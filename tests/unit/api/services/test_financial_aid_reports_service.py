"""Reports' reads and typed history through the service (Reports back end, Part A; clean spec §9.2, §9.3, §9.7;
D72, D80, D129–D131, D138), with real pricing over fictional seasons (decisions_fakes): Session 2 costs 2,000, so
Emma's family (60,000, tier 2) gets Round 1 = 1,500 and Liam's (90,000, tier 3) 1,100. The clock is April 1 2027.
Fictional only."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest

from api.constants.collections import AID_REPORTED_HISTORY
from api.services.financial_aid_cancellations import CancelEvent, EnrollmentState
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_intake_types import CorrectionRecord
from api.services.financial_aid_reports_service import (
    FinancialAidReportsService,
    ReportedFigureNotFoundError,
    ReportsRefusedError,
)
from api.services.financial_aid_request_overrides import EXCLUDED, INCLUDE_OVERRIDE
from bunking.financial_aid.reports.committee import PHASE_BOUNDARY_GAP
from bunking.financial_aid.reports.history import ReportedFigure
from tests.unit.api.services.decisions_fakes import (
    ACTOR,
    FakeDecisionsStore,
    FakeRules,
    approved,
    grant_row,
    seed_request,
)
from tests.unit.api.services.financial_aid_fakes import YEAR, intake_rules
from tests.unit.api.services.reports_fakes import EMMA, FakeReportsStore, posted, report_season
from tests.unit.bunking.financial_aid.fixtures import with_levers

pytestmark = pytest.mark.asyncio

NOAH = "reqnoah00000001"
NOW = datetime(2027, 4, 1, 17, 0, tzinfo=UTC)
FINANCE = "finance@example.com"
RULES = with_levers(intake_rules(), {"milestones.application_deadline": "2027-02-01"})


def _service(
    store: FakeDecisionsStore,
    history: FakeReportsStore | None = None,
    register: Sequence[RegisterRow] = (),
    rules: Any = None,
) -> FinancialAidReportsService:
    async def rows(year: int) -> Sequence[RegisterRow]:
        return list(register) if year == YEAR else []

    return FinancialAidReportsService(
        store, rules or FakeRules(approved(RULES)), rows, history or FakeReportsStore(), clock=lambda: NOW
    )


def _tier(rows: Sequence[Any], tier: int | None) -> Any:
    return next(row for row in rows if row.tier == tier)


# --- Statistics -------------------------------------------------------------------------------------------------


async def test_statistics_counts_received_requests_and_awards_only_what_posted() -> None:
    """D72 apps, D80 awarded = Posted: Liam's 1,100 is decided, not awarded, so it isn't in the money."""
    out = await _service(report_season()).statistics(YEAR, table="camp", round_=1)
    assert (out.figures_on, out.as_of, out.rules_version, out.basis) == (date(2027, 4, 1), None, 1, "posted")
    two, three = _tier(out.rows, 2), _tier(out.rows, 3)
    assert (two.apps, two.asked, two.amount, two.awarded_count, two.pct_of_ask) == (1, 4000.0, 1500.0, 1, 37.5)
    assert (three.apps, three.asked, three.amount, three.awarded_count) == (1, 2000.0, 0.0, 0)
    assert (out.total.apps, out.total.amount) == (2, 1500.0)
    assert [chip.key for chip in out.tables] == list(RULES.award_tables)


async def test_include_not_yet_offered_adds_the_decided_amounts_labelled_apart() -> None:
    """D130, RPT-5."""
    out = await _service(report_season()).statistics(YEAR, table="camp", round_=1, basis="posted_and_decided")
    three = _tier(out.rows, 3)
    assert (three.amount, three.decided, three.awarded_count, three.decided_count) == (1100.0, 1100.0, 0, 1)
    assert three.average_award is None  # nothing posted: decided money is never an award (D130)
    assert (out.total.amount, out.total.decided) == (2600.0, 1100.0)


async def test_a_cancelled_request_stays_in_apps_and_leaves_the_money_at_once() -> None:
    """D129, D131: inclusion from request status; the budget's Posted still holds it until the reversal posts."""
    store = report_season()
    store.cancel_events.append(
        CancelEvent(
            "can000000000001",
            EMMA,
            "cancel",
            NOW - timedelta(days=1),
            reason="aid_not_enough",
            in_kindred=True,
            actor=ACTOR,
        )
    )
    out = await _service(store).statistics(YEAR, table="camp", round_=1)
    assert (out.total.apps, out.total.cancelled, out.cancelled_applicants, out.total.amount) == (2, 1, 1, 0.0)
    [row] = out.recipients_cancelled
    assert (row.reason, row.reason_label, row.pool, row.round, row.requests, row.posted) == (
        "aid_not_enough",
        "declined: aid not enough / financial constraints",
        "camp_pool",
        1,
        1,
        1500.0,
    )


