"""Tests for bunking.satisfaction.aggregate.camper_satisfaction."""

from typing import Any

import pytest

from bunking.satisfaction.aggregate import _coerce_row, camper_satisfaction
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
) -> dict[str, Any]:
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
        req = _req("r1", "bunk_with", 1, 2, "bunk_request_form")
        result = camper_satisfaction(person_cm_id=1, person_requests=[req], person_to_bunk={1: 100, 2: 100})
        mp = result.counted_totals[RequestBucket.MATERIAL_PARENT]
        assert mp.satisfied == 1
        assert mp.total == 1
        assert result.flags.has_any_counted_request
        assert not result.flags.parent_min_one_violation


class TestParentMinOneViolation:
    def test_one_unsatisfied_material_parent_triggers(self) -> None:
        req = _req("r1", "bunk_with", 1, 2, "bunk_request_form")
        result = camper_satisfaction(person_cm_id=1, person_requests=[req], person_to_bunk={1: 100, 2: 101})
        assert result.flags.parent_min_one_violation

    def test_one_satisfied_one_unsatisfied_does_not_trigger(self) -> None:
        # Per spec: violation requires ≥1 material_parent request AND zero satisfied.
        # ≥1 satisfied ⇒ no violation.
        req1 = _req("r1", "bunk_with", 1, 2, "bunk_request_form")
        req2 = _req("r2", "bunk_with", 1, 3, "bunk_request_form")
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
        req = _req("r1", "not_bunk_with", 1, 2, "staff_not_bunk_with")
        result = camper_satisfaction(person_cm_id=1, person_requests=[req], person_to_bunk={1: 100, 2: 100})
        assert result.flags.staff_unsatisfied_alert

    def test_satisfied_staff_does_not_alert(self) -> None:
        req = _req("r1", "not_bunk_with", 1, 2, "staff_not_bunk_with")
        result = camper_satisfaction(person_cm_id=1, person_requests=[req], person_to_bunk={1: 100, 2: 101})
        assert not result.flags.staff_unsatisfied_alert


class TestMixedBuckets:
    def test_material_and_immaterial_both_present(self) -> None:
        # Camper has one material parent (bunk_with → bunk_with field, satisfied)
        # AND one immaterial parent (bunk_with type → socialize_with field, satisfied).
        material = _req("r1", "bunk_with", 1, 2, "bunk_request_form")
        immaterial = _req("r2", "bunk_with", 1, 3, "socialize_with")
        result = camper_satisfaction(
            person_cm_id=1,
            person_requests=[material, immaterial],
            person_to_bunk={1: 100, 2: 100, 3: 100},
        )
        # Material counted, immaterial separately tracked
        assert result.counted_totals[RequestBucket.MATERIAL_PARENT].total == 1
        assert result.counted_totals[RequestBucket.MATERIAL_PARENT].satisfied == 1
        assert result.immaterial.total == 1
        assert result.immaterial.satisfied == 1
        # Both visible in per_request, in input order
        assert len(result.per_request) == 2
        assert result.per_request[0].bucket is RequestBucket.MATERIAL_PARENT
        assert result.per_request[1].bucket is RequestBucket.IMMATERIAL_PARENT
        # has_any_counted_request True because material is counted
        assert result.flags.has_any_counted_request

    def test_material_unsatisfied_with_immaterial_satisfied_still_violates(self) -> None:
        # Even if a camper has a satisfied immaterial socialize_with,
        # an unsatisfied material parent_min_one_violation still triggers
        # — immaterial cannot rescue the parent-paramount metric.
        material = _req("r1", "bunk_with", 1, 2, "bunk_request_form")  # unsatisfied
        immaterial = _req("r2", "bunk_with", 1, 3, "socialize_with")  # satisfied
        result = camper_satisfaction(
            person_cm_id=1,
            person_requests=[material, immaterial],
            person_to_bunk={1: 100, 2: 101, 3: 100},
        )
        assert result.flags.parent_min_one_violation is True
        assert result.immaterial.satisfied == 1  # immaterial still tracked


class TestCoerceRowNoneSourceField:
    """Finding #2: str(None) → 'None' string defeats missing-source-field fallback.

    PB rows can return source_field=None explicitly (legacy rows). The default-
    arg shortcut `r.get("source_field", "")` only fires when the key is absent;
    if it's present-and-None, str(None) yields the literal string 'None' which
    `bucket.classify_request` then rejects as unknown.
    """

    def test_none_source_field_dict_coerces_to_empty_string(self) -> None:
        row = {
            "id": "r1",
            "requester_id": 1,
            "requestee_id": 2,
            "request_type": "bunk_with",
            "source_field": None,
        }
        coerced = _coerce_row(row)
        assert coerced["source_field"] == ""

    def test_none_source_field_object_coerces_to_empty_string(self) -> None:
        class Row:
            id = "r1"
            requester_id = 1
            requestee_id = 2
            request_type = "bunk_with"
            source_field = None

        coerced = _coerce_row(Row())
        assert coerced["source_field"] == ""

    def test_none_request_type_coerces_to_empty_string(self) -> None:
        row = {
            "id": "r1",
            "requester_id": 1,
            "requestee_id": 2,
            "request_type": None,
            "source_field": "bunk_request_form",
        }
        coerced = _coerce_row(row)
        assert coerced["request_type"] == ""


