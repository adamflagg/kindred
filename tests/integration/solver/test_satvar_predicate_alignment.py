"""Golden alignment test: solve-time sat vars vs post-solve predicate.

#1398 — drift defense between the solver's CP-SAT satisfaction encoding and
the post-solve oracle (``bunking.satisfaction.predicate.is_request_satisfied``).

Scope:
  * ``bunk_with`` / ``not_bunk_with`` — alignment for the shared bidirectional
    sat var built by ``get_or_create_request_sat_var`` in
    ``bunking/solver/constraints/bunk_requests.py``. See PR #1427.
  * ``age_preference`` — alignment for the bidirectional sat var built by
    ``_create_age_preference_satisfaction_var`` in
    ``bunking/solver/constraints/age_preference.py``. See #1433.

Impossible requests (dropped by ``_validate_requests`` before sat-var
creation) carry no sat var and are not asserted; the fixture exercises the
drop path with one ``age_preference`` and two malformed/missing-target
``bunk_with`` requests.

If alignment fails on real divergence (not a fixture bug), per the #1398
acceptance criteria file a follow-up to investigate which path — the encoding
or the predicate — is wrong.
"""

from __future__ import annotations

from typing import Any

from ortools.sat.python import cp_model

from bunking.satisfaction.predicate import is_request_satisfied
from bunking.solver.direct_solver import DirectBunkingSolver
from tests.integration.solver.fixtures import (
    AGE_PREF_EXPECTED_SATISFACTION,
    BUILD_PATH_EXERCISERS,
    EXPECTED_SATISFACTION,
    build_age_preference_alignment_fixture,
    build_alignment_fixture,
)


def _build_and_solve(
    mock_config: Any,
    fixture_builder: Any = build_alignment_fixture,
) -> tuple[DirectBunkingSolver, cp_model.CpSolver]:
    """Build the alignment fixture, add constraints + objective, and solve.

    Uses a test-local ``CpSolver`` with ``num_search_workers=1`` — the model is
    tiny, and single-worker keeps the solve fast and reproducible. Mirrors the
    build-and-inspect pattern established by
    ``tests/unit/solver/test_satvar_unification.py``.
    """
    solver = DirectBunkingSolver(fixture_builder(), config_service=mock_config)
    solver.add_constraints()
    solver.add_objective()

    cp_solver = cp_model.CpSolver()
    cp_solver.parameters.max_time_in_seconds = 10
    cp_solver.parameters.num_search_workers = 1
    status = cp_solver.Solve(solver.model)
    assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE), (
        f"alignment fixture did not solve: status={cp_solver.StatusName(status)}"
    )
    return solver, cp_solver


def _bunkmate_grades(solver: DirectBunkingSolver, person_to_bunk: dict[int, int]) -> dict[int, list[int]]:
    """Per-camper list of bunkmate grades, required by the age_preference predicate."""
    bunk_to_persons: dict[int, list[int]] = {}
    for cm_id, bunk_cm_id in person_to_bunk.items():
        bunk_to_persons.setdefault(bunk_cm_id, []).append(cm_id)

    grade_by_cm_id = {p.campminder_person_id: p.grade for p in solver.input.persons}
    bunkmate_grades: dict[int, list[int]] = {}
    for cm_id, bunk_cm_id in person_to_bunk.items():
        bunkmate_grades[cm_id] = [grade_by_cm_id[other] for other in bunk_to_persons[bunk_cm_id] if other != cm_id]
    return bunkmate_grades


