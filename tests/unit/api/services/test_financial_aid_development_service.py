"""Reports › Development through the service (Reports back end, Part B; clean spec §9.4; D87, D92, D96, D99, D102),
with real pricing over a fictional season (decisions_fakes): Emma's Round 1 is posted at 1,500; Liam's 1,100 is
decided, not posted. The clock is April 1 2027. Fictional only."""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest

from api.schemas.financial_aid_reports import DatedColumn
from api.services.financial_aid_cancellations import CANCEL_REASONS, CancelEvent
from api.services.financial_aid_development_repository import (
    GrantorRecord,
    OutsideCreditRecord,
    PersonRecord,
    SourceRecord,
)
from api.services.financial_aid_development_service import (
    AVERAGE_AWARD_DEFINITION,
    FIRST_TIME_FAMILY,
    FIRST_TIME_SUMMER,
    FinancialAidDevelopmentService,
    grant_money,
    grouping,
)
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_intake_types import SessionRow
from api.services.financial_aid_reported_recipients_repository import StoredRecipient
from bunking.financial_aid.decisions import DecisionEvent
from bunking.financial_aid.reports.development import NOT_REPORTED
from bunking.financial_aid.reports.history import ReportedFigure
from bunking.financial_aid.reports.recipients import ReportedRecipient
from bunking.financial_aid.rules import AidRules
from tests.unit.api.services.decisions_fakes import FakeDecisionsStore, FakeRules, approved, grant_row, seed_line
from tests.unit.api.services.development_fakes import FakeDevelopmentStore, went
from tests.unit.api.services.financial_aid_fakes import SESSIONS, YEAR, intake_rules
from tests.unit.api.services.reports_fakes import FakeReportsStore, report_season
from tests.unit.bunking.financial_aid.fixtures import with_lever

pytestmark = pytest.mark.asyncio

NOW = datetime(2027, 4, 1, 17, 0, tzinfo=UTC)
EMMA, LIAM = 1000011, 1000021
REGIONAL = SourceRecord("src000000000001", "regional grant", "Regional Camp Fund", "outside", False, ("summer",))


def _development(**change: Any) -> FakeDevelopmentStore:
    store = FakeDevelopmentStore(
        registrations=[went(EMMA, 1000001), went(LIAM, 1000002)],
        people=[
            PersonRecord(EMMA, 1000001, date(2015, 1, 1), "Girl/woman", ""),
            PersonRecord(LIAM, 1000002, date(2012, 1, 1), "", "their own words"),
        ],
        source_rows=[REGIONAL],
    )
    for key, value in change.items():
        setattr(store, key, value)
    return store


def _service(
    development: FakeDevelopmentStore,
    history: FakeReportsStore | None = None,
    register: Sequence[RegisterRow] = (),
    store: FakeDecisionsStore | None = None,
    past_register: Sequence[RegisterRow] = (),
    rules: AidRules | None = None,
    fake_rules: FakeRules | None = None,
) -> FinancialAidDevelopmentService:
    async def rows(year: int) -> Sequence[RegisterRow]:
        return list(register) if year == YEAR else list(past_register)

    return FinancialAidDevelopmentService(
        store or report_season(),
        fake_rules or FakeRules(approved(rules or intake_rules())),
        rows,
        development,
        history or FakeReportsStore(),
        clock=lambda: NOW,
    )


def _row(out: Any, key: str, group: str | None) -> Any:
    return next(r for r in out.rows if r.key == key and r.group == group)


def _asks_within_cost() -> FakeDecisionsStore:
    """report_season with Emma's ask at her session's 2,000 cost: no ask is impossible (owner 10-03)."""
    store = report_season()
    store.requests["reqemma00000001"] = replace(store.requests["reqemma00000001"], ask=2000.0)
    return store


async def test_the_season_column_is_all_money_on_campers_who_attended() -> None:
    """D87: the camp's awarded money plus every live outside grant; Liam's decided 1,100 is not money given out."""
    out = await _service(
        _development(), register=[grant_row("reqemma00000001", "500")], store=_asks_within_cost()
    ).development(YEAR)
    assert [(c.season, c.basis, c.basis_unconfirmed) for c in out.columns] == [(2027, "P", False)]
    assert [(g.key, g.kind) for g in out.groups] == [
        ("camp_pool", "summer"),
        ("weekend_pool", "families"),
        ("bmitzvah_pool", "campers"),
    ]
    assert _row(out, "total_awards", "camp_pool").values == [2000.0]
    assert _row(out, "awards", "camp_pool").values == [1.0]  # item 32: Emma's aid and her grant are one award
    assert _row(out, "recipients", None).values == [1.0]
    assert _row(out, "total_requests", "camp_pool").values == [4000.0]  # both attended, both asked
    assert [(s.name, s.who_paid, s.amount, s.awards) for s in out.sources] == [
        ("The camp's awards", "the camp", 1500.0, 1),
        ("Regional Camp Fund", "another funder", 500.0, 1),
    ]


async def test_a_camper_who_did_not_attend_drops_out_with_their_money() -> None:
    """D92: "If they unenroll, they should be removed because they're no longer asking for aid"."""
    out = await _service(_development(registrations=[went(LIAM, 1000002)])).development(YEAR)
    assert _row(out, "total_awards", "camp_pool").values == [0.0]
    assert _row(out, "recipients", "camp_pool").values == [0.0]


@pytest.mark.parametrize("status", [32, 256])
async def test_a_cancelled_or_withdrawn_registration_does_not_attend(status: int) -> None:
    """D92: only status 2 attends; Emma's cancelled (32) or withdrawn (256) row keeps her and her money out."""
    development = _development(registrations=[went(EMMA, 1000001, status=status), went(LIAM, 1000002)])
    out = await _service(development).development(YEAR)
    assert _row(out, "total_awards", "camp_pool").values == [0.0]
    assert _row(out, "recipients", "camp_pool").values == [0.0]


async def test_outside_money_leaves_out_reversed_lines_and_unposted_commitments() -> None:
    """D29 (ruled as built, R2b): a reversed line isn't money given out, and a commitment not yet posted isn't."""
    live = grant_row("reqemma00000001", "500")
    reversed_line = replace(grant_row("reqemma00000001", "7000"), is_reversed=True, reversal_date="2027-03-01")
    commitment = replace(grant_row("reqemma00000001", "9000"), kind="commitment", commitment_id="com000000000001")
    out = await _service(_development(), register=[live, reversed_line, commitment]).development(YEAR)
    assert _row(out, "total_awards", "camp_pool").values == [2000.0]  # 1,500 + 500, none of the 7,000 or 9,000
    assert _row(out, "outside_awards", "camp_pool").values == [500.0]
    assert _row(out, "awards", "camp_pool").values == [1.0]  # item 32: one camper-session


async def test_the_every_group_average_award_includes_money_in_no_group() -> None:
    """D158: every-group average = (all money, the money no group holds too) / all awards."""
    line = replace(
        grant_row("reqemma00000001", "300", on_request=False),
        person_cm_id=0,
        session_cm_id=0,
        program_family="other",
        camper_basis="none",
        counts=False,
    )
    out = await _service(_development(), register=[line]).development(YEAR)
    assert _row(out, "average_award", None).values == [900.0]  # (1,500 + 300) / 2 awards
    assert _row(out, "average_award", "camp_pool").values == [1500.0]  # the group's own, without the 300


