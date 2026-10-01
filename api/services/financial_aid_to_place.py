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
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date
from decimal import ROUND_FLOOR, Decimal
from typing import TYPE_CHECKING, Any, Final, Literal

from api.services.financial_aid_grants_register import (
    LIVE_REQUEST_STATUSES,
    Placement,
    program_family_for_session_type,
)
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

# Go's posting flag for a description naming a program the camper isn't in (pocketbase/sync/aid_flags.go).
MISMATCH_FLAG: Final = "implied_program_mismatch"
# aid_flag_dispositions.flag for "Leave at family level" (D58: To place's own disposition).
TO_PLACE_FLAG: Final = "to_place"

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
    """A request the line's household has a stake in. `still_due` is what CampMinder should still hold
    for it: its locked total plus the decided amounts of the rounds waiting to be ticked, less the live
    money already placed on it (main spec §11's net total). `weight` is the same before that money: the
    request's decided amounts, a locked round's at the amount it locked (D12). `ticked_on` holds the days
    its posted rounds were ticked. A cancelled request (10b-2) is still a candidate: its family-level
    money is placed on it so To reverse can show it (SP10b-2)."""

    request_id: str
    household_cm_id: int
    person_cm_id: int
    session_cm_id: int
    program_family: str
    still_due: Decimal
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
        still_due=weight - live_net(season.ledger.lines(request_id)),
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
    if candidate.still_due > 0 and candidate.still_due == line.amount:
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
    matches = [c for c in found if c.still_due > 0 and c.still_due == line.amount]
    if len(matches) > 1:  # equal amounts: only the person or the day can tell them apart
        by_person = _one([c for c in matches if line.person_cm_id > 0 and c.person_cm_id == line.person_cm_id])
        by_day = _one([c for c in matches if any(e.kind == "date" for e in _facts(line, c, False))])
        chosen = by_person or by_day
        return _whole(line, chosen, alone) if chosen is not None else None
    if matches:
        return _whole(line, matches[0], alone)
    by_person = _one([c for c in found if line.person_cm_id > 0 and c.person_cm_id == line.person_cm_id])
    by_day = _one([c for c in found if c.still_due > 0 and any(e.kind == "date" for e in _facts(line, c, False))])
    if by_person is not None and by_day is not None and by_person is not by_day:
        return None  # the person and the day point at different requests: Kindred never guesses (D12)
    chosen_one = by_person or by_day
    if chosen_one is not None:
        return _whole(line, chosen_one, alone)
    if alone:
        return _whole(line, found[0], alone)
    due = [c for c in found if c.still_due > 0]
    if len(due) > 1 and sum((c.still_due for c in due), ZERO) == line.amount:
        parts = tuple(Part(c.request_id, c.still_due) for c in due)
        what = f"together exactly what these requests still need in CampMinder ({_dollars(line.amount)})"
        return Suggestion(parts, (Evidence("amount", what),))
    weighted = [c for c in found if c.weight > 0 and not c.cancelled]
    if len(weighted) > 1:
        parts = proportional(line.amount, [(c.request_id, c.weight) for c in weighted])
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
