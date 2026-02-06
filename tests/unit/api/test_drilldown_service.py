"""
Unit tests for the drilldown service.

These tests verify drilldown filtering logic for new breakdown types:
- returning_status (new/returning based on years_at_camp)
- session_length (based on session date calculations)
- first_summer_year (based on enrollment history)
"""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, Mock

import pytest

# Set AUTH_MODE before any imports that might load settings
os.environ["AUTH_MODE"] = "bypass"
os.environ["SKIP_PB_AUTH"] = "true"

from api.services.drilldown_service import DrilldownService

# ============================================================================
# Test Data Factories
# ============================================================================


def create_mock_person(
    cm_id: int,
    first_name: str,
    last_name: str,
    gender: str = "M",
    grade: int = 6,
    years_at_camp: int = 2,
    year: int = 2026,
    school: str = "Riverside Elementary",
    address_city: str = "Springfield",
    address_state: str = "IL",
    normalized_school: str | None = None,
    normalized_city: str | None = None,
    normalized_congregation: str | None = None,
) -> Mock:
    """Create a mock person record.

    Uses discrete address columns (address_city, address_state) instead of JSON.
    """
    person = Mock()
    person.cm_id = cm_id
    person.first_name = first_name
    person.last_name = last_name
    person.gender = gender
    person.grade = grade
    person.years_at_camp = years_at_camp
    person.year = year
    person.school = school
    # Use discrete address columns
    person.address_city = address_city
    person.address_state = address_state
    person.preferred_name = None
    person.age = 12
    person.normalized_school = normalized_school
    person.normalized_city = normalized_city
    person.normalized_congregation = normalized_congregation
    return person


def create_mock_session(
    cm_id: int,
    name: str,
    year: int,
    session_type: str = "main",
    start_date: str = "2026-06-15",
    end_date: str = "2026-07-05",
    parent_id: int | None = None,
) -> Mock:
    """Create a mock session record."""
    session = Mock()
    session.cm_id = cm_id
    session.name = name
    session.year = year
    session.session_type = session_type
    session.start_date = start_date
    session.end_date = end_date
    session.parent_id = parent_id
    return session


def create_mock_attendee(
    person_id: int,
    session: Mock,
    year: int,
    status: str = "enrolled",
    status_id: int = 2,
    is_active: bool = True,
) -> Mock:
    """Create a mock attendee record with embedded session."""
    attendee = Mock()
    attendee.person_id = person_id
    attendee.year = year
    attendee.status = status
    attendee.status_id = status_id
    attendee.is_active = is_active
    # Embed session in expand dict (matching real PocketBase behavior)
    attendee.expand = {"session": session}
    return attendee


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def mock_repository():
    """Create a mock MetricsRepository."""
    repo = Mock()
    repo.fetch_attendees = AsyncMock(return_value=[])
    repo.fetch_persons = AsyncMock(return_value={})
    repo.fetch_sessions = AsyncMock(return_value={})
    repo.fetch_summer_enrollment_history = AsyncMock(return_value=[])
    return repo


@pytest.fixture
def drilldown_service(mock_repository):
    """Create a DrilldownService with mock repository."""
    return DrilldownService(mock_repository)


@pytest.fixture
def sample_sessions() -> dict[int, Mock]:
    """Sample sessions for 2026 with various lengths."""
    return {
        # 1-week session (7 days: June 15-21)
        1001: create_mock_session(1001, "Taste of Camp", 2026, "main", "2026-06-15", "2026-06-21"),
        # 2-week session (14 days: June 15-28)
        1002: create_mock_session(1002, "Session 2a", 2026, "embedded", "2026-06-15", "2026-06-28"),
        # 3-week session (21 days: June 15 - July 5)
        1003: create_mock_session(1003, "Session 2", 2026, "main", "2026-06-15", "2026-07-05"),
        # 4-week+ session (28 days: June 15 - July 12)
        1004: create_mock_session(1004, "Session 3", 2026, "main", "2026-06-15", "2026-07-12"),
    }