async def test_first_time_counts_only_earlier_summer_sessions() -> None:
    """D99's default: no Summer Camp or Quest session in any earlier season; an earlier weekend doesn't count."""
    development = _development(earlier=[went(EMMA, 1000001, year=2025, start=date(2025, 6, 20), session_type="family")])
    out = await _service(development).development(YEAR)
    assert _row(out, "first_time", "camp_pool").values == [1.0]
    assert _row(out, "returning", "camp_pool").values == [0.0]


def _backfilled_2025() -> FakeReportsStore:
    history = FakeReportsStore()
    history.seed(
        ReportedFigure(
            2025, "development", "total_awards", "camp_pool", 0, 0, "season_end", date(2025, 9, 29), Decimal(900)
        )
    )
    return history


def _stayed_2025() -> FakeDevelopmentStore:
    return _development(
        registrations=[
            went(EMMA, 1000001),
            went(LIAM, 1000002),
            went(EMMA, 1000001, year=2025, start=date(2025, 6, 20)),
            went(LIAM, 1000002, year=2025, start=date(2025, 6, 20)),
        ]
    )


# --- a past season's age lines come from that season's Campership sheet (owner ruling 2026-10-16, CS-AGES25) -------

OLIVIA = 1000012  # Emma's sister, in Emma's household


def _on_sheet(person: int, household: int, *, source: str = "camp", year: int = 2025) -> StoredRecipient:
    return StoredRecipient(
        f"rrc{person:012d}"[:15],
        ReportedRecipient(
            year=year,
            person_cm_id=person,
            household_cm_id=household,
            program="summer",
            source=source,  # type: ignore[arg-type]
            funder="Regional Camp Fund" if source == "outside" else "",
            amount=Decimal(1200),
            sheet_tab="Grants" if source == "outside" else "Aid calculator",
            sheet_row=7,
            match="personal_id",
        ),
    )


def _sisters_2025(*listed: StoredRecipient) -> FakeDevelopmentStore:
    development = _stayed_2025()
    development.registrations.append(went(OLIVIA, 1000001, year=2025, start=date(2025, 6, 20)))
    development.people.append(PersonRecord(OLIVIA, 1000001, date(2016, 3, 1), "", ""))
    development.recipient_rows = list(listed)
    return development


async def test_a_loaded_sheet_gives_exactly_its_summer_recipients_by_age_an_outside_only_camper_included() -> None:
    """Emma (10) has the camp's award; Liam (13) only an outside grant, and still counts (the ruling: "don't forget
    to include families who only got external aid"). Nothing names the season as waiting."""
    development = _sisters_2025(_on_sheet(EMMA, 1000001), _on_sheet(LIAM, 1000002, source="outside"))
    out = await _service(development, _backfilled_2025()).development(YEAR)
    assert _row(out, "youth", "camp_pool").values[0] == 1.0
    assert _row(out, "teens", "camp_pool").values[0] == 1.0
    assert _row(out, "adults", "camp_pool").values[0] == 0.0
    assert {n.figure for n in out.not_built} & {"ages_need_sheet", "ages_before_backfill"} == set()


async def test_a_sibling_the_sheet_does_not_list_is_not_counted() -> None:
    """Olivia attended 2025 in Emma's household, and only Emma is on the sheet: one youth, never the household's
    every summer camper (the ruling: "it overcounts summer")."""
    out = await _service(_sisters_2025(_on_sheet(EMMA, 1000001)), _backfilled_2025()).development(YEAR)
    assert _row(out, "youth", "camp_pool").values[0] == 1.0
    assert _row(out, "teens", "camp_pool").values[0] == 0.0


async def test_a_listed_recipient_with_no_enrolled_summer_stay_is_not_counted() -> None:
    """Liam is on 2025's sheet, but his 2025 registration was cancelled: he isn't a summer camper that season."""
    development = _sisters_2025(_on_sheet(EMMA, 1000001), _on_sheet(LIAM, 1000002))
    development.registrations = [
        r if not (r.person_cm_id == LIAM and r.year == 2025) else replace(r, status_id=32)
        for r in development.registrations
    ]
    out = await _service(development, _backfilled_2025()).development(YEAR)
    assert _row(out, "teens", "camp_pool").values[0] == 0.0
    assert _row(out, "youth", "camp_pool").values[0] == 1.0


async def test_with_no_sheet_the_age_lines_are_blank_whatever_the_ledger_holds() -> None:
    """The household fan-out (owner item 50) and the sole-camper tie (D142) are gone from the age lines: a 2025
    camp line on Liam and an outside grant on Emma count nothing until 2025's sheet is loaded, and the season is
    named once, by the sheet, never by the backfill."""
    store = report_season()
    seed_line(store, 7001, "800", household=1000002, person=LIAM)  # a live camp line on Liam
    seed_line(store, 7002, "600", household=1000001, person=0)  # a household-level line on Emma's household
    line = grant_row("reqemma00000001", "300")
    out = await _service(_stayed_2025(), _backfilled_2025(), store=store, past_register=[line]).development(YEAR)
    for key in ("teens", "youth", "adults", "age_unknown"):
        assert _row(out, key, "camp_pool").values[0] is None, key
    figures = [n.figure for n in out.not_built]
    assert "ages_before_backfill" not in figures
    assert figures.count("ages_need_sheet") == 1
    gap = next(n for n in out.not_built if n.figure == "ages_need_sheet")
    assert "2025" in gap.reason
    assert "Campership sheet is loaded" in gap.reason


async def test_the_waiting_seasons_are_named_in_one_reason_and_a_loaded_one_is_not() -> None:
    history = FakeReportsStore()
    for season in (2023, 2024, 2025):
        history.seed(
            ReportedFigure(
                season, "development", "total_awards", "camp_pool", 0, 0, "season_end", date(season, 9, 29), Decimal(9)
            )
        )
    out = await _service(_sisters_2025(_on_sheet(EMMA, 1000001)), history).development(YEAR)
    assert _row(out, "youth", "camp_pool").values[:3] == [None, None, 1.0]
    gap = next(n for n in out.not_built if n.figure == "ages_need_sheet")
    assert "2023, 2024" in gap.reason
    assert "2025" not in gap.reason
    assert "sheets are loaded" in gap.reason  # two seasons: their sheets


SAMUEL, SAM_HOME = 1000022, 1000003  # Samuel and his brother Riley share household 1000003; Liam's is 1000002
RILEY = 1000023
SUMMER_GRANT = SourceRecord(
    "src000000000011", "valley youth summer", "Valley Youth Fund", "outside", False, ("summer",)
)


def _credit(household: int, *, person: int = 0, attributed: int = 0, level: str = "none") -> OutsideCreditRecord:
    return OutsideCreditRecord(household, person, attributed, level, SUMMER_GRANT.description_key, "")


