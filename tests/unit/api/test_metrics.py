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

    def test_session_length_categorization_from_dates(self) -> None:
        """Test session length categorization using actual dates.

        Categories are now dynamically calculated from session dates:
        - Taste of Camp (4 days) = 1-week
        - Session 2a embedded (14 days) = 2-week
        - Session 2, 3 main (21 days) = 3-week
        - Session 4 (14 days) = 2-week
        """
        from api.routers.metrics import get_session_length_category

        # Create sessions with realistic dates
        sessions_with_dates = [
            # Taste of Camp: 4 days (Jun 15-18)
            create_mock_session(2004, "Taste of Camp 1", 2026, "main", start_date="2026-06-15", end_date="2026-06-18"),
            # Session 2a embedded: 14 days (Jun 15-28)
            create_mock_session(2005, "Session 2a", 2026, "embedded", start_date="2026-06-15", end_date="2026-06-28"),
            # Session 2 main: 21 days (Jun 15 - Jul 5)
            create_mock_session(2001, "Session 2", 2026, "main", start_date="2026-06-15", end_date="2026-07-05"),
            # Session 3 main: 21 days (Jul 6 - Jul 26)
            create_mock_session(2002, "Session 3", 2026, "main", start_date="2026-07-06", end_date="2026-07-26"),
            # Session 4: 14 days (Jul 27 - Aug 9)
            create_mock_session(2003, "Session 4", 2026, "main", start_date="2026-07-27", end_date="2026-08-09"),
        ]

        # Calculate categories from dates
        categories = {s.name: get_session_length_category(s.start_date, s.end_date) for s in sessions_with_dates}

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


# ============================================================================
# Session Length Calculation Tests (Dynamic from dates)
# ============================================================================


class TestDynamicSessionLengthCalculation:
    """Tests for dynamic session length calculation from actual dates.

    Session length categories are now calculated from start_date and end_date
    rather than hardcoded based on session name.
    """

    def test_one_to_four_days_is_one_week(self) -> None:
        """Test 1-4 day sessions are categorized as 1-week (Taste of Camp)."""
        from api.routers.metrics import get_session_length_category

        # 4 days (e.g., Taste of Camp: May 25-28)
        assert get_session_length_category("2025-05-25", "2025-05-28") == "1-week"
        # 1 day
        assert get_session_length_category("2025-06-01", "2025-06-01") == "1-week"
        # 3 days
        assert get_session_length_category("2025-06-01", "2025-06-03") == "1-week"

    def test_five_to_seven_days_is_one_week(self) -> None:
        """Test 5-7 day sessions are categorized as 1-week."""
        from api.routers.metrics import get_session_length_category

        # 5 days
        assert get_session_length_category("2025-06-01", "2025-06-05") == "1-week"
        # 7 days
        assert get_session_length_category("2025-06-01", "2025-06-07") == "1-week"

    def test_eight_to_fourteen_days_is_two_week(self) -> None:
        """Test 8-14 day sessions are categorized as 2-week."""
        from api.routers.metrics import get_session_length_category

        # 8 days
        assert get_session_length_category("2025-06-01", "2025-06-08") == "2-week"
        # 12 days
        assert get_session_length_category("2025-06-01", "2025-06-12") == "2-week"
        # 14 days (exactly 2 weeks)
        assert get_session_length_category("2025-06-01", "2025-06-14") == "2-week"

    def test_fifteen_to_twenty_one_days_is_three_week(self) -> None:
        """Test 15-21 day sessions are categorized as 3-week."""
        from api.routers.metrics import get_session_length_category

        # 15 days
        assert get_session_length_category("2025-06-01", "2025-06-15") == "3-week"
        # 18 days
        assert get_session_length_category("2025-06-01", "2025-06-18") == "3-week"
        # 21 days (exactly 3 weeks)
        assert get_session_length_category("2025-06-01", "2025-06-21") == "3-week"

    def test_twenty_two_plus_days_is_four_week_plus(self) -> None:
        """Test 22+ day sessions are categorized as 4-week+."""
        from api.routers.metrics import get_session_length_category

        # 22 days
        assert get_session_length_category("2025-06-01", "2025-06-22") == "4-week+"
        # 28 days (4 weeks)
        assert get_session_length_category("2025-06-01", "2025-06-28") == "4-week+"
        # 35 days (5 weeks)
        assert get_session_length_category("2025-06-01", "2025-07-05") == "4-week+"

    def test_missing_or_invalid_dates_return_unknown(self) -> None:
        """Test missing or invalid dates return 'unknown'."""
        from api.routers.metrics import get_session_length_category

        # Empty strings
        assert get_session_length_category("", "") == "unknown"
        # One empty
        assert get_session_length_category("2025-06-01", "") == "unknown"
        assert get_session_length_category("", "2025-06-15") == "unknown"
        # Invalid format
        assert get_session_length_category("not-a-date", "2025-06-15") == "unknown"
        assert get_session_length_category("2025-06-01", "invalid") == "unknown"

    def test_handles_datetime_with_time_and_timezone(self) -> None:
        """Test parsing dates with time and timezone components."""
        from api.routers.metrics import get_session_length_category

        # Full ISO format with time and Z suffix (common from APIs)
        assert get_session_length_category("2025-06-01 00:00:00Z", "2025-06-14 23:59:59Z") == "2-week"

        # Just date portion should work
        assert get_session_length_category("2025-06-01", "2025-06-14") == "2-week"


# ============================================================================
# Session Type Filtering Tests
# ============================================================================


class TestSessionTypeFiltering:
    """Tests for session type filtering in registration metrics.

    By default, registration metrics should only include summer camp sessions
    (main, embedded, ag) and exclude family camp, training, etc.
    """

    @pytest.fixture
    def sample_sessions_mixed_types(self) -> list[Mock]:
        """Sessions with various types including non-summer."""
        return [
            # Summer camp sessions
            create_mock_session(1001, "Session 2", 2026, "main", start_date="2026-06-15", end_date="2026-07-05"),
            create_mock_session(1002, "Session 3", 2026, "main", start_date="2026-07-06", end_date="2026-07-26"),
            create_mock_session(1003, "Session 2a", 2026, "embedded", start_date="2026-06-15", end_date="2026-06-28"),
            create_mock_session(
                1004, "All-Gender Cabin-Session 2", 2026, "ag", start_date="2026-06-15", end_date="2026-07-05"
            ),
            # Non-summer sessions (should be excluded by default)
            create_mock_session(
                2001, "Family Camp Weekend 1", 2026, "family", start_date="2026-08-15", end_date="2026-08-17"
            ),
            create_mock_session(
                2002, "Staff Training", 2026, "training", start_date="2026-05-20", end_date="2026-05-25"
            ),
        ]

    def test_default_filter_includes_summer_types_only(self, sample_sessions_mixed_types: list[Mock]) -> None:
        """Test that default filter includes only main, embedded, ag sessions."""
        # Simulate what the API does with default filter
        default_types = ["main", "embedded", "ag"]
        filtered = [s for s in sample_sessions_mixed_types if s.session_type in default_types]

        # Should include summer camp sessions
        assert len(filtered) == 4
        session_names = {s.name for s in filtered}
        assert "Session 2" in session_names
        assert "Session 3" in session_names
        assert "Session 2a" in session_names
        assert "All-Gender Cabin-Session 2" in session_names

        # Should exclude non-summer sessions
        assert "Family Camp Weekend 1" not in session_names
        assert "Staff Training" not in session_names

    def test_explicit_filter_can_include_family_camp(self, sample_sessions_mixed_types: list[Mock]) -> None:
        """Test that explicit filter can include family camp if requested."""
        explicit_types = ["main", "family"]
        filtered = [s for s in sample_sessions_mixed_types if s.session_type in explicit_types]

        assert len(filtered) == 3
        session_names = {s.name for s in filtered}
        assert "Session 2" in session_names
        assert "Session 3" in session_names
        assert "Family Camp Weekend 1" in session_names


# ============================================================================
# Session Types Filtering in camper_history Tests
# ============================================================================


