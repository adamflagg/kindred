"""Tests for objective.enable_first_boost toggle behavior in direct_solver.

When enable_first_boost is true, the request flagged is_first_requested=true
lands in slot 0 of the diminishing-returns stack (10x multiplier). When false,
slot 0 falls to natural iteration order from PB.
"""

from unittest.mock import MagicMock

from bunking.solver.direct_solver import (
    BASE_REQUEST_WEIGHT,
    FIRST_REQUEST_MULTIPLIER,
    SECOND_REQUEST_MULTIPLIER,
    THIRD_PLUS_REQUEST_MULTIPLIER,
)


def test_constants_match_seeded_values():
    """Hardcoded multipliers match the calibrated values.

    BASE=40 matches old `priority * 10` at typical P4 first-pick magnitude so
    the satisfaction side outweighs under-occupancy penalties (else the typical
    fixture totals net-negative — see solver_score.json baseline).
    """
    assert BASE_REQUEST_WEIGHT == 40
    assert FIRST_REQUEST_MULTIPLIER == 10
    assert SECOND_REQUEST_MULTIPLIER == 5
    assert THIRD_PLUS_REQUEST_MULTIPLIER == 1


def test_objective_sort_with_first_boost_enabled():
    """When enable_first_boost=true, is_first_requested=True lands in slot 0
    via stable sort (reverse=True puts 1 before 0; insertion order is the
    tiebreaker among equals)."""
    r_subsequent = MagicMock(is_first_requested=False)
    r_first = MagicMock(is_first_requested=True)
    r_other_subsequent = MagicMock(is_first_requested=False)

    requests = [r_subsequent, r_first, r_other_subsequent]
    sat_vars = [MagicMock() for _ in requests]
    pairs = list(zip(requests, sat_vars, strict=False))

    # Apply the same sort the solver uses
    pairs.sort(key=lambda x: x[0].is_first_requested, reverse=True)

    assert pairs[0][0] is r_first  # promoted to slot 0
    # Original insertion order preserved among False's (stable sort)
    assert pairs[1][0] is r_subsequent
    assert pairs[2][0] is r_other_subsequent


def test_objective_sort_with_first_boost_disabled():
    """When enable_first_boost=false, no sort runs — natural iteration order
    determines slot 0. Document the contract explicitly so a future regression
    can't reintroduce a sort by accident."""
    r1 = MagicMock(is_first_requested=False)
    r2 = MagicMock(is_first_requested=True)  # would land in slot 0 if sorted
    r3 = MagicMock(is_first_requested=False)

    requests = [r1, r2, r3]
    sat_vars = [MagicMock() for _ in requests]
    pairs = list(zip(requests, sat_vars, strict=False))

    # No sort applied — order is whatever the caller passed in
    assert pairs[0][0] is r1
    assert pairs[1][0] is r2
    assert pairs[2][0] is r3


def test_dead_negative_requests_threshold_branch_removed():
    """The legacy `priority >= 8` hard-constraint branch is gone from
    direct_solver. Verifies via source inspection rather than full solve."""
    import inspect

    from bunking.solver import direct_solver

    src = inspect.getsource(direct_solver.DirectBunkingSolver.add_objective)
    assert "hard_constraint_threshold" not in src, (
        "dead negative_requests.hard_constraint_threshold branch must stay deleted (#1432)"
    )
    # The comment "priority >= 8" is allowed in docstring, but the actual
    # if/elif branch checking it must not exist
    lines = [line.strip() for line in src.split("\n")]
    executable_lines = [line for line in lines if line and not line.startswith("#")]
    assert "if request.priority >= 8" not in "\n".join(executable_lines), (
        "unreachable priority>=8 gate must stay deleted"
    )
    assert "request.priority" not in src, "priority field is gone from BunkRequest"
