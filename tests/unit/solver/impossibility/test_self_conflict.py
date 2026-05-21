"""SelfConflictImpossibility: bunk_with + not_bunk_with to same target from same requester.

Tests exercise the predicate in isolation (direct class instantiation) and
through the full validate_impossibility() pipeline.
"""

from bunking.solver.constraints.self_conflict import SelfConflictImpossibility
from bunking.solver.impossibility import _build_context, validate_impossibility

from .conftest import make_bunk, make_input, make_person, make_request

PREDICATE = SelfConflictImpossibility()


# ---------------------------------------------------------------------------
# Predicate-level tests (check_request)
# ---------------------------------------------------------------------------


def test_bunk_with_only_is_not_self_conflicting(mock_config):
    """A single bunk_with request with no counterpart is not a self-conflict."""
    p1 = make_person(1, session=1000)
    p2 = make_person(2, session=1000)
    req_bw = make_request("r_bw", requester=1, requestee=2, request_type="bunk_with", session=1000)
    input_data = make_input([p1, p2], [make_bunk(10, session=1000)], [req_bw])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_request(req_bw, ctx) is None


def test_not_bunk_with_only_is_not_self_conflicting(mock_config):
    """A single not_bunk_with request with no counterpart is not a self-conflict."""
    p1 = make_person(1, session=1000)
    p2 = make_person(2, session=1000)
    req_nbw = make_request("r_nbw", requester=1, requestee=2, request_type="not_bunk_with", session=1000)
    input_data = make_input([p1, p2], [make_bunk(10, session=1000)], [req_nbw])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_request(req_nbw, ctx) is None


def test_bunk_with_with_counter_not_bunk_with_is_self_conflict(mock_config):
    """Emma has bunk_with Liam AND not_bunk_with Liam — the bunk_with side is flagged."""
    p_emma = make_person(1, session=1000)
    p_liam = make_person(2, session=1000)
    req_bw = make_request("r_bw", requester=1, requestee=2, request_type="bunk_with", session=1000)
    req_nbw = make_request("r_nbw", requester=1, requestee=2, request_type="not_bunk_with", session=1000)
    input_data = make_input([p_emma, p_liam], [make_bunk(10, session=1000)], [req_bw, req_nbw])
    ctx = _build_context(input_data, mock_config)

    reason = PREDICATE.check_request(req_bw, ctx)
    assert reason is not None
    assert reason.code == "self_conflict"
    assert "not_bunk_with" in reason.message or "conflict" in reason.message.lower()
    assert reason.detail["conflicting_request_id"] == "r_nbw"
    assert reason.detail["requested_person_cm_id"] == 2


def test_not_bunk_with_with_counter_bunk_with_is_self_conflict(mock_config):
    """The not_bunk_with side of the same pair is also flagged independently."""
    p_emma = make_person(1, session=1000)
    p_liam = make_person(2, session=1000)
    req_bw = make_request("r_bw", requester=1, requestee=2, request_type="bunk_with", session=1000)
    req_nbw = make_request("r_nbw", requester=1, requestee=2, request_type="not_bunk_with", session=1000)
    input_data = make_input([p_emma, p_liam], [make_bunk(10, session=1000)], [req_bw, req_nbw])
    ctx = _build_context(input_data, mock_config)

    reason = PREDICATE.check_request(req_nbw, ctx)
    assert reason is not None
    assert reason.code == "self_conflict"
    assert reason.detail["conflicting_request_id"] == "r_bw"
    assert reason.detail["requested_person_cm_id"] == 2


def test_different_target_is_not_self_conflict(mock_config):
    """bunk_with Olivia + not_bunk_with Liam — different targets, not a conflict."""
    p_emma = make_person(1, session=1000)
    p_liam = make_person(2, session=1000)
    p_olivia = make_person(3, session=1000)
    req_bw = make_request("r_bw", requester=1, requestee=3, request_type="bunk_with", session=1000)
    req_nbw = make_request("r_nbw", requester=1, requestee=2, request_type="not_bunk_with", session=1000)
    input_data = make_input(
        [p_emma, p_liam, p_olivia],
        [make_bunk(10, session=1000)],
        [req_bw, req_nbw],
    )
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_request(req_bw, ctx) is None
    assert PREDICATE.check_request(req_nbw, ctx) is None


