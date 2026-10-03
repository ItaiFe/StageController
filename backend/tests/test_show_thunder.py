import random
from pathlib import Path

import pytest

from app.features.show import tunables
from app.features.show.songmap import SongMap
from app.features.show.thunder import Thunder

FIXTURE = Path(__file__).parent / "fixtures" / "its_only_love.analysis.json"


class Pick:
    """RNG stub: always picks the given pole."""
    def __init__(self, side):
        self.side = side

    def choice(self, options):
        assert list(options) == ["L", "R"]
        return self.side


@pytest.fixture(autouse=True)
def clean():
    tunables.clear_overrides()
    yield
    tunables.clear_overrides()


def fixture(side="L"):
    m = SongMap.load(FIXTURE)
    return m, Thunder(m, Pick(side))


def beat(m, k, b0=169):
    return m.beats[b0 + k]


def test_one_window_at_the_end_of_verse_two_on_the_beat_grid():
    m, th = fixture()
    (w,) = th.windows
    assert w.verse == 2 and w.pole == "L"
    assert w.change_s == beat(m, 0) == 126.665  # the beat nearest the verse end (126.67)
    assert w.window_beats == 4  # 4 beats at 103.4 bpm = 2.345 s >= minWindowMs
    assert w.start_s == beat(m, -8) == 121.951
    assert w.end_s == beat(m, 4) == 129.01


def test_the_pole_comes_from_the_injected_rng():
    m = SongMap.load(FIXTURE)
    assert Thunder(m, Pick("R")).windows[0].pole == "R"
    assert Thunder(m, random.Random(1)).windows[0].pole == Thunder(m, random.Random(1)).windows[0].pole


def test_no_window_after_verse_one_or_the_last_verse():
    secs = [{"start": i * 10, "end": i * 10 + 10, "label": "verse"} for i in range(5)]
    th = Thunder(SongMap(None, [], secs), Pick("L"))
    assert [w.verse for w in th.windows] == [2, 3, 4]
    assert [w.change_s for w in th.windows] == [20, 30, 40]
    assert Thunder(SongMap(None, [], []), Pick("L")).windows == []


def frames(m, th, ks):
    return [th.frame(beat(m, k) + 0.01) for k in ks]


def test_build_rush_open_window_per_beat():
    m, th = fixture("L")
    got = [(f.phase, f.beat, f.poles["L"].pct, f.poles["L"].mode, f.poles["L"].color) for f in frames(m, th, range(-8, 4))]
    assert got == [
        ("build", -8, 12, "solid", "white"), ("build", -7, 25, "solid", "white"),
        ("build", -6, 38, "solid", "white"), ("build", -5, 50, "solid", "white"),
        ("rush", -4, 62, "pulse", "white"), ("rush", -3, 75, "pulse", "white"),
        ("rush", -2, 88, "pulse", "white"), ("rush", -1, 100, "pulse", "white"),
        ("open", 0, 100, "solid", "white"),
        ("window", 1, 75, "solid", "white"), ("window", 2, 50, "solid", "white"), ("window", 3, 25, "solid", "white"),
    ]
    assert all("R" not in f.poles for f in frames(m, th, range(-8, 4)))  # the other pole is dark


def test_rush_pulses_at_double_the_beat_rate():
    m, th = fixture()
    f = th.frame(beat(m, -2) + 0.01)
    assert f.poles["L"].ms == round((beat(m, 4) - beat(m, 0)) / 4 * 1000 / 2)  # half a beat per pulse


def test_rest_before_the_countdown_and_after_the_window():
    m, th = fixture()
    assert th.frame(beat(m, -8) - 0.01) is None
    assert th.frame(beat(m, 4)) is None
    assert th.frame(200) is None


def test_tag_fires_on_the_first_beat_after_the_press_arrives():
    m, th = fixture("L")
    # pressed on the change, but the pillar reports ~400 ms after the release
    assert th.press("L", "tap", 126.67, 127.07) == "tag"
    (w,) = th.to_log(127.07)
    assert th.to_log(130) == []
    assert w.outcome == "tag" and w.fire_s == beat(m, 1) == 127.269
    assert th.frame(127.2).phase == "open"  # the countdown runs on until the fire beat
    tag = th.frame(127.27)
    assert (tag.phase, tag.beat, tag.poles, tag.perimeter.look) == ("tag", 1, {}, "blackout")
    look = th.frame(127.27 + 0.3)  # after half a beat
    assert (look.phase, look.poles, look.perimeter.look) == ("new_look", {}, "new_look")
    assert th.frame(129.1) is None
    assert w.record(7, 103.4) == {"songId": "7", "verse": 2, "pole": "L", "outcome": "tag", "pressOffsetMs": 5,
                                  "windowBeats": 4, "bpm": 103.4}


def test_tag_never_fires_before_the_change_nor_before_the_press():
    m, th = fixture()
    th.press("L", "tap", 126.6, 126.6)  # inside the grace, arrived before the change
    assert th.windows[0].fire_s == beat(m, 0)
    _, th = fixture()
    th.press("L", "tap", 127.5, 127.5)  # pressed mid-window
    assert th.windows[0].fire_s == beat(m, 2)
    _, th = fixture()
    th.press("L", "tap", beat(m, 2), beat(m, 2))  # exactly on a beat fires on that beat
    assert th.windows[0].fire_s == beat(m, 2)


