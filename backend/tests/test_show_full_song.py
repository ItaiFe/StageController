"""Whole songs, headless and instantly (design D5): a fake clock and a fake player whose song time
runs with the clock play the fixture song from the launch presses to the song's end, through the
real director, the real event builders and the real JSONL log."""
import asyncio
import json
from itertools import groupby
from pathlib import Path

import pytest

from app.features.show import analytics, tunables
from app.features.show.service import ShowDirector, SongStatus
from app.features.show.songmap import SongMap

FIXTURE = Path(__file__).parent / "fixtures" / "its_only_love.analysis.json"
DURATION_MS = 290_551
STEP = 20


class Pick:
    def __init__(self, side):
        self.side = side

    def choice(self, options):
        return self.side


class Clock:
    t = 0

    def now_ms(self):
        return self.t


class SongPlayer:
    """Plays the fixture song: song time is the clock since start_game, gone at the end."""

    def __init__(self, clock):
        self.clock, self.started_ms, self.actions = clock, None, []

    async def start_game(self, game):
        self.started_ms = self.clock.t
        return 1

    def status(self):
        if self.started_ms is None or self.clock.t - self.started_ms >= DURATION_MS:
            return None
        return SongStatus(1, (self.clock.t - self.started_ms) / 1000, DURATION_MS / 1000)

    def song_map(self):
        return SongMap.load(FIXTURE)

    async def run_action(self, action):
        self.actions.append(action)


@pytest.fixture(autouse=True)
def jsonl(tmp_path, monkeypatch):
    tunables.clear_overrides()
    monkeypatch.setattr(analytics, "PATH", tmp_path / "show-events.jsonl")
    yield tmp_path / "show-events.jsonl"
    tunables.clear_overrides()


def run(launch, script=(), pole="L"):
    """launch: [(action, side, ago)] pressed at clock 0; script: [(song_t, action, side, ago)]."""
    clock = Clock()
    player = SongPlayer(clock)
    events = []

    async def emit(event):
        if event.action == "show":
            events.append(event)

    director = ShowDirector(player, clock, emit, analytics.append, rng=Pick(pole))

    async def main():
        for action, side, ago in launch:
            await director.on_press(action, side, ago)
        pending = list(script)
        while clock.t < DURATION_MS + 10_000:
            clock.t += STEP
            status = player.status()
            if pending and status and status.t >= pending[0][0]:
                _, action, side, ago = pending.pop(0)
                await director.on_press(action, side, ago)
            await director.tick()
            if director.state == "idle":
                return

    asyncio.run(main())
    assert director.state == "idle" and player.started_ms is not None
    return events, player


def lines(path):
    return [json.loads(l) for l in path.read_text().splitlines()]


def states(events):
    return [k for k, _ in groupby((e.state, e.step) for e in events)]


def playing(events):
    return [e for e in events if e.state == "playing"]


EXPECTED_STATES = [("launching", None), ("intro", 3), ("intro", 2), ("intro", 1), ("playing", None), ("idle", None)]
SECTIONS = [("intro", 1), ("instrumental", 1), ("verse", 1), ("instrumental", 2), ("verse", 2), ("chorus", 1),
            ("instrumental", 3), ("bridge", 1), ("instrumental", 4), ("chorus", 2), ("verse", 3), ("chorus", 3),
            ("outro", 1)]


def check_log(path, game, count, extra=()):
    log = lines(path)
    assert [l["type"] for l in log] == ["launch_attempt", "song_start", *[e["type"] for e in extra], "song_end"]
    assert log[0]["countL"] + log[0]["countR"] == count and log[0]["result"] == game
    assert log[1] == {**log[1], "songId": "1", "game": game, "bpm": 103.4, "hasSections": True, "hasBeats": True}
    for line, want in zip(log[2:-1], extra):
        assert {k: line[k] for k in want} == want
    end = log[-1]
    assert (end["reason"], end["game"]) == ("finished", game)
    assert end["playedMs"] == pytest.approx(DURATION_MS, abs=STEP) and end["atMs"] == pytest.approx(DURATION_MS, abs=STEP)
    monos = [l["mono"] for l in log]
    assert monos == sorted(monos)
    return log


