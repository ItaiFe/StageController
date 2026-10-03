from datetime import datetime
from typing import Literal

from pydantic import BaseModel

State = Literal["idle", "launching", "failing", "intro", "playing"]
PoleMode = Literal["solid", "pulse", "blink", "drain", "glow", "off"]
Side = Literal["L", "R"]


class Pole(BaseModel):
    pct: int
    color: str | None = None  # palette name: pink | lime | blue | white
    mode: PoleMode = "off"
    ms: int | None = None  # drain: time to fall from pct to 0
    level: int | None = None  # glow: brightness % (the in-song ambient, below a full-brightness fill)


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


class ButtonLights(BaseModel):
    """The pillar button rings in song: the singer's colour per side (None = dim). On the event at a
    change of singer `pulses` > 0: both buttons pulse together (ease in/out) that many times over
    `pulse_ms`, then settle on these colours. A later event without a pulse does not cut it short."""
    L: str | None = None
    R: str | None = None
    pulses: int = 0
    pulse_ms: int = 0


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
    buttons: ButtonLights | None = None  # playing only: the button rings, see ButtonLights


class ShowCue(BaseModel):
    """A one-off moment on /api/buttons/ws, sent when the director runs it (before the action's own
    sequence, which can take seconds): the emulator flashes a badge and plays its sound. Not LED state:
    a late client does not need it. See docs/show-events-contract.md."""
    action: Literal["cue"] = "cue"
    timestamp: datetime
    cue: Literal["claps"]
    side: Literal["L", "R"] | None = None
    reason: Literal["claps", "applause"] = "claps"  # 2 taps in a song | thunder's dark-pole applause
