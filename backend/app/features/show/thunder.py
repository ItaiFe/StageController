"""Thunder: the steal loop (user rule, 2026-10-03; replaces the spec's beat-based countdown and
windows). Time-based, independent of the song and its sections.

The performer's pole is full in the performer's colour. The other player's pole rises 0 -> 100 %
in their colour over `cooldownMs`; at 100 % it flickers (fade up/down at `flickerHz`): a steal is
open, with no timeout. A 1-tap from the flickering side steals: the roles swap, a short blackout
(`stealBlackoutMs`) and the smoke puff, and the cooldown restarts for the one who lost the stage.
A press on the rising pole before 100 % is ignored (`stealBeforeFull` switches that to a steal),
a press on the performer's pole is ignored. Left performs first.
"""
from dataclasses import dataclass

from . import tunables
from .events import TURN_COLOR
from .schemas import Perimeter, Pole, ThunderInfo

OTHER = {"L": "R", "R": "L"}


@dataclass
class Frame:
    """What thunder shows now: the poles, the perimeter and the info for the event."""
    poles: dict[str, Pole]
    perimeter: Perimeter
    info: ThunderInfo

    @property
    def key(self):
        return self.info.phase, self.info.performer, self.info.pct


class Thunder:
    def __init__(self, now_ms: int, first: str = "L"):
        self.performer = first
        self._since = now_ms  # the cooldown's start
        self._blackout_until = now_ms  # no blackout before the first steal
        self._ready_at: int | None = None
        self.steals = 0

    @property
    def rival(self) -> str:
        return OTHER[self.performer]

    def pct(self, now_ms: int) -> int:
        """How far the rising pole is, 0..100 (0 through a steal's blackout)."""
        start = max(self._since, self._blackout_until)  # the rise starts after the blackout
        return max(0, min(100, (now_ms - start) * 100 // max(1, tunables.get("cooldownMs"))))

    def press(self, side: str, now_ms: int) -> tuple[str, dict]:
        """A 1-tap in thunder: ('steal' | 'early' | 'performer', log fields)."""
        if side == self.performer:
            return "performer", {}
        pct = self.pct(now_ms)
        if pct < 100 and not tunables.get("stealBeforeFull"):
            return "early", {"pct": pct}
        waited = now_ms - self._ready_at if self._ready_at is not None else 0
        fields = {"from": self.performer, "to": side, "waitedMs": waited}
        self.performer, self._since, self._ready_at = side, now_ms, None
        self._blackout_until = now_ms + tunables.get("stealBlackoutMs")
        self.steals += 1
        return "steal", fields

    def frame(self, now_ms: int) -> Frame:
        me, rival = self.performer, self.rival
        if now_ms < self._blackout_until:
            return Frame({}, Perimeter(look="blackout", color=None, side="both"),
                         ThunderInfo(phase="steal", performer=me, pct=0))
        pct = self.pct(now_ms)
        ready = pct >= 100
        if ready and self._ready_at is None:
            self._ready_at = now_ms
        rising = (Pole(pct=100, color=TURN_COLOR[rival], mode="pulse", ms=round(1000 / tunables.get("flickerHz")))
                  if ready else Pole(pct=pct, color=TURN_COLOR[rival], mode="solid"))
        poles = {me: Pole(pct=100, color=TURN_COLOR[me], mode="solid"), rival: rising}
        info = ThunderInfo(phase="ready" if ready else "cooldown", performer=me, pct=pct)
        return Frame(poles, Perimeter(look="turn", color=TURN_COLOR[me], side=me), info)
