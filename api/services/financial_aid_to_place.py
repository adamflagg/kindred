"""Money > To place (campership SP11-rest; clean spec §8.1; D12, D16, D26, D58, D62, D81).

Pure functions over a season the decisions service priced (FinancialAidDecisionsService.season).
Nothing here writes.

THE POOL is the season's camp-aid money no single request takes: SP10b's family-level lines
(SeasonLedger.unplaced_lines_by_household), live only. A line's CANDIDATES are the live requests its
household has a financial stake in (D26, D58): the requests it applied for and the requests it pays a
share of, the same set build_ledger places by. Each line has one REASON (§8.1):

  several           a request could take it: several could, or one could but a person must say so
                    (a summer line on a parent or the household waits for the registrar even with one
                    request; SP10b Decision 3, D81);
  no_request        no request behind it: camp aid to a household with no live request (main spec §11's
                    "unexplained" posting);
  program_mismatch  CampMinder's description names a program this camper isn't in (D62; from 2027's
                    per-program descriptions, Go's implied_program_mismatch flag).

Kindred SUGGESTS and never places (D12, D16): a suggestion counts toward nothing until a person confirms
it. It is a whole line on one request, or a split. Its evidence is every fact that holds of it, in this
order: the exact amount a request still needs in CampMinder; the person CampMinder posted it to; the day
a round was ticked; the only request the family has; or, for a split, the amounts the requests still need
(together exactly the line) or a split in proportion to the decided amounts, a posted round's at the
amount it locked (D12). Two candidates the evidence can't tell apart get no suggestion.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from decimal import ROUND_FLOOR, Decimal
from typing import TYPE_CHECKING, Any, Final, Literal, get_args

from api.services.financial_aid_grants_register import (
    LIVE_REQUEST_STATUSES,
    Placement,
    RegisterRow,
    program_family_for_session_type,
)
from api.services.financial_aid_ledger_service import as_of_cutoff, family_household_set, parse_pb_datetime
from api.services.financial_aid_reconciliation import (
    CampLine,
    LedgerTick,
    SeasonLedger,
    SplitPart,
    apply_clawback,
    build_ledger,
    camp_date,
    ledger_ticks,
    live_net,
    locked_total,
    placeable,
    request_scope,
)
from api.services.financial_aid_reconciliation import (
    page_scope as _page_scope,
)
from bunking.financial_aid.decisions import PricedRequest
from bunking.financial_aid.money import ZERO

if TYPE_CHECKING:  # annotations only: the repository imports this module, and must not import the service
    from api.services.financial_aid_decisions_service import Season
    from api.services.financial_aid_rules_service import RulesVersion

# Go's posting flag for a description naming a program the camper isn't in (pocketbase/sync/aid_flags.go).
MISMATCH_FLAG: Final = "implied_program_mismatch"
# aid_flag_dispositions.flag for "Leave at family level" (D58: To place's own disposition).
TO_PLACE_FLAG: Final = "to_place"
# ...and a left line is that flag with this disposition (D10); the schema allows others, which are not left lines.
LEFT_DISPOSITION: Final = "accepted_let_stand"

Reason = Literal["several", "no_request", "program_mismatch"]
REASONS: Final[tuple[Reason, ...]] = ("several", "no_request", "program_mismatch")
EvidenceKind = Literal["amount", "person", "date", "only_request", "proportional"]
_CENT: Final = Decimal("0.01")


@dataclass(frozen=True)
class LineDetail:
    """What To place shows of a line beyond the ledger's figures: its CampMinder description (after any
    reclassification, aid_postings.effective_source_key) and Go's posting flags."""

    transaction_cm_id: int
    description_key: str
    flags: tuple[str, ...] = ()


@dataclass(frozen=True)
class OverrideRow:
    """An aid_attribution_overrides record in full, as To place's writes read and log it."""

    id: str
    transaction_cm_id: int
    attributed_person_cm_id: int
    attributed_session_cm_id: int
    program_family: str
    source_key_override: str
    source: str
    note: str
    split: tuple[SplitPart, ...] = ()

    def snapshot(self, year: int) -> dict[str, Any]:
        """The record's logged fields (the write service's override shape, plus `split`)."""
        return {
            "transaction_cm_id": self.transaction_cm_id,
            "year": year,
            "attributed_person_cm_id": self.attributed_person_cm_id,
            "attributed_session_cm_id": self.attributed_session_cm_id,
            "program_family": self.program_family,
            "source_key_override": self.source_key_override,
            "source": self.source,
            "note": self.note,
            "split": [part.fields() for part in self.split],
        }


