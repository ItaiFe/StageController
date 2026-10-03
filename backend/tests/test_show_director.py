import asyncio
from pathlib import Path

import pytest

from app.features.show import tunables
from app.features.show.scene import scene_for
from app.features.show.service import ShowDirector, SongStatus
from app.features.show.songmap import SongMap

FIXTURE = Path(__file__).parent / "fixtures" / "its_only_love.analysis.json"

STEP = 20  # the real loop ticks about every 20 ms


class FakeClock:
    def __init__(self):
        self.t = 0

    def now_ms(self):
        return self.t


class FakePlayer:
    def __init__(self, song_id=1):
        self.song_id = song_id
        self.loaded = False
        self.t = 0.0  # song time, set by the test
        self.map = SongMap(None, [], [])
        self.started: list[str] = []
        self.actions: list[str] = []
        self.devices = {"floodLights (x2)": False, "spotlights": False, "smoke": False}

    async def apply_scene(self, section):
        self.devices.update(scene_for(section, list(self.devices)))

    async def start_game(self, game):
        self.started.append(game)
        self.loaded = self.song_id is not None
        return self.song_id

    def status(self):
        return SongStatus(self.song_id, self.t, 290.551) if self.loaded else None

    def song_map(self):
        return self.map

    async def run_action(self, action):
        self.actions.append(action)
        if action == "stop":
            self.loaded = False


class Pick:
    """RNG stub: every thunder window goes to this pole."""
    def __init__(self, side):
        self.side = side

    def choice(self, options):
        return self.side


class Rig:
    def __init__(self, song_id=1, rng=None):
        self.clock = FakeClock()
        self.player = FakePlayer(song_id)
        self.events = []  # show events
        self.legacy = []  # button events broadcast alongside
        self.log = []

        async def emit(event):
            (self.events if event.action == "show" else self.legacy).append((self.clock.t, event))

        self.director = ShowDirector(self.player, self.clock, emit, lambda kind, mono, /, **f: self.log.append((kind, mono, f)),
                                     rng=rng)

    def press(self, action, side, ago=0, taps=None):
        return asyncio.run(self.director.on_press(action, side, ago, taps))

    def advance(self, ms):
        end = self.clock.t + ms
        while self.clock.t < end:
            self.clock.t += STEP
            asyncio.run(self.director.tick())

    def states(self):
        return [(e.state, e.step) for _, e in self.events]

    def at(self, state, step=None):
        return next(t for t, e in self.events if e.state == state and e.step == step)


@pytest.fixture(autouse=True)
def clean():
    tunables.clear_overrides()
    yield
    tunables.clear_overrides()


def test_solo_launch_runs_the_intro_then_starts_the_song():
    rig = Rig()
    assert rig.press("start", "L")["status"] == "ok"
    assert rig.director.state == "launching"
    launching = rig.events[-1][1]
    assert (launching.poles.L.pct, launching.poles.R.pct) == (33, 0)

    rig.advance(500)
    assert rig.director.state == "intro" and rig.director.game == "solo"
    decided = rig.at("intro", 3)
    rig.advance(1000)
    rig.advance(2000 - 20)
    assert rig.player.started == []  # the song waits for the whole 3 s
    rig.advance(20)
    assert rig.player.started == ["solo"]
    assert rig.director.state == "playing"

    assert rig.states() == [("launching", None), ("intro", 3), ("intro", 2), ("intro", 1), ("playing", None)]
    assert [rig.at("intro", s) - decided for s in (2, 1)] == [1000, 2000]
    assert rig.at("playing") - decided == 3000
    assert [e.poles.L.pct for _, e in rig.events if e.state == "intro"] == [100, 66, 33]
    assert rig.events[-1][1].song.id == 1


