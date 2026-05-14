"""Unit tests for the canonical bunk-request satisfaction var builder.

get_or_create_request_sat_var must produce an HONEST bidirectional sat var:
    sat_var == 1  <=>  the request's placement condition actually holds.

The headline tests are the "true implies" honesty tests — they fail for any
one-way (falsifiable) encoding and pass only for the bidirectional one.
"""

from __future__ import annotations

from ortools.sat.python import cp_model

from bunking.models import RequestType
from bunking.solver.constraints.bunk_requests import get_or_create_request_sat_var

from ..conftest import build_solver_context, create_bunk, create_person, create_request


class TestBunkWithHonesty:
    """A bunk_with sat var must be true IFF the pair is actually co-placed."""

    def test_sat_var_true_implies_coplacement(self):
        """sat_var == 1 with the pair in different bunks must be INFEASIBLE.

        This is the falsifiability guard: a one-way encoding lets the solver
        claim sat_var == 1 for free without honest co-placement.
        """
        c1 = create_person(cm_id=1001, first_name="Emma", last_name="Johnson", gender="F", grade=5)
        c2 = create_person(cm_id=1002, first_name="Liam", last_name="Garcia", gender="F", grade=5)
        bunk1 = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)
        bunk2 = create_bunk(cm_id=2002, name="G-2", gender="F", capacity=12)
        request = create_request(
            request_id="req-1",
            requester_cm_id=1001,
            requested_cm_id=1002,
            request_type=RequestType.BUNK_WITH,
        )
        ctx = build_solver_context(persons=[c1, c2], bunks=[bunk1, bunk2], requests=[request])

        sat_var = get_or_create_request_sat_var(ctx, request)
        assert sat_var is not None

        ctx.model.Add(ctx.person_bunk_assignment[0] != ctx.person_bunk_assignment[1])
        ctx.model.Add(sat_var == 1)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)
        assert status == cp_model.INFEASIBLE, (
            "sat_var == 1 while the pair is in different bunks must be "
            "INFEASIBLE — a one-way encoding makes this falsely FEASIBLE"
        )

    def test_sat_var_false_implies_separation(self):
        """sat_var == 0 with the pair in the same bunk must be INFEASIBLE."""
        c1 = create_person(cm_id=1001, first_name="Emma", last_name="Johnson", gender="F", grade=5)
        c2 = create_person(cm_id=1002, first_name="Liam", last_name="Garcia", gender="F", grade=5)
        bunk1 = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)
        bunk2 = create_bunk(cm_id=2002, name="G-2", gender="F", capacity=12)
        request = create_request(
            request_id="req-1",
            requester_cm_id=1001,
            requested_cm_id=1002,
            request_type=RequestType.BUNK_WITH,
        )
        ctx = build_solver_context(persons=[c1, c2], bunks=[bunk1, bunk2], requests=[request])

        sat_var = get_or_create_request_sat_var(ctx, request)
        assert sat_var is not None

        ctx.model.Add(ctx.person_bunk_assignment[0] == ctx.person_bunk_assignment[1])
        ctx.model.Add(sat_var == 0)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)
        assert status == cp_model.INFEASIBLE