@dataclass(frozen=True)
class LeftLine:
    """A line left at family level (D58): its aid_flag_dispositions record (flag TO_PLACE_FLAG)."""

    id: str
    transaction_cm_id: int
    note: str


@dataclass(frozen=True)
class SourceRow:
    """An aid_sources row as Reclassify checks it (D104) and To place names it."""

    description_key: str
    description: str
    classified: bool
    counts_as_aid: bool
    funder_type: str


@dataclass(frozen=True)
class Candidate:
    """A request the line's household has a stake in. `not_yet_in_campminder` is the part of it not yet in
    CampMinder: its locked total plus the decided amounts of the rounds waiting to be ticked, less the live
    money already placed on it (main spec §11's net total). `weight` is the same before that money: the
    request's decided amounts, a locked round's at the amount it locked (D12). `ticked_on` holds the days
    its posted rounds were ticked. A cancelled request (10b-2) is still a candidate: its family-level
    money is placed on it so To reverse can show it (SP10b-2)."""

    request_id: str
    household_cm_id: int
    person_cm_id: int
    session_cm_id: int
    program_family: str
    not_yet_in_campminder: Decimal
    weight: Decimal
    ticked_on: frozenset[date]
    cancelled: bool

    def placement(self, transaction_cm_id: int) -> Placement:
        """The staff placement that puts a whole line on this request."""
        return Placement(transaction_cm_id, self.person_cm_id, self.session_cm_id, self.program_family)

    def part(self, amount: Decimal) -> SplitPart:
        """The split part that puts `amount` of a line on this request."""
        return SplitPart(self.person_cm_id, self.session_cm_id, self.program_family, amount)


@dataclass(frozen=True)
class Evidence:
    kind: EvidenceKind
    text: str


@dataclass(frozen=True)
class Part:
    request_id: str
    amount: Decimal


@dataclass(frozen=True)
class Suggestion:
    """One part places the whole line; two or more split it."""

    parts: tuple[Part, ...]
    evidence: tuple[Evidence, ...]


@dataclass(frozen=True)
class ToPlaceItem:
    """One line in To place. `line` is the line as CampMinder posted it; `unplaced` is how much of it no
    request takes (all of it, unless a split placed some parts and a part's request has since gone)."""

    line: CampLine
    unplaced: Decimal
    reason: Reason
    candidates: tuple[Candidate, ...]
    suggestion: Suggestion | None


def open_decided(priced: PricedRequest) -> Decimal:
    """The decided amounts of the rounds waiting to be ticked, oldest first, up to the first round that
    can't be (held, pending approval, refused, not decided): the rounds a placement could tick
    (ledger_ticks walks the same rounds)."""
    total = ZERO
    for view in sorted(priced.rounds, key=lambda v: v.round):
        if view.status == "posted":
            continue
        if view.status != "needs_offer" or view.decided is None:
            break
        total += view.decided
    return total


def _candidate(season: Season, request_id: str) -> Candidate:
    request = season.requests[request_id]
    priced = season.priced[request_id]
    session = season.sessions.get(request.session_cm_id)
    weight = locked_total(priced) + open_decided(priced)
    ticked = frozenset(
        state.posted_on for state in season.rounds.get(request_id, {}).values() if state.posted and state.posted_on
    )
    return Candidate(
        request_id=request_id,
        household_cm_id=request.household_cm_id,
        person_cm_id=request.person_cm_id,
        session_cm_id=request.session_cm_id,
        program_family=program_family_for_session_type(session.session_type) if session is not None else "",
        not_yet_in_campminder=weight - live_net(season.ledger.lines(request_id)),
        weight=weight,
        ticked_on=ticked,
        cancelled=request_id in season.cancellations,
    )


def candidates(household_cm_id: int, season: Season) -> tuple[Candidate, ...]:
    """The live requests this household applied for or pays a share of (D26, D58), by request id."""
    return tuple(
        _candidate(season, request_id)
        for request_id, request in sorted(season.requests.items())
        if request.status in LIVE_REQUEST_STATUSES
        and household_cm_id in request_scope(request, season.shares.get(request_id, ()))
    )