def test_duet_launch_from_two_near_simultaneous_presses():
    rig = Rig()
    rig.press("start", "L", ago=0)
    rig.advance(100)
    rig.press("start", "R", ago=100)  # first press was 100 ms ago, i.e. together with the left
    rig.advance(500)
    assert (rig.director.state, rig.director.game) == ("intro", "duet")
    rig.advance(3000)
    assert rig.player.started == ["duet"]


def test_first_press_ago_decides_togetherness_not_arrival():
    rig = Rig()
    rig.advance(900)
    rig.press("claps", "L", ago=800)     # first press at t=100
    rig.advance(450)
    rig.press("claps", "R", ago=1000)    # arrives 450 ms later (> syncWindowMs) but first pressed at t=350
    rig.advance(500)
    assert rig.director.game == "showoff"


@pytest.mark.parametrize("action,game", [("claps", "showoff"), ("special", "thunder")])
def test_showoff_and_thunder_launch_and_play(action, game):
    rig = Rig()
    rig.press(action, "L")
    rig.press(action, "R", ago=50)
    rig.advance(500 + 3000)
    assert rig.player.started == [game]


def test_late_opposite_press_is_ignored_and_the_left_goes_solo():
    rig = Rig()
    rig.press("start", "L")
    rig.advance(450)
    assert rig.press("start", "R", ago=0)["status"] == "ignored"
    rig.advance(500)
    assert rig.director.game == "solo"


def test_mismatched_counts_blink_fade_and_return_to_idle():
    rig = Rig()
    rig.press("claps", "L")
    rig.press("special", "R")
    rig.advance(500)
    assert rig.director.state == "failing"
    rig.advance(4 * 250 + 500 + STEP)
    lit = [(e.poles.L.pct, e.poles.R.pct) for _, e in rig.events if e.state == "failing"]
    assert lit == [(100, 0), (0, 100), (100, 0), (0, 100), (0, 100)]
    fade = [e for _, e in rig.events if e.state == "failing"][-1]
    assert fade.poles.R.mode == "drain" and fade.poles.R.ms == 500
    assert rig.events[-1][1].state == "idle" and rig.director.state == "idle"
    assert rig.player.started == []
    blink_times = [t for t, e in rig.events if e.state == "failing"]
    assert all(abs(b - blink_times[0] - n * 250) <= STEP for n, b in enumerate(blink_times))


def test_launch_pole_follows_the_tap_count():
    rig = Rig()
    rig.press("claps", "R")
    assert rig.events[-1][1].poles.R.pct == 66


def test_long_press_while_idle_only_turns_everything_off():
    rig = Rig()
    rig.press("stop", "L")
    assert rig.player.actions == ["stop"]
    assert rig.director.state == "idle" and rig.events == []


def test_long_press_while_launching_cancels_the_round():
    rig = Rig()
    rig.press("start", "L")
    rig.press("stop", "R")
    rig.advance(2000)
    assert rig.director.state == "idle" and rig.player.started == []
    assert rig.events[-1][1].state == "idle"


def test_presses_are_ignored_during_the_intro_but_stop_cancels_it():
    rig = Rig()
    rig.press("start", "L")
    rig.advance(1000)
    assert rig.director.state == "intro"
    assert rig.press("claps", "L")["status"] == "ignored"
    rig.press("stop", "L")
    rig.advance(5000)
    assert rig.director.state == "idle" and rig.player.started == []


def play_solo(rig):
    rig.press("start", "L")
    rig.advance(500 + 3000 + STEP)
    assert rig.director.state == "playing"


def test_in_song_gestures_use_todays_handlers_and_a_plain_tap_does_nothing():
    rig = Rig()
    play_solo(rig)
    for action in ("claps", "special", "skip"):
        assert rig.press(action, "R")["status"] == "ok"
    assert rig.press("start", "L")["status"] == "ignored"
    assert rig.player.actions == ["claps", "special", "skip"]


def test_stop_in_song_ends_the_show_and_returns_to_idle():
    rig = Rig()
    play_solo(rig)
    rig.press("stop", "L")
    assert rig.player.actions == ["stop"]
    assert rig.director.state == "idle" and rig.events[-1][1].state == "idle"


