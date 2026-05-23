"""Tests for RetentionService - written first (TDD).

These tests define the expected behavior for the retention service that
moves business logic out of the endpoint and into a testable service.
"""

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock

import pytest


@dataclass
class MockPerson:
    """Mock person object for testing."""

    cm_id: int
    gender: str | None = None
    grade: int | None = None
    years_at_camp: int | None = None
    normalized_school: str | None = None
    school: str | None = None
    normalized_city: str | None = None
    address_city: str | None = None
    normalized_congregation: str | None = None


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


@dataclass
class MockBunk:
    """Mock bunk object for testing."""

    name: str
    gender: str | None = None


@dataclass
class MockBunkAssignment:
    """Mock bunk_assignment record with expand pattern."""

    person_id: int
    year: int
    expand: dict[str, Any] | None = None


def _make_bunk_assignment(
    person_id: int,
    year: int,
    session: MockSession,
    bunk: MockBunk,
    person_cm_id: int | None = None,
) -> MockBunkAssignment:
    """Helper to create a bunk assignment with proper expand structure."""
    person = MockPerson(cm_id=person_cm_id if person_cm_id is not None else person_id)
    return MockBunkAssignment(
        person_id=person_id,
        year=year,
        expand={"person": person, "session": session, "bunk": bunk},
    )