def _outside_only_2025(*credits: OutsideCreditRecord) -> FakeDevelopmentStore:
    """2025's sheet lists Emma only. Liam's household has one 2025 summer camper; Samuel's has two (Samuel and
    Riley). Neither household is on the sheet; their only aid is the outside credits given."""
    development = _sisters_2025(_on_sheet(EMMA, 1000001))
    for person, home, born in ((SAMUEL, SAM_HOME, date(2012, 2, 1)), (RILEY, SAM_HOME, date(2009, 2, 1))):
        development.registrations.append(went(person, home, year=2025, start=date(2025, 6, 20)))
        development.people.append(PersonRecord(person, home, born, "", ""))
    development.source_rows = [REGIONAL, SUMMER_GRANT]
    development.credit_rows = {2025: list(credits)}
    return development


async def test_an_outside_only_single_camper_household_counts_in_the_age_lines() -> None:
    """#55 (owner 2026-10-16, "a"): Liam's household is on no sheet row, a summer-source outside grant sits on the
    household, and Liam is its one enrolled summer camper: certain, so he counts (teen)."""
    out = await _service(_outside_only_2025(_credit(1000002)), _backfilled_2025()).development(YEAR)
    assert _row(out, "youth", "camp_pool").values[0] == 1.0  # Emma, from the sheet
    assert _row(out, "teens", "camp_pool").values[0] == 1.0  # Liam


async def test_an_outside_only_two_camper_household_is_not_counted_in_the_age_lines() -> None:
    """#55: Samuel and Riley's household grant can't say whose it is, so neither is counted: never fanned out."""
    out = await _service(_outside_only_2025(_credit(SAM_HOME)), _backfilled_2025()).development(YEAR)
    assert _row(out, "teens", "camp_pool").values[0] == 0.0
    assert _row(out, "adults", "camp_pool").values[0] == 0.0


async def test_an_ambiguous_outside_line_is_not_counted_and_a_person_level_one_is() -> None:
    """#55: the sync's guess at an "ambiguous" level isn't certain; its "person" level placement is."""
    ambiguous = await _service(
        _outside_only_2025(_credit(SAM_HOME, attributed=SAMUEL, level="ambiguous")), _backfilled_2025()
    ).development(YEAR)
    assert _row(ambiguous, "teens", "camp_pool").values[0] == 0.0
    placed = await _service(
        _outside_only_2025(_credit(SAM_HOME, attributed=SAMUEL, level="person")), _backfilled_2025()
    ).development(YEAR)
    assert _row(placed, "teens", "camp_pool").values[0] == 1.0  # Samuel, 13; never Riley


async def test_the_families_cell_of_an_as_reported_column_stays_the_typed_figure() -> None:
    """#55's Families clause is how the dashboard counts families where it computes them; an as-reported column's
    Families cell stays what development typed, sheet loaded or not."""
    history = _backfilled_2025()
    history.seed(
        ReportedFigure(
            2025, "development", "families", "camp_pool", 0, 0, "season_end", date(2025, 9, 29), Decimal(450)
        )
    )
    out = await _service(_outside_only_2025(_credit(1000002), _credit(SAM_HOME)), history).development(YEAR)
    assert _row(out, "families", "camp_pool").values[0] == 450.0


async def test_the_age_lines_never_build_a_past_seasons_grants_register() -> None:
    """A register is a full-season load; the age lines read only the sheet's rows and the season's stays now."""
    reads: list[int] = []

    async def rows(year: int) -> Sequence[RegisterRow]:
        reads.append(year)
        return []

    service = FinancialAidDevelopmentService(
        report_season(),
        FakeRules(approved(intake_rules())),
        rows,
        _sisters_2025(_on_sheet(EMMA, 1000001)),
        _backfilled_2025(),
        clock=lambda: NOW,
    )
    out = await service.development(YEAR)
    assert _row(out, "youth", "camp_pool").values[0] == 1.0
    assert 2025 not in reads


async def test_first_time_states_its_definition_and_reads_earlier_seasons_for_recipients() -> None:
    development = _development(earlier=[went(EMMA, 1000001, year=2025, start=date(2025, 6, 20))])
    out = await _service(development).development(YEAR)
    row = _row(out, "first_time", "camp_pool")
    assert (row.values, row.definition) == ([0.0], FIRST_TIME_SUMMER)
    assert _row(out, "returning", "camp_pool").values == [1.0]
    assert EMMA in development.earlier_reads[0][0]


async def test_typed_history_fills_earlier_columns_and_flags_the_contested_basis() -> None:
    """§9.4: 2022–2025 as reported (r); O-930-1: a 2025 column carries basis_unconfirmed; D102: 2026 as reported."""
    history = FakeReportsStore()
    for year, metric, pool, value in (
        (2025, "total_awards", "camp_pool", "800000"),
        (2025, "awards", "camp_pool", "400"),
        (2026, "total_awards", "camp_pool", "900000"),
    ):
        history.seed(
            ReportedFigure(year, "development", metric, pool, 0, 0, "season_end", date(year, 9, 29), Decimal(value))
        )
    out = await _service(_development(), history).development(YEAR)
    assert [(c.season, c.basis, c.basis_unconfirmed) for c in out.columns] == [
        (2025, "r", True),
        (2026, "r", False),
        (2027, "P", False),
    ]
    assert _row(out, "total_awards", "camp_pool").values == [800000.0, 900000.0, 1500.0]
    assert _row(out, "average_award", "camp_pool").values[0] == 2000.0  # Kindred computes it from the typed pair
    assert _row(out, "camp_awards", "camp_pool").values[:2] == [None, None]  # never typed


async def test_finance_typed_history_never_reaches_development() -> None:
    history = FakeReportsStore()
    history.seed(ReportedFigure(2025, "finance", "awarded", "", 0, 0, "season_end", date(2025, 10, 10), Decimal(1)))
    out = await _service(_development(), history).development(YEAR)
    assert [c.season for c in out.columns] == [2027]


async def test_ages_are_on_the_first_session_and_gender_reads_the_write_in() -> None:
    """D103: age on the first day of the camper's first session in the group; D94: a write-in is self-described."""
    store = report_season()
    store.events.append(
        DecisionEvent(
            id="ev0000000000009",
            request_id="reqliam00000001",
            round=1,
            kind="post",
            created=datetime(2027, 3, 9, 18, 0, tzinfo=UTC),
            amount=Decimal(1100),
            effective_on=date(2027, 3, 9),
            lock_source="tick",
            rules_version=1,
            snapshot={"pool": "camp_pool", "counts_toward_budget": True, "result": {"final_tier": 3}},
        )
    )
    out = await _service(_development(), store=store).development(YEAR)
    assert _row(out, "teens", "camp_pool").values == [1.0]  # Liam is 15 on June 20 2027
    assert _row(out, "youth", "camp_pool").values == [1.0]  # Emma is 12
    genders = {r.label: r.values for r in out.rows if r.key == "gender_recipients"}
    assert genders == {
        "Gender, campers who got money: Girl/woman": [1.0],
        "Gender, campers who got money: self-described": [1.0],
    }


async def test_groups_come_from_the_rules_pools_by_their_sessions_types() -> None:
    """D100: development's groups are the season's budget pools."""
    found = grouping(intake_rules(), SESSIONS)
    assert {g.key: g.kind for g in found.groups} == {
        "camp_pool": "summer",
        "weekend_pool": "families",
        "bmitzvah_pool": "campers",
    }
    assert found.by_session[1000101] == "camp_pool"
    assert found.by_family["family_camp"] == "weekend_pool"