def test_song_end_returns_to_idle_once():
    rig = Rig()
    play_solo(rig)
    asyncio.run(rig.director.to_idle())
    asyncio.run(rig.director.to_idle())
    assert [e.state for _, e in rig.events].count("idle") == 1


def test_song_vanishing_under_the_director_is_noticed():
    rig = Rig()
    play_solo(rig)
    rig.player.loaded = False  # stopped from the web UI
    rig.advance(STEP)
    assert rig.director.state == "idle"



def test_stop_while_the_start_sequence_runs_leaves_no_music_playing():
    rig = Rig()
    real_start = rig.player.start_game

    async def start_then_stop(game):
        song_id = await real_start(game)
        await rig.director.on_press("stop", "L")  # long press during the main sequence's delays
        rig.player.loaded = True  # ...which then loads the song anyway
        return song_id

    rig.player.start_game = start_then_stop
    rig.press("start", "L")
    rig.advance(500 + 3000 + STEP)
    assert rig.director.state == "idle" and not rig.player.loaded
    assert rig.legacy == [] and kinds(rig, "song_start") == []

def test_empty_playlist_goes_back_to_idle():
    rig = Rig(song_id=None)
    rig.press("start", "L")
    rig.advance(500 + 3000 + STEP)
    assert rig.director.state == "idle" and rig.events[-1][1].state == "idle"


def test_a_new_launch_works_after_a_song():
    rig = Rig()
    play_solo(rig)
    asyncio.run(rig.director.to_idle())
    rig.press("start", "R")
    rig.advance(500)
    assert rig.director.game == "solo"
    assert rig.events[-1][1].poles.R.pct == 100


def test_intro_step_follows_the_tunable():
    tunables.set_override("introStepMs", 500)
    rig = Rig()
    rig.press("start", "L")
    rig.advance(500 + 1500 + STEP)
    assert rig.player.started == ["solo"]


def kinds(rig, kind):
    return [f for k, _, f in rig.log if k == kind]


def play_game(rig, action="claps", map_=None):
    rig.player.map = map_ or SongMap.load(FIXTURE)
    rig.press(action, "L")
    if action != "start":
        rig.press(action, "R", ago=50)
    rig.advance(500 + 3000 + STEP)
    assert rig.director.state == "playing"


def seek(rig, t):
    rig.player.t = t
    rig.advance(STEP)


def playing_events(rig):
    return [e for _, e in rig.events if e.state == "playing"]


def test_game_start_also_broadcasts_the_legacy_start_before_the_playing_event():
    rig = Rig()
    play_game(rig, "start")
    assert [(e.action, e.playlist_name) for _, e in rig.legacy] == [("start", "solo")]
    assert rig.legacy[0][0] <= next(t for t, e in rig.events if e.state == "playing")


def test_showoff_turns_go_l_r_l_with_both_between_and_at_the_end():
    rig = Rig()
    play_game(rig)
    for t in (60, 70, 100, 110, 130, 190, 200, 220, 260):
        seek(rig, t)
    assert [(e.song.section, e.turn) for e in playing_events(rig)] == [
        ("intro", "both"), ("instrumental", "both"), ("verse", "L"), ("instrumental", "both"), ("verse", "R"),
        ("chorus", "both"), ("chorus", "both"), ("verse", "L"), ("chorus", "both"), ("outro", "both")]
    colors = {e.turn: e.perimeter.color for e in playing_events(rig)}
    assert colors == {"both": "pink", "L": "lime", "R": "blue"}


def test_the_turn_event_lands_at_the_section_boundary():
    rig = Rig()
    play_game(rig)
    seek(rig, 66.0)
    before = len(playing_events(rig))
    seek(rig, 66.05)
    event = playing_events(rig)[-1]
    assert len(playing_events(rig)) == before + 1 and event.turn == "L" and event.song.t == 66.05
    seek(rig, 70)  # same section: no new event
    assert len(playing_events(rig)) == before + 1


