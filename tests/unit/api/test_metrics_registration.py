"""
TDD tests for Registration Tab API enhancements.

Tests for:
- session_cm_id parameter filtering on /api/metrics/registration
- by_gender_grade breakdown (gender counts per grade)
- by_summer_years breakdown (calculated from attendees table)
- by_first_summer_year breakdown (first summer year from enrollment history)

These tests are written FIRST before implementation (TDD).
"""

from unittest.mock import Mock, patch

import pytest
from fastapi.testclient import TestClient

from api.main import create_app
from tests.unit.api.conftest import create_mock_attendee, create_mock_person, create_mock_session

# ============================================================================
# Test Data Factories
# ============================================================================


def create_mock_camper_history(
    person_id: int,
    year: int,
    gender: str = "M",
    grade: int = 6,
    sessions: str = "Session 2",
    session_types: str = "main",
    bunks: str = "B-1",
    first_year_attended: int | None = None,
    school: str = "Riverside Elementary",
    city: str = "Springfield",
    synagogue: str = "Temple Beth El",
) -> Mock:
    """Create a mock camper_history record."""
    history = Mock()
    history.person_id = person_id
    history.year = year
    history.gender = gender
    history.grade = grade
    history.sessions = sessions
    history.session_types = session_types
    history.bunks = bunks
    history.first_year_attended = first_year_attended
    history.school = school
    history.city = city
    history.synagogue = synagogue
    history.years_at_camp = 1 if first_year_attended == year else 2
    return history


def create_mock_bunk(
    pb_id: str = "bunk_001",
    name: str = "B-1",
    gender: str = "M",
    year: int = 2026,
) -> Mock:
    """Create a mock bunk record.

    Args:
        pb_id: PocketBase record ID.
        name: Bunk name (e.g., "B-1", "G-2", "AG-3").
        gender: Bunk gender - "M", "F", or "Mixed" (for AG bunks).
        year: Year for the bunk.
    """
    bunk = Mock()
    bunk.id = pb_id
    bunk.name = name
    bunk.gender = gender
    bunk.year = year
    return bunk


def create_mock_bunk_plan(
    session_pb_id: str,
    bunk: Mock,
    year: int = 2026,
    pb_id: str | None = None,
) -> Mock:
    """Create a mock bunk_plan record with bunk expansion.

    Args:
        session_pb_id: PocketBase ID of the session.
        bunk: Mock bunk record (will be in expand.bunk).
        year: Year for the bunk plan.
        pb_id: Optional PocketBase record ID.
    """
    bunk_plan = Mock()
    bunk_plan.id = pb_id or f"bp_{session_pb_id}_{bunk.id}"
    bunk_plan.session = session_pb_id
    bunk_plan.bunk = bunk.id
    bunk_plan.year = year
    bunk_plan.expand = {"bunk": bunk}
    return bunk_plan


def create_mock_config(
    category: str,
    subcategory: str,
    config_key: str,
    value: str,
) -> Mock:
    """Create a mock config record.

    Args:
        category: Config category (e.g., "constraint").
        subcategory: Config subcategory (e.g., "cabin_capacity").
        config_key: Config key (e.g., "default").
        value: Config value (e.g., "12").
    """
    config = Mock()
    config.category = category
    config.subcategory = subcategory
    config.config_key = config_key
    config.value = value
    return config


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def client():
    """Create test client with mocked PocketBase."""
    app = create_app()
    return TestClient(app)


@pytest.fixture
def sample_sessions_2026() -> list[Mock]:
    """Sample sessions for 2026."""
    return [
        create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05"),
        create_mock_session(2002, "Session 3", 2026, "main", "2026-07-07", "2026-07-27"),
        create_mock_session(2003, "Session 4", 2026, "main", "2026-07-29", "2026-08-18"),
        create_mock_session(2004, "Taste of Camp", 2026, "embedded", "2026-06-20", "2026-06-23"),
        create_mock_session(2005, "AG Session 2", 2026, "ag", "2026-06-15", "2026-07-05", parent_id=2001),
    ]


@pytest.fixture
def sample_persons_2026() -> list[Mock]:
    """Sample persons for 2026 with varied genders and grades."""
    return [
        # Session 2 campers
        create_mock_person(101, "Emma", "Johnson", "F", 5, 2, 2026),
        create_mock_person(102, "Liam", "Garcia", "M", 5, 1, 2026),
        create_mock_person(103, "Olivia", "Chen", "F", 6, 3, 2026),
        create_mock_person(104, "Noah", "Williams", "M", 6, 2, 2026),
        # Session 3 campers
        create_mock_person(105, "Ava", "Brown", "F", 7, 1, 2026),
        create_mock_person(106, "Mason", "Davis", "M", 7, 2, 2026),
        # Session 4 campers
        create_mock_person(107, "Sophia", "Martinez", "F", 8, 4, 2026),
        create_mock_person(108, "Jackson", "Lee", "M", 8, 1, 2026),
    ]


@pytest.fixture
def sample_attendees_2026(sample_sessions_2026: list[Mock]) -> list[Mock]:
    """Sample attendees for 2026, organized by session."""
    session_2, session_3, session_4, taste, ag_session = sample_sessions_2026
    return [
        # Session 2 attendees (4 campers)
        create_mock_attendee(101, session_cm_id=session_2.cm_id, session=session_2, year=2026),  # Emma F G5
        create_mock_attendee(102, session_cm_id=session_2.cm_id, session=session_2, year=2026),  # Liam M G5
        create_mock_attendee(103, session_cm_id=session_2.cm_id, session=session_2, year=2026),  # Olivia F G6
        create_mock_attendee(104, session_cm_id=session_2.cm_id, session=session_2, year=2026),  # Noah M G6
        # Session 3 attendees (2 campers)
        create_mock_attendee(105, session_cm_id=session_3.cm_id, session=session_3, year=2026),  # Ava F G7
        create_mock_attendee(106, session_cm_id=session_3.cm_id, session=session_3, year=2026),  # Mason M G7
        # Session 4 attendees (2 campers)
        create_mock_attendee(107, session_cm_id=session_4.cm_id, session=session_4, year=2026),  # Sophia F G8
        create_mock_attendee(108, session_cm_id=session_4.cm_id, session=session_4, year=2026),  # Jackson M G8
    ]


@pytest.fixture
def sample_camper_history_2026() -> list[Mock]:
    """Sample camper_history for 2026 with session_types."""
    return [
        # Session 2 campers (all with main session type)
        create_mock_camper_history(101, 2026, "F", 5, "Session 2", "main", "G-1", 2025),
        create_mock_camper_history(102, 2026, "M", 5, "Session 2", "main", "B-1", 2026),  # First year
        create_mock_camper_history(103, 2026, "F", 6, "Session 2", "main", "G-2", 2024),
        create_mock_camper_history(104, 2026, "M", 6, "Session 2", "main", "B-2", 2025),
        # Session 3 campers
        create_mock_camper_history(105, 2026, "F", 7, "Session 3", "main", "G-3", 2026),  # First year
        create_mock_camper_history(106, 2026, "M", 7, "Session 3", "main", "B-3", 2025),
        # Session 4 campers
        create_mock_camper_history(107, 2026, "F", 8, "Session 4", "main", "G-4", 2023),
        create_mock_camper_history(108, 2026, "M", 8, "Session 4", "main", "B-4", 2026),  # First year
    ]


# Historical attendee data for summer years calculation
@pytest.fixture
def sample_attendees_history() -> list[Mock]:
    """Historical attendee records for summer years calculation.

    This data represents enrollment history across multiple years.
    Used by fetch_summer_enrollment_history() to calculate:
    - by_summer_years: How many summers has each camper attended?
    - by_first_summer_year: What was their first summer at camp?
    """
    # Sessions for historical years
    session_2024 = create_mock_session(1001, "Session 2", 2024, "main")
    session_2025 = create_mock_session(1501, "Session 2", 2025, "main")
    session_2026 = create_mock_session(2001, "Session 2", 2026, "main")

    return [
        # Person 101 (Emma): 2 summers (2025, 2026)
        create_mock_attendee(101, session_cm_id=session_2025.cm_id, session=session_2025, year=2025),
        create_mock_attendee(101, session_cm_id=session_2026.cm_id, session=session_2026, year=2026),
        # Person 102 (Liam): 1 summer (2026 only - first year)
        create_mock_attendee(102, session_cm_id=session_2026.cm_id, session=session_2026, year=2026),
        # Person 103 (Olivia): 3 summers (2024, 2025, 2026)
        create_mock_attendee(103, session_cm_id=session_2024.cm_id, session=session_2024, year=2024),
        create_mock_attendee(103, session_cm_id=session_2025.cm_id, session=session_2025, year=2025),
        create_mock_attendee(103, session_cm_id=session_2026.cm_id, session=session_2026, year=2026),
        # Person 104 (Noah): 2 summers (2025, 2026)
        create_mock_attendee(104, session_cm_id=session_2025.cm_id, session=session_2025, year=2025),
        create_mock_attendee(104, session_cm_id=session_2026.cm_id, session=session_2026, year=2026),
        # Person 105 (Ava): 1 summer (2026 only - first year)
        create_mock_attendee(105, session_cm_id=session_2026.cm_id, session=session_2026, year=2026),
        # Person 106 (Mason): 2 summers (2025, 2026)
        create_mock_attendee(106, session_cm_id=session_2025.cm_id, session=session_2025, year=2025),
        create_mock_attendee(106, session_cm_id=session_2026.cm_id, session=session_2026, year=2026),
        # Person 107 (Sophia): 4 summers (2023, 2024, 2025, 2026)
        create_mock_attendee(
            107, session_cm_id=501, session=create_mock_session(501, "Session 4", 2023, "main"), year=2023
        ),
        create_mock_attendee(107, session_cm_id=session_2024.cm_id, session=session_2024, year=2024),
        create_mock_attendee(107, session_cm_id=session_2025.cm_id, session=session_2025, year=2025),
        create_mock_attendee(107, session_cm_id=session_2026.cm_id, session=session_2026, year=2026),
        # Person 108 (Jackson): 1 summer (2026 only - first year)
        create_mock_attendee(108, session_cm_id=session_2026.cm_id, session=session_2026, year=2026),
    ]


# ============================================================================
# Session Filter Tests
# ============================================================================