@pytest.fixture
def sample_persons() -> dict[int, Mock]:
    """Sample persons with varying years_at_camp."""
    return {
        # New campers (years_at_camp = 1)
        101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=1),
        102: create_mock_person(102, "Liam", "Garcia", "M", 6, years_at_camp=1),
        # Returning campers (years_at_camp > 1)
        103: create_mock_person(103, "Olivia", "Chen", "F", 6, years_at_camp=2),
        104: create_mock_person(104, "Noah", "Williams", "M", 7, years_at_camp=3),
        105: create_mock_person(105, "Ava", "Brown", "F", 8, years_at_camp=5),
    }


@pytest.fixture
def sample_attendees(sample_sessions: dict[int, Mock], sample_persons: dict[int, Mock]) -> list[Mock]:
    """Sample attendees with various sessions."""
    return [
        # New campers
        create_mock_attendee(101, sample_sessions[1001], 2026),  # Emma in 1-week
        create_mock_attendee(102, sample_sessions[1002], 2026),  # Liam in 2-week
        # Returning campers
        create_mock_attendee(103, sample_sessions[1003], 2026),  # Olivia in 3-week
        create_mock_attendee(104, sample_sessions[1004], 2026),  # Noah in 4-week+
        create_mock_attendee(105, sample_sessions[1003], 2026),  # Ava in 3-week
    ]


# ============================================================================
# Tests for returning_status breakdown type
# ============================================================================


class TestReturningStatusBreakdown:
    """Tests for filtering by returning_status (new/returning)."""

    @pytest.mark.asyncio
    async def test_filter_by_returning_status_new(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
        sample_attendees: list[Mock],
    ) -> None:
        """Filter for new campers (years_at_camp == 1)."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = sample_attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="returning_status",
            breakdown_value="new",
        )

        # Should return Emma (101) and Liam (102) who have years_at_camp = 1
        assert len(result) == 2
        person_ids = {r.person_id for r in result}
        assert person_ids == {101, 102}

    @pytest.mark.asyncio
    async def test_filter_by_returning_status_returning(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
        sample_attendees: list[Mock],
    ) -> None:
        """Filter for returning campers (years_at_camp > 1)."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = sample_attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="returning_status",
            breakdown_value="returning",
        )

        # Should return Olivia (103), Noah (104), Ava (105) who have years_at_camp > 1
        assert len(result) == 3
        person_ids = {r.person_id for r in result}
        assert person_ids == {103, 104, 105}


# ============================================================================
# Tests for session_length breakdown type
# ============================================================================


class TestSessionLengthBreakdown:
    """Tests for filtering by session_length."""

    @pytest.mark.asyncio
    async def test_filter_by_session_length_1_week(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
        sample_attendees: list[Mock],
    ) -> None:
        """Filter for 1-week sessions."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = sample_attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="session_length",
            breakdown_value="1-week",
        )

        # Should return Emma (101) who is in the 1-week session (Taste of Camp)
        assert len(result) == 1
        assert result[0].person_id == 101

    @pytest.mark.asyncio
    async def test_filter_by_session_length_2_week(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
        sample_attendees: list[Mock],
    ) -> None:
        """Filter for 2-week sessions."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = sample_attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="session_length",
            breakdown_value="2-week",
        )

        # Should return Liam (102) who is in the 2-week session (Session 2a)
        assert len(result) == 1
        assert result[0].person_id == 102

    @pytest.mark.asyncio
    async def test_filter_by_session_length_3_week(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
        sample_attendees: list[Mock],
    ) -> None:
        """Filter for 3-week sessions."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = sample_attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="session_length",
            breakdown_value="3-week",
        )

        # Should return Olivia (103) and Ava (105) who are in the 3-week session
        assert len(result) == 2
        person_ids = {r.person_id for r in result}
        assert person_ids == {103, 105}

    @pytest.mark.asyncio
    async def test_filter_by_session_length_4_week_plus(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
        sample_attendees: list[Mock],
    ) -> None:
        """Filter for 4-week+ sessions."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = sample_attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="session_length",
            breakdown_value="4-week+",
        )

        # Should return Noah (104) who is in the 4-week+ session
        assert len(result) == 1
        assert result[0].person_id == 104


