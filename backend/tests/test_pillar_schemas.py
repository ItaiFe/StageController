import pytest
from pydantic import ValidationError

from app.features.pillar.defaults import DEFAULT_SEQUENCES, SLOTS
from app.features.pillar.schemas import Sequence


def effect(**overrides) -> dict:
    return {"kind": "effect", "effect": "solid", "duration_ms": 1000, "colors": ["#FFFFFF"], **overrides}


def frame(transition: dict, duration_ms: int = 1000, pixels: int = 100, **pixel) -> dict:
    px = {"color": "#FFFFFF", **pixel}
    return {"kind": "frame", "duration_ms": duration_ms, "transition": transition, "pixels": [px] * pixels}


def errors_of(data: dict) -> str:
    with pytest.raises(ValidationError) as exc:
        Sequence.model_validate(data)
    return str(exc.value)


def test_valid_sequence_with_defaults_filled_in():
    s = Sequence.model_validate({"steps": [{"kind": "effect", "effect": "rainbow", "duration_ms": 500}]})
    step = s.steps[0]
    assert (s.loop, step.brightness, step.direction, step.speed, step.colors) == (False, 255, "up", 1.0, [])


@pytest.mark.parametrize("steps", [[], [effect()] * 65])
def test_step_count_limits(steps):
    errors_of({"steps": steps})


@pytest.mark.parametrize("duration", [49, 60001])
def test_duration_limits(duration):
    errors_of({"steps": [effect(duration_ms=duration)]})


@pytest.mark.parametrize("speed", [0.2, 4.1])
def test_speed_limits(speed):
    errors_of({"steps": [effect(speed=speed)]})


def test_unknown_effect_rejected():
    errors_of({"steps": [effect(effect="lasers")]})


def test_at_most_three_colours():
    errors_of({"steps": [effect(colors=["#000000"] * 4)]})


def test_bad_colour_rejected():
    errors_of({"steps": [effect(colors=["red"])]})


@pytest.mark.parametrize("count", [99, 101])
def test_frame_needs_exactly_100_pixels(count):
    errors_of({"steps": [frame({"type": "cut"}, pixels=count)]})


def test_custom_timing_longer_than_step_is_rejected_with_step_number():
    msg = errors_of({"steps": [effect(), frame({"type": "custom"}, duration_ms=800, fade_ms=500, delay_ms=400)]})
    assert "Step 2" in msg and "900" in msg and "800" in msg


def test_wipe_as_long_as_the_step_is_fine():
    # Baking trims the soft edge so the last pixel still fits (see compiler tests)
    Sequence.model_validate({"steps": [frame({"type": "wipe", "ms": 1000}, duration_ms=1000)]})


@pytest.mark.parametrize("kind", ["wipe", "crossfade"])
def test_transition_longer_than_step_is_rejected(kind):
    msg = errors_of({"steps": [frame({"type": kind, "ms": 1200}, duration_ms=1000)]})
    assert "Step 1" in msg


def test_crossfade_equal_to_duration_is_fine():
    Sequence.model_validate({"steps": [frame({"type": "crossfade", "ms": 1000}, duration_ms=1000)]})


def test_largest_allowed_sequence_validates():
    Sequence.model_validate({"steps": [frame({"type": "cut"})] * 64})


def test_defaults_cover_every_slot_and_validate():
    assert set(DEFAULT_SEQUENCES) == set(SLOTS) == {"idle", "start", "claps", "special", "skip", "stop"}
    for data in DEFAULT_SEQUENCES.values():
        Sequence.model_validate(data)
    assert DEFAULT_SEQUENCES["idle"]["loop"] and DEFAULT_SEQUENCES["start"]["loop"]
    assert DEFAULT_SEQUENCES["idle"]["steps"][0]["duration_ms"] == 20480
