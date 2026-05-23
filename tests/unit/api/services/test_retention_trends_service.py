"""Tests for RetentionTrendsService - TDD tests written first.

These tests define the expected behavior of the RetentionTrendsService.
Implementation must conform to these tests, not the other way around.
"""

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


def make_mock_person(
    person_id: int,
    gender: str,
    grade: int | None = None,
    normalized_city: str | None = None,
    address_city: str | None = None,
    normalized_school: str | None = None,
    school: str | None = None,
    normalized_congregation: str | None = None,
) -> MagicMock:
    """Create a mock person."""
    person = MagicMock()
    person.person_id = person_id
    person.gender = gender
    person.grade = grade
    person.normalized_city = normalized_city
    person.address_city = address_city
    person.normalized_school = normalized_school
    person.school = school
    person.normalized_congregation = normalized_congregation
    return person


def make_mock_session(cm_id: int, session_type: str = "main", name: str = "Session 1") -> MagicMock:
    """Create a mock session."""
    session = MagicMock()
    session.cm_id = cm_id
    session.session_type = session_type
    session.name = name
    return session


def make_enrollment_record(person_id: int, year: int, session_type: str = "main") -> MagicMock:
    """Create a mock enrollment history record for summer metrics calculation."""
    record = MagicMock()
    record.person_id = person_id
    record.year = year

    session = MagicMock()
    session.session_type = session_type
    record.expand = {"session": session}
    return record


# ============================================================================
# TestRetentionTrendsServiceBasic - Core functionality tests
# ============================================================================


