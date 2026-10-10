"""The round a grant offsets (campership slice 3, ask 10; clean spec §8.2 "the aid request it offsets"; D43, D88,
D116, D143).

Each share of a counted grant on an aid request is classified by the calculator's flag-free grant_round, fed the
share exactly as pricing's bridge feeds it (reaches_calculator, bridge_input), against the request as the season
priced it. The Register's "R1 $1,420" is `round` 1 with that round's amount now (decided while open, locked once
posted). A grant known after Round 1 posted offsets Round 2 only where the rules make an appeal subtract grants
(D139: round2.cap_subtracts_grants or round2.total_cap.include_grants, both off in 2027); otherwise it is "after the
offer" (D43). Live only.

GET /grants/{year} prices the season once, on the register it shows (OneGrantsLoad), as Today and the household page
do. Nothing here writes.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from decimal import Decimal
from typing import Final

from api.schemas.financial_aid_grants import GrantRowOut, GrantsResponse, ShareOffsetOut
from api.services.financial_aid_decisions_service import (
    DecisionsStore,
    FinancialAidDecisionsService,
    PricingRules,
    Season,
)
from api.services.financial_aid_grants_register import RegisterRow, RequestShare, bridge_input, reaches_calculator
from api.services.financial_aid_grants_service import GrantsLoader, OneGrantsLoad
from api.services.financial_aid_ledger_service import money
from bunking.financial_aid.calculator.grants import GrantRound, grant_round_at
from bunking.financial_aid.decisions import DecisionEvent, fold_rounds
from bunking.financial_aid.rules.schema import AidRules

_EXCLUDED: Final[Mapping[GrantRound, ShareOffsetOut]] = {
    "not_offset_program": "not_offset_program",
    "not_received": "not_received",
}


# What the rule reads off a request: its program under the rules, Round 1's and the appeal's Posted instants, the rules.
_Basis = tuple[str, datetime | None, datetime | None, AidRules]


@dataclass(frozen=True)
class ShareOffset:
    """What one share offsets: `round` and its `round_amount` now when offsets is "round"; else why none."""

    offsets: ShareOffsetOut
    round: int | None = None
    round_amount: Decimal | None = None


def _appeal_subtracts_grants(rules: AidRules) -> bool:
    """D139: an appeal never subtracts outside grants, unless a season's rules turn one of the two levers on (the same
    two the engine reads before it subtracts grants_since_round1: engine.py:446-447, 570-571). Both are off in 2027."""
    cap = rules.round2.total_cap
    return rules.round2.cap_subtracts_grants or (cap is not None and cap.include_grants)


def _offset(row: RegisterRow, share: RequestShare, basis: _Basis | None) -> ShareOffset:
    """The rule both reads share: why the bridge leaves a row out, else the round grant_round_at names under `basis`
    (None: the request has no program or rules to read, so "not_priced"). No amount: the caller adds one."""
    if not reaches_calculator(row):
        # A share exists only on a counted row, and the register holds outside and incentive lines only, so the bridge
        # leaves it out for one of two reasons.
        return ShareOffset("incentive" if row.funder_type != "outside" else "pays_after_camp_aid")
    if basis is None:
        return ShareOffset("not_priced")
    program_key, r1_decided_at, r2_decided_at, rules = basis
    found = grant_round_at(
        bridge_input(row, share),
        program_key=program_key,
        r1_decided_at=r1_decided_at,
        r2_decided_at=r2_decided_at,
        rules=rules,
    )
    if found == "round_1" or (found == "after_round_1" and _appeal_subtracts_grants(rules)):
        return ShareOffset("round", 1 if found == "round_1" else 2)
    return ShareOffset(_EXCLUDED.get(found, "after_offer"))


def share_offset(row: RegisterRow, share: RequestShare, season: Season) -> ShareOffset:
    """The round of `share`'s request the rules count this share in, and that round's amount now. A share known after
    Round 1 posted offsets Round 2 only where an appeal subtracts grants (D139); else the offer stands (D43)."""
    priced = season.priced.get(share.request_id)
    inputs = priced.inputs if priced is not None else None
    basis = (
        None
        if inputs is None or season.rules is None
        else (inputs.program_key, inputs.r1_decided_at, inputs.r2_decided_at, season.rules.document)
    )
    found = _offset(row, share, basis)
    if found.round is None or priced is None:
        return found
    view = priced.view(found.round)
    # RoundView.decided is the open round's decided amount, and the amount it locked once posted (pricing.py:332).
    return replace(found, round_amount=view.decided if view is not None else None)


def offset_as_of(
    row: RegisterRow,
    share: RequestShare,
    at: datetime,
    *,
    events: Iterable[DecisionEvent],
    program_key: str | None,
    rules: AidRules | None,
) -> ShareOffset:
    """share_offset replayed at `at` (Season › History's Round column, owner 2026-10-10): the share's request's Round 1
    and appeal Posted instants folded from the decisions recorded by then, under the program and rules that priced it
    then. No round amount: History shows what was recorded and never re-prices. `events` may hold other requests'."""
    if program_key is None or rules is None:
        return _offset(row, share, None)
    rounds = fold_rounds((e for e in events if e.request_id == share.request_id), as_of=at).get(share.request_id, {})
    r1, r2 = rounds.get(1), rounds.get(2)
    return _offset(
        row,
        share,
        (
            program_key,
            r1.locked_at if r1 is not None and r1.posted else None,
            r2.locked_at if r2 is not None and r2.posted else None,
            rules,
        ),
    )


def with_offsets(response: GrantsResponse, rows: Sequence[RegisterRow], season: Season) -> GrantsResponse:
    """The grants read with every share of every row (the Register, and the copies in needs a camper and waiting)
    naming what it offsets. A row the register didn't build, or a share it doesn't hold, is left as it was."""
    by_key = {(r.kind, r.transaction_cm_id, r.commitment_id): r for r in rows}

    def annotated(grant: GrantRowOut) -> GrantRowOut:
        row = by_key.get((grant.kind, grant.transaction_cm_id, grant.commitment_id))
        if row is None:
            return grant
        shares = {s.request_id: s for s in row.requests}
        out = []
        for sent in grant.requests:
            share = shares.get(sent.request_id)
            if share is None:
                out.append(sent)
                continue
            found = share_offset(row, share, season)
            amount = money(found.round_amount) if found.round_amount is not None else None
            out.append(sent.model_copy(update={"offsets": found.offsets, "round": found.round, "round_amount": amount}))
        return grant.model_copy(update={"requests": out})

    return response.model_copy(
        update={
            "grants": [annotated(g) for g in response.grants],
            "needs_camper": [n.model_copy(update={"grant": annotated(n.grant)}) for n in response.needs_camper],
            "waiting": [w.model_copy(update={"grant": annotated(w.grant)}) for w in response.waiting],
        }
    )


class GrantsRegisterService:
    """GET /grants/{year}: Grants' one read (D21) with each share's round (ask 10). The season is priced once, on the
    register the read shows: one grants load (OneGrantsLoad) serves both."""

    def __init__(
        self,
        grants: GrantsLoader,
        store: DecisionsStore,
        pricing: PricingRules,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._grants = grants
        self._store = store
        self._pricing = pricing
        self._clock: Callable[[], datetime] = clock or (lambda: datetime.now(UTC))

    async def read(self, year: int) -> GrantsResponse:
        shared = OneGrantsLoad(self._grants, year)
        decisions = FinancialAidDecisionsService(self._store, self._pricing, shared.register, clock=self._clock)
        season, (response, rows) = await asyncio.gather(decisions.season(year), shared.read())
        return with_offsets(response, rows, season)
