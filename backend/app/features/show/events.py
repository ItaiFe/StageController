"""Builders for the show events. Pole numbers come from the tunables; nothing here knows about time."""
from datetime import datetime

from . import tunables
from .schemas import ButtonLights, Perimeter, Pole, Poles, ShowCue, ShowEvent, SongInfo

OFF = Pole(pct=0, mode="off")

# Intro per game, indexed by count 3, 2, 1: (pole colours L/R, perimeter look)
# duet/solo/showoff/thunder follow spec intro.perGame
_SHOWOFF = {3: ("lime", "blue", "lime", "L"), 2: ("lime", "blue", "blue", "R"), 1: ("pink", "pink", "pink", "both")}
_THUNDER = {3: "L", 2: "R", 1: "centre"}


def _event(state, poles: dict[str, Pole], **kw) -> ShowEvent:
    return ShowEvent(timestamp=datetime.now(), state=state, poles=Poles(L=poles.get("L", OFF), R=poles.get("R", OFF)), **kw)


def idle() -> ShowEvent:
    return _event("idle", {})


def launching(poles: dict[str, Pole]) -> ShowEvent:
    return _event("launching", poles)


def launch_pole(count: int) -> Pole:
    pcts = tunables.get("launchPcts")
    return Pole(pct=min(100, pcts[min(count, len(pcts)) - 1]), color="pink", mode="solid")


def intro(game: str, count: int) -> ShowEvent:
    pct = tunables.get("polePcts")[tunables.SPEC["intro"]["steps"] - count]

    def pole(color):
        return Pole(pct=pct, color=color, mode="solid")

    if game in ("solo", "duet"):  # solo is symmetric: which side pressed does not matter (user rule)
        return _event("intro", {"L": pole("pink"), "R": pole("pink")}, game=game, step=count,
                      perimeter=Perimeter(look="intro", color="pink", side="both"))
    if game == "showoff":
        left, right, color, where = _SHOWOFF[count]
        return _event("intro", {"L": pole(left), "R": pole(right)}, game=game, step=count,
                      perimeter=Perimeter(look="merge" if count == 1 else "intro", color=color, side=where))
    return _event("intro", {"L": pole("white"), "R": pole("white")}, game=game, step=count,
                  perimeter=Perimeter(look="intro", color="white", side=_THUNDER[count]))


# Showoff colours by turn (spec: verses lime then blue, everything else both = pink)
TURN_COLOR = {"L": "lime", "R": "blue", "both": "pink"}


def glow(color: str) -> Pole:
    return Pole(pct=100, color=color, mode="glow", level=tunables.get("ambientGlowPct"))


def ambient(game: str, owner: str | None) -> dict[str, Pole]:
    """The poles' in-song glow, in the colour of whoever owns the section (a deviation from the spec's
    0 % after the intro, asked for by the user). Solo has no turns: both pink, whichever side pressed.
    Every two-player mode: L = left pole lime, R = right pole blue, both = both pink; the side not
    singing is off."""
    if game != "solo" and owner in ("L", "R"):
        return {owner: glow(TURN_COLOR[owner])}
    return {"L": glow("pink"), "R": glow("pink")}


def buttons(game: str, singer: str, handover: bool = False) -> ButtonLights:
    """The button rings in the singer's colour (the glow's colours, never thunder's frame); `handover`:
    the singer just changed, so both pulse together first."""
    glows = ambient(game, singer)
    return ButtonLights(L=glows["L"].color if "L" in glows else None, R=glows["R"].color if "R" in glows else None,
                        pulses=tunables.get("handoverPulses") if handover else 0,
                        pulse_ms=tunables.get("handoverPulseMs") if handover else 0)


def playing(game: str, song_id: int, section: tuple[str, int] | None = None, turn: str | None = None,
            t: float = 0.0, thunder=None, owner: str | None = None, handover: bool = False) -> ShowEvent:
    """`thunder`: the thunder.Frame showing now (thunder games only); it brings the poles, the
    perimeter and the button rings (both in the players' colours, the rising one flickering with its
    pole once full). `owner`: whose section it is (solo: none; duet: the singer; showoff: the turn);
    defaults to the showoff `turn`, else both."""
    label, index = section or (None, None)
    perimeter = Perimeter(look="turn", color=TURN_COLOR[turn], side=turn) if turn else None
    singer = owner or turn or "both"
    poles, info = ambient(game, singer), None
    rings = buttons(game, singer, handover)
    if thunder:
        perimeter, poles, info = thunder.perimeter, thunder.poles, thunder.info
        lit = {s: p.color for s, p in thunder.poles.items()}
        rings = ButtonLights(L=lit.get("L"), R=lit.get("R"),
                             flicker=next((s for s, p in thunder.poles.items() if p.mode == "pulse"), None))
    return _event("playing", poles, game=game, song=SongInfo(id=song_id, section=label, section_index=index, t=round(t, 2)),
                  turn=turn, perimeter=perimeter, thunder=info, buttons=rings)


def legacy_start(game: str):
    """What a plain `start` press broadcasts, so StageLeds and the pillars (which only know
    legacy actions) enter their play look when a game's song starts."""
    from app.features.buttons.router import ButtonEvent
    return ButtonEvent(action="start", timestamp=datetime.now(), playlist_name=game)


def fail_blink(lit: str) -> ShowEvent:
    return _event("failing", {lit: Pole(pct=100, color="white", mode="solid")})


def fail_fade(lit: str) -> ShowEvent:
    return _event("failing", {lit: Pole(pct=100, color="white", mode="drain", ms=tunables.get("failFadeMs"))})


def claps(side: str | None) -> ShowCue:
    return ShowCue(timestamp=datetime.now(), cue="claps", side=side)
