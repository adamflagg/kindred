"""Tests for RegistrationService - written first (TDD).

These tests define the expected behavior for the registration metrics
service layer that will replace the monolithic endpoint code.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest


@dataclass
class MockPerson:
    """Mock person object for testing."""

    person_id: int
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
    expand: dict[str, Any] | None = None


@dataclass
class MockCamperHistory:
    """Mock camper history record for testing."""

    person_id: int
    school: str | None = None
    city: str | None = None
    synagogue: str | None = None
    first_year_attended: int | None = None
    sessions: str | None = None  # Comma-separated
    bunks: str | None = None  # Comma-separated


class TestRegistrationServiceCalculate:
    """Tests for calculate_registration method."""

    @pytest.mark.asyncio
    async def test_returns_correct_response_shape(self) -> None:
        """calculate_registration returns a response with required fields."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        # Setup minimal mock data
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(
                person_id=1, expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")}
            ),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(person_id=1, gender="M", grade=5, years_at_camp=1),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        # Verify response shape
        assert result.year == 2025
        assert hasattr(result, "total_enrolled")
        assert hasattr(result, "total_waitlisted")
        assert hasattr(result, "total_cancelled")
        assert hasattr(result, "by_gender")
        assert hasattr(result, "by_grade")
        assert hasattr(result, "by_session")
        assert hasattr(result, "new_vs_returning")

    @pytest.mark.asyncio
    async def test_gender_breakdown_counts_correctly(self) -> None:
        """Gender breakdown shows correct counts and percentages."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(person_id=1, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=2, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=3, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(person_id=1, gender="M"),
            2: MockPerson(person_id=2, gender="M"),
            3: MockPerson(person_id=3, gender="F"),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        gender_dict = {g.gender: g for g in result.by_gender}
        assert gender_dict["M"].count == 2
        assert gender_dict["F"].count == 1
        assert gender_dict["M"].percentage == pytest.approx(2 / 3 * 100)
        assert gender_dict["F"].percentage == pytest.approx(1 / 3 * 100)

    @pytest.mark.asyncio
    async def test_grade_breakdown_handles_none(self) -> None:
        """Grade breakdown handles null grades correctly."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(person_id=1, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=2, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(person_id=1, grade=5),
            2: MockPerson(person_id=2, grade=None),  # Null grade
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        grade_dict = {g.grade: g for g in result.by_grade}
        assert 5 in grade_dict
        assert None in grade_dict
        assert grade_dict[5].count == 1
        assert grade_dict[None].count == 1

    @pytest.mark.asyncio
    async def test_session_filtering_by_type(self) -> None:
        """Filtering by session type only includes matching sessions."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        # Return attendees from both main and embedded sessions
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(person_id=1, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=2, expand={"session": MockSession(cm_id=2000, name="S2", session_type="embedded")}),
            MockAttendee(
                person_id=3, expand={"session": MockSession(cm_id=3000, name="Family", session_type="family")}
            ),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(person_id=1, gender="M"),
            2: MockPerson(person_id=2, gender="M"),
            3: MockPerson(person_id=3, gender="F"),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
            2000: MockSession(cm_id=2000, name="S2", session_type="embedded"),
            3000: MockSession(cm_id=3000, name="Family", session_type="family"),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RegistrationService(mock_repo)
        # Filter to only main sessions
        result = await service.calculate_registration(2025, session_types=["main"])

        assert result.total_enrolled == 1  # Only person 1 in main session

    @pytest.mark.asyncio
    async def test_session_filtering_by_cm_id(self) -> None:
        """Filtering by session_cm_id only includes that session."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(person_id=1, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=2, expand={"session": MockSession(cm_id=2000, name="S2", session_type="main")}),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(person_id=1, gender="M"),
            2: MockPerson(person_id=2, gender="F"),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
            2000: MockSession(cm_id=2000, name="S2", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025, session_cm_id=1000)

        assert result.total_enrolled == 1

    @pytest.mark.asyncio
    async def test_ag_sessions_included_with_parent(self) -> None:
        """AG sessions are included when their parent session is selected."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(person_id=1, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(
                person_id=2,
                expand={"session": MockSession(cm_id=1001, name="AG-S1", session_type="ag", parent_id=1000)},
            ),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(person_id=1, gender="M"),
            2: MockPerson(person_id=2, gender="F"),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
            1001: MockSession(cm_id=1001, name="AG-S1", session_type="ag", parent_id=1000),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RegistrationService(mock_repo)
        # Filter to session 1000 - should also include AG session 1001
        result = await service.calculate_registration(2025, session_cm_id=1000)

        assert result.total_enrolled == 2  # Both main and AG attendees

    @pytest.mark.asyncio
    async def test_new_vs_returning_breakdown(self) -> None:
        """New vs returning counts campers correctly."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(person_id=1, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=2, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=3, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(person_id=1, years_at_camp=1),  # New
            2: MockPerson(person_id=2, years_at_camp=3),  # Returning
            3: MockPerson(person_id=3, years_at_camp=2),  # Returning
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        assert result.new_vs_returning.new_count == 1
        assert result.new_vs_returning.returning_count == 2
        assert result.new_vs_returning.new_percentage == pytest.approx(1 / 3 * 100)
        assert result.new_vs_returning.returning_percentage == pytest.approx(2 / 3 * 100)

    @pytest.mark.asyncio
    async def test_session_breakdown_merges_ag(self) -> None:
        """Session breakdown merges AG counts into parent session."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(person_id=1, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=2, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(
                person_id=3,
                expand={"session": MockSession(cm_id=1001, name="AG-S1", session_type="ag", parent_id=1000)},
            ),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(person_id=1),
            2: MockPerson(person_id=2),
            3: MockPerson(person_id=3),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
            1001: MockSession(cm_id=1001, name="AG-S1", session_type="ag", parent_id=1000),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        # AG should be merged into parent, so only S1 appears with count=3
        session_dict = {s.session_cm_id: s for s in result.by_session}
        assert 1000 in session_dict
        assert session_dict[1000].count == 3  # 2 from main + 1 from AG
        # AG session should NOT appear separately
        assert 1001 not in session_dict

    @pytest.mark.asyncio
    async def test_deduplicates_persons_across_sessions(self) -> None:
        """Same person in multiple sessions is only counted once in totals."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        # Same person_id=1 in two sessions
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(person_id=1, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=1, expand={"session": MockSession(cm_id=2000, name="S2", session_type="main")}),
            MockAttendee(person_id=2, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(person_id=1, gender="M"),
            2: MockPerson(person_id=2, gender="F"),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
            2000: MockSession(cm_id=2000, name="S2", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        # Total enrolled should be 2 unique persons, not 3 attendee records
        assert result.total_enrolled == 2


class TestRegistrationServiceStatusCategories:
    """Tests for status filtering (enrolled, waitlisted, cancelled)."""

    @pytest.mark.asyncio
    async def test_returns_separate_totals_by_status(self) -> None:
        """Separate totals for enrolled, waitlisted, cancelled."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()

        # Simulate fetch_attendees being called with different status filters
        async def mock_fetch_attendees(year: int, status_filter: str | list[str] | None = None) -> list[Any]:
            if status_filter == ["enrolled"] or status_filter == "enrolled" or status_filter is None:
                return [
                    MockAttendee(
                        person_id=1, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                    ),
                    MockAttendee(
                        person_id=2, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                    ),
                ]
            elif status_filter == "waitlisted":
                return [
                    MockAttendee(
                        person_id=3, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                    ),
                ]
            elif status_filter == "cancelled":
                return [
                    MockAttendee(
                        person_id=4, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                    ),
                    MockAttendee(
                        person_id=5, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                    ),
                    MockAttendee(
                        person_id=6, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}
                    ),
                ]
            return []

        mock_repo.fetch_attendees.side_effect = mock_fetch_attendees
        mock_repo.fetch_persons.return_value = {i: MockPerson(person_id=i, gender="M") for i in range(1, 7)}
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        assert result.total_enrolled == 2
        assert result.total_waitlisted == 1
        assert result.total_cancelled == 3


class TestRegistrationServiceDemographics:
    """Tests for demographic breakdowns from camper_history."""

    @pytest.mark.asyncio
    async def test_school_breakdown_top_20(self) -> None:
        """School breakdown returns top 20 by count."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(person_id=1, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(person_id=1),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }
        # Create 25 schools, each appearing different number of times
        history = []
        for i in range(25):
            for j in range(25 - i):  # School 0 appears 25 times, School 24 appears 1 time
                history.append(MockCamperHistory(person_id=1, school=f"School {i}"))
        mock_repo.fetch_camper_history.return_value = history
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        # Should only have 20 schools
        assert len(result.by_school) == 20
        # First school should be School 0 (most common)
        assert result.by_school[0].school == "School 0"

    @pytest.mark.asyncio
    async def test_city_breakdown_excludes_empty(self) -> None:
        """City breakdown excludes empty/null cities."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(person_id=1, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(person_id=1),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = [
            MockCamperHistory(person_id=1, city="Oakland"),
            MockCamperHistory(person_id=2, city=""),
            MockCamperHistory(person_id=3, city=None),
            MockCamperHistory(person_id=4, city="Berkeley"),
        ]
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        city_names = [c.city for c in result.by_city]
        assert "Oakland" in city_names
        assert "Berkeley" in city_names
        assert "" not in city_names

    @pytest.mark.asyncio
    async def test_synagogue_breakdown(self) -> None:
        """Synagogue breakdown works correctly."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(person_id=1, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(person_id=1),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = [
            MockCamperHistory(person_id=1, synagogue="Temple Beth Sholom"),
            MockCamperHistory(person_id=2, synagogue="Temple Beth Sholom"),
            MockCamperHistory(person_id=3, synagogue="Congregation Shalom"),
        ]
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        synagogue_dict = {s.synagogue: s for s in result.by_synagogue}
        assert synagogue_dict["Temple Beth Sholom"].count == 2
        assert synagogue_dict["Congregation Shalom"].count == 1


class TestRegistrationServiceSummerMetrics:
    """Tests for summer enrollment history metrics."""

    @pytest.mark.asyncio
    async def test_summer_years_breakdown(self) -> None:
        """Summer years breakdown counts correctly."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(person_id=1, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=2, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=3, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(person_id=1),
            2: MockPerson(person_id=2),
            3: MockPerson(person_id=3),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []

        # Return history showing different summer years
        # Person 1: 2 summers (2023, 2024), Person 2: 1 summer (2024), Person 3: 3 summers (2022, 2023, 2024)
        mock_repo.fetch_summer_enrollment_history.return_value = [
            MagicMock(person_id=1, expand={"session": MagicMock(start_date="2023-06-01", session_type="main")}),
            MagicMock(person_id=1, expand={"session": MagicMock(start_date="2024-06-01", session_type="main")}),
            MagicMock(person_id=2, expand={"session": MagicMock(start_date="2024-06-01", session_type="main")}),
            MagicMock(person_id=3, expand={"session": MagicMock(start_date="2022-06-01", session_type="main")}),
            MagicMock(person_id=3, expand={"session": MagicMock(start_date="2023-06-01", session_type="main")}),
            MagicMock(person_id=3, expand={"session": MagicMock(start_date="2024-06-01", session_type="main")}),
        ]

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        # Check summer years breakdown
        years_dict = {y.summer_years: y for y in result.by_summer_years}
        assert years_dict[1].count == 1  # Person 2
        assert years_dict[2].count == 1  # Person 1
        assert years_dict[3].count == 1  # Person 3

    @pytest.mark.asyncio
    async def test_first_summer_year_breakdown(self) -> None:
        """First summer year breakdown shows cohort correctly."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(person_id=1, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=2, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(person_id=1),
            2: MockPerson(person_id=2),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []

        # Person 1 started 2022, Person 2 started 2024
        mock_repo.fetch_summer_enrollment_history.return_value = [
            MagicMock(person_id=1, expand={"session": MagicMock(start_date="2022-06-01", session_type="main")}),
            MagicMock(person_id=1, expand={"session": MagicMock(start_date="2023-06-01", session_type="main")}),
            MagicMock(person_id=1, expand={"session": MagicMock(start_date="2024-06-01", session_type="main")}),
            MagicMock(person_id=2, expand={"session": MagicMock(start_date="2024-06-01", session_type="main")}),
        ]

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        first_year_dict = {y.first_summer_year: y for y in result.by_first_summer_year}
        assert first_year_dict[2022].count == 1  # Person 1
        assert first_year_dict[2024].count == 1  # Person 2


class TestRegistrationServiceGenderByGrade:
    """Tests for gender by grade cross-tabulation."""

    @pytest.mark.asyncio
    async def test_gender_by_grade_breakdown(self) -> None:
        """Gender by grade breakdown shows correct counts."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(person_id=1, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=2, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=3, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=4, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(person_id=1, gender="M", grade=5),
            2: MockPerson(person_id=2, gender="F", grade=5),
            3: MockPerson(person_id=3, gender="F", grade=5),
            4: MockPerson(person_id=4, gender="M", grade=6),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        grade_dict = {g.grade: g for g in result.by_gender_grade}
        assert grade_dict[5].male_count == 1
        assert grade_dict[5].female_count == 2
        assert grade_dict[5].total == 3
        assert grade_dict[6].male_count == 1
        assert grade_dict[6].female_count == 0
        assert grade_dict[6].total == 1