class TestCoerceRowMissingRequesterId:
    """Scan-it round 3 #1: _coerce_row raised KeyError/AttributeError on rows
    missing requester_id, bypassing session_satisfaction's per-row error
    handling and 500ing the entire /api/satisfaction call. Contract:
    _coerce_row raises a typed ValueError so the caller can catch + skip.
    """

    def test_dict_missing_requester_id_raises_valueerror(self) -> None:
        row = {
            "id": "r1",
            # requester_id intentionally absent
            "requestee_id": 2,
            "request_type": "bunk_with",
            "source_field": "bunk_request_form",
        }
        with pytest.raises(ValueError, match="requester_id"):
            _coerce_row(row)

    def test_dict_none_requester_id_raises_valueerror(self) -> None:
        row = {
            "id": "r1",
            "requester_id": None,
            "requestee_id": 2,
            "request_type": "bunk_with",
            "source_field": "bunk_request_form",
        }
        with pytest.raises(ValueError, match="requester_id"):
            _coerce_row(row)

    def test_object_missing_requester_id_raises_valueerror(self) -> None:
        class Row:
            id = "r1"
            # requester_id intentionally absent
            requestee_id = 2
            request_type = "bunk_with"
            source_field = "bunk_request_form"

        with pytest.raises(ValueError, match="requester_id"):
            _coerce_row(Row())


def test_dict_without_source_field_does_not_raise_keyerror() -> None:
    """Finding #10: req["source_field"] subscript raises KeyError for raw dict.

    `camper_satisfaction` accepts `list[BunkRequestRow] | list[dict[str, Any]]`.
    Direct dict callers bypassing `_coerce_row` should not see KeyError on a
    missing source_field — they should see the same missing-field signal that
    coerced rows surface (i.e. classify_request(""))
    """
    row = {
        "id": "r1",
        "requester_id": 1,
        "requestee_id": 2,
        "request_type": "bunk_with",
        # source_field intentionally absent
    }
    with pytest.raises(ValueError, match="unknown source_field"):
        # classify_request raises ValueError for unknown source_field — that's the
        # contract. KeyError would be a regression.
        camper_satisfaction(
            person_cm_id=1,
            person_requests=[row],
            person_to_bunk={1: 100, 2: 100},
        )


class TestCamperSatisfactionPredicateExceptionHandling:
    """Finding #4: is_request_satisfied() raises on bad rows; one bad row should
    not 500 the whole endpoint. Solver path (score_evaluator.py) wraps with
    try/except already; the new aggregator path should match.
    """

    def test_unknown_request_type_treated_as_unsatisfied_not_raised(self) -> None:
        # request_type='foo' is unknown; predicate would normally raise ValueError.
        # Aggregator must catch and treat as unsatisfied so one malformed row
        # doesn't crash the entire response.
        bad_row = {
            "id": "r_bad",
            "requester_id": 1,
            "requestee_id": 2,
            "request_type": "foo_bar_unknown",
            "source_field": "bunk_request_form",
        }
        good_row = _req("r_good", "bunk_with", 1, 3, "bunk_request_form")  # 1→3 satisfied
        result = camper_satisfaction(
            person_cm_id=1,
            person_requests=[bad_row, good_row],
            person_to_bunk={1: 100, 2: 100, 3: 100},
        )
        # Both rows in counted_totals: bad treated as unsatisfied, good as satisfied
        assert result.counted_totals[RequestBucket.MATERIAL_PARENT].total == 2
        assert result.counted_totals[RequestBucket.MATERIAL_PARENT].satisfied == 1
        # Per-request tracks both
        assert len(result.per_request) == 2
        assert result.per_request[0].satisfied is False
        assert result.per_request[1].satisfied is True

    def test_age_preference_missing_grade_treated_as_unsatisfied(self) -> None:
        # age_preference with out-of-range grade would normally ValueError.
        # Aggregator must catch and treat as unsatisfied.
        bad_age = {
            "id": "r_bad_age",
            "requester_id": 1,
            "requestee_id": 0,
            "request_type": "age_preference",
            "source_field": "socialize_with",
            "age_preference_target": "older",
            "requester_grade": 99,  # out of range 0-12
        }
        result = camper_satisfaction(
            person_cm_id=1,
            person_requests=[bad_age],
            person_to_bunk={1: 100},
            bunkmate_grades={1: [10, 11]},
        )
        # IMMATERIAL bucket since source_field is socialize_with
        assert result.immaterial.total == 1
        assert result.immaterial.satisfied == 0
        assert result.per_request[0].satisfied is False


