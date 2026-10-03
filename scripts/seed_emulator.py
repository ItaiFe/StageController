#!/usr/bin/env python
"""Seed the local data/ with an example song so the emulator can play every game.

    backend/.venv/bin/python scripts/seed_emulator.py --audio SONG.mp4 --analysis SONG.analysis.json

Copies the audio to data/music/<stem>.m4a and the analysis next to it as <stem>.analysis.json,
registers the song, puts it in the solo/duet/showoff/thunder playlists, adds the stage
appliances as devices (fake addresses, for STAGE_IO=emulated) and example main / claps / special
sequences on them, so the emulator shows appliances switching. Safe to run again; without
--audio/--analysis it only adds the devices and sequences.

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
from app.features.devices.models import Device, Sequence, SequenceStep  # noqa: E402
from app.features.playlists.models import Playlist  # noqa: E402
from app.features.playlists.services import add_songs_to_playlist  # noqa: E402
from app.features.show.tunables import SPEC  # noqa: E402
from app.features.songs.models import Song  # noqa: E402
from app.features.songs.services import create_song_from_file  # noqa: E402

GAMES = [g["playlist"] for g in SPEC["games"]]
# Example sequences (the real ones are made on the Stage tab): (device, on/off, delay before in ms)
SEQUENCES = {
    # floodlights and spotlights follow the song sections (show/scene.py), not the start sequence
    "main": [("backLights", "on", 0), ("movingLights", "on", 0)],
    "claps": [("flickers", "on", 0), ("flickers", "off", 2000)],
    "special": [("smoke", "on", 0), ("bubbles", "on", 0), ("smoke", "off", 1500), ("bubbles", "off", 1500)],
}


def seed_sequences(db) -> None:
    devices = {d.name: d.id for d in db.query(Device).all()}
    for name, steps in SEQUENCES.items():
        if db.query(Sequence).filter(Sequence.name.ilike(name)).first():
            continue
        seq = Sequence(name=name, description="emulator example")
        seq.steps = [SequenceStep(device_id=devices[d], action=a, delay_before=ms, order=i)
                     for i, (d, a, ms) in enumerate(steps) if d in devices]
        db.add(seq)
    db.commit()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--audio", type=Path)
    ap.add_argument("--analysis", type=Path)
    ap.add_argument("--stem", default="its_only_love")
    ap.add_argument("--title", default="It's Only Love")
    ap.add_argument("--artist", default="Bryan Adams & Tina Turner")
    args = ap.parse_args()

    init_db()
    db = SessionLocal()
    try:
        add_devices(db)
        seed_sequences(db)
        if not (args.audio and args.analysis):
            print("Seeded devices and sequences")
            return
        audio = MUSIC_DIR / f"{args.stem}.m4a"
        shutil.copyfile(args.audio, audio)
        shutil.copyfile(args.analysis, MUSIC_DIR / f"{args.stem}.analysis.json")
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
        print(f"Seeded song {song.id} ({song.title}), playlists {', '.join(GAMES)}, "
              f"{len(SPEC['stage']['appliances'])} devices, sequences {', '.join(SEQUENCES)}")
    finally:
        db.close()


def add_devices(db) -> None:
    for i, name in enumerate(SPEC["stage"]["appliances"], start=1):
        ip = f"10.99.0.{i}"
        if not db.query(Device).filter(Device.ip_address == ip).first():
            db.add(Device(name=name, ip_address=ip, role="custom"))
    db.commit()


if __name__ == "__main__":
    main()