async def test_a_never_applied_households_unplaced_grant_is_development_money_all_the_same() -> None:
    """Known limit, ruled: the register doesn't count a household-level line no one could place (D142), so pricing
    never sees it; development sums it itself, in the money and the families, and shows it as household-level."""
    line = replace(
        grant_row("reqemma00000001", "300", on_request=False),
        person_cm_id=0,
        camper_basis="none",
        counts=False,
    )
    out = await _service(_development(), register=[line]).development(YEAR)
    assert _row(out, "total_awards", "camp_pool").values == [1800.0]
    assert _row(out, "household_level_amount", "camp_pool").values == [300.0]
    assert _row(out, "household_level_lines", "camp_pool").values == [1.0]
    assert _row(out, "recipients", "camp_pool").values == [1.0]  # never a camper


async def test_only_sessions_of_an_aid_eligible_program_are_in_a_group() -> None:
    """Owner rule (item 28): development counts only attendees of aid-eligible sessions. A session no program claims,
    a session of a program closed to aid and an "other" session are in no group; an open one is."""
    sessions = [*SESSIONS, SessionRow(1000302, "Hebrew", "hebrew"), SessionRow(1000999, "Other", "other")]
    found = grouping(intake_rules(), sessions)
    assert found.by_session[1000301] == "bmitzvah_pool"  # claimed by an open program
    assert 1000302 not in found.by_session  # B'mitzvah's family, but no program claims it: it was joined before
    assert 1000999 not in found.by_session  # "other": no longer even attended-but-unreported
    closed = grouping(with_lever(intake_rules(), "programs.bmitzvah.open_to_aid", False), sessions)
    assert 1000301 not in closed.by_session  # claimed, but the program is closed to aid
    assert "bmitzvah" not in closed.by_family
    assert found.by_family["bmitzvah"] == "bmitzvah_pool"


async def test_an_adult_reg_session_is_grouped_with_its_family_weekend() -> None:
    """kindred#3213: an Adult Reg (family_adult) session's aid is Family Camp aid. It joins its weekend's pool, and
    that pool still reads as a families group."""
    sessions = [*SESSIONS, SessionRow(1000203, "Adult Reg: Family Camp 3", "family_adult", parent_cm_id=1000201)]
    found = grouping(intake_rules(), sessions)
    assert found.by_session[1000203] == found.by_session[1000201]
    assert {g.key: g.kind for g in found.groups}[found.by_session[1000201]] == "families"


async def test_an_unclaimed_ag_session_is_grouped_with_its_parents_program() -> None:
    """Spec §8: an AG session no program claims takes its parent session's program, so its attendees count under
    that program's group; a session that is not an AG session and is claimed by nothing still counts nowhere."""
    rules = with_lever(intake_rules(), "programs.summer.session_types", ["main", "embedded"])
    sessions = [
        *SESSIONS,
        SessionRow(1000109, "AG Session 3", "ag", parent_cm_id=1000101),
        SessionRow(1000110, "Counselor Session 3", "scit", parent_cm_id=1000101),
    ]
    found = grouping(rules, sessions)
    assert found.by_session[1000109] == found.by_session[1000101] == "camp_pool"
    assert 1000110 not in found.by_session
    assert 1000109 not in grouping(rules, SESSIONS).by_session


async def test_family_school_is_not_a_camper_program_even_where_a_program_claims_it() -> None:
    """Queue "Known limits": B*Mitzvah counts as a camper program; Family School doesn't (D107: sunsetted)."""
    found = grouping(intake_rules(), [*SESSIONS, SessionRow(1000501, "Family School", "school")])
    assert found.by_session[1000501] == NOT_REPORTED  # the rules' family_school program claims it
    assert "family_school" not in found.by_family


async def test_a_grant_no_group_holds_is_in_the_total_and_its_own_row() -> None:
    """D100's "needs a group": all money (D87), never dropped; shown as money in no group."""
    line = replace(
        grant_row("reqemma00000001", "300", on_request=False),
        person_cm_id=0,
        session_cm_id=0,
        program_family="other",
        camper_basis="none",
        counts=False,
    )
    out = await _service(_development(), register=[line]).development(YEAR)
    assert _row(out, "not_in_group_amount", None).values == [300.0]
    assert _row(out, "total_awards", None).values == [1800.0]
    assert _row(out, "total_awards", "camp_pool").values == [1500.0]


async def test_typed_summer_lines_reach_their_rows() -> None:
    """Plan review I3: a typed % of need met, teens and TLI + SCIT are typed with the summer group's pool."""
    history = FakeReportsStore()
    for metric, value in (("need_met", "70.0"), ("teen_programs", "3")):
        history.seed(
            ReportedFigure(
                2025, "development", metric, "camp_pool", 0, 0, "season_end", date(2025, 9, 29), Decimal(value)
            )
        )
    out = await _service(_development(), history).development(YEAR)
    assert _row(out, "need_met", "camp_pool").values[0] == 70.0
    assert _row(out, "teens", "camp_pool").values[0] is None  # no 2025 ledger lines in this fake: blank, never typed
    assert _row(out, "teen_programs", "camp_pool").values[0] == 3.0
    # approved final mock: the program line reads "Teen leadership (program line)"
    assert _row(out, "teen_programs", "camp_pool").label == "Teen leadership (program line)"


async def test_development_lists_every_cancel_reason_with_its_label() -> None:
    """D158: one line per reason, each a count of cancelled aid requests; "aid not enough" stays its own line."""
    store = report_season()
    store.cancel_events.append(
        CancelEvent(
            "can000000000001",
            "reqliam00000001",
            "cancel",
            NOW - timedelta(days=1),
            reason="schedule",
            in_kindred=True,
            actor="registrar@example.com",
        )
    )
    out = await _service(_development(), store=store).development(YEAR)
    row = _row(out, "cancelled_schedule", None)
    assert (row.label, row.section, row.values) == ("Cancelled: schedule", "appeals", [1.0])
    assert _row(out, "cancelled_not_recorded", "camp_pool").values == [0.0]
    assert _row(out, "declined_insufficient", "camp_pool").values == [0.0]
    every = {r.key for r in out.rows if r.group is None and r.key.startswith("cancelled_")}
    assert every == {f"cancelled_{c}" for c in CANCEL_REASONS if c != "aid_not_enough"} | {"cancelled_not_recorded"}


async def test_the_average_award_is_all_money_over_the_number_of_awards_and_says_so() -> None:
    """D158: (the camp's aid + outside grants) / Number of awards, per group and for every group."""
    out = await _service(_development(), register=[grant_row("reqemma00000001", "500")]).development(YEAR)
    row = _row(out, "average_award", "camp_pool")
    assert row.values == [2000.0]  # (1,500 + 500) / 1 award: item 32, one camper-session
    assert row.definition == AVERAGE_AWARD_DEFINITION
    assert _row(out, "average_award", None).values == [2000.0]