def page_scope(household_cm_id: int, season: Season) -> frozenset[int]:
    """D26: the household, every household holding a payer share of its requests, and the households
    whose requests it pays a share of. This is the household page's own scope (slice 1), not a second rule."""
    return frozenset(_page_scope(household_cm_id, season.requests, season.shares).households)


def proportional(amount: Decimal, weights: Sequence[tuple[str, Decimal]]) -> tuple[Part, ...]:
    """`amount` split in proportion to `weights`, exact to the cent (D74): each part rounds down to the
    cent, and the cents left over go one each to the largest remainders (then the larger weight, then the
    earlier request). The parts add up to `amount`."""
    total = sum((w for _, w in weights), ZERO)
    if total <= 0:
        raise ValueError("proportional needs at least one positive weight")
    cents = int((amount / _CENT).to_integral_value())
    raw = [(rid, w, Decimal(cents) * w / total) for rid, w in weights]
    floors = {rid: int(share.to_integral_value(rounding=ROUND_FLOOR)) for rid, _, share in raw}
    left = cents - sum(floors.values())
    order = sorted(raw, key=lambda r: (-(r[2] - floors[r[0]]), -r[1], r[0]))
    for rid, _, _ in order[:left]:
        floors[rid] += 1
    return tuple(Part(rid, Decimal(floors[rid]) * _CENT) for rid, _ in weights)


def _dollars(amount: Decimal) -> str:
    return f"${amount:,.0f}" if amount == amount.to_integral_value() else f"${amount:,.2f}"


def _facts(line: CampLine, candidate: Candidate, alone: bool) -> tuple[Evidence, ...]:
    """Every fact that ties `line` to `candidate`, in the fixed order the module docstring gives."""
    facts: list[Evidence] = []
    if candidate.not_yet_in_campminder > 0 and candidate.not_yet_in_campminder == line.amount:
        facts.append(
            Evidence("amount", f"exactly what this request still needs in CampMinder ({_dollars(line.amount)})")
        )
    if line.person_cm_id > 0 and line.person_cm_id == candidate.person_cm_id:
        facts.append(Evidence("person", "CampMinder posted it to this camper"))
    if line.post_date is not None and camp_date(line.post_date) in candidate.ticked_on:
        facts.append(Evidence("date", "posted the day this request was ticked Posted"))
    if alone:
        facts.append(Evidence("only_request", "the only request this family has"))
    return tuple(facts)


def _whole(line: CampLine, candidate: Candidate, alone: bool) -> Suggestion:
    return Suggestion((Part(candidate.request_id, line.amount),), _facts(line, candidate, alone))


def _one(found: Sequence[Candidate]) -> Candidate | None:
    return found[0] if len(found) == 1 else None


def suggest(line: CampLine, found: Sequence[Candidate]) -> Suggestion | None:
    """Kindred's suggestion for one line, or None when the evidence can't choose (D12, D16)."""
    if not found:
        return None
    alone = len(found) == 1
    matches = [c for c in found if c.not_yet_in_campminder > 0 and c.not_yet_in_campminder == line.amount]
    if len(matches) > 1:  # equal amounts: only the person or the day can tell them apart
        by_person = _one([c for c in matches if line.person_cm_id > 0 and c.person_cm_id == line.person_cm_id])
        by_day = _one([c for c in matches if any(e.kind == "date" for e in _facts(line, c, False))])
        if by_person is not None and by_day is not None and by_person is not by_day:
            return None  # the person and the day point at different requests: Kindred never guesses (D12)
        chosen = by_person or by_day
        return _whole(line, chosen, alone) if chosen is not None else None
    if matches:
        return _whole(line, matches[0], alone)
    by_person = _one([c for c in found if line.person_cm_id > 0 and c.person_cm_id == line.person_cm_id])
    by_day = _one(
        [c for c in found if c.not_yet_in_campminder > 0 and any(e.kind == "date" for e in _facts(line, c, False))]
    )
    if by_person is not None and by_day is not None and by_person is not by_day:
        return None  # the person and the day point at different requests: Kindred never guesses (D12)
    chosen_one = by_person or by_day
    if chosen_one is not None:
        return _whole(line, chosen_one, alone)
    if alone:
        return _whole(line, found[0], alone)
    due = [c for c in found if c.not_yet_in_campminder > 0]
    if len(due) > 1 and sum((c.not_yet_in_campminder for c in due), ZERO) == line.amount:
        parts = tuple(Part(c.request_id, c.not_yet_in_campminder) for c in due)
        what = f"together exactly what these requests still need in CampMinder ({_dollars(line.amount)})"
        return Suggestion(parts, (Evidence("amount", what),))
    weighted = [c for c in found if c.weight > 0 and not c.cancelled]
    if len(weighted) > 1:
        parts = proportional(line.amount, [(c.request_id, c.weight) for c in weighted])
        if any(part.amount <= 0 for part in parts):
            return None  # a $0.00 share is a guess too (D12)
        what = "split in proportion to the decided amounts (a posted round at the amount it locked)"
        return Suggestion(parts, (Evidence("proportional", what),))
    return None


