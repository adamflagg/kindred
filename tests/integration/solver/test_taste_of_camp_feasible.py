"""Regression: Taste 1 scenario is FEASIBLE after impossibility detection.

The case (reciprocal bunk_with across grades 3-5) caused Stage 4 hard MSO
to return INFEASIBLE. With grade_compatibility detection, both reciprocal
requests are classified impossible upstream — the hard MSO no longer fires
for either camper, and the solver returns a non-None DirectSolverOutput.

Ship-gate for Stream 6 in PR #1391.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from bunking.config import ConfigLoader
from bunking.solver.direct_solver import DirectBunkingSolver
from bunking.solver.impossibility import validate_impossibility
from tests.unit.solver.impossibility.conftest import (
    make_bunk,
    make_input,
    make_person,
    make_request,
)


@pytest.fixture
def mock_config():
    """ConfigLoader mock that returns proper typed defaults for every solver call.

    get_constraint, get_int, get_float, and get_str each forward to the
    real default via their `default=` keyword argument so that type-checked
    comparisons (e.g. ``age_spread_weight > 0``) work correctly.
    """
    cfg = MagicMock()

    def _get_constraint(constraint_type, param, default=None):
        # grade_spread.max_spread → 2 (hard constraint, 2 unique grades/bunk)
        if constraint_type == "grade_spread" and param == "max_spread":
            return 2
        # Return default for everything else (age_spread, grade_ratio, etc.)
        return default if default is not None else 0

    def _get_int(key, default=None):
        return default if default is not None else 0

    def _get_float(key, default=None):
        return default if default is not None else 0.0

    def _get_str(key, default=None):
        if "grade_spread.mode" in key:
            return "hard"
        return default if default is not None else ""

    def _get_bool(key, default=None):
        return default if default is not None else False

    def _get_soft_constraint_weight(constraint_name):
        # Return 0 for all soft constraint weights — disables soft penalties
        # so the solver only enforces hard constraints (assignment, capacity,
        # grade_spread, grade_adjacency, session_boundary, min_occupancy).
        return 0

    cfg.get_constraint.side_effect = _get_constraint
    cfg.get_int.side_effect = _get_int
    cfg.get_float.side_effect = _get_float
    cfg.get_str.side_effect = _get_str
    cfg.get_bool.side_effect = _get_bool
    cfg.get_soft_constraint_weight.side_effect = _get_soft_constraint_weight
    return cfg


def _build_scenario():
    """Build the Taste-1 smoking-gun scenario.

    26 female campers:
      9 in grade 3  (cm_ids 1-8 + person 101)
      8 in grade 4  (cm_ids 9-16)
      9 in grade 5  (cm_ids 17-24 + person 102)

    3 bunks, capacity 10 each (30 spots for 26 campers → constraint OK).

    Grade adjacency (hard): gap > 1 forbidden in same bunk, so grades 3 & 5
    can never coexist in the same bunk regardless of requests.

    Reciprocal bunk_with:  person 101 (grade 3) ↔ person 102 (grade 5).
    gap = 2 > max_gap_allowed(1) → grade_compatibility predicate fires for both.
    """
    persons = (
        [make_person(i, session=1000001, gender="F", grade=3) for i in range(1, 9)]
        + [make_person(i, session=1000001, gender="F", grade=4) for i in range(9, 17)]
        + [make_person(i, session=1000001, gender="F", grade=5) for i in range(17, 25)]
    )
    persons.append(make_person(101, session=1000001, gender="F", grade=3))
    persons.append(make_person(102, session=1000001, gender="F", grade=5))

    bunks = [
        make_bunk(1001, session=1000001, gender="F", capacity=10),
        make_bunk(1002, session=1000001, gender="F", capacity=10),
        make_bunk(1003, session=1000001, gender="F", capacity=10),
    ]

    requests = [
        make_request(
            "r_a_b",
            requester=101,
            requestee=102,
            request_type="bunk_with",
            source_field="bunk_request_form",
            session=1000001,
        ),
        make_request(
            "r_b_a",
            requester=102,
            requestee=101,
            request_type="bunk_with",
            source_field="bunk_request_form",
            session=1000001,
        ),
    ]
    return make_input(persons, bunks, requests)


def test_reciprocal_bunk_with_across_grades_is_classified_impossible(mock_config):
    """Both directions of the cross-grade pair must be classified impossible.

    Verifies the predicate fires before we even touch the OR-Tools model.
    """
    input_data = _build_scenario()

    report = validate_impossibility(input_data, mock_config)
    flagged_ids = {item.request_id for item in report.flat}

    assert "r_a_b" in flagged_ids, (
        "r_a_b (grade 3 → grade 5, gap=2) was not classified impossible by grade_compatibility predicate"
    )
    assert "r_b_a" in flagged_ids, (
        "r_b_a (grade 5 → grade 3, gap=2) was not classified impossible by grade_compatibility predicate"
    )

    a_b_item = next(item for item in report.flat if item.request_id == "r_a_b")
    assert a_b_item.reason_code == "grade_compatibility", (
        f"Expected reason_code='grade_compatibility', got '{a_b_item.reason_code}'"
    )
    assert a_b_item.detail["gap"] == 2, f"Expected gap=2 in detail, got {a_b_item.detail.get('gap')}"


def test_solver_returns_feasible_with_predicate_active(mock_config):
    """End-to-end ship-gate: solver completes FEASIBLE after grade_compatibility
    drops both reciprocal requests from possible_requests.

    Without the predicate, both hard bunk_with requests would remain in scope
    and the OR-Tools model would become INFEASIBLE (grades 3 and 5 cannot
    share a bunk due to the grade_adjacency hard constraint).

    With the predicate active, both are flagged impossible pre-solve; the
    hard MSO never fires; the solver finds a valid assignment.

    DirectBunkingSolver.solve() returns DirectSolverOutput | None.
    None indicates the solver failed (INFEASIBLE, MODEL_INVALID, or UNKNOWN).

    Some penalty functions (min_occupancy_penalty, grade_spread_penalty) use
    ConfigLoader.get_instance() directly instead of the injected config, so
    we inject the mock as the singleton for the duration of the solve.
    """
    input_data = _build_scenario()

    # Inject mock as the ConfigLoader singleton so that penalty functions
    # that call ConfigLoader.get_instance() also return clean integers.
    with ConfigLoader.use(mock_config):
        solver = DirectBunkingSolver(input_data, mock_config)
        result = solver.solve()

    assert result is not None, (
        "solver.solve() returned None (INFEASIBLE/failure). "
        "The grade_compatibility predicate should have dropped both cross-grade "
        "bunk_with requests from possible_requests before the OR-Tools model ran. "
        "Check _validate_requests() and GradeCompatibilityImpossibility.check_pair()."
    )

    # Extra signal: every camper should be assigned
    assert len(result.assignments) == 26, f"Expected 26 assignments, got {len(result.assignments)}"
