"""Hard constraint tests for parent_paramount.py — Task 4, Stage 4.

Tests verify that `add_must_satisfy_one_request_constraints` now adds a *hard*
`sum(mp_sat_vars) >= 1` constraint (not a soft violation variable) for campers
who have at least one Material-Parent (MP) request in `possible_requests`.

Four scenarios are exercised by building a real `SolverContext` (via the
existing `build_solver_context` helper), calling the constraint function, and
then attempting to solve with an additional pinning constraint.  Infeasibility
proves the hard constraint fired; feasibility proves it didn't.

MP = source_field == "bunk_with" (MATERIAL_PARENT bucket per bucket.py).
Non-MP = source_field == "bunking_notes" (STAFF bucket, explicit but not MP).
"""

from __future__ import annotations

from ortools.sat.python import cp_model

from bunking.models_v2 import DirectBunkRequest
from bunking.solver.constraints.base import SolverContext

# Helpers from tests/unit/bunking/solver/conftest.py — pytest auto-discovers
# the parent conftest.py for tests in tests/unit/bunking/solver/constraints/.
from tests.unit.bunking.solver.conftest import (
    build_solver_context,
    create_bunk,
    create_person,
    is_infeasible,
    is_optimal_or_feasible,
)


def _mp_request(
    request_id: str,
    requester_cm_id: int,
    requested_cm_id: int,
    session_cm_id: int = 1000,
) -> DirectBunkRequest:
    """Material-Parent bunk_with request (source_field=bunk_with)."""
    return DirectBunkRequest(
        id=request_id,
        requester_person_cm_id=requester_cm_id,
        requested_person_cm_id=requested_cm_id,
        request_type="bunk_with",
        session_cm_id=session_cm_id,
        year=2025,
        source_field="bunk_with",  # MATERIAL_PARENT bucket
        confidence_score=1.0,
        status="resolved",
    )


def _non_mp_request(
    request_id: str,
    requester_cm_id: int,
    requested_cm_id: int,
    session_cm_id: int = 1000,
) -> DirectBunkRequest:
    """Non-MP bunk_with request (source_field=bunking_notes → STAFF bucket)."""
    return DirectBunkRequest(
        id=request_id,
        requester_person_cm_id=requester_cm_id,
        requested_person_cm_id=requested_cm_id,
        request_type="bunk_with",
        session_cm_id=session_cm_id,
        year=2025,
        source_field="bunking_notes",  # STAFF bucket — explicit but NOT material-parent
        confidence_score=1.0,
        status="resolved",
    )


def _force_apart(ctx: SolverContext, requester_cm_id: int, requested_cm_id: int) -> None:
    """Pin requester and requested to *different* bunks.

    We do this by forcing them each to a specific distinct bunk index, making
    a bunk_with satisfaction variable provably False (both in bunk_idx 0 vs 1).
    Requires at least 2 bunks in the context.
    """
    req_idx = ctx.person_idx_map[requester_cm_id]
    tgt_idx = ctx.person_idx_map[requested_cm_id]
    bunk_idxs = list(range(len(ctx.bunks)))
    assert len(bunk_idxs) >= 2, "Need ≥2 bunks to force apart"
    # requester → bunk 0, requested → bunk 1
    ctx.model.Add(ctx.assignments[(req_idx, bunk_idxs[0])] == 1)
    ctx.model.Add(ctx.assignments[(tgt_idx, bunk_idxs[1])] == 1)


class TestParentParamountBindsMPHavers:
    def test_camper_with_one_mp_request_must_satisfy(self):
        """Camper has 1 MP bunk_with request.

        Forcing that request unsatisfied (requester and requestee in different
        bunks) must make the model INFEASIBLE — the hard constraint fires.
        """
        camper1 = create_person(cm_id=100, first_name="Emma", last_name="Johnson", gender="F", grade=5)
        camper2 = create_person(cm_id=200, first_name="Liam", last_name="Garcia", gender="F", grade=5)
        bunk1 = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)
        bunk2 = create_bunk(cm_id=2002, name="G-2", gender="F", capacity=12)

        req = _mp_request("r1", requester_cm_id=100, requested_cm_id=200)

        ctx = build_solver_context(
            persons=[camper1, camper2],
            bunks=[bunk1, bunk2],
            requests=[req],
        )

        from bunking.solver.constraints.parent_paramount import add_must_satisfy_one_request_constraints

        add_must_satisfy_one_request_constraints(ctx)

        # Force the two campers into DIFFERENT bunks — bunk_with is unsatisfied.
        _force_apart(ctx, 100, 200)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_infeasible(status), (
            "Hard MP constraint should make model INFEASIBLE when the only MP request is provably unsatisfied"
        )