def _reason(found: Sequence[Candidate], detail: LineDetail | None) -> Reason:
    if not found:
        return "no_request"
    if detail is not None and MISMATCH_FLAG in detail.flags:
        return "program_mismatch"
    return "several"


def to_place(season: Season, details: Mapping[int, LineDetail]) -> list[ToPlaceItem]:
    """Every live camp-aid line, or part of one, that no request takes, with its reason, its candidates
    and Kindred's suggestion; by reason, then household, post date and transaction."""
    pieces: dict[int, list[CampLine]] = defaultdict(list)
    for lines in season.ledger.unplaced_lines_by_household.values():
        for piece in lines:
            pieces[piece.transaction_cm_id].append(piece)
    whole = {line.transaction_cm_id: line for line in season.camp_lines if line.live()}
    items: list[ToPlaceItem] = []
    for txn, parts in pieces.items():
        line = whole.get(txn, parts[0])
        found = candidates(line.household_cm_id, season)
        items.append(
            ToPlaceItem(
                line=line,
                unplaced=sum((p.amount for p in parts), ZERO),
                reason=_reason(found, details.get(txn)),
                candidates=found,
                suggestion=suggest(line, found),
            )
        )
    return sorted(
        items,
        key=lambda i: (
            REASONS.index(i.reason),
            i.line.household_cm_id,
            i.line.post_date.timestamp() if i.line.post_date is not None else 0.0,
            i.line.transaction_cm_id,
        ),
    )


def simulate(
    season: Season, placements: Mapping[int, Placement], splits: Mapping[int, Sequence[SplitPart]]
) -> SeasonLedger:
    """The season's ledger as it would be with these lines placed whole (`placements`) or split (`splits`)
    instead of however each is placed now. The season itself is untouched."""
    changed = set(placements) | set(splits)
    whole = {txn: p for txn, p in season.placements.items() if txn not in changed} | dict(placements)
    parts = {txn: s for txn, s in season.splits.items() if txn not in changed} | {
        txn: tuple(s) for txn, s in splits.items()
    }
    posted = frozenset(rid for rid, states in season.rounds.items() if any(s.posted for s in states.values()))
    return build_ledger(
        season.camp_lines,
        whole,
        [placeable(r, season.sessions, season.shares.get(r.id, ())) for r in season.requests.values()],
        season.ledger.synced_at,
        posted,
        splits=parts,
    )


def reclaw(season: Season, ledger: SeasonLedger, request_ids: Iterable[str]) -> list[PricedRequest]:
    """These requests priced again against `ledger`: the season marked a request clawed back (D54) from
    the money as it was placed before; placing a live line on it can lift that."""
    out: list[PricedRequest] = []
    for request_id in request_ids:
        priced = season.priced[request_id]
        fresh = replace(priced, rounds=tuple(replace(v, clawed_back=False) for v in priced.rounds))
        scope = request_scope(season.requests[request_id], season.shares.get(request_id, ()))
        item, _ = apply_clawback(
            fresh,
            season.rounds.get(request_id, {}),
            ledger.lines(request_id),
            family_lines=ledger.family_lines(scope),
        )
        out.append(item)
    return out