def test_events_carry_the_section_for_every_game_but_the_turn_only_for_showoff():
    rig = Rig()
    play_game(rig, "start")
    seek(rig, 70)
    event = playing_events(rig)[-1]
    assert (event.song.section, event.song.section_index, event.turn, event.perimeter) == ("verse", 1, None, None)


def test_skip_is_allowed_before_the_middle_of_verse_two_and_ignored_after():
    rig = Rig()
    play_game(rig, "start")
    seek(rig, 115.0)
    assert rig.press("skip", "L")["status"] == "ok" and rig.player.actions == ["skip"]
    seek(rig, 116.0)
    res = rig.press("skip", "R")
    assert res == {"status": "ignored", "action": "skip", "reason": "after_cutoff", "show_state": "playing"}
    assert rig.player.actions == ["skip"]
    assert [(f["side"], f["kind"]) for f in kinds(rig, "press")] == [("L", "skip"), ("R", "ordinary")]


def test_skip_without_markers_uses_the_fallback_cutoff():
    rig = Rig()
    play_game(rig, "start", SongMap(None, [], []))
    seek(rig, tunables.get("skipFallbackMs") / 1000 - 1)
    assert rig.press("skip", "L")["status"] == "ok"
    seek(rig, tunables.get("skipFallbackMs") / 1000 + 1)
    assert rig.press("skip", "L")["status"] == "ignored"


def test_skip_starts_the_next_song_and_logs_the_old_one_ending():
    rig = Rig()
    play_game(rig, "start")
    seek(rig, 50)
    rig.press("skip", "L")
    assert rig.director.state == "playing"
    assert [(f["songId"], f["reason"], f["atMs"]) for f in kinds(rig, "song_end")] == [("1", "skip", 50000)]
    assert len(kinds(rig, "song_start")) == 2


def test_analytics_for_a_whole_game():
    rig = Rig()
    play_game(rig)
    seek(rig, 80)
    rig.press("claps", "L")
    rig.press("start", "R")
    rig.press("special", "R")
    rig.press("stop", "L")
    assert kinds(rig, "launch_attempt") == [{"countL": 2, "countR": 2, "gapMs": 50, "result": "showoff"}]
    assert kinds(rig, "song_start") == [{"songId": "1", "game": "showoff", "bpm": 103.4, "hasSections": True, "hasBeats": True}]
    assert [f["kind"] for f in kinds(rig, "press")] == ["applause", "ordinary", "ordinary", "stop"]
    end = kinds(rig, "song_end")
    assert len(end) == 1 and end[0]["reason"] == "stop" and end[0]["atMs"] == 80000 and end[0]["game"] == "showoff"
    assert kinds(rig, "fault") == []


def test_song_running_out_is_logged_as_finished():
    rig = Rig()
    play_game(rig, "start")
    seek(rig, 288)
    rig.player.loaded = False
    rig.advance(STEP)
    assert [f["reason"] for f in kinds(rig, "song_end")] == ["finished"]


def test_missing_markers_log_a_fault_and_the_game_still_plays():
    rig = Rig()
    play_game(rig, "claps", SongMap(None, [], []))
    assert kinds(rig, "fault") == [{"kind": "markers_missing", "detail": "song 1: no usable sections, using spec fallbacks"}]
    assert kinds(rig, "song_start")[0]["hasSections"] is False
    seek(rig, 30)
    assert [e.turn for e in playing_events(rig)] == ["L", "R"]  # fallbackTurnMs = 20 s
    assert all(e.song.section is None for e in playing_events(rig))


def play_song(rig, until):
    """Song time runs with the clock, tick by tick."""
    while rig.player.t < until:
        rig.player.t = round(rig.player.t + STEP / 1000, 3)
        rig.advance(STEP)


