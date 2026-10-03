"""Thunder round (spec `thunder`): the countdown and window at the end of verses 2..N-1, and what
a press on a pole means there.

Pure: no player or DB, time is always song seconds passed in, and the pole choice comes from an
injected RNG (anything with `choice`). Everything is relative to beat 0, the beat nearest the verse
change; that beat *is* the change for grace, firing and offsets, so a tag pressed on the change
fires on it rather than a beat later when the analyzer's section edge sits a few ms after it.
A song without beats gets an even grid instead: countdownBeats steps over fallbackCountdownMs,
windowBeatsShort steps over fallbackWindowMs.

Ending: the round ends with the last performer alone on stage (spec open question, design D10):
nothing special happens at song end.
"""
from bisect import bisect_left, bisect_right
from dataclasses import dataclass

from . import tunables
from .schemas import Perimeter, Pole
from .songmap import SongMap

THUNDER_ENDING = "last performer alone"  # placeholder until the spec decides (design D10)
BEATS_PER_BAR = 4
COLOR = "white"


@dataclass
class Frame:
    """What the stage shows at one moment of a window. Poles not listed are dark."""
    phase: str  # build | rush | open | window | tag | new_look | early
    beat: int  # relative to beat 0
    pole: str  # the active pole
    poles: dict[str, Pole]
    perimeter: Perimeter | None = None


class Window:
    def __init__(self, verse: int, pole: str, grid: list[float], b0: int, window_beats: int):
        self.verse, self.pole, self.window_beats = verse, pole, window_beats
        self._grid, self._b0 = grid, b0
        self.countdown_beats = tunables.get("countdownBeats")
        self.rush_beats = tunables.get("rushBeats")
        self.change_s = grid[b0]
        self.start_s = grid[b0 - self.countdown_beats]
        self.end_s = grid[b0 + window_beats]
        self.beat_s = (self.end_s - self.change_s) / window_beats
        self.outcome: str | None = None  # tag | early | none
        self.press_s: float | None = None
        self.fire_s: float | None = None  # tag: when the blackout lands
        self.arrival_s: float | None = None  # early: when the fall starts
        self._fall_from = 0
        self.seen = False  # a frame of it was shown (a seek can jump over a window)
        self.logged = False

    def frame(self, t: float) -> Frame | None:
        if self.outcome == "early":
            if self.arrival_s <= t < self.arrival_s + tunables.get("flareBars") * BEATS_PER_BAR * self.beat_s:
                fall = Pole(pct=self._fall_from, color=COLOR, mode="drain", ms=tunables.get("earlyFallMs"))
                return Frame("early", self._beat(self.arrival_s), self.pole, {self.pole: fall},
                             Perimeter(look="halo", color=COLOR, side="both"))
            return None
        if self.outcome == "tag" and t >= self.fire_s:
            k = self._beat(self.fire_s)
            if t < self.fire_s + self.beat_s / 2:
                return Frame("tag", k, self.pole, {}, Perimeter(look="blackout"))
            if t < max(self.end_s, self.fire_s + self.beat_s):
                return Frame("new_look", k, self.pole, {}, Perimeter(look="new_look", color=COLOR, side="both"))
            return None
        if not self.start_s <= t < self.end_s:
            return None
        k = self._beat(t)
        if k >= 0:
            pct = 100 - k * 100 / self.window_beats
            return Frame("open" if k == 0 else "window", k, self.pole, {self.pole: Pole(pct=round(pct), color=COLOR, mode="solid")})
        pct = round((k + self.countdown_beats + 1) * 100 / self.countdown_beats)
        if k < -self.rush_beats:
            return Frame("build", k, self.pole, {self.pole: Pole(pct=pct, color=COLOR, mode="solid")})
        # rush: two pulses per beat, `ms` = one pulse
        return Frame("rush", k, self.pole, {self.pole: Pole(pct=pct, color=COLOR, mode="pulse", ms=round(self.beat_s * 500))})

    def press(self, side: str, press_s: float, arrival_s: float) -> str | None:
        """A 1-tap on a pole: tag, early, or None when it is not a thunder press."""
        if self.outcome or side != self.pole or not self.start_s <= press_s <= self.end_s:
            return None
        self.press_s = press_s
        if press_s >= self.change_s - tunables.get("graceMs") / 1000:
            self.outcome = "tag"
            self.fire_s = self._beat_from(max(self.change_s, press_s, arrival_s))
        else:
            current = self.frame(arrival_s)
            self._fall_from = current.poles[self.pole].pct if current and self.pole in current.poles else 0
            self.outcome, self.arrival_s = "early", arrival_s
        return self.outcome

    def live(self, t: float) -> bool:
        """Countdown or window running: only the dark pole may applaud."""
        return self.outcome != "early" and self.start_s <= t <= self.end_s

    def record(self, song_id, bpm) -> dict:
        offset = None if self.press_s is None else round((self.press_s - self.change_s) * 1000)
        return {"songId": str(song_id), "verse": self.verse, "pole": self.pole, "outcome": self.outcome or "none",
                "pressOffsetMs": offset, "windowBeats": self.window_beats, "bpm": bpm}

    def _beat(self, t: float) -> int:
        return bisect_right(self._grid, t) - 1 - self._b0

    def _beat_from(self, t: float) -> float:
        """The first beat at or after t (t itself past the end of the grid)."""
        i = bisect_left(self._grid, t)
        return self._grid[i] if i < len(self._grid) else t


