"""Which button actions take effect in which show state.

Kept free of player/device imports so it can be unit-tested without audio hardware.
"""

# While the show is idle, a single press (start) brings it up and a long press (stop)
# makes sure everything is off; every other gesture is ignored.
IDLE_ALLOWED_ACTIONS = frozenset({"start", "stop"})


def is_action_allowed(action: str, show_running: bool) -> bool:
    return show_running or action in IDLE_ALLOWED_ACTIONS