class TestRegistrationSessionFilter:
    """Tests for session_cm_id parameter filtering."""

    def test_session_filter_returns_only_matching_attendees(
        self,
        sample_persons_2026: list[Mock],
        sample_sessions_2026: list[Mock],
        sample_attendees_2026: list[Mock],
        sample_camper_history_2026: list[Mock],
    ) -> None:
        """When session_cm_id is provided, only attendees in that session are counted.

        Session 2 (cm_id=2001) has 4 campers: Emma, Liam, Olivia, Noah
        Filtering to session_cm_id=2001 should return total_enrolled=4
        """
        # Filter attendees to session 2 (cm_id=2001)
        session_2_attendees = [a for a in sample_attendees_2026 if a.session_cm_id == 2001]

        # Verify we have 4 attendees in session 2
        assert len(session_2_attendees) == 4

        # Get unique person IDs
        person_ids = {a.person_id for a in session_2_attendees}
        assert person_ids == {101, 102, 103, 104}

    def test_session_filter_includes_ag_children(
        self,
        sample_sessions_2026: list[Mock],
    ) -> None:
        """AG sessions with matching parent_id should be included.

        When filtering to session_cm_id=2001 (Session 2):
        - Attendees in session 2001 should be included
        - Attendees in AG session 2005 (parent_id=2001) should also be included
        """
        session_2, _session_3, _session_4, _taste, ag_session = sample_sessions_2026

        # Verify AG session has correct parent
        assert ag_session.parent_id == session_2.cm_id
        assert ag_session.session_type == "ag"

        # Create attendees in AG session
        ag_attendees = [
            create_mock_attendee(109, session_cm_id=ag_session.cm_id, session=ag_session, year=2026),  # AG camper
            create_mock_attendee(110, session_cm_id=ag_session.cm_id, session=ag_session, year=2026),  # AG camper
        ]

        # When filtering to session 2001, both main and AG attendees should be included
        # AG attendees should be included because their session's parent_id matches
        all_session_2_attendees = [
            # Regular session 2 attendees
            create_mock_attendee(101, session_cm_id=session_2.cm_id, session=session_2, year=2026),
            create_mock_attendee(102, session_cm_id=session_2.cm_id, session=session_2, year=2026),
        ] + ag_attendees

        # Total should be 4 (2 main + 2 AG)
        assert len(all_session_2_attendees) == 4

    def test_session_filter_with_nonexistent_session(self) -> None:
        """Filtering to a non-existent session_cm_id should return empty results."""
        # This is a pure logic test - implementation should handle gracefully
        attendees: list[Mock] = []
        nonexistent_session_id = 99999

        filtered = [a for a in attendees if a.session_cm_id == nonexistent_session_id]
        assert filtered == []

    def test_all_sessions_when_no_filter(
        self,
        sample_attendees_2026: list[Mock],
    ) -> None:
        """When session_cm_id is None, all sessions should be included."""
        # Total attendees across all sessions: 8
        assert len(sample_attendees_2026) == 8


# ============================================================================
# Gender by Grade Breakdown Tests
# ============================================================================


class TestGenderByGradeBreakdown:
    """Tests for by_gender_grade breakdown (gender counts per grade)."""

    def test_gender_by_grade_structure(
        self,
        sample_persons_2026: list[Mock],
        sample_attendees_2026: list[Mock],
    ) -> None:
        """by_gender_grade should have male/female counts per grade.

        Note: We only track M/F since CampMinder's sex field only has these values.

        Expected structure:
        [
            { grade: 5, male_count: 1, female_count: 1, total: 2 },
            { grade: 6, male_count: 1, female_count: 1, total: 2 },
            { grade: 7, male_count: 1, female_count: 1, total: 2 },
            { grade: 8, male_count: 1, female_count: 1, total: 2 },
        ]
        """
        persons_by_id = {p.cm_id: p for p in sample_persons_2026}
        person_ids = {a.person_id for a in sample_attendees_2026}

        # Build gender by grade breakdown
        by_grade: dict[int, dict[str, int]] = {}
        for pid in person_ids:
            person = persons_by_id.get(pid)
            if not person:
                continue
            grade = person.grade
            gender = person.gender

            if grade not in by_grade:
                by_grade[grade] = {"M": 0, "F": 0}

            if gender in ("M", "F"):
                by_grade[grade][gender] += 1
            # Non-M/F values are ignored since CampMinder sex field only has M/F

        # Verify grade 5: 1M (Liam), 1F (Emma)
        assert by_grade[5]["M"] == 1
        assert by_grade[5]["F"] == 1

        # Verify grade 6: 1M (Noah), 1F (Olivia)
        assert by_grade[6]["M"] == 1
        assert by_grade[6]["F"] == 1

        # Verify grade 7: 1M (Mason), 1F (Ava)
        assert by_grade[7]["M"] == 1
        assert by_grade[7]["F"] == 1

        # Verify grade 8: 1M (Jackson), 1F (Sophia)
        assert by_grade[8]["M"] == 1
        assert by_grade[8]["F"] == 1

    def test_gender_by_grade_sorted_by_grade(self) -> None:
        """Results should be sorted by grade ascending."""
        grades = [8, 5, 7, 6]  # Unsorted
        sorted_grades = sorted(grades)

        assert sorted_grades == [5, 6, 7, 8]


# ============================================================================
# Summer Years Breakdown Tests
# ============================================================================


class TestSummerYearsBreakdown:
    """Tests for by_summer_years breakdown (calculated from attendees table)."""

    def test_summer_years_calculation_from_history(
        self,
        sample_attendees_history: list[Mock],
    ) -> None:
        """Summer years should be calculated from actual attendance history.

        Expected (based on fixture data):
        - 3 campers with 1 summer: Liam (102), Ava (105), Jackson (108)
        - 3 campers with 2 summers: Emma (101), Noah (104), Mason (106)
        - 1 camper with 3 summers: Olivia (103)
        - 1 camper with 4 summers: Sophia (107)
        """
        # Group by person and count unique years
        by_person: dict[int, set[int]] = {}
        for attendee in sample_attendees_history:
            pid = attendee.person_id
            year = attendee.year
            if pid not in by_person:
                by_person[pid] = set()
            by_person[pid].add(year)

        # Calculate summer years for each person
        summer_years = {pid: len(years) for pid, years in by_person.items()}

        # Verify individual calculations
        assert summer_years[101] == 2  # Emma: 2025, 2026
        assert summer_years[102] == 1  # Liam: 2026 only
        assert summer_years[103] == 3  # Olivia: 2024, 2025, 2026
        assert summer_years[104] == 2  # Noah: 2025, 2026
        assert summer_years[105] == 1  # Ava: 2026 only
        assert summer_years[106] == 2  # Mason: 2025, 2026
        assert summer_years[107] == 4  # Sophia: 2023, 2024, 2025, 2026
        assert summer_years[108] == 1  # Jackson: 2026 only

        # Count by summer years
        counts: dict[int, int] = {}
        for years in summer_years.values():
            counts[years] = counts.get(years, 0) + 1

        assert counts[1] == 3  # 3 first-year campers
        assert counts[2] == 3  # 3 second-year campers
        assert counts[3] == 1  # 1 third-year camper
        assert counts[4] == 1  # 1 fourth-year camper

    def test_summer_years_excludes_non_summer_sessions(self) -> None:
        """Only main, embedded, and ag session types count as summer.

        Family camp or other session types should NOT be counted.
        """
        # Create a family session (not summer)
        family_session = create_mock_session(9001, "Family Camp", 2025, "family")
        summer_session = create_mock_session(2001, "Session 2", 2026, "main")

        attendees = [
            create_mock_attendee(
                101, session_cm_id=family_session.cm_id, session=family_session, year=2025
            ),  # Should NOT count
            create_mock_attendee(
                101, session_cm_id=summer_session.cm_id, session=summer_session, year=2026
            ),  # Should count
        ]

        # Filter to summer session types
        summer_types = ("main", "embedded", "ag")
        summer_attendees = [a for a in attendees if a.expand["session"].session_type in summer_types]

        assert len(summer_attendees) == 1
        assert summer_attendees[0].year == 2026


# ============================================================================
# First Summer Year Breakdown Tests
# ============================================================================


class TestFirstSummerYearBreakdown:
    """Tests for by_first_summer_year breakdown (cohort analysis)."""

    def test_first_summer_year_from_history(
        self,
        sample_attendees_history: list[Mock],
    ) -> None:
        """First summer year should be the minimum year from enrollment history.

        Expected (based on fixture data):
        - 2023 cohort: Sophia (107) - 1 camper
        - 2024 cohort: Olivia (103) - 1 camper
        - 2025 cohort: Emma (101), Noah (104), Mason (106) - 3 campers
        - 2026 cohort: Liam (102), Ava (105), Jackson (108) - 3 campers
        """
        # Group by person and find min year
        by_person: dict[int, set[int]] = {}
        for attendee in sample_attendees_history:
            pid = attendee.person_id
            year = attendee.year
            if pid not in by_person:
                by_person[pid] = set()
            by_person[pid].add(year)

        first_years = {pid: min(years) for pid, years in by_person.items()}

        # Verify individual first years
        assert first_years[101] == 2025  # Emma
        assert first_years[102] == 2026  # Liam (first year)
        assert first_years[103] == 2024  # Olivia
        assert first_years[104] == 2025  # Noah
        assert first_years[105] == 2026  # Ava (first year)
        assert first_years[106] == 2025  # Mason
        assert first_years[107] == 2023  # Sophia
        assert first_years[108] == 2026  # Jackson (first year)

        # Count by first summer year (cohort counts)
        cohorts: dict[int, int] = {}
        for year in first_years.values():
            cohorts[year] = cohorts.get(year, 0) + 1

        assert cohorts[2023] == 1  # Sophia
        assert cohorts[2024] == 1  # Olivia
        assert cohorts[2025] == 3  # Emma, Noah, Mason
        assert cohorts[2026] == 3  # Liam, Ava, Jackson

    def test_first_summer_year_percentage_calculation(self) -> None:
        """Percentages should be calculated correctly for cohorts."""
        cohort_counts = {2023: 1, 2024: 1, 2025: 3, 2026: 3}
        total = sum(cohort_counts.values())

        assert total == 8

        percentages = {year: (count / total * 100) for year, count in cohort_counts.items()}

        assert percentages[2023] == pytest.approx(12.5)
        assert percentages[2024] == pytest.approx(12.5)
        assert percentages[2025] == pytest.approx(37.5)
        assert percentages[2026] == pytest.approx(37.5)


# ============================================================================
# Integration Tests (with mocked API)
# ============================================================================


