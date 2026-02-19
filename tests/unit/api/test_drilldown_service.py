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


# ============================================================================
# Tests for person-level deduplication across multiple sessions
# ============================================================================


class TestPersonLevelDeduplication:
    """Tests for deduplicating persons enrolled in multiple sessions.

    When a person is enrolled in multiple sessions (e.g., embedded sessions 2a + 3a),
    person-level breakdowns (gender, grade, status, etc.) should return one result per
    person with a sessions list, while session-level breakdowns should return one
    result per attendee record (no dedup).
    """

    @pytest.fixture
    def multi_session_sessions(self) -> dict[int, Mock]:
        """Sessions including embedded sessions for multi-enrollment scenarios."""
        return {
            1001: create_mock_session(1001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05"),
            1002: create_mock_session(1002, "Session 2a", 2026, "embedded", "2026-06-15", "2026-06-28"),
            1003: create_mock_session(1003, "Session 3a", 2026, "embedded", "2026-06-29", "2026-07-12"),
        }

    @pytest.fixture
    def multi_session_persons(self) -> dict[int, Mock]:
        """Persons where one is enrolled in multiple sessions."""
        return {
            # Emma is enrolled in 2 embedded sessions
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=2),
            # Liam is enrolled in 1 session
            102: create_mock_person(102, "Liam", "Garcia", "M", 6, years_at_camp=1),
        }

    @pytest.fixture
    def multi_session_attendees(self, multi_session_sessions: dict[int, Mock]) -> list[Mock]:
        """Attendees where Emma (101) is in two sessions."""
        return [
            create_mock_attendee(101, multi_session_sessions[1002], 2026),  # Emma in 2a
            create_mock_attendee(101, multi_session_sessions[1003], 2026),  # Emma in 3a
            create_mock_attendee(102, multi_session_sessions[1001], 2026),  # Liam in Session 2
        ]

    @pytest.mark.asyncio
    async def test_gender_dedup(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        multi_session_sessions: dict[int, Mock],
        multi_session_persons: dict[int, Mock],
        multi_session_attendees: list[Mock],
    ) -> None:
        """Gender breakdown deduplicates: Emma appears once despite 2 sessions."""
        mock_repository.fetch_sessions.return_value = multi_session_sessions
        mock_repository.fetch_persons.return_value = multi_session_persons
        mock_repository.fetch_attendees.return_value = multi_session_attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="gender",
            breakdown_value="F",
        )

        # Emma is F and in 2 sessions, but gender is person-level => 1 result
        assert len(result) == 1
        assert result[0].person_id == 101
        assert len(result[0].sessions) == 2
        session_names = {s.session_name for s in result[0].sessions}
        assert session_names == {"Session 2a", "Session 3a"}

    @pytest.mark.asyncio
    async def test_grade_dedup(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        multi_session_sessions: dict[int, Mock],
        multi_session_persons: dict[int, Mock],
        multi_session_attendees: list[Mock],
    ) -> None:
        """Grade breakdown deduplicates: person in 2 sessions returns 1 result."""
        mock_repository.fetch_sessions.return_value = multi_session_sessions
        mock_repository.fetch_persons.return_value = multi_session_persons
        mock_repository.fetch_attendees.return_value = multi_session_attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="grade",
            breakdown_value="5",
        )

        # Emma (grade 5) is in 2 sessions => 1 deduped result
        assert len(result) == 1
        assert result[0].person_id == 101

    @pytest.mark.asyncio
    async def test_status_dedup(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        multi_session_sessions: dict[int, Mock],
        multi_session_persons: dict[int, Mock],
        multi_session_attendees: list[Mock],
    ) -> None:
        """Status breakdown deduplicates: enrolled person in 2 sessions => 1 result."""
        mock_repository.fetch_sessions.return_value = multi_session_sessions
        mock_repository.fetch_persons.return_value = multi_session_persons
        mock_repository.fetch_attendees.return_value = multi_session_attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="status",
            breakdown_value="enrolled",
        )

        # Both Emma and Liam are enrolled, but Emma deduped => 2 unique persons
        assert len(result) == 2
        person_ids = {r.person_id for r in result}
        assert person_ids == {101, 102}

    @pytest.mark.asyncio
    async def test_session_no_dedup(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        multi_session_sessions: dict[int, Mock],
        multi_session_persons: dict[int, Mock],
        multi_session_attendees: list[Mock],
    ) -> None:
        """Session breakdown does NOT deduplicate: one result per attendee record."""
        mock_repository.fetch_sessions.return_value = multi_session_sessions
        mock_repository.fetch_persons.return_value = multi_session_persons
        mock_repository.fetch_attendees.return_value = multi_session_attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="session",
            breakdown_value="1002",  # Session 2a
        )

        # Session-level: Emma in Session 2a => 1 result (no dedup needed here)
        assert len(result) == 1
        assert result[0].person_id == 101
        assert result[0].session_cm_id == 1002

    @pytest.mark.asyncio
    async def test_session_length_no_dedup(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        multi_session_sessions: dict[int, Mock],
        multi_session_persons: dict[int, Mock],
        multi_session_attendees: list[Mock],
    ) -> None:
        """Session length breakdown does NOT deduplicate."""
        mock_repository.fetch_sessions.return_value = multi_session_sessions
        mock_repository.fetch_persons.return_value = multi_session_persons
        mock_repository.fetch_attendees.return_value = multi_session_attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="session_length",
            breakdown_value="2-week",
        )

        # Session 2a (June 15 - June 28 = 13 days) is 2-week, Session 3a is also ~2-week
        # Each attendee record is separate since session_length is per-attendee
        assert all(r.session_cm_id in (1002, 1003) for r in result)

    @pytest.mark.asyncio
    async def test_returning_null_years(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        multi_session_sessions: dict[int, Mock],
    ) -> None:
        """Persons with years_at_camp=None are included in returning filter."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=3),
        }
        # Set years_at_camp to None to simulate missing data
        persons[101].years_at_camp = None
        attendees = [
            create_mock_attendee(101, multi_session_sessions[1001], 2026),
        ]
        mock_repository.fetch_sessions.return_value = multi_session_sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="returning_status",
            breakdown_value="returning",
        )

        # years_at_camp=None should be treated as returning (not == 1)
        assert len(result) == 1
        assert result[0].person_id == 101

    @pytest.mark.asyncio
    async def test_returning_zero_years(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        multi_session_sessions: dict[int, Mock],
    ) -> None:
        """Persons with years_at_camp=0 are included in returning filter."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=0),
        }
        attendees = [
            create_mock_attendee(101, multi_session_sessions[1001], 2026),
        ]
        mock_repository.fetch_sessions.return_value = multi_session_sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="returning_status",
            breakdown_value="returning",
        )

        # years_at_camp=0 should be treated as returning (not == 1)
        assert len(result) == 1
        assert result[0].person_id == 101

    @pytest.mark.asyncio
    async def test_sessions_list_populated(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        multi_session_sessions: dict[int, Mock],
        multi_session_persons: dict[int, Mock],
        multi_session_attendees: list[Mock],
    ) -> None:
        """Deduped person has all sessions in sessions field."""
        mock_repository.fetch_sessions.return_value = multi_session_sessions
        mock_repository.fetch_persons.return_value = multi_session_persons
        mock_repository.fetch_attendees.return_value = multi_session_attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="returning_status",
            breakdown_value="returning",
        )

        # Emma (years_at_camp=2) is returning and in 2 sessions
        assert len(result) == 1
        assert result[0].person_id == 101
        assert len(result[0].sessions) == 2
        session_cm_ids = {s.session_cm_id for s in result[0].sessions}
        assert session_cm_ids == {1002, 1003}

    @pytest.mark.asyncio
    async def test_single_session_person_has_sessions_list(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        multi_session_sessions: dict[int, Mock],
        multi_session_persons: dict[int, Mock],
        multi_session_attendees: list[Mock],
    ) -> None:
        """Single-session person still has a sessions list with 1 entry."""
        mock_repository.fetch_sessions.return_value = multi_session_sessions
        mock_repository.fetch_persons.return_value = multi_session_persons
        mock_repository.fetch_attendees.return_value = multi_session_attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="gender",
            breakdown_value="M",
        )

        # Liam is M, in 1 session => 1 result with sessions list of 1
        assert len(result) == 1
        assert result[0].person_id == 102
        assert len(result[0].sessions) == 1
        assert result[0].sessions[0].session_name == "Session 2"