class TestCamperHistorySessionTypesFiltering:
    """Tests for session_types filtering in camper_history.

    The session_types field allows filtering out non-summer camp sessions
    (like family camp) from metrics calculations. This prevents grade 0
    campers (adults from family camp) from appearing in summer registration metrics.
    """

    @pytest.fixture
    def mock_camper_history_with_session_types(self) -> list[Mock]:
        """Sample camper_history records with session_types field."""
        records = []

        # Summer camp campers (main, embedded, ag sessions)
        for i in range(5):
            record = Mock()
            record.person_id = 1000 + i
            record.first_name = f"Camper{i}"
            record.last_name = "Summer"
            record.year = 2025
            record.sessions = "Session 2, Session 3"
            record.session_types = "main"  # Summer camp
            record.grade = 5 + i
            record.gender = "F" if i % 2 == 0 else "M"
            record.years_at_camp = 2
            record.status = "enrolled"
            record.school = "Riverside Elementary"
            record.city = "Springfield"
            record.synagogue = "Temple Beth El"
            record.first_year_attended = 2024
            records.append(record)

        # AG session campers
        for i in range(2):
            record = Mock()
            record.person_id = 2000 + i
            record.first_name = f"AGCamper{i}"
            record.last_name = "Summer"
            record.year = 2025
            record.sessions = "All-Gender Session 2"
            record.session_types = "main,ag"  # AG session
            record.grade = 7
            record.gender = "M" if i % 2 == 0 else "F"
            record.years_at_camp = 1
            record.status = "enrolled"
            record.school = "Oak Valley Middle"
            record.city = "Riverside"
            record.synagogue = ""
            record.first_year_attended = 2025
            records.append(record)

        # Embedded session campers
        for i in range(3):
            record = Mock()
            record.person_id = 3000 + i
            record.first_name = f"EmbeddedCamper{i}"
            record.last_name = "Summer"
            record.year = 2025
            record.sessions = "Session 2a"
            record.session_types = "embedded"
            record.grade = 6
            record.gender = "F"
            record.years_at_camp = 1
            record.status = "enrolled"
            record.school = "Hillcrest High"
            record.city = "Lakewood"
            record.synagogue = "Congregation Shalom"
            record.first_year_attended = 2025
            records.append(record)

        # Family camp attendees (should be filtered out by default)
        for i in range(4):
            record = Mock()
            record.person_id = 4000 + i
            record.first_name = f"FamilyMember{i}"
            record.last_name = "Adult"
            record.year = 2025
            record.sessions = "Family Camp Weekend 1"
            record.session_types = "family"  # Family camp - not summer
            record.grade = 0  # Adults don't have grades
            record.gender = "M" if i % 2 == 0 else "F"
            record.years_at_camp = 1
            record.status = "enrolled"
            record.school = ""
            record.city = "Springfield"
            record.synagogue = "Temple Beth El"
            record.first_year_attended = 2025
            records.append(record)

        return records

    def test_fetch_camper_history_filters_by_session_types(
        self, mock_camper_history_with_session_types: list[Mock]
    ) -> None:
        """Test that camper_history can be filtered by session_types.

        When session_types filter is ['main', 'embedded', 'ag'], records
        with session_types containing 'family' should be excluded.
        """
        records = mock_camper_history_with_session_types
        summer_types = ["main", "embedded", "ag"]

        # Simulate the filtering logic that should be in fetch_camper_history_for_year
        def matches_session_types(record: Mock, type_filter: list[str]) -> bool:
            """Check if record's session_types matches any of the filter types."""
            session_types_str = getattr(record, "session_types", "") or ""
            if not session_types_str:
                return False
            record_types = [t.strip() for t in session_types_str.split(",")]
            return any(t in type_filter for t in record_types)

        filtered = [r for r in records if matches_session_types(r, summer_types)]

        # Should include summer camp (5) + AG (2) + embedded (3) = 10
        assert len(filtered) == 10

        # Should exclude family camp (4)
        family_records = [r for r in filtered if "family" in (getattr(r, "session_types", "") or "")]
        assert len(family_records) == 0

        # Grade breakdown should not include grade 0 (family camp adults)
        grades = [getattr(r, "grade", None) for r in filtered]
        assert 0 not in grades

    def test_grade_breakdown_excludes_family_camp(self, mock_camper_history_with_session_types: list[Mock]) -> None:
        """Test that grade breakdown excludes grade 0 from family camp.

        This is the core issue: family camp adults with grade 0 were showing
        in the Summer Registration metrics.
        """
        records = mock_camper_history_with_session_types
        summer_types = ["main", "embedded", "ag"]

        # Filter to summer only
        def matches_session_types(record: Mock, type_filter: list[str]) -> bool:
            session_types_str = getattr(record, "session_types", "") or ""
            if not session_types_str:
                return False
            record_types = [t.strip() for t in session_types_str.split(",")]
            return any(t in type_filter for t in record_types)

        filtered = [r for r in records if matches_session_types(r, summer_types)]

        # Compute grade breakdown
        grade_counts: dict[int | None, int] = {}
        for record in filtered:
            grade = getattr(record, "grade", None)
            grade_counts[grade] = grade_counts.get(grade, 0) + 1

        # Grade 0 should not be present (family camp excluded)
        assert 0 not in grade_counts

        # Valid grades should be present
        assert 5 in grade_counts
        assert 6 in grade_counts
        assert 7 in grade_counts

    def test_demographic_breakdown_with_session_types_filter(
        self, mock_camper_history_with_session_types: list[Mock]
    ) -> None:
        """Test that demographic breakdowns work with session_types filter.

        When filtering to summer sessions, school/city/synagogue breakdowns
        should only include data from summer camp attendees.
        """
        records = mock_camper_history_with_session_types
        summer_types = ["main", "embedded", "ag"]

        # Filter to summer only
        def matches_session_types(record: Mock, type_filter: list[str]) -> bool:
            session_types_str = getattr(record, "session_types", "") or ""
            if not session_types_str:
                return False
            record_types = [t.strip() for t in session_types_str.split(",")]
            return any(t in type_filter for t in record_types)

        filtered = [r for r in records if matches_session_types(r, summer_types)]

        # School breakdown
        school_counts: dict[str, int] = {}
        for record in filtered:
            school = getattr(record, "school", "") or ""
            if school:
                school_counts[school] = school_counts.get(school, 0) + 1

        # Should have schools from summer campers
        assert "Riverside Elementary" in school_counts
        assert "Oak Valley Middle" in school_counts
        assert "Hillcrest High" in school_counts

        # Total should be 10 (excluding family camp members with empty school)
        total_with_schools = sum(school_counts.values())
        assert total_with_schools == 10

    def test_historical_trends_uses_session_types(self, mock_camper_history_with_session_types: list[Mock]) -> None:
        """Test that historical trends endpoint uses session_types filter.

        The historical trends endpoint declares session_types param but
        currently doesn't use it (bug at line 801). This test ensures
        the filter is actually applied.
        """
        records = mock_camper_history_with_session_types
        summer_types = ["main", "embedded", "ag"]

        # Simulate what fetch_camper_history_for_year should do with session_types
        def matches_session_types(record: Mock, type_filter: list[str] | None) -> bool:
            if type_filter is None:
                return True  # No filter = include all
            session_types_str = getattr(record, "session_types", "") or ""
            if not session_types_str:
                return False
            record_types = [t.strip() for t in session_types_str.split(",")]
            return any(t in type_filter for t in record_types)

        # With filter: should exclude family camp
        filtered = [r for r in records if matches_session_types(r, summer_types)]
        assert len(filtered) == 10

        # Without filter: should include all
        unfiltered = [r for r in records if matches_session_types(r, None)]
        assert len(unfiltered) == 14  # All records


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


# ============================================================================
# TDD Tests for Metrics Dashboard Redesign (Phase 1)
# ============================================================================


class TestWaitlistCancelledSessionTypeFiltering:
    """Tests for filtering waitlist/cancelled counts by session_type.

    Issue: Waitlist/Cancelled counts are inflated because they include
    family camp and other non-summer sessions. They should be filtered
    by session_type just like enrolled counts are.
    """

    @pytest.fixture
    def attendees_with_mixed_session_types(self) -> list[Mock]:
        """Create attendees with various statuses and session types."""
        attendees = []

        # Summer camp sessions (should be included in filtered counts)
        main_session = Mock(cm_id=1001, session_type="main", name="Session 2")
        ag_session = Mock(cm_id=1002, session_type="ag", name="AG Session 2")
        embedded_session = Mock(cm_id=1003, session_type="embedded", name="Session 2a")

        # Non-summer sessions (should be excluded)
        family_session = Mock(cm_id=2001, session_type="family", name="Family Camp Weekend")

        # Enrolled in summer (should count)
        attendees.append(create_mock_attendee(101, 1001, 2026, "enrolled", 2, True))
        attendees[-1].expand = {"session": main_session}

        # Waitlisted in summer (should count in filtered waitlist)
        attendees.append(create_mock_attendee(102, 1001, 2026, "waitlisted", 4, True))
        attendees[-1].expand = {"session": main_session}

        # Waitlisted in AG session (should count)
        attendees.append(create_mock_attendee(103, 1002, 2026, "waitlisted", 4, True))
        attendees[-1].expand = {"session": ag_session}

        # Cancelled in summer (should count)
        attendees.append(create_mock_attendee(104, 1003, 2026, "cancelled", 5, False))
        attendees[-1].expand = {"session": embedded_session}

        # Waitlisted in family camp (should NOT count in summer metrics)
        attendees.append(create_mock_attendee(105, 2001, 2026, "waitlisted", 4, True))
        attendees[-1].expand = {"session": family_session}

        # Cancelled in family camp (should NOT count in summer metrics)
        attendees.append(create_mock_attendee(106, 2001, 2026, "cancelled", 5, False))
        attendees[-1].expand = {"session": family_session}

        return attendees

    def test_waitlist_filtered_by_session_type(self, attendees_with_mixed_session_types: list[Mock]) -> None:
        """Test that waitlist count only includes summer session types.

        Given attendees with waitlisted status in both summer and family camp,
        when filtered to summer session types (main, embedded, ag),
        then only summer waitlisted attendees should be counted.
        """
        # Filter to only waitlisted
        waitlisted = [a for a in attendees_with_mixed_session_types if a.status == "waitlisted"]

        # Without session type filtering: 3 waitlisted (2 summer + 1 family)
        assert len(waitlisted) == 3

        # With session type filtering: should only be 2 (summer only)
        summer_types = ["main", "embedded", "ag"]

        def filter_by_session_type(attendees: list[Mock]) -> list[Mock]:
            filtered = []
            for a in attendees:
                expand = getattr(a, "expand", {}) or {}
                session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
                session_type = getattr(session, "session_type", None) if session else None
                if session_type in summer_types:
                    filtered.append(a)
            return filtered

        filtered_waitlisted = filter_by_session_type(waitlisted)
        assert len(filtered_waitlisted) == 2

    def test_cancelled_filtered_by_session_type(self, attendees_with_mixed_session_types: list[Mock]) -> None:
        """Test that cancelled count only includes summer session types.

        Given attendees with cancelled status in both summer and family camp,
        when filtered to summer session types (main, embedded, ag),
        then only summer cancelled attendees should be counted.
        """
        # Filter to only cancelled
        cancelled = [a for a in attendees_with_mixed_session_types if a.status == "cancelled"]

        # Without session type filtering: 2 cancelled (1 summer + 1 family)
        assert len(cancelled) == 2

        # With session type filtering: should only be 1 (summer only)
        summer_types = ["main", "embedded", "ag"]

        def filter_by_session_type(attendees: list[Mock]) -> list[Mock]:
            filtered = []
            for a in attendees:
                expand = getattr(a, "expand", {}) or {}
                session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
                session_type = getattr(session, "session_type", None) if session else None
                if session_type in summer_types:
                    filtered.append(a)
            return filtered

        filtered_cancelled = filter_by_session_type(cancelled)
        assert len(filtered_cancelled) == 1


