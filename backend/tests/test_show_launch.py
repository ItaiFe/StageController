import pytest

from app.features.show import tunables
from app.features.show.launch import LaunchArbiter

WAIT = 500  # max(soloWaitMs, syncWindowMs) with the spec defaults


@pytest.fixture(autouse=True)
def clean():
    tunables.clear_overrides()
    yield
    tunables.clear_overrides()


def run(*gestures):
    """gestures: (side, taps, first_press_ms, arrival_ms). Returns the decision and when it fell."""
    arbiter = LaunchArbiter()
    for side, taps, first, now in gestures:
        arbiter.on_gesture(side, taps, first, now)
    for t in range(0, 5000):
        result = arbiter.poll(t)
        if result:
            return result, t
    return None, None


def test_solo_left_and_right():
    result, _ = run(("L", 1, 0, 450))
    assert (result.game, result.side, result.count_l, result.count_r, result.gap_ms) == ("solo", "L", 1, 0, None)
    result, _ = run(("R", 1, 0, 450))
    assert (result.game, result.side, result.count_r) == ("solo", "R", 1)


@pytest.mark.parametrize("taps,game", [(1, "duet"), (2, "showoff"), (3, "thunder")])
def test_together_with_equal_counts_picks_game_by_count(taps, game):
    result, _ = run(("L", taps, 0, 600), ("R", taps, 100, 700))
    assert result.game == game
    assert (result.count_l, result.count_r, result.gap_ms) == (taps, taps, 100)


def test_unequal_counts_fail():
    result, _ = run(("L", 2, 0, 600), ("R", 3, 50, 800))
    assert result.game == "fail"
    assert (result.count_l, result.count_r) == (2, 3)


def test_count_above_match_max_fails_even_when_equal():
    result, _ = run(("L", 4, 0, 900), ("R", 4, 0, 900))
    assert result.game == "fail"


def test_opposite_side_after_sync_window_is_not_part_of_the_launch():
    arbiter = LaunchArbiter()
    assert arbiter.on_gesture("L", 1, 0, 450)
    assert not arbiter.on_gesture("R", 1, 401, 851)
    result = arbiter.poll(450 + WAIT)
    assert (result.game, result.side) == ("solo", "L")


def test_opposite_side_exactly_at_sync_window_is_together():
    result, _ = run(("L", 1, 0, 450), ("R", 1, 400, 850))
    assert result.game == "duet"


def test_second_gesture_on_same_side_is_ignored():
    arbiter = LaunchArbiter()
    assert arbiter.on_gesture("L", 1, 0, 450)
    assert not arbiter.on_gesture("L", 2, 100, 700)
    assert arbiter.poll(450 + WAIT).count_l == 1


def test_decision_falls_exactly_wait_after_the_latest_gesture():
    # the later (right) gesture arrives at 750, so the decision is at 750 + 500
    result, at = run(("L", 1, 0, 450), ("R", 1, 300, 750))
    assert result.game == "duet"
    assert at == 750 + WAIT


def test_no_decision_before_the_wait():
    arbiter = LaunchArbiter()
    arbiter.on_gesture("L", 1, 0, 450)
    assert arbiter.poll(450 + WAIT - 1) is None
    assert arbiter.poll(450 + WAIT) is not None
    assert arbiter.poll(450 + WAIT + 1) is None  # round is over


def test_wait_is_the_larger_of_solo_wait_and_sync_window():
    tunables.set_override("syncWindowMs", 900)
    _, at = run(("L", 1, 0, 450))
    assert at == 450 + 900
    tunables.set_override("syncWindowMs", 100)
    tunables.set_override("soloWaitMs", 300)
    _, at = run(("L", 1, 0, 450))
    assert at == 450 + 300


def test_tunable_change_is_respected():
    tunables.set_override("syncWindowMs", 100)
    arbiter = LaunchArbiter()
    arbiter.on_gesture("L", 1, 0, 450)
    assert not arbiter.on_gesture("R", 1, 150, 600)
    tunables.set_override("matchMaxCount", 1)
    result, _ = run(("L", 2, 0, 600), ("R", 2, 0, 600))
    assert result.game == "fail"


def test_arbiter_is_reusable_after_a_decision():
    arbiter = LaunchArbiter()
    arbiter.on_gesture("L", 1, 0, 450)
    arbiter.poll(450 + WAIT)
    assert arbiter.on_gesture("R", 1, 5000, 5450)
    assert arbiter.poll(5450 + WAIT).side == "R"
