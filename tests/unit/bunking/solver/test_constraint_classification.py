"""Invariant tests for constraint_classification.py — Stream C.

These exist to catch maintenance drift: if a future PR adds a new constraint
module or changes a constraint's tier, the classification (and the
find_infeasibility_cause probe list) must be updated in lockstep. These tests
fail loudly if that doesn't happen.
"""

from bunking.solver.constraint_classification import (
    INFO_ONLY_CONSTRAINTS,
    INVIOLABLE_CONSTRAINTS,
    SOLVER_RELAXABLE_CONSTRAINTS,
)


class TestClassificationInvariants:
    def test_tiers_are_disjoint(self):
        """Each constraint name belongs to exactly one tier."""
        assert INVIOLABLE_CONSTRAINTS.isdisjoint(SOLVER_RELAXABLE_CONSTRAINTS)
        assert INVIOLABLE_CONSTRAINTS.isdisjoint(INFO_ONLY_CONSTRAINTS)
        assert SOLVER_RELAXABLE_CONSTRAINTS.isdisjoint(INFO_ONLY_CONSTRAINTS)

    def test_diagnostic_probe_list_matches_info_only(self):
        """find_infeasibility_cause's probe list must equal INFO_ONLY_CONSTRAINTS.

        Drift here = either INFO_ONLY has an entry the probe doesn't test
        (silent diagnostic blind spot), or the probe tests something not in
        INFO_ONLY (wasted probe solve, possibly probing an INVIOLABLE).
        """
        from bunking.solver.feasibility import _DIAGNOSTIC_PROBE_CONSTRAINTS

        assert frozenset(_DIAGNOSTIC_PROBE_CONSTRAINTS) == INFO_ONLY_CONSTRAINTS

    def test_capacity_is_the_sole_solver_relaxable(self):
        """If we ever add another SOLVER_RELAXABLE class, the orchestrator
        needs a corresponding probe + objective module. This test forces a
        conscious update."""
        assert frozenset({"cabin_capacity"}) == SOLVER_RELAXABLE_CONSTRAINTS

    def test_diagnostic_probe_order_is_deterministic(self):
        """#3: find_infeasibility_cause must probe constraints in a stable
        (sorted) order. Iterating the frozenset directly makes the
        first-feasible reported cause flip between processes (PYTHONHASHSEED);
        sorted() pins it. This drives all probes to INFEASIBLE and captures the
        order constraints are disabled in."""
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
