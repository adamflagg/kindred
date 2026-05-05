"""Truth-table tests for bunking.satisfaction.predicate.is_request_satisfied."""

from __future__ import annotations

import pytest

from bunking.satisfaction.predicate import is_request_satisfied


def _req(
    request_type: str,
    requester_id: int,
    requestee_id: int | None = None,
    *,
    age_preference_target: str | None = None,
    source_field: str = "bunk_with",
    requester_grade: int | None = None,
) -> dict:
    return {
        "requester_id": requester_id,
        "requestee_id": requestee_id,
        "request_type": request_type,
        "age_preference_target": age_preference_target,
        "source_field": source_field,
        "requester_grade": requester_grade,
    }


class TestBunkWith:
    def test_unassigned_requester_is_not_satisfied(self) -> None:
        assert not is_request_satisfied(_req("bunk_with", 1, 2), person_to_bunk={2: 100})

    def test_unassigned_requestee_is_not_satisfied(self) -> None:
        assert not is_request_satisfied(_req("bunk_with", 1, 2), person_to_bunk={1: 100})

    def test_same_bunk_is_satisfied(self) -> None:
        assert is_request_satisfied(_req("bunk_with", 1, 2), person_to_bunk={1: 100, 2: 100})

    def test_different_bunk_is_not_satisfied(self) -> None:
        assert not is_request_satisfied(_req("bunk_with", 1, 2), person_to_bunk={1: 100, 2: 101})


class TestNotBunkWith:
    def test_unassigned_requester_is_not_satisfied(self) -> None:
        assert not is_request_satisfied(_req("not_bunk_with", 1, 2), person_to_bunk={2: 100})

    def test_unassigned_requestee_is_satisfied(self) -> None:
        # Requestee absent = no risk of conflict = satisfied
        assert is_request_satisfied(_req("not_bunk_with", 1, 2), person_to_bunk={1: 100})

    def test_same_bunk_is_violation(self) -> None:
        assert not is_request_satisfied(_req("not_bunk_with", 1, 2), person_to_bunk={1: 100, 2: 100})

    def test_different_bunk_is_satisfied(self) -> None:
        assert is_request_satisfied(_req("not_bunk_with", 1, 2), person_to_bunk={1: 100, 2: 101})


class TestAgePreference:
    def test_unassigned_requester_is_not_satisfied(self) -> None:
        assert not is_request_satisfied(
            _req("age_preference", 1, age_preference_target="older", requester_grade=10),
            person_to_bunk={},
            bunkmate_grades={1: [11, 12]},
        )

    def test_missing_bunkmate_grades_raises(self) -> None:
        with pytest.raises(ValueError, match="bunkmate_grades"):
            is_request_satisfied(
                _req("age_preference", 1, age_preference_target="older", requester_grade=10),
                person_to_bunk={1: 100},
                bunkmate_grades=None,
            )


class TestUnknownRequestType:
    def test_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="unknown request_type"):
            is_request_satisfied(_req("nonsense", 1, 2), person_to_bunk={1: 100, 2: 100})
