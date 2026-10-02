import os
import uuid
from pathlib import Path

import aiofiles
from fastapi import UploadFile
from mutagen import File as MutagenFile
from mutagen.easyid3 import EasyID3
from mutagen.mp3 import MP3
from mutagen.flac import FLAC
from mutagen.oggvorbis import OggVorbis
from mutagen.mp4 import MP4
from sqlalchemy.orm import Session

from app.core.config import MUSIC_DIR, ALLOWED_AUDIO_EXTENSIONS
from .models import Song
from .schemas import SongUpdate


def get_audio_metadata(file_path: Path) -> dict:
    """Extract metadata from audio file using mutagen."""
    metadata = {
        "title": file_path.stem,
        "artist": "Unknown Artist",
        "album": "Unknown Album",
        "duration": 0.0,
    }

    try:
        audio = MutagenFile(file_path, easy=True)
        if audio is None:
            return metadata

        # Get duration
        if hasattr(audio, "info") and hasattr(audio.info, "length"):
            metadata["duration"] = audio.info.length

        # Get tags
        if audio.tags:
            metadata["title"] = audio.tags.get("title", [file_path.stem])[0]
            metadata["artist"] = audio.tags.get("artist", ["Unknown Artist"])[0]
            metadata["album"] = audio.tags.get("album", ["Unknown Album"])[0]

    except Exception:
        pass

    return metadata


async def save_uploaded_file(upload_file: UploadFile) -> Path:
    """Save uploaded file to music directory with unique name."""
    ext = Path(upload_file.filename).suffix.lower()
    unique_name = f"{uuid.uuid4()}{ext}"
    file_path = MUSIC_DIR / unique_name

    async with aiofiles.open(file_path, "wb") as f:
        content = await upload_file.read()
        await f.write(content)

    return file_path


def create_song_from_file(db: Session, file_path: Path, original_filename: str) -> Song:
    """Create a song record from an uploaded file."""
    metadata = get_audio_metadata(file_path)
    file_size = file_path.stat().st_size
    file_format = file_path.suffix.lstrip(".").lower()

    song = Song(
        title=metadata["title"],
        artist=metadata["artist"],
        album=metadata["album"],
        duration=metadata["duration"],
        filename=original_filename,
        file_path=str(file_path),
        file_size=file_size,
        format=file_format,
    )

    db.add(song)
    db.commit()
    db.refresh(song)
    return song


def get_songs(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    search: str | None = None,
    sort_by: str = "created_at",
    sort_desc: bool = True,
) -> tuple[list[Song], int]:
    """Get songs with optional filtering and pagination."""
    query = db.query(Song)

    if search:
        search_term = f"%{search}%"
        query = query.filter(
            Song.title.ilike(search_term)
            | Song.artist.ilike(search_term)
            | Song.album.ilike(search_term)
        )

    total = query.count()

    # Sorting
    sort_column = getattr(Song, sort_by, Song.created_at)
    if sort_desc:
        sort_column = sort_column.desc()
    query = query.order_by(sort_column)

    songs = query.offset(skip).limit(limit).all()
    return songs, total


def get_song(db: Session, song_id: int) -> Song | None:
    """Get a single song by ID."""
    return db.query(Song).filter(Song.id == song_id).first()


def update_song(db: Session, song_id: int, song_update: SongUpdate) -> Song | None:
    """Update song metadata."""
    song = get_song(db, song_id)
    if not song:
        return None

    update_data = song_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(song, key, value)

    db.commit()
    db.refresh(song)
    return song


def delete_song(db: Session, song_id: int) -> bool:
    """Delete a song and its file."""
    song = get_song(db, song_id)
    if not song:
        return False

    # Delete file
    file_path = Path(song.file_path)
    if file_path.exists():
        file_path.unlink()

    db.delete(song)
    db.commit()
    return True


def is_valid_audio_file(filename: str) -> bool:
    """Check if file has allowed audio extension."""
    ext = Path(filename).suffix.lower()
    return ext in ALLOWED_AUDIO_EXTENSIONS


def trim_song(db: Session, song_id: int, start_time: float, end_time: float) -> Song | None:
    """Trim a song to the specified time range using ffmpeg."""
    import subprocess
    import shutil

    song = get_song(db, song_id)
    if not song:
        return None

    original_path = Path(song.file_path)
    if not original_path.exists():
        return None

    # Create temp file for trimmed output
    temp_path = original_path.with_suffix(f".trimmed{original_path.suffix}")

    try:
        # Use ffmpeg to trim the audio
        cmd = [
            "ffmpeg", "-y",
            "-i", str(original_path),
            "-ss", str(start_time),
            "-to", str(end_time),
            "-c", "copy",  # Copy codec (fast, no re-encoding)
            str(temp_path)
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            # Try with re-encoding if copy fails
            cmd = [
                "ffmpeg", "-y",
                "-i", str(original_path),
                "-ss", str(start_time),
                "-to", str(end_time),
                "-acodec", "libmp3lame" if original_path.suffix.lower() == ".mp3" else "copy",
                str(temp_path)
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                print(f"FFmpeg error: {result.stderr}")
                return None

        # Replace original with trimmed
        shutil.move(str(temp_path), str(original_path))

        # Update song metadata
        new_duration = end_time - start_time
        song.duration = new_duration
        song.file_size = original_path.stat().st_size

        db.commit()
        db.refresh(song)
        return song

    except Exception as e:
        print(f"Trim error: {e}")
        if temp_path.exists():
            temp_path.unlink()
        return None
