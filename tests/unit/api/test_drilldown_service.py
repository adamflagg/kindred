"""
Unit tests for the drilldown service.

These tests verify drilldown filtering logic for new breakdown types:
- returning_status (new/returning based on years_at_camp)
- session_length (based on session date calculations)
- first_summer_year (based on enrollment history)
"""

from unittest.mock import AsyncMock, Mock

import pytest

from api.services.drilldown_service import DrilldownService
from tests.unit.api.conftest import (
    create_mock_attendee as create_mock_attendee_with_person,
)
from tests.unit.api.conftest import (
    create_mock_person,
    create_mock_session,
    create_mock_status_history,
)

# ============================================================================
# Test Data Factories
# ============================================================================


def create_mock_attendee(
    person_id: int,
    session: Mock,
    year: int,
    status: str = "enrolled",
    status_id: int = 2,
) -> Mock:
    """Create a mock attendee record with embedded session."""
    attendee = Mock()
    attendee.person_id = person_id
    attendee.year = year
    attendee.status = status
    attendee.status_id = status_id
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
    @pytest.mark.parametrize(
        ("breakdown_value", "expected_person_ids"),
        [
            ("new", {101, 102}),
            ("returning", {103, 104, 105}),
        ],
    )
    async def test_filter_by_returning_status(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
        sample_attendees: list[Mock],
        breakdown_value: str,
        expected_person_ids: set[int],
    ) -> None:
        """Filter by returning_status returns correct campers."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = sample_attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="returning_status",
            breakdown_value=breakdown_value,
        )

        person_ids = {r.person_id for r in result}
        assert person_ids == expected_person_ids


# ============================================================================
# Tests for session_length breakdown type
# ============================================================================


class TestSessionLengthBreakdown:
    """Tests for filtering by session_length."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("breakdown_value", "expected_person_ids"),
        [
            ("1-week", {101}),
            ("2-week", {102}),
            ("3-week", {103, 105}),
            ("4-week+", {104}),
        ],
    )
    async def test_filter_by_session_length(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
        sample_attendees: list[Mock],
        breakdown_value: str,
        expected_person_ids: set[int],
    ) -> None:
        """Filter by session_length returns correct campers."""
        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = sample_attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="session_length",
            breakdown_value=breakdown_value,
        )

        person_ids = {r.person_id for r in result}
        assert person_ids == expected_person_ids

    @pytest.mark.asyncio
    async def test_filter_by_session_length_resolves_ag_to_parent(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
    ) -> None:
        """AG session attendees should use parent session dates for length classification.

        An AG session might have different dates than its parent, but the length
        category should be based on the parent session's dates.
        """
        # Parent is 3-week (June 15 - July 5 = 20 days)
        parent_session = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        # AG session has same dates as parent but that's not always the case
        ag_session = create_mock_session(2005, "AG Session 2", 2026, "ag", "2026-06-15", "2026-07-05", parent_id=2001)

        sessions = {2001: parent_session, 2005: ag_session}
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=2),
        }
        attendees = [
            create_mock_attendee(101, ag_session, 2026),  # Emma in AG session
        ]

        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="session_length",
            breakdown_value="3-week",
        )

        # Emma's AG session should resolve to parent (3-week), so she should appear
        assert len(result) == 1
        assert result[0].person_id == 101

    @pytest.mark.asyncio
    async def test_filter_by_session_length_ag_with_different_dates(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
    ) -> None:
        """AG session with dates that differ from parent should still use parent's length.

        Even if the AG session dates would classify as a different length category,
        the parent session's dates determine the category.
        """
        # Parent is 3-week (June 15 - July 5 = 20 days)
        parent_session = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        # AG session has shorter dates (would be 2-week if classified independently)
        ag_session = create_mock_session(2005, "AG Session 2", 2026, "ag", "2026-06-15", "2026-06-28", parent_id=2001)

        sessions = {2001: parent_session, 2005: ag_session}
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=2),
        }
        attendees = [
            create_mock_attendee(101, ag_session, 2026),  # Emma in AG (dates say 2-week)
        ]

        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.return_value = attendees

        # Should NOT match 2-week (even though AG dates say 2-week)
        result_2week = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="session_length",
            breakdown_value="2-week",
        )
        assert len(result_2week) == 0

        # Should match 3-week (parent's length)
        result_3week = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="session_length",
            breakdown_value="3-week",
        )
        assert len(result_3week) == 1
        assert result_3week[0].person_id == 101


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
    @pytest.mark.parametrize(
        ("breakdown_value", "expected_person_ids"),
        [
            ("San Francisco", {101, 102}),
            ("Oakland", {103, 105}),
            ("Los Angeles", set()),
        ],
    )
    async def test_filter_by_city(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        persons_with_cities: dict[int, Mock],
        breakdown_value: str,
        expected_person_ids: set[int],
    ) -> None:
        """Filter by city using normalized_city returns correct campers."""
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
            breakdown_value=breakdown_value,
        )

        person_ids = {r.person_id for r in result}
        assert person_ids == expected_person_ids

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
    @pytest.mark.parametrize(
        ("breakdown_value", "expected_person_ids"),
        [
            ("Congregation Beth Israel", {101, 102, 104}),
            ("Temple Sinai", {103, 105}),
        ],
    )
    async def test_filter_by_synagogue(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        persons_with_congregations: dict[int, Mock],
        breakdown_value: str,
        expected_person_ids: set[int],
    ) -> None:
        """Filter by synagogue returns correct campers."""
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
            breakdown_value=breakdown_value,
        )

        person_ids = {r.person_id for r in result}
        assert person_ids == expected_person_ids

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
    @pytest.mark.parametrize(
        ("breakdown_value", "expected_person_ids"),
        [
            ("Park Day School", {101, 102}),
            ("Mark Day School", {103}),
        ],
    )
    async def test_school_drilldown_normalized(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        persons_with_schools: dict[int, Mock],
        breakdown_value: str,
        expected_person_ids: set[int],
    ) -> None:
        """School drilldown matches on normalized_school, not raw person.school."""
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
            breakdown_value=breakdown_value,
        )

        person_ids = {r.person_id for r in result}
        assert person_ids == expected_person_ids

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
    @pytest.mark.parametrize(
        ("school", "normalized_school", "expected_school"),
        [
            ("park day", "Park Day School", "Park Day School"),
            ("Hillcrest High", None, "Hillcrest High"),
        ],
    )
    async def test_response_school_display(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        school: str,
        normalized_school: str | None,
        expected_school: str,
    ) -> None:
        """DrilldownAttendee.school prefers normalized_school, falls back to raw."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, school=school, normalized_school=normalized_school),
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
        assert result[0].school == expected_school

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("address_city", "normalized_city", "expected_city"),
        [
            ("san francisco", "San Francisco", "San Francisco"),
            ("Springfield", None, "Springfield"),
        ],
    )
    async def test_response_city_display(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        address_city: str,
        normalized_city: str | None,
        expected_city: str,
    ) -> None:
        """DrilldownAttendee.city prefers normalized_city, falls back to raw."""
        persons = {
            101: create_mock_person(
                101, "Emma", "Johnson", "F", 5, address_city=address_city, normalized_city=normalized_city
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
        assert result[0].city == expected_city


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
    @pytest.mark.parametrize(
        ("breakdown_type", "breakdown_value", "expected_person_ids", "check_multi_sessions"),
        [
            ("gender", "F", {101}, True),
            ("grade", "5", {101}, False),
            ("status", "enrolled", {101, 102}, False),
            ("session_length", "2-week", {101}, True),
        ],
    )
    async def test_person_level_dedup(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        multi_session_sessions: dict[int, Mock],
        multi_session_persons: dict[int, Mock],
        multi_session_attendees: list[Mock],
        breakdown_type: str,
        breakdown_value: str,
        expected_person_ids: set[int],
        check_multi_sessions: bool,
    ) -> None:
        """Person-level breakdowns deduplicate: one result per person with sessions list."""
        mock_repository.fetch_sessions.return_value = multi_session_sessions
        mock_repository.fetch_persons.return_value = multi_session_persons
        mock_repository.fetch_attendees.return_value = multi_session_attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type=breakdown_type,
            breakdown_value=breakdown_value,
        )

        person_ids = {r.person_id for r in result}
        assert person_ids == expected_person_ids

        if check_multi_sessions:
            emma = next(r for r in result if r.person_id == 101)
            assert len(emma.sessions) == 2
            session_names = {s.session_name for s in emma.sessions}
            assert session_names == {"Session 2a", "Session 3a"}

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
            side_effect=lambda year, status_filter=None: waitlisted if status_filter == ["waitlisted"] else []
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
            side_effect=lambda year, status_filter=None: waitlisted if status_filter == ["waitlisted"] else []
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
            side_effect=lambda year, status_filter=None: waitlisted if status_filter == ["waitlisted"] else []
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
            side_effect=lambda year, status_filter=None: waitlisted if status_filter == ["waitlisted"] else []
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
            side_effect=lambda year, status_filter=None: waitlisted if status_filter == ["waitlisted"] else []
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
            side_effect=lambda year, status_filter=None: waitlisted if status_filter == ["waitlisted"] else []
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
            side_effect=lambda year, status_filter=None: waitlisted if status_filter == ["waitlisted"] else []
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
            side_effect=lambda year, status_filter=None: waitlisted if status_filter == ["waitlisted"] else []
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


# ============================================================================
# Tests for retention card drilldown (retention_all, retention_returned, retention_not_returned)
# ============================================================================


class TestRetentionCardBreakdown:
    """Tests for top-card retention drilldowns.

    Three card types:
    - retention_all: All base year campers
    - retention_returned: Only campers who returned to compare year
    - retention_not_returned: Only campers who did NOT return to compare year
    """

    @pytest.fixture
    def base_year_sessions(self) -> dict[int, Mock]:
        """Sessions for 2025 (base year)."""
        return {
            1001: create_mock_session(1001, "Session 1", 2025, "main", "2025-06-15", "2025-07-05"),
            1002: create_mock_session(1002, "Session 2", 2025, "main", "2025-07-06", "2025-07-26"),
        }

    @pytest.fixture
    def compare_year_sessions(self) -> dict[int, Mock]:
        """Sessions for 2026 (compare year)."""
        return {
            2001: create_mock_session(2001, "Session 1", 2026, "main", "2026-06-15", "2026-07-05"),
            2002: create_mock_session(2002, "Session 2", 2026, "main", "2026-07-06", "2026-07-26"),
        }

    @pytest.fixture
    def retention_persons(self) -> dict[int, Mock]:
        """Persons for retention card tests."""
        return {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=2),
            102: create_mock_person(102, "Liam", "Garcia", "M", 6, years_at_camp=3),
            103: create_mock_person(103, "Olivia", "Chen", "F", 6, years_at_camp=2),
            104: create_mock_person(104, "Noah", "Williams", "M", 7, years_at_camp=1),
        }

    def _setup_retention_mocks(
        self,
        mock_repository: Mock,
        base_sessions: dict[int, Mock],
        compare_sessions: dict[int, Mock],
        persons: dict[int, Mock],
        base_attendees: list[Mock],
        compare_attendees: list[Mock],
    ) -> None:
        """Set up mocks for retention card tests."""
        mock_repository.fetch_sessions.return_value = base_sessions
        mock_repository.fetch_persons.return_value = persons

        async def fetch_attendees_side_effect(year: int, status_filter: list[str] | None = None) -> list[Mock]:
            if year == 2025:
                return base_attendees
            if year == 2026:
                return compare_attendees
            return []

        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("breakdown_type", "expected_person_ids", "expected_is_returning"),
        [
            ("retention_all", {101, 102, 103, 104}, None),
            ("retention_returned", {101, 102}, True),
            ("retention_not_returned", {103, 104}, False),
        ],
    )
    async def test_retention_card_filter(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
        compare_year_sessions: dict[int, Mock],
        retention_persons: dict[int, Mock],
        breakdown_type: str,
        expected_person_ids: set[int],
        expected_is_returning: bool | None,
    ) -> None:
        """Retention card breakdowns filter base year campers by return status."""
        base_attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
            create_mock_attendee(102, base_year_sessions[1002], 2025),
            create_mock_attendee(103, base_year_sessions[1001], 2025),
            create_mock_attendee(104, base_year_sessions[1002], 2025),
        ]
        compare_attendees = [
            create_mock_attendee(101, compare_year_sessions[2001], 2026),
            create_mock_attendee(102, compare_year_sessions[2002], 2026),
        ]

        self._setup_retention_mocks(
            mock_repository,
            base_year_sessions,
            compare_year_sessions,
            retention_persons,
            base_attendees,
            compare_attendees,
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type=breakdown_type,
            breakdown_value="all",
            compare_year=2026,
        )

        person_ids = {r.person_id for r in result}
        assert person_ids == expected_person_ids

        if expected_is_returning is not None:
            for r in result:
                assert r.is_returning is expected_is_returning

    @pytest.mark.asyncio
    async def test_retention_all_marks_is_returning_correctly(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
        compare_year_sessions: dict[int, Mock],
        retention_persons: dict[int, Mock],
    ) -> None:
        """retention_all marks is_returning based on compare year enrollment."""
        base_attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
            create_mock_attendee(103, base_year_sessions[1001], 2025),
        ]
        compare_attendees = [
            create_mock_attendee(101, compare_year_sessions[2001], 2026),
            # 103 did not return
        ]

        self._setup_retention_mocks(
            mock_repository,
            base_year_sessions,
            compare_year_sessions,
            retention_persons,
            base_attendees,
            compare_attendees,
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="retention_all",
            breakdown_value="all",
            compare_year=2026,
        )

        result_map = {r.person_id: r.is_returning for r in result}
        assert result_map[101] is True
        assert result_map[103] is False

    @pytest.mark.asyncio
    async def test_retention_all_populates_enrolled_sessions(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
        compare_year_sessions: dict[int, Mock],
        retention_persons: dict[int, Mock],
    ) -> None:
        """retention_all populates enrolled_sessions with compare year sessions."""
        base_attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
            create_mock_attendee(103, base_year_sessions[1001], 2025),
        ]
        compare_attendees = [
            create_mock_attendee(101, compare_year_sessions[2001], 2026),
            create_mock_attendee(101, compare_year_sessions[2002], 2026),
            # 103 did not return — no enrolled_sessions
        ]

        self._setup_retention_mocks(
            mock_repository,
            base_year_sessions,
            compare_year_sessions,
            retention_persons,
            base_attendees,
            compare_attendees,
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="retention_all",
            breakdown_value="all",
            compare_year=2026,
        )

        result_map = {r.person_id: r for r in result}
        emma = result_map[101]
        olivia = result_map[103]

        # Emma has 2 compare year sessions
        assert len(emma.enrolled_sessions) == 2
        enrolled_cm_ids = {s.session_cm_id for s in emma.enrolled_sessions}
        assert enrolled_cm_ids == {2001, 2002}

        # Olivia has no compare year sessions
        assert len(olivia.enrolled_sessions) == 0

    @pytest.mark.asyncio
    async def test_retention_returned_populates_enrolled_sessions(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
        compare_year_sessions: dict[int, Mock],
        retention_persons: dict[int, Mock],
    ) -> None:
        """retention_returned includes enrolled_sessions for each returned camper."""
        base_attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
        ]
        compare_attendees = [
            create_mock_attendee(101, compare_year_sessions[2001], 2026),
        ]

        self._setup_retention_mocks(
            mock_repository,
            base_year_sessions,
            compare_year_sessions,
            retention_persons,
            base_attendees,
            compare_attendees,
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="retention_returned",
            breakdown_value="all",
            compare_year=2026,
        )

        assert len(result) == 1
        assert result[0].enrolled_sessions[0].session_name == "Session 1"

    @pytest.mark.asyncio
    async def test_retention_all_deduplicates_multi_session_base(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
        compare_year_sessions: dict[int, Mock],
        retention_persons: dict[int, Mock],
    ) -> None:
        """retention_all deduplicates a camper enrolled in multiple base year sessions."""
        base_attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
            create_mock_attendee(101, base_year_sessions[1002], 2025),  # Emma in 2 sessions
        ]
        compare_attendees = [
            create_mock_attendee(101, compare_year_sessions[2001], 2026),
        ]

        self._setup_retention_mocks(
            mock_repository,
            base_year_sessions,
            compare_year_sessions,
            retention_persons,
            base_attendees,
            compare_attendees,
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="retention_all",
            breakdown_value="all",
            compare_year=2026,
        )

        # Should be deduped to 1 record but sessions list shows both
        assert len(result) == 1
        assert result[0].person_id == 101
        assert len(result[0].sessions) == 2


# ============================================================================
# Tests for enrolled_sessions in generic retention path
# ============================================================================


class TestRetentionEnrolledSessions:
    """Tests that enrolled_sessions is populated for generic retention drilldowns.

    When compare_year is set in the generic path (e.g., gender drilldown on retention tab),
    enrolled_sessions should be populated with the compare year sessions for each camper.
    """

    @pytest.fixture
    def base_year_sessions(self) -> dict[int, Mock]:
        return {
            1001: create_mock_session(1001, "Session 1", 2025, "main", "2025-06-15", "2025-07-05"),
        }

    @pytest.fixture
    def compare_year_sessions(self) -> dict[int, Mock]:
        return {
            2001: create_mock_session(2001, "Session 1", 2026, "main", "2026-06-15", "2026-07-05"),
            2002: create_mock_session(2002, "Session 2", 2026, "main", "2026-07-06", "2026-07-26"),
        }

    @pytest.mark.asyncio
    async def test_generic_retention_populates_enrolled_sessions(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
        compare_year_sessions: dict[int, Mock],
    ) -> None:
        """Generic retention drilldown (e.g., gender with compare_year) populates enrolled_sessions."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=2),
        }

        base_attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
        ]

        compare_attendees = [
            create_mock_attendee(101, compare_year_sessions[2001], 2026),
            create_mock_attendee(101, compare_year_sessions[2002], 2026),
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
            breakdown_type="gender",
            breakdown_value="F",
            compare_year=2026,
        )

        assert len(result) == 1
        assert len(result[0].enrolled_sessions) == 2
        enrolled_cm_ids = {s.session_cm_id for s in result[0].enrolled_sessions}
        assert enrolled_cm_ids == {2001, 2002}

    @pytest.mark.asyncio
    async def test_generic_retention_non_returnee_has_empty_enrolled_sessions(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
    ) -> None:
        """Non-returning camper has empty enrolled_sessions in generic retention drilldown."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=2),
        }

        base_attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
        ]

        async def fetch_attendees_side_effect(year: int, status_filter: list[str] | None = None) -> list[Mock]:
            if year == 2025:
                return base_attendees
            return []  # No compare year attendees

        mock_repository.fetch_sessions.return_value = base_year_sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.side_effect = fetch_attendees_side_effect

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="gender",
            breakdown_value="F",
            compare_year=2026,
        )

        assert len(result) == 1
        assert len(result[0].enrolled_sessions) == 0

    @pytest.mark.asyncio
    async def test_retention_session_populates_enrolled_sessions(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
        compare_year_sessions: dict[int, Mock],
    ) -> None:
        """retention_session breakdown populates enrolled_sessions for returned campers."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=2),
        }

        base_attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
        ]

        compare_attendees = [
            create_mock_attendee(101, compare_year_sessions[2001], 2026),
            create_mock_attendee(101, compare_year_sessions[2002], 2026),
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
            breakdown_value="2001",
            compare_year=2026,
        )

        assert len(result) == 1
        # Should have enrolled_sessions from compare year
        assert len(result[0].enrolled_sessions) == 2
        enrolled_cm_ids = {s.session_cm_id for s in result[0].enrolled_sessions}
        assert enrolled_cm_ids == {2001, 2002}


