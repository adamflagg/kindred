"""Tests for RetentionService - written first (TDD).

These tests define the expected behavior for the retention service that
moves business logic out of the endpoint and into a testable service.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest


@dataclass
class MockPerson:
    """Mock person object for testing."""

    cm_id: int
    gender: str | None = None
    grade: int | None = None
    years_at_camp: int | None = None


@dataclass
class MockSession:
    """Mock session object for testing."""

    cm_id: int
    name: str
    session_type: str
    parent_id: int | None = None
    start_date: str | None = None
    end_date: str | None = None


@dataclass
class MockAttendee:
    """Mock attendee object for testing."""

    person_id: int
    year: int
    expand: dict[str, Any] | None = None


@dataclass
class MockCamperHistory:
    """Mock camper history record for testing."""

    person_id: int
    school: str | None = None
    city: str | None = None
    synagogue: str | None = None
    first_year_attended: int | None = None
    sessions: str | None = None
    bunks: str | None = None


class TestRetentionServiceCalculateRetention:
    """Tests for RetentionService.calculate_retention method."""

    @pytest.mark.asyncio
    async def test_calculate_retention_returns_correct_response_shape(self) -> None:
        """calculate_retention returns RetentionMetricsResponse with all fields."""
        from api.services.retention_service import RetentionService

        # Setup mock repository
        mock_repo = AsyncMock()

        # Mock data: 5 campers in base year, 3 returned in compare year
        mock_repo.fetch_attendees.side_effect = [
            # Base year attendees
            [
                MockAttendee(person_id=1, year=2025, expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")}),
                MockAttendee(person_id=2, year=2025, expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")}),
                MockAttendee(person_id=3, year=2025, expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")}),
                MockAttendee(person_id=4, year=2025, expand={"session": MockSession(cm_id=1001, name="Session 2", session_type="main")}),
                MockAttendee(person_id=5, year=2025, expand={"session": MockSession(cm_id=1001, name="Session 2", session_type="main")}),
            ],
            # Compare year attendees (persons 1, 2, 4 returned)
            [
                MockAttendee(person_id=1, year=2026, expand={}),
                MockAttendee(person_id=2, year=2026, expand={}),
                MockAttendee(person_id=4, year=2026, expand={}),
                MockAttendee(person_id=6, year=2026, expand={}),  # New camper
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M", grade=5, years_at_camp=2),
            2: MockPerson(cm_id=2, gender="M", grade=5, years_at_camp=1),
            3: MockPerson(cm_id=3, gender="F", grade=6, years_at_camp=1),
            4: MockPerson(cm_id=4, gender="F", grade=6, years_at_camp=3),
            5: MockPerson(cm_id=5, gender="F", grade=7, years_at_camp=2),
        }

        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
            1001: MockSession(cm_id=1001, name="Session 2", session_type="main"),
        }

        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        # build_history_by_person is a sync method, use MagicMock return
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
        )

        # Verify response shape
        assert result.base_year == 2025
        assert result.compare_year == 2026
        assert result.base_year_total == 5
        assert result.compare_year_total == 4
        assert result.returned_count == 3
        assert result.overall_retention_rate == pytest.approx(0.6)  # 3/5

        # Verify breakdown lists exist
        assert isinstance(result.by_gender, list)
        assert isinstance(result.by_grade, list)
        assert isinstance(result.by_session, list)
        assert isinstance(result.by_years_at_camp, list)

    @pytest.mark.asyncio
    async def test_calculate_retention_gender_breakdown(self) -> None:
        """calculate_retention computes correct gender breakdown."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # 2 males (1 returned), 3 females (2 returned)
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(person_id=1, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
                MockAttendee(person_id=2, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
                MockAttendee(person_id=3, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
                MockAttendee(person_id=4, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
                MockAttendee(person_id=5, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            ],
            [
                MockAttendee(person_id=1, year=2026, expand={}),
                MockAttendee(person_id=3, year=2026, expand={}),
                MockAttendee(person_id=4, year=2026, expand={}),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),  # Returned
            2: MockPerson(cm_id=2, gender="M"),  # Not returned
            3: MockPerson(cm_id=3, gender="F"),  # Returned
            4: MockPerson(cm_id=4, gender="F"),  # Returned
            5: MockPerson(cm_id=5, gender="F"),  # Not returned
        }

        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        # Find gender breakdowns
        male_stats = next((g for g in result.by_gender if g.gender == "M"), None)
        female_stats = next((g for g in result.by_gender if g.gender == "F"), None)

        assert male_stats is not None
        assert male_stats.base_count == 2
        assert male_stats.returned_count == 1
        assert male_stats.retention_rate == 0.5

        assert female_stats is not None
        assert female_stats.base_count == 3
        assert female_stats.returned_count == 2
        assert female_stats.retention_rate == pytest.approx(2 / 3)

    @pytest.mark.asyncio
    async def test_calculate_retention_filters_by_session_types(self) -> None:
        """calculate_retention filters attendees by session_types."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # Base year has main and ag sessions
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(person_id=1, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
                MockAttendee(person_id=2, year=2025, expand={"session": MockSession(cm_id=1001, name="AG", session_type="ag")}),
                MockAttendee(person_id=3, year=2025, expand={"session": MockSession(cm_id=1002, name="Family", session_type="family")}),
            ],
            [
                MockAttendee(person_id=1, year=2026, expand={}),
                MockAttendee(person_id=2, year=2026, expand={}),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
            3: MockPerson(cm_id=3, gender="M"),
        }

        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_types=["main"],  # Only main sessions
        )

        # Only person 1 should be counted (main session)
        assert result.base_year_total == 1
        assert result.returned_count == 1

    @pytest.mark.asyncio
    async def test_calculate_retention_filters_by_session_cm_id(self) -> None:
        """calculate_retention filters attendees by specific session_cm_id."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(person_id=1, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
                MockAttendee(person_id=2, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
                MockAttendee(person_id=3, year=2025, expand={"session": MockSession(cm_id=1001, name="S2", session_type="main")}),
            ],
            [
                MockAttendee(person_id=1, year=2026, expand={}),
                MockAttendee(person_id=2, year=2026, expand={}),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
            3: MockPerson(cm_id=3, gender="M"),
        }

        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
            1001: MockSession(cm_id=1001, name="Session 2", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(
            base_year=2025,
            compare_year=2026,
            session_cm_id=1000,  # Only Session 1
        )

        # Only persons 1 and 2 should be counted
        assert result.base_year_total == 2
        assert result.returned_count == 2

    @pytest.mark.asyncio
    async def test_calculate_retention_handles_empty_base_year(self) -> None:
        """calculate_retention handles empty base year gracefully."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.side_effect = [[], []]  # No attendees
        mock_repo.fetch_persons.return_value = {}
        mock_repo.fetch_sessions.return_value = {}
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        assert result.base_year_total == 0
        assert result.returned_count == 0
        assert result.overall_retention_rate == 0.0
        assert result.by_gender == []
        assert result.by_grade == []

    @pytest.mark.asyncio
    async def test_calculate_retention_merges_ag_into_parent(self) -> None:
        """calculate_retention merges AG session stats into parent sessions."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # Person 1 in main, person 2 in AG (parent is main)
        mock_repo.fetch_attendees.side_effect = [
            [
                MockAttendee(person_id=1, year=2025, expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")}),
                MockAttendee(person_id=2, year=2025, expand={"session": MockSession(cm_id=1001, name="AG Session", session_type="ag", parent_id=1000)}),
            ],
            [
                MockAttendee(person_id=1, year=2026, expand={}),
            ],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
        }

        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
            1001: MockSession(cm_id=1001, name="AG Session", session_type="ag", parent_id=1000),
        }
        mock_repo.fetch_camper_history.return_value = []
        mock_repo.fetch_summer_enrollment_history.return_value = []
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        # Should only have one session breakdown (main), not AG
        assert len(result.by_session) == 1
        assert result.by_session[0].session_name == "Session 1"
        # Both campers should be counted under the main session
        assert result.by_session[0].base_count == 2


class TestRetentionServiceComputeSummerMetrics:
    """Tests for summer enrollment metrics computation."""

    @pytest.mark.asyncio
    async def test_computes_summer_years_correctly(self) -> None:
        """Service computes summer years from enrollment history."""
        from api.services.retention_service import RetentionService

        mock_repo = AsyncMock()

        # Person 1: enrolled 2023, 2024, 2025 (3 summers)
        # Person 2: enrolled 2025 only (1 summer)
        mock_repo.fetch_attendees.side_effect = [
            # Base year
            [
                MockAttendee(person_id=1, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
                MockAttendee(person_id=2, year=2025, expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")}),
            ],
            # Compare year
            [MockAttendee(person_id=1, year=2026, expand={})],
        ]

        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, gender="M"),
            2: MockPerson(cm_id=2, gender="F"),
        }

        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
        }
        mock_repo.fetch_camper_history.return_value = []

        # Summer enrollment history
        mock_repo.fetch_summer_enrollment_history.return_value = [
            MockAttendee(person_id=1, year=2023, expand={"session": MockSession(cm_id=900, name="S1-2023", session_type="main")}),
            MockAttendee(person_id=1, year=2024, expand={"session": MockSession(cm_id=950, name="S1-2024", session_type="main")}),
            MockAttendee(person_id=1, year=2025, expand={"session": MockSession(cm_id=1000, name="S1-2025", session_type="main")}),
            MockAttendee(person_id=2, year=2025, expand={"session": MockSession(cm_id=1000, name="S1-2025", session_type="main")}),
        ]
        mock_repo.build_history_by_person = MagicMock(return_value={})

        service = RetentionService(mock_repo)
        result = await service.calculate_retention(base_year=2025, compare_year=2026)

        # Check summer years breakdown
        assert len(result.by_summer_years) == 2

        one_summer = next((s for s in result.by_summer_years if s.summer_years == 1), None)
        three_summers = next((s for s in result.by_summer_years if s.summer_years == 3), None)

        assert one_summer is not None
        assert one_summer.base_count == 1  # Person 2

        assert three_summers is not None
        assert three_summers.base_count == 1  # Person 1