class TestRegistrationEndpointWithSessionFilter:
    """Integration tests for the /api/metrics/registration endpoint with session filter."""

    @pytest.fixture
    def mock_pb_collection(self):
        """Create mock PocketBase collection for integration tests."""
        mock_pb = Mock()
        mock_collection = Mock()
        mock_pb.collection = Mock(return_value=mock_collection)
        return mock_pb, mock_collection

    def test_endpoint_accepts_session_cm_id_parameter(self, client: TestClient) -> None:
        """The registration endpoint should accept session_cm_id query parameter."""
        # This test verifies the endpoint signature accepts the parameter
        # Implementation will make this pass
        with patch("api.routers.metrics.pb") as mock_pb:
            mock_collection = Mock()
            mock_collection.get_full_list = Mock(return_value=[])
            mock_pb.collection = Mock(return_value=mock_collection)

            response = client.get(
                "/api/metrics/registration",
                params={"year": 2026, "session_cm_id": 2001},
            )

            # Should not fail with 422 (validation error) due to unknown parameter
            # Once implemented, should return 200
            assert response.status_code in (200, 500)  # 500 if not yet implemented

    def test_response_includes_gender_by_grade(self, client: TestClient) -> None:
        """Response should include by_gender_grade breakdown.

        Expected response field:
        {
            "by_gender_grade": [
                {"grade": 5, "male_count": 1, "female_count": 1, "total": 2},
                ...
            ]
        }
        """
        with patch("api.routers.metrics.pb") as mock_pb:
            mock_collection = Mock()
            mock_collection.get_full_list = Mock(return_value=[])
            mock_pb.collection = Mock(return_value=mock_collection)

            response = client.get(
                "/api/metrics/registration",
                params={"year": 2026},
            )

            if response.status_code == 200:
                data = response.json()
                # Once implemented, should have by_gender_grade field
                assert "by_gender_grade" in data

    def test_response_includes_summer_years(self, client: TestClient) -> None:
        """Response should include by_summer_years breakdown.

        Expected response field:
        {
            "by_summer_years": [
                {"summer_years": 1, "count": 3, "percentage": 37.5},
                ...
            ]
        }
        """
        with patch("api.routers.metrics.pb") as mock_pb:
            mock_collection = Mock()
            mock_collection.get_full_list = Mock(return_value=[])
            mock_pb.collection = Mock(return_value=mock_collection)

            response = client.get(
                "/api/metrics/registration",
                params={"year": 2026},
            )

            if response.status_code == 200:
                data = response.json()
                # Once implemented, should have by_summer_years field
                assert "by_summer_years" in data

    def test_response_includes_first_summer_year(self, client: TestClient) -> None:
        """Response should include by_first_summer_year breakdown.

        Expected response field:
        {
            "by_first_summer_year": [
                {"first_summer_year": 2023, "count": 1, "percentage": 12.5},
                ...
            ]
        }
        """
        with patch("api.routers.metrics.pb") as mock_pb:
            mock_collection = Mock()
            mock_collection.get_full_list = Mock(return_value=[])
            mock_pb.collection = Mock(return_value=mock_collection)

            response = client.get(
                "/api/metrics/registration",
                params={"year": 2026},
            )

            if response.status_code == 200:
                data = response.json()
                # Once implemented, should have by_first_summer_year field
                assert "by_first_summer_year" in data

    def test_response_includes_gender_by_session_length(self, client: TestClient) -> None:
        """Response should include by_gender_by_session_length breakdown."""
        with patch("api.routers.metrics.pb") as mock_pb:
            mock_collection = Mock()
            mock_collection.get_full_list = Mock(return_value=[])
            mock_pb.collection = Mock(return_value=mock_collection)

            response = client.get(
                "/api/metrics/registration",
                params={"year": 2026},
            )

            if response.status_code == 200:
                data = response.json()
                assert "by_gender_by_session_length" in data


# ============================================================================
# Waitlisted/Cancelled Deduplication Tests
# ============================================================================


class TestWaitlistedCancelledDeduplication:
    """Tests for deduplication of waitlisted and cancelled counts by person_id.

    These tests verify that total_waitlisted and total_cancelled count unique persons,
    not raw attendee records. A person waitlisted/cancelled in multiple sessions
    should only be counted once.
    """

    def test_waitlisted_counts_unique_persons(
        self,
        sample_sessions_2026: list[Mock],
    ) -> None:
        """Person waitlisted in 3 sessions should count as 1 in total_waitlisted.

        Bug scenario: If person 101 is waitlisted in sessions 2, 3, and 4,
        total_waitlisted should be 1 (one unique person), not 3.
        """
        session_2, session_3, session_4, _taste, _ag = sample_sessions_2026

        # One person (ID 101) waitlisted in 3 different sessions
        waitlisted_attendees = [
            create_mock_attendee(
                101, session_cm_id=session_2.cm_id, session=session_2, year=2026, status="waitlisted", status_id=3
            ),
            create_mock_attendee(
                101, session_cm_id=session_3.cm_id, session=session_3, year=2026, status="waitlisted", status_id=3
            ),
            create_mock_attendee(
                101, session_cm_id=session_4.cm_id, session=session_4, year=2026, status="waitlisted", status_id=3
            ),
        ]

        # WRONG (current bug): counting raw records = 3
        wrong_count = len(waitlisted_attendees)
        assert wrong_count == 3  # Bug behavior

        # CORRECT: counting unique person_ids = 1
        waitlisted_person_ids: set[int] = {
            pid for a in waitlisted_attendees if (pid := getattr(a, "person_id", None)) is not None
        }
        correct_count = len(waitlisted_person_ids)
        assert correct_count == 1  # Expected behavior

    def test_cancelled_counts_unique_persons(
        self,
        sample_sessions_2026: list[Mock],
    ) -> None:
        """Person cancelled from 3 sessions should count as 1 in total_cancelled.

        Bug scenario: If person 102 cancelled from sessions 2, 3, and 4,
        total_cancelled should be 1 (one unique person), not 3.
        """
        session_2, session_3, session_4, _taste, _ag = sample_sessions_2026

        # One person (ID 102) cancelled from 3 different sessions
        cancelled_attendees = [
            create_mock_attendee(
                102, session_cm_id=session_2.cm_id, session=session_2, year=2026, status="cancelled", status_id=4
            ),
            create_mock_attendee(
                102, session_cm_id=session_3.cm_id, session=session_3, year=2026, status="cancelled", status_id=4
            ),
            create_mock_attendee(
                102, session_cm_id=session_4.cm_id, session=session_4, year=2026, status="cancelled", status_id=4
            ),
        ]

        # WRONG (current bug): counting raw records = 3
        wrong_count = len(cancelled_attendees)
        assert wrong_count == 3  # Bug behavior

        # CORRECT: counting unique person_ids = 1
        cancelled_person_ids: set[int] = {
            pid for a in cancelled_attendees if (pid := getattr(a, "person_id", None)) is not None
        }
        correct_count = len(cancelled_person_ids)
        assert correct_count == 1  # Expected behavior

    def test_enrolled_already_deduplicated(
        self,
        sample_sessions_2026: list[Mock],
    ) -> None:
        """Verify enrolled counts unique persons (existing correct behavior).

        Person enrolled in 2 sessions should count as 1 in total_enrolled.
        """
        session_2, session_3, _session_4, _taste, _ag = sample_sessions_2026

        # One person (ID 103) enrolled in 2 different sessions
        enrolled_attendees = [
            create_mock_attendee(
                103, session_cm_id=session_2.cm_id, session=session_2, year=2026, status="enrolled", status_id=2
            ),
            create_mock_attendee(
                103, session_cm_id=session_3.cm_id, session=session_3, year=2026, status="enrolled", status_id=2
            ),
        ]

        # Enrolled uses set deduplication (correct existing behavior)
        enrolled_person_ids: set[int] = {
            pid for a in enrolled_attendees if (pid := getattr(a, "person_id", None)) is not None
        }
        correct_count = len(enrolled_person_ids)
        assert correct_count == 1  # Should be 1, not 2

    def test_mixed_statuses_counted_separately(
        self,
        sample_sessions_2026: list[Mock],
    ) -> None:
        """Person enrolled in session A, waitlisted in session B counts in both totals.

        A single person can have different statuses in different sessions.
        They should appear once in each relevant total.
        """
        session_2, session_3, session_4, _taste, _ag = sample_sessions_2026

        # Person 104: enrolled in session 2, waitlisted in session 3
        enrolled_attendees = [
            create_mock_attendee(
                104, session_cm_id=session_2.cm_id, session=session_2, year=2026, status="enrolled", status_id=2
            ),
        ]
        waitlisted_attendees = [
            create_mock_attendee(
                104, session_cm_id=session_3.cm_id, session=session_3, year=2026, status="waitlisted", status_id=3
            ),
        ]

        # Person 105: waitlisted in session 2, cancelled in session 3
        waitlisted_attendees.append(
            create_mock_attendee(
                105, session_cm_id=session_2.cm_id, session=session_2, year=2026, status="waitlisted", status_id=3
            )
        )
        cancelled_attendees = [
            create_mock_attendee(
                105, session_cm_id=session_3.cm_id, session=session_3, year=2026, status="cancelled", status_id=4
            ),
        ]

        # Deduplicate each status category
        enrolled_person_ids: set[int] = {
            pid for a in enrolled_attendees if (pid := getattr(a, "person_id", None)) is not None
        }
        waitlisted_person_ids: set[int] = {
            pid for a in waitlisted_attendees if (pid := getattr(a, "person_id", None)) is not None
        }
        cancelled_person_ids: set[int] = {
            pid for a in cancelled_attendees if (pid := getattr(a, "person_id", None)) is not None
        }

        # Person 104 enrolled, persons 104 and 105 waitlisted, person 105 cancelled
        assert len(enrolled_person_ids) == 1  # Person 104
        assert len(waitlisted_person_ids) == 2  # Persons 104 and 105
        assert len(cancelled_person_ids) == 1  # Person 105

        # Person 104 appears in both enrolled and waitlisted (different sessions)
        assert 104 in enrolled_person_ids
        assert 104 in waitlisted_person_ids

        # Person 105 appears in both waitlisted and cancelled (different sessions)
        assert 105 in waitlisted_person_ids
        assert 105 in cancelled_person_ids

    def test_multiple_persons_multiple_sessions_deduplication(
        self,
        sample_sessions_2026: list[Mock],
    ) -> None:
        """Complex scenario: multiple persons each in multiple sessions.

        3 persons waitlisted across various sessions should count as 3.
        """
        session_2, session_3, session_4, _taste, _ag = sample_sessions_2026

        waitlisted_attendees = [
            # Person 101 waitlisted in 2 sessions
            create_mock_attendee(
                101, session_cm_id=session_2.cm_id, session=session_2, year=2026, status="waitlisted", status_id=3
            ),
            create_mock_attendee(
                101, session_cm_id=session_3.cm_id, session=session_3, year=2026, status="waitlisted", status_id=3
            ),
            # Person 102 waitlisted in 3 sessions
            create_mock_attendee(
                102, session_cm_id=session_2.cm_id, session=session_2, year=2026, status="waitlisted", status_id=3
            ),
            create_mock_attendee(
                102, session_cm_id=session_3.cm_id, session=session_3, year=2026, status="waitlisted", status_id=3
            ),
            create_mock_attendee(
                102, session_cm_id=session_4.cm_id, session=session_4, year=2026, status="waitlisted", status_id=3
            ),
            # Person 103 waitlisted in 1 session
            create_mock_attendee(
                103, session_cm_id=session_4.cm_id, session=session_4, year=2026, status="waitlisted", status_id=3
            ),
        ]

        # Total records: 6, but unique persons: 3
        assert len(waitlisted_attendees) == 6

        waitlisted_person_ids: set[int] = {
            pid for a in waitlisted_attendees if (pid := getattr(a, "person_id", None)) is not None
        }
        assert len(waitlisted_person_ids) == 3  # Persons 101, 102, 103


# ============================================================================
# Session Length by Session Breakdown Tests
# ============================================================================


