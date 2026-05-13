"""GradeCompatibilityImpossibility: bunks span max 2 consecutive grades.

Pair layer: a bunk_with pair whose grade gap > max_grade_range - 1
cannot co-occupy any bunk satisfying grade_spread + grade_adjacency.

Cluster layer added in Task 9.
"""

from __future__ import annotations

from bunking.solver.constraints.grade_spread import GradeCompatibilityImpossibility
from bunking.solver.impossibility import _build_context

from .conftest import make_bunk, make_input, make_person, make_request


PREDICATE = GradeCompatibilityImpossibility()


def test_same_grade_pair_is_not_impossible(mock_config):
    p1 = make_person(1, session=100, gender="F", grade=4)
    p2 = make_person(2, session=100, gender="F", grade=4)
    req = make_request("r1", requester=1, requestee=2, session=100)
    input_data = make_input([p1, p2], [make_bunk(10, session=100)], [req])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_pair(req, ctx) is None


def test_consecutive_grade_pair_is_not_impossible(mock_config):
    p1 = make_person(1, session=100, gender="F", grade=4)
    p2 = make_person(2, session=100, gender="F", grade=5)
    req = make_request("r1", requester=1, requestee=2, session=100)
    input_data = make_input([p1, p2], [make_bunk(10, session=100)], [req])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_pair(req, ctx) is None


def test_two_grade_gap_is_impossible(mock_config):
    """The smoking-gun case: g3 + g5 cannot co-occupy a 2-grade-range bunk."""
    p1 = make_person(1, session=100, gender="F", grade=3)
    p2 = make_person(2, session=100, gender="F", grade=5)
    req = make_request("r1", requester=1, requestee=2, session=100)
    input_data = make_input([p1, p2], [make_bunk(10, session=100)], [req])
    ctx = _build_context(input_data, mock_config)

    reason = PREDICATE.check_pair(req, ctx)
    assert reason is not None
    assert reason.code == "grade_compatibility"
    assert reason.detail["gap"] == 2
    assert reason.detail["max_gap_allowed"] == 1


def test_three_grade_gap_is_impossible(mock_config):
    p1 = make_person(1, session=100, gender="F", grade=3)
    p2 = make_person(2, session=100, gender="F", grade=6)
    req = make_request("r1", requester=1, requestee=2, session=100)
    input_data = make_input([p1, p2], [make_bunk(10, session=100)], [req])
    ctx = _build_context(input_data, mock_config)

    reason = PREDICATE.check_pair(req, ctx)
    assert reason is not None
    assert reason.detail["gap"] == 3


def test_not_bunk_with_grade_gap_is_not_impossible(mock_config):
    """Separation requests don't need a shared bunk; gap doesn't matter."""
    p1 = make_person(1, session=100, gender="F", grade=3)
    p2 = make_person(2, session=100, gender="F", grade=5)
    req = make_request("r1", requester=1, requestee=2, request_type="not_bunk_with", session=100)
    input_data = make_input([p1, p2], [make_bunk(10, session=100)], [req])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_pair(req, ctx) is None


def test_reciprocal_pair_both_flagged(mock_config):
    """A→B and B→A should both flag — neither alone breaks the cycle."""
    p1 = make_person(1, session=100, gender="F", grade=3)
    p2 = make_person(2, session=100, gender="F", grade=5)
    req_a = make_request("r1", requester=1, requestee=2, session=100)
    req_b = make_request("r2", requester=2, requestee=1, session=100)
    input_data = make_input([p1, p2], [make_bunk(10, session=100)], [req_a, req_b])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_pair(req_a, ctx) is not None
    assert PREDICATE.check_pair(req_b, ctx) is not None
