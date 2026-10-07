"""Decisions service (sub-project 10a): the season priced and its reads (Task 6), and each round's
asks, amounts and ticks (Task 7). Fictional only; every write runs the real 4a helper over a fake
batch. Figures: Session 2 costs 2,000, so a tier-2 family's Round 1 is 1,500 (see decisions_fakes)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

import api.schemas.financial_aid_decisions as schemas
from api.schemas.financial_aid_decisions import (
    AcceptedIn,
    AskIn,
    CellOut,
    ChangedRowOut,
    PostedIn,
    PostedRow,
    Round3AmountIn,
    Round3ApprovalIn,
    RoundRef,
    UnpostIn,
)
from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository, decision_event
from api.services.financial_aid_decisions_service import (
    DecisionChangedError,
    DecisionNotFoundError,
    DecisionRefusedError,
    FinancialAidDecisionsService,
)
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_intake_types import EquityAnswers
from bunking.financial_aid.decisions import DecisionEvent, fold_rounds
from tests.unit.api.services.decisions_fakes import (
    ACTOR,
    T0,
    FakeDecisionsStore,
    FakeRules,
    approved,
    grant_row,
    seed_request,
)
from tests.unit.api.services.financial_aid_fakes import YEAR, intake_rules
from tests.unit.bunking.financial_aid.fixtures import with_lever

EMMA = "reqemma00000001"
LIAM = "reqliam00000001"


@pytest.fixture(autouse=True)
def _today_is_after_the_fictional_dates(monkeypatch: pytest.MonkeyPatch) -> None:
    """The writes refuse a date after today; the fixtures' dates sit in the fictional 2027 season."""
    monkeypatch.setattr(schemas, "today", lambda: date(2027, 12, 31))


def _service(
    store: FakeDecisionsStore, rules: FakeRules | None = None, register: Sequence[RegisterRow] = ()
) -> FinancialAidDecisionsService:
    async def rows(year: int) -> Sequence[RegisterRow]:
        return register

    return FinancialAidDecisionsService(store, rules or FakeRules(approved()), rows, clock=lambda: T0)


def _event(store: FakeDecisionsStore, request_id: str, n: int, kind: Any, **fields: Any) -> None:
    store.events.append(
        DecisionEvent(id=f"ev{len(store.events):013d}", request_id=request_id, round=n, kind=kind, created=T0, **fields)
    )


def _posted(store: FakeDecisionsStore, request_id: str, n: int, amount: str) -> None:
    _event(
        store,
        request_id,
        n,
        "post",
        amount=Decimal(amount),
        effective_on=date(2027, 3, 9),
        lock_source="tick",
        rules_version=1,
        snapshot={"pool": "camp_pool", "counts_toward_budget": True},
    )


# --- the repository ---------------------------------------------------------------------------


def _record(**fields: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "id": "dec000000000001",
        "request": EMMA,
        "round": 2,
        "event": "ask",
        "amount": 400,
        "effective_on": "2027-03-20 00:00:00.000Z",
        "statement_of_need": "",
        "decision_type": "",
        "needs_approval": False,
        "lock_source": "",
        "rules_version": 0,
        "snapshot": None,
        "note": "Family emailed Mar 20",
        "actor": ACTOR,
        "created": "2027-03-21 17:00:00.000Z",
    }
    return SimpleNamespace(**{**base, **fields})


def test_a_record_becomes_an_event() -> None:
    event = decision_event(_record())
    assert (event.kind, event.round, event.amount, event.effective_on) == ("ask", 2, Decimal(400), date(2027, 3, 20))
    assert (event.rules_version, event.snapshot, event.note) == (None, None, "Family emailed Mar 20")


def test_an_event_that_carries_no_amount_reads_none_not_the_zero_pocketbase_stores() -> None:
    assert decision_event(_record(event="accept", amount=0)).amount is None


def test_a_snapshot_stored_as_json_text_comes_back_as_a_dict() -> None:
    assert decision_event(_record(event="post", snapshot='{"pool": "camp_pool"}')).snapshot == {"pool": "camp_pool"}


def test_an_unknown_event_is_refused() -> None:
    with pytest.raises(ValueError, match="unknown event"):
        decision_event(_record(event="offer"))


@pytest.mark.asyncio
async def test_events_are_read_by_season_in_recorded_order() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = []
    await FinancialAidDecisionsRepository(pb).fetch_decision_events(YEAR)
    pb.collection.assert_called_with("aid_decisions")
    query = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert query == {"filter": f"year = {YEAR}", "sort": "created,id"}