@dataclass(frozen=True)
class Outcome:
    """What placing some lines would do: the season's ledger with them placed, the requests they land on
    priced again against it (`reclaw`), and the Posted ticks that money makes (`ledger_ticks`)."""

    ledger: SeasonLedger
    priced: tuple[PricedRequest, ...]
    ticks: tuple[LedgerTick, ...]


def placement_outcome(
    season: Season,
    placements: Mapping[int, Placement],
    splits: Mapping[int, Sequence[SplitPart]],
    request_ids: Iterable[str],
    *,
    today: date,
) -> Outcome:
    """The one computation behind a suggestion's preview (the read, §4.10) and the write itself, so what the
    registrar confirms is what is written: the ledger's own walk (ledger_ticks, D146's full cover), skipping
    the rounds a person un-ticked (SP10b Decision 8)."""
    ledger = simulate(season, placements, splits)
    priced = reclaw(season, ledger, list(dict.fromkeys(request_ids)))
    ticks = ledger_ticks(priced, ledger, today=today, undone=season.undone)
    return Outcome(ledger, tuple(priced), tuple(ticks))


# --- D16 (option a): a placement ticks at the posting day's amount, or withholds the tick ------------------------

ChangedCode = Literal[
    "rules",
    "rules_history",
    "request",
    "application",
    "correction",
    "payer_shares",
    "decision",
    "hold",
    "cancellation",
    "grant",
    "enrollment",
    "equity",
    "session",
    "removed_by_sync",
    "too_long_ago",
]
# The CampMinder syncs that delete rows pricing reads (sync_runs.service): registrations, people and their
# households, the equity custom field (both scopes), sessions, and the grant lines with Go's household links.
CUSTOM_VALUE_SERVICES: Final = frozenset({"person_custom_values", "person_custom_values_family_camp"})
REMOVAL_SERVICES: Final = frozenset({"attendees", "persons", "sessions", "aid_postings", *CUSTOM_VALUE_SERVICES})


@dataclass(frozen=True)
class ChangedReason:
    """Why Kindred can't be sure a round's amount is what it was decided at on the posting day."""

    code: ChangedCode
    text: str


@dataclass(frozen=True)
class SinceLog:
    """One aid_change_log row recorded after the floor. `before`/`after` are read only for the entities whose
    records name a grant's household or person (overrides, commitments, household links)."""

    entity: str
    entity_id: str
    action: str
    created: datetime
    before: Mapping[str, Any] | None = None
    after: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class SinceCorrection:
    """An aid_application_corrections row made after the floor (its own `created`)."""

    application_id: str
    request_id: str
    created: datetime


@dataclass(frozen=True)
class Synced:
    """A CampMinder-synced record created or changed after the floor, at the later of its created and
    updated: attendees, persons, person_custom_values (equity fields only), camp_sessions, aid_sources,
    aid_grantors."""

    collection: str
    at: datetime
    person_cm_id: int = 0
    household_cm_id: int = 0
    session_cm_id: int = 0
    key: str = ""  # aid_sources: the description key; aid_grantors: the grantor key


@dataclass(frozen=True)
class GrantLineRow:
    """A non-camp aid_postings row (an outside grant line) created or changed after the floor."""

    transaction_cm_id: int
    household_cm_id: int
    person_cm_id: int
    attributed_person_cm_id: int
    source_key: str
    created: datetime | None
    updated: datetime | None


@dataclass(frozen=True)
class LinkRow:
    """An aid_household_links row: every one of the season's, as family_household_set reads them."""

    household_cm_id: int
    family_key: str
    excluded: bool
    at: datetime | None  # the later of its created and updated


@dataclass(frozen=True)
class SyncRemoval:
    """A sync run that deleted records and ended after the floor."""

    service: str
    ended: datetime


@dataclass(frozen=True)
class SinceRecords:
    """What the store reads once per To place read or write: everything recorded after a floor."""

    log: tuple[SinceLog, ...] = ()
    corrections: tuple[SinceCorrection, ...] = ()
    synced: tuple[Synced, ...] = ()
    grant_lines: tuple[GrantLineRow, ...] = ()
    links: tuple[LinkRow, ...] = ()
    removals: tuple[SyncRemoval, ...] = ()