# ============================================================================
# Tests for waitlist drilldown breakdown types
# ============================================================================


def create_mock_status_history(
    person_id: int,
    session: Mock,
    person: Mock | None,
    old_status: str,
    new_status: str,
    detected_at: str = "2026-01-15 10:00:00.000Z",
    year: int = 2026,
) -> Mock:
    """Create a mock attendee_status_history record."""
    record = Mock()
    record.person_id = person_id
    record.old_status = old_status
    record.new_status = new_status
    record.detected_at = detected_at
    record.year = year
    record.expand = {"session": session}
    if person:
        record.expand["person"] = person
    return record


class TestWaitlistDrilldowns:
    """Tests for waitlist-specific drilldown breakdown types.

    These breakdown types use separate fetching logic from the standard
    breakdown pipeline since they need to cross-reference waitlisted vs
    enrolled attendees or query status history.
    """

    @pytest.fixture
    def waitlist_sessions(self) -> dict[int, Mock]:
        """Sessions for waitlist drilldown tests."""
        return {
            1001: create_mock_session(1001, "Session 1", 2026, "main", "2026-06-15", "2026-07-05"),
            1002: create_mock_session(1002, "Session 2", 2026, "main", "2026-07-06", "2026-07-26"),
            1003: create_mock_session(1003, "Session 2a", 2026, "embedded", "2026-07-06", "2026-07-19"),
        }

    @pytest.fixture
    def waitlist_persons(self) -> dict[int, Mock]:
        """Persons for waitlist drilldown tests."""
        return {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=1),
            102: create_mock_person(102, "Liam", "Garcia", "M", 6, years_at_camp=2),
            103: create_mock_person(103, "Olivia", "Chen", "F", 7, years_at_camp=1),
            104: create_mock_person(104, "Noah", "Williams", "M", 8, years_at_camp=3),
        }

    @pytest.mark.asyncio
    async def test_waitlist_no_enrollment(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """waitlist_no_enrollment returns persons waitlisted with no enrolled sessions."""
        session1 = waitlist_sessions[1001]
        session2 = waitlist_sessions[1002]

        # Emma (101) waitlisted for Session 1, NOT enrolled anywhere
        # Liam (102) waitlisted for Session 1, enrolled in Session 2
        waitlisted = [
            create_mock_attendee(101, session1, 2026, status="waitlisted"),
            create_mock_attendee(102, session1, 2026, status="waitlisted"),
        ]
        enrolled = [
            create_mock_attendee(102, session2, 2026, status="enrolled"),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted if status_filter == ["waitlisted"] else enrolled if status_filter == ["enrolled"] else []
            )
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_no_enrollment",
            breakdown_value="true",
        )

        # Only Emma should be returned (waitlisted, no enrollment)
        assert len(result) == 1
        assert result[0].person_id == 101

    @pytest.mark.asyncio
    async def test_waitlist_has_enrollment(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """waitlist_has_enrollment returns persons waitlisted who are enrolled elsewhere."""
        session1 = waitlist_sessions[1001]
        session2 = waitlist_sessions[1002]

        # Emma (101) waitlisted, NOT enrolled. Liam (102) waitlisted + enrolled in S2
        waitlisted = [
            create_mock_attendee(101, session1, 2026, status="waitlisted"),
            create_mock_attendee(102, session1, 2026, status="waitlisted"),
        ]
        enrolled = [
            create_mock_attendee(102, session2, 2026, status="enrolled"),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted if status_filter == ["waitlisted"] else enrolled if status_filter == ["enrolled"] else []
            )
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_has_enrollment",
            breakdown_value="true",
        )

        # Only Liam should be returned (waitlisted + enrolled elsewhere)
        assert len(result) == 1
        assert result[0].person_id == 102

    @pytest.mark.asyncio
    async def test_waitlist_accepted(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """waitlist_accepted returns persons with waitlisted->enrolled transition."""
        session1 = waitlist_sessions[1001]

        history = [
            create_mock_status_history(
                104, session1, waitlist_persons[104], old_status="waitlisted", new_status="enrolled"
            ),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_status_history = AsyncMock(return_value=history)

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_accepted",
            breakdown_value="true",
        )

        assert len(result) == 1
        assert result[0].person_id == 104
        assert result[0].first_name == "Noah"

    @pytest.mark.asyncio
    async def test_waitlist_declined(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """waitlist_declined returns persons with waitlisted->cancelled/withdrawn/dismissed."""
        session1 = waitlist_sessions[1001]

        history = [
            create_mock_status_history(
                103, session1, waitlist_persons[103], old_status="waitlisted", new_status="cancelled"
            ),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_status_history = AsyncMock(return_value=history)

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_declined",
            breakdown_value="true",
        )

        assert len(result) == 1
        assert result[0].person_id == 103
        assert result[0].first_name == "Olivia"

    @pytest.mark.asyncio
    async def test_waitlist_with_session_filter(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """Waitlist drilldown respects session_cm_id filter."""
        session1 = waitlist_sessions[1001]
        session2 = waitlist_sessions[1002]

        # Emma waitlisted for S1, Olivia waitlisted for S2, neither enrolled
        waitlisted = [
            create_mock_attendee(101, session1, 2026, status="waitlisted"),
            create_mock_attendee(103, session2, 2026, status="waitlisted"),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (waitlisted if status_filter == ["waitlisted"] else [])
        )

        # Filter to Session 1 only
        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_no_enrollment",
            breakdown_value="true",
            session_cm_id=1001,
        )

        # Only Emma (waitlisted in Session 1)
        assert len(result) == 1
        assert result[0].person_id == 101

    @pytest.mark.asyncio
    async def test_waitlist_accepted_deduplicates_by_person(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """waitlist_accepted deduplicates: person accepted from multiple sessions returns once."""
        session1 = waitlist_sessions[1001]
        session2 = waitlist_sessions[1002]

        # Noah accepted from waitlist in both sessions
        history = [
            create_mock_status_history(
                104, session1, waitlist_persons[104], old_status="waitlisted", new_status="enrolled"
            ),
            create_mock_status_history(
                104, session2, waitlist_persons[104], old_status="waitlisted", new_status="enrolled"
            ),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_status_history = AsyncMock(return_value=history)

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_accepted",
            breakdown_value="true",
        )

        # Should return Noah once, not twice
        assert len(result) == 1
        assert result[0].person_id == 104


class TestWaitlistTotalDrilldown:
    """Tests for waitlist_total breakdown type.

    waitlist_total returns all currently waitlisted persons (UC1 + UC2 combined)
    with enrolled session info. Supports filtering by session via breakdown_value.
    """

    @pytest.fixture
    def waitlist_sessions(self) -> dict[int, Mock]:
        """Sessions for waitlist_total drilldown tests."""
        return {
            1001: create_mock_session(1001, "Session 1", 2026, "main", "2026-06-15", "2026-07-05"),
            1002: create_mock_session(1002, "Session 2", 2026, "main", "2026-07-06", "2026-07-26"),
            1003: create_mock_session(1003, "Session 2a", 2026, "embedded", "2026-07-06", "2026-07-19"),
        }

    @pytest.fixture
    def waitlist_persons(self) -> dict[int, Mock]:
        """Persons for waitlist_total drilldown tests."""
        return {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=1),
            102: create_mock_person(102, "Liam", "Garcia", "M", 6, years_at_camp=2),
            103: create_mock_person(103, "Olivia", "Chen", "F", 7, years_at_camp=1),
        }

    @pytest.mark.asyncio
    async def test_waitlist_total_all_returns_uc1_and_uc2(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """waitlist_total with value='all' returns both UC1 and UC2 persons."""
        session1 = waitlist_sessions[1001]
        session2 = waitlist_sessions[1002]

        # Emma (101) waitlisted for S1, no enrollment (UC1)
        # Liam (102) waitlisted for S1, enrolled in S2 (UC2)
        waitlisted = [
            create_mock_attendee(101, session1, 2026, status="waitlisted"),
            create_mock_attendee(102, session1, 2026, status="waitlisted"),
        ]
        enrolled = [
            create_mock_attendee(102, session2, 2026, status="enrolled"),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted if status_filter == ["waitlisted"] else enrolled if status_filter == ["enrolled"] else []
            )
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_total",
            breakdown_value="all",
        )

        # Both UC1 and UC2 should be returned
        assert len(result) == 2
        person_ids = {r.person_id for r in result}
        assert person_ids == {101, 102}

    @pytest.mark.asyncio
    async def test_waitlist_total_filtered_by_session(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """waitlist_total with numeric value filters to that session's waitlisted persons."""
        session1 = waitlist_sessions[1001]
        session2 = waitlist_sessions[1002]

        # Emma waitlisted for S1, Olivia waitlisted for S2
        waitlisted = [
            create_mock_attendee(101, session1, 2026, status="waitlisted"),
            create_mock_attendee(103, session2, 2026, status="waitlisted"),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (waitlisted if status_filter == ["waitlisted"] else [])
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_total",
            breakdown_value="1001",
        )

        # Only Emma (waitlisted for session 1001)
        assert len(result) == 1
        assert result[0].person_id == 101

    @pytest.mark.asyncio
    async def test_waitlist_total_deduplicates_multi_session_person(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """Person waitlisted in 2 sessions appears once with both sessions listed."""
        session1 = waitlist_sessions[1001]
        session2 = waitlist_sessions[1002]

        # Emma waitlisted in both S1 and S2
        waitlisted = [
            create_mock_attendee(101, session1, 2026, status="waitlisted"),
            create_mock_attendee(101, session2, 2026, status="waitlisted"),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (waitlisted if status_filter == ["waitlisted"] else [])
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_total",
            breakdown_value="all",
        )

        # Emma appears once
        assert len(result) == 1
        assert result[0].person_id == 101

        # sessions field should contain both waitlisted sessions
        assert len(result[0].sessions) == 2
        session_ids = {s.session_cm_id for s in result[0].sessions}
        assert session_ids == {1001, 1002}


class TestWaitlistDrilldownEnrolledSessions:
    """Tests for enrolled_sessions field on waitlist drilldown results.

    All waitlist breakdown types should populate enrolled_sessions to show
    which sessions the waitlisted person is enrolled in.
    """

    @pytest.fixture
    def waitlist_sessions(self) -> dict[int, Mock]:
        """Sessions for enrolled_sessions tests."""
        return {
            1001: create_mock_session(1001, "Session 1", 2026, "main", "2026-06-15", "2026-07-05"),
            1002: create_mock_session(1002, "Session 2", 2026, "main", "2026-07-06", "2026-07-26"),
            1003: create_mock_session(1003, "Session 2a", 2026, "embedded", "2026-07-06", "2026-07-19"),
        }

    @pytest.fixture
    def waitlist_persons(self) -> dict[int, Mock]:
        """Persons for enrolled_sessions tests."""
        return {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=1),
            102: create_mock_person(102, "Liam", "Garcia", "M", 6, years_at_camp=2),
            103: create_mock_person(103, "Olivia", "Chen", "F", 7, years_at_camp=1),
            104: create_mock_person(104, "Noah", "Williams", "M", 8, years_at_camp=3),
        }

    @pytest.mark.asyncio
    async def test_waitlist_total_populates_enrolled_sessions(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """waitlist_total should populate enrolled_sessions for UC2 persons."""
        session1 = waitlist_sessions[1001]
        session2 = waitlist_sessions[1002]

        # Liam waitlisted for S1, enrolled in S2
        waitlisted = [
            create_mock_attendee(102, session1, 2026, status="waitlisted"),
        ]
        enrolled = [
            create_mock_attendee(102, session2, 2026, status="enrolled"),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted if status_filter == ["waitlisted"] else enrolled if status_filter == ["enrolled"] else []
            )
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_total",
            breakdown_value="all",
        )

        assert len(result) == 1
        liam = result[0]
        assert liam.person_id == 102
        assert len(liam.enrolled_sessions) == 1
        assert liam.enrolled_sessions[0].session_cm_id == 1002
        assert liam.enrolled_sessions[0].session_name == "Session 2"

    @pytest.mark.asyncio
    async def test_waitlist_no_enrollment_has_empty_enrolled_sessions(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """waitlist_no_enrollment persons should have empty enrolled_sessions."""
        session1 = waitlist_sessions[1001]

        waitlisted = [
            create_mock_attendee(101, session1, 2026, status="waitlisted"),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (waitlisted if status_filter == ["waitlisted"] else [])
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_no_enrollment",
            breakdown_value="true",
        )

        assert len(result) == 1
        assert result[0].enrolled_sessions == []

    @pytest.mark.asyncio
    async def test_waitlist_has_enrollment_populates_enrolled_sessions(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """waitlist_has_enrollment persons should have their enrolled sessions listed."""
        session1 = waitlist_sessions[1001]
        session2 = waitlist_sessions[1002]
        session2a = waitlist_sessions[1003]

        # Liam waitlisted for S1, enrolled in S2 and S2a
        waitlisted = [
            create_mock_attendee(102, session1, 2026, status="waitlisted"),
        ]
        enrolled = [
            create_mock_attendee(102, session2, 2026, status="enrolled"),
            create_mock_attendee(102, session2a, 2026, status="enrolled"),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted if status_filter == ["waitlisted"] else enrolled if status_filter == ["enrolled"] else []
            )
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_has_enrollment",
            breakdown_value="true",
        )

        assert len(result) == 1
        liam = result[0]
        assert liam.person_id == 102
        assert len(liam.enrolled_sessions) == 2
        enrolled_ids = {s.session_cm_id for s in liam.enrolled_sessions}
        assert enrolled_ids == {1002, 1003}

    @pytest.mark.asyncio
    async def test_waitlist_accepted_populates_enrolled_sessions(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """waitlist_accepted should populate enrolled_sessions from current enrollments."""
        session1 = waitlist_sessions[1001]
        session2 = waitlist_sessions[1002]

        history = [
            create_mock_status_history(
                104, session1, waitlist_persons[104], old_status="waitlisted", new_status="enrolled"
            ),
        ]
        # Noah is now enrolled in S1 and S2
        enrolled = [
            create_mock_attendee(104, session1, 2026, status="enrolled"),
            create_mock_attendee(104, session2, 2026, status="enrolled"),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_status_history = AsyncMock(return_value=history)
        mock_repository.fetch_attendees = AsyncMock(return_value=enrolled)

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_accepted",
            breakdown_value="true",
        )

        assert len(result) == 1
        noah = result[0]
        assert noah.person_id == 104
        assert len(noah.enrolled_sessions) == 2
        enrolled_ids = {s.session_cm_id for s in noah.enrolled_sessions}
        assert enrolled_ids == {1001, 1002}

    @pytest.mark.asyncio
    async def test_waitlist_declined_has_empty_enrolled_sessions(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """waitlist_declined persons (not enrolled) should have empty enrolled_sessions."""
        session1 = waitlist_sessions[1001]

        history = [
            create_mock_status_history(
                103, session1, waitlist_persons[103], old_status="waitlisted", new_status="cancelled"
            ),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_status_history = AsyncMock(return_value=history)
        mock_repository.fetch_attendees = AsyncMock(return_value=[])

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_declined",
            breakdown_value="true",
        )

        assert len(result) == 1
        assert result[0].enrolled_sessions == []


# ============================================================================
# Bug 4: Session drilldown only shows clicked session in "Waitlisted For"
# ============================================================================


class TestWaitlistDrilldownFullSessionsList:
    """Bug: When drilling down on a specific session, the "Waitlisted For"
    column only shows that session. It should show ALL sessions the person
    is waitlisted for.

    Root cause: waitlisted_groups is built from filtered attendees (after
    _filter_by_session), so only the clicked session's records appear.
    Fix: Build waitlisted_groups from ALL waitlisted attendees before filtering.
    """

    @pytest.fixture
    def waitlist_sessions(self) -> dict[int, Mock]:
        """Sessions for multi-session waitlist tests."""
        return {
            1001: create_mock_session(1001, "Session 1", 2026, "main", "2026-06-15", "2026-07-05"),
            1002: create_mock_session(1002, "Session 2", 2026, "main", "2026-07-06", "2026-07-26"),
            1003: create_mock_session(1003, "Session 2a", 2026, "embedded", "2026-07-06", "2026-07-19"),
        }

    @pytest.fixture
    def waitlist_persons(self) -> dict[int, Mock]:
        """Persons for multi-session waitlist tests."""
        return {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=1),
            102: create_mock_person(102, "Liam", "Garcia", "M", 6, years_at_camp=2),
        }

    @pytest.mark.asyncio
    async def test_session_filtered_drilldown_shows_all_waitlisted_sessions(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """Person waitlisted in S1 and S2, drilldown on S1 -> sessions shows both S1 and S2."""
        session1 = waitlist_sessions[1001]
        session2 = waitlist_sessions[1002]

        # Emma waitlisted in BOTH Session 1 and Session 2
        waitlisted = [
            create_mock_attendee(101, session1, 2026, status="waitlisted"),
            create_mock_attendee(101, session2, 2026, status="waitlisted"),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (waitlisted if status_filter == ["waitlisted"] else [])
        )

        # Drilldown filtered to Session 1 bar click
        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_total",
            breakdown_value="1001",
        )

        # Emma should appear in results (she IS waitlisted for S1)
        assert len(result) == 1
        assert result[0].person_id == 101

        # But her sessions list should show ALL waitlisted sessions, not just S1
        assert len(result[0].sessions) == 2
        session_ids = {s.session_cm_id for s in result[0].sessions}
        assert session_ids == {1001, 1002}

    @pytest.mark.asyncio
    async def test_session_filtered_drilldown_no_enrollment(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """waitlist_no_enrollment with session filter shows all waitlisted sessions per person."""
        session1 = waitlist_sessions[1001]
        session2 = waitlist_sessions[1002]

        # Emma waitlisted in S1 and S2, not enrolled anywhere
        waitlisted = [
            create_mock_attendee(101, session1, 2026, status="waitlisted"),
            create_mock_attendee(101, session2, 2026, status="waitlisted"),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (waitlisted if status_filter == ["waitlisted"] else [])
        )

        # Drilldown on waitlist_no_enrollment filtered to Session 1
        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_no_enrollment",
            breakdown_value="true",
            session_cm_id=1001,
        )

        assert len(result) == 1
        assert result[0].person_id == 101

        # Sessions should show all waitlisted sessions, not just S1
        assert len(result[0].sessions) == 2
        session_ids = {s.session_cm_id for s in result[0].sessions}
        assert session_ids == {1001, 1002}


# ============================================================================
# Tests for person-level breakdowns with waitlisted status filter
# ============================================================================


class TestWaitlistPersonBreakdowns:
    """Tests for person-level breakdowns (grade, gender, etc.) with status_filter=waitlisted.

    Bug: When drilling down on a grade bar in the waitlist tab, the generic
    drilldown path runs: it fetches only waitlisted attendees, applies session
    filter, then builds person_attendee_groups from the *already-filtered* set.
    This means "Waitlisted For" only shows the filtered session and "Enrolled In"
    is always empty.

    Fix: A new _handle_waitlist_person_breakdown method should:
    1. Build all_waitlisted_groups BEFORE session filtering (like waitlist_total does)
    2. Also fetch enrolled attendees and build enrolled_attendee_groups
    3. Pass both to _build_response
    """

    @pytest.fixture
    def waitlist_sessions(self) -> dict[int, Mock]:
        """Sessions for waitlist person breakdown tests."""
        return {
            1001: create_mock_session(1001, "Session 1", 2026, "main", "2026-06-15", "2026-07-05"),
            1002: create_mock_session(1002, "Session 2", 2026, "main", "2026-07-06", "2026-07-26"),
            1003: create_mock_session(1003, "Session 2a", 2026, "embedded", "2026-07-06", "2026-07-19"),
        }

    @pytest.fixture
    def waitlist_persons(self) -> dict[int, Mock]:
        """Persons for waitlist person breakdown tests."""
        return {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=1),
            102: create_mock_person(102, "Liam", "Garcia", "M", 6, years_at_camp=2),
            103: create_mock_person(103, "Olivia", "Chen", "F", 5, years_at_camp=1),
            104: create_mock_person(104, "Noah", "Williams", "M", 7, years_at_camp=3),
        }

    @pytest.mark.asyncio
    async def test_grade_drilldown_waitlisted_shows_all_sessions(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """Person waitlisted in S1+S2, filter on S1, grade drilldown -> sessions shows both."""
        session1 = waitlist_sessions[1001]
        session2 = waitlist_sessions[1002]

        # Emma (grade 5) waitlisted in BOTH Session 1 and Session 2
        waitlisted = [
            create_mock_attendee(101, session1, 2026, status="waitlisted"),
            create_mock_attendee(101, session2, 2026, status="waitlisted"),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (waitlisted if status_filter == ["waitlisted"] else [])
        )

        # Grade drilldown for grade=5, filtered to Session 1, waitlisted status
        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="grade",
            breakdown_value="5",
            session_cm_id=1001,
            status_filter=["waitlisted"],
        )

        # Emma should appear (she's grade 5 and waitlisted in S1)
        assert len(result) == 1
        assert result[0].person_id == 101

        # Sessions should show ALL waitlisted sessions, not just S1
        assert len(result[0].sessions) == 2
        session_ids = {s.session_cm_id for s in result[0].sessions}
        assert session_ids == {1001, 1002}

    @pytest.mark.asyncio
    async def test_grade_drilldown_waitlisted_shows_enrolled_sessions(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """Person waitlisted in S1, enrolled in S2 -> enrolled_sessions shows S2."""
        session1 = waitlist_sessions[1001]
        session2 = waitlist_sessions[1002]

        # Emma (grade 5) waitlisted in S1, enrolled in S2
        waitlisted = [
            create_mock_attendee(101, session1, 2026, status="waitlisted"),
        ]
        enrolled = [
            create_mock_attendee(101, session2, 2026, status="enrolled"),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                waitlisted if status_filter == ["waitlisted"] else enrolled if status_filter == ["enrolled"] else []
            )
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="grade",
            breakdown_value="5",
            status_filter=["waitlisted"],
        )

        # Emma should appear
        assert len(result) == 1
        assert result[0].person_id == 101

        # enrolled_sessions should show Session 2
        assert len(result[0].enrolled_sessions) == 1
        assert result[0].enrolled_sessions[0].session_cm_id == 1002

    @pytest.mark.asyncio
    async def test_grade_drilldown_waitlisted_filters_by_grade_value(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """Only matching grade persons appear in grade drilldown."""
        session1 = waitlist_sessions[1001]

        # Emma (grade 5) and Liam (grade 6) both waitlisted in S1
        waitlisted = [
            create_mock_attendee(101, session1, 2026, status="waitlisted"),
            create_mock_attendee(102, session1, 2026, status="waitlisted"),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: (waitlisted if status_filter == ["waitlisted"] else [])
        )

        # Drilldown on grade=5 with waitlisted filter
        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="grade",
            breakdown_value="5",
            status_filter=["waitlisted"],
        )

        # Only Emma (grade 5) should appear, not Liam (grade 6)
        assert len(result) == 1
        assert result[0].person_id == 101

    @pytest.mark.asyncio
    async def test_grade_drilldown_enrolled_uses_generic_path(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        waitlist_sessions: dict[int, Mock],
        waitlist_persons: dict[int, Mock],
    ) -> None:
        """status_filter=enrolled still uses generic path (no regression)."""
        session1 = waitlist_sessions[1001]

        # Emma (grade 5) enrolled in S1
        enrolled = [
            create_mock_attendee(101, session1, 2026, status="enrolled"),
        ]

        mock_repository.fetch_sessions.return_value = waitlist_sessions
        mock_repository.fetch_persons.return_value = waitlist_persons
        mock_repository.fetch_attendees.return_value = enrolled

        # Standard enrolled grade drilldown should still work
        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="grade",
            breakdown_value="5",
            status_filter=["enrolled"],
        )

        assert len(result) == 1
        assert result[0].person_id == 101


# ============================================================================
# Tests for summer_years breakdown type
# ============================================================================


class TestSummerYearsBreakdown:
    """Tests for filtering by summer_years (computed from enrollment history)."""

    @pytest.mark.asyncio
    async def test_filter_by_summer_years(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Filter for campers with a specific number of summers."""
        attendees_2026 = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
            create_mock_attendee(102, sample_sessions[1002], 2026),
            create_mock_attendee(103, sample_sessions[1003], 2026),
        ]

        history_sessions = {
            901: create_mock_session(901, "Session 2", 2024, "main", "2024-06-15", "2024-07-05"),
            902: create_mock_session(902, "Session 3", 2025, "main", "2025-06-15", "2025-07-05"),
        }

        # Emma (101): 1 summer (2026 only)
        # Liam (102): 2 summers (2025, 2026)
        # Olivia (103): 3 summers (2024, 2025, 2026)
        enrollment_history = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
            create_mock_attendee(102, sample_sessions[1002], 2026),
            create_mock_attendee(103, sample_sessions[1003], 2026),
            create_mock_attendee(102, history_sessions[902], 2025),
            create_mock_attendee(103, history_sessions[902], 2025),
            create_mock_attendee(103, history_sessions[901], 2024),
        ]

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = attendees_2026
        mock_repository.fetch_summer_enrollment_history.return_value = enrollment_history

        # Filter for campers with 2 summers
        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="summer_years",
            breakdown_value="2",
        )

        # Should return only Liam (102) who has 2 summers
        assert len(result) == 1
        assert result[0].person_id == 102

    @pytest.mark.asyncio
    async def test_filter_by_summer_years_one_summer(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Filter for campers with exactly 1 summer (first-timers)."""
        attendees_2026 = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
            create_mock_attendee(102, sample_sessions[1002], 2026),
        ]

        # Only 2026 enrollment for both campers
        enrollment_history = [
            create_mock_attendee(101, sample_sessions[1001], 2026),
            create_mock_attendee(102, sample_sessions[1002], 2026),
        ]

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = attendees_2026
        mock_repository.fetch_summer_enrollment_history.return_value = enrollment_history

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="summer_years",
            breakdown_value="1",
        )

        # Both Emma and Liam only have 1 summer in history
        assert len(result) == 2
        person_ids = {r.person_id for r in result}
        assert person_ids == {101, 102}

    @pytest.mark.asyncio
    async def test_filter_by_summer_years_is_person_level(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """summer_years is a person-level breakdown, so multi-session campers are deduped."""
        # Olivia in two sessions in 2026
        attendees_2026 = [
            create_mock_attendee(103, sample_sessions[1001], 2026),
            create_mock_attendee(103, sample_sessions[1003], 2026),
        ]

        enrollment_history = [
            create_mock_attendee(103, sample_sessions[1001], 2026),
            create_mock_attendee(103, sample_sessions[1003], 2026),
        ]

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = attendees_2026
        mock_repository.fetch_summer_enrollment_history.return_value = enrollment_history

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="summer_years",
            breakdown_value="1",
        )

        # Olivia should appear only once despite two attendee records
        assert len(result) == 1
        assert result[0].person_id == 103
        # Multi-session should show in sessions list
        assert len(result[0].sessions) == 2

    @pytest.mark.asyncio
    async def test_filter_by_summer_years_no_match(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """Filter for a number of summers with no matching campers returns empty."""
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

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="summer_years",
            breakdown_value="10",
        )

        assert len(result) == 0


# ============================================================================
# Tests for retention_session breakdown type
# ============================================================================


class TestRetentionSessionBreakdown:
    """Tests for retention_session breakdown.

    Filters base year campers who returned to a specific compare year session.
    """

    @pytest.fixture
    def compare_year_sessions(self) -> dict[int, Mock]:
        """Sessions for 2026 (compare year)."""
        return {
            2001: create_mock_session(2001, "Session 1", 2026, "main", "2026-06-15", "2026-07-05"),
            2002: create_mock_session(2002, "Session 2", 2026, "main", "2026-07-06", "2026-07-26"),
            2003: create_mock_session(2003, "AG Session 1", 2026, "ag", "2026-06-15", "2026-07-05", parent_id=2001),
        }

    @pytest.fixture
    def base_year_sessions(self) -> dict[int, Mock]:
        """Sessions for 2025 (base year)."""
        return {
            1001: create_mock_session(1001, "Session 1", 2025, "main", "2025-06-15", "2025-07-05"),
            1002: create_mock_session(1002, "Session 2", 2025, "main", "2025-07-06", "2025-07-26"),
        }

    @pytest.mark.asyncio
    async def test_retention_session_filters_base_year_campers(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
        compare_year_sessions: dict[int, Mock],
    ) -> None:
        """retention_session returns base year attendees who returned to a specific compare year session."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=2),
            102: create_mock_person(102, "Liam", "Garcia", "M", 6, years_at_camp=3),
            103: create_mock_person(103, "Olivia", "Chen", "F", 6, years_at_camp=1),
        }

        base_attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
            create_mock_attendee(102, base_year_sessions[1002], 2025),
            create_mock_attendee(103, base_year_sessions[1001], 2025),
        ]

        # Emma and Liam returned, Olivia did not
        compare_attendees = [
            create_mock_attendee(101, compare_year_sessions[2001], 2026),
            create_mock_attendee(102, compare_year_sessions[2002], 2026),
        ]

        mock_repository.fetch_sessions.return_value = base_year_sessions
        mock_repository.fetch_persons.return_value = persons

        async def fetch_attendees_side_effect(year: int, status_filter: list[str] | None = None) -> list[Mock]:
            if year == 2025:
                return base_attendees
            if year == 2026:
                return compare_attendees
            return []

        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="retention_session",
            breakdown_value="2001",
            compare_year=2026,
        )

        # Only Emma returned to Session 1 in 2026
        assert len(result) == 1
        assert result[0].person_id == 101

    @pytest.mark.asyncio
    async def test_retention_session_no_returnees(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
    ) -> None:
        """retention_session returns empty when no base year campers returned to that session."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=1),
        }

        base_attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
        ]

        async def fetch_attendees_side_effect(year: int, status_filter: list[str] | None = None) -> list[Mock]:
            if year == 2025:
                return base_attendees
            return []

        mock_repository.fetch_sessions.return_value = base_year_sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="retention_session",
            breakdown_value="2001",
            compare_year=2026,
        )

        assert len(result) == 0

    @pytest.mark.asyncio
    async def test_retention_session_multiple_returnees(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
        compare_year_sessions: dict[int, Mock],
    ) -> None:
        """retention_session returns all base year campers who returned to the target session."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=2),
            102: create_mock_person(102, "Liam", "Garcia", "M", 6, years_at_camp=3),
            103: create_mock_person(103, "Olivia", "Chen", "F", 6, years_at_camp=2),
        }

        base_attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
            create_mock_attendee(102, base_year_sessions[1002], 2025),
            create_mock_attendee(103, base_year_sessions[1001], 2025),
        ]

        # Emma and Olivia returned to Session 2 in 2026
        compare_attendees = [
            create_mock_attendee(101, compare_year_sessions[2002], 2026),
            create_mock_attendee(103, compare_year_sessions[2002], 2026),
        ]

        async def fetch_attendees_side_effect(year: int, status_filter: list[str] | None = None) -> list[Mock]:
            if year == 2025:
                return base_attendees
            if year == 2026:
                return compare_attendees
            return []

        mock_repository.fetch_sessions.return_value = base_year_sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="retention_session",
            breakdown_value="2002",
            compare_year=2026,
        )

        assert len(result) == 2
        person_ids = {r.person_id for r in result}
        assert person_ids == {101, 103}


# ============================================================================
# Tests for compare_year affecting is_returning
# ============================================================================


class TestCompareYearIsReturning:
    """Tests for compare_year parameter changing is_returning logic.

    When compare_year is set, is_returning should be based on whether the person
    actually returned to the compare year (not just years_at_camp > 1).
    """

    @pytest.mark.asyncio
    async def test_compare_year_sets_is_returning_true_for_returnees(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
    ) -> None:
        """With compare_year, campers who returned should have is_returning=True."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=2),
            102: create_mock_person(102, "Liam", "Garcia", "M", 6, years_at_camp=3),
        }

        base_attendees = [
            create_mock_attendee(101, sample_sessions[1001], 2025),
            create_mock_attendee(102, sample_sessions[1002], 2025),
        ]

        compare_sessions = {
            2001: create_mock_session(2001, "Session 1", 2026, "main"),
        }
        compare_attendees = [
            create_mock_attendee(101, compare_sessions[2001], 2026),
            # Liam did NOT return
        ]

        async def fetch_attendees_side_effect(year: int, status_filter: list[str] | None = None) -> list[Mock]:
            if year == 2025:
                return base_attendees
            if year == 2026:
                return compare_attendees
            return []

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="gender",
            breakdown_value="F",
            compare_year=2026,
        )

        # Emma is female and returned -> is_returning=True
        assert len(result) == 1
        assert result[0].person_id == 101
        assert result[0].is_returning is True

    @pytest.mark.asyncio
    async def test_compare_year_sets_is_returning_false_for_non_returnees(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
    ) -> None:
        """With compare_year, non-returnees have is_returning=False even with years_at_camp > 1."""
        persons = {
            # Liam has years_at_camp=3 (would be is_returning=True without compare_year)
            102: create_mock_person(102, "Liam", "Garcia", "M", 6, years_at_camp=3),
        }

        base_attendees = [
            create_mock_attendee(102, sample_sessions[1002], 2025),
        ]

        async def fetch_attendees_side_effect(year: int, status_filter: list[str] | None = None) -> list[Mock]:
            if year == 2025:
                return base_attendees
            return []  # Liam did not return

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="gender",
            breakdown_value="M",
            compare_year=2026,
        )

        # Liam is male but did NOT return -> is_returning=False despite years_at_camp=3
        assert len(result) == 1
        assert result[0].person_id == 102
        assert result[0].is_returning is False

    @pytest.mark.asyncio
    async def test_without_compare_year_uses_years_at_camp(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
        sample_attendees: list[Mock],
    ) -> None:
        """Without compare_year, is_returning is based on years_at_camp > 1 (default)."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = sample_attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="gender",
            breakdown_value="M",
            # No compare_year
        )

        # Liam (102): years_at_camp=1 -> is_returning=False
        # Noah (104): years_at_camp=3 -> is_returning=True
        result_map = {r.person_id: r.is_returning for r in result}
        assert result_map[102] is False
        assert result_map[104] is True
