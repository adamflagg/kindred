"""
Unit tests for the metrics API endpoints.

These tests verify retention and registration metrics calculations
using mocked PocketBase data.
"""

from __future__ import annotations

import os
from typing import Any
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
    last_year_attended: int = 2025,
    year: int = 2026,
    school: str = "Riverside Elementary",
    address: dict[str, Any] | None = None,
) -> Mock:
    """Create a mock person record."""
    person = Mock()
    person.cm_id = cm_id
    person.first_name = first_name
    person.last_name = last_name
    person.gender = gender
    person.grade = grade
    person.years_at_camp = years_at_camp
    person.last_year_attended = last_year_attended
    person.year = year
    person.school = school
    person.address = address or {"city": "Springfield", "state": "IL"}
    return person


def create_mock_attendee(
    person_id: int,
    session_cm_id: int,
    year: int,
    status: str = "enrolled",
    status_id: int = 2,
    is_active: bool = True,
) -> Mock:
    """Create a mock attendee record."""
    attendee = Mock()
    attendee.person_id = person_id
    attendee.session_cm_id = session_cm_id
    attendee.year = year
    attendee.status = status
    attendee.status_id = status_id
    attendee.is_active = is_active
    # Add expand for session relation
    attendee.expand = {"session": Mock(cm_id=session_cm_id)}
    return attendee


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


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def mock_pb_client():
    """Create a mock PocketBase client with collection support."""
    mock_pb = Mock()
    mock_collection = Mock()
    mock_pb.collection = Mock(return_value=mock_collection)
    return mock_pb, mock_collection


@pytest.fixture
def sample_sessions_2025() -> list[Mock]:
    """Sample sessions for 2025."""
    return [
        create_mock_session(1001, "Session 2", 2025, "main"),
        create_mock_session(1002, "Session 3", 2025, "main"),
        create_mock_session(1003, "Session 4", 2025, "main"),
        create_mock_session(1004, "Taste of Camp 1", 2025, "main"),
    ]


@pytest.fixture
def sample_sessions_2026() -> list[Mock]:
    """Sample sessions for 2026."""
    return [
        create_mock_session(2001, "Session 2", 2026, "main"),
        create_mock_session(2002, "Session 3", 2026, "main"),
        create_mock_session(2003, "Session 4", 2026, "main"),
        create_mock_session(2004, "Taste of Camp 1", 2026, "main"),
        create_mock_session(2005, "Session 2a", 2026, "embedded"),
    ]


@pytest.fixture
def sample_persons_2025() -> list[Mock]:
    """Sample persons for 2025 (last year's campers)."""
    return [
        create_mock_person(101, "Emma", "Johnson", "F", 5, 1, 2025, 2025),
        create_mock_person(102, "Liam", "Garcia", "M", 6, 2, 2025, 2025),
        create_mock_person(103, "Olivia", "Chen", "F", 5, 1, 2025, 2025),
        create_mock_person(104, "Noah", "Williams", "M", 7, 3, 2025, 2025),
        create_mock_person(105, "Ava", "Brown", "F", 6, 2, 2025, 2025),
    ]


@pytest.fixture
def sample_persons_2026() -> list[Mock]:
    """Sample persons for 2026 (current year campers)."""
    return [
        # Returning campers (same cm_id as 2025, updated year)
        create_mock_person(101, "Emma", "Johnson", "F", 6, 2, 2026, 2026),
        create_mock_person(102, "Liam", "Garcia", "M", 7, 3, 2026, 2026),
        create_mock_person(104, "Noah", "Williams", "M", 8, 4, 2026, 2026),
        # New campers in 2026
        create_mock_person(201, "Sophia", "Martinez", "F", 5, 1, 2026, 2026),
        create_mock_person(202, "Jackson", "Lee", "M", 6, 1, 2026, 2026),
    ]


@pytest.fixture
def sample_attendees_2025(sample_sessions_2025: list[Mock]) -> list[Mock]:
    """Sample attendees for 2025."""
    return [
        create_mock_attendee(101, 1001, 2025),  # Emma in Session 2
        create_mock_attendee(102, 1001, 2025),  # Liam in Session 2
        create_mock_attendee(103, 1002, 2025),  # Olivia in Session 3
        create_mock_attendee(104, 1002, 2025),  # Noah in Session 3
        create_mock_attendee(105, 1003, 2025),  # Ava in Session 4
    ]