@pytest.mark.asyncio
async def test_a_requests_events_are_read_only_by_a_well_formed_record_id() -> None:
    with pytest.raises(ValueError, match="record id"):
        await FinancialAidDecisionsRepository(MagicMock()).fetch_request_events('x" || year > 0 || "')


# --- the reads (Task 6) ------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_grid_prices_every_request_with_its_names_and_rounds() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    out = await _service(store).grid(YEAR)
    assert out.rules_version == 1
    (row,) = out.rows
    assert (row.family_name, row.camper_name, row.session_name, row.pool, row.tier, row.cost) == (
        "Family 1000001",
        "Camper 1000011",
        "Session 2",
        "camp_pool",
        2,
        2000.0,
    )
    (r1,) = row.rounds
    assert (r1.round, r1.status, r1.ask, r1.decided, r1.posted) == (1, "needs_offer", 4000.0, 1500.0, None)
    assert (row.total_decided, row.total_posted) == (1500.0, None)


@pytest.mark.asyncio
async def test_the_grid_says_the_season_is_not_ticked_before_the_first_ticked_season() -> None:
    assert (await _service(FakeDecisionsStore()).grid(2026)).ticked_season is False


@pytest.mark.asyncio
async def test_the_grid_says_the_first_ticked_season_is_ticked_live_and_on_a_past_date() -> None:
    service = _service(FakeDecisionsStore())
    assert (await service.grid(2027)).ticked_season is True
    # The day before T0's camp date: today (March 9) would be the live read again.
    past = await service.grid(2027, as_of=date(2027, 3, 8))
    assert past.as_of == date(2027, 3, 8)
    assert past.ticked_season is True


@pytest.mark.asyncio
async def test_each_grid_row_names_the_requests_views_it_is_in() -> None:
    """Slice 1 (D21): queue membership is the server's; Today counts the same memberships."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    _posted(store, LIAM, 1, "1500")
    rows = {row.request_id: row for row in (await _service(store).grid(YEAR)).rows}
    assert rows[EMMA].queues == ["needs_offer"]
    # Ticked by hand, and nothing of it in CampMinder yet: the family hasn't accepted. No sync has run since the tick,
    # so it is no Not reconciled exception yet (V1, owner 10-03: its CM ✓ reads pending).
    assert rows[LIAM].queues == ["waiting_on_family"]


@pytest.mark.asyncio
async def test_a_posted_round_shows_its_lock_and_the_day_it_was_posted() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    (row,) = (await _service(store).grid(YEAR)).rows
    (r1,) = row.rounds
    assert (r1.status, r1.posted, r1.posted_on, r1.rules_version) == ("posted", 1500.0, date(2027, 3, 9), 1)
    assert (row.total_decided, row.total_posted) == (1500.0, 1500.0)


@pytest.mark.asyncio
async def test_a_posted_round_the_rules_now_price_differently_carries_no_would_change_figure() -> None:
    """Owner 2026-10-05: posted rounds are history. Round 1 posted at $1,300 while today's rules work it out to $1,500
    keeps its $1,300 and says nothing about the difference: `would_change_by` is never emitted (it stays on the schema,
    always null, until slice 1 lands)."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1300")
    (row,) = (await _service(store).grid(YEAR)).rows
    (r1,) = row.rounds
    assert (r1.status, r1.posted, r1.decided, r1.would_change_by) == ("posted", 1300.0, 1300.0, None)