async def test_every_average_award_rounds_a_half_cent_up_as_the_group_rows_do() -> None:
    """§9.7's rule (facts.average, ROUND_HALF_UP) on every average row: the every-group total and a typed column's,
    not only a group's. 1,500.01 / 2 awards and 1,000.01 / 2 land on a half cent."""
    line = replace(
        grant_row("reqemma00000001", "0.01", on_request=False),
        person_cm_id=0,
        session_cm_id=0,
        program_family="other",
        camper_basis="none",
        counts=False,
    )
    history = FakeReportsStore()
    for metric, value in (("total_awards", "1000.01"), ("awards", "2")):
        history.seed(
            ReportedFigure(
                2025, "development", metric, "camp_pool", 0, 0, "season_end", date(2025, 9, 29), Decimal(value)
            )
        )
    out = await _service(_development(), history, register=[line]).development(YEAR)
    assert _row(out, "average_award", None).values[-1] == 750.01  # (1,500 + 0.01) / 2, the P column
    assert _row(out, "average_award", "camp_pool").values[0] == 500.01  # the typed 2025 pair


async def test_a_family_groups_first_time_label_says_any_earlier_family_or_adult_session_counts() -> None:
    """The label matches the code: an earlier weekend of either kind (family or adult) makes a household returning,
    not only an earlier season in the same group's programs."""
    assert "first weekend program" in FIRST_TIME_FAMILY
    assert "Family or Adult" in FIRST_TIME_FAMILY
    assert "first season in this group" not in FIRST_TIME_FAMILY
    out = await _service(_development()).development(YEAR)
    assert _row(out, "first_time", "weekend_pool").definition == FIRST_TIME_FAMILY


BMITZVAH_KID, BMITZVAH_HOME = 1000031, 1000003


def _bmitzvah_grant(session: int) -> RegisterRow:
    return replace(
        grant_row("reqemma00000001", "400", on_request=False),
        household_cm_id=BMITZVAH_HOME,
        person_cm_id=BMITZVAH_KID,
        session_cm_id=session,
        program_family="bmitzvah",
    )


async def _bmitzvah_read(session: int, rules: AidRules | None = None) -> Any:
    store = report_season()
    store.sessions.append(SessionRow(1000302, "B'mitzvah Year 2", "hebrew", "2027-01-17"))
    development = _development(
        registrations=[went(EMMA, 1000001), went(BMITZVAH_KID, BMITZVAH_HOME, session, session_type="bmitzvah")]
    )
    return await _service(development, register=[_bmitzvah_grant(session)], store=store, rules=rules).development(YEAR)


async def test_an_attendee_of_an_open_program_session_counts() -> None:
    out = await _bmitzvah_read(1000301)
    assert _row(out, "recipients", "bmitzvah_pool").values == [1.0]
    assert _row(out, "total_awards", "bmitzvah_pool").values == [400.0]
    assert _row(out, "families", None).values == [2.0]  # Emma's household and this one


async def test_an_attendee_of_an_unclaimed_session_counts_nowhere() -> None:
    """Owner rule (item 28): attended only a session no program claims, so no group, no family, no money line."""
    out = await _bmitzvah_read(1000302)
    assert _row(out, "recipients", "bmitzvah_pool").values == [0.0]
    assert _row(out, "total_awards", "bmitzvah_pool").values == [0.0]
    assert _row(out, "total_awards", None).values == [1500.0]  # Emma's only
    assert _row(out, "families", None).values == [1.0]


async def test_an_attendee_of_a_closed_to_aid_programs_session_counts_nowhere() -> None:
    closed = with_lever(intake_rules(), "programs.bmitzvah.open_to_aid", False)
    out = await _bmitzvah_read(1000301, closed)
    assert _row(out, "recipients", "bmitzvah_pool").values == [0.0]
    assert _row(out, "total_awards", None).values == [1500.0]
    assert _row(out, "families", None).values == [1.0]


async def test_number_of_awards_says_what_an_award_is_and_the_average_divides_by_it() -> None:
    """Owner rule (item 32): an award is a distinct attendee/session combo with any aid, the camp's or an outside
    funder's, never one per line."""
    out = await _service(_development(), register=[grant_row("reqemma00000001", "500")]).development(YEAR)
    awards = _row(out, "awards", "camp_pool").definition
    assert "distinct" in awards
    assert "session" in awards
    assert "counts as one" not in awards
    average = _row(out, "average_award", "camp_pool").definition
    assert "Grants/Awards" in average  # owner ruling L (10-08): the row's new name
    assert "counts as one" not in average


async def test_a_grant_line_carries_its_session_into_the_awards_count() -> None:
    line = replace(grant_row("reqemma00000001", "500"), session_cm_id=1000102)
    found = grant_money([line], grouping(intake_rules(), SESSIONS))
    assert [g.session_cm_id for g in found] == [1000102]


REGIONAL_SPRING = SourceRecord(
    "src000000000011", "regional grant 2", "Regional Camp Fund (spring)", "outside", False, ("summer",), "regional_fund"
)
UNCLASSIFIED = SourceRecord("src000000000012", "mystery fund", "Mystery Fund", "unknown", False, ())
REGIONAL_FUND = GrantorRecord("regional_fund", "Regional Camp Fund", retired=False)


def _by_funder(*extra: SourceRecord) -> FakeDevelopmentStore:
    return _development(
        source_rows=[replace(REGIONAL, grantor_key="regional_fund"), REGIONAL_SPRING, *extra],
        grantor_rows=[REGIONAL_FUND],
    )


def _line(key: str, amount: str) -> RegisterRow:
    return replace(grant_row("reqemma00000001", amount), source_key=key)


async def test_money_by_source_groups_descriptions_of_one_funder_into_one_line_with_the_summed_amount() -> None:
    """Owner item 52 (C7): the same grouping Funding sources uses; two descriptions of one funder are one line."""
    out = await _service(
        _by_funder(), register=[_line("regional grant", "500"), _line("regional grant 2", "250")]
    ).development(YEAR)
    assert [(s.name, s.who_paid, s.amount, s.group, s.awards) for s in out.sources] == [
        ("The camp's awards", "the camp", 1500.0, "camp_pool", 1),
        ("Regional Camp Fund", "another funder", 750.0, "camp_pool", 2),  # a line count per source (item 32)
    ]


async def test_one_funders_money_in_two_groups_is_one_line_per_group() -> None:
    """The grouping folds descriptions, never groups: a funder paying a summer line and a Family Camp line shows both."""
    weekend = replace(_line("regional grant 2", "250"), session_cm_id=1000201, program_family="family_camp")
    store = _by_funder()
    store.registrations.append(went(0, 1000001, 1000201, session_type="family"))
    out = await _service(store, register=[_line("regional grant", "500"), weekend]).development(YEAR)
    assert [(s.name, s.group, s.amount) for s in out.sources[1:]] == [
        ("Regional Camp Fund", "camp_pool", 500.0),
        ("Regional Camp Fund", "weekend_pool", 250.0),
    ]


async def test_an_unclassified_source_keeps_its_own_line_and_is_never_folded_into_a_funder() -> None:
    """N3: unclassified sources are shown, not hidden, and a funder's line does not swallow them."""
    out = await _service(
        _by_funder(UNCLASSIFIED),
        register=[_line("regional grant", "500"), _line("mystery fund", "100")],
    ).development(YEAR)
    assert [(s.name, s.amount) for s in out.sources] == [
        ("The camp's awards", 1500.0),
        ("Mystery Fund", 100.0),
        ("Regional Camp Fund", 500.0),
    ]


