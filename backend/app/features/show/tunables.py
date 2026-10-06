"""Show tunables: defaults come from spec.json, overrides live in memory (persistence is later)."""
import json
from pathlib import Path

SPEC = json.loads((Path(__file__).parent / "spec.json").read_text())

_DEFAULTS = {t["id"]: t["value"] for t in SPEC["tunables"]}
_overrides: dict = {}


def defaults() -> dict:
    return dict(_DEFAULTS)


def get(tunable_id: str):
    return _overrides.get(tunable_id, _DEFAULTS[tunable_id])


def set_override(tunable_id: str, value) -> None:
    if tunable_id not in _DEFAULTS:
        raise KeyError(tunable_id)
    _overrides[tunable_id] = value


def clear_overrides() -> None:
    _overrides.clear()


def palette(name: str, gain: float = 1.0) -> tuple[int, int, int]:
    """Middle of the colour's ramp, scaled by gain and capped at 255."""
    r, g, b = SPEC["palette"][name]["ramp"][1]
    return min(255, round(r * gain)), min(255, round(g * gain)), min(255, round(b * gain))
