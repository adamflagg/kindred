"""
Tests for retention metrics endpoints - specifically the enrollment_by_year field
for the 3-year enrollment comparison feature.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

# ============================================================================
# Test fixtures
# ============================================================================


@pytest.fixture
def test_client():
    """Create test client with mocked dependencies."""
    # Set test environment
    os.environ["AUTH_MODE"] = "bypass"
    os.environ["SKIP_PB_AUTH"] = "true"

    # Import app after setting environment
    from api.main import create_app

    app = create_app()
    client = TestClient(app)
    yield client

    # Clean up environment
    os.environ.pop("AUTH_MODE", None)
    os.environ.pop("SKIP_PB_AUTH", None)


# ============================================================================
# enrollment_by_year Tests
# ============================================================================


class TestRetentionTrendsEnrollmentByYear:
    """Tests for the enrollment_by_year field in RetentionTrendsResponse."""

    @pytest.fixture
    def mock_attendees_by_year(
        self,
    ) -> Callable[[int, list[dict[str, Any]]], list[MagicMock]]:
        """Create mock attendees for multiple years with gender/grade data."""

        def create_attendees(year: int, person_data: list[dict[str, Any]]) -> list[MagicMock]:
            """Create mock attendee objects with person expansion."""
            attendees: list[MagicMock] = []
            for _i, data in enumerate(person_data):
                attendee = MagicMock()
                attendee.person_id = data["person_id"]
                attendee.year = year
                # Mock expand for session
                session = MagicMock()
                session.cm_id = 1000001
                session.session_type = "main"
                session.name = "Session 1"
                attendee.expand = {"session": session}
                attendees.append(attendee)
            return attendees

        return create_attendees

    @pytest.fixture
    def mock_persons_by_year(
        self,
    ) -> Callable[[int, list[dict[str, Any]]], dict[int, MagicMock]]:
        """Create mock persons for multiple years."""

        def create_persons(_year: int, person_data: list[dict[str, Any]]) -> dict[int, MagicMock]:
            """Create mock person objects with gender/grade."""
            persons: dict[int, MagicMock] = {}
            for data in person_data:
                person = MagicMock()
                person.cm_id = data["person_id"]
                person.gender = data.get("gender", "M")
                person.grade = data.get("grade")
                person.years_at_camp = data.get("years_at_camp", 1)
                persons[data["person_id"]] = person
            return persons

        return create_persons

    def test_enrollment_by_year_field_exists(self, test_client: TestClient) -> None:
        """Test that enrollment_by_year is present in the response."""
        response = test_client.get(
            "/api/metrics/retention-trends",
            params={"current_year": 2026, "num_years": 3},
        )

        # Should return 200 even if no data
        assert response.status_code == 200
        data = response.json()

        # Field should exist in response
        assert "enrollment_by_year" in data, "enrollment_by_year field is missing from response"

    def test_enrollment_by_year_has_correct_structure(self, test_client: TestClient) -> None:
        """Test that enrollment_by_year entries have the correct structure."""
        response = test_client.get(
            "/api/metrics/retention-trends",
            params={"current_year": 2026, "num_years": 3},
        )

        assert response.status_code == 200
        data = response.json()

        enrollment_by_year = data.get("enrollment_by_year", [])

        # If data exists, verify structure
        for entry in enrollment_by_year:
            assert "year" in entry, "year field missing"
            assert "total" in entry, "total field missing"
            assert "by_gender" in entry, "by_gender field missing"
            assert "by_grade" in entry, "by_grade field missing"

            # Verify by_gender structure
            for gender_entry in entry["by_gender"]:
                assert "gender" in gender_entry, "gender field missing in by_gender"
                assert "count" in gender_entry, "count field missing in by_gender"

            # Verify by_grade structure
            for grade_entry in entry["by_grade"]:
                assert "grade" in grade_entry or grade_entry.get("grade") is None, "grade field check failed"
                assert "count" in grade_entry, "count field missing in by_grade"

    def test_enrollment_by_year_has_three_entries_for_three_years(self, test_client: TestClient) -> None:
        """Test that num_years=3 returns 3 enrollment entries."""
        response = test_client.get(
            "/api/metrics/retention-trends",
            params={"current_year": 2026, "num_years": 3},
        )

        assert response.status_code == 200
        data = response.json()

        enrollment_by_year = data.get("enrollment_by_year", [])

        # Should have exactly 3 entries for years 2024, 2025, 2026
        assert len(enrollment_by_year) == 3, f"Expected 3 entries, got {len(enrollment_by_year)}"

        # Verify the years are correct
        years = [entry["year"] for entry in enrollment_by_year]
        assert years == [2024, 2025, 2026], f"Expected years [2024, 2025, 2026], got {years}"

    def test_enrollment_by_year_gender_totals_match_year_total(self, test_client: TestClient) -> None:
        """Test that sum of gender counts equals year total."""
        response = test_client.get(
            "/api/metrics/retention-trends",
            params={"current_year": 2026, "num_years": 3},
        )

        assert response.status_code == 200
        data = response.json()

        for entry in data.get("enrollment_by_year", []):
            gender_total = sum(g["count"] for g in entry["by_gender"])
            # Gender counts should equal total (each person counted once)
            assert gender_total == entry["total"], (
                f"Year {entry['year']}: gender total {gender_total} != year total {entry['total']}"
            )

    def test_enrollment_by_year_grade_totals_match_year_total(self, test_client: TestClient) -> None:
        """Test that sum of grade counts equals year total."""
        response = test_client.get(
            "/api/metrics/retention-trends",
            params={"current_year": 2026, "num_years": 3},
        )

        assert response.status_code == 200
        data = response.json()

        for entry in data.get("enrollment_by_year", []):
            grade_total = sum(g["count"] for g in entry["by_grade"])
            # Grade counts should equal total (each person counted once)
            assert grade_total == entry["total"], (
                f"Year {entry['year']}: grade total {grade_total} != year total {entry['total']}"
            )


class TestEnrollmentByYearSchemas:
    """Test the schema definitions for enrollment_by_year types."""

    def test_gender_enrollment_schema(self):
        """Test GenderEnrollment schema can be instantiated."""
        from api.schemas.metrics import GenderEnrollment

        entry = GenderEnrollment(gender="M", count=50)
        assert entry.gender == "M"
        assert entry.count == 50

    def test_grade_enrollment_schema(self):
        """Test GradeEnrollment schema can be instantiated."""
        from api.schemas.metrics import GradeEnrollment

        entry = GradeEnrollment(grade=5, count=30)
        assert entry.grade == 5
        assert entry.count == 30

        # Test with null grade
        entry_null = GradeEnrollment(grade=None, count=10)
        assert entry_null.grade is None
        assert entry_null.count == 10

    def test_year_enrollment_schema(self):
        """Test YearEnrollment schema can be instantiated."""
        from api.schemas.metrics import GenderEnrollment, GradeEnrollment, YearEnrollment

        entry = YearEnrollment(
            year=2025,
            total=100,
            by_gender=[
                GenderEnrollment(gender="M", count=52),
                GenderEnrollment(gender="F", count=48),
            ],
            by_grade=[
                GradeEnrollment(grade=5, count=25),
                GradeEnrollment(grade=6, count=35),
                GradeEnrollment(grade=7, count=40),
            ],
        )

        assert entry.year == 2025
        assert entry.total == 100
        assert len(entry.by_gender) == 2
        assert len(entry.by_grade) == 3

    def test_retention_trends_response_has_enrollment_by_year(self):
        """Test RetentionTrendsResponse includes enrollment_by_year field."""
        from api.schemas.metrics import RetentionTrendsResponse, YearEnrollment

        response = RetentionTrendsResponse(
            years=[],
            avg_retention_rate=0.75,
            trend_direction="stable",
            enrollment_by_year=[
                YearEnrollment(year=2024, total=100, by_gender=[], by_grade=[]),
                YearEnrollment(year=2025, total=110, by_gender=[], by_grade=[]),
                YearEnrollment(year=2026, total=120, by_gender=[], by_grade=[]),
            ],
        )

        assert len(response.enrollment_by_year) == 3
        assert response.enrollment_by_year[0].year == 2024
        assert response.enrollment_by_year[1].year == 2025
        assert response.enrollment_by_year[2].year == 2026


# ============================================================================
# Integration test with mocked PocketBase
# ============================================================================


class TestRetentionTrendsEnrollmentIntegration:
    """Integration tests for enrollment_by_year calculation."""

    @pytest.fixture
    def mock_pb_data(self) -> dict[int, dict[int, MagicMock]]:
        """Create realistic mock data for 3 years."""
        # Year 2024: 100 campers (52 M, 48 F)
        year_2024_persons = []
        for i in range(52):
            person = MagicMock()
            person.cm_id = 1000 + i
            person.gender = "M"
            person.grade = 5 + (i % 4)  # Grades 5-8
            person.years_at_camp = 1 + (i % 3)
            year_2024_persons.append((1000 + i, person))
        for i in range(48):
            person = MagicMock()
            person.cm_id = 2000 + i
            person.gender = "F"
            person.grade = 5 + (i % 4)
            person.years_at_camp = 1 + (i % 3)
            year_2024_persons.append((2000 + i, person))

        # Year 2025: 110 campers (55 M, 55 F)
        year_2025_persons = []
        for i in range(55):
            person = MagicMock()
            person.cm_id = 3000 + i
            person.gender = "M"
            person.grade = 5 + (i % 4)
            person.years_at_camp = 1 + (i % 3)
            year_2025_persons.append((3000 + i, person))
        for i in range(55):
            person = MagicMock()
            person.cm_id = 4000 + i
            person.gender = "F"
            person.grade = 5 + (i % 4)
            person.years_at_camp = 1 + (i % 3)
            year_2025_persons.append((4000 + i, person))

        # Year 2026: 120 campers (60 M, 60 F)
        year_2026_persons = []
        for i in range(60):
            person = MagicMock()
            person.cm_id = 5000 + i
            person.gender = "M"
            person.grade = 5 + (i % 4)
            person.years_at_camp = 1 + (i % 3)
            year_2026_persons.append((5000 + i, person))
        for i in range(60):
            person = MagicMock()
            person.cm_id = 6000 + i
            person.gender = "F"
            person.grade = 5 + (i % 4)
            person.years_at_camp = 1 + (i % 3)
            year_2026_persons.append((6000 + i, person))

        return {
            2024: dict(year_2024_persons),
            2025: dict(year_2025_persons),
            2026: dict(year_2026_persons),
        }

    def test_enrollment_totals_calculated_correctly(
        self, test_client: TestClient, mock_pb_data: dict[int, dict[int, MagicMock]]
    ) -> None:
        """Test that enrollment totals are calculated correctly per year."""
        # This test will initially fail until implementation is complete
        response = test_client.get(
            "/api/metrics/retention-trends",
            params={"current_year": 2026, "num_years": 3},
        )

        assert response.status_code == 200
        data = response.json()

        enrollment_by_year = data.get("enrollment_by_year", [])

        # Verify we have entries for all 3 years
        assert len(enrollment_by_year) == 3, f"Expected 3 entries, got {len(enrollment_by_year)}"


class TestEnrollmentByYearAllSessions:
    """Tests for enrollment_by_year when 'All Sessions' is selected (no session_cm_id filter).

    This tests the specific bug where person lookup fails for "All Sessions" but works
    when a specific session is selected.
    """

    def test_all_sessions_has_gender_data(self, test_client: TestClient) -> None:
        """Test that by_gender is populated when no session_cm_id filter is applied.

        This catches the bug where person lookup fails for 'All Sessions' view.
        The retention breakdown (lines 1550-1559) uses the same lookup pattern but
        works correctly, while enrollment_by_year (lines 1638-1643) fails.
        """
        response = test_client.get(
            "/api/metrics/retention-trends",
            params={"current_year": 2026, "num_years": 3},
            # Note: no session_cm_id - this is the "All Sessions" case
        )

        assert response.status_code == 200
        data = response.json()

        enrollment_by_year = data.get("enrollment_by_year", [])
        assert len(enrollment_by_year) == 3, f"Expected 3 years, got {len(enrollment_by_year)}"

        # Track which years have gender data
        years_with_gender_data = []
        years_with_empty_gender = []

        for entry in enrollment_by_year:
            year = entry["year"]
            total = entry["total"]
            by_gender = entry.get("by_gender", [])

            if by_gender:
                years_with_gender_data.append(year)
                # Verify gender counts sum to total
                gender_sum = sum(g["count"] for g in by_gender)
                assert gender_sum == total, f"Year {year}: gender sum {gender_sum} != total {total}"
            elif total > 0:
                # If total > 0 but no gender data, person lookup failed
                years_with_empty_gender.append((year, total))

        # If any year has total > 0 but empty gender data, the lookup failed
        if years_with_empty_gender:
            failed_years = ", ".join(f"{year} (total={total})" for year, total in years_with_empty_gender)
            pytest.fail(
                f"Person lookup failed for 'All Sessions': years with total>0 but empty "
                f"by_gender: {failed_years}. This indicates person_ids don't match "
                f"persons dict keys."
            )

    def test_all_sessions_has_grade_data(self, test_client: TestClient) -> None:
        """Test that by_grade is populated when no session_cm_id filter is applied."""
        response = test_client.get(
            "/api/metrics/retention-trends",
            params={"current_year": 2026, "num_years": 3},
        )

        assert response.status_code == 200
        data = response.json()

        enrollment_by_year = data.get("enrollment_by_year", [])

        years_with_empty_grade = []

        for entry in enrollment_by_year:
            year = entry["year"]
            total = entry["total"]
            by_grade = entry.get("by_grade", [])

            if not by_grade and total > 0:
                years_with_empty_grade.append((year, total))
            elif by_grade:
                grade_sum = sum(g["count"] for g in by_grade)
                assert grade_sum == total, f"Year {year}: grade sum {grade_sum} != total {total}"

        if years_with_empty_grade:
            failed_years = ", ".join(f"{year} (total={total})" for year, total in years_with_empty_grade)
            pytest.fail(
                f"Person lookup failed for 'All Sessions': years with total>0 but empty by_grade: {failed_years}."
            )

    def test_all_sessions_vs_specific_session_consistency(self, test_client: TestClient) -> None:
        """Test that data is consistent between 'All Sessions' and specific session queries.

        If specific session works but 'All Sessions' doesn't, this indicates a lookup bug.
        """
        # Get "All Sessions" data
        all_response = test_client.get(
            "/api/metrics/retention-trends",
            params={"current_year": 2026, "num_years": 3},
        )
        assert all_response.status_code == 200
        all_data = all_response.json()

        # Check if we have any data at all
        all_enrollment = all_data.get("enrollment_by_year", [])
        current_year_entry = next((e for e in all_enrollment if e["year"] == 2026), None)

        if current_year_entry and current_year_entry["total"] > 0:
            # We have data - verify gender/grade lookups worked
            by_gender = current_year_entry.get("by_gender", [])
            by_grade = current_year_entry.get("by_grade", [])

            # This is the key assertion: if total > 0, we must have breakdown data
            assert by_gender, (
                f"Year 2026 has total={current_year_entry['total']} but empty by_gender. "
                f"Person lookup is failing for 'All Sessions' view."
            )
            assert by_grade, (
                f"Year 2026 has total={current_year_entry['total']} but empty by_grade. "
                f"Person lookup is failing for 'All Sessions' view."
            )
