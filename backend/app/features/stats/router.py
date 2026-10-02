from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Literal
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.database import get_db
from app.features.songs.models import Song
from .models import SongPlay

router = APIRouter(prefix="/stats", tags=["stats"])

Outcome = Literal["completed", "skipped", "stopped"]


class RecordPlayRequest(BaseModel):
    song_id: int
    outcome: Outcome


class SongStats(BaseModel):
    song_id: int
    title: str
    artist: str
    completed: int
    skipped: int
    stopped: int
    total: int


@router.post("/record")
def record_play(data: RecordPlayRequest, db: Session = Depends(get_db)):
    """Record a song play outcome."""
    play = SongPlay(song_id=data.song_id, outcome=data.outcome)
    db.add(play)
    db.commit()
    return {"status": "ok", "song_id": data.song_id, "outcome": data.outcome}


@router.get("/songs", response_model=list[SongStats])
def get_all_song_stats(db: Session = Depends(get_db)):
    """Get play statistics for all songs."""
    songs = db.query(Song).all()
    stats = []

    for song in songs:
        completed = db.query(func.count(SongPlay.id)).filter(
            SongPlay.song_id == song.id, SongPlay.outcome == "completed"
        ).scalar()
        skipped = db.query(func.count(SongPlay.id)).filter(
            SongPlay.song_id == song.id, SongPlay.outcome == "skipped"
        ).scalar()
        stopped = db.query(func.count(SongPlay.id)).filter(
            SongPlay.song_id == song.id, SongPlay.outcome == "stopped"
        ).scalar()

        stats.append(SongStats(
            song_id=song.id,
            title=song.title,
            artist=song.artist,
            completed=completed,
            skipped=skipped,
            stopped=stopped,
            total=completed + skipped + stopped,
        ))

    return stats


@router.get("/songs/{song_id}", response_model=SongStats)
def get_song_stats(song_id: int, db: Session = Depends(get_db)):
    """Get play statistics for a specific song."""
    song = db.query(Song).filter(Song.id == song_id).first()
    if not song:
        return {"error": "Song not found"}

    completed = db.query(func.count(SongPlay.id)).filter(
        SongPlay.song_id == song_id, SongPlay.outcome == "completed"
    ).scalar()
    skipped = db.query(func.count(SongPlay.id)).filter(
        SongPlay.song_id == song_id, SongPlay.outcome == "skipped"
    ).scalar()
    stopped = db.query(func.count(SongPlay.id)).filter(
        SongPlay.song_id == song_id, SongPlay.outcome == "stopped"
    ).scalar()

    return SongStats(
        song_id=song.id,
        title=song.title,
        artist=song.artist,
        completed=completed,
        skipped=skipped,
        stopped=stopped,
        total=completed + skipped + stopped,
    )


@router.get("/summary")
def get_summary(db: Session = Depends(get_db)):
    """Get overall play statistics summary."""
    total_plays = db.query(func.count(SongPlay.id)).scalar()
    completed = db.query(func.count(SongPlay.id)).filter(SongPlay.outcome == "completed").scalar()
    skipped = db.query(func.count(SongPlay.id)).filter(SongPlay.outcome == "skipped").scalar()
    stopped = db.query(func.count(SongPlay.id)).filter(SongPlay.outcome == "stopped").scalar()

    return {
        "total_plays": total_plays,
        "completed": completed,
        "skipped": skipped,
        "stopped": stopped,
    }
