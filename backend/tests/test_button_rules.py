import pytest

from app.features.buttons.rules import is_action_allowed


@pytest.mark.parametrize("action", ["start", "stop", "skip", "claps", "special"])
def test_every_action_allowed_while_show_running(action):
    assert is_action_allowed(action, show_running=True)


@pytest.mark.parametrize("action", ["start", "stop"])
def test_start_and_stop_allowed_while_idle(action):
    assert is_action_allowed(action, show_running=False)


@pytest.mark.parametrize("action", ["skip", "claps", "special"])
def test_other_actions_ignored_while_idle(action):
    assert not is_action_allowed(action, show_running=False)
