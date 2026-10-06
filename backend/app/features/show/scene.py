"""Appliances per song section (Tom's decision, docs/superpowers/specs/2026-10-03-emulator-target.md §2):
floodlights on in choruses, spotlights on in verses, both off in every other section."""

SECTION_SCENE: dict[str, list[str]] = {"chorus": ["floodLights"], "verse": ["spotlights"]}
_ALL = {a.lower() for names in SECTION_SCENE.values() for a in names}


def scene_for(section: str | None, device_names: list[str]) -> dict[str, bool]:
    """{device name: on?} for the devices the table knows, matched case-insensitively by prefix
    ("floodLights (x2)" is floodLights). Devices the table never names are left alone."""
    wanted = {a.lower() for a in SECTION_SCENE.get(section or "", [])}
    out = {}
    for name in device_names:
        match = next((a for a in _ALL if name.lower().startswith(a)), None)
        if match:
            out[name] = match in wanted
    return out
