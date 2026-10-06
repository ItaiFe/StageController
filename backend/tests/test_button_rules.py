import pytest

from app.features.buttons.rules import IDLE_TAPS, IN_SONG, is_action_allowed


@pytest.mark.parametrize("action", ["start", "stop", "skip", "claps", "special"])
def test_every_action_allowed_while_show_running(action):
    assert is_action_allowed(action, show_running=True)


@pytest.mark.parametrize("action", ["start", "stop"])
def test_start_and_stop_allowed_while_idle(action):
    assert is_action_allowed(action, show_running=False)


@pytest.mark.parametrize("action", ["skip", "claps", "special"])
def test_other_actions_ignored_while_idle(action):
    assert not is_action_allowed(action, show_running=False)


def test_idle_taps_map_actions_back_to_tap_counts():
    assert IDLE_TAPS == {"start": 1, "claps": 2, "special": 3, "skip": 4}
    assert "stop" not in IDLE_TAPS  # a long press is never a launch


def test_in_song_table_covers_every_action():
    assert set(IN_SONG) == {"start", "stop", "skip", "claps", "special"}
    assert IN_SONG["start"] == "tap"
    assert all(IN_SONG[a] == a for a in ("claps", "special", "skip", "stop"))