class TestRetentionSessionTypeFiltering:
    """Tests that drilldown columns respect session_types filter in retention mode.

    The session_types parameter controls which sessions appear in both the
    "Prior Session" (person_attendee_groups) and "Session" (enrolled_attendee_groups)
    columns. returned_person_ids is NOT filtered — is_returning reflects any-session return.
    """

    @pytest.fixture
    def base_year_sessions(self) -> dict[int, Mock]:
        return {
            1001: create_mock_session(1001, "Session 1", 2025, "main", "2025-06-15", "2025-07-05"),
            1002: create_mock_session(1002, "Quest Adventure", 2025, "quest", "2025-06-20", "2025-06-25"),
            1003: create_mock_session(1003, "Family Camp", 2025, "family", "2025-08-01", "2025-08-05"),
        }

    @pytest.fixture
    def compare_year_sessions(self) -> dict[int, Mock]:
        return {
            2001: create_mock_session(2001, "Session 1", 2026, "main", "2026-06-15", "2026-07-05"),
            2002: create_mock_session(2002, "At Camp", 2026, "quest", "2026-06-20", "2026-06-25"),
            2003: create_mock_session(2003, "Family Camp", 2026, "family", "2026-08-01", "2026-08-05"),
        }

    @pytest.mark.asyncio
    async def test_enrolled_sessions_excludes_non_summer(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
        compare_year_sessions: dict[int, Mock],
    ) -> None:
        """enrolled_sessions (Session column) should exclude family sessions."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=2),
        }

        base_attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
        ]

        # Emma enrolled in main + quest + family in compare year
        compare_attendees = [
            create_mock_attendee(101, compare_year_sessions[2001], 2026),
            create_mock_attendee(101, compare_year_sessions[2002], 2026),
            create_mock_attendee(101, compare_year_sessions[2003], 2026),
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
            breakdown_type="gender",
            breakdown_value="F",
            session_types=["main", "embedded", "ag", "quest"],
            compare_year=2026,
        )

        assert len(result) == 1
        # main + quest should appear, family excluded
        assert len(result[0].enrolled_sessions) == 2
        enrolled_cm_ids = {s.session_cm_id for s in result[0].enrolled_sessions}
        assert enrolled_cm_ids == {2001, 2002}

    @pytest.mark.asyncio
    async def test_enrolled_sessions_excludes_quest_when_not_in_types(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
        compare_year_sessions: dict[int, Mock],
    ) -> None:
        """enrolled_sessions should exclude quest when session_types is summer-only."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=2),
        }

        base_attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
        ]

        # Emma enrolled in main + quest in compare year
        compare_attendees = [
            create_mock_attendee(101, compare_year_sessions[2001], 2026),
            create_mock_attendee(101, compare_year_sessions[2002], 2026),
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
            breakdown_type="gender",
            breakdown_value="F",
            session_types=["main", "embedded", "ag"],
            compare_year=2026,
        )

        assert len(result) == 1
        # Only main should appear, quest excluded (not in session_types)
        assert len(result[0].enrolled_sessions) == 1
        assert result[0].enrolled_sessions[0].session_cm_id == 2001

    @pytest.mark.asyncio
    async def test_prior_sessions_excludes_non_summer(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
        compare_year_sessions: dict[int, Mock],
    ) -> None:
        """sessions (Prior Session column) should exclude family sessions in retention mode."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=2),
        }

        # Emma enrolled in main + quest + family in base year
        base_attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
            create_mock_attendee(101, base_year_sessions[1002], 2025),
            create_mock_attendee(101, base_year_sessions[1003], 2025),
        ]

        compare_attendees = [
            create_mock_attendee(101, compare_year_sessions[2001], 2026),
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
            breakdown_type="gender",
            breakdown_value="F",
            session_types=["main", "embedded", "ag", "quest"],
            compare_year=2026,
        )

        assert len(result) == 1
        # main + quest should appear in prior sessions, family excluded
        assert len(result[0].sessions) == 2
        session_cm_ids = {s.session_cm_id for s in result[0].sessions}
        assert session_cm_ids == {1001, 1002}

    @pytest.mark.asyncio
    async def test_retention_card_excludes_non_summer_sessions(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
        compare_year_sessions: dict[int, Mock],
    ) -> None:
        """Retention card drilldowns should filter session types in both columns."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=2),
        }

        # Base year: main + quest + family
        base_attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
            create_mock_attendee(101, base_year_sessions[1002], 2025),
            create_mock_attendee(101, base_year_sessions[1003], 2025),
        ]

        # Compare year: main + quest + family
        compare_attendees = [
            create_mock_attendee(101, compare_year_sessions[2001], 2026),
            create_mock_attendee(101, compare_year_sessions[2002], 2026),
            create_mock_attendee(101, compare_year_sessions[2003], 2026),
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
            breakdown_type="retention_all",
            breakdown_value="all",
            session_types=["main", "embedded", "ag", "quest"],
            compare_year=2026,
        )

        assert len(result) == 1
        # Prior sessions: main + quest (family excluded)
        assert len(result[0].sessions) == 2
        prior_cm_ids = {s.session_cm_id for s in result[0].sessions}
        assert prior_cm_ids == {1001, 1002}
        # Enrolled sessions: main + quest (family excluded)
        assert len(result[0].enrolled_sessions) == 2
        enrolled_cm_ids = {s.session_cm_id for s in result[0].enrolled_sessions}
        assert enrolled_cm_ids == {2001, 2002}

    @pytest.mark.asyncio
    async def test_returned_person_ids_not_filtered(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
        compare_year_sessions: dict[int, Mock],
    ) -> None:
        """is_returning should be True even if camper only enrolled in non-matching session types."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=2),
        }

        base_attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
        ]

        # Only enrolled in family camp in compare year
        compare_attendees = [
            create_mock_attendee(101, compare_year_sessions[2003], 2026),
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
            breakdown_type="gender",
            breakdown_value="F",
            session_types=["main", "embedded", "ag", "quest"],
            compare_year=2026,
        )

        assert len(result) == 1
        # Camper IS still returning (returned_person_ids not filtered by session type)
        assert result[0].is_returning is True
        # But enrolled_sessions should be empty since family is filtered out
        assert len(result[0].enrolled_sessions) == 0

    @pytest.mark.asyncio
    async def test_retention_session_filters_both_columns(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
        compare_year_sessions: dict[int, Mock],
    ) -> None:
        """retention_session breakdown should filter both columns by session_types."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=2),
        }

        # Base year: main + family
        base_attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
            create_mock_attendee(101, base_year_sessions[1003], 2025),
        ]

        # Compare year: main + family (Emma returned to session 2001)
        compare_attendees = [
            create_mock_attendee(101, compare_year_sessions[2001], 2026),
            create_mock_attendee(101, compare_year_sessions[2003], 2026),
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
            breakdown_value="2001",
            session_types=["main", "embedded", "ag", "quest"],
            compare_year=2026,
        )

        assert len(result) == 1
        # Prior sessions: only main (family excluded)
        assert len(result[0].sessions) == 1
        assert result[0].sessions[0].session_cm_id == 1001
        # Enrolled sessions: only main (family excluded)
        assert len(result[0].enrolled_sessions) == 1
        assert result[0].enrolled_sessions[0].session_cm_id == 2001

    @pytest.mark.asyncio
    async def test_non_retention_keeps_all_session_types(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        base_year_sessions: dict[int, Mock],
    ) -> None:
        """Non-retention drilldowns (no compare_year) should keep all session types."""
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=2),
        }

        # Enrolled in both main and quest in same year
        attendees = [
            create_mock_attendee(101, base_year_sessions[1001], 2025),
            create_mock_attendee(101, base_year_sessions[1002], 2025),
        ]

        mock_repository.fetch_sessions.return_value = base_year_sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_attendees.return_value = attendees

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="gender",
            breakdown_value="F",
            # No compare_year = non-retention mode
        )

        assert len(result) == 1
        # Should include BOTH sessions (main + quest) since this is registration drilldown
        assert len(result[0].sessions) == 2
        session_cm_ids = {s.session_cm_id for s in result[0].sessions}
        assert session_cm_ids == {1001, 1002}