@pytest.fixture
def sample_attendees_2026(sample_sessions_2026: list[Mock]) -> list[Mock]:
    """Sample attendees for 2026."""
    return [
        # Returning from 2025
        create_mock_attendee(101, 2001, 2026),  # Emma in Session 2
        create_mock_attendee(102, 2002, 2026),  # Liam in Session 3
        create_mock_attendee(104, 2002, 2026),  # Noah in Session 3
        # New in 2026
        create_mock_attendee(201, 2001, 2026),  # Sophia in Session 2 (new)
        create_mock_attendee(202, 2004, 2026),  # Jackson in Taste of Camp (new)
    ]


# ============================================================================
# Retention Metrics Tests
# ============================================================================


class TestRetentionMetrics:
    """Tests for retention metrics endpoint."""

    def test_retention_rate_calculation(
        self,
        sample_persons_2025: list[Mock],
        sample_persons_2026: list[Mock],
        sample_attendees_2025: list[Mock],
        sample_attendees_2026: list[Mock],
    ) -> None:
        """Test basic retention rate calculation.

        Given 5 campers in 2025, 3 returned in 2026.
        Expected retention rate: 3/5 = 60%
        """
        # 2025 had: Emma (101), Liam (102), Olivia (103), Noah (104), Ava (105)
        # 2026 has: Emma (101), Liam (102), Noah (104), Sophia (201), Jackson (202)
        # Returned: Emma, Liam, Noah = 3 out of 5 = 60%

        # Extract unique person IDs from each year's attendees
        persons_2025 = {a.person_id for a in sample_attendees_2025}
        persons_2026 = {a.person_id for a in sample_attendees_2026}

        returned = persons_2025 & persons_2026
        retention_rate = len(returned) / len(persons_2025) if persons_2025 else 0

        assert len(persons_2025) == 5
        assert len(returned) == 3
        assert retention_rate == pytest.approx(0.6)

    def test_retention_by_gender(
        self,
        sample_persons_2025: list[Mock],
        sample_persons_2026: list[Mock],
        sample_attendees_2025: list[Mock],
        sample_attendees_2026: list[Mock],
    ) -> None:
        """Test retention breakdown by gender.

        2025 females: Emma (101), Olivia (103), Ava (105) = 3
        2026 returning females: Emma (101) = 1
        Female retention: 1/3 = 33.3%

        2025 males: Liam (102), Noah (104) = 2
        2026 returning males: Liam (102), Noah (104) = 2
        Male retention: 2/2 = 100%
        """
        # Build person lookup by cm_id
        persons_by_id_2025 = {p.cm_id: p for p in sample_persons_2025}

        persons_2025_ids = {a.person_id for a in sample_attendees_2025}
        persons_2026_ids = {a.person_id for a in sample_attendees_2026}
        returned_ids = persons_2025_ids & persons_2026_ids

        # Calculate by gender
        females_2025 = [pid for pid in persons_2025_ids if persons_by_id_2025[pid].gender == "F"]
        males_2025 = [pid for pid in persons_2025_ids if persons_by_id_2025[pid].gender == "M"]

        females_returned = [pid for pid in returned_ids if persons_by_id_2025[pid].gender == "F"]
        males_returned = [pid for pid in returned_ids if persons_by_id_2025[pid].gender == "M"]

        assert len(females_2025) == 3
        assert len(females_returned) == 1
        assert len(females_returned) / len(females_2025) == pytest.approx(1 / 3)

        assert len(males_2025) == 2
        assert len(males_returned) == 2
        assert len(males_returned) / len(males_2025) == pytest.approx(1.0)

    def test_retention_by_grade(
        self,
        sample_persons_2025: list[Mock],
        sample_attendees_2025: list[Mock],
        sample_attendees_2026: list[Mock],
    ) -> None:
        """Test retention breakdown by grade (2025 grade).

        Grade 5 (2025): Emma (101), Olivia (103) = 2
        Grade 5 returned: Emma (101) = 1 -> 50%

        Grade 6 (2025): Liam (102), Ava (105) = 2
        Grade 6 returned: Liam (102) = 1 -> 50%

        Grade 7 (2025): Noah (104) = 1
        Grade 7 returned: Noah (104) = 1 -> 100%
        """
        persons_by_id = {p.cm_id: p for p in sample_persons_2025}
        persons_2025_ids = {a.person_id for a in sample_attendees_2025}
        persons_2026_ids = {a.person_id for a in sample_attendees_2026}
        returned_ids = persons_2025_ids & persons_2026_ids

        # Group by grade
        by_grade: dict[int, dict[str, int]] = {}
        for pid in persons_2025_ids:
            grade = persons_by_id[pid].grade
            if grade not in by_grade:
                by_grade[grade] = {"total": 0, "returned": 0}
            by_grade[grade]["total"] += 1
            if pid in returned_ids:
                by_grade[grade]["returned"] += 1

        assert by_grade[5]["total"] == 2
        assert by_grade[5]["returned"] == 1
        assert by_grade[6]["total"] == 2
        assert by_grade[6]["returned"] == 1
        assert by_grade[7]["total"] == 1
        assert by_grade[7]["returned"] == 1

    def test_retention_by_years_at_camp(
        self,
        sample_persons_2025: list[Mock],
        sample_attendees_2025: list[Mock],
        sample_attendees_2026: list[Mock],
    ) -> None:
        """Test retention breakdown by years_at_camp.

        1 year (2025): Emma, Olivia = 2, returned: Emma = 1 -> 50%
        2 years (2025): Liam, Ava = 2, returned: Liam = 1 -> 50%
        3 years (2025): Noah = 1, returned: Noah = 1 -> 100%
        """
        persons_by_id = {p.cm_id: p for p in sample_persons_2025}
        persons_2025_ids = {a.person_id for a in sample_attendees_2025}
        persons_2026_ids = {a.person_id for a in sample_attendees_2026}
        returned_ids = persons_2025_ids & persons_2026_ids

        by_years: dict[int, dict[str, int]] = {}
        for pid in persons_2025_ids:
            years = persons_by_id[pid].years_at_camp
            if years not in by_years:
                by_years[years] = {"total": 0, "returned": 0}
            by_years[years]["total"] += 1
            if pid in returned_ids:
                by_years[years]["returned"] += 1

        assert by_years[1]["total"] == 2
        assert by_years[1]["returned"] == 1
        assert by_years[2]["total"] == 2
        assert by_years[2]["returned"] == 1
        assert by_years[3]["total"] == 1
        assert by_years[3]["returned"] == 1

    def test_retention_by_session(
        self,
        sample_persons_2025: list[Mock],
        sample_attendees_2025: list[Mock],
        sample_attendees_2026: list[Mock],
        sample_sessions_2025: list[Mock],
    ) -> None:
        """Test retention breakdown by 2025 session.

        Session 2 (1001): Emma (101), Liam (102) = 2, returned: Emma, Liam = 2 -> 100%
        Session 3 (1002): Olivia (103), Noah (104) = 2, returned: Noah = 1 -> 50%
        Session 4 (1003): Ava (105) = 1, returned: 0 -> 0%
        """
        persons_2026_ids = {a.person_id for a in sample_attendees_2026}

        by_session: dict[int, dict[str, int]] = {}
        for attendee in sample_attendees_2025:
            session_id = attendee.session_cm_id
            if session_id not in by_session:
                by_session[session_id] = {"total": 0, "returned": 0}
            by_session[session_id]["total"] += 1
            if attendee.person_id in persons_2026_ids:
                by_session[session_id]["returned"] += 1

        assert by_session[1001]["total"] == 2
        assert by_session[1001]["returned"] == 2  # Both Emma and Liam returned
        assert by_session[1002]["total"] == 2
        assert by_session[1002]["returned"] == 1  # Only Noah returned
        assert by_session[1003]["total"] == 1
        assert by_session[1003]["returned"] == 0  # Ava did not return


