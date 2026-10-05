"""The household page (clean spec §6.3; D8, D26, D32, D50, D77, D127): one aggregate read for one family,
built on the season the Requests grid prices (D21: the server decides), so its request rows are the grid's
own rows and every figure matches the grid and Today.

Scope (D26): the household it was opened from, plus every household holding a payer share in its
requests, both ways (the requests it applied for and the requests it pays a share of). The scope is households,
and everything on the page follows it (Decision 4): every request a scope household applied for, and the scope
households' postings, grants, incomes, links and log. A linked household outside the scope is read only to name
it on its link row (its row and members: owner ruling 2026-10-04, late), and a scope household with no camper on the
page (a second payer) has its members read for its card's adults and emails (owner N11, 2026-10-04 late).

Included requests (D77's band) are live ones: not withdrawn, duplicate or cancelled (the budget's `live`).
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from datetime import datetime
from decimal import Decimal
from typing import Any, Final, Protocol

from api.schemas.financial_aid_decisions import ConfirmationStatusOut, GridRowOut
from api.schemas.financial_aid_grants import GrantRowOut
from api.schemas.financial_aid_household_page import (
    ConfirmationStateOut,
    HistoryEntryOut,
    HouseholdCardOut,
    HouseholdGrantRowOut,
    HouseholdMoneyOut,
    HouseholdPageLinkOut,
    HouseholdPageResponse,
    HouseholdRequestOut,
    HouseholdTotalsOut,
    IncomeOut,
    ReceiptLabelOut,
    ReceiptOut,
    Round3ContextOut,
    ShareLineOut,
)
from api.schemas.financial_aid_intake import ApplicationDetailResponse
from api.services.financial_aid_casework_service import CaseworkNotFoundError
from api.services.financial_aid_change_log_reads import log_detail
from api.services.financial_aid_decisions_service import (
    DecisionsStore,
    FinancialAidDecisionsService,
    PricingRules,
    is_included,
)
from api.services.financial_aid_grants_register import RegisterRow, counts_as_outside, outside_grants_by_request
from api.services.financial_aid_grants_service import GrantsLoader, OneGrantsLoad
from api.services.financial_aid_intake_types import PayerShareRecord
from api.services.financial_aid_ledger_service import (
    accepted_index,
    household_display_name,
    money,
    parse_pb_datetime,
    person_display_name,
    posting_line,
)
from api.services.financial_aid_payer_shares import share_status
from api.services.financial_aid_reconciliation import (
    page_scope as page_scope,  # re-exported: it lives in the light module
)
from api.services.financial_aid_request_overrides import DEFAULT_REASON_CODES
from api.services.financial_aid_requesters import requester_names
from api.services.financial_aid_share_split import dollars, payers, split
from api.utils.age import ADULT_AGE
from bunking.financial_aid.calculator.result import TraceStep
from bunking.financial_aid.decisions import PricedRequest, RoundState
from bunking.financial_aid.errors import FinancialAidError
from bunking.geo_normalizer.zip_counties import county_for_postal_code

_ZERO = Decimal(0)
# The round states whose amount isn't decided yet (Decision 2): a held round's amount is unknown (D44).
_UNDECIDED: Final = frozenset({"held", "not_decided", "pending_approval"})
# The lock_source the 2026 decision-year load (D67) is to write on its reproduced rounds: the receipt then
# reads "2026, reproduced from the repaired sheet". Nothing writes it yet; the load's plan owns it.
REPRODUCED = "reproduced"


def _share_state(
    row: GridRowOut, household_cm_id: int, adds_up: bool
) -> tuple[Decimal | None, ConfirmationStatusOut | None]:
    """A payer's money in CampMinder and its state: its own share's when the request is split (main spec
    §11), else the request's: one payer, or a reversed request (nothing is left in CampMinder for any payer).
    Shares that don't add up to 100% (the same test `split` makes, so it yields no parts either) have no share
    of their own to show, one payer or several: the request's whole figure is never one payer's."""
    c = row.confirmation
    if c is None:
        return None, None
    if not c.shares:
        return (dollars(c.in_campminder), c.status) if adds_up else (None, None)
    share = next((s for s in c.shares if s.household_cm_id == household_cm_id), None)
    if share is None:
        return None, None
    return dollars(share.in_campminder), share.status


def share_lines(row: GridRowOut, shares: Sequence[PayerShareRecord], chips: Mapping[int, int]) -> list[ShareLineOut]:
    shares = payers(row.request_id, row.household_cm_id, shares)
    decided = split(dollars(row.total_decided), shares, row.household_cm_id)
    posted = split(dollars(row.total_posted), shares, row.household_cm_id)
    adds_up = share_status(shares) == "complete"
    out = []
    for share in sorted(shares, key=lambda s: (chips.get(s.household_cm_id, len(chips) + 1), s.household_cm_id)):
        held, status = _share_state(row, share.household_cm_id, adds_up)
        mine_decided = decided.get(share.household_cm_id)
        mine_posted = posted.get(share.household_cm_id)
        out.append(
            ShareLineOut(
                household_cm_id=share.household_cm_id,
                chip=chips.get(share.household_cm_id, 0),
                share_pct=float(share.share_pct),
                decided=money(mine_decided) if mine_decided is not None else None,
                posted=money(mine_posted) if mine_posted is not None else None,
                in_campminder=money(held) if held is not None else None,
                status=status,
            )
        )
    return out


def included(row: GridRowOut) -> bool:
    """D77's included request (is_included): live and not cancelled (D129)."""
    return is_included(row.request_status, cancelled=row.cancellation is not None)


