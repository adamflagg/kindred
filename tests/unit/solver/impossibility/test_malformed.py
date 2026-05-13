"""MalformedRequestImpossibility: malformed bunk_with/not_bunk_with requests."""

from __future__ import annotations

from bunking.solver.constraints.bunk_requests import MalformedRequestImpossibility
from bunking.solver.impossibility import _build_context

from .conftest import make_bunk, make_input, make_person, make_request

PREDICATE = MalformedRequestImpossibility()


def test_bunk_with_with_missing_requestee_is_impossible(mock_config):
    p1 = make_person(1, session=100)
    req = make_request("r1", requester=1, requestee=None, request_type="bunk_with", session=100)
    input_data = make_input([p1], [make_bunk(10, session=100)], [req])
    ctx = _build_context(input_data, mock_config)

    reason = PREDICATE.check_request(req, ctx)
    assert reason is not None
    assert reason.code == "malformed"


def test_not_bunk_with_with_missing_requestee_is_impossible(mock_config):
    p1 = make_person(1, session=100)
    req = make_request("r1", requester=1, requestee=None, request_type="not_bunk_with", session=100)
    input_data = make_input([p1], [make_bunk(10, session=100)], [req])
    ctx = _build_context(input_data, mock_config)

    reason = PREDICATE.check_request(req, ctx)
    assert reason is not None
    assert reason.code == "malformed"


def test_well_formed_bunk_with_is_not_impossible(mock_config):
    p1 = make_person(1, session=100)
    p2 = make_person(2, session=100)
    req = make_request("r1", requester=1, requestee=2, session=100)
    input_data = make_input([p1, p2], [make_bunk(10, session=100)], [req])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_request(req, ctx) is None


def test_age_preference_does_not_need_requestee(mock_config):
    """age_preference is not subject to malformed check (no requestee expected)."""
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