@dataclass(frozen=True)
class SinceInputs:
    """changed_since's loads: the records after the earliest posting day in hand, the rules that priced the
    season at the end of each posting day (`rules_unknown`: the days whose rules history can't be replayed),
    when the sync history starts (sync_runs is pruned), and now."""

    now: datetime
    history_from: datetime
    records: SinceRecords
    rules_at: Mapping[date, RulesVersion | None]
    rules_unknown: frozenset[date] = frozenset()


_INSTANT: Final = timedelta(microseconds=1)
# PocketBase stamps created and updated from two clock reads, so a new row can show them a millisecond apart (5 prod
# postings rows have updated BEFORE created): rewritten by Go only when updated is more than a second past created.
_SAME_WRITE: Final = timedelta(seconds=1)
_PERSON_FIELDS: Final = frozenset({"gender_identity", "pronouns"})  # camper equity answers read from `persons`
_NOT_PRICING: Final = frozenset({"accept", "unaccept"})  # Accepted is recorded, never priced (pricing.py)
_TEXT: Final[Mapping[ChangedCode, str]] = {
    "rules": "the pricing rules changed",
    "rules_history": "Kindred can't replay the pricing rules' history to that day",
    "request": "a request in this family was changed",
    "application": "the application was changed",
    "correction": "a correction was entered",
    "payer_shares": "the payer shares were changed",
    "decision": "a round's ask, amount or decision was recorded",
    "hold": "a hold was placed or released",
    "cancellation": "the request was cancelled or reopened in Kindred",
    "grant": "an outside grant was posted, reversed or moved",
    "enrollment": "a registration changed in CampMinder",
    "equity": "the camper's equity answers changed in CampMinder",
    "session": "the session changed in CampMinder",
    "removed_by_sync": "CampMinder records were removed by a sync since",
    "too_long_ago": "the posting is older than Kindred's 90-day sync history",
}


def _end_of(day: date) -> datetime:
    """The last instant of `day` in camp time, as the decisions service's as_of_instant (3c Decision 5)."""
    return as_of_cutoff(day) - _INSTANT


def _day(moment: datetime) -> str:
    on = camp_date(moment)
    return f"{on:%b} {on.day}"


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except TypeError, ValueError:
        return 0


def reads_person_fields(rules: RulesVersion | None) -> bool:
    """Whether the rules weigh a camper answer read from `persons` (gender identity, pronouns), whose
    `updated` CampMinder touches daily; only then does a persons change count."""
    if rules is None:
        return False
    return any(
        c.source == "camper" and ({c.field, *c.also_fields} & _PERSON_FIELDS) for c in rules.document.equity.criteria
    )


def reads_custom_values(rules: RulesVersion | None) -> bool:
    """Whether the rules weigh a camper answer kept in person custom values (the BIPOC answer): only then can
    a custom-value sync's removal move a camper-level request's price."""
    if rules is None:
        return False
    return any(
        c.source == "camper" and ({c.field, *c.also_fields} - _PERSON_FIELDS) for c in rules.document.equity.criteria
    )


def _named(record: Mapping[str, Any] | None, field: str) -> set[int]:
    """The ids a logged record names in `field`, and in each part of its split."""
    if not record:
        return set()
    found = {_int(record.get(field))}
    split = record.get("split")
    if isinstance(split, list):
        found |= {_int(part.get(field)) for part in split if isinstance(part, Mapping)}
    return found - {0}


def _names_grant(
    log: SinceLog,
    camp: Collection[int],
    lines: Collection[int],
    commitments: Collection[str],
    grantors: Collection[str],
    households: Collection[int],
    people: Collection[int],
    keys: Collection[str],
) -> bool:
    """Whether a logged staff write moved a grant in this family: a placement or split of an outside grant line
    (never a camp-aid line's: camp aid doesn't price), a commitment, a grantor, a household link."""
    before, after = log.before, log.after

    def named(field: str) -> set[int]:
        return _named(before, field) | _named(after, field)

    if log.entity == "aid_attribution_overrides":
        txns = named("transaction_cm_id")
        moved = named("attributed_person_cm_id") | named("person_cm_id")
        was, now = ((record or {}).get("source_key_override") or "" for record in (before, after))
        if txns <= set(camp) and was == now:
            return False  # placing camp aid, not reclassifying it: camp aid never prices (D81/D146)
        return bool(txns & set(lines) or moved & set(people))
    if log.entity == "aid_grants":
        return log.entity_id in commitments or bool(
            named("household_cm_id") & set(households) or named("person_cm_id") & set(people)
        )
    if log.entity == "aid_grantors":
        return log.entity_id in grantors
    if log.entity == "aid_household_links":
        linked = {str(r.get("family_key")) for r in (before, after) if r and r.get("family_key")}
        return bool(named("household_cm_id") & set(households) or linked & set(keys))
    return False