# ============================================================================
# Tests for enrollment_date population in drilldown responses
# ============================================================================


class TestEnrollmentDatePopulation:
    """Tests for enrollment_date field in DrilldownAttendee responses.

    The enrollment_date field is used by waitlist drilldowns to sort
    campers by registration date (earliest first).
    """

    @pytest.mark.asyncio
    async def test_build_response_includes_enrollment_date(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """_build_response populates enrollment_date from attendee records."""
        session = sample_sessions[1001]
        attendee = create_mock_attendee(101, session, 2026)
        attendee.enrollment_date = "2025-12-01 10:30:00.000Z"

        result = drilldown_service._build_response(
            attendees=[attendee],
            persons=sample_persons,
            _sessions=sample_sessions,
        )

        assert len(result) == 1
        assert result[0].enrollment_date == "2025-12-01 10:30:00.000Z"

    @pytest.mark.asyncio
    async def test_build_response_enrollment_date_none_when_missing(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """_build_response sets enrollment_date to None when not on attendee."""
        session = sample_sessions[1001]
        attendee = create_mock_attendee(101, session, 2026)
        # Remove enrollment_date attr so getattr returns None
        del attendee.enrollment_date

        result = drilldown_service._build_response(
            attendees=[attendee],
            persons=sample_persons,
            _sessions=sample_sessions,
        )

        assert len(result) == 1
        assert result[0].enrollment_date is None

    @pytest.mark.asyncio
    async def test_enrollment_date_flows_through_standard_drilldown(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        sample_sessions: dict[int, Mock],
        sample_persons: dict[int, Mock],
    ) -> None:
        """enrollment_date passes through the standard get_attendees_for_breakdown path."""
        attendee_m = create_mock_attendee(104, sample_sessions[1004], 2026)
        attendee_m.enrollment_date = "2025-10-01 08:00:00.000Z"

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = [attendee_m]

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="gender",
            breakdown_value="M",
        )

        assert len(result) == 1
        assert result[0].enrollment_date == "2025-10-01 08:00:00.000Z"

    @pytest.mark.asyncio
    async def test_waitlist_accepted_includes_enrollment_date(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
    ) -> None:
        """UC3 (waitlist_accepted) path populates enrollment_date from attendee lookup."""
        sessions = {
            1001: create_mock_session(1001, "Session 1", 2026, "main", "2026-06-15", "2026-07-05"),
        }
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=1),
        }
        session1 = sessions[1001]

        # Status history: Emma was waitlisted, then accepted (enrolled)
        history = [
            create_mock_status_history(101, session1, persons[101], old_status="waitlisted", new_status="enrolled"),
        ]

        # Attendee record with enrollment_date
        attendee_with_date = create_mock_attendee(101, session1, 2026, status="enrolled")
        attendee_with_date.enrollment_date = "2025-12-15 14:30:00.000Z"

        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_status_history = AsyncMock(return_value=history)
        mock_repository.fetch_attendees = AsyncMock(return_value=[attendee_with_date])

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_accepted",
            breakdown_value="true",
        )

        assert len(result) == 1
        assert result[0].person_id == 101
        assert result[0].enrollment_date == "2025-12-15 14:30:00.000Z"

    @pytest.mark.asyncio
    async def test_waitlist_declined_includes_enrollment_date(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
    ) -> None:
        """UC4 (waitlist_declined) path populates enrollment_date from attendee lookup."""
        sessions = {
            1001: create_mock_session(1001, "Session 1", 2026, "main", "2026-06-15", "2026-07-05"),
        }
        persons = {
            102: create_mock_person(102, "Liam", "Garcia", "M", 6, years_at_camp=2),
        }
        session1 = sessions[1001]

        # Status history: Liam was waitlisted, then cancelled
        history = [
            create_mock_status_history(102, session1, persons[102], old_status="waitlisted", new_status="cancelled"),
        ]

        # Attendee record with enrollment_date
        attendee_with_date = create_mock_attendee(102, session1, 2026, status="cancelled")
        attendee_with_date.enrollment_date = "2025-11-01 10:00:00.000Z"

        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_status_history = AsyncMock(return_value=history)
        mock_repository.fetch_attendees = AsyncMock(return_value=[attendee_with_date])

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_declined",
            breakdown_value="true",
        )

        assert len(result) == 1
        assert result[0].person_id == 102
        assert result[0].enrollment_date == "2025-11-01 10:00:00.000Z"

    @pytest.mark.asyncio
    async def test_waitlist_accepted_enrollment_date_none_when_no_attendee(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
    ) -> None:
        """UC3 path sets enrollment_date to None when no attendee record found."""
        sessions = {
            1001: create_mock_session(1001, "Session 1", 2026, "main", "2026-06-15", "2026-07-05"),
        }
        persons = {
            103: create_mock_person(103, "Olivia", "Chen", "F", 7, years_at_camp=1),
        }
        session1 = sessions[1001]

        history = [
            create_mock_status_history(103, session1, persons[103], old_status="waitlisted", new_status="enrolled"),
        ]

        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_status_history = AsyncMock(return_value=history)
        # No attendee records available
        mock_repository.fetch_attendees = AsyncMock(return_value=[])

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_accepted",
            breakdown_value="true",
        )

        assert len(result) == 1
        assert result[0].person_id == 103
        assert result[0].enrollment_date is None

    @pytest.mark.asyncio
    async def test_waitlist_accepted_uses_earliest_enrollment_date(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
    ) -> None:
        """UC3 path uses earliest enrollment_date when person has multiple attendee records."""
        sessions = {
            1001: create_mock_session(1001, "Session 1", 2026, "main", "2026-06-15", "2026-07-05"),
            1002: create_mock_session(1002, "Session 2", 2026, "main", "2026-07-06", "2026-07-26"),
        }
        persons = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=1),
        }
        session1 = sessions[1001]
        session2 = sessions[1002]

        history = [
            create_mock_status_history(101, session1, persons[101], old_status="waitlisted", new_status="enrolled"),
        ]

        # Two attendee records with different enrollment dates
        att1 = create_mock_attendee(101, session1, 2026, status="enrolled")
        att1.enrollment_date = "2025-12-15 14:30:00.000Z"  # Later
        att2 = create_mock_attendee(101, session2, 2026, status="enrolled")
        att2.enrollment_date = "2025-11-01 09:00:00.000Z"  # Earlier

        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_persons.return_value = persons
        mock_repository.fetch_status_history = AsyncMock(return_value=history)
        mock_repository.fetch_attendees = AsyncMock(return_value=[att1, att2])

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_accepted",
            breakdown_value="true",
        )

        assert len(result) == 1
        assert result[0].enrollment_date == "2025-11-01 09:00:00.000Z"  # Earliest


