"""
Unit tests for bunk request satisfaction variables.

Tests the mechanics of request satisfaction:
- bunk_with: satisfied when both campers are in the same bunk
- not_bunk_with: satisfied when campers are in different bunks

Note: This tests the satisfaction variable creation, not the "must satisfy"
constraint (which is in must_satisfy.py).
"""

from __future__ import annotations

from ortools.sat.python import cp_model

from bunking.solver.constraints.bunk_requests import add_bunk_request_satisfaction_vars

from ..conftest import build_solver_context, create_bunk, create_person, create_request, is_optimal_or_feasible


class TestBunkWithSatisfaction:
    """Test bunk_with request satisfaction."""

    def test_bunk_with_satisfied_when_together(self):
        """bunk_with request is satisfied when both campers in same bunk."""
        # 2 campers who want to bunk together, 1 bunk
        camper1 = create_person(cm_id=1001, first_name="Alice", last_name="Test", gender="F", grade=5)
        camper2 = create_person(cm_id=1002, first_name="Bob", last_name="Test", gender="F", grade=5)
        bunk = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)

        request = create_request(
            request_id="req-1",
            requester_cm_id=1001,
            requested_cm_id=1002,
            request_type="bunk_with",
        )

        ctx = build_solver_context(
            persons=[camper1, camper2],
            bunks=[bunk],
            requests=[request],
        )

        # Create satisfaction variables
        requests_by_person = {1001: [request]}
        sat_vars = add_bunk_request_satisfaction_vars(ctx, requests_by_person)

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)

        # Both should be in same bunk (only 1 bunk available)
        bunk_idx = ctx.bunk_idx_map[2001]
        assert solver.Value(ctx.assignments[(0, bunk_idx)]) == 1
        assert solver.Value(ctx.assignments[(1, bunk_idx)]) == 1

        # Satisfaction variable should be 1
        assert 1001 in sat_vars
        assert len(sat_vars[1001]) == 1
        # Can verify the satisfaction var value if needed

    def test_bunk_with_can_be_satisfied_across_bunks(self):
        """Solver can choose to satisfy bunk_with by putting campers together."""
        # 2 campers, 2 bunks - solver should put them in same bunk to satisfy
        camper1 = create_person(cm_id=1001, first_name="Alice", last_name="Test", gender="F", grade=5)
        camper2 = create_person(cm_id=1002, first_name="Beth", last_name="Test", gender="F", grade=5)
        bunk1 = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)
        bunk2 = create_bunk(cm_id=2002, name="G-2", gender="F", capacity=12)

        request = create_request(
            request_id="req-1",
            requester_cm_id=1001,
            requested_cm_id=1002,
            request_type="bunk_with",
        )

        ctx = build_solver_context(
            persons=[camper1, camper2],
            bunks=[bunk1, bunk2],
            requests=[request],
        )

        # Create satisfaction variables
        requests_by_person = {1001: [request]}
        sat_vars = add_bunk_request_satisfaction_vars(ctx, requests_by_person)

        # Add objective to maximize satisfaction
        assert 1001 in sat_vars
        ctx.model.Maximize(sum(sat_vars[1001]))

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)

        # Both should be in same bunk
        bunk1_idx = ctx.bunk_idx_map[2001]
        bunk2_idx = ctx.bunk_idx_map[2002]

        c1_in_b1 = solver.Value(ctx.assignments[(0, bunk1_idx)])
        c1_in_b2 = solver.Value(ctx.assignments[(0, bunk2_idx)])
        c2_in_b1 = solver.Value(ctx.assignments[(1, bunk1_idx)])
        c2_in_b2 = solver.Value(ctx.assignments[(1, bunk2_idx)])

        # Either both in bunk1 or both in bunk2
        assert (c1_in_b1 == 1 and c2_in_b1 == 1) or (c1_in_b2 == 1 and c2_in_b2 == 1)

    def test_bunk_with_invalid_when_requested_not_in_solver(self):
        """bunk_with returns None if requested person not in solver context."""
        camper1 = create_person(cm_id=1001, first_name="Alice", last_name="Test", gender="F", grade=5)
        bunk = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)

        # Request for person not in context
        request = create_request(
            request_id="req-1",
            requester_cm_id=1001,
            requested_cm_id=9999,  # Not in context
            request_type="bunk_with",
        )

        ctx = build_solver_context(
            persons=[camper1],
            bunks=[bunk],
            requests=[request],
        )

        # Create satisfaction variables
        requests_by_person = {1001: [request]}
        sat_vars = add_bunk_request_satisfaction_vars(ctx, requests_by_person)

        # Should have no satisfaction vars (invalid request)
        assert 1001 not in sat_vars or len(sat_vars.get(1001, [])) == 0


