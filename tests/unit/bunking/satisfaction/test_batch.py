"""Tests for bunking.satisfaction.batch.satisfied_request_ids_by_person.

Verifies the post-solve batch helper delegates to the canonical predicate
(bunking.satisfaction.predicate.is_request_satisfied) and handles the four
behavior divergences from the retired solution.calculate_satisfied_requests.
See docs/superpowers/specs/2026-05-14-retire-calculate-satisfied-requests-design.md.
"""

from __future__ import annotations

from bunking.models_v2 import DirectBunkAssignment, DirectBunkRequest, DirectPerson
from bunking.satisfaction.batch import satisfied_request_ids_by_person
from bunking.satisfaction.predicate import is_request_satisfied


def _person(cm_id: int, grade: int = 5) -> DirectPerson:
    return DirectPerson(
        campminder_person_id=cm_id,
        first_name="Test",
        last_name=f"Camper{cm_id}",
        grade=grade,
        birthdate="2014-06-15",
        session_cm_id=1000,
    )


def _assignment(person_cm_id: int, bunk_cm_id: int) -> DirectBunkAssignment:
    return DirectBunkAssignment(
        person_cm_id=person_cm_id,
        session_cm_id=1000,
        bunk_cm_id=bunk_cm_id,
        year=2025,
    )


def _request(
    req_id: str,
    requester: int,
    request_type: str,
    *,
    requested: int | None = None,
    age_preference_target: str | None = None,
) -> DirectBunkRequest:
    return DirectBunkRequest(
        id=req_id,
        requester_person_cm_id=requester,
        requested_person_cm_id=requested,
        request_type=request_type,
        session_cm_id=1000,
        year=2025,
        age_preference_target=age_preference_target,
    )


def test_bunk_with_same_bunk_satisfied():
    assignments = [_assignment(100, 1), _assignment(200, 1)]
    requests = {100: [_request("r1", 100, "bunk_with", requested=200)]}
    persons = {100: _person(100), 200: _person(200)}

    result = satisfied_request_ids_by_person(assignments, requests, persons)

    assert result == {100: ["r1"]}


def test_bunk_with_different_bunk_unsatisfied():
    assignments = [_assignment(100, 1), _assignment(200, 2)]
    requests = {100: [_request("r1", 100, "bunk_with", requested=200)]}
    persons = {100: _person(100), 200: _person(200)}

    result = satisfied_request_ids_by_person(assignments, requests, persons)

    assert result == {}


def test_not_bunk_with_different_bunk_satisfied():
    assignments = [_assignment(100, 1), _assignment(200, 2)]
    requests = {100: [_request("r1", 100, "not_bunk_with", requested=200)]}
    persons = {100: _person(100), 200: _person(200)}

    result = satisfied_request_ids_by_person(assignments, requests, persons)

    assert result == {100: ["r1"]}


def test_not_bunk_with_same_bunk_unsatisfied():
    assignments = [_assignment(100, 1), _assignment(200, 1)]
    requests = {100: [_request("r1", 100, "not_bunk_with", requested=200)]}
    persons = {100: _person(100), 200: _person(200)}

    result = satisfied_request_ids_by_person(assignments, requests, persons)

    assert result == {}


def test_not_bunk_with_unassigned_target_satisfied():
    """DIVERGENCE 1: predicate treats an unassigned not_bunk_with target as
    satisfied ('no conflict possible'). The retired function returned unsatisfied."""
    assignments = [_assignment(100, 1)]  # 200 is NOT assigned
    requests = {100: [_request("r1", 100, "not_bunk_with", requested=200)]}
    persons = {100: _person(100), 200: _person(200)}

    result = satisfied_request_ids_by_person(assignments, requests, persons)

    assert result == {100: ["r1"]}


def test_age_preference_older_satisfied():
    """Requester grade 5 with a grade-8 bunkmate, preference 'older' -> satisfied."""
    assignments = [_assignment(100, 1), _assignment(101, 1)]
    requests = {100: [_request("r1", 100, "age_preference", age_preference_target="older")]}
    persons = {100: _person(100, grade=5), 101: _person(101, grade=8)}

    result = satisfied_request_ids_by_person(assignments, requests, persons)

    assert result == {100: ["r1"]}