async def test_an_edited_answer_is_one_application_and_a_refused_duplicate_is_none() -> None:
    """D72: received = every intake request except refused duplicates; an edit replaces, never adds."""
    store = report_season()
    seed_request(store, "reqemma00000000", status="withdrawn")  # Emma's first answer, which her edit replaced
    seed_request(store, NOAH, household=1000003, person=1000031, status="duplicate")
    out = await _service(store).statistics(YEAR, table="camp", round_=1)
    assert out.total.apps == 2


async def test_grants_on_the_request_feed_percent_of_ask_with_grants() -> None:
    out = await _service(report_season(), register=[grant_row(EMMA, "500")]).statistics(YEAR, table="camp", round_=1)
    two = _tier(out.rows, 2)
    assert (two.grants, two.pct_of_ask_with_grants) == (500.0, 50.0)


async def test_the_round_1_deadline_switch_leaves_out_requests_received_after_it() -> None:
    """D138: off by default; when on, the figures are labelled and say what they leave out."""
    service = _service(report_season(liam_late=True))
    every = await service.statistics(YEAR, table="camp", round_=1)
    assert every.request_set is None
    assert every.total.apps == 2
    cut = await service.statistics(YEAR, table="camp", round_=1, through_deadline=True)
    assert cut.total.apps == 1
    assert cut.request_set is not None
    assert (cut.request_set.basis, cut.request_set.through, cut.request_set.left_out) == (
        "round1_deadline",
        date(2027, 2, 1),
        1,
    )
    assert cut.request_set.label == "requests received through Feb 1, 2027"


async def test_the_controls_refuse_both_at_once_and_a_season_before_2027() -> None:
    service = _service(report_season())
    with pytest.raises(ReportsRefusedError, match="not both"):
        await service.statistics(YEAR, through_deadline=True, through=date(2027, 2, 1))
    with pytest.raises(ReportsRefusedError, match="work from 2027"):
        await service.statistics(2026, through=date(2026, 2, 1))


async def test_a_past_date_refuses_the_decided_basis_and_names_the_grants_it_does_not_read_yet() -> None:
    """Until A6c reads 3c-2's priced past: Decided is refused and grants are left empty and named. The fake season
    records no equity answers, so 3c-2 keeps Liam to 3c-1's figures (named by the decisions service, with his id):
    his unposted round has no tier and counts in the "no tier" row."""
    store = report_season()
    store.events = [posted("ev0000000000001", EMMA, 1, "1500", 2, on=date(2027, 3, 5))]
    service = _service(store)
    with pytest.raises(ReportsRefusedError, match="live read only"):
        await service.statistics(YEAR, basis="posted_and_decided", as_of=date(2027, 3, 8))
    out = await service.statistics(YEAR, table="camp", round_=1, as_of=date(2027, 3, 8))
    assert (out.as_of, out.as_of_axis, out.figures_on) == (date(2027, 3, 8), "campminder", date(2027, 3, 8))
    assert (_tier(out.rows, 2).amount, _tier(out.rows, None).apps) == (1500.0, 1)
    assert "grants" in {gap.figure for gap in out.not_rebuilt}
    assert (out.total.cancelled, out.cancelled_applicants) == (0, 0)  # counted, not nulled: a past read lists them


