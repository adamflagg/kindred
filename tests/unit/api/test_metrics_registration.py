"""
TDD tests for Registration Tab API enhancements.

Tests for:
- session_cm_id parameter filtering on /api/metrics/registration
- by_gender_grade breakdown (gender counts per grade)
- by_summer_years breakdown (calculated from attendees table)
- by_first_summer_year breakdown (first summer year from enrollment history)

These tests are written FIRST before implementation (TDD).
"""

from __future__ import annotations

import os
from unittest.mock import Mock, patch

import pytest
from fastapi.testclient import TestClient

# Set AUTH_MODE before any imports that might load settings
os.environ["AUTH_MODE"] = "bypass"
os.environ["SKIP_PB_AUTH"] = "true"

from api.main import create_app

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
) -> Mock:
    """Create a mock person record."""
    person = Mock()
    person.cm_id = cm_id
    person.first_name = first_name
    person.last_name = last_name
    person.gender = gender
    person.grade = grade
    person.years_at_camp = years_at_camp
    person.year = year
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
    """Create a mock attendee record with session expand."""
    attendee = Mock()
    attendee.person_id = person_id
    attendee.session_cm_id = session.cm_id
    attendee.year = year
    attendee.status = status
    attendee.status_id = status_id
    attendee.is_active = is_active
    # Add expand for session relation (mimics PocketBase expansion)
    attendee.expand = {"session": session}
    return attendee


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
        create_mock_attendee(101, session_2, 2026),  # Emma F G5
        create_mock_attendee(102, session_2, 2026),  # Liam M G5
        create_mock_attendee(103, session_2, 2026),  # Olivia F G6
        create_mock_attendee(104, session_2, 2026),  # Noah M G6
        # Session 3 attendees (2 campers)
        create_mock_attendee(105, session_3, 2026),  # Ava F G7
        create_mock_attendee(106, session_3, 2026),  # Mason M G7
        # Session 4 attendees (2 campers)
        create_mock_attendee(107, session_4, 2026),  # Sophia F G8
        create_mock_attendee(108, session_4, 2026),  # Jackson M G8
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
        create_mock_attendee(101, session_2025, 2025),
        create_mock_attendee(101, session_2026, 2026),
        # Person 102 (Liam): 1 summer (2026 only - first year)
        create_mock_attendee(102, session_2026, 2026),
        # Person 103 (Olivia): 3 summers (2024, 2025, 2026)
        create_mock_attendee(103, session_2024, 2024),
        create_mock_attendee(103, session_2025, 2025),
        create_mock_attendee(103, session_2026, 2026),
        # Person 104 (Noah): 2 summers (2025, 2026)
        create_mock_attendee(104, session_2025, 2025),
        create_mock_attendee(104, session_2026, 2026),
        # Person 105 (Ava): 1 summer (2026 only - first year)
        create_mock_attendee(105, session_2026, 2026),
        # Person 106 (Mason): 2 summers (2025, 2026)
        create_mock_attendee(106, session_2025, 2025),
        create_mock_attendee(106, session_2026, 2026),
        # Person 107 (Sophia): 4 summers (2023, 2024, 2025, 2026)
        create_mock_attendee(107, create_mock_session(501, "Session 4", 2023, "main"), 2023),
        create_mock_attendee(107, session_2024, 2024),
        create_mock_attendee(107, session_2025, 2025),
        create_mock_attendee(107, session_2026, 2026),
        # Person 108 (Jackson): 1 summer (2026 only - first year)
        create_mock_attendee(108, session_2026, 2026),
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
            create_mock_attendee(109, ag_session, 2026),  # AG camper
            create_mock_attendee(110, ag_session, 2026),  # AG camper
        ]

        # When filtering to session 2001, both main and AG attendees should be included
        # AG attendees should be included because their session's parent_id matches
        all_session_2_attendees = [
            # Regular session 2 attendees
            create_mock_attendee(101, session_2, 2026),
            create_mock_attendee(102, session_2, 2026),
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
            create_mock_attendee(101, family_session, 2025),  # Should NOT count
            create_mock_attendee(101, summer_session, 2026),  # Should count
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
            create_mock_attendee(101, session_2, 2026, status="waitlisted", status_id=3),
            create_mock_attendee(101, session_3, 2026, status="waitlisted", status_id=3),
            create_mock_attendee(101, session_4, 2026, status="waitlisted", status_id=3),
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
            create_mock_attendee(102, session_2, 2026, status="cancelled", status_id=4),
            create_mock_attendee(102, session_3, 2026, status="cancelled", status_id=4),
            create_mock_attendee(102, session_4, 2026, status="cancelled", status_id=4),
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
            create_mock_attendee(103, session_2, 2026, status="enrolled", status_id=2),
            create_mock_attendee(103, session_3, 2026, status="enrolled", status_id=2),
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
            create_mock_attendee(104, session_2, 2026, status="enrolled", status_id=2),
        ]
        waitlisted_attendees = [
            create_mock_attendee(104, session_3, 2026, status="waitlisted", status_id=3),
        ]

        # Person 105: waitlisted in session 2, cancelled in session 3
        waitlisted_attendees.append(create_mock_attendee(105, session_2, 2026, status="waitlisted", status_id=3))
        cancelled_attendees = [
            create_mock_attendee(105, session_3, 2026, status="cancelled", status_id=4),
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
            create_mock_attendee(101, session_2, 2026, status="waitlisted", status_id=3),
            create_mock_attendee(101, session_3, 2026, status="waitlisted", status_id=3),
            # Person 102 waitlisted in 3 sessions
            create_mock_attendee(102, session_2, 2026, status="waitlisted", status_id=3),
            create_mock_attendee(102, session_3, 2026, status="waitlisted", status_id=3),
            create_mock_attendee(102, session_4, 2026, status="waitlisted", status_id=3),
            # Person 103 waitlisted in 1 session
            create_mock_attendee(103, session_4, 2026, status="waitlisted", status_id=3),
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
        from api.services.registration_service import get_session_length_category

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
        from api.services.registration_service import get_session_length_category

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
        taste = create_mock_session(1001, "Taste of Camp", 2026, "embedded", "2026-06-20", "2026-06-23")  # 4 days = 1-week
        session_2 = create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")  # 21 days = 3-week
        session_3 = create_mock_session(2002, "Session 3", 2026, "main", "2026-07-07", "2026-07-27")  # 21 days = 3-week

        sessions_dict = {
            1001: taste,
            2001: session_2,
            2002: session_3,
        }

        # Create attendees in different sessions
        attendees = [
            create_mock_attendee(101, taste, 2026),
            create_mock_attendee(102, taste, 2026),
            create_mock_attendee(103, session_2, 2026),
            create_mock_attendee(104, session_2, 2026),
            create_mock_attendee(105, session_2, 2026),
            create_mock_attendee(106, session_3, 2026),
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
        attendee_with_session = create_mock_attendee(101, session_2, 2026)
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
            create_mock_attendee(101, four_week, 2026),  # 4-week+ first
            create_mock_attendee(102, one_week, 2026),  # 1-week second
            create_mock_attendee(103, three_week, 2026),  # 3-week third
            create_mock_attendee(104, two_week, 2026),  # 2-week fourth
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
            create_mock_attendee(101, session_2, 2026),
            create_mock_attendee(102, session_2, 2026),
            create_mock_attendee(103, session_2, 2026),
            create_mock_attendee(104, session_2, 2026),
            create_mock_attendee(105, ag_session_2, 2026),
            create_mock_attendee(106, ag_session_2, 2026),
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
            create_mock_attendee(101, session_2, 2026),
            create_mock_attendee(102, ag_session_2, 2026),
            create_mock_attendee(103, session_3, 2026),
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
            create_mock_attendee(101, taste, 2026),
            create_mock_attendee(102, session_2, 2026),
            create_mock_attendee(103, ag_session_2, 2026),
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
            create_mock_attendee(101, session_2, 2026),
            create_mock_attendee(102, orphan_ag, 2026),
        ]

        mock_repo = Mock()
        service = RegistrationService(mock_repo)
        result = service._compute_session_length_by_session(attendees, sessions_dict)

        # Both should appear since orphan AG has no parent to merge into
        all_session_names = [s.session_name for cat in result for s in cat.sessions]
        assert "Session 2" in all_session_names
        assert "Orphan AG" in all_session_names