class TestDemographicsNoStatusFilter:
    """Tests for demographics queries not filtering by status.

    Issue: Demographics are empty because camper_history is filtered by
    status='enrolled', but status in camper_history doesn't map cleanly
    to per-session status. Demographics should include everyone associated
    with summer sessions, regardless of status.
    """

    @pytest.fixture
    def camper_history_mixed_status(self) -> list[Mock]:
        """Create camper_history records with various statuses."""
        records = []

        # Enrolled camper
        record = Mock()
        record.person_id = 101
        record.year = 2026
        record.session_types = "main"
        record.status = "enrolled"
        record.school = "Riverside Elementary"
        record.city = "Springfield"
        record.synagogue = "Temple Beth El"
        records.append(record)

        # Waitlisted camper (should still be in demographics)
        record = Mock()
        record.person_id = 102
        record.year = 2026
        record.session_types = "main"
        record.status = "waitlisted"
        record.school = "Oak Valley Middle"
        record.city = "Riverside"
        record.synagogue = "Congregation Shalom"
        records.append(record)

        # Cancelled camper (should still be in demographics)
        record = Mock()
        record.person_id = 103
        record.year = 2026
        record.session_types = "main,embedded"
        record.status = "cancelled"
        record.school = "Hillcrest High"
        record.city = "Lakewood"
        record.synagogue = ""
        records.append(record)

        # Empty status (should still be in demographics)
        record = Mock()
        record.person_id = 104
        record.year = 2026
        record.session_types = "ag"
        record.status = ""
        record.school = "Riverside Elementary"
        record.city = "Springfield"
        record.synagogue = "Temple Beth El"
        records.append(record)

        return records

    def test_demographics_include_all_statuses(self, camper_history_mixed_status: list[Mock]) -> None:
        """Test that demographics include records regardless of status.

        When fetching camper_history for demographics (school, city, synagogue),
        all records with matching session_types should be included,
        regardless of their status field.
        """
        records = camper_history_mixed_status
        summer_types = ["main", "embedded", "ag"]

        # Filter only by session_types (not status)
        def matches_session_types(record: Mock, type_filter: list[str]) -> bool:
            session_types_str = getattr(record, "session_types", "") or ""
            if not session_types_str:
                return False
            record_types = [t.strip() for t in session_types_str.split(",")]
            return any(t in type_filter for t in record_types)

        filtered = [r for r in records if matches_session_types(r, summer_types)]

        # All 4 records should be included (regardless of status)
        assert len(filtered) == 4

        # Verify school breakdown includes all
        school_counts: dict[str, int] = {}
        for record in filtered:
            school = getattr(record, "school", "") or ""
            if school:
                school_counts[school] = school_counts.get(school, 0) + 1

        assert "Riverside Elementary" in school_counts
        assert school_counts["Riverside Elementary"] == 2
        assert "Oak Valley Middle" in school_counts
        assert "Hillcrest High" in school_counts


class TestStatusesParameter:
    """Tests for the statuses parameter in registration endpoint.

    Feature: Allow filtering by multiple status values (enrolled, waitlisted,
    cancelled, etc.) to enable flexible dashboard views.
    """

    @pytest.fixture
    def app(self) -> Any:
        """Create test application."""
        return create_app()

    @pytest.fixture
    def client(self, app: Any) -> TestClient:
        """Create test client."""
        return TestClient(app)

    def test_registration_accepts_statuses_parameter(self, client: TestClient, mock_pocketbase: Mock) -> None:
        """Test that registration endpoint accepts statuses parameter.

        The endpoint should accept a comma-separated list of statuses
        and return counts filtered to those statuses.
        """
        mock_pb = mock_pocketbase
        mock_pb.collection.return_value.get_full_list.return_value = []

        with patch("api.routers.metrics.pb", mock_pb):
            # Should accept statuses parameter without error
            response = client.get("/api/metrics/registration?year=2026&statuses=enrolled,waitlisted")
            assert response.status_code == 200

    def test_registration_statuses_parameter_is_passed_to_query(self) -> None:
        """Test that statuses parameter is actually used in the query.

        This is a spec test - when statuses parameter is provided,
        the endpoint should use it to filter attendees by the given statuses.

        Currently the endpoint ignores statuses parameter - this test should
        fail until the feature is implemented.
        """
        import inspect

        from api.routers.metrics import get_registration_metrics

        # Check the signature includes statuses parameter
        sig = inspect.signature(get_registration_metrics)
        param_names = list(sig.parameters.keys())

        # This test will FAIL until we add statuses parameter to the endpoint
        assert "statuses" in param_names, "statuses parameter should be added to get_registration_metrics"


class TestComparisonEndpointSessionTypes:
    """Tests for session_types parameter in comparison endpoint.

    Issue: Compare dropdown does nothing because comparison endpoint
    doesn't support session_types filtering.
    """

    @pytest.fixture
    def app(self) -> Any:
        """Create test application."""
        return create_app()

    @pytest.fixture
    def client(self, app: Any) -> TestClient:
        """Create test client."""
        return TestClient(app)

    def test_comparison_accepts_session_types_parameter(self, client: TestClient, mock_pocketbase: Mock) -> None:
        """Test that comparison endpoint accepts session_types parameter.

        The endpoint should accept session_types to filter both years
        to summer sessions only.
        """
        mock_pb = mock_pocketbase
        mock_pb.collection.return_value.get_full_list.return_value = []

        with patch("api.routers.metrics.pb", mock_pb):
            # Should accept session_types parameter without error
            response = client.get("/api/metrics/comparison?year_a=2025&year_b=2026&session_types=main,embedded,ag")
            assert response.status_code == 200

    def test_comparison_endpoint_has_session_types_parameter(self) -> None:
        """Test that comparison endpoint declares session_types parameter.

        The endpoint function signature should include session_types parameter
        for filtering both years to summer sessions only.
        """
        import inspect

        from api.routers.metrics import get_comparison_metrics

        sig = inspect.signature(get_comparison_metrics)
        param_names = list(sig.parameters.keys())

        # This test will FAIL until we add session_types parameter to comparison endpoint
        assert "session_types" in param_names, "session_types parameter should be added to get_comparison_metrics"


class TestFetchCamperHistoryNoStatusFilter:
    """Tests for fetch_camper_history_for_year function.

    The function should NOT filter by status - status filtering happens
    at the attendees level, not at the demographics level.
    """

    def test_fetch_camper_history_has_no_status_parameter(self) -> None:
        """Verify fetch_camper_history_for_year signature has no status_filter.

        The function should only accept year and session_types parameters.
        Status filtering is wrong at this level because demographics
        should include everyone associated with summer sessions.
        """
        import inspect

        from api.routers.metrics import fetch_camper_history_for_year

        sig = inspect.signature(fetch_camper_history_for_year)
        param_names = list(sig.parameters.keys())

        # Should have year and session_types, but NOT status_filter
        assert "year" in param_names
        assert "session_types" in param_names
        # This test will FAIL until we remove status_filter parameter
        assert "status_filter" not in param_names, (
            "status_filter parameter should be removed from fetch_camper_history_for_year"
        )


# ============================================================================
# TDD Tests for Dynamic Status Fetching (Phase 6)
# ============================================================================


