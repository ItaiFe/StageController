import asyncio
import os
import platform
import threading
from pathlib import Path
from typing import Callable

# Set library path for mpv on macOS
if os.path.exists('/opt/homebrew/lib'):
    os.environ.setdefault('DYLD_LIBRARY_PATH', '/opt/homebrew/lib')

import mpv

# Raspberry Pi uses ALSA directly for reliable audio
IS_RASPBERRY_PI = platform.machine().startswith('aarch64') and os.path.exists('/proc/device-tree/model')

# Global event loop reference for callbacks from mpv thread
_main_loop: asyncio.AbstractEventLoop | None = None

def set_main_loop(loop: asyncio.AbstractEventLoop):
    global _main_loop
    _main_loop = loop

from app.core.config import MUSIC_DIR


class PlayerState:
    def __init__(self):
        self.current_song_id: int | None = None
        self.current_song_title: str | None = None
        self.current_song_artist: str | None = None
        self.queue: list[dict] = []
        self.queue_index: int = -1
        self.playlist_name: str | None = None
        self.is_playing: bool = False
        self.current_time: float = 0.0
        self.duration: float = 0.0
        self.volume: float = 70.0

    def to_dict(self) -> dict:
        return {
            "current_song": {
                "id": self.current_song_id,
                "title": self.current_song_title,
                "artist": self.current_song_artist,
            } if self.current_song_id else None,
            "queue_length": len(self.queue),
            "queue_index": self.queue_index,
            "playlist_name": self.playlist_name,
            "is_playing": self.is_playing,
            "current_time": self.current_time,
            "duration": self.duration,
            "volume": self.volume,
        }


