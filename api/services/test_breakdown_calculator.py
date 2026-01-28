"""Tests for the breakdown calculator - written first (TDD).

These tests define the expected behavior for the generic breakdown computation
that will eliminate 26+ duplicate patterns in metrics.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest


@dataclass
class MockPerson:
    """Mock person object for testing."""

    person_id: int
    gender: str | None = None
    grade: int | None = None
    school: str | None = None
    city: str | None = None
    synagogue: str | None = None
    years_at_camp: int | None = None


@dataclass
class MockCamperHistory:
    """Mock camper history record for testing."""

    person_id: int
    first_year_attended: int | None = None
    school: str | None = None
    city: str | None = None
    synagogue: str | None = None
    sessions: str | None = None  # Comma-separated
    bunks: str | None = None  # Comma-separated


class TestBreakdownCalculator:
    """Tests for the compute_breakdown function."""

    def test_basic_gender_breakdown(self) -> None:
        """compute_breakdown computes correct stats for gender."""
        from api.services.breakdown_calculator import BreakdownStats, compute_breakdown
        from api.services.extractors import extract_gender

        persons = {
            1: MockPerson(person_id=1, gender="M"),
            2: MockPerson(person_id=2, gender="M"),
            3: MockPerson(person_id=3, gender="F"),
            4: MockPerson(person_id=4, gender="F"),
            5: MockPerson(person_id=5, gender="F"),
        }
        person_ids = {1, 2, 3, 4, 5}
        returned_ids = {1, 3, 4}  # 1 male, 2 females returned

        result = compute_breakdown(person_ids, returned_ids, persons, extract_gender)

        assert "M" in result
        assert "F" in result
        assert result["M"].base_count == 2
        assert result["M"].returned_count == 1
        assert result["M"].retention_rate == 0.5  # 1/2
        assert result["F"].base_count == 3
        assert result["F"].returned_count == 2
        assert result["F"].retention_rate == pytest.approx(2 / 3)

    def test_empty_persons_dict(self) -> None:
        """compute_breakdown handles empty persons dict gracefully."""
        from api.services.breakdown_calculator import compute_breakdown
        from api.services.extractors import extract_gender

        persons: dict[int, Any] = {}
        person_ids = {1, 2, 3}
        returned_ids = {1}

        result = compute_breakdown(person_ids, returned_ids, persons, extract_gender)

        assert result == {}

    def test_no_returned_campers(self) -> None:
        """compute_breakdown handles zero retention correctly."""
        from api.services.breakdown_calculator import compute_breakdown
        from api.services.extractors import extract_gender

        persons = {
            1: MockPerson(person_id=1, gender="M"),
            2: MockPerson(person_id=2, gender="F"),
        }
        person_ids = {1, 2}
        returned_ids: set[int] = set()  # Nobody returned

        result = compute_breakdown(person_ids, returned_ids, persons, extract_gender)

        assert result["M"].base_count == 1
        assert result["M"].returned_count == 0
        assert result["M"].retention_rate == 0.0
        assert result["F"].base_count == 1
        assert result["F"].returned_count == 0
        assert result["F"].retention_rate == 0.0

    def test_all_returned(self) -> None:
        """compute_breakdown handles 100% retention correctly."""
        from api.services.breakdown_calculator import compute_breakdown
        from api.services.extractors import extract_gender

        persons = {
            1: MockPerson(person_id=1, gender="M"),
            2: MockPerson(person_id=2, gender="M"),
        }
        person_ids = {1, 2}
        returned_ids = {1, 2}  # Everyone returned

        result = compute_breakdown(person_ids, returned_ids, persons, extract_gender)

        assert result["M"].base_count == 2
        assert result["M"].returned_count == 2
        assert result["M"].retention_rate == 1.0

    def test_missing_person_in_dict(self) -> None:
        """compute_breakdown skips person IDs not in the persons dict."""
        from api.services.breakdown_calculator import compute_breakdown
        from api.services.extractors import extract_gender

        persons = {
            1: MockPerson(person_id=1, gender="M"),
            # Person 2 is NOT in the dict
        }
        person_ids = {1, 2}  # But we try to look up both
        returned_ids = {1, 2}

        result = compute_breakdown(person_ids, returned_ids, persons, extract_gender)

        # Only person 1 should be counted
        assert result["M"].base_count == 1
        assert result["M"].returned_count == 1

    def test_null_value_handling_with_default(self) -> None:
        """compute_breakdown handles None values using the default."""
        from api.services.breakdown_calculator import compute_breakdown
        from api.services.extractors import extract_gender

        persons = {
            1: MockPerson(person_id=1, gender="M"),
            2: MockPerson(person_id=2, gender=None),  # Null gender
        }
        person_ids = {1, 2}
        returned_ids = {1}

        result = compute_breakdown(person_ids, returned_ids, persons, extract_gender)

        # Gender extractor should return "Unknown" for None
        assert "M" in result
        assert "Unknown" in result
        assert result["Unknown"].base_count == 1

    def test_grade_breakdown(self) -> None:
        """compute_breakdown works with integer values (grades)."""
        from api.services.breakdown_calculator import compute_breakdown
        from api.services.extractors import extract_grade

        persons = {
            1: MockPerson(person_id=1, grade=3),
            2: MockPerson(person_id=2, grade=3),
            3: MockPerson(person_id=3, grade=5),
            4: MockPerson(person_id=4, grade=None),
        }
        person_ids = {1, 2, 3, 4}
        returned_ids = {1, 2, 3}

        result = compute_breakdown(person_ids, returned_ids, persons, extract_grade)

        assert result[3].base_count == 2
        assert result[3].returned_count == 2
        assert result[5].base_count == 1
        assert result[5].returned_count == 1
        assert result[None].base_count == 1
        assert result[None].returned_count == 0


class TestExtractors:
    """Tests for individual extractor functions."""

    def test_extract_gender_normal(self) -> None:
        """extract_gender returns gender value."""
        from api.services.extractors import extract_gender

        person = MockPerson(person_id=1, gender="M")
        assert extract_gender(person) == "M"

    def test_extract_gender_none(self) -> None:
        """extract_gender returns 'Unknown' for None."""
        from api.services.extractors import extract_gender

        person = MockPerson(person_id=1, gender=None)
        assert extract_gender(person) == "Unknown"

    def test_extract_gender_empty_string(self) -> None:
        """extract_gender returns 'Unknown' for empty string."""
        from api.services.extractors import extract_gender

        person = MockPerson(person_id=1, gender="")
        assert extract_gender(person) == "Unknown"

    def test_extract_grade_normal(self) -> None:
        """extract_grade returns grade value."""
        from api.services.extractors import extract_grade

        person = MockPerson(person_id=1, grade=5)
        assert extract_grade(person) == 5

    def test_extract_grade_none(self) -> None:
        """extract_grade returns None for missing grade."""
        from api.services.extractors import extract_grade

        person = MockPerson(person_id=1, grade=None)
        assert extract_grade(person) is None

    def test_extract_school_normal(self) -> None:
        """extract_school returns school value."""
        from api.services.extractors import extract_school

        history = MockCamperHistory(person_id=1, school="Riverside Elementary")
        assert extract_school(history) == "Riverside Elementary"

    def test_extract_school_none(self) -> None:
        """extract_school returns empty string for None."""
        from api.services.extractors import extract_school

        history = MockCamperHistory(person_id=1, school=None)
        assert extract_school(history) == ""

    def test_extract_city_normal(self) -> None:
        """extract_city returns city value."""
        from api.services.extractors import extract_city

        history = MockCamperHistory(person_id=1, city="Oakland")
        assert extract_city(history) == "Oakland"

    def test_extract_city_none(self) -> None:
        """extract_city returns empty string for None."""
        from api.services.extractors import extract_city

        history = MockCamperHistory(person_id=1, city=None)
        assert extract_city(history) == ""

    def test_extract_synagogue_normal(self) -> None:
        """extract_synagogue returns synagogue value."""
        from api.services.extractors import extract_synagogue

        history = MockCamperHistory(person_id=1, synagogue="Temple Beth Sholom")
        assert extract_synagogue(history) == "Temple Beth Sholom"

    def test_extract_synagogue_none(self) -> None:
        """extract_synagogue returns empty string for None."""
        from api.services.extractors import extract_synagogue

        history = MockCamperHistory(person_id=1, synagogue=None)
        assert extract_synagogue(history) == ""

    def test_extract_years_at_camp_normal(self) -> None:
        """extract_years_at_camp returns years value."""
        from api.services.extractors import extract_years_at_camp

        person = MockPerson(person_id=1, years_at_camp=3)
        assert extract_years_at_camp(person) == 3

    def test_extract_years_at_camp_none(self) -> None:
        """extract_years_at_camp returns 0 for None."""
        from api.services.extractors import extract_years_at_camp

        person = MockPerson(person_id=1, years_at_camp=None)
        assert extract_years_at_camp(person) == 0

    def test_extract_first_year_attended_normal(self) -> None:
        """extract_first_year_attended returns first year value."""
        from api.services.extractors import extract_first_year_attended

        history = MockCamperHistory(person_id=1, first_year_attended=2020)
        assert extract_first_year_attended(history) == 2020

    def test_extract_first_year_attended_none(self) -> None:
        """extract_first_year_attended returns None for missing."""
        from api.services.extractors import extract_first_year_attended

        history = MockCamperHistory(person_id=1, first_year_attended=None)
        assert extract_first_year_attended(history) is None


class TestBreakdownStats:
    """Tests for BreakdownStats dataclass."""

    def test_dataclass_fields(self) -> None:
        """BreakdownStats has expected fields."""
        from api.services.breakdown_calculator import BreakdownStats

        stats = BreakdownStats(base_count=10, returned_count=7, retention_rate=0.7)

        assert stats.base_count == 10
        assert stats.returned_count == 7
        assert stats.retention_rate == 0.7

    def test_dataclass_immutability(self) -> None:
        """BreakdownStats is immutable (frozen)."""
        from api.services.breakdown_calculator import BreakdownStats

        stats = BreakdownStats(base_count=10, returned_count=7, retention_rate=0.7)

        # Should raise FrozenInstanceError when trying to modify
        with pytest.raises(Exception):  # FrozenInstanceError or AttributeError
            stats.base_count = 20  # type: ignore[misc]


class TestComputeRegistrationBreakdown:
    """Tests for compute_registration_breakdown (count-only variant)."""

    def test_basic_registration_breakdown(self) -> None:
        """compute_registration_breakdown counts correctly."""
        from api.services.breakdown_calculator import (
            RegistrationBreakdownStats,
            compute_registration_breakdown,
        )
        from api.services.extractors import extract_gender

        persons = {
            1: MockPerson(person_id=1, gender="M"),
            2: MockPerson(person_id=2, gender="M"),
            3: MockPerson(person_id=3, gender="F"),
        }
        person_ids = {1, 2, 3}

        result = compute_registration_breakdown(person_ids, persons, extract_gender)

        assert result["M"].count == 2
        assert result["M"].percentage == pytest.approx(2 / 3 * 100)
        assert result["F"].count == 1
        assert result["F"].percentage == pytest.approx(1 / 3 * 100)

    def test_empty_registration_breakdown(self) -> None:
        """compute_registration_breakdown handles empty input."""
        from api.services.breakdown_calculator import compute_registration_breakdown
        from api.services.extractors import extract_gender

        persons: dict[int, Any] = {}
        person_ids: set[int] = set()

        result = compute_registration_breakdown(person_ids, persons, extract_gender)

        assert result == {}


class TestSafeRate:
    """Tests for the safe_rate helper function."""

    def test_safe_rate_normal(self) -> None:
        """safe_rate calculates correctly for normal values."""
        from api.services.breakdown_calculator import safe_rate

        assert safe_rate(7, 10) == 0.7
        assert safe_rate(0, 10) == 0.0
        assert safe_rate(10, 10) == 1.0

    def test_safe_rate_zero_denominator(self) -> None:
        """safe_rate returns 0.0 for zero denominator."""
        from api.services.breakdown_calculator import safe_rate

        assert safe_rate(5, 0) == 0.0
        assert safe_rate(0, 0) == 0.0


class TestCalculatePercentage:
    """Tests for the calculate_percentage helper function."""

    def test_calculate_percentage_normal(self) -> None:
        """calculate_percentage computes correctly."""
        from api.services.breakdown_calculator import calculate_percentage

        assert calculate_percentage(50, 100) == 50.0
        assert calculate_percentage(1, 4) == 25.0
        assert calculate_percentage(0, 100) == 0.0

    def test_calculate_percentage_zero_total(self) -> None:
        """calculate_percentage returns 0.0 for zero total."""
        from api.services.breakdown_calculator import calculate_percentage

        assert calculate_percentage(5, 0) == 0.0
        assert calculate_percentage(0, 0) == 0.0