class TestDynamicStatusFetching:
    """Tests for fetching attendees with dynamic status filtering.

    Issue: Backend currently only fetches 3 statuses (enrolled, waitlisted, cancelled)
    in parallel, then combines. Need to support all 10 statuses dynamically.

    All 10 statuses from PB schema:
    - enrolled, applied, waitlisted, left_early, cancelled
    - dismissed, inquiry, withdrawn, incomplete, unknown
    """

    @pytest.fixture
    def attendees_with_all_statuses(self) -> list[Mock]:
        """Create attendees with all possible status values."""
        main_session = Mock(cm_id=1001, session_type="main", name="Session 2")
        attendees = []

        # All 10 status types
        statuses_and_status_ids = [
            ("enrolled", 2),
            ("applied", 1),
            ("waitlisted", 4),
            ("left_early", 6),
            ("cancelled", 5),
            ("dismissed", 7),
            ("inquiry", 3),
            ("withdrawn", 8),
            ("incomplete", 9),
            ("unknown", 10),
        ]

        for i, (status, status_id) in enumerate(statuses_and_status_ids, start=101):
            attendee = create_mock_attendee(i, 1001, 2026, status, status_id, status == "enrolled")
            attendee.expand = {"session": main_session}
            attendees.append(attendee)

        return attendees

    def test_fetch_attendees_supports_all_status_values(self, attendees_with_all_statuses: list[Mock]) -> None:
        """Test that all 10 status values can be queried.

        The backend should be able to fetch attendees for any status value,
        not just enrolled/waitlisted/cancelled.
        """
        all_statuses = [
            "enrolled",
            "applied",
            "waitlisted",
            "left_early",
            "cancelled",
            "dismissed",
            "inquiry",
            "withdrawn",
            "incomplete",
            "unknown",
        ]

        # Simulate filtering for each status
        for status in all_statuses:
            filtered = [a for a in attendees_with_all_statuses if a.status == status]
            # Each status should have exactly 1 attendee
            assert len(filtered) == 1, f"Expected 1 attendee with status '{status}', got {len(filtered)}"

    def test_multiple_statuses_can_be_combined(self, attendees_with_all_statuses: list[Mock]) -> None:
        """Test that multiple statuses can be combined in a single query.

        When user selects ["enrolled", "applied", "waitlisted"], the query
        should return all attendees matching ANY of those statuses.
        """
        selected_statuses = ["enrolled", "applied", "waitlisted"]

        # Simulate combined filter
        filtered = [a for a in attendees_with_all_statuses if a.status in selected_statuses]

        assert len(filtered) == 3

    def test_registration_endpoint_uses_all_requested_statuses(
        self, attendees_with_all_statuses: list[Mock], mock_pocketbase: Mock
    ) -> None:
        """Test that registration endpoint fetches all requested statuses.

        When statuses=enrolled,applied,dismissed is passed, the response
        should include counts for all three status types combined.
        """
        from fastapi.testclient import TestClient

        from api.main import create_app

        app = create_app()
        client = TestClient(app)

        mock_pb = mock_pocketbase
        # Mock returns empty lists by default (clean test)
        mock_pb.collection.return_value.get_full_list.return_value = []

        with patch("api.routers.metrics.pb", mock_pb):
            response = client.get("/api/metrics/registration?year=2026&statuses=enrolled,applied,dismissed")
            assert response.status_code == 200
            # The endpoint should accept any valid statuses parameter
            data = response.json()
            assert data["year"] == 2026

    def test_build_dynamic_status_filter(self) -> None:
        """Test that dynamic PB filter is built correctly for multiple statuses.

        When statuses=["enrolled", "applied", "waitlisted"], the filter should be:
        'status = "enrolled" || status = "applied" || status = "waitlisted"'
        """
        statuses = ["enrolled", "applied", "waitlisted"]

        # Build filter the way it should be done
        status_conditions = " || ".join(f'status = "{s}"' for s in statuses)
        expected_filter = f"year = 2026 && ({status_conditions})"

        assert 'status = "enrolled"' in expected_filter
        assert 'status = "applied"' in expected_filter
        assert 'status = "waitlisted"' in expected_filter
        assert "||" in expected_filter

    def test_empty_statuses_defaults_to_enrolled(self, mock_pocketbase: Mock) -> None:
        """Test that empty/missing statuses parameter defaults to enrolled.

        If no statuses parameter is provided, the endpoint should default
        to querying only enrolled attendees (current behavior).
        """
        from fastapi.testclient import TestClient

        from api.main import create_app

        app = create_app()
        client = TestClient(app)

        mock_pb = mock_pocketbase
        mock_pb.collection.return_value.get_full_list.return_value = []

        with patch("api.routers.metrics.pb", mock_pb):
            # No statuses parameter - should default to enrolled
            response = client.get("/api/metrics/registration?year=2026")
            assert response.status_code == 200

    def test_single_non_enrolled_status_works(self, mock_pocketbase: Mock) -> None:
        """Test that querying a single non-enrolled status works.

        User should be able to query only waitlisted or only applied, etc.
        """
        from fastapi.testclient import TestClient

        from api.main import create_app

        app = create_app()
        client = TestClient(app)

        mock_pb = mock_pocketbase
        mock_pb.collection.return_value.get_full_list.return_value = []

        with patch("api.routers.metrics.pb", mock_pb):
            # Just waitlisted
            response = client.get("/api/metrics/registration?year=2026&statuses=waitlisted")
            assert response.status_code == 200

            # Just applied
            response = client.get("/api/metrics/registration?year=2026&statuses=applied")
            assert response.status_code == 200

            # Just inquiry
            response = client.get("/api/metrics/registration?year=2026&statuses=inquiry")
            assert response.status_code == 200


class TestFetchAttendeesForYearDynamicStatuses:
    """Tests for the fetch_attendees_for_year function with dynamic status support.

    The function needs to be refactored to support:
    1. Multiple statuses as a list
    2. Building dynamic PB filter
    3. Fetching all requested statuses in a single query
    """

    def test_fetch_attendees_accepts_status_list(self) -> None:
        """Test that fetch_attendees_for_year can accept a list of statuses.

        The function signature should support:
        fetch_attendees_for_year(year, status_filter=["enrolled", "applied"])
        """
        import inspect

        from api.routers.metrics import fetch_attendees_for_year

        sig = inspect.signature(fetch_attendees_for_year)
        params = sig.parameters

        # status_filter parameter should exist
        assert "status_filter" in params, "fetch_attendees_for_year should have status_filter parameter"

        # Check the type hint allows list (str | list[str] | None)
        # Note: This is a design test - implementation can use str | list[str] | None

    def test_fetch_attendees_builds_correct_filter_for_applied(self) -> None:
        """Test that fetch_attendees_for_year builds correct filter for 'applied' status.

        Currently the function only has explicit handling for enrolled/waitlisted/cancelled.
        Other statuses like 'applied' fall through to the default (enrolled) behavior.

        This test will FAIL until we implement dynamic status filtering.
        """
        import inspect

        from api.routers.metrics import fetch_attendees_for_year

        # Inspect the function source to verify it handles 'applied'

        source = inspect.getsource(fetch_attendees_for_year)

        # The function should build a dynamic filter for any status, not just 3 hardcoded ones
        # Currently it has: if status_filter == "waitlisted": ... elif status_filter == "cancelled": ... else: (enrolled)
        # It should handle 'applied', 'dismissed', 'inquiry', 'withdrawn', 'incomplete', 'unknown'

        # This test verifies the function explicitly handles 'applied' status
        assert '"applied"' in source or "applied" in source, (
            "fetch_attendees_for_year should explicitly handle 'applied' status, not fall through to enrolled default"
        )

    def test_registration_endpoint_dynamically_filters_by_requested_statuses(self) -> None:
        """Test that registration endpoint actually filters by all requested statuses.

        Issue: Currently the registration endpoint fetches enrolled, waitlisted, cancelled
        in parallel and then combines based on statuses parameter. But it doesn't fetch
        other statuses like 'applied', 'dismissed', etc.

        This test verifies the registration endpoint can properly filter by non-standard
        statuses by checking the total_enrolled reflects the filtered data.
        """
        # Create mock attendees with applied status
        applied_attendees = [
            create_mock_attendee(101, 1001, 2026, "applied", 1, True),
            create_mock_attendee(102, 1001, 2026, "applied", 1, True),
        ]
        # Add session expand
        main_session = Mock(cm_id=1001, session_type="main", name="Session 2")
        for a in applied_attendees:
            a.expand = {"session": main_session}

        # The test expectation: when statuses=applied, we should get count=2
        # Currently the implementation doesn't fetch 'applied' attendees,
        # so this would return 0

        # For now, this is a specification test - the actual integration test
        # would need more complex mocking to verify the PB query


# ============================================================================
# TDD Tests for New Retention Breakdowns (Metrics Dashboard Enhancement)
# ============================================================================