def _states(pairs: Iterable[tuple[ConfirmationStatusOut, Decimal]]) -> list[ConfirmationStateOut]:
    counts: dict[ConfirmationStatusOut, int] = defaultdict(int)
    gaps: dict[ConfirmationStatusOut, Decimal] = defaultdict(Decimal)
    for status, gap in pairs:
        counts[status] += 1
        gaps[status] += gap
    return [ConfirmationStateOut(status=s, count=counts[s], gap=money(gaps[s])) for s in sorted(counts)]


def _sum(values: Iterable[Decimal | None]) -> Decimal | None:
    known = [v for v in values if v is not None]
    return sum(known, _ZERO) if known else None


def band_grants_by_request(register: Iterable[RegisterRow]) -> dict[str, Decimal]:
    """The grants the band subtracts, per request. THE one place Decision 7 (⚠, the owner's) lives: the counted
    outside grants on the request, live lines plus open commitments (D116, D55; Expected never, D56), INCLUDING a
    last-dollar grantor's (D77's "live outside-grant lines", D143), as the budget's below-the-line money does.
    The other reading (§5.8's gloss "the same grants the calculator subtracts") is `grant_inputs_by_request`,
    which leaves that grant out. Flipping it is this function,
    test_a_last_dollar_grant_counts_in_the_band_and_the_share_never_goes_below_zero, and the grant rows' in_band
    flag (grant_rows_with_band_flag, test_a_last_dollar_grant_is_in_the_band_as_the_band_counts_it)."""
    return outside_grants_by_request(register)


def grant_rows_with_band_flag(grants: Iterable[GrantRowOut], rows: Sequence[GridRowOut]) -> list[HouseholdGrantRowOut]:
    """Each grant row with in_band: whether the band counted it. Same rule as band_grants_by_request
    (counts_as_outside) and totals (included requests only), so a counted grant on a withdrawn or duplicate
    request reads False. The band takes a grant per request share: a grant split over a live and a withdrawn
    request reads True, and only its live share is in the band."""
    live = {row.request_id for row in rows if included(row)}
    return [
        HouseholdGrantRowOut(
            **g.model_dump(),
            in_band=counts_as_outside(g.counts, g.funder_type) and any(s.request_id in live for s in g.requests),
        )
        for g in grants
    ]


