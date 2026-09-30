"""The frozen season (sub-project 9b; spec §7.4): freezing records every read sub-project 10a's live season read
makes, and pricing replays them into that same read with a scenario's document approved. Fictional only
(decisions_fakes): session 1000101 costs 2,000; a 60,000 family is tier 2 (Round 1 = 1,500), a 90,000 family
tier 3 (1,100)."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from api.services.financial_aid_decisions_service import FinancialAidDecisionsService, RegisterSource
from api.services.financial_aid_grants_register import RegisterRow
from api.services.financial_aid_intake_types import CorrectionRecord
from api.services.financial_aid_scenario_pricing import (
    SNAPSHOT_FORMAT,
    SeasonSnapshot,
    SnapshotError,
    capture_season,
    decode_snapshot,
    encode_snapshot,
    price_document,
)
from bunking.financial_aid.decisions import MANUAL_HOLD, DecisionEvent, HoldEvent, PricedRequest, lock_snapshot
from bunking.financial_aid.scenarios import shift_round1_tables
from tests.unit.api.services.decisions_fakes import (
    ACTOR,
    T0,
    FakeDecisionsStore,
    FakeRules,
    approved,
    grant_row,
    log_seeded,
    seed_line,
    seed_request,
)
from tests.unit.api.services.financial_aid_fakes import YEAR, intake_rules
from tests.unit.bunking.financial_aid.fixtures import with_lever

EMMA = "reqemma00000001"
LIAM = "reqliam00000001"
RILEY = "reqrile00000001"
OLIVIA = "reqoliv00000001"
SAMUEL = "reqsamu00000001"

Rounds = dict[str, list[tuple[int, str, Decimal | None, Decimal | None]]]


def _store() -> FakeDecisionsStore:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021, income=90000.0)
    return store


def _register(rows: Sequence[RegisterRow] = ()) -> RegisterSource:
    async def read(year: int) -> Sequence[RegisterRow]:
        return rows

    return read


def _rounds(priced: Mapping[str, PricedRequest]) -> Rounds:
    return {rid: [(v.round, v.status, v.decided, v.would_change_by) for v in p.rounds] for rid, p in priced.items()}


async def _frozen(store: FakeDecisionsStore, rows: Sequence[RegisterRow] = ()) -> SeasonSnapshot:
    """Freeze, and send it through JSON the way PocketBase stores it."""
    snapshot = await capture_season(store, _register(rows), FakeRules(approved()), YEAR)
    return decode_snapshot(json.loads(json.dumps(encode_snapshot(snapshot))))


def _busy_season(store: FakeDecisionsStore) -> None:
    """Everything the live read turns into a figure (the parity guard, review finding 6):
    - a check's hold: Olivia's family reports 500, under the placeholder-income threshold;
    - a manual hold through 3b's hold history (Riley);
    - a staff correction to Emma's family's income;
    - a payer share that no longer adds up (Liam's at 60%: payer_shares_incomplete);
    - a request that simply needs an offer (Samuel);
    - SP10b-1's ledger: a camp-aid line CampMinder posted for Emma's family, and the last sync."""
    seed_request(store, RILEY, household=1000003, person=1000031)
    seed_request(store, OLIVIA, household=1000004, person=1000041, income=500.0)
    seed_request(store, SAMUEL, household=1000005, person=1000051)
    seed_line(store, 9001, "1500", posted=T0)
    store.synced_at = T0
    store.hold_events.append(
        HoldEvent(
            id="hld000000000001",
            request_id=RILEY,
            kind="place",
            code=MANUAL_HOLD,
            created=T0,
            note="Family asked us to wait",
            actor=ACTOR,
        )
    )
    store.corrections.append(
        CorrectionRecord(
            id="cor000000000001",
            year=YEAR,
            application_id="app000001000001",
            request_id="",
            field="total_gross_income",
            new_value="85000",
            original_value="60000",
            reason="Tax return received",
            actor=ACTOR,
            created="2027-02-01 17:00:00.000Z",
        )
    )
    store.shares = [replace(s, share_pct=Decimal(60)) if s.request_id == LIAM else s for s in store.shares]


@pytest.mark.asyncio
async def test_a_frozen_season_prices_exactly_as_the_live_season() -> None:
    store = _store()
    _busy_season(store)
    # An outside grant the calculator counts, and one from a grantor that pays after camp aid (below the line only),
    # tied to its household's sole camper (#2914): the register's rows are frozen whole, whatever built them.
    rows = [
        grant_row(EMMA, "250"),
        replace(grant_row(SAMUEL, "300", pays_after_camp_aid=True), camper_basis="sole_camper"),
    ]
    live_service = FinancialAidDecisionsService(store, FakeRules(approved()), _register(rows))
    # A posted lock, stored exactly as SP10a's Posted tick stores it.
    before = (await live_service.season(YEAR)).priced[EMMA]
    snapshot = lock_snapshot(before, 1, 1)
    assert {"decision_type", "decision_round", "top_up", "discretionary"} <= snapshot.keys()
    decided = before.view(1).decided  # type: ignore[union-attr]
    store.events.append(
        DecisionEvent(
            id="ev0000000000001",
            request_id=EMMA,
            round=1,
            kind="post",
            created=T0,
            amount=decided,
            effective_on=date(2027, 3, 9),
            lock_source="tick",
            rules_version=1,
            snapshot=snapshot,
        )
    )
    live = await live_service.season(YEAR)
    priced = await price_document(await _frozen(store, rows), approved().document, approved())
    assert dict(priced.season.priced) == dict(live.priced)  # every request, round, hold, note and result
    assert (priced.season.ledger, priced.season.reversed_on) == (live.ledger, live.reversed_on)
    assert priced.budget == live_service.budget_of(live)
    statuses = {v.status for p in live.priced.values() for v in p.rounds}
    assert {"posted", "held", "needs_offer"} <= statuses  # the guard really covers them


@pytest.mark.asyncio
async def test_a_snapshot_does_not_see_later_changes() -> None:
    store = _store()
    frozen = await _frozen(store)
    seed_request(store, RILEY, household=1000003, person=1000031)
    priced = await price_document(frozen, approved().document, approved())
    assert set(priced.season.priced) == {EMMA, LIAM}


@pytest.mark.asyncio
async def test_a_scenario_document_prices_under_its_own_rules() -> None:
    frozen = await _frozen(_store())
    priced = await price_document(frozen, shift_round1_tables(intake_rules(), Decimal(5)), approved())
    decided = {rid: p.view(1).decided for rid, p in priced.season.priced.items()}  # type: ignore[union-attr]
    assert decided == {EMMA: Decimal(1600), LIAM: Decimal(1200)}


@pytest.mark.asyncio
async def test_a_posted_round_replays_at_its_lock_under_any_document() -> None:
    store = _store()
    store.events.append(
        DecisionEvent(
            id="ev0000000000001",
            request_id=EMMA,
            round=1,
            kind="post",
            created=T0,
            amount=Decimal(1400),
            effective_on=date(2027, 3, 9),
            lock_source="tick",
            rules_version=1,
            snapshot={"pool": "camp_pool", "counts_toward_budget": True},
        )
    )
    priced = await price_document(await _frozen(store), shift_round1_tables(intake_rules(), Decimal(5)), approved())
    assert _rounds(priced.season.priced)[EMMA] == [(1, "posted", Decimal(1400), Decimal(200))]


@pytest.mark.asyncio
async def test_the_frozen_season_is_plain_json_and_counts_its_live_requests() -> None:
    snapshot = await capture_season(_store(), _register(), FakeRules(approved()), YEAR, clock=lambda: T0)
    encoded = encode_snapshot(snapshot)
    assert json.loads(json.dumps(encoded)) == encoded
    assert (encoded["format"], encoded["year"], encoded["requests"], encoded["awaiting_rules"]) == (
        SNAPSHOT_FORMAT,
        YEAR,
        2,
        0,
    )
    assert decode_snapshot(encoded).frozen_at == T0
    assert "fetch_requests" in encoded["calls"]


@pytest.mark.asyncio
async def test_a_snapshot_in_another_format_is_refused() -> None:
    encoded = encode_snapshot(await capture_season(_store(), _register(), FakeRules(approved()), YEAR))
    with pytest.raises(SnapshotError, match="freeze"):
        decode_snapshot({**encoded, "format": 0})


@pytest.mark.asyncio
async def test_a_snapshot_missing_a_read_the_season_now_makes_is_refused() -> None:
    encoded = encode_snapshot(await capture_season(_store(), _register(), FakeRules(approved()), YEAR))
    calls = {name: value for name, value in encoded["calls"].items() if name != "fetch_sessions"}
    old = decode_snapshot({**encoded, "calls": calls})
    with pytest.raises(SnapshotError, match="fetch_sessions"):
        await price_document(old, approved().document, approved())


@pytest.mark.asyncio
async def test_a_read_the_store_does_not_declare_is_refused() -> None:
    encoded = encode_snapshot(await capture_season(_store(), _register(), FakeRules(approved()), YEAR))
    with pytest.raises(SnapshotError, match="fetch_everything"):
        decode_snapshot({**encoded, "calls": {**encoded["calls"], "fetch_everything": []}})


@pytest.mark.asyncio
async def test_a_document_for_another_season_is_refused() -> None:
    frozen = await _frozen(_store())
    with pytest.raises(SnapshotError, match="2026"):
        await price_document(frozen, with_lever(intake_rules(), "year", 2026), approved())


# --- the request set (D138) ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_freezing_records_when_each_request_was_first_recorded() -> None:
    store = _store()
    log_seeded(store, datetime(2027, 1, 20, 18, 0, tzinfo=UTC))  # intake's create rows for Emma and Liam
    seed_request(store, RILEY, household=1000003, person=1000031)  # no create row: its received date is unknown
    frozen = await _frozen(store)
    assert frozen.received == {
        EMMA: datetime(2027, 1, 20, 18, 0, tzinfo=UTC),
        LIAM: datetime(2027, 1, 20, 18, 0, tzinfo=UTC),
        RILEY: None,
    }


@pytest.mark.asyncio
async def test_a_request_set_prices_only_its_requests() -> None:
    frozen = await _frozen(_store())
    priced = await price_document(frozen, approved().document, approved(), requests={EMMA})
    assert set(priced.season.priced) == {EMMA}
    assert priced.budget.total.rounds[1].needs_offer == Decimal(1500)
