"""Development's ZIP codes by group (Reports back end, Part C, owner ruling 2026-10-02): the tables stay the summer
group by default; `group` takes any of the season's pool keys, or `all`. Fictional only. Pools in the fixture rules:
camp_pool (summer), weekend_pool (a family camp and an adult weekend), bmitzvah_pool (campers only)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any

import pytest

from api.services.financial_aid_development_service import FinancialAidDevelopmentService, attendance, grouping
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_reports_service import ReportsRefusedError
from bunking.financial_aid.reports.zips import NO_ZIP, HouseholdAddress
from tests.unit.api.services.decisions_fakes import FakeRules, approved, grant_row
from tests.unit.api.services.development_fakes import FakeDevelopmentStore, went
from tests.unit.api.services.financial_aid_fakes import SESSIONS, YEAR, intake_rules
from tests.unit.api.services.reports_fakes import FakeReportsStore, report_season
from tests.unit.bunking.financial_aid.fixtures import with_lever

pytestmark = pytest.mark.asyncio

NOW = datetime(2027, 4, 1, 17, 0, tzinfo=UTC)
EMMA, SIBLING, LIAM, PARENT_A, PARENT_B = 1000011, 1000012, 1000021, 1000031, 1000041
FAMILY_CAMP, ADULT_WEEKEND, BMITZVAH = 1000201, 1000401, 1000301
ZIP_A, ZIP_B, ZIP_C = "94000", "94111", "95000"


def _development(**change: Any) -> FakeDevelopmentStore:
    store = FakeDevelopmentStore(
        registrations=[
            went(EMMA, 1000001),  # summer
            went(LIAM, 1000002),  # summer, no aid
            went(SIBLING, 1000001, BMITZVAH, session_type="bmitzvah"),  # Emma's household again, in the B*Mitzvah group
            went(PARENT_A, 1000003, FAMILY_CAMP, session_type="family"),  # weekend
            went(PARENT_B, 1000004, ADULT_WEEKEND, session_type="adult"),  # weekend
        ],
        homes={
            1000001: HouseholdAddress(ZIP_A, "US"),
            1000002: HouseholdAddress("", "US"),
            1000003: HouseholdAddress(ZIP_B, "US"),
            1000004: HouseholdAddress(ZIP_C, "US"),
        },
    )
    for key, value in change.items():
        setattr(store, key, value)
    return store


def _weekend_grant() -> RegisterRow:
    """An outside grant of 300 on the family-camp household (a household-level line: no camper on it)."""
    return replace(
        grant_row("", "300", on_request=False),
        household_cm_id=1000003,
        person_cm_id=0,
        session_cm_id=FAMILY_CAMP,
        program_family="family",
    )


def _summer_household_line() -> RegisterRow:
    """An outside grant of 100 on Liam's household, on no camper (household-level), in a summer session."""
    return replace(grant_row("", "100", on_request=False), household_cm_id=1000002, person_cm_id=0)


def _service(
    development: FakeDevelopmentStore, rules: Any = None, extra: Sequence[RegisterRow] = ()
) -> FinancialAidDevelopmentService:
    async def rows(year: int) -> Sequence[RegisterRow]:
        return [grant_row("reqemma00000001", "500"), _weekend_grant(), *extra] if year == YEAR else []

    return FinancialAidDevelopmentService(
        report_season(),
        FakeRules(approved(rules or intake_rules())),
        rows,
        development,
        FakeReportsStore(),
        clock=lambda: NOW,
    )


def _zips(table: Any) -> list[tuple[str, int, int]]:
    return [(r.zip, r.campers, r.families) for r in table.rows]


async def test_the_default_and_an_explicit_summer_group_are_the_same_read() -> None:
    service = _service(_development())
    default = await service.zip_codes(YEAR)
    explicit = await service.zip_codes(YEAR, "camp_pool")
    assert (default.group, default.group_label) == ("camp_pool", "Camp")
    assert explicit == default
    assert sorted(_zips(default.every_camper)) == [(ZIP_A, 1, 1), (NO_ZIP, 1, 1)]  # Emma and Liam: the summer group


async def test_the_response_lists_the_seasons_groups_from_its_rules_with_all_last() -> None:
    out = await _service(_development()).zip_codes(YEAR, "weekend_pool")
    assert [(g.key, g.label) for g in out.groups] == [
        ("camp_pool", "Camp"),
        ("weekend_pool", "Weekends"),
        ("bmitzvah_pool", "B'mitzvah"),
        ("all", "All groups"),
    ]
    assert (out.group, out.group_label) == ("weekend_pool", "Weekends")


