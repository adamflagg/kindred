"""Teen Programs (SCIT, TLI) forecast aggregation.

SCIT row = CIT + SIT sessions summed into one row; TLI is its own row.
Teens are window-gated (off-season scit/tli excluded) and excluded from the
grand total. Reconstruction / single-session drill-down emit no teen rows.
"""

from unittest.mock import AsyncMock

import pytest

from api.services.forecast_service import ForecastService
from tests.unit.api.conftest import create_mock_attendee, create_mock_session


@pytest.fixture
def repo():
    r = AsyncMock()
    r.fetch_sessions = AsyncMock(return_value={})
    r.fetch_attendees = AsyncMock(return_value=[])
    r.fetch_budget_config = AsyncMock(return_value={})
    r.fetch_registration_dates = AsyncMock(return_value={})
    return r


@pytest.fixture
def service(repo):
    return ForecastService(repo)


def _summer_sessions():
    # main session anchors the summer window (2026-06-15 .. 2026-07-05 defaults)
    return {
        1001: create_mock_session(1001, "Session 2", session_type="main"),
        1236361: create_mock_session(1236361, "Counselor In-Training", session_type="scit"),
        1236368: create_mock_session(1236368, "Specialist In-Training", session_type="scit"),
        1274420: create_mock_session(1274420, "Teen Leadership Institute", session_type="tli"),
    }


def _enrolled():
    # main: 4, CIT: 2, SIT: 1, TLI: 3
    return [
        create_mock_attendee(1, 1001),
        create_mock_attendee(2, 1001),
        create_mock_attendee(3, 1001),
        create_mock_attendee(4, 1001),
        create_mock_attendee(10, 1236361),
        create_mock_attendee(11, 1236361),
        create_mock_attendee(12, 1236368),
        create_mock_attendee(20, 1274420),
        create_mock_attendee(21, 1274420),
        create_mock_attendee(22, 1274420),
    ]


def _wire(repo, sessions, enrolled, budget):
    async def fetch_sessions(year, session_types=None):
        if year != 2026:
            return {}
        if session_types is None:
            return sessions
        return {sid: s for sid, s in sessions.items() if s.session_type in session_types}

    async def fetch_attendees(year, status_filter=None, **kwargs):
        if status_filter == "waitlisted" or year != 2026:
            return []
        return enrolled

    repo.fetch_sessions.side_effect = fetch_sessions
    repo.fetch_attendees.side_effect = fetch_attendees
    repo.fetch_budget_config.return_value = budget


@pytest.mark.asyncio
async def test_scit_row_sums_cit_and_sit(service, repo):
    _wire(
        service.repository,
        _summer_sessions(),
        _enrolled(),
        {
            "type:scit": {"participant_goal": 50, "session_fee": 1500},
            "type:tli": {"participant_goal": 40, "session_fee": 2000},
        },
    )

    result = await service.calculate_forecast(year=2026, session_types=["main", "scit", "tli"])
    by_type = {s.session_type: s for s in result.sessions}

    assert sum(1 for s in result.sessions if s.session_type == "scit") == 1
    assert sum(1 for s in result.sessions if s.session_type == "tli") == 1

    assert by_type["scit"].session_name == "SCIT"
    assert by_type["scit"].enrolled == 3  # 2 CIT + 1 SIT
    assert by_type["scit"].session_cm_id == 0
    assert by_type["scit"].participant_goal == 50
    assert by_type["scit"].session_fee == 1500

    assert by_type["tli"].session_name == "TLI"
    assert by_type["tli"].enrolled == 3
    assert by_type["tli"].participant_goal == 40


@pytest.mark.asyncio
async def test_teens_included_in_grand_total_when_displayed(service, repo):
    # A displayed cohort belongs in the total: grand total counts main + teens.
    _wire(service.repository, _summer_sessions(), _enrolled(), {})
    result = await service.calculate_forecast(year=2026, session_types=["main", "scit", "tli"])
    assert result.grand_total.enrolled == 10  # main 4 + SCIT 3 (CIT 2 + SIT 1) + TLI 3


@pytest.mark.asyncio
async def test_offseason_teen_excluded_by_window(service, repo):
    sessions = {
        1001: create_mock_session(1001, "Session 2", session_type="main"),
        1236361: create_mock_session(1236361, "Counselor In-Training", session_type="scit"),
        1300000: create_mock_session(
            1300000,
            "Family Camp 5 CIT",
            session_type="scit",
            start_date="2026-09-12",
            end_date="2026-09-15",
        ),
    }
    enrolled = [
        create_mock_attendee(10, 1236361),
        create_mock_attendee(11, 1236361),
        create_mock_attendee(99, 1300000),  # must NOT count toward SCIT
    ]
    _wire(service.repository, sessions, enrolled, {})

    result = await service.calculate_forecast(year=2026, session_types=["main", "scit"])
    scit = next(s for s in result.sessions if s.session_type == "scit")
    assert scit.enrolled == 2  # fall CIT excluded by the window gate


@pytest.mark.asyncio
async def test_teens_only_scope_fetches_window(service, repo):
    _wire(service.repository, _summer_sessions(), _enrolled(), {})
    result = await service.calculate_forecast(year=2026, session_types=["scit", "tli"])
    types = {s.session_type for s in result.sessions}
    assert types == {"scit", "tli"}
    assert next(s for s in result.sessions if s.session_type == "scit").enrolled == 3


@pytest.mark.asyncio
async def test_no_teen_rows_for_single_session_drilldown(service, repo):
    _wire(service.repository, _summer_sessions(), _enrolled(), {})
    result = await service.calculate_forecast(year=2026, session_types=["main", "scit", "tli"], session_cm_id=1001)
    assert all(s.session_type not in ("scit", "tli") for s in result.sessions)
