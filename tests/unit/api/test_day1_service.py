"""Tests for Day 1 registration counting service."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from api.services.day1_service import Day1Service


def _make_attendee(
    *,
    session_cm_id: int,
    session_type: str = "main",
    status_id: int = 2,
    effective_date: str,
    enrollment_date: str = "",
) -> MagicMock:
    att = MagicMock()
    att.status_id = status_id
    att.effective_date = effective_date
    att.enrollment_date = enrollment_date
    session_mock = MagicMock()
    session_mock.cm_id = session_cm_id
    session_mock.session_type = session_type
    att.expand = {"session": session_mock}
    return att


def _make_session(cm_id: int, session_type: str = "main") -> MagicMock:
    s = MagicMock()
    s.cm_id = cm_id
    s.session_type = session_type
    return s


@pytest.mark.asyncio
async def test_day1_counts_on_tier_date():
    """Attendees with effective_date matching tier date are counted."""
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
        _make_attendee(session_cm_id=1001, effective_date="2025-11-12T00:00:00.000Z"),
        _make_attendee(session_cm_id=1001, effective_date="2025-11-12"),
    ]

    service = Day1Service(repo)
    result = await service.get_day1(2026)

    priority_tier = next(t for t in result.tiers if t.tier == "priority")
    assert priority_tier.total.count == 2
    assert priority_tier.approximate is True


@pytest.mark.asyncio
async def test_day1_excludes_different_date():
    """Attendees with effective_date on other dates are not counted."""
    repo = AsyncMock()
    repo.fetch_registration_dates.return_value = {
        "priority_reg_date": "2025-11-12",
    }
    repo.fetch_sessions.return_value = {
        1001: _make_session(1001, "main"),
    }
    repo.fetch_attendees_with_dates.return_value = [
        _make_attendee(session_cm_id=1001, effective_date="2025-11-11"),
        _make_attendee(session_cm_id=1001, effective_date="2025-11-13"),
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
        _make_attendee(session_cm_id=1001, effective_date="2025-11-12"),
        _make_attendee(session_cm_id=1001, effective_date="2025-11-12"),
        _make_attendee(session_cm_id=1002, effective_date="2025-11-12"),
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


@pytest.mark.asyncio
async def test_day1_skips_missing_effective_date():
    """Attendees without effective_date are skipped."""
    repo = AsyncMock()
    repo.fetch_registration_dates.return_value = {
        "priority_reg_date": "2025-11-12",
    }
    repo.fetch_sessions.return_value = {
        1001: _make_session(1001, "main"),
    }
    repo.fetch_attendees_with_dates.return_value = [
        _make_attendee(session_cm_id=1001, effective_date=""),
        _make_attendee(session_cm_id=1001, effective_date="2025-11-12"),
    ]

    service = Day1Service(repo)
    result = await service.get_day1(2026)

    priority_tier = next(t for t in result.tiers if t.tier == "priority")
    assert priority_tier.total.count == 1


@pytest.mark.asyncio
async def test_day1_ignores_enrollment_date():
    """enrollment_date (sync timestamp) does not affect Day 1 counting."""
    repo = AsyncMock()
    repo.fetch_registration_dates.return_value = {
        "priority_reg_date": "2025-11-12",
    }
    repo.fetch_sessions.return_value = {
        1001: _make_session(1001, "main"),
    }
    repo.fetch_attendees_with_dates.return_value = [
        # effective_date matches tier, but enrollment_date is months later (sync time)
        _make_attendee(
            session_cm_id=1001,
            effective_date="2025-11-12",
            enrollment_date="2026-02-05 20:21:10.508Z",
        ),
        # effective_date does NOT match tier, but enrollment_date falls on tier date
        _make_attendee(
            session_cm_id=1001,
            effective_date="2025-11-13",
            enrollment_date="2025-11-12T18:00:00.000Z",
        ),
    ]

    service = Day1Service(repo)
    result = await service.get_day1(2026)

    priority_tier = next(t for t in result.tiers if t.tier == "priority")
    # Only first attendee should count (effective_date matches)
    assert priority_tier.total.count == 1


# ============================================================================
# session_types filter tests
# ============================================================================


def _make_repo_with_mixed_sessions() -> AsyncMock:
    """Repo with main, quest, and scit sessions all having attendees on 2025-11-12."""
    repo = AsyncMock()
    repo.fetch_registration_dates.return_value = {
        "priority_reg_date": "2025-11-12",
    }
    repo.fetch_sessions.return_value = {
        1001: _make_session(1001, "main"),
        1002: _make_session(1002, "quest"),
        1003: _make_session(1003, "scit"),
    }
    repo.fetch_attendees_with_dates.return_value = [
        # 2 main attendees
        _make_attendee(session_cm_id=1001, session_type="main", effective_date="2025-11-12"),
        _make_attendee(session_cm_id=1001, session_type="main", effective_date="2025-11-12"),
        # 1 quest attendee
        _make_attendee(session_cm_id=1002, session_type="quest", effective_date="2025-11-12"),
        # 1 scit (teen) attendee
        _make_attendee(session_cm_id=1003, session_type="scit", effective_date="2025-11-12"),
    ]
    return repo


@pytest.mark.asyncio
async def test_day1_session_types_none_returns_existing_behavior():
    """session_types=None preserves existing behavior.

    With session_types=None, the existing code processes all attendees but only
    counts those in AT_CAMP_TYPES (main, embedded, ag) or QUEST_TYPES (quest).
    The scit attendee is on the tier date but falls into neither bucket, so
    None returns 3 (2 main + 1 quest), not 4.  This test documents and protects
    that contract: adding session_types must not change the None path.
    """
    repo = _make_repo_with_mixed_sessions()
    service = Day1Service(repo)
    result = await service.get_day1(2026)

    priority_tier = next(t for t in result.tiers if t.tier == "priority")
    # 2 main (at_camp) + 1 quest; scit is not bucketed so not counted
    assert priority_tier.total.count == 3


@pytest.mark.asyncio
async def test_day1_session_types_main_only():
    """session_types=['main'] restricts to main-session attendees only."""
    repo = _make_repo_with_mixed_sessions()
    service = Day1Service(repo)
    result = await service.get_day1(2026, session_types=["main"])

    priority_tier = next(t for t in result.tiers if t.tier == "priority")
    # Only the 2 main attendees pass the filter; quest + scit are excluded
    assert priority_tier.total.count == 2
    assert priority_tier.total.count < 3  # fewer than unfiltered


@pytest.mark.asyncio
async def test_day1_session_types_main_and_quest():
    """session_types=['main', 'quest'] counts main and quest but excludes scit."""
    repo = _make_repo_with_mixed_sessions()
    service = Day1Service(repo)
    result = await service.get_day1(2026, session_types=["main", "quest"])

    priority_tier = next(t for t in result.tiers if t.tier == "priority")
    # 2 main + 1 quest = 3; scit is excluded by the filter
    assert priority_tier.total.count == 3


@pytest.mark.asyncio
async def test_day1_session_types_quest_only():
    """session_types=['quest'] restricts to quest-session attendees only."""
    repo = _make_repo_with_mixed_sessions()
    service = Day1Service(repo)
    result = await service.get_day1(2026, session_types=["quest"])

    priority_tier = next(t for t in result.tiers if t.tier == "priority")
    # Only the 1 quest attendee passes the filter
    assert priority_tier.total.count == 1
    assert priority_tier.total.count < 3  # fewer than unfiltered (None = 3)


@pytest.mark.asyncio
async def test_day1_session_types_scit_only_counts_teens():
    """session_types=['scit'] counts the teen attendee in a dedicated 'teen' bucket.

    Regression guard: previously scit/tli fell through both AT_CAMP_TYPES and
    QUEST_TYPES, so any teen-only filter silently returned a total of 0.
    """
    repo = _make_repo_with_mixed_sessions()
    service = Day1Service(repo)
    result = await service.get_day1(2026, session_types=["scit"])

    priority_tier = next(t for t in result.tiers if t.tier == "priority")
    teen = next(c for c in priority_tier.categories if c.category == "teen")
    assert teen.count == 1
    assert priority_tier.total.count == 1


@pytest.mark.asyncio
async def test_day1_session_types_all_including_teens():
    """A filter covering camp + quest + teen counts all three buckets."""
    repo = _make_repo_with_mixed_sessions()
    service = Day1Service(repo)
    result = await service.get_day1(2026, session_types=["main", "embedded", "ag", "quest", "scit", "tli"])

    priority_tier = next(t for t in result.tiers if t.tier == "priority")
    at_camp = next(c for c in priority_tier.categories if c.category == "at_camp")
    quest = next(c for c in priority_tier.categories if c.category == "quest")
    teen = next(c for c in priority_tier.categories if c.category == "teen")
    assert at_camp.count == 2
    assert quest.count == 1
    assert teen.count == 1
    # 2 main + 1 quest + 1 scit
    assert priority_tier.total.count == 4
