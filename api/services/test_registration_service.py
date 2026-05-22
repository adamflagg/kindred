"""Tests for RegistrationService - written first (TDD).

These tests define the expected behavior for the registration metrics
service layer that will replace the monolithic endpoint code.
"""

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
    school: str | None = None
    address: dict[str, Any] | None = None
    household_id: int | None = None


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

        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_synagogue_by_household.return_value = {}

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

        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_synagogue_by_household.return_value = {}

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

        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_synagogue_by_household.return_value = {}

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

        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_synagogue_by_household.return_value = {}

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

        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_synagogue_by_household.return_value = {}

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

        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_synagogue_by_household.return_value = {}

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

        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_synagogue_by_household.return_value = {}

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

        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_synagogue_by_household.return_value = {}

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

        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_synagogue_by_household.return_value = {}

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

        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_synagogue_by_household.return_value = {}

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        assert result.total_enrolled == 2
        assert result.total_waitlisted == 1
        assert result.total_cancelled == 3


class TestRegistrationServiceDemographics:
    """Tests for demographic breakdowns from persons data."""

    @pytest.mark.asyncio
    async def test_school_breakdown_top_20(self) -> None:
        """School breakdown returns top 20 by count from persons.school field."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        # Create 25 persons, each with different schools
        # But to test "top 20", we need multiple persons per school
        attendees = []
        persons = {}
        for i in range(25):
            # Create (25-i) persons for each school
            # School 0: 25 persons, School 1: 24 persons, etc.
            for k in range(25 - i):
                pid = i * 100 + k + 1  # Unique person IDs
                attendees.append(
                    MockAttendee(pid, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")})
                )
                persons[pid] = MockPerson(person_id=pid, school=f"School {i}")

        mock_repo.fetch_attendees.return_value = attendees
        mock_repo.fetch_persons.return_value = persons
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }

        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_synagogue_by_household.return_value = {}

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        # Should only have 20 schools
        assert len(result.by_school) == 20
        # First school should be School 0 (most common - 25 persons)
        assert result.by_school[0].school == "School 0"
        assert result.by_school[0].count == 25

    @pytest.mark.asyncio
    async def test_city_breakdown_excludes_empty(self) -> None:
        """City breakdown excludes empty/null cities from persons.address.city field."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(person_id=1, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=2, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=3, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=4, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(person_id=1, address={"city": "Oakland"}),
            2: MockPerson(person_id=2, address={"city": ""}),
            3: MockPerson(person_id=3, address=None),  # No address
            4: MockPerson(person_id=4, address={"city": "Berkeley"}),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }

        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_synagogue_by_household.return_value = {}

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        city_names = [c.city for c in result.by_city]
        assert "Oakland" in city_names
        assert "Berkeley" in city_names
        assert "" not in city_names

    @pytest.mark.asyncio
    async def test_synagogue_breakdown(self) -> None:
        """Synagogue breakdown works correctly from household custom values."""
        from api.services.registration_service import RegistrationService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(person_id=1, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=2, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            MockAttendee(person_id=3, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
        ]
        # Persons with household_id for synagogue lookup
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(person_id=1, household_id=100),
            2: MockPerson(person_id=2, household_id=100),  # Same household as person 1
            3: MockPerson(person_id=3, household_id=200),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }

        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        # Synagogue by household mapping
        mock_repo.fetch_synagogue_by_household.return_value = {
            100: "Temple Beth Sholom",
            200: "Congregation Shalom",
        }

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        synagogue_dict = {s.synagogue: s for s in result.by_synagogue}
        assert synagogue_dict["Temple Beth Sholom"].count == 2  # Persons 1 and 2
        assert synagogue_dict["Congregation Shalom"].count == 1  # Person 3


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

        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_synagogue_by_household.return_value = {}

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

        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_synagogue_by_household.return_value = {}

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

        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_synagogue_by_household.return_value = {}

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2025)

        grade_dict = {g.grade: g for g in result.by_gender_grade}
        assert grade_dict[5].male_count == 1
        assert grade_dict[5].female_count == 2
        assert grade_dict[5].total == 3
        assert grade_dict[6].male_count == 1
        assert grade_dict[6].female_count == 0
        assert grade_dict[6].total == 1