class MusicPlayer:
    def __init__(self):
        self._player: mpv.MPV | None = None
        self._overlay_player: mpv.MPV | None = None
        self._state = PlayerState()
        self._lock = threading.Lock()
        self._on_song_end: Callable | None = None
        self._on_state_change: Callable | None = None
        self._init_player()
        self._init_overlay_player()

    def _init_player(self):
        mpv_opts = dict(
            video=False,
            terminal=False,
            input_default_bindings=False,
            input_vo_keyboard=False,
        )
        # Use ALSA directly on Raspberry Pi for reliable audio
        if IS_RASPBERRY_PI:
            mpv_opts['ao'] = 'alsa'
            mpv_opts['audio_device'] = 'alsa/plughw:2,0'

        self._player = mpv.MPV(**mpv_opts)
        self._player.volume = self._state.volume

        self._song_ended_triggered = False
        self._fade_started = False
        self._claps_triggered = False
        self._fade_duration = 10.0  # 10 second fade out
        self._claps_before_end = 5.0  # Play finale claps 5 seconds before end

        @self._player.property_observer('time-pos')
        def time_observer(_name, value):
            if value is not None:
                self._state.current_time = value

                # Start fade out before song ends
                if (self._state.duration > 0 and
                    value >= self._state.duration - self._fade_duration and
                    not self._fade_started):
                    self._fade_started = True
                    print(f"Starting fade out at {value}")
                    self._start_fade_out()

                # Play finale claps before song ends
                if (self._state.duration > 0 and
                    value >= self._state.duration - self._claps_before_end and
                    not self._claps_triggered):
                    self._claps_triggered = True
                    print(f"Playing finale claps at {value}")
                    if self._on_song_ending and _main_loop:
                        _main_loop.call_soon_threadsafe(
                            lambda: asyncio.create_task(self._on_song_ending())
                        )

                # Check if song ended (time reached duration)
                if (self._state.duration > 0 and
                    value >= self._state.duration - 0.5 and
                    not self._song_ended_triggered):
                    self._song_ended_triggered = True
                    print(f"Song ended: time={value}, duration={self._state.duration}")
                    if self._on_song_end and _main_loop:
                        _main_loop.call_soon_threadsafe(
                            lambda: asyncio.create_task(self._on_song_end())
                        )

        @self._player.property_observer('duration')
        def duration_observer(_name, value):
            if value is not None:
                self._state.duration = value

        @self._player.property_observer('pause')
        def pause_observer(_name, value):
            # mpv starts unpaused with nothing loaded; that isn't "playing"
            self._state.is_playing = not value and self._state.current_song_id is not None
            if self._on_state_change and _main_loop:
                _main_loop.call_soon_threadsafe(
                    lambda: asyncio.create_task(self._on_state_change())
                )

    def _init_overlay_player(self):
        mpv_opts = dict(
            video=False,
            terminal=False,
            input_default_bindings=False,
            input_vo_keyboard=False,
        )
        if IS_RASPBERRY_PI:
            mpv_opts['ao'] = 'alsa'
            mpv_opts['audio_device'] = 'alsa/plughw:2,0'

        self._overlay_player = mpv.MPV(**mpv_opts)
        # Overlay (claps) plays louder than main music
        self._overlay_player.volume = min(100, self._state.volume * 1.5)

    def set_callbacks(self, on_song_end: Callable, on_state_change: Callable, on_song_ending: Callable = None):
        self._on_song_end = on_song_end
        self._on_state_change = on_state_change
        self._on_song_ending = on_song_ending  # Called when fade starts

    def _start_fade_out(self):
        """Start fading out the volume with a smooth curve."""
        import threading

        def fade():
            start_volume = self._state.volume
            steps = 50  # More steps for smoother fade
            step_time = self._fade_duration / steps
            for i in range(steps):
                if not self._state.is_playing:
                    break
                # Use exponential curve for more natural fade (stays louder longer, then drops)
                progress = (i + 1) / steps
                # Exponential ease-in: slow start, fast end
                curve = progress * progress * progress
                new_vol = start_volume * (1 - curve)
                if self._player:
                    self._player.volume = max(0, new_vol)
                import time
                time.sleep(step_time)

        threading.Thread(target=fade, daemon=True).start()

    def get_state(self) -> dict:
        return self._state.to_dict()

    def play_song(self, song_id: int, title: str, artist: str, file_path: str):
        with self._lock:
            # file_path can be absolute or relative to MUSIC_DIR
            path = Path(file_path)
            if path.is_absolute():
                full_path = path
            else:
                full_path = Path(MUSIC_DIR) / file_path

            if not full_path.exists():
                print(f"File not found: {full_path}")
                return False

            self._state.current_song_id = song_id
            self._state.current_song_title = title
            self._state.current_song_artist = artist
            self._state.current_time = 0.0
            self._state.duration = 0.0
            self._song_ended_triggered = False
            self._fade_started = False
            self._claps_triggered = False

            # Restore volume in case previous song faded out
            if self._player:
                self._player.volume = self._state.volume

            print(f"Playing: {full_path}")
            self._player.play(str(full_path))
            # mpv's pause flag persists across files; clear it so a prior pause doesn't silence the new song
            self._player.pause = False
            self._state.is_playing = True
            return True

    def set_queue(self, songs: list[dict], playlist_name: str | None = None):
        with self._lock:
            self._state.queue = songs
            self._state.playlist_name = playlist_name
            self._state.queue_index = -1

    def play_from_queue(self, index: int = 0) -> bool:
        with self._lock:
            if not self._state.queue or index >= len(self._state.queue):
                return False

            self._state.queue_index = index
            song = self._state.queue[index]

        return self.play_song(
            song['id'],
            song['title'],
            song['artist'],
            song['file_path']
        )

    def next(self) -> bool:
        with self._lock:
            if not self._state.queue:
                return False
            new_index = self._state.queue_index + 1
            if new_index >= len(self._state.queue):
                new_index = 0
            self._state.queue_index = new_index
            song = self._state.queue[new_index]

        return self.play_song(
            song['id'],
            song['title'],
            song['artist'],
            song['file_path']
        )

    def prev(self) -> bool:
        with self._lock:
            if not self._state.queue:
                return False
            new_index = self._state.queue_index - 1
            if new_index < 0:
                new_index = len(self._state.queue) - 1
            self._state.queue_index = new_index
            song = self._state.queue[new_index]

        return self.play_song(
            song['id'],
            song['title'],
            song['artist'],
            song['file_path']
        )

    def toggle_play(self):
        with self._lock:
            if self._player:
                self._player.pause = not self._player.pause

    def pause(self):
        with self._lock:
            if self._player:
                self._player.pause = True
                self._state.is_playing = False

    def resume(self):
        with self._lock:
            if self._player:
                self._player.pause = False
                self._state.is_playing = True

    def stop(self, advance_queue: bool = True):
        with self._lock:
            if self._player:
                self._player.stop()
            self._state.is_playing = False
            self._state.current_song_id = None
            self._state.current_song_title = None
            self._state.current_song_artist = None
            self._state.current_time = 0.0
            self._state.duration = 0.0
            # Advance to next song in queue for next start
            if advance_queue and self._state.queue:
                self._state.queue_index += 1
                if self._state.queue_index >= len(self._state.queue):
                    self._state.queue_index = 0  # Loop back

    def clear_queue(self):
        with self._lock:
            self._state.queue = []
            self._state.queue_index = -1
            self._state.playlist_name = None

    def seek(self, time: float):
        with self._lock:
            if self._player:
                try:
                    self._player.seek(time, 'absolute')
                except Exception as e:
                    print(f"Seek error: {e}")

    def set_volume(self, volume: float):
        with self._lock:
            self._state.volume = max(0, min(100, volume))
            if self._player:
                self._player.volume = self._state.volume
            if self._overlay_player:
                self._overlay_player.volume = self._state.volume

    def play_overlay(self, file_path: str) -> bool:
        """Play an overlay sound (e.g., claps) over the main music."""
        with self._lock:
            path = Path(file_path)
            if path.is_absolute():
                full_path = path
            else:
                full_path = Path(MUSIC_DIR) / file_path

            if not full_path.exists():
                print(f"Overlay file not found: {full_path}")
                return False

            if self._overlay_player:
                # Set overlay volume louder (1.5x main volume, max 100)
                self._overlay_player.volume = min(100, self._state.volume * 1.5)
                self._overlay_player.play(str(full_path))
                return True
            return False

    def stop_overlay(self):
        """Stop any overlay sound (e.g., claps) that is still playing."""
        with self._lock:
            if self._overlay_player:
                self._overlay_player.stop()

    def get_current_song_id(self) -> int | None:
        return self._state.current_song_id

    def get_queue_index(self) -> int:
        return self._state.queue_index

    def has_queue(self) -> bool:
        return len(self._state.queue) > 0

    def is_queue_exhausted(self) -> bool:
        """Returns True if we've played through the entire queue."""
        return self._state.queue_index >= len(self._state.queue)

    def play_current_queue_position(self) -> bool:
        """Play song at current queue index."""
        with self._lock:
            if not self._state.queue:
                return False
            idx = self._state.queue_index
            if idx < 0 or idx >= len(self._state.queue):
                idx = 0
                self._state.queue_index = 0
            song = self._state.queue[idx]

        return self.play_song(
            song['id'],
            song['title'],
            song['artist'],
            song['file_path']
        )


# Global player instance
player = MusicPlayer()
