"""Tests for Day 1 registration counting service."""

from typing import Any
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


def _make_session(
    cm_id: int,
    session_type: str = "main",
    *,
    name: str = "",
    start_date: str = "2026-06-21",
    end_date: str = "2026-07-11",
    parent_id: int | None = None,
) -> MagicMock:
    s = MagicMock()
    s.cm_id = cm_id
    s.session_type = session_type
    s.name = name or f"Session {cm_id}"
    s.start_date = start_date
    s.end_date = end_date
    s.parent_id = parent_id
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


# ============================================================================
# Session resolver scoping (#3208): single session, duration, summer window
# ============================================================================

_REG_DATES = {"priority_reg_date": "2025-11-12"}
_DAY1 = "2025-11-12"
_SUMMER_TYPES = ["main", "embedded", "ag", "quest"]


def _repo_by_year(sessions_by_year: dict[int, dict[int, Any]], attendees_by_year: dict[int, list[Any]]) -> AsyncMock:
    repo = AsyncMock()
    repo.fetch_registration_dates.return_value = _REG_DATES

    async def _sessions(year, *_a, **_k):
        return sessions_by_year.get(year, {})

    async def _attendees(year, *_a, **_k):
        return attendees_by_year.get(year, [])

    repo.fetch_sessions.side_effect = _sessions
    repo.fetch_attendees_with_dates.side_effect = _attendees
    return repo


def _att(cm_id: int, stype: str = "main") -> MagicMock:
    return _make_attendee(session_cm_id=cm_id, session_type=stype, effective_date=_DAY1)


def _total(result: Any, which: str = "current") -> int:
    tiers = result.tiers if which == "current" else result.prior_years[0 if which == "prior1" else 1].tiers
    count: int = next(t for t in tiers if t.tier == "priority").total.count
    return count


@pytest.mark.asyncio
async def test_single_session_pick_counts_only_that_session_and_its_ag():
    sessions = {
        1001: _make_session(1001, "main", name="Session 2"),
        1101: _make_session(1101, "ag", name="AG 2", parent_id=1001),
        1002: _make_session(1002, "main", name="Session 3"),
    }
    atts = [_att(1001)] * 2 + [_att(1101, "ag")] + [_att(1002)] * 3
    repo = _repo_by_year({2026: sessions, 2025: sessions}, {2026: atts, 2025: [_att(1001)] + [_att(1002)] * 4})
    result = await Day1Service(repo).get_day1(2026, session_types=_SUMMER_TYPES, session_cm_id=1001)

    assert _total(result) == 3  # 2 in Session 2 + 1 in its AG cabin
    assert _total(result, "prior1") == 1  # same session last year, not the whole summer


@pytest.mark.asyncio
async def test_renamed_session_matches_prior_years_via_alias():
    cur = {1378702: _make_session(1378702, "embedded", name="Taste of Camp 1"), 1002: _make_session(1002, "main")}
    prior = {1235403: _make_session(1235403, "embedded", name="Taste of Camp"), 1002: _make_session(1002, "main")}
    repo = _repo_by_year(
        {2026: cur, 2025: prior, 2024: prior},
        {
            2026: [_att(1378702, "embedded")] * 2 + [_att(1002)],
            2025: [_att(1235403, "embedded")] * 3 + [_att(1002)] * 5,
            2024: [_att(1235403, "embedded")] * 4,
        },
    )
    result = await Day1Service(repo).get_day1(2026, session_types=_SUMMER_TYPES, session_cm_id=1378702)

    assert _total(result) == 2
    assert _total(result, "prior1") == 3
    assert _total(result, "prior2") == 4


@pytest.mark.asyncio
async def test_pick_with_no_match_in_prior_year_counts_zero_not_whole_summer():
    cur = {1378702: _make_session(1378702, "embedded", name="Taste of Camp 1"), 1002: _make_session(1002, "main")}
    prior = {1002: _make_session(1002, "main")}
    repo = _repo_by_year({2026: cur, 2025: prior}, {2026: [_att(1378702, "embedded")], 2025: [_att(1002)] * 5})
    result = await Day1Service(repo).get_day1(2026, session_types=_SUMMER_TYPES, session_cm_id=1378702)

    assert _total(result) == 1
    assert _total(result, "prior1") == 0


@pytest.mark.asyncio
async def test_offseason_teen_sessions_excluded_by_summer_window():
    sessions = {
        1001: _make_session(1001, "main"),
        1301: _make_session(1301, "scit", name="CIT Summer", start_date="2026-06-25", end_date="2026-07-20"),
        1302: _make_session(1302, "scit", name="Family Camp 5 CIT", start_date="2026-09-04", end_date="2026-09-07"),
    }
    atts = [_att(1301, "scit")] * 2 + [_att(1302, "scit")] * 7
    repo = _repo_by_year({2026: sessions}, {2026: atts})
    result = await Day1Service(repo).get_day1(2026, session_types=["scit", "tli"])

    priority = next(t for t in result.tiers if t.tier == "priority")
    teen = next(c for c in priority.categories if c.category == "teen")
    assert teen.count == 2


@pytest.mark.asyncio
async def test_duration_pick_scopes_day1():
    sessions = {
        1001: _make_session(1001, "main", start_date="2026-06-21", end_date="2026-06-27"),  # 1-week
        1002: _make_session(1002, "main", start_date="2026-06-28", end_date="2026-07-18"),  # 3-week
    }
    atts = [_att(1001)] * 2 + [_att(1002)] * 5
    repo = _repo_by_year({2026: sessions}, {2026: atts})
    result = await Day1Service(repo).get_day1(2026, session_types=_SUMMER_TYPES, duration="1-week")

    assert _total(result) == 2


@pytest.mark.asyncio
async def test_day1_summer_numbers_unchanged_by_family_adult_and_bmitzvah_sessions():
    """Family Camp / adult / B*Mitzvah / Hebrew never fold into summer Day 1 (#2435)."""
    base = {1001: _make_session(1001, "main", name="Session 2"), 1002: _make_session(1002, "quest")}
    extra = {
        1401: _make_session(1401, "family", name="Session 2"),  # same name as a summer session
        1402: _make_session(1402, "adult"),
        1403: _make_session(1403, "bmitzvah"),
        1404: _make_session(1404, "hebrew"),
    }
    summer_atts = [_att(1001)] * 2 + [_att(1002, "quest")]
    other_atts = [_att(1401, "family")] * 4 + [_att(1402, "adult")] * 3 + [_att(1403, "bmitzvah"), _att(1404, "hebrew")]

    async def run(with_extra: bool, **kw: Any) -> Any:
        sessions = {**base, **(extra if with_extra else {})}
        atts = summer_atts + (other_atts if with_extra else [])
        repo = _repo_by_year({2026: sessions, 2025: sessions}, {2026: atts, 2025: atts})
        return await Day1Service(repo).get_day1(2026, **kw)

    for kw in (
        {},
        {"session_types": _SUMMER_TYPES},
        {"session_types": _SUMMER_TYPES, "session_cm_id": 1001},
        {"session_types": ["family", "adult"]},
    ):
        plain, mixed = await run(False, **kw), await run(True, **kw)
        assert mixed.model_dump() == plain.model_dump(), kw