def test_per_request_status_has_detail_field() -> None:
    """Regression: PerRequestStatus must accept and round-trip detail."""
    from bunking.satisfaction.api_shape import PerRequestStatus

    entry = PerRequestStatus(
        request_id="abc",
        bucket=RequestBucket.MATERIAL_PARENT,
        satisfied=True,
        detail="Same bunk",
    )
    assert entry.detail == "Same bunk"

    # detail is optional (forward-compat with older clients).
    entry2 = PerRequestStatus(
        request_id="abc",
        bucket=RequestBucket.MATERIAL_PARENT,
        satisfied=False,
    )
    assert entry2.detail is None


def test_camper_satisfaction_threads_detail_for_bunk_with() -> None:
    """detail strings from evaluate_request must surface in per_request output."""
    # Two campers in the same bunk — bunk_with should be satisfied with "Same bunk".
    req = _req("rq1", "bunk_with", 1, 2, "bunk_request_form")
    result = camper_satisfaction(
        person_cm_id=1,
        person_requests=[req],
        person_to_bunk={1: 100, 2: 100},
    )
    assert len(result.per_request) == 1
    assert result.per_request[0].satisfied is True
    assert result.per_request[0].detail == "Same bunk"


def test_camper_satisfaction_threads_detail_for_unsatisfied_not_bunk_with() -> None:
    """Unsatisfied not_bunk_with surfaces 'Same bunk (conflict!)' detail (the violation reason).

    Mirrors the TS predicate in `frontend/src/utils/requestSatisfaction.ts` so
    Path 1 (drag preview) and Path 2 (persisted) tooltips agree.
    """
    req = _req("rq1", "not_bunk_with", 1, 2, "staff_not_bunk_with")
    result = camper_satisfaction(
        person_cm_id=1,
        person_requests=[req],
        person_to_bunk={1: 100, 2: 100},  # both in same bunk = violation
    )
    assert result.per_request[0].satisfied is False
    assert result.per_request[0].detail == "Same bunk (conflict!)"


class TestMaterialParentSuppression1672:
    def test_coexisting_form_age_pref_suppressed_from_material(self) -> None:
        """#1672/#1664: a form age_preference is material only as a sole form
        request. With a coexisting form bunk_with it drops from the MATERIAL_PARENT
        totals (counted as immaterial), and no longer masks the unsatisfied bunk_with.
        Per-request statuses are untouched."""
        bunk_with = _req("r1", "bunk_with", 1, 2, "bunk_request_form")
        age_pref = _req(
            "ap",
            "age_preference",
            1,
            None,
            "bunk_request_form",
            requester_grade=5,
            age_preference_target="older",
        )
        result = camper_satisfaction(
            person_cm_id=1,
            person_requests=[bunk_with, age_pref],
            person_to_bunk={1: 100, 2: 101},  # bunk_with UNsatisfied
            bunkmate_grades={1: [8]},  # older bunkmate -> age_pref satisfiable
        )
        mp = result.counted_totals[RequestBucket.MATERIAL_PARENT]
        assert mp.total == 1  # age-pref suppressed (was 2)
        assert mp.satisfied == 0  # only the unsatisfied bunk_with counts
        # The unsatisfied sole material request now correctly trips the flag.
        assert result.flags.parent_min_one_violation
        # Per-request statuses untouched — both rows still reported.
        assert len(result.per_request) == 2

    def test_sole_form_age_pref_stays_material(self) -> None:
        """A form age_preference with no coexisting real form request stays material."""
        age_pref = _req(
            "ap",
            "age_preference",
            1,
            None,
            "bunk_request_form",
            requester_grade=5,
            age_preference_target="older",
        )
        result = camper_satisfaction(
            person_cm_id=1,
            person_requests=[age_pref],
            person_to_bunk={1: 100},
            bunkmate_grades={1: [8]},
        )
        assert result.counted_totals[RequestBucket.MATERIAL_PARENT].total == 1


def test_camper_satisfaction_malformed_request_has_none_detail() -> None:
    """Malformed rows logged as warning + treated as unsatisfied keep detail=None."""
    bad_age = {
        "id": "r_bad_age",
        "requester_id": 1,
        "requestee_id": 0,
        "request_type": "age_preference",
        "source_field": "socialize_with",
        "age_preference_target": "older",
        "requester_grade": 99,  # out of range 0-12 — raises ValueError in predicate
    }
    result = camper_satisfaction(
        person_cm_id=1,
        person_requests=[bad_age],
        person_to_bunk={1: 100},
        bunkmate_grades={1: [10, 11]},
    )
    assert result.per_request[0].satisfied is False
    assert result.per_request[0].detail is None
