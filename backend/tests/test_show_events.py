import json

import pytest

from app.features.show import events, tunables
from app.features.show.schemas import Pole


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


def test_solo_intro_lights_both_poles_and_all_round():
    assert [poles(events.intro("solo", c)) for c in (3, 2, 1)] == [
        {"L": (p, "pink", "solid"), "R": (p, "pink", "solid")} for p in (100, 66, 33)]
    assert events.intro("solo", 3).perimeter.side == "both"


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


def test_idle_has_poles_off():
    assert events.idle().state == "idle" and events.idle().poles.L.mode == "off"


def glows(ev):
    return {s: (p.color, p.level) if p.mode == "glow" else p.mode for s, p in ev.poles}


@pytest.mark.parametrize("game, turn, owner, want", [
    ("solo", None, "R", {"L": ("pink", 35), "R": ("pink", 35)}),  # no turns in solo, any owner
    ("duet", None, "L", {"L": ("lime", 35), "R": "off"}),
    ("duet", None, "R", {"L": "off", "R": ("blue", 35)}),
    ("duet", None, "both", {"L": ("pink", 35), "R": ("pink", 35)}),
    ("showoff", "L", None, {"L": ("lime", 35), "R": "off"}),
    ("showoff", "R", None, {"L": "off", "R": ("blue", 35)}),
    ("showoff", "both", None, {"L": ("pink", 35), "R": ("pink", 35)}),
    ("thunder", None, "R", {"L": "off", "R": ("blue", 35)}),
    ("thunder", None, None, {"L": ("pink", 35), "R": ("pink", 35)}),
])
def test_in_song_poles_glow_in_the_colour_of_whoever_owns_the_section(game, turn, owner, want):
    ev = events.playing(game, 7, ("verse", 1), turn, owner=owner)
    assert ev.song.id == 7 and glows(ev) == want
    assert all(p.pct == 100 for _, p in ev.poles if p.mode == "glow")


def test_the_glow_level_is_a_tunable():
    tunables.set_override("ambientGlowPct", 20)
    try:
        assert events.playing("duet", 7).poles.L.level == 20
    finally:
        tunables.clear_overrides()


def test_a_thunder_frame_replaces_the_glow_except_for_the_new_look():
    from app.features.show.thunder import Frame
    fill = Pole(pct=50, color="white", mode="solid")
    ev = events.playing("thunder", 7, thunder=Frame("build", -4, "L", {"L": fill}), owner="both")
    assert glows(ev) == {"L": "solid", "R": "off"}  # the dark pole is off
    assert glows(events.playing("thunder", 7, thunder=Frame("tag", 1, "L", {}))) == {"L": "off", "R": "off"}
    # after a tag the tagger owns the stage: the new look glows their colour
    assert glows(events.playing("thunder", 7, thunder=Frame("new_look", 1, "L", {}), owner="L")) == {"L": ("lime", 35), "R": "off"}


def test_event_serialises_to_the_documented_envelope():
    data = json.loads(events.intro("duet", 3).model_dump_json())
    assert data["action"] == "show" and "timestamp" in data
    assert set(data["poles"]) == {"L", "R"}