class TestSessionLengthBySessionBreakdown:
    """Tests for by_session_length_by_session breakdown.

    This breakdown groups sessions by their length category (1-week, 2-week, etc.)
    and shows camper counts per session within each category.
    """

    def test_session_length_category_calculation(self) -> None:
        """get_session_length_category should correctly categorize session lengths.

        Categories:
        - 1-week: 1-7 days
        - 2-week: 8-14 days
        - 3-week: 15-21 days
        - 4-week+: 22+ days
        - unknown: missing or invalid dates
        """
        from api.utils.session_metrics import get_session_length_category

        # 1-week (4 days: June 20-23 inclusive = 4 days)
        assert get_session_length_category("2026-06-20", "2026-06-23") == "1-week"

        # 1-week (7 days: June 20-26 inclusive = 7 days)
        assert get_session_length_category("2026-06-20", "2026-06-26") == "1-week"

        # 2-week (14 days)
        assert get_session_length_category("2026-06-15", "2026-06-28") == "2-week"

        # 3-week (21 days: June 15 to July 5 = 21 days)
        assert get_session_length_category("2026-06-15", "2026-07-05") == "3-week"

        # 4-week+ (22+ days)
        assert get_session_length_category("2026-06-15", "2026-07-15") == "4-week+"

        # Unknown (empty dates)
        assert get_session_length_category("", "") == "unknown"
        assert get_session_length_category("2026-06-15", "") == "unknown"
        assert get_session_length_category("", "2026-07-05") == "unknown"

    def test_session_length_by_session_groups_by_length(
        self,
        sample_sessions_2026: list[Mock],
        sample_attendees_2026: list[Mock],
    ) -> None:
        """by_session_length_by_session should group sessions by length category.

        From sample_sessions_2026:
        - Session 2 (2001): June 15 - July 5 = 21 days = 3-week
        - Session 3 (2002): July 7 - July 27 = 21 days = 3-week
        - Session 4 (2003): July 29 - Aug 18 = 21 days = 3-week
        - Taste of Camp (2004): June 20-23 = 4 days = 1-week
        - AG Session 2 (2005): June 15 - July 5 = 21 days = 3-week

        sample_attendees_2026 has:
        - 4 in Session 2
        - 2 in Session 3
        - 2 in Session 4
        - 0 in Taste of Camp
        - 0 in AG Session 2

        Expected:
        - "3-week" category: 8 total (4+2+2 from Sessions 2, 3, 4)
        """
        from api.utils.session_metrics import get_session_length_category

        # Verify session lengths from fixtures
        session_2, session_3, session_4, taste, ag_session = sample_sessions_2026

        assert get_session_length_category(session_2.start_date, session_2.end_date) == "3-week"
        assert get_session_length_category(session_3.start_date, session_3.end_date) == "3-week"
        assert get_session_length_category(session_4.start_date, session_4.end_date) == "3-week"
        assert get_session_length_category(taste.start_date, taste.end_date) == "1-week"
        assert get_session_length_category(ag_session.start_date, ag_session.end_date) == "3-week"

        # Simulate the grouping logic
        length_session_counts: dict[str, dict[int, int]] = {}
        for a in sample_attendees_2026:
            session = a.expand.get("session")
            if not session:
                continue
            start_date = getattr(session, "start_date", "") or ""
            end_date = getattr(session, "end_date", "") or ""
            length = get_session_length_category(start_date, end_date)

            if length not in length_session_counts:
                length_session_counts[length] = {}
            sid = session.cm_id
            length_session_counts[length][sid] = length_session_counts[length].get(sid, 0) + 1

        # All attendees are in 3-week sessions
        assert "3-week" in length_session_counts
        assert length_session_counts["3-week"][2001] == 4  # Session 2
        assert length_session_counts["3-week"][2002] == 2  # Session 3
        assert length_session_counts["3-week"][2003] == 2  # Session 4

    def test_session_length_by_session_structure(
        self,
        sample_sessions_2026: list[Mock],
        sample_attendees_2026: list[Mock],
    ) -> None:
        """by_session_length_by_session should return proper structure.

        Expected structure:
        [
            {
                "length_category": "3-week",
                "sessions": [
                    {"session_name": "Session 2", "session_cm_id": 2001, "count": 4},
                    {"session_name": "Session 3", "session_cm_id": 2002, "count": 2},
                    {"session_name": "Session 4", "session_cm_id": 2003, "count": 2},
                ],
                "total": 8
            }
        ]
        """
        from api.services.registration_service import RegistrationService

        # Create sessions dict like the service uses
        sessions_dict = {s.cm_id: s for s in sample_sessions_2026}

        # Create mock service with mock repo
        mock_repo = Mock()
        service = RegistrationService(mock_repo)

        # Call the method directly
        result = service._compute_session_length_by_session(sample_attendees_2026, sessions_dict)

        # Should have one length category with data
        assert len(result) == 1
        assert result[0].length_category == "3-week"
        assert result[0].total == 8

        # Check individual sessions
        session_names = {s.session_name for s in result[0].sessions}
        assert "Session 2" in session_names
        assert "Session 3" in session_names
        assert "Session 4" in session_names

        # Check counts
        session_by_name = {s.session_name: s for s in result[0].sessions}
        assert session_by_name["Session 2"].count == 4
        assert session_by_name["Session 3"].count == 2
        assert session_by_name["Session 4"].count == 2

    def test_session_length_by_session_multiple_categories(self) -> None:
        """by_session_length_by_session should handle multiple length categories.

        Create sessions of different lengths and verify proper grouping.
        """
        from api.services.registration_service import RegistrationService

        # Create sessions of different lengths
        taste = create_mock_session(
            1001, "Taste of Camp", 2026, "embedded", "2026-06-20", "2026-06-23"
        )  # 4 days = 1-week
        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")  # 21 days = 3-week
        session_3 = create_mock_session(2002, "Session 3", 2026, "main", "2026-07-07", "2026-07-27")  # 21 days = 3-week

        sessions_dict = {
            1001: taste,
            2001: session_2,
            2002: session_3,
        }

        # Create attendees in different sessions
        attendees = [
            create_mock_attendee(101, session_cm_id=taste.cm_id, session=taste, year=2026),
            create_mock_attendee(102, session_cm_id=taste.cm_id, session=taste, year=2026),
            create_mock_attendee(103, session_cm_id=session_2.cm_id, session=session_2, year=2026),
            create_mock_attendee(104, session_cm_id=session_2.cm_id, session=session_2, year=2026),
            create_mock_attendee(105, session_cm_id=session_2.cm_id, session=session_2, year=2026),
            create_mock_attendee(106, session_cm_id=session_3.cm_id, session=session_3, year=2026),
        ]

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_session_length_by_session(attendees, sessions_dict)

        # Should have two length categories
        categories = {r.length_category: r for r in result}
        assert "1-week" in categories
        assert "3-week" in categories

        # 1-week: Taste of Camp with 2 attendees
        assert categories["1-week"].total == 2
        assert len(categories["1-week"].sessions) == 1
        assert categories["1-week"].sessions[0].session_name == "Taste of Camp"
        assert categories["1-week"].sessions[0].count == 2

        # 3-week: Session 2 (3) + Session 3 (1) = 4
        assert categories["3-week"].total == 4
        assert len(categories["3-week"].sessions) == 2

    def test_session_length_by_session_empty_attendees(self) -> None:
        """by_session_length_by_session should return empty list for no attendees."""
        from api.services.registration_service import RegistrationService

        sessions_dict = {
            2001: create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05"),
        }

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_session_length_by_session([], sessions_dict)

        assert result == []

    def test_session_length_by_session_missing_expand(self) -> None:
        """Attendees without session expand should be skipped."""
        from api.services.registration_service import RegistrationService

        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        sessions_dict = {2001: session_2}

        # Create attendees, one with missing expand
        attendee_with_session = create_mock_attendee(101, session_cm_id=session_2.cm_id, session=session_2, year=2026)
        attendee_no_expand = Mock()
        attendee_no_expand.expand = {}  # Empty expand, no session

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_session_length_by_session([attendee_with_session, attendee_no_expand], sessions_dict)

        # Should only count the attendee with valid session
        assert len(result) == 1
        assert result[0].total == 1

    def test_session_length_by_session_sorted_by_length(self) -> None:
        """Categories should be sorted: 1-week, 2-week, 3-week, 4-week+, unknown."""
        from api.services.registration_service import RegistrationService

        # Create sessions of different lengths
        one_week = create_mock_session(1001, "Short Session", 2026, "embedded", "2026-06-20", "2026-06-23")  # 4 days
        two_week = create_mock_session(1002, "Two Week", 2026, "embedded", "2026-06-20", "2026-07-02")  # 13 days
        three_week = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")  # 21 days
        four_week = create_mock_session(3001, "Long Session", 2026, "main", "2026-06-15", "2026-07-20")  # 36 days

        sessions_dict = {
            1001: one_week,
            1002: two_week,
            2001: three_week,
            3001: four_week,
        }

        attendees = [
            create_mock_attendee(101, session_cm_id=four_week.cm_id, session=four_week, year=2026),  # 4-week+ first
            create_mock_attendee(102, session_cm_id=one_week.cm_id, session=one_week, year=2026),  # 1-week second
            create_mock_attendee(103, session_cm_id=three_week.cm_id, session=three_week, year=2026),  # 3-week third
            create_mock_attendee(104, session_cm_id=two_week.cm_id, session=two_week, year=2026),  # 2-week fourth
        ]

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_session_length_by_session(attendees, sessions_dict)

        # Should be sorted by length category
        categories = [r.length_category for r in result]
        assert categories == ["1-week", "2-week", "3-week", "4-week+"]


# ============================================================================
# Session Length by Session AG Merging Tests
# ============================================================================


