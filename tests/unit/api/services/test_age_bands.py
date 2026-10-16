"""Campers by age on Registration › Overview (epic #3207, owner ruling D-UNCOVERED).

Age is the season year minus the birth year, never the stored `persons.age`
snapshot, which drifts. Bars: 5-7, 8-10, 11-13, 14-16, 17+, None (no birthdate).
Distinct campers, the same enrolled population and scope as the grade chart, and
the drill-down list behind a bar holds exactly the campers the bar counts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock

import pytest

from api.services.extractors import AGE_BAND_KEYS, extract_age_band


@dataclass
class Person:
    cm_id: int
    birthdate: str | None = None
    age: float | None = None
    grade: int | None = None
    gender: str | None = None
    years_at_camp: int | None = None
    first_name: str = "Emma"
    last_name: str = "Johnson"


@dataclass
class Session:
    cm_id: int
    name: str
    session_type: str
    parent_id: int | None = None
    start_date: str | None = None
    end_date: str | None = None


@dataclass
class Attendee:
    person_id: int
    status: str = "enrolled"
    expand: dict[str, Any] | None = None


S1 = Session(cm_id=1000, name="Session 2", session_type="main")
S2 = Session(cm_id=1001, name="Session 3", session_type="main")


def _att(pid: int, session: Session = S1) -> Attendee:
    return Attendee(person_id=pid, expand={"session": session})


class TestExtractAgeBand:
    @pytest.mark.parametrize(
        ("birthdate", "band"),
        [
            ("2019-01-01", "5-7"),  # 7
            ("2018-12-31", "8-10"),  # 8, even with a December birthday
            ("2016-11-30", "8-10"),  # born late 2016 -> 10 in 2026 (the note's example)
            ("2016-01-01", "8-10"),  # 10
            ("2015-06-15", "11-13"),  # 11
            ("2013-12-31", "11-13"),  # 13
            ("2012-01-01", "14-16"),  # 14
            ("2010-12-31", "14-16"),  # 16
            ("2009-01-01", "17+"),  # 17
            ("2001-05-05", "17+"),  # 25
            ("2016-11-30 00:00:00.000Z", "8-10"),  # PocketBase datetime form
        ],
    )
    def test_season_year_minus_birth_year(self, birthdate: str, band: str) -> None:
        assert extract_age_band(Person(cm_id=1, birthdate=birthdate), 2026) == band

    def test_under_five_folds_into_youngest_band(self) -> None:
        # Measured zero campers under 5 in 2025 and 2026, so the youngest bar takes them.
        assert extract_age_band(Person(cm_id=1, birthdate="2022-03-01"), 2026) == "5-7"

    @pytest.mark.parametrize("birthdate", [None, "", "   ", "unknown"])
    def test_no_birthdate_is_none(self, birthdate: str | None) -> None:
        assert extract_age_band(Person(cm_id=1, birthdate=birthdate), 2026) == "none"

    def test_ignores_stored_age_snapshot(self) -> None:
        assert extract_age_band(Person(cm_id=1, birthdate="2016-11-30", age=9.87), 2026) == "8-10"

    def test_season_is_the_viewed_season(self) -> None:
        person = Person(cm_id=1, birthdate="2016-11-30")
        assert extract_age_band(person, 2026) == "8-10"
        assert extract_age_band(person, 2027) == "11-13"

    def test_band_order(self) -> None:
        assert AGE_BAND_KEYS == ("5-7", "8-10", "11-13", "14-16", "17+", "none")


def _registration_repo(attendees: list[Attendee], persons: dict[int, Person]) -> AsyncMock:
    repo = AsyncMock()

    async def fetch_attendees(year: int, status: Any = None) -> list[Attendee]:
        if status in (None, ["enrolled"], "enrolled"):
            return attendees
        return []

    repo.fetch_attendees.side_effect = fetch_attendees
    repo.fetch_persons.return_value = persons
    repo.fetch_sessions.return_value = {S1.cm_id: S1, S2.cm_id: S2}
    repo.fetch_summer_enrollment_history.return_value = []
    repo.fetch_bunk_plans.return_value = []
    repo.fetch_capacity_config.return_value = 12
    return repo


class TestRegistrationByAge:
    @pytest.mark.asyncio
    async def test_counts_distinct_campers_in_every_band_in_order(self) -> None:
        from api.services.registration_service import RegistrationService

        persons = {
            1: Person(cm_id=1, birthdate="2016-11-30"),  # 10
            2: Person(cm_id=2, birthdate="2016-02-01"),  # 10
            3: Person(cm_id=3, birthdate="2013-07-04"),  # 13
            4: Person(cm_id=4, birthdate=""),  # none
            5: Person(cm_id=5, birthdate="2009-09-09"),  # 17
        }
        # Camper 1 is in two sessions and counts once.
        attendees = [_att(1), _att(1, S2), _att(2), _att(3), _att(4), _att(5)]
        result = await RegistrationService(_registration_repo(attendees, persons)).calculate_registration(2026)

        assert [(b.band, b.count) for b in result.by_age] == [
            ("5-7", 0),
            ("8-10", 2),
            ("11-13", 1),
            ("14-16", 0),
            ("17+", 1),
            ("none", 1),
        ]
        assert sum(b.count for b in result.by_age) == result.total_enrolled == 5
        assert [b.percentage for b in result.by_age] == [0.0, 40.0, 20.0, 0.0, 20.0, 20.0]

    @pytest.mark.asyncio
    async def test_uses_season_year_not_stored_age(self) -> None:
        from api.services.registration_service import RegistrationService

        persons = {1: Person(cm_id=1, birthdate="2016-11-30", age=9.87)}
        result = await RegistrationService(_registration_repo([_att(1)], persons)).calculate_registration(2026)
        assert {b.band: b.count for b in result.by_age}["8-10"] == 1

    @pytest.mark.asyncio
    async def test_no_campers_gives_six_empty_bands(self) -> None:
        from api.services.registration_service import RegistrationService

        result = await RegistrationService(_registration_repo([], {})).calculate_registration(2026)
        assert [(b.band, b.count, b.percentage) for b in result.by_age] == [(key, 0, 0.0) for key in AGE_BAND_KEYS]

    @pytest.mark.asyncio
    async def test_camper_with_no_persons_row_is_left_out_like_grade(self) -> None:
        from api.services.registration_service import RegistrationService

        persons = {1: Person(cm_id=1, birthdate="2016-11-30", grade=5)}
        result = await RegistrationService(_registration_repo([_att(1), _att(2)], persons)).calculate_registration(2026)
        assert sum(b.count for b in result.by_age) == sum(g.count for g in result.by_grade) == 1


class TestDrilldownByAgeBand:
    @pytest.mark.asyncio
    async def test_bar_list_holds_the_campers_the_bar_counts(self) -> None:
        from api.services.drilldown_service import DrilldownService
        from api.services.registration_service import RegistrationService

        persons = {
            1: Person(cm_id=1, birthdate="2016-11-30", first_name="Emma", last_name="Johnson"),
            2: Person(cm_id=2, birthdate="2018-12-31", first_name="Liam", last_name="Garcia"),
            3: Person(cm_id=3, birthdate="2015-01-01", first_name="Olivia", last_name="Chen"),
            4: Person(cm_id=4, birthdate=None, first_name="Riley", last_name="Sam"),
        }
        attendees = [_att(1), _att(1, S2), _att(2), _att(3), _att(4)]
        repo = _registration_repo(attendees, persons)

        card = await RegistrationService(repo).calculate_registration(2026)
        counts = {b.band: b.count for b in card.by_age}

        drill = DrilldownService(repo)
        for band in AGE_BAND_KEYS:
            rows = await drill.get_attendees_for_breakdown(year=2026, breakdown_type="age_band", breakdown_value=band)
            assert len(rows) == counts[band], band

        eight_to_ten = await drill.get_attendees_for_breakdown(
            year=2026, breakdown_type="age_band", breakdown_value="8-10"
        )
        assert sorted(r.person_id for r in eight_to_ten) == [1, 2]
        none = await drill.get_attendees_for_breakdown(year=2026, breakdown_type="age_band", breakdown_value="none")
        assert [r.person_id for r in none] == [4]

    @pytest.mark.asyncio
    async def test_reads_age_in_the_drilled_season(self) -> None:
        from api.services.drilldown_service import DrilldownService

        persons = {1: Person(cm_id=1, birthdate="2016-11-30")}
        repo = _registration_repo([_att(1)], persons)
        drill = DrilldownService(repo)
        rows_2026 = await drill.get_attendees_for_breakdown(
            year=2026, breakdown_type="age_band", breakdown_value="8-10"
        )
        rows_2027 = await drill.get_attendees_for_breakdown(
            year=2027, breakdown_type="age_band", breakdown_value="11-13"
        )
        assert [r.person_id for r in rows_2026] == [1]
        assert [r.person_id for r in rows_2027] == [1]
