"""The March bulk file (campership slice 3, ask 6; clean spec §8.3; D21, D52, D73; owner ruling S3-7).

A download-only read: it changes no state, and nothing marks a row posted (D52, D73). The file is SENT to
CampMinder's staff in the registrar's 2025 layout (S3-7), so the server owns the row rule (D21) and the browser only
writes the five columns.

THE ROWS. Every request whose Round 1 needs an offer: decided and not ticked Posted (pricing's `needs_offer`; the
Round 1 group of Requests > Needs an offer, §8.3). One row per payer share of it, at that share's whole-dollar part of
Round 1's decided amount (split_award, the split the grid and the household page show); one payer is one row.
Never in the file:
  * a posted Round 1, whatever its later rounds need: sending it again double-posts (D73's risk);
  * a held, pending or undecided Round 1: nothing is decided to send (D44);
  * a request that isn't live (withdrawn, duplicate, cancelled in Kindred or CampMinder): pricing gives it no Round 1
    to offer (Decision 14).
A $0 Round 1 is a real zero (D74) and still needs its offer: it is a $0 row (owner question 2, default). A household's
own request (Family Camp) names no camper: blank names and no Personal Id (owner question 1, default).

Names are CampMinder's (persons.first_name and last_name, never the preferred name): CampMinder's staff match on them.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import TYPE_CHECKING, Protocol

from api.schemas.financial_aid_march_file import MarchFileOut, MarchFileRowOut
from api.services.financial_aid_intake_types import PayerShareRecord, RequestRecord
from api.services.financial_aid_ledger_service import money
from api.services.financial_aid_share_split import payers, split
from bunking.financial_aid.decisions import PricedRequest
from bunking.logging_config import get_logger

if TYPE_CHECKING:  # annotations only, as To place does: the service module is heavy
    from api.services.financial_aid_decisions_service import FinancialAidDecisionsService

logger = get_logger(__name__)


@dataclass(frozen=True)
class MarchShare:
    """One payer share of a Round 1 offer: one row of the file."""

    request_id: str
    person_cm_id: int  # the camper; 0 for a household's own request (Family Camp)
    household_cm_id: int  # the payer share's household: the file's Primary Childhood ID
    amount: Decimal  # the share's whole-dollar part of Round 1's decided amount
    applicant: bool  # the household that applied: its row comes first


def round1_to_offer(priced: PricedRequest) -> Decimal | None:
    """Round 1's decided amount while it needs an offer (decided, not ticked Posted); None otherwise."""
    view = next((v for v in priced.rounds if v.round == 1), None)
    if view is None or view.status != "needs_offer":
        return None
    return view.decided


def march_shares(
    requests: Mapping[str, RequestRecord],
    priced: Mapping[str, PricedRequest],
    shares: Mapping[str, Sequence[PayerShareRecord]],
    left_out: list[str] | None = None,
) -> list[MarchShare]:
    """Every payer share of every Round 1 offer still to make, by request. A request whose shares don't split is left
    out; its id is appended to `left_out` when the caller passes one, so the read can count it."""
    out: list[MarchShare] = []
    for request_id, request in sorted(requests.items()):
        item = priced.get(request_id)
        decided = round1_to_offer(item) if item is not None else None
        if decided is None:
            continue
        applicant = request.household_cm_id
        parts = split(decided, payers(request_id, applicant, shares.get(request_id, ())), applicant)
        if not parts:  # incomplete shares hold the request, so this can't happen; never guess a row
            logger.warning("March file: request %s needs a Round 1 offer but its payer shares don't split", request_id)
            if left_out is not None:
                left_out.append(request_id)
            continue
        out.extend(
            MarchShare(request_id, request.person_cm_id, household, amount, household == applicant)
            for household, amount in parts.items()
        )
    return out


def march_rows(shares: Sequence[MarchShare], names: Mapping[int, tuple[str, str]]) -> list[MarchFileRowOut]:
    """The file's rows: by camper (last, then first name), then person and request, the applying household first."""

    def row(share: MarchShare) -> MarchFileRowOut:
        first, last = names.get(share.person_cm_id, ("", "")) if share.person_cm_id > 0 else ("", "")
        return MarchFileRowOut(
            request_id=share.request_id,
            camper_first=first,
            camper_last=last,
            total_award=money(share.amount),
            primary_childhood_id=share.household_cm_id,
            personal_id=share.person_cm_id if share.person_cm_id > 0 else None,
        )

    built = [(share, row(share)) for share in shares]
    built.sort(
        key=lambda pair: (
            pair[1].camper_last.casefold(),
            pair[1].camper_first.casefold(),
            pair[0].person_cm_id,
            pair[0].request_id,
            not pair[0].applicant,
            pair[0].household_cm_id,
        )
    )
    return [out for _, out in built]


class CamperNames(Protocol):
    async def fetch_camper_names(self, year: int, person_cm_ids: Collection[int]) -> dict[int, tuple[str, str]]: ...


class MarchFileService:
    def __init__(self, decisions: FinancialAidDecisionsService, store: CamperNames) -> None:
        self._decisions = decisions
        self._store = store

    async def read(self, year: int) -> MarchFileOut:
        """The season's March file, live (§8.3: made the morning it is sent). Changes nothing."""
        season = await self._decisions.season(year)
        left_out: list[str] = []
        shares = march_shares(season.requests, season.priced, season.shares, left_out)
        people = sorted({share.person_cm_id for share in shares if share.person_cm_id > 0})
        names = await self._store.fetch_camper_names(year, people)
        rows = march_rows(shares, names)
        logger.info(
            "March file year=%s rows=%s requests=%s left_out=%s",
            year,
            len(rows),
            len({s.request_id for s in shares}),
            len(left_out),
        )
        return MarchFileOut(year=year, rows=rows)