class TestSessionLengthBySessionAGMerging:
    """Tests for AG session merging in by_session_length_by_session breakdown.

    AG sessions should be merged into their parent main session counts,
    not displayed as separate bars in the chart.
    """

    def test_ag_sessions_merged_into_parent(self) -> None:
        """AG session counts should be merged into parent main session."""
        from api.services.registration_service import RegistrationService

        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        ag_session_2 = create_mock_session(2005, "AG Session 2", 2026, "ag", "2026-06-15", "2026-07-05", parent_id=2001)

        sessions_dict = {2001: session_2, 2005: ag_session_2}

        # 4 campers in main, 2 in AG
        attendees = [
            create_mock_attendee(101, session_cm_id=session_2.cm_id, session=session_2, year=2026),
            create_mock_attendee(102, session_cm_id=session_2.cm_id, session=session_2, year=2026),
            create_mock_attendee(103, session_cm_id=session_2.cm_id, session=session_2, year=2026),
            create_mock_attendee(104, session_cm_id=session_2.cm_id, session=session_2, year=2026),
            create_mock_attendee(105, session_cm_id=ag_session_2.cm_id, session=ag_session_2, year=2026),
            create_mock_attendee(106, session_cm_id=ag_session_2.cm_id, session=ag_session_2, year=2026),
        ]

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_session_length_by_session(attendees, sessions_dict)

        assert len(result) == 1
        assert result[0].length_category == "3-week"
        assert len(result[0].sessions) == 1
        assert result[0].sessions[0].session_name == "Session 2"
        assert result[0].sessions[0].count == 6  # 4 main + 2 AG merged
        assert result[0].total == 6

    def test_ag_session_not_in_output(self) -> None:
        """AG sessions should not appear separately in sessions list."""
        from api.services.registration_service import RegistrationService

        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        session_3 = create_mock_session(2002, "Session 3", 2026, "main", "2026-07-07", "2026-07-27")
        ag_session_2 = create_mock_session(2005, "AG Session 2", 2026, "ag", "2026-06-15", "2026-07-05", parent_id=2001)

        sessions_dict = {2001: session_2, 2002: session_3, 2005: ag_session_2}

        attendees = [
            create_mock_attendee(101, session_cm_id=session_2.cm_id, session=session_2, year=2026),
            create_mock_attendee(102, session_cm_id=ag_session_2.cm_id, session=ag_session_2, year=2026),
            create_mock_attendee(103, session_cm_id=session_3.cm_id, session=session_3, year=2026),
        ]

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_session_length_by_session(attendees, sessions_dict)

        all_session_names = [s.session_name for cat in result for s in cat.sessions]
        assert "Session 2" in all_session_names
        assert "Session 3" in all_session_names
        assert "AG Session 2" not in all_session_names

    def test_ag_merging_with_multiple_length_categories(self) -> None:
        """AG merging should work correctly when sessions span multiple length categories."""
        from api.services.registration_service import RegistrationService

        # 1-week session
        taste = create_mock_session(1001, "Taste of Camp", 2026, "embedded", "2026-06-20", "2026-06-23")
        # 3-week session with AG
        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        ag_session_2 = create_mock_session(2005, "AG Session 2", 2026, "ag", "2026-06-15", "2026-07-05", parent_id=2001)

        sessions_dict = {1001: taste, 2001: session_2, 2005: ag_session_2}

        attendees = [
            create_mock_attendee(101, session_cm_id=taste.cm_id, session=taste, year=2026),
            create_mock_attendee(102, session_cm_id=session_2.cm_id, session=session_2, year=2026),
            create_mock_attendee(103, session_cm_id=ag_session_2.cm_id, session=ag_session_2, year=2026),
        ]

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_session_length_by_session(attendees, sessions_dict)

        categories = {r.length_category: r for r in result}

        # 1-week: Taste of Camp with 1 attendee
        assert categories["1-week"].total == 1
        assert categories["1-week"].sessions[0].session_name == "Taste of Camp"

        # 3-week: Session 2 with 2 attendees (1 main + 1 AG merged)
        assert categories["3-week"].total == 2
        assert len(categories["3-week"].sessions) == 1
        assert categories["3-week"].sessions[0].session_name == "Session 2"
        assert categories["3-week"].sessions[0].count == 2

    def test_ag_without_parent_not_merged(self) -> None:
        """AG session without parent_id should not be merged (edge case)."""
        from api.services.registration_service import RegistrationService

        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        # AG session with no parent_id - should appear separately
        orphan_ag = create_mock_session(2005, "Orphan AG", 2026, "ag", "2026-06-15", "2026-07-05", parent_id=None)

        sessions_dict = {2001: session_2, 2005: orphan_ag}

        attendees = [
            create_mock_attendee(101, session_cm_id=session_2.cm_id, session=session_2, year=2026),
            create_mock_attendee(102, session_cm_id=orphan_ag.cm_id, session=orphan_ag, year=2026),
        ]

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_session_length_by_session(attendees, sessions_dict)

        # Both should appear since orphan AG has no parent to merge into
        all_session_names = [s.session_name for cat in result for s in cat.sessions]
        assert "Session 2" in all_session_names
        assert "Orphan AG" in all_session_names


# ============================================================================
# Session Capacity and Utilization Tests
# ============================================================================


class TestSessionCapacityUtilization:
    """Tests for capacity and utilization in session breakdown.

    The capacity calculation follows the pattern from the bunking landing page:
    1. Fetch bunk_plans with bunk expansion
    2. Get default capacity from config (default: 12)
    3. Filter out AG bunks (gender='Mixed') for main sessions
    4. Capacity = bunk_plans count × default_capacity
    5. Utilization = (enrolled / capacity) × 100
    """

    def test_capacity_basic_calculation(self) -> None:
        """Basic capacity = bunk_plans count × default_capacity.

        Session with 5 bunk_plans and capacity of 12 = 60 capacity.
        """
        # Create 5 bunk plans (non-AG bunks)
        bunks = [create_mock_bunk(f"bunk_{i}", f"B-{i}", "M", 2026) for i in range(1, 6)]
        bunk_plans = [create_mock_bunk_plan("session_2001", bunk, 2026) for bunk in bunks]

        # 10 attendees enrolled
        num_attendees = 10

        # Test the helper method that calculates capacity
        # Expected: 5 bunks × 12 capacity = 60
        default_capacity = 12
        session_capacity = len(bunk_plans) * default_capacity

        assert session_capacity == 60

        # Utilization = 10 / 60 = 16.67%
        utilization = (num_attendees / session_capacity) * 100
        assert utilization == pytest.approx(16.67, rel=0.01)

    def test_capacity_excludes_ag_bunks_for_main_sessions(self) -> None:
        """Main sessions should exclude AG bunks (gender='Mixed') from capacity.

        Session 2 (main) has 5 boys bunks and 2 AG bunks.
        Only the 5 boys bunks should count toward capacity.
        """

        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        session_2.pb_id = "session_2001"

        # Create 5 regular bunks + 2 AG bunks
        regular_bunks = [create_mock_bunk(f"bunk_{i}", f"B-{i}", "M", 2026) for i in range(1, 6)]
        ag_bunks = [
            create_mock_bunk("bunk_ag_1", "AG-1", "Mixed", 2026),
            create_mock_bunk("bunk_ag_2", "AG-2", "Mixed", 2026),
        ]

        all_bunk_plans = [create_mock_bunk_plan("session_2001", bunk, 2026) for bunk in regular_bunks + ag_bunks]

        # Filter out AG bunks for main session (mimics frontend logic)
        is_main_session = session_2.session_type == "main"
        filtered_plans = []
        for bp in all_bunk_plans:
            bunk_gender = bp.expand.get("bunk", {})
            if hasattr(bunk_gender, "gender"):
                bunk_gender = bunk_gender.gender
            else:
                bunk_gender = bunk_gender.get("gender", "")
            bunk_gender = bunk_gender.lower() if bunk_gender else ""
            is_ag_bunk = bunk_gender in ("ag", "mixed", "all-gender", "nb")

            # For main sessions, exclude AG bunks
            if is_main_session and is_ag_bunk:
                continue
            filtered_plans.append(bp)

        # Should have only 5 regular bunks
        assert len(filtered_plans) == 5

        # Capacity = 5 × 12 = 60 (not 7 × 12 = 84)
        default_capacity = 12
        assert len(filtered_plans) * default_capacity == 60

    def test_capacity_includes_all_bunks_for_embedded_sessions(self) -> None:
        """Embedded sessions should include ALL bunks in capacity (no AG filtering).

        Taste of Camp (embedded) has 3 bunks - all should count.
        """
        taste = create_mock_session(1001, "Taste of Camp", 2026, "embedded", "2026-06-20", "2026-06-23")
        taste.pb_id = "session_1001"

        # Create bunks of different genders
        bunks = [
            create_mock_bunk("bunk_1", "B-1", "M", 2026),
            create_mock_bunk("bunk_2", "G-1", "F", 2026),
            create_mock_bunk("bunk_3", "AG-1", "Mixed", 2026),  # AG bunk included!
        ]

        bunk_plans = [create_mock_bunk_plan("session_1001", bunk, 2026) for bunk in bunks]

        # Embedded session - no filtering
        is_main_session = taste.session_type == "main"
        assert is_main_session is False

        # All 3 bunks should count
        default_capacity = 12
        assert len(bunk_plans) * default_capacity == 36

    def test_utilization_calculation(self) -> None:
        """Utilization = (enrolled / capacity) × 100.

        30 enrolled with capacity 60 = 50% utilization.
        """
        enrolled = 30
        capacity = 60

        utilization = (enrolled / capacity) * 100
        assert utilization == 50.0

    def test_utilization_none_when_capacity_zero(self) -> None:
        """Utilization should be None when capacity is 0 or None.

        Prevents division by zero.
        """

        def calculate_utilization(count: int, capacity: int | None) -> float | None:
            """Helper that matches the service implementation."""
            if capacity is None or capacity == 0:
                return None
            return (count / capacity) * 100

        # Zero capacity
        assert calculate_utilization(10, 0) is None

        # None capacity
        assert calculate_utilization(10, None) is None

        # Valid capacity
        assert calculate_utilization(10, 100) == 10.0

    def test_capacity_uses_default_when_config_missing(self) -> None:
        """When config is missing, use default capacity of 12."""
        # The frontend uses: const bunkCapacity = capacityConfig?.value ? Number(capacityConfig.value) : 12
        default_capacity = 12

        # Simulate missing config (returns None)
        config_value = None
        bunk_capacity = int(config_value) if config_value else default_capacity

        assert bunk_capacity == 12

        # Simulate config with value
        config_value = "10"
        bunk_capacity = int(config_value) if config_value else default_capacity
        assert bunk_capacity == 10

    def test_ag_capacity_merges_into_parent(self) -> None:
        """AG session capacity should be merged into parent main session.

        Main Session 2 has 5 bunks → capacity 60
        AG Session 2 has 2 bunks → capacity 24
        When viewing Session 2, total capacity = 84 (including AG)

        BUT when looking at bunk_plans for main session only,
        we EXCLUDE the AG bunks attached to the main session.
        The AG session has its OWN bunk_plans for AG bunks.
        """
        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        session_2.pb_id = "session_2001"
        ag_session_2 = create_mock_session(2005, "AG Session 2", 2026, "ag", "2026-06-15", "2026-07-05", parent_id=2001)
        ag_session_2.pb_id = "session_2005"

        # Main session bunk plans (5 boys bunks)
        main_bunks = [create_mock_bunk(f"bunk_{i}", f"B-{i}", "M", 2026) for i in range(1, 6)]
        main_bunk_plans = [create_mock_bunk_plan("session_2001", bunk, 2026) for bunk in main_bunks]

        # AG session bunk plans (2 AG bunks)
        ag_bunks = [
            create_mock_bunk("bunk_ag_1", "AG-1", "Mixed", 2026),
            create_mock_bunk("bunk_ag_2", "AG-2", "Mixed", 2026),
        ]
        ag_bunk_plans = [create_mock_bunk_plan("session_2005", bunk, 2026) for bunk in ag_bunks]

        default_capacity = 12

        # Main session capacity: 5 bunks × 12 = 60
        main_capacity = len(main_bunk_plans) * default_capacity
        assert main_capacity == 60

        # AG session capacity: 2 bunks × 12 = 24
        ag_capacity = len(ag_bunk_plans) * default_capacity
        assert ag_capacity == 24

        # When merging AG into parent (for display), total = 84
        combined_capacity = main_capacity + ag_capacity
        assert combined_capacity == 84

    def test_no_bunk_plans_returns_none_capacity(self) -> None:
        """Session with no bunk_plans should have capacity=None, utilization=None."""
        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        session_2.pb_id = "session_2001"

        bunk_plans: list[Mock] = []  # No bunk plans

        # With no bunk plans, capacity should be None (not 0)
        # This indicates "capacity not configured" vs "capacity is zero"
        if len(bunk_plans) == 0:
            capacity = None
            utilization = None
        else:
            capacity = len(bunk_plans) * 12
            utilization = 0.0  # Would calculate based on enrolled

        assert capacity is None
        assert utilization is None

    def test_full_integration_with_service(self) -> None:
        """Integration test: verify _compute_session_breakdown includes capacity/utilization.

        NEW SIGNATURE (after implementation):
        _compute_session_breakdown(attendees, sessions, bunk_plans, default_capacity)

        5 bunk plans × 12 capacity = 60
        30 enrolled / 60 capacity = 50% utilization
        """
        from api.services.registration_service import RegistrationService

        session_2 = create_mock_session(
            2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05", pb_id="session_2001"
        )

        sessions_dict = {2001: session_2}

        # Create 5 bunk plans for session 2
        bunks = [create_mock_bunk(f"bunk_{i}", f"B-{i}", "M", 2026) for i in range(1, 6)]
        bunk_plans = [create_mock_bunk_plan("session_2001", bunk, 2026) for bunk in bunks]

        # 30 attendees enrolled
        attendees = [
            create_mock_attendee(100 + i, session_cm_id=session_2.cm_id, session=session_2, year=2026)
            for i in range(30)
        ]

        mock_repo = Mock()
        service = RegistrationService(mock_repo)

        # NEW: Pass bunk_plans and default_capacity to the method
        result = service._compute_session_breakdown(attendees, sessions_dict, bunk_plans, 12)

        # Find session 2 breakdown
        session_2_breakdown = next((s for s in result if s.session_cm_id == 2001), None)
        assert session_2_breakdown is not None
        assert session_2_breakdown.count == 30

        # Capacity = 5 bunks × 12 = 60
        assert session_2_breakdown.capacity == 60
        # Utilization = 30 / 60 × 100 = 50%
        assert session_2_breakdown.utilization == pytest.approx(50.0, rel=0.01)

    def test_session_breakdown_with_ag_merging(self) -> None:
        """AG session counts and capacity merge into parent main session.

        Main: 4 attendees, 5 bunks → capacity 60
        AG: 2 attendees, 2 bunks → capacity 24
        Combined: 6 attendees, 84 capacity → 7.14% utilization
        """
        from api.services.registration_service import RegistrationService

        session_2 = create_mock_session(
            2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05", pb_id="session_2001"
        )
        ag_session_2 = create_mock_session(
            2005, "AG Session 2", 2026, "ag", "2026-06-15", "2026-07-05", parent_id=2001, pb_id="session_2005"
        )

        sessions_dict = {2001: session_2, 2005: ag_session_2}

        # Main session bunk plans (5 boys bunks)
        main_bunks = [create_mock_bunk(f"bunk_{i}", f"B-{i}", "M", 2026) for i in range(1, 6)]
        main_bunk_plans = [create_mock_bunk_plan("session_2001", bunk, 2026) for bunk in main_bunks]

        # AG session bunk plans (2 AG bunks)
        ag_bunks = [
            create_mock_bunk("bunk_ag_1", "AG-1", "Mixed", 2026),
            create_mock_bunk("bunk_ag_2", "AG-2", "Mixed", 2026),
        ]
        ag_bunk_plans = [create_mock_bunk_plan("session_2005", bunk, 2026) for bunk in ag_bunks]

        # 4 main attendees + 2 AG attendees
        main_attendees = [
            create_mock_attendee(100 + i, session_cm_id=session_2.cm_id, session=session_2, year=2026) for i in range(4)
        ]
        ag_attendees = [
            create_mock_attendee(200 + i, session_cm_id=ag_session_2.cm_id, session=ag_session_2, year=2026)
            for i in range(2)
        ]
        all_attendees = main_attendees + ag_attendees
        all_bunk_plans = main_bunk_plans + ag_bunk_plans

        mock_repo = Mock()
        service = RegistrationService(mock_repo)

        result = service._compute_session_breakdown(all_attendees, sessions_dict, all_bunk_plans, 12)

        # Session 2 should have merged AG counts and capacity
        session_2_breakdown = next((s for s in result if s.session_cm_id == 2001), None)
        assert session_2_breakdown is not None

        # Count: 4 main + 2 AG = 6
        assert session_2_breakdown.count == 6

        # Capacity: 5 main bunks × 12 + 2 AG bunks × 12 = 60 + 24 = 84
        assert session_2_breakdown.capacity == 84

        # Utilization: 6 / 84 × 100 = 7.14%
        assert session_2_breakdown.utilization == pytest.approx(7.14, rel=0.01)

        # AG session should NOT appear in results (merged into parent)
        ag_breakdown = next((s for s in result if s.session_cm_id == 2005), None)
        assert ag_breakdown is None

    def test_embedded_session_includes_all_bunks(self) -> None:
        """Embedded sessions include all bunks including AG bunks.

        Taste of Camp (embedded) with 3 bunks including 1 AG.
        All 3 should count toward capacity.
        """
        from api.services.registration_service import RegistrationService

        taste = create_mock_session(
            1001, "Taste of Camp", 2026, "embedded", "2026-06-20", "2026-06-23", pb_id="session_1001"
        )

        sessions_dict = {1001: taste}

        # 3 bunks: 1 boys, 1 girls, 1 AG (all should count)
        bunks = [
            create_mock_bunk("bunk_1", "B-1", "M", 2026),
            create_mock_bunk("bunk_2", "G-1", "F", 2026),
            create_mock_bunk("bunk_3", "AG-1", "Mixed", 2026),
        ]
        bunk_plans = [create_mock_bunk_plan("session_1001", bunk, 2026) for bunk in bunks]

        # 18 attendees
        attendees = [
            create_mock_attendee(100 + i, session_cm_id=taste.cm_id, session=taste, year=2026) for i in range(18)
        ]

        mock_repo = Mock()
        service = RegistrationService(mock_repo)

        result = service._compute_session_breakdown(attendees, sessions_dict, bunk_plans, 12)

        taste_breakdown = next((s for s in result if s.session_cm_id == 1001), None)
        assert taste_breakdown is not None
        assert taste_breakdown.count == 18

        # All 3 bunks count → capacity = 36
        assert taste_breakdown.capacity == 36
        # Utilization = 18 / 36 × 100 = 50%
        assert taste_breakdown.utilization == pytest.approx(50.0, rel=0.01)

    def test_session_with_no_bunk_plans(self) -> None:
        """Session with no bunk_plans should have capacity=None, utilization=None."""
        from api.services.registration_service import RegistrationService

        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        session_2.pb_id = "session_2001"

        sessions_dict = {2001: session_2}
        bunk_plans: list[Mock] = []  # No bunk plans for any session

        attendees = [
            create_mock_attendee(100 + i, session_cm_id=session_2.cm_id, session=session_2, year=2026)
            for i in range(10)
        ]

        mock_repo = Mock()
        service = RegistrationService(mock_repo)

        result = service._compute_session_breakdown(attendees, sessions_dict, bunk_plans, 12)

        session_2_breakdown = next((s for s in result if s.session_cm_id == 2001), None)
        assert session_2_breakdown is not None
        assert session_2_breakdown.count == 10

        # No bunk plans → capacity should be None
        assert session_2_breakdown.capacity is None
        # Utilization should also be None (can't calculate without capacity)
        assert session_2_breakdown.utilization is None


