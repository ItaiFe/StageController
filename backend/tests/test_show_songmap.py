import json
from pathlib import Path

import pytest

from app.features.show import tunables
from app.features.show.songmap import SongMap

FIXTURE = Path(__file__).parent / "fixtures" / "its_only_love.analysis.json"


@pytest.fixture(autouse=True)
def clean():
    tunables.clear_overrides()
    yield
    tunables.clear_overrides()


@pytest.fixture
def song():
    return SongMap.load(FIXTURE)


def test_loads_tempo_beats_and_sections(song):
    assert song.bpm == 103.4 and song.beats[0] == 28.607
    assert len(song.sections) == 13 and song.has_markers


def test_skip_cutoff_is_the_middle_of_verse_two(song):
    assert song.skip_cutoff_s() == pytest.approx(115.72)


def test_showoff_turns_alternate_by_verse(song):
    assert [song.turn_owner(t) for t in (70, 110, 200)] == ["L", "R", "L"]


def test_everything_that_is_not_a_verse_is_both_and_so_is_the_last_section(song):
    # intro, instrumental, chorus, bridge, outro (the last section, however it is labelled)
    assert [song.turn_owner(t) for t in (10, 60, 95, 130, 150, 250, 289)] == ["both"] * 7


def test_the_last_section_is_both_even_when_it_is_a_verse():
    last_verse = SongMap(None, [], [{"start": 0, "end": 10, "label": "verse"}, {"start": 10, "end": 20, "label": "verse"},
                                    {"start": 20, "end": 30, "label": "verse"}])
    assert [last_verse.turn_owner(t) for t in (5, 15, 25)] == ["L", "R", "both"]


def test_section_at_gives_label_and_index(song):
    assert song.section_at(70) == ("verse", 1)
    assert song.section_at(95) == ("instrumental", 2)
    assert song.section_at(1000) == ("outro", 1)  # past the end: still the last section


def test_beat_lookups(song):
    assert song.beat_at(28.607) == 0 and song.beat_at(29.2) == 1 and song.beat_at(1) == -1
    assert song.beat_after(29.2) == 29.768 and song.beat_after(10_000) is None


def test_no_sidecar_falls_back_to_the_tunables(tmp_path):
    song = SongMap.load(tmp_path / "nothing.analysis.json")
    assert not song.has_markers and song.section_at(5) is None
    assert song.skip_cutoff_s() == tunables.get("skipFallbackMs") / 1000
    turn = tunables.get("fallbackTurnMs") / 1000
    assert [song.turn_owner(t, 200) for t in (1, turn + 1, 2 * turn + 1)] == ["L", "R", "L"]
    assert song.turn_owner(190, 200) == "both"  # the final turn belongs to both


def test_a_sidecar_without_sections_or_with_bad_json_is_the_same_as_none(tmp_path):
    bad = tmp_path / "bad.analysis.json"
    bad.write_text("{not json")
    assert not SongMap.load(bad).has_markers
    bad.write_text(json.dumps({"tempo": {"bpm": 120}}))
    assert not SongMap.load(bad).has_markers and SongMap.load(bad).bpm == 120


def test_one_verse_only_uses_the_fallback_cutoff(tmp_path):
    song = SongMap(None, [], [{"start": 0, "end": 10, "label": "verse"}])
    assert song.skip_cutoff_s() == tunables.get("skipFallbackMs") / 1000


def test_songmap_endpoint_gives_sections_with_turn_colours_and_the_cutoff(tmp_path):
    import shutil

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app.core.database import Base, get_db
    from app.features.show.router import router
    from app.features.songs.models import Song

    shutil.copy(FIXTURE, tmp_path / "x.analysis.json")
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    def song(i, name):
        return Song(id=i, title="x", duration=1.0, filename=name, file_path=str(tmp_path / name), file_size=1, format="m4a")

    db.add_all([song(1, "x.m4a"), song(2, "none.m4a")])
    db.commit()
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)

    body = client.get("/api/show/songmap/1").json()
    verses = [(s["start"], s["turn"], s["color"]) for s in body["sections"] if s["label"] == "verse"]
    assert verses == [(66.04, "L", "lime"), (104.77, "R", "blue"), (194.49, "L", "lime")]
    assert set(body["sections"][0]) == {"start", "end", "label", "index", "turn", "color", "singer", "singer_color"}
    assert [s["singer"] for s in body["sections"] if s["label"] == "verse"] == ["L", "R", "L"]  # untagged: the alternation
    assert [round(w["change_s"], 1) for w in body["thunder_windows"]] == [126.7, 143.0, 180.5, 215.5]
    assert body["sections"][-1]["turn"] == "both" and body["skip_cutoff_s"] == pytest.approx(115.72)
    empty = client.get("/api/show/songmap/2").json()
    assert empty["sections"] == [] and not empty["has_markers"] and empty["thunder_windows"] == []
    assert client.get("/api/show/songmap/9").status_code == 404


def test_a_sidecar_with_malformed_sections_is_the_same_as_none(tmp_path):
    bad = tmp_path / "bad.analysis.json"
    for sections in ([{"start": 0, "end": 5}], ["verse"]):
        bad.write_text(json.dumps({"sections": sections}))
        assert not SongMap.load(bad).has_markers


def test_singer_reads_a_hand_tagged_turn_and_falls_back_to_the_alternation():
    secs = [{"start": 0, "end": 10, "label": "verse", "turn": "R"}, {"start": 10, "end": 20, "label": "verse"},
            {"start": 20, "end": 30, "label": "chorus", "turn": "L"}, {"start": 30, "end": 40, "label": "outro", "turn": "R"}]
    m = SongMap(None, [], secs)
    assert [m.singer(t) for t in (5, 15, 25, 35)] == ["R", "R", "L", "both"]  # verse 2 alternates to R; the end is both
    assert [m.turn_owner(t) for t in (5, 15, 25, 35)] == ["L", "R", "both", "both"]  # showoff ignores the tags