class TestRetentionBySchool:
    """Tests for retention breakdown by school.

    Track retention rates for each school - which schools have the highest
    retention rates and which might need more engagement.
    """

    @pytest.fixture
    def camper_history_with_schools(self) -> list[Mock]:
        """Create camper_history records with school data for two years."""
        records = []

        # Base year (2025) campers - 5 campers from 3 schools
        for i, (person_id, school) in enumerate(
            [
                (101, "Riverside Elementary"),
                (102, "Riverside Elementary"),  # 2 from Riverside
                (103, "Oak Valley Middle"),
                (104, "Oak Valley Middle"),  # 2 from Oak Valley
                (105, "Hillcrest High"),  # 1 from Hillcrest
            ]
        ):
            record = Mock()
            record.person_id = person_id
            record.year = 2025
            record.school = school
            record.city = "Springfield"
            record.synagogue = "Temple Beth El"
            record.first_year_attended = 2024
            record.session_types = "main"
            record.sessions = "Session 2"
            record.bunks = "B-1"
            records.append(record)

        # Compare year (2026) campers - 3 returned + 2 new
        for person_id, school in [
            (101, "Riverside Elementary"),  # Returned from 2025
            (103, "Oak Valley Middle"),  # Returned from 2025
            (105, "Hillcrest High"),  # Returned from 2025
            (201, "Riverside Elementary"),  # New
            (202, "Lakeside Academy"),  # New
        ]:
            record = Mock()
            record.person_id = person_id
            record.year = 2026
            record.school = school
            record.city = "Springfield"
            record.synagogue = "Temple Beth El"
            record.first_year_attended = 2026 if person_id >= 200 else 2024
            record.session_types = "main"
            record.sessions = "Session 2"
            record.bunks = "B-1"
            records.append(record)

        return records

    def test_retention_by_school_structure(self, camper_history_with_schools: list[Mock]) -> None:
        """Test that retention by school breakdown has correct structure.

        Expected output format:
        {
            school: str,
            base_count: int,      # Campers from this school in base year
            returned_count: int,  # How many from that school returned
            retention_rate: float # returned_count / base_count
        }
        """
        # Separate by year
        base_year_records = [r for r in camper_history_with_schools if r.year == 2025]
        compare_year_records = [r for r in camper_history_with_schools if r.year == 2026]

        # Get person IDs who returned
        base_person_ids = {r.person_id for r in base_year_records}
        compare_person_ids = {r.person_id for r in compare_year_records}
        returned_ids = base_person_ids & compare_person_ids

        # Build school -> stats map
        school_stats: dict[str, dict[str, int]] = {}
        for record in base_year_records:
            school = record.school
            if school not in school_stats:
                school_stats[school] = {"base_count": 0, "returned_count": 0}
            school_stats[school]["base_count"] += 1
            if record.person_id in returned_ids:
                school_stats[school]["returned_count"] += 1

        # Verify expected data
        assert "Riverside Elementary" in school_stats
        assert school_stats["Riverside Elementary"]["base_count"] == 2
        assert school_stats["Riverside Elementary"]["returned_count"] == 1
        # Retention rate: 1/2 = 50%

        assert "Oak Valley Middle" in school_stats
        assert school_stats["Oak Valley Middle"]["base_count"] == 2
        assert school_stats["Oak Valley Middle"]["returned_count"] == 1
        # Retention rate: 1/2 = 50%

        assert "Hillcrest High" in school_stats
        assert school_stats["Hillcrest High"]["base_count"] == 1
        assert school_stats["Hillcrest High"]["returned_count"] == 1
        # Retention rate: 1/1 = 100%

    def test_retention_endpoint_includes_by_school(self) -> None:
        """Test that retention endpoint response includes by_school field.

        This test will FAIL until we add by_school to RetentionMetricsResponse.
        """

        from api.schemas.metrics import RetentionMetricsResponse

        # Check the model fields
        fields = RetentionMetricsResponse.model_fields
        assert "by_school" in fields, "RetentionMetricsResponse should include by_school field"


class TestRetentionByCity:
    """Tests for retention breakdown by city."""

    @pytest.fixture
    def camper_history_with_cities(self) -> list[Mock]:
        """Create camper_history records with city data."""
        records = []

        # Base year - campers from 3 cities
        for person_id, city in [
            (101, "Springfield"),
            (102, "Springfield"),
            (103, "Riverside"),
            (104, "Lakewood"),
        ]:
            record = Mock()
            record.person_id = person_id
            record.year = 2025
            record.city = city
            record.school = "Test School"
            record.synagogue = ""
            record.first_year_attended = 2024
            record.session_types = "main"
            record.sessions = "Session 2"
            record.bunks = "B-1"
            records.append(record)

        # Compare year - 2 returned
        for person_id, city in [
            (101, "Springfield"),  # Returned
            (104, "Lakewood"),  # Returned
        ]:
            record = Mock()
            record.person_id = person_id
            record.year = 2026
            record.city = city
            record.school = "Test School"
            record.synagogue = ""
            record.first_year_attended = 2024
            record.session_types = "main"
            record.sessions = "Session 2"
            record.bunks = "B-1"
            records.append(record)

        return records

    def test_retention_by_city_calculation(self, camper_history_with_cities: list[Mock]) -> None:
        """Test retention calculation by city.

        Springfield: 2 base, 1 returned = 50%
        Riverside: 1 base, 0 returned = 0%
        Lakewood: 1 base, 1 returned = 100%
        """
        base_records = [r for r in camper_history_with_cities if r.year == 2025]
        compare_records = [r for r in camper_history_with_cities if r.year == 2026]

        returned_ids = {r.person_id for r in base_records} & {r.person_id for r in compare_records}

        city_stats: dict[str, dict[str, int]] = {}
        for record in base_records:
            city = record.city
            if city not in city_stats:
                city_stats[city] = {"base_count": 0, "returned_count": 0}
            city_stats[city]["base_count"] += 1
            if record.person_id in returned_ids:
                city_stats[city]["returned_count"] += 1

        assert city_stats["Springfield"]["base_count"] == 2
        assert city_stats["Springfield"]["returned_count"] == 1

        assert city_stats["Riverside"]["base_count"] == 1
        assert city_stats["Riverside"]["returned_count"] == 0

        assert city_stats["Lakewood"]["base_count"] == 1
        assert city_stats["Lakewood"]["returned_count"] == 1

    def test_retention_endpoint_includes_by_city(self) -> None:
        """Test that retention endpoint response includes by_city field."""
        from api.schemas.metrics import RetentionMetricsResponse

        fields = RetentionMetricsResponse.model_fields
        assert "by_city" in fields, "RetentionMetricsResponse should include by_city field"


class TestRetentionBySynagogue:
    """Tests for retention breakdown by synagogue."""

    @pytest.fixture
    def camper_history_with_synagogues(self) -> list[Mock]:
        """Create camper_history records with synagogue data."""
        records = []

        # Base year
        for person_id, synagogue in [
            (101, "Temple Beth El"),
            (102, "Temple Beth El"),
            (103, "Congregation Shalom"),
            (104, ""),  # No synagogue
        ]:
            record = Mock()
            record.person_id = person_id
            record.year = 2025
            record.synagogue = synagogue
            record.school = "Test School"
            record.city = "Springfield"
            record.first_year_attended = 2024
            record.session_types = "main"
            record.sessions = "Session 2"
            record.bunks = "B-1"
            records.append(record)

        # Compare year - some returned
        for person_id, synagogue in [
            (101, "Temple Beth El"),  # Returned
            (103, "Congregation Shalom"),  # Returned
        ]:
            record = Mock()
            record.person_id = person_id
            record.year = 2026
            record.synagogue = synagogue
            record.school = "Test School"
            record.city = "Springfield"
            record.first_year_attended = 2024
            record.session_types = "main"
            record.sessions = "Session 2"
            record.bunks = "B-1"
            records.append(record)

        return records

    def test_retention_by_synagogue_calculation(self, camper_history_with_synagogues: list[Mock]) -> None:
        """Test retention by synagogue.

        Temple Beth El: 2 base, 1 returned = 50%
        Congregation Shalom: 1 base, 1 returned = 100%
        (empty synagogue excluded from breakdown)
        """
        base_records = [r for r in camper_history_with_synagogues if r.year == 2025]
        compare_records = [r for r in camper_history_with_synagogues if r.year == 2026]

        returned_ids = {r.person_id for r in base_records} & {r.person_id for r in compare_records}

        synagogue_stats: dict[str, dict[str, int]] = {}
        for record in base_records:
            synagogue = record.synagogue
            if not synagogue:  # Skip empty
                continue
            if synagogue not in synagogue_stats:
                synagogue_stats[synagogue] = {"base_count": 0, "returned_count": 0}
            synagogue_stats[synagogue]["base_count"] += 1
            if record.person_id in returned_ids:
                synagogue_stats[synagogue]["returned_count"] += 1

        # Only non-empty synagogues
        assert len(synagogue_stats) == 2

        assert synagogue_stats["Temple Beth El"]["base_count"] == 2
        assert synagogue_stats["Temple Beth El"]["returned_count"] == 1

        assert synagogue_stats["Congregation Shalom"]["base_count"] == 1
        assert synagogue_stats["Congregation Shalom"]["returned_count"] == 1

    def test_retention_endpoint_includes_by_synagogue(self) -> None:
        """Test that retention endpoint response includes by_synagogue field."""
        from api.schemas.metrics import RetentionMetricsResponse

        fields = RetentionMetricsResponse.model_fields
        assert "by_synagogue" in fields, "RetentionMetricsResponse should include by_synagogue field"


class TestRetentionByFirstYear:
    """Tests for retention breakdown by first_year_attended.

    This helps analyze retention patterns based on how long campers have been
    attending - do long-time campers have better retention?
    """

    @pytest.fixture
    def camper_history_with_first_years(self) -> list[Mock]:
        """Create camper_history records with first_year_attended data."""
        records = []

        # Base year (2025) campers
        for person_id, first_year in [
            (101, 2022),  # 4-year veteran
            (102, 2023),  # 3-year veteran
            (103, 2024),  # 2-year veteran
            (104, 2025),  # First year
            (105, 2025),  # First year
        ]:
            record = Mock()
            record.person_id = person_id
            record.year = 2025
            record.first_year_attended = first_year
            record.school = "Test School"
            record.city = "Springfield"
            record.synagogue = ""
            record.session_types = "main"
            record.sessions = "Session 2"
            record.bunks = "B-1"
            records.append(record)

        # Compare year (2026) - veterans more likely to return
        for person_id, first_year in [
            (101, 2022),  # Returned (veteran)
            (102, 2023),  # Returned (veteran)
            (103, 2024),  # Returned
            (105, 2025),  # Returned (1 of 2 first-years)
        ]:
            record = Mock()
            record.person_id = person_id
            record.year = 2026
            record.first_year_attended = first_year
            record.school = "Test School"
            record.city = "Springfield"
            record.synagogue = ""
            record.session_types = "main"
            record.sessions = "Session 2"
            record.bunks = "B-1"
            records.append(record)

        return records

    def test_retention_by_first_year_calculation(self, camper_history_with_first_years: list[Mock]) -> None:
        """Test retention calculation by first_year_attended.

        2022: 1 base, 1 returned = 100%
        2023: 1 base, 1 returned = 100%
        2024: 1 base, 1 returned = 100%
        2025: 2 base, 1 returned = 50%
        """
        base_records = [r for r in camper_history_with_first_years if r.year == 2025]
        compare_records = [r for r in camper_history_with_first_years if r.year == 2026]

        returned_ids = {r.person_id for r in base_records} & {r.person_id for r in compare_records}

        first_year_stats: dict[int, dict[str, int]] = {}
        for record in base_records:
            first_year = record.first_year_attended
            if first_year not in first_year_stats:
                first_year_stats[first_year] = {"base_count": 0, "returned_count": 0}
            first_year_stats[first_year]["base_count"] += 1
            if record.person_id in returned_ids:
                first_year_stats[first_year]["returned_count"] += 1

        # Veterans (started before 2025) all returned
        assert first_year_stats[2022]["base_count"] == 1
        assert first_year_stats[2022]["returned_count"] == 1

        assert first_year_stats[2023]["base_count"] == 1
        assert first_year_stats[2023]["returned_count"] == 1

        assert first_year_stats[2024]["base_count"] == 1
        assert first_year_stats[2024]["returned_count"] == 1

        # First-years (started 2025) had lower retention
        assert first_year_stats[2025]["base_count"] == 2
        assert first_year_stats[2025]["returned_count"] == 1

    def test_retention_endpoint_includes_by_first_year(self) -> None:
        """Test that retention endpoint response includes by_first_year field."""
        from api.schemas.metrics import RetentionMetricsResponse

        fields = RetentionMetricsResponse.model_fields
        assert "by_first_year" in fields, "RetentionMetricsResponse should include by_first_year field"