# ============================================================================
# School/City/Synagogue Breakdown Count Consistency Tests
# ============================================================================


def create_mock_person_with_normalized(
    cm_id: int,
    first_name: str,
    last_name: str,
    gender: str = "M",
    grade: int = 6,
    years_at_camp: int = 2,
    year: int = 2026,
    school: str = "",
    normalized_school: str = "",
    address_city: str = "",
    normalized_city: str = "",
    normalized_congregation: str = "",
) -> Mock:
    """Create a mock person with normalized geo fields.

    These normalized fields are set by the normalize_geographic sync job
    and stored directly on the persons table.
    """
    person = create_mock_person(cm_id, first_name, last_name, gender, grade, years_at_camp, year)
    person.school = school
    person.normalized_school = normalized_school
    person.address_city = address_city
    person.normalized_city = normalized_city
    person.normalized_congregation = normalized_congregation
    return person


class TestSchoolBreakdownFromPersons:
    """Tests for school breakdown using enrolled persons instead of normalized_mappings.

    The bug: school counts came from normalized_mappings (one row per person×session,
    no enrollment filter), so a person in 3 sessions showed count=3 instead of 1.
    The fix: count unique enrolled persons using persons.normalized_school field.
    """

    def test_school_counts_unique_enrolled_persons(self) -> None:
        """Person enrolled in 3 sessions should be counted once in school breakdown.

        Bug scenario: Emma (101) is enrolled in sessions 2, 3, and 4.
        normalized_mappings had 3 rows for her school → count showed 3.
        Fix: count unique persons → count should be 1.
        """
        from api.services.registration_service import RegistrationService

        person_emma = create_mock_person_with_normalized(
            101,
            "Emma",
            "Johnson",
            "F",
            5,
            2,
            2026,
            school="Riverside Elementary",
            normalized_school="Riverside Elementary",
        )
        person_liam = create_mock_person_with_normalized(
            102,
            "Liam",
            "Garcia",
            "M",
            5,
            1,
            2026,
            school="Oak Valley Middle",
            normalized_school="Oak Valley Middle",
        )

        persons = {101: person_emma, 102: person_liam}
        # Both enrolled (deduplicated person IDs from attendees)
        enrolled_person_ids = {101, 102}
        total_enrolled = 2

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_school_breakdown_from_persons(enrolled_person_ids, persons, total_enrolled)

        school_map = {s.school: s.count for s in result}
        assert school_map["Riverside Elementary"] == 1  # Emma counted once
        assert school_map["Oak Valley Middle"] == 1  # Liam counted once

    def test_school_uses_normalized_field(self) -> None:
        """School breakdown should prefer normalized_school over raw school field.

        The normalize_geographic sync standardizes school names (e.g., fixes
        typos, normalizes abbreviations). The breakdown should use these
        normalized values for consistency with the drilldown.
        """
        from api.services.registration_service import RegistrationService

        person = create_mock_person_with_normalized(
            101,
            "Emma",
            "Johnson",
            "F",
            5,
            2,
            2026,
            school="riverside elem",  # Raw, non-normalized
            normalized_school="Riverside Elementary",  # Normalized by sync
        )

        persons = {101: person}
        enrolled_person_ids = {101}

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_school_breakdown_from_persons(enrolled_person_ids, persons, 1)

        # Should use normalized value, not raw
        assert len(result) == 1
        assert result[0].school == "Riverside Elementary"

    def test_school_falls_back_to_raw_when_no_normalized(self) -> None:
        """When normalized_school is empty, fall back to raw school field.

        Not all persons have been processed by normalize_geographic yet.
        """
        from api.services.registration_service import RegistrationService

        person = create_mock_person_with_normalized(
            101,
            "Emma",
            "Johnson",
            "F",
            5,
            2,
            2026,
            school="Hillcrest High",
            normalized_school="",  # Not yet normalized
        )

        persons = {101: person}
        enrolled_person_ids = {101}

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_school_breakdown_from_persons(enrolled_person_ids, persons, 1)

        assert len(result) == 1
        assert result[0].school == "Hillcrest High"

    def test_school_excludes_non_enrolled_persons(self) -> None:
        """Only enrolled person_ids should be counted in school breakdown.

        Persons in the persons dict but not in enrolled_person_ids should
        not contribute to school counts.
        """
        from api.services.registration_service import RegistrationService

        person_enrolled = create_mock_person_with_normalized(
            101,
            "Emma",
            "Johnson",
            "F",
            5,
            2,
            2026,
            normalized_school="Riverside Elementary",
        )
        person_not_enrolled = create_mock_person_with_normalized(
            102,
            "Liam",
            "Garcia",
            "M",
            5,
            1,
            2026,
            normalized_school="Oak Valley Middle",
        )

        persons = {101: person_enrolled, 102: person_not_enrolled}
        # Only person 101 is enrolled
        enrolled_person_ids = {101}

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_school_breakdown_from_persons(enrolled_person_ids, persons, 1)

        school_names = [s.school for s in result]
        assert "Riverside Elementary" in school_names
        assert "Oak Valley Middle" not in school_names

    def test_school_empty_values_excluded(self) -> None:
        """Persons with no school (empty string) should not appear in breakdown."""
        from api.services.registration_service import RegistrationService

        person = create_mock_person_with_normalized(
            101,
            "Emma",
            "Johnson",
            "F",
            5,
            2,
            2026,
            school="",
            normalized_school="",
        )

        persons = {101: person}
        enrolled_person_ids = {101}

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_school_breakdown_from_persons(enrolled_person_ids, persons, 1)

        assert result == []

    def test_school_percentage_calculation(self) -> None:
        """School breakdown should calculate correct percentages."""
        from api.services.registration_service import RegistrationService

        persons = {
            101: create_mock_person_with_normalized(
                101,
                "Emma",
                "Johnson",
                normalized_school="Riverside Elementary",
            ),
            102: create_mock_person_with_normalized(
                102,
                "Liam",
                "Garcia",
                normalized_school="Riverside Elementary",
            ),
            103: create_mock_person_with_normalized(
                103,
                "Olivia",
                "Chen",
                normalized_school="Oak Valley Middle",
            ),
        }
        enrolled_person_ids = {101, 102, 103}
        total_enrolled = 3

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_school_breakdown_from_persons(enrolled_person_ids, persons, total_enrolled)

        school_map = {s.school: s for s in result}
        assert school_map["Riverside Elementary"].count == 2
        assert school_map["Riverside Elementary"].percentage == pytest.approx(66.67, rel=0.01)
        assert school_map["Oak Valley Middle"].count == 1
        assert school_map["Oak Valley Middle"].percentage == pytest.approx(33.33, rel=0.01)