class TestNotBunkWithSatisfaction:
    """Test not_bunk_with request satisfaction."""

    def test_not_bunk_with_satisfied_when_separated(self):
        """not_bunk_with request is satisfied when campers in different bunks."""
        camper1 = create_person(cm_id=1001, first_name="Alice", last_name="Test", gender="F", grade=5)
        camper2 = create_person(cm_id=1002, first_name="Beth", last_name="Test", gender="F", grade=5)
        bunk1 = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)
        bunk2 = create_bunk(cm_id=2002, name="G-2", gender="F", capacity=12)

        request = create_request(
            request_id="req-1",
            requester_cm_id=1001,
            requested_cm_id=1002,
            request_type="not_bunk_with",
        )

        ctx = build_solver_context(
            persons=[camper1, camper2],
            bunks=[bunk1, bunk2],
            requests=[request],
        )

        # Create satisfaction variables
        requests_by_person = {1001: [request]}
        sat_vars = add_bunk_request_satisfaction_vars(ctx, requests_by_person)

        # Add objective to maximize satisfaction
        assert 1001 in sat_vars
        ctx.model.Maximize(sum(sat_vars[1001]))

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)

        # Should be in different bunks
        bunk1_idx = ctx.bunk_idx_map[2001]

        c1_in_b1 = solver.Value(ctx.assignments[(0, bunk1_idx)])
        c2_in_b1 = solver.Value(ctx.assignments[(1, bunk1_idx)])

        # They should NOT both be in the same bunk
        assert not (c1_in_b1 == 1 and c2_in_b1 == 1)

    def test_not_bunk_with_not_satisfied_when_forced_together(self):
        """not_bunk_with request cannot be satisfied if only one bunk available."""
        camper1 = create_person(cm_id=1001, first_name="Alice", last_name="Test", gender="F", grade=5)
        camper2 = create_person(cm_id=1002, first_name="Beth", last_name="Test", gender="F", grade=5)
        bunk = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)

        request = create_request(
            request_id="req-1",
            requester_cm_id=1001,
            requested_cm_id=1002,
            request_type="not_bunk_with",
        )

        ctx = build_solver_context(
            persons=[camper1, camper2],
            bunks=[bunk],  # Only one bunk - can't separate
            requests=[request],
        )

        # Create satisfaction variables (returns empty since only 1 bunk)
        requests_by_person = {1001: [request]}
        add_bunk_request_satisfaction_vars(ctx, requests_by_person)

        # Solve (still feasible, just request unsatisfied)
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)

        # Both forced into same bunk
        bunk_idx = ctx.bunk_idx_map[2001]
        assert solver.Value(ctx.assignments[(0, bunk_idx)]) == 1
        assert solver.Value(ctx.assignments[(1, bunk_idx)]) == 1