def test_unknown_request_type_treated_unsatisfied():
    """DIVERGENCE 3: predicate raises ValueError on unknown request_type; the
    helper catches it and treats the request as unsatisfied (no raise)."""
    assignments = [_assignment(100, 1), _assignment(200, 1)]
    requests = {100: [_request("r1", 100, "garbage_type", requested=200)]}
    persons = {100: _person(100), 200: _person(200)}

    result = satisfied_request_ids_by_person(assignments, requests, persons)

    assert result == {}


def test_age_preference_out_of_range_grade_unsatisfied():
    """DIVERGENCE 2: predicate raises ValueError when requester grade is outside
    0-12; the helper catches it and treats the request as unsatisfied."""
    assignments = [_assignment(100, 1), _assignment(101, 1)]
    requests = {100: [_request("r1", 100, "age_preference", age_preference_target="older")]}
    persons = {100: _person(100, grade=15), 101: _person(101, grade=8)}

    result = satisfied_request_ids_by_person(assignments, requests, persons)

    assert result == {}


def test_age_preference_missing_requester_unsatisfied():
    """DIVERGENCE 4: requester absent from person_by_cm_id -> requester_grade is
    None -> predicate's age_preference branch returns False."""
    assignments = [_assignment(100, 1), _assignment(101, 1)]
    requests = {100: [_request("r1", 100, "age_preference", age_preference_target="older")]}
    persons = {101: _person(101, grade=8)}  # 100 is missing

    result = satisfied_request_ids_by_person(assignments, requests, persons)

    assert result == {}


def test_requester_not_assigned_absent_from_result():
    assignments = [_assignment(200, 1)]  # requester 100 not assigned
    requests = {100: [_request("r1", 100, "bunk_with", requested=200)]}
    persons = {100: _person(100), 200: _person(200)}

    result = satisfied_request_ids_by_person(assignments, requests, persons)

    assert result == {}


def test_agreement_with_predicate_over_mixed_batch():
    """The helper's output must equal applying is_request_satisfied per-request
    over the same inputs (the consolidation's core guarantee)."""
    # This mirrors batch.py's adapter logic — it verifies the helper agrees with
    # the predicate, not that the adapter's internal strategy is itself correct.
    assignments = [
        _assignment(100, 1),
        _assignment(200, 1),
        _assignment(300, 2),
        _assignment(101, 1),
    ]
    requests = {
        100: [
            _request("r1", 100, "bunk_with", requested=200),
            _request("r2", 100, "not_bunk_with", requested=300),
            _request("r3", 100, "age_preference", age_preference_target="older"),
        ],
        300: [_request("r4", 300, "bunk_with", requested=100)],
    }
    persons = {
        100: _person(100, grade=5),
        200: _person(200, grade=5),
        300: _person(300, grade=6),
        101: _person(101, grade=9),
    }

    result = satisfied_request_ids_by_person(assignments, requests, persons)

    # Independently replicate the adapter and apply the predicate per request.
    person_to_bunk = {a.person_cm_id: a.bunk_cm_id for a in assignments}
    bunk_to_persons: dict[int, list[int]] = {}
    for pid, bid in person_to_bunk.items():
        bunk_to_persons.setdefault(bid, []).append(pid)
    bunkmate_grades = {
        pid: [persons[mate].grade for mate in bunk_to_persons[bid] if mate != pid and mate in persons]
        for pid, bid in person_to_bunk.items()
    }
    expected: dict[int, list[str]] = {}
    for requester, reqs in requests.items():
        if requester not in person_to_bunk:
            continue
        grade = persons[requester].grade if requester in persons else None
        for req in reqs:
            mapping = {**req.model_dump(), "requester_grade": grade}
            if is_request_satisfied(mapping, person_to_bunk, bunkmate_grades=bunkmate_grades):
                expected.setdefault(requester, []).append(req.id)

    assert result == expected
