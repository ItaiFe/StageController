import asyncio

import pytest

from app.core import config
from app.features.devices import service


@pytest.fixture(autouse=True)
def emulated(monkeypatch):
    monkeypatch.setattr(config, "STAGE_IO", "emulated")
    service._emulated_power.clear()


def test_power_commands_are_remembered_in_memory():
    assert asyncio.run(service.get_device_state("10.0.0.1")) is False
    assert asyncio.run(service.set_device_state("10.0.0.1", True))
    assert asyncio.run(service.get_device_state("10.0.0.1")) is True
    assert asyncio.run(service.get_device_state("10.0.0.2")) is False
    assert asyncio.run(service.set_device_state("10.0.0.1", False))
    assert asyncio.run(service.get_device_state("10.0.0.1")) is False


def test_emulated_device_is_online():
    assert asyncio.run(service.check_device_online("10.0.0.1"))


def test_unemulated_still_goes_to_the_network(monkeypatch):
    monkeypatch.setattr(config, "STAGE_IO", "")
    monkeypatch.setattr(service, "TASMOTA_TIMEOUT", 0.05)
    assert asyncio.run(service.tasmota_command("127.0.0.1:1", "Status")) == {"error": "Device unreachable"}
