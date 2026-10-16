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
        (2000.0, r"\$2,258\.00 on no request for that camper and session, not \$2,000\.00"),
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
    with pytest.raises(CaseworkValidationError, match="no aid on no request for that camper and session"):
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
    # A sibling in the same session (follow-up A, coordinator ruling): the money is credited to Liam, so it is his to
    # record, never his sibling's.
    sibling = LIAM + 1
    store.attendees = [*store.attendees, *enrolled(sibling, LIAM_HOUSEHOLD, SESSION_2)]
    twice = await casework.add_requests(
        YEAR, [item, replace(item, person_cm_id=sibling)], "sitting", ACTOR, dry_run=True
    )
    assert [r.ok for r in twice.items] == [True, False]
    assert "no aid on no request" in twice.items[1].error

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


# -- Follow-up A: Add a Request… → Undo Posted → Remove… gives the money back (owner's standing rule: posted aid always
#    shows). Before, D170 took ANY request of the family x session to hold it, so the removed request kept it, and it
#    showed nowhere: not in Posted (undone), not on D170, not in Form intake's amber cell. --------------------------


@pytest.mark.asyncio
async def test_after_undo_posted_and_remove_the_campminder_money_is_back_on_d170_and_form_intake(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import api.services.financial_aid_decisions_service as decisions_module
    from api.schemas.financial_aid_decisions import BudgetResponse, PoolBudgetOut, UnpostIn
    from api.services.financial_aid_form_intake import FormIntakeService
    from tests.unit.api.services.decisions_fakes import EMMA as EMMA_REQUEST
    from tests.unit.api.services.decisions_fakes import FakeDecisionsStore, seed_request
    from tests.unit.api.services.test_financial_aid_decisions_service import _service

    monkeypatch.setattr(decisions_module, "CAMPMINDER_AID_ON_NO_REQUEST_YEARS", frozenset({YEAR}))
    casework_store = liam_store()
    casework = FinancialAidCaseworkService(casework_store)
    season = FakeDecisionsStore()
    seed_request(season, EMMA_REQUEST)
    season.camp_lines = list(casework_store.camp_lines)

    def mirror() -> None:
        """What the casework writes left, as the decisions service reads it back."""
        for application in casework_store.applications.values():
            if application not in season.applications:
                season.applications.append(application)
        season.requests.update(casework_store.requests)
        season.shares.extend(s for s in casework_store.payer_shares.values() if s not in season.shares)
        season.events.extend(e for e in casework_store.decision_events if e not in season.events)
        season.additions = list(casework_store.additions.values())

    def camp_pool(budget: BudgetResponse) -> PoolBudgetOut:
        return next(p for p in budget.pools if p.pool == "camp_pool")

    def d170(pool: PoolBudgetOut) -> float:
        off = pool.below.campminder_aid_off_requests
        return off.amount if off is not None else 0.0

    async def form_intake() -> tuple[float, list[tuple[int, int, float]], list[float]]:
        """D170's drill-in total and lines (family, session, amount), and Liam's amber Form intake money."""
        service = FormIntakeService(casework_store)
        drill = await service.aid_on_no_request(YEAR)
        out = await service.forms(YEAR)
        (liam,) = [r for r in out.rows if r.person_cm_id == LIAM]
        amber = [a.amount for a in liam.campminder_aid if not a.on_request]
        return drill.total, [(x.household_cm_id, x.session_cm_id, x.amount) for x in drill.lines], amber

    before = await _service(season).budget(YEAR)
    assert d170(camp_pool(before)) == 2258.0
    assert await form_intake() == (2258.0, [(LIAM_HOUSEHOLD, SESSION_2, 2258.0)], [2258.0])

    # 1. Add a Request… with the box ticked: the money counts in Posted and leaves D170.
    out = await casework.add_request(
        YEAR, LIAM_HOUSEHOLD, LIAM, SESSION_2, 2500.0, "Assessed by phone", ACTOR, round1_campminder=2258.0
    )
    mirror()
    added = await _service(season).budget(YEAR)
    assert camp_pool(added).total.posted == pytest.approx((camp_pool(before).total.posted or 0) + 2258.0)
    assert (d170(camp_pool(added)), d170(added.total)) == (0.0, 0.0)
    assert await form_intake() == (0.0, [], [])

    # 2. Undo Posted, then 3. Remove…: the request is withdrawn and its addition retired.
    await _service(season).undo_posted(YEAR, UnpostIn(request_id=out.request.id, round=1, reason="Wrong family"), ACTOR)
    casework_store.decision_events.extend(e for e in season.events if e not in casework_store.decision_events)
    await casework.retire_addition(YEAR, out.addition.id, "Entered in error", ACTOR)
    assert casework_store.requests[out.request.id].status == "withdrawn"
    mirror()

    removed = await _service(season).budget(YEAR)
    assert camp_pool(removed).total.posted == pytest.approx(camp_pool(before).total.posted or 0)
    assert (d170(camp_pool(removed)), d170(removed.total)) == (2258.0, 2258.0)
    assert await form_intake() == (2258.0, [(LIAM_HOUSEHOLD, SESSION_2, 2258.0)], [2258.0])

    # And it can be added again, recording the money once more.
    again = await casework.add_request(
        YEAR, LIAM_HOUSEHOLD, LIAM, SESSION_2, 2500.0, "Assessed again", ACTOR, round1_campminder=2258.0
    )
    assert again.addition.round1_posted == 2258.0


# -- Follow-up A (coordinator ruling): the guard takes the camper's own money, never the family x session's -----------


def siblings_store(*lines: CampLine, sibling_enrolled: bool = True) -> FakeAidStore:
    """Liam Garcia and his sibling are both enrolled in Session 2; neither family filed the form."""
    sibling = LIAM + 1
    store = make_store(
        attendees=[
            *enrolled(LIAM, LIAM_HOUSEHOLD, SESSION_2),
            *enrolled(sibling, LIAM_HOUSEHOLD, SESSION_2, status=2 if sibling_enrolled else 4),
        ]
    )
    store.camp_lines = list(lines)
    return store


def credited_siblings() -> FakeAidStore:
    return siblings_store(
        camp_line(59000011, LIAM_HOUSEHOLD, "1000", session=SESSION_2, person=LIAM),
        camp_line(59000012, LIAM_HOUSEHOLD, "500", session=SESSION_2, person=LIAM + 1),
    )


@pytest.mark.asyncio
async def test_the_guard_takes_the_campers_own_credited_money_and_refuses_the_family_total() -> None:
    store = credited_siblings()
    casework = FinancialAidCaseworkService(store)
    with pytest.raises(CaseworkValidationError, match=r"\$1,000\.00 on no request .*, not \$1,500\.00"):
        await casework.add_request(
            YEAR, LIAM_HOUSEHOLD, LIAM, SESSION_2, 1000.0, "Assessed by phone", ACTOR, round1_campminder=1500.0
        )
    assert store.operations == []
    await casework.add_request(
        YEAR, LIAM_HOUSEHOLD, LIAM, SESSION_2, 1000.0, "Assessed by phone", ACTOR, round1_campminder=1000.0
    )
    (event,) = store.decision_events
    assert event.amount == Decimal(1000)

    # The sibling, from the same start, records only their own.
    store = credited_siblings()
    await FinancialAidCaseworkService(store).add_request(
        YEAR, LIAM_HOUSEHOLD, LIAM + 1, SESSION_2, 500.0, "Assessed by phone", ACTOR, round1_campminder=500.0
    )
    (event,) = store.decision_events
    assert event.amount == Decimal(500)


@pytest.mark.asyncio
async def test_money_credited_to_no_camper_with_two_enrolled_siblings_is_recorded_for_neither() -> None:
    store = siblings_store(camp_line(59000013, LIAM_HOUSEHOLD, "700", session=SESSION_2))
    casework = FinancialAidCaseworkService(store)
    for person in (LIAM, LIAM + 1):
        # The family x session has money on no request; it is just not this camper's, and the refusal says whose.
        with pytest.raises(CaseworkValidationError, match="no aid on no request for that camper and session"):
            await casework.add_request(
                YEAR, LIAM_HOUSEHOLD, person, SESSION_2, 700.0, "Assessed by phone", ACTOR, round1_campminder=700.0
            )
    assert store.operations == []
    # Add a Request… without the box still works.
    await casework.add_request(YEAR, LIAM_HOUSEHOLD, LIAM, SESSION_2, 700.0, "Assessed by phone", ACTOR)
    assert store.decision_events == []


@pytest.mark.asyncio
async def test_money_credited_to_no_camper_is_recorded_for_the_one_enrolled_camper() -> None:
    store = siblings_store(camp_line(59000014, LIAM_HOUSEHOLD, "700", session=SESSION_2), sibling_enrolled=False)
    await FinancialAidCaseworkService(store).add_request(
        YEAR, LIAM_HOUSEHOLD, LIAM, SESSION_2, 700.0, "Assessed by phone", ACTOR, round1_campminder=700.0
    )
    (event,) = store.decision_events
    assert event.amount == Decimal(700)
