import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.features.buttons import router as buttons
from app.features.show import service


class FakePlayer:
    def get_current_song_id(self):
        return None


@pytest.fixture
def client(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    monkeypatch.setattr(buttons, "music_player", FakePlayer())
    app = FastAPI()
    app.include_router(buttons.router, prefix="/api")
    app.dependency_overrides[get_db] = db
    return TestClient(app)


def test_press_without_side_takes_the_legacy_path(client, monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("director must not see a legacy press")

    monkeypatch.setattr(service.director, "on_press", boom)
    res = client.post("/api/buttons/press", json={"action": "claps"})
    assert res.json() == {"status": "ignored", "action": "claps", "reason": "show_stopped"}


def test_press_with_side_goes_to_the_director(client, monkeypatch):
    seen = []

    async def on_press(action, side, ago):
        seen.append((action, side, ago))
        return {"status": "ok"}

    monkeypatch.setattr(service.director, "on_press", on_press)
    res = client.post("/api/buttons/press", json={"action": "start", "side": "R", "first_press_ago_ms": 120})
    assert res.json() == {"status": "ok"} and seen == [("start", "R", 120)]


def test_bad_side_or_negative_age_is_rejected(client):
    assert client.post("/api/buttons/press", json={"action": "start", "side": "X"}).status_code == 422
    assert client.post("/api/buttons/press", json={"action": "start", "side": "L", "first_press_ago_ms": -1}).status_code == 422


def test_spec_endpoint_serves_the_stage_spec():
    from app.features.show.router import router as show_router

    app = FastAPI()
    app.include_router(show_router, prefix="/api")
    spec = TestClient(app).get("/api/show/spec").json()
    assert spec["palette"]["pink"]["ramp"][1] == [255, 20, 147]
    assert [g["id"] for g in spec["games"]] == ["solo", "duet", "showoff", "thunder"]
