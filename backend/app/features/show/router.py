from fastapi import APIRouter
from pydantic import BaseModel, Field

from . import analytics
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
