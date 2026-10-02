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

from api.constants.collections import AID_REPORTED_HISTORY, AID_REQUESTS
from api.services.financial_aid_cancellations import CancelEvent, EnrollmentState
from api.services.financial_aid_grant_placements import PlacementRecord, grant_key, placement_json
from api.services.financial_aid_grants_register import Placement, RegisterRow
from api.services.financial_aid_intake_types import UNKNOWN_EQUITY, CorrectionRecord, SessionRow
from api.services.financial_aid_reports_facts import _round, _standing
from api.services.financial_aid_reports_service import (
    FinancialAidReportsService,
    ReportedFigureNotFoundError,
    ReportsRefusedError,
)
from bunking.financial_aid.decisions import RoundView
from bunking.financial_aid.reports.committee import NO_DEADLINE_CUT_GAP, PHASE_BOUNDARY_GAP
from bunking.financial_aid.reports.facts import RoundFacts
from bunking.financial_aid.reports.history import ReportedFigure
from tests.unit.api.services.decisions_fakes import (
    ACTOR,
    FakeDecisionsStore,
    FakeRules,
    approved,
    grant_row,
    log_seeded,
    log_update,
    seed_line,
    seed_request,
)
from tests.unit.api.services.financial_aid_fakes import YEAR, intake_rules
from tests.unit.api.services.reports_fakes import EARLY, EMMA, LIAM, FakeReportsStore, posted, report_season
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
    now: datetime = NOW,
) -> FinancialAidReportsService:
    async def rows(year: int) -> Sequence[RegisterRow]:
        return list(register) if year == YEAR else []

    return FinancialAidReportsService(
        store, rules or FakeRules(approved(RULES)), rows, history or FakeReportsStore(), clock=lambda: now
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


async def test_a_cancelled_request_with_no_posted_round_keeps_its_income_tier() -> None:
    """Cancelled pricing has no result, so the tier comes from pricing the request live (tier only: no award)."""
    store = report_season()
    store.cancel_events.append(
        CancelEvent(
            "can000000000002",
            LIAM,
            "cancel",
            NOW - timedelta(days=1),
            reason="aid_not_enough",
            in_kindred=True,
            actor=ACTOR,
        )
    )
    out = await _service(store).statistics(YEAR, table="camp", round_=1)
    three = _tier(out.rows, 3)
    assert (three.apps, three.cancelled, three.amount, three.awarded_count) == (1, 1, 0.0, 0)
    assert all(row.tier is not None for row in out.rows)


async def test_a_cancelled_request_with_no_posted_round_keeps_its_income_tier_on_a_past_date() -> None:
    """The past read fills the cancelled request's tier the way the live read does: it never drops into "no tier"."""
    store = report_season()
    store.cancel_events.append(
        CancelEvent(
            "can000000000002",
            LIAM,
            "cancel",
            NOW - timedelta(days=1),
            reason="aid_not_enough",
            in_kindred=True,
            actor=ACTOR,
        )
    )
    out = await _service(store).statistics(YEAR, table="camp", round_=1, as_of=date(2027, 3, 31))
    three = _tier(out.rows, 3)
    assert (three.apps, three.cancelled, three.amount, three.awarded_count) == (1, 1, 0.0, 0)
    assert all(row.tier is not None for row in out.rows)


async def test_a_past_date_names_the_requests_whose_posted_money_cannot_be_replayed_and_leaves_it_out() -> None:
    """The grid and budget blank a request's posted money when its clawback can't be replayed (3c-2). Reports does the
    same for its awarded: the request stays in apps and asks, its posted money is out of awarded, and a `posted` gap
    names it. (A6c: the same answer as the Requests grid and the budget, never a guess.)"""
    store = report_season()
    store.placements[9001] = Placement(9001, 1000011, 0, "")  # placed now, never logged: Emma's posted is unknown
    seed_line(store, 9001, "1500", person=0, posted=datetime(2027, 3, 9, 18, 0, tzinfo=UTC))
    out = await _service(store).statistics(YEAR, table="camp", round_=1, as_of=date(2027, 3, 31))
    gap = next(g for g in out.not_rebuilt if g.figure == "posted")
    assert gap.requests == [EMMA]
    assert "left out of awarded" in gap.reason  # Reports' own wording, not the grid's cells and strip counts
    two = _tier(out.rows, 2)
    assert (two.apps, two.amount, two.awarded_count, out.total.amount) == (1, 0.0, 0, 0.0)
    assert two.asked == 4000.0  # the ask is not money posted: it stays


async def test_the_posted_gap_names_only_requests_the_reporting_control_keeps() -> None:
    """Emma's posted money can't be replayed, but a received-through cut before her request leaves her out of the
    reading, so the gap does not name her (and says nothing at all)."""
    store = report_season(liam_late=False)
    store.placements[9001] = Placement(9001, 1000011, 0, "")
    seed_line(store, 9001, "1500", person=0, posted=datetime(2027, 3, 9, 18, 0, tzinfo=UTC))
    kept = await _service(store).statistics(YEAR, table="camp", round_=1, as_of=date(2027, 3, 31))
    assert next(g for g in kept.not_rebuilt if g.figure == "posted").requests == [EMMA]
    cut = await _service(store).statistics(
        YEAR, table="camp", round_=1, as_of=date(2027, 3, 31), through=date(2027, 1, 10)
    )
    assert not [g for g in cut.not_rebuilt if g.figure == "posted"]


async def test_a_closed_request_is_neither_awarded_nor_cancelled() -> None:
    """Standing is the request's status: a pending duplicate still counts in apps but is never awarded, even with a
    posted lock, and is not a cancellation."""
    store = report_season()
    store.requests[EMMA] = replace(store.requests[EMMA], status="duplicate_pending")
    out = await _service(store).statistics(YEAR, table="camp", round_=1)
    assert (out.total.apps, out.total.cancelled, out.total.amount) == (2, 0, 0.0)
    assert out.recipients_cancelled == []


async def test_a_withdrawn_request_with_a_posted_award_reads_exactly_like_a_cancelled_twin() -> None:
    """Owner (a) (RULED 2026-10-02): a posted award on a withdrawn request is a forgotten reversal, so Reports counts
    it with "aid recipients who cancelled", figure for figure as a cancelled request with the same award (no reason
    given on either)."""
    cancelled = report_season()
    cancelled.cancel_events.append(
        CancelEvent("can000000000003", EMMA, "cancel", NOW - timedelta(days=1), in_kindred=True)
    )
    withdrawn = report_season()
    withdrawn.requests[EMMA] = replace(withdrawn.requests[EMMA], status="withdrawn")
    twin = await _service(cancelled).statistics(YEAR, table="camp", round_=1)
    out = await _service(withdrawn).statistics(YEAR, table="camp", round_=1)
    assert (out.total.apps, out.total.cancelled, out.cancelled_applicants, out.total.amount) == (2, 1, 1, 0.0)
    # Same count, pool, round and money; only the reason line differs by design: a withdrawal is named, never read as
    # missing data ("no reason recorded" stays the cancelled twin's).
    assert len(out.recipients_cancelled) == len(twin.recipients_cancelled) == 1
    line, twin_line = out.recipients_cancelled[0], twin.recipients_cancelled[0]
    assert (line.pool, line.round, line.requests, line.posted) == (
        twin_line.pool,
        twin_line.round,
        twin_line.requests,
        twin_line.posted,
    )
    assert line.posted == 1500.0
    assert (twin_line.reason, twin_line.reason_label) == ("not_recorded", "no reason recorded")
    assert (line.reason, line.reason_label) == ("withdrawn_in_kindred", "Withdrawn in Kindred")
    assert out.total.model_dump() == twin.total.model_dump()
    assert [r.model_dump() for r in out.rows] == [r.model_dump() for r in twin.rows]


async def test_a_withdrawn_request_whose_award_was_since_reversed_still_counts_as_cancelled_like_its_twin() -> None:
    """The cancelled path counts a clawed-back award too (it reads the lock, not the net Posted), so the withdrawn
    one does: standing is the same for a reversed lock as for a standing one."""
    withdrawn = replace(report_season().requests[EMMA], status="withdrawn")
    reversed_lock = RoundFacts(1, Decimal(4000), Decimal(1500), True, None, False, None, 2, "camp_pool")
    assert _standing(withdrawn, False, (reversed_lock,)) == "cancelled"
    assert _standing(withdrawn, False, (replace(reversed_lock, locked=None),)) == "closed"
    assert _standing(replace(withdrawn, status="active"), False, (reversed_lock,)) == "live"


async def test_a_withdrawn_request_with_no_posted_award_stays_closed() -> None:
    """Owner (a): only a posted award makes a withdrawn request a recipient who cancelled."""
    store = report_season()
    store.requests[LIAM] = replace(store.requests[LIAM], status="withdrawn")  # Liam is decided, never posted
    out = await _service(store).statistics(YEAR, table="camp", round_=1)
    assert (out.total.apps, out.total.cancelled, out.cancelled_applicants) == (2, 0, 0)
    assert out.recipients_cancelled == []


async def test_an_outside_funders_full_cost_round_keeps_its_ask_but_leaves_the_percent_of_ask_denominator() -> None:
    """D121 / owner (c) (RULED 2026-10-02): the round does not count toward the budget, so it is never awarded; its
    ask stays in the asked column but leaves % of ask's denominator (live_asked)."""
    store = report_season()
    store.events[:] = [
        replace(ev, snapshot={**(ev.snapshot or {}), "counts_toward_budget": False}) if ev.request_id == EMMA else ev
        for ev in store.events
    ]
    service = _service(store)
    out = await service.statistics(YEAR, table="camp", round_=1)
    two = _tier(out.rows, 2)
    assert (two.apps, two.asked, two.amount, two.awarded_count) == (1, 4000.0, 0.0, 0)
    assert (two.live_asked, two.pct_of_ask) == (0.0, None)
    assert out.total.live_asked == 2000.0  # Liam's alone
    block = (await service.programs(YEAR)).total.round1
    assert (block.requested, block.pct_awarded) == (6000.0, 0.0)  # asked kept; Liam's 2,000 alone is the denominator


async def test_an_unposted_outside_funders_round_is_never_decided_money_and_leaves_the_denominator() -> None:
    """D121 / owner (c): the budget puts a decided round of a type outside the budget below the line, never in Needs an
    offer. Reports agrees before posting too: no "Decided (not yet offered)" money, and its ask leaves % of ask's
    denominator, so % of ask doesn't move when the round posts."""
    view = RoundView(
        round=3,
        status="needs_offer",
        ask=Decimal(900),
        decided=Decimal(650),
        locked=None,
        accepted=False,
        pending=None,
        would_change_by=None,
        counts_toward_budget=False,
        pool="camp_pool",
        decision_type="discretionary",
    )
    facts = _round(3, view, None, r1_ask=None, tier_now=2, home_pool="camp_pool")
    assert (facts.decided, facts.locked, facts.outside_budget, facts.ask) == (None, None, True, Decimal(900))
    inside = _round(3, replace(view, counts_toward_budget=True), None, r1_ask=None, tier_now=2, home_pool="camp_pool")
    assert (inside.decided, inside.outside_budget) == (Decimal(650), False)


async def test_a_withdrawn_request_whose_posted_money_a_past_date_cannot_replay_still_counts_as_cancelled() -> None:
    """Owner (a): standing reads the lock, whether or not its money was since reversed. A past read that can't replay
    the clawback leaves the money out of awarded (the `posted` gap), but the request was still a recipient that
    withdrew: it stays a cancellation, never "closed"."""
    store = report_season()
    active = store.requests[EMMA]
    store.requests[EMMA] = replace(active, status="withdrawn")  # withdrawn on March 20, logged as 4a logs it
    log_update(
        store, AID_REQUESTS, EMMA, {"status": "active"}, {"status": "withdrawn"}, datetime(2027, 3, 20, tzinfo=UTC)
    )
    store.placements[9001] = Placement(9001, 1000011, 0, "")  # placed now, never logged: Emma's posted is unknown
    seed_line(store, 9001, "1500", person=0, posted=datetime(2027, 3, 9, 18, 0, tzinfo=UTC))
    out = await _service(store).statistics(YEAR, table="camp", round_=1, as_of=date(2027, 3, 31))
    assert (out.total.apps, out.total.cancelled, out.cancelled_applicants, out.total.amount) == (2, 1, 1, 0.0)
    assert [line.posted for line in out.recipients_cancelled] == [1500.0]
    assert not [g for g in out.not_rebuilt if g.figure == "posted"]  # nothing awarded was left out


async def test_a_cancelled_recipient_whose_clawback_a_past_date_cannot_replay_keeps_its_recipients_line() -> None:
    """The recipients-who-cancelled line reads the lock, clawed back since or not, so a clawback the past read can't
    replay changes nothing there: only awarded (a live request's money) is what the `posted` gap leaves out."""
    store = report_season()
    store.cancel_events.append(
        CancelEvent(
            "can000000000001",
            EMMA,
            "cancel",
            datetime(2027, 3, 20, tzinfo=UTC),
            reason="aid_not_enough",
            in_kindred=True,
            actor=ACTOR,
        )
    )
    store.placements[9001] = Placement(9001, 1000011, 0, "")  # placed now, never logged: Emma's posted is unknown
    seed_line(store, 9001, "1500", person=0, posted=datetime(2027, 3, 9, 18, 0, tzinfo=UTC))
    out = await _service(store).statistics(YEAR, table="camp", round_=1, as_of=date(2027, 3, 31))
    assert (out.total.cancelled, out.total.amount) == (1, 0.0)
    [row] = out.recipients_cancelled
    assert (row.reason, row.round, row.requests, row.posted) == ("aid_not_enough", 1, 1, 1500.0)
    assert not [g for g in out.not_rebuilt if g.figure == "posted"]  # never awarded, so nothing was left out


async def test_the_percent_of_ask_column_is_labelled_with_its_numerator_on_each_basis() -> None:
    """Owner (b) (RULED 2026-10-02): on the decided basis % of ask divides Posted + Decided by the asks, and says so."""
    service = _service(report_season())
    assert (await service.statistics(YEAR, table="camp", round_=1)).pct_of_ask_label == "% of ask"
    decided = await service.statistics(YEAR, table="camp", round_=1, basis="posted_and_decided")
    assert decided.pct_of_ask_label == "% of ask (posted + decided)"


async def test_the_committee_cuts_applications_at_the_received_through_date() -> None:
    """Liam was received Feb 20: through Feb 1 he is "since" the cutoff, through Mar 1 he is at it."""
    service = _service(report_season(liam_late=True))
    early = await service.committee(YEAR, through=date(2027, 2, 1))
    camp = next(r for r in early.applications if r.year == YEAR and r.kind == "headline")
    assert (camp.cutoff, camp.at_cutoff.apps, camp.since.apps) == (date(2027, 2, 1), 1, 1)  # type: ignore[union-attr]
    late = await service.committee(YEAR, through=date(2027, 3, 1))
    camp = next(r for r in late.applications if r.year == YEAR and r.kind == "headline")
    assert (camp.cutoff, camp.at_cutoff.apps, camp.since.apps) == (date(2027, 3, 1), 2, 0)  # type: ignore[union-attr]


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


def _equity_recorded(store: FakeDecisionsStore) -> FakeDecisionsStore:
    """Intake's recorded equity copy on every camper request, logged, so 3c-2 prices them (else equity_not_recorded)."""
    for request_id, request in store.requests.items():
        store.requests[request_id] = replace(request, equity=UNKNOWN_EQUITY)
    store.change_log = []
    log_seeded(store, EARLY)  # report_season logged everything at EARLY too; re-log with the equity copy
    return store


def _placed(store: FakeDecisionsStore, row: RegisterRow, at: datetime) -> None:
    """One grant placement logged at `at`, as live pricing logs it (3c-2's own test helper)."""
    store.grant_placements.append(
        PlacementRecord(
            id=f"gpl{len(store.grant_placements):012d}",
            grant=grant_key(row),
            household_cm_id=row.household_cm_id,
            event="place",
            placement=placement_json(row),
            created=at,
        )
    )


async def test_a_past_date_prices_tiers_and_decided_and_names_only_what_it_cannot_rebuild() -> None:
    """3c-2 (D154): a past date is priced, so an unposted round has its tier and Decided works. Nothing is named as a
    standing gap: CampMinder's cancellations are rebuilt too (counted, never nulled)."""
    store = _equity_recorded(report_season())
    store.events = [posted("ev0000000000001", EMMA, 1, "1500", 2, on=date(2027, 3, 5))]
    out = await _service(store).statistics(
        YEAR, table="camp", round_=1, basis="posted_and_decided", as_of=date(2027, 3, 8)
    )
    three = _tier(out.rows, 3)
    assert (three.apps, three.decided) == (1, 1100.0)  # Liam: tier 3, decided and not posted, priced as of Mar 8
    assert all(row.tier is not None for row in out.rows if row.apps)  # nobody is "no tier"
    figures = {gap.figure for gap in out.not_rebuilt}
    assert not figures & {"tier", "decided", "grants"}
    assert figures == {"cancellation"}  # only the caveat: no request is kept from its figures
    assert (out.total.cancelled, out.cancelled_applicants) == (0, 0)  # real counts, not nulled


async def test_a_past_date_reads_grants_where_the_placement_log_had_them() -> None:
    """3c-2: grants on a past date come from the grant placement log as it stood, never a silent $0 or a blank."""
    store = _equity_recorded(report_season())
    row = grant_row(EMMA, "500")  # recorded Feb 10 (decisions_fakes.grant_row)
    _placed(store, row, datetime(2027, 3, 1, 18, 0, tzinfo=UTC))
    out = await _service(store, register=[row]).statistics(YEAR, table="camp", round_=1, as_of=date(2027, 3, 10))
    two = _tier(out.rows, 2)
    assert (two.grants, two.pct_of_ask_with_grants) == (500.0, 50.0)
    assert "grants" not in {g.figure for g in out.not_rebuilt}


async def test_a_request_3c2_cannot_price_adds_no_decided_amount_and_is_named() -> None:
    """D154: never an estimate. Without intake's equity copy Liam can't be priced for the date (equity_not_recorded):
    he adds nothing to Decided and is named with his request id."""
    store = report_season()  # no equity copy: 3c-2 keeps Liam to 3c-1's figures
    out = await _service(store).statistics(
        YEAR, table="camp", round_=1, basis="posted_and_decided", as_of=date(2027, 3, 8)
    )
    assert out.total.decided == 0.0
    gap = next(g for g in out.not_rebuilt if g.figure == "equity_not_recorded")
    assert LIAM in gap.requests


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
    assert all(not gap.requests for gap in out.not_rebuilt if gap.figure == "cancellation")


async def test_a_past_date_carries_a_cancellation_caveat_that_names_no_request() -> None:
    """The Requests grid names a `cancellation` limit on a past date; Reports says the same as a caveat. It carries no
    request ids, so a reader never blanks the counts for it: the counts stand, as of the day."""
    store = report_season()
    stats = await _service(store).statistics(YEAR, table="camp", round_=1, as_of=date(2027, 3, 10))
    programs = await _service(store).programs(YEAR, as_of=date(2027, 3, 10))
    for out in (stats, programs):
        [caveat] = [g for g in out.not_rebuilt if g.figure == "cancellation"]
        assert caveat.requests == []
        assert "changed since" in caveat.reason
    live = await _service(store).statistics(YEAR, table="camp", round_=1)
    assert live.not_rebuilt == []


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


async def test_a_legacy_include_override_row_excludes_nothing_from_reports() -> None:
    """There is no Include override (owner ruling, ⚠5 option c): a correction row written before the ruling is never
    read, so Emma is still an app, her ask is still asked and her posted 1,500 is still awarded."""
    store = report_season()
    store.corrections.append(
        CorrectionRecord(
            id="cor000000000900",
            year=YEAR,
            application_id=store.requests[EMMA].application_id,
            request_id=EMMA,
            field="include_override",
            new_value="excluded",
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
    assert (p.phases, p.total, p.budget, p.gaps) == ([1500.0, 0.0, 0.0], 1500.0, 500000.0, [])
    assert p.reconciliation == 0.0
    camp = next(row for row in out.applications if row.year == YEAR and row.pool == "camp_pool")
    assert camp.cutoff == date(2027, 2, 1)
    assert camp.at_cutoff is not None
    assert camp.at_cutoff.apps == 2
    figures = {item.figure for item in out.not_built}
    assert PHASE_BOUNDARY_GAP not in figures
    assert figures >= {NO_DEADLINE_CUT_GAP, "enrollment_pct_of_goal"}


async def test_the_phase_row_carries_as_offered_and_end_of_season_and_a_cancellation_only_moves_the_second() -> None:
    """Owner N2 = C (RULED 2026-10-02): Emma's 1,500 lock is As offered from the day it posted; once she cancels it
    leaves End of season but stays in As offered."""
    store = report_season()
    live = (await _service(store).committee(YEAR)).phases[-1]
    assert (live.offered, live.phases) == ([1500.0, 0.0, 0.0], [1500.0, 0.0, 0.0])
    assert (live.offered_label, live.end_of_season_label) == ("As offered", "End of season (to date)")
    store.cancel_events.append(CancelEvent("can000000000007", EMMA, "cancel", NOW - timedelta(days=1), in_kindred=True))
    out = (await _service(store).committee(YEAR)).phases[-1]
    assert out.offered == [1500.0, 0.0, 0.0]
    assert out.phases == [0.0, 0.0, 0.0]
    assert (out.offered_pct_of_budget[0], out.pct_of_budget[0]) == (0.3, 0.0)


def _aided_sessions(**ends: str) -> list[SessionRow]:
    return [
        SessionRow(1000101, "Session 2", "main", "2027-06-20", ends.get("summer", "")),
        SessionRow(1000202, "Family Camp 6", "family", "2027-08-20", ends.get("family", "")),
        SessionRow(1000106, "A Quest", "quest", "2027-07-05", ends.get("quest", "")),
        SessionRow(1000999, "Unmapped", "unmapped_type", "2027-10-01", ends.get("unmapped", "")),
    ]


async def _to_date(store: FakeDecisionsStore, day: date, *, rules: Any = None) -> bool:
    now = datetime(day.year, day.month, day.day, 17, 0, tzinfo=UTC)
    return (await _service(store, rules=rules, now=now).committee(YEAR)).phases[-1].to_date


async def test_the_season_is_to_date_until_the_last_aided_session_has_ended() -> None:
    """Coordinator ruling 2026-10-02: closed once EVERY program open to aid has finished, not just summer. Summer
    ended but a later aided family weekend hasn't: still to date; every aided session ended: closed. A session no
    program claims, and one of a program closed to aid, never holds the season open."""
    store = report_season()
    store.sessions = _aided_sessions(
        summer="2027-07-10", family="2027-08-22", quest="2027-12-01", unmapped="2027-12-31"
    )
    closed_to_aid = FakeRules(approved(with_levers(RULES, {"programs.quest.open_to_aid": False})))
    assert await _to_date(store, date(2027, 7, 20), rules=closed_to_aid) is True  # summer ended; the weekend hasn't
    assert await _to_date(store, date(2027, 8, 22), rules=closed_to_aid) is True  # the last day itself is still open
    assert await _to_date(store, date(2027, 8, 23), rules=closed_to_aid) is False  # every aided session has ended
    # The quest is open to aid here, so its December end holds the season open.
    assert await _to_date(store, date(2027, 8, 23)) is True
    assert await _to_date(store, date(2027, 12, 2)) is False


async def test_with_no_session_end_dates_the_season_closes_with_the_calendar_year() -> None:
    store = report_season()
    store.sessions = _aided_sessions()
    assert await _to_date(store, date(2027, 12, 31)) is True
    assert await _to_date(store, date(2028, 1, 2)) is False


async def test_a_typed_phase_row_never_reads_to_date() -> None:
    history = FakeReportsStore()
    history.seed(replace(_figure("phase_awarded", "300000", phase=1), year=2026, as_of=date(2026, 10, 10)))
    out = await _service(report_season(), history).committee(YEAR)
    typed = next(row for row in out.phases if row.basis == "r")
    assert (typed.to_date, typed.end_of_season_label) == (False, "End of season")


async def test_a_bulk_load_round_trips_both_phase_figures_and_the_committee_reads_each_column() -> None:
    """Staff backfill both typed figures as totals: a deck pull (As offered, its own as-of) and the end-of-season
    total, each optional; the response lists both, the committee fills each column from its own figure."""
    history = FakeReportsStore()
    service = _service(report_season(), history)
    out = await service.load_reported(
        [
            _figure("phase_awarded", "250000", phase=1, at="pull", as_of=date(2025, 3, 2)),
            _figure("phase_awarded", "300000", phase=1),
            _figure("phase_awarded", "40000", phase=2),  # only an end-of-season figure
            _figure("phase_awarded", "90000", phase=3, at="pull", as_of=date(2025, 3, 2)),  # only a pull
            _figure("budget", "500000"),
        ],
        actor=FINANCE,
    )
    assert out.created == 5
    stored = await service.reported_history()
    assert {(f.phase, f.at) for f in stored.figures if f.metric == "phase_awarded"} == {
        (1, "pull"),
        (1, "season_end"),
        (2, "season_end"),
        (3, "pull"),
    }
    row = next(r for r in (await service.committee(YEAR)).phases if r.year == 2025)
    assert row.offered == [250000.0, None, 90000.0]
    assert row.offered_as_of == [date(2025, 3, 2), None, date(2025, 3, 2)]
    assert row.phases == [300000.0, 40000.0, None]
    assert (row.offered_pct_of_budget, row.pct_of_budget) == ([50.0, None, 18.0], [60.0, 8.0, None])


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


async def test_a_load_too_large_for_one_logged_batch_is_refused_as_a_422_never_a_500() -> None:
    """The route takes up to 2,000 figures, but every write carries its change-log row in ONE batch, so more than half
    PocketBase's batch limit can't commit as one operation: the load is refused, asking for a split, not left to
    4a's BatchLimitError (an uncaught ValueError, a 500)."""
    history = FakeReportsStore()
    figures = [
        replace(_figure("r1_apps", "1"), year=2027, at="pull", as_of=date(2026, 1, 1) + timedelta(days=n))
        for n in range(1001)
    ]
    with pytest.raises(ReportsRefusedError, match="split"):
        await _service(report_season(), history).load_reported(figures, actor=FINANCE)
    assert history.rows == []


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
