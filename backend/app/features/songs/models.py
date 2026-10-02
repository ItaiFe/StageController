from sqlalchemy import Column, Integer, String, Float, DateTime
from sqlalchemy.sql import func

from app.core.database import Base


class Song(Base):
    __tablename__ = "songs"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    artist = Column(String, default="Unknown Artist")
    album = Column(String, default="Unknown Album")
    duration = Column(Float, nullable=False)  # Duration in seconds
    filename = Column(String, nullable=False, unique=True)
    file_path = Column(String, nullable=False)
    file_size = Column(Integer, nullable=False)  # Size in bytes
    format = Column(String, nullable=False)  # mp3, flac, etc.
    created_at = Column(DateTime, server_default=func.now())
