import asyncio

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.features.buttons import router as buttons
from app.features.playlists.models import Playlist, playlist_songs
from app.features.songs.models import Song


class FakePlayer:
    """Records calls instead of playing audio. A song is already loaded, so start just resumes."""

    def __init__(self):
        self.overlays: list[str] = []
        self.resumed = False

    def get_current_song_id(self):
        return 1

    def resume(self):
        self.resumed = True

    def play_overlay(self, file_path: str) -> bool:
        self.overlays.append(file_path)
        return True


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def player(monkeypatch):
    fake = FakePlayer()
    monkeypatch.setattr(buttons, "music_player", fake)
    return fake


def add_playlist(db, name: str, song_files: list[str]):
    playlist = Playlist(name=name)
    db.add(playlist)
    db.flush()
    for i, filename in enumerate(song_files):
        song = Song(title=filename, duration=3.0, filename=filename, file_path=f"/music/{filename}",
                    file_size=1, format="mp3")
        db.add(song)
        db.flush()
        db.execute(playlist_songs.insert().values(playlist_id=playlist.id, song_id=song.id, position=i))
    db.commit()


def test_start_plays_a_claps_sound(db, player):
    add_playlist(db, "main", ["song.mp3"])
    add_playlist(db, "claps", ["clap.mp3"])

    result = asyncio.run(buttons.handle_start_action(db))

    assert player.resumed
    assert player.overlays == ["/music/clap.mp3"]
    assert result["overlay_song"]["title"] == "clap.mp3"


def test_start_without_claps_playlist_still_starts(db, player):
    add_playlist(db, "main", ["song.mp3"])

    result = asyncio.run(buttons.handle_start_action(db))

    assert player.resumed
    assert player.overlays == []
    assert result["overlay_song"] is None


def test_claps_action_still_plays_a_claps_sound(db, player):
    add_playlist(db, "claps", ["clap.mp3"])

    result = asyncio.run(buttons.handle_claps_action(db))

    assert player.overlays == ["/music/clap.mp3"]
    assert result["overlay_song"]["title"] == "clap.mp3"
