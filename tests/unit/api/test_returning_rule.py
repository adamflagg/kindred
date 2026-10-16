"""One "returning" rule for enrolled campers (analytics gap plan, row 6).

The Registration card and filter count a camper as new only when CampMinder
records them in their first year (years_at_camp == 1); everyone else who is
enrolled is returning, including a camper with no years recorded. The staff
guide says so. The drill-down R badge used `years_at_camp > 1`, which only
disagrees for 0 or blank — never true of an enrolled summer row in practice,
but the rules must not drift.

Waitlisted, cancelled and other non-enrolled rows deliberately keep `> 1`:
about half of them carry 0 years, and moving them to `!= 1` would flip all of
them to "returning". That is an open owner decision (plan decision 35), so
these tests pin today's waitlist behaviour.
"""

from unittest.mock import AsyncMock, Mock

import pytest

from api.services.drilldown_service import DrilldownService
from api.services.extractors import is_new_camper, is_returning_camper
from api.services.registration_service import RegistrationService
from tests.unit.api.conftest import create_mock_attendee as create_mock_attendee_with_person
from tests.unit.api.conftest import create_mock_person, create_mock_session, create_mock_status_history


def _attendee(person_id: int, session: Mock, status: str = "enrolled", status_id: int = 2) -> Mock:
    att = Mock()
    att.person_id = person_id
    att.year = 2026
    att.status = status
    att.status_id = status_id
    att.enrollment_date = "2025-11-20"
    att.effective_date = "2025-11-20"
    att.expand = {"session": session}
    return att


@pytest.fixture
def session() -> Mock:
    return create_mock_session(1001, "Session 2", 2026, "main", "2026-06-15", "2026-07-05")


@pytest.fixture
def persons() -> dict[int, Mock]:
    return {
        101: create_mock_person(101, "Emma", "Johnson", "F", 5, years_at_camp=1),
        102: create_mock_person(102, "Liam", "Garcia", "M", 6, years_at_camp=0),
        103: create_mock_person(103, "Olivia", "Chen", "F", 7, years_at_camp=4),
    }


@pytest.fixture
def repo() -> Mock:
    r = Mock()
    r.fetch_attendees = AsyncMock(return_value=[])
    r.fetch_persons = AsyncMock(return_value={})
    r.fetch_sessions = AsyncMock(return_value={})
    r.fetch_summer_enrollment_history = AsyncMock(return_value=[])
    r.fetch_household_postal_codes = AsyncMock(return_value={})
    return r


class TestReturningHelper:
    @pytest.mark.parametrize(
        ("years", "new", "returning"),
        [(1, True, False), (2, False, True), (0, False, True), (None, False, True)],
    )
    def test_documented_rule(self, years: int | None, new: bool, returning: bool) -> None:
        assert is_new_camper(years) is new
        assert is_returning_camper(years) is returning


class TestEnrolledSitesAgree:
    """A years_at_camp=0 enrolled camper reads "returning" at every enrolled site."""

    @pytest.mark.asyncio
    async def test_drilldown_badge_matches_card_for_zero_years(
        self, repo: Mock, session: Mock, persons: dict[int, Mock]
    ) -> None:
        repo.fetch_sessions.return_value = {1001: session}
        repo.fetch_persons.return_value = persons
        repo.fetch_attendees.return_value = [_attendee(pid, session) for pid in persons]

        result = await DrilldownService(repo).get_attendees_for_breakdown(
            year=2026, breakdown_type="gender", breakdown_value="M"
        )

        assert {r.person_id: r.is_returning for r in result} == {102: True}

    @pytest.mark.asyncio
    async def test_returning_filter_includes_zero_years(
        self, repo: Mock, session: Mock, persons: dict[int, Mock]
    ) -> None:
        repo.fetch_sessions.return_value = {1001: session}
        repo.fetch_persons.return_value = persons
        repo.fetch_attendees.return_value = [_attendee(pid, session) for pid in persons]

        returning = await DrilldownService(repo).get_attendees_for_breakdown(
            year=2026, breakdown_type="returning_status", breakdown_value="returning"
        )

        assert {r.person_id for r in returning} == {102, 103}
        assert all(r.is_returning for r in returning)

    def test_registration_card_counts_zero_years_as_returning(self, persons: dict[int, Mock]) -> None:
        service = RegistrationService(Mock())
        result = service._compute_new_vs_returning({101, 102, 103}, persons, 3)
        assert (result.new_count, result.returning_count) == (1, 2)


