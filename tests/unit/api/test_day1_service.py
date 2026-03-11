"""Tests for Day 1 registration counting service."""

import os

os.environ["AUTH_MODE"] = "bypass"
os.environ["SKIP_PB_AUTH"] = "true"

from unittest.mock import AsyncMock, MagicMock
from zoneinfo import ZoneInfo

import pytest

from api.services.day1_service import Day1Service

CAMP_TZ = ZoneInfo("America/Los_Angeles")


def _make_attendee(
    *, session_cm_id: int, status_id: int = 2, enrollment_date: str, session_type: str = "main"
) -> MagicMock:
    att = MagicMock()
    att.status_id = status_id
    att.enrollment_date = enrollment_date
    att.effective_date = enrollment_date.split("T")[0] if "T" in enrollment_date else enrollment_date
    # Use expand-dict pattern matching PocketBase expanded session relation
    session_mock = MagicMock()
    session_mock.cm_id = session_cm_id
    att.expand = {"session": session_mock}
    return att


def _make_session(cm_id: int, session_type: str = "main") -> MagicMock:
    s = MagicMock()
    s.cm_id = cm_id
    s.session_type = session_type
    return s


@pytest.mark.asyncio
async def test_day1_counts_within_window():
    """Attendees within 9am-9am window are counted."""
    repo = AsyncMock()
    repo.fetch_registration_dates.return_value = {
        "priority_reg_date": "2025-11-12",
        "early_reg_date": "2025-11-19",
        "open_reg_date": "2025-12-03",
    }
    repo.fetch_sessions.return_value = {
        1001: _make_session(1001, "main"),
    }
    repo.fetch_attendees_with_dates.return_value = [
        _make_attendee(
            session_cm_id=1001, enrollment_date="2025-11-12T17:00:00.000Z"
        ),  # 9am PST = 5pm UTC, this is within window
        _make_attendee(
            session_cm_id=1001, enrollment_date="2025-11-13T16:00:00.000Z"
        ),  # Within 9am-9am window (before 9am PT next day = before 5pm UTC)
    ]

    service = Day1Service(repo)
    result = await service.get_day1(2026)

    # Priority tier should count both attendees
    priority_tier = next(t for t in result.tiers if t.tier == "priority")
    assert priority_tier.total.count == 2


@pytest.mark.asyncio
async def test_day1_excludes_outside_window():
    """Attendees outside 9am-9am window are not counted."""
    repo = AsyncMock()
    repo.fetch_registration_dates.return_value = {
        "priority_reg_date": "2025-11-12",
    }
    repo.fetch_sessions.return_value = {
        1001: _make_session(1001, "main"),
    }
    repo.fetch_attendees_with_dates.return_value = [
        _make_attendee(
            session_cm_id=1001, enrollment_date="2025-11-12T16:00:00.000Z"
        ),  # Before 9am PST (8am PST = 4pm UTC)
        _make_attendee(
            session_cm_id=1001, enrollment_date="2025-11-13T18:00:00.000Z"
        ),  # After 9am PST next day (10am PST = 6pm UTC)
    ]

    service = Day1Service(repo)
    result = await service.get_day1(2026)

    priority_tier = next(t for t in result.tiers if t.tier == "priority")
    assert priority_tier.total.count == 0


@pytest.mark.asyncio
async def test_day1_categories():
    """Attendees grouped by At Camp vs Quest."""
    repo = AsyncMock()
    repo.fetch_registration_dates.return_value = {
        "priority_reg_date": "2025-11-12",
    }
    repo.fetch_sessions.return_value = {
        1001: _make_session(1001, "main"),
        1002: _make_session(1002, "quest"),
    }
    repo.fetch_attendees_with_dates.return_value = [
        _make_attendee(session_cm_id=1001, enrollment_date="2025-11-12T18:00:00.000Z"),
        _make_attendee(session_cm_id=1001, enrollment_date="2025-11-12T19:00:00.000Z"),
        _make_attendee(session_cm_id=1002, enrollment_date="2025-11-12T18:00:00.000Z"),
    ]

    service = Day1Service(repo)
    result = await service.get_day1(2026)

    priority_tier = next(t for t in result.tiers if t.tier == "priority")
    at_camp = next(c for c in priority_tier.categories if c.category == "at_camp")
    quest = next(c for c in priority_tier.categories if c.category == "quest")
    assert at_camp.count == 2
    assert quest.count == 1
    assert priority_tier.total.count == 3


@pytest.mark.asyncio
async def test_day1_missing_tier():
    """Missing tier dates produce empty tiers list."""
    repo = AsyncMock()
    repo.fetch_registration_dates.return_value = {}
    repo.fetch_sessions.return_value = {}
    repo.fetch_attendees_with_dates.return_value = []

    service = Day1Service(repo)
    result = await service.get_day1(2026)

    assert len(result.tiers) == 0