async def test_an_unclassified_source_is_not_folded_even_if_it_still_names_a_funder() -> None:
    """N3: only an outside description joins a funder's line, whatever its stored grantor says."""
    stray = replace(UNCLASSIFIED, grantor_key="regional_fund")
    out = await _service(
        _by_funder(stray), register=[_line("regional grant", "500"), _line("mystery fund", "100")]
    ).development(YEAR)
    assert [(s.name, s.amount) for s in out.sources[1:]] == [("Mystery Fund", 100.0), ("Regional Camp Fund", 500.0)]


async def test_a_funders_incentive_and_need_based_money_stay_on_separate_lines() -> None:
    """D88's three facts survive the grouping: incentive money is not folded into need-based money."""
    store = _by_funder()
    store.source_rows[1] = replace(REGIONAL_SPRING, incentive=True)
    out = await _service(
        store, register=[_line("regional grant", "500"), _line("regional grant 2", "250")]
    ).development(YEAR)
    assert [(s.name, s.incentive, s.amount) for s in out.sources[1:]] == [
        ("Regional Camp Fund", False, 500.0),
        ("Regional Camp Fund", True, 250.0),
    ]


async def test_a_request_above_its_sessions_cost_counts_at_the_cost_and_the_column_counts_it() -> None:
    """Rule M (owner 10-08, per request): a request whose asks add up to more than its session's cost (as priced, a
    staff cost override included) counts AT the cost in Total Requests and % of need met, and the column counts it for the
    footnote ("N requests above their session's cost counted at the cost"). Emma asks 4,000 for Session 2, which costs
    2,000 (fixtures.fictional_rules), so she counts 2,000; Liam's 2,000 stays: 4,000."""
    out = await _service(_development()).development(YEAR)
    assert _row(out, "total_requests", "camp_pool").values == [4000.0]
    assert [(c.season, c.basis, c.requests_capped) for c in out.columns] == [(2027, "P", 1)]


async def test_a_season_with_no_ask_above_its_cost_caps_none() -> None:
    out = await _service(_development(), store=_asks_within_cost()).development(YEAR)
    assert _row(out, "total_requests", "camp_pool").values == [4000.0]
    assert [c.requests_capped for c in out.columns] == [0]


async def test_an_ask_above_its_sessions_cost_is_capped_though_the_familys_income_is_missing() -> None:
    """The session's cost doesn't depend on the family's income: a request the calculator stops on (no income figure
    reported) still has its session's price, so its 4,000 ask on a 2,000 session counts at 2,000 too (Rule M)."""
    store = report_season()
    store.applications = [replace(a, answers={}) if a.household_cm_id == 1000001 else a for a in store.applications]
    out = await _service(_development(), store=store).development(YEAR)
    assert _row(out, "total_requests", "camp_pool").values == [4000.0]
    assert [c.requests_capped for c in out.columns] == [1]


# --- owner 10-08: the Budget row (development-v2) and ruling L's "Grants/Awards" ---------------------------------

BUDGET_LABEL = "Budget (this camp's, the first board-passed)"


def _budget_rows(out: Any) -> list[Any]:
    return [r for r in out.rows if r.key == "budget"]


async def test_the_budget_row_is_one_total_line_from_the_rules_on_a_kindred_column() -> None:
    """The mock's Budget row, total only (owner 10-08): one line, this camp's own aid budget (D96), never the
    all-money total and never split by group. A P column reads the season's approved rules: 500,000."""
    out = await _service(_development()).development(YEAR)
    [budget] = _budget_rows(out)
    assert (budget.group, budget.label, budget.section, budget.unit) == (None, BUDGET_LABEL, "money", "dollars")
    assert budget.values == [500000.0]
    assert out.rows[0].key == "budget"  # the first money line, as the mock draws it


async def test_the_budget_row_reads_the_seasons_first_approved_budget() -> None:
    """Owner 10-08 (D96, "the first (board-passed) budget"): a P column shows the total of the season's FIRST
    approved budget, which doesn't move when a later version with another budget is approved and prices the season.
    A dated column shows the same figure: it is the board-passed budget, not the budget as of the day."""
    fake = FakeRules(approved(with_lever(intake_rules(), "budget.total", "600000"), version=2))
    fake.first = approved(with_lever(intake_rules(), "budget.total", "450000"), version=1)
    out = await _service(_development(), fake_rules=fake).development(
        YEAR, column=DatedColumn(season=YEAR, as_of=date(2027, 3, 5))
    )
    assert [(c.basis, c.as_of) for c in out.columns] == [("P", date(2027, 4, 1)), ("P", date(2027, 3, 5))]
    assert [(r.group, r.values) for r in _budget_rows(out)] == [(None, [450000.0, 450000.0])]


def _budget_approved_on(version: Any, at: datetime) -> Any:
    """`version` with its budget section approved at `at` (the board's first pass)."""
    status = dict(version.section_status)
    status["budget"] = status["budget"].model_copy(update={"approved_at": at})
    return version.model_copy(update={"section_status": status})


async def test_a_dated_column_before_the_first_budget_approval_has_no_budget() -> None:
    """Final audit O10: a dated column's day before the season's first budget approval had no approved budget, so
    its Budget is null (blank), never the figure the board passed later. The live column keeps it, and the null
    line is named among the column's not-rebuilt lines."""
    fake = FakeRules(approved(intake_rules()))
    assert fake.first is not None
    fake.first = _budget_approved_on(
        approved(with_lever(intake_rules(), "budget.total", "450000")), datetime(2027, 3, 10, 18, 0, tzinfo=UTC)
    )
    before = await _service(_development(), fake_rules=fake).development(
        YEAR, column=DatedColumn(season=YEAR, as_of=date(2027, 3, 5))
    )
    assert [(r.group, r.values) for r in _budget_rows(before)] == [(None, [450000.0, None])]
    assert "budget" in before.columns[1].not_rebuilt
    assert "budget" not in before.columns[0].not_rebuilt
    after = await _service(_development(), fake_rules=fake).development(
        YEAR, column=DatedColumn(season=YEAR, as_of=date(2027, 3, 20))
    )
    assert [(r.group, r.values) for r in _budget_rows(after)] == [(None, [450000.0, 450000.0])]


async def test_a_dated_columns_not_rebuilt_lines_are_exactly_the_lines_it_leaves_null() -> None:
    """Final audit O10: the read names, among a dated column's not-rebuilt lines, every line that reads null there
    for every group and in total (the cancellation lines first), and no line that has a figure anywhere in it."""
    fake = FakeRules(approved(intake_rules()))
    fake.first = _budget_approved_on(approved(intake_rules()), datetime(2027, 3, 10, 18, 0, tzinfo=UTC))
    out = await _service(_development(), fake_rules=fake).development(
        YEAR, column=DatedColumn(season=YEAR, as_of=date(2027, 3, 5))
    )
    named = out.columns[1].not_rebuilt
    keys = {r.key for r in out.rows}
    blank = {k for k in keys if all(r.values[1] is None for r in out.rows if r.key == k)}
    assert set(named) == blank
    assert "budget" in named
    assert len(named) == len(set(named))
    assert named[0] == "declined_insufficient"