class TestWaitlistBadgeUnchanged:
    """Pin: a waitlisted years_at_camp=0 camper still shows no R badge (decision 35 open)."""

    @pytest.mark.asyncio
    async def test_waitlist_session_gender_badge_for_zero_years(self, repo: Mock) -> None:
        repo.fetch_sessions.return_value = {1001: create_mock_session(1001, "Session 1")}
        repo.fetch_attendees_with_persons = AsyncMock(
            side_effect=lambda year, status_filter=None: (
                [
                    create_mock_attendee_with_person(
                        102,
                        1001,
                        gender="M",
                        status="waitlisted",
                        first_name="Liam",
                        last_name="Garcia",
                        grade=6,
                        years_at_camp=0,
                        effective_date="2025-11-12",
                        enrollment_date="2025-11-13T00:00:00Z",
                    )
                ]
                if status_filter == ["waitlisted"]
                else []
            )
        )

        result = await DrilldownService(repo).get_attendees_for_breakdown(
            year=2026, breakdown_type="waitlist_session_gender", breakdown_value="1001:M"
        )

        assert [(r.person_id, r.is_returning) for r in result] == [(102, False)]

    @pytest.mark.asyncio
    async def test_waitlist_accepted_badge_for_zero_years(
        self, repo: Mock, session: Mock, persons: dict[int, Mock]
    ) -> None:
        repo.fetch_sessions.return_value = {1001: session}
        repo.fetch_persons.return_value = persons
        repo.fetch_status_history = AsyncMock(
            return_value=[
                create_mock_status_history(102, session, persons[102], old_status="waitlisted", new_status="enrolled")
            ]
        )

        result = await DrilldownService(repo).get_attendees_for_breakdown(
            year=2026, breakdown_type="waitlist_accepted", breakdown_value="true"
        )

        assert [(r.person_id, r.is_returning) for r in result] == [(102, False)]

    @pytest.mark.asyncio
    async def test_waitlist_total_badge_for_zero_years(
        self, repo: Mock, session: Mock, persons: dict[int, Mock]
    ) -> None:
        waitlisted = [_attendee(102, session, status="waitlisted", status_id=8)]
        repo.fetch_sessions.return_value = {1001: session}
        repo.fetch_persons.return_value = persons
        repo.fetch_attendees = AsyncMock(
            side_effect=lambda year, status_filter=None: waitlisted if status_filter == ["waitlisted"] else []
        )

        result = await DrilldownService(repo).get_attendees_for_breakdown(
            year=2026, breakdown_type="waitlist_total", breakdown_value=""
        )

        assert [(r.person_id, r.is_returning) for r in result] == [(102, False)]

    @pytest.mark.asyncio
    async def test_cancelled_status_list_badge_for_zero_years(
        self, repo: Mock, session: Mock, persons: dict[int, Mock]
    ) -> None:
        repo.fetch_sessions.return_value = {1001: session}
        repo.fetch_persons.return_value = persons
        repo.fetch_attendees.return_value = [_attendee(102, session, status="cancelled", status_id=32)]

        result = await DrilldownService(repo).get_attendees_for_breakdown(
            year=2026, breakdown_type="gender", breakdown_value="M", status_filter=["cancelled"]
        )

        assert [(r.person_id, r.is_returning) for r in result] == [(102, False)]
