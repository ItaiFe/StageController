"""LAUNCHING rules from the stage spec: which game do the opening presses ask for?

Pure: takes time as an argument and imports nothing from player/devices/DB.

A pillar reports a whole gesture at once, about GAP_MS after its last release, so the
decision wait runs from the latest gesture's arrival rather than from the (unknown)
last physical press. Waiting less would call a 2+2 showoff solo before the second
pillar's gesture has arrived.
"""
from dataclasses import dataclass

from . import tunables

# Together-games by click count, from the spec's game table (two buttons)
TOGETHER_GAMES = {g["start"]["clicks"]: g["id"] for g in tunables.SPEC["games"] if g["start"]["buttons"] == 2}


@dataclass
class LaunchResult:
    game: str  # solo | duet | showoff | thunder | fail
    side: str | None  # solo: the earlier button
    count_l: int
    count_r: int
    gap_ms: int | None  # between the first presses, when both sides pressed


class LaunchArbiter:
    def __init__(self):
        self._gestures: dict[str, tuple[int, int]] = {}  # side -> (taps, first_press_ms)
        self._last_arrival_ms = 0

    def on_gesture(self, side: str, taps: int, first_press_ms: int, now_ms: int) -> bool:
        """True if the gesture is part of the launch round (opens it, or joins it)."""
        if side in self._gestures:
            return False  # neither joins nor restarts the wait
        if self._gestures:
            (_, other_first), = self._gestures.values()
            if abs(first_press_ms - other_first) > tunables.get("syncWindowMs"):
                return False  # a late first press is an ordinary in-song press
        self._gestures[side] = (taps, first_press_ms)
        self._last_arrival_ms = now_ms
        return True

    def reset(self) -> None:
        self._gestures.clear()

    def poll(self, now_ms: int) -> LaunchResult | None:
        wait = max(tunables.get("soloWaitMs"), tunables.get("syncWindowMs"))
        if not self._gestures or now_ms < self._last_arrival_ms + wait:
            return None
        gestures, self._gestures = self._gestures, {}
        l_taps = gestures.get("L", (0, 0))[0]
        r_taps = gestures.get("R", (0, 0))[0]
        if len(gestures) == 1:
            (side, (_, _)), = gestures.items()
            return LaunchResult("solo", side, l_taps, r_taps, None)
        gap = abs(gestures["L"][1] - gestures["R"][1])
        game = "fail"
        if l_taps == r_taps and 1 <= l_taps <= tunables.get("matchMaxCount"):
            game = TOGETHER_GAMES.get(l_taps, "fail")
        return LaunchResult(game, None, l_taps, r_taps, gap)
