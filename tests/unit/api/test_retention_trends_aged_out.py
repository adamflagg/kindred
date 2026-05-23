"""Tests for 10th grader exclusion in retention trends.

Verifies that:
- 10th graders are excluded from trend base counts and returned counts
- Enrollment counts are NOT affected (only retention is filtered)
- aged_out_count is reported per trend year
- include_teen_pipeline threads correctly (Tasks 1-3)
"""

from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest

from api.services.retention_trends_service import RetentionTrendsService

# ============================================================================
# Helpers
# ============================================================================


def _make_person(cm_id: int, grade: int | None = 7, gender: str = "M") -> Mock:
    p = Mock()
    p.cm_id = cm_id
    p.grade = grade
    p.gender = gender
    p.years_at_camp = 2
    p.school = "Riverside Elementary"
    p.normalized_school = None
    p.normalized_city = None
    p.normalized_congregation = None
    p.address_city = "Springfield"
    return p


def _make_session(cm_id: int, name: str = "Session 2", session_type: str = "main") -> Mock:
    s = Mock()
    s.cm_id = cm_id
    s.name = name
    s.session_type = session_type
    s.parent_id = None
    s.start_date = "2025-06-15"
    s.end_date = "2025-07-05"
    return s


def _make_attendee(person_id: int, session: Mock) -> Mock:
    a = Mock()
    a.person_id = person_id
    a.expand = {"session": session}
    a.status = "enrolled"
    return a


