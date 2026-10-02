from sqlalchemy import Column, Integer, ForeignKey, DateTime, String
from sqlalchemy.sql import func

from app.core.database import Base


class SongPlay(Base):
    __tablename__ = "song_plays"

    id = Column(Integer, primary_key=True, index=True)
    song_id = Column(Integer, ForeignKey("songs.id", ondelete="CASCADE"), nullable=False)
    outcome = Column(String, nullable=False)  # "completed", "skipped", "stopped"
    played_at = Column(DateTime, server_default=func.now())