class TestCancellationReEnrolledDrilldown:
    """Tests for cancellation_re_enrolled drilldown breakdown.

    Re-enrolled campers are those who were cancelled then later re-enrolled.
    They are currently enrolled (not cancelled), so the drilldown returns
    enrolled attendees filtered to those with a cancelled->enrolled status
    history transition.
    """

    @pytest.fixture
    def re_enrolled_sessions(self) -> dict[int, Mock]:
        """Sessions for re-enrolled tests."""
        return {
            1001: create_mock_session(1001, "Session 1", 2026, "main"),
            1002: create_mock_session(1002, "Session 2", 2026, "main"),
        }

    @pytest.fixture
    def re_enrolled_persons(self) -> dict[int, Mock]:
        """Persons for re-enrolled tests.

        - 101 Emma: was cancelled then re-enrolled
        - 102 Liam: was cancelled then re-enrolled (different session)
        - 103 Olivia: never cancelled, just enrolled normally
        """
        return {
            101: create_mock_person(101, "Emma", "Johnson", gender="F", grade=6),
            102: create_mock_person(102, "Liam", "Garcia", gender="M", grade=7),
            103: create_mock_person(103, "Olivia", "Chen", gender="F", grade=5),
        }

    @pytest.mark.asyncio
    async def test_re_enrolled_returns_currently_enrolled_with_history(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        re_enrolled_sessions: dict[int, Mock],
        re_enrolled_persons: dict[int, Mock],
    ) -> None:
        """cancellation_re_enrolled returns enrolled campers who have a cancelled->enrolled transition."""
        session1 = re_enrolled_sessions[1001]
        session2 = re_enrolled_sessions[1002]

        # Status history: Emma and Liam were cancelled then re-enrolled
        history = [
            create_mock_status_history(
                101, session1, re_enrolled_persons[101], old_status="cancelled", new_status="enrolled"
            ),
            create_mock_status_history(
                102, session2, re_enrolled_persons[102], old_status="withdrawn", new_status="enrolled"
            ),
        ]

        # Currently enrolled attendees: Emma, Liam, and Olivia
        enrolled_attendees = [
            create_mock_attendee(101, session1, 2026, status="enrolled"),
            create_mock_attendee(102, session2, 2026, status="enrolled"),
            create_mock_attendee(103, session1, 2026, status="enrolled"),
        ]

        mock_repository.fetch_sessions.return_value = re_enrolled_sessions
        mock_repository.fetch_persons.return_value = re_enrolled_persons
        mock_repository.fetch_attendees = AsyncMock(return_value=enrolled_attendees)
        mock_repository.fetch_status_history = AsyncMock(return_value=history)

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="cancellation_re_enrolled",
            breakdown_value="true",
            status_filter=["enrolled"],
        )

        # Only Emma and Liam should be returned (they have cancel->enrolled history)
        assert len(result) == 2
        person_ids = {r.person_id for r in result}
        assert person_ids == {101, 102}
        # They should show as enrolled status
        for r in result:
            assert r.status == "enrolled"

    @pytest.mark.asyncio
    async def test_re_enrolled_empty_when_no_transitions(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        re_enrolled_sessions: dict[int, Mock],
        re_enrolled_persons: dict[int, Mock],
    ) -> None:
        """cancellation_re_enrolled returns empty when no cancel->enrolled transitions exist."""
        session1 = re_enrolled_sessions[1001]

        enrolled_attendees = [
            create_mock_attendee(103, session1, 2026, status="enrolled"),
        ]

        mock_repository.fetch_sessions.return_value = re_enrolled_sessions
        mock_repository.fetch_persons.return_value = re_enrolled_persons
        mock_repository.fetch_attendees = AsyncMock(return_value=enrolled_attendees)
        mock_repository.fetch_status_history = AsyncMock(return_value=[])

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="cancellation_re_enrolled",
            breakdown_value="true",
            status_filter=["enrolled"],
        )

        assert len(result) == 0

    @pytest.mark.asyncio
    async def test_re_enrolled_deduplicates_by_person(
        self,
        drilldown_service: DrilldownService,
        mock_repository: Mock,
        re_enrolled_sessions: dict[int, Mock],
        re_enrolled_persons: dict[int, Mock],
    ) -> None:
        """cancellation_re_enrolled deduplicates when a person is enrolled in multiple sessions."""
        session1 = re_enrolled_sessions[1001]
        session2 = re_enrolled_sessions[1002]

        history = [
            create_mock_status_history(
                101, session1, re_enrolled_persons[101], old_status="cancelled", new_status="enrolled"
            ),
        ]

        # Emma enrolled in both sessions
        enrolled_attendees = [
            create_mock_attendee(101, session1, 2026, status="enrolled"),
            create_mock_attendee(101, session2, 2026, status="enrolled"),
        ]

        mock_repository.fetch_sessions.return_value = re_enrolled_sessions
        mock_repository.fetch_persons.return_value = re_enrolled_persons
        mock_repository.fetch_attendees = AsyncMock(return_value=enrolled_attendees)
        mock_repository.fetch_status_history = AsyncMock(return_value=history)

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="cancellation_re_enrolled",
            breakdown_value="true",
            status_filter=["enrolled"],
        )

        # Only one entry for Emma, but with both sessions listed
        assert len(result) == 1
        assert result[0].person_id == 101
        assert len(result[0].sessions) == 2