async def test_a_season_with_no_approved_budget_shows_none_on_its_kindred_column() -> None:
    """No approved version carries a budget: the P column's Budget is blank, never a later draft's figure."""
    fake = FakeRules(approved(intake_rules()))
    fake.first = None
    out = await _service(_development(), fake_rules=fake).development(YEAR)
    assert [(r.group, r.values, r.label) for r in _budget_rows(out)] == [(None, [None], BUDGET_LABEL)]


async def test_the_budget_row_reads_the_typed_budget_on_an_as_reported_column() -> None:
    """An r column's budget is finance's typed total budget for that season (the first one typed: the board-passed
    one); a pool's typed budget and finance's other typed figures never reach development."""
    history = FakeReportsStore()
    history.seed(
        ReportedFigure(
            2026, "development", "total_awards", "camp_pool", 0, 0, "season_end", date(2026, 9, 29), Decimal(900000)
        )
    )
    for pool, value, day in (("", "1111000", 10), ("camp_pool", "900000", 10), ("", "1200000", 20)):
        history.seed(
            ReportedFigure(2026, "finance", "budget", pool, 0, 0, "season_end", date(2026, 10, day), Decimal(value))
        )
    history.seed(ReportedFigure(2026, "finance", "awarded", "", 0, 0, "season_end", date(2026, 10, 10), Decimal(1)))
    out = await _service(_development(), history).development(YEAR)
    assert [(c.season, c.basis) for c in out.columns] == [(2026, "r"), (2027, "P")]
    assert [(r.group, r.values) for r in _budget_rows(out)] == [(None, [1111000.0, 500000.0])]


async def test_the_awards_count_is_called_grants_and_awards() -> None:
    """Owner ruling L (10-08): Development's any-aid count is "Grants/Awards" (Statistics' camp-only count stays
    "Awards")."""
    out = await _service(_development()).development(YEAR)
    assert _row(out, "awards", "camp_pool").label == "Grants/Awards"


async def test_no_row_definition_shows_an_internal_id() -> None:
    """Owner 10-08 (visual true-up): no staff-visible internal ids (ruling numbers, report ids, plan items)."""
    out = await _service(_development()).development(YEAR)
    shown = [r.definition for r in out.rows if re.search(r"\b(D\d{2,3}|RPT-\d+|O-\d+-\d+|item \d+)\b", r.definition)]
    assert shown == []


def _strings(value: Any) -> list[str]:
    """Every string in a response, at any depth: what staff can be shown."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for v in value.values() for s in _strings(v)]
    if isinstance(value, list):
        return [s for v in value for s in _strings(v)]
    return []


async def test_no_string_in_the_report_shows_an_internal_id() -> None:
    """Owner 10-08 (visual true-up): the named gaps (not_built), labels and notes carry no internal ids either."""
    out = await _service(_development()).development(YEAR)
    assert {n.figure for n in out.not_built} >= {"rebuild"}
    shown = [s for s in _strings(out.model_dump()) if re.search(r"\b(D\d{2,3}|RPT-\d+|O-\d+-\d+|item \d+)\b", s)]
    assert shown == []


# --- Final audit O1/O2: the lines follow the approved development-v2 mock, in order and in words -------------


def _lines(out: Any, section: str) -> list[tuple[str, str]]:
    return list(dict.fromkeys((r.key, r.label) for r in out.rows if r.section == section and r.group is None))


async def test_the_money_lines_follow_the_approved_mock_in_order_and_words() -> None:
    """Budget, Total requests, Total Awards Granted with this camp's awards and the outside grants under it (the
    pools sit under those on screen), the money no group holds, Grants/Awards, Average award, % of need met. The
    owner-ruled words stay exactly: Budget's and "Grants/Awards"."""
    out = await _service(_development()).development(YEAR)
    assert _lines(out, "money") == [
        ("budget", "Budget (this camp's, the first board-passed)"),
        ("total_requests", "Total requests (demand) = Σ need"),
        ("total_awards", "Total Awards Granted (all money)"),
        ("camp_awards", "this camp's awards (awarded = Posted)"),
        ("outside_awards", "outside grants, every funder"),
        ("incentive_awards", "of which incentive grants"),
        ("not_in_group_amount", "Money in no group (a source that needs a group, a program in no pool, other)"),
        ("not_in_group_awards", "Grants/Awards in no group"),
        ("awards", "Grants/Awards"),
        ("average_award", "Average award = Total Awards Granted ÷ Grants/Awards"),
    ]
    need_met = [r for r in out.rows if r.key == "need_met"]
    assert [(r.group, r.label) for r in need_met] == [("camp_pool", "% of need met")]
    money_keys = [r.key for r in out.rows if r.section == "money"]
    assert money_keys.index("need_met") == len(money_keys) - 1  # the last money line


async def test_the_counts_and_appeals_lines_carry_the_mocks_words() -> None:
    """The recipients line says what it counts (campers who attended and got money from any source, applied or
    not), never "Applications"; families are CampMinder households; the gender lines follow the age lines and come
    before First-time; the household-level dollars sit with the household-level count."""
    out = await _service(_development()).development(YEAR)
    counts = [(r.key, r.label) for r in out.rows if r.section == "counts"]
    labels = dict(counts)
    assert labels["recipients"] == "Recipients (attended and got money, any source)"
    assert labels["families"] == "Families (CampMinder households)"
    assert labels["shared_households"] == "including households that share a camper"
    assert labels["teens"] == "Teens, 13–17 on their first session day"
    assert labels["youth"] == "Youth, 0–12"
    assert labels["household_level_lines"] == "Household-level grants not tied to a camper"
    assert labels["household_level_amount"] == "Household-level grant dollars not tied to a camper"
    first_time = {r.group: r.label for r in out.rows if r.key == "first_time"}
    assert first_time == {"camp_pool": "First-time campers", "weekend_pool": "First weekend program"}
    keys = [k for k, _ in counts]
    gender = [i for i, k in enumerate(keys) if k.startswith("gender_")]
    assert gender, "the fixture has gender rows"
    assert keys.index("teen_programs") < min(gender)
    assert max(gender) < keys.index("first_time")
    assert keys.index("household_level_amount") == keys.index("household_level_lines") + len(
        [r for r in out.rows if r.key == "household_level_lines"]
    )
    appeals = {r.key: r.label for r in out.rows if r.section == "appeals"}
    assert appeals["appeals_submitted"] == "Appeals (asks in Round 2 or later, campers who attended)"
    assert appeals["appeals_in_full"] == "approved in full"
    assert appeals["appeals_in_part"] == "approved in part"
    assert appeals["declined_insufficient"] == "Declined enrollment due to insufficient aid"


# --- the lookback cap (owner 10-09 Q5): five historical seasons as reported, the dashboard's live and last closed ---


def _typed(year: int, day: date | None = None, metric: str = "total_awards") -> ReportedFigure:
    return ReportedFigure(
        year, "development", metric, "camp_pool", 0, 0, "season_end", day or date(year, 9, 29), Decimal(1)
    )


