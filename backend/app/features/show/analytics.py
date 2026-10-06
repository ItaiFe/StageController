"""Append-only event log for the crew to pull after the night: one JSON object per line
(spec `analytics`): {t: ISO time, mono: ms on the monotonic clock, type, ...fields}."""
import json
import time
from datetime import datetime

from app.core.config import DATA_DIR

from .tunables import SPEC

PATH = DATA_DIR / "show-events.jsonl"
TYPES = {e["type"] for e in SPEC["analytics"]["events"]}


def append(kind: str, mono_ms: int | None = None, /, **fields) -> dict:
    if kind not in TYPES:
        raise ValueError(f"unknown show event type {kind!r}")
    line = {"t": datetime.now().isoformat(timespec="milliseconds"),
            "mono": int(time.monotonic() * 1000) if mono_ms is None else mono_ms, "type": kind, **fields}
    with open(PATH, "a") as f:
        f.write(json.dumps(line) + "\n")
    return line


def tail(limit: int = 50) -> list[dict]:
    # ponytail: reads the whole file; a night is a few thousand lines, seek from the end if it ever isn't
    try:
        lines = PATH.read_text().splitlines()
    except OSError:
        return []
    return [json.loads(l) for l in lines[-limit:]] if limit > 0 else []
