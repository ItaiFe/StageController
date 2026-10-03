import time

from app.features.player.service import MusicPlayer


def test_fresh_player_is_not_playing():
    # mpv reports pause=False at startup; with no song loaded that must not read as playing
    p = MusicPlayer()
    time.sleep(0.3)  # let mpv's initial property callbacks fire
    state = p.get_state()
    assert state["current_song"] is None
    assert state["is_playing"] is False
