"""GradeCompatibilityImpossibility: bunks span max 2 consecutive grades.

Pair layer: a bunk_with pair whose grade gap > max_grade_range - 1
cannot co-occupy any bunk satisfying grade_spread + grade_adjacency.
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


def test_grade_compatibility_no_cluster_check_emitted(mock_config):
    """After Stage 4 hard MSO cleanup, GradeCompatibilityImpossibility no longer emits cluster_grade_compatibility.

    A 5-camper chain spanning grades 3-7 (g3→g4→g5→g6→g7) must NOT produce a
    cluster_grade_compatibility reason; only pair-level grade_compatibility for
    cross-grade pairs whose gap > 1.

    Each adjacent pair (g3-g4, g4-g5, g5-g6, g6-g7) has gap=1, which is ≤ max_gap_allowed=1
    (max_grade_range=2 → max_gap=1), so no pair-level flags for those.
    The cluster span (g3..g7, range=4) would have triggered the old cluster_grade_compatibility
    check — after Task A5 removes check_cluster, that code no longer runs.
    """
    from bunking.solver.impossibility import validate_impossibility

    # 5-camper chain: each camper is one grade apart, so no pair is individually impossible
    # but the cluster spans grades 3-7 (range=4 > max_grade_range=2).
    p1 = make_person(1, session=100, gender="F", grade=3)
    p2 = make_person(2, session=100, gender="F", grade=4)
    p3 = make_person(3, session=100, gender="F", grade=5)
    p4 = make_person(4, session=100, gender="F", grade=6)
    p5 = make_person(5, session=100, gender="F", grade=7)
    # Chain: 1→2→3→4→5 (each adjacent pair has gap=1, within range)
    reqs = [
        make_request("r1", requester=1, requestee=2, session=100),
        make_request("r2", requester=2, requestee=3, session=100),
        make_request("r3", requester=3, requestee=4, session=100),
        make_request("r4", requester=4, requestee=5, session=100),
    ]
    input_data = make_input([p1, p2, p3, p4, p5], [make_bunk(10, session=100)], reqs)

    report = validate_impossibility(input_data, mock_config)

    for item in report.flat:
        assert item.reason_code != "cluster_grade_compatibility", (
            f"cluster_grade_compatibility should be deleted, got {item}"
        )