async def test_a_past_date_leaves_grants_empty_never_a_silent_zero() -> None:
    """The past read carries no grants register: grants and % of ask with grants are null and named, not $0."""
    store = report_season()
    out = await _service(store, register=[grant_row(EMMA, "500")]).statistics(
        YEAR, table="camp", round_=1, as_of=date(2027, 3, 10)
    )
    two = _tier(out.rows, 2)
    assert (two.grants, two.pct_of_ask_with_grants, two.pct_of_ask) == (None, None, 37.5)
    gap = next(g for g in out.not_rebuilt if g.figure == "grants")
    assert "left empty" in gap.reason


async def test_a_cancellation_in_kindred_before_the_date_takes_its_request_out_of_awarded() -> None:
    """A Kindred cancellation applies as of the date it was recorded."""
    store = report_season()
    store.cancel_events.append(
        CancelEvent(
            "can000000000001",
            EMMA,
            "cancel",
            datetime(2027, 3, 9, 20, 0, tzinfo=UTC),
            reason="medical",
            in_kindred=True,
            actor=ACTOR,
        )
    )
    out = await _service(store).statistics(YEAR, table="camp", round_=1, as_of=date(2027, 3, 10))
    assert (_tier(out.rows, 2).apps, _tier(out.rows, 2).amount) == (1, 0.0)
    assert (out.total.cancelled, out.cancelled_applicants) == (1, 1)


def _camper_cancelled_in_campminder(store: FakeDecisionsStore, on: date) -> None:
    store.enrollments.append(EnrollmentState(1000011, 1000001, 1000101, 32, on))


async def test_a_request_campminder_cancelled_on_or_before_the_date_is_cancelled_at_that_date() -> None:
    """The decisions service's past read lists a cancellation made by the day (Decision 11), so Reports count it in
    `cancelled` and out of awarded, with the lines real counts, never nulled and never a `cancellation` gap."""
    store = report_season()
    _camper_cancelled_in_campminder(store, date(2027, 3, 8))
    service = _service(store)
    out = await service.statistics(YEAR, table="camp", round_=1, as_of=date(2027, 3, 10))
    two = _tier(out.rows, 2)
    assert (two.apps, two.cancelled, two.amount, two.awarded_count) == (1, 1, 0.0, 0)
    assert (out.total.apps, out.total.cancelled, out.cancelled_applicants) == (2, 1, 1)
    assert "cancellation" not in {gap.figure for gap in out.not_rebuilt if not gap.requests}


async def test_a_request_cancelled_after_the_date_is_not_cancelled_at_that_date() -> None:
    store = report_season()
    _camper_cancelled_in_campminder(store, date(2027, 3, 20))
    out = await _service(store).statistics(YEAR, table="camp", round_=1, as_of=date(2027, 3, 10))
    two = _tier(out.rows, 2)
    assert (two.apps, two.cancelled, two.amount, two.awarded_count) == (1, 0, 1500.0, 1)
    assert (out.total.cancelled, out.cancelled_applicants) == (0, 0)


async def test_programs_count_a_past_cancellation_too() -> None:
    store = report_season()
    _camper_cancelled_in_campminder(store, date(2027, 3, 8))
    out = await _service(store).programs(YEAR, as_of=date(2027, 3, 10))
    camp = next(group for group in out.pools if group.pool == "camp_pool")
    session2 = next(row for row in camp.sessions if row.session_cm_id == 1000101)
    assert (session2.round1.apps, session2.round1.awarded) == (2, 0.0)


async def test_a_request_the_include_override_excludes_still_counts_in_apps_asks_and_awarded() -> None:
    """OWNER ITEM 53 NOT RULED: Reports do NOT read the Include override (default; flip deliberately). Staff leaving
    Emma out of her family's sums doesn't take her out of Statistics: she is still an app, her ask is still asked and
    her posted 1,500 is still awarded. (The report's own "live" standing is the request's status, a different
    concept.)"""
    store = report_season()
    store.corrections.append(
        CorrectionRecord(
            id="cor000000000900",
            year=YEAR,
            application_id=store.requests[EMMA].application_id,
            request_id=EMMA,
            field=INCLUDE_OVERRIDE,
            new_value=EXCLUDED,
            original_value="",
            reason="staff left it out",
            actor=ACTOR,
            created="2027-03-10 12:00:00.000Z",
        )
    )
    out = await _service(store).statistics(YEAR, table="camp", round_=1)
    two = _tier(out.rows, 2)
    assert (two.apps, two.asked, two.amount, two.awarded_count) == (1, 4000.0, 1500.0, 1)
    assert (out.total.apps, out.total.asked, out.total.amount) == (2, 6000.0, 1500.0)


