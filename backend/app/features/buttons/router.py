from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from pydantic import BaseModel
from typing import Literal
from datetime import datetime
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.features.devices.models import Sequence, Device
from app.features.devices.service import execute_sequence, set_device_state, update_device_state
import random

from app.features.playlists.models import Playlist, playlist_songs
from app.features.playlists.services import shuffle_playlist, get_playlist_songs
from app.features.songs.models import Song
from app.features.player.service import player as music_player
from app.features.stats.models import SongPlay
from app.features.buttons.rules import is_action_allowed

router = APIRouter(prefix="/buttons", tags=["buttons"])

ButtonAction = Literal["start", "stop", "skip", "claps", "special"]


class ButtonPress(BaseModel):
    action: ButtonAction
    timestamp: datetime | None = None


class ButtonEvent(BaseModel):
    action: ButtonAction
    timestamp: datetime
    playlist_id: int | None = None
    playlist_name: str | None = None
    overlay_song_id: int | None = None


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self.last_events: list[ButtonEvent] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, event: ButtonEvent):
        self.last_events.append(event)
        if len(self.last_events) > 100:
            self.last_events = self.last_events[-100:]

        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(event.model_dump(mode="json"))
            except Exception:
                disconnected.append(connection)

        for conn in disconnected:
            self.active_connections.remove(conn)


manager = ConnectionManager()


def play_random_claps(db: Session) -> dict | None:
    """Play a random song from the "claps" playlist as an overlay (doesn't stop main music).

    Returns the song played, or None if there is no claps playlist or it is empty.
    """
    claps_playlist = db.query(Playlist).filter(Playlist.name.ilike("claps")).first()
    if not claps_playlist:
        return None

    song_ids = db.execute(
        playlist_songs.select().where(playlist_songs.c.playlist_id == claps_playlist.id)
    ).fetchall()
    if not song_ids:
        return None

    random_entry = random.choice(song_ids)
    song = db.query(Song).filter(Song.id == random_entry.song_id).first()
    if not song:
        return None

    music_player.play_overlay(song.file_path)
    return {"id": song.id, "title": song.title, "artist": song.artist}


async def handle_start_action(db: Session) -> dict:
    """Start main sequence and main playlist, with a claps sound to open the show."""
    result = {"sequence": None, "playlist": None, "overlay_song": None}

    # Find and execute "main" sequence
    main_sequence = db.query(Sequence).filter(Sequence.name.ilike("main")).first()
    if main_sequence:
        seq_result = await execute_sequence(db, main_sequence.id)
        result["sequence"] = seq_result

    # Find "main" playlist
    main_playlist = db.query(Playlist).filter(Playlist.name.ilike("main")).first()
    if main_playlist:
        # If currently playing, just resume
        if music_player.get_current_song_id() is not None:
            music_player.resume()
        # If queue exists (was stopped mid-show), play next song
        elif music_player.has_queue():
            music_player.play_current_queue_position()
        # No queue - shuffle and start fresh
        else:
            shuffle_playlist(db, main_playlist.id)
            songs = get_playlist_songs(db, main_playlist.id)
            if songs:
                queue = [
                    {"id": s.id, "title": s.title, "artist": s.artist, "file_path": s.file_path}
                    for s in songs
                ]
                music_player.set_queue(queue, main_playlist.name)
                music_player.play_from_queue(0)

        result["playlist"] = {"id": main_playlist.id, "name": main_playlist.name}

    # Claps sound over the music (sound only, not the claps device sequence)
    result["overlay_song"] = play_random_claps(db)

    return result


async def end_show(db: Session) -> dict:
    """End the show - turn off all devices. Called by stop button or when playlist ends."""
    result = {"devices_off": []}

    devices = db.query(Device).all()
    for device in devices:
        success = await set_device_state(device.ip_address, False)
        if success:
            update_device_state(db, device.id, False)
        result["devices_off"].append({"device": device.name, "success": success})

    return result


async def handle_stop_action(db: Session) -> dict:
    """Stop button pressed - end the show."""
    # Record stopped stat for current song
    current_song_id = music_player.get_current_song_id()
    if current_song_id:
        play = SongPlay(song_id=current_song_id, outcome="stopped")
        db.add(play)
        db.commit()

    # Stop music playback and any claps/overlay sound still playing
    music_player.stop()
    music_player.stop_overlay()

    return await end_show(db)


