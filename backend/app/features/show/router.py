from fastapi import APIRouter

from .tunables import SPEC

router = APIRouter(prefix="/show", tags=["show"])


@router.get("/spec")
def get_spec():
    """The stage spec, so the emulator draws the same palette and games as the controller."""
    return SPEC