# ============================================================================
# Tests for effective_date population in drilldown responses
# ============================================================================


class TestDrilldownEffectiveDate:
    """Tests for effective_date field in DrilldownAttendee responses.

    The effective_date field captures the original registration date from
    CampMinder, which differs from enrollment_date (PostDate). For cancelled
    records, enrollment_date shows cancellation date, while effective_date
    shows when they originally registered.
    """

    @pytest.mark.asyncio
    async def test_drilldown_includes_effective_date(
        self,
        drilldown_service,
        mock_repository,
        sample_sessions,
        sample_persons,
    ):
        """DrilldownAttendee has effective_date populated from attendee record."""
        session = sample_sessions[1003]
        attendee = create_mock_attendee(101, session, 2026, status="enrolled")
        attendee.enrollment_date = "2025-11-15 10:30:00.000Z"
        attendee.effective_date = "2025-11-10 08:00:00.000Z"

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = [attendee]

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="gender",
            breakdown_value="F",
        )

        assert len(result) >= 1
        match = [r for r in result if r.person_id == 101]
        assert len(match) == 1
        assert match[0].effective_date == "2025-11-10 08:00:00.000Z"

    @pytest.mark.asyncio
    async def test_drilldown_cancelled_has_both_dates(
        self,
        drilldown_service,
        mock_repository,
        sample_sessions,
        sample_persons,
    ):
        """Cancelled attendee has both effective_date and enrollment_date."""
        session = sample_sessions[1003]
        attendee = create_mock_attendee(101, session, 2026, status="cancelled")
        attendee.enrollment_date = "2026-07-01 12:00:00.000Z"  # cancellation date
        attendee.effective_date = "2025-11-10 08:00:00.000Z"  # original registration

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = [attendee]

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="status",
            breakdown_value="cancelled",
            status_filter=["cancelled"],
        )

        assert len(result) == 1
        assert result[0].enrollment_date == "2026-07-01 12:00:00.000Z"
        assert result[0].effective_date == "2025-11-10 08:00:00.000Z"

    @pytest.mark.asyncio
    async def test_drilldown_effective_date_none_when_missing(
        self,
        drilldown_service,
        mock_repository,
        sample_sessions,
        sample_persons,
    ):
        """effective_date is None when field is absent on attendee record."""
        session = sample_sessions[1003]
        attendee = create_mock_attendee(101, session, 2026, status="enrolled")
        attendee.enrollment_date = "2025-11-15 10:30:00.000Z"
        # No effective_date attribute set

        mock_repository.fetch_sessions.return_value = sample_sessions
        mock_repository.fetch_persons.return_value = sample_persons
        mock_repository.fetch_attendees.return_value = [attendee]

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="gender",
            breakdown_value="F",
        )

        match = [r for r in result if r.person_id == 101]
        assert len(match) == 1
        assert match[0].effective_date is None


