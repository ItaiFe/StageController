import asyncio

import pytest

from app.features.show import tunables
from app.features.show.service import ShowDirector

STEP = 20  # the real loop ticks about every 20 ms


class FakeClock:
    def __init__(self):
        self.t = 0

    def now_ms(self):
        return self.t


class FakePlayer:
    def __init__(self, song_id=1):
        self.song_id = song_id
        self.loaded = False
        self.started: list[str] = []
        self.actions: list[str] = []

    async def start_game(self, game):
        self.started.append(game)
        self.loaded = self.song_id is not None
        return self.song_id

    def song_loaded(self):
        return self.loaded

    async def run_action(self, action):
        self.actions.append(action)
        if action == "stop":
            self.loaded = False


class Rig:
    def __init__(self, song_id=1):
        self.clock = FakeClock()
        self.player = FakePlayer(song_id)
        self.events = []

        async def emit(event):
            self.events.append((self.clock.t, event))

        self.director = ShowDirector(self.player, self.clock, emit)

    def press(self, action, side, ago=0):
        return asyncio.run(self.director.on_press(action, side, ago))

    def advance(self, ms):
        end = self.clock.t + ms
        while self.clock.t < end:
            self.clock.t += STEP
            asyncio.run(self.director.tick())

    def states(self):
        return [(e.state, e.step) for _, e in self.events]

    def at(self, state, step=None):
        return next(t for t, e in self.events if e.state == state and e.step == step)


@pytest.fixture(autouse=True)
def clean():
    tunables.clear_overrides()
    yield
    tunables.clear_overrides()


def test_solo_launch_runs_the_intro_then_starts_the_song():
    rig = Rig()
    assert rig.press("start", "L")["status"] == "ok"
    assert rig.director.state == "launching"
    launching = rig.events[-1][1]
    assert (launching.poles.L.pct, launching.poles.R.pct) == (33, 0)

    rig.advance(500)
    assert rig.director.state == "intro" and rig.director.game == "solo"
    decided = rig.at("intro", 3)
    rig.advance(1000)
    rig.advance(2000 - 20)
    assert rig.player.started == []  # the song waits for the whole 3 s
    rig.advance(20)
    assert rig.player.started == ["solo"]
    assert rig.director.state == "playing"

    assert rig.states() == [("launching", None), ("intro", 3), ("intro", 2), ("intro", 1), ("playing", None)]
    assert [rig.at("intro", s) - decided for s in (2, 1)] == [1000, 2000]
    assert rig.at("playing") - decided == 3000
    assert [e.poles.L.pct for _, e in rig.events if e.state == "intro"] == [100, 66, 33]
    assert rig.events[-1][1].song.id == 1


def test_duet_launch_from_two_near_simultaneous_presses():
    rig = Rig()
    rig.press("start", "L", ago=0)
    rig.advance(100)
    rig.press("start", "R", ago=100)  # first press was 100 ms ago, i.e. together with the left
    rig.advance(500)
    assert (rig.director.state, rig.director.game) == ("intro", "duet")
    rig.advance(3000)
    assert rig.player.started == ["duet"]


def test_first_press_ago_decides_togetherness_not_arrival():
    rig = Rig()
    rig.advance(900)
    rig.press("claps", "L", ago=800)     # first press at t=100
    rig.advance(450)
    rig.press("claps", "R", ago=1000)    # arrives 450 ms later (> syncWindowMs) but first pressed at t=350
    rig.advance(500)
    assert rig.director.game == "showoff"


@pytest.mark.parametrize("action,game", [("claps", "showoff"), ("special", "thunder")])
def test_showoff_and_thunder_launch_and_play(action, game):
    rig = Rig()
    rig.press(action, "L")
    rig.press(action, "R", ago=50)
    rig.advance(500 + 3000)
    assert rig.player.started == [game]


def test_late_opposite_press_is_ignored_and_the_left_goes_solo():
    rig = Rig()
    rig.press("start", "L")
    rig.advance(450)
    assert rig.press("start", "R", ago=0)["status"] == "ignored"
    rig.advance(500)
    assert rig.director.game == "solo"


