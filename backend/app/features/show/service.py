"""ShowDirector: the show state machine (idle -> launching -> intro -> playing, or failing).

All time comes from the injected clock and the player behind a small adapter, so tests run
whole launches instantly without mpv or a database. The real adapter is StagePlayer.
"""
import asyncio
import time
from functools import partial

from app.features.buttons.rules import IDLE_TAPS, IN_SONG

from . import events, tunables
from .launch import LaunchArbiter, LaunchResult
from .schemas import Pole

TICK_S = 0.02
INTRO_STEPS = tunables.SPEC["intro"]["steps"]


class Clock:
    def now_ms(self) -> int:
        return int(time.monotonic() * 1000)


class StagePlayer:
    """The real thing: game playlists, the existing button handlers and mpv."""

    async def start_game(self, game: str) -> int | None:
        from app.core.database import SessionLocal
        from app.features.buttons.router import handle_start_action
        from app.features.player.service import player

        # Always a fresh shuffle of this game's playlist, never a queue left by another one
        player.stop(advance_queue=False)
        player.clear_queue()
        db = SessionLocal()
        try:
            await handle_start_action(db, game)
        finally:
            db.close()
        return player.get_current_song_id()

    def song_loaded(self) -> bool:
        from app.features.player.service import player
        return player.get_current_song_id() is not None

    async def run_action(self, action: str) -> None:
        from app.core.database import SessionLocal
        from app.features.buttons.router import perform

        db = SessionLocal()
        try:
            await perform(action, db)
        finally:
            db.close()


async def _broadcast(event) -> None:
    from app.features.buttons.router import manager
    await manager.broadcast(event)


class ShowDirector:
    def __init__(self, player, clock, emit):
        self._player = player
        self._clock = clock
        self._emit = emit
        self._arbiter = LaunchArbiter()
        self._poles: dict[str, Pole] = {}
        self._timeline: list[tuple[int, object]] = []  # (due_ms, async callable), in due order
        self.state = "idle"
        self.game: str | None = None

    async def on_press(self, action: str, side: str, first_press_ago_ms: int = 0) -> dict:
        now = self._clock.now_ms()
        if self.state in ("idle", "launching"):
            if action == "stop":
                await self.to_idle()
                await self._player.run_action("stop")
            elif action in IDLE_TAPS:
                taps = IDLE_TAPS[action]
                if not self._arbiter.on_gesture(side, taps, now - first_press_ago_ms, now):
                    return self._ignored(action, "late_press")
                self.state = "launching"
                self._poles[side] = events.launch_pole(taps)
                await self._emit(events.launching(self._poles))
            return self._ok(action, side)
        if action == "stop" and self.state in ("intro", "playing"):
            await self.to_idle()
            await self._player.run_action("stop")
            return self._ok(action, side)
        if self.state == "playing" and IN_SONG[action] != "tap":
            await self._player.run_action(IN_SONG[action])
            return self._ok(action, side)
        return self._ignored(action, self.state if self.state != "playing" else "ordinary")

    async def tick(self) -> None:
        now = self._clock.now_ms()
        if self.state == "launching" and (result := self._arbiter.poll(now)):
            self._decide(result, now)
        while self._timeline and self._timeline[0][0] <= now:
            _, step = self._timeline.pop(0)
            await step()
        if self.state == "playing" and not self._player.song_loaded():
            await self.to_idle()  # song ended or was stopped from somewhere else

    async def to_idle(self) -> None:
        was_idle = self.state == "idle"
        self._arbiter.reset()
        self._poles = {}
        self._timeline = []
        self.state = "idle"
        self.game = None
        if not was_idle:
            await self._emit(events.idle())

    async def run(self) -> None:
        while True:
            await asyncio.sleep(TICK_S)
            try:
                await self.tick()
            except Exception as e:  # a broken tick must not end the show loop
                print(f"Show director tick failed: {e}")

    def _decide(self, result: LaunchResult, now: int) -> None:
        self._poles = {}
        if result.game == "fail":
            self._schedule_fail(now)
        else:
            self._schedule_intro(result, now)

    def _schedule_intro(self, result: LaunchResult, now: int) -> None:
        self.state, self.game = "intro", result.game
        step_ms = tunables.get("introStepMs")
        for i, count in enumerate(range(INTRO_STEPS, 0, -1)):
            self._timeline.append((now + i * step_ms, partial(self._emit, events.intro(result.game, count, result.side))))
        self._timeline.append((now + INTRO_STEPS * step_ms, self._start_song))

    def _schedule_fail(self, now: int) -> None:
        self.state = "failing"
        blink_ms = tunables.get("failBlinkMs")
        count = tunables.get("failBlinkCount")
        for i in range(count):
            lit = "L" if i % 2 == 0 else "R"
            self._timeline.append((now + i * blink_ms, partial(self._emit, events.fail_blink(lit))))
        last = "L" if (count - 1) % 2 == 0 else "R"
        self._timeline.append((now + count * blink_ms, partial(self._emit, events.fail_fade(last))))
        self._timeline.append((now + count * blink_ms + tunables.get("failFadeMs"), self.to_idle))

    async def _start_song(self) -> None:
        game = self.game
        self.state = "playing"
        song_id = await self._player.start_game(game)
        if song_id is None:
            print(f"Show: no song to play for game {game!r} (missing or empty playlist)")
            await self.to_idle()
            return
        await self._emit(events.playing(game, song_id))

    def _ok(self, action, side) -> dict:
        return {"status": "ok", "action": action, "side": side, "show_state": self.state}

    def _ignored(self, action, reason) -> dict:
        return {"status": "ignored", "action": action, "reason": reason, "show_state": self.state}


director = ShowDirector(StagePlayer(), Clock(), _broadcast)
