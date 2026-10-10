"""The round a grant offsets (campership slice 3, ask 10; spec §8.2 "the aid request it offsets"; D43, D88, D116,
D139, D143). Fictional only. Emma's request (reqemma00000001, household 1000001) prices Round 1 at 1,500 under the fake
rules; a 500 grant known before Round 1 is decided lowers it to 1,000. `_posted` locks a round at T0 (Mar 9 2027).
Under the 2027 rules an appeal never subtracts grants (D139), so a grant known after Round 1 posted offsets no round;
`SUBTRACTING` turns on the two levers that make an appeal subtract them."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from api.schemas.financial_aid_grants import GrantRowOut, GrantsResponse, RequestShareOut, WaitingCommitmentOut
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService, Season
from api.services.financial_aid_grant_offsets import (
    GrantsRegisterService,
    ShareOffset,
    offset_as_of,
    share_offset,
    with_offsets,
)
from api.services.financial_aid_grants_register import RegisterRow, RequestShare, grant_inputs_by_request
from bunking.financial_aid.decisions import DecisionEvent
from bunking.financial_aid.decisions.rounds import EventKind
from bunking.financial_aid.rules.schema import AidRules
from tests.unit.api.services.decisions_fakes import T0, FakeDecisionsStore, FakeRules, approved, grant_row, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR, intake_rules
from tests.unit.api.services.test_financial_aid_decisions_service import EMMA, _posted
from tests.unit.bunking.financial_aid.fixtures import with_lever

MAR20 = datetime(2027, 3, 20, 17, 0, tzinfo=UTC)  # after T0's locks
OTHER = "reqother0000001"  # a request this season doesn't hold
# The two rules levers under which an appeal subtracts outside grants (engine.py:446-447, 570-571): both are off in 2027.
SUBTRACTING = {
    "round2.cap_subtracts_grants": with_lever(intake_rules(), "round2.cap_subtracts_grants", True),
    "round2.total_cap.include_grants": with_lever(
        intake_rules(), "round2.total_cap", {"pct_of_cost": "80", "include_grants": True}
    ),
}


def _emma() -> FakeDecisionsStore:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    return store


async def _season(store: FakeDecisionsStore, register: Sequence[RegisterRow], rules: FakeRules | None = None) -> Season:
    async def rows(year: int) -> Sequence[RegisterRow]:
        return register

    service = FinancialAidDecisionsService(store, rules or FakeRules(approved()), rows, clock=lambda: T0)
    return await service.season(YEAR)


async def _offset(
    row: RegisterRow, store: FakeDecisionsStore | None = None, rules: FakeRules | None = None
) -> ShareOffset:
    (share,) = row.requests
    return share_offset(row, share, await _season(store or _emma(), [row], rules))


def _late(amount: str = "500") -> RegisterRow:
    return replace(grant_row(EMMA, amount), recorded_at=MAR20, recorded_on="2027-03-20")


def _out(row: RegisterRow) -> GrantRowOut:
    return GrantRowOut(
        kind=row.kind,
        transaction_cm_id=row.transaction_cm_id,
        commitment_id=row.commitment_id,
        household_cm_id=row.household_cm_id,
        family_name="The Johnson Family",
        person_cm_id=row.person_cm_id,
        camper_name="Emma Johnson",
        camper_basis=row.camper_basis,
        session_cm_id=row.session_cm_id,
        session_name="Session 2",
        program_family=row.program_family,
        grantor_key=row.grantor_key,
        grantor_name="Regional Fund",
        description="Regional Grant",
        source_family=row.source_family,
        funder_type=row.funder_type,
        amount=float(row.amount),
        recorded_on=row.recorded_on,
        is_reversed=row.is_reversed,
        reversal_date=row.reversal_date,
        cancelled=row.cancelled,
        counts=row.counts,
        fulfils_commitment_id=row.fulfils_commitment_id,
        requests=[RequestShareOut(request_id=s.request_id, amount=float(s.amount)) for s in row.requests],
    )


# --- share_offset ----------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_grant_known_before_round_1_offsets_round_1_at_that_rounds_amount() -> None:
    """The mock's "R1 $1,000": Round 1 as priced now, with the grant already taken off (the share is the row's Amount)."""
    row = grant_row(EMMA, "500")
    season = await _season(_emma(), [row])
    (share,) = row.requests
    assert share_offset(row, share, season) == ShareOffset("round", 1, Decimal(1000))
    view = season.priced[EMMA].view(1)
    assert view is not None
    assert view.decided == Decimal(1000)


@pytest.mark.asyncio
async def test_a_posted_round_shows_the_amount_it_locked() -> None:
    """D43/D152: once posted, the amount never moves, so a grant known before the posting names the locked amount."""
    store = _emma()
    _posted(store, EMMA, 1, "1500")
    assert await _offset(grant_row(EMMA, "500"), store) == ShareOffset("round", 1, Decimal(1500))


@pytest.mark.asyncio
async def test_the_share_is_the_grant_input_pricing_saw() -> None:
    """One bridge: the share share_offset classifies is exactly what grant_inputs_by_request fed the calculator."""
    row = grant_row(EMMA, "500")
    season = await _season(_emma(), [row])
    priced = season.priced[EMMA].inputs
    assert priced is not None
    assert priced.grants_applicable == grant_inputs_by_request([row])[EMMA]


@pytest.mark.asyncio
async def test_a_grant_known_after_round_1_was_posted_offsets_no_round_under_the_2027_rules() -> None:
    """D139: an appeal never subtracts outside grants, and D43: the posted offer stands. So no round counts it, and the
    Register says "after the offer", not "R2". (Both levers that would change this are off in the 2027 rules.)"""
    store = _emma()
    _posted(store, EMMA, 1, "1500")
    assert await _offset(_late(), store) == ShareOffset("after_offer")


@pytest.mark.parametrize("lever", sorted(SUBTRACTING))
@pytest.mark.asyncio
async def test_with_an_appeal_that_subtracts_grants_the_late_grant_names_round_2_with_no_amount_yet(lever: str) -> None:
    """Only where the rules make the appeal subtract grants does a grant known after Round 1 offset Round 2. With no
    appeal asked there is no Round 2 amount yet ("counts in an appeal")."""
    store = _emma()
    _posted(store, EMMA, 1, "1500")
    assert await _offset(_late(), store, FakeRules(approved(SUBTRACTING[lever]))) == ShareOffset("round", 2, None)


@pytest.mark.parametrize("lever", sorted(SUBTRACTING))
@pytest.mark.asyncio
async def test_with_an_appeal_open_under_subtracting_rules_the_amount_is_round_2_as_priced_now(lever: str) -> None:
    store = _emma()
    _posted(store, EMMA, 1, "1500")
    store.events.append(
        DecisionEvent(
            id="ev9999999999998",
            request_id=EMMA,
            round=2,
            kind="ask",
            created=T0,
            amount=Decimal(300),
            effective_on=date(2027, 3, 9),
        )
    )
    row = _late()
    season = await _season(store, [row], FakeRules(approved(SUBTRACTING[lever])))
    view = season.priced[EMMA].view(2)
    assert view is not None
    (share,) = row.requests
    assert share_offset(row, share, season) == ShareOffset("round", 2, view.decided)


@pytest.mark.parametrize("lever", ["none", *sorted(SUBTRACTING)])
@pytest.mark.asyncio
async def test_a_grant_known_after_the_appeal_was_posted_offsets_no_round(lever: str) -> None:
    store = _emma()
    _posted(store, EMMA, 1, "1500")
    _posted(store, EMMA, 2, "300")
    rules = FakeRules(approved(SUBTRACTING[lever])) if lever in SUBTRACTING else None
    assert await _offset(_late(), store, rules) == ShareOffset("after_offer")


@pytest.mark.asyncio
async def test_a_late_grant_under_recalculate_is_still_after_the_posted_round_1() -> None:
    """The classifier is read by recorded-after-Round-1's-posting before any policy: `recalculate` does not move a
    posted amount (D43), so the Register still says "after the offer"."""
    store = _emma()
    _posted(store, EMMA, 1, "1500")
    rules = FakeRules(approved(with_lever(intake_rules(), "grants.late_grant_policy", "recalculate")))
    assert await _offset(_late(), store, rules) == ShareOffset("after_offer")


@pytest.mark.asyncio
async def test_a_pays_after_camp_aid_grant_offsets_no_round() -> None:
    """D143: pricing never feeds a last-dollar grantor's grant to the calculator, so the Register never says "R1"."""
    assert await _offset(grant_row(EMMA, "2000", pays_after_camp_aid=True)) == ShareOffset("pays_after_camp_aid")


