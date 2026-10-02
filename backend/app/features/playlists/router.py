from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from . import services
from .schemas import (
    PlaylistCreate,
    PlaylistUpdate,
    PlaylistResponse,
    PlaylistDetailResponse,
    ReorderRequest,
    AddSongsRequest,
    RemoveSongsRequest,
)

router = APIRouter(prefix="/playlists", tags=["playlists"])


@router.post("", response_model=PlaylistResponse)
def create_playlist(
    playlist_data: PlaylistCreate,
    db: Session = Depends(get_db),
):
    """Create a new playlist."""
    playlist = services.create_playlist(db, playlist_data)
    return {**playlist.__dict__, "song_count": 0, "total_duration": 0.0}


@router.get("", response_model=list[PlaylistResponse])
def get_playlists(db: Session = Depends(get_db)):
    """Get all playlists."""
    return services.get_playlists(db)


@router.get("/{playlist_id}", response_model=PlaylistDetailResponse)
def get_playlist(playlist_id: int, db: Session = Depends(get_db)):
    """Get a playlist with all its songs."""
    playlist = services.get_playlist(db, playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    songs = services.get_playlist_songs(db, playlist_id)
    return {
        "id": playlist.id,
        "name": playlist.name,
        "description": playlist.description,
        "created_at": playlist.created_at,
        "updated_at": playlist.updated_at,
        "songs": songs,
    }


@router.patch("/{playlist_id}", response_model=PlaylistResponse)
def update_playlist(
    playlist_id: int,
    playlist_update: PlaylistUpdate,
    db: Session = Depends(get_db),
):
    """Update playlist metadata."""
    playlist = services.update_playlist(db, playlist_id, playlist_update)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    playlists = services.get_playlists(db)
    return next(p for p in playlists if p["id"] == playlist_id)


@router.delete("/{playlist_id}")
def delete_playlist(playlist_id: int, db: Session = Depends(get_db)):
    """Delete a playlist."""
    success = services.delete_playlist(db, playlist_id)
    if not success:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return {"message": "Playlist deleted successfully"}


@router.post("/{playlist_id}/songs")
def add_songs(
    playlist_id: int,
    request: AddSongsRequest,
    db: Session = Depends(get_db),
):
    """Add songs to a playlist."""
    success = services.add_songs_to_playlist(db, playlist_id, request.song_ids)
    if not success:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return {"message": "Songs added successfully"}


@router.delete("/{playlist_id}/songs")
def remove_songs(
    playlist_id: int,
    request: RemoveSongsRequest,
    db: Session = Depends(get_db),
):
    """Remove songs from a playlist."""
    success = services.remove_songs_from_playlist(db, playlist_id, request.song_ids)
    if not success:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return {"message": "Songs removed successfully"}


@router.post("/{playlist_id}/reorder")
def reorder_playlist(
    playlist_id: int,
    request: ReorderRequest,
    db: Session = Depends(get_db),
):
    """Reorder songs in a playlist."""
    success = services.reorder_playlist(db, playlist_id, request.song_ids)
    if not success:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return {"message": "Playlist reordered successfully"}


@router.post("/{playlist_id}/shuffle")
def shuffle_playlist(playlist_id: int, db: Session = Depends(get_db)):
    """Shuffle the order of songs in a playlist."""
    success = services.shuffle_playlist(db, playlist_id)
    if not success:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return {"message": "Playlist shuffled successfully"}


@router.post("/{playlist_id}/duplicate", response_model=PlaylistResponse)
def duplicate_playlist(playlist_id: int, db: Session = Depends(get_db)):
    """Create a copy of a playlist."""
    new_playlist = services.duplicate_playlist(db, playlist_id)
    if not new_playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    playlists = services.get_playlists(db)
    return next(p for p in playlists if p["id"] == new_playlist.id)