class TestRetentionTrendsAgedOutExclusion:
    """10th graders should be excluded from retention trend calculations."""

    @pytest.fixture
    def repo(self) -> AsyncMock:
        return AsyncMock()

    def _setup_repo(
        self,
        repo: AsyncMock,
        data_by_year: dict[int, dict[str, Any]],
    ) -> None:
        """Wire up mock repository with multi-year data."""

        async def fetch_attendees(year: int, *args: Any, **kwargs: Any) -> list[Any]:
            return data_by_year.get(year, {}).get("attendees", [])  # type: ignore[no-any-return]

        async def fetch_persons(year: int) -> dict[int, Any]:
            return data_by_year.get(year, {}).get("persons", {})  # type: ignore[no-any-return]

        async def fetch_sessions(year: int, types: Any) -> dict[int, Any]:
            return data_by_year.get(year, {}).get("sessions", {})  # type: ignore[no-any-return]

        repo.fetch_attendees = AsyncMock(side_effect=fetch_attendees)
        repo.fetch_persons = AsyncMock(side_effect=fetch_persons)
        repo.fetch_sessions = AsyncMock(side_effect=fetch_sessions)
        repo.fetch_summer_enrollment_history = AsyncMock(return_value=[])

    @pytest.mark.asyncio
    async def test_10th_graders_excluded_from_trend_base_count(self, repo: AsyncMock) -> None:
        """Trend base_count should not include 10th graders."""
        session_2025 = _make_session(1001, "Session 2")
        session_2026 = _make_session(2001, "Session 2")

        data = {
            2025: {
                "attendees": [
                    _make_attendee(1, session_2025),  # grade 7
                    _make_attendee(2, session_2025),  # grade 10 - excluded
                    _make_attendee(3, session_2025),  # grade 8
                ],
                "persons": {
                    1: _make_person(1, grade=7),
                    2: _make_person(2, grade=10),
                    3: _make_person(3, grade=8),
                },
                "sessions": {1001: session_2025},
            },
            2026: {
                "attendees": [
                    _make_attendee(1, session_2026),
                    _make_attendee(3, session_2026),
                ],
                "persons": {
                    1: _make_person(1, grade=8),
                    3: _make_person(3, grade=9),
                },
                "sessions": {2001: session_2026},
            },
        }

        self._setup_repo(repo, data)
        svc = RetentionTrendsService(repo)
        result = await svc.calculate_retention_trends(2026, num_years=1)

        assert len(result.years) == 1
        trend = result.years[0]
        # Base should be 2 (persons 1, 3) not 3
        assert trend.base_count == 2
        # Both returned
        assert trend.returned_count == 2

    @pytest.mark.asyncio
    async def test_11th_graders_included_in_trend_base_count(self, repo: AsyncMock) -> None:
        """Grade 11 is always tracked (flag-independent) — included in base pool.

        After removing the legacy_aged_out pin, grade 11 is kept in the base
        pool (they can return to a teen program next year). Only grade 10 is
        conditionally gated by include_teen_pipeline, and grade >=12 is always
        aged out.
        """
        session_2025 = _make_session(1001, "Session 2")
        session_2026 = _make_session(2001, "Session 2")

        data = {
            2025: {
                "attendees": [
                    _make_attendee(1, session_2025),  # grade 7
                    _make_attendee(2, session_2025),  # grade 11 - now included
                    _make_attendee(3, session_2025),  # grade 8
                ],
                "persons": {
                    1: _make_person(1, grade=7),
                    2: _make_person(2, grade=11),
                    3: _make_person(3, grade=8),
                },
                "sessions": {1001: session_2025},
            },
            2026: {
                "attendees": [
                    _make_attendee(1, session_2026),
                    _make_attendee(3, session_2026),
                ],
                "persons": {
                    1: _make_person(1, grade=8),
                    3: _make_person(3, grade=9),
                },
                "sessions": {2001: session_2026},
            },
        }

        self._setup_repo(repo, data)
        svc = RetentionTrendsService(repo)
        result = await svc.calculate_retention_trends(2026, num_years=1)

        trend = result.years[0]
        assert trend.base_count == 3  # persons 1, 2, 3 (grade 11 included)
        assert trend.aged_out_count == 0  # grade 11 is tracked, not aged out

    @pytest.mark.asyncio
    async def test_10th_graders_excluded_returns_aged_out_count(self, repo: AsyncMock) -> None:
        """Each trend year should report aged_out_count."""
        session_2025 = _make_session(1001, "Session 2")
        session_2026 = _make_session(2001, "Session 2")

        data = {
            2025: {
                "attendees": [
                    _make_attendee(1, session_2025),
                    _make_attendee(2, session_2025),  # grade 10
                ],
                "persons": {
                    1: _make_person(1, grade=7),
                    2: _make_person(2, grade=10),
                },
                "sessions": {1001: session_2025},
            },
            2026: {
                "attendees": [_make_attendee(1, session_2026)],
                "persons": {1: _make_person(1, grade=8)},
                "sessions": {2001: session_2026},
            },
        }

        self._setup_repo(repo, data)
        svc = RetentionTrendsService(repo)
        result = await svc.calculate_retention_trends(2026, num_years=1)

        assert result.years[0].aged_out_count == 1

    @pytest.mark.asyncio
    async def test_enrollment_not_affected_by_exclusion(self, repo: AsyncMock) -> None:
        """enrollment_by_year totals should NOT exclude 10th graders."""
        session_2025 = _make_session(1001, "Session 2")
        session_2026 = _make_session(2001, "Session 2")

        data = {
            2025: {
                "attendees": [
                    _make_attendee(1, session_2025),
                    _make_attendee(2, session_2025),  # grade 10
                ],
                "persons": {
                    1: _make_person(1, grade=7),
                    2: _make_person(2, grade=10),
                },
                "sessions": {1001: session_2025},
            },
            2026: {
                "attendees": [_make_attendee(1, session_2026)],
                "persons": {1: _make_person(1, grade=8)},
                "sessions": {2001: session_2026},
            },
        }

        self._setup_repo(repo, data)
        svc = RetentionTrendsService(repo)
        result = await svc.calculate_retention_trends(2026, num_years=1)

        # Enrollment should include ALL persons (including 10th graders)
        enrollment_2025 = next((e for e in result.enrollment_by_year if e.year == 2025), None)
        assert enrollment_2025 is not None
        assert enrollment_2025.total == 2  # both persons

    @pytest.mark.asyncio
    async def test_trend_retention_rate_correct_after_exclusion(self, repo: AsyncMock) -> None:
        """Retention rate should be calculated from filtered base."""
        session_2025 = _make_session(1001, "Session 2")
        session_2026 = _make_session(2001, "Session 2")

        data = {
            2025: {
                "attendees": [
                    _make_attendee(1, session_2025),  # grade 7, returns
                    _make_attendee(2, session_2025),  # grade 10, excluded
                    _make_attendee(3, session_2025),  # grade 8, doesn't return
                ],
                "persons": {
                    1: _make_person(1, grade=7),
                    2: _make_person(2, grade=10),
                    3: _make_person(3, grade=8),
                },
                "sessions": {1001: session_2025},
            },
            2026: {
                "attendees": [_make_attendee(1, session_2026)],
                "persons": {1: _make_person(1, grade=8)},
                "sessions": {2001: session_2026},
            },
        }

        self._setup_repo(repo, data)
        svc = RetentionTrendsService(repo)
        result = await svc.calculate_retention_trends(2026, num_years=1)

        # Base=2 (1,3), returned=1 (1), rate=50%
        assert result.years[0].retention_rate == pytest.approx(0.5)