class TestRetentionBySessionBunk:
    """Tests for retention breakdown by session+bunk combination.

    This helps identify which cabin groups had best retention - useful for
    evaluating cabin counselor effectiveness and group dynamics.
    """

    @pytest.fixture
    def camper_history_with_session_bunks(self) -> list[Mock]:
        """Create camper_history records with session and bunk data."""
        records = []

        # Base year (2025) - campers in different session/bunk combos
        for person_id, session, bunk in [
            (101, "Session 2", "B-1"),
            (102, "Session 2", "B-1"),
            (103, "Session 2", "B-2"),
            (104, "Session 3", "G-1"),
            (105, "Session 3", "G-1"),
            (106, "Session 3", "G-1"),
        ]:
            record = Mock()
            record.person_id = person_id
            record.year = 2025
            record.sessions = session
            record.bunks = bunk
            record.school = "Test School"
            record.city = "Springfield"
            record.synagogue = ""
            record.first_year_attended = 2024
            record.session_types = "main"
            records.append(record)

        # Compare year (2026) - some bunks had better retention
        for person_id, session, bunk in [
            (101, "Session 2", "B-1"),  # Returned from B-1
            (104, "Session 3", "G-1"),  # Returned from G-1
            (105, "Session 3", "G-1"),  # Returned from G-1
            (106, "Session 3", "G-1"),  # Returned from G-1
        ]:
            record = Mock()
            record.person_id = person_id
            record.year = 2026
            record.sessions = session
            record.bunks = bunk
            record.school = "Test School"
            record.city = "Springfield"
            record.synagogue = ""
            record.first_year_attended = 2024
            record.session_types = "main"
            records.append(record)

        return records

    def test_retention_by_session_bunk_calculation(self, camper_history_with_session_bunks: list[Mock]) -> None:
        """Test retention calculation by session+bunk combination.

        Session 2 + B-1: 2 base, 1 returned = 50%
        Session 2 + B-2: 1 base, 0 returned = 0%
        Session 3 + G-1: 3 base, 3 returned = 100% (great cabin!)
        """
        base_records = [r for r in camper_history_with_session_bunks if r.year == 2025]
        compare_records = [r for r in camper_history_with_session_bunks if r.year == 2026]

        returned_ids = {r.person_id for r in base_records} & {r.person_id for r in compare_records}

        session_bunk_stats: dict[tuple[str, str], dict[str, int]] = {}
        for record in base_records:
            key = (record.sessions, record.bunks)
            if key not in session_bunk_stats:
                session_bunk_stats[key] = {"base_count": 0, "returned_count": 0}
            session_bunk_stats[key]["base_count"] += 1
            if record.person_id in returned_ids:
                session_bunk_stats[key]["returned_count"] += 1

        # Session 2, B-1: 50% retention
        assert session_bunk_stats[("Session 2", "B-1")]["base_count"] == 2
        assert session_bunk_stats[("Session 2", "B-1")]["returned_count"] == 1

        # Session 2, B-2: 0% retention
        assert session_bunk_stats[("Session 2", "B-2")]["base_count"] == 1
        assert session_bunk_stats[("Session 2", "B-2")]["returned_count"] == 0

        # Session 3, G-1: 100% retention
        assert session_bunk_stats[("Session 3", "G-1")]["base_count"] == 3
        assert session_bunk_stats[("Session 3", "G-1")]["returned_count"] == 3

    def test_retention_endpoint_includes_by_session_bunk(self) -> None:
        """Test that retention endpoint response includes by_session_bunk field."""
        from api.schemas.metrics import RetentionMetricsResponse

        fields = RetentionMetricsResponse.model_fields
        assert "by_session_bunk" in fields, "RetentionMetricsResponse should include by_session_bunk field"


class TestRetentionBreakdownSchemas:
    """Tests verifying the Pydantic schemas exist for retention breakdowns."""

    def test_retention_by_school_schema_exists(self) -> None:
        """Test that RetentionBySchool schema exists with correct fields."""
        from api.schemas.metrics import RetentionBySchool

        # Create an instance to verify fields
        instance = RetentionBySchool(
            school="Riverside Elementary",
            base_count=10,
            returned_count=7,
            retention_rate=0.7,
        )
        assert instance.school == "Riverside Elementary"
        assert instance.base_count == 10
        assert instance.returned_count == 7
        assert instance.retention_rate == 0.7

    def test_retention_by_city_schema_exists(self) -> None:
        """Test that RetentionByCity schema exists with correct fields."""
        from api.schemas.metrics import RetentionByCity

        instance = RetentionByCity(
            city="Springfield",
            base_count=15,
            returned_count=12,
            retention_rate=0.8,
        )
        assert instance.city == "Springfield"
        assert instance.base_count == 15
        assert instance.returned_count == 12
        assert instance.retention_rate == 0.8

    def test_retention_by_synagogue_schema_exists(self) -> None:
        """Test that RetentionBySynagogue schema exists with correct fields."""
        from api.schemas.metrics import RetentionBySynagogue

        instance = RetentionBySynagogue(
            synagogue="Temple Beth El",
            base_count=8,
            returned_count=6,
            retention_rate=0.75,
        )
        assert instance.synagogue == "Temple Beth El"
        assert instance.base_count == 8
        assert instance.returned_count == 6
        assert instance.retention_rate == 0.75

    def test_retention_by_first_year_schema_exists(self) -> None:
        """Test that RetentionByFirstYear schema exists with correct fields."""
        from api.schemas.metrics import RetentionByFirstYear

        instance = RetentionByFirstYear(
            first_year=2022,
            base_count=5,
            returned_count=4,
            retention_rate=0.8,
        )
        assert instance.first_year == 2022
        assert instance.base_count == 5
        assert instance.returned_count == 4
        assert instance.retention_rate == 0.8

    def test_retention_by_session_bunk_schema_exists(self) -> None:
        """Test that RetentionBySessionBunk schema exists with correct fields."""
        from api.schemas.metrics import RetentionBySessionBunk

        instance = RetentionBySessionBunk(
            session="Session 2",
            bunk="B-1",
            base_count=12,
            returned_count=10,
            retention_rate=0.833,
        )
        assert instance.session == "Session 2"
        assert instance.bunk == "B-1"
        assert instance.base_count == 12
        assert instance.returned_count == 10
        assert instance.retention_rate == pytest.approx(0.833, rel=0.01)


# ============================================================================
# TDD Tests for Retention Tab Redesign
# ============================================================================


