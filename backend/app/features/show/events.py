"""Builders for the show events. Pole numbers come from the tunables; nothing here knows about time."""
from datetime import datetime

from . import tunables
from .schemas import Perimeter, Pole, Poles, ShowEvent, SongInfo

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


def intro(game: str, count: int, side: str | None = None) -> ShowEvent:
    pct = tunables.get("polePcts")[tunables.SPEC["intro"]["steps"] - count]

    def pole(color):
        return Pole(pct=pct, color=color, mode="solid")

    if game == "solo":
        return _event("intro", {side: pole("pink")}, game=game, step=count,
                      perimeter=Perimeter(look="intro", color="pink", side=side))
    if game == "duet":
        return _event("intro", {"L": pole("pink"), "R": pole("pink")}, game=game, step=count,
                      perimeter=Perimeter(look="intro", color="pink", side="both"))
    if game == "showoff":
        left, right, color, where = _SHOWOFF[count]
        return _event("intro", {"L": pole(left), "R": pole(right)}, game=game, step=count,
                      perimeter=Perimeter(look="merge" if count == 1 else "intro", color=color, side=where))
    return _event("intro", {"L": pole("white"), "R": pole("white")}, game=game, step=count,
                  perimeter=Perimeter(look="intro", color="white", side=_THUNDER[count]))


def playing(game: str, song_id: int) -> ShowEvent:
    return _event("playing", {}, game=game, song=SongInfo(id=song_id))


def fail_blink(lit: str) -> ShowEvent:
    return _event("failing", {lit: Pole(pct=100, color="white", mode="solid")})


def fail_fade(lit: str) -> ShowEvent:
    return _event("failing", {lit: Pole(pct=100, color="white", mode="drain", ms=tunables.get("failFadeMs"))})