async def test_an_unknown_table_is_refused() -> None:
    with pytest.raises(ReportsRefusedError, match="award tables"):
        await _service(report_season()).statistics(YEAR, table="nowhere")


async def test_statistics_carries_rpt_9_and_rpt_23_for_the_samereport_season() -> None:
    out = await _service(report_season()).statistics(YEAR, table="camp", round_=1)
    assert _tier(out.tier_appeals, 2).round1_apps == 1
    every = out.outcomes[-1]
    assert (every.pool, every.pool_label, every.waiting) == (None, "All pools", 1)


# --- Programs ---------------------------------------------------------------------------------------------------


async def test_programs_lists_the_rules_sessions_by_pool() -> None:
    out = await _service(report_season()).programs(YEAR)
    camp = next(group for group in out.pools if group.pool == "camp_pool")
    assert camp.pool_label == "Camp"
    session2 = next(row for row in camp.sessions if row.session_cm_id == 1000101)
    assert (session2.session_name, session2.round1.apps, session2.round1.awarded) == ("Session 2", 2, 1500.0)
    assert {row.session_cm_id for row in camp.sessions} >= {1000101, 1000104, 1000106}
    assert out.total.round1.apps == 2


# --- the committee's tables -------------------------------------------------------------------------------------


async def test_the_committee_puts_this_seasons_p_rows_beside_typed_history() -> None:
    history = FakeReportsStore()
    for metric, value in (("awarded", "460000"), ("budget", "500000")):
        history.seed(
            ReportedFigure(2026, "finance", metric, "", 0, 0, "season_end", date(2026, 10, 10), Decimal(value))
        )
    out = await _service(report_season(), history).committee(YEAR)
    assert out.seasons == [2026, 2027]
    assert [(row.year, row.basis) for row in out.phases] == [(2026, "r"), (2027, "P")]
    p = out.phases[1]
    assert (p.phases, p.total, p.budget, p.gaps) == ([None, None, 0.0], 1500.0, 500000.0, [PHASE_BOUNDARY_GAP])
    camp = next(row for row in out.applications if row.year == YEAR and row.pool == "camp_pool")
    assert camp.cutoff == date(2027, 2, 1)
    assert camp.at_cutoff is not None
    assert camp.at_cutoff.apps == 2
    assert {item.figure for item in out.not_built} >= {PHASE_BOUNDARY_GAP, "enrollment_pct_of_goal"}


async def test_the_committee_refuses_a_received_through_date_before_2027_as_statistics_does() -> None:
    with pytest.raises(ReportsRefusedError, match="work from 2027"):
        await _service(report_season()).committee(2026, through=date(2026, 2, 1))


async def test_a_load_keeps_every_change_log_key_within_64_characters() -> None:
    """aid_change_log.entity_id holds 64 characters; a typed figure's natural key can run longer (a long pool key),
    so the log key is the compact figure_entity. The fake refuses a longer key, as PocketBase does."""
    history = FakeReportsStore()
    long_pool = "a_reporting_pool_key_that_runs_to_the_sixty_character_limit"
    out = await _service(report_season(), history).load_reported(
        [_figure("r1_awarded", "1", pool=long_pool)], actor=FINANCE
    )
    assert out.created == 1
    assert all(len(row["entity_id"]) <= 64 for row in history.log)


async def test_2026_has_no_p_row_until_its_decisions_load() -> None:
    """D67: 2026's decisions arrive with the one-off load; until then its money would read 0, so it isn't shown."""
    out = await _service(report_season()).committee(YEAR)
    assert [row.year for row in out.phases] == [YEAR]


# --- finance's typed history ------------------------------------------------------------------------------------


def _figure(metric: str = "budget", value: str = "500000", **change: Any) -> ReportedFigure:
    figure = ReportedFigure(2025, "finance", metric, "", 0, 0, "season_end", date(2025, 10, 10), Decimal(value))
    return replace(figure, **change)