def _band_states(row: GridRowOut) -> list[tuple[ConfirmationStatusOut, Decimal]]:
    """A request's confirmation for the band: its own state, or, when it is confirmed and split, each payer
    share's (D59: one payer short is not "confirmed"), as Today and the household cards count it. A request whose
    shares don't add up to 100% counts once here, as the request's own state, as Today counts it; no household
    card counts it, having no share of its own to show (_share_state)."""
    c = row.confirmation
    if c is None:
        return []
    if c.status == "confirmed" and c.shares:
        return [(s.status, Decimal(str(s.in_campminder)) - Decimal(str(s.expected))) for s in c.shares]
    return [(c.status, Decimal(str(c.gap)))]


def request_grants(
    row: GridRowOut, grants_by_request: Mapping[str, Decimal]
) -> tuple[Decimal, Decimal | None, Decimal | None]:
    """A request's counted grants, the part of them its family owed (applied), and the rest (beyond what was owed):
    ⚠38 (b), owner ruling 2026-10-01. Applied = min(grants, max(0, cost − decided)), so cost − decided − applied is the
    request's floored share whenever its aid alone doesn't pass its cost (Decision 1 names that edge). Applied and
    beyond are None until the request has a cost and a decided total, and for a request outside the band."""
    grants = grants_by_request.get(row.request_id, _ZERO)
    cost, decided = dollars(row.cost), dollars(row.total_decided)
    if not included(row) or cost is None or decided is None:
        return grants, None, None
    applied = min(grants, max(_ZERO, cost - decided))
    return grants, applied, grants - applied


def totals(rows: Sequence[GridRowOut], grants_by_request: Mapping[str, Decimal]) -> HouseholdTotalsOut:
    """The band (D77, §5.8): cost − {camp} aid (decided) − grants = family's share, then Posted with its states.
    Grants come from band_grants_by_request. Each request's share is floored at $0, then summed (owner ruling
    2026-10-01): an over-covered request (a last-dollar grantor's full-price first line before it reverses, D143;
    a minimum award paid though grants cover the cost; a late grant) owes nothing and never cancels a sibling's
    real share. The share is "—" until every included request has a cost and a decided total. With no included
    request every figure is "—"."""
    rows = [row for row in rows if included(row)]
    costs = [dollars(row.cost) for row in rows]
    decided = [dollars(row.total_decided) for row in rows]
    cost = sum((c for c in costs if c is not None), _ZERO) if rows and None not in costs else None
    aid = _sum(decided)
    grants = sum((grants_by_request.get(row.request_id, _ZERO) for row in rows), _ZERO)
    share = (
        sum(
            (
                max(_ZERO, c - d - grants_by_request.get(row.request_id, _ZERO))
                for row, c, d in zip(rows, costs, decided, strict=True)
                if c is not None and d is not None
            ),
            _ZERO,
        )
        if cost is not None and None not in decided
        else None
    )
    parts = [request_grants(row, grants_by_request) for row in rows]
    applied = [a for _, a, _ in parts]
    beyond = [b for _, _, b in parts]
    known = share is not None  # grants applied wait with the family's share (Decision 1)
    return HouseholdTotalsOut(
        cost=money(cost) if cost is not None else None,
        decided=money(aid) if aid is not None else None,
        grants=money(grants) if rows else None,
        family_share=money(share) if share is not None else None,
        posted=money(p) if (p := _sum(dollars(row.total_posted) for row in rows)) is not None else None,
        states=_states(pair for row in rows for pair in _band_states(row)),
        decided_partial=any(r.status in _UNDECIDED for row in rows for r in row.rounds),
        grants_applied=money(sum((a for a in applied if a is not None), _ZERO)) if known else None,
        grants_beyond_owed=money(sum((b for b in beyond if b is not None), _ZERO)) if known else None,
    )