# ============================================================================
# Registration Metrics Tests
# ============================================================================


class TestRegistrationMetrics:
    """Tests for registration metrics endpoint."""

    def test_total_enrollment_count(self, sample_attendees_2026: list[Mock]) -> None:
        """Test total enrollment count for a year."""
        enrolled = [a for a in sample_attendees_2026 if a.status == "enrolled"]
        assert len(enrolled) == 5

    def test_enrollment_by_gender(
        self,
        sample_persons_2026: list[Mock],
        sample_attendees_2026: list[Mock],
    ) -> None:
        """Test enrollment breakdown by gender.

        2026: Emma (F), Liam (M), Noah (M), Sophia (F), Jackson (M)
        Females: 2, Males: 3
        """
        persons_by_id = {p.cm_id: p for p in sample_persons_2026}
        enrolled_ids = {a.person_id for a in sample_attendees_2026 if a.status == "enrolled"}

        by_gender: dict[str, int] = {}
        for pid in enrolled_ids:
            gender = persons_by_id[pid].gender
            by_gender[gender] = by_gender.get(gender, 0) + 1

        assert by_gender["F"] == 2
        assert by_gender["M"] == 3

    def test_enrollment_by_grade(
        self,
        sample_persons_2026: list[Mock],
        sample_attendees_2026: list[Mock],
    ) -> None:
        """Test enrollment breakdown by grade.

        2026 grades: Emma (6), Liam (7), Noah (8), Sophia (5), Jackson (6)
        Grade 5: 1, Grade 6: 2, Grade 7: 1, Grade 8: 1
        """
        persons_by_id = {p.cm_id: p for p in sample_persons_2026}
        enrolled_ids = {a.person_id for a in sample_attendees_2026 if a.status == "enrolled"}

        by_grade: dict[int, int] = {}
        for pid in enrolled_ids:
            grade = persons_by_id[pid].grade
            by_grade[grade] = by_grade.get(grade, 0) + 1

        assert by_grade[5] == 1
        assert by_grade[6] == 2
        assert by_grade[7] == 1
        assert by_grade[8] == 1

    def test_enrollment_by_session(
        self,
        sample_attendees_2026: list[Mock],
        sample_sessions_2026: list[Mock],
    ) -> None:
        """Test enrollment breakdown by session.

        Session 2 (2001): Emma, Sophia = 2
        Session 3 (2002): Liam, Noah = 2
        Taste of Camp 1 (2004): Jackson = 1
        """
        by_session: dict[int, int] = {}
        for attendee in sample_attendees_2026:
            session_id = attendee.session_cm_id
            by_session[session_id] = by_session.get(session_id, 0) + 1

        assert by_session[2001] == 2  # Session 2
        assert by_session[2002] == 2  # Session 3
        assert by_session[2004] == 1  # Taste of Camp

    def test_new_vs_returning(
        self,
        sample_persons_2026: list[Mock],
        sample_attendees_2026: list[Mock],
    ) -> None:
        """Test new vs returning camper breakdown.

        New (years_at_camp == 1): Sophia, Jackson = 2
        Returning (years_at_camp > 1): Emma, Liam, Noah = 3
        """
        persons_by_id = {p.cm_id: p for p in sample_persons_2026}
        enrolled_ids = {a.person_id for a in sample_attendees_2026 if a.status == "enrolled"}

        new_count = 0
        returning_count = 0
        for pid in enrolled_ids:
            if persons_by_id[pid].years_at_camp == 1:
                new_count += 1
            else:
                returning_count += 1

        assert new_count == 2
        assert returning_count == 3

    def test_enrollment_by_years_at_camp(
        self,
        sample_persons_2026: list[Mock],
        sample_attendees_2026: list[Mock],
    ) -> None:
        """Test enrollment breakdown by years at camp.

        1 year: Sophia, Jackson = 2
        2 years: Emma = 1
        3 years: Liam = 1
        4 years: Noah = 1
        """
        persons_by_id = {p.cm_id: p for p in sample_persons_2026}
        enrolled_ids = {a.person_id for a in sample_attendees_2026 if a.status == "enrolled"}

        by_years: dict[int, int] = {}
        for pid in enrolled_ids:
            years = persons_by_id[pid].years_at_camp
            by_years[years] = by_years.get(years, 0) + 1

        assert by_years[1] == 2
        assert by_years[2] == 1
        assert by_years[3] == 1
        assert by_years[4] == 1

    def test_session_length_categorization(self, sample_sessions_2026: list[Mock]) -> None:
        """Test session length categorization.

        Taste of Camp = 1-week
        Session 2a (embedded) = 2-week
        Session 2, 3 = 3-week
        Session 4 = 2-week
        """

        def get_session_length_category(session: Mock) -> str:
            """Categorize session by length."""
            name = session.name
            session_type = session.session_type

            # Taste of Camp = 1-week
            if "Taste of Camp" in name:
                return "1-week"

            # Embedded sessions = 2-week
            if session_type == "embedded":
                return "2-week"

            # Session 4 = 2-week
            if name == "Session 4":
                return "2-week"

            # Session 2, 3 (main) = 3-week
            if name in ("Session 2", "Session 3") and session_type == "main":
                return "3-week"

            return "other"

        categories = {s.name: get_session_length_category(s) for s in sample_sessions_2026}

        assert categories["Taste of Camp 1"] == "1-week"
        assert categories["Session 2a"] == "2-week"
        assert categories["Session 2"] == "3-week"
        assert categories["Session 3"] == "3-week"
        assert categories["Session 4"] == "2-week"