async def test_a_load_adds_new_figures_and_corrects_stored_ones_in_one_logged_operation() -> None:
    history = FakeReportsStore()
    service = _service(report_season(), history)
    first = await service.load_reported([_figure(), _figure("awarded", "480000")], actor=FINANCE)
    assert (first.created, first.updated, first.unchanged) == (2, 0, 0)
    assert len(history.operations) == 1
    assert {row["entity"] for row in history.log} == {AID_REPORTED_HISTORY}
    assert len({row["operation_id"] for row in history.log}) == 1
    second = await service.load_reported([_figure(), _figure("awarded", "481000", note="corrected")], actor=FINANCE)
    assert (second.created, second.updated, second.unchanged) == (0, 1, 1)
    [update] = history.operations[1]
    assert update.action == "update"
    assert set(update.data or {}) == {"value", "note"}


async def test_a_load_with_nothing_new_writes_nothing() -> None:
    """A no-op never reaches 4a (change_row raises "nothing changed")."""
    history = FakeReportsStore()
    history.seed(_figure())
    out = await _service(report_season(), history).load_reported([_figure()], actor=FINANCE)
    assert (out.created, out.updated, out.unchanged) == (0, 0, 1)
    assert history.operations == []


async def test_a_load_with_one_bad_or_repeated_figure_writes_nothing() -> None:
    history = FakeReportsStore()
    service = _service(report_season(), history)
    with pytest.raises(ReportsRefusedError, match=r"figure 2: .*not a reported metric"):
        await service.load_reported([_figure(), _figure("made_up")], actor=FINANCE)
    with pytest.raises(ReportsRefusedError, match="the same figure twice"):
        await service.load_reported([_figure(), _figure(value="1")], actor=FINANCE)
    assert history.operations == []


async def test_a_typed_figure_is_deleted_with_a_reason_and_an_unknown_one_is_404() -> None:
    history = FakeReportsStore()
    record_id = history.seed(_figure())
    service = _service(report_season(), history)
    await service.delete_reported(record_id, reason="typed against the wrong as-of date", actor=FINANCE)
    assert history.rows == []
    assert history.log[-1]["reason"] == "typed against the wrong as-of date"
    with pytest.raises(ReportedFigureNotFoundError):
        await service.delete_reported(record_id, reason="again", actor=FINANCE)


# --- review focus -----------------------------------------------------------------------------------------------


async def test_a_season_with_no_approved_rules_still_reads_with_every_request_untiered() -> None:
    """Before finance approves the rules nothing is priced: apps and asks still count. Emma's posted round keeps its
    lock's tier (D43); Liam's unpriced request has none, so it is the "no tier" row (there are no bands to list)."""
    out = await _service(report_season(), rules=FakeRules(None)).statistics(YEAR)
    assert [(row.tier, row.apps) for row in out.rows] == [(2, 1), (None, 1)]
    assert (out.total.apps, out.total.asked, out.tables, out.rules_version) == (2, 6000.0, [], None)


async def test_as_of_today_or_later_is_the_live_read() -> None:
    out = await _service(report_season()).statistics(YEAR, as_of=date(2027, 4, 1))
    assert (out.as_of, out.not_rebuilt, out.cancelled_applicants) == (None, [], 0)


async def test_a_typed_pool_the_rules_dont_know_keeps_its_key_as_its_label() -> None:
    history = FakeReportsStore()
    history.seed(
        ReportedFigure(2025, "finance", "budget", "family_school", 0, 0, "season_end", date(2025, 10, 10), Decimal(1))
    )
    out = await _service(report_season(), history).committee(YEAR)
    assert next(row for row in out.budget if row.pool == "family_school").pool_label == "family_school"


async def test_a_committee_read_for_a_season_before_requests_is_typed_history_only() -> None:
    history = FakeReportsStore()
    history.seed(ReportedFigure(2024, "finance", "awarded", "", 0, 0, "season_end", date(2024, 10, 1), Decimal(7)))
    out = await _service(report_season(), history).committee(2025)
    assert out.seasons == [2024]
    assert [(row.year, row.basis) for row in out.phases] == [(2024, "r")]
