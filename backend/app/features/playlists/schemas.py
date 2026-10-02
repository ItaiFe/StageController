from datetime import datetime
from pydantic import BaseModel

from app.features.songs.schemas import SongResponse


class PlaylistBase(BaseModel):
    name: str
    description: str = ""


class PlaylistCreate(PlaylistBase):
    pass


class PlaylistUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class PlaylistSongEntry(BaseModel):
    song_id: int
    position: int


class PlaylistResponse(PlaylistBase):
    id: int
    created_at: datetime
    updated_at: datetime
    song_count: int = 0
    total_duration: float = 0.0

    class Config:
        from_attributes = True


class PlaylistDetailResponse(PlaylistBase):
    id: int
    created_at: datetime
    updated_at: datetime
    songs: list[SongResponse]

    class Config:
        from_attributes = True


class ReorderRequest(BaseModel):
    song_ids: list[int]  # New order of song IDs


class AddSongsRequest(BaseModel):
    song_ids: list[int]


class RemoveSongsRequest(BaseModel):
    song_ids: list[int]