class TestParentParamountSkipsNoMP:
    def test_camper_with_only_non_mp_has_no_constraint(self):
        """Camper has only non-MP requests (source_field=bunking_notes → STAFF).

        No hard MP constraint should be added.  Pinning the non-MP request
        unsatisfied must remain FEASIBLE.  ctx.mp_set_entirely_impossible
        must NOT contain this camper.
        """
        camper1 = create_person(cm_id=100, first_name="Olivia", last_name="Chen", gender="F", grade=5)
        camper2 = create_person(cm_id=200, first_name="Noah", last_name="Williams", gender="F", grade=5)
        bunk1 = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)
        bunk2 = create_bunk(cm_id=2002, name="G-2", gender="F", capacity=12)

        req = _non_mp_request("r1", requester_cm_id=100, requested_cm_id=200)

        ctx = build_solver_context(
            persons=[camper1, camper2],
            bunks=[bunk1, bunk2],
            requests=[req],
        )

        from bunking.solver.constraints.parent_paramount import add_must_satisfy_one_request_constraints

        add_must_satisfy_one_request_constraints(ctx)

        # Force them into different bunks — non-MP bunk_with is unsatisfied.
        _force_apart(ctx, 100, 200)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status), (
            "Non-MP request must NOT generate a hard constraint — model should remain FEASIBLE"
        )

        # The camper had requests but none were MP → not an "all-impossible" case
        assert 100 not in ctx.mp_set_entirely_impossible, (
            "Camper with only non-MP requests must NOT appear in mp_set_entirely_impossible"
        )


class TestParentParamountSkipsAllImpossibleMP:
    def test_camper_with_all_mp_impossible_recorded(self):
        """Camper has MP requests in input.requests_by_person but NONE are in
        ctx.possible_requests (all classified impossible).

        No hard constraint should be added. ctx.mp_set_entirely_impossible is
        pre-populated by _validate_requests (single source of truth); parent_paramount
        must NOT re-derive it — it just consumes the pre-populated list unchanged.
        """
        camper1 = create_person(cm_id=100, first_name="Ava", last_name="Martinez", gender="F", grade=5)
        camper2 = create_person(cm_id=200, first_name="Ethan", last_name="Brown", gender="F", grade=5)
        bunk1 = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)
        bunk2 = create_bunk(cm_id=2002, name="G-2", gender="F", capacity=12)

        req = _mp_request("r1", requester_cm_id=100, requested_cm_id=200)

        ctx = build_solver_context(
            persons=[camper1, camper2],
            bunks=[bunk1, bunk2],
            requests=[req],
        )

        # Override: move the MP request from possible → impossible
        ctx.possible_requests[100] = []
        ctx.impossible_requests[100] = [req]

        # Simulate _validate_requests having already recorded camper 100 as
        # entirely-impossible (Task 4 made _validate_requests the single source of truth).
        ctx.mp_set_entirely_impossible.append(100)

        from bunking.solver.constraints.parent_paramount import add_must_satisfy_one_request_constraints

        add_must_satisfy_one_request_constraints(ctx)

        # Force different bunks — if no hard constraint, model is still feasible.
        _force_apart(ctx, 100, 200)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status), "No hard constraint should be added when all MP requests are impossible"

        assert 100 in ctx.mp_set_entirely_impossible, (
            "Camper pre-seeded as entirely-impossible must still be in mp_set_entirely_impossible "
            "(parent_paramount must not clear or modify the list)"
        )


