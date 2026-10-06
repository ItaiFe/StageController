"""The thunder steal loop on a bare clock (ms): the rise, the flicker, steals, ignored presses."""
import pytest

from app.features.show import tunables
from app.features.show.thunder import Thunder

CD = tunables.defaults()["cooldownMs"]  # the single source: spec.json


@pytest.fixture(autouse=True)
def clean():
    tunables.clear_overrides()
    yield
    tunables.clear_overrides()


def test_left_performs_full_and_the_right_pole_rises_over_the_cooldown():
    th = Thunder(0)
    f = th.frame(CD // 2)
    assert (f.info.phase, f.info.performer, f.info.pct) == ("cooldown", "L", 50)
    assert (f.poles["L"].pct, f.poles["L"].color, f.poles["L"].mode) == (100, "lime", "solid")
    assert (f.poles["R"].pct, f.poles["R"].color, f.poles["R"].mode) == (50, "blue", "solid")
    assert (f.perimeter.look, f.perimeter.color, f.perimeter.side) == ("turn", "lime", "L")


def test_full_pole_flickers_until_pressed_no_timeout():
    th = Thunder(0)
    for t in (CD, CD * 10):
        f = th.frame(t)
        assert (f.info.phase, f.poles["R"].pct, f.poles["R"].mode, f.poles["R"].ms) == ("ready", 100, "pulse", 500)


def test_a_steal_swaps_roles_blacks_out_and_restarts_the_cooldown():
    th = Thunder(0)
    th.frame(CD)
    kind, fields = th.press("R", CD + 2000)
    assert kind == "steal" and fields == {"from": "L", "to": "R", "waitedMs": 2000}
    f = th.frame(CD + 2100)
    assert (f.info.phase, f.poles, f.perimeter.look) == ("steal", {}, "blackout")
    after = CD + 2000 + tunables.get("stealBlackoutMs")
    f = th.frame(after)
    assert (f.info.phase, f.info.performer, f.info.pct) == ("cooldown", "R", 0)
    assert (f.poles["R"].color, f.poles["R"].pct, f.poles["L"].color, f.poles["L"].pct) == ("blue", 100, "lime", 0)
    assert th.frame(after + CD).info.phase == "ready" and th.steals == 1


def test_early_and_performer_presses_are_ignored():
    th = Thunder(0)
    assert th.press("R", CD - 1) == ("early", {"pct": 99})
    assert th.press("L", CD * 2)[0] == "performer"
    assert th.performer == "L"


def test_steal_before_full_is_one_switch_away():
    tunables.set_override("stealBeforeFull", True)
    assert Thunder(0).press("R", 1000)[0] == "steal"


@pytest.mark.parametrize("ms, hz, want", [(8000, 2, 50), (4000, 4, 100)])
def test_cooldown_and_flicker_are_tunables(ms, hz, want):
    tunables.set_override("cooldownMs", ms)
    tunables.set_override("flickerHz", hz)
    th = Thunder(0)
    f = th.frame(4000)
    assert f.info.pct == want
    if want == 100:
        assert f.poles["R"].ms == 250