class TestRegistrationTeenCohortGating:
    """Tests for window-gating teen (scit/tli) sessions in registration counts.

    Off-season teen sessions (fall Family-Camp CIT, Feb trips, year-long interns)
    must be excluded from both totals and by_session breakdown rows.
    Summer-overlapping teen sessions must appear normally.
    Non-teen behavior must be identical before and after the change.
    """

    # Main session window anchor for 2026: June 15 – July 5
    # Summer SCIT: overlaps (June 20 – July 10) → IN
    # Fall CIT:    does not overlap (Sept 12 – Sept 15) → OUT

    def _make_all_sessions_dict(self) -> dict[int, MockSession]:
        """Full year session dict with main + both SCIT variants."""
        return {
            3001: MockSession(
                cm_id=3001,
                name="Session 2",
                session_type="main",
                start_date="2026-06-15",
                end_date="2026-07-05",
            ),
            3010: MockSession(
                cm_id=3010,
                name="Summer SCIT",
                session_type="scit",
                start_date="2026-06-20",
                end_date="2026-07-10",
            ),
            3020: MockSession(
                cm_id=3020,
                name="Fall CIT",
                session_type="scit",
                start_date="2026-09-12",
                end_date="2026-09-15",
            ),
        }

    def _make_fetch_sessions_side_effect(self, all_sessions: dict[int, MockSession]):
        """Return a side_effect coroutine for fetch_sessions(year, types).

        Called with types=None → returns the full dict.
        Called with explicit types → returns only sessions of those types.
        """

        async def _fetch(year: int, types: list[str] | None = None) -> dict[int, MockSession]:
            if types is None:
                return all_sessions
            return {sid: s for sid, s in all_sessions.items() if s.session_type in types}

        return _fetch

    @pytest.mark.asyncio
    async def test_registration_summer_teen_session_appears_in_breakdown(self) -> None:
        """Summer-overlapping SCIT session must appear in by_session and count toward total.

        Year has a main session (window anchor) + a summer SCIT that overlaps the window.
        A grade-11 attendee enrolled in the summer SCIT.
        Calling calculate_registration(year, ["scit"], ["enrolled"]) must:
          - total_enrolled == 1
          - by_session contains a row for the summer SCIT session (cm_id=3010)
        """
        from api.services.registration_service import RegistrationService

        all_sessions = self._make_all_sessions_dict()

        summer_scit = all_sessions[3010]
        enrollee = MockAttendee(
            person_id=201,
            expand={"session": summer_scit},
        )

        mock_repo = AsyncMock()
        mock_repo.fetch_sessions.side_effect = self._make_fetch_sessions_side_effect(all_sessions)
        mock_repo.fetch_attendees.return_value = [enrollee]
        mock_repo.fetch_persons.return_value = {201: MockPerson(person_id=201, gender="M", grade=11)}
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_synagogue_by_household.return_value = {}

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2026, session_types=["scit"], status_filter=["enrolled"])

        assert result.total_enrolled == 1, f"Expected 1 enrolled for summer SCIT, got {result.total_enrolled}"
        session_ids = {s.session_cm_id for s in result.by_session}
        assert 3010 in session_ids, f"Summer SCIT session (3010) must appear in by_session; got {session_ids}"

    @pytest.mark.asyncio
    async def test_registration_offseason_teen_excluded(self) -> None:
        """Off-season SCIT session (fall dates) must be excluded from counts AND by_session.

        Year has a main session (window anchor) + a fall CIT outside the window.
        A grade-11 attendee enrolled in the fall CIT.
        Calling calculate_registration(year, ["scit"], ["enrolled"]) must:
          - total_enrolled == 0  (off-season teen excluded)
          - by_session == []     (no row for the excluded session)
        """
        from api.services.registration_service import RegistrationService

        all_sessions = self._make_all_sessions_dict()

        fall_cit = all_sessions[3020]
        enrollee = MockAttendee(
            person_id=202,
            expand={"session": fall_cit},
        )

        mock_repo = AsyncMock()
        mock_repo.fetch_sessions.side_effect = self._make_fetch_sessions_side_effect(all_sessions)
        mock_repo.fetch_attendees.return_value = [enrollee]
        mock_repo.fetch_persons.return_value = {202: MockPerson(person_id=202, gender="F", grade=11)}
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_synagogue_by_household.return_value = {}

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2026, session_types=["scit"], status_filter=["enrolled"])

        assert result.total_enrolled == 0, (
            f"Off-season fall CIT must not count toward total_enrolled; got {result.total_enrolled}"
        )
        assert result.by_session == [], f"Off-season fall CIT must not appear in by_session; got {result.by_session}"

    @pytest.mark.asyncio
    async def test_registration_nonteen_unchanged(self) -> None:
        """Non-teen session types (main, embedded, ag, quest) must be unaffected.

        Baseline fixture: main + embedded sessions, no teens.
        calculate_registration(year, ["main", "embedded", "ag", "quest"], ["enrolled"])
        must produce the same totals and by_session as before the teen-gating change.
        """
        from api.services.registration_service import RegistrationService

        main_session = MockSession(
            cm_id=4001,
            name="Session 2",
            session_type="main",
            start_date="2026-06-15",
            end_date="2026-07-05",
        )
        embedded_session = MockSession(
            cm_id=4002,
            name="Taste of Camp",
            session_type="embedded",
            start_date="2026-06-20",
            end_date="2026-06-23",
        )
        all_sessions: dict[int, MockSession] = {
            4001: main_session,
            4002: embedded_session,
        }
        non_teen_types = ["main", "embedded", "ag", "quest"]

        enrollees = [
            MockAttendee(person_id=301, expand={"session": main_session}),
            MockAttendee(person_id=302, expand={"session": main_session}),
            MockAttendee(person_id=303, expand={"session": embedded_session}),
        ]
        persons = {
            301: MockPerson(person_id=301, gender="M", grade=6),
            302: MockPerson(person_id=302, gender="F", grade=7),
            303: MockPerson(person_id=303, gender="M", grade=5),
        }

        mock_repo = AsyncMock()
        mock_repo.fetch_sessions.side_effect = self._make_fetch_sessions_side_effect(all_sessions)
        mock_repo.fetch_attendees.return_value = enrollees
        mock_repo.fetch_persons.return_value = persons
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_synagogue_by_household.return_value = {}

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(2026, session_types=non_teen_types, status_filter=["enrolled"])

        # All 3 non-teen enrollees must be counted
        assert result.total_enrolled == 3, f"Non-teen total must be 3; got {result.total_enrolled}"
        # Both sessions must appear in breakdown
        session_ids = {s.session_cm_id for s in result.by_session}
        assert 4001 in session_ids, "Main session must appear in by_session"
        assert 4002 in session_ids, "Embedded session must appear in by_session"
        # Counts per session
        by_session_map = {s.session_cm_id: s.count for s in result.by_session}
        assert by_session_map[4001] == 2, f"Main session must have 2 enrollees; got {by_session_map[4001]}"
        assert by_session_map[4002] == 1, f"Embedded session must have 1 enrollee; got {by_session_map[4002]}"

    @pytest.mark.asyncio
    async def test_registration_offseason_teen_excluded_even_with_matching_duration(self) -> None:
        """Cohort gate excludes an off-season teen even when it matches the duration filter.

        Guards the new ``cohort_ids & duration_session_ids`` intersection branch.

        Year has a main session (window anchor) + a fall Family-Camp CIT (scit,
        2026-09-12..2026-09-15 → "1-week" category, off-season). A grade-11 attendee
        is enrolled in the fall CIT. Calling
        ``calculate_registration(year, ["scit"], ["enrolled"], duration="1-week")`` must:
          - total_enrolled == 0
          - by_session == []

        Discrimination: the fall CIT IS a "1-week" session, so the old code path
        (session_cm_ids=duration_session_ids) would have admitted it → total_enrolled
        would be 1. The cohort gate makes resolve_cohort_session_ids(["scit"]) empty
        (off-season window-gated out), so cohort_ids & duration_ids == {} and the
        attendee is dropped.
        """
        from api.services.registration_service import RegistrationService

        # Window anchor + off-season fall CIT that lands in the "1-week" bucket.
        all_sessions: dict[int, MockSession] = {
            5001: MockSession(
                cm_id=5001,
                name="Session 2",
                session_type="main",
                start_date="2026-06-15",
                end_date="2026-07-05",
            ),
            5020: MockSession(
                cm_id=5020,
                name="Fall CIT",
                session_type="scit",
                start_date="2026-09-12",
                end_date="2026-09-15",
            ),
        }

        fall_cit = all_sessions[5020]
        enrollee = MockAttendee(
            person_id=205,
            expand={"session": fall_cit},
        )

        mock_repo = AsyncMock()
        mock_repo.fetch_sessions.side_effect = self._make_fetch_sessions_side_effect(all_sessions)
        mock_repo.fetch_attendees.return_value = [enrollee]
        mock_repo.fetch_persons.return_value = {205: MockPerson(person_id=205, gender="M", grade=11)}
        mock_repo.fetch_bunk_plans.return_value = []
        mock_repo.fetch_capacity_config.return_value = 12
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.fetch_synagogue_by_household.return_value = {}

        service = RegistrationService(mock_repo)
        result = await service.calculate_registration(
            2026, session_types=["scit"], status_filter=["enrolled"], duration="1-week"
        )

        assert result.total_enrolled == 0, (
            f"Off-season fall CIT must be cohort-gated out even though it matches the "
            f"1-week duration; got {result.total_enrolled}"
        )
        assert result.by_session == [], f"Off-season fall CIT must not appear in by_session; got {result.by_session}"