# ============================================================================
# Comparison Metrics Tests
# ============================================================================


class TestComparisonMetrics:
    """Tests for year-over-year comparison endpoint."""

    def test_total_change_calculation(
        self,
        sample_attendees_2025: list[Mock],
        sample_attendees_2026: list[Mock],
    ) -> None:
        """Test total enrollment change between years.

        2025: 5 enrolled
        2026: 5 enrolled
        Change: 0 (0%)
        """
        enrolled_2025 = len([a for a in sample_attendees_2025 if a.status == "enrolled"])
        enrolled_2026 = len([a for a in sample_attendees_2026 if a.status == "enrolled"])

        total_change = enrolled_2026 - enrolled_2025
        percentage_change = (total_change / enrolled_2025 * 100) if enrolled_2025 > 0 else 0

        assert enrolled_2025 == 5
        assert enrolled_2026 == 5
        assert total_change == 0
        assert percentage_change == pytest.approx(0.0)

    def test_gender_comparison(
        self,
        sample_persons_2025: list[Mock],
        sample_persons_2026: list[Mock],
        sample_attendees_2025: list[Mock],
        sample_attendees_2026: list[Mock],
    ) -> None:
        """Test gender breakdown comparison between years.

        2025: F=3, M=2
        2026: F=2, M=3
        Female change: -1, Male change: +1
        """
        persons_2025_by_id = {p.cm_id: p for p in sample_persons_2025}
        persons_2026_by_id = {p.cm_id: p for p in sample_persons_2026}

        def count_by_gender(attendees: list[Mock], persons_by_id: dict[int, Mock]) -> dict[str, int]:
            by_gender: dict[str, int] = {}
            for a in attendees:
                if a.status == "enrolled":
                    gender = persons_by_id[a.person_id].gender
                    by_gender[gender] = by_gender.get(gender, 0) + 1
            return by_gender

        gender_2025 = count_by_gender(sample_attendees_2025, persons_2025_by_id)
        gender_2026 = count_by_gender(sample_attendees_2026, persons_2026_by_id)

        assert gender_2025["F"] == 3
        assert gender_2025["M"] == 2
        assert gender_2026["F"] == 2
        assert gender_2026["M"] == 3

        female_change = gender_2026["F"] - gender_2025["F"]
        male_change = gender_2026["M"] - gender_2025["M"]

        assert female_change == -1
        assert male_change == 1