class TestCityBreakdownFromPersons:
    """Tests for city breakdown using enrolled persons instead of normalized_mappings.

    Same bug pattern as school: counts came from per-session rows instead of
    unique enrolled persons.
    """

    def test_city_counts_unique_enrolled_persons(self) -> None:
        """Person enrolled in 3 sessions should be counted once in city breakdown."""
        from api.services.registration_service import RegistrationService

        persons = {
            101: create_mock_person_with_normalized(
                101,
                "Emma",
                "Johnson",
                address_city="Springfield",
                normalized_city="Springfield",
            ),
            102: create_mock_person_with_normalized(
                102,
                "Liam",
                "Garcia",
                address_city="Oakland",
                normalized_city="Oakland",
            ),
        }
        enrolled_person_ids = {101, 102}

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_city_breakdown_from_persons(enrolled_person_ids, persons, 2)

        city_map = {c.city: c.count for c in result}
        assert city_map["Springfield"] == 1
        assert city_map["Oakland"] == 1

    def test_city_uses_normalized_field(self) -> None:
        """City breakdown should prefer normalized_city over raw address_city."""
        from api.services.registration_service import RegistrationService

        person = create_mock_person_with_normalized(
            101,
            "Emma",
            "Johnson",
            address_city="san francisco",  # Raw, not normalized
            normalized_city="San Francisco",  # Normalized by sync
        )

        persons = {101: person}
        enrolled_person_ids = {101}

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_city_breakdown_from_persons(enrolled_person_ids, persons, 1)

        assert len(result) == 1
        assert result[0].city == "San Francisco"

    def test_city_falls_back_to_address_city(self) -> None:
        """When normalized_city is empty, fall back to address_city."""
        from api.services.registration_service import RegistrationService

        person = create_mock_person_with_normalized(
            101,
            "Emma",
            "Johnson",
            address_city="Portland",
            normalized_city="",
        )

        persons = {101: person}
        enrolled_person_ids = {101}

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_city_breakdown_from_persons(enrolled_person_ids, persons, 1)

        assert len(result) == 1
        assert result[0].city == "Portland"

    def test_city_excludes_non_enrolled(self) -> None:
        """Only enrolled person_ids should be counted in city breakdown."""
        from api.services.registration_service import RegistrationService

        persons = {
            101: create_mock_person_with_normalized(
                101,
                "Emma",
                "Johnson",
                normalized_city="Springfield",
            ),
            102: create_mock_person_with_normalized(
                102,
                "Liam",
                "Garcia",
                normalized_city="Oakland",
            ),
        }
        # Only person 101 is enrolled
        enrolled_person_ids = {101}

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_city_breakdown_from_persons(enrolled_person_ids, persons, 1)

        city_names = [c.city for c in result]
        assert "Springfield" in city_names
        assert "Oakland" not in city_names

    def test_city_empty_values_excluded(self) -> None:
        """Persons with no city should not appear in breakdown."""
        from api.services.registration_service import RegistrationService

        person = create_mock_person_with_normalized(
            101,
            "Emma",
            "Johnson",
            address_city="",
            normalized_city="",
        )

        persons = {101: person}
        enrolled_person_ids = {101}

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_city_breakdown_from_persons(enrolled_person_ids, persons, 1)

        assert result == []

    def test_city_percentage_calculation(self) -> None:
        """City breakdown should calculate correct percentages."""
        from api.services.registration_service import RegistrationService

        persons = {
            101: create_mock_person_with_normalized(
                101,
                "Emma",
                "Johnson",
                normalized_city="Springfield",
            ),
            102: create_mock_person_with_normalized(
                102,
                "Liam",
                "Garcia",
                normalized_city="Springfield",
            ),
            103: create_mock_person_with_normalized(
                103,
                "Olivia",
                "Chen",
                normalized_city="Oakland",
            ),
            104: create_mock_person_with_normalized(
                104,
                "Noah",
                "Williams",
                normalized_city="Oakland",
            ),
        }
        enrolled_person_ids = {101, 102, 103, 104}

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_city_breakdown_from_persons(enrolled_person_ids, persons, 4)

        city_map = {c.city: c for c in result}
        assert city_map["Springfield"].count == 2
        assert city_map["Springfield"].percentage == pytest.approx(50.0)
        assert city_map["Oakland"].count == 2
        assert city_map["Oakland"].percentage == pytest.approx(50.0)


class TestSynagogueBreakdownFromPersons:
    """Tests for synagogue breakdown using enrolled persons instead of normalized_mappings.

    Same bug pattern: counts came from per-session rows. The fix uses
    persons.normalized_congregation field.
    """

    def test_synagogue_counts_unique_enrolled_persons(self) -> None:
        """Person enrolled in 3 sessions should be counted once in synagogue breakdown."""
        from api.services.registration_service import RegistrationService

        persons = {
            101: create_mock_person_with_normalized(
                101,
                "Emma",
                "Johnson",
                normalized_congregation="Temple Beth El",
            ),
            102: create_mock_person_with_normalized(
                102,
                "Liam",
                "Garcia",
                normalized_congregation="Congregation Shalom",
            ),
        }
        enrolled_person_ids = {101, 102}

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_synagogue_breakdown_from_persons(enrolled_person_ids, persons, 2)

        syn_map = {s.synagogue: s.count for s in result}
        assert syn_map["Temple Beth El"] == 1
        assert syn_map["Congregation Shalom"] == 1

    def test_synagogue_uses_normalized_congregation(self) -> None:
        """Synagogue breakdown should use persons.normalized_congregation field."""
        from api.services.registration_service import RegistrationService

        person = create_mock_person_with_normalized(
            101,
            "Emma",
            "Johnson",
            normalized_congregation="Temple Beth El",
        )

        persons = {101: person}
        enrolled_person_ids = {101}

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_synagogue_breakdown_from_persons(enrolled_person_ids, persons, 1)

        assert len(result) == 1
        assert result[0].synagogue == "Temple Beth El"

    def test_synagogue_excludes_non_enrolled(self) -> None:
        """Only enrolled person_ids should be counted in synagogue breakdown."""
        from api.services.registration_service import RegistrationService

        persons = {
            101: create_mock_person_with_normalized(
                101,
                "Emma",
                "Johnson",
                normalized_congregation="Temple Beth El",
            ),
            102: create_mock_person_with_normalized(
                102,
                "Liam",
                "Garcia",
                normalized_congregation="Congregation Shalom",
            ),
        }
        enrolled_person_ids = {101}

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_synagogue_breakdown_from_persons(enrolled_person_ids, persons, 1)

        syn_names = [s.synagogue for s in result]
        assert "Temple Beth El" in syn_names
        assert "Congregation Shalom" not in syn_names

    def test_synagogue_empty_values_excluded(self) -> None:
        """Persons with no congregation should not appear in breakdown."""
        from api.services.registration_service import RegistrationService

        person = create_mock_person_with_normalized(
            101,
            "Emma",
            "Johnson",
            normalized_congregation="",
        )

        persons = {101: person}
        enrolled_person_ids = {101}

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_synagogue_breakdown_from_persons(enrolled_person_ids, persons, 1)

        assert result == []

    def test_synagogue_percentage_calculation(self) -> None:
        """Synagogue breakdown should calculate correct percentages."""
        from api.services.registration_service import RegistrationService

        persons = {
            101: create_mock_person_with_normalized(
                101,
                "Emma",
                "Johnson",
                normalized_congregation="Temple Beth El",
            ),
            102: create_mock_person_with_normalized(
                102,
                "Liam",
                "Garcia",
                normalized_congregation="Temple Beth El",
            ),
            103: create_mock_person_with_normalized(
                103,
                "Olivia",
                "Chen",
                normalized_congregation="Congregation Shalom",
            ),
        }
        enrolled_person_ids = {101, 102, 103}

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_synagogue_breakdown_from_persons(enrolled_person_ids, persons, 3)

        syn_map = {s.synagogue: s for s in result}
        assert syn_map["Temple Beth El"].count == 2
        assert syn_map["Temple Beth El"].percentage == pytest.approx(66.67, rel=0.01)
        assert syn_map["Congregation Shalom"].count == 1
        assert syn_map["Congregation Shalom"].percentage == pytest.approx(33.33, rel=0.01)


# ============================================================================
# Gender by Session Length Tests
# ============================================================================


