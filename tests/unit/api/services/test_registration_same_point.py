"""Overview compares with the same point last year while registration is live (decision 7, PR 7).

``calculate_registration(year, ..., same_point_of=S)`` reads ``year`` at the registration day
season S has reached today: enrolled at day N = registered by N and not cancelled by N, the rule
Velocity and Forecast use. After season S, or when ``year`` has no anchor, it reads ``year`` as it
stands now ("final"). A past waitlist cannot be rebuilt, so a same-point read has no waitlist.
"""

from dataclasses import dataclass
from datetime import date
from typing import Any
from unittest.mock import AsyncMock

import pytest

from api.services.registration_service import RegistrationService

PRIOR = 2025
CURRENT = 2026
ANCHORS = {CURRENT: "2025-11-12", PRIOR: "2024-11-12"}


@dataclass
class _Session:
    cm_id: int
    name: str
    session_type: str = "main"
    parent_id: int | None = None
    start_date: str | None = "2025-06-15"
    end_date: str | None = "2025-07-05"


@dataclass
class _Person:
    person_id: int
    gender: str | None = "F"
    grade: int | None = 5
    years_at_camp: int | None = 1
    school: str | None = None
    address: dict[str, Any] | None = None
    household_id: int | None = None
    normalized_school: str | None = None
    normalized_city: str | None = None
    address_city: str | None = None
    normalized_congregation: str | None = None


@dataclass
class _Att:
    person_id: int
    status: str
    status_id: int
    effective_date: str
    enrollment_date: str
    expand: dict[str, Any]


SESSION = _Session(1000, "Session 2")
STATUS_IDS = {"enrolled": 2, "cancelled": 32, "withdrawn": 256, "waitlisted": 8}


def _att(pid: int, status: str, registered: str, posted: str | None = None) -> _Att:
    return _Att(
        person_id=pid,
        status=status,
        status_id=STATUS_IDS[status],
        effective_date=registered,
        enrollment_date=posted or registered,
        expand={"session": SESSION},
    )


# 2025, read at day 110 of 2026's season (2026-03-02) -> cutoff 2025-03-02 (day 110 from 2024-11-12)
PRIOR_ATTENDEES = [
    _att(1, "enrolled", "2024-11-12"),  # registered on the priority day, still enrolled
    _att(2, "enrolled", "2025-03-02"),  # registered on the cutoff day itself: counts
    _att(3, "enrolled", "2025-04-20"),  # registered after the cutoff: not yet enrolled then
    _att(4, "cancelled", "2024-11-13", "2025-05-01"),  # cancelled after the cutoff: enrolled then
    _att(5, "cancelled", "2024-11-13", "2025-01-10"),  # cancelled by the cutoff
    _att(6, "withdrawn", "2024-11-20", "2025-02-01"),  # withdrawn by the cutoff: not enrolled, not "cancelled"
    _att(7, "waitlisted", "2024-12-01"),  # a waitlist cannot be rebuilt
]


def _repo(attendees: list[_Att], dates: dict[int, str] | None = None) -> AsyncMock:
    dates = ANCHORS if dates is None else dates
    repo = AsyncMock()

    async def fetch_attendees(year: int, status_filter: Any = None, expand_person: bool = False) -> list[Any]:
        wanted = status_filter[0] if isinstance(status_filter, list) else (status_filter or "enrolled")
        return [a for a in attendees if a.status == wanted]

    async def fetch_dates(year: int) -> dict[str, str]:
        return {"priority_reg_date": dates[year]} if year in dates else {}

    async def with_dates(year: int, session_cm_id: int | None = None, expand_person: bool = False) -> list[Any]:
        return list(attendees)

    repo.fetch_attendees.side_effect = fetch_attendees
    repo.fetch_registration_dates.side_effect = fetch_dates
    repo.fetch_attendees_with_dates.side_effect = with_dates
    repo.fetch_sessions.return_value = {1000: SESSION}
    repo.fetch_persons.return_value = {i: _Person(i) for i in range(1, 8)}
    repo.fetch_summer_enrollment_history.return_value = []
    repo.fetch_bunk_plans.return_value = []
    repo.fetch_capacity_config.return_value = 12
    return repo