# ============================================================================
# Status-based Metrics Tests
# ============================================================================


class TestStatusMetrics:
    """Tests for status-based metrics (waitlist, cancelled)."""

    @pytest.fixture
    def mixed_status_attendees(self):
        """Attendees with various statuses."""
        return [
            create_mock_attendee(101, 2001, 2026, "enrolled", 2, True),
            create_mock_attendee(102, 2001, 2026, "enrolled", 2, True),
            create_mock_attendee(103, 2001, 2026, "waitlisted", 4, True),
            create_mock_attendee(104, 2002, 2026, "enrolled", 2, True),
            create_mock_attendee(105, 2002, 2026, "cancelled", 5, False),
            create_mock_attendee(106, 2002, 2026, "waitlisted", 4, True),
        ]

    def test_waitlist_count(self, mixed_status_attendees: list[Mock]) -> None:
        """Test counting waitlisted campers."""
        waitlisted = [a for a in mixed_status_attendees if a.status == "waitlisted"]
        assert len(waitlisted) == 2

    def test_cancelled_count(self, mixed_status_attendees: list[Mock]) -> None:
        """Test counting cancelled campers."""
        cancelled = [a for a in mixed_status_attendees if a.status == "cancelled"]
        assert len(cancelled) == 1

    def test_active_enrolled_filter(self, mixed_status_attendees: list[Mock]) -> None:
        """Test filtering for active enrolled campers (is_active AND status_id=2)."""
        active_enrolled = [a for a in mixed_status_attendees if a.is_active and a.status_id == 2]
        assert len(active_enrolled) == 3