# ============================================================================
# Helpers for Tasks 1-3
# ============================================================================


def _make_session_with_dates(
    cm_id: int,
    name: str = "Session 2",
    session_type: str = "main",
    start_date: str = "2025-06-15",
    end_date: str = "2025-07-05",
) -> Mock:
    s = Mock()
    s.cm_id = cm_id
    s.name = name
    s.session_type = session_type
    s.parent_id = None
    s.start_date = start_date
    s.end_date = end_date
    return s


def _build_repo(data_by_year: dict[int, dict[str, Any]]) -> AsyncMock:
    """Build a mock repository from a data_by_year dict (attendees/persons/sessions per year)."""
    repo = AsyncMock()

    async def fetch_attendees(year: int, *args: Any, **kwargs: Any) -> list[Any]:
        return data_by_year.get(year, {}).get("attendees", [])  # type: ignore[no-any-return]

    async def fetch_persons(year: int) -> dict[int, Any]:
        return data_by_year.get(year, {}).get("persons", {})  # type: ignore[no-any-return]

    async def fetch_sessions(year: int, types: Any) -> dict[int, Any]:
        return data_by_year.get(year, {}).get("sessions", {})  # type: ignore[no-any-return]

    repo.fetch_attendees = AsyncMock(side_effect=fetch_attendees)
    repo.fetch_persons = AsyncMock(side_effect=fetch_persons)
    repo.fetch_sessions = AsyncMock(side_effect=fetch_sessions)
    repo.fetch_summer_enrollment_history = AsyncMock(return_value=[])
    return repo


def _build_trends_service(
    grade: int,
    base_year_session: str,
    returns_next_year: bool,
) -> RetentionTrendsService:
    """Build a RetentionTrendsService with a single camper for testing include_teen_pipeline.

    - base_year 2025: camper (person_id=1) in session type `base_year_session`, grade=`grade`
    - compare year 2026: same camper present iff returns_next_year=True

    For teen sessions (scit/tli), the session dates are within the summer window
    (derived from a co-located main session) so resolve_cohort_session_ids gates them in.
    """
    # Always include a main session so get_summer_window has a reference point.
    main_2025 = _make_session_with_dates(9001, "Session 2", "main", "2025-06-15", "2025-07-05")
    main_2026 = _make_session_with_dates(9002, "Session 2", "main", "2026-06-15", "2026-07-05")

    if base_year_session in ("scit", "tli"):
        base_session = _make_session_with_dates(1001, "SCIT", base_year_session, "2025-06-15", "2025-07-05")
        compare_session = _make_session_with_dates(2001, "SCIT", base_year_session, "2026-06-15", "2026-07-05")
    else:
        base_session = _make_session_with_dates(1001, "Session 2", base_year_session, "2025-06-15", "2025-07-05")
        compare_session = _make_session_with_dates(2001, "Session 2", base_year_session, "2026-06-15", "2026-07-05")

    person = _make_person(1, grade=grade)

    attendees_base = [_make_attendee(1, base_session)]
    attendees_compare = [_make_attendee(1, compare_session)] if returns_next_year else []

    sessions_2025: dict[int, Any] = {main_2025.cm_id: main_2025, base_session.cm_id: base_session}
    sessions_2026: dict[int, Any] = {main_2026.cm_id: main_2026, compare_session.cm_id: compare_session}

    data_by_year: dict[int, dict[str, Any]] = {
        2025: {
            "attendees": attendees_base,
            "persons": {1: person},
            "sessions": sessions_2025,
        },
        2026: {
            "attendees": attendees_compare,
            "persons": {1: _make_person(1, grade=grade + 1)},
            "sessions": sessions_2026,
        },
    }
    return RetentionTrendsService(_build_repo(data_by_year))


