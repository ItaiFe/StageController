import json

import pytest

from app.features.show import analytics, tunables


@pytest.fixture(autouse=True)
def log_file(tmp_path, monkeypatch):
    monkeypatch.setattr(analytics, "PATH", tmp_path / "show-events.jsonl")


def test_every_spec_event_type_can_be_appended():
    for kind in tunables.SPEC["analytics"]["events"]:
        analytics.append(kind["type"])
    assert [l["type"] for l in analytics.tail(50)] == [e["type"] for e in tunables.SPEC["analytics"]["events"]]


def test_lines_are_json_with_iso_time_and_monotonic_ms():
    line = analytics.append("night_note", 1234, text="hello")
    raw = json.loads(analytics.PATH.read_text())
    assert raw == line and raw["mono"] == 1234 and raw["text"] == "hello" and "T" in raw["t"]


def test_the_log_only_grows():
    analytics.append("night_note", text="a")
    analytics.append("night_note", text="b")
    assert [l["text"] for l in analytics.tail()] == ["a", "b"]
    assert [l["text"] for l in analytics.tail(1)] == ["b"]


def test_a_field_may_be_called_kind():
    assert analytics.append("fault", kind="markers_missing", detail="x")["kind"] == "markers_missing"


def test_unknown_types_are_rejected_and_a_missing_file_is_an_empty_tail():
    assert analytics.tail() == []
    with pytest.raises(ValueError):
        analytics.append("made_up")


def test_note_and_log_endpoints():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.features.show.router import router

    app = FastAPI()
    app.include_router(router, prefix="/api")
    client = TestClient(app)
    assert client.post("/api/show/note", json={"text": "smoke machine empty"}).json()["type"] == "night_note"
    assert client.post("/api/show/note", json={"text": ""}).status_code == 422
    assert [l["text"] for l in client.get("/api/show/log").json()] == ["smoke machine empty"]