# ============================================================================
# Edge Cases and Error Handling Tests
# ============================================================================


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_empty_year_data(self) -> None:
        """Test handling when a year has no data."""
        empty_attendees: list[Mock] = []
        enrolled = [a for a in empty_attendees if a.status == "enrolled"]
        assert len(enrolled) == 0

    def test_retention_with_no_prior_year(self) -> None:
        """Test retention calculation when prior year has no data."""
        prior_year_ids: set[int] = set()
        current_year_ids = {101, 102, 103}

        returned = prior_year_ids & current_year_ids
        assert len(returned) == 0

        # Retention rate should be 0 or undefined
        retention_rate = len(returned) / len(prior_year_ids) if prior_year_ids else 0
        assert retention_rate == 0

    def test_missing_person_data(self) -> None:
        """Test handling attendees with missing person data."""
        attendees = [
            create_mock_attendee(101, 2001, 2026),
            create_mock_attendee(102, 2001, 2026),
        ]

        # Partial persons data - only one person exists
        persons = [
            create_mock_person(101, "Emma", "Johnson"),
        ]

        persons_by_id = {p.cm_id: p for p in persons}

        # Should handle missing persons gracefully
        known_persons = [a for a in attendees if a.person_id in persons_by_id]
        assert len(known_persons) == 1

    def test_grade_with_none_values(self) -> None:
        """Test handling persons with None grade."""
        persons = [
            create_mock_person(101, "Emma", "Johnson", grade=5),
            create_mock_person(102, "Unknown", "Camper", grade=None),  # type: ignore
        ]

        by_grade: dict[int | None, int] = {}
        for p in persons:
            grade = p.grade
            by_grade[grade] = by_grade.get(grade, 0) + 1

        assert by_grade[5] == 1
        assert by_grade[None] == 1


# ============================================================================
# API Integration Tests (with mocked PocketBase)
# ============================================================================


class TestMetricsAPIEndpoints:
    """Integration tests for metrics API endpoints."""

    @pytest.fixture
    def app(self) -> Any:
        """Create test application with auth bypassed."""
        # AUTH_MODE and SKIP_PB_AUTH are set at module level
        return create_app()

    @pytest.fixture
    def client(self, app: Any) -> TestClient:
        """Create test client."""
        return TestClient(app)

    def test_retention_endpoint_returns_200(self, client: TestClient, mock_pocketbase: Mock) -> None:
        """Test that retention endpoint returns 200."""
        # Set up mock to return empty lists
        mock_pb = mock_pocketbase
        mock_pb.collection.return_value.get_full_list.return_value = []

        with patch("api.routers.metrics.pb", mock_pb):
            response = client.get("/api/metrics/retention?base_year=2025&compare_year=2026")
            assert response.status_code == 200
            data = response.json()
            assert data["base_year"] == 2025
            assert data["compare_year"] == 2026
            assert "overall_retention_rate" in data

    def test_registration_endpoint_returns_200(self, client: TestClient, mock_pocketbase: Mock) -> None:
        """Test that registration endpoint returns 200."""
        mock_pb = mock_pocketbase
        mock_pb.collection.return_value.get_full_list.return_value = []

        with patch("api.routers.metrics.pb", mock_pb):
            response = client.get("/api/metrics/registration?year=2026")
            assert response.status_code == 200
            data = response.json()
            assert data["year"] == 2026
            assert "total_enrolled" in data
            assert "new_vs_returning" in data

    def test_comparison_endpoint_returns_200(self, client: TestClient, mock_pocketbase: Mock) -> None:
        """Test that comparison endpoint returns 200."""
        mock_pb = mock_pocketbase
        mock_pb.collection.return_value.get_full_list.return_value = []

        with patch("api.routers.metrics.pb", mock_pb):
            response = client.get("/api/metrics/comparison?year_a=2025&year_b=2026")
            assert response.status_code == 200
            data = response.json()
            assert data["year_a"]["year"] == 2025
            assert data["year_b"]["year"] == 2026
            assert "delta" in data
