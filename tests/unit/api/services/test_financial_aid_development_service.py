"""Reports › Development through the service (Reports back end, Part B; clean spec §9.4; D87, D92, D96, D99, D102),
with real pricing over a fictional season (decisions_fakes): Emma's Round 1 is posted at 1,500; Liam's 1,100 is
decided, not posted. The clock is April 1 2027. Fictional only."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest

from api.services.financial_aid_cancellations import CANCEL_REASONS, CancelEvent
from api.services.financial_aid_development_repository import PersonRecord, SourceRecord
from api.services.financial_aid_development_service import (
    AVERAGE_AWARD_DEFINITION,
    FIRST_TIME_SUMMER,
    FinancialAidDevelopmentService,
    grouping,
)
from api.services.financial_aid_grants_register import RegisterRow
from bunking.financial_aid.decisions import DecisionEvent
from bunking.financial_aid.reports.development import NOT_REPORTED
from bunking.financial_aid.reports.history import ReportedFigure
from tests.unit.api.services.decisions_fakes import FakeDecisionsStore, FakeRules, approved, grant_row, seed_line
from tests.unit.api.services.development_fakes import FakeDevelopmentStore, went
from tests.unit.api.services.financial_aid_fakes import SESSIONS, YEAR, intake_rules
from tests.unit.api.services.reports_fakes import FakeReportsStore, report_season

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
) -> FinancialAidDevelopmentService:
    async def rows(year: int) -> Sequence[RegisterRow]:
        return list(register) if year == YEAR else list(past_register)

    return FinancialAidDevelopmentService(
        store or report_season(),
        FakeRules(approved(intake_rules())),
        rows,
        development,
        history or FakeReportsStore(),
        clock=lambda: NOW,
    )


def _row(out: Any, key: str, group: str | None) -> Any:
    return next(r for r in out.rows if r.key == key and r.group == group)


async def test_the_season_column_is_all_money_on_campers_who_attended() -> None:
    """D87: the camp's awarded money plus every live outside grant; Liam's decided 1,100 is not money given out."""
    out = await _service(_development(), register=[grant_row("reqemma00000001", "500")]).development(YEAR)
    assert [(c.season, c.basis, c.basis_unconfirmed) for c in out.columns] == [(2027, "P", False)]
    assert [(g.key, g.kind) for g in out.groups] == [
        ("camp_pool", "summer"),
        ("weekend_pool", "families"),
        ("bmitzvah_pool", "campers"),
    ]
    assert _row(out, "total_awards", "camp_pool").values == [2000.0]
    assert _row(out, "awards", "camp_pool").values == [2.0]
    assert _row(out, "recipients", None).values == [1.0]
    assert _row(out, "total_requests", "camp_pool").values == [6000.0]  # both attended, both asked
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
    assert _row(out, "awards", "camp_pool").values == [2.0]


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


async def test_the_rebuilt_ages_ignore_reversed_camp_lines() -> None:
    """D158: Emma's reversed 2025 camp line isn't aid, so she isn't counted; Liam's live one is."""
    store = report_season()
    seed_line(store, 7001, "800", household=1000002, person=LIAM)
    seed_line(store, 7002, "600", household=1000001, person=EMMA, reversed_at=datetime(2025, 8, 1, 18, 0, tzinfo=UTC))
    out = await _service(_stayed_2025(), _backfilled_2025(), store=store).development(YEAR)
    assert _row(out, "teens", "camp_pool").values[0] == 1.0  # Liam, 13
    assert _row(out, "youth", "camp_pool").values[0] == 0.0  # not Emma


async def test_the_rebuilt_ages_count_only_attending_registrations() -> None:
    """D158: Emma's 2025 registration was cancelled (status 32), so her 2025 aid line gives no youth to count."""
    store = report_season()
    seed_line(store, 7001, "800", household=1000002, person=LIAM)
    seed_line(store, 7002, "600", household=1000001, person=EMMA)
    development = _development(
        registrations=[
            went(EMMA, 1000001),
            went(LIAM, 1000002),
            went(EMMA, 1000001, year=2025, start=date(2025, 6, 20), status=32),
            went(LIAM, 1000002, year=2025, start=date(2025, 6, 20)),
        ]
    )
    out = await _service(development, _backfilled_2025(), store=store).development(YEAR)
    assert _row(out, "teens", "camp_pool").values[0] == 1.0
    assert _row(out, "youth", "camp_pool").values[0] == 0.0


