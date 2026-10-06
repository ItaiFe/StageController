from datetime import datetime
from typing import Literal

from pydantic import BaseModel

State = Literal["idle", "launching", "failing", "intro", "playing"]
PoleMode = Literal["solid", "pulse", "blink", "drain", "off"]
Side = Literal["L", "R"]


class Pole(BaseModel):
    pct: int
    color: str | None = None  # palette name: pink | lime | blue | white
    mode: PoleMode = "off"
    ms: int | None = None  # drain: time to fall from pct to 0


class Poles(BaseModel):
    L: Pole
    R: Pole


class Perimeter(BaseModel):
    """A hint only: the spec treats the perimeter drawing as illustration."""
    look: str
    color: str | None = None
    side: Literal["L", "R", "both", "centre"] | None = None


class SongInfo(BaseModel):
    id: int
    section: str | None = None
    section_index: int | None = None
    t: float = 0.0


class ThunderInfo(BaseModel):
    phase: str
    pole: Side
    beat: int


class ShowEvent(BaseModel):
    """Semantic LED instruction on /api/buttons/ws. Carries the full pole state so a client that
    joins late is correct after one message. See docs/show-events-contract.md."""
    action: Literal["show"] = "show"
    timestamp: datetime
    state: State
    game: str | None = None
    step: int | None = None  # intro count: 3, 2, 1
    poles: Poles
    perimeter: Perimeter | None = None
    song: SongInfo | None = None
    turn: Literal["L", "R", "both"] | None = None  # showoff: whose turn it is
    thunder: ThunderInfo | None = None