def household_money(
    household_cm_id: int,
    rows: Sequence[GridRowOut],
    shares: Mapping[str, Sequence[PayerShareRecord]],
    chips: Mapping[int, int],
) -> HouseholdMoneyOut:
    """A card's money line (D32, D59): this household's payer share of decided and posted over the page's
    included requests, and its shares' confirmation states."""
    decided: list[Decimal] = []
    posted: list[Decimal] = []
    held: list[Decimal] = []
    states: list[tuple[ConfirmationStatusOut, Decimal]] = []
    for row in rows:
        if not included(row):
            continue
        for line in share_lines(row, shares.get(row.request_id, ()), chips):
            if line.household_cm_id != household_cm_id:
                continue
            if line.decided is not None:
                decided.append(Decimal(str(line.decided)))
            if line.posted is not None:
                posted.append(Decimal(str(line.posted)))
            if line.in_campminder is not None:
                held.append(Decimal(str(line.in_campminder)))
            if line.status is not None:
                mine_posted = Decimal(str(line.posted)) if line.posted is not None else _ZERO
                mine_held = Decimal(str(line.in_campminder)) if line.in_campminder is not None else _ZERO
                states.append((line.status, mine_held - mine_posted))
    return HouseholdMoneyOut(
        decided=money(sum(decided, _ZERO)) if decided else None,
        posted=money(sum(posted, _ZERO)) if posted else None,
        in_campminder=money(sum(held, _ZERO)) if held else None,
        states=_states(states),
    )


# --- the service ---------------------------------------------------------------------------------------


class HouseholdNotFoundError(FinancialAidError, LookupError):
    """No aid activity for the household this season: no application or request, grant or posting (D8)."""


class CaseworkReads(Protocol):
    async def application_detail(self, year: int, household_cm_id: int) -> ApplicationDetailResponse: ...


class HouseholdLedgerReads(Protocol):
    async def fetch_postings(
        self, year: int, household_ids: Collection[int] | None = None, *, include_reversed: bool = False
    ) -> list[Any]: ...
    async def fetch_dispositions(self, year: int) -> list[Any]: ...
    async def fetch_households(self, year: int, cm_ids: Collection[int]) -> list[Any]: ...
    async def fetch_persons(self, year: int, cm_ids: Collection[int]) -> list[Any]: ...
    async def fetch_household_members(self, year: int, household_ids: Collection[int]) -> list[Any]: ...
    async def fetch_links(self, year: int) -> list[Any]: ...
    async def fetch_session_counts(self, year: int, session_cm_ids: Collection[int]) -> dict[int, tuple[int, int]]: ...
    async def fetch_capacities(self, year: int, session_cm_ids: Collection[int]) -> dict[int, Any]: ...
    async def fetch_user_names(self, emails: Collection[str]) -> dict[str, str]: ...


def round3_context(
    row: GridRowOut, counts: Mapping[int, tuple[int, int]], capacities: Mapping[int, Any]
) -> Round3ContextOut | None:
    if row.session_cm_id <= 0 or not any(r.round == 3 for r in row.rounds):
        return None
    enrolled, waitlisted = counts.get(row.session_cm_id, (0, 0))
    cap = capacities.get(row.session_cm_id)
    return Round3ContextOut(
        session_cm_id=row.session_cm_id,
        enrolled=enrolled,
        waitlisted=waitlisted,
        capacity=int(cap.capacity) if cap is not None else None,
        capacity_note=str(getattr(cap, "note", "") or "") if cap is not None else "",
    )


def _name(names: Mapping[str, str], actor: str) -> str | None:
    return names.get(actor.strip().lower()) or None  # fetch_user_names keys are lowercased emails