def _setup_mock_repo_no_camper_history(mock_repo: AsyncMock) -> None:
    """Configure mock repo without camper_history (common setup after migration)."""
    mock_repo.fetch_bunk_assignments.return_value = []
    mock_repo.fetch_summer_enrollment_history.return_value = []


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
                MockAttendee(
                    person_id=4,
                    year=2026,
                    expand={"session": MockSession(cm_id=1001, name="Session 2", session_type="main")},
                ),
                MockAttendee(
                    person_id=6,
                    year=2026,
                    expand={"session": MockSession(cm_id=1001, name="Session 2", session_type="main")},
                ),  # New camper
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

        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

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
                MockAttendee(
                    person_id=1, year=2026, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                ),
                MockAttendee(
                    person_id=3, year=2026, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                ),
                MockAttendee(
                    person_id=4, year=2026, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                ),
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
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

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
            # Person 1 returns in a 2026 main session (CampMinder mints new cm_ids per year)
            2000: MockSession(cm_id=2000, name="Session 1", session_type="main"),
        }
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

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
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

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
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

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
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

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
    async def test_session_cm_id_resolves_alias_across_years(self) -> None:
        """When session_cm_id only exists in compare year, resolve alias to find base year equivalent.

        Scenario: User picks "Taste of Camp 2" (cm_id=2000) from the 2026 dropdown.
        2025 has "Session 2b" (cm_id=1001) which is aliased to "Taste of Camp 2".
        The service should find the base year equivalent and include those campers.
        """
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # Base year: person 1 in Session 2b (cm_id=1001), person 2 in Session 2 (cm_id=1000)
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1001, name="Session 2b", session_type="embedded")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="Session 2", session_type="main")},
                ),
            ],
            # Compare year: person 1 returned to Taste of Camp 2 (cm_id=2000)
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Taste of Camp 2", session_type="embedded")},
                ),
                MockAttendee(
                    person_id=3,
                    year=2026,
                    expand={"session": MockSession(cm_id=1000, name="Session 2", session_type="main")},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
        }

        # Sessions for each year (fetch_sessions called multiple times)
        mock_repo.fetch_sessions.side_effect = [
            # base year sessions (unfiltered)
            {
                1000: MockSession(cm_id=1000, name="Session 2", session_type="main"),
                1001: MockSession(cm_id=1001, name="Session 2b", session_type="embedded"),
            },
            # compare year sessions (filtered by type)
            {
                1000: MockSession(cm_id=1000, name="Session 2", session_type="main"),
                2000: MockSession(cm_id=2000, name="Taste of Camp 2", session_type="embedded"),
            },
            # compare year sessions (unfiltered)
            {
                1000: MockSession(cm_id=1000, name="Session 2", session_type="main"),
                2000: MockSession(cm_id=2000, name="Taste of Camp 2", session_type="embedded"),
            },
        ]
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_cm_id=2000,  # "Taste of Camp 2" - only exists in 2026
        )

        # Base year: person 1 should be included (Session 2b aliases to Taste of Camp 2)
        # Person 2 should NOT be included (Session 2 is a different session)
        assert result.base_year_total == 1
        # Compare year: person 1 in Taste of Camp 2 (cm_id=2000)
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
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

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
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

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
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

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
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

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
    async def test_by_prior_session_filtered_by_session_types(self) -> None:
        """by_prior_session only includes base year sessions matching the dropdown filter.

        With "At Camp" filter (main/embedded/ag), Quest sessions from the prior
        year should be excluded from by_prior_session.
        """
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
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_types=["main", "embedded", "ag"],  # "at camp" filter
        )

        # by_prior_session should only include main from 2025 (Quest excluded)
        session_names = {s.prior_session for s in result.by_prior_session}
        assert "Quest" not in session_names
        assert "Session 1" in session_names

    @pytest.mark.asyncio
    async def test_by_prior_session_returned_is_unfiltered(self) -> None:
        """by_prior_session returned count is unfiltered — any return to compare year counts.

        2025 Session 1 has 2 kids. Kid 1 returns to main in 2026, kid 2 returns to
        quest in 2026. With "at camp" dropdown: Session 1 is shown (it's main).
        returned_count == 2 because BOTH kids came back to some 2026 session,
        regardless of session type filter.
        """
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025 Session 1 (main): person 1 + person 2
        # 2026: person 1 → main Session 1, person 2 → quest
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
                MockAttendee(
                    person_id=2,
                    year=2026,
                    expand={"session": MockSession(cm_id=2100, name="Quest", session_type="quest")},
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
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        # "At camp" filter: only main/embedded/ag
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_types=["main", "embedded", "ag"],
        )

        # by_prior_session should show Session 1 from 2025 with base=2
        s1 = next((s for s in result.by_prior_session if s.prior_session == "Session 1"), None)
        assert s1 is not None
        assert s1.base_count == 2
        # Returned is UNFILTERED: both kids came back to some 2026 session
        # (kid 1 → main, kid 2 → quest — both count as returned)
        assert s1.returned_count == 2

    @pytest.mark.asyncio
    async def test_by_prior_session_shows_all_with_all_types(self) -> None:
        """by_prior_session includes all session types when all types are in the filter.

        With "All Summer" dropdown (all session types), both Quest and main
        from the prior year should appear.
        """
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025: person 1 in quest, person 2 in main Session 1
        # 2026: both return
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
                2025: {
                    1000: MockSession(cm_id=1000, name="Quest", session_type="quest"),
                    1001: MockSession(cm_id=1001, name="Session 1", session_type="main"),
                },
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
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        # "All Summer" filter: all session types
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_types=["main", "embedded", "ag", "quest"],
        )

        # by_prior_session should include BOTH quest and main from 2025
        session_names = {s.prior_session for s in result.by_prior_session}
        assert "Quest" in session_names
        assert "Session 1" in session_names

    @pytest.mark.asyncio
    async def test_by_prior_session_specific_session_cm_id(self) -> None:
        """by_prior_session shows only the specific session when session_cm_id is set.

        When the dropdown selects a specific session (e.g. Session 1 with cm_id=1001),
        only the 2025 session with that cm_id should appear in by_prior_session.
        Other 2025 sessions are excluded.
        """
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025: person 1 in Session 1 (cm_id=1001), person 2 in Session 2 (cm_id=1002)
        # 2026: both return to Session 1
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1001, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={"session": MockSession(cm_id=1002, name="Session 2", session_type="main")},
                ),
            ],
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2001, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2026,
                    expand={"session": MockSession(cm_id=2001, name="Session 1", session_type="main")},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
        }

        async def mock_fetch_sessions(year: int, session_types: list[str] | None = None) -> dict[int, MockSession]:
            all_sessions: dict[int, dict[int, MockSession]] = {
                2025: {
                    1001: MockSession(cm_id=1001, name="Session 1", session_type="main"),
                    1002: MockSession(cm_id=1002, name="Session 2", session_type="main"),
                },
                2026: {
                    2001: MockSession(cm_id=2001, name="Session 1", session_type="main"),
                },
            }
            sessions = all_sessions.get(year, {})
            if session_types:
                return {k: v for k, v in sessions.items() if v.session_type in session_types}
            return sessions

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        # Specific session dropdown: Session 1 (cm_id=1001 in 2025)
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_cm_id=1001,
        )

        # by_prior_session should only show Session 1 from 2025
        assert len(result.by_prior_session) == 1
        assert result.by_prior_session[0].prior_session == "Session 1"
        assert result.by_prior_session[0].base_count == 1
        assert result.by_prior_session[0].returned_count == 1

    @pytest.mark.asyncio
    async def test_by_prior_session_includes_start_date(self) -> None:
        """by_prior_session includes start_date from the session for frontend sorting."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={
                        "session": MockSession(
                            cm_id=1001,
                            name="Session 1",
                            session_type="main",
                            start_date="2025-06-15",
                        )
                    },
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={
                        "session": MockSession(
                            cm_id=1002,
                            name="Session 2",
                            session_type="main",
                            start_date="2025-07-10",
                        )
                    },
                ),
            ],
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2001, name="Session 1", session_type="main")},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
        }

        async def mock_fetch_sessions(year: int, session_types: list[str] | None = None) -> dict[int, MockSession]:
            all_sessions: dict[int, dict[int, MockSession]] = {
                2025: {
                    1001: MockSession(cm_id=1001, name="Session 1", session_type="main", start_date="2025-06-15"),
                    1002: MockSession(cm_id=1002, name="Session 2", session_type="main", start_date="2025-07-10"),
                },
                2026: {2001: MockSession(cm_id=2001, name="Session 1", session_type="main")},
            }
            sessions = all_sessions.get(year, {})
            if session_types:
                return {k: v for k, v in sessions.items() if v.session_type in session_types}
            return sessions

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        # Both prior sessions should have start_date populated
        by_name = {s.prior_session: s for s in result.by_prior_session}
        assert by_name["Session 1"].start_date == "2025-06-15"
        assert by_name["Session 2"].start_date == "2025-07-10"


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
        mock_repo.fetch_bunk_assignments.return_value = []

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
        """Basic flow: 3 campers across 2 sessions produce correct flow items.

        CampMinder reuses session cm_ids across years, so Session 1 has cm_id=1000
        in both 2025 and 2026.
        """
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025: person 1+2 in Session 1 (cm_id=1000), person 3 in Session 2 (cm_id=1001)
        # 2026: person 1 in Session 1 (cm_id=1000), person 2 in Session 2 (cm_id=1001),
        #        person 3 in Session 1 (cm_id=1000)
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
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2026,
                    expand={"session": MockSession(cm_id=1001, name="Session 2", session_type="main")},
                ),
                MockAttendee(
                    person_id=3,
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

        async def mock_fetch_sessions(year: int, session_types: list[str] | None = None) -> dict[int, MockSession]:
            if year == 2025:
                return {
                    1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
                    1001: MockSession(cm_id=1001, name="Session 2", session_type="main"),
                }
            return {
                1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
                1001: MockSession(cm_id=1001, name="Session 2", session_type="main"),
            }

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        assert len(result.session_flow) > 0

        # Build lookup: (source, target) -> flow item
        flow_map = {(f.source, f.target): f for f in result.session_flow}

        # Session 1 -> Session 1: person 1
        s1_to_s1 = flow_map.get(("Session 1", "Session 1"))
        assert s1_to_s1 is not None
        assert s1_to_s1.value == 1
        assert s1_to_s1.source_cm_id == 1000
        assert s1_to_s1.target_cm_id == 1000

        # Session 1 -> Session 2: person 2
        s1_to_s2 = flow_map.get(("Session 1", "Session 2"))
        assert s1_to_s2 is not None
        assert s1_to_s2.value == 1
        assert s1_to_s2.source_cm_id == 1000
        assert s1_to_s2.target_cm_id == 1001

        # Session 2 -> Session 1: person 3
        s2_to_s1 = flow_map.get(("Session 2", "Session 1"))
        assert s2_to_s1 is not None
        assert s2_to_s1.value == 1
        assert s2_to_s1.source_cm_id == 1001
        assert s2_to_s1.target_cm_id == 1000

    @pytest.mark.asyncio
    async def test_session_flow_did_not_return(self) -> None:
        """Non-returned campers generate 'Did Not Return' flow entries with target_cm_id=None."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025: person 1+2 in Session 1 (cm_id=1000)
        # 2026: only person 1 returns to Session 1 (cm_id=1000)
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
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
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
            return {1000: MockSession(cm_id=1000, name="Session 1", session_type="main")}

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        flow_map = {(f.source, f.target): f for f in result.session_flow}

        # Person 1: Session 1 -> Session 1
        s1_to_s1 = flow_map.get(("Session 1", "Session 1"))
        assert s1_to_s1 is not None
        assert s1_to_s1.value == 1
        assert s1_to_s1.source_cm_id == 1000
        assert s1_to_s1.target_cm_id == 1000

        # Person 2: Session 1 -> Did Not Return
        s1_to_dnr = flow_map.get(("Session 1", "Did Not Return"))
        assert s1_to_dnr is not None
        assert s1_to_dnr.value == 1
        assert s1_to_dnr.source_cm_id == 1000
        assert s1_to_dnr.target_cm_id is None

    @pytest.mark.asyncio
    async def test_session_flow_ag_merged(self) -> None:
        """AG sessions collapse into parent session on both source and target sides.

        AG merges into parent, so source_cm_id/target_cm_id reflect the parent's cm_id.
        """
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025: person 1 in AG (parent=Session 1, cm_id=1000), person 2 in Session 1
        # 2026: person 1 in Session 2 (cm_id=1001), person 2 in AG (parent=Session 1, cm_id=1000)
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1002, name="AG Session", session_type="ag", parent_id=1000)},
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
                    expand={"session": MockSession(cm_id=1001, name="Session 2", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2026,
                    expand={"session": MockSession(cm_id=1003, name="AG Session", session_type="ag", parent_id=1000)},
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
                    1002: MockSession(cm_id=1002, name="AG Session", session_type="ag", parent_id=1000),
                }
            return {
                1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
                1001: MockSession(cm_id=1001, name="Session 2", session_type="main"),
                1003: MockSession(cm_id=1003, name="AG Session", session_type="ag", parent_id=1000),
            }

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        flow_map = {(f.source, f.target): f for f in result.session_flow}

        # Both persons should show as "Session 1" source (AG merged)
        # Person 1: Session 1 -> Session 2
        s1_to_s2 = flow_map.get(("Session 1", "Session 2"))
        assert s1_to_s2 is not None
        assert s1_to_s2.value == 1
        assert s1_to_s2.source_cm_id == 1000  # AG parent cm_id
        assert s1_to_s2.target_cm_id == 1001

        # Person 2: Session 1 -> Session 1 (AG target merged to parent)
        s1_to_s1 = flow_map.get(("Session 1", "Session 1"))
        assert s1_to_s1 is not None
        assert s1_to_s1.value == 1
        assert s1_to_s1.source_cm_id == 1000
        assert s1_to_s1.target_cm_id == 1000  # AG target merged to parent cm_id

        # No AG entries should appear
        ag_entries = [f for f in result.session_flow if "AG" in f.source or "AG" in f.target]
        assert len(ag_entries) == 0

    @pytest.mark.asyncio
    async def test_session_flow_multi_session_camper(self) -> None:
        """Camper in multiple compare-year sessions produces multiple flow links.

        CampMinder reuses cm_ids across years.
        """
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025: person 1 in Session 1 (cm_id=1000)
        # 2026: person 1 in Session 1 (cm_id=1000) AND Session 2 (cm_id=1001)
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
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=1001, name="Session 2", session_type="main")},
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
                1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
                1001: MockSession(cm_id=1001, name="Session 2", session_type="main"),
            }

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        flow_map = {(f.source, f.target): f for f in result.session_flow}

        # Person 1 goes from Session 1 to both Session 1 and Session 2
        s1_to_s1 = flow_map.get(("Session 1", "Session 1"))
        assert s1_to_s1 is not None
        assert s1_to_s1.value == 1
        assert s1_to_s1.source_cm_id == 1000
        assert s1_to_s1.target_cm_id == 1000  # Same cm_id across years

        s1_to_s2 = flow_map.get(("Session 1", "Session 2"))
        assert s1_to_s2 is not None
        assert s1_to_s2.value == 1
        assert s1_to_s2.source_cm_id == 1000
        assert s1_to_s2.target_cm_id == 1001

    @pytest.mark.asyncio
    async def test_session_flow_unfiltered_destinations(self) -> None:
        """Even when session_types filter is set, destinations show ALL session types.

        CampMinder reuses cm_ids across years. Quest has its own cm_id (2100).
        """
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025: person 1+2 in Session 1 (cm_id=1000, main)
        # 2026: person 1 -> Quest (cm_id=2100), person 2 -> Session 1 (cm_id=1000, main)
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
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
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
                    1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
                    2100: MockSession(cm_id=2100, name="Quest", session_type="quest"),
                },
            }
            sessions = all_sessions.get(year, {})
            if session_types:
                return {k: v for k, v in sessions.items() if v.session_type in session_types}
            return sessions

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        # Filter to "at camp" (main only) — but destinations should show all
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_types=["main", "embedded", "ag"],
        )

        flow_map = {(f.source, f.target): f for f in result.session_flow}

        # Person 1 went to Quest — should still appear in flow
        s1_to_quest = flow_map.get(("Session 1", "Quest"))
        assert s1_to_quest is not None
        assert s1_to_quest.value == 1
        assert s1_to_quest.source_cm_id == 1000
        assert s1_to_quest.target_cm_id == 2100

        # Person 2 went to main Session 1
        s1_to_s1 = flow_map.get(("Session 1", "Session 1"))
        assert s1_to_s1 is not None
        assert s1_to_s1.value == 1
        assert s1_to_s1.source_cm_id == 1000
        assert s1_to_s1.target_cm_id == 1000

    @pytest.mark.asyncio
    async def test_session_flow_empty(self) -> None:
        """No attendees produces empty session_flow list."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.side_effect = [[], []]
        mock_repo.fetch_persons.return_value = {}
        mock_repo.fetch_sessions.return_value = {}
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        assert result.session_flow == []

    @pytest.mark.asyncio
    async def test_session_flow_filtered_by_session_cm_id(self) -> None:
        """Only the filtered base-year session appears as a source.

        CampMinder reuses cm_ids across years.
        """
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2025: person 1 in Session 1 (cm_id=1000), person 2 in Session 2 (cm_id=1001)
        # 2026: both return to Session 1 (cm_id=1000)
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
                    expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
                ),
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
        }

        async def mock_fetch_sessions(year: int, session_types: list[str] | None = None) -> dict[int, MockSession]:
            if year == 2025:
                return {
                    1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
                    1001: MockSession(cm_id=1001, name="Session 2", session_type="main"),
                }
            return {1000: MockSession(cm_id=1000, name="Session 1", session_type="main")}

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

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

        flow_map = {(f.source, f.target): f for f in result.session_flow}
        s1_to_s1 = flow_map.get(("Session 1", "Session 1"))
        assert s1_to_s1 is not None
        assert s1_to_s1.value == 1
        assert s1_to_s1.source_cm_id == 1000
        assert s1_to_s1.target_cm_id == 1000


class TestSessionBunkBreakdownFromBunkAssignments:
    """Tests for _build_session_bunk_breakdown using bunk_assignments data.

    After migration, session-bunk breakdown comes from bunk_assignments
    (with expand: person, session, bunk) instead of camper_history.
    AG sessions should merge into their parent session.
    """

    @pytest.mark.asyncio
    async def test_basic_session_bunk_breakdown(self) -> None:
        """Session-bunk breakdown counts persons from bunk_assignments."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        session1 = MockSession(cm_id=1000, name="Session 1", session_type="main")
        bunk_b1 = MockBunk(name="B-1")
        bunk_g1 = MockBunk(name="G-1")

        # 3 campers in base year, 2 returned
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(person_id=1, year=2025, expand={"session": session1}),
                MockAttendee(person_id=2, year=2025, expand={"session": session1}),
                MockAttendee(person_id=3, year=2025, expand={"session": session1}),
            ],
            [
                MockAttendee(person_id=1, year=2026, expand={"session": session1}),
                MockAttendee(person_id=2, year=2026, expand={"session": session1}),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
            3: MockPerson(cm_id=3, gender="M"),
        }

        mock_repo.fetch_sessions.return_value = {
            1000: session1,
        }

        # Bunk assignments: person 1+2 in B-1, person 3 in G-1
        mock_repo.fetch_bunk_assignments.return_value = [
            _make_bunk_assignment(1, 2025, session1, bunk_b1),
            _make_bunk_assignment(2, 2025, session1, bunk_b1),
            _make_bunk_assignment(3, 2025, session1, bunk_g1),
        ]
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        # B-1: 2 base, 2 returned (persons 1+2)
        b1 = next((x for x in result.by_session_bunk if x.bunk == "B-1"), None)
        assert b1 is not None
        assert b1.session == "Session 1"
        assert b1.base_count == 2
        assert b1.returned_count == 2
        assert b1.retention_rate == 1.0

        # G-1: 1 base, 0 returned (person 3 didn't return)
        g1 = next((x for x in result.by_session_bunk if x.bunk == "G-1"), None)
        assert g1 is not None
        assert g1.base_count == 1
        assert g1.returned_count == 0
        assert g1.retention_rate == 0.0

    @pytest.mark.asyncio
    async def test_ag_bunks_merge_into_parent_session(self) -> None:
        """AG session bunk assignments merge into parent session name."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        session_main = MockSession(cm_id=1000, name="Session 1", session_type="main")
        session_ag = MockSession(cm_id=1001, name="AG Session", session_type="ag", parent_id=1000)
        bunk_b1 = MockBunk(name="B-1")
        bunk_ag8 = MockBunk(name="AG-8")

        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(person_id=1, year=2025, expand={"session": session_main}),
                MockAttendee(person_id=2, year=2025, expand={"session": session_ag}),
            ],
            [
                MockAttendee(person_id=1, year=2026, expand={}),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
        }

        mock_repo.fetch_sessions.return_value = {
            1000: session_main,
            1001: session_ag,
        }

        mock_repo.fetch_bunk_assignments.return_value = [
            _make_bunk_assignment(1, 2025, session_main, bunk_b1),
            _make_bunk_assignment(2, 2025, session_ag, bunk_ag8),
        ]
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        # AG-8 should appear under "Session 1" (parent), not "AG Session"
        ag8 = next((x for x in result.by_session_bunk if x.bunk == "AG-8"), None)
        assert ag8 is not None
        assert ag8.session == "Session 1"  # Merged into parent

        # No entries should have "AG Session" as session name
        ag_sessions = [x for x in result.by_session_bunk if x.session == "AG Session"]
        assert len(ag_sessions) == 0

    @pytest.mark.asyncio
    async def test_empty_bunk_assignments(self) -> None:
        """No bunk assignments produces empty by_session_bunk list."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        mock_repo.fetch_attendees.side_effect = [
            [MockAttendee(person_id=1, year=2025, expand={})],
            [MockAttendee(person_id=1, year=2026, expand={})],
        ]
        mock_repo.fetch_persons.return_value = {1: MockPerson(cm_id=1)}
        mock_repo.fetch_sessions.return_value = {}
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        assert result.by_session_bunk == []


