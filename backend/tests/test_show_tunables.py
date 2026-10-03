import pytest

from app.features.show import tunables


@pytest.fixture(autouse=True)
def clean():
    tunables.clear_overrides()
    yield
    tunables.clear_overrides()


def test_defaults_come_from_the_spec():
    d = tunables.defaults()
    assert d["syncWindowMs"] == 400
    assert d["soloWaitMs"] == 500
    assert d["matchMaxCount"] == 3
    assert d["launchPcts"] == [33, 66, 100]
    assert tunables.get("introStepMs") == 1000


def test_override_wins_until_cleared():
    tunables.set_override("syncWindowMs", 250)
    assert tunables.get("syncWindowMs") == 250
    assert tunables.defaults()["syncWindowMs"] == 400
    tunables.clear_overrides()
    assert tunables.get("syncWindowMs") == 400


def test_unknown_tunable_rejected():
    with pytest.raises(KeyError):
        tunables.set_override("nope", 1)


def test_palette_is_ramp_middle_with_gain():
    assert tunables.palette("pink") == (255, 20, 147)
    assert tunables.palette("lime", 0.5) == (62, 128, 0)
    assert tunables.palette("white", 2.0) == (255, 255, 255)