class TestMultipleRequests:
    """Test multiple requests from same person."""

    def test_multiple_bunk_with_requests(self):
        """Multiple bunk_with requests can be tracked."""
        camper1 = create_person(cm_id=1001, first_name="Alice", last_name="Test", gender="F", grade=5)
        camper2 = create_person(cm_id=1002, first_name="Beth", last_name="Test", gender="F", grade=5)
        camper3 = create_person(cm_id=1003, first_name="Carol", last_name="Test", gender="F", grade=5)
        bunk = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)

        # Alice wants to bunk with both Beth and Carol
        request1 = create_request(
            request_id="req-1",
            requester_cm_id=1001,
            requested_cm_id=1002,
            request_type="bunk_with",
        )
        request2 = create_request(
            request_id="req-2",
            requester_cm_id=1001,
            requested_cm_id=1003,
            request_type="bunk_with",
        )

        ctx = build_solver_context(
            persons=[camper1, camper2, camper3],
            bunks=[bunk],
            requests=[request1, request2],
        )

        # Create satisfaction variables
        requests_by_person = {1001: [request1, request2]}
        sat_vars = add_bunk_request_satisfaction_vars(ctx, requests_by_person)

        # Should have 2 satisfaction variables for camper 1001
        assert 1001 in sat_vars
        assert len(sat_vars[1001]) == 2

    def test_mixed_request_types(self):
        """Mix of bunk_with and not_bunk_with for same person."""
        camper1 = create_person(cm_id=1001, first_name="Alice", last_name="Test", gender="F", grade=5)
        camper2 = create_person(cm_id=1002, first_name="Beth", last_name="Test", gender="F", grade=5)
        camper3 = create_person(cm_id=1003, first_name="Carol", last_name="Test", gender="F", grade=5)
        bunk1 = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)
        bunk2 = create_bunk(cm_id=2002, name="G-2", gender="F", capacity=12)

        # Alice wants to bunk with Beth, but NOT with Carol
        request1 = create_request(
            request_id="req-1",
            requester_cm_id=1001,
            requested_cm_id=1002,
            request_type="bunk_with",
        )
        request2 = create_request(
            request_id="req-2",
            requester_cm_id=1001,
            requested_cm_id=1003,
            request_type="not_bunk_with",
        )

        ctx = build_solver_context(
            persons=[camper1, camper2, camper3],
            bunks=[bunk1, bunk2],
            requests=[request1, request2],
        )

        # Create satisfaction variables
        requests_by_person = {1001: [request1, request2]}
        sat_vars = add_bunk_request_satisfaction_vars(ctx, requests_by_person)

        # Maximize all satisfaction
        assert 1001 in sat_vars
        ctx.model.Maximize(sum(sat_vars[1001]))

        # Solve
        solver = cp_model.CpSolver()
        status = solver.Solve(ctx.model)

        assert is_optimal_or_feasible(status)

        # Verify: Alice and Beth together, Carol separate
        bunk1_idx = ctx.bunk_idx_map[2001]

        alice_idx = ctx.person_idx_map[1001]
        beth_idx = ctx.person_idx_map[1002]
        carol_idx = ctx.person_idx_map[1003]

        alice_bunk = 1 if solver.Value(ctx.assignments[(alice_idx, bunk1_idx)]) else 2
        beth_bunk = 1 if solver.Value(ctx.assignments[(beth_idx, bunk1_idx)]) else 2
        carol_bunk = 1 if solver.Value(ctx.assignments[(carol_idx, bunk1_idx)]) else 2

        # Alice and Beth should be together
        assert alice_bunk == beth_bunk
        # Carol should be separate from Alice
        assert alice_bunk != carol_bunk


class TestRequestEdgeCases:
    """Test edge cases for request handling."""

    def test_request_with_no_requested_person(self):
        """Request with None requested_person_cm_id is skipped."""
        camper = create_person(cm_id=1001, first_name="Alice", last_name="Test", gender="F", grade=5)
        bunk = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)

        request = create_request(
            request_id="req-1",
            requester_cm_id=1001,
            requested_cm_id=None,  # No target
            request_type="bunk_with",
        )

        ctx = build_solver_context(
            persons=[camper],
            bunks=[bunk],
            requests=[request],
        )

        # Create satisfaction variables
        requests_by_person = {1001: [request]}
        sat_vars = add_bunk_request_satisfaction_vars(ctx, requests_by_person)

        # Should have no satisfaction vars
        assert 1001 not in sat_vars or len(sat_vars.get(1001, [])) == 0

    def test_requester_not_in_solver(self):
        """Request from person not in solver is skipped."""
        camper = create_person(cm_id=1001, first_name="Alice", last_name="Test", gender="F", grade=5)
        bunk = create_bunk(cm_id=2001, name="G-1", gender="F", capacity=12)

        request = create_request(
            request_id="req-1",
            requester_cm_id=9999,  # Not in context
            requested_cm_id=1001,
            request_type="bunk_with",
        )

        ctx = build_solver_context(
            persons=[camper],
            bunks=[bunk],
            requests=[request],
        )

        # Create satisfaction variables
        requests_by_person = {9999: [request]}
        sat_vars = add_bunk_request_satisfaction_vars(ctx, requests_by_person)

        # Should have no satisfaction vars
        assert 9999 not in sat_vars
