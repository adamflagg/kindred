"""Tests for DrilldownService - written first (TDD).

These tests define the expected behavior for the drilldown service that enables
chart drill-down functionality: clicking a chart segment shows matching campers.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock

import pytest


@dataclass
class MockPerson:
    """Mock person object for testing."""

    cm_id: int
    first_name: str = "Test"
    last_name: str = "Person"
    preferred_name: str | None = None
    gender: str | None = None
    grade: int | None = None
    age: int | None = None
    school: str | None = None
    years_at_camp: int | None = None
    address: str | None = None  # JSON string with city


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
    status: str = "enrolled"
    expand: dict[str, Any] | None = None


class TestDrilldownServiceGetAttendees:
    """Tests for get_attendees_for_breakdown method."""

    @pytest.mark.asyncio
    async def test_returns_correct_response_shape(self) -> None:
        """get_attendees_for_breakdown returns a list of DrilldownAttendee."""
        from api.services.drilldown_service import DrilldownService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(
                person_id=1,
                status="enrolled",
                expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
            ),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, first_name="Emma", last_name="Johnson", gender="F", grade=5),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
        }

        service = DrilldownService(mock_repo)
        result = await service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="gender",
            breakdown_value="F",
        )

        assert len(result) == 1
        assert result[0].first_name == "Emma"
        assert result[0].last_name == "Johnson"
        assert result[0].session_name == "Session 1"

    @pytest.mark.asyncio
    async def test_filter_by_gender(self) -> None:
        """Filter by gender returns only matching attendees."""
        from api.services.drilldown_service import DrilldownService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(
                person_id=1,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
            MockAttendee(
                person_id=2,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
            MockAttendee(
                person_id=3,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, first_name="Emma", last_name="Johnson", gender="F"),
            2: MockPerson(cm_id=2, first_name="Liam", last_name="Garcia", gender="M"),
            3: MockPerson(cm_id=3, first_name="Olivia", last_name="Chen", gender="F"),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }

        service = DrilldownService(mock_repo)
        result = await service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="gender",
            breakdown_value="F",
        )

        assert len(result) == 2
        names = {r.first_name for r in result}
        assert names == {"Emma", "Olivia"}

    @pytest.mark.asyncio
    async def test_filter_by_grade(self) -> None:
        """Filter by grade returns only matching attendees."""
        from api.services.drilldown_service import DrilldownService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(
                person_id=1,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
            MockAttendee(
                person_id=2,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
            MockAttendee(
                person_id=3,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, first_name="Emma", last_name="Johnson", grade=5),
            2: MockPerson(cm_id=2, first_name="Liam", last_name="Garcia", grade=6),
            3: MockPerson(cm_id=3, first_name="Olivia", last_name="Chen", grade=5),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }

        service = DrilldownService(mock_repo)
        result = await service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="grade",
            breakdown_value="5",
        )

        assert len(result) == 2
        names = {r.first_name for r in result}
        assert names == {"Emma", "Olivia"}

    @pytest.mark.asyncio
    async def test_filter_by_session(self) -> None:
        """Filter by session returns only matching attendees."""
        from api.services.drilldown_service import DrilldownService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(
                person_id=1,
                expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
            ),
            MockAttendee(
                person_id=2,
                expand={"session": MockSession(cm_id=2000, name="Session 2", session_type="main")},
            ),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, first_name="Emma", last_name="Johnson"),
            2: MockPerson(cm_id=2, first_name="Liam", last_name="Garcia"),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
            2000: MockSession(cm_id=2000, name="Session 2", session_type="main"),
        }

        service = DrilldownService(mock_repo)
        result = await service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="session",
            breakdown_value="1000",
        )

        assert len(result) == 1
        assert result[0].first_name == "Emma"
        assert result[0].session_cm_id == 1000

    @pytest.mark.asyncio
    async def test_filter_by_school(self) -> None:
        """Filter by school returns only matching attendees."""
        from api.services.drilldown_service import DrilldownService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(
                person_id=1,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
            MockAttendee(
                person_id=2,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, first_name="Emma", last_name="Johnson", school="Riverside Elementary"),
            2: MockPerson(cm_id=2, first_name="Liam", last_name="Garcia", school="Oak Valley Middle"),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }

        service = DrilldownService(mock_repo)
        result = await service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="school",
            breakdown_value="Riverside Elementary",
        )

        assert len(result) == 1
        assert result[0].first_name == "Emma"

    @pytest.mark.asyncio
    async def test_filter_by_years_at_camp(self) -> None:
        """Filter by years_at_camp returns only matching attendees."""
        from api.services.drilldown_service import DrilldownService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(
                person_id=1,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
            MockAttendee(
                person_id=2,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
            MockAttendee(
                person_id=3,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, first_name="Emma", last_name="Johnson", years_at_camp=1),
            2: MockPerson(cm_id=2, first_name="Liam", last_name="Garcia", years_at_camp=3),
            3: MockPerson(cm_id=3, first_name="Olivia", last_name="Chen", years_at_camp=1),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }

        service = DrilldownService(mock_repo)
        result = await service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="years_at_camp",
            breakdown_value="1",
        )

        assert len(result) == 2
        names = {r.first_name for r in result}
        assert names == {"Emma", "Olivia"}

    @pytest.mark.asyncio
    async def test_respects_session_cm_id_filter(self) -> None:
        """Additional session_cm_id filter narrows results."""
        from api.services.drilldown_service import DrilldownService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(
                person_id=1,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
            MockAttendee(
                person_id=2,
                expand={"session": MockSession(cm_id=2000, name="S2", session_type="main")},
            ),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, first_name="Emma", last_name="Johnson", gender="F"),
            2: MockPerson(cm_id=2, first_name="Olivia", last_name="Chen", gender="F"),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
            2000: MockSession(cm_id=2000, name="S2", session_type="main"),
        }

        service = DrilldownService(mock_repo)
        # Filter by gender=F but also limit to session 1000
        result = await service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="gender",
            breakdown_value="F",
            session_cm_id=1000,
        )

        assert len(result) == 1
        assert result[0].first_name == "Emma"

    @pytest.mark.asyncio
    async def test_includes_ag_sessions_with_parent(self) -> None:
        """AG sessions are included when their parent session is selected."""
        from api.services.drilldown_service import DrilldownService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(
                person_id=1,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
            MockAttendee(
                person_id=2,
                expand={"session": MockSession(cm_id=1001, name="AG-S1", session_type="ag", parent_id=1000)},
            ),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, first_name="Emma", last_name="Johnson", gender="F"),
            2: MockPerson(cm_id=2, first_name="Olivia", last_name="Chen", gender="F"),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
            1001: MockSession(cm_id=1001, name="AG-S1", session_type="ag", parent_id=1000),
        }

        service = DrilldownService(mock_repo)
        # Filter by session 1000 - should also include AG session attendees
        result = await service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="gender",
            breakdown_value="F",
            session_cm_id=1000,
        )

        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_respects_session_types_filter(self) -> None:
        """session_types filter only includes matching session types."""
        from api.services.drilldown_service import DrilldownService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(
                person_id=1,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
            MockAttendee(
                person_id=2,
                expand={"session": MockSession(cm_id=2000, name="Family", session_type="family")},
            ),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, first_name="Emma", last_name="Johnson", gender="F"),
            2: MockPerson(cm_id=2, first_name="Olivia", last_name="Chen", gender="F"),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
            2000: MockSession(cm_id=2000, name="Family", session_type="family"),
        }

        service = DrilldownService(mock_repo)
        result = await service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="gender",
            breakdown_value="F",
            session_types=["main"],
        )

        assert len(result) == 1
        assert result[0].first_name == "Emma"

    @pytest.mark.asyncio
    async def test_deduplicates_persons_in_multiple_sessions(self) -> None:
        """Same person in multiple sessions appears once per session."""
        from api.services.drilldown_service import DrilldownService

        mock_repo = AsyncMock()
        # Same person in two sessions
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(
                person_id=1,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
            MockAttendee(
                person_id=1,
                expand={"session": MockSession(cm_id=2000, name="S2", session_type="main")},
            ),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, first_name="Emma", last_name="Johnson", gender="F"),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
            2000: MockSession(cm_id=2000, name="S2", session_type="main"),
        }

        service = DrilldownService(mock_repo)
        result = await service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="gender",
            breakdown_value="F",
        )

        # Should return both records (one per session enrollment)
        assert len(result) == 2
        sessions = {r.session_name for r in result}
        assert sessions == {"S1", "S2"}

    @pytest.mark.asyncio
    async def test_includes_is_returning_flag(self) -> None:
        """Response includes is_returning flag based on years_at_camp."""
        from api.services.drilldown_service import DrilldownService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(
                person_id=1,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
            MockAttendee(
                person_id=2,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, first_name="Emma", last_name="Johnson", years_at_camp=1),  # New
            2: MockPerson(cm_id=2, first_name="Liam", last_name="Garcia", years_at_camp=3),  # Returning
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }

        service = DrilldownService(mock_repo)
        result = await service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="session",
            breakdown_value="1000",
        )

        result_dict = {r.first_name: r for r in result}
        assert result_dict["Emma"].is_returning is False  # years_at_camp == 1
        assert result_dict["Liam"].is_returning is True  # years_at_camp > 1

    @pytest.mark.asyncio
    async def test_handles_null_grade_filter(self) -> None:
        """Filter by grade handles null/unknown grade values."""
        from api.services.drilldown_service import DrilldownService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(
                person_id=1,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
            MockAttendee(
                person_id=2,
                expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
            ),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, first_name="Emma", last_name="Johnson", grade=5),
            2: MockPerson(cm_id=2, first_name="Liam", last_name="Garcia", grade=None),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }

        service = DrilldownService(mock_repo)
        # Filter for null grade using special value
        result = await service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="grade",
            breakdown_value="null",
        )

        assert len(result) == 1
        assert result[0].first_name == "Liam"

    @pytest.mark.asyncio
    async def test_returns_all_attendee_fields(self) -> None:
        """Response includes all expected attendee fields."""
        from api.services.drilldown_service import DrilldownService

        mock_repo = AsyncMock()
        mock_repo.fetch_attendees.return_value = [
            MockAttendee(
                person_id=1,
                status="enrolled",
                expand={"session": MockSession(cm_id=1000, name="Session 1", session_type="main")},
            ),
        ]
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(
                cm_id=1,
                first_name="Emma",
                last_name="Johnson",
                preferred_name="Em",
                gender="F",
                grade=5,
                age=11,
                school="Riverside Elementary",
                years_at_camp=2,
            ),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="Session 1", session_type="main"),
        }

        service = DrilldownService(mock_repo)
        result = await service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="gender",
            breakdown_value="F",
        )

        attendee = result[0]
        assert attendee.person_id == 1
        assert attendee.first_name == "Emma"
        assert attendee.last_name == "Johnson"
        assert attendee.preferred_name == "Em"
        assert attendee.gender == "F"
        assert attendee.grade == 5
        assert attendee.age == 11
        assert attendee.school == "Riverside Elementary"
        assert attendee.years_at_camp == 2
        assert attendee.session_name == "Session 1"
        assert attendee.session_cm_id == 1000
        assert attendee.status == "enrolled"
        assert attendee.is_returning is True


class TestDrilldownServiceStatusFilter:
    """Tests for status-based filtering."""

    @pytest.mark.asyncio
    async def test_filter_by_status_enrolled(self) -> None:
        """Filter by status works for enrolled campers."""
        from api.services.drilldown_service import DrilldownService

        mock_repo = AsyncMock()

        async def mock_fetch_attendees(year: int, status_filter: str | list[str] | None = None) -> list[Any]:
            if status_filter == ["enrolled"] or status_filter is None:
                return [
                    MockAttendee(
                        person_id=1,
                        status="enrolled",
                        expand={"session": MockSession(cm_id=1000, name="S1", session_type="main")},
                    ),
                ]
            return []

        mock_repo.fetch_attendees.side_effect = mock_fetch_attendees
        mock_repo.fetch_persons.return_value = {
            1: MockPerson(cm_id=1, first_name="Emma", last_name="Johnson", gender="F"),
        }
        mock_repo.fetch_sessions.return_value = {
            1000: MockSession(cm_id=1000, name="S1", session_type="main"),
        }

        service = DrilldownService(mock_repo)
        result = await service.get_attendees_for_breakdown(
            year=2025,
            breakdown_type="gender",
            breakdown_value="F",
            status_filter=["enrolled"],
        )

        assert len(result) == 1
        assert result[0].status == "enrolled"