# ============================================================================
# Tests for waitlist_session_gender breakdown type
# ============================================================================


class TestWaitlistSessionGenderDrilldown:
    """Test waitlist_session_gender drilldown filter."""

    @pytest.mark.asyncio
    async def test_returns_waitlisted_for_session_and_gender(self, drilldown_service, mock_repository):
        """Should return only waitlisted girls for specified session."""
        # Setup: sessions with cm_id 1001
        sessions = {1001: create_mock_session(1001, "Session 1")}
        mock_repository.fetch_sessions.return_value = sessions

        # Only waitlisted attendees returned (repo filters by status_filter=["waitlisted"])
        # Mix of genders to verify gender filtering
        mock_repository.fetch_attendees_with_persons = AsyncMock(
            return_value=[
                create_mock_attendee_with_person(
                    101,
                    1001,
                    gender="F",
                    status="waitlisted",
                    first_name="Emma",
                    last_name="Johnson",
                    grade=4,
                    effective_date="2025-11-13",
                    enrollment_date="2025-11-14T00:00:00Z",
                ),
                create_mock_attendee_with_person(
                    102,
                    1001,
                    gender="F",
                    status="waitlisted",
                    first_name="Olivia",
                    last_name="Chen",
                    grade=3,
                    effective_date="2025-11-12",
                    enrollment_date="2025-11-13T00:00:00Z",
                ),
                create_mock_attendee_with_person(
                    201,
                    1001,
                    gender="M",
                    status="waitlisted",
                    first_name="Liam",
                    last_name="Garcia",
                    grade=5,
                    effective_date="2025-11-12",
                    enrollment_date="2025-11-13T00:00:00Z",
                ),
            ]
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_session_gender",
            breakdown_value="1001:F",
        )

        # Only waitlisted girls
        assert len(result) == 2
        assert all(a.gender == "F" for a in result)
        assert all(a.status == "waitlisted" for a in result)

        # Sorted by effective_date ASC, enrollment_date ASC
        assert result[0].person_id == 102  # eff=2025-11-12 (earlier)
        assert result[1].person_id == 101  # eff=2025-11-13

    @pytest.mark.asyncio
    async def test_combined_gender_for_ag(self, drilldown_service, mock_repository):
        """When gender is omitted (AG/quest), return all genders."""
        sessions = {2001: create_mock_session(2001, "AG Session", session_type="ag")}
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_attendees_with_persons = AsyncMock(
            return_value=[
                create_mock_attendee_with_person(
                    101,
                    2001,
                    gender="F",
                    status="waitlisted",
                    first_name="Emma",
                    last_name="Johnson",
                    effective_date="2025-11-12",
                    enrollment_date="2025-11-13T00:00:00Z",
                ),
                create_mock_attendee_with_person(
                    201,
                    2001,
                    gender="M",
                    status="waitlisted",
                    first_name="Liam",
                    last_name="Garcia",
                    effective_date="2025-11-13",
                    enrollment_date="2025-11-14T00:00:00Z",
                ),
            ]
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_session_gender",
            breakdown_value="2001:",  # empty gender = all
        )

        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_respects_session_types_filter(self, drilldown_service, mock_repository):
        """When session_types is passed, summer_session_ids should only include matching sessions.

        The internal fetch_sessions call (for summer session filtering) must use the passed
        session_types, not hardcoded SUMMER_SESSION_TYPES. Otherwise, enrolled-in-main sessions
        leak into the enrolled_sessions list when filtering by quest-only session_types.
        """
        quest_session = create_mock_session(3001, "Quest A", session_type="quest")
        main_session = create_mock_session(1001, "Session 1", session_type="main")

        # fetch_sessions returns different results based on session_types:
        # - called with ["quest"] → only quest session (expected with fix)
        # - called with SUMMER_SESSION_TYPES (all types) → both sessions (old broken behavior)
        async def mock_fetch_sessions(year, session_types=None):
            if session_types and "quest" in session_types and "main" not in session_types:
                return {3001: quest_session}
            # Old code path: SUMMER_SESSION_TYPES includes main, returns all sessions
            return {3001: quest_session, 1001: main_session}

        mock_repository.fetch_sessions = AsyncMock(side_effect=mock_fetch_sessions)

        # Emma is waitlisted in quest session AND enrolled in a main session.
        # With old code: main session 1001 is in summer_session_ids (SUMMER_SESSION_TYPES
        # includes "main"), so Emma's main enrollment shows in enrolled_sessions.
        # With fix: main session 1001 is NOT in summer_session_ids (filtered to quest only),
        # so enrolled_sessions should be empty.
        mock_repository.fetch_attendees_with_persons = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                [
                    create_mock_attendee_with_person(
                        101,
                        3001,
                        gender="F",
                        status="waitlisted",
                        first_name="Emma",
                        last_name="Johnson",
                        grade=5,
                        effective_date="2025-11-12",
                        enrollment_date="2025-11-13T00:00:00Z",
                        session=quest_session,
                    ),
                ]
                if status_filter == ["waitlisted"]
                else [
                    create_mock_attendee_with_person(
                        101,
                        1001,
                        gender="F",
                        status="enrolled",
                        first_name="Emma",
                        last_name="Johnson",
                        session=main_session,
                    ),
                ]
                if status_filter == ["enrolled"]
                else []
            )
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_session_gender",
            breakdown_value="3001:F",
            session_types=["quest"],
        )

        # Should find Emma (waitlisted in quest session)
        assert len(result) == 1
        assert result[0].person_id == 101

        # With the fix, enrolled_sessions must NOT include the main session
        # (main session 1001 is outside the quest-only session_types filter).
        # With old code (hardcoded SUMMER_SESSION_TYPES), main session would appear here.
        assert result[0].enrolled_sessions == [], (
            "enrolled_sessions should be empty when session_types=['quest'] — "
            "main session must not leak in via hardcoded SUMMER_SESSION_TYPES"
        )


