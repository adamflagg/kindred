"""Money > Ledger's family rows (campership slice 3, ask 1; clean spec §5.5, §8.1; D26, D54, D74, D97, D151).

Pure functions over a priced season (live or as of a past day) and every aid_postings line of it. Nothing here writes.

ONE ROW PER FAMILY (D26). A family is the households a payer share joins: each request's household and every
household holding a share of it, followed through. D26 scopes a household page from the household it was opened from;
the Ledger needs every line in exactly one row, so its footer is the rows' sum. The row opens the page of its
applying household with the lowest id (its lowest household when none applied).

TWO COLUMNS (§5.5, D97). In CampMinder (net): the family's camp-aid lines (funder type camp, after any
reclassification). Outside grants: every other line: outside, incentive, and an unclassified one ("nothing drops out
of the Ledger", §8.1). Both count live lines only: a reversed line stays one line, in `lines` and `reversed_lines`,
never in a net (D54, D74).

THE LEVEL, READ FROM KINDRED'S PLACEMENTS (D151). A camp-aid line, or a part of a split one, that SeasonLedger placed on
a request has none: the money is on a request. A live one no request takes has To place's reason ("several" is
"household" here), or "left" when a person left it at family level (D58). Outside lines and reversed lines carry none.
A season before FIRST_TICKED_SEASON has no levels at all (`levels=False`; Owner question 7): To place shows nothing
before then.

AS OF A DAY (`at`, the day's last instant): a line counts once CampMinder posted it by then, and is reversed if
CampMinder reversed it by then (CampLine.live); the recorded axis first cuts the lines to what Kindred had recorded
(as_recorded_lines). The caller passes the season and its placement as of the same day.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from decimal import Decimal
from typing import Final, Literal

from api.services.financial_aid_grants_register import (
    LIVE_REQUEST_STATUSES,
    RegisterRow,
    program_family_for_session_type,
)
from api.services.financial_aid_intake_types import PayerShareRecord, RequestRecord, SessionRow
from api.services.financial_aid_reconciliation import CampLine, SeasonLedger, as_recorded, request_scope
from api.services.financial_aid_to_place import MISMATCH_FLAG
from bunking.financial_aid.money import ZERO


@dataclass(frozen=True)
class LedgerLine:
    """One aid_postings row of any funder, as Money > Ledger reads it. `line` carries its money (aid dollars, positive)
    and its dates, so CampLine's live, reversed_by and as_recorded apply whatever the funder; the rest is its
    classification after any reclassification (aid_postings materializes it)."""

    line: CampLine
    funder_type: str  # camp, outside or incentive; "unknown" while its description is unclassified
    source_key: str  # aid_postings.effective_source_key
    source_family: str  # "unclassified" when blank
    flags: tuple[str, ...] = ()  # Go's posting flags (implied_program_mismatch, ...)


LedgerLevel = Literal["household", "left", "no_request", "program_mismatch"]
# A family row shows the first level its lines carry, in this order: open work first, a line a person left last.
LEVELS: Final[tuple[LedgerLevel, ...]] = ("no_request", "program_mismatch", "household", "left")
LedgerTotal = Literal["in_campminder_net", "outside_grants"]
CAMP: Final = "camp"


@dataclass(frozen=True)
class Piece:
    """A line, or one part of a split line, as the Ledger counts it."""

    transaction_cm_id: int
    household_cm_id: int  # the household CampMinder posted it to
    family: tuple[int, ...]  # its family row: the row's household first
    camp: bool  # In CampMinder (net) when True, else Outside grants
    amount: Decimal
    live: bool  # counts in the nets by the read's day; False: reversed by then
    source_key: str
    source_family: str
    program: str  # its request's program when Kindred placed it, else CampMinder's attribution; "" for none
    level: LedgerLevel | None  # None: on a request, not camp aid, or reversed
    person_cm_id: int  # the camper it names; 0 for none
    post_date: datetime | None
    reversal_date: datetime | None


# LedgerSourceFilter's "outside" (api/schemas/financial_aid_money_ledger.py): every line of the Outside grants column.
OUTSIDE_SOURCE: Final = "outside"


@dataclass(frozen=True)
class LedgerFilters:
    """The Ledger's filters, per line (Decision 8). None is "all"."""

    source: str | None = None
    program: str | None = None
    level: str | None = None

    def _source_keeps(self, piece: Piece) -> bool:
        """`source="outside"` is the Outside grants column itself (a piece that isn't camp aid), whatever its family."""
        return not piece.camp if self.source == OUTSIDE_SOURCE else piece.source_family == self.source

    def keeps(self, piece: Piece) -> bool:
        return (
            (self.source is None or self._source_keeps(piece))
            and (self.program is None or piece.program == self.program)
            and (self.level is None or piece.level == self.level)
        )


