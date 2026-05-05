"""Truth-table tests for bunking.satisfaction.predicate.is_request_satisfied."""

from __future__ import annotations

from typing import Any

import pytest

from bunking.satisfaction.predicate import is_request_satisfied


def _req(
    request_type: str,
    requester_id: int,
    requestee_id: int | None = None,
    *,
    age_preference_target: str | None = None,
    requester_grade: int | None = None,
) -> dict[str, Any]:
    return {
        "requester_id": requester_id,
        "requestee_id": requestee_id,
        "request_type": request_type,
        "age_preference_target": age_preference_target,
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

    def test_older_preference_satisfied_when_bunkmates_older(self) -> None:
        # Requester in 9th grade prefers older; bunkmates in 11th. Should be True.
        result = is_request_satisfied(
            _req("age_preference", 1, age_preference_target="older", requester_grade=9),
            person_to_bunk={1: 100},
            bunkmate_grades={1: [11, 12]},
        )
        assert result is True

    def test_older_preference_not_satisfied_when_bunkmates_younger(self) -> None:
        # Requester in 11th grade prefers older; bunkmates in 9th. Should be False.
        result = is_request_satisfied(
            _req("age_preference", 1, age_preference_target="older", requester_grade=11),
            person_to_bunk={1: 100},
            bunkmate_grades={1: [9, 10]},
        )
        assert result is False


class TestUnknownRequestType:
    def test_raises_value_error(self) -> None:
        with pytest.raises(ValueError, match="unknown request_type"):
            is_request_satisfied(_req("nonsense", 1, 2), person_to_bunk={1: 100, 2: 100})


@pytest.mark.parametrize("a_bunk,b_bunk", [(10, 10), (10, 11), (10, None)])
def test_bunk_with_and_not_bunk_with_are_inverses(a_bunk: int | None, b_bunk: int | None) -> None:
    p2b = {1: a_bunk} if a_bunk is not None else {}
    if b_bunk is not None:
        p2b[2] = b_bunk
    bunk_with = {
        "requester_id": 1,
        "requestee_id": 2,
        "request_type": "bunk_with",
        "source_field": "bunk_with",
    }
    not_bunk_with = {**bunk_with, "request_type": "not_bunk_with", "source_field": "not_bunk_with"}
    assert is_request_satisfied(bunk_with, p2b) == (not is_request_satisfied(not_bunk_with, p2b))
