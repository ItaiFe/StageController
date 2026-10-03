import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.features.show import analytics, tunables
from app.features.show.models import ShowTunable
from app.features.show.router import router
from app.features.show.service import load_tunables


@pytest.fixture
def api(tmp_path, monkeypatch):
    monkeypatch.setattr(analytics, "PATH", tmp_path / "show-events.jsonl")
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_db] = db
    tunables.clear_overrides()
    yield TestClient(app), Session
    tunables.clear_overrides()


def test_lists_every_tunable_with_default_unit_and_group(api):
    client, _ = api
    rows = {r["id"]: r for r in client.get("/api/show/tunables").json()}
    assert len(rows) == len(tunables.SPEC["tunables"])
    assert rows["syncWindowMs"]["value"] == rows["syncWindowMs"]["default"] == 400
    assert rows["syncWindowMs"]["unit"] == "ms" and rows["syncWindowMs"]["group"] and rows["syncWindowMs"]["he"]


def test_put_applies_persists_and_logs_the_change(api):
    client, Session = api
    assert client.put("/api/show/tunables/syncWindowMs", json={"value": 250}).json() == {"id": "syncWindowMs", "value": 250}
    assert tunables.get("syncWindowMs") == 250
    assert {r["id"]: r["value"] for r in client.get("/api/show/tunables").json()}["syncWindowMs"] == 250

    tunables.clear_overrides()  # a restart: the saved value comes back from the table
    load_tunables(Session())
    assert tunables.get("syncWindowMs") == 250

    assert [(l["type"], l["id"], l["from"], l["to"]) for l in analytics.tail()] == [("tunable_change", "syncWindowMs", 400, 250)]


def test_list_tunables_take_a_list_of_the_same_length(api):
    client, _ = api
    assert client.put("/api/show/tunables/launchPcts", json={"value": [10, 20, 30]}).status_code == 200
    assert tunables.get("launchPcts") == [10, 20, 30]
    assert client.put("/api/show/tunables/launchPcts", json={"value": [10, 20]}).status_code == 422


def test_unknown_ids_and_non_numbers_are_rejected_without_a_log_line(api):
    client, _ = api
    assert client.put("/api/show/tunables/nope", json={"value": 1}).status_code == 404
    assert client.put("/api/show/tunables/syncWindowMs", json={"value": "fast"}).status_code == 422
    assert client.put("/api/show/tunables/syncWindowMs", json={"value": True}).status_code == 422
    assert tunables.get("syncWindowMs") == 400 and analytics.tail() == []


def test_a_saved_override_for_a_tunable_the_spec_no_longer_has_is_ignored(api):
    _, Session = api
    db = Session()
    db.add(ShowTunable(id="gone", value=1))
    db.commit()
    load_tunables(db)
    assert "gone" not in tunables._overrides