def _known_at(grant: RegisterRow, synced_at: Mapping[int, datetime]) -> datetime | None:
    """When a grant joined the register on the campminder axis: a ledger line's own CampMinder post date (not
    an earlier commitment's created, which recorded_at carries when the line fulfils one), else when Kindred
    first read the line; a commitment's created."""
    if grant.kind != "ledger":
        return grant.recorded_at
    if grant.posted_at is not None:
        return grant.posted_at
    if grant.recorded_at is not None and not grant.fulfils_commitment_id:
        return grant.recorded_at  # recorded_at is the post date when no commitment came first
    return synced_at.get(grant.transaction_cm_id)


def _grant_moments(
    season: Season,
    request_id: str,
    households: frozenset[int],
    people: frozenset[int],
    cut: datetime,
    since: SinceInputs,
) -> list[datetime]:
    """When anything that places an outside grant on this request changed after `cut`. One function, so 3c-2's
    logged grant placements can replace it in place with one exact comparison (d16b design §7)."""
    rows = [
        r
        for r in season.register
        if r.household_cm_id in households
        or r.person_cm_id in people
        or any(s.request_id == request_id for s in r.requests)
    ]
    lines = {r.transaction_cm_id for r in rows if r.kind == "ledger"} | {
        g.transaction_cm_id
        for g in since.records.grant_lines
        if g.household_cm_id in households or ({g.person_cm_id, g.attributed_person_cm_id} & people)
    }
    commitments = {r.commitment_id for r in rows if r.kind == "commitment"}
    grantors = {r.grantor_key for r in rows if r.grantor_key}
    sources = {r.source_key for r in rows if r.source_key} | {
        g.source_key for g in since.records.grant_lines if g.transaction_cm_id in lines
    }
    camp = {line.transaction_cm_id for line in season.camp_lines}
    # The family's camp-aid lines too: today's funder type, which a Reclassify since the posting day may have set.
    lines |= {
        line.transaction_cm_id
        for line in season.camp_lines
        if line.household_cm_id in households
        or ({line.person_cm_id, line.attributed_person_cm_id} & people)
        or any(p.person_cm_id in people for p in season.splits.get(line.transaction_cm_id, ()))
    }
    keys = {link.family_key for link in since.records.links if link.household_cm_id in households}
    moments: list[datetime] = []
    synced_at = {g.transaction_cm_id: g.created for g in since.records.grant_lines if g.created is not None}
    for grant in rows:  # CampMinder's own dates (the campminder axis): posted or reversed after the posting day
        known = _known_at(grant, synced_at)
        if known is not None and known > cut:
            moments.append(known)
        reversed_at = parse_pb_datetime(grant.reversal_date) if grant.reversal_date else None
        if reversed_at is not None and camp_date(reversed_at) > camp_date(cut):
            moments.append(reversed_at)
    moments.extend(  # Go rewrote the row (reclassified, re-attributed, re-amounted), not merely created it
        g.updated
        for g in since.records.grant_lines
        if g.transaction_cm_id in lines
        and g.updated is not None
        and g.updated > cut
        and (g.created is None or g.updated - g.created > _SAME_WRITE)
    )
    moments.extend(
        log.created
        for log in since.records.log
        if log.created > cut and _names_grant(log, camp, lines, commitments, grantors, households, people, keys)
    )
    moments.extend(  # a link created, re-keyed or excluded since: the family itself moved
        link.at
        for link in since.records.links
        if link.at is not None and link.at > cut and (link.household_cm_id in households or link.family_key in keys)
    )
    moments.extend(  # a description or a grantor (read from its own record: the directory spans seasons)
        synced.at
        for synced in since.records.synced
        if synced.at > cut
        and (
            (synced.collection == "aid_sources" and synced.key in sources)
            or (synced.collection == "aid_grantors" and synced.key in grantors)
        )
    )
    return moments


