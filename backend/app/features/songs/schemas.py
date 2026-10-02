from datetime import datetime
from pydantic import BaseModel


class SongBase(BaseModel):
    title: str
    artist: str = "Unknown Artist"
    album: str = "Unknown Album"


class SongCreate(SongBase):
    pass


class SongUpdate(BaseModel):
    title: str | None = None
    artist: str | None = None
    album: str | None = None


class SongResponse(SongBase):
    id: int
    duration: float
    filename: str
    file_size: int
    format: str
    created_at: datetime

    class Config:
        from_attributes = True


class SongListResponse(BaseModel):
    songs: list[SongResponse]
    total: int