@pytest.mark.asyncio
async def test_the_budget_read_sends_committed_and_share_and_no_round_allocation() -> None:
    """Spec §9.4: new fields optional; a round's allocated and remaining are sent as null (§8.1)."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    _posted(store, LIAM, 1, "1500")
    budget = await _service(store).budget(YEAR)
    camp = next(p for p in budget.pools if p.pool == "camp_pool")
    r1 = next(c for c in camp.rounds if c.round == 1)
    assert (r1.allocated, r1.remaining, r1.committed) == (None, None, 3000.0)
    assert (camp.share_pct, camp.total.allocated, camp.total.committed, camp.total.remaining) == (
        80.0,
        400000.0,
        3000.0,
        397000.0,
    )
    assert budget.total.share_pct is None
    assert budget.total.total.allocated == 500000.0


def test_committed_and_share_are_optional_so_old_fixtures_still_validate() -> None:
    """No new REQUIRED field (Global Constraints): a cell without `committed` still validates."""
    cell = CellOut(allocated=None, posted=0, accepted=0, needs_offer=0, pending_approval=0, remaining=None)
    assert cell.committed is None


@pytest.mark.asyncio
async def test_the_budget_and_the_remaining_line_count_posted_and_needs_an_offer() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    _posted(store, LIAM, 1, "1500")
    service = _service(store)
    budget = await service.budget(YEAR)
    camp = next(p for p in budget.pools if p.pool == "camp_pool")
    r1 = next(c for c in camp.rounds if c.round == 1)
    assert (r1.posted, r1.needs_offer, camp.total.allocated, camp.total.remaining) == (
        1500.0,
        1500.0,
        400000.0,
        397000.0,
    )
    strip = next(s for s in budget.strip if s.round == 1)
    assert strip.needs_offer is not None
    assert strip.posted is not None
    assert (strip.needs_offer.requests, strip.posted.requests) == (1, 1)
    remaining = await service.remaining(YEAR)
    assert [(p.pool, p.remaining) for p in remaining.pools] == [
        ("camp_pool", 397000.0),
        ("weekend_pool", 75000.0),
        ("bmitzvah_pool", 25000.0),
    ]
    assert remaining.total == 497000.0


@pytest.mark.asyncio
async def test_a_withdrawn_request_keeps_its_posted_money_in_the_budget() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, status="withdrawn")
    _posted(store, EMMA, 1, "1500")
    budget = await _service(store).budget(YEAR)
    camp = next(p for p in budget.pools if p.pool == "camp_pool")
    r1 = next(c for c in camp.rounds if c.round == 1)
    assert (r1.posted, r1.needs_offer) == (1500.0, 0.0)


@pytest.mark.asyncio
async def test_with_no_approved_rules_every_live_request_is_held_and_nothing_is_allocated() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store, FakeRules(None))
    (row,) = (await service.grid(YEAR)).rows
    assert row.rounds[0].status == "held"
    assert [h.code for h in row.holds] == ["no_approved_rules"]
    remaining = await service.remaining(YEAR)
    assert (remaining.pools, remaining.total) == ([], None)


@pytest.mark.asyncio
async def test_a_request_with_an_unmatched_session_is_held_with_intakes_reasons() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, session=0, status="unmatched_session")
    (row,) = (await _service(store).grid(YEAR)).rows
    assert row.rounds[0].status == "held"
    assert {"unmatched_session", "not_priceable"} <= {h.code for h in row.holds}


@pytest.mark.asyncio
async def test_outside_grants_reach_the_calculator_and_sit_below_the_line() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store, register=[grant_row(EMMA, "500"), grant_row(EMMA, "750", on_request=False)])
    (row,) = (await service.grid(YEAR)).rows
    assert row.rounds[0].decided == 1000.0
    budget = await service.budget(YEAR)
    camp = next(p for p in budget.pools if p.pool == "camp_pool")
    assert (camp.below.outside_grants, budget.outside_grants_off_requests) == (500.0, 750.0)


@pytest.mark.asyncio
async def test_a_pays_after_camp_aid_grant_never_lowers_the_award_but_sits_below_the_line() -> None:
    """D143: a last-dollar funder is posted at the full session price and pays what the camp's award leaves,
    so the calculator never sees it (the award stays 1,500, not 0) and no above-cost hold fires. It
    is still outside money, so the budget shows it below the line with the other outside grants."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store, register=[grant_row(EMMA, "2000", pays_after_camp_aid=True)])
    (row,) = (await service.grid(YEAR)).rows
    assert row.rounds[0].decided == 1500.0
    assert "award_above_cost" not in {h.code for h in row.holds}
    budget = await service.budget(YEAR)
    camp = next(p for p in budget.pools if p.pool == "camp_pool")
    assert camp.below.outside_grants == 2000.0


@pytest.mark.asyncio
async def test_an_incentive_line_never_reaches_the_calculator() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    (row,) = (await _service(store, register=[grant_row(EMMA, "500", funder_type="incentive")]).grid(YEAR)).rows
    assert row.rounds[0].decided == 1500.0


# --- the writes (Task 7) -----------------------------------------------------------------------


def _ask(n: int, amount: str, **fields: Any) -> AskIn:
    return AskIn(round=n, amount=Decimal(amount), asked_on=date(2027, 3, 20), **fields)


def _tick(*rows: tuple[str, int, str]) -> PostedIn:
    return PostedIn(
        rows=[PostedRow(request_id=r, round=n, amount=Decimal(a)) for r, n, a in rows],
        posted_on=date(2027, 3, 9),
    )


def _round3_ready(store: FakeDecisionsStore) -> None:
    """Round 1 posted, an appeal keyed, and the family's Round 3 ask with its statement of need."""
    _posted(store, EMMA, 1, "1500")
    _event(store, EMMA, 2, "ask", amount=Decimal(400))
    _event(store, EMMA, 3, "ask", amount=Decimal(500), statement_of_need="A parent lost their job")