async def handle_skip_action(db: Session) -> dict:
    """Skip to next song."""
    # Record skipped stat for current song
    current_song_id = music_player.get_current_song_id()
    if current_song_id:
        play = SongPlay(song_id=current_song_id, outcome="skipped")
        db.add(play)
        db.commit()

    # Skip to next song
    music_player.next()

    return {"command": "skip", "state": music_player.get_state()}


async def handle_claps_action(db: Session) -> dict:
    """Trigger claps sequence and play random song from claps playlist as overlay."""
    result = {"sequence": None, "overlay_song": None}

    # Find and execute "claps" sequence
    claps_sequence = db.query(Sequence).filter(Sequence.name.ilike("claps")).first()
    if claps_sequence:
        seq_result = await execute_sequence(db, claps_sequence.id)
        result["sequence"] = seq_result

    result["overlay_song"] = play_random_claps(db)

    return result


async def handle_special_action(db: Session) -> dict:
    """Trigger special sequence - smoke, bubbles, effects."""
    result = {"sequence": None}

    # Find and execute "special" sequence
    special_sequence = db.query(Sequence).filter(Sequence.name.ilike("special")).first()
    if special_sequence:
        seq_result = await execute_sequence(db, special_sequence.id)
        result["sequence"] = seq_result

    return result


async def handle_action(action: ButtonAction, db: Session | None = None) -> dict:
    """Handle button actions with side effects."""
    extras = {}

    if db:
        if action == "start":
            extras = await handle_start_action(db)
        elif action == "stop":
            extras = await handle_stop_action(db)
        elif action == "skip":
            extras = await handle_skip_action(db)
        elif action == "claps":
            extras = await handle_claps_action(db)
        elif action == "special":
            extras = await handle_special_action(db)

    return extras


def show_is_running() -> bool:
    """The show runs while a song is loaded (playing or paused); otherwise it is idle."""
    return music_player.get_current_song_id() is not None


def ignored_response(action: ButtonAction) -> dict:
    # 200 with an explicit status so the button doesn't treat it as a failure and retry
    return {"status": "ignored", "action": action, "reason": "show_stopped"}


@router.post("/press")
async def button_press(data: ButtonPress, db: Session = Depends(get_db)):
    """Receive a button press from external device (Pi GPIO, remote, etc.)"""
    if not is_action_allowed(data.action, show_is_running()):
        return ignored_response(data.action)

    extras = await handle_action(data.action, db)

    playlist_info = extras.get("playlist", {})
    overlay_song = extras.get("overlay_song", {})
    event = ButtonEvent(
        action=data.action,
        timestamp=data.timestamp or datetime.now(),
        playlist_id=playlist_info.get("id") if playlist_info else None,
        playlist_name=playlist_info.get("name") if playlist_info else None,
        overlay_song_id=overlay_song.get("id") if overlay_song else None,
    )

    await manager.broadcast(event)

    return {"status": "ok", "action": data.action, "timestamp": event.timestamp, **extras}


@router.post("/press/{action}")
async def button_press_simple(action: ButtonAction, db: Session = Depends(get_db)):
    """Simple endpoint: POST /api/buttons/press/start"""
    if not is_action_allowed(action, show_is_running()):
        return ignored_response(action)

    extras = await handle_action(action, db)

    playlist_info = extras.get("playlist", {})
    overlay_song = extras.get("overlay_song", {})
    event = ButtonEvent(
        action=action,
        timestamp=datetime.now(),
        playlist_id=playlist_info.get("id") if playlist_info else None,
        playlist_name=playlist_info.get("name") if playlist_info else None,
        overlay_song_id=overlay_song.get("id") if overlay_song else None,
    )

    await manager.broadcast(event)

    return {"status": "ok", "action": action, "timestamp": event.timestamp, **extras}


@router.post("/end")
async def playlist_ended(db: Session = Depends(get_db)):
    """Called when a song ends - turns off all devices. Does NOT broadcast stop event."""
    result = await end_show(db)
    return {"status": "ok", "reason": "song_ended", **result}


@router.get("/recent")
async def get_recent_events(limit: int = 10):
    """Get recent button events"""
    return manager.last_events[-limit:]


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket for real-time button events"""
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
