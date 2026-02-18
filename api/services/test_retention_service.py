"""Tests for RetentionService - written first (TDD).

These tests define the expected behavior for the retention service that
moves business logic out of the endpoint and into a testable service.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest


@dataclass
class MockPerson:
    """Mock person object for testing."""

    cm_id: int
    gender: str | None = None
    grade: int | None = None
    years_at_camp: int | None = None


@dataclass
class MockSession:
    """Mock session object for testing."""

    cm_id: int
    name: str
    session_type: str
    parent_id: int | None = None
    start_date: str | None = None
    end_date: str | None = None


@dataclass
class MockAttendee:
    """Mock attendee object for testing."""

    person_id: int
    year: int
    expand: dict[str, Any] | None = None


@dataclass
class MockCamperHistory:
    """Mock camper history record for testing."""

    person_id: int
    school: str | None = None
    city: str | None = None
    synagogue: str | None = None
    first_year_attended: int | None = None
    sessions: str | None = None
    bunks: str | None = None


class TestRetentionServiceCalculateRetention:
    """Tests for RetentionService.calculate_retention method."""

    @pytest.mark.asyncio
    async def test_calculate_retention_returns_correct_response_shape(self) -> None:
        """calculate_retention returns RetentionMetricsResponse with all fields."""
        from api.services.retention_service import RetentionService

        # Setup mock repository
        mock_repo = AsyncMock()

        # Mock data: 5 campers in base year, 3 returned in compare year
        mock_repo.fetch_attendees.side_effect = [
            # Base year attendees
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=3,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=4,
                    year=2025,
                    expand={"session": MockSession(cm_id=1001, name="Session 2", session_type="main")},
                ),
                MockAttendee(
                    person_id=5,
                    year=2025,
                    expand={"session": MockSession(cm_id=1001, name="Session 2", session_type="main")},
                ),
            ],
            # Compare year attendees (persons 1, 2, 4 returned)
            [
                MockAttendee(person_id=1, year=2026, expand={}),
                MockAttendee(person_id=2, year=2026, expand={}),
                MockAttendee(person_id=4, year=2026, expand={}),
                MockAttendee(person_id=6, year=2026, expand={}),  # New camper
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M", grade=5, years_at_camp=2),
            2: MockPerson(cm_id=2, gender="M", grade=5, years_at_camp=1),
            3: MockPerson(cm_id=3, gender="F", grade=6, years_at_camp=1),
            4: MockPerson(cm_id=4, gender="F", grade=6, years_at_camp=3),
            5: MockPerson(cm_id=5, gender="F", grade=7, years_at_camp=2),
        }

        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
            1001: MockSession(cm_id=1001, name="Session 2", session_type="main"),
        }

        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        # build_history_by_person is a sync method, use MagicMock return
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
        )

        # Verify response shape
        assert result.base_year == 2025
        assert result.compare_year == 2026
        assert result.base_year_total == 5
        assert result.compare_year_total == 4
        assert result.returned_count == 3
        assert result.overall_retention_rate == pytest.approx(0.6)  # 3/5

        # Verify breakdown lists exist
        assert isinstance(result.by_gender, list)
        assert isinstance(result.by_grade, list)
        assert isinstance(result.by_session, list)
        assert isinstance(result.by_years_at_camp, list)

    @pytest.mark.asyncio
    async def test_calculate_retention_gender_breakdown(self) -> None:
        """calculate_retention computes correct gender breakdown."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2 males (1 returned), 3 females (2 returned)
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                ),
                MockAttendee(
                    person_id=2, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                ),
                MockAttendee(
                    person_id=3, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                ),
                MockAttendee(
                    person_id=4, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                ),
                MockAttendee(
                    person_id=5, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                ),
            ],
            [
                MockAttendee(person_id=1, year=2026, expand={}),
                MockAttendee(person_id=3, year=2026, expand={}),
                MockAttendee(person_id=4, year=2026, expand={}),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),  # Returned
            2: MockPerson(cm_id=2, gender="M"),  # Not returned
            3: MockPerson(cm_id=3, gender="F"),  # Returned
            4: MockPerson(cm_id=4, gender="F"),  # Returned
            5: MockPerson(cm_id=5, gender="F"),  # Not returned
        }

        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        # Find gender breakdowns
        male_stats = next((g for g in result.by_gender if g.gender == "M"), None)
        female_stats = next((g for g in result.by_gender if g.gender == "F"), None)

        assert male_stats is not None
        assert male_stats.base_count == 2
        assert male_stats.returned_count == 1
        assert male_stats.retention_rate == 0.5

        assert female_stats is not None
        assert female_stats.base_count == 3
        assert female_stats.returned_count == 2
        assert female_stats.retention_rate == pytest.approx(2 / 3)

    @pytest.mark.asyncio
    async def test_calculate_retention_filters_by_session_types(self) -> None:
        """calculate_retention filters attendees by session_types."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # Base year has main and ag sessions
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                ),
                MockAttendee(
                    person_id=2, year=2025, expand={"session": MockSession(cm_id=1001, name="AG", session_type="ag")}
                ),
                MockAttendee(
                    person_id=3,
                    year=2025,
                    expand={"session": MockSession(cm_id=1002, name="Family", session_type="family")},
                ),
            ],
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Session 1", session_type="main")},
                ),
                # CampMinder reuses cm_ids across years
                MockAttendee(
                    person_id=2,
                    year=2026,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
            3: MockPerson(cm_id=3, gender="M"),
        }

        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_types=["main"],  # Only main sessions
        )

        # Only person 1 should be counted (main session)
        assert result.base_year_total == 1
        assert result.returned_count == 1

    @pytest.mark.asyncio
    async def test_compare_year_excludes_non_matching_session_types(self) -> None:
        """compare_year_total excludes attendees whose session type doesn't match filter."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # Base year: 2 campers in main sessions
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
            ],
            # Compare year: person 1 returned (main), person 3 new (main),
            # person 4 new (family camp - should be excluded)
            # CampMinder reuses cm_ids across years
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=3,
                    year=2026,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=4,
                    year=2026,
                    expand={"session": MockSession(cm_id=1001, name="Family Camp", session_type="family")},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
        }

        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_types=["main"],
        )

        # Base year: 2 campers in main sessions
        assert result.base_year_total == 2
        # Compare year: only 2 in main sessions (family camp excluded)
        assert result.compare_year_total == 2
        # Person 1 returned
        assert result.returned_count == 1

    @pytest.mark.asyncio
    async def test_calculate_retention_filters_by_session_cm_id(self) -> None:
        """calculate_retention filters attendees by specific session_cm_id."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                ),
                MockAttendee(
                    person_id=2, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                ),
                MockAttendee(
                    person_id=3, year=2025, expand={"session": MockSession(cm_id=1001, name="S2", session_type="main")}
                ),
            ],
            # CampMinder reuses cm_ids across years
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2026,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                # Person 5 in a different session - should be filtered out by cm_id
                MockAttendee(
                    person_id=5,
                    year=2026,
                    expand={"session": MockSession(cm_id=1001, name="Session 2", session_type="main")},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
            3: MockPerson(cm_id=3, gender="M"),
        }

        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
            1001: MockSession(cm_id=1001, name="Session 2", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_cm_id=1000,  # Only Session 1
        )

        # Only persons 1 and 2 should be counted (base year)
        assert result.base_year_total == 2
        # Compare year: person 5 excluded (different cm_id)
        assert result.compare_year_total == 2
        assert result.returned_count == 2

    @pytest.mark.asyncio
    async def test_compare_year_filters_by_session_cm_id(self) -> None:
        """Compare year attendees are filtered by session_cm_id (CampMinder reuses IDs across years)."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # Base year: 2 campers in session cm_id=1000
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
            ],
            # Compare year: person 1 in cm_id=1000 (returned), person 3 in cm_id=1001 (different session)
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=3,
                    year=2026,
                    expand={"session": MockSession(cm_id=1001, name="Session 2", session_type="main")},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
        }

        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_cm_id=1000,
        )

        # Compare year should only count person 1 (cm_id=1000), not person 3 (cm_id=1001)
        assert result.compare_year_total == 1
        assert result.returned_count == 1

    @pytest.mark.asyncio
    async def test_calculate_retention_handles_empty_base_year(self) -> None:
        """calculate_retention handles empty base year gracefully."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.side_effect = [[], []]  # No attendees
        mock_repo.fetch_persons.return_value = {}
        mock_repo.fetch_sessions.return_value = {}
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        assert result.base_year_total == 0
        assert result.returned_count == 0
        assert result.overall_retention_rate == 0.0
        assert result.by_gender == []
        assert result.by_grade == []

    @pytest.mark.asyncio
    async def test_calculate_retention_merges_ag_into_parent(self) -> None:
        """calculate_retention merges AG session stats into parent sessions.

        by_session now shows compare year sessions. AG sessions in the compare
        year should merge into their parent main session.
        """
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # Person 1 in main, person 2 in AG (parent is main) - both years
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={"session": MockSession(cm_id=1001, name="AG Session", session_type="ag", parent_id=1000)},
                ),
            ],
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2026,
                    expand={"session": MockSession(cm_id=2001, name="AG Session", session_type="ag", parent_id=2000)},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
        }

        async def mock_fetch_sessions(year: int, session_types: list[str] | None = None) -> dict[int, MockSession]:
            if year == 2025:
                return {
                    1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
                    1001: MockSession(cm_id=1001, name="AG Session", session_type="ag", parent_id=1000),
                }
            return {
                2000: MockSession(cm_id=2000, name="Session 1", session_type="main"),
                2001: MockSession(cm_id=2001, name="AG Session", session_type="ag", parent_id=2000),
            }

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        # by_session shows compare year sessions with AG merged into parent
        assert len(result.by_session) == 1
        assert result.by_session[0].session_name == "Session 1"
        # Both campers should be counted under the main session
        assert result.by_session[0].base_count == 2


class TestRetentionSessionChartSemantics:
    """Tests for correct session chart semantics.

    Chart 1 (by_session): Shows compare year (2026) sessions.
    base_count = total enrolled in that 2026 session.
    returned_count = those who were also in base year (any session type, unfiltered).

    Chart 2 (by_prior_session): Shows ALL base year (2025) sessions (unfiltered by dropdown).
    base_count = total enrolled in that 2025 session.
    returned_count = those in compare year matching the dropdown filter.
    """

    @pytest.mark.asyncio
    async def test_by_session_shows_compare_year_sessions(self) -> None:
        """by_session lists compare year (2026) sessions, not base year."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025: person 1 in quest, person 2 in main Session 1
        # 2026: both in main Session 1
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Quest", session_type="quest")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={"session": MockSession(cm_id=1001, name="Session 1", session_type="main")},
                ),
            ],
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Session 1", session_type="main")},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
        }

        async def mock_fetch_sessions(year: int, session_types: list[str] | None = None) -> dict[int, MockSession]:
            if year == 2025:
                return {
                    1000: MockSession(cm_id=1000, name="Quest", session_type="quest"),
                    1001: MockSession(cm_id=1001, name="Session 1", session_type="main"),
                }
            return {2000: MockSession(cm_id=2000, name="Session 1", session_type="main")}

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        # by_session should show 2026 Session 1, not 2025 sessions
        assert len(result.by_session) == 1
        assert result.by_session[0].session_name == "Session 1"
        assert result.by_session[0].session_cm_id == 2000
        # base_count = total in 2026 Session 1
        assert result.by_session[0].base_count == 2
        # returned_count = those who were in ANY 2025 session
        assert result.by_session[0].returned_count == 2

    @pytest.mark.asyncio
    async def test_by_session_counts_returning_from_any_base_session_type(self) -> None:
        """by_session returned count includes campers from any base year session type.

        Even with "at camp" filter, a person who was in quest-only in 2025
        should count as returning if they're in a 2026 main session.
        """
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # Person 1: quest-only in 2025, main in 2026
        # Person 3: new in 2026 (not in 2025 at all)
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Quest", session_type="quest")},
                ),
            ],
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=3,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Session 1", session_type="main")},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
        }

        # "at camp" filter: main/embedded/ag
        async def mock_fetch_sessions(year: int, session_types: list[str] | None = None) -> dict[int, MockSession]:
            all_sessions: dict[int, dict[int, MockSession]] = {
                2025: {1000: MockSession(cm_id=1000, name="Quest", session_type="quest")},
                2026: {2000: MockSession(cm_id=2000, name="Session 1", session_type="main")},
            }
            sessions = all_sessions.get(year, {})
            if session_types:
                return {k: v for k, v in sessions.items() if v.session_type in session_types}
            return sessions

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_types=["main", "embedded", "ag"],
        )

        # by_session shows 2026 Session 1
        assert len(result.by_session) == 1
        # base_count = total in 2026 Session 1 (persons 1 and 3)
        assert result.by_session[0].base_count == 2
        # Person 1 was in quest in 2025 — still counts as returning
        # Person 3 was NOT in 2025 at all — does not count
        assert result.by_session[0].returned_count == 1

    @pytest.mark.asyncio
    async def test_by_prior_session_shows_all_base_year_sessions(self) -> None:
        """by_prior_session includes all base year session types regardless of dropdown filter."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025: person 1 in quest, person 2 in main Session 1
        # 2026: both in main Session 1
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Quest", session_type="quest")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={"session": MockSession(cm_id=1001, name="Session 1", session_type="main")},
                ),
            ],
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Session 1", session_type="main")},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
        }

        # "at camp" filter — but by_prior_session should still show quest
        async def mock_fetch_sessions(year: int, session_types: list[str] | None = None) -> dict[int, MockSession]:
            all_sessions: dict[int, dict[int, MockSession]] = {
                2025: {
                    1000: MockSession(cm_id=1000, name="Quest", session_type="quest"),
                    1001: MockSession(cm_id=1001, name="Session 1", session_type="main"),
                },
                2026: {2000: MockSession(cm_id=2000, name="Session 1", session_type="main")},
            }
            sessions = all_sessions.get(year, {})
            if session_types:
                return {k: v for k, v in sessions.items() if v.session_type in session_types}
            return sessions

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_types=["main", "embedded", "ag"],  # "at camp" filter
        )

        # by_prior_session should include BOTH quest and main from 2025
        session_names = {s.prior_session for s in result.by_prior_session}
        assert "Quest" in session_names
        assert "Session 1" in session_names

    @pytest.mark.asyncio
    async def test_by_prior_session_returned_filtered_by_dropdown(self) -> None:
        """by_prior_session returned count reflects only compare year sessions matching dropdown.

        2025 quest has 2 kids. Kid 1 returns to quest in 2026, kid 2 returns to
        main in 2026. With "at camp" dropdown: quest shows 1 of 2 returned
        (only kid 2 who went to main counts, since quest is not in the filter).
        """
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025 quest: person 1 + person 2
        # 2026: person 1 → quest, person 2 → main Session 2
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Quest", session_type="quest")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Quest", session_type="quest")},
                ),
            ],
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2100, name="Quest", session_type="quest")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Session 2", session_type="main")},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
        }

        async def mock_fetch_sessions(year: int, session_types: list[str] | None = None) -> dict[int, MockSession]:
            all_sessions: dict[int, dict[int, MockSession]] = {
                2025: {1000: MockSession(cm_id=1000, name="Quest", session_type="quest")},
                2026: {
                    2000: MockSession(cm_id=2000, name="Session 2", session_type="main"),
                    2100: MockSession(cm_id=2100, name="Quest", session_type="quest"),
                },
            }
            sessions = all_sessions.get(year, {})
            if session_types:
                return {k: v for k, v in sessions.items() if v.session_type in session_types}
            return sessions

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        # "At camp" filter: only main/embedded/ag
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_types=["main", "embedded", "ag"],
        )

        # by_prior_session should show Quest from 2025 with base=2
        quest = next((s for s in result.by_prior_session if s.prior_session == "Quest"), None)
        assert quest is not None
        assert quest.base_count == 2
        # With "at camp" filter: only person 2 returned to main session
        # Person 1 returned to quest which is NOT in the "at camp" filter
        assert quest.returned_count == 1


class TestRetentionServiceComputeSummerMetrics:
    """Tests for summer enrollment metrics computation."""

    @pytest.mark.asyncio
    async def test_computes_summer_years_correctly(self) -> None:
        """Service computes summer years from enrollment history."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # Person 1: enrolled 2023, 2024, 2025 (3 summers)
        # Person 2: enrolled 2025 only (1 summer)
        mock_repo.fetch_attendees.side_effect = [
            # Base year
            [
                MockAttendee(
                    person_id=1, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                ),
                MockAttendee(
                    person_id=2, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                ),
            ],
            # Compare year
            [MockAttendee(person_id=1, year=2026, expand={})],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
        }

        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []

        # Summer enrollment history
        mock_repo.fetch_summer_enrollment_history.return_value = [
            MockAttendee(
                person_id=1, year=2023, expand={"session": MockSession(cm_id=900, name="S1-2023", session_type="main")}
            ),
            MockAttendee(
                person_id=1, year=2024, expand={"session": MockSession(cm_id=950, name="S1-2024", session_type="main")}
            ),
            MockAttendee(
                person_id=1, year=2025, expand={"session": MockSession(cm_id=1000, name="S1-2025", session_type="main")}
            ),
            MockAttendee(
                person_id=2, year=2025, expand={"session": MockSession(cm_id=1000, name="S1-2025", session_type="main")}
            ),
        ]
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        # Check summer years breakdown
        assert len(result.by_summer_years) == 2

        one_summer = next((s for s in result.by_summer_years if s.summer_years == 1), None)
        three_summers = next((s for s in result.by_summer_years if s.summer_years == 3), None)

        assert one_summer is not None
        assert one_summer.base_count == 1  # Person 2

        assert three_summers is not None
        assert three_summers.base_count == 1  # Person 1