class TestRetentionTrendsServiceBasic:
    """Test basic RetentionTrendsService functionality."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        """Create a mock MetricsRepository."""
        repo = MagicMock(spec=MetricsRepository)
        # Default empty responses - all methods are async
        repo.fetch_attendees = AsyncMock(return_value=[])
        repo.fetch_persons = AsyncMock(return_value={})
        repo.fetch_sessions = AsyncMock(return_value={})
        return repo

    @pytest.mark.asyncio
    async def test_response_shape_with_3_years(self, mock_repository: MagicMock) -> None:
        """Test that response has correct shape for 3-year analysis."""
        from api.services.retention_trends_service import RetentionTrendsService

        # Set up 3 years of data - all methods are async
        mock_repository.fetch_attendees = AsyncMock(return_value=[])
        mock_repository.fetch_persons = AsyncMock(return_value={})
        mock_repository.fetch_sessions = AsyncMock(return_value={})

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(
            current_year=2026,
            num_years=3,
        )

        # With num_years=3 we get 3 transitions from 4 years of data
        assert len(result.years) == 3
        assert result.years[0].from_year == 2023
        assert result.years[0].to_year == 2024
        assert result.years[1].from_year == 2024
        assert result.years[1].to_year == 2025
        assert result.years[2].from_year == 2025
        assert result.years[2].to_year == 2026

        # Should have avg_retention_rate and trend_direction
        assert isinstance(result.avg_retention_rate, float)
        assert result.trend_direction in ("improving", "declining", "stable")

        # Should have enrollment_by_year for all 4 years
        assert len(result.enrollment_by_year) == 4

    @pytest.mark.asyncio
    async def test_response_shape_with_2_years(self, mock_repository: MagicMock) -> None:
        """Test that response has correct shape for 2-year analysis."""
        from api.services.retention_trends_service import RetentionTrendsService

        mock_repository.fetch_attendees = AsyncMock(return_value=[])
        mock_repository.fetch_persons = AsyncMock(return_value={})
        mock_repository.fetch_sessions = AsyncMock(return_value={})

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(
            current_year=2026,
            num_years=2,
        )

        # With num_years=2 we get 2 transitions from 3 years of data
        assert len(result.years) == 2
        assert result.years[0].from_year == 2024
        assert result.years[0].to_year == 2025
        assert result.years[1].from_year == 2025
        assert result.years[1].to_year == 2026
        assert len(result.enrollment_by_year) == 3

    @pytest.mark.asyncio
    async def test_retention_rate_calculation(self, mock_repository: MagicMock) -> None:
        """Test retention rate calculation for a transition."""
        from api.services.retention_trends_service import RetentionTrendsService

        # Year 2024: 10 campers (IDs 1-10)
        attendees_2024 = [make_mock_attendee(i, 100) for i in range(1, 11)]
        persons_2024 = {i: make_mock_person(i, "M") for i in range(1, 11)}

        # Year 2025: 6 campers returned (IDs 3-8) + 2 new (IDs 11-12)
        attendees_2025 = [make_mock_attendee(i, 100) for i in [3, 4, 5, 6, 7, 8, 11, 12]]
        persons_2025 = {i: make_mock_person(i, "M") for i in [3, 4, 5, 6, 7, 8, 11, 12]}

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(
            current_year=2025,
            num_years=1,
        )

        # 6 out of 10 returned = 60% retention
        assert len(result.years) == 1
        assert result.years[0].base_count == 10
        assert result.years[0].returned_count == 6
        assert abs(result.years[0].retention_rate - 0.6) < 0.001


# ============================================================================
# TestRetentionTrendsServiceBreakdowns - Gender and grade breakdowns
# ============================================================================


class TestRetentionTrendsServiceBreakdowns:
    """Test gender and grade breakdown calculations."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        """Create a mock MetricsRepository."""
        repo = MagicMock(spec=MetricsRepository)
        return repo

    @pytest.mark.asyncio
    async def test_gender_breakdown_per_transition(self, mock_repository: MagicMock) -> None:
        """Test gender breakdown is computed per year transition."""
        from api.services.retention_trends_service import RetentionTrendsService

        # 2024: 5 M (IDs 1-5), 5 F (IDs 6-10)
        attendees_2024 = [make_mock_attendee(i, 100) for i in range(1, 11)]
        persons_2024 = {
            **{i: make_mock_person(i, "M") for i in range(1, 6)},
            **{i: make_mock_person(i, "F") for i in range(6, 11)},
        }

        # 2025: 3 M returned (IDs 2, 3, 4), 4 F returned (IDs 7, 8, 9, 10)
        attendees_2025 = [make_mock_attendee(i, 100) for i in [2, 3, 4, 7, 8, 9, 10]]
        persons_2025 = {
            **{i: make_mock_person(i, "M") for i in [2, 3, 4]},
            **{i: make_mock_person(i, "F") for i in [7, 8, 9, 10]},
        }

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(
            current_year=2025,
            num_years=1,
        )

        transition = result.years[0]
        assert len(transition.by_gender) == 2

        gender_dict = {g.gender: g for g in transition.by_gender}
        # 3/5 M returned = 60%
        assert gender_dict["M"].base_count == 5
        assert gender_dict["M"].returned_count == 3
        assert abs(gender_dict["M"].retention_rate - 0.6) < 0.001
        # 4/5 F returned = 80%
        assert gender_dict["F"].base_count == 5
        assert gender_dict["F"].returned_count == 4
        assert abs(gender_dict["F"].retention_rate - 0.8) < 0.001

    @pytest.mark.asyncio
    async def test_grade_breakdown_per_transition(self, mock_repository: MagicMock) -> None:
        """Test grade breakdown is computed per year transition."""
        from api.services.retention_trends_service import RetentionTrendsService

        # 2024: 4 in grade 5, 6 in grade 6
        attendees_2024 = [make_mock_attendee(i, 100) for i in range(1, 11)]
        persons_2024 = {
            **{i: make_mock_person(i, "M", grade=5) for i in range(1, 5)},
            **{i: make_mock_person(i, "M", grade=6) for i in range(5, 11)},
        }

        # 2025: 2 grade-5 returned, 4 grade-6 returned
        attendees_2025 = [make_mock_attendee(i, 100) for i in [1, 2, 5, 6, 7, 8]]
        persons_2025 = {
            **{i: make_mock_person(i, "M", grade=5) for i in [1, 2]},
            **{i: make_mock_person(i, "M", grade=6) for i in [5, 6, 7, 8]},
        }

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(
            current_year=2025,
            num_years=1,
        )

        transition = result.years[0]
        assert len(transition.by_grade) == 2

        grade_dict = {g.grade: g for g in transition.by_grade}
        # 2/4 grade 5 returned = 50%
        assert grade_dict[5].base_count == 4
        assert grade_dict[5].returned_count == 2
        assert abs(grade_dict[5].retention_rate - 0.5) < 0.001
        # 4/6 grade 6 returned = 66.67%
        assert grade_dict[6].base_count == 6
        assert grade_dict[6].returned_count == 4


# ============================================================================
# TestRetentionTrendsServiceTrend - Trend direction calculation
# ============================================================================


class TestRetentionTrendsServiceTrend:
    """Test trend direction calculation."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        """Create a mock MetricsRepository."""
        repo = MagicMock(spec=MetricsRepository)
        return repo

    @pytest.mark.asyncio
    async def test_improving_trend(self, mock_repository: MagicMock) -> None:
        """Test that improving retention is detected."""
        from api.services.retention_trends_service import RetentionTrendsService

        # 2024: 10 campers, 2025: 5 returned (50%)
        attendees_2024 = [make_mock_attendee(i, 100) for i in range(1, 11)]
        persons_2024 = {i: make_mock_person(i, "M") for i in range(1, 11)}

        # 2025: 5 from 2024 + 5 new = 10 total
        attendees_2025 = [make_mock_attendee(i, 100) for i in [1, 2, 3, 4, 5, 11, 12, 13, 14, 15]]
        persons_2025 = {i: make_mock_person(i, "M") for i in [1, 2, 3, 4, 5, 11, 12, 13, 14, 15]}

        # 2026: 8 from 2025 returned (80%)
        attendees_2026 = [make_mock_attendee(i, 100) for i in [1, 2, 3, 11, 12, 13, 14, 15]]
        persons_2026 = {i: make_mock_person(i, "M") for i in [1, 2, 3, 11, 12, 13, 14, 15]}

        def mock_fetch_attendees(year: int) -> list[Any]:
            return {2024: attendees_2024, 2025: attendees_2025, 2026: attendees_2026}[year]

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return {2024: persons_2024, 2025: persons_2025, 2026: persons_2026}[year]

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(
            current_year=2026,
            num_years=2,
        )

        # 2024→2025: 50%, 2025→2026: 80%, trend is improving
        assert result.trend_direction == "improving"

    @pytest.mark.asyncio
    async def test_declining_trend(self, mock_repository: MagicMock) -> None:
        """Test that declining retention is detected."""
        from api.services.retention_trends_service import RetentionTrendsService

        # 2024: 10 campers, 2025: 8 returned (80%)
        attendees_2024 = [make_mock_attendee(i, 100) for i in range(1, 11)]
        persons_2024 = {i: make_mock_person(i, "M") for i in range(1, 11)}

        attendees_2025 = [make_mock_attendee(i, 100) for i in range(1, 9)]
        persons_2025 = {i: make_mock_person(i, "M") for i in range(1, 9)}

        # 2026: only 4 from 2025 returned (50%)
        attendees_2026 = [make_mock_attendee(i, 100) for i in [1, 2, 3, 4]]
        persons_2026 = {i: make_mock_person(i, "M") for i in [1, 2, 3, 4]}

        def mock_fetch_attendees(year: int) -> list[Any]:
            return {2024: attendees_2024, 2025: attendees_2025, 2026: attendees_2026}[year]

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return {2024: persons_2024, 2025: persons_2025, 2026: persons_2026}[year]

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(
            current_year=2026,
            num_years=2,
        )

        # 2024→2025: 80%, 2025→2026: 50%, trend is declining
        assert result.trend_direction == "declining"

    @pytest.mark.asyncio
    async def test_stable_trend(self, mock_repository: MagicMock) -> None:
        """Test that stable retention is detected."""
        from api.services.retention_trends_service import RetentionTrendsService

        # All years have roughly 70% retention (within 2% threshold)
        attendees_2024 = [make_mock_attendee(i, 100) for i in range(1, 11)]
        persons_2024 = {i: make_mock_person(i, "M") for i in range(1, 11)}

        # 7/10 return
        attendees_2025 = [make_mock_attendee(i, 100) for i in [1, 2, 3, 4, 5, 6, 7]]
        persons_2025 = {i: make_mock_person(i, "M") for i in [1, 2, 3, 4, 5, 6, 7]}

        # 5/7 return = ~71%
        attendees_2026 = [make_mock_attendee(i, 100) for i in [1, 2, 3, 4, 5]]
        persons_2026 = {i: make_mock_person(i, "M") for i in [1, 2, 3, 4, 5]}

        def mock_fetch_attendees(year: int) -> list[Any]:
            return {2024: attendees_2024, 2025: attendees_2025, 2026: attendees_2026}[year]

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return {2024: persons_2024, 2025: persons_2025, 2026: persons_2026}[year]

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(
            current_year=2026,
            num_years=2,
        )

        # Both transitions are ~70%, trend is stable
        assert result.trend_direction == "stable"


# ============================================================================
# TestRetentionTrendsServiceFiltering - Session type and ID filtering
# ============================================================================


class TestRetentionTrendsServiceFiltering:
    """Test session filtering functionality."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        """Create a mock MetricsRepository."""
        repo = MagicMock(spec=MetricsRepository)
        return repo

    @pytest.mark.asyncio
    async def test_filter_by_session_types(self, mock_repository: MagicMock) -> None:
        """Test filtering by session types."""
        from api.services.retention_trends_service import RetentionTrendsService

        # Include both main and ag session types
        attendees_2024 = [
            make_mock_attendee(1, 100, "main"),
            make_mock_attendee(2, 100, "main"),
            make_mock_attendee(3, 200, "ag"),
            make_mock_attendee(4, 300, "family"),  # Should be excluded
        ]
        persons_2024 = {i: make_mock_person(i, "M") for i in range(1, 5)}

        attendees_2025 = [
            make_mock_attendee(1, 100, "main"),
            make_mock_attendee(3, 200, "ag"),
        ]
        persons_2025 = {i: make_mock_person(i, "M") for i in [1, 3]}

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(
            return_value={
                100: make_mock_session(100, "main"),
                200: make_mock_session(200, "ag"),
                300: make_mock_session(300, "family"),
            }
        )

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(
            current_year=2025,
            num_years=1,
            session_types=["main", "ag"],
        )

        # Only 3 campers counted (excluding family camp)
        assert result.years[0].base_count == 3
        # 2 returned
        assert result.years[0].returned_count == 2

    @pytest.mark.asyncio
    async def test_filter_by_session_cm_id(self, mock_repository: MagicMock) -> None:
        """Test filtering by specific session cm_id."""
        from api.services.retention_trends_service import RetentionTrendsService

        # Multiple sessions
        attendees_2024 = [
            make_mock_attendee(1, 100, "main"),
            make_mock_attendee(2, 100, "main"),
            make_mock_attendee(3, 200, "main"),  # Different session
        ]
        persons_2024 = {i: make_mock_person(i, "M") for i in range(1, 4)}

        attendees_2025 = [
            make_mock_attendee(1, 100, "main"),
        ]
        persons_2025 = {1: make_mock_person(1, "M")}

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(
            return_value={
                100: make_mock_session(100),
                200: make_mock_session(200),
            }
        )

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(
            current_year=2025,
            num_years=1,
            session_cm_id=100,
        )

        # Only session 100 campers: 2 in 2024
        assert result.years[0].base_count == 2
        # 1 returned
        assert result.years[0].returned_count == 1


# ============================================================================
# TestRetentionTrendsServiceEnrollment - Enrollment by year
# ============================================================================


class TestRetentionTrendsServiceEnrollment:
    """Test enrollment_by_year computation."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        """Create a mock MetricsRepository."""
        repo = MagicMock(spec=MetricsRepository)
        return repo

    @pytest.mark.asyncio
    async def test_enrollment_by_year_totals(self, mock_repository: MagicMock) -> None:
        """Test enrollment totals per year."""
        from api.services.retention_trends_service import RetentionTrendsService

        # 2024: 10 campers, 2025: 8 campers, 2026: 12 campers
        attendees_2024 = [make_mock_attendee(i, 100) for i in range(1, 11)]
        persons_2024 = {i: make_mock_person(i, "M") for i in range(1, 11)}

        attendees_2025 = [make_mock_attendee(i, 100) for i in range(1, 9)]
        persons_2025 = {i: make_mock_person(i, "M") for i in range(1, 9)}

        attendees_2026 = [make_mock_attendee(i, 100) for i in range(1, 13)]
        persons_2026 = {i: make_mock_person(i, "M") for i in range(1, 13)}

        def mock_fetch_attendees(year: int) -> list[Any]:
            return {2024: attendees_2024, 2025: attendees_2025, 2026: attendees_2026}[year]

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return {2024: persons_2024, 2025: persons_2025, 2026: persons_2026}[year]

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(
            current_year=2026,
            num_years=2,
        )

        assert len(result.enrollment_by_year) == 3
        enrollment_dict = {e.year: e for e in result.enrollment_by_year}
        assert enrollment_dict[2024].total == 10
        assert enrollment_dict[2025].total == 8
        assert enrollment_dict[2026].total == 12

    @pytest.mark.asyncio
    async def test_enrollment_by_year_gender_breakdown(self, mock_repository: MagicMock) -> None:
        """Test enrollment gender breakdown per year."""
        from api.services.retention_trends_service import RetentionTrendsService

        # 2024: 6 M, 4 F
        attendees_2024 = [make_mock_attendee(i, 100) for i in range(1, 11)]
        persons_2024 = {
            **{i: make_mock_person(i, "M") for i in range(1, 7)},
            **{i: make_mock_person(i, "F") for i in range(7, 11)},
        }

        # 2025: same structure for simplicity
        attendees_2025 = [make_mock_attendee(i, 100) for i in range(1, 11)]
        persons_2025 = persons_2024.copy()

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(
            current_year=2025,
            num_years=1,
        )

        year_2024 = next(e for e in result.enrollment_by_year if e.year == 2024)
        gender_dict = {g.gender: g.count for g in year_2024.by_gender}
        assert gender_dict["M"] == 6
        assert gender_dict["F"] == 4

    @pytest.mark.asyncio
    async def test_enrollment_by_year_grade_breakdown(self, mock_repository: MagicMock) -> None:
        """Test enrollment grade breakdown per year."""
        from api.services.retention_trends_service import RetentionTrendsService

        # 2024: 4 in grade 5, 6 in grade 6
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
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(
            current_year=2025,
            num_years=1,
        )

        year_2024 = next(e for e in result.enrollment_by_year if e.year == 2024)
        grade_dict = {g.grade: g.count for g in year_2024.by_grade}
        assert grade_dict[5] == 4
        assert grade_dict[6] == 6


# ============================================================================
# TestRetentionTrendsServiceEdgeCases - Edge cases and error handling
# ============================================================================


class TestRetentionTrendsServiceEdgeCases:
    """Test edge cases and error handling."""

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        """Create a mock MetricsRepository."""
        repo = MagicMock(spec=MetricsRepository)
        return repo

    @pytest.mark.asyncio
    async def test_empty_base_year(self, mock_repository: MagicMock) -> None:
        """Test handling of empty base year."""
        from api.services.retention_trends_service import RetentionTrendsService

        attendees_2024: list[Any] = []  # Empty year
        persons_2024: dict[int, Any] = {}

        attendees_2025 = [make_mock_attendee(1, 100)]
        persons_2025 = {1: make_mock_person(1, "M")}

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(
            current_year=2025,
            num_years=1,
        )

        # With 0 base campers, retention rate should be 0
        assert result.years[0].base_count == 0
        assert result.years[0].returned_count == 0
        assert result.years[0].retention_rate == 0.0

    @pytest.mark.asyncio
    async def test_avg_retention_rate_calculation(self, mock_repository: MagicMock) -> None:
        """Test average retention rate across transitions."""
        from api.services.retention_trends_service import RetentionTrendsService

        # 2024→2025: 50%, 2025→2026: 80% => avg = 65%
        attendees_2024 = [make_mock_attendee(i, 100) for i in range(1, 11)]
        persons_2024 = {i: make_mock_person(i, "M") for i in range(1, 11)}

        # 5/10 return
        attendees_2025 = [make_mock_attendee(i, 100) for i in range(1, 6)]
        persons_2025 = {i: make_mock_person(i, "M") for i in range(1, 6)}

        # 4/5 return
        attendees_2026 = [make_mock_attendee(i, 100) for i in range(1, 5)]
        persons_2026 = {i: make_mock_person(i, "M") for i in range(1, 5)}

        def mock_fetch_attendees(year: int) -> list[Any]:
            return {2024: attendees_2024, 2025: attendees_2025, 2026: attendees_2026}[year]

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return {2024: persons_2024, 2025: persons_2025, 2026: persons_2026}[year]

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(
            current_year=2026,
            num_years=2,
        )

        # (0.5 + 0.8) / 2 = 0.65
        assert abs(result.avg_retention_rate - 0.65) < 0.001

    @pytest.mark.asyncio
    async def test_single_year_trend_is_stable(self, mock_repository: MagicMock) -> None:
        """Test that a single transition defaults to stable trend."""
        from api.services.retention_trends_service import RetentionTrendsService

        attendees_2024 = [make_mock_attendee(i, 100) for i in range(1, 11)]
        persons_2024 = {i: make_mock_person(i, "M") for i in range(1, 11)}

        attendees_2025 = [make_mock_attendee(i, 100) for i in range(1, 8)]
        persons_2025 = {i: make_mock_person(i, "M") for i in range(1, 8)}

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2024 if year == 2024 else attendees_2025

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2024 if year == 2024 else persons_2025

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(
            current_year=2025,
            num_years=1,
        )

        # With only 1 transition, we can't determine trend - should be stable
        assert result.trend_direction == "stable"


# ============================================================================
# TestRetentionTrendsServiceEnrollmentBreakdowns - New geographic & summer breakdowns
# ============================================================================


class TestRetentionTrendsServiceEnrollmentBreakdowns:
    """Test new enrollment breakdown fields in enrollment_by_year.

    These tests verify that _compute_enrollment_by_year populates:
    - by_city: city enrollment from persons
    - by_school: school enrollment from persons
    - by_synagogue: synagogue enrollment from persons
    - by_summer_years: summers at camp from enrollment history
    - by_first_summer_year: first summer year from enrollment history
    """

    @pytest.fixture
    def mock_repository(self) -> MagicMock:
        """Create a mock MetricsRepository."""
        repo = MagicMock(spec=MetricsRepository)
        return repo

    @pytest.mark.asyncio
    async def test_enrollment_by_year_has_city_breakdown(self, mock_repository: MagicMock) -> None:
        """Test that enrollment_by_year includes city breakdown."""
        from api.services.retention_trends_service import RetentionTrendsService

        attendees_2025 = [make_mock_attendee(i, 100) for i in range(1, 6)]
        persons_2025 = {
            1: make_mock_person(1, "M", grade=5, normalized_city="San Francisco"),
            2: make_mock_person(2, "F", grade=6, normalized_city="San Francisco"),
            3: make_mock_person(3, "M", grade=5, normalized_city="Oakland"),
            4: make_mock_person(4, "F", grade=6, address_city="Berkeley"),  # fallback
            5: make_mock_person(5, "M", grade=7),  # no city
        }

        attendees_2026 = [make_mock_attendee(i, 100) for i in range(1, 4)]
        persons_2026 = {
            1: make_mock_person(1, "M", normalized_city="San Francisco"),
            2: make_mock_person(2, "F", normalized_city="San Francisco"),
            3: make_mock_person(3, "M", normalized_city="Oakland"),
        }

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2025 if year == 2025 else attendees_2026

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2025 if year == 2025 else persons_2026

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})
        mock_repository.fetch_summer_enrollment_history = AsyncMock(return_value=[])

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(current_year=2026, num_years=1)

        year_2025 = next(e for e in result.enrollment_by_year if e.year == 2025)
        assert len(year_2025.by_city) > 0

        city_dict = {c.city: c.count for c in year_2025.by_city}
        assert city_dict["San Francisco"] == 2
        assert city_dict["Oakland"] == 1
        assert city_dict["Berkeley"] == 1  # fallback from address_city

    @pytest.mark.asyncio
    async def test_enrollment_by_year_has_school_breakdown(self, mock_repository: MagicMock) -> None:
        """Test that enrollment_by_year includes school breakdown."""
        from api.services.retention_trends_service import RetentionTrendsService

        attendees_2025 = [make_mock_attendee(i, 100) for i in range(1, 5)]
        persons_2025 = {
            1: make_mock_person(1, "M", normalized_school="Riverside Elementary"),
            2: make_mock_person(2, "F", normalized_school="Riverside Elementary"),
            3: make_mock_person(3, "M", school="Oak Valley Middle"),  # fallback
            4: make_mock_person(4, "F"),  # no school
        }

        attendees_2026 = [make_mock_attendee(i, 100) for i in range(1, 3)]
        persons_2026 = {
            1: make_mock_person(1, "M", normalized_school="Riverside Elementary"),
            2: make_mock_person(2, "F", normalized_school="Riverside Elementary"),
        }

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2025 if year == 2025 else attendees_2026

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2025 if year == 2025 else persons_2026

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})
        mock_repository.fetch_summer_enrollment_history = AsyncMock(return_value=[])

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(current_year=2026, num_years=1)

        year_2025 = next(e for e in result.enrollment_by_year if e.year == 2025)
        assert len(year_2025.by_school) > 0

        school_dict = {s.school: s.count for s in year_2025.by_school}
        assert school_dict["Riverside Elementary"] == 2
        assert school_dict["Oak Valley Middle"] == 1

    @pytest.mark.asyncio
    async def test_enrollment_by_year_has_synagogue_breakdown(self, mock_repository: MagicMock) -> None:
        """Test that enrollment_by_year includes synagogue breakdown."""
        from api.services.retention_trends_service import RetentionTrendsService

        attendees_2025 = [make_mock_attendee(i, 100) for i in range(1, 5)]
        persons_2025 = {
            1: make_mock_person(1, "M", normalized_congregation="Temple Beth El"),
            2: make_mock_person(2, "F", normalized_congregation="Temple Beth El"),
            3: make_mock_person(3, "M", normalized_congregation="Congregation Emanu-El"),
            4: make_mock_person(4, "F"),  # no congregation
        }

        attendees_2026 = [make_mock_attendee(i, 100) for i in range(1, 3)]
        persons_2026 = {
            1: make_mock_person(1, "M", normalized_congregation="Temple Beth El"),
            2: make_mock_person(2, "F", normalized_congregation="Temple Beth El"),
        }

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2025 if year == 2025 else attendees_2026

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2025 if year == 2025 else persons_2026

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})
        mock_repository.fetch_summer_enrollment_history = AsyncMock(return_value=[])

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(current_year=2026, num_years=1)

        year_2025 = next(e for e in result.enrollment_by_year if e.year == 2025)
        assert len(year_2025.by_synagogue) > 0

        syn_dict = {s.synagogue: s.count for s in year_2025.by_synagogue}
        assert syn_dict["Temple Beth El"] == 2
        assert syn_dict["Congregation Emanu-El"] == 1

    @pytest.mark.asyncio
    async def test_enrollment_by_year_has_summer_years_breakdown(self, mock_repository: MagicMock) -> None:
        """Test that enrollment_by_year includes summers at camp breakdown."""
        from api.services.retention_trends_service import RetentionTrendsService

        # 2025 campers: person 1 (3 years), person 2 (1 year), person 3 (2 years)
        attendees_2025 = [make_mock_attendee(i, 100) for i in range(1, 4)]
        persons_2025 = {i: make_mock_person(i, "M") for i in range(1, 4)}

        attendees_2026 = [make_mock_attendee(i, 100) for i in range(1, 4)]
        persons_2026 = {i: make_mock_person(i, "M") for i in range(1, 4)}

        enrollment_history = [
            # Person 1: enrolled in 2023, 2024, 2025 (3 summers)
            make_enrollment_record(1, 2023),
            make_enrollment_record(1, 2024),
            make_enrollment_record(1, 2025),
            # Person 2: enrolled in 2025 only (1 summer)
            make_enrollment_record(2, 2025),
            # Person 3: enrolled in 2024, 2025 (2 summers)
            make_enrollment_record(3, 2024),
            make_enrollment_record(3, 2025),
            # Person 1 also in 2026
            make_enrollment_record(1, 2026),
            # Person 2 also in 2026
            make_enrollment_record(2, 2026),
            # Person 3 also in 2026
            make_enrollment_record(3, 2026),
        ]

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2025 if year == 2025 else attendees_2026

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2025 if year == 2025 else persons_2026

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})
        mock_repository.fetch_summer_enrollment_history = AsyncMock(return_value=enrollment_history)

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(current_year=2026, num_years=1)

        # For year 2025, summer_years should reflect history up to 2025
        year_2025 = next(e for e in result.enrollment_by_year if e.year == 2025)
        assert len(year_2025.by_summer_years) > 0

        sy_dict = {s.summer_years: s.count for s in year_2025.by_summer_years}
        # Person 1: 3 summers (2023,2024,2025), Person 2: 1 (2025), Person 3: 2 (2024,2025)
        assert sy_dict.get(3) == 1  # person 1
        assert sy_dict.get(1) == 1  # person 2
        assert sy_dict.get(2) == 1  # person 3

    @pytest.mark.asyncio
    async def test_enrollment_by_year_has_first_summer_year_breakdown(self, mock_repository: MagicMock) -> None:
        """Test that enrollment_by_year includes first summer year breakdown."""
        from api.services.retention_trends_service import RetentionTrendsService

        attendees_2025 = [make_mock_attendee(i, 100) for i in range(1, 4)]
        persons_2025 = {i: make_mock_person(i, "M") for i in range(1, 4)}

        attendees_2026 = [make_mock_attendee(i, 100) for i in range(1, 4)]
        persons_2026 = {i: make_mock_person(i, "M") for i in range(1, 4)}

        enrollment_history = [
            # Person 1: first summer 2023
            make_enrollment_record(1, 2023),
            make_enrollment_record(1, 2024),
            make_enrollment_record(1, 2025),
            # Person 2: first summer 2025
            make_enrollment_record(2, 2025),
            # Person 3: first summer 2024
            make_enrollment_record(3, 2024),
            make_enrollment_record(3, 2025),
            # Also in 2026
            make_enrollment_record(1, 2026),
            make_enrollment_record(2, 2026),
            make_enrollment_record(3, 2026),
        ]

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2025 if year == 2025 else attendees_2026

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2025 if year == 2025 else persons_2026

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})
        mock_repository.fetch_summer_enrollment_history = AsyncMock(return_value=enrollment_history)

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(current_year=2026, num_years=1)

        year_2025 = next(e for e in result.enrollment_by_year if e.year == 2025)
        assert len(year_2025.by_first_summer_year) > 0

        fsy_dict = {f.first_summer_year: f.count for f in year_2025.by_first_summer_year}
        assert fsy_dict.get(2023) == 1  # person 1
        assert fsy_dict.get(2024) == 1  # person 3
        assert fsy_dict.get(2025) == 1  # person 2

    @pytest.mark.asyncio
    async def test_city_sorted_by_count_desc(self, mock_repository: MagicMock) -> None:
        """Test that city breakdown is sorted by count descending."""
        from api.services.retention_trends_service import RetentionTrendsService

        attendees = [make_mock_attendee(i, 100) for i in range(1, 7)]
        persons = {
            1: make_mock_person(1, "M", normalized_city="Oakland"),
            2: make_mock_person(2, "F", normalized_city="San Francisco"),
            3: make_mock_person(3, "M", normalized_city="San Francisco"),
            4: make_mock_person(4, "F", normalized_city="San Francisco"),
            5: make_mock_person(5, "M", normalized_city="Oakland"),
            6: make_mock_person(6, "F", normalized_city="Berkeley"),
        }

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})
        mock_repository.fetch_summer_enrollment_history = AsyncMock(return_value=[])

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(current_year=2026, num_years=1)

        year = result.enrollment_by_year[0]
        assert year.by_city[0].city == "San Francisco"
        assert year.by_city[0].count == 3
        assert year.by_city[1].city == "Oakland"
        assert year.by_city[1].count == 2

    @pytest.mark.asyncio
    async def test_empty_enrollment_history_gives_empty_summer_breakdowns(self, mock_repository: MagicMock) -> None:
        """Test that empty enrollment history produces empty summer breakdowns."""
        from api.services.retention_trends_service import RetentionTrendsService

        attendees = [make_mock_attendee(1, 100)]
        persons = {1: make_mock_person(1, "M")}

        mock_repository.fetch_attendees = AsyncMock(return_value=attendees)
        mock_repository.fetch_persons = AsyncMock(return_value=persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})
        mock_repository.fetch_summer_enrollment_history = AsyncMock(return_value=[])

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(current_year=2026, num_years=1)

        for enrollment in result.enrollment_by_year:
            assert enrollment.by_summer_years == []
            assert enrollment.by_first_summer_year == []

    @pytest.mark.asyncio
    async def test_summer_years_scoped_to_year(self, mock_repository: MagicMock) -> None:
        """Test that summer_years is scoped per year (not counting future years)."""
        from api.services.retention_trends_service import RetentionTrendsService

        # Person 1 enrolled in 2024, 2025, 2026
        attendees_2025 = [make_mock_attendee(1, 100)]
        persons_2025 = {1: make_mock_person(1, "M")}
        attendees_2026 = [make_mock_attendee(1, 100)]
        persons_2026 = {1: make_mock_person(1, "M")}

        enrollment_history = [
            make_enrollment_record(1, 2024),
            make_enrollment_record(1, 2025),
            make_enrollment_record(1, 2026),
        ]

        def mock_fetch_attendees(year: int) -> list[Any]:
            return attendees_2025 if year == 2025 else attendees_2026

        def mock_fetch_persons(year: int) -> dict[int, Any]:
            return persons_2025 if year == 2025 else persons_2026

        mock_repository.fetch_attendees = AsyncMock(side_effect=mock_fetch_attendees)
        mock_repository.fetch_persons = AsyncMock(side_effect=mock_fetch_persons)
        mock_repository.fetch_sessions = AsyncMock(return_value={100: make_mock_session(100)})
        mock_repository.fetch_summer_enrollment_history = AsyncMock(return_value=enrollment_history)

        service = RetentionTrendsService(mock_repository)
        result = await service.calculate_retention_trends(current_year=2026, num_years=1)

        # For year 2025: person 1 has 2 summers (2024, 2025) — not 3
        year_2025 = next(e for e in result.enrollment_by_year if e.year == 2025)
        sy_dict = {s.summer_years: s.count for s in year_2025.by_summer_years}
        assert sy_dict.get(2) == 1  # 2 summers up to 2025

        # For year 2026: person 1 has 3 summers (2024, 2025, 2026)
        year_2026 = next(e for e in result.enrollment_by_year if e.year == 2026)
        sy_dict_2026 = {s.summer_years: s.count for s in year_2026.by_summer_years}
        assert sy_dict_2026.get(3) == 1  # 3 summers up to 2026