@pytest.mark.parametrize(("funder_type", "youth", "named"), [("outside", 1.0, False), ("unknown", None, True)])
async def test_the_rebuilt_ages_count_only_classified_outside_grants(
    funder_type: str, youth: float | None, named: bool
) -> None:
    """D158: with no camp lines, an outside grant on Emma rebuilds her age; a line whose funder is unclassified
    ("unknown") isn't a grant, so the season stays blank and is named."""
    line = grant_row("reqemma00000001", "300", funder_type=funder_type)
    out = await _service(_stayed_2025(), _backfilled_2025(), past_register=[line]).development(YEAR)
    assert _row(out, "youth", "camp_pool").values[0] == youth
    assert ("ages_before_backfill" in {n.figure for n in out.not_built}) is named


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
    found = grouping(intake_rules(), {s.cm_id: s.session_type for s in SESSIONS})
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


async def test_a_session_no_program_claims_joins_its_program_familys_pool() -> None:
    """A session not open to aid still has campers development reports (a teen-program session no program claims):
    it joins the pool its program family's claimed sessions use; "other" is attended but in no group."""
    sessions = {s.cm_id: s.session_type for s in SESSIONS} | {1000302: "hebrew", 1000999: "other"}
    found = grouping(intake_rules(), sessions)
    assert found.by_session[1000302] == "bmitzvah_pool"  # B'mitzvah's family, unclaimed
    assert found.by_session[1000999] == NOT_REPORTED  # "other": attended, counted in no group


async def test_family_school_is_not_a_camper_program_even_where_a_program_claims_it() -> None:
    """Queue "Known limits": B*Mitzvah counts as a camper program; Family School doesn't (D107: sunsetted)."""
    found = grouping(intake_rules(), {s.cm_id: s.session_type for s in SESSIONS} | {1000501: "school"})
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
    assert row.values == [1000.0]  # (1,500 + 500) / 2 awards
    assert row.definition == AVERAGE_AWARD_DEFINITION
    assert _row(out, "average_award", None).values == [1000.0]


async def test_a_column_with_no_p_column_counts_its_ages_by_age_from_the_ledger() -> None:
    """D158: 2025's "as reported" column shows teens and youth by age, rebuilt from 2025's ledger, with no mark."""
    history = FakeReportsStore()
    history.seed(
        ReportedFigure(
            2025, "development", "total_awards", "camp_pool", 0, 0, "season_end", date(2025, 9, 29), Decimal(900)
        )
    )
    store = report_season()
    seed_line(store, 7001, "800", household=1000002, person=LIAM)  # on Liam: 13 on June 20 2025
    seed_line(store, 7002, "600", household=1000001, person=0)  # Emma's household-level line: 10 that day
    development = _development(
        registrations=[
            went(EMMA, 1000001),
            went(LIAM, 1000002),
            went(EMMA, 1000001, year=2025, start=date(2025, 6, 20)),
            went(LIAM, 1000002, year=2025, start=date(2025, 6, 20)),
        ]
    )
    out = await _service(development, history, store=store).development(YEAR)
    assert [(c.season, c.basis) for c in out.columns] == [(2025, "r"), (2027, "P")]
    assert _row(out, "teens", "camp_pool").values[0] == 1.0
    assert _row(out, "youth", "camp_pool").values[0] == 1.0
    assert "ages_before_backfill" not in {n.figure for n in out.not_built}


async def test_a_season_with_no_ledger_lines_leaves_its_ages_blank_and_names_why() -> None:
    """OWNER ITEM 51 NOT RULED: 2022-2024 wait on the 2017-2024 backfill; the cells are blank and the wait is named
    once."""
    history = FakeReportsStore()
    history.seed(
        ReportedFigure(
            2024, "development", "total_awards", "camp_pool", 0, 0, "season_end", date(2024, 9, 29), Decimal(900)
        )
    )
    out = await _service(_development(), history).development(YEAR)
    assert _row(out, "teens", "camp_pool").values[0] is None
    gap = next(n for n in out.not_built if n.figure == "ages_before_backfill")
    assert "2024" in gap.reason