# ============================================================================
# Tests for waitlist_teen_program breakdown type (SCIT/TLI drilldown)
# ============================================================================


class TestWaitlistTeenProgramDrilldown:
    """Teen rows aggregate to session_cm_id=0, so the drilldown must resolve the
    teen *type* (scit/tli) to its real, window-gated session cm_ids."""

    def _teen_world(self):
        """Sessions: a main (defines summer window), CIT+SIT (scit), TLI, and an
        off-season scit that must be window-gated out."""
        return {
            1001: create_mock_session(1001, "Session 1", session_type="main"),
            5001: create_mock_session(5001, "CIT", session_type="scit"),
            5002: create_mock_session(5002, "SIT", session_type="scit"),
            6001: create_mock_session(6001, "TLI", session_type="tli"),
            # Fall Family-Camp CIT — same type, outside the summer window.
            5999: create_mock_session(
                5999, "Fall CIT", session_type="scit", start_date="2026-10-01", end_date="2026-10-08"
            ),
        }

    def _teen_waitlisted(self, sessions):
        return [
            create_mock_attendee_with_person(
                101,
                5001,
                gender="M",
                status="waitlisted",
                grade=12,
                effective_date="2025-11-12",
                session=sessions[5001],
            ),
            create_mock_attendee_with_person(
                102,
                5002,
                gender="F",
                status="waitlisted",
                grade=11,
                effective_date="2025-11-13",
                session=sessions[5002],
            ),
            create_mock_attendee_with_person(
                103,
                6001,
                gender="F",
                status="waitlisted",
                grade=10,
                effective_date="2025-11-14",
                session=sessions[6001],
            ),
            # Waitlisted in main — must not appear for a teen-type drilldown.
            create_mock_attendee_with_person(
                104,
                1001,
                gender="M",
                status="waitlisted",
                grade=6,
                effective_date="2025-11-15",
                session=sessions[1001],
            ),
            # Waitlisted in the off-season scit — window-gated out.
            create_mock_attendee_with_person(
                105,
                5999,
                gender="M",
                status="waitlisted",
                grade=12,
                effective_date="2025-11-16",
                session=sessions[5999],
            ),
        ]

    @pytest.mark.asyncio
    async def test_scit_merges_cit_and_sit_excludes_others(self, drilldown_service, mock_repository):
        """value='scit' returns waitlisted from CIT+SIT only — not TLI, main, or off-season scit."""
        sessions = self._teen_world()
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_attendees_with_persons = AsyncMock(return_value=self._teen_waitlisted(sessions))

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_teen_program",
            breakdown_value="scit",
            session_types=["main", "scit", "tli"],
        )

        pids = {a.person_id for a in result}
        assert pids == {101, 102}
        assert all(a.status == "waitlisted" for a in result)

    @pytest.mark.asyncio
    async def test_tli_distinct_from_scit(self, drilldown_service, mock_repository):
        """value='tli' returns only the TLI waitlister, distinguishing it from SCIT."""
        sessions = self._teen_world()
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_attendees_with_persons = AsyncMock(return_value=self._teen_waitlisted(sessions))

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_teen_program",
            breakdown_value="tli",
            session_types=["main", "scit", "tli"],
        )

        assert {a.person_id for a in result} == {103}

    @pytest.mark.asyncio
    async def test_scit_with_grade_filter(self, drilldown_service, mock_repository):
        """value='scit:12' filters the merged SCIT pool to a single grade."""
        sessions = self._teen_world()
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_attendees_with_persons = AsyncMock(return_value=self._teen_waitlisted(sessions))

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_teen_program",
            breakdown_value="scit:12",
            session_types=["main", "scit", "tli"],
        )

        assert {a.person_id for a in result} == {101}

    @pytest.mark.asyncio
    async def test_unknown_teen_type_returns_empty(self, drilldown_service, mock_repository):
        """A non-teen breakdown value yields no rows rather than erroring."""
        sessions = self._teen_world()
        mock_repository.fetch_sessions.return_value = sessions
        mock_repository.fetch_attendees_with_persons = AsyncMock(return_value=self._teen_waitlisted(sessions))

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_teen_program",
            breakdown_value="main",
            session_types=["main", "scit", "tli"],
        )

        assert result == []