def changed_since(season: Season, tick: LedgerTick, since: SinceInputs) -> tuple[ChangedReason, ...]:
    """Why Kindred can't be sure `tick.amount` is what the round was decided at on tick.posted_on (D16b,
    owner ruling 2026-10-01): every input that prices the request recorded or changed after the end of that
    day (camp time), a sync that removed records since, or a posting older than the sync history. Empty:
    nothing that prices the request moved, and pricing reads no clock, so today's amount is the posting day's.
    The read's preview and the write both run this, on one load (§4.10). Conservative by design: a false
    "changed" costs one hand tick; a false "unchanged" is what the ruling forbids."""
    cut = _end_of(tick.posted_on)
    if cut >= since.now:
        return ()  # posted today: nothing can be after it (3c: today or later is live)
    request = season.requests[tick.request_id]
    person, household = request.person_cm_id, request.household_cm_id
    households = frozenset(
        {
            *family_household_set(since.records.links, household),
            *request_scope(request, season.shares.get(request.id, ())),
        }
    )
    people = frozenset({person} - {0})
    family = {
        rid
        for rid, r in season.requests.items()
        if (person > 0 and r.person_cm_id == person) or (r.person_cm_id == 0 and r.household_cm_id in households)
    } | {request.id}
    sessions = {season.requests[rid].session_cm_id for rid in family} - {0}
    found: dict[ChangedCode, list[datetime]] = defaultdict(list)
    texts: dict[ChangedCode, str] = {}

    rules_now = season.rules
    if tick.posted_on in since.rules_unknown:
        texts["rules_history"] = _TEXT["rules_history"]
    else:
        then = since.rules_at.get(tick.posted_on)
        if then is None or rules_now is None:
            texts["rules"] = f"{_TEXT['rules']} (no approved rules priced it that day)"
        elif then.version != rules_now.version or then.document != rules_now.document:
            texts["rules"] = f"{_TEXT['rules']} (version {then.version} then, {rules_now.version} now)"

    for row in since.records.log:
        if row.created <= cut:
            continue
        head = row.entity_id.split(":", 1)[0]
        if row.entity == "aid_requests" and row.entity_id in family:
            found["request"].append(row.created)
        elif row.entity == "aid_applications" and row.entity_id == request.application_id:
            found["application"].append(row.created)
        elif row.entity == "aid_payer_shares" and head == request.id:
            found["payer_shares"].append(row.created)
        elif row.entity == "aid_decisions" and head == request.id and row.action not in _NOT_PRICING:
            found["decision"].append(row.created)
        elif row.entity == "aid_hold_events" and head == request.id:
            found["hold"].append(row.created)
        elif row.entity == "aid_cancellations" and row.entity_id == request.id:
            found["cancellation"].append(row.created)
    for correction in since.records.corrections:
        if correction.created > cut and (
            correction.application_id == request.application_id or correction.request_id == request.id
        ):
            found["correction"].append(correction.created)
    found["grant"].extend(_grant_moments(season, request.id, households, people, cut, since))
    person_fields = reads_person_fields(rules_now)
    for synced in since.records.synced:
        if synced.at <= cut:
            continue
        if synced.collection == "attendees" and (synced.person_cm_id in people or synced.household_cm_id in households):
            found["enrollment"].append(synced.at)
        elif (synced.collection == "person_custom_values" and synced.person_cm_id in people) or (
            synced.collection == "persons" and person_fields and synced.person_cm_id in people
        ):
            found["equity"].append(synced.at)
        elif synced.collection == "camp_sessions" and synced.session_cm_id in sessions:
            found["session"].append(synced.at)
    custom = person > 0 and reads_custom_values(rules_now)  # else a custom-value removal can't move the price
    found["removed_by_sync"] = [
        r.ended
        for r in since.records.removals
        if r.service in REMOVAL_SERVICES and r.ended > cut and (custom or r.service not in CUSTOM_VALUE_SERVICES)
    ]
    if cut < since.history_from:
        texts["too_long_ago"] = _TEXT["too_long_ago"]

    for code, moments in found.items():
        if moments:
            texts[code] = f"{_TEXT[code]} ({_day(min(moments))})"
    return tuple(ChangedReason(code, texts[code]) for code in get_args(ChangedCode) if code in texts)