def _build_trends_service_offseason_return() -> RetentionTrendsService:
    """Build service where base is summer SCIT 2025 (grade 11) and compare is
    an off-season SCIT session in 2026 (February dates, outside summer window).
    The off-season session should NOT count as returned.
    """
    # 2025: main + summer scit
    main_2025 = _make_session_with_dates(9001, "Session 2", "main", "2025-06-15", "2025-07-05")
    scit_2025 = _make_session_with_dates(1001, "SCIT", "scit", "2025-06-15", "2025-07-05")

    # 2026: main (summer) + off-season scit (February L.A. trip)
    main_2026 = _make_session_with_dates(9002, "Session 2", "main", "2026-06-15", "2026-07-05")
    scit_2026_offseason = _make_session_with_dates(2001, "Feb LA Trip", "scit", "2026-02-01", "2026-02-05")

    person = _make_person(1, grade=11)

    data_by_year: dict[int, dict[str, Any]] = {
        2025: {
            "attendees": [_make_attendee(1, scit_2025)],
            "persons": {1: person},
            "sessions": {main_2025.cm_id: main_2025, scit_2025.cm_id: scit_2025},
        },
        2026: {
            "attendees": [_make_attendee(1, scit_2026_offseason)],
            "persons": {1: _make_person(1, grade=12)},
            "sessions": {main_2026.cm_id: main_2026, scit_2026_offseason.cm_id: scit_2026_offseason},
        },
    }
    return RetentionTrendsService(_build_repo(data_by_year))


def _build_trends_service_main_quest() -> RetentionTrendsService:
    """Build service with main + quest sessions and grade-9 campers across 2 year transitions.
    Used to verify that include_teen_pipeline has NO effect in a non-teen scope.
    """

    # Two persons: grade 7 and grade 8 (both stay in non-teen territory).
    def _year_data(yr: int, base_offset: int) -> dict[str, Any]:
        main_s = _make_session_with_dates(base_offset + 1, "Session 2", "main", f"{yr}-06-15", f"{yr}-07-05")
        quest_s = _make_session_with_dates(base_offset + 2, "Quest", "quest", f"{yr}-06-20", f"{yr}-06-27")
        p1 = _make_person(1, grade=7 + (yr - 2024))
        p2 = _make_person(2, grade=8 + (yr - 2024))
        return {
            "attendees": [_make_attendee(1, main_s), _make_attendee(2, quest_s)],
            "persons": {1: p1, 2: p2},
            "sessions": {main_s.cm_id: main_s, quest_s.cm_id: quest_s},
        }

    data_by_year = {yr: _year_data(yr, yr * 100) for yr in [2024, 2025, 2026]}
    return RetentionTrendsService(_build_repo(data_by_year))


# ============================================================================
# Task 1: include_teen_pipeline + effective_pipeline aged-out
# ============================================================================


class TestTrendsIncludeTeenPipeline:
    """Thread include_teen_pipeline through calculate_retention_trends."""

    @pytest.mark.asyncio
    async def test_trends_grade11_always_in_base_teen_scope(self) -> None:
        """Rising-11th-grader in summer SCIT is in base pool regardless of the flag."""
        svc = _build_trends_service(grade=11, base_year_session="scit", returns_next_year=True)
        off = await svc.calculate_retention_trends(
            2026, num_years=1, session_types=["scit", "tli"], include_teen_pipeline=False
        )
        on = await svc.calculate_retention_trends(
            2026, num_years=1, session_types=["scit", "tli"], include_teen_pipeline=True
        )
        assert off.years[-1].base_count == 1
        assert on.years[-1].base_count == 1

    @pytest.mark.asyncio
    async def test_trends_grade10_gated_by_flag_teen_scope(self) -> None:
        """Grade-10 camper is excluded when flag=False and credited when flag=True (teen scope)."""
        svc = _build_trends_service(grade=10, base_year_session="main", returns_next_year=True)
        off = await svc.calculate_retention_trends(
            2026, num_years=1, session_types=["main", "scit", "tli"], include_teen_pipeline=False
        )
        on = await svc.calculate_retention_trends(
            2026, num_years=1, session_types=["main", "scit", "tli"], include_teen_pipeline=True
        )
        assert off.years[-1].base_count == 0  # grade 10 aged out
        assert on.years[-1].base_count == 1  # grade 10 credited