class TestNotBunkWithHonesty:
    """A not_bunk_with sat var must be true IFF the pair is actually separated."""

    def test_sat_var_true_implies_separation(self):
        """sat_var == 1 with the pair in the same bunk must be INFEASIBLE."""
        c1 = create_person(cm_id=1001, first_name="Emma", last_name="Johnson", gender="F", grade=5)
        c2 = create_person(cm_id=1002, first_name="Liam", last_name="Garcia", gender="F", grade=5)
        bunk1 = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)
        bunk2 = create_bunk(cm_id=2002, name="G-2", gender="F", capacity=12)
        request = create_request(
            request_id="req-1",
            requester_cm_id=1001,
            requested_cm_id=1002,
            request_type=RequestType.NOT_BUNK_WITH,
        )
        ctx = build_solver_context(persons=[c1, c2], bunks=[bunk1, bunk2], requests=[request])

        sat_var = get_or_create_request_sat_var(ctx, request)
        assert sat_var is not None

        ctx.model.Add(ctx.person_bunk_assignment[0] == ctx.person_bunk_assignment[1])
        ctx.model.Add(sat_var == 1)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)
        assert status == cp_model.INFEASIBLE, (
            "sat_var == 1 while the pair shares a bunk must be INFEASIBLE — "
            "a one-way encoding makes this falsely FEASIBLE"
        )

    def test_sat_var_false_implies_coplacement(self):
        """sat_var == 0 with the pair in different bunks must be INFEASIBLE."""
        c1 = create_person(cm_id=1001, first_name="Emma", last_name="Johnson", gender="F", grade=5)
        c2 = create_person(cm_id=1002, first_name="Liam", last_name="Garcia", gender="F", grade=5)
        bunk1 = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)
        bunk2 = create_bunk(cm_id=2002, name="G-2", gender="F", capacity=12)
        request = create_request(
            request_id="req-1",
            requester_cm_id=1001,
            requested_cm_id=1002,
            request_type=RequestType.NOT_BUNK_WITH,
        )
        ctx = build_solver_context(persons=[c1, c2], bunks=[bunk1, bunk2], requests=[request])

        sat_var = get_or_create_request_sat_var(ctx, request)
        assert sat_var is not None

        ctx.model.Add(ctx.person_bunk_assignment[0] != ctx.person_bunk_assignment[1])
        ctx.model.Add(sat_var == 0)

        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)
        assert status == cp_model.INFEASIBLE


class TestMemoization:
    """The same request must yield one var, shared across callers."""

    def test_second_call_returns_same_var(self):
        c1 = create_person(cm_id=1001, first_name="Emma", last_name="Johnson", gender="F", grade=5)
        c2 = create_person(cm_id=1002, first_name="Liam", last_name="Garcia", gender="F", grade=5)
        bunk = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)
        request = create_request(
            request_id="req-1",
            requester_cm_id=1001,
            requested_cm_id=1002,
            request_type=RequestType.BUNK_WITH,
        )
        ctx = build_solver_context(persons=[c1, c2], bunks=[bunk], requests=[request])

        first = get_or_create_request_sat_var(ctx, request)
        second = get_or_create_request_sat_var(ctx, request)

        assert first is second
        assert ctx.request_satisfied_vars["req-1"] is first
        assert len(ctx.request_satisfied_vars) == 1


class TestReturnsNone:
    """Requests this builder cannot encode return None and register nothing."""

    def test_missing_target(self):
        c1 = create_person(cm_id=1001, first_name="Emma", last_name="Johnson", gender="F", grade=5)
        bunk = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)
        request = create_request(
            request_id="req-1",
            requester_cm_id=1001,
            requested_cm_id=None,
            request_type=RequestType.BUNK_WITH,
        )
        ctx = build_solver_context(persons=[c1], bunks=[bunk], requests=[request])

        assert get_or_create_request_sat_var(ctx, request) is None
        assert ctx.request_satisfied_vars == {}

    def test_target_not_in_solver(self):
        c1 = create_person(cm_id=1001, first_name="Emma", last_name="Johnson", gender="F", grade=5)
        bunk = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)
        request = create_request(
            request_id="req-1",
            requester_cm_id=1001,
            requested_cm_id=9999,
            request_type=RequestType.BUNK_WITH,
        )
        ctx = build_solver_context(persons=[c1], bunks=[bunk], requests=[request])

        assert get_or_create_request_sat_var(ctx, request) is None
        assert ctx.request_satisfied_vars == {}

    def test_unsupported_request_type(self):
        c1 = create_person(cm_id=1001, first_name="Emma", last_name="Johnson", gender="F", grade=5)
        c2 = create_person(cm_id=1002, first_name="Liam", last_name="Garcia", gender="F", grade=5)
        bunk = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)
        request = create_request(
            request_id="req-1",
            requester_cm_id=1001,
            requested_cm_id=1002,
            request_type=RequestType.AGE_PREFERENCE,
        )
        ctx = build_solver_context(persons=[c1, c2], bunks=[bunk], requests=[request])

        assert get_or_create_request_sat_var(ctx, request) is None
        assert ctx.request_satisfied_vars == {}
