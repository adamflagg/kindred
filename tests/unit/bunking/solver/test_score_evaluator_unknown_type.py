"""Regression: unknown request_type must not abort the entire scenario score."""

import logging
from typing import ClassVar

import pytest

from bunking.config import ConfigLoader
from bunking.solver.score_evaluator import evaluate_scenario_score


class _MinimalConfig:
    """Stub that provides everything score_evaluator reads.

    These tests previously called ``evaluate_scenario_score`` without a
    ``config=`` parameter, relying on ``ConfigLoader.get_instance()``. After the
    B1/B2/B4 centralization, the four canonical penalty keys must also be
    available via the global loader, so install this stub via
    ``ConfigLoader.use(...)`` for the duration of each test.
    """

    _values: ClassVar[dict[str, int | float]] = {
        "objective.enable_diminishing_returns": 1,
        "objective.first_request_multiplier": 10,
        "objective.second_request_multiplier": 5,
        "objective.third_plus_request_multiplier": 1,
        "objective.source_multipliers.share_bunk_with": 1.5,
        "objective.source_multipliers.do_not_share_with": 1.5,
        "objective.source_multipliers.bunking_notes": 1.2,
        "objective.source_multipliers.internal_notes": 1.0,
        "objective.source_multipliers.socialize_preference": 0.8,
        "constraint.grade_spread.penalty": 100,
        "constraint.grade_spread.max_spread": 2,
        "constraint.cabin_capacity.penalty": 500,
        "constraint.cabin_capacity.standard": 12,
        "constraint.cabin_minimum_occupancy.min": 8,
        "constraint.cabin_minimum_occupancy.penalty": 50,
    }

    def get_int(self, key: str, default: int | None = None) -> int:
        v = self._values.get(key)
        return int(v) if v is not None else (default if default is not None else 0)

    def get_float(self, key: str, default: float | None = None) -> float:
        v = self._values.get(key)
        return float(v) if v is not None else (default if default is not None else 0.0)


@pytest.fixture(autouse=True)
def _install_minimal_loader():
    with ConfigLoader.use(_MinimalConfig()):  # type: ignore[arg-type]
        yield


def test_unknown_request_type_treated_as_unsatisfied(caplog):
    requests = [
        {
            "id": "r1",
            "request_type": "bunk_with",
            "source_field": "bunk_with",
            "requester_id": 1,
            "requestee_id": 2,
            "priority": 5,
        },
        {
            "id": "r2",
            "request_type": "future_unknown_type",
            "source_field": "bunk_with",
            "requester_id": 1,
            "requestee_id": 3,
            "priority": 5,
        },
    ]
    # person 1 and 2 share bunk 10; person 3 is in bunk 11
    assignments = [
        {"person_cm_id": 1, "bunk_cm_id": 10},
        {"person_cm_id": 2, "bunk_cm_id": 10},
        {"person_cm_id": 3, "bunk_cm_id": 11},
    ]
    persons = [
        {"cm_id": 1, "grade": 5, "gender": "M"},
        {"cm_id": 2, "grade": 5, "gender": "M"},
        {"cm_id": 3, "grade": 5, "gender": "M"},
    ]
    bunks = [
        {"cm_id": 10, "name": "Bunk A", "gender": "M", "max_size": 12},
        {"cm_id": 11, "name": "Bunk B", "gender": "M", "max_size": 12},
    ]

    with caplog.at_level(logging.WARNING, logger="bunking.solver.score_evaluator"):
        breakdown = evaluate_scenario_score(requests, assignments, persons, bunks)

    # r1 should be satisfied (1+2 in same bunk), r2 should be treated as unsatisfied (caught)
    assert breakdown.satisfied_requests == 1
    assert any("unknown request_type" in r.message.lower() for r in caplog.records)


def test_age_preference_with_explicit_none_requester_grade_uses_persons_fallback():
    """Finding #3: PB rows can carry requester_grade=None explicitly. The
    backfill in score_evaluator only fired when the key was absent, so
    explicit-None rows were treated as unsatisfied even when the requester's
    grade is available in `persons`. Fix: backfill when key is absent OR None.
    """
    requests = [
        {
            "id": "r_age",
            "request_type": "age_preference",
            "source_field": "socialize_with",
            "requester_id": 1,
            "requestee_id": 0,
            "age_preference_target": "older",
            "requester_grade": None,  # explicit None — present but unfilled
            "priority": 5,
        }
    ]
    # Requester (1) is grade 5; bunkmate (2) is grade 8 → "older" target satisfied.
    assignments = [
        {"person_cm_id": 1, "bunk_cm_id": 10},
        {"person_cm_id": 2, "bunk_cm_id": 10},
    ]
    persons = [
        {"cm_id": 1, "grade": 5, "gender": "M"},
        {"cm_id": 2, "grade": 8, "gender": "M"},
    ]
    bunks = [{"cm_id": 10, "name": "Bunk A", "gender": "M", "max_size": 12}]

    breakdown = evaluate_scenario_score(requests, assignments, persons, bunks)

    # Without the fix: requester_grade=None → predicate returns False → 0 satisfied.
    # With the fix:    score_evaluator backfills 5 from persons → satisfied.
    assert breakdown.satisfied_requests == 1