def thunder_events(rig):
    return [e for e in playing_events(rig) if e.thunder]


def play_thunder(side="L"):
    rig = Rig(rng=Pick(side))
    play_game(rig, "special")
    seek(rig, 120.0)
    return rig


def test_thunder_countdown_and_window_one_event_per_beat():
    rig = play_thunder("R")
    play_song(rig, 130)
    got = [(e.thunder.phase, e.thunder.beat, e.thunder.pole, e.poles.R.pct, e.poles.R.mode, e.poles.L.mode)
           for e in thunder_events(rig)]
    assert [g[:2] for g in got] == [("build", k) for k in range(-8, -4)] + [("rush", k) for k in range(-4, 0)] + [
        ("open", 0), ("window", 1), ("window", 2), ("window", 3)]
    assert [g[3] for g in got] == [12, 25, 38, 50, 62, 75, 88, 100, 100, 75, 50, 25]
    assert {g[2] for g in got} == {"R"} and {g[5] for g in got} == {"off"}
    assert [e.song.t for e in thunder_events(rig)][0] == pytest.approx(121.951, abs=0.021)
    assert playing_events(rig)[-1].thunder is None and playing_events(rig)[-1].poles.R.mode == "glow"  # rest after: the white glow
    assert kinds(rig, "window") == [{"songId": "1", "section": 5, "pole": "R", "outcome": "none", "pressOffsetMs": None,
                                     "windowBeats": 4, "bpm": 103.4}]


def test_thunder_tag_blacks_out_on_the_beat_and_puffs_smoke():
    rig = play_thunder("L")
    play_song(rig, 127.0)
    assert rig.press("start", "L", ago=400)["status"] == "ok"  # pressed at 126.6, in the grace
    assert rig.player.actions == []
    play_song(rig, 127.26)
    assert rig.player.actions == []  # waits for the beat after the arrival
    play_song(rig, 127.3)
    assert rig.player.actions == ["special"]
    tag = thunder_events(rig)[-1]
    assert (tag.thunder.phase, tag.thunder.beat, tag.poles.L.mode, tag.perimeter.look) == ("tag", 1, "off", "blackout")
    play_song(rig, 130)
    assert [e.thunder.phase for e in thunder_events(rig)][-2:] == ["tag", "new_look"]
    assert rig.player.actions == ["special"]
    assert [f["kind"] for f in kinds(rig, "press")] == ["tag"]
    assert [(f["outcome"], f["pressOffsetMs"]) for f in kinds(rig, "window")] == [("tag", -65)]


def test_thunder_early_press_falls_at_once_and_cancels_the_window():
    rig = play_thunder("L")
    play_song(rig, 123.0)
    rig.press("start", "L", ago=400)
    early = playing_events(rig)[-1]
    assert (early.thunder.phase, early.poles.L.mode, early.poles.L.pct, early.poles.L.ms, early.perimeter.look) == (
        "early", "drain", 25, 500, "halo")
    play_song(rig, 130)
    assert "open" not in [e.thunder.phase for e in thunder_events(rig)]
    assert [f["outcome"] for f in kinds(rig, "window")] == ["early"]
    assert [f["kind"] for f in kinds(rig, "press")] == ["early"]


def test_thunder_only_the_dark_pole_applauds_during_the_countdown():
    rig = play_thunder("L")
    play_song(rig, 123.0)
    assert rig.press("claps", "L")["reason"] == "active_pole"
    assert rig.press("claps", "R")["status"] == "ok"
    assert rig.player.actions == ["claps"]
    assert [f["kind"] for f in kinds(rig, "press")] == ["ordinary", "dark"]


def test_other_games_have_no_thunder():
    rig = Rig(rng=Pick("L"))
    play_game(rig, "start")
    seek(rig, 120.0)
    play_song(rig, 130)
    assert thunder_events(rig) == [] and kinds(rig, "window") == []


