"""Parity test: Python evaluate_request matches the shared JSON fixture.

The fixture at bunking/satisfaction/test_fixtures/predicate_cases.json is the
single source of truth. The TS counterpart (satisfactionLookup.parity.test.ts)
loads the same file and asserts the same expectations.

For bunk_with and not_bunk_with cases, both `expected_satisfied` and
`expected_detail` are asserted. For age_preference cases, only
`expected_satisfied` is asserted — TS prefixes the detail with a bunk-grade
breakdown for drag-preview UX while Python returns the raw detail. This
divergence is intentional.

To add a case: append to predicate_cases.json. Both test suites pick it up.
To change predicate logic: update the fixture's expected_satisfied/detail,
then update both predicates to match.
"""

import json
from pathlib import Path
from typing import Any, cast

import pytest

from bunking.satisfaction.predicate import evaluate_request

_FIXTURE_PATH = (
    Path(__file__).resolve().parents[4] / "bunking" / "satisfaction" / "test_fixtures" / "predicate_cases.json"
)


def _load_fixture() -> list[dict[str, Any]]:
    with _FIXTURE_PATH.open() as f:
        return cast(list[dict[str, Any]], json.load(f))


@pytest.mark.parametrize("case", _load_fixture(), ids=lambda c: c["name"])
def test_predicate_matches_fixture(case: dict[str, Any]) -> None:
    person_to_bunk = {int(k): int(v) for k, v in case["person_to_bunk"].items()}
    bunkmate_grades_raw = case.get("bunkmate_grades")
    bunkmate_grades = (
        {int(k): list(v) for k, v in bunkmate_grades_raw.items()} if bunkmate_grades_raw is not None else None
    )

    satisfied, detail = evaluate_request(
        case["request"],
        person_to_bunk,
        bunkmate_grades=bunkmate_grades,
    )

    assert satisfied is case["expected_satisfied"], (
        f"satisfied mismatch for {case['name']!r}: got {satisfied}, expected {case['expected_satisfied']}"
    )
    if "expected_detail" in case:
        assert detail == case["expected_detail"], (
            f"detail mismatch for {case['name']!r}: got {detail!r}, expected {case['expected_detail']!r}"
        )