def test_solo_whole_song(jsonl):
    events, player = run([("start", "R", 0)])
    assert states(events) == EXPECTED_STATES
    assert [e.poles.R.pct for e in events if e.state == "intro"] == [100, 66, 33]
    assert [(e.song.section, e.song.section_index) for e in playing(events)] == SECTIONS
    assert all(e.turn is None and e.thunder is None for e in playing(events))
    check_log(jsonl, "solo", 1)
    assert player.actions == []


def test_duet_whole_song(jsonl):
    events, _ = run([("start", "L", 0), ("start", "R", 80)])
    assert states(events) == EXPECTED_STATES
    assert all(e.poles.L.color == e.poles.R.color == "pink" for e in events if e.state == "intro")
    assert [(e.song.section, e.song.section_index) for e in playing(events)] == SECTIONS
    log = check_log(jsonl, "duet", 2)
    assert log[0]["gapMs"] == 80


def test_showoff_whole_song(jsonl):
    events, _ = run([("claps", "L", 0), ("claps", "R", 30)])
    assert states(events) == EXPECTED_STATES
    changes = [(turn, next(group).song.t) for turn, group in groupby(playing(events), key=lambda e: e.turn)]
    assert [turn for turn, _ in changes] == ["both", "L", "both", "R", "both", "L", "both"]
    assert [t for turn, t in changes if turn != "both"] == pytest.approx([66.04, 104.77, 194.49], abs=0.021)
    check_log(jsonl, "showoff", 4)


def thunder_phases(events):
    """Phase and beat as they change (a section change re-sends the current frame)."""
    return [k for k, _ in groupby((e.thunder.phase, e.thunder.beat) for e in playing(events) if e.thunder)]


def test_thunder_whole_song_with_a_tag(jsonl):
    # the right pillar's friend taps on the change; the pillar reports it 400 ms later
    events, player = run([("special", "L", 0), ("special", "R", 40)], script=[(127.07, "start", "R", 400)], pole="R")
    assert states(events) == EXPECTED_STATES
    assert [e.perimeter.side for e in events if e.state == "intro"] == ["L", "R", "centre"]
    assert thunder_phases(events) == [("build", k) for k in range(-8, -4)] + [("rush", k) for k in range(-4, 0)] + [
        ("open", 0), ("tag", 1), ("new_look", 1)]
    tag = next(e for e in playing(events) if e.thunder and e.thunder.phase == "tag")
    assert tag.song.t == pytest.approx(127.269, abs=0.021)
    assert player.actions == ["special"]
    check_log(jsonl, "thunder", 6, extra=[
        {"type": "press", "side": "R", "kind": "tag"},
        {"type": "window", "songId": "1", "verse": 2, "pole": "R", "outcome": "tag", "pressOffsetMs": 15,  # arrived on the 127.08 tick
         "windowBeats": 4, "bpm": 103.4}])


def test_thunder_whole_song_with_an_early_press(jsonl):
    events, player = run([("special", "L", 0), ("special", "R", 40)], script=[(124.5, "start", "L", 400)], pole="L")
    assert thunder_phases(events) == [("build", k) for k in range(-8, -4)] + [("rush", -4), ("early", -4)]
    early = next(e for e in playing(events) if e.thunder and e.thunder.phase == "early")
    assert (early.poles.L.mode, early.poles.L.pct, early.perimeter.look) == ("drain", 62, "halo")
    assert player.actions == []
    check_log(jsonl, "thunder", 6, extra=[
        {"type": "press", "side": "L", "kind": "early"},
        {"type": "window", "verse": 2, "pole": "L", "outcome": "early", "pressOffsetMs": -2565}])


def test_thunder_whole_song_without_a_press(jsonl):
    events, _ = run([("special", "L", 0), ("special", "R", 40)], pole="L")
    assert thunder_phases(events)[-4:] == [("open", 0), ("window", 1), ("window", 2), ("window", 3)]
    check_log(jsonl, "thunder", 6, extra=[{"type": "window", "outcome": "none", "pressOffsetMs": None}])
