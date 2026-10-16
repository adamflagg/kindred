"""Drill-down lists, epic #3207 PR 6 (decisions 13, 37, 43, 44).

- The teen-window gate: a list counts the campers its card counts. Registration,
  Waitlist and Cancellations gate SCIT/TLI to the summer window; the drill-down did not,
  so an off-season teen session (a February trip, a fall CIT) put campers on the list
  that the card never counted.
- Age is season year minus birth year (the rule CampMinder uses), never the stored
  `persons.age` snapshot, which drifts.
- The CSV-only fields: zip (the primary childhood household's billing postal code) and
  caregivers (`parent_names` as stored, which is the household's mailing-title order).
- Each session entry carries its own dates, so the list can show one row per enrollment.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from unittest.mock import AsyncMock

import pytest

from api.services.drilldown_service import DrilldownService
from api.services.metrics_repository import DrilldownHousehold

YEAR = 2026
ALL_SUMMER = ["main", "embedded", "ag", "quest", "scit", "tli"]


@dataclass
class Person:
    cm_id: int
    first_name: str = "Test"
    last_name: str = "Camper"
    preferred_name: str | None = None
    gender: str | None = "F"
    grade: int | None = 5
    age: float | None = None
    birthdate: str | None = None
    school: str | None = None
    years_at_camp: int | None = 1
    normalized_school: str | None = None
    normalized_city: str | None = None
    address_city: str | None = None
    address_state: str | None = None
    primary_childhood_household: str | None = None
    parent_names: Any = None


@dataclass
class Session:
    cm_id: int
    name: str
    session_type: str
    start_date: str | None = None
    end_date: str | None = None
    parent_id: int | None = None


@dataclass
class Attendee:
    person_id: int
    status: str = "enrolled"
    enrollment_date: str | None = None
    effective_date: str | None = None
    expand: dict[str, Any] = field(default_factory=dict)


MAIN = Session(1000, "Session 2", "main", "2026-06-20", "2026-07-10")
MAIN_B = Session(1001, "Session 3", "main", "2026-07-12", "2026-08-01")
SUMMER_TEEN = Session(3000, "Summer CIT", "scit", "2026-06-20", "2026-08-01")
WINTER_TRIP = Session(3001, "Winter Trip", "tli", "2026-02-14", "2026-02-21")
SESSIONS = {s.cm_id: s for s in (MAIN, MAIN_B, SUMMER_TEEN, WINTER_TRIP)}


def _att(pid: int, session: Session, status: str = "enrolled", **dates: str) -> Attendee:
    return Attendee(person_id=pid, status=status, expand={"session": session}, **dates)


def _repo(
    attendees_by_status: dict[str, list[Attendee]],
    persons: dict[int, Person],
    postal_codes: dict[str, str] | None = None,
) -> AsyncMock:
    repo = AsyncMock()

    async def fetch_sessions(year: int, types: list[str] | None = None) -> dict[int, Session]:
        return {k: s for k, s in SESSIONS.items() if not types or s.session_type in types}

    async def fetch_attendees(year: int, status_filter: Any = None, expand_person: bool = False) -> list[Attendee]:
        statuses = status_filter if isinstance(status_filter, list) else [status_filter or "enrolled"]
        return [a for st in statuses for a in attendees_by_status.get(st, [])]

    repo.fetch_sessions.side_effect = fetch_sessions
    repo.fetch_attendees.side_effect = fetch_attendees
    repo.fetch_persons.return_value = persons
    repo.fetch_status_history.return_value = []
    repo.fetch_drilldown_households.return_value = {
        pb_id: DrilldownHousehold(cm_id=None, postal_code=code) for pb_id, code in (postal_codes or {}).items()
    }
    return repo


class TestTeenWindowGate:
    """Card count = list count: an off-season teen session is not a summer enrollment."""

    @pytest.mark.asyncio
    async def test_enrolled_list_drops_an_off_season_teen_session(self) -> None:
        persons = {1: Person(1), 2: Person(2), 3: Person(3)}
        enrolled = [_att(1, MAIN), _att(2, SUMMER_TEEN), _att(3, WINTER_TRIP)]
        service = DrilldownService(_repo({"enrolled": enrolled}, persons))

        result = await service.get_attendees_for_breakdown(
            YEAR, "status", "enrolled", session_types=ALL_SUMMER, status_filter=["enrolled"]
        )

        assert sorted(a.person_id for a in result) == [1, 2]

    @pytest.mark.asyncio
    async def test_teens_scope_keeps_only_the_summer_teen_session(self) -> None:
        persons = {2: Person(2), 3: Person(3)}
        enrolled = [_att(2, SUMMER_TEEN), _att(3, WINTER_TRIP)]
        service = DrilldownService(_repo({"enrolled": enrolled}, persons))

        result = await service.get_attendees_for_breakdown(
            YEAR, "gender", "Girl/woman", session_types=["scit", "tli"], status_filter=["enrolled"]
        )

        assert [a.person_id for a in result] == [2]

    @pytest.mark.asyncio
    async def test_cancellation_list_is_gated(self) -> None:
        persons = {4: Person(4), 5: Person(5)}
        cancelled = [_att(4, MAIN, "cancelled"), _att(5, WINTER_TRIP, "cancelled")]
        service = DrilldownService(_repo({"cancelled": cancelled}, persons))

        result = await service.get_attendees_for_breakdown(
            YEAR, "cancellation_total", "all", session_types=ALL_SUMMER, status_filter=["enrolled"]
        )

        assert [a.person_id for a in result] == [4]

    @pytest.mark.asyncio
    async def test_waitlist_list_and_its_waitlisted_for_cell_are_gated(self) -> None:
        persons = {6: Person(6), 7: Person(7)}
        waitlisted = [
            _att(6, MAIN, "waitlisted"),
            _att(6, WINTER_TRIP, "waitlisted"),
            _att(7, WINTER_TRIP, "waitlisted"),
        ]
        service = DrilldownService(_repo({"waitlisted": waitlisted}, persons))

        result = await service.get_attendees_for_breakdown(
            YEAR, "waitlist_total", "all", session_types=ALL_SUMMER, status_filter=["enrolled"]
        )

        assert [a.person_id for a in result] == [6]
        assert [s.session_name for s in result[0].sessions] == ["Session 2"]


class TestAge:
    """Age = season year - birth year; no birth date -> no age. The stored snapshot is never read."""

    @pytest.mark.asyncio
    async def test_age_is_the_season_year_minus_the_birth_year(self) -> None:
        persons = {
            1: Person(1, age=13.9, birthdate="2014-11-30"),
            2: Person(2, age=11.2, birthdate=None),
        }
        service = DrilldownService(_repo({"enrolled": [_att(1, MAIN), _att(2, MAIN)]}, persons))

        result = await service.get_attendees_for_breakdown(
            YEAR, "status", "enrolled", session_types=ALL_SUMMER, status_filter=["enrolled"]
        )

        ages = {a.person_id: a.age for a in result}
        assert ages == {1: 12, 2: None}

    @pytest.mark.asyncio
    async def test_waitlist_rows_use_the_same_age_rule(self) -> None:
        persons = {6: Person(6, age=9.4, birthdate="2016-01-02")}
        service = DrilldownService(_repo({"waitlisted": [_att(6, MAIN, "waitlisted")]}, persons))

        result = await service.get_attendees_for_breakdown(
            YEAR, "waitlist_total", "all", session_types=ALL_SUMMER, status_filter=["enrolled"]
        )

        assert result[0].age == 10


class TestCsvOnlyFields:
    """Zip and caregivers ride on every list row (decisions 13 and 44); the modal never shows them."""

    @pytest.mark.asyncio
    async def test_zip_is_the_primary_childhood_households_billing_postal_code(self) -> None:
        persons = {
            1: Person(1, primary_childhood_household="hh_a"),
            2: Person(2, primary_childhood_household="hh_missing"),
            3: Person(3, primary_childhood_household=None),
        }
        repo = _repo({"enrolled": [_att(1, MAIN), _att(2, MAIN), _att(3, MAIN)]}, persons, {"hh_a": "94110"})
        service = DrilldownService(repo)

        result = await service.get_attendees_for_breakdown(
            YEAR, "status", "enrolled", session_types=ALL_SUMMER, status_filter=["enrolled"]
        )

        assert {a.person_id: a.zip for a in result} == {1: "94110", 2: None, 3: None}
        repo.fetch_drilldown_households.assert_awaited_with(YEAR)

    @pytest.mark.asyncio
    async def test_caregivers_keep_the_stored_mailing_title_order(self) -> None:
        persons = {
            1: Person(
                1,
                parent_names=[
                    {"first": "Sarah", "last": "Johnson", "relationship": "Mother", "is_primary": False},
                    {"first": "David", "last": "Johnson", "relationship": "Father", "is_primary": False},
                ],
            ),
            2: Person(2, parent_names=""),
            3: Person(3, parent_names=None),
        }
        service = DrilldownService(_repo({"enrolled": [_att(1, MAIN), _att(2, MAIN), _att(3, MAIN)]}, persons))

        result = await service.get_attendees_for_breakdown(
            YEAR, "status", "enrolled", session_types=ALL_SUMMER, status_filter=["enrolled"]
        )

        by_id = {a.person_id: a.caregivers for a in result}
        assert by_id == {1: ["Sarah Johnson", "David Johnson"], 2: [], 3: []}


class TestEnrollmentDates:
    """Each session entry carries its own Registered (effective_date) and Enrolled on (enrollment_date)."""

    @pytest.mark.asyncio
    async def test_each_session_carries_its_own_dates(self) -> None:
        persons = {1: Person(1)}
        enrolled = [
            _att(1, MAIN, effective_date="2025-11-11 00:00:00.000Z", enrollment_date="2025-11-12 16:05:00.000Z"),
            _att(1, MAIN_B, effective_date="2026-03-01 00:00:00.000Z", enrollment_date="2026-03-02 18:00:00.000Z"),
        ]
        service = DrilldownService(_repo({"enrolled": enrolled}, persons))

        result = await service.get_attendees_for_breakdown(
            YEAR, "status", "enrolled", session_types=ALL_SUMMER, status_filter=["enrolled"]
        )

        assert len(result) == 1
        dates = {(s.session_name, s.effective_date, s.enrollment_date) for s in result[0].sessions}
        assert dates == {
            ("Session 2", "2025-11-11 00:00:00.000Z", "2025-11-12 16:05:00.000Z"),
            ("Session 3", "2026-03-01 00:00:00.000Z", "2026-03-02 18:00:00.000Z"),
        }

    @pytest.mark.asyncio
    async def test_cancelled_sessions_carry_their_cancel_dates(self) -> None:
        persons = {4: Person(4)}
        cancelled = [
            _att(4, MAIN, "cancelled", enrollment_date="2026-04-01 17:00:00.000Z"),
            _att(4, MAIN_B, "cancelled", enrollment_date="2026-05-01 17:00:00.000Z"),
        ]
        service = DrilldownService(_repo({"cancelled": cancelled}, persons))

        result = await service.get_attendees_for_breakdown(
            YEAR, "cancellation_total", "all", session_types=ALL_SUMMER, status_filter=["enrolled"]
        )

        assert sorted(s.enrollment_date or "" for s in result[0].sessions) == [
            "2026-04-01 17:00:00.000Z",
            "2026-05-01 17:00:00.000Z",
        ]


QUEST = Session(2000, "Quest 1", "quest", "2026-07-01", "2026-07-08")
SESSIONS[QUEST.cm_id] = QUEST


class TestEnrolledElsewhereMatchesTheCards:
    """ "Enrolled In" / "Has Other Sessions" mean enrolled anywhere at summer camp, as the cards count it.

    WaitlistService and CancellationService look for another enrollment across every summer
    type plus the teen programs, whatever scope is picked; the lists looked only inside the
    picked types, so a Quests waitlister enrolled in a main session read as "no other sessions".
    """

    @pytest.mark.asyncio
    async def test_waitlister_enrolled_outside_the_scope_has_other_sessions(self) -> None:
        persons = {6: Person(6), 7: Person(7)}
        repo = _repo(
            {
                "waitlisted": [_att(6, QUEST, "waitlisted"), _att(7, QUEST, "waitlisted")],
                "enrolled": [_att(6, MAIN), _att(7, WINTER_TRIP)],
            },
            persons,
        )
        service = DrilldownService(repo)

        has_other = await service.get_attendees_for_breakdown(
            YEAR, "waitlist_has_enrollment", "true", session_types=["quest"], status_filter=["enrolled"]
        )
        no_other = await service.get_attendees_for_breakdown(
            YEAR, "waitlist_no_enrollment", "true", session_types=["quest"], status_filter=["enrolled"]
        )

        # Teen programs count as enrolled at camp, like the card (any teen session, as WaitlistService does).
        assert sorted(a.person_id for a in has_other) == [6, 7]
        assert no_other == []
        enrolled_in = {a.person_id: [s.session_name for s in a.enrolled_sessions] for a in has_other}
        assert enrolled_in == {6: ["Session 2"], 7: ["Winter Trip"]}

    @pytest.mark.asyncio
    async def test_cancelled_camper_enrolled_outside_the_scope_is_not_no_other_sessions(self) -> None:
        persons = {4: Person(4), 5: Person(5)}
        repo = _repo(
            {"cancelled": [_att(4, QUEST, "cancelled"), _att(5, QUEST, "cancelled")], "enrolled": [_att(4, MAIN)]},
            persons,
        )
        service = DrilldownService(repo)

        no_other = await service.get_attendees_for_breakdown(
            YEAR, "cancellation_no_other_sessions", "all", session_types=["quest"], status_filter=["enrolled"]
        )

        assert [a.person_id for a in no_other] == [5]


class TestOverviewTotalCancelled:
    """The Overview card counts status "cancelled" only; the Cancellations page counts withdrawn and
    dismissed too. Each card's list counts what its card counts: the status filter narrows it."""

    @pytest.mark.asyncio
    async def test_a_cancelled_status_filter_leaves_out_withdrawn(self) -> None:
        persons = {4: Person(4), 8: Person(8)}
        repo = _repo({"cancelled": [_att(4, MAIN, "cancelled")], "withdrawn": [_att(8, MAIN, "withdrawn")]}, persons)
        service = DrilldownService(repo)

        overview = await service.get_attendees_for_breakdown(
            YEAR, "cancellation_total", "all", session_types=ALL_SUMMER, status_filter=["cancelled"]
        )
        page = await service.get_attendees_for_breakdown(
            YEAR, "cancellation_total", "all", session_types=ALL_SUMMER, status_filter=["enrolled"]
        )

        assert [a.person_id for a in overview] == [4]
        assert sorted(a.person_id for a in page) == [4, 8]


class TestCancellationsBySessionBar:
    """The Cancellations page's by-session bars open cancellation_total with the bar's session as the
    value, as the waitlist bars do; the list ignored it and showed every cancelled camper."""

    @pytest.mark.asyncio
    async def test_the_bars_session_scopes_the_list(self) -> None:
        persons = {4: Person(4), 5: Person(5)}
        cancelled = [_att(4, MAIN, "cancelled"), _att(5, MAIN_B, "cancelled")]
        service = DrilldownService(_repo({"cancelled": cancelled}, persons))

        result = await service.get_attendees_for_breakdown(
            YEAR, "cancellation_total", str(MAIN_B.cm_id), session_types=ALL_SUMMER, status_filter=["cancelled"]
        )

        assert [a.person_id for a in result] == [5]