# ============================================================================
# Tests for first_summer_year breakdown type
# ============================================================================


class TestFirstSummerYearBreakdown:
    """Tests for filtering by first_summer_year."""

    @pytest.mark.asyncio
    async def test_filter_by_first_summer_year(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Filter for campers whose first summer was a specific year."""
        # Create attendees for current year
        attendees_2026 = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
            create_mock_attendee(102, sample_sessions[1002], 2026),
            create_mock_attendee(103, sample_sessions[1003], 2026),
        ]

        # Create enrollment history showing different first years
        history_sessions = {
            # Sessions for historical years
            901: create_mock_session(901, "Session 2", 2024, "main", "2024-06-15", "2024-07-05"),
            902: create_mock_session(902, "Session 3", 2025, "main", "2025-06-15", "2025-07-05"),
        }

        # Emma (101): first summer 2026 (only enrolled this year)
        # Liam (102): first summer 2025 (enrolled in 2025 and 2026)
        # Olivia (103): first summer 2024 (enrolled in 2024, 2025, and 2026)
        enrollment_history = [
            # 2026 enrollments
            create_mock_attendee(101, sample_sessions[1001], 2026),
            create_mock_attendee(102, sample_sessions[1002], 2026),
            create_mock_attendee(103, sample_sessions[1003], 2026),
            # 2025 enrollments
            create_mock_attendee(102, history_sessions[902], 2025),
            create_mock_attendee(103, history_sessions[902], 2025),
            # 2024 enrollments
            create_mock_attendee(103, history_sessions[901], 2024),
        ]

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = attendees_2026
        mock_repository.fetch_summer_enrollment_history.return_value = enrollment_history

        # Filter for campers whose first summer was 2024
        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="first_summer_year",
            breakdown_value="2024",
        )

        # Should return only Olivia (103) who started in 2024
        assert len(result) == 1
        assert result[0].person_id == 103

    @pytest.mark.asyncio
    async def test_filter_by_first_summer_year_current_year(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Filter for campers whose first summer is the current year (brand new)."""
        # Create attendees for current year
        attendees_2026 = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
            create_mock_attendee(102, sample_sessions[1002], 2026),
            create_mock_attendee(103, sample_sessions[1003], 2026),
        ]

        # Create enrollment history (no history for Emma 101)
        history_sessions = {
            902: create_mock_session(902, "Session 3", 2025, "main", "2025-06-15", "2025-07-05"),
        }

        enrollment_history = [
            # 2026 enrollments (everyone enrolled this year)
            create_mock_attendee(101, sample_sessions[1001], 2026),
            create_mock_attendee(102, sample_sessions[1002], 2026),
            create_mock_attendee(103, sample_sessions[1003], 2026),
            # 2025 enrollments (Liam and Olivia were enrolled)
            create_mock_attendee(102, history_sessions[902], 2025),
            create_mock_attendee(103, history_sessions[902], 2025),
        ]

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = attendees_2026
        mock_repository.fetch_summer_enrollment_history.return_value = enrollment_history

        # Filter for campers whose first summer was 2026
        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="first_summer_year",
            breakdown_value="2026",
        )

        # Should return only Emma (101) who started in 2026
        assert len(result) == 1
        assert result[0].person_id == 101

    @pytest.mark.asyncio
    async def test_filter_by_first_summer_year_no_match(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Filter for a year with no matching campers returns empty list."""
        attendees_2026 = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
        ]

        enrollment_history = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
        ]

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = attendees_2026
        mock_repository.fetch_summer_enrollment_history.return_value = enrollment_history

        # Filter for campers whose first summer was 2020 (none exist)
        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="first_summer_year",
            breakdown_value="2020",
        )

        assert len(result) == 0


# ============================================================================
# Tests for city breakdown type
# ============================================================================


class TestCityBreakdown:
    """Tests for filtering by city using person.normalized_city.

    City drilldown uses the normalized_city field on the person record (set by
    the normalize_geographic sync), NOT raw person.address_city values. This
    ensures that when a user clicks "Oakland" in the GeoDetailList (which shows
    normalized values), they get all campers whose city was normalized to
    "Oakland", regardless of how the raw address was spelled.
    """

    @pytest.fixture
    def persons_with_cities(self) -> dict[int, Mock]:
        """Sample persons with normalized_city set by normalize_geographic sync.

        Note: The raw address values differ from normalized values to demonstrate
        that city drilldown matches on person.normalized_city, not raw address.
        """
        return {
            # Raw: "san francisco" -> Normalized: "San Francisco"
            101: create_mock_person(
                101,
                "Emma",
                "Johnson",
                "F",
                5,
                address_city="san francisco",
                address_state="CA",
                normalized_city="San Francisco",
            ),
            # Raw: "SF, CA" -> Normalized: "San Francisco"
            102: create_mock_person(
                102,
                "Liam",
                "Garcia",
                "M",
                6,
                address_city="SF, CA",
                address_state="CA",
                normalized_city="San Francisco",
            ),
            # Raw: "oakland" -> Normalized: "Oakland"
            103: create_mock_person(
                103,
                "Olivia",
                "Chen",
                "F",
                6,
                address_city="oakland",
                address_state="CA",
                normalized_city="Oakland",
            ),
            # Raw: "Berkeley" -> Normalized: "Berkeley"
            104: create_mock_person(
                104,
                "Noah",
                "Williams",
                "M",
                7,
                address_city="Berkeley",
                address_state="CA",
                normalized_city="Berkeley",
            ),
            # Raw: "Oaklnad" (typo) -> Normalized: "Oakland"
            105: create_mock_person(
                105,
                "Ava",
                "Brown",
                "F",
                8,
                address_city="Oaklnad",
                address_state="CA",
                normalized_city="Oakland",
            ),
        }

    @pytest.mark.asyncio
    async def test_filter_by_city_uses_normalized_field(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        persons_with_cities: dict[int, Mock],
    ) -> None:
        """Filter for campers from a specific city using person.normalized_city.

        Raw values like "san francisco" and "SF, CA" both have
        normalized_city="San Francisco" on the person record.
        """
        attendees = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
            create_mock_attendee(102, sample_sessions[1002], 2026),
            create_mock_attendee(103, sample_sessions[1003], 2026),
            create_mock_attendee(104, sample_sessions[1004], 2026),
            create_mock_attendee(105, sample_sessions[1003], 2026),
        ]
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons_with_cities
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="city",
            breakdown_value="San Francisco",
        )

        # Should return Emma (101) and Liam (102) - both normalized to "San Francisco"
        assert len(result) == 2
        person_ids = {r.person_id for r in result}
        assert person_ids == {101, 102}

    @pytest.mark.asyncio
    async def test_filter_by_city_oakland_with_typo_normalization(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        persons_with_cities: dict[int, Mock],
    ) -> None:
        """Filter for Oakland includes campers with typos normalized to Oakland.

        Ava (105) has raw address "Oaklnad" (typo) but normalized_city="Oakland",
        so she should appear in Oakland drilldown results.
        """
        attendees = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
            create_mock_attendee(102, sample_sessions[1002], 2026),
            create_mock_attendee(103, sample_sessions[1003], 2026),
            create_mock_attendee(104, sample_sessions[1004], 2026),
            create_mock_attendee(105, sample_sessions[1003], 2026),
        ]
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons_with_cities
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="city",
            breakdown_value="Oakland",
        )

        # Should return Olivia (103) and Ava (105) - both normalized to "Oakland"
        assert len(result) == 2
        person_ids = {r.person_id for r in result}
        assert person_ids == {103, 105}

    @pytest.mark.asyncio
    async def test_filter_by_city_no_match(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        persons_with_cities: dict[int, Mock],
    ) -> None:
        """Filter for city with no campers returns empty list."""
        attendees = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
        ]
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons_with_cities
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="city",
            breakdown_value="Los Angeles",
        )

        # No one has normalized_city="Los Angeles"
        assert len(result) == 0

    @pytest.mark.asyncio
    async def test_filter_by_city_person_without_normalized_city(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
    ) -> None:
        """Campers without normalized_city are not matched.

        If a person doesn't have normalized_city set (e.g., normalize_geographic
        sync hasn't run yet), they won't appear in city drilldown results.
        """
        persons = {
            101: create_mock_person(
                101,
                "Emma",
                "Johnson",
                "F",
                5,
                address_city="San Francisco",
                normalized_city="San Francisco",
            ),
            102: create_mock_person(
                102,
                "Liam",
                "Garcia",
                "M",
                6,
                address_city="San Francisco",
                normalized_city=None,
            ),
        }
        attendees = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
            create_mock_attendee(102, sample_sessions[1002], 2026),
        ]
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="city",
            breakdown_value="San Francisco",
        )

        # Only Emma (101) has normalized_city, Liam (102) doesn't
        assert len(result) == 1
        assert result[0].person_id == 101


# ============================================================================
# Tests for synagogue breakdown type
# ============================================================================


class TestSynagogueBreakdown:
    """Tests for filtering by synagogue using person.normalized_congregation.

    Synagogue drilldown uses the normalized_congregation field on the person
    record (set by the normalize_geographic sync), NOT raw values from the
    person_custom_values table. This ensures drilldown counts match the
    summary list which aggregates from persons.normalized_congregation.
    """

    @pytest.fixture
    def persons_with_congregations(self) -> dict[int, Mock]:
        """Sample persons with normalized_congregation set."""
        return {
            101: create_mock_person(
                101,
                "Emma",
                "Johnson",
                "F",
                5,
                normalized_congregation="Congregation Beth Israel",
            ),
            102: create_mock_person(
                102,
                "Liam",
                "Garcia",
                "M",
                6,
                normalized_congregation="Congregation Beth Israel",
            ),
            103: create_mock_person(
                103,
                "Olivia",
                "Chen",
                "F",
                6,
                normalized_congregation="Temple Sinai",
            ),
            104: create_mock_person(
                104,
                "Noah",
                "Williams",
                "M",
                7,
                normalized_congregation="Congregation Beth Israel",
            ),
            105: create_mock_person(
                105,
                "Ava",
                "Brown",
                "F",
                8,
                normalized_congregation="Temple Sinai",
            ),
        }

    @pytest.mark.asyncio
    async def test_filter_by_synagogue(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        persons_with_congregations: dict[int, Mock],
    ) -> None:
        """Filter for campers from a specific synagogue."""
        attendees = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
            create_mock_attendee(102, sample_sessions[1002], 2026),
            create_mock_attendee(103, sample_sessions[1003], 2026),
            create_mock_attendee(104, sample_sessions[1004], 2026),
            create_mock_attendee(105, sample_sessions[1003], 2026),
        ]
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons_with_congregations
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="synagogue",
            breakdown_value="Congregation Beth Israel",
        )

        # Should return Emma (101), Liam (102), and Noah (104)
        assert len(result) == 3
        person_ids = {r.person_id for r in result}
        assert person_ids == {101, 102, 104}

    @pytest.mark.asyncio
    async def test_filter_by_synagogue_temple_sinai(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        persons_with_congregations: dict[int, Mock],
    ) -> None:
        """Filter for campers from Temple Sinai."""
        attendees = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
            create_mock_attendee(102, sample_sessions[1002], 2026),
            create_mock_attendee(103, sample_sessions[1003], 2026),
            create_mock_attendee(104, sample_sessions[1004], 2026),
            create_mock_attendee(105, sample_sessions[1003], 2026),
        ]
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons_with_congregations
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="synagogue",
            breakdown_value="Temple Sinai",
        )

        # Should return Olivia (103) and Ava (105) from Temple Sinai
        assert len(result) == 2
        person_ids = {r.person_id for r in result}
        assert person_ids == {103, 105}

    @pytest.mark.asyncio
    async def test_filter_by_synagogue_no_match(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
    ) -> None:
        """Filter for synagogue with no campers returns empty list."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5),
        }
        attendees = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
        ]
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="synagogue",
            breakdown_value="Unknown Temple",
        )

        assert len(result) == 0