@pytest.mark.asyncio
async def test_an_incentive_offsets_no_round() -> None:
    """D88: the rules meet an incentive through grants.incentives, never as a grant the award is lowered by."""
    assert await _offset(grant_row(EMMA, "500", funder_type="incentive")) == ShareOffset("incentive")


@pytest.mark.asyncio
async def test_a_program_the_rules_do_not_offset_has_no_round() -> None:
    rules = FakeRules(approved(with_lever(intake_rules(), "grants.offset_programs", [])))
    assert await _offset(grant_row(EMMA, "500"), rules=rules) == ShareOffset("not_offset_program")


@pytest.mark.asyncio
async def test_a_request_that_cannot_be_priced_has_no_round() -> None:
    assert await _offset(grant_row(EMMA, "500"), rules=FakeRules(None)) == ShareOffset("not_priced")


# --- with_offsets and the service ------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_every_copy_of_a_row_gets_its_shares_rounds_and_a_share_on_an_unknown_request_is_not_priced() -> None:
    split = replace(
        grant_row(EMMA, "1000"),
        requests=(RequestShare(EMMA, Decimal(500)), RequestShare(OTHER, Decimal(500))),
    )
    pledge = replace(
        grant_row(EMMA, "200"),
        kind="commitment",
        transaction_cm_id=0,
        commitment_id="com000000000001",
        camper_basis="commitment",
        source_key="",
        source_family="",
    )
    season = await _season(_emma(), [split, pledge])
    response = GrantsResponse(
        year=YEAR,
        grants=[_out(split), _out(pledge)],
        needs_camper=[],
        unmapped=[],
        waiting=[WaitingCommitmentOut(grant=_out(pledge), days_waiting=3, reason="not_posted", transaction_cm_id=0)],
        expected=[],
    )
    out = with_offsets(response, [split, pledge], season)
    emma, other = out.grants[0].requests
    assert (emma.offsets, emma.round, other.offsets, other.round, other.round_amount) == (
        "round",
        1,
        "not_priced",
        None,
        None,
    )
    assert emma.round_amount == float(season.priced[EMMA].view(1).decided)  # type: ignore[union-attr, arg-type]
    assert out.waiting[0].grant.requests == out.grants[1].requests
    assert out.grants[1].requests[0].round == 1