@pytest.mark.asyncio
async def test_an_appeal_ask_is_recorded_dated_before_anything_is_decided() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    service = _service(store)
    out = await service.key_ask(EMMA, _ask(2, "400", note="Family emailed Mar 20"), ACTOR)
    assert (out.written, out.unchanged) == (1, 0)
    ask = store.events[-1]
    assert (ask.kind, ask.round, ask.amount, ask.effective_on, ask.actor) == (
        "ask",
        2,
        Decimal(400),
        date(2027, 3, 20),
        ACTOR,
    )
    (log,) = store.log
    assert (log["entity"], log["entity_id"], log["action"], log["reason"], log["operation_id"]) == (
        "aid_decisions",
        f"{EMMA}:2",
        "ask",
        "Family emailed Mar 20",
        out.operation_id,
    )
    (row,) = (await service.grid(YEAR)).rows
    r2 = row.rounds[1]
    assert (r2.status, r2.ask, r2.asked_on, r2.decided) == ("needs_offer", 400.0, date(2027, 3, 20), 300.0)


@pytest.mark.asyncio
async def test_an_appeal_answers_a_posted_offer() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    with pytest.raises(
        DecisionRefusedError, match=r"^Round 1 needs to show as posted before you can start an appeal\. "
    ):
        await _service(store).key_ask(EMMA, _ask(2, "400"), ACTOR)
    assert store.operations == []


def test_a_round_3_ask_needs_its_statement_of_need_and_only_round_3_has_one() -> None:
    with pytest.raises(ValidationError, match="statement of need"):
        _ask(3, "500")
    with pytest.raises(ValidationError, match="only a Round 3 ask"):
        _ask(2, "400", statement_of_need="A parent lost their job")


@pytest.mark.asyncio
async def test_a_round_3_asks_statement_of_need_is_its_logged_reason() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    _event(store, EMMA, 2, "ask", amount=Decimal(400))
    await _service(store).key_ask(EMMA, _ask(3, "500", statement_of_need="A parent lost their job"), ACTOR)
    assert store.log[-1]["reason"] == "A parent lost their job"
    assert store.events[-1].statement_of_need == "A parent lost their job"


@pytest.mark.asyncio
async def test_resending_the_same_ask_writes_nothing() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    service = _service(store)
    await service.key_ask(EMMA, _ask(2, "400"), ACTOR)
    again = await service.key_ask(EMMA, _ask(2, "400"), ACTOR)
    assert (again.written, again.unchanged, again.operation_id) == (0, 1, "")
    assert len(store.operations) == 1


