import random
from sqlalchemy import select, delete, func
from sqlalchemy.orm import Session

from app.features.songs.models import Song
from .models import Playlist, playlist_songs
from .schemas import PlaylistCreate, PlaylistUpdate


def create_playlist(db: Session, playlist_data: PlaylistCreate) -> Playlist:
    """Create a new playlist."""
    playlist = Playlist(**playlist_data.model_dump())
    db.add(playlist)
    db.commit()
    db.refresh(playlist)
    return playlist


def get_playlists(db: Session) -> list[dict]:
    """Get all playlists with song count and total duration."""
    playlists = db.query(Playlist).order_by(Playlist.updated_at.desc()).all()

    result = []
    for playlist in playlists:
        # Get song count and total duration
        stats = (
            db.query(
                func.count(playlist_songs.c.song_id).label("count"),
                func.coalesce(func.sum(Song.duration), 0).label("duration"),
            )
            .select_from(playlist_songs)
            .join(Song, Song.id == playlist_songs.c.song_id)
            .filter(playlist_songs.c.playlist_id == playlist.id)
            .first()
        )

        result.append({
            "id": playlist.id,
            "name": playlist.name,
            "description": playlist.description,
            "created_at": playlist.created_at,
            "updated_at": playlist.updated_at,
            "song_count": stats.count if stats else 0,
            "total_duration": stats.duration if stats else 0.0,
        })

    return result


def get_playlist(db: Session, playlist_id: int) -> Playlist | None:
    """Get a playlist by ID."""
    return db.query(Playlist).filter(Playlist.id == playlist_id).first()


def get_playlist_songs(db: Session, playlist_id: int) -> list[Song]:
    """Get all songs in a playlist, ordered by position."""
    songs = (
        db.query(Song)
        .join(playlist_songs, Song.id == playlist_songs.c.song_id)
        .filter(playlist_songs.c.playlist_id == playlist_id)
        .order_by(playlist_songs.c.position)
        .all()
    )
    return songs


def update_playlist(
    db: Session, playlist_id: int, playlist_update: PlaylistUpdate
) -> Playlist | None:
    """Update playlist metadata."""
    playlist = get_playlist(db, playlist_id)
    if not playlist:
        return None

    update_data = playlist_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(playlist, key, value)

    db.commit()
    db.refresh(playlist)
    return playlist


def delete_playlist(db: Session, playlist_id: int) -> bool:
    """Delete a playlist."""
    playlist = get_playlist(db, playlist_id)
    if not playlist:
        return False

    db.delete(playlist)
    db.commit()
    return True


def add_songs_to_playlist(
    db: Session, playlist_id: int, song_ids: list[int]
) -> bool:
    """Add songs to a playlist."""
    playlist = get_playlist(db, playlist_id)
    if not playlist:
        return False

    # Get current max position
    max_pos = (
        db.query(func.max(playlist_songs.c.position))
        .filter(playlist_songs.c.playlist_id == playlist_id)
        .scalar()
    ) or -1

    # Add new songs
    for i, song_id in enumerate(song_ids):
        # Check if song exists and not already in playlist
        song_exists = db.query(Song).filter(Song.id == song_id).first()
        already_in = (
            db.query(playlist_songs)
            .filter(
                playlist_songs.c.playlist_id == playlist_id,
                playlist_songs.c.song_id == song_id,
            )
            .first()
        )

        if song_exists and not already_in:
            db.execute(
                playlist_songs.insert().values(
                    playlist_id=playlist_id,
                    song_id=song_id,
                    position=max_pos + 1 + i,
                )
            )

    db.commit()
    return True


def remove_songs_from_playlist(
    db: Session, playlist_id: int, song_ids: list[int]
) -> bool:
    """Remove songs from a playlist."""
    playlist = get_playlist(db, playlist_id)
    if not playlist:
        return False

    db.execute(
        delete(playlist_songs).where(
            playlist_songs.c.playlist_id == playlist_id,
            playlist_songs.c.song_id.in_(song_ids),
        )
    )

    # Reorder remaining songs
    _reindex_positions(db, playlist_id)
    db.commit()
    return True


def reorder_playlist(db: Session, playlist_id: int, song_ids: list[int]) -> bool:
    """Reorder songs in a playlist."""
    playlist = get_playlist(db, playlist_id)
    if not playlist:
        return False

    # Update positions based on new order
    for position, song_id in enumerate(song_ids):
        db.execute(
            playlist_songs.update()
            .where(
                playlist_songs.c.playlist_id == playlist_id,
                playlist_songs.c.song_id == song_id,
            )
            .values(position=position)
        )

    db.commit()
    return True


def shuffle_playlist(db: Session, playlist_id: int) -> bool:
    """Shuffle the order of songs in a playlist."""
    playlist = get_playlist(db, playlist_id)
    if not playlist:
        return False

    # Get current song IDs
    song_ids = [
        row.song_id
        for row in db.query(playlist_songs.c.song_id)
        .filter(playlist_songs.c.playlist_id == playlist_id)
        .all()
    ]

    # Shuffle and reorder
    random.shuffle(song_ids)
    return reorder_playlist(db, playlist_id, song_ids)


def duplicate_playlist(db: Session, playlist_id: int) -> Playlist | None:
    """Create a copy of a playlist."""
    original = get_playlist(db, playlist_id)
    if not original:
        return None

    # Create new playlist
    new_playlist = Playlist(
        name=f"{original.name} (Copy)",
        description=original.description,
    )
    db.add(new_playlist)
    db.commit()
    db.refresh(new_playlist)

    # Copy songs
    songs = (
        db.query(playlist_songs.c.song_id, playlist_songs.c.position)
        .filter(playlist_songs.c.playlist_id == playlist_id)
        .order_by(playlist_songs.c.position)
        .all()
    )

    for song in songs:
        db.execute(
            playlist_songs.insert().values(
                playlist_id=new_playlist.id,
                song_id=song.song_id,
                position=song.position,
            )
        )

    db.commit()
    return new_playlist


def _reindex_positions(db: Session, playlist_id: int):
    """Reindex positions to be sequential starting from 0."""
    songs = (
        db.query(playlist_songs.c.song_id)
        .filter(playlist_songs.c.playlist_id == playlist_id)
        .order_by(playlist_songs.c.position)
        .all()
    )

    for i, song in enumerate(songs):
        db.execute(
            playlist_songs.update()
            .where(
                playlist_songs.c.playlist_id == playlist_id,
                playlist_songs.c.song_id == song.song_id,
            )
            .values(position=i)
        )