def _window(m: SongMap, verse: int, change: float, pole: str) -> Window:
    countdown, short, long_ = (tunables.get(k) for k in ("countdownBeats", "windowBeatsShort", "windowBeatsLong"))
    b = m.beats
    if b:
        b0 = min(range(len(b)), key=lambda i: abs(b[i] - change))
        if b0 + short < len(b):
            w = short if b[b0 + short] - b[b0] >= tunables.get("minWindowMs") / 1000 else long_
            if b0 - countdown >= 0 and b0 + w < len(b):
                return Window(verse, pole, b, b0, w)
    # no beats (or not enough around the change): an even grid from the fallback tunables
    step_in = tunables.get("fallbackCountdownMs") / 1000 / countdown
    step_out = tunables.get("fallbackWindowMs") / 1000 / short
    grid = [change - (countdown - i) * step_in for i in range(countdown)] + [change + j * step_out for j in range(short + 1)]
    return Window(verse, pole, grid, countdown, short)


class Thunder:
    """The windows of one song, poles drawn when the song starts."""

    def __init__(self, m: SongMap, rng):
        verses = [s for s in m.sections if s["label"] == "verse"]
        self.windows = [_window(m, k, verses[k - 1]["end"], rng.choice(["L", "R"])) for k in range(2, len(verses))]

    def frame(self, t: float) -> Frame | None:
        for w in self.windows:
            if f := w.frame(t):
                w.seen = True
                return f
        return None

    def press(self, side: str, what: str, press_s: float, arrival_s: float) -> str | None:
        """tag | early (a tap on the active pole), dark (applause from the dark pole, allowed),
        blocked (applause from the active pole, ignored), or None: not thunder, today's rules."""
        if what == "tap":
            return next((kind for w in self.windows if (kind := w.press(side, press_s, arrival_s))), None)
        if what == "claps" and (w := next((w for w in self.windows if w.live(arrival_s)), None)):
            return "blocked" if side == w.pole else "dark"
        return None

    def to_log(self, t: float) -> list[Window]:
        """Windows whose outcome is known and not logged yet (marks them logged): a tag or early press
        at once, none once a window that was shown runs out."""
        done = [w for w in self.windows if not w.logged and (w.outcome or (w.seen and t >= w.end_s))]
        for w in done:
            w.logged = True
        return done
