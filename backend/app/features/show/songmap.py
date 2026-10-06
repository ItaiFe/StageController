"""Song markers from the analyzer's sidecar (data/music/<stem>.analysis.json).

Pure: no player or DB, and time is always an argument. A song without usable sections is still
a SongMap (`has_markers` False): every question then answers from the spec's fallback tunables.
"""
import json
from pathlib import Path

from . import tunables


class SongMap:
    def __init__(self, bpm: float | None, beats: list[float], sections: list[dict]):
        self.bpm = bpm
        self.beats = beats
        self.sections = sections  # [{start, end, label, index?}] in time order
        self._verses = [s for s in sections if s["label"] == "verse"]

    @classmethod
    def for_audio(cls, file_path: str, music_dir: Path) -> "SongMap":
        """The sidecar sits next to the audio: <stem>.analysis.json (file_path may be relative to music_dir)."""
        path = Path(file_path)
        return cls.load((path if path.is_absolute() else music_dir / path).with_suffix(".analysis.json"))

    @classmethod
    def load(cls, path: Path) -> "SongMap":
        try:
            data = json.loads(Path(path).read_text())
            tempo = data.get("tempo") or {}
            return cls(tempo.get("bpm"), tempo.get("beats") or [], data.get("sections") or [])
        except (OSError, ValueError, AttributeError, KeyError, TypeError):
            return cls(None, [], [])

    @property
    def has_markers(self) -> bool:
        return bool(self.sections)

    def skip_cutoff_s(self) -> float:
        """Skip is allowed until the middle of verse 2."""
        if len(self._verses) < 2:
            return tunables.get("skipFallbackMs") / 1000
        v = self._verses[1]
        return (v["start"] + v["end"]) / 2

    def section_at(self, t: float) -> tuple[str, int] | None:
        """(label, index) of the section playing at t; past the end it is still the last one."""
        for n, s in enumerate(self.sections, 1):
            if t < s["end"]:
                return s["label"], s.get("index", n)
        if self.sections:
            return self.sections[-1]["label"], self.sections[-1].get("index", len(self.sections))
        return None

    def turn_owner(self, t: float, duration: float = 0.0) -> str:
        """Showoff turn: verses alternate L, R, ...; every other section, and the last, is both."""
        if not self.sections:
            turn_s = tunables.get("fallbackTurnMs") / 1000
            if duration and t >= duration - turn_s:
                return "both"
            return "L" if int(t // turn_s) % 2 == 0 else "R"
        current = next((s for s in self.sections if t < s["end"]), self.sections[-1])
        if current is self.sections[-1] or current["label"] != "verse":
            return "both"
        return "L" if self._verses.index(current) % 2 == 0 else "R"

    def singer(self, t: float, duration: float = 0.0) -> str:
        """Duet (and thunder before a steal): who sings this section. The sidecar may say so per section
        (optional `turn`: L | R | both, hand-tagged; the analyzer does not detect voices); untagged
        sections fall back to the showoff alternation. A duet ends with both: the last section is both."""
        current = next((s for s in self.sections if t < s["end"]), self.sections[-1]) if self.sections else None
        if current is not None and current is not self.sections[-1] and current.get("turn") in ("L", "R", "both"):
            return current["turn"]
        return self.turn_owner(t, duration)