def test_a_song_changed_from_the_web_ui_reloads_the_song_map():
    rig = Rig()
    play_game(rig, "start")
    seek(rig, 50)
    rig.player.song_id, rig.player.map = 2, SongMap(None, [], [])
    seek(rig, 1.0)
    assert [(f["songId"], f["reason"]) for f in kinds(rig, "song_end")] == [("1", "skip")]
    assert [f["songId"] for f in kinds(rig, "song_start")] == ["1", "2"]
    assert playing_events(rig)[-1].song.id == 2 and playing_events(rig)[-1].song.section is None


def test_a_window_cut_short_by_stop_is_still_logged():
    rig = play_thunder("R")
    play_song(rig, 127.5)
    rig.press("stop", "L")
    assert [f["outcome"] for f in kinds(rig, "window")] == ["none"]


def test_thunder_tag_smoke_does_not_hold_up_the_show():
    """The special sequence waits between its steps; the blackout and the new look must not wait for it."""
    import time
    rig = play_thunder("L")
    play_song(rig, 127.0)
    rig.press("start", "L", ago=400)
    started = []

    async def slow(action):
        started.append(action)
        await asyncio.sleep(5)

    rig.player.run_action = slow
    t0 = time.monotonic()
    play_song(rig, 130)
    assert time.monotonic() - t0 < 4
    assert started == ["special"]
    assert [e.thunder.phase for e in thunder_events(rig)][-2:] == ["tag", "new_look"]


@pytest.mark.parametrize("t, flood, spot", [
    (70.0, False, True),    # verse 1
    (128.0, True, False),   # chorus 1
    (136.0, False, False),  # instrumental
    (250.0, False, False),  # outro
])
def test_section_scene_floodlights_in_choruses_spotlights_in_verses(t, flood, spot):
    rig = Rig()
    play_game(rig, "claps")  # duet
    seek(rig, t)
    assert rig.player.devices == {"floodLights (x2)": flood, "spotlights": spot, "smoke": False}


def test_scene_matches_names_by_prefix_case_insensitively():
    assert scene_for("chorus", ["FloodLights (x2)", "spotlights", "bubbles"]) == {"FloodLights (x2)": True, "spotlights": False}
    assert scene_for(None, ["floodLights (x2)"]) == {"floodLights (x2)": False}


@pytest.mark.parametrize("action, taps, game", [
    ("claps", 2, "showoff"),
    ("special", 3, "thunder"),
    ("skip", 4, "fail"),     # over matchMaxCount
    ("special", 5, "fail"),  # the action name alone ("special" = 3) would launch thunder
])
def test_launch_counts_the_real_taps_when_the_press_says_them(action, taps, game):
    rig = Rig()
    rig.press(action, "L", taps=taps)
    rig.press(action, "R", ago=50, taps=taps)
    rig.advance(500 + STEP)
    (attempt,) = [f for kind, _, f in rig.log if kind == "launch_attempt"]
    assert (attempt["countL"], attempt["countR"], attempt["result"]) == (taps, taps, game)


def test_solo_glows_both_poles_pink_and_showoff_follows_the_turns():
    rig = Rig()
    rig.press("start", "R")
    rig.advance(500 + 3000 + STEP)
    p = playing_events(rig)[-1].poles
    assert (p.L.mode, p.L.color, p.R.mode, p.R.color) == ("glow", "pink", "glow", "pink")

    rig = Rig()
    play_game(rig)
    for t in (70, 100, 110):  # verse 1 (L), instrumental, verse 2 (R)
        seek(rig, t)
    assert [(e.poles.L.color, e.poles.R.color) for e in playing_events(rig)][-3:] == [
        ("lime", None), ("pink", "pink"), (None, "blue")]


