import json

import pytest

from app.features.show import events, tunables


@pytest.fixture(autouse=True)
def clean():
    tunables.clear_overrides()
    yield
    tunables.clear_overrides()


def poles(ev):
    return {s: (p.pct, p.color, p.mode) for s, p in (("L", ev.poles.L), ("R", ev.poles.R))}


def test_launch_pole_fills_by_count_and_caps_at_100():
    assert [events.launch_pole(n).pct for n in (1, 2, 3, 4, 7)] == [33, 66, 100, 100, 100]


def test_duet_intro_steps_down_the_pole_pcts_on_both_sides():
    got = [events.intro("duet", c).poles.L.pct for c in (3, 2, 1)]
    assert got == tunables.get("polePcts")[:3] == [100, 66, 33]
    ev = events.intro("duet", 2)
    assert poles(ev) == {"L": (66, "pink", "solid"), "R": (66, "pink", "solid")}
    assert ev.step == 2 and ev.state == "intro" and ev.game == "duet"


def test_solo_intro_lights_only_the_presser():
    ev = events.intro("solo", 3, "R")
    assert poles(ev) == {"L": (0, None, "off"), "R": (100, "pink", "solid")}
    assert ev.perimeter.side == "R"


def test_showoff_intro_keeps_player_colours_then_merges_to_pink():
    assert poles(events.intro("showoff", 3))["L"][1:] == ("lime", "solid")
    assert poles(events.intro("showoff", 2))["R"][1] == "blue"
    last = events.intro("showoff", 1)
    assert [c for _, c, _ in poles(last).values()] == ["pink", "pink"]
    assert last.perimeter.look == "merge"


def test_thunder_intro_is_white_and_walks_left_right_centre():
    assert [events.intro("thunder", c).perimeter.side for c in (3, 2, 1)] == ["L", "R", "centre"]
    assert {c for _, c, _ in poles(events.intro("thunder", 3)).values()} == {"white"}


def test_fail_events_are_white_and_fade_uses_the_tunable():
    assert poles(events.fail_blink("L"))["L"] == (100, "white", "solid")
    fade = events.fail_fade("R")
    assert fade.poles.R.mode == "drain" and fade.poles.R.ms == 500


def test_playing_and_idle_have_poles_off():
    ev = events.playing("duet", 7)
    assert ev.song.id == 7 and poles(ev)["L"][2] == "off"
    assert events.idle().state == "idle"


def test_event_serialises_to_the_documented_envelope():
    data = json.loads(events.intro("duet", 3).model_dump_json())
    assert data["action"] == "show" and "timestamp" in data
    assert set(data["poles"]) == {"L", "R"}