class TestParentParamountDebugToggle:
    """The infeasibility analyzer needs to isolate parent_paramount.

    Without an honored debug toggle, the analyzer at feasibility.py iterates
    constraint_types but the new hard MP constraint is always added — making
    the analyzer's diagnosis misleading (it blames whatever else interacts
    with the hard MP, typically gender).
    """

    def test_debug_constraints_skips_hard_mp_constraint(self):
        """debug_constraints['parent_paramount']=True must skip the hard constraint."""
        camper1 = create_person(cm_id=100, first_name="Emma", last_name="Johnson", gender="F", grade=5)
        camper2 = create_person(cm_id=200, first_name="Liam", last_name="Garcia", gender="F", grade=5)
        bunk1 = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)
        bunk2 = create_bunk(cm_id=2002, name="G-2", gender="F", capacity=12)

        req = _mp_request("r1", requester_cm_id=100, requested_cm_id=200)

        ctx = build_solver_context(
            persons=[camper1, camper2],
            bunks=[bunk1, bunk2],
            requests=[req],
            debug_constraints={"parent_paramount": True},
        )

        from bunking.solver.constraints.parent_paramount import add_must_satisfy_one_request_constraints

        add_must_satisfy_one_request_constraints(ctx)

        # No hard constraint was added — forcing campers apart should remain feasible.
        _force_apart(ctx, 100, 200)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status), (
            "With parent_paramount disabled via debug_constraints, the hard MP constraint "
            "must not be added — forcing the only MP request unsatisfied should remain feasible"
        )


class TestParentParamountPartialImpossible:
    def test_partial_impossible_constrains_only_possible(self):
        """Camper has 2 MP requests: 1 possible, 1 impossible.

        The hard constraint should only sum over the 1 possible MP request.
        Forcing THAT request unsatisfied makes the model INFEASIBLE.
        ctx.mp_set_entirely_impossible must NOT contain this camper.
        """
        camper1 = create_person(cm_id=100, first_name="Sophia", last_name="Davis", gender="F", grade=5)
        camper2 = create_person(cm_id=200, first_name="Mason", last_name="Lopez", gender="F", grade=5)
        # camper3 is the target of the impossible request (different session, not in solver)
        # We model this by simply not including camper3 in person_idx_map while still
        # having the request listed in input.requests_by_person.
        bunk1 = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)
        bunk2 = create_bunk(cm_id=2002, name="G-2", gender="F", capacity=12)

        req_possible = _mp_request("r1", requester_cm_id=100, requested_cm_id=200)
        req_impossible = _mp_request("r2", requester_cm_id=100, requested_cm_id=999)

        ctx = build_solver_context(
            persons=[camper1, camper2],
            bunks=[bunk1, bunk2],
            requests=[req_possible, req_impossible],
        )

        # Override: only req_possible is in possible_requests; req_impossible is in impossible
        ctx.possible_requests[100] = [req_possible]
        ctx.impossible_requests[100] = [req_impossible]

        from bunking.solver.constraints.parent_paramount import add_must_satisfy_one_request_constraints

        add_must_satisfy_one_request_constraints(ctx)

        # Force the *possible* request's requester and requestee apart.
        _force_apart(ctx, 100, 200)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_infeasible(status), (
            "Hard constraint covers the 1 possible MP request; forcing it unsatisfied must be INFEASIBLE"
        )

        assert 100 not in ctx.mp_set_entirely_impossible, (
            "Camper with at least one possible MP request must NOT appear in mp_set_entirely_impossible"
        )


def test_parent_paramount_does_not_rederive_entirely_impossible_set():
    """mp_set_entirely_impossible is pre-populated by _validate_requests now.
    parent_paramount must NOT append to it again (which would double-count)."""
    p1 = create_person(cm_id=1, first_name="Emma", last_name="Johnson", gender="F", grade=5)
    p2 = create_person(cm_id=2, first_name="Liam", last_name="Garcia", gender="F", grade=5)
    bunks = [create_bunk(cm_id=10, name="G-1", gender="F")]
    # Camper 1 has one MP request; we simulate it being impossible by clearing
    # possible_requests for camper 1 after construction.
    mp_req = _mp_request("r1", requester_cm_id=1, requested_cm_id=2)
    ctx = build_solver_context(persons=[p1, p2], bunks=bunks, requests=[mp_req])
    ctx.possible_requests = {}  # camper 1's MP request is impossible

    # Simulate _validate_requests having already recorded camper 1.
    ctx.mp_set_entirely_impossible.append(1)

    from bunking.solver.constraints.parent_paramount import add_must_satisfy_one_request_constraints

    add_must_satisfy_one_request_constraints(ctx)

    # parent_paramount must leave the pre-populated list untouched — exactly [1].
    assert ctx.mp_set_entirely_impossible == [1], (
        "parent_paramount must not re-append camper 1 — mp_set_entirely_impossible should remain [1], "
        f"got {ctx.mp_set_entirely_impossible}"
    )
