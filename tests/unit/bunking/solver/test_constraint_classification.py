"""Invariant tests for constraint_classification.py — Stream D (four-tier model).

These exist to catch maintenance drift: if a future PR adds a new constraint
module or changes a constraint's tier, the classification (and the
find_infeasibility_cause probe list) must be updated in lockstep. These tests
fail loudly if that doesn't happen.
"""

from bunking.solver.constraint_classification import (
    ALL_HARD_CONSTRAINTS,
    CAPACITY_RELAXABLE,
    INFO_ONLY_CONSTRAINTS,
    INVIOLABLE_ALWAYS,
    INVIOLABLE_CONSTRAINTS,
    REQUEST_RELAXABLE,
    SOLVER_RELAXABLE_CONSTRAINTS,
    STRUCTURAL_HARD,
    break_glass_relaxable_constraints,
    diagnostic_probe_constraints,
)


class TestClassificationInvariants:
    def test_four_tiers_are_pairwise_disjoint(self):
        """Each constraint name belongs to exactly one tier."""
        assert INVIOLABLE_ALWAYS.isdisjoint(STRUCTURAL_HARD)
        assert INVIOLABLE_ALWAYS.isdisjoint(REQUEST_RELAXABLE)
        assert INVIOLABLE_ALWAYS.isdisjoint(CAPACITY_RELAXABLE)
        assert STRUCTURAL_HARD.isdisjoint(REQUEST_RELAXABLE)
        assert STRUCTURAL_HARD.isdisjoint(CAPACITY_RELAXABLE)
        assert REQUEST_RELAXABLE.isdisjoint(CAPACITY_RELAXABLE)

    def test_all_hard_constraints_is_union_of_four_tiers(self):
        """ALL_HARD_CONSTRAINTS must equal the union of all four tiers and the
        expected 9 constraint names."""
        assert ALL_HARD_CONSTRAINTS == (INVIOLABLE_ALWAYS | STRUCTURAL_HARD | REQUEST_RELAXABLE | CAPACITY_RELAXABLE)
        assert (
            frozenset(
                {
                    "gender",
                    "session_boundary",
                    "grade_spread",
                    "grade_adjacency",
                    "age_spread",
                    "group_locks",
                    "parent_paramount",
                    "staff_separation",
                    "cabin_capacity",
                }
            )
            == ALL_HARD_CONSTRAINTS
        )

    def test_diagnostic_probe_equals_structural_hard(self):
        """diagnostic_probe_constraints() must equal STRUCTURAL_HARD.

        Post-break-glass, REQUEST_RELAXABLE constraints have already been
        softened — they must NOT appear in the probe list. Probing them would
        be a wasted solve and would misattribute residual infeasibility to
        request conflicts that break-glass already handled.
        """
        from bunking.solver.feasibility import _DIAGNOSTIC_PROBE_CONSTRAINTS

        assert diagnostic_probe_constraints() == STRUCTURAL_HARD
        assert frozenset(_DIAGNOSTIC_PROBE_CONSTRAINTS) == STRUCTURAL_HARD

    def test_break_glass_relaxable_is_request_plus_capacity(self):
        """break_glass_relaxable_constraints() must equal REQUEST_RELAXABLE | CAPACITY_RELAXABLE."""
        assert break_glass_relaxable_constraints() == frozenset(
            {"parent_paramount", "staff_separation", "cabin_capacity"}
        )
        assert break_glass_relaxable_constraints() == REQUEST_RELAXABLE | CAPACITY_RELAXABLE

    def test_capacity_is_the_sole_capacity_relaxable(self):
        """If we ever add another CAPACITY_RELAXABLE class, the orchestrator
        needs a corresponding probe + objective module. This test forces a
        conscious update."""
        assert frozenset({"cabin_capacity"}) == CAPACITY_RELAXABLE

    def test_grade_adjacency_is_in_structural_hard_and_probed(self):
        """Regression for Stream D Phase 1: grade_adjacency was an unclassified
        hard constraint; it must be in STRUCTURAL_HARD and in the diagnostic
        probe list."""
        from bunking.solver.feasibility import _DIAGNOSTIC_PROBE_CONSTRAINTS

        assert "grade_adjacency" in STRUCTURAL_HARD
        assert "grade_adjacency" in _DIAGNOSTIC_PROBE_CONSTRAINTS

    def test_back_compat_aliases_resolve(self):
        """Back-compat aliases for consumers still importing the 3-tier names."""
        assert INVIOLABLE_CONSTRAINTS == INVIOLABLE_ALWAYS
        assert SOLVER_RELAXABLE_CONSTRAINTS == CAPACITY_RELAXABLE
        assert INFO_ONLY_CONSTRAINTS == STRUCTURAL_HARD | REQUEST_RELAXABLE

    def test_diagnostic_probe_order_is_deterministic(self):
        """find_infeasibility_cause must probe constraints in a stable (sorted)
        order. Iterating the frozenset directly makes the first-feasible reported
        cause flip between processes (PYTHONHASHSEED); sorted() pins it. This
        drives all probes to INFEASIBLE and captures the order constraints are
        disabled in."""
        from unittest.mock import MagicMock, patch

        from ortools.sat.python import cp_model

        import bunking.solver
        from bunking.solver.feasibility import _DIAGNOSTIC_PROBE_CONSTRAINTS, find_infeasibility_cause

        constructed_debug_constraints: list[dict[str, bool]] = []

        def _fake_solver(input_data, config, debug_constraints, impossibility_report=None):
            constructed_debug_constraints.append(debug_constraints)
            inst = MagicMock()
            inst.impossibility_report = MagicMock()
            inst.model = MagicMock()
            return inst

        fake_cp_solver = MagicMock()
        fake_cp_solver.Solve.return_value = cp_model.INFEASIBLE
        fake_cp_solver.StatusName.return_value = "INFEASIBLE"

        with (
            patch.object(bunking.solver, "DirectBunkingSolver", side_effect=_fake_solver),
            patch("bunking.solver.feasibility.cp_model.CpSolver", return_value=fake_cp_solver),
        ):
            find_infeasibility_cause(MagicMock(), MagicMock(), time_limit_seconds=1)

        # First construction is the all-enabled probe ({}); the rest disable one
        # constraint each, in probe order.
        probe_order = [next(iter(d)) for d in constructed_debug_constraints[1:]]
        assert probe_order == sorted(_DIAGNOSTIC_PROBE_CONSTRAINTS)