# ============================================================================
# Tests for school breakdown using normalized values
# ============================================================================


class TestSchoolBreakdownNormalized:
    """Tests for filtering by school using normalized_school from persons.

    School drilldown should match on the normalized_school column (set by
    normalize_geographic sync), NOT the raw person.school value. This ensures
    that clicking "Park Day School" in the GeoDetailList returns all campers
    whose schools normalized to "Park Day School", even if the raw value
    differs (e.g. "park day school", "Park Day").
    """

    @pytest.fixture
    def persons_with_schools(self) -> dict[int, Mock]:
        """Sample persons with raw school values and normalized_school."""
        persons: dict[int, Mock] = {
            # Raw: "park day school" (lowercase) -> Normalized: "Park Day School"
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, school="park day school"),
            # Raw: "Park Day" (abbreviation) -> Normalized: "Park Day School"
            102: create_mock_person(102, "Liam", "Garcia", "M", 6, school="Park Day"),
            # Raw: "Mark Day School" (correct) -> Normalized: "Mark Day School"
            103: create_mock_person(103, "Olivia", "Chen", "F", 6, school="Mark Day School"),
            # Raw: "Riverside Elementary" -> Normalized: "Riverside Elementary School"
            104: create_mock_person(104, "Noah", "Williams", "M", 7, school="Riverside Elementary"),
        }
        # Set normalized_school on each person (populated by normalize_geographic sync)
        persons[101].normalized_school = "Park Day School"
        persons[102].normalized_school = "Park Day School"
        persons[103].normalized_school = "Mark Day School"
        persons[104].normalized_school = "Riverside Elementary School"
        return persons

    @pytest.mark.asyncio
    async def test_school_drilldown_uses_normalized_value(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        persons_with_schools: dict[int, Mock],
    ) -> None:
        """School drilldown matches on normalized_school, not raw person.school.

        When user clicks "Park Day School" in GeoDetailList, the drilldown
        should return all persons whose normalized_school is "Park Day School",
        even if their raw school value is different.
        """
        attendees = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
            create_mock_attendee(102, sample_sessions[1002], 2026),
            create_mock_attendee(103, sample_sessions[1003], 2026),
            create_mock_attendee(104, sample_sessions[1004], 2026),
        ]
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons_with_schools
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="school",
            breakdown_value="Park Day School",
        )

        # Should return Emma (101) and Liam (102) - both normalized to "Park Day School"
        # even though raw school values are "park day school" and "Park Day"
        assert len(result) == 2
        person_ids = {r.person_id for r in result}
        assert person_ids == {101, 102}

    @pytest.mark.asyncio
    async def test_school_drilldown_mark_day_separate(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        persons_with_schools: dict[int, Mock],
    ) -> None:
        """Mark Day School drilldown only returns Mark Day campers, not Park Day."""
        attendees = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
            create_mock_attendee(102, sample_sessions[1002], 2026),
            create_mock_attendee(103, sample_sessions[1003], 2026),
            create_mock_attendee(104, sample_sessions[1004], 2026),
        ]
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons_with_schools
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="school",
            breakdown_value="Mark Day School",
        )

        # Should return only Olivia (103)
        assert len(result) == 1
        assert result[0].person_id == 103

    @pytest.mark.asyncio
    async def test_school_drilldown_no_normalized_not_matched(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
    ) -> None:
        """Persons without normalized_school are not matched in school drilldown.

        The normalize_geographic sync always populates normalized_school for
        enrolled attendees with non-empty school values, so no fallback is needed.
        """
        persons: dict[int, Mock] = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, school="Hillcrest High"),
        }
        persons[101].normalized_school = None
        attendees = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
        ]
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="school",
            breakdown_value="Hillcrest High",
        )

        # No normalized_school means no match (no fallback to raw)
        assert len(result) == 0