def _native_column() -> Any:
    from bunking.financial_aid.reports.development import DevelopmentColumn, NotInGroup

    zero = Decimal(0)
    return DevelopmentColumn((), zero, 0, zero, 0, 0, 0, 0, (), NotInGroup(zero, zero, 0, 0))


def _shape(columns: Sequence[Any]) -> list[tuple[int, str, date]]:
    return [(c.season, c.basis, c.as_of) for c, _ in columns]


async def test_the_lookback_keeps_the_five_latest_historical_seasons_and_both_dates_of_a_season_typed_twice() -> None:
    from api.services.financial_aid_development_service import _columns

    typed = [_typed(y) for y in range(2021, 2027)] + [_typed(2024, date(2025, 2, 1))]
    shown = _columns(typed, {2027: _native_column()}, date(2027, 4, 1), report_year=2027)
    reported = [(s, d) for s, b, d in _shape(shown) if b == "r"]
    # six typed seasons before 2027: the oldest (2020 and 2021) roll off; 2024 counts once but keeps both columns
    assert sorted({s for s, _ in reported}) == [2022, 2023, 2024, 2025, 2026]
    assert [s for s, _ in reported].count(2024) == 2
    assert [s for s, b, _ in _shape(shown) if b == "P"] == [2027]


async def test_the_lookback_keeps_every_season_in_the_window_when_fewer_than_five_were_typed() -> None:
    from api.services.financial_aid_development_service import _columns

    shown = _columns([_typed(2025), _typed(2026)], {2027: _native_column()}, date(2027, 4, 1), report_year=2027)
    assert [(s, b) for s, b, _ in _shape(shown)] == [(2025, "r"), (2026, "r"), (2027, "P")]


async def test_the_lookback_is_a_calendar_window_so_gaps_in_the_typed_years_do_not_reach_back() -> None:
    from api.services.financial_aid_development_service import _columns

    typed = [_typed(2022), _typed(2023), _typed(2026)]
    shown = _columns(typed, {2030: _native_column()}, date(2030, 4, 1), report_year=2030)
    # 2030 shows 2025-2029: 2022 and 2023 are outside the window even though fewer than five were typed after them
    assert [s for s, b, _ in _shape(shown) if b == "r"] == [2026]


async def test_the_current_seasons_own_typed_column_is_not_a_historical_season() -> None:
    from api.services.financial_aid_development_service import _columns

    typed = [_typed(y) for y in range(2021, 2028)]
    shown = _columns(typed, {}, date(2027, 4, 1), report_year=2027)
    assert sorted({s for s, b, _ in _shape(shown) if b == "r"}) == [2022, 2023, 2024, 2025, 2026, 2027]


async def test_the_dashboard_group_keeps_the_live_season_and_the_last_closed_one() -> None:
    from api.services.financial_aid_development_service import _columns

    natives = {y: _native_column() for y in (2027, 2028, 2029)}
    shown = _columns([], natives, date(2029, 4, 1), report_year=2029)
    assert [(s, b) for s, b, _ in _shape(shown)] == [(2028, "P"), (2029, "P")]


async def test_a_report_year_with_older_priced_seasons_prices_only_the_two_the_dashboard_shows() -> None:
    service = _service(_development())
    seen: list[int] = []
    real = service._decisions.season

    async def spy(year: int) -> Any:
        seen.append(year)
        return await real(year)

    service._decisions.season = spy  # type: ignore[method-assign]
    await service.development(2029)
    assert sorted(set(seen)) == [2028, 2029]


async def test_a_dated_column_for_a_season_the_dashboard_no_longer_shows_is_refused() -> None:
    from api.services.financial_aid_reports_service import ReportsRefusedError

    with pytest.raises(ReportsRefusedError, match="not shown"):
        await _service(_development()).development(2029, column=DatedColumn(season=2027, as_of=date(2027, 3, 5)))


async def test_the_rebuild_note_names_only_the_seasons_still_shown() -> None:
    out = await _service(_development()).development(YEAR)
    rebuild = next(n.reason for n in out.not_built if n.figure == "rebuild")
    assert "2022–2025" in rebuild
    # the 2029 report shows 2024–2028 as reported: the rebuild window is 2024–2025
    out = await _service(_development()).development(2029)
    rebuild = next(n.reason for n in out.not_built if n.figure == "rebuild")
    assert "2024–2025" in rebuild
    # by 2031 every unconfirmed season has rolled off, so there is no rebuild to wait on
    out = await _service(_development()).development(2031)
    assert not any(n.figure == "rebuild" for n in out.not_built)


# --- #53 (owner 2026-10-16, "go with a"): a report year with no approved rules keeps the newest approved groups ---


class _RulesFrom(FakeRules):
    """Rules approved only for the seasons in `years` (FakeRules answers every season alike)."""

    def __init__(self, years: set[int]) -> None:
        super().__init__(approved(intake_rules()))
        self.years = years

    async def latest_approved(self, year: int, sections: Any) -> Any:
        return self.version if year in self.years else None

    async def first_approved(self, year: int, sections: Any) -> Any:
        return self.first if year in self.years else None


async def test_a_report_year_with_no_approved_rules_keeps_the_newest_approved_seasons_groups() -> None:
    """2027's rules aren't approved yet, so the report would have no groups at all (`groups: []`). Ruling a: every
    column uses 2026's groups, and the report says so where staff see it."""
    out = await _service(
        _development(), register=[grant_row("reqemma00000001", "500")], fake_rules=_RulesFrom({2026})
    ).development(YEAR)
    assert [g.key for g in out.groups] == ["camp_pool", "weekend_pool", "bmitzvah_pool"]
    assert _row(out, "outside_awards", "camp_pool").values[-1] == 500.0  # 2027's grant, in 2026's summer group
    assert _row(out, "recipients", "camp_pool").values[-1] == 1.0
    [notice] = [n for n in out.not_built if n.figure == "groups_from"]
    assert notice.reason == "Groups follow 2026's rules until 2027's are approved"


async def test_the_groups_switch_to_the_report_years_own_once_they_are_approved() -> None:
    out = await _service(_development(), fake_rules=_RulesFrom({2026, 2027})).development(YEAR)
    assert [g.key for g in out.groups] == ["camp_pool", "weekend_pool", "bmitzvah_pool"]
    assert "groups_from" not in {n.figure for n in out.not_built}


async def test_with_no_approved_rules_in_any_season_there_are_no_groups_and_no_notice() -> None:
    out = await _service(_development(), fake_rules=_RulesFrom(set())).development(YEAR)
    assert out.groups == []
    assert "groups_from" not in {n.figure for n in out.not_built}


async def test_a_dated_column_reads_a_reversal_on_its_camp_day_not_its_utc_date() -> None:
    """reversal_date is true UTC (main spec §6.2): reversed the evening of December 31 Pacific (January 1 in UTC),
    the line was no longer money given out at the end of December 31."""
    found = grouping(intake_rules(), SESSIONS)
    line = replace(
        grant_row("reqemma00000001", "500"),
        recorded_on="2026-12-01",
        is_reversed=True,
        reversal_date="2027-01-01 03:30:00.000Z",
    )
    assert grant_money([line], found, as_of=date(2026, 12, 31)) == ()
    assert len(grant_money([line], found, as_of=date(2026, 12, 30))) == 1
