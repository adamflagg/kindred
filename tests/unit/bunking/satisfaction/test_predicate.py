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


class TestRequesterIdZero:
    def test_requester_id_zero_is_treated_as_id(self) -> None:
        """Regression: literal 0 must not fall through to the alternate field."""
        p2b = {0: 10, 2: 10}
        req = {"requester_id": 0, "requestee_id": 2, "request_type": "bunk_with"}
        # Should NOT raise; should evaluate as a real request with id=0
        result = is_request_satisfied(req, p2b)
        assert result is True  # 0 and 2 in same bunk

    def test_missing_requester_id_raises(self) -> None:
        """request missing both requester_id and requester_person_cm_id raises ValueError."""
        req = {"requestee_id": 2, "request_type": "bunk_with"}
        with pytest.raises(ValueError, match="request missing requester_id"):
            is_request_satisfied(req, {2: 100})

    def test_requester_person_cm_id_fallback(self) -> None:
        """Legacy field name requester_person_cm_id is accepted as fallback."""
        p2b = {5: 100, 6: 100}
        req = {"requester_person_cm_id": 5, "requestee_id": 6, "request_type": "bunk_with"}
        assert is_request_satisfied(req, p2b)


class TestGradeSanityBound:
    """requester_grade must be in range 0-12; out-of-range raises ValueError."""

    def test_grade_zero_is_valid(self) -> None:
        result = is_request_satisfied(
            _req("age_preference", 1, age_preference_target="older", requester_grade=0),
            person_to_bunk={1: 100},
            bunkmate_grades={1: [1, 2]},
        )
        assert isinstance(result, bool)

    def test_grade_twelve_is_valid(self) -> None:
        result = is_request_satisfied(
            _req("age_preference", 1, age_preference_target="older", requester_grade=12),
            person_to_bunk={1: 100},
            bunkmate_grades={1: [10, 11]},
        )
        assert isinstance(result, bool)

    def test_grade_thirteen_raises(self) -> None:
        with pytest.raises(ValueError, match="requester_grade 13 out of valid range"):
            is_request_satisfied(
                _req("age_preference", 1, age_preference_target="older", requester_grade=13),
                person_to_bunk={1: 100},
                bunkmate_grades={1: [10, 11]},
            )

    def test_grade_negative_one_raises(self) -> None:
        with pytest.raises(ValueError, match="requester_grade -1 out of valid range"):
            is_request_satisfied(
                _req("age_preference", 1, age_preference_target="older", requester_grade=-1),
                person_to_bunk={1: 100},
                bunkmate_grades={1: [10, 11]},
            )


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