# ============================================================================
# Tests for discrete address columns in DrilldownAttendee
# ============================================================================


class TestDiscreteAddressColumns:
    """Verify city/state come from discrete person columns, not JSON address field.

    The JSON address field was removed in Phase 3 (PR #208). The drilldown service
    must read city from person.address_city and state from person.address_state.
    """

    @pytest.mark.asyncio
    async def test_drilldown_attendee_has_city_from_discrete_column(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
    ) -> None:
        """DrilldownAttendee.city should be populated from person.address_city."""
        persons = {
            101: create_mock_person(
                101,
                "Emma",
                "Johnson",
                "F",
                5,
                years_at_camp=1,
                address_city="Springfield",
                address_state="IL",
            ),
        }
        attendees = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
        ]
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="returning_status",
            breakdown_value="new",
        )

        assert len(result) == 1
        # City and state must come from the discrete columns
        assert result[0].city == "Springfield"
        assert result[0].state == "IL"

    @pytest.mark.asyncio
    async def test_drilldown_attendee_empty_address_columns(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
    ) -> None:
        """DrilldownAttendee.city/state should be None when discrete columns are empty."""
        persons = {
            101: create_mock_person(
                101,
                "Emma",
                "Johnson",
                "F",
                5,
                years_at_camp=1,
                address_city="",
                address_state="",
            ),
        }
        attendees = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
        ]
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="returning_status",
            breakdown_value="new",
        )

        assert len(result) == 1
        # Empty strings should become None
        assert result[0].city is None
        assert result[0].state is None


