"""PR 3's two casework writes: Mark Reviewed on a rule-made request (owner Q2-A) and Add a Request… recording
CampMinder's posted money as Round 1, posted, in the same operation (owner Q5-A). Fictional data only."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import pytest

from api.services.financial_aid_casework_service import (
    AdditionItem,
    CaseworkNotFoundError,
    CaseworkValidationError,
    FinancialAidCaseworkService,
)
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from api.services.financial_aid_intake_types import AdditionRecord
from api.services.financial_aid_reconciliation import CampLine
from bunking.financial_aid.decisions.rounds import fold_rounds
from tests.unit.api.services.financial_aid_fakes import YEAR, FakeAidStore, fa_row
from tests.unit.api.services.test_financial_aid_request_additions import (
    ACTOR,
    EMMA,
    EMMA_HOUSEHOLD,
    LIAM,
    LIAM_HOUSEHOLD,
    SESSION_2,
    WINTER,
    enrolled,
    make_store,
)

# -- Mark Reviewed (Q2-A) ------------------------------------------------------------------------------------------------


def rule_made(store: FakeAidStore, **changes: Any) -> AdditionRecord:
    """A registration-ask addition (PR 4 writes these; none exist before it), stored as the rule would store it."""
    row = AdditionRecord(
        id="add000000000rul",
        year=YEAR,
        household_cm_id=EMMA_HOUSEHOLD,
        person_cm_id=EMMA,
        program_key="summer",
        session_cm_id=WINTER,
        ask=290.0,
        source="registration_ask",
        reason="Registration ask dated with the enrollment",
        actor="system:intake",
    )
    row = replace(row, **changes)
    store.additions[row.id] = row
    return row


@pytest.mark.asyncio
async def test_mark_reviewed_stamps_a_rule_made_request_once_and_logs_it() -> None:
    store = make_store(attendees=enrolled(EMMA, EMMA_HOUSEHOLD, WINTER))
    made = rule_made(store)
    await FinancialAidIntakeService(store).build(YEAR)
    store.change_log.clear()

    out = await FinancialAidCaseworkService(store).review_addition(YEAR, made.id, ACTOR)

    stored = store.additions[made.id]
    assert stored.reviewed_by == ACTOR
    assert stored.reviewed_at
    assert (out.addition.reviewed_by, out.addition.reviewed_at) == (ACTOR, stored.reviewed_at)
    assert out.request.origin == "registration_ask"
    assert [(row["entity"], row["action"], row["actor"]) for row in store.change_log] == [
        ("aid_request_additions", "review_added_request", ACTOR)
    ]
    # Idempotent: a second Mark Reviewed writes nothing and keeps the first stamp.
    operations = len(store.operations)
    again = await FinancialAidCaseworkService(store).review_addition(YEAR, made.id, "someone@example.com")
    assert len(store.operations) == operations
    assert again.addition.reviewed_by == ACTOR


@pytest.mark.asyncio
async def test_mark_reviewed_is_only_for_a_live_rule_made_request() -> None:
    store = make_store(attendees=enrolled(EMMA, EMMA_HOUSEHOLD, WINTER))
    casework = FinancialAidCaseworkService(store)
    added = await casework.add_request(YEAR, EMMA_HOUSEHOLD, EMMA, WINTER, 600.0, "Retreat", ACTOR)
    with pytest.raises(CaseworkValidationError, match="registration ask"):
        await casework.review_addition(YEAR, added.addition.id, ACTOR)
    retired = rule_made(store, id="add000000000ret", session_cm_id=SESSION_2, retired_at="2027-02-01 00:00:00.000Z")
    with pytest.raises(CaseworkValidationError, match="removed"):
        await casework.review_addition(YEAR, retired.id, ACTOR)
    with pytest.raises(CaseworkNotFoundError):
        await casework.review_addition(YEAR, "add000000000000", ACTOR)
    with pytest.raises(CaseworkNotFoundError):
        await casework.review_addition(YEAR + 1, retired.id, ACTOR)


# -- Add a Request… with CampMinder's posted money as Round 1 (Q5-A) ----------------------------------------------------


def camp_line(txn: int, household: int, amount: str, *, session: int, person: int = 0, day: int = 20) -> CampLine:
    return CampLine(
        transaction_cm_id=txn,
        household_cm_id=household,
        person_cm_id=person,
        amount=Decimal(amount),
        post_date=datetime(YEAR, 2, day, 17, 0, tzinfo=UTC),
        is_reversed=False,
        reversal_date=None,
        attributed_person_cm_id=person,
        attributed_session_cm_id=session,
    )


def liam_store() -> FakeAidStore:
    """Liam Garcia's family never filed the aid form; CampMinder posted $2,258 of camp aid on his Session 2."""
    store = make_store(attendees=enrolled(LIAM, LIAM_HOUSEHOLD, SESSION_2))
    store.camp_lines = [
        camp_line(59000001, LIAM_HOUSEHOLD, "2000", session=SESSION_2, person=LIAM, day=20),
        camp_line(59000002, LIAM_HOUSEHOLD, "258", session=SESSION_2, person=LIAM, day=27),
    ]
    return store