def test_grace_edge_between_early_and_tag():
    grace = tunables.get("graceMs") / 1000
    m, th = fixture()
    assert th.press("L", "tap", beat(m, 0) - grace, 127.0) == "tag"
    _, th = fixture()
    assert th.press("L", "tap", beat(m, 0) - grace - 0.001, 127.0) == "early"


def test_tag_up_to_the_window_end_and_not_after():
    m, th = fixture()
    assert th.press("L", "tap", beat(m, 4), beat(m, 4) + 0.4) == "tag"
    assert th.windows[0].fire_s == beat(m, 5)  # the window is over: the next beat after arrival
    _, th = fixture()
    assert th.press("L", "tap", beat(m, 4) + 0.01, beat(m, 4) + 0.4) is None


def test_early_press_drops_the_pole_and_gives_a_halo():
    m, th = fixture("R")
    arrival = beat(m, -3) + 0.1
    assert th.press("R", "tap", arrival - 0.4, arrival) == "early"
    w = th.windows[0]
    f = th.frame(arrival)
    assert (f.phase, f.beat) == ("early", -3)
    assert f.poles["R"].model_dump() == {"pct": 75, "color": "white", "mode": "drain", "ms": tunables.get("earlyFallMs")}
    assert f.perimeter.look == "halo"
    bar = (beat(m, 4) - beat(m, 0)) / 4 * 4
    assert th.frame(arrival + bar * tunables.get("flareBars") - 0.01).phase == "early"
    assert th.frame(arrival + bar * tunables.get("flareBars") + 0.01) is None
    assert th.frame(beat(m, 0) + 0.01).phase == "early" and th.frame(beat(m, 3) + 0.01) is None  # no open, no window
    assert w.record(1, 103.4)["outcome"] == "early" and w.record(1, 103.4)["pressOffsetMs"] < 0


def test_a_second_press_after_the_outcome_is_ordinary():
    m, th = fixture()
    th.press("L", "tap", 127.0, 127.0)
    assert th.press("L", "tap", 127.5, 127.5) is None


def test_press_before_the_countdown_or_on_the_dark_pole_is_not_thunder():
    m, th = fixture("L")
    assert th.press("L", "tap", beat(m, -8) - 0.01, beat(m, -8) + 0.39) is None
    assert th.press("R", "tap", 126.7, 127.0) is None
    assert th.windows[0].outcome is None


def test_only_the_dark_pole_may_applaud_during_countdown_and_window():
    m, th = fixture("L")
    assert th.press("R", "claps", 122.0, 122.4) == "dark"
    assert th.press("L", "claps", 122.0, 122.4) == "blocked"
    assert th.press("L", "claps", 128.5, 128.9) == "blocked"
    assert th.press("L", "claps", 110.0, 110.4) is None  # no countdown: today's claps
    assert th.press("L", "claps", 129.5, 129.9) is None
    th.press("L", "tap", 123.0, 123.4)  # early cancels the countdown, applause is free again
    assert th.press("L", "claps", 124.0, 124.4) is None


def test_none_is_reported_once_and_only_for_a_window_that_was_seen():
    m, th = fixture()
    th.frame(122.0)
    assert th.to_log(128.0) == []
    (w,) = th.to_log(129.1)
    assert w.record(1, 103.4)["outcome"] == "none" and w.record(1, 103.4)["pressOffsetMs"] is None
    assert th.to_log(130.0) == []
    _, th = fixture()
    assert th.to_log(200.0) == []  # seeked over it: never opened


def test_fallback_timing_without_beats():
    m = SongMap.load(FIXTURE)
    th = Thunder(SongMap(None, [], m.sections), Pick("L"))
    (w,) = th.windows
    countdown, window = tunables.get("fallbackCountdownMs") / 1000, tunables.get("fallbackWindowMs") / 1000
    assert w.change_s == 126.67 and w.window_beats == tunables.get("windowBeatsShort")
    assert w.start_s == pytest.approx(126.67 - countdown) and w.end_s == pytest.approx(126.67 + window)
    assert th.frame(126.67 - countdown + 0.01).poles["L"].pct == 12
    assert th.frame(126.67 + 0.01).phase == "open"
    assert th.frame(126.67 + window - 0.01).phase == "window"
    assert th.frame(126.67 + window + 0.01) is None
    assert th.press("L", "tap", 127.0, 127.4) == "tag" and w.fire_s == pytest.approx(126.67 + window / 4 * 2)
    assert w.record(1, None)["bpm"] is None


def test_fast_song_gets_the_long_window():
    beats = [i * 0.25 for i in range(400)]  # 240 bpm: 4 beats = 1 s < minWindowMs
    secs = [{"start": 0, "end": 30, "label": "verse"}, {"start": 30, "end": 60, "label": "verse"},
            {"start": 60, "end": 90, "label": "verse"}]
    (w,) = Thunder(SongMap(240, beats, secs), Pick("L")).windows
    assert w.window_beats == tunables.get("windowBeatsLong") and w.end_s == 62.0


def test_countdown_follows_the_tunables():
    tunables.set_override("countdownBeats", 4)
    tunables.set_override("rushBeats", 2)
    m, th = fixture()
    assert th.windows[0].start_s == beat(m, -4)
    assert [(f.phase, f.poles["L"].pct) for f in frames(m, th, range(-4, 0))] == [
        ("build", 25), ("build", 50), ("rush", 75), ("rush", 100)]
