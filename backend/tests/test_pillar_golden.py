"""Golden vector shared with StagePillar (docs/pillar-led-contract.md §5).

StagePillar copies tests/fixtures/pillar_golden.bin and parses it natively; if this test
fails, the wire format changed — update the contract and tell the ESP side.
"""
import json
import struct
import zlib
from pathlib import Path

from app.features.pillar.compiler import compile_sequence
from app.features.pillar.schemas import Sequence

FIXTURES = Path(__file__).parent / "fixtures"
GOLDEN_VERSION = 42


def golden_bytes() -> bytes:
    return (FIXTURES / "pillar_golden.bin").read_bytes()


def test_compiler_reproduces_golden_binary():
    seq = Sequence.model_validate(json.loads((FIXTURES / "pillar_golden.json").read_text()))
    assert compile_sequence(seq, GOLDEN_VERSION) == golden_bytes()


def test_golden_binary_decodes_to_expected_values():
    data = golden_bytes()
    magic, version, loop, count, reserved, crc = struct.unpack_from("<4sIBBHI", data, 0)
    assert (magic, version, loop, count, reserved) == (b"PLP1", 42, 1, 7, 0)
    assert crc == zlib.crc32(data[16:])
    assert len(data) == 16 + 3 * 16 + 4 * 703

    # Effect steps: comet bounce 1.5x, band down 0.25x at brightness 200, rainbow 4x
    assert data[16:32] == bytes([1, 3]) + struct.pack("<H", 2100) + bytes([255, 2, 24, 0xFF, 0, 0xC0, 0, 0xE5, 0xFF, 0xFF, 0xB0, 0])
    assert data[32:48] == bytes([1, 7]) + struct.pack("<H", 500) + bytes([200, 1, 4, 0, 0xFF, 0xFF]) + bytes(6)
    assert data[48:52] == bytes([1, 2]) + struct.pack("<H", 20480)

    def pixel(frame_index: int, i: int):
        base = 64 + frame_index * 703
        assert data[base] == 2
        return struct.unpack_from("<BBBHH", data, base + 3 + i * 7)

    assert pixel(0, 0) == (0, 255, 0, 0, 0)            # cut, gradient start
    assert pixel(1, 10) == (128, 64, 32, 400, 0)       # crossfade, brightness 128 baked in
    assert pixel(2, 0) == (0, 0, 255, 40, 0)           # wipe up: bottom first
    assert pixel(2, 99) == (0, 0, 255, 4, 396)         # wipe trimmed to fit the 400 ms step
    assert pixel(3, 50) == (205, 205, 205, 250, 200)   # custom: brightness 205, fade 250, delay 200