@pytest.mark.asyncio
async def test_recording_campminders_money_writes_the_request_and_its_posted_round_1_in_one_operation() -> None:
    store = liam_store()
    out = await FinancialAidCaseworkService(store).add_request(
        YEAR, LIAM_HOUSEHOLD, LIAM, SESSION_2, 2500.0, "Assessed by phone", ACTOR, round1_campminder=2258.0
    )

    assert len(store.operations) == 1
    assert [(row["entity"], row["action"]) for row in store.change_log] == [
        ("aid_applications", "create"),
        ("aid_request_additions", "add_request"),
        ("aid_requests", "add_request"),
        ("aid_payer_shares", "add_request"),
        ("aid_decisions", "post"),
    ]
    (event,) = store.decision_events
    assert (event.request_id, event.round, event.kind, event.amount) == (out.request.id, 1, "post", Decimal(2258))
    assert (event.lock_source, event.actor) == ("campminder_added", ACTOR)
    assert event.effective_on == date(YEAR, 2, 27)  # the posting's day: its latest line
    state = fold_rounds(store.decision_events)[out.request.id][1]
    assert (state.posted, state.locked_amount) == (True, Decimal(2258))
    assert out.addition.round1_posted == 2258.0
    assert out.request.ask.effective == "2500.00"  # the ask stays what staff typed


@pytest.mark.asyncio
async def test_unticked_adds_the_request_only() -> None:
    store = liam_store()
    await FinancialAidCaseworkService(store).add_request(
        YEAR, LIAM_HOUSEHOLD, LIAM, SESSION_2, 2500.0, "Assessed by phone", ACTOR
    )
    assert store.decision_events == []
    assert "aid_decisions" not in {row["entity"] for row in store.change_log}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("amount", "words"),
    [
        (2000.0, r"\$2,258\.00 on no request for that family and session, not \$2,000\.00"),
        (2258.01, r"not \$2,258\.01"),
    ],
)
async def test_an_amount_that_is_not_campminders_is_refused_and_writes_nothing(amount: float, words: str) -> None:
    store = liam_store()
    with pytest.raises(CaseworkValidationError, match=words):
        await FinancialAidCaseworkService(store).add_request(
            YEAR, LIAM_HOUSEHOLD, LIAM, SESSION_2, 2500.0, "Assessed by phone", ACTOR, round1_campminder=amount
        )
    assert store.operations == []


@pytest.mark.asyncio
async def test_no_campminder_money_on_no_request_is_refused() -> None:
    store = liam_store()
    store.camp_lines = []
    with pytest.raises(CaseworkValidationError, match="no aid on no request for that family and session"):
        await FinancialAidCaseworkService(store).add_request(
            YEAR, LIAM_HOUSEHOLD, LIAM, SESSION_2, 2500.0, "Assessed by phone", ACTOR, round1_campminder=2258.0
        )
    assert store.operations == []


@pytest.mark.asyncio
async def test_money_already_on_a_request_is_not_on_no_request() -> None:
    # Emma's family x session already has her request: CampMinder's money there is on it, not on D170.
    store = make_store(
        fa_row(EMMA, EMMA_HOUSEHOLD, summer="Session 2", summer_ask=900.0),
        attendees=enrolled(EMMA, EMMA_HOUSEHOLD, SESSION_2, WINTER),
    )
    await FinancialAidIntakeService(store).build(YEAR)
    store.camp_lines = [camp_line(59000003, EMMA_HOUSEHOLD, "600", session=SESSION_2, person=EMMA)]
    with pytest.raises(CaseworkValidationError, match="no aid on no request"):
        await FinancialAidCaseworkService(store).add_request(
            YEAR, EMMA_HOUSEHOLD, EMMA, WINTER, 600.0, "Retreat", ACTOR, round1_campminder=600.0
        )


@pytest.mark.asyncio
async def test_a_bulk_load_records_round_1_per_item_and_never_twice_for_one_family_x_session() -> None:
    store = liam_store()
    casework = FinancialAidCaseworkService(store)
    item = AdditionItem(LIAM_HOUSEHOLD, LIAM, SESSION_2, 2500.0, "", round1_campminder=2258.0)
    dry = await casework.add_requests(YEAR, [item], "sitting", ACTOR, dry_run=True)
    assert (dry.written, dry.items[0].ok, dry.items[0].round1_campminder) == (False, True, 2258.0)
    assert store.operations == []
    wrong = await casework.add_requests(YEAR, [replace(item, round1_campminder=1.0)], "sitting", ACTOR, dry_run=True)
    assert not wrong.items[0].ok
    assert "not $1.00" in wrong.items[0].error
    # A sibling in the same session: CampMinder's money is the family x session's, recorded once (never split).
    sibling = LIAM + 1
    store.attendees = [*store.attendees, *enrolled(sibling, LIAM_HOUSEHOLD, SESSION_2)]
    twice = await casework.add_requests(
        YEAR, [item, replace(item, person_cm_id=sibling)], "sitting", ACTOR, dry_run=True
    )
    assert [r.ok for r in twice.items] == [True, False]
    assert "already recorded" in twice.items[1].error

    done = await casework.add_requests(YEAR, [item], "sitting", ACTOR, dry_run=False)
    assert done.written
    (event,) = store.decision_events
    assert (event.amount, event.lock_source) == (Decimal(2258), "campminder_added")