NO_FILTERS: Final = LedgerFilters()


@dataclass(frozen=True)
class FamilyTotals:
    family: tuple[int, ...]
    in_campminder_net: Decimal
    outside_grants: Decimal
    lines: int
    reversed_lines: int
    level: LedgerLevel | None
    person_cm_ids: tuple[int, ...]


@dataclass(frozen=True)
class LineTotal:
    """One line behind a total: its first piece (household, family, dates, source), and every piece in the total."""

    first: Piece
    amount: Decimal
    level: LedgerLevel | None
    person_cm_ids: tuple[int, ...]


def _first_level(levels: Collection[LedgerLevel | None]) -> LedgerLevel | None:
    return next((level for level in LEVELS if level in levels), None)


def families(
    requests: Mapping[str, RequestRecord], shares: Mapping[str, Sequence[PayerShareRecord]]
) -> dict[int, tuple[int, ...]]:
    """Each household that applied or holds a payer share, to its family: the row's household first, then by id."""
    parent: dict[int, int] = {}

    def root(household: int) -> int:
        parent.setdefault(household, household)
        while parent[household] != household:
            parent[household] = parent[parent[household]]
            household = parent[household]
        return household

    applicants: set[int] = set()
    for request_id, request in requests.items():
        applicants.add(request.household_cm_id)
        for household in request_scope(request, shares.get(request_id, ())):
            parent[root(household)] = root(request.household_cm_id)
    groups: dict[int, set[int]] = defaultdict(set)
    for household in list(parent):
        groups[root(household)].add(household)
    out: dict[int, tuple[int, ...]] = {}
    for group in groups.values():
        head = min(group & applicants or group)
        family = (head, *sorted(group - {head}))
        for household in group:
            out[household] = family
    return out


def stake_households(
    requests: Mapping[str, RequestRecord], shares: Mapping[str, Sequence[PayerShareRecord]]
) -> frozenset[int]:
    """The households with a live request they applied for or pay a share of: To place's candidates (D26, D58)."""
    return frozenset(
        household
        for request_id, request in requests.items()
        if request.status in LIVE_REQUEST_STATUSES
        for household in request_scope(request, shares.get(request_id, ()))
    )


def line_level(
    transaction_cm_id: int,
    household_cm_id: int,
    flags: Collection[str],
    *,
    left: Collection[int],
    stake: Collection[int],
) -> LedgerLevel:
    """A live camp-aid line no request takes: left by a person, or To place's reason for it."""
    if transaction_cm_id in left:
        return "left"
    if household_cm_id not in stake:
        return "no_request"
    if MISMATCH_FLAG in flags:
        return "program_mismatch"
    return "household"


def _camp_parts(placed: SeasonLedger) -> dict[int, list[tuple[Decimal, str | None]]]:
    """Each camp-aid line's pieces as the placement left them: (amount, the request it is on, or None)."""
    parts: dict[int, list[tuple[Decimal, str | None]]] = defaultdict(list)
    for on_requests in (placed.by_request, placed.by_closed_request):
        for request_id, lines in on_requests.items():
            for piece in lines:
                parts[piece.transaction_cm_id].append((piece.amount, request_id))
    for lines in placed.unplaced_lines_by_household.values():
        for piece in lines:
            parts[piece.transaction_cm_id].append((piece.amount, None))
    return parts


def _piece(
    ledger_line: LedgerLine,
    family: tuple[int, ...],
    live: bool,
    amount: Decimal,
    *,
    camp: bool,
    program: str,
    level: LedgerLevel | None,
    person: int,
) -> Piece:
    line = ledger_line.line
    return Piece(
        transaction_cm_id=line.transaction_cm_id,
        household_cm_id=line.household_cm_id,
        family=family,
        camp=camp,
        amount=amount,
        live=live,
        source_key=ledger_line.source_key,
        source_family=ledger_line.source_family,
        program=program,
        level=level,
        person_cm_id=person,
        post_date=line.post_date,
        reversal_date=line.reversal_date,
    )