@pytest.mark.asyncio
async def test_resending_the_same_ask_with_a_changed_note_keeps_the_note() -> None:
    """The screen shows the save, so the note must persist: it is recorded as one more ask event carrying the note,
    one change row under its own operation, and the round reads as it did."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    service = _service(store)
    await service.key_ask(EMMA, _ask(2, "400", note="Family emailed Mar 20"), ACTOR)
    again = await service.key_ask(EMMA, _ask(2, "400", note="Family called, same amount"), ACTOR)
    assert (again.written, again.unchanged) == (1, 0)
    assert again.operation_id != ""
    assert len(store.operations) == 2
    assert [e.note for e in store.events if e.kind == "ask" and e.round == 2] == [
        "Family emailed Mar 20",
        "Family called, same amount",
    ]
    assert store.log[-1]["operation_id"] == again.operation_id
    assert sum(1 for row in store.log if row["operation_id"] == again.operation_id) == 1
    asks = [e for e in store.events if e.kind == "ask" and e.round == 2]
    cut = asks[0].created
    now = fold_rounds(store.events)[EMMA][2]
    then = fold_rounds(store.events, as_of=cut)[EMMA][2]
    assert (now.ask, now.asked_on) == (then.ask, then.asked_on) == (Decimal(400), date(2027, 3, 20))


@pytest.mark.asyncio
async def test_resending_the_same_ask_with_the_same_note_still_writes_nothing() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    service = _service(store)
    await service.key_ask(EMMA, _ask(2, "400", note="Family emailed Mar 20"), ACTOR)
    again = await service.key_ask(EMMA, _ask(2, "400", note="Family emailed Mar 20"), ACTOR)
    blank = await service.key_ask(EMMA, _ask(2, "400"), ACTOR)
    assert [(r.written, r.unchanged, r.operation_id) for r in (again, blank)] == [(0, 1, ""), (0, 1, "")]
    assert len(store.operations) == 1


@pytest.mark.asyncio
async def test_a_changed_amount_is_written_as_before_whatever_the_note() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    service = _service(store)
    await service.key_ask(EMMA, _ask(2, "400", note="Family emailed Mar 20"), ACTOR)
    moved = await service.key_ask(EMMA, _ask(2, "450", note="Family emailed Mar 20"), ACTOR)
    assert (moved.written, moved.unchanged) == (1, 0)
    assert store.events[-1].amount == Decimal(450)


@pytest.mark.asyncio
async def test_a_posted_rounds_ask_cannot_change() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    _event(store, EMMA, 2, "ask", amount=Decimal(400))
    _posted(store, EMMA, 2, "300")
    with pytest.raises(DecisionRefusedError, match="Round 2 is posted"):
        await _service(store).key_ask(EMMA, _ask(2, "600"), ACTOR)


@pytest.mark.asyncio
async def test_a_request_that_is_not_live_takes_no_new_ask() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, status="withdrawn")
    with pytest.raises(DecisionRefusedError, match="withdrawn"):
        await _service(store).key_ask(EMMA, _ask(2, "400"), ACTOR)


@pytest.mark.asyncio
async def test_an_unknown_request_is_not_found() -> None:
    with pytest.raises(DecisionNotFoundError):
        await _service(FakeDecisionsStore()).key_ask(EMMA, _ask(2, "400"), ACTOR)


@pytest.mark.asyncio
async def test_a_round_3_amount_needs_the_familys_ask_first() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    with pytest.raises(DecisionRefusedError, match="Round 3 ask"):
        await _service(store).key_round3_amount(EMMA, Round3AmountIn(amount=Decimal(350)), ACTOR, can_approve=False)


@pytest.mark.asyncio
async def test_a_round_3_amount_above_the_registrars_limit_waits_for_finance() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, session=1000102)  # costs 4,000: 1,500 + 400 + 500 stays under it
    _round3_ready(store)
    rules = FakeRules(approved(with_lever(intake_rules(), "round3.registrar_limit", "400")))
    service = _service(store, rules)
    out = await service.key_round3_amount(EMMA, Round3AmountIn(amount=Decimal(500)), ACTOR, can_approve=False)
    assert out.pending_approval
    (row,) = (await service.grid(YEAR)).rows
    assert (row.rounds[2].status, row.rounds[2].pending_approval) == ("pending_approval", 500.0)
    camp = next(p for p in (await service.budget(YEAR)).pools if p.pool == "camp_pool")
    assert next(c for c in camp.rounds if c.round == 3).pending_approval == 500.0
    within = await service.key_round3_amount(EMMA, Round3AmountIn(amount=Decimal(400)), ACTOR, can_approve=False)
    assert not within.pending_approval
    (row,) = (await service.grid(YEAR)).rows
    assert (row.rounds[2].status, row.rounds[2].decided) == ("needs_offer", 400.0)


@pytest.mark.asyncio
async def test_finances_own_round_3_amount_is_approved_at_once() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _round3_ready(store)
    out = await _service(store).key_round3_amount(EMMA, Round3AmountIn(amount=Decimal(500)), ACTOR, can_approve=True)
    assert not out.pending_approval
    assert store.events[-1].needs_approval is False


@pytest.mark.asyncio
async def test_finance_approves_or_refuses_a_pending_round_3_amount() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, session=1000102)  # costs 4,000: 1,500 + 400 + 500 stays under it
    _round3_ready(store)
    service = _service(store)  # the season sets no limit, so every registrar amount waits
    await service.key_round3_amount(EMMA, Round3AmountIn(amount=Decimal(500)), ACTOR, can_approve=False)
    await service.decide_round3(EMMA, Round3ApprovalIn(approve=True, note="Finance, Jun 2"), "finance@example.com")
    (row,) = (await service.grid(YEAR)).rows
    assert (row.rounds[2].status, row.rounds[2].decided) == ("needs_offer", 500.0)
    again = await service.decide_round3(EMMA, Round3ApprovalIn(approve=True, note="again"), "finance@example.com")
    assert again.written == 0
    with pytest.raises(DecisionRefusedError, match="waiting for finance"):
        await service.decide_round3(EMMA, Round3ApprovalIn(approve=False, note="No"), "finance@example.com")


@pytest.mark.asyncio
async def test_a_refused_round_3_amount_counts_nowhere() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _round3_ready(store)
    service = _service(store)
    await service.key_round3_amount(EMMA, Round3AmountIn(amount=Decimal(500)), ACTOR, can_approve=False)
    await service.decide_round3(EMMA, Round3ApprovalIn(approve=False, note="Finance, Jun 2"), "finance@example.com")
    (row,) = (await service.grid(YEAR)).rows
    assert (row.rounds[2].status, row.rounds[2].decided, row.rounds[2].pending_approval) == ("refused", None, None)


@pytest.mark.asyncio
async def test_ticking_posted_locks_the_decided_amount_with_its_receipt_version_and_sections() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    rules = FakeRules(approved())
    out = await _service(store, rules).tick_posted(YEAR, _tick((EMMA, 1, "1500")), ACTOR)
    assert (out.written, out.unchanged, out.total_locked, out.sections_not_locked) == (1, 0, 1500.0, [])
    post = store.events[-1]
    assert (post.kind, post.amount, post.rules_version, post.lock_source, post.effective_on) == (
        "post",
        Decimal(1500),
        1,
        "tick",
        date(2027, 3, 9),
    )
    assert post.snapshot is not None
    assert (post.snapshot["pool"], post.snapshot["result"]["r1"]) == ("camp_pool", "1500")
    sections = ("award_tables", "awards", "cost", "equity", "grants", "income", "programs", "tiers")
    assert rules.lock_calls == [(YEAR, 1, sections)]
    assert len(store.operations) == 1
    assert len(store.rules_writes) == len(sections)
    assert "snapshot" not in store.log[0]["after"]  # the row keeps the receipt; the log keeps what changed


@pytest.mark.asyncio
async def test_a_tick_whose_amount_moved_writes_nothing_and_names_the_row() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    with pytest.raises(DecisionChangedError) as raised:
        await _service(store).tick_posted(YEAR, _tick((EMMA, 1, "1400")), ACTOR)
    assert raised.value.rows == [ChangedRowOut(request_id=EMMA, round=1, confirmed=1400.0, decided_now=1500.0)]
    assert store.operations == []
    # The household page ticks one amount and has no rows to check, so the message must not point at rows.
    assert str(raised.value) == (
        "A decided amount moved since it was shown, so nothing was posted: check the amount and mark it posted again"
    )


@pytest.mark.asyncio
async def test_one_row_that_cannot_be_posted_stops_the_whole_tick() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021, income=500.0)  # a placeholder income holds
    # A held row is refused before amounts are compared, so any amount will do.
    with pytest.raises(DecisionRefusedError, match=f"{LIAM}: Round 1 is on hold"):
        await _service(store).tick_posted(YEAR, _tick((EMMA, 1, "1500"), (LIAM, 1, "1500")), ACTOR)
    assert store.operations == []


@pytest.mark.asyncio
async def test_resending_a_tick_writes_nothing() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store)
    await service.tick_posted(YEAR, _tick((EMMA, 1, "1500")), ACTOR)
    again = await service.tick_posted(YEAR, _tick((EMMA, 1, "1500")), ACTOR)
    assert (again.written, again.unchanged, again.operation_id) == (0, 1, "")
    assert len(store.operations) == 1


@pytest.mark.asyncio
async def test_a_later_round_is_ticked_only_with_or_after_the_one_before_it() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _event(store, EMMA, 2, "ask", amount=Decimal(400))  # recorded directly: the service would refuse it
    service = _service(store)
    with pytest.raises(DecisionRefusedError, match=f"^{EMMA}: mark Round 1 posted before Round 2$"):
        await service.tick_posted(YEAR, _tick((EMMA, 2, "300")), ACTOR)
    both = await service.tick_posted(YEAR, _tick((EMMA, 1, "1500"), (EMMA, 2, "300")), ACTOR)
    assert both.written == 2


@pytest.mark.asyncio
async def test_the_tick_names_rules_sections_that_did_not_lock() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    rules = FakeRules(approved())
    rules.not_locked = ["income"]
    out = await _service(store, rules).tick_posted(YEAR, _tick((EMMA, 1, "1500")), ACTOR)
    assert (out.written, out.sections_not_locked) == (1, ["income"])


@pytest.mark.asyncio
async def test_a_tick_with_no_approved_rules_is_refused() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    with pytest.raises(DecisionRefusedError, match="not approved"):
        await _service(store, FakeRules(None)).tick_posted(YEAR, _tick((EMMA, 1, "1500")), ACTOR)


@pytest.mark.asyncio
async def test_undo_posted_waits_for_accepted_to_be_unticked_then_reopens_the_round() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    service = _service(store)
    await service.tick_accepted(YEAR, AcceptedIn(rows=[RoundRef(request_id=EMMA, round=1)], accepted=True), ACTOR)
    undo = UnpostIn(request_id=EMMA, round=1, reason="Ticked the wrong family")
    with pytest.raises(DecisionRefusedError, match="Uncheck Accepted"):
        await service.undo_posted(YEAR, undo, ACTOR)
    await service.tick_accepted(YEAR, AcceptedIn(rows=[RoundRef(request_id=EMMA, round=1)], accepted=False), ACTOR)
    out = await service.undo_posted(YEAR, undo, ACTOR)
    assert out.written == 1
    assert store.log[-1]["reason"] == "Ticked the wrong family"
    (row,) = (await service.grid(YEAR)).rows
    assert row.rounds[0].status == "needs_offer"


@pytest.mark.asyncio
async def test_undoing_a_round_that_is_not_posted_writes_nothing() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    out = await _service(store).undo_posted(YEAR, UnpostIn(request_id=EMMA, round=1, reason="retry"), ACTOR)
    assert (out.written, out.unchanged) == (0, 1)
    assert store.operations == []


@pytest.mark.asyncio
async def test_undo_is_refused_while_a_later_round_is_posted() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    _event(store, EMMA, 2, "ask", amount=Decimal(400))
    _posted(store, EMMA, 2, "300")
    with pytest.raises(DecisionRefusedError, match="Round 2 is posted"):
        await _service(store).undo_posted(YEAR, UnpostIn(request_id=EMMA, round=1, reason="x"), ACTOR)


@pytest.mark.asyncio
async def test_accepted_ticks_only_posted_rounds_and_resending_writes_nothing() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    _posted(store, EMMA, 1, "1500")
    service = _service(store)
    with pytest.raises(DecisionRefusedError, match=f"{LIAM}: Round 1 is not posted"):
        await service.tick_accepted(YEAR, AcceptedIn(rows=[RoundRef(request_id=LIAM, round=1)], accepted=True), ACTOR)
    first = await service.tick_accepted(
        YEAR, AcceptedIn(rows=[RoundRef(request_id=EMMA, round=1)], accepted=True), ACTOR
    )
    again = await service.tick_accepted(
        YEAR, AcceptedIn(rows=[RoundRef(request_id=EMMA, round=1)], accepted=True), ACTOR
    )
    assert (first.written, again.written, again.unchanged) == (1, 0, 1)
    camp = next(p for p in (await service.budget(YEAR)).pools if p.pool == "camp_pool")
    assert next(c for c in camp.rounds if c.round == 1).accepted == 1500.0


@pytest.mark.asyncio
async def test_resending_the_same_round_3_amount_writes_nothing() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA, session=1000102)
    _round3_ready(store)
    service = _service(store)
    first = await service.key_round3_amount(EMMA, Round3AmountIn(amount=Decimal(350)), ACTOR, can_approve=False)
    events, logs, ops = len(store.events), len(store.log), len(store.operations)
    again = await service.key_round3_amount(EMMA, Round3AmountIn(amount=Decimal(350)), ACTOR, can_approve=False)
    assert first.written == 1
    assert (again.written, again.unchanged, again.operation_id) == (0, 1, "")
    assert (len(store.events), len(store.log), len(store.operations)) == (events, logs, ops)


_BAD_ID = "not a valid id'\""


@pytest.mark.asyncio
async def test_a_write_on_a_malformed_request_id_is_not_found_never_a_500() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store)
    calls = [
        service.key_ask(_BAD_ID, _ask(2, "400"), ACTOR),
        service.key_round3_amount(_BAD_ID, Round3AmountIn(amount=Decimal(350)), ACTOR, can_approve=True),
        service.decide_round3(_BAD_ID, Round3ApprovalIn(approve=True, note="x"), ACTOR),
        service.undo_posted(YEAR, UnpostIn.model_construct(request_id=_BAD_ID, round=1, reason="x"), ACTOR),
    ]
    for call in calls:
        with pytest.raises(DecisionNotFoundError):
            await call
    assert store.operations == []


_NO_ROUND_2 = FakeRules(approved(with_lever(intake_rules(), "round3.require_round2", False)))


async def _key_round_3(store: FakeDecisionsStore) -> FinancialAidDecisionsService:
    """A Round 3 amount of 250 with no Round 2 (the rules' Round 2 requirement lifted)."""
    _event(store, EMMA, 3, "ask", amount=Decimal(500), statement_of_need="A parent lost their job")
    service = _service(store, _NO_ROUND_2)
    await service.key_round3_amount(EMMA, Round3AmountIn(amount=Decimal(250)), ACTOR, can_approve=True)
    return service


@pytest.mark.asyncio
async def test_a_tick_too_big_for_one_batch_is_refused_to_mark_posted_in_smaller_groups() -> None:
    """The refusal's words say Mark posted, as the button does (D162/O4), never "tick"."""
    from bunking.pocketbase_batch import BatchLimitError

    store = FakeDecisionsStore()
    seed_request(store, EMMA)

    async def commit(*args: object, **kwargs: object) -> None:
        raise BatchLimitError("too many")

    store.commit = commit  # type: ignore[method-assign,assignment]
    with pytest.raises(DecisionRefusedError) as raised:
        await _service(store).tick_posted(YEAR, _tick((EMMA, 1, "1500")), ACTOR)
    assert str(raised.value) == "1 rounds are too many to mark posted at once; mark them posted in smaller groups"


@pytest.mark.asyncio
async def test_a_round_3_tick_is_refused_while_an_earlier_round_is_unposted_even_without_a_round_2() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = await _key_round_3(store)
    ops = len(store.operations)
    with pytest.raises(DecisionRefusedError, match=f"^{EMMA}: mark Round 1 posted before Round 3$"):
        await service.tick_posted(YEAR, _tick((EMMA, 3, "250")), ACTOR)
    assert len(store.operations) == ops
    both = await service.tick_posted(YEAR, _tick((EMMA, 1, "1500"), (EMMA, 3, "250")), ACTOR)
    assert both.written == 2


@pytest.mark.asyncio
async def test_undo_is_refused_while_any_later_round_is_posted_even_without_a_round_2() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    service = await _key_round_3(store)
    await service.tick_posted(YEAR, _tick((EMMA, 3, "250")), ACTOR)
    ops = len(store.operations)
    with pytest.raises(DecisionRefusedError, match="Round 3 is posted"):
        await service.undo_posted(YEAR, UnpostIn(request_id=EMMA, round=1, reason="x"), ACTOR)
    assert len(store.operations) == ops


@pytest.mark.asyncio
async def test_a_tick_naming_one_round_with_two_amounts_is_refused_but_an_exact_repeat_collapses() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    service = _service(store)
    with pytest.raises(DecisionRefusedError, match=f"{EMMA}: Round 1 appears twice"):
        await service.tick_posted(YEAR, _tick((EMMA, 1, "1500"), (EMMA, 1, "1400")), ACTOR)
    assert store.operations == []
    out = await service.tick_posted(YEAR, _tick((EMMA, 1, "1500"), (EMMA, 1, "1500")), ACTOR)
    assert out.written == 1


# --- final review guards -----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_ask_is_refused_while_a_later_round_is_posted() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    service = await _key_round_3(store)
    await service.tick_posted(YEAR, _tick((EMMA, 3, "250")), ACTOR)
    ops = len(store.operations)
    with pytest.raises(DecisionRefusedError, match="Round 3 is posted"):
        await service.key_ask(EMMA, _ask(2, "400"), ACTOR)
    assert len(store.operations) == ops


@pytest.mark.asyncio
async def test_a_round_3_amount_is_refused_without_a_round_2_ask_while_the_rules_require_one() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted(store, EMMA, 1, "1500")
    _event(store, EMMA, 3, "ask", amount=Decimal(500), statement_of_need="A parent lost their job")
    with pytest.raises(DecisionRefusedError, match="Round 2"):
        await _service(store).key_round3_amount(EMMA, Round3AmountIn(amount=Decimal(350)), ACTOR, can_approve=True)
    assert store.operations == []
    lenient = FakeRules(approved(with_lever(intake_rules(), "round3.require_round2", False)))
    out = await _service(store, lenient).key_round3_amount(
        EMMA, Round3AmountIn(amount=Decimal(350)), ACTOR, can_approve=True
    )
    assert out.written == 1


def test_a_write_dated_after_today_is_refused() -> None:
    row = PostedRow(request_id=EMMA, round=1, amount=Decimal(1500))
    assert PostedIn(rows=[row], posted_on=date(2027, 12, 31)).posted_on == date(2027, 12, 31)
    with pytest.raises(ValidationError, match="future"):
        PostedIn(rows=[row], posted_on=date(2028, 1, 1))
    with pytest.raises(ValidationError, match="future"):
        AskIn(round=2, amount=Decimal(400), asked_on=date(2028, 1, 1))


@pytest.mark.asyncio
async def test_live_pricing_reads_the_synced_equity_answers_not_intakes_recorded_copy() -> None:
    """Owner ruling 2026-09-30 (3c-2): only a past date prices from the recorded copy."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.requests[EMMA] = replace(
        store.requests[EMMA], equity=EquityAnswers(bipoc=True, gender_identity="", pronouns="")
    )
    store.equity[1000011] = EquityAnswers(bipoc=False, gender_identity="", pronouns="")
    inputs = (await _service(store).season(YEAR)).priced[EMMA].inputs
    assert inputs is not None
    assert inputs.equity_answers["bipoc"] == "No"