async def test_a_groups_key_and_label_come_from_the_rules() -> None:
    renamed = with_lever(intake_rules(), "budget.pools.weekend_pool.label", "Shoulder season")
    out = await _service(_development(), renamed).zip_codes(YEAR, "weekend_pool")
    assert out.group_label == "Shoulder season"
    assert ("weekend_pool", "Shoulder season") in [(g.key, g.label) for g in out.groups]


async def test_the_weekend_group_counts_its_attendees_and_the_dollars_on_their_households() -> None:
    out = await _service(_development()).zip_codes(YEAR, "weekend_pool")
    assert sorted(_zips(out.every_camper)) == [(ZIP_B, 1, 1), (ZIP_C, 1, 1)]
    assert out.with_aid is not None
    assert [(r.zip, r.dollars) for r in out.with_aid.rows] == [(ZIP_B, 300.0)]  # the outside grant, on the household
    assert out.with_aid.total.families == 1


async def test_the_tbm_group_counts_its_eligible_attendee() -> None:
    out = await _service(_development()).zip_codes(YEAR, "bmitzvah_pool")
    assert _zips(out.every_camper) == [(ZIP_A, 1, 1)]
    assert out.with_aid is not None
    assert out.with_aid.rows == []


async def test_a_group_leaves_out_an_attendee_of_only_a_session_no_open_program_claims() -> None:
    narrowed = with_lever(intake_rules(), "programs.adult_weekend.open_to_aid", False)
    narrowed = with_lever(narrowed, "programs.bmitzvah.open_to_aid", False)
    service = _service(_development(), narrowed)
    weekend = await service.zip_codes(YEAR, "weekend_pool")
    assert sorted(_zips(weekend.every_camper)) == [(ZIP_B, 1, 1)]  # the family camp stays, the adult weekend goes
    bmitzvah = await service.zip_codes(YEAR, "bmitzvah_pool")
    assert bmitzvah.every_camper.rows == []


async def test_all_counts_a_household_in_two_groups_once_and_its_dollars_once() -> None:
    out = await _service(_development()).zip_codes(YEAR, "all")
    assert (out.group, out.group_label) == ("all", "All groups")
    # Emma (summer) and her sibling (B*Mitzvah) share one household: two campers, ONE family, in their ZIP
    assert sorted(_zips(out.every_camper)) == [(ZIP_A, 2, 1), (ZIP_B, 1, 1), (ZIP_C, 1, 1), (NO_ZIP, 1, 1)]
    assert out.every_camper.total.campers == 5
    assert out.every_camper.total.families == 4
    assert out.with_aid is not None
    assert sorted((r.zip, r.dollars) for r in out.with_aid.rows) == [(ZIP_A, 2000.0), (ZIP_B, 300.0)]
    assert out.with_aid.total.dollars == 2300.0


async def test_all_counts_a_camper_in_two_groups_once() -> None:
    development = _development(
        registrations=[went(EMMA, 1000001), went(EMMA, 1000001, BMITZVAH, session_type="bmitzvah")]
    )
    out = await _service(development).zip_codes(YEAR, "all")
    assert _zips(out.every_camper) == [(ZIP_A, 1, 1)]


async def test_an_unknown_group_is_refused() -> None:
    for group in ("summer", "families", "weekend", "ALL", ""):
        with pytest.raises(ReportsRefusedError, match="is not a group"):
            await _service(_development()).zip_codes(YEAR, group)


async def test_zip_group_membership_is_developments_for_every_pool() -> None:
    """The same grouping the Development screen uses: each group's every-camper count is its attendees."""
    development = _development()
    rules = intake_rules()
    found = grouping(rules, SESSIONS)
    attended = attendance(development.registrations, found)
    service = _service(development)
    for pool in found.groups:
        wanted = {a.person_cm_id for a in attended if a.group == pool.key}
        out = await service.zip_codes(YEAR, pool.key)
        assert out.every_camper.total.campers == len(wanted), pool.key


async def test_a_household_level_line_counts_once_in_its_group_and_once_in_all() -> None:
    service = _service(_development(), extra=[_summer_household_line()])
    summer = await service.zip_codes(YEAR)
    assert summer.with_aid is not None
    assert sorted((r.zip, r.dollars) for r in summer.with_aid.rows) == [(ZIP_A, 2000.0), (NO_ZIP, 100.0)]
    everything = await service.zip_codes(YEAR, "all")
    assert everything.with_aid is not None
    assert everything.with_aid.total.dollars == 2400.0  # 2,000 + 300 + 100, each line once


async def test_a_group_does_not_carry_another_groups_dollars() -> None:
    out = await _service(_development()).zip_codes(YEAR, "bmitzvah_pool")
    assert out.with_aid is not None
    assert out.with_aid.total.dollars == 0.0
