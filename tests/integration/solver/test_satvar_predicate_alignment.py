"""Golden alignment test: solve-time sat vars vs post-solve predicate.

#1398 — drift defense between the solver's CP-SAT satisfaction encoding
(``get_or_create_request_sat_var`` in
``bunking/solver/constraints/bunk_requests.py``) and the post-solve oracle
(``bunking.satisfaction.predicate.is_request_satisfied``).

Scope (Option 2 — see #1398): asserts agreement for every entry in
``DirectBunkingSolver.request_satisfied_vars`` — the shared bidirectional sat
var built for ``bunk_with`` / ``not_bunk_with`` requests with in-roster
targets. That map is the complete output of ``get_or_create_request_sat_var``
and the exact surface PR #1427 changed.

``age_preference`` is deliberately out of scope: it has no faithful
satisfaction var to align against (its sat var is one-way encoded and
discarded by its only caller — see #1433). The fixture still includes an
``age_preference`` request plus impossible requests so the build/validation
path is exercised, but they carry no shared sat var and so are not asserted.

If ``test_satvar_predicate_alignment`` fails on real divergence (not a fixture
bug), per the #1398 acceptance criteria file a follow-up to investigate which
path — the encoding or the predicate — is wrong.
"""

from __future__ import annotations

from typing import Any

from ortools.sat.python import cp_model

from bunking.satisfaction.predicate import is_request_satisfied
from bunking.solver.direct_solver import DirectBunkingSolver
from tests.integration.solver.fixtures import (
    BUILD_PATH_EXERCISERS,
    EXPECTED_SATISFACTION,
    build_alignment_fixture,
)


def _build_and_solve(mock_config: Any) -> tuple[DirectBunkingSolver, cp_model.CpSolver]:
    """Build the alignment fixture, add constraints + objective, and solve.

    Uses a test-local ``CpSolver`` with ``num_search_workers=1`` — the model is
    tiny, and single-worker keeps the solve fast and reproducible. Mirrors the
    build-and-inspect pattern established by
    ``tests/unit/solver/test_satvar_unification.py``.
    """
    solver = DirectBunkingSolver(build_alignment_fixture(), config_service=mock_config)
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


def _person_to_bunk(solver: DirectBunkingSolver, cp_solver: cp_model.CpSolver) -> dict[int, int]:
    """Reconstruct the cm_id -> bunk_cm_id map the predicate consumes."""
    person_to_bunk: dict[int, int] = {}
    for person_idx, person_cm_id in enumerate(solver.person_ids):
        for bunk_idx, bunk in enumerate(solver.bunks):
            if cp_solver.Value(solver.assignments[(person_idx, bunk_idx)]) == 1:
                person_to_bunk[person_cm_id] = bunk.campminder_id
                break
    return person_to_bunk


def test_satvar_predicate_alignment(mock_config: Any) -> None:
    """Every shared sat var agrees with ``is_request_satisfied`` post-solve."""
    solver, cp_solver = _build_and_solve(mock_config)
    person_to_bunk = _person_to_bunk(solver, cp_solver)

    sat_vars = solver.request_satisfied_vars
    assert sat_vars, "fixture produced no shared sat vars — nothing to align"

    # age_preference / impossible requests must never get a shared sat var.
    for req_id in BUILD_PATH_EXERCISERS:
        assert req_id not in sat_vars, (
            f"{req_id} unexpectedly has a shared sat var — get_or_create_request_sat_var "
            f"should return None for age_preference / impossible requests"
        )

    requests_by_id = {r.id: r for r in solver.input.requests}
    disagreements: list[str] = []
    seen_true = seen_false = False

    for req_id, sat_var in sat_vars.items():
        request = requests_by_id[req_id]
        solver_satisfied = bool(cp_solver.Value(sat_var))
        # bunkmate_grades is unused: age_preference never reaches this map, and
        # is_request_satisfied only requires it for age_preference requests.
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

    for req_id, expected in EXPECTED_SATISFACTION.items():
        assert req_id in sat_vars, f"{req_id} expected in request_satisfied_vars but absent"
        actual = bool(cp_solver.Value(sat_vars[req_id]))
        assert actual == expected, (
            f"{req_id}: fixture expected sat_var={expected}, solver produced {actual} — "
            f"the deterministic partition no longer holds, re-check build_alignment_fixture"
        )