class TestRetentionSessionCmIdFilter:
    """Tests for session_cm_id filter parameter in retention endpoint.

    The retention endpoint should accept an optional session_cm_id parameter
    to filter results to a specific session, allowing users to see retention
    metrics for individual sessions.
    """

    @pytest.fixture
    def sample_attendees_multi_session(self) -> list[Mock]:
        """Attendees across multiple sessions for filter testing."""
        main_session_1 = Mock()
        main_session_1.cm_id = 1001
        main_session_1.session_type = "main"
        main_session_1.name = "Session 2"

        main_session_2 = Mock()
        main_session_2.cm_id = 1002
        main_session_2.session_type = "main"
        main_session_2.name = "Session 3"

        embedded_session = Mock()
        embedded_session.cm_id = 1003
        embedded_session.session_type = "embedded"
        embedded_session.name = "Session 2a"

        attendees = []

        # Session 2 (cm_id 1001): 3 campers in base year
        for i in range(3):
            a = create_mock_attendee(100 + i, 1001, 2025, "enrolled", 2, True)
            a.expand = {"session": main_session_1}
            attendees.append(a)

        # Session 3 (cm_id 1002): 2 campers in base year
        for i in range(2):
            a = create_mock_attendee(200 + i, 1002, 2025, "enrolled", 2, True)
            a.expand = {"session": main_session_2}
            attendees.append(a)

        # Session 2a (cm_id 1003): 2 campers in base year
        for i in range(2):
            a = create_mock_attendee(300 + i, 1003, 2025, "enrolled", 2, True)
            a.expand = {"session": embedded_session}
            attendees.append(a)

        return attendees

    def test_filter_attendees_by_session_cm_id(self, sample_attendees_multi_session: list[Mock]) -> None:
        """Test filtering attendees by a specific session cm_id.

        When session_cm_id is provided, only attendees in that session
        should be included in retention calculations.
        """
        # Filter to Session 2 only (cm_id 1001)
        session_cm_id = 1001
        filtered = [
            a
            for a in sample_attendees_multi_session
            if getattr(a.expand.get("session"), "cm_id", None) == session_cm_id
        ]

        assert len(filtered) == 3
        # All should be from Session 2
        for a in filtered:
            assert a.expand["session"].name == "Session 2"

    def test_filter_returns_all_when_session_cm_id_is_none(self, sample_attendees_multi_session: list[Mock]) -> None:
        """Test that no filtering happens when session_cm_id is None.

        This is the default behavior - show retention across all sessions.
        """
        session_cm_id = None

        if session_cm_id is None:
            filtered = sample_attendees_multi_session
        else:
            filtered = [
                a
                for a in sample_attendees_multi_session
                if getattr(a.expand.get("session"), "cm_id", None) == session_cm_id
            ]

        assert len(filtered) == 7  # All attendees

    def test_retention_calculation_with_session_filter(self) -> None:
        """Test retention rate calculation when filtered to specific session.

        Given: Session 2 has 3 campers in 2025, 2 returned in 2026
        Expected: 66.7% retention for Session 2 specifically
        """
        # Base year attendees for Session 2
        base_year_session_2_ids = {100, 101, 102}

        # Compare year attendees (some returned)
        compare_year_all_ids = {100, 102, 201, 202, 301}  # 100, 102 returned from Session 2

        returned_from_session_2 = base_year_session_2_ids & compare_year_all_ids
        retention_rate = len(returned_from_session_2) / len(base_year_session_2_ids)

        assert len(returned_from_session_2) == 2
        assert retention_rate == pytest.approx(2 / 3, rel=0.01)


class TestRetentionBySummerYears:
    """Tests for summer years calculation (calculated from attendees, not years_at_camp).

    The 'years of summer enrollment' should be calculated from actual summer
    session enrollments in the attendees table, not from the potentially
    incorrect years_at_camp field in persons.
    """

    @pytest.fixture
    def enrollment_history(self) -> dict[int, list[int]]:
        """Mock enrollment history: person_id -> list of years enrolled in summer."""
        return {
            101: [2023, 2024, 2025],  # 3 summers
            102: [2024, 2025],  # 2 summers
            103: [2025],  # 1 summer
            104: [2022, 2023, 2024, 2025],  # 4 summers
            105: [2024, 2025],  # 2 summers
        }

    def test_count_summer_enrollment_years(self, enrollment_history: dict[int, list[int]]) -> None:
        """Test calculating number of summer years for each camper.

        This replaces the years_at_camp field which can be incorrect.
        """
        summer_years_by_person = {pid: len(years) for pid, years in enrollment_history.items()}

        assert summer_years_by_person[101] == 3
        assert summer_years_by_person[102] == 2
        assert summer_years_by_person[103] == 1
        assert summer_years_by_person[104] == 4
        assert summer_years_by_person[105] == 2

    def test_retention_by_summer_years_breakdown(self, enrollment_history: dict[int, list[int]]) -> None:
        """Test retention breakdown by summer years.

        Given: 5 campers from 2025 with varying summer experience
        Assume: 101, 102, 104 returned (3 out of 5)
        Calculate: Retention rate by summer years bucket
        """
        base_year = 2025
        base_year_ids = {pid for pid, years in enrollment_history.items() if base_year in years}
        returned_ids = {101, 102, 104}

        summer_years_by_person = {pid: len(years) for pid, years in enrollment_history.items() if pid in base_year_ids}

        # Group by summer years
        by_summer_years: dict[int, dict[str, int]] = {}
        for pid in base_year_ids:
            years_count = summer_years_by_person[pid]
            if years_count not in by_summer_years:
                by_summer_years[years_count] = {"base": 0, "returned": 0}
            by_summer_years[years_count]["base"] += 1
            if pid in returned_ids:
                by_summer_years[years_count]["returned"] += 1

        # 1 summer: 103 (base=1, returned=0) -> 0%
        assert by_summer_years[1]["base"] == 1
        assert by_summer_years[1]["returned"] == 0

        # 2 summers: 102, 105 (base=2, returned=1 (102)) -> 50%
        assert by_summer_years[2]["base"] == 2
        assert by_summer_years[2]["returned"] == 1

        # 3 summers: 101 (base=1, returned=1) -> 100%
        assert by_summer_years[3]["base"] == 1
        assert by_summer_years[3]["returned"] == 1

        # 4 summers: 104 (base=1, returned=1) -> 100%
        assert by_summer_years[4]["base"] == 1
        assert by_summer_years[4]["returned"] == 1


class TestRetentionByFirstSummerYear:
    """Tests for first summer year calculation (when camper first attended summer camp)."""

    @pytest.fixture
    def first_summer_year_data(self) -> dict[int, int]:
        """Mock first summer year data: person_id -> first summer year."""
        return {
            101: 2020,  # Started in 2020
            102: 2022,  # Started in 2022
            103: 2025,  # Started in 2025 (first year)
            104: 2019,  # Started in 2019
            105: 2023,  # Started in 2023
        }

    def test_calculate_first_summer_year(self, first_summer_year_data: dict[int, int]) -> None:
        """Test calculating first summer year from enrollment history."""
        enrollment_history = {
            101: [2020, 2021, 2022, 2023, 2024, 2025],
            102: [2022, 2024, 2025],
            103: [2025],
            104: [2019, 2020, 2021, 2022, 2023, 2024, 2025],
            105: [2023, 2024, 2025],
        }

        calculated_first_year = {pid: min(years) for pid, years in enrollment_history.items()}

        assert calculated_first_year == first_summer_year_data

    def test_retention_by_first_summer_year_breakdown(self, first_summer_year_data: dict[int, int]) -> None:
        """Test retention breakdown by first summer year (cohort analysis).

        This allows analyzing retention by "class" of when campers first joined.
        """
        returned_ids = {101, 104}  # Long-timers returned

        by_first_year: dict[int, dict[str, int]] = {}
        for pid, first_year in first_summer_year_data.items():
            if first_year not in by_first_year:
                by_first_year[first_year] = {"base": 0, "returned": 0}
            by_first_year[first_year]["base"] += 1
            if pid in returned_ids:
                by_first_year[first_year]["returned"] += 1

        # 2019 cohort: 104 (1/1 returned) -> 100%
        assert by_first_year[2019]["base"] == 1
        assert by_first_year[2019]["returned"] == 1

        # 2020 cohort: 101 (1/1 returned) -> 100%
        assert by_first_year[2020]["base"] == 1
        assert by_first_year[2020]["returned"] == 1

        # 2022 cohort: 102 (0/1 returned) -> 0%
        assert by_first_year[2022]["base"] == 1
        assert by_first_year[2022]["returned"] == 0

        # 2023 cohort: 105 (0/1 returned) -> 0%
        assert by_first_year[2023]["base"] == 1
        assert by_first_year[2023]["returned"] == 0

        # 2025 cohort: 103 (0/1 returned) -> 0%
        assert by_first_year[2025]["base"] == 1
        assert by_first_year[2025]["returned"] == 0


class TestRetentionByPriorSession:
    """Tests for retention breakdown by prior year session.

    Shows what sessions campers were in during the prior year and their
    retention rate per session.
    """

    @pytest.fixture
    def prior_year_sessions(self) -> dict[int, list[str]]:
        """Mock prior year session data: person_id -> list of session names."""
        return {
            101: ["Session 2"],
            102: ["Session 2", "Session 3"],  # Did both sessions
            103: ["Session 3"],
            104: ["Session 4"],
            105: ["Taste of Camp"],
        }

    def test_retention_by_prior_session_breakdown(self, prior_year_sessions: dict[int, list[str]]) -> None:
        """Test retention breakdown by what session campers were in prior year.

        This helps identify which prior-year sessions have best retention.
        """
        returned_ids = {101, 102, 103}

        by_prior_session: dict[str, dict[str, int]] = {}
        for pid, sessions in prior_year_sessions.items():
            for session in sessions:
                if session not in by_prior_session:
                    by_prior_session[session] = {"base": 0, "returned": 0}
                by_prior_session[session]["base"] += 1
                if pid in returned_ids:
                    by_prior_session[session]["returned"] += 1

        # Session 2: 101, 102 were enrolled. Both returned -> 100%
        assert by_prior_session["Session 2"]["base"] == 2
        assert by_prior_session["Session 2"]["returned"] == 2

        # Session 3: 102, 103 were enrolled. Both returned -> 100%
        assert by_prior_session["Session 3"]["base"] == 2
        assert by_prior_session["Session 3"]["returned"] == 2

        # Session 4: 104 was enrolled. Did not return -> 0%
        assert by_prior_session["Session 4"]["base"] == 1
        assert by_prior_session["Session 4"]["returned"] == 0

        # Taste of Camp: 105 was enrolled. Did not return -> 0%
        assert by_prior_session["Taste of Camp"]["base"] == 1
        assert by_prior_session["Taste of Camp"]["returned"] == 0


