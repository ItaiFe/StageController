"""ShowDirector: the show state machine (idle -> launching -> intro -> playing, or failing).

All time comes from the injected clock and the player behind a small adapter, so tests run
whole launches instantly without mpv or a database. The real adapter is StagePlayer.
"""
import asyncio
import time
from dataclasses import dataclass
from functools import partial
from pathlib import Path

from app.features.buttons.rules import IDLE_TAPS, IN_SONG

from . import events, tunables
from . import analytics
from .launch import LaunchArbiter, LaunchResult
from .schemas import Pole
from .songmap import SongMap

TICK_S = 0.02
# analytics press kind by in-song meaning (anything else is "ordinary")
PRESS_KIND = {"skip": "skip", "claps": "applause"}
INTRO_STEPS = tunables.SPEC["intro"]["steps"]


class Clock:
    def now_ms(self) -> int:
        return int(time.monotonic() * 1000)


@dataclass
class SongStatus:
    id: int
    t: float  # seconds into the song
    duration: float


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

    def status(self) -> SongStatus | None:
        from app.features.player.service import player
        state = player.get_state()
        song = state["current_song"]
        return SongStatus(song["id"], state["current_time"], state["duration"]) if song else None

    def song_map(self) -> SongMap:
        from app.core.config import MUSIC_DIR
        from app.core.database import SessionLocal
        from app.features.player.service import player
        from app.features.songs.models import Song

        db = SessionLocal()
        try:
            song = db.get(Song, player.get_current_song_id())
            path = Path(song.file_path) if song else Path()
        finally:
            db.close()
        # the sidecar sits next to the audio: <stem>.analysis.json
        return SongMap.load((path if path.is_absolute() else MUSIC_DIR / path).with_suffix(".analysis.json"))

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
    def __init__(self, player, clock, emit, log=None):
        self._player = player
        self._clock = clock
        self._emit = emit
        self._log_to = log
        self._map = SongMap(None, [], [])
        self._song_id: int | None = None
        self._song_started_ms = 0
        self._t = 0.0  # song time at the last tick
        self._key = None  # (section, turn) of the last playing event
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
            if self.state == "playing":
                self._log("press", side=side, kind="stop")
            await self.to_idle("stop")
            await self._player.run_action("stop")
            return self._ok(action, side)
        if self.state != "playing":
            return self._ignored(action, self.state)
        what = IN_SONG[action]
        if what == "skip" and (status := self._player.status()) and status.t > self._map.skip_cutoff_s():
            self._log("press", side=side, kind="ordinary")
            return self._ignored(action, "after_cutoff")
        self._log("press", side=side, kind=PRESS_KIND.get(what, "ordinary"))
        if what == "tap":
            return self._ignored(action, "ordinary")
        await self._player.run_action(what)
        if what == "skip":
            await self._after_skip()
        return self._ok(action, side)

    async def tick(self) -> None:
        now = self._clock.now_ms()
        if self.state == "launching" and (result := self._arbiter.poll(now)):
            self._decide(result, now)
        while self._timeline and self._timeline[0][0] <= now:
            _, step = self._timeline.pop(0)
            await step()
        if self.state == "playing":
            if status := self._player.status():
                await self._follow(status)
            else:
                await self.to_idle()  # song ended or was stopped from somewhere else

    async def to_idle(self, reason: str = "finished") -> None:
        was_idle = self.state == "idle"
        self._end_song(reason)
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

    def _log(self, kind: str, /, **fields) -> None:
        if self._log_to:
            self._log_to(kind, self._clock.now_ms(), **fields)

    def _decide(self, result: LaunchResult, now: int) -> None:
        self._log("launch_attempt", countL=result.count_l, countR=result.count_r, gapMs=result.gap_ms, result=result.game)
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
        await self._emit(events.legacy_start(game))
        await self._begin_song(song_id)

    async def _begin_song(self, song_id: int) -> None:
        self._song_id = song_id
        self._song_started_ms = self._clock.now_ms()
        self._key = None
        self._map = self._player.song_map()
        self._log("song_start", songId=str(song_id), game=self.game, bpm=self._map.bpm,
                  hasSections=self._map.has_markers, hasBeats=bool(self._map.beats))
        if not self._map.has_markers:
            self._log("fault", kind="markers_missing", detail=f"song {song_id}: no usable sections, using spec fallbacks")
        if status := self._player.status():
            await self._follow(status)

    async def _follow(self, status: SongStatus) -> None:
        """One playing event whenever the section or the showoff turn changes."""
        self._t = status.t
        section = self._map.section_at(status.t)
        turn = self._map.turn_owner(status.t, status.duration) if self.game == "showoff" else None
        if (section, turn) != self._key:
            self._key = (section, turn)
            await self._emit(events.playing(self.game, status.id, section, turn, status.t))

    async def _after_skip(self) -> None:
        self._end_song("skip")
        if status := self._player.status():
            await self._begin_song(status.id)  # same game, next song (a one-song playlist replays it)
        else:
            await self.to_idle()

    def _end_song(self, reason: str) -> None:
        if self._song_id is None:
            return
        self._log("song_end", songId=str(self._song_id), game=self.game, reason=reason,
                  playedMs=self._clock.now_ms() - self._song_started_ms, atMs=int(self._t * 1000))
        self._song_id = None

    def _ok(self, action, side) -> dict:
        return {"status": "ok", "action": action, "side": side, "show_state": self.state}

    def _ignored(self, action, reason) -> dict:
        return {"status": "ignored", "action": action, "reason": reason, "show_state": self.state}


director = ShowDirector(StagePlayer(), Clock(), _broadcast, analytics.append)
