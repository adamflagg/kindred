"""The request editor's live preview (clean spec §4.6, D22, D79): what the editor shows while the registrar
types a Round 2 ask or a Round 3 amount, priced exactly as the write would price it, written and logged
nowhere. Fictional only; figures as decisions_fakes: Session 2 costs 2,000, Round 1 is 1,500, and Round
2's cap is 1,800 less Round 1."""

from __future__ import annotations

from dataclasses import replace
from datetime import date
from decimal import Decimal
from typing import Any

import pytest

import api.schemas.financial_aid_decisions as schemas
from api.schemas.financial_aid_decisions import AskIn, PreviewIn, Round3AmountIn
from api.services.financial_aid_decisions_service import (
    DecisionNotFoundError,
    DecisionRefusedError,
    FinancialAidDecisionsService,
    _total_decided,
)
from api.services.financial_aid_grants_register import RegisterRow
from bunking.financial_aid.decisions import DecisionEvent
from tests.unit.api.services.decisions_fakes import (
    ACTOR,
    T0,
    FakeDecisionsStore,
    FakeRules,
    approved,
    seed_request,
    share_row,
)
from tests.unit.api.services.financial_aid_fakes import intake_rules
from tests.unit.bunking.financial_aid.fixtures import with_lever

EMMA = "reqemma00000001"


@pytest.fixture(autouse=True)
def _today_is_after_the_fictional_dates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(schemas, "today", lambda: date(2027, 12, 31))


def _service(store: FakeDecisionsStore, rules: FakeRules | None = None) -> FinancialAidDecisionsService:
    async def register(year: int) -> list[RegisterRow]:
        return []

    return FinancialAidDecisionsService(store, rules or FakeRules(approved()), register, clock=lambda: T0)


def _event(store: FakeDecisionsStore, n: int, kind: Any, **fields: Any) -> None:
    store.events.append(
        DecisionEvent(id=f"ev{len(store.events):013d}", request_id=EMMA, round=n, kind=kind, created=T0, **fields)
    )


def _posted_round_1(store: FakeDecisionsStore) -> None:
    _event(
        store,
        1,
        "post",
        amount=Decimal(1500),
        effective_on=date(2027, 3, 9),
        lock_source="tick",
        rules_version=1,
        snapshot={"pool": "camp_pool", "counts_toward_budget": True},
    )


@pytest.mark.asyncio
async def test_an_appeal_ask_previews_its_award_and_the_new_stage_writing_nothing() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted_round_1(store)
    before = list(store.events)
    out = await _service(store).preview(EMMA, PreviewIn(round=2, amount=Decimal(400)), can_approve=False)
    assert (out.award, out.stage_after, out.pending_approval, out.shares) == (300.0, "needs_offer", False, [])
    assert out.stage_after_label == "Needs an offer"
    assert {step.key for step in out.trace} >= {"r2"}
    assert store.events == before
    assert store.operations == []
    assert store.log == []


@pytest.mark.asyncio
async def test_retyping_the_ask_already_keyed_moves_no_stage() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted_round_1(store)
    _event(store, 2, "ask", amount=Decimal(250), effective_on=date(2027, 3, 20))
    out = await _service(store).preview(EMMA, PreviewIn(round=2, amount=Decimal(400)), can_approve=False)
    assert (out.award, out.stage_after, out.stage_after_label) == (300.0, None, None)


