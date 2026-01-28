"""Tests for ComparisonService - TDD tests written first.

These tests define the expected behavior of the ComparisonService.
Implementation must conform to these tests, not the other way around.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.services.metrics_repository import MetricsRepository


def make_mock_attendee(person_id: int, session_cm_id: int, session_type: str = "main") -> MagicMock:
    """Create a mock attendee with session expansion."""
    attendee = MagicMock()
    attendee.person_id = person_id

    session = MagicMock()
    session.cm_id = session_cm_id
    session.session_type = session_type

    attendee.expand = {"session": session}
    return attendee


def make_mock_person(person_id: int, gender: str, grade: int | None = None) -> MagicMock:
    """Create a mock person."""
    person = MagicMock()
    person.person_id = person_id
    person.gender = gender
    person.grade = grade
    return person


# ============================================================================
# TestComparisonServiceBasic - Core functionality tests
# ============================================================================


class TestComparisonServiceBasic:
    """Test basic ComparisonService functionality."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        """Create a mock MetricsRepository."""
        repo = MagicMock(spec=MetricsRepository)
        repo.fetch_attendees = AsyncMock(return_value=[])
        repo.fetch_persons = AsyncMock(return_value={})
        return repo

    @pytest.mark.asyncio
    async def test_response_shape(self, mock_repository: MagicMock) -> None:
        """Test that response has correct shape."""
        from api.services.comparison_service import ComparisonService

        mock_repository.fetch_attendees = AsyncMock(return_value=[])
        mock_repository.fetch_persons = AsyncMock(return_value={})

        service = ComparisonService(mock_repository)
        result = await service.calculate_comparison(year_a=2024, year_b=2025)

        # Check response structure
        assert hasattr(result, "year_a")
        assert hasattr(result, "year_b")
        assert hasattr(result, "delta")

        # Year summaries should have expected fields
        assert result.year_a.year == 2024
        assert result.year_b.year == 2025
        assert hasattr(result.year_a, "total")
        assert hasattr(result.year_a, "by_gender")
        assert hasattr(result.year_a, "by_grade")

    @pytest.mark.asyncio
    async def test_total_enrollment_counts(self, mock_repository: MagicMock) -> None:
        """Test that total enrollment is computed correctly for each year."""
        from api.services.comparison_service import ComparisonService

        # Year 2024: 5 campers
        attendees_2024 = [make_mock_attendee(i, 100) for i in range(1, 6)]
        persons_2024 = {i: make_mock_person(i, "M") for i in range(1, 6)}

        # Year 2025: 8 campers
        attendees_2025 = [make_mock_attendee(i, 100) for i in range(1, 9)]
        persons_2025 = {i: make_mock_person(i, "M") for i in range(1, 9)}

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)

        service = ComparisonService(mock_repository)
        result = await service.calculate_comparison(year_a=2024, year_b=2025)

        assert result.year_a.total == 5
        assert result.year_b.total == 8

    @pytest.mark.asyncio
    async def test_delta_calculation(self, mock_repository: MagicMock) -> None:
        """Test delta calculation between years."""
        from api.services.comparison_service import ComparisonService

        # Year 2024: 10 campers
        attendees_2024 = [make_mock_attendee(i, 100) for i in range(1, 11)]
        persons_2024 = {i: make_mock_person(i, "M") for i in range(1, 11)}

        # Year 2025: 15 campers (50% increase)
        attendees_2025 = [make_mock_attendee(i, 100) for i in range(1, 16)]
        persons_2025 = {i: make_mock_person(i, "M") for i in range(1, 16)}

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)

        service = ComparisonService(mock_repository)
        result = await service.calculate_comparison(year_a=2024, year_b=2025)

        assert result.delta.total_change == 5
        assert abs(result.delta.percentage_change - 50.0) < 0.001


# ============================================================================
# TestComparisonServiceBreakdowns - Gender and grade breakdown tests
# ============================================================================


class TestComparisonServiceBreakdowns:
    """Test breakdown calculations."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        """Create a mock MetricsRepository."""
        repo = MagicMock(spec=MetricsRepository)
        return repo

    @pytest.mark.asyncio
    async def test_gender_breakdown(self, mock_repository: MagicMock) -> None:
        """Test gender breakdown for each year."""
        from api.services.comparison_service import ComparisonService

        # Year 2024: 6 M, 4 F = 60/40 split
        attendees_2024 = [make_mock_attendee(i, 100) for i in range(1, 11)]
        persons_2024 = {
            **{i: make_mock_person(i, "M") for i in range(1, 7)},
            **{i: make_mock_person(i, "F") for i in range(7, 11)},
        }

        # Year 2025: 5 M, 5 F = 50/50 split
        attendees_2025 = [make_mock_attendee(i, 100) for i in range(1, 11)]
        persons_2025 = {
            **{i: make_mock_person(i, "M") for i in range(1, 6)},
            **{i: make_mock_person(i, "F") for i in range(6, 11)},
        }

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)

        service = ComparisonService(mock_repository)
        result = await service.calculate_comparison(year_a=2024, year_b=2025)

        # Year 2024 breakdown
        gender_a = {g.gender: g for g in result.year_a.by_gender}
        assert gender_a["M"].count == 6
        assert abs(gender_a["M"].percentage - 60.0) < 0.001
        assert gender_a["F"].count == 4
        assert abs(gender_a["F"].percentage - 40.0) < 0.001

        # Year 2025 breakdown
        gender_b = {g.gender: g for g in result.year_b.by_gender}
        assert gender_b["M"].count == 5
        assert abs(gender_b["M"].percentage - 50.0) < 0.001
        assert gender_b["F"].count == 5
        assert abs(gender_b["F"].percentage - 50.0) < 0.001

    @pytest.mark.asyncio
    async def test_grade_breakdown(self, mock_repository: MagicMock) -> None:
        """Test grade breakdown for each year."""
        from api.services.comparison_service import ComparisonService

        # Year 2024: 4 in grade 5, 6 in grade 6
        attendees_2024 = [make_mock_attendee(i, 100) for i in range(1, 11)]
        persons_2024 = {
            **{i: make_mock_person(i, "M", grade=5) for i in range(1, 5)},
            **{i: make_mock_person(i, "M", grade=6) for i in range(5, 11)},
        }

        attendees_2025 = [make_mock_attendee(i, 100) for i in range(1, 11)]
        persons_2025 = persons_2024.copy()

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)

        service = ComparisonService(mock_repository)
        result = await service.calculate_comparison(year_a=2024, year_b=2025)

        grade_a = {g.grade: g for g in result.year_a.by_grade}
        assert grade_a[5].count == 4
        assert abs(grade_a[5].percentage - 40.0) < 0.001
        assert grade_a[6].count == 6
        assert abs(grade_a[6].percentage - 60.0) < 0.001


# ============================================================================
# TestComparisonServiceFiltering - Session type filtering tests
# ============================================================================


class TestComparisonServiceFiltering:
    """Test session type filtering."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        """Create a mock MetricsRepository."""
        repo = MagicMock(spec=MetricsRepository)
        return repo

    @pytest.mark.asyncio
    async def test_filter_by_session_types(self, mock_repository: MagicMock) -> None:
        """Test filtering by session types."""
        from api.services.comparison_service import ComparisonService

        # Year 2024: main and ag attendees, plus a family camp one
        attendees_2024 = [
            make_mock_attendee(1, 100, "main"),
            make_mock_attendee(2, 100, "main"),
            make_mock_attendee(3, 200, "ag"),
            make_mock_attendee(4, 300, "family"),  # Should be excluded
        ]
        persons_2024 = {i: make_mock_person(i, "M") for i in range(1, 5)}

        attendees_2025 = attendees_2024.copy()
        persons_2025 = persons_2024.copy()

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)

        service = ComparisonService(mock_repository)
        result = await service.calculate_comparison(
            year_a=2024,
            year_b=2025,
            session_types=["main", "ag"],
        )

        # Should only count 3 (main + ag), not 4 (excludes family)
        assert result.year_a.total == 3
        assert result.year_b.total == 3


# ============================================================================
# TestComparisonServiceEdgeCases - Edge cases
# ============================================================================


class TestComparisonServiceEdgeCases:
    """Test edge cases."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        """Create a mock MetricsRepository."""
        repo = MagicMock(spec=MetricsRepository)
        return repo

    @pytest.mark.asyncio
    async def test_empty_year(self, mock_repository: MagicMock) -> None:
        """Test handling of empty year."""
        from api.services.comparison_service import ComparisonService

        # Year 2024: empty
        attendees_2024: list[Any] = []
        persons_2024: dict[int, Any] = {}

        # Year 2025: 5 campers
        attendees_2025 = [make_mock_attendee(i, 100) for i in range(1, 6)]
        persons_2025 = {i: make_mock_person(i, "M") for i in range(1, 6)}

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)

        service = ComparisonService(mock_repository)
        result = await service.calculate_comparison(year_a=2024, year_b=2025)

        assert result.year_a.total == 0
        assert result.year_b.total == 5
        # Percentage change should be 0 when base is 0
        assert result.delta.percentage_change == 0.0

    @pytest.mark.asyncio
    async def test_negative_change(self, mock_repository: MagicMock) -> None:
        """Test handling of negative enrollment change."""
        from api.services.comparison_service import ComparisonService

        # Year 2024: 10 campers
        attendees_2024 = [make_mock_attendee(i, 100) for i in range(1, 11)]
        persons_2024 = {i: make_mock_person(i, "M") for i in range(1, 11)}

        # Year 2025: 8 campers (20% decrease)
        attendees_2025 = [make_mock_attendee(i, 100) for i in range(1, 9)]
        persons_2025 = {i: make_mock_person(i, "M") for i in range(1, 9)}

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)

        service = ComparisonService(mock_repository)
        result = await service.calculate_comparison(year_a=2024, year_b=2025)

        assert result.delta.total_change == -2
        assert abs(result.delta.percentage_change - (-20.0)) < 0.001
