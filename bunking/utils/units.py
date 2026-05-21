"""Unit mapping — server-side authority for bunk → unit resolution.

Mirrors `frontend/src/utils/unitMapping.ts`. The two implementations share a
JSON fixture (tests/fixtures/unit_mapping_cases.json) consumed by contract tests
in both languages so drift is caught in CI.
"""

import re

CABIN_NUMBER_TO_UNIT: dict[int, str] = {
    1: "Carmel",
    2: "Carmel",
    3: "Galil",
    4: "Galil",
    5: "Eilat",
    6: "Eilat",
    7: "Haifa",
    8: "Haifa",
    9: "Chalutzim 1",
    10: "Chalutzim 1",
    11: "Chalutzim 2",
    12: "Chalutzim 2",
}

SPECIAL_NAME_TO_UNIT: dict[str, str] = {
    "aleph": "Nitzanim",
    "bet": "Nitzanim",
    "b-aleph": "Nitzanim",
    "b-bet": "Nitzanim",
    "g-aleph": "Nitzanim",
    "g-bet": "Nitzanim",
}

UNIT_NAMES: tuple[str, ...] = (
    "Nitzanim",
    "Carmel",
    "Galil",
    "Eilat",
    "Haifa",
    "Chalutzim 1",
    "Chalutzim 2",
)

_BUNK_NUMBER_RE = re.compile(r"^(B|G|AG)-(\d+)[A-Za-z]?$", re.IGNORECASE)
_PREFIXED_NITZANIM_RE = re.compile(r"^(B|G)-(?:aleph|bet)$", re.IGNORECASE)


def get_unit_for_bunk(bunk_name: str | None) -> str | None:
    if not bunk_name:
        return None

    lower = bunk_name.strip().lower()
    if lower in SPECIAL_NAME_TO_UNIT:
        return SPECIAL_NAME_TO_UNIT[lower]

    match = _BUNK_NUMBER_RE.match(bunk_name)
    if match is None:
        return None

    cabin_number = int(match.group(2))
    return CABIN_NUMBER_TO_UNIT.get(cabin_number)


def get_unit_side_for_bunk(bunk_name: str | None) -> dict[str, str | None] | None:
    """Return {'unit': name, 'side': 'B'|'G'|None} or None.

    AG-prefixed bunks and unprefixed Aleph/Bet have side=None (float — no unit
    gravity). Useful for solver constraints that split each unit into halves.
    """
    if not bunk_name:
        return None

    lower = bunk_name.strip().lower()

    nitzanim_match = _PREFIXED_NITZANIM_RE.match(lower)
    if nitzanim_match is not None:
        side = nitzanim_match.group(1).upper()
        return {"unit": "Nitzanim", "side": side}

    if lower in {"aleph", "bet"}:
        return {"unit": "Nitzanim", "side": None}

    match = _BUNK_NUMBER_RE.match(bunk_name)
    if match is None:
        return None

    prefix = match.group(1).upper()
    cabin_number = int(match.group(2))
    unit = CABIN_NUMBER_TO_UNIT.get(cabin_number)
    if unit is None:
        return None

    if prefix == "AG":
        return {"unit": unit, "side": None}
    return {"unit": unit, "side": prefix}


def get_bunks_in_unit(unit_name: str, bunk_names: list[str]) -> list[str]:
    return [name for name in bunk_names if get_unit_for_bunk(name) == unit_name]


def unit_to_slug(unit_name: str) -> str:
    return unit_name.lower().replace(" ", "-")