class _Loader:
    """A GrantsLoader that counts its loads (OneGrantsLoad must share one between pricing and the read)."""

    def __init__(self, rows: Sequence[RegisterRow]) -> None:
        self.rows = list(rows)
        self.calls = 0

    async def read_with_rows(self, year: int) -> tuple[GrantsResponse, list[RegisterRow]]:
        self.calls += 1
        response = GrantsResponse(
            year=year, grants=[_out(r) for r in self.rows], needs_camper=[], unmapped=[], waiting=[], expected=[]
        )
        return response, list(self.rows)


@pytest.mark.asyncio
async def test_the_grants_read_prices_the_season_on_the_register_it_shows_from_one_load() -> None:
    loader = _Loader([grant_row(EMMA, "500")])
    service = GrantsRegisterService(loader, _emma(), FakeRules(approved()), clock=lambda: T0)
    out = await service.read(YEAR)
    ((share,),) = [g.requests for g in out.grants]
    assert (share.offsets, share.round, share.round_amount) == ("round", 1, 1000.0)
    assert loader.calls == 1


# --- as of a placement (Season › History's Round column, owner 2026-10-10 "k lets go w/B") ---------------------------

MAR21 = datetime(2027, 3, 21, 17, 0, tzinfo=UTC)
MAR25 = datetime(2027, 3, 25, 17, 0, tzinfo=UTC)


def _tick(kind: EventKind, at: datetime, n: int = 1, request_id: str = EMMA, rid: str = "") -> DecisionEvent:
    amount = Decimal(1000) if kind == "post" else None
    return DecisionEvent(id=rid or f"{kind}{n}{at:%m%d}", request_id=request_id, round=n, kind=kind, created=at,
                         amount=amount)  # fmt: skip


