"""Contract test: Python unit-mapping matches the shared JSON fixture.

The fixture at tests/fixtures/unit_mapping_cases.json is the canonical reference
shared with the TypeScript implementation. If anyone changes either impl
without updating both + the fixture, this test (or its TS sibling at
frontend/src/utils/unitMapping.contract.test.ts) will fail in CI.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from bunking.utils.units import UNIT_NAMES, get_unit_for_bunk, unit_to_slug

FIXTURE_PATH = Path(__file__).parents[3] / "fixtures" / "unit_mapping_cases.json"


def _load_fixture() -> dict[str, Any]:
    with FIXTURE_PATH.open() as f:
        result: dict[str, Any] = json.load(f)
        return result


_FIXTURE = _load_fixture()


@pytest.mark.parametrize("case", _FIXTURE["cases"], ids=[c["bunk"] or "<empty>" for c in _FIXTURE["cases"]])
def test_python_matches_fixture(case: dict[str, Any]) -> None:
    assert get_unit_for_bunk(case["bunk"]) == case["unit"]


def test_unit_names_match_fixture() -> None:
    assert list(UNIT_NAMES) == _FIXTURE["unit_names"]


@pytest.mark.parametrize(("unit", "expected_slug"), list(_FIXTURE["unit_slugs"].items()))
def test_unit_slugs_match_fixture(unit: str, expected_slug: str) -> None:
    assert unit_to_slug(unit) == expected_slug