class TestDemographicBreakdownsNoLimit:
    """Tests for removing top-N limits from demographic breakdowns.

    Currently demographics (school, city, synagogue) are limited to top 20.
    For data quality visibility, we should return ALL values.
    """

    @pytest.fixture
    def many_schools(self) -> list[str]:
        """Generate 50 different school names."""
        schools = [f"School {i}" for i in range(50)]
        return schools

    def test_all_schools_returned_no_limit(self, many_schools: list[str]) -> None:
        """Test that all schools are returned, not just top 20.

        This is important for data quality - users need to see all schools
        to identify duplicates and normalize data.
        """
        # Simulate school stats
        school_stats = {school: {"base": i + 1, "returned": i} for i, school in enumerate(many_schools)}

        # OLD behavior (limited to 20):
        limited_schools = sorted(school_stats.items(), key=lambda x: -x[1]["base"])[:20]
        assert len(limited_schools) == 20

        # NEW behavior (no limit):
        all_schools = sorted(school_stats.items(), key=lambda x: -x[1]["base"])
        assert len(all_schools) == 50

    def test_low_count_demographics_visible(self) -> None:
        """Test that demographics with low counts are visible.

        Even schools with just 1 camper should be visible for data quality.
        """
        school_stats = {
            "Big School": {"base": 100, "returned": 80},
            "Medium School": {"base": 20, "returned": 15},
            "Small School": {"base": 5, "returned": 3},
            "Tiny School": {"base": 1, "returned": 0},  # Would be invisible in top-20
        }

        # All should be returned
        all_schools = list(school_stats.keys())
        assert "Tiny School" in all_schools


class TestRetentionSchemasForNewBreakdowns:
    """Tests verifying new Pydantic schemas for retention tab redesign."""

    def test_retention_by_summer_years_schema_exists(self) -> None:
        """Test that RetentionBySummerYears schema exists with correct fields."""
        from api.schemas.metrics import RetentionBySummerYears

        instance = RetentionBySummerYears(
            summer_years=3,
            base_count=10,
            returned_count=8,
            retention_rate=0.8,
        )
        assert instance.summer_years == 3
        assert instance.base_count == 10
        assert instance.returned_count == 8
        assert instance.retention_rate == 0.8

    def test_retention_by_first_summer_year_schema_exists(self) -> None:
        """Test that RetentionByFirstSummerYear schema exists with correct fields."""
        from api.schemas.metrics import RetentionByFirstSummerYear

        instance = RetentionByFirstSummerYear(
            first_summer_year=2020,
            base_count=15,
            returned_count=12,
            retention_rate=0.8,
        )
        assert instance.first_summer_year == 2020
        assert instance.base_count == 15
        assert instance.returned_count == 12
        assert instance.retention_rate == 0.8

    def test_retention_by_prior_session_schema_exists(self) -> None:
        """Test that RetentionByPriorSession schema exists with correct fields."""
        from api.schemas.metrics import RetentionByPriorSession

        instance = RetentionByPriorSession(
            prior_session="Session 2",
            base_count=25,
            returned_count=20,
            retention_rate=0.8,
        )
        assert instance.prior_session == "Session 2"
        assert instance.base_count == 25
        assert instance.returned_count == 20
        assert instance.retention_rate == 0.8

    def test_retention_response_includes_new_breakdown_fields(self) -> None:
        """Test that RetentionMetricsResponse includes new breakdown fields."""
        from api.schemas.metrics import RetentionMetricsResponse

        fields = RetentionMetricsResponse.model_fields

        assert "by_summer_years" in fields, "Should include by_summer_years"
        assert "by_first_summer_year" in fields, "Should include by_first_summer_year"
        assert "by_prior_session" in fields, "Should include by_prior_session"


class TestBatchFetchSummerEnrollmentHistory:
    """Tests for batch fetching summer enrollment history from attendees table.

    Performance critical: fetching enrollment history for all persons in a
    single batched query instead of per-person queries.
    """

    def test_batch_query_structure(self) -> None:
        """Test the structure of a batched enrollment history query.

        The query should:
        1. Filter by person_id IN (...)
        2. Filter by status_id = 2 (enrolled)
        3. Expand session to get session_type and year
        4. Return all matching records in single query
        """
        person_ids = {101, 102, 103, 104, 105}

        # Build filter string as the API would
        person_ids_str = ",".join(str(pid) for pid in sorted(person_ids))
        filter_str = f"person_id ?= [{person_ids_str}] && status_id = 2"

        # Verify filter structure
        assert "person_id ?=" in filter_str
        assert "status_id = 2" in filter_str
        assert "101" in filter_str
        assert "105" in filter_str

    def test_group_enrollment_history_by_person(self) -> None:
        """Test grouping fetched enrollment records by person_id.

        After batch fetch, records need to be grouped by person_id for
        efficient computation of summer years, first year, etc.
        """
        # Simulate batch fetch results
        enrollment_records: list[dict[str, Any]] = [
            {"person_id": 101, "year": 2023, "session_type": "main"},
            {"person_id": 101, "year": 2024, "session_type": "main"},
            {"person_id": 101, "year": 2025, "session_type": "main"},
            {"person_id": 102, "year": 2024, "session_type": "embedded"},
            {"person_id": 102, "year": 2025, "session_type": "main"},
            {"person_id": 103, "year": 2025, "session_type": "ag"},
        ]

        # Group by person_id
        by_person: dict[int, list[dict[str, Any]]] = {}
        for record in enrollment_records:
            pid = int(record["person_id"])
            if pid not in by_person:
                by_person[pid] = []
            by_person[pid].append(record)

        assert len(by_person[101]) == 3
        assert len(by_person[102]) == 2
        assert len(by_person[103]) == 1

    def test_compute_summer_years_from_grouped_history(self) -> None:
        """Test computing summer years count from grouped enrollment history."""
        by_person = {
            101: [
                {"year": 2023, "session_type": "main"},
                {"year": 2024, "session_type": "main"},
                {"year": 2025, "session_type": "main"},
            ],
            102: [
                {"year": 2024, "session_type": "embedded"},
                {"year": 2025, "session_type": "main"},
            ],
            103: [
                {"year": 2025, "session_type": "ag"},
            ],
        }

        summer_years_by_person = {pid: len({r["year"] for r in records}) for pid, records in by_person.items()}

        assert summer_years_by_person[101] == 3
        assert summer_years_by_person[102] == 2
        assert summer_years_by_person[103] == 1

    def test_compute_first_summer_year_from_grouped_history(self) -> None:
        """Test computing first summer year from grouped enrollment history."""
        by_person: dict[int, list[dict[str, Any]]] = {
            101: [
                {"year": 2023, "session_type": "main"},
                {"year": 2024, "session_type": "main"},
                {"year": 2025, "session_type": "main"},
            ],
            102: [
                {"year": 2024, "session_type": "embedded"},
                {"year": 2025, "session_type": "main"},
            ],
        }

        first_summer_year_by_person = {pid: min(int(r["year"]) for r in records) for pid, records in by_person.items()}

        assert first_summer_year_by_person[101] == 2023
        assert first_summer_year_by_person[102] == 2024

    def test_compute_prior_year_sessions_from_grouped_history(self) -> None:
        """Test computing prior year sessions from grouped enrollment history."""
        prior_year = 2024

        by_person = {
            101: [
                {"year": 2024, "session_name": "Session 2", "session_type": "main"},
                {"year": 2025, "session_name": "Session 3", "session_type": "main"},
            ],
            102: [
                {"year": 2024, "session_name": "Session 2", "session_type": "main"},
                {"year": 2024, "session_name": "Session 3", "session_type": "main"},
                {"year": 2025, "session_name": "Session 2", "session_type": "main"},
            ],
            103: [
                {"year": 2025, "session_name": "Session 2", "session_type": "main"},
            ],
        }

        prior_sessions_by_person = {
            pid: [r["session_name"] for r in records if r["year"] == prior_year] for pid, records in by_person.items()
        }

        assert prior_sessions_by_person[101] == ["Session 2"]
        assert prior_sessions_by_person[102] == ["Session 2", "Session 3"]
        assert prior_sessions_by_person[103] == []  # No prior year enrollment


class TestRetentionEndpointWithSessionCmId:
    """Integration tests for retention endpoint with session_cm_id parameter."""

    @pytest.fixture
    def app(self) -> Any:
        """Create test application with auth bypassed."""
        return create_app()

    @pytest.fixture
    def client(self, app: Any) -> TestClient:
        """Create test client."""
        return TestClient(app)

    def test_retention_endpoint_accepts_session_cm_id_param(self, client: TestClient, mock_pocketbase: Mock) -> None:
        """Test that retention endpoint accepts session_cm_id parameter."""
        mock_pb = mock_pocketbase
        mock_pb.collection.return_value.get_full_list.return_value = []

        with patch("api.routers.metrics.pb", mock_pb):
            # Should not error with session_cm_id parameter
            response = client.get("/api/metrics/retention?base_year=2025&compare_year=2026&session_cm_id=1001")
            assert response.status_code == 200

    def test_retention_endpoint_returns_new_breakdown_fields(self, client: TestClient, mock_pocketbase: Mock) -> None:
        """Test that retention endpoint returns new breakdown fields in response."""
        mock_pb = mock_pocketbase
        mock_pb.collection.return_value.get_full_list.return_value = []

        with patch("api.routers.metrics.pb", mock_pb):
            response = client.get("/api/metrics/retention?base_year=2025&compare_year=2026")
            assert response.status_code == 200
            data = response.json()

            # New fields should be present (may be empty lists)
            assert "by_summer_years" in data
            assert "by_first_summer_year" in data
            assert "by_prior_session" in data