def receipts(
    priced: PricedRequest,
    rounds: Mapping[int, RoundState],
    *,
    year: int,
    rules_version: int | None,
    names: Mapping[str, str],
) -> list[ReceiptOut]:
    """One receipt per round the request shows (D43, D52, §4.7): a posted round's snapshot as locked, else
    the request priced now. A round with neither (no rules priced it yet) has none."""
    out: list[ReceiptOut] = []
    for view in priced.rounds:
        state = rounds.get(view.round, RoundState(round=view.round))
        # A refused Round 3 was never decided: its keyer is not the decider (D79).
        decided_by = (
            _name(names, state.decided_by)
            if view.round == 3 and state.award is not None and state.approval != "refused"
            else None
        )
        snapshot = state.snapshot or {}
        result = snapshot.get("result")
        if state.posted and isinstance(result, Mapping) and state.rules_version is not None:
            source = state.lock_source if state.lock_source in ("tick", "ledger", "placement") else None
            out.append(
                ReceiptOut(
                    round=view.round,
                    trace=[TraceStep.model_validate(step) for step in result.get("trace", [])],
                    label=ReceiptLabelOut(
                        kind="reproduced" if state.lock_source == REPRODUCED else "locked",
                        season=year,
                        rules_version=state.rules_version,
                        locked_on=state.posted_on,
                        lock_source=source,
                        ticked_by_name=_name(names, state.posted_by) if source in ("tick", "placement") else None,
                        decided_by_name=decided_by,
                    ),
                )
            )
        elif not state.posted and priced.result is not None and rules_version is not None:
            out.append(
                ReceiptOut(
                    round=view.round,
                    trace=list(priced.result.trace),
                    label=ReceiptLabelOut(
                        kind="live",
                        season=year,
                        rules_version=rules_version,
                        locked_on=None,
                        lock_source=None,
                        ticked_by_name=None,
                        decided_by_name=decided_by,
                    ),
                )
            )
    return out


def _is_adult(person: Any) -> bool:
    """Aged ADULT_AGE or over (a missing or 0 age never is). Not is_camper: the sync sets it for anyone with an
    attendee row in any program, Family Camp parents included, so false only means staff (coordinator, N11 (A)).
    `persons.age` is a snapshot: good enough to name someone, not to count them."""
    return float(getattr(person, "age", 0) or 0) >= ADULT_AGE


def _adults(people: Iterable[Any], *, members: bool = False) -> list[str]:
    """The parent names `people`'s records give, sorted. With `members` (a household's own people, not the page's
    campers), a member who is an adult names themselves (owner N11 follow-up, 2026-10-05): their own names lead,
    sorted, then any further parent names, deduplicated case-insensitively against both the name shown (preferred
    first) and the legal "first last"."""
    people = list(people)
    named = {
        f"{str(p.get('first') or '').strip()} {str(p.get('last') or '').strip()}".strip()
        for person in people
        for p in (getattr(person, "parent_names", None) or [])
        if isinstance(p, Mapping)
    }
    own: dict[str, str] = {}
    known: set[str] = set()
    for person in (p for p in people if members and _is_adult(p)):
        name = person_display_name(person)
        legal = f"{str(person.first_name or '').strip()} {str(person.last_name or '').strip()}".strip()
        if name and name.lower() not in known:
            own[name.lower()] = name
        known |= {name.lower(), legal.lower()} - {""}
    return [
        *sorted(own.values(), key=str.lower),
        *sorted((n for n in named - {""} if n.lower() not in known), key=str.lower),
    ]


def _city(household: Any | None) -> str:
    if household is None:
        return ""
    parts = [str(getattr(household, f, "") or "").strip() for f in ("billing_city", "billing_state")]
    return ", ".join(p for p in parts if p)


def short_family_name(surnames: Iterable[str], family_name: str) -> str:
    """O3 (owner 2026-10-04, late): a household chip's short name. The weekend family-journey rule
    (frontend/src/components/weekend/householdIdentity.ts, childSurnames + familyNameLabel) without its "The … Family"
    wrapper, so summer, weekend and Camperships name a household alike: every distinct surname, trimmed, blanks dropped,
    deduplicated case-insensitively with the first spelling kept, in arrival order, joined "A", "A & B", "A, B & C" and
    never truncated (a whole string is one surname, hyphen or space and all). None: the full `family_name`."""
    seen: set[str] = set()
    distinct: list[str] = []
    for value in surnames:
        surname = value.strip()
        if surname and surname.lower() not in seen:
            seen.add(surname.lower())
            distinct.append(surname)
    if not distinct:
        return family_name
    return distinct[0] if len(distinct) == 1 else f"{', '.join(distinct[:-1])} & {distinct[-1]}"