def test_age_preference_request_is_ignored(mock_config):
    """age_preference requests are not bunk_with/not_bunk_with — predicate ignores them."""
    p1 = make_person(1, session=1000)
    req_age = make_request(
        "r_age",
        requester=1,
        requestee=None,
        request_type="age_preference",
        session=1000,
        age_preference_target="older",
    )
    input_data = make_input([p1], [make_bunk(10, session=1000)], [req_age])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_request(req_age, ctx) is None


def test_self_conflict_has_no_check_pair_effect(mock_config):
    """check_pair is not overridden — returns None (Layer 2 does not apply)."""
    p_emma = make_person(1, session=1000)
    p_liam = make_person(2, session=1000)
    req_bw = make_request("r_bw", requester=1, requestee=2, request_type="bunk_with", session=1000)
    req_nbw = make_request("r_nbw", requester=1, requestee=2, request_type="not_bunk_with", session=1000)
    input_data = make_input([p_emma, p_liam], [make_bunk(10, session=1000)], [req_bw, req_nbw])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_pair(req_bw, ctx) is None


# ---------------------------------------------------------------------------
# Pipeline-level tests (validate_impossibility)
# ---------------------------------------------------------------------------


def test_self_conflict_pair_appears_in_pipeline(mock_config):
    """Both requests in the contradictory pair appear in the pipeline report."""
    p_emma = make_person(1, session=1000)
    p_liam = make_person(2, session=1000)
    req_bw = make_request("r_bw", requester=1, requestee=2, request_type="bunk_with", session=1000)
    req_nbw = make_request("r_nbw", requester=1, requestee=2, request_type="not_bunk_with", session=1000)
    input_data = make_input([p_emma, p_liam], [make_bunk(10, session=1000)], [req_bw, req_nbw])

    report = validate_impossibility(input_data, mock_config)

    assert "self_conflict" in report.by_reason, f"Expected self_conflict bucket; got: {list(report.by_reason)}"
    flagged_ids = {item.request_id for item in report.by_reason["self_conflict"]}
    assert "r_bw" in flagged_ids, "bunk_with side not flagged"
    assert "r_nbw" in flagged_ids, "not_bunk_with side not flagged"


def test_self_conflict_total_impossible_counts_both_requests(mock_config):
    """total_impossible = 2 when both sides of the contradiction are flagged."""
    p_emma = make_person(1, session=1000)
    p_liam = make_person(2, session=1000)
    req_bw = make_request("r_bw", requester=1, requestee=2, request_type="bunk_with", session=1000)
    req_nbw = make_request("r_nbw", requester=1, requestee=2, request_type="not_bunk_with", session=1000)
    input_data = make_input([p_emma, p_liam], [make_bunk(10, session=1000)], [req_bw, req_nbw])

    report = validate_impossibility(input_data, mock_config)

    assert report.total_impossible == 2


def test_self_conflict_affected_campers_is_one(mock_config):
    """affected_campers = 1: Emma is the single requester, despite two flagged requests."""
    p_emma = make_person(1, session=1000)
    p_liam = make_person(2, session=1000)
    req_bw = make_request("r_bw", requester=1, requestee=2, request_type="bunk_with", session=1000)
    req_nbw = make_request("r_nbw", requester=1, requestee=2, request_type="not_bunk_with", session=1000)
    input_data = make_input([p_emma, p_liam], [make_bunk(10, session=1000)], [req_bw, req_nbw])

    report = validate_impossibility(input_data, mock_config)

    assert report.affected_campers == 1


def test_unrelated_request_not_caught_by_self_conflict(mock_config):
    """Emma's bunk_with Olivia (no counterpart) is not flagged as self-conflict."""
    p_emma = make_person(1, session=1000)
    p_liam = make_person(2, session=1000)
    p_olivia = make_person(3, session=1000)
    req_bw_liam = make_request("r_bw_liam", requester=1, requestee=2, request_type="bunk_with", session=1000)
    req_nbw_liam = make_request("r_nbw_liam", requester=1, requestee=2, request_type="not_bunk_with", session=1000)
    req_bw_olivia = make_request("r_bw_olivia", requester=1, requestee=3, request_type="bunk_with", session=1000)
    input_data = make_input(
        [p_emma, p_liam, p_olivia],
        [make_bunk(10, session=1000, gender="F")],
        [req_bw_liam, req_nbw_liam, req_bw_olivia],
    )

    report = validate_impossibility(input_data, mock_config)

    flagged_ids = {item.request_id for item in report.flat}
    assert "r_bw_olivia" not in flagged_ids, "Clean request incorrectly flagged"
    assert "r_bw_liam" in flagged_ids
    assert "r_nbw_liam" in flagged_ids
