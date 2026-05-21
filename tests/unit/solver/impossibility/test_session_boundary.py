"""SessionBoundaryImpossibility: bunk_with across sessions is impossible."""

from bunking.solver.constraints.session_boundary import SessionBoundaryImpossibility
from bunking.solver.impossibility import _build_context

from .conftest import make_bunk, make_input, make_person, make_request

PREDICATE = SessionBoundaryImpossibility()


def test_bunk_with_same_session_is_not_impossible(mock_config):
    p1 = make_person(1, session=100)
    p2 = make_person(2, session=100)
    req = make_request("r1", requester=1, requestee=2, request_type="bunk_with", session=100)
    input_data = make_input([p1, p2], [make_bunk(10, session=100)], [req])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_pair(req, ctx) is None


def test_bunk_with_different_session_is_impossible(mock_config):
    p1 = make_person(1, session=100)
    p2 = make_person(2, session=200)
    req = make_request("r1", requester=1, requestee=2, request_type="bunk_with", session=100)
    input_data = make_input([p1, p2], [make_bunk(10, session=100), make_bunk(11, session=200)], [req])
    ctx = _build_context(input_data, mock_config)

    reason = PREDICATE.check_pair(req, ctx)
    assert reason is not None
    assert reason.code == "cross_session"
    assert reason.detail["requester_session"] == 100
    assert reason.detail["requestee_session"] == 200


def test_not_bunk_with_different_session_is_not_impossible(mock_config):
    """Separation is already guaranteed by the session split; no need to enforce."""
    p1 = make_person(1, session=100)
    p2 = make_person(2, session=200)
    req = make_request("r1", requester=1, requestee=2, request_type="not_bunk_with", session=100)
    input_data = make_input([p1, p2], [make_bunk(10, session=100), make_bunk(11, session=200)], [req])
    ctx = _build_context(input_data, mock_config)

    assert PREDICATE.check_pair(req, ctx) is None