@pytest.mark.asyncio
async def test_a_recorded_round_1_is_undone_like_any_posted_round_before_remove() -> None:
    # Not read-only like 2026's sheet load: retire refuses while it is posted (PR 1's rule) and says how to undo.
    store = liam_store()
    casework = FinancialAidCaseworkService(store)
    out = await casework.add_request(
        YEAR, LIAM_HOUSEHOLD, LIAM, SESSION_2, 2500.0, "Assessed by phone", ACTOR, round1_campminder=2258.0
    )
    with pytest.raises(CaseworkValidationError, match="Round 1 is posted: undo Posted first"):
        await casework.retire_addition(YEAR, out.addition.id, "Entered in error", ACTOR)


def test_the_repository_reads_the_mark_reviewed_stamp() -> None:
    from types import SimpleNamespace

    from api.services.financial_aid_intake_repository import _addition

    record = SimpleNamespace(
        id="add000000000rul",
        year=YEAR,
        household_cm_id=EMMA_HOUSEHOLD,
        person_cm_id=EMMA,
        program_key="summer",
        session_cm_id=WINTER,
        ask=290,
        source="registration_ask",
        reason="Registration ask",
        actor="system:intake",
        reviewed_at="2027-03-03 17:00:00.000Z",
        reviewed_by=ACTOR,
    )
    parsed = _addition(record)
    assert (parsed.reviewed_at, parsed.reviewed_by) == ("2027-03-03 17:00:00.000Z", ACTOR)
    assert parsed.reviewed


# -- the season's figures (owner Q5-A is a number-meaning ruling): Committed and Posted move by CampMinder's money, and
#    D170's "CampMinder aid on no request" drops by it ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_recording_campminders_money_moves_it_from_the_d170_line_into_committed_and_posted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import api.services.financial_aid_decisions_service as decisions_module
    from api.schemas.financial_aid_decisions import BudgetResponse, PoolBudgetOut
    from tests.unit.api.services.decisions_fakes import EMMA as EMMA_REQUEST
    from tests.unit.api.services.decisions_fakes import FakeDecisionsStore, seed_request
    from tests.unit.api.services.test_financial_aid_decisions_service import _service

    monkeypatch.setattr(decisions_module, "CAMPMINDER_AID_ON_NO_REQUEST_YEARS", frozenset({YEAR}))
    casework_store = liam_store()
    season = FakeDecisionsStore()
    seed_request(season, EMMA_REQUEST)  # another family's request, so the season is not empty
    season.camp_lines = list(casework_store.camp_lines)

    def camp_pool(budget: BudgetResponse) -> PoolBudgetOut:
        return next(p for p in budget.pools if p.pool == "camp_pool")

    def figure(value: float | None) -> float:
        assert value is not None
        return value

    def d170(pool: PoolBudgetOut) -> float:
        off = pool.below.campminder_aid_off_requests
        assert off is not None
        return off.amount

    before = await _service(season).budget(YEAR)
    assert d170(camp_pool(before)) == 2258.0

    out = await FinancialAidCaseworkService(casework_store).add_request(
        YEAR, LIAM_HOUSEHOLD, LIAM, SESSION_2, 2500.0, "Assessed by phone", ACTOR, round1_campminder=2258.0
    )
    # What the one operation wrote, as the decisions service reads it back.
    season.applications.extend(casework_store.applications.values())
    season.requests[out.request.id] = casework_store.requests[out.request.id]
    season.shares.extend(s for s in casework_store.payer_shares.values() if s.request_id == out.request.id)
    season.events.extend(casework_store.decision_events)

    after = await _service(season).budget(YEAR)
    pool_before, pool_after = camp_pool(before), camp_pool(after)
    assert figure(pool_after.total.posted) - figure(pool_before.total.posted) == pytest.approx(2258.0)
    assert figure(pool_after.total.committed) - figure(pool_before.total.committed) == pytest.approx(2258.0)
    assert figure(after.total.total.posted) - figure(before.total.total.posted) == pytest.approx(2258.0)
    assert d170(pool_after) == 0.0
    assert d170(after.total) == 0.0