def test_mismatched_counts_blink_fade_and_return_to_idle():
    rig = Rig()
    rig.press("claps", "L")
    rig.press("special", "R")
    rig.advance(500)
    assert rig.director.state == "failing"
    rig.advance(4 * 250 + 500 + STEP)
    lit = [(e.poles.L.pct, e.poles.R.pct) for _, e in rig.events if e.state == "failing"]
    assert lit == [(100, 0), (0, 100), (100, 0), (0, 100), (0, 100)]
    fade = [e for _, e in rig.events if e.state == "failing"][-1]
    assert fade.poles.R.mode == "drain" and fade.poles.R.ms == 500
    assert rig.events[-1][1].state == "idle" and rig.director.state == "idle"
    assert rig.player.started == []
    blink_times = [t for t, e in rig.events if e.state == "failing"]
    assert all(abs(b - blink_times[0] - n * 250) <= STEP for n, b in enumerate(blink_times))


def test_launch_pole_follows_the_tap_count():
    rig = Rig()
    rig.press("claps", "R")
    assert rig.events[-1][1].poles.R.pct == 66


def test_long_press_while_idle_only_turns_everything_off():
    rig = Rig()
    rig.press("stop", "L")
    assert rig.player.actions == ["stop"]
    assert rig.director.state == "idle" and rig.events == []


def test_long_press_while_launching_cancels_the_round():
    rig = Rig()
    rig.press("start", "L")
    rig.press("stop", "R")
    rig.advance(2000)
    assert rig.director.state == "idle" and rig.player.started == []
    assert rig.events[-1][1].state == "idle"


def test_presses_are_ignored_during_the_intro_but_stop_cancels_it():
    rig = Rig()
    rig.press("start", "L")
    rig.advance(1000)
    assert rig.director.state == "intro"
    assert rig.press("claps", "L")["status"] == "ignored"
    rig.press("stop", "L")
    rig.advance(5000)
    assert rig.director.state == "idle" and rig.player.started == []


def play_solo(rig):
    rig.press("start", "L")
    rig.advance(500 + 3000 + STEP)
    assert rig.director.state == "playing"


def test_in_song_gestures_use_todays_handlers_and_a_plain_tap_does_nothing():
    rig = Rig()
    play_solo(rig)
    for action in ("claps", "special", "skip"):
        assert rig.press(action, "R")["status"] == "ok"
    assert rig.press("start", "L")["status"] == "ignored"
    assert rig.player.actions == ["claps", "special", "skip"]


def test_stop_in_song_ends_the_show_and_returns_to_idle():
    rig = Rig()
    play_solo(rig)
    rig.press("stop", "L")
    assert rig.player.actions == ["stop"]
    assert rig.director.state == "idle" and rig.events[-1][1].state == "idle"


def test_song_end_returns_to_idle_once():
    rig = Rig()
    play_solo(rig)
    asyncio.run(rig.director.to_idle())
    asyncio.run(rig.director.to_idle())
    assert [e.state for _, e in rig.events].count("idle") == 1


def test_song_vanishing_under_the_director_is_noticed():
    rig = Rig()
    play_solo(rig)
    rig.player.loaded = False  # stopped from the web UI
    rig.advance(STEP)
    assert rig.director.state == "idle"


def test_empty_playlist_goes_back_to_idle():
    rig = Rig(song_id=None)
    rig.press("start", "L")
    rig.advance(500 + 3000 + STEP)
    assert rig.director.state == "idle" and rig.events[-1][1].state == "idle"


def test_a_new_launch_works_after_a_song():
    rig = Rig()
    play_solo(rig)
    asyncio.run(rig.director.to_idle())
    rig.press("start", "R")
    rig.advance(500)
    assert rig.director.game == "solo"
    assert rig.events[-1][1].poles.R.pct == 100


def test_intro_step_follows_the_tunable():
    tunables.set_override("introStepMs", 500)
    rig = Rig()
    rig.press("start", "L")
    rig.advance(500 + 1500 + STEP)
    assert rig.player.started == ["solo"]
