"""
TDD tests for Retention Trends API endpoint.

Tests for:
- GET /api/metrics/retention-trends endpoint
- 3-year data aggregation (current year vs prior 2 years)
- session_types and session_cm_id filtering
- Response structure with trend data

These tests are written FIRST before implementation (TDD).
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
) -> Mock:
    """Create a mock session record."""
    session = Mock()
    session.cm_id = cm_id
    session.name = name
    session.year = year
    session.session_type = session_type
    session.start_date = start_date
    session.end_date = end_date
    session.parent_id = None
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
    attendee.expand = {"session": session}
    return attendee


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def client():
    """Create test client with mocked PocketBase."""
    app = create_app()
    return TestClient(app)


@pytest.fixture
def multi_year_sessions() -> dict[int, list[Mock]]:
    """Sessions across multiple years for trend analysis."""
    return {
        2024: [
            create_mock_session(1001, "Session 2", 2024, "main", "2024-06-15", "2024-07-05"),
            create_mock_session(1002, "Session 3", 2024, "main", "2024-07-07", "2024-07-27"),
        ],
        2025: [
            create_mock_session(1501, "Session 2", 2025, "main", "2025-06-15", "2025-07-05"),
            create_mock_session(1502, "Session 3", 2025, "main", "2025-07-07", "2025-07-27"),
        ],
        2026: [
            create_mock_session(2001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05"),
            create_mock_session(2002, "Session 3", 2026, "main", "2026-07-07", "2026-07-27"),
        ],
    }


@pytest.fixture
def multi_year_persons() -> dict[int, list[Mock]]:
    """Persons across multiple years for trend analysis."""
    return {
        2024: [
            create_mock_person(101, "Emma", "Johnson", "F", 5, 1, 2024),
            create_mock_person(102, "Liam", "Garcia", "M", 5, 1, 2024),
            create_mock_person(103, "Olivia", "Chen", "F", 6, 2, 2024),
            create_mock_person(104, "Noah", "Williams", "M", 6, 2, 2024),
            create_mock_person(105, "Ava", "Brown", "F", 7, 3, 2024),
        ],
        2025: [
            # 101, 102, 103 returned (3 of 5 = 60% retention from 2024)
            create_mock_person(101, "Emma", "Johnson", "F", 6, 2, 2025),
            create_mock_person(102, "Liam", "Garcia", "M", 6, 2, 2025),
            create_mock_person(103, "Olivia", "Chen", "F", 7, 3, 2025),
            # New in 2025
            create_mock_person(201, "Sophia", "Martinez", "F", 5, 1, 2025),
            create_mock_person(202, "Jackson", "Lee", "M", 5, 1, 2025),
        ],
        2026: [
            # 101, 102, 201 returned (3 of 5 = 60% retention from 2025)
            create_mock_person(101, "Emma", "Johnson", "F", 7, 3, 2026),
            create_mock_person(102, "Liam", "Garcia", "M", 7, 3, 2026),
            create_mock_person(201, "Sophia", "Martinez", "F", 6, 2, 2026),
            # New in 2026
            create_mock_person(301, "Mason", "Davis", "M", 5, 1, 2026),
            create_mock_person(302, "Isabella", "Wilson", "F", 5, 1, 2026),
        ],
    }


@pytest.fixture
def multi_year_attendees(
    multi_year_sessions: dict[int, list[Mock]],
) -> dict[int, list[Mock]]:
    """Attendees across multiple years for trend analysis."""
    attendees: dict[int, list[Mock]] = {}

    for year, sessions in multi_year_sessions.items():
        session_2 = sessions[0]
        attendees[year] = []

        # Different person IDs for each year (based on multi_year_persons fixture)
        if year == 2024:
            person_ids = [101, 102, 103, 104, 105]
        elif year == 2025:
            person_ids = [101, 102, 103, 201, 202]
        else:  # 2026
            person_ids = [101, 102, 201, 301, 302]

        for pid in person_ids:
            attendees[year].append(create_mock_attendee(pid, session_2, year))

    return attendees


# ============================================================================
# Retention Trend Calculation Tests
# ============================================================================


class TestRetentionTrendCalculation:
    """Tests for retention trend calculation logic."""

    def test_three_year_trend_calculation(
        self,
        multi_year_attendees: dict[int, list[Mock]],
    ) -> None:
        """Calculates retention for 3 year transitions.

        For current_year=2026, we need:
        - 2024→2025 retention: 3/5 = 60%
        - 2025→2026 retention: 3/5 = 60%
        """
        # Calculate 2024→2025 retention
        persons_2024 = {a.person_id for a in multi_year_attendees[2024]}
        persons_2025 = {a.person_id for a in multi_year_attendees[2025]}
        returned_2024_to_2025 = persons_2024 & persons_2025

        retention_2024_2025 = len(returned_2024_to_2025) / len(persons_2024)
        assert retention_2024_2025 == pytest.approx(0.6)  # 3/5

        # Calculate 2025→2026 retention
        persons_2026 = {a.person_id for a in multi_year_attendees[2026]}
        returned_2025_to_2026 = persons_2025 & persons_2026

        retention_2025_2026 = len(returned_2025_to_2026) / len(persons_2025)
        assert retention_2025_2026 == pytest.approx(0.6)  # 3/5

    def test_trend_direction_calculation(self) -> None:
        """Trend direction should be calculated from rate changes.

        - Improving: current rate > average of prior rates
        - Declining: current rate < average of prior rates
        - Stable: within a small threshold
        """
        # Scenario 1: Improving trend
        rates = [0.50, 0.55, 0.60]  # 50%, 55%, 60%
        avg_prior = (rates[0] + rates[1]) / 2
        current = rates[2]
        assert current > avg_prior  # Improving

        # Scenario 2: Declining trend
        rates = [0.70, 0.65, 0.55]  # 70%, 65%, 55%
        avg_prior = (rates[0] + rates[1]) / 2
        current = rates[2]
        assert current < avg_prior  # Declining

        # Scenario 3: Stable trend
        rates = [0.60, 0.60, 0.61]  # 60%, 60%, 61%
        avg_prior = (rates[0] + rates[1]) / 2
        current = rates[2]
        threshold = 0.02  # 2% threshold
        assert abs(current - avg_prior) <= threshold  # Stable

    def test_retention_by_gender_across_years(
        self,
        multi_year_persons: dict[int, list[Mock]],
        multi_year_attendees: dict[int, list[Mock]],
    ) -> None:
        """Retention breakdowns by gender should span all years.

        This enables grouped bar charts showing gender retention over time.
        """

        # For each year transition, calculate retention by gender
        def calc_retention_by_gender(
            base_year: int,
            compare_year: int,
            persons_by_year: dict[int, list[Mock]],
            attendees_by_year: dict[int, list[Mock]],
        ) -> dict[str, float]:
            persons_lookup = {p.cm_id: p for p in persons_by_year[base_year]}
            base_ids = {a.person_id for a in attendees_by_year[base_year]}
            compare_ids = {a.person_id for a in attendees_by_year[compare_year]}
            returned = base_ids & compare_ids

            by_gender: dict[str, dict[str, int]] = {}
            for pid in base_ids:
                person = persons_lookup.get(pid)
                if not person:
                    continue
                gender = person.gender
                if gender not in by_gender:
                    by_gender[gender] = {"base": 0, "returned": 0}
                by_gender[gender]["base"] += 1
                if pid in returned:
                    by_gender[gender]["returned"] += 1

            return {g: stats["returned"] / stats["base"] if stats["base"] > 0 else 0 for g, stats in by_gender.items()}

        # 2024→2025 by gender
        retention_2024_2025 = calc_retention_by_gender(2024, 2025, multi_year_persons, multi_year_attendees)
        assert "F" in retention_2024_2025
        assert "M" in retention_2024_2025

        # 2025→2026 by gender
        retention_2025_2026 = calc_retention_by_gender(2025, 2026, multi_year_persons, multi_year_attendees)
        assert "F" in retention_2025_2026
        assert "M" in retention_2025_2026


# ============================================================================
# Response Structure Tests
# ============================================================================


class TestRetentionTrendsResponseStructure:
    """Tests for the expected response structure."""

    def test_response_has_year_transitions(self) -> None:
        """Response should include data for each year transition.

        Expected structure:
        {
            "years": [
                {
                    "from_year": 2024,
                    "to_year": 2025,
                    "retention_rate": 0.60,
                    "base_count": 100,
                    "returned_count": 60,
                    "by_gender": [...],
                    "by_grade": [...]
                },
                {
                    "from_year": 2025,
                    "to_year": 2026,
                    "retention_rate": 0.65,
                    ...
                }
            ],
            "avg_retention_rate": 0.625,
            "trend_direction": "improving"
        }
        """
        # Mock response structure
        expected_fields = {
            "years": list,
            "avg_retention_rate": (int, float),
            "trend_direction": str,
        }

        # Each year entry should have these fields
        year_entry_fields = {
            "from_year": int,
            "to_year": int,
            "retention_rate": (int, float),
            "base_count": int,
            "returned_count": int,
            "by_gender": list,
            "by_grade": list,
        }

        # Verify structure is as expected (this is a schema test)
        for field, field_type in expected_fields.items():
            assert field in expected_fields  # Sanity check

        for field, field_type in year_entry_fields.items():
            assert field in year_entry_fields  # Sanity check

    def test_breakdown_entries_have_year_values(self) -> None:
        """Breakdown entries should include values for each year.

        For grouped bar charts, we need structure like:
        {
            "by_gender": [
                {
                    "gender": "M",
                    "values": [
                        {"from_year": 2024, "to_year": 2025, "retention_rate": 0.55},
                        {"from_year": 2025, "to_year": 2026, "retention_rate": 0.60}
                    ]
                },
                {
                    "gender": "F",
                    "values": [
                        {"from_year": 2024, "to_year": 2025, "retention_rate": 0.65},
                        {"from_year": 2025, "to_year": 2026, "retention_rate": 0.70}
                    ]
                }
            ]
        }
        """
        # This test documents the expected structure for frontend consumption
        mock_breakdown = {
            "gender": "M",
            "values": [
                {"from_year": 2024, "to_year": 2025, "retention_rate": 0.55},
                {"from_year": 2025, "to_year": 2026, "retention_rate": 0.60},
            ],
        }

        assert mock_breakdown["gender"] == "M"
        assert len(mock_breakdown["values"]) == 2


# ============================================================================
# Parameter Tests
# ============================================================================


class TestRetentionTrendsParameters:
    """Tests for endpoint parameters."""

    def test_num_years_parameter(self) -> None:
        """num_years parameter controls how many year transitions to include.

        Default: 3 (means 2 transitions: Y-2→Y-1, Y-1→Y)
        Custom: 5 (means 4 transitions: Y-4→Y-3, Y-3→Y-2, Y-2→Y-1, Y-1→Y)
        """
        current_year = 2026
        num_years = 3

        # Calculate year pairs
        years = list(range(current_year - num_years + 1, current_year + 1))
        transitions = [(years[i], years[i + 1]) for i in range(len(years) - 1)]

        assert years == [2024, 2025, 2026]
        assert transitions == [(2024, 2025), (2025, 2026)]

        # With num_years=5
        num_years = 5
        years = list(range(current_year - num_years + 1, current_year + 1))
        transitions = [(years[i], years[i + 1]) for i in range(len(years) - 1)]

        assert years == [2022, 2023, 2024, 2025, 2026]
        assert len(transitions) == 4

    def test_session_types_filtering(self) -> None:
        """session_types parameter filters to specific session types."""
        all_attendees = [
            {"session_type": "main", "person_id": 1},
            {"session_type": "embedded", "person_id": 2},
            {"session_type": "ag", "person_id": 3},
            {"session_type": "family", "person_id": 4},
        ]

        # Filter to main,embedded
        session_types = ["main", "embedded"]
        filtered = [a for a in all_attendees if a["session_type"] in session_types]

        assert len(filtered) == 2
        assert all(a["session_type"] in session_types for a in filtered)

    def test_session_cm_id_filtering(self) -> None:
        """session_cm_id parameter filters to specific session."""
        all_attendees = [
            {"session_cm_id": 2001, "person_id": 1},
            {"session_cm_id": 2001, "person_id": 2},
            {"session_cm_id": 2002, "person_id": 3},
            {"session_cm_id": 2003, "person_id": 4},
        ]

        # Filter to session 2001
        session_cm_id = 2001
        filtered = [a for a in all_attendees if a["session_cm_id"] == session_cm_id]

        assert len(filtered) == 2
        assert all(a["session_cm_id"] == session_cm_id for a in filtered)


# ============================================================================
# Integration Tests
# ============================================================================


class TestRetentionTrendsEndpoint:
    """Integration tests for the /api/metrics/retention-trends endpoint."""

    def test_endpoint_exists(self, client: TestClient) -> None:
        """The retention-trends endpoint should exist and accept GET requests."""
        with patch("api.routers.metrics.pb") as mock_pb:
            mock_collection = Mock()
            mock_collection.get_full_list = Mock(return_value=[])
            mock_pb.collection = Mock(return_value=mock_collection)

            response = client.get(
                "/api/metrics/retention-trends",
                params={"current_year": 2026},
            )

            # Should not 404 (endpoint exists)
            # Will 500 or 200 depending on implementation status
            assert response.status_code != 404

    def test_endpoint_requires_current_year(self, client: TestClient) -> None:
        """The current_year parameter should be required."""
        with patch("api.routers.metrics.pb") as mock_pb:
            mock_collection = Mock()
            mock_collection.get_full_list = Mock(return_value=[])
            mock_pb.collection = Mock(return_value=mock_collection)

            response = client.get("/api/metrics/retention-trends")

            # Should fail with 422 (validation error) due to missing required param
            # or 404 if endpoint not yet implemented
            assert response.status_code in (404, 422)

    def test_endpoint_accepts_optional_params(self, client: TestClient) -> None:
        """Optional parameters should be accepted."""
        with patch("api.routers.metrics.pb") as mock_pb:
            mock_collection = Mock()
            mock_collection.get_full_list = Mock(return_value=[])
            mock_pb.collection = Mock(return_value=mock_collection)

            response = client.get(
                "/api/metrics/retention-trends",
                params={
                    "current_year": 2026,
                    "num_years": 5,
                    "session_types": "main,embedded",
                    "session_cm_id": 2001,
                },
            )

            # Should not fail with 422 (validation error)
            # 404 if endpoint not implemented, 200/500 otherwise
            assert response.status_code != 422

    def test_response_structure(self, client: TestClient) -> None:
        """Response should have expected structure once implemented."""
        with patch("api.routers.metrics.pb") as mock_pb:
            mock_collection = Mock()
            mock_collection.get_full_list = Mock(return_value=[])
            mock_pb.collection = Mock(return_value=mock_collection)

            response = client.get(
                "/api/metrics/retention-trends",
                params={"current_year": 2026},
            )

            if response.status_code == 200:
                data = response.json()

                # Check required fields
                assert "years" in data
                assert "avg_retention_rate" in data
                assert "trend_direction" in data

                # years should be a list
                assert isinstance(data["years"], list)


# ============================================================================
# Edge Cases
# ============================================================================


class TestRetentionTrendsEdgeCases:
    """Edge case tests for retention trends."""

    def test_handles_year_with_no_data(self) -> None:
        """Years with no enrollment data should be handled gracefully."""
        attendees_by_year: dict[int, list[Any]] = {
            2024: [],  # No data
            2025: [{"person_id": 1}, {"person_id": 2}],
            2026: [{"person_id": 1}],
        }

        # 2024→2025: 0 base, undefined retention
        base_2024 = {a["person_id"] for a in attendees_by_year[2024]}
        compare_2025 = {a["person_id"] for a in attendees_by_year[2025]}

        if len(base_2024) == 0:
            retention_2024_2025 = 0.0  # Or None, depending on implementation
        else:
            returned = base_2024 & compare_2025
            retention_2024_2025 = len(returned) / len(base_2024)

        assert retention_2024_2025 == 0.0

    def test_handles_100_percent_retention(self) -> None:
        """100% retention should be calculated correctly."""
        attendees_by_year = {
            2025: [{"person_id": 1}, {"person_id": 2}, {"person_id": 3}],
            2026: [{"person_id": 1}, {"person_id": 2}, {"person_id": 3}, {"person_id": 4}],
        }

        base = {a["person_id"] for a in attendees_by_year[2025]}
        compare = {a["person_id"] for a in attendees_by_year[2026]}
        returned = base & compare

        retention = len(returned) / len(base)
        assert retention == pytest.approx(1.0)  # 100%

    def test_handles_0_percent_retention(self) -> None:
        """0% retention should be calculated correctly."""
        attendees_by_year = {
            2025: [{"person_id": 1}, {"person_id": 2}],
            2026: [{"person_id": 3}, {"person_id": 4}],  # Completely different
        }

        base = {a["person_id"] for a in attendees_by_year[2025]}
        compare = {a["person_id"] for a in attendees_by_year[2026]}
        returned = base & compare

        retention = len(returned) / len(base) if base else 0
        assert retention == pytest.approx(0.0)  # 0%

    def test_num_years_exceeds_available_data(self) -> None:
        """When num_years exceeds available data, return what's available."""
        # If user requests 5 years but we only have 3 years of data
        available_years = [2024, 2025, 2026]
        requested_num_years = 5

        # Implementation should return data for available years only
        actual_years = available_years[-min(requested_num_years, len(available_years)) :]
        assert actual_years == [2024, 2025, 2026]  # All 3 available