# ============================================================================
# Tests for normalized display values in drilldown response
# ============================================================================


class TestNormalizedDisplayValues:
    """Verify _build_response uses normalized_school/normalized_city for display.

    The filtering logic correctly matches on normalized values, but the response
    should also DISPLAY normalized values (not raw) so the popup shows canonical
    names like "Park Day School" instead of raw "park day school" or "Park Day".
    """

    @pytest.mark.asyncio
    async def test_response_uses_normalized_school_for_display(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
    ) -> None:
        """DrilldownAttendee.school should prefer normalized_school over raw school."""
        persons = {
            101: create_mock_person(
                101,
                "Emma",
                "Johnson",
                "F",
                5,
                school="park day",
                normalized_school="Park Day School",
            ),
        }
        attendees = [create_mock_attendee(101, sample_sessions[1001], 2026)]
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="returning_status",
            breakdown_value="returning",
        )

        # Use returning_status=returning to match years_at_camp=2 default
        assert len(result) == 1
        assert result[0].school == "Park Day School"

    @pytest.mark.asyncio
    async def test_response_uses_normalized_city_for_display(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
    ) -> None:
        """DrilldownAttendee.city should prefer normalized_city over raw address_city."""
        persons = {
            101: create_mock_person(
                101,
                "Emma",
                "Johnson",
                "F",
                5,
                address_city="san francisco",
                normalized_city="San Francisco",
            ),
        }
        attendees = [create_mock_attendee(101, sample_sessions[1001], 2026)]
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="returning_status",
            breakdown_value="returning",
        )

        assert len(result) == 1
        assert result[0].city == "San Francisco"

    @pytest.mark.asyncio
    async def test_response_falls_back_to_raw_school_when_no_normalized(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
    ) -> None:
        """DrilldownAttendee.school falls back to raw school when normalized_school is None."""
        persons = {
            101: create_mock_person(
                101,
                "Emma",
                "Johnson",
                "F",
                5,
                school="Hillcrest High",
                normalized_school=None,
            ),
        }
        attendees = [create_mock_attendee(101, sample_sessions[1001], 2026)]
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="returning_status",
            breakdown_value="returning",
        )

        assert len(result) == 1
        assert result[0].school == "Hillcrest High"

    @pytest.mark.asyncio
    async def test_response_falls_back_to_raw_city_when_no_normalized(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
    ) -> None:
        """DrilldownAttendee.city falls back to raw address_city when normalized_city is None."""
        persons = {
            101: create_mock_person(
                101,
                "Emma",
                "Johnson",
                "F",
                5,
                address_city="Springfield",
                normalized_city=None,
            ),
        }
        attendees = [create_mock_attendee(101, sample_sessions[1001], 2026)]
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="returning_status",
            breakdown_value="returning",
        )

        assert len(result) == 1
        assert result[0].city == "Springfield"
