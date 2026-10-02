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
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
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
from bunking.financial_aid.calculator.grants import GrantRound, grant_round
from bunking.financial_aid.rules.schema import AidRules

_EXCLUDED: Final[Mapping[GrantRound, ShareOffsetOut]] = {
    "not_offset_program": "not_offset_program",
    "not_received": "not_received",
}


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


def share_offset(row: RegisterRow, share: RequestShare, season: Season) -> ShareOffset:
    """The round of `share`'s request the rules count this share in, and that round's amount now. A share known after
    Round 1 posted offsets Round 2 only where an appeal subtracts grants (D139); else the offer stands (D43)."""
    if not reaches_calculator(row):
        # A share exists only on a counted row, and the register holds outside and incentive lines only, so the bridge
        # leaves it out for one of two reasons.
        return ShareOffset("incentive" if row.funder_type != "outside" else "pays_after_camp_aid")
    priced = season.priced.get(share.request_id)
    if priced is None or priced.inputs is None or season.rules is None:
        return ShareOffset("not_priced")
    rules = season.rules.document
    found = grant_round(bridge_input(row, share), priced.inputs, rules)
    if found == "round_1" or (found == "after_round_1" and _appeal_subtracts_grants(rules)):
        n = 1 if found == "round_1" else 2
        view = priced.view(n)
        # RoundView.decided is the open round's decided amount, and the amount it locked once posted (pricing.py:332).
        return ShareOffset("round", n, view.decided if view is not None else None)
    return ShareOffset(_EXCLUDED.get(found, "after_offer"))


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