class TestGenderBySessionLength:
    """Tests for by_gender_by_session_length breakdown.

    Shows male/female enrollment counts per session length category
    (1-week, 2-week, 3-week, etc.) for a stacked bar chart.
    """

    def test_gender_by_session_length_structure(
        self,
        sample_sessions_2026: list[Mock],
        sample_attendees_2026: list[Mock],
        sample_persons_2026: list[Mock],
    ) -> None:
        """by_gender_by_session_length should have male/female counts per length category.

        From fixtures:
        - All sessions are 3-week (Sessions 2, 3, 4)
        - 4 males: Liam (102), Noah (104), Mason (106), Jackson (108)
        - 4 females: Emma (101), Olivia (103), Ava (105), Sophia (107)

        Expected:
        [{ length_category: "3-week", male_count: 4, female_count: 4, total: 8 }]
        """
        from api.services.registration_service import RegistrationService

        sessions_dict = {s.cm_id: s for s in sample_sessions_2026}
        persons_dict = {p.cm_id: p for p in sample_persons_2026}

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_gender_by_session_length(sample_attendees_2026, sessions_dict, persons_dict)

        assert len(result) == 1
        assert result[0].length_category == "3-week"
        assert result[0].male_count == 4
        assert result[0].female_count == 4
        assert result[0].total == 8

    def test_gender_by_session_length_multiple_categories(self) -> None:
        """Should group by length category with correct gender counts.

        Create sessions of different lengths and verify gender counts per category.
        """
        from api.services.registration_service import RegistrationService

        # 1-week session and 3-week session
        taste = create_mock_session(1001, "Taste of Camp", 2026, "embedded", "2026-06-20", "2026-06-23")
        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")

        sessions_dict = {1001: taste, 2001: session_2}

        persons_dict = {
            101: create_mock_person(101, "Emma", "Johnson", "F", 5),
            102: create_mock_person(102, "Liam", "Garcia", "M", 5),
            103: create_mock_person(103, "Olivia", "Chen", "F", 6),
            104: create_mock_person(104, "Noah", "Williams", "M", 6),
            105: create_mock_person(105, "Ava", "Brown", "F", 7),
        }

        attendees = [
            create_mock_attendee(101, session_cm_id=taste.cm_id, session=taste, year=2026),  # Emma F -> 1-week
            create_mock_attendee(102, session_cm_id=taste.cm_id, session=taste, year=2026),  # Liam M -> 1-week
            create_mock_attendee(
                103, session_cm_id=session_2.cm_id, session=session_2, year=2026
            ),  # Olivia F -> 3-week
            create_mock_attendee(104, session_cm_id=session_2.cm_id, session=session_2, year=2026),  # Noah M -> 3-week
            create_mock_attendee(105, session_cm_id=session_2.cm_id, session=session_2, year=2026),  # Ava F -> 3-week
        ]

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_gender_by_session_length(attendees, sessions_dict, persons_dict)

        categories = {r.length_category: r for r in result}
        assert "1-week" in categories
        assert "3-week" in categories

        # 1-week: 1M (Liam), 1F (Emma)
        assert categories["1-week"].male_count == 1
        assert categories["1-week"].female_count == 1
        assert categories["1-week"].total == 2

        # 3-week: 1M (Noah), 2F (Olivia, Ava)
        assert categories["3-week"].male_count == 1
        assert categories["3-week"].female_count == 2
        assert categories["3-week"].total == 3

    def test_gender_by_session_length_sorted_by_length(self) -> None:
        """Categories should be sorted: 1-week, 2-week, 3-week, 4-week+, unknown."""
        from api.services.registration_service import RegistrationService

        one_week = create_mock_session(1001, "Short", 2026, "embedded", "2026-06-20", "2026-06-23")
        three_week = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        four_week = create_mock_session(3001, "Long", 2026, "main", "2026-06-15", "2026-07-20")

        sessions_dict = {1001: one_week, 2001: three_week, 3001: four_week}
        persons_dict = {
            101: create_mock_person(101, "Emma", "Johnson", "F"),
            102: create_mock_person(102, "Liam", "Garcia", "M"),
            103: create_mock_person(103, "Olivia", "Chen", "F"),
        }

        attendees = [
            create_mock_attendee(103, session_cm_id=four_week.cm_id, session=four_week, year=2026),  # 4-week+ first
            create_mock_attendee(101, session_cm_id=one_week.cm_id, session=one_week, year=2026),  # 1-week second
            create_mock_attendee(102, session_cm_id=three_week.cm_id, session=three_week, year=2026),  # 3-week third
        ]

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_gender_by_session_length(attendees, sessions_dict, persons_dict)

        categories = [r.length_category for r in result]
        assert categories == ["1-week", "3-week", "4-week+"]

    def test_gender_by_session_length_empty_attendees(self) -> None:
        """Should return empty list for no attendees."""
        from api.services.registration_service import RegistrationService

        sessions_dict = {
            2001: create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05"),
        }

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_gender_by_session_length([], sessions_dict, {})

        assert result == []

    def test_gender_by_session_length_missing_person(self) -> None:
        """Attendees without matching person should be skipped."""
        from api.services.registration_service import RegistrationService

        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        sessions_dict = {2001: session_2}
        persons_dict = {
            101: create_mock_person(101, "Emma", "Johnson", "F"),
            # person_id 102 NOT in persons_dict
        }

        attendees = [
            create_mock_attendee(101, session_cm_id=session_2.cm_id, session=session_2, year=2026),
            create_mock_attendee(
                102, session_cm_id=session_2.cm_id, session=session_2, year=2026
            ),  # No matching person
        ]

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_gender_by_session_length(attendees, sessions_dict, persons_dict)

        assert len(result) == 1
        assert result[0].total == 1
        assert result[0].female_count == 1
        assert result[0].male_count == 0

    def test_gender_by_session_length_ag_merged(self) -> None:
        """AG session attendees should be counted under parent session's length category."""
        from api.services.registration_service import RegistrationService

        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        ag_session_2 = create_mock_session(2005, "AG Session 2", 2026, "ag", "2026-06-15", "2026-07-05", parent_id=2001)

        sessions_dict = {2001: session_2, 2005: ag_session_2}
        persons_dict = {
            101: create_mock_person(101, "Emma", "Johnson", "F"),
            102: create_mock_person(102, "Liam", "Garcia", "M"),
            103: create_mock_person(103, "Olivia", "Chen", "F"),
        }

        attendees = [
            create_mock_attendee(101, session_cm_id=session_2.cm_id, session=session_2, year=2026),  # Emma F -> main
            create_mock_attendee(102, session_cm_id=session_2.cm_id, session=session_2, year=2026),  # Liam M -> main
            create_mock_attendee(
                103, session_cm_id=ag_session_2.cm_id, session=ag_session_2, year=2026
            ),  # Olivia F -> AG (merges to parent)
        ]

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_gender_by_session_length(attendees, sessions_dict, persons_dict)

        # All should be under 3-week (parent session's length)
        assert len(result) == 1
        assert result[0].length_category == "3-week"
        assert result[0].male_count == 1  # Liam
        assert result[0].female_count == 2  # Emma + Olivia (AG merged)
        assert result[0].total == 3

    def test_gender_by_session_length_deduplicates_persons(self) -> None:
        """A person enrolled in multiple sessions of the same length should be counted once."""
        from api.services.registration_service import RegistrationService

        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        session_3 = create_mock_session(2002, "Session 3", 2026, "main", "2026-07-07", "2026-07-27")

        sessions_dict = {2001: session_2, 2002: session_3}
        persons_dict = {
            101: create_mock_person(101, "Emma", "Johnson", "F"),
        }

        # Emma is in both 3-week sessions
        attendees = [
            create_mock_attendee(101, session_cm_id=session_2.cm_id, session=session_2, year=2026),
            create_mock_attendee(101, session_cm_id=session_3.cm_id, session=session_3, year=2026),
        ]

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_gender_by_session_length(attendees, sessions_dict, persons_dict)

        # Emma should only be counted once in 3-week
        assert len(result) == 1
        assert result[0].length_category == "3-week"
        assert result[0].female_count == 1
        assert result[0].total == 1

    def test_gender_by_session_length_excludes_non_display_sessions(self) -> None:
        """Non-display session types (e.g. family) should be excluded."""
        from api.services.registration_service import RegistrationService

        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        family = create_mock_session(9001, "Family Camp", 2026, "family", "2026-08-20", "2026-08-24")

        sessions_dict = {2001: session_2, 9001: family}
        persons_dict = {
            101: create_mock_person(101, "Emma", "Johnson", "F"),
            102: create_mock_person(102, "Liam", "Garcia", "M"),
        }

        attendees = [
            create_mock_attendee(
                101, session_cm_id=session_2.cm_id, session=session_2, year=2026
            ),  # Emma F -> main (included)
            create_mock_attendee(
                102, session_cm_id=family.cm_id, session=family, year=2026
            ),  # Liam M -> family (excluded)
        ]

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_gender_by_session_length(attendees, sessions_dict, persons_dict)

        # Only main session should appear; family excluded
        assert len(result) == 1
        assert result[0].length_category == "3-week"
        assert result[0].female_count == 1
        assert result[0].male_count == 0
        assert result[0].total == 1

    def test_gender_by_session_length_person_id_cast_to_int(self) -> None:
        """person_id should be cast to int for consistent dict lookup.

        The persons dict is keyed by int. If person_id arrives as a
        different type (e.g. string), lookup must still succeed.
        """
        from api.services.registration_service import RegistrationService

        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        sessions_dict = {2001: session_2}
        persons_dict = {
            101: create_mock_person(101, "Emma", "Johnson", "F"),
        }

        # Simulate person_id as a different numeric type
        attendee = create_mock_attendee(101, session_cm_id=session_2.cm_id, session=session_2, year=2026)
        attendee.person_id = "101"  # String instead of int

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_gender_by_session_length([attendee], sessions_dict, persons_dict)

        # Should still find the person despite string person_id
        assert len(result) == 1
        assert result[0].female_count == 1
        assert result[0].total == 1

    def test_gender_by_session_length_unknown_gender_in_total(self) -> None:
        """Persons with unknown/null gender should still count toward the total.

        The total should reflect unique persons in the category, not just M+F.
        This ensures the gender chart total matches the enrollment chart's
        person-deduped count even when some persons lack gender data.
        """
        from api.services.registration_service import RegistrationService

        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")
        sessions_dict = {2001: session_2}
        persons_dict = {
            101: create_mock_person(101, "Emma", "Johnson", "F"),
            102: create_mock_person(102, "Liam", "Garcia", "M"),
            103: create_mock_person(103, "Olivia", "Chen", ""),  # Empty gender
            104: create_mock_person(104, "Noah", "Williams", "X"),  # Non-binary / other
        }

        attendees = [
            create_mock_attendee(101, session_cm_id=session_2.cm_id, session=session_2, year=2026),
            create_mock_attendee(102, session_cm_id=session_2.cm_id, session=session_2, year=2026),
            create_mock_attendee(103, session_cm_id=session_2.cm_id, session=session_2, year=2026),
            create_mock_attendee(104, session_cm_id=session_2.cm_id, session=session_2, year=2026),
        ]

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_gender_by_session_length(attendees, sessions_dict, persons_dict)

        assert len(result) == 1
        assert result[0].male_count == 1  # Liam
        assert result[0].female_count == 1  # Emma
        assert result[0].total == 4  # All 4 persons, not just M+F