# ============================================================================
# Tests for waitlist "Waitlisted For" summer session filtering
# ============================================================================


class TestWaitlistForSummerSessionFiltering:
    """Waitlisted For column should only show summer sessions, not family camp etc."""

    @pytest.mark.asyncio
    async def test_enrollment_breakdown_excludes_non_summer_from_waitlisted_for(
        self, drilldown_service, mock_repository
    ):
        """_handle_waitlist_enrollment_breakdown: sessions list excludes non-summer sessions."""
        summer_session = create_mock_session(1001, "Session 1", session_type="main")
        family_session = create_mock_session(5001, "Family Camp", session_type="family")
        sessions = {1001: summer_session, 5001: family_session}

        mock_repository.fetch_sessions = AsyncMock(
            side_effect=lambda year, session_types=None: (
                {1001: summer_session} if session_types and "family" not in session_types else sessions
            )
        )
        mock_repository.fetch_persons.return_value = {
            101: create_mock_person(101, "Emma", "Johnson", gender="F", grade=5),
        }

        # Emma waitlisted in both summer and family camp sessions
        waitlisted = [
            create_mock_attendee(101, summer_session, 2026, status="waitlisted"),
            create_mock_attendee(101, family_session, 2026, status="waitlisted"),
        ]
        enrolled: list[Mock] = []

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: waitlisted if status_filter == ["waitlisted"] else enrolled
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="waitlist_no_enrollment",
            breakdown_value="all",
        )

        # Emma should appear
        assert len(result) == 1
        # Her "Waitlisted For" sessions should only include summer, not family camp
        session_ids = {s.session_cm_id for s in result[0].sessions}
        assert 1001 in session_ids
        assert 5001 not in session_ids

    @pytest.mark.asyncio
    async def test_person_breakdown_excludes_non_summer_from_waitlisted_for(self, drilldown_service, mock_repository):
        """_handle_waitlist_person_breakdown: sessions list excludes non-summer sessions."""
        summer_session = create_mock_session(1001, "Session 1", session_type="main")
        family_session = create_mock_session(5001, "Family Camp", session_type="family")
        sessions = {1001: summer_session, 5001: family_session}

        mock_repository.fetch_sessions = AsyncMock(
            side_effect=lambda year, session_types=None: (
                {1001: summer_session} if session_types and "family" not in session_types else sessions
            )
        )
        mock_repository.fetch_persons.return_value = {
            101: create_mock_person(101, "Emma", "Johnson", gender="F", grade=5),
        }

        # Emma waitlisted in both summer and family camp sessions
        waitlisted = [
            create_mock_attendee(101, summer_session, 2026, status="waitlisted"),
            create_mock_attendee(101, family_session, 2026, status="waitlisted"),
        ]
        enrolled: list[Mock] = []

        mock_repository.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: waitlisted if status_filter == ["waitlisted"] else enrolled
        )

        result = await drilldown_service.get_attendees_for_breakdown(
            year=2026,
            breakdown_type="grade",
            breakdown_value="5",
            status_filter=["waitlisted"],
        )

        # Emma should appear
        assert len(result) == 1
        # Her "Waitlisted For" sessions should only include summer, not family camp
        session_ids = {s.session_cm_id for s in result[0].sessions}
        assert 1001 in session_ids
        assert 5001 not in session_ids