def _as_of(
    row: RegisterRow,
    at: datetime,
    events: Sequence[DecisionEvent] = (),
    program: str | None = "summer",
    rules: AidRules | None = None,
) -> ShareOffset:
    (share,) = row.requests
    return offset_as_of(row, share, at, events=events, program_key=program, rules=rules or intake_rules())


def test_as_of_a_placement_a_grant_known_before_round_1_posted_counts_in_round_1_for_good() -> None:
    """The Register's rule replayed at the placement's instant: known before Round 1's Posted lock, it lowered Round 1,
    whether Round 1 had posted by the placement or posted later. No amount: History records, it never re-prices."""
    early = grant_row(EMMA, "500")  # known Feb 10
    assert _as_of(early, MAR21, [_tick("post", T0)]) == ShareOffset("round", 1)
    assert _as_of(early, T0 - (MAR21 - T0), [_tick("post", T0)]) == ShareOffset("round", 1)  # placed before the post
    assert _as_of(_late(), MAR21, []) == ShareOffset("round", 1)  # Round 1 not posted: every grant counts there


def test_as_of_a_placement_a_grant_known_after_round_1_posted_is_after_the_offer_unless_appeals_subtract() -> None:
    assert _as_of(_late(), MAR21, [_tick("post", T0)]) == ShareOffset("after_offer")
    for rules in SUBTRACTING.values():
        assert _as_of(_late(), MAR21, [_tick("post", T0)], rules=rules) == ShareOffset("round", 2)
    # Known after the appeal posted too: nothing counts it, whatever the levers.
    appeal = [_tick("post", T0), _tick("post", datetime(2027, 3, 15, tzinfo=UTC), n=2)]
    assert _as_of(_late(), MAR21, appeal, rules=SUBTRACTING["round2.cap_subtracts_grants"]) == ShareOffset(
        "after_offer"
    )


def test_as_of_reads_the_decisions_recorded_by_the_placement_only() -> None:
    """A Posted tick undone after the placement leaves it as it was then; a tick recorded after it never reaches back."""
    undone_later = [_tick("post", T0), _tick("unpost", MAR25)]
    assert _as_of(_late(), MAR21, undone_later) == ShareOffset("after_offer")
    posted_later = [_tick("post", MAR25)]
    assert _as_of(_late(), MAR21, posted_later) == ShareOffset("round", 1)
    other_request = [_tick("post", T0, request_id=OTHER)]
    assert _as_of(_late(), MAR21, other_request) == ShareOffset("round", 1)


def test_as_of_says_why_no_round_counts_a_share() -> None:
    assert _as_of(grant_row(EMMA, "500"), MAR21, program="family_camp") == ShareOffset("not_offset_program")
    assert _as_of(grant_row(EMMA, "500", funder_type="incentive"), MAR21) == ShareOffset("incentive")
    assert _as_of(grant_row(EMMA, "500", pays_after_camp_aid=True), MAR21) == ShareOffset("pays_after_camp_aid")
    assert _as_of(grant_row(EMMA, "500"), MAR21, program=None) == ShareOffset("not_priced")  # no program then
    (share,) = grant_row(EMMA, "500").requests
    no_rules = offset_as_of(grant_row(EMMA, "500"), share, MAR21, events=[], program_key="summer", rules=None)
    assert no_rules == ShareOffset("not_priced")


@pytest.mark.asyncio
@pytest.mark.parametrize("posted", [False, True])
@pytest.mark.parametrize("late", [False, True])
async def test_as_of_now_agrees_with_the_registers_live_offset(posted: bool, late: bool) -> None:
    """One rule, two reads: replayed at the season's own instant, the History answer is the Register's minus its
    amount, so the two pages can't disagree."""
    store = _emma()
    if posted:
        _posted(store, EMMA, 1, "1000")
    row = _late() if late else grant_row(EMMA, "500")
    live = await _offset(row, store)
    (share,) = row.requests
    replayed = offset_as_of(row, share, MAR25, events=store.events, program_key="summer", rules=intake_rules())
    assert replayed == replace(live, round_amount=None)
