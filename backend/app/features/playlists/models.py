from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Table
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


# Association table for playlist-song many-to-many relationship
playlist_songs = Table(
    "playlist_songs",
    Base.metadata,
    Column("id", Integer, primary_key=True),
    Column("playlist_id", Integer, ForeignKey("playlists.id", ondelete="CASCADE")),
    Column("song_id", Integer, ForeignKey("songs.id", ondelete="CASCADE")),
    Column("position", Integer, nullable=False),  # Order within playlist
)


class Playlist(Base):
    __tablename__ = "playlists"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, default="")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