class TestRegistrationSamePoint:
    @pytest.mark.asyncio
    async def test_live_season_reads_the_prior_year_at_the_same_registration_day(self) -> None:
        service = RegistrationService(_repo(PRIOR_ATTENDEES))

        result = await service.calculate_registration(PRIOR, same_point_of=CURRENT, today=date(2026, 3, 2))

        assert result.prior_basis == "same_point"
        assert result.day_offset == 110
        assert result.prior_day_offset == 110
        assert result.as_of_date == "2025-03-02"
        # 1, 2 and 4 were registered by the day and not cancelled by it
        assert result.total_enrolled == 3
        assert sum(s.count for s in result.by_session) == 3
        assert result.new_vs_returning.new_count + result.new_vs_returning.returning_count == 3
        # 5 cancelled by the day; 6 withdrew, which Overview's Cancelled never counts
        assert result.total_cancelled == 1
        assert result.total_waitlisted is None

    @pytest.mark.asyncio
    async def test_priority_date_reads_the_prior_year_through_the_next_day(self) -> None:
        """Decision 45: day 0 reads the prior through day 1, where its batch-dated sign-ups sit."""
        attendees = [_att(1, "enrolled", "2024-11-12"), _att(2, "enrolled", "2024-11-13")]
        service = RegistrationService(_repo(attendees))

        result = await service.calculate_registration(PRIOR, same_point_of=CURRENT, today=date(2025, 11, 12))

        assert result.prior_basis == "same_point"
        assert result.day_offset == 0
        assert result.prior_day_offset == 1
        assert result.as_of_date == "2024-11-13"
        assert result.total_enrolled == 2

    @pytest.mark.asyncio
    async def test_before_the_anchor_counts_every_earlier_registration(self) -> None:
        attendees = [_att(1, "enrolled", "2024-09-01"), _att(2, "enrolled", "2024-11-12")]
        service = RegistrationService(_repo(attendees))

        result = await service.calculate_registration(PRIOR, same_point_of=CURRENT, today=date(2025, 11, 2))

        assert result.day_offset == -10
        assert result.as_of_date == "2024-11-02"
        assert result.total_enrolled == 1

    @pytest.mark.asyncio
    async def test_after_the_season_reads_the_final(self) -> None:
        service = RegistrationService(_repo(PRIOR_ATTENDEES))

        result = await service.calculate_registration(PRIOR, same_point_of=CURRENT, today=date(2026, 9, 1))

        assert result.prior_basis == "final"
        assert result.day_offset is None
        assert result.prior_day_offset is None
        assert result.as_of_date is None
        assert result.total_enrolled == 3  # today's enrolled records: 1, 2 and 3
        assert result.total_waitlisted == 1

    @pytest.mark.asyncio
    async def test_a_year_with_no_anchor_reads_the_final(self) -> None:
        service = RegistrationService(_repo(PRIOR_ATTENDEES, dates={CURRENT: ANCHORS[CURRENT]}))

        result = await service.calculate_registration(PRIOR, same_point_of=CURRENT, today=date(2026, 3, 2))

        assert result.prior_basis == "final"
        assert result.as_of_date is None

    @pytest.mark.asyncio
    async def test_without_same_point_of_nothing_changes(self) -> None:
        service = RegistrationService(_repo(PRIOR_ATTENDEES))

        result = await service.calculate_registration(PRIOR)

        assert result.prior_basis is None
        assert result.day_offset is None
        assert result.total_enrolled == 3
        assert result.total_cancelled == 2
        assert result.total_waitlisted == 1

    @pytest.mark.asyncio
    async def test_same_point_needs_the_enrolled_status(self) -> None:
        service = RegistrationService(_repo(PRIOR_ATTENDEES))

        with pytest.raises(ValueError, match="enrolled"):
            await service.calculate_registration(
                PRIOR, status_filter=["waitlisted"], same_point_of=CURRENT, today=date(2026, 3, 2)
            )


class TestMetricsDoesNotFold:
    """#15: the embedded add is Today only. Overview's one-session read keeps the session's own campers."""

    @pytest.mark.asyncio
    async def test_a_picked_session_does_not_add_the_embedded_sessions_it_contains(self) -> None:
        main = _Session(1000, "Session 2", start_date="2025-06-22", end_date="2025-07-12")
        embedded = _Session(1001, "Session 2b", session_type="embedded", start_date="2025-07-06", end_date="2025-07-12")
        in_main = _att(1, "enrolled", "2024-11-12")
        in_main.expand = {"session": main}
        in_embedded = _att(2, "enrolled", "2024-11-12")
        in_embedded.expand = {"session": embedded}
        repo = _repo([in_main, in_embedded])
        repo.fetch_sessions.return_value = {1000: main, 1001: embedded}
        service = RegistrationService(repo)

        result = await service.calculate_registration(
            PRIOR, session_cm_id=1000, same_point_of=CURRENT, today=date(2026, 3, 2)
        )

        assert result.total_enrolled == 1