@pytest.mark.asyncio
async def test_a_registrars_round_3_amount_above_the_limit_previews_as_pending_approval() -> None:
    """D79: above the season's registrar limit it waits for finance; finance's own never does."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA, session=1000102)  # costs 4,000: 1,500 + 300 + 500 stays under it
    _posted_round_1(store)
    _event(store, 2, "ask", amount=Decimal(400))
    _event(store, 3, "ask", amount=Decimal(500), statement_of_need="A parent lost their job")
    rules = FakeRules(approved(with_lever(intake_rules(), "round3.registrar_limit", "400")))
    registrar = await _service(store, rules).preview(EMMA, PreviewIn(round=3, amount=Decimal(500)), can_approve=False)
    assert (registrar.pending_approval, registrar.stage_after, registrar.award) == (True, "pending_approval", 500.0)
    finance = await _service(store, rules).preview(EMMA, PreviewIn(round=3, amount=Decimal(500)), can_approve=True)
    assert (finance.pending_approval, finance.stage_after, finance.award) == (False, "needs_offer", 500.0)


@pytest.mark.asyncio
async def test_a_split_request_previews_each_payers_whole_dollar_share() -> None:
    """§4.6: the recomputed payer shares; the remainder dollar stays with the applying household (§6.3)."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    store.shares = [share_row(EMMA, 1000001, "50"), share_row(EMMA, 1000002, "50")]
    _posted_round_1(store)
    out = await _service(store).preview(EMMA, PreviewIn(round=2, amount=Decimal(301)), can_approve=False)
    assert out.award == 300.0
    assert [(s.household_cm_id, s.pct, s.amount) for s in out.shares] == [
        (1000001, 50.0, 900.0),
        (1000002, 50.0, 900.0),
    ]


@pytest.mark.asyncio
async def test_an_appeal_before_round_1_is_posted_is_refused_as_the_write_would_be() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    with pytest.raises(
        DecisionRefusedError, match=r"^Round 1 needs to show as posted before you can start an appeal\. "
    ):
        await _service(store).preview(EMMA, PreviewIn(round=2, amount=Decimal(400)), can_approve=False)


@pytest.mark.asyncio
async def test_a_round_3_amount_before_its_ask_is_refused() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted_round_1(store)
    with pytest.raises(DecisionRefusedError, match="Round 3 ask"):
        await _service(store).preview(EMMA, PreviewIn(round=3, amount=Decimal(300)), can_approve=False)


@pytest.mark.asyncio
async def test_an_unknown_request_is_not_found() -> None:
    with pytest.raises(DecisionNotFoundError):
        await _service(FakeDecisionsStore()).preview(EMMA, PreviewIn(round=2, amount=Decimal(1)), can_approve=False)


# Plan review I2: the preview refuses exactly what the write refuses, from the same checks.


@pytest.mark.asyncio
async def test_a_round_3_amount_before_the_round_2_appeal_the_rules_require_is_refused_like_the_write() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted_round_1(store)
    _event(store, 3, "ask", amount=Decimal(500), statement_of_need="A parent lost their job")
    service = _service(store)
    with pytest.raises(DecisionRefusedError, match="only after a Round 2 appeal") as previewed:
        await service.preview(EMMA, PreviewIn(round=3, amount=Decimal(300)), can_approve=False)
    with pytest.raises(DecisionRefusedError) as written:
        await service.key_round3_amount(EMMA, Round3AmountIn(amount=Decimal(300)), ACTOR, can_approve=False)
    assert str(previewed.value) == str(written.value)


@pytest.mark.asyncio
async def test_an_ask_under_a_later_posted_round_is_refused_like_the_write() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted_round_1(store)
    _event(store, 2, "ask", amount=Decimal(400), effective_on=date(2027, 3, 20))
    _event(store, 3, "ask", amount=Decimal(500), statement_of_need="A parent lost their job")
    _event(
        store,
        3,
        "post",
        amount=Decimal(200),
        effective_on=date(2027, 5, 1),
        lock_source="tick",
        rules_version=1,
        snapshot={"pool": "camp_pool", "counts_toward_budget": True},
    )
    service = _service(store)
    with pytest.raises(DecisionRefusedError, match="Round 3 is posted and builds on Round 2") as previewed:
        await service.preview(EMMA, PreviewIn(round=2, amount=Decimal(450)), can_approve=False)
    with pytest.raises(DecisionRefusedError) as written:
        await service.key_ask(EMMA, AskIn(round=2, amount=Decimal(450), asked_on=date(2027, 5, 2)), ACTOR)
    assert str(previewed.value) == str(written.value)


# Fix round 1: retyping what is already keyed is the write's no-op, so the preview moves nothing either.