def _oldest_first(people: Iterable[Any]) -> list[Any]:
    """Campers oldest first, as the weekend roster lists a party's children (lodging_roster_service's
    _children_oldest_first, by age), ties by CampMinder id."""
    return sorted(people, key=lambda p: (-float(getattr(p, "age", 0) or 0), int(p.cm_id)))


def _household_of(person: Any) -> int:
    return int(getattr(person, "household_id", 0) or 0)


def _emails(people: Iterable[Any]) -> list[str]:
    return sorted({str(getattr(p, "primary_email", "") or "").strip() for p in people} - {""})


def _link_row(link: Any, household: Any | None, adults: list[str]) -> HouseholdPageLinkOut:
    """The link, and its household named as a card names it: `adults` are its card's (`HouseholdPageService`'s
    `household_adults`)."""
    cm_id = int(link.household_cm_id)
    return HouseholdPageLinkOut(
        family_name=household_display_name(household, cm_id),
        adults=adults,
        city=_city(household),
        id=str(link.id),
        year=int(link.year),
        household_cm_id=int(link.household_cm_id),
        family_key=str(link.family_key),
        source=str(link.source),
        excluded=bool(link.excluded),
        note=str(link.note or ""),
        actor=str(link.actor or ""),
    )


class HistoryReads(Protocol):
    async def fetch_entity_log(
        self, year: int, *, exact: Collection[str], containing: Collection[str]
    ) -> list[Any]: ...


def _history_entry(record: Any, request_ids: Collection[str]) -> HistoryEntryOut | None:
    """One timeline entry; a row with no created time has no place in the order and is left out."""
    created = parse_pb_datetime(getattr(record, "created", None))
    if created is None:
        return None
    entity_id = str(record.entity_id)
    head = entity_id.split(":", 1)[0]
    return HistoryEntryOut(
        at=created,
        action=str(record.action),
        entity=str(record.entity),
        entity_id=entity_id,
        request_id=head if head in request_ids else None,
        actor=str(record.actor or ""),
        reason=str(getattr(record, "reason", "") or ""),
        operation_id=str(getattr(record, "operation_id", "") or ""),
        before=log_detail(getattr(record, "before", None)),
        after=log_detail(getattr(record, "after", None)),
    )


def _correction_ids(details: Iterable[ApplicationDetailResponse]) -> set[str]:
    answers = [a for d in details for a in (*d.answers, *(r.ask for r in d.requests))]
    return {c.id for a in answers for c in a.history}


async def _income(casework: CaseworkReads, year: int, household_cm_id: int) -> ApplicationDetailResponse | None:
    try:
        return await casework.application_detail(year, household_cm_id)
    except CaseworkNotFoundError:
        return None


