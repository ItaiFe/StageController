#!/usr/bin/env python
"""Seed the local data/ with an example song so the emulator can play every game.

    backend/.venv/bin/python scripts/seed_emulator.py --audio SONG.mp4 --analysis SONG.analysis.json

Copies the audio to data/music/<stem>.m4a and the analysis next to it as <stem>.analysis.json,
registers the song, puts it in the solo/duet/showoff/thunder playlists, and adds the stage
appliances as devices (fake addresses, for STAGE_IO=emulated). Safe to run again.

Laptop only: deploy.sh rsyncs data/ (db.sqlite included) to the Pi, and the fake devices
would make every real start/stop wait out the plug timeout. Don't deploy a seeded data/.
"""
import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.core.config import MUSIC_DIR  # noqa: E402
from app.core.database import SessionLocal, init_db  # noqa: E402
from app.features.devices.models import Device  # noqa: E402
from app.features.playlists.models import Playlist  # noqa: E402
from app.features.playlists.services import add_songs_to_playlist  # noqa: E402
from app.features.show.tunables import SPEC  # noqa: E402
from app.features.songs.models import Song  # noqa: E402
from app.features.songs.services import create_song_from_file  # noqa: E402

GAMES = [g["playlist"] for g in SPEC["games"]]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--audio", required=True, type=Path)
    ap.add_argument("--analysis", required=True, type=Path)
    ap.add_argument("--stem", default="its_only_love")
    ap.add_argument("--title", default="It's Only Love")
    ap.add_argument("--artist", default="Bryan Adams & Tina Turner")
    args = ap.parse_args()

    audio = MUSIC_DIR / f"{args.stem}.m4a"
    shutil.copyfile(args.audio, audio)
    shutil.copyfile(args.analysis, MUSIC_DIR / f"{args.stem}.analysis.json")

    init_db()
    db = SessionLocal()
    try:
        song = db.query(Song).filter(Song.file_path == str(audio)).first()
        if not song:
            song = create_song_from_file(db, audio, audio.name)
            song.title, song.artist = args.title, args.artist
            db.commit()
        for name in GAMES:
            playlist = db.query(Playlist).filter(Playlist.name.ilike(name)).first()
            if not playlist:
                playlist = Playlist(name=name)
                db.add(playlist)
                db.commit()
            add_songs_to_playlist(db, playlist.id, [song.id])
        for i, name in enumerate(SPEC["stage"]["appliances"], start=1):
            ip = f"10.99.0.{i}"
            if not db.query(Device).filter(Device.ip_address == ip).first():
                db.add(Device(name=name, ip_address=ip, role="custom"))
        db.commit()
        print(f"Seeded song {song.id} ({song.title}), playlists {', '.join(GAMES)}, "
              f"{len(SPEC['stage']['appliances'])} devices")
    finally:
        db.close()


if __name__ == "__main__":
    main()
