"""Tests for bunking.satisfaction.aggregate.camper_satisfaction."""

from __future__ import annotations

from bunking.satisfaction.aggregate import camper_satisfaction
from bunking.satisfaction.bucket import RequestBucket


def _req(
    request_id: str,
    request_type: str,
    requester_id: int,
    requestee_id: int | None,
    source_field: str,
    *,
    requester_grade: int | None = None,
    age_preference_target: str | None = None,
) -> dict:
    return {
        "id": request_id,
        "request_type": request_type,
        "requester_id": requester_id,
        "requestee_id": requestee_id,
        "source_field": source_field,
        "requester_grade": requester_grade,
        "age_preference_target": age_preference_target,
    }


class TestEmptyRequests:
    def test_no_requests_returns_zero_aggregate(self) -> None:
        result = camper_satisfaction(person_cm_id=1, person_requests=[], person_to_bunk={1: 100})
        assert result.person_cm_id == 1
        assert result.per_request == []
        assert result.counted_totals[RequestBucket.MATERIAL_PARENT].total == 0
        assert result.counted_totals[RequestBucket.STAFF].total == 0
        assert result.immaterial.total == 0
        assert not result.flags.has_any_counted_request
        assert not result.flags.parent_min_one_violation
        assert not result.flags.staff_unsatisfied_alert


class TestSingleSatisfiedMaterialParent:
    def test_counts_satisfied(self) -> None:
        req = _req("r1", "bunk_with", 1, 2, "bunk_with")
        result = camper_satisfaction(person_cm_id=1, person_requests=[req], person_to_bunk={1: 100, 2: 100})
        mp = result.counted_totals[RequestBucket.MATERIAL_PARENT]
        assert mp.satisfied == 1
        assert mp.total == 1
        assert result.flags.has_any_counted_request
        assert not result.flags.parent_min_one_violation


class TestParentMinOneViolation:
    def test_one_unsatisfied_material_parent_triggers(self) -> None:
        req = _req("r1", "bunk_with", 1, 2, "bunk_with")
        result = camper_satisfaction(person_cm_id=1, person_requests=[req], person_to_bunk={1: 100, 2: 101})
        assert result.flags.parent_min_one_violation

    def test_one_satisfied_one_unsatisfied_does_not_trigger(self) -> None:
        # Per spec: violation requires ≥1 material_parent request AND zero satisfied.
        # ≥1 satisfied ⇒ no violation.
        req1 = _req("r1", "bunk_with", 1, 2, "bunk_with")
        req2 = _req("r2", "bunk_with", 1, 3, "bunk_with")
        result = camper_satisfaction(
            person_cm_id=1,
            person_requests=[req1, req2],
            person_to_bunk={1: 100, 2: 100, 3: 101},
        )
        assert not result.flags.parent_min_one_violation


class TestImmaterialUncounted:
    def test_immaterial_visible_excluded_from_totals(self) -> None:
        req = _req("r1", "bunk_with", 1, 2, "socialize_with")
        result = camper_satisfaction(person_cm_id=1, person_requests=[req], person_to_bunk={1: 100, 2: 100})
        # Immaterial entry is satisfied + visible
        assert result.immaterial.satisfied == 1
        assert result.immaterial.total == 1
        assert len(result.per_request) == 1
        assert result.per_request[0].bucket is RequestBucket.IMMATERIAL_PARENT
        # But NOT counted toward totals
        assert result.counted_totals[RequestBucket.MATERIAL_PARENT].total == 0
        assert result.counted_totals[RequestBucket.STAFF].total == 0
        # And not flag-relevant — no counted requests means no violation/alert
        assert not result.flags.has_any_counted_request
        assert not result.flags.parent_min_one_violation


class TestStaffUnsatisfiedAlert:
    def test_unsatisfied_staff_request_triggers(self) -> None:
        req = _req("r1", "not_bunk_with", 1, 2, "not_bunk_with")
        result = camper_satisfaction(person_cm_id=1, person_requests=[req], person_to_bunk={1: 100, 2: 100})
        assert result.flags.staff_unsatisfied_alert

    def test_satisfied_staff_does_not_alert(self) -> None:
        req = _req("r1", "not_bunk_with", 1, 2, "not_bunk_with")
        result = camper_satisfaction(person_cm_id=1, person_requests=[req], person_to_bunk={1: 100, 2: 101})
        assert not result.flags.staff_unsatisfied_alert