class TestRetentionSessionFlow:
    """Tests for session_flow field in RetentionMetricsResponse.

    The session_flow field provides data for a Sankey diagram showing
    how campers flow from base year sessions to compare year sessions.
    """

    @pytest.mark.asyncio
    async def test_session_flow_basic(self) -> None:
        """Basic flow: 3 campers across 2 sessions produce correct flow items."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025: person 1+2 in Session 1, person 3 in Session 2
        # 2026: person 1 in Session 1, person 2 in Session 2, person 3 in Session 1
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=3,
                    year=2025,
                    expand={"session": MockSession(cm_id=1001, name="Session 2", session_type="main")},
                ),
            ],
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2026,
                    expand={"session": MockSession(cm_id=2001, name="Session 2", session_type="main")},
                ),
                MockAttendee(
                    person_id=3,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Session 1", session_type="main")},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
            3: MockPerson(cm_id=3, gender="M"),
        }

        async def mock_fetch_sessions(year: int, session_types: list[str] | None = None) -> dict[int, MockSession]:
            if year == 2025:
                return {
                    1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
                    1001: MockSession(cm_id=1001, name="Session 2", session_type="main"),
                }
            return {
                2000: MockSession(cm_id=2000, name="Session 1", session_type="main"),
                2001: MockSession(cm_id=2001, name="Session 2", session_type="main"),
            }

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        assert len(result.session_flow) > 0

        # Build lookup: (source, target) -> value
        flow_map = {(f.source, f.target): f.value for f in result.session_flow}

        # Session 1 -> Session 1: person 1
        assert flow_map.get(("Session 1", "Session 1")) == 1
        # Session 1 -> Session 2: person 2
        assert flow_map.get(("Session 1", "Session 2")) == 1
        # Session 2 -> Session 1: person 3
        assert flow_map.get(("Session 2", "Session 1")) == 1

    @pytest.mark.asyncio
    async def test_session_flow_did_not_return(self) -> None:
        """Non-returned campers generate 'Did Not Return' flow entries."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025: person 1+2 in Session 1
        # 2026: only person 1 returns
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
            ],
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Session 1", session_type="main")},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
        }

        async def mock_fetch_sessions(year: int, session_types: list[str] | None = None) -> dict[int, MockSession]:
            if year == 2025:
                return {1000: MockSession(cm_id=1000, name="Session 1", session_type="main")}
            return {2000: MockSession(cm_id=2000, name="Session 1", session_type="main")}

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        flow_map = {(f.source, f.target): f.value for f in result.session_flow}

        # Person 1: Session 1 -> Session 1
        assert flow_map.get(("Session 1", "Session 1")) == 1
        # Person 2: Session 1 -> Did Not Return
        assert flow_map.get(("Session 1", "Did Not Return")) == 1

    @pytest.mark.asyncio
    async def test_session_flow_ag_merged(self) -> None:
        """AG sessions collapse into parent session on both source and target sides."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025: person 1 in AG (parent=Session 1), person 2 in Session 1
        # 2026: person 1 in Session 2, person 2 in AG (parent=Session 1)
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1001, name="AG Session", session_type="ag", parent_id=1000)},
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
            ],
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2001, name="Session 2", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2026,
                    expand={"session": MockSession(cm_id=2002, name="AG Session", session_type="ag", parent_id=2000)},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
        }

        async def mock_fetch_sessions(year: int, session_types: list[str] | None = None) -> dict[int, MockSession]:
            if year == 2025:
                return {
                    1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
                    1001: MockSession(cm_id=1001, name="AG Session", session_type="ag", parent_id=1000),
                }
            return {
                2000: MockSession(cm_id=2000, name="Session 1", session_type="main"),
                2001: MockSession(cm_id=2001, name="Session 2", session_type="main"),
                2002: MockSession(cm_id=2002, name="AG Session", session_type="ag", parent_id=2000),
            }

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        flow_map = {(f.source, f.target): f.value for f in result.session_flow}

        # Both persons should show as "Session 1" source (AG merged)
        # Person 1: Session 1 -> Session 2
        assert flow_map.get(("Session 1", "Session 2")) == 1
        # Person 2: Session 1 -> Session 1 (AG target merged to parent)
        assert flow_map.get(("Session 1", "Session 1")) == 1

        # No AG entries should appear
        ag_entries = [f for f in result.session_flow if "AG" in f.source or "AG" in f.target]
        assert len(ag_entries) == 0

    @pytest.mark.asyncio
    async def test_session_flow_multi_session_camper(self) -> None:
        """Camper in multiple compare-year sessions produces multiple flow links."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025: person 1 in Session 1
        # 2026: person 1 in Session 1 AND Session 2 (multi-session camper)
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
            ],
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2001, name="Session 2", session_type="main")},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
        }

        async def mock_fetch_sessions(year: int, session_types: list[str] | None = None) -> dict[int, MockSession]:
            if year == 2025:
                return {1000: MockSession(cm_id=1000, name="Session 1", session_type="main")}
            return {
                2000: MockSession(cm_id=2000, name="Session 1", session_type="main"),
                2001: MockSession(cm_id=2001, name="Session 2", session_type="main"),
            }

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        flow_map = {(f.source, f.target): f.value for f in result.session_flow}

        # Person 1 goes from Session 1 to both Session 1 and Session 2
        assert flow_map.get(("Session 1", "Session 1")) == 1
        assert flow_map.get(("Session 1", "Session 2")) == 1

    @pytest.mark.asyncio
    async def test_session_flow_unfiltered_destinations(self) -> None:
        """Even when session_types filter is set, destinations show ALL session types."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025: person 1 in Session 1 (main), person 2 in Session 1 (main)
        # 2026: person 1 -> Quest, person 2 -> Session 1 (main)
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
            ],
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2100, name="Quest", session_type="quest")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Session 1", session_type="main")},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
        }

        async def mock_fetch_sessions(year: int, session_types: list[str] | None = None) -> dict[int, MockSession]:
            all_sessions: dict[int, dict[int, MockSession]] = {
                2025: {1000: MockSession(cm_id=1000, name="Session 1", session_type="main")},
                2026: {
                    2000: MockSession(cm_id=2000, name="Session 1", session_type="main"),
                    2100: MockSession(cm_id=2100, name="Quest", session_type="quest"),
                },
            }
            sessions = all_sessions.get(year, {})
            if session_types:
                return {k: v for k, v in sessions.items() if v.session_type in session_types}
            return sessions

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        # Filter to "at camp" (main only) — but destinations should show all
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_types=["main", "embedded", "ag"],
        )

        flow_map = {(f.source, f.target): f.value for f in result.session_flow}

        # Person 1 went to Quest — should still appear in flow
        assert flow_map.get(("Session 1", "Quest")) == 1
        # Person 2 went to main Session 1
        assert flow_map.get(("Session 1", "Session 1")) == 1

    @pytest.mark.asyncio
    async def test_session_flow_empty(self) -> None:
        """No attendees produces empty session_flow list."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.side_effect = [[], []]
        mock_repo.fetch_persons.return_value = {}
        mock_repo.fetch_sessions.return_value = {}
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        assert result.session_flow == []

    @pytest.mark.asyncio
    async def test_session_flow_filtered_by_session_cm_id(self) -> None:
        """Only the filtered base-year session appears as a source."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025: person 1 in Session 1, person 2 in Session 2
        # 2026: both return to Session 1
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={"session": MockSession(cm_id=1001, name="Session 2", session_type="main")},
                ),
            ],
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Session 1", session_type="main")},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
        }

        async def mock_fetch_sessions(year: int, session_types: list[str] | None = None) -> dict[int, MockSession]:
            if year == 2025:
                return {
                    1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
                    1001: MockSession(cm_id=1001, name="Session 2", session_type="main"),
                }
            return {2000: MockSession(cm_id=2000, name="Session 1", session_type="main")}

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        # Filter to Session 1 only
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_cm_id=1000,
        )

        # Only Session 1 should appear as source (person 2 excluded by session_cm_id filter)
        sources = {f.source for f in result.session_flow}
        assert sources == {"Session 1"}

        flow_map = {(f.source, f.target): f.value for f in result.session_flow}
        assert flow_map.get(("Session 1", "Session 1")) == 1
