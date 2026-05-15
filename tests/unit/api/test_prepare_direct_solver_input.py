"""Tests for prepare_direct_solver_input in data_fetcher.

The PB→DirectBunkRequest transformation must propagate is_first_requested.
Pydantic v2 silently drops unknown kwargs (extra='ignore' is the default),
so a stale `priority=...` kwarg passed to DirectBunkRequest would make every
request appear non-first-pick to the solver — silently breaking the slot-0
boost for the entire API solve path. This test pins that contract.
"""

from __future__ import annotations

from unittest.mock import Mock

from api.services.data_fetcher import prepare_direct_solver_input


def _mock_attendee(person_id: int, session_id: int) -> Mock:
    m = Mock()
    m.person_id = person_id
    m.expand = {
        "person": Mock(
            cm_id=person_id,
            first_name="Emma",
            last_name="Johnson",
            grade=5,
            birthdate="2015-01-01",
            gender="M",
        ),
        "session": Mock(cm_id=session_id),
    }
    return m


def _mock_bunk(cm_id: int, session_id: int) -> Mock:
    m = Mock()
    m.id = f"bunk_{cm_id}"
    m.cm_id = cm_id
    m.name = "B-1"
    m.area = "Test Area"
    m.gender = "M"
    m.expand = {"session": Mock(cm_id=session_id)}
    return m


def _mock_request(id_: str, requester_id: int, is_first_requested: bool) -> Mock:
    m = Mock()
    m.id = id_
    m.requester_id = requester_id
    m.requestee_id = 200
    m.request_type = "bunk_with"
    m.is_first_requested = is_first_requested
    m.session_id = 999
    m.year = 2026
    m.confidence_score = 0.95
    m.status = "resolved"
    m.original_text = "test"
    m.age_preference_target = None
    m.source_field = "bunk_with"
    return m


def _mock_bunk_plan(session_id: int, bunk_cm_id: int) -> Mock:
    m = Mock()
    m.expand = {
        "session": Mock(cm_id=session_id),
        "bunk": Mock(cm_id=bunk_cm_id),
    }
    return m


def test_prepare_direct_solver_input_propagates_is_first_requested() -> None:
    """is_first_requested must round-trip from PB record to DirectBunkRequest.

    Regression guard: an earlier version of this code passed `priority=...` to
    the DirectBunkRequest constructor (a now-deleted field). Pydantic silently
    dropped that kwarg, leaving is_first_requested at its default of False for
    every API solve.
    """
    attendees = [_mock_attendee(person_id=100, session_id=999)]
    bunks = [_mock_bunk(cm_id=1, session_id=999)]
    requests = [
        _mock_request(id_="r1", requester_id=100, is_first_requested=True),
        _mock_request(id_="r2", requester_id=100, is_first_requested=False),
    ]
    bunk_plans = [_mock_bunk_plan(session_id=999, bunk_cm_id=1)]
    assignments: list[Mock] = []

    result = prepare_direct_solver_input(attendees, bunks, requests, assignments, bunk_plans)

    assert len(result.requests) == 2
    by_id = {r.id: r for r in result.requests}
    assert by_id["r1"].is_first_requested is True
    assert by_id["r2"].is_first_requested is False