class HouseholdPageService:
    """The household page's one aggregate read (D21): the live season priced once with its grants register
    (OneGrantsLoad), scoped to the family (D26), plus the family's own reads: its names, incomes, postings,
    the households' details, links and log, and the details of any linked household outside the scope."""

    def __init__(
        self,
        *,
        store: DecisionsStore,
        pricing: PricingRules,
        grants: GrantsLoader,
        casework: CaseworkReads,
        ledger: HouseholdLedgerReads,
        history: HistoryReads,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._store = store
        self._pricing = pricing
        self._grants = grants
        self._casework = casework
        self._ledger = ledger
        self._history = history
        self._clock = clock

    async def read(self, year: int, household_cm_id: int) -> HouseholdPageResponse:
        shared = OneGrantsLoad(self._grants, year)
        decisions = FinancialAidDecisionsService(self._store, self._pricing, shared.register, clock=self._clock)
        season, (grants, _) = await asyncio.gather(decisions.season(year), shared.read())
        season = await decisions.with_unticked(season)  # D162: the grid's own rows, Not reconciled's reasons and all
        scope = page_scope(household_cm_id, season.requests, season.shares)
        households = set(scope.households)
        request_ids = set(scope.request_ids)
        campers = sorted({season.requests[rid].person_cm_id for rid in scope.request_ids} - {0})
        actors = {
            actor
            for rid in scope.request_ids
            for state in season.rounds.get(rid, {}).values()
            for actor in (state.posted_by, state.decided_by)
        } - {""}
        actors = {a.strip() for a in actors} - {""}
        (
            (names, user_names, postings, dispositions, household_rows, persons),
            links,
            details,
            contacts,
        ) = await asyncio.gather(
            asyncio.gather(
                self._store.fetch_names(year, scope.households, campers),
                self._ledger.fetch_user_names(actors) if actors else _no_names(),
                self._ledger.fetch_postings(year, scope.households, include_reversed=True),
                self._ledger.fetch_dispositions(year),
                self._ledger.fetch_households(year, scope.households),
                self._ledger.fetch_persons(year, campers) if campers else _nothing(),
            ),
            self._ledger.fetch_links(year),
            asyncio.gather(*(_income(self._casework, year, h) for h in scope.households)),
            self._store.fetch_fa_contacts(year),
        )
        requesters = requester_names(contacts, season.requests.values())
        rows = [decisions.row_of(season, names, rid, requesters) for rid in scope.request_ids]
        r3_sessions = sorted(
            {r.session_cm_id for r in rows if r.session_cm_id > 0 and any(x.round == 3 for x in r.rounds)}
        )
        counts, capacities = (
            await asyncio.gather(
                self._ledger.fetch_session_counts(year, r3_sessions), self._ledger.fetch_capacities(year, r3_sessions)
            )
            if r3_sessions
            else ({}, {})
        )
        grant_rows = [
            g
            for g in grants.grants
            if g.household_cm_id in households or any(s.request_id in request_ids for s in g.requests)
        ]
        incomes = [d for d in details if d is not None]
        if not rows and not grant_rows and not postings and not incomes:
            raise HouseholdNotFoundError(f"household {household_cm_id} has no aid activity in {year}")

        # The canonical family set (`family_household_set`) takes members from non-excluded rows only, so an
        # exclusion never pulls the family's other members in; the scope's own excluded rows still show.
        family_keys = {
            str(ln.family_key) for ln in links if int(ln.household_cm_id) in households and not bool(ln.excluded)
        }
        family_links = [
            ln
            for ln in sorted(links, key=lambda ln: (int(ln.household_cm_id), str(ln.id)))
            if str(ln.family_key) in family_keys or int(ln.household_cm_id) in households
        ]
        # A linked household outside the scope has no card, so its row and members are read here, for its name (the
        # same reads a household search makes); one in the scope reads as its card does. A card with no camper on the
        # page (a second payer) has its own members read too, for its adults and emails (owner N11, 2026-10-04 late).
        outside = sorted({int(ln.household_cm_id) for ln in family_links} - households)
        camper_less = households - {_household_of(p) for p in persons}
        members_of = sorted(set(outside) | camper_less)
        log, (linked_rows, members) = await asyncio.gather(
            self._history.fetch_entity_log(
                year,
                exact={
                    *(r.application_id for r in season.requests.values() if r.household_cm_id in households),
                    *_correction_ids(incomes),
                    *(g.commitment_id for g in grant_rows if g.commitment_id),
                    *(str(ln.id) for ln in family_links),
                }
                - {""},
                containing=request_ids,
            ),
            asyncio.gather(
                self._ledger.fetch_households(year, outside) if outside else _nothing(),
                self._ledger.fetch_household_members(year, members_of) if members_of else _nothing(),
            ),
        )
        chips = {h: i + 1 for i, h in enumerate(scope.households)}
        asks = {r.id: r for d in incomes for r in d.requests}
        by_household = {int(h.cm_id): h for h in household_rows}
        people = {int(p.cm_id): p for p in persons}
        linked_households = {int(h.cm_id): h for h in linked_rows}

        def household_people(h: int) -> list[Any]:
            """The people household `h`'s adults and emails come from, on its card and its link alike: the page's
            campers in it, or, with none (a second payer, or a linked household outside the scope), its own members.
            The short name reads only their adults, and only with no camper (`short_surnames`)."""
            return campers_in(h) or [p for p in members if _household_of(p) == h]

        def campers_in(h: int) -> list[Any]:
            return [p for p in people.values() if _household_of(p) == h] if h in households else []

        def short_surnames(h: int) -> list[str]:
            """The chip's surnames, oldest first: the household's campers on the page (O3), or, with none, its adult
            members (P3, owner 2026-10-05: aged ADULT_AGE or over, as `_is_adult` reads them). Neither: none, and the
            short name falls back to the full family name."""
            source = campers_in(h) or [p for p in household_people(h) if _is_adult(p)]
            return [str(getattr(p, "last_name", "") or "") for p in _oldest_first(source)]

        def household_adults(h: int) -> list[str]:
            """Card and link alike: the campers' parent names, or, with no camper on the page, the members' adults by
            name and then their parent names."""
            return _adults(household_people(h), members=not campers_in(h))

        accepted = accepted_index(dispositions)
        rules_version = season.rules.version if season.rules is not None else None
        band = band_grants_by_request(season.register)

        def request_out(row: GridRowOut) -> HouseholdRequestOut:
            counted, applied, beyond = request_grants(row, band)
            return HouseholdRequestOut(
                row=row,
                ask=asks[row.request_id].ask if row.request_id in asks else None,
                payer_share_status=asks[row.request_id].payer_share_status if row.request_id in asks else "",
                shares=share_lines(row, season.shares.get(row.request_id, ()), chips),
                receipts=receipts(
                    season.priced[row.request_id],
                    season.rounds.get(row.request_id, {}),
                    year=year,
                    rules_version=rules_version,
                    names=user_names,
                ),
                grants=money(counted),
                grants_applied=money(applied) if applied is not None else None,
                grants_beyond_owed=money(beyond) if beyond is not None else None,
                round3_context=round3_context(row, counts, capacities),
            )

        def link_out(link: Any) -> HouseholdPageLinkOut:
            h = int(link.household_cm_id)
            row = by_household.get(h) if h in households else linked_households.get(h)
            return _link_row(link, row, household_adults(h))

        return HouseholdPageResponse(
            year=year,
            household_cm_id=household_cm_id,
            rules_version=rules_version,
            households=[
                HouseholdCardOut(
                    household_cm_id=h,
                    chip=chips[h],
                    family_name=household_display_name(by_household.get(h), h),
                    short_name=short_family_name(short_surnames(h), household_display_name(by_household.get(h), h)),
                    adults=household_adults(h),
                    phone=str(getattr(by_household.get(h), "household_phone", "") or ""),
                    emails=_emails(household_people(h)),
                    city=_city(by_household.get(h)),
                    county=county_for_postal_code(str(getattr(by_household.get(h), "billing_postal_code", "") or "")),
                    money=household_money(h, rows, season.shares, chips),
                    request_ids=[
                        row.request_id
                        for row in rows
                        if row.household_cm_id == h
                        or any(s.household_cm_id == h for s in season.shares.get(row.request_id, ()))
                    ],
                )
                for h in scope.households
            ],
            totals=totals(rows, band),
            requests=[request_out(row) for row in rows],
            incomes=[
                IncomeOut(
                    household_cm_id=d.household_cm_id,
                    status=d.status,
                    answers=d.answers,
                    notes=d.notes,
                    flags=d.flags,
                )
                for d in incomes
            ],
            grants=grant_rows_with_band_flag(grant_rows, rows),
            expected=[e for e in grants.expected if e.household_cm_id in households],
            postings=[
                posting_line(p, accepted)
                for p in sorted(postings, key=lambda p: (str(p.post_date or ""), int(p.transaction_cm_id)))
            ],
            links=[link_out(ln) for ln in family_links],
            history=[entry for record in log if (entry := _history_entry(record, request_ids)) is not None],
            override_reasons=(
                list(season.rules.document.cost.override_reasons)
                if season.rules is not None
                else list(DEFAULT_REASON_CODES)
            ),
        )


async def _nothing() -> list[Any]:
    return []


async def _no_names() -> dict[str, str]:
    return {}
