"""GenderImpossibility: bunk_with pair with no gender-compatible bunk."""

from __future__ import annotations

from bunking.solver.constraints.gender import GenderImpossibility
from bunking.solver.impossibility import _build_context

from .conftest import make_bunk, make_input, make_person, make_request

PREDICATE = GenderImpossibility()


def test_same_gender_pair_with_compatible_bunk_is_not_impossible(mock_config):
    p1 = make_person(1, session=1000001, gender="F")
    p2 = make_person(2, session=1000001, gender="F")
    req = make_request("r1", requester=1, requestee=2, session=1000001)
    input_data = make_input([p1, p2], [make_bunk(10, session=1000001, gender="F")], [req])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_pair(req, ctx) is None


def test_cross_gender_bunk_with_with_no_mixed_bunk_is_impossible(mock_config):
    p1 = make_person(1, session=1000001, gender="F")
    p2 = make_person(2, session=1000001, gender="M")
    req = make_request("r1", requester=1, requestee=2, request_type="bunk_with", session=1000001)
    input_data = make_input(
        [p1, p2],
        [make_bunk(10, session=1000001, gender="F"), make_bunk(11, session=1000001, gender="M")],
        [req],
    )
    ctx = _build_context(input_data, mock_config)

    reason = PREDICATE.check_pair(req, ctx)
    assert reason is not None
    assert reason.code == "pair_no_shared_bunk"
    assert reason.detail["requester_gender"] == "F"
    assert reason.detail["requestee_gender"] == "M"


def test_cross_gender_with_mixed_bunk_available_is_not_impossible(mock_config):
    p1 = make_person(1, session=1000001, gender="F")
    p2 = make_person(2, session=1000001, gender="M")
    req = make_request("r1", requester=1, requestee=2, request_type="bunk_with", session=1000001)
    input_data = make_input(
        [p1, p2],
        [make_bunk(10, session=1000001, gender="Mixed")],
        [req],
    )
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_pair(req, ctx) is None


def test_cross_gender_not_bunk_with_is_not_impossible(mock_config):
    """Separation is already guaranteed; no need to flag."""
    p1 = make_person(1, session=1000001, gender="F")
    p2 = make_person(2, session=1000001, gender="M")
    req = make_request("r1", requester=1, requestee=2, request_type="not_bunk_with", session=1000001)
    input_data = make_input(
        [p1, p2],
        [make_bunk(10, session=1000001, gender="F"), make_bunk(11, session=1000001, gender="M")],
        [req],
    )
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_pair(req, ctx) is None


def test_pair_with_missing_gender_is_not_impossible(mock_config):
    """Unknown-gender campers fit any bunk: ``add_gender_constraints`` only
    constrains campers with a known gender, so the predicate must not flag a
    pair as impossible just because one camper's gender is missing.
    """
    p1 = make_person(1, session=1000001, gender=None)
    p2 = make_person(2, session=1000001, gender="F")
    req = make_request("r1", requester=1, requestee=2, request_type="bunk_with", session=1000001)
    input_data = make_input(
        [p1, p2],
        [make_bunk(10, session=1000001, gender="F"), make_bunk(11, session=1000001, gender="M")],
        [req],
    )
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_pair(req, ctx) is None