@pytest.mark.parametrize("taps", [1, 2, 3])
def test_solo_from_left_or_right_gives_the_same_show(taps):
    """Solo is symmetric: only the launch fill (button feedback on the presser's own pole) and the
    logged side differ; the intro, the song and every show event after it are identical."""
    def run(side):
        rig = Rig()
        rig.player.map = SongMap.load(FIXTURE)
        rig.press("start", side, taps=taps)
        rig.advance(500 + 3000 + STEP)
        for t in (70, 100, 110, 130, 260):
            seek(rig, t)
        shown = [e.model_dump(exclude={"timestamp"}) for _, e in rig.events if e.state != "launching"]
        legacy = [e.model_dump(exclude={"timestamp"}) for _, e in rig.legacy]
        return rig.director.game, shown, legacy

    left, right = run("L"), run("R")
    assert left[0] == "solo" and left == right


def test_duet_poles_follow_the_singer_and_end_with_both():
    rig = Rig()
    rig.player.map = SongMap.load(FIXTURE)
    rig.press("start", "L")
    rig.press("start", "R", ago=50)
    rig.advance(500 + 3000 + STEP)
    assert rig.director.game == "duet"
    for t in (70, 100, 110, 130, 260):  # verse 1, instrumental, verse 2, chorus, outro
        seek(rig, t)
    assert [(e.poles.L.color, e.poles.R.color) for e in playing_events(rig)][-5:] == [
        ("lime", None), ("pink", "pink"), (None, "blue"), ("pink", "pink"), ("pink", "pink")]
    assert all(e.turn is None for e in playing_events(rig))  # the perimeter stays the duet's


@pytest.mark.parametrize("game, action", [("duet", "start"), ("showoff", "claps")])
def test_a_change_of_singer_pulses_both_buttons_then_shows_the_new_colours(game, action):
    rig = Rig()
    rig.player.map = SongMap.load(FIXTURE)
    rig.press(action, "L")
    rig.press(action, "R", ago=50)
    rig.advance(500 + 3000 + STEP)
    assert rig.director.game == game
    first = playing_events(rig)[0].buttons
    assert (first.L, first.R, first.pulses) == ("pink", "pink", 0)  # song start: no handover
    for t in (70, 100, 110):  # verse 1 (L), instrumental (both), verse 2 (R)
        seek(rig, t)
    got = [(e.buttons.L, e.buttons.R, e.buttons.pulses, e.buttons.pulse_ms) for e in playing_events(rig)[-3:]]
    assert got == [("lime", None, 3, 1000), ("pink", "pink", 3, 1000), (None, "blue", 3, 1000)]


def test_no_handover_pulse_without_a_change_of_singer():
    rig = Rig()
    play_game(rig, "start")  # solo: everyone sings, always
    for t in (70, 100, 110):
        seek(rig, t)
    assert {(e.buttons.L, e.buttons.R, e.buttons.pulses) for e in playing_events(rig)} == {("pink", "pink", 0)}


def test_thunder_poles_follow_the_singer_until_a_tag_then_the_tagger():
    rig = play_thunder("L")
    assert (playing_events(rig)[-1].poles.L.color, playing_events(rig)[-1].poles.R.color) == (None, "blue")  # verse 2
    play_song(rig, 127.0)
    rig.press("start", "L", ago=400)
    play_song(rig, 135)
    last = playing_events(rig)[-1]
    assert last.thunder is None and (last.poles.L.color, last.poles.L.mode, last.poles.R.mode) == ("lime", "glow", "off")


def cues(rig):
    return [(e.cue, e.side, e.reason) for _, e in rig.legacy if e.action == "cue"]


def test_claps_announce_a_cue_before_the_sequence_runs():
    rig = Rig()
    play_solo(rig)
    rig.press("claps", "R")
    rig.press("special", "R")
    assert cues(rig) == [("claps", "R", "claps")]  # special has no cue


def test_thunder_dark_pole_applause_is_a_claps_cue_the_active_pole_none():
    rig = play_thunder("L")
    play_song(rig, 122.5)
    rig.press("claps", "L")
    rig.press("claps", "R")
    assert cues(rig) == [("claps", "R", "applause")]