class TestDemographicBreakdownsFromPersons:
    """Tests for demographic breakdowns (school, city, synagogue) using persons data.

    After migration, these come from persons' normalized fields instead of
    camper_history. The extractors should use normalized_school, normalized_city,
    normalized_congregation from persons.
    """

    @pytest.mark.asyncio
    async def test_school_breakdown_uses_normalized_school(self) -> None:
        """School breakdown reads normalized_school from persons."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
                ),
            ],
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
                )
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M", normalized_school="Riverside Elementary", school="riverside elem"),
            2: MockPerson(cm_id=2, gender="F", normalized_school="Riverside Elementary", school="riverside elem"),
        }

        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
        }
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        assert len(result.by_school) == 1
        assert result.by_school[0].school == "Riverside Elementary"
        assert result.by_school[0].base_count == 2
        assert result.by_school[0].returned_count == 1

    @pytest.mark.asyncio
    async def test_school_falls_back_to_raw_school(self) -> None:
        """When normalized_school is None, falls back to raw school field."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
                ),
            ],
            [],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M", normalized_school=None, school="Oak Valley Middle"),
        }

        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
        }
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        assert len(result.by_school) == 1
        assert result.by_school[0].school == "Oak Valley Middle"

    @pytest.mark.asyncio
    async def test_city_breakdown_uses_normalized_city(self) -> None:
        """City breakdown reads normalized_city from persons, falls back to address_city."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
                ),
            ],
            [MockAttendee(person_id=1, year=2026, expand={})],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M", normalized_city="San Francisco", address_city="SF"),
            2: MockPerson(cm_id=2, gender="F", normalized_city=None, address_city="Oakland"),
        }

        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
        }
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        cities = {c.city for c in result.by_city}
        assert "San Francisco" in cities
        assert "Oakland" in cities

    @pytest.mark.asyncio
    async def test_synagogue_breakdown_uses_normalized_congregation(self) -> None:
        """Synagogue breakdown reads normalized_congregation from persons."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(
                    person_id=1,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2025,
                    expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
                ),
            ],
            [MockAttendee(person_id=1, year=2026, expand={})],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M", normalized_congregation="Temple Beth El"),
            2: MockPerson(cm_id=2, gender="F", normalized_congregation="Congregation Emanu-El"),
        }

        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
        }
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        synagogues = {s.synagogue for s in result.by_synagogue}
        assert "Temple Beth El" in synagogues
        assert "Congregation Emanu-El" in synagogues

    @pytest.mark.asyncio
    async def test_response_has_no_by_first_year(self) -> None:
        """RetentionMetricsResponse should not have by_first_year field."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.side_effect = [[], []]
        mock_repo.fetch_persons.return_value = {}
        mock_repo.fetch_sessions.return_value = {}
        mock_repo.fetch_bunk_assignments.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        assert not hasattr(result, "by_first_year")


class TestSessionBunkUsesUnfilteredPools:
    """Tests that by_session_bunk always uses unfiltered person pools.

    The heatmap should show the true picture: "of campers in last year's
    B-8, how many came back to camp at all?" — not just "how many came
    back to this specific session." This prevents unfairly penalizing
    bunk counselor performance when a session filter is active.
    """

    @pytest.mark.asyncio
    async def test_by_session_bunk_unfiltered_when_session_cm_id_filter_active(self) -> None:
        """by_session_bunk counts campers as returned even if they went to a different session.

        Scenario: Session 1 B-1 had persons 1 and 2.
        Person 1 returns to Session 1 (matches filter).
        Person 2 returns to Session 3 (doesn't match filter).
        With session_cm_id filter on Session 1, the heatmap should still
        show B-1 as 2/2 returned (100%), not 1/2 (50%).
        """
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        session1 = MockSession(cm_id=1000, name="Session 1", session_type="main")
        bunk_b1 = MockBunk(name="B-1")

        # Base year: persons 1 and 2 both in Session 1
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(person_id=1, year=2025, expand={"session": session1}),
                MockAttendee(person_id=2, year=2025, expand={"session": session1}),
            ],
            # Compare year: person 1 in Session 1, person 2 in Session 3
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2000, name="Session 1", session_type="main")},
                ),
                MockAttendee(
                    person_id=2,
                    year=2026,
                    expand={"session": MockSession(cm_id=2002, name="Session 3", session_type="main")},
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
                    1002: MockSession(cm_id=1002, name="Session 3", session_type="main"),
                }
            return {
                2000: MockSession(cm_id=2000, name="Session 1", session_type="main"),
                2002: MockSession(cm_id=2002, name="Session 3", session_type="main"),
            }

        mock_repo.fetch_sessions.side_effect = mock_fetch_sessions

        # Both persons assigned to B-1 in Session 1 during base year
        mock_repo.fetch_bunk_assignments.return_value = [
            _make_bunk_assignment(1, 2025, session1, bunk_b1),
            _make_bunk_assignment(2, 2025, session1, bunk_b1),
        ]
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        # Filter to Session 1 only — but heatmap should use unfiltered pools
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_cm_id=1000,
        )

        b1 = next((x for x in result.by_session_bunk if x.bunk == "B-1"), None)
        assert b1 is not None
        assert b1.base_count == 2
        # Both returned to camp (person 2 to Session 3) — should be 2, not 1
        assert b1.returned_count == 2
        assert b1.retention_rate == 1.0

    @pytest.mark.asyncio
    async def test_by_session_bunk_unfiltered_when_session_types_filter_active(self) -> None:
        """by_session_bunk counts returns from any session type, not just filtered ones.

        Scenario: Session 1 B-1 had person 1 (main session).
        Person 1 returns to Quest only (not main) in compare year.
        With session_types=["main"] filter, heatmap should still show
        B-1 as 1/1 returned because person came back to camp.
        """
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        session1 = MockSession(cm_id=1000, name="Session 1", session_type="main")
        bunk_b1 = MockBunk(name="B-1")

        mock_repo.fetch_attendees.side_effect = [
            [MockAttendee(person_id=1, year=2025, expand={"session": session1})],
            # Person returns to Quest only
            [
                MockAttendee(
                    person_id=1,
                    year=2026,
                    expand={"session": MockSession(cm_id=2100, name="Quest", session_type="quest")},
                ),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
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

        mock_repo.fetch_bunk_assignments.return_value = [
            _make_bunk_assignment(1, 2025, session1, bunk_b1),
        ]
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_types=["main", "embedded", "ag"],
        )

        b1 = next((x for x in result.by_session_bunk if x.bunk == "B-1"), None)
        assert b1 is not None
        assert b1.base_count == 1
        # Person returned to Quest — still counts as returned for heatmap
        assert b1.returned_count == 1
        assert b1.retention_rate == 1.0
