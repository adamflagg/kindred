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
A $0 Round 1 is a real zero (D74) and still needs its offer: it is a $0 row (owner question 2, default).

A FAMILY CAMP ROW (owner ruling A3 (a), 2026-10-02). A household's own request has no camper (person_cm_id 0), so its
rows name the OLDEST CHILD attending that Family Camp session, as the registrar's 2025 file does (one child per
family, all under 18): the child's CampMinder first and last names, and the child's Personal Id. Primary Childhood
ID stays each payer share's household, and every payer share of the request names the same child. The rules:
  * Attending: enrolled in the request's session_cm_id this season with status_id 2 (ACTIVE_ENROLLED_STATUS_ID,
    the house rule for active enrolled).
  * A member of the request's household: the membership rule Go's attribution and the grants register (D142's
    `_sole_camper`) use, FinancialAidRepository.fetch_household_persons_by_household: the person's own household or
    their primary or alternate childhood household.
  * A child: under 18 on the session's first day (camp_sessions.start_date), by birthdate. A session with no start
    date has no first day, so no child can be chosen.
  * Oldest: the earliest birthdate. A tie on birthdate (twins) goes to the lowest Personal Id, so the file is
    deterministic.
  * A person with no birthdate can't be ranked, so is never chosen.
  * If no child qualifies (an all-adult household, or no dated child), the row stays as it was: blank names and no
    Personal Id, and the request is logged at info.
The household's members are read in one batch for the whole file (HouseholdAttendeeReads), never per request.

Names are CampMinder's (persons.first_name and last_name, never the preferred name): CampMinder's staff match on them.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING, Protocol

from api.constants.filters import ACTIVE_ENROLLED_STATUS_ID
from api.schemas.financial_aid_march_file import MarchFileOut, MarchFileRowOut
from api.services.financial_aid_intake_types import PayerShareRecord, RequestRecord
from api.services.financial_aid_ledger_service import money
from api.services.financial_aid_share_split import payers, split
from bunking.financial_aid.decisions import PricedRequest
from bunking.logging_config import get_logger

if TYPE_CHECKING:  # annotations only, as To place does: the service module is heavy
    from api.services.financial_aid_decisions_service import FinancialAidDecisionsService, Season

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


@dataclass(frozen=True)
class HouseholdAttendee:
    """One registration of one member of a household (own or childhood household): who, where, and their birthdate."""

    household_cm_id: int
    person_cm_id: int
    session_cm_id: int
    status_id: int
    birthdate: date | None


class CamperNames(Protocol):
    async def fetch_camper_names(self, year: int, person_cm_ids: Collection[int]) -> dict[int, tuple[str, str]]: ...

    async def fetch_household_attendees(
        self, year: int, household_cm_ids: Collection[int]
    ) -> Sequence[HouseholdAttendee]: ...


def _day(text: str) -> date | None:
    """A PocketBase date or date-time string ("2027-08-20 00:00:00.000Z"), or None."""
    try:
        return date.fromisoformat(text[:10]) if text else None
    except ValueError:
        return None


def _age_on(born: date, day: date) -> int:
    return day.year - born.year - ((day.month, day.day) < (born.month, born.day))


def oldest_child(
    attendees: Sequence[HouseholdAttendee], household_cm_id: int, session_cm_id: int, first_day: date | None
) -> int | None:
    """The Personal Id of the oldest child (under 18 on the session's first day) of the household actively enrolled
    in the session: earliest birthdate, twins to the lowest Personal Id. None when no child qualifies."""
    if first_day is None:
        return None
    kids = [
        (a.birthdate, a.person_cm_id)
        for a in attendees
        if a.household_cm_id == household_cm_id
        and a.session_cm_id == session_cm_id
        and a.status_id == ACTIVE_ENROLLED_STATUS_ID
        and a.person_cm_id > 0
        and a.birthdate is not None
        and _age_on(a.birthdate, first_day) < 18
    ]
    return min(kids)[1] if kids else None


class MarchFileService:
    def __init__(self, decisions: FinancialAidDecisionsService, store: CamperNames) -> None:
        self._decisions = decisions
        self._store = store

    async def read(self, year: int) -> MarchFileOut:
        """The season's March file, live (§8.3: made the morning it is sent). Changes nothing."""
        season = await self._decisions.season(year)
        left_out: list[str] = []
        shares = march_shares(season.requests, season.priced, season.shares, left_out)
        shares = await self._name_family_camp_children(year, season, shares)
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

    async def _name_family_camp_children(self, year: int, season: Season, shares: list[MarchShare]) -> list[MarchShare]:
        """Each household request's shares (person 0) take the oldest attending child's Personal Id (ruling A3 (a));
        one read of the household members for the whole file."""
        asks = {s.request_id for s in shares if s.person_cm_id <= 0}
        if not asks:
            return shares
        households = {season.requests[r].household_cm_id for r in asks}
        attendees = await self._store.fetch_household_attendees(year, households)
        chosen: dict[str, int] = {}
        for request_id in sorted(asks):
            request = season.requests[request_id]
            session = season.sessions.get(request.session_cm_id)
            child = oldest_child(
                attendees,
                request.household_cm_id,
                request.session_cm_id,
                _day(session.start_date) if session is not None else None,
            )
            if child is None:
                logger.info("March file: request %s has no child attending to name; its row stays blank", request_id)
            else:
                chosen[request_id] = child
        return [replace(s, person_cm_id=chosen[s.request_id]) if s.request_id in chosen else s for s in shares]