def _person_to_bunk(solver: DirectBunkingSolver, cp_solver: cp_model.CpSolver) -> dict[int, int]:
    """Reconstruct the cm_id -> bunk_cm_id map the predicate consumes.

    The hard assignment constraint (``sum(assignments) == 1`` per camper)
    guarantees exactly one bunk per camper in any FEASIBLE/OPTIMAL solve. We
    assert that cardinality explicitly so a fixture regression (e.g. the
    assignment constraint disabled) fails loudly here rather than silently
    masking an alignment failure.
    """
    person_to_bunk: dict[int, int] = {}
    for person_idx, person_cm_id in enumerate(solver.person_ids):
        assigned_bunks = [
            bunk.campminder_id
            for bunk_idx, bunk in enumerate(solver.bunks)
            if cp_solver.Value(solver.assignments[(person_idx, bunk_idx)]) == 1
        ]
        assert len(assigned_bunks) == 1, (
            f"expected exactly one assigned bunk for camper {person_cm_id}, got {assigned_bunks}"
        )
        person_to_bunk[person_cm_id] = assigned_bunks[0]
    return person_to_bunk


def test_satvar_predicate_alignment(mock_config: Any) -> None:
    """Every shared bunk_with/not_bunk_with sat var agrees with the predicate."""
    solver, cp_solver = _build_and_solve(mock_config)
    person_to_bunk = _person_to_bunk(solver, cp_solver)

    sat_vars = solver.request_satisfied_vars
    assert sat_vars, "fixture produced no shared sat vars — nothing to align"

    # Impossible requests are dropped by _validate_requests before sat-var
    # creation, so they must never appear in request_satisfied_vars.
    for req_id in BUILD_PATH_EXERCISERS:
        assert req_id not in sat_vars, (
            f"{req_id} unexpectedly has a shared sat var — _validate_requests should "
            f"drop impossible requests before sat-var creation"
        )

    requests_by_id = {r.id: r for r in solver.input.requests}
    disagreements: list[str] = []
    seen_true = seen_false = False

    for req_id, sat_var in sat_vars.items():
        request = requests_by_id[req_id]
        solver_satisfied = bool(cp_solver.Value(sat_var))
        # bunkmate_grades is unused: this fixture has no feasible age_preference
        # requests, and is_request_satisfied only requires it for that type.
        predicate_satisfied = is_request_satisfied(
            request.model_dump(),
            person_to_bunk,
            bunkmate_grades=None,
        )
        seen_true |= solver_satisfied
        seen_false |= not solver_satisfied

        if solver_satisfied != predicate_satisfied:
            disagreements.append(
                f"  {req_id} ({request.request_type}, "
                f"{request.requester_person_cm_id}->{request.requested_person_cm_id}): "
                f"solver sat_var={solver_satisfied}, is_request_satisfied={predicate_satisfied}"
            )

    assert not disagreements, "solve-time sat vars disagree with is_request_satisfied:\n" + "\n".join(disagreements)

    # Anti-vacuous guards: the fixture must exercise BOTH predicate branches,
    # else an all-satisfied (or all-unsatisfied) solve would pass trivially.
    assert seen_true, "fixture exercised no satisfied request — alignment test is vacuous"
    assert seen_false, "fixture exercised no unsatisfied request — alignment test is vacuous"


def test_alignment_fixture_outcomes_are_deterministic(mock_config: Any) -> None:
    """The fixture's structurally-forced outcomes hold.

    Guards the fixture itself against silently drifting into a degenerate
    scenario (e.g. all-satisfied) that would make the alignment assertion
    vacuous. A failure here means the fixture needs re-checking — not that the
    solver/predicate disagree.
    """
    solver, cp_solver = _build_and_solve(mock_config)
    sat_vars = solver.request_satisfied_vars

    # request_satisfied_vars must hold EXACTLY the expected request ids — no
    # more, no less. Without the converse check, a future change that emits a
    # shared sat var for an unexpected request id would slip past both this
    # test and test_satvar_predicate_alignment (whose BUILD_PATH_EXERCISERS
    # guard only names the three known exercisers).
    assert set(sat_vars) == set(EXPECTED_SATISFACTION), (
        "request_satisfied_vars key set drifted from EXPECTED_SATISFACTION:\n"
        f"  unexpected: {sorted(set(sat_vars) - set(EXPECTED_SATISFACTION))}\n"
        f"  missing:    {sorted(set(EXPECTED_SATISFACTION) - set(sat_vars))}"
    )

    for req_id, expected in EXPECTED_SATISFACTION.items():
        assert req_id in sat_vars, f"{req_id} expected in request_satisfied_vars but absent"
        actual = bool(cp_solver.Value(sat_vars[req_id]))
        assert actual == expected, (
            f"{req_id}: fixture expected sat_var={expected}, solver produced {actual} — "
            f"the deterministic partition no longer holds, re-check build_alignment_fixture"
        )


