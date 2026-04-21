"""Teen Programs (SCIT, TLI) forecast aggregation tests.

Verifies that:
- All sessions of session_type 'scit' (CIT + SIT) collapse into ONE row
- All sessions of session_type 'tli' collapse into ONE row
- Teen rows read fee/goal from type-level config (`type:scit`, `type:tli`)
- Non-teen sessions still emit one row per session (no regression)
- Missing type-level config still produces a row with null goal/fee
"""

from unittest.mock import AsyncMock

import pytest

from tests.unit.api.conftest import create_mock_attendee, create_mock_session


@pytest.fixture
def mock_repository():
    repo = AsyncMock()
    repo.fetch_sessions = AsyncMock(return_value={})
    repo.fetch_attendees = AsyncMock(return_value=[])
    repo.fetch_budget_config = AsyncMock(return_value={})
    repo.fetch_registration_dates = AsyncMock(return_value={})
    repo.has_pre_anchor_enrollments = AsyncMock(return_value=False)
    return repo


@pytest.fixture
def service(mock_repository):
    from api.services.forecast_service import ForecastService

    return ForecastService(mock_repository)


@pytest.mark.asyncio
async def test_scit_row_aggregates_cit_and_sit_enrollments(service, mock_repository):
    """SCIT row sums enrollments across all sessions with session_type='scit'."""
    sessions = {
        1236361: create_mock_session(1236361, "Counselor In-Training", session_type="scit"),
        1236368: create_mock_session(1236368, "Specialist In-Training", session_type="scit"),
        1274420: create_mock_session(1274420, "Teen Leadership Institute", session_type="tli"),
    }
    mock_repository.fetch_sessions.return_value = sessions

    enrolled = [
        create_mock_attendee(1, 1236361),
        create_mock_attendee(2, 1236361),
        create_mock_attendee(3, 1236368),
        create_mock_attendee(4, 1274420),
    ]

    async def fetch_attendees_side_effect(year, status_filter=None, **kwargs):
        if status_filter == "waitlisted":
            return []
        if year == 2026:
            return enrolled
        return []

    mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect
    mock_repository.fetch_budget_config.return_value = {
        "type:scit": {"participant_goal": 50, "session_fee": 1500},
        "type:tli": {"participant_goal": 40, "session_fee": 2000},
    }

    result = await service.calculate_forecast(year=2026, session_types=["scit", "tli"])

    assert len(result.sessions) == 2, "Expected exactly 2 teen rows (one SCIT, one TLI)"
    by_type = {s.session_type: s for s in result.sessions}
    assert set(by_type) == {"scit", "tli"}, "Expected exactly one SCIT row and one TLI row"

    # SCIT aggregates 2 CIT + 1 SIT = 3
    scit = by_type["scit"]
    assert scit.enrolled == 3
    assert scit.participant_goal == 50
    assert scit.session_fee == 1500
    assert scit.session_name == "SCIT"
    assert scit.budget_revenue == 75000  # 50 * 1500
    assert scit.actual_revenue == 4500  # 3 * 1500

    # TLI has 1 enrollment
    tli = by_type["tli"]
    assert tli.enrolled == 1
    assert tli.participant_goal == 40
    assert tli.session_fee == 2000
    assert tli.session_name == "TLI"


@pytest.mark.asyncio
async def test_non_teen_sessions_still_emit_one_row_per_session(service, mock_repository):
    """Regression: main/ag/embedded/quest behavior unchanged."""
    sessions = {
        1235404: create_mock_session(1235404, "Session 2", session_type="main"),
        1235405: create_mock_session(1235405, "Session 3", session_type="main"),
    }
    mock_repository.fetch_sessions.return_value = sessions

    enrolled = [create_mock_attendee(1, 1235404)]

    async def fetch_attendees_side_effect(year, status_filter=None, **kwargs):
        if status_filter == "waitlisted":
            return []
        if year == 2026:
            return enrolled
        return []

    mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect
    mock_repository.fetch_budget_config.return_value = {
        1235404: {"participant_goal": 200, "session_fee": 5000},
        1235405: {"participant_goal": 180, "session_fee": 5000},
    }

    result = await service.calculate_forecast(year=2026, session_types=["main"])

    assert len(result.sessions) == 2
    assert {s.session_cm_id for s in result.sessions} == {1235404, 1235405}


@pytest.mark.asyncio
async def test_teen_rows_use_none_for_missing_config(service, mock_repository):
    """If no type:scit config exists, the teen row still appears with goal/fee=None."""
    sessions = {
        1236361: create_mock_session(1236361, "CIT", session_type="scit"),
    }
    mock_repository.fetch_sessions.return_value = sessions

    enrolled = [create_mock_attendee(1, 1236361)]

    async def fetch_attendees_side_effect(year, status_filter=None, **kwargs):
        if status_filter == "waitlisted":
            return []
        if year == 2026:
            return enrolled
        return []

    mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect
    mock_repository.fetch_budget_config.return_value = {}  # no type config

    result = await service.calculate_forecast(year=2026, session_types=["scit"])

    teen_rows = [s for s in result.sessions if s.session_type == "scit"]
    assert len(teen_rows) == 1
    assert teen_rows[0].enrolled == 1
    assert teen_rows[0].participant_goal is None
    assert teen_rows[0].session_fee is None
    assert teen_rows[0].budget_revenue is None