def ledger_pieces(
    lines: Iterable[LedgerLine],
    placed: SeasonLedger,
    requests: Mapping[str, RequestRecord],
    shares: Mapping[str, Sequence[PayerShareRecord]],
    sessions: Mapping[int, SessionRow],
    register: Iterable[RegisterRow],
    *,
    left: Collection[int],
    at: datetime | None,
    levels: bool,
) -> list[Piece]:
    """Every line posted by `at` (every line when live), a split camp-aid line as its parts. `levels` is False for a
    season before FIRST_TICKED_SEASON (Owner question 7): every piece then has no level."""
    family_of = families(requests, shares)
    stake = stake_households(requests, shares)
    parts = _camp_parts(placed)
    grants = {row.transaction_cm_id: row for row in register if row.kind == "ledger"}
    out: list[Piece] = []
    for ledger_line in lines:
        line = ledger_line.line
        if at is not None and (line.post_date is None or line.post_date > at):
            continue  # not posted by the day (a line with no post date can't be placed in time)
        live = line.live(at)
        family = family_of.get(line.household_cm_id, (line.household_cm_id,))
        if ledger_line.funder_type != CAMP:
            grant = grants.get(line.transaction_cm_id)
            program = (grant.program_family if grant is not None else "") or line.program_family
            person = grant.person_cm_id if grant is not None and grant.person_cm_id > 0 else line.person_cm_id
            out.append(
                _piece(ledger_line, family, live, line.amount, camp=False, program=program, level=None, person=person)
            )
            continue
        found = parts.get(line.transaction_cm_id, [])
        rest = line.amount - sum((amount for amount, _ in found), ZERO)
        if rest > 0:  # an unplaced reversed piece is in no list: it is the rest of the line
            found = [*found, (rest, None)]
        for amount, request_id in found:
            request = requests.get(request_id) if request_id is not None else None
            if request is not None:
                session = sessions.get(request.session_cm_id)
                program = program_family_for_session_type(session.session_type) if session is not None else ""
                program = program or line.program_family
                out.append(
                    _piece(
                        ledger_line,
                        family,
                        live,
                        amount,
                        camp=True,
                        program=program,
                        level=None,
                        person=request.person_cm_id,
                    )
                )
                continue
            level = (
                line_level(line.transaction_cm_id, line.household_cm_id, ledger_line.flags, left=left, stake=stake)
                if live and levels
                else None
            )
            out.append(
                _piece(
                    ledger_line,
                    family,
                    live,
                    amount,
                    camp=True,
                    program=line.program_family,
                    level=level,
                    person=line.person_cm_id,
                )
            )
    return out


def as_recorded_lines(lines: Sequence[LedgerLine], at: datetime) -> list[LedgerLine]:
    """The lines as Kindred had recorded them by `at` (the recorded as-of axis; as_recorded). aid_postings holds one
    row per transaction, so each line is matched back by its transaction id."""
    recorded = {line.transaction_cm_id: line for line in as_recorded([ll.line for ll in lines], at)}
    return [
        replace(ll, line=recorded[ll.line.transaction_cm_id]) for ll in lines if ll.line.transaction_cm_id in recorded
    ]


def family_totals(pieces: Iterable[Piece]) -> list[FamilyTotals]:
    """One total per family, in the order the families first appear."""
    by_family: dict[tuple[int, ...], list[Piece]] = defaultdict(list)
    for p in pieces:
        by_family[p.family].append(p)
    return [
        FamilyTotals(
            family=family,
            in_campminder_net=sum((p.amount for p in items if p.camp and p.live), ZERO),
            outside_grants=sum((p.amount for p in items if not p.camp and p.live), ZERO),
            lines=len({p.transaction_cm_id for p in items}),
            reversed_lines=len({p.transaction_cm_id for p in items if not p.live}),
            level=_first_level({p.level for p in items}),
            person_cm_ids=tuple(sorted({p.person_cm_id for p in items if p.person_cm_id > 0})),
        )
        for family, items in by_family.items()
    ]


def total_lines(pieces: Iterable[Piece], total: LedgerTotal) -> list[LineTotal]:
    """The lines behind one footer total, a split line once with every part of it in that total."""
    camp = total == "in_campminder_net"
    by_line: dict[int, list[Piece]] = defaultdict(list)
    for p in pieces:
        if p.camp == camp:
            by_line[p.transaction_cm_id].append(p)
    return [
        LineTotal(
            first=items[0],
            amount=sum((p.amount for p in items), ZERO),
            level=_first_level({p.level for p in items}),
            person_cm_ids=tuple(sorted({p.person_cm_id for p in items if p.person_cm_id > 0})),
        )
        for items in by_line.values()
    ]
