import struct
import zlib

import pytest

from app.features.pillar.compiler import (
    EFFECT_RECORD_SIZE,
    FRAME_RECORD_SIZE,
    HEADER_SIZE,
    bake_frame,
    compile_sequence,
)
from app.features.pillar.schemas import Sequence


def frame(transition: dict, pixel: dict | None = None, duration_ms: int = 1000) -> dict:
    px = {"color": "#FF8040", "brightness": 255, "fade_ms": 0, "delay_ms": 0, **(pixel or {})}
    return {"kind": "frame", "duration_ms": duration_ms, "transition": transition, "pixels": [px] * 100}


def seq(*steps: dict, loop: bool = False) -> Sequence:
    return Sequence.model_validate({"loop": loop, "steps": list(steps)})


def test_crc32_check_value():
    assert zlib.crc32(b"123456789") == 0xCBF43926


def test_header_layout_and_crc():
    data = compile_sequence(seq({"kind": "effect", "effect": "solid", "duration_ms": 500,
                                 "colors": ["#010203"]}, loop=True), version=7)
    magic, version, loop, count, reserved, crc = struct.unpack_from("<4sIBBHI", data, 0)
    assert (magic, version, loop, count, reserved) == (b"PLP1", 7, 1, 1, 0)
    assert crc == zlib.crc32(data[HEADER_SIZE:])
    assert len(data) == HEADER_SIZE + EFFECT_RECORD_SIZE


def test_effect_record_bytes():
    data = compile_sequence(seq({"kind": "effect", "effect": "comet", "duration_ms": 2100,
                                 "brightness": 200, "direction": "bounce", "speed": 1.5,
                                 "colors": ["#FF00C0", "#00E5FF"]}), version=1)
    rec = data[HEADER_SIZE:]
    assert rec == bytes([1, 3]) + struct.pack("<H", 2100) + bytes([200, 2, 24]) + bytes(
        [0xFF, 0x00, 0xC0, 0x00, 0xE5, 0xFF, 0, 0, 0])


@pytest.mark.parametrize("speed,x16", [(0.25, 4), (1.0, 16), (4.0, 64), (1.03, 16)])
def test_speed_encoding(speed, x16):
    data = compile_sequence(seq({"kind": "effect", "effect": "rainbow", "duration_ms": 1000,
                                 "speed": speed}), version=1)
    assert data[HEADER_SIZE + 6] == x16


def test_frame_record_size_and_layout():
    data = compile_sequence(seq(frame({"type": "cut"})), version=1)
    rec = data[HEADER_SIZE:]
    assert len(rec) == FRAME_RECORD_SIZE == 703
    assert rec[0] == 2
    assert struct.unpack_from("<H", rec, 1)[0] == 1000
    r, g, b, fade, delay = struct.unpack_from("<BBBHH", rec, 3)
    assert (r, g, b, fade, delay) == (0xFF, 0x80, 0x40, 0, 0)


def test_cut_bakes_zero_timing():
    assert {(p.fade_ms, p.delay_ms) for p in bake_frame(seq(frame({"type": "cut"})).steps[0])} == {(0, 0)}


def test_crossfade_bakes_same_fade_everywhere():
    baked = bake_frame(seq(frame({"type": "crossfade", "ms": 400})).steps[0])
    assert {(p.fade_ms, p.delay_ms) for p in baked} == {(400, 0)}


def test_wipe_up_staggers_delay_from_the_bottom():
    baked = bake_frame(seq(frame({"type": "wipe", "ms": 500, "direction": "up"})).steps[0])
    assert [p.delay_ms for p in baked[:3]] == [0, 5, 10]
    assert baked[99].delay_ms == 495
    assert {p.fade_ms for p in baked} == {50}  # min(150, 500 // 10)


def test_wipe_down_staggers_delay_from_the_top():
    baked = bake_frame(seq(frame({"type": "wipe", "ms": 500, "direction": "down"})).steps[0])
    assert baked[99].delay_ms == 0
    assert baked[0].delay_ms == 495


def test_wipe_soft_edge_is_capped_at_150():
    baked = bake_frame(seq(frame({"type": "wipe", "ms": 3000}, duration_ms=5000)).steps[0])
    assert {p.fade_ms for p in baked} == {150}


def test_wipe_as_long_as_step_trims_fade_to_fit():
    baked = bake_frame(seq(frame({"type": "wipe", "ms": 400}, duration_ms=400)).steps[0])
    assert baked[99].delay_ms == 396
    assert baked[99].fade_ms == 4  # min(40, 400 - 396)
    assert all(p.delay_ms + p.fade_ms <= 400 for p in baked)


def test_custom_uses_per_pixel_timing():
    baked = bake_frame(seq(frame({"type": "custom"}, {"fade_ms": 120, "delay_ms": 300})).steps[0])
    assert {(p.fade_ms, p.delay_ms) for p in baked} == {(120, 300)}


def test_non_custom_transition_ignores_per_pixel_timing():
    baked = bake_frame(seq(frame({"type": "cut"}, {"fade_ms": 120, "delay_ms": 300})).steps[0])
    assert {(p.fade_ms, p.delay_ms) for p in baked} == {(0, 0)}


def test_pixel_brightness_is_baked_into_colour():
    baked = bake_frame(seq(frame({"type": "cut"}, {"color": "#FF8040", "brightness": 128})).steps[0])
    assert (baked[0].r, baked[0].g, baked[0].b) == (128, 64, 32)


def test_mixed_sequence_size():
    data = compile_sequence(seq(
        {"kind": "effect", "effect": "rainbow", "duration_ms": 1000},
        frame({"type": "crossfade", "ms": 200}),
        frame({"type": "cut"}),
    ), version=3)
    assert len(data) == HEADER_SIZE + EFFECT_RECORD_SIZE + 2 * FRAME_RECORD_SIZE
    assert data[9] == 3