def test_age_preference_satvar_predicate_alignment(mock_config: Any) -> None:
    """Every feasible MP age_preference sat var agrees with the predicate.

    #1433 — after the bidirectional refactor, age_preference sat vars are
    registered in ``DirectBunkingSolver.request_satisfied_vars`` and are
    bidirectionally bound to the post-solve satisfaction condition.
    """
    solver, cp_solver = _build_and_solve(mock_config, build_age_preference_alignment_fixture)
    person_to_bunk = _person_to_bunk(solver, cp_solver)
    bunkmate_grades = _bunkmate_grades(solver, person_to_bunk)

    sat_vars = solver.request_satisfied_vars

    # Every expected age_preference request must have a sat var registered.
    for req_id in AGE_PREF_EXPECTED_SATISFACTION:
        assert req_id in sat_vars, (
            f"{req_id} (feasible MP age_preference) missing from request_satisfied_vars — "
            f"the bidirectional refactor (#1433) is not wired into the shared map"
        )

    requests_by_id = {r.id: r for r in solver.input.requests}
    grade_by_cm_id = {p.campminder_person_id: p.grade for p in solver.input.persons}
    disagreements: list[str] = []

    for req_id in AGE_PREF_EXPECTED_SATISFACTION:
        request = requests_by_id[req_id]
        sat_var = sat_vars[req_id]
        solver_satisfied = bool(cp_solver.Value(sat_var))
        # is_request_satisfied reads requester_grade off the request dict (the
        # production callers in score_evaluator / bunking_validator pad it on
        # before calling). Mirror that here.
        request_payload = request.model_dump()
        request_payload["requester_grade"] = grade_by_cm_id[request.requester_person_cm_id]
        predicate_satisfied = is_request_satisfied(
            request_payload,
            person_to_bunk,
            bunkmate_grades=bunkmate_grades,
        )
        if solver_satisfied != predicate_satisfied:
            disagreements.append(
                f"  {req_id} (age_preference {request.age_preference_target}, "
                f"requester={request.requester_person_cm_id}): "
                f"solver sat_var={solver_satisfied}, is_request_satisfied={predicate_satisfied}"
            )

    assert not disagreements, "age_preference sat vars disagree with is_request_satisfied:\n" + "\n".join(disagreements)


def test_age_preference_alignment_fixture_outcomes_are_deterministic(mock_config: Any) -> None:
    """The age_preference fixture's structurally-forced outcomes hold.

    Mirrors ``test_alignment_fixture_outcomes_are_deterministic`` but for the
    age_preference fixture — anti-vacuity guard against fixture drift.
    """
    solver, cp_solver = _build_and_solve(mock_config, build_age_preference_alignment_fixture)
    sat_vars = solver.request_satisfied_vars

    for req_id, expected in AGE_PREF_EXPECTED_SATISFACTION.items():
        assert req_id in sat_vars, f"{req_id} expected in request_satisfied_vars but absent"
        actual = bool(cp_solver.Value(sat_vars[req_id]))
        assert actual == expected, (
            f"{req_id}: fixture expected sat_var={expected}, solver produced {actual} — "
            f"the deterministic partition no longer holds, re-check "
            f"build_age_preference_alignment_fixture"
        )

    # Both branches must be exercised.
    assert any(AGE_PREF_EXPECTED_SATISFACTION.values()), "fixture has no satisfied case — vacuous"
    assert not all(AGE_PREF_EXPECTED_SATISFACTION.values()), "fixture has no unsatisfied case — vacuous"