# ============================================================================
# Task 2: summer-window cohort gating + flag-off invariance
# ============================================================================


class TestTrendsCohortGatingAndInvariance:
    """Summer-window gate and flag-off safety invariant."""

    @pytest.mark.asyncio
    async def test_trends_offseason_teen_return_not_counted(self) -> None:
        """Off-season scit session (Feb dates outside summer window) must NOT count as returned."""
        svc = _build_trends_service_offseason_return()
        res = await svc.calculate_retention_trends(
            2026, num_years=1, session_types=["scit", "tli"], include_teen_pipeline=True
        )
        assert res.years[-1].returned_count == 0

    @pytest.mark.asyncio
    async def test_trends_flag_off_invariance_non_teen(self) -> None:
        """In a non-teen scope, toggling include_teen_pipeline must not change any numbers."""
        svc = _build_trends_service_main_quest()
        off = await svc.calculate_retention_trends(
            2026, num_years=2, session_types=["main", "quest"], include_teen_pipeline=False
        )
        on = await svc.calculate_retention_trends(
            2026, num_years=2, session_types=["main", "quest"], include_teen_pipeline=True
        )
        assert [y.retention_rate for y in on.years] == [y.retention_rate for y in off.years]
        assert [y.base_count for y in on.years] == [y.base_count for y in off.years]


# ============================================================================
# Task 3: by_grade carve-out for grade 10 in teen scope
# ============================================================================


class TestTrendsByGradeCarveOut:
    """Grade-10 always appears in by_grade when scope includes teen sessions."""

    @pytest.mark.asyncio
    async def test_trends_by_grade_includes_grade10_in_teen_scope(self) -> None:
        """Grade-10 row must appear in by_grade even when include_teen_pipeline=False (teen scope)."""
        svc = _build_trends_service(grade=10, base_year_session="main", returns_next_year=False)
        res = await svc.calculate_retention_trends(
            2026, num_years=1, session_types=["main", "scit", "tli"], include_teen_pipeline=False
        )
        grades = {row.grade for row in res.years[-1].by_grade}
        assert 10 in grades


class TestRetentionTrendsAgChildren:
    """Selecting a parent session must keep its AG children in the cohort."""

    @pytest.mark.asyncio
    async def test_session_scoped_trend_includes_ag_children(self) -> None:
        """A session-scoped trend must count campers in the session's AG children.

        When the user picks a main session, its AG child sessions (separate
        cm_ids carrying parent_id) belong to that selection. Filtering the cohort
        to the exact cm_id alone drops the AG campers and understates base_count.
        """
        main_2025 = _make_session_with_dates(1001, "Session 2", "main", "2025-06-15", "2025-07-05")
        ag_2025 = _make_session_with_dates(1010, "Session 2 AG", "ag", "2025-06-15", "2025-07-05")
        ag_2025.parent_id = 1001
        main_2026 = _make_session_with_dates(2001, "Session 2", "main", "2026-06-15", "2026-07-05")

        # Camper 1 enrolled directly in the parent main session; camper 2 in its AG child.
        attendees_2025 = [_make_attendee(1, main_2025), _make_attendee(2, ag_2025)]
        data_by_year: dict[int, dict[str, Any]] = {
            2025: {
                "attendees": attendees_2025,
                "persons": {1: _make_person(1, grade=7), 2: _make_person(2, grade=7)},
                "sessions": {1001: main_2025, 1010: ag_2025},
            },
            2026: {
                "attendees": [],
                "persons": {},
                "sessions": {2001: main_2026},
            },
        }
        svc = RetentionTrendsService(_build_repo(data_by_year))
        result = await svc.calculate_retention_trends(2026, num_years=1, session_cm_id=1001)

        # Both campers belong to the selected parent session (one directly, one
        # via its AG child), so the base pool must be 2 — not just the direct one.
        assert result.years[0].base_count == 2
