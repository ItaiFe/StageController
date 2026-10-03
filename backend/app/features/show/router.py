from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db

from . import analytics, tunables
from .service import save_tunable
from .tunables import SPEC

router = APIRouter(prefix="/show", tags=["show"])


class Note(BaseModel):
    text: str = Field(min_length=1)


@router.get("/spec")
def get_spec():
    """The stage spec, so the emulator draws the same palette and games as the controller."""
    return SPEC


@router.post("/note")
def add_note(note: Note):
    """A line typed by the crew, kept in the night's log."""
    return analytics.append("night_note", text=note.text)


@router.get("/log")
def get_log(limit: int = 50):
    """The last lines of the night's log, oldest first."""
    return analytics.tail(limit)


class TunableUpdate(BaseModel):
    value: Any


def _number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


@router.get("/tunables")
def list_tunables():
    """Every spec tunable with its current value, in the spec's order."""
    return [{"id": t["id"], "value": tunables.get(t["id"]), "default": t["value"], "unit": t["unit"],
             "group": t["group"], "he": t["he"]} for t in SPEC["tunables"]]


@router.put("/tunables/{tunable_id}")
def set_tunable(tunable_id: str, body: TunableUpdate, db: Session = Depends(get_db)):
    if tunable_id not in tunables.defaults():
        raise HTTPException(404, f"Unknown tunable {tunable_id!r}")
    default = tunables.defaults()[tunable_id]
    ok = (isinstance(body.value, list) and len(body.value) == len(default) and all(map(_number, body.value))
          if isinstance(default, list) else _number(body.value))
    if not ok:
        raise HTTPException(422, f"{tunable_id} must be {'a list of ' + str(len(default)) + ' numbers' if isinstance(default, list) else 'a number'}")
    before = tunables.get(tunable_id)
    save_tunable(db, tunable_id, body.value)
    analytics.append("tunable_change", id=tunable_id, **{"from": before, "to": body.value})
    return {"id": tunable_id, "value": body.value}
