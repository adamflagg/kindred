"""Invariance of `unsatisfied_no_possible` across solve outcomes.

Pre-fix bug (#1527): the diagnostic loop in
`_check_must_satisfy_one_violations` gates the `no_possible` bucket on
`all_satisfied` (post-solve), which means
`is_request_satisfied` returning True for a structurally-impossible request
(e.g. a cross-session `not_bunk_with` whose target lands in a different
bunk, which the predicate treats as "no conflict possible") skips the
camper out of `no_possible` via the `continue`. With more solve time more
campers get a "satisfied" tag on some request and drop out — the metric
drifts from solve-time variability despite naming itself as an
input-property fact.

The fix consults the canonical input-property rollup
(`ImpossibilityReport.campers_no_resolved_possible`), intersected with
placed campers — independent of post-solve satisfaction.
"""

from unittest.mock import MagicMock

from bunking.models_v2 import DirectBunk, DirectBunkAssignment, DirectBunkRequest, DirectPerson, DirectSolverInput
from bunking.solver.direct_solver import DirectBunkingSolver


def _person(cm_id: int, session: int, gender: str = "F") -> DirectPerson:
    return DirectPerson(
        campminder_person_id=cm_id,
        first_name=f"Camper{cm_id}",
        last_name="Test",
        grade=5,
        birthdate="2015-01-01",
        gender=gender,
        session_cm_id=session,
    )


def _bunk(cm_id: int, session: int, gender: str = "F") -> DirectBunk:
    return DirectBunk(
        id=f"bunk-{cm_id}",
        campminder_id=cm_id,
        name=f"Bunk{cm_id}",
        capacity=10,
        gender=gender,
        session_cm_id=session,
    )


def _req(
    req_id: str,
    requester: int,
    requestee: int | None,
    session: int,
    request_type: str = "bunk_with",
    source_field: str = "bunk_request_form",
) -> DirectBunkRequest:
    return DirectBunkRequest(
        id=req_id,
        requester_person_cm_id=requester,
        requested_person_cm_id=requestee,
        request_type=request_type,
        source_field=source_field,
        status="resolved",
        session_cm_id=session,
        year=2026,
    )


def _run(
    persons: list[DirectPerson],
    bunks: list[DirectBunk],
    requests: list[DirectBunkRequest],
    assignments: dict[int, tuple[int, int]],  # cm_id -> (bunk_cm_id, session_cm_id)
) -> int:
    """Run only the post-solve diagnostic and return unsatisfied_no_possible."""
    input_data = DirectSolverInput(persons=persons, bunks=bunks, requests=requests)
    solver = DirectBunkingSolver(input_data, config_service=MagicMock())
    assignment_list = [
        DirectBunkAssignment(person_cm_id=pid, bunk_cm_id=bid, session_cm_id=sid, year=2026)
        for pid, (bid, sid) in assignments.items()
    ]
    solver._check_must_satisfy_one_violations(assignment_list)
    return int(solver.request_validation_summary["unsatisfied_no_possible"])


def test_post_solve_satisfaction_of_impossible_request_still_counts_no_possible() -> None:
    """The classic drift case: a request flagged impossible (pair_no_shared_bunk
    via cross-gender) that the post-solve predicate marks satisfied because
    both campers happen to land in the same bunk.

    Pre-fix the diagnostic's `all_satisfied` continue skips the camper since
    one of their resolved requests is "satisfied" — the
    `unsatisfied_no_possible` count drops despite the input-property fact
    that the camper has zero solver-actionable resolved requests. Post-fix
    the rollup-driven count is unaffected by post-solve placement."""
    persons = [
        _person(1, session=100, gender="F"),
        _person(2, session=100, gender="M"),
    ]
    bunks = [
        _bunk(2001, session=100, gender="F"),
        _bunk(2002, session=100, gender="M"),
    ]
    # Cross-gender bunk_with → impossible (pair_no_shared_bunk).
    requests = [_req("r1", requester=1, requestee=2, session=100, request_type="bunk_with")]

    # Fixture places both in the same bunk — synthetic but legal for the
    # diagnostic helper, which doesn't re-validate gender. is_request_satisfied
    # returns True (same bunk), feeding the `all_satisfied` continue pre-fix.
    assignments = {1: (2001, 100), 2: (2001, 100)}

    count = _run(persons, bunks, requests, assignments)

    # Pre-fix: 0 (gated out by the all_satisfied continue).
    # Post-fix: 1 (input-property: camper 1 has no resolved possible requests).
    assert count == 1


def test_no_possible_invariant_across_satisfaction_outcomes() -> None:
    """Two scenarios with the same input — same `unsatisfied_no_possible`
    regardless of which post-solve placements happen to satisfy other requests.

    Camper 1 has all impossible resolved requests (cross-session bunk_with).
    Camper 3 is independent and has a possible request that varies in
    satisfaction across the two scenarios. The metric should not move."""
    persons = [_person(1, session=100), _person(2, session=200), _person(3, session=100), _person(4, session=100)]
    bunks = [_bunk(2001, session=100), _bunk(2002, session=100), _bunk(2003, session=200)]
    requests = [
        # Camper 1: impossible cross-session bunk_with (target session 200).
        _req("r_imp", requester=1, requestee=2, session=100, request_type="bunk_with"),
        # Camper 3: possible bunk_with against camper 4 (same session).
        _req("r_ok", requester=3, requestee=4, session=100, request_type="bunk_with"),
    ]

    # Scenario A: camper 3 and 4 in DIFFERENT bunks (r_ok unsatisfied).
    a_count = _run(persons, bunks, requests, {1: (2001, 100), 2: (2003, 200), 3: (2001, 100), 4: (2002, 100)})

    # Scenario B: camper 3 and 4 in SAME bunk (r_ok satisfied).
    b_count = _run(persons, bunks, requests, {1: (2001, 100), 2: (2003, 200), 3: (2002, 100), 4: (2002, 100)})

    # Both scenarios: camper 1 has no possible requests → metric == 1, invariant.
    assert a_count == 1
    assert b_count == 1
    assert a_count == b_count
