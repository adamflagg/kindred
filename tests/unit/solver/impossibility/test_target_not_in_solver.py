"""TargetNotInSolverImpossibility: bunk_with to a non-roster requestee."""

from __future__ import annotations

from bunking.solver.constraints.bunk_requests import TargetNotInSolverImpossibility
from bunking.solver.impossibility import _build_context

from .conftest import make_bunk, make_input, make_person, make_request

PREDICATE = TargetNotInSolverImpossibility()


def test_build_context_populates_roster_cm_ids(mock_config):
    """roster_cm_ids is the frozenset of every person cm_id in the input."""
    p1 = make_person(1, session=100)
    p2 = make_person(2, session=100)
    input_data = make_input([p1, p2], [make_bunk(10, session=100)], [])

    ctx = _build_context(input_data, mock_config)

    assert ctx.roster_cm_ids == frozenset({1, 2})
    assert isinstance(ctx.roster_cm_ids, frozenset)


def test_bunk_with_to_non_roster_target_is_impossible(mock_config):
    """bunk_with whose requestee is not in the input roster is impossible."""
    p1 = make_person(1, session=100)
    # Requestee cm_id 999 is NOT in the persons list -> not in the roster.
    req = make_request("r1", requester=1, requestee=999, request_type="bunk_with", session=100)
    input_data = make_input([p1], [make_bunk(10, session=100)], [req])
    ctx = _build_context(input_data, mock_config)

    reason = PREDICATE.check_request(req, ctx)
    assert reason is not None
    assert reason.code == "target_not_in_solver"
    assert reason.detail["requested_person_cm_id"] == 999


def test_not_bunk_with_to_non_roster_target_is_not_impossible(mock_config):
    """A not_bunk_with whose requestee is absent from the roster is trivially
    satisfied — the two campers can never share a bunk — so this predicate must
    NOT flag it. Mirrors the satisfaction logic in bunking/satisfaction/
    predicate.py ("requestee unassigned — no conflict possible") and the
    bunk_with-only guard in the gender/grade_spread/session_boundary predicates.
    Only a bunk_with to a non-roster target is genuinely impossible.
    """
    p1 = make_person(1, session=100)
    req = make_request("r1", requester=1, requestee=999, request_type="not_bunk_with", session=100)
    input_data = make_input([p1], [make_bunk(10, session=100)], [req])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_request(req, ctx) is None


def test_bunk_with_to_in_roster_target_is_not_impossible(mock_config):
    p1 = make_person(1, session=100)
    p2 = make_person(2, session=100)
    req = make_request("r1", requester=1, requestee=2, request_type="bunk_with", session=100)
    input_data = make_input([p1, p2], [make_bunk(10, session=100)], [req])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_request(req, ctx) is None


def test_malformed_request_is_not_target_not_in_solver(mock_config):
    """No requestee_id -> MalformedRequestImpossibility's concern, not this one."""
    p1 = make_person(1, session=100)
    req = make_request("r1", requester=1, requestee=None, request_type="bunk_with", session=100)
    input_data = make_input([p1], [make_bunk(10, session=100)], [req])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_request(req, ctx) is None


def test_age_preference_request_is_ignored(mock_config):
    p1 = make_person(1, session=100)
    req = make_request(
        "r1",
        requester=1,
        requestee=None,
        request_type="age_preference",
        age_preference_target="older",
        session=100,
    )
    input_data = make_input([p1], [make_bunk(10, session=100)], [req])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_request(req, ctx) is None