def _round3_keyed(store: FakeDecisionsStore, approval: str) -> FakeRules:
    seed_request(store, EMMA, session=1000102)
    _posted_round_1(store)
    _event(store, 2, "ask", amount=Decimal(400))
    _event(store, 3, "ask", amount=Decimal(500), statement_of_need="A parent lost their job")
    _event(store, 3, "award", amount=Decimal(500), needs_approval=approval == "pending")
    return FakeRules(approved(with_lever(intake_rules(), "round3.registrar_limit", "400")))


@pytest.mark.asyncio
async def test_retyping_the_round_2_ask_already_keyed_is_the_writes_no_op() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted_round_1(store)
    _event(store, 2, "ask", amount=Decimal(400), effective_on=date(2027, 3, 20))
    out = await _service(store).preview(EMMA, PreviewIn(round=2, amount=Decimal(400)), can_approve=False)
    assert (out.stage_after, out.stage_after_label, out.pending_approval) == (None, None, False)
    written = await _service(store).key_ask(
        EMMA, AskIn(round=2, amount=Decimal(400), asked_on=date(2027, 3, 20)), ACTOR
    )
    assert written.unchanged == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(("approval", "can_approve"), [("approved", False), ("pending", True), ("pending", False)])
async def test_retyping_the_round_3_amount_already_keyed_is_the_writes_no_op(approval: str, can_approve: bool) -> None:
    store = FakeDecisionsStore()
    rules = _round3_keyed(store, approval)
    service = _service(store, rules)
    out = await service.preview(EMMA, PreviewIn(round=3, amount=Decimal(500)), can_approve=can_approve)
    assert (out.stage_after, out.stage_after_label, out.pending_approval) == (None, None, False)
    written = await service.key_round3_amount(EMMA, Round3AmountIn(amount=Decimal(500)), ACTOR, can_approve=can_approve)
    assert (written.unchanged, written.pending_approval) == (1, False)


# --- the request's total decided after the edit (the grid row's own definition) -------------------------------


@pytest.mark.asyncio
async def test_the_preview_total_is_round_1_plus_the_previewed_round_2_award() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted_round_1(store)
    out = await _service(store).preview(EMMA, PreviewIn(round=2, amount=Decimal(400)), can_approve=False)
    assert out.award == 300.0
    assert out.total_decided == 1800.0  # 1,500 posted + the previewed 300, not the Round 2 ask of 400


@pytest.mark.asyncio
async def test_the_preview_total_uses_the_previewed_award_not_the_one_already_keyed() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted_round_1(store)
    _event(store, 2, "ask", amount=Decimal(100), effective_on=date(2027, 3, 20))
    out = await _service(store).preview(EMMA, PreviewIn(round=2, amount=Decimal(250)), can_approve=False)
    assert (out.award, out.total_decided) == (250.0, 1750.0)


@pytest.mark.asyncio
async def test_a_clawed_back_round_still_counts_in_the_total() -> None:
    """The preview refuses a cancelled or closed request (the only kind a round is clawed back on), so the shared
    definition is pinned directly: the grid row and the preview both read it."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted_round_1(store)
    priced = (await _service(store).season(2027)).priced[EMMA]
    clawed = replace(priced, rounds=tuple(replace(v, clawed_back=True) for v in priced.rounds))
    assert any(v.status == "posted" for v in clawed.rounds)
    assert all(v.clawed_back for v in clawed.rounds if v.status == "posted")
    assert _total_decided(clawed) == 1500.0 == _total_decided(priced)


@pytest.mark.asyncio
async def test_the_preview_total_equals_the_grid_rows_total_once_the_edit_is_saved() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    _posted_round_1(store)
    service = _service(store)
    previewed = await service.preview(EMMA, PreviewIn(round=2, amount=Decimal(400)), can_approve=False)
    await service.key_ask(EMMA, AskIn(round=2, amount=Decimal(400), asked_on=date(2027, 3, 20)), ACTOR)
    row = next(r for r in (await service.grid(2027)).rows if r.request_id == EMMA)
    assert row.total_decided == 1800.0
    assert previewed.total_decided == row.total_decided
