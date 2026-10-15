"""Teen Programs (SCIT, TLI) forecast aggregation.

SCIT row = CIT + SIT sessions summed into one row; TLI is its own row.
Teens are window-gated (off-season scit/tli excluded). When teen rows are
displayed (live mode) they are included in the grand total. Reconstruction /
single-session drill-down emit no teen rows, so they're absent from both the
rows and the total in those modes.
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


# ============================================================================
# #3209 rows 18 + 23: teen rows in week mode, gender split, prior by type
# ============================================================================


def _reg_attendee(pid, sid, reg_date, gender=None, year=2026):
    return create_mock_attendee(pid, sid, year=year, gender=gender, effective_date=reg_date, enrollment_date=reg_date)


def _wire_week_mode(repo, sessions, attendees_by_year, anchors=None):
    anchors = anchors or {2026: "2025-10-15"}

    async def fetch_sessions(year, session_types=None):
        if year != 2026:
            return {}
        if session_types is None:
            return sessions
        return {sid: s for sid, s in sessions.items() if s.session_type in session_types}

    async def fetch_dates(year):
        return {"priority_reg_date": anchors[year]} if year in anchors else {}

    async def with_dates(year, expand_person=False):
        return attendees_by_year.get(year, [])

    repo.fetch_sessions.side_effect = fetch_sessions
    repo.fetch_registration_dates.side_effect = fetch_dates
    repo.fetch_attendees_with_dates = AsyncMock(side_effect=with_dates)


@pytest.mark.asyncio
async def test_teen_rows_present_in_week_mode(service, repo):
    attendees = [
        _reg_attendee(1, 1001, "2025-10-16", "M"),
        _reg_attendee(10, 1236361, "2025-10-16", "M"),
        _reg_attendee(11, 1236361, "2025-10-17", "F"),
        _reg_attendee(12, 1236368, "2025-10-17", "F"),
        _reg_attendee(20, 1274420, "2025-10-18", "M"),
        _reg_attendee(21, 1274420, "2026-03-01", "M"),  # after the offset: not yet registered
    ]
    _wire_week_mode(repo, _summer_sessions(), {2026: attendees})

    result = await service.calculate_forecast(year=2026, session_types=["main", "scit", "tli"], day_offset=30)
    by_type = {s.session_type: s for s in result.sessions}

    assert by_type["scit"].enrolled == 3
    assert (by_type["scit"].enrolled_boys, by_type["scit"].enrolled_girls) == (1, 2)
    assert by_type["tli"].enrolled == 1
    assert by_type["scit"].waitlisted is None
    assert result.grand_total.enrolled == 5  # main 1 + SCIT 3 + TLI 1


@pytest.mark.asyncio
async def test_grand_total_gender_split_includes_teen_rows(service, repo):
    enrolled = [
        create_mock_attendee(1, 1001, gender="M"),
        create_mock_attendee(2, 1001, gender="F"),
        create_mock_attendee(10, 1236361, gender="M"),
        create_mock_attendee(11, 1236368, gender="F"),
        create_mock_attendee(20, 1274420, gender="F"),
    ]
    _wire(service.repository, _summer_sessions(), enrolled, {})

    result = await service.calculate_forecast(year=2026, session_types=["main", "scit", "tli"])
    by_type = {s.session_type: s for s in result.sessions}

    assert (by_type["scit"].enrolled_boys, by_type["scit"].enrolled_girls) == (1, 1)
    assert (by_type["tli"].enrolled_boys, by_type["tli"].enrolled_girls) == (0, 1)
    assert result.grand_total.enrolled == 5
    assert result.grand_total.enrolled_boys == 2
    assert result.grand_total.enrolled_girls == 3


@pytest.mark.asyncio
async def test_teen_rows_carry_prior_by_type(service, repo):
    prior_sessions = {
        9001: create_mock_session(9001, "Session 2", year=2025, session_type="main"),
        9361: create_mock_session(9361, "Counselor In-Training", year=2025, session_type="scit"),
        9368: create_mock_session(9368, "Specialist In-Training", year=2025, session_type="scit"),
        9420: create_mock_session(9420, "Teen Leadership Institute", year=2025, session_type="tli"),
    }
    prior_att = [
        *[create_mock_attendee(100 + i, 9361, year=2025) for i in range(4)],
        *[create_mock_attendee(200 + i, 9368, year=2025) for i in range(2)],
        *[create_mock_attendee(300 + i, 9420, year=2025) for i in range(5)],
        create_mock_attendee(400, 9001, year=2025),
    ]
    current = _summer_sessions()

    async def fetch_sessions(year, session_types=None):
        src = {2026: current, 2025: prior_sessions}.get(year, {})
        return {sid: s for sid, s in src.items() if session_types is None or s.session_type in session_types}

    async def fetch_attendees(year, status_filter=None, **kwargs):
        if status_filter == "waitlisted":
            return []
        return {2026: _enrolled(), 2025: prior_att}.get(year, [])

    repo.fetch_sessions.side_effect = fetch_sessions
    repo.fetch_attendees.side_effect = fetch_attendees

    result = await service.calculate_forecast(year=2026, session_types=["main", "scit", "tli"])
    by_type = {s.session_type: s for s in result.sessions}

    assert by_type["scit"].prior_year_count == 6
    assert by_type["scit"].participants_vs_prior_year == 3 - 6
    assert by_type["tli"].prior_year_count == 5
    assert by_type["scit"].two_year_prior_count is None
    assert result.section_priors["teen"].prior_year_count == 11
