"""The grants register (sub-project 6-core) as pure functions over records the service read.

D55: every outside-grant line in the CampMinder ledger IS a grant. aid_postings holds them
already (funder type outside or incentive, classified through aid_sources), so the register is
DERIVED here at read time, never copied. Kindred stores only what the ledger lacks:

* the camper for a household-level line: an aid_attribution_overrides placement, the one
  placement home (Decision 2). Go's attribution rules only SUGGEST a camper (D16); until a
  person confirms, the line counts toward nothing (Decision 3);
* a grant committed but not yet posted: an aid_grants commitment (Decision 4). It counts until
  a line fulfils it by rule (owner rulings 2026-09-29, see _fulfilments); then the line counts
  instead, never both. Anything short of the rule -- a reversed line, an unmapped description, a
  sibling's line -- never closes a commitment on its own: the commitment keeps counting and waits
  in Needs attention with that line as evidence, for a person to withdraw it or map the
  description (D16).

The target follows the program (owner ruling 2026-09-29): Family Camp aid requests belong to the
household (person 0), so a Family Camp grant needs no camper and sits on the household's request.

Expected grants (D56) are never grants: nothing here feeds them to the calculator.
grant_inputs_by_request() is the calculator bridge SP10 wires in (Decision 5).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime
from decimal import ROUND_DOWN, Decimal
from typing import Final, Literal

from api.constants.filters import ACTIVE_ENROLLED_STATUS_ID
from api.services.financial_aid_intake_types import PROGRAM_FAMILY_CAMP, STATUS_ACTIVE, STATUS_UNMATCHED
from api.services.financial_aid_ledger_service import parse_pb_datetime
from bunking.financial_aid.calculator import GrantInput

# Go's aidCancelledStatusIDs (pocketbase/sync/aid_attribution.go): 32 cancelled, 256 withdrawn.
CANCELLED_STATUS_IDS: Final = frozenset({32, 256})
# The aid requests a grant can sit on: intake's live statuses (a duplicate or withdrawn one can't).
LIVE_REQUEST_STATUSES: Final = frozenset({STATUS_ACTIVE, STATUS_UNMATCHED})
# Python twin of Go's sessionTypeProgramFamily (pocketbase/sync/aid_program_family.go); the
# register's tests parse the Go literal and fail on any drift.
PROGRAM_FAMILY_BY_SESSION_TYPE: Final[Mapping[str, str]] = {
    "main": "summer",
    "embedded": "summer",
    "ag": "summer",
    "quest": "quest",
    "scit": "teen",
    "tli": "teen",
    "teen": "teen",
    "bmitzvah": "bmitzvah",
    "hebrew": "bmitzvah",
    "family": "family_camp",
    "adult": "adult_weekend",
    "school": "family_school",
}
_CENT: Final = Decimal("0.01")
# Programs whose aid requests are the household's, not a person's (intake: Family Camp is one
# request per household). A grant for one of these needs no camper.
HOUSEHOLD_PROGRAM_FAMILIES: Final = frozenset({PROGRAM_FAMILY_CAMP})

CamperBasis = Literal["ledger", "placed", "commitment", "household", "none"]


def program_family_for_session_type(session_type: str) -> str:
    return PROGRAM_FAMILY_BY_SESSION_TYPE.get(session_type.strip().lower(), "other")


# --- inputs -------------------------------------------------------------------------------


@dataclass(frozen=True)
class GrantLine:
    """One aid_postings row whose (effective) funder type is outside or incentive."""

    transaction_cm_id: int
    household_cm_id: int
    person_cm_id: int  # CampMinder's posted person; 0 when posted to the household
    amount: Decimal  # aid dollars, positive
    source_key: str  # the EFFECTIVE description key, after any reclassification
    source_family: str
    funder_type: str
    post_date: str
    is_reversed: bool
    reversal_date: str
    attribution_method: str  # Go's inference, shown as the suggestion's evidence
    attributed_person_cm_id: int
    attributed_session_cm_id: int
    program_family: str


@dataclass(frozen=True)
class Placement:
    """An aid_attribution_overrides row that names a person: a confirmed camper."""

    transaction_cm_id: int
    person_cm_id: int
    session_cm_id: int
    program_family: str


@dataclass(frozen=True)
class Commitment:
    id: str
    grantor_key: str
    household_cm_id: int
    person_cm_id: int
    session_cm_id: int
    program_family: str
    amount: Decimal
    committed_on: date
    created: datetime | None  # when Kindred recorded it
    status: str  # open | withdrawn


@dataclass(frozen=True)
class Enrollment:
    person_cm_id: int
    session_cm_id: int
    program_family: str
    status_id: int


@dataclass(frozen=True)
class RequestRef:
    id: str
    household_cm_id: int
    person_cm_id: int
    session_cm_id: int
    status: str


@dataclass(frozen=True)
class RegisterInputs:
    lines: Sequence[GrantLine]
    placements: Mapping[int, Placement]  # by transaction id; only overrides that name a person
    commitments: Sequence[Commitment]
    grantor_by_source: Mapping[str, str]  # description_key -> grantor key ("" = unmapped)
    enrollments: Sequence[Enrollment]
    requests: Sequence[RequestRef]


# --- outputs ------------------------------------------------------------------------------


@dataclass(frozen=True)
class RequestShare:
    request_id: str
    amount: Decimal


@dataclass(frozen=True)
class RegisterRow:
    kind: Literal["ledger", "commitment"]
    transaction_cm_id: int  # 0 for a commitment
    commitment_id: str  # "" for a ledger line
    household_cm_id: int
    person_cm_id: int  # 0 while a ledger line needs a camper
    camper_basis: CamperBasis
    session_cm_id: int
    program_family: str
    grantor_key: str  # "" = the description names no grantor yet
    source_key: str  # "" for a commitment
    source_family: str  # "" for a commitment
    funder_type: str
    amount: Decimal
    recorded_on: str  # YYYY-MM-DD: the post date, or the commitment's committed_on
    recorded_at: datetime | None  # when the grant became known (Decision 5)
    is_reversed: bool
    reversal_date: str
    cancelled: bool
    counts: bool
    fulfils_commitment_id: str
    requests: tuple[RequestShare, ...]  # the aid requests it sits on; () = didn't apply


@dataclass(frozen=True)
class _Camper:
    person_cm_id: int
    session_cm_id: int
    program_family: str
    basis: CamperBasis


def split_equally(amount: Decimal, request_ids: Sequence[str]) -> tuple[RequestShare, ...]:
    """Main spec §2 item 18: equal shares in whole cents; the remainder cent goes to the first."""
    if not request_ids:
        return ()
    each = (amount / len(request_ids)).quantize(_CENT, rounding=ROUND_DOWN)
    first = amount - each * (len(request_ids) - 1)
    return tuple(RequestShare(rid, first if i == 0 else each) for i, rid in enumerate(request_ids))


def _line_camper(line: GrantLine, placement: Placement | None, enrolled: frozenset[int]) -> _Camper:
    """Decision 3: a placement (staff, or the owner-approved 2026 sheet load) wins; otherwise the
    line names its camper when CampMinder posted it to a person enrolled this season. Anything
    Go inferred is only a suggestion."""
    if placement is not None:
        return _Camper(placement.person_cm_id, placement.session_cm_id, placement.program_family, "placed")
    if line.person_cm_id > 0 and line.person_cm_id in enrolled:
        on_person = line.attributed_person_cm_id == line.person_cm_id
        return _Camper(
            line.person_cm_id,
            line.attributed_session_cm_id if on_person else 0,
            line.program_family if on_person else "",
            "ledger",
        )
    return _Camper(0, 0, "", "none")


def _fulfilments(
    inputs: RegisterInputs, campers: Sequence[_Camper], household_lines: frozenset[int]
) -> dict[int, Commitment]:
    """Decision 4 as the owner ruled it on 2026-09-29. Each open commitment, oldest first, is
    fulfilled by at most one line that is:

    * live -- a reversed line never fulfils (item A): CampMinder corrects a posting by reversing it
      and reposting, so only the repost may close the commitment;
    * outside-funded -- an incentive never reaches the calculator, so letting one close an outside
      commitment would lose the grant;
    * confirmed on the commitment's camper -- or, for a household program (Family Camp), where the
      target is the household, a household-program line in the commitment's household; a line and a
      commitment on opposite sides of that divide never pair;
    * from a description mapped to the commitment's own grantor -- never an unmapped one (item B);
    * not in a different session, when both name one (item D2);
    * posted on or after the commitment's committed_on (item D6): a commitment is for a grant not
      yet posted (D55), so an earlier line is a different grant.

    Candidates rank the same session first, then the earliest post, then an equal amount (item
    D1: a later line can never take a commitment from an earlier one), then the transaction id."""
    taken: dict[int, Commitment] = {}
    pending = sorted((c for c in inputs.commitments if c.status == "open"), key=lambda c: (c.committed_on, c.id))
    for commitment in pending:
        committed_on = commitment.committed_on.isoformat()
        candidates = [
            (line, camper)
            for line, camper in zip(inputs.lines, campers, strict=True)
            if line.transaction_cm_id not in taken
            and not line.is_reversed
            and line.funder_type == "outside"
            and (line.transaction_cm_id in household_lines) == (commitment.program_family in HOUSEHOLD_PROGRAM_FAMILIES)
            and (
                (camper.person_cm_id > 0 and camper.person_cm_id == commitment.person_cm_id)
                or (line.transaction_cm_id in household_lines and line.household_cm_id == commitment.household_cm_id)
            )
            and inputs.grantor_by_source.get(line.source_key, "") == commitment.grantor_key
            and not (
                commitment.session_cm_id and camper.session_cm_id and camper.session_cm_id != commitment.session_cm_id
            )
            and line.post_date[:10] >= committed_on
        ]
        if candidates:
            best, _ = min(
                candidates,
                key=lambda pair: (
                    bool(commitment.session_cm_id) and pair[1].session_cm_id != commitment.session_cm_id,
                    pair[0].post_date,
                    pair[0].amount != commitment.amount,
                    pair[0].transaction_cm_id,
                ),
            )
            taken[best.transaction_cm_id] = commitment
    return taken


def _family(person: int, session: int, fallback: str, families: Mapping[tuple[int, int], str]) -> str:
    return families.get((person, session), fallback) if person and session else fallback


def _cancelled(person: int, session: int, family: str, by_person: Mapping[int, Sequence[Enrollment]]) -> bool:
    """Derived from enrollment, never typed (main spec §5): the enrollments this grant covers (its
    session; else its program family; else all) include a cancelled one and no active one."""
    if person <= 0:
        return False
    mine = [
        e
        for e in by_person.get(person, ())
        if (e.session_cm_id == session if session else (not family or e.program_family == family))
    ]
    return any(e.status_id in CANCELLED_STATUS_IDS for e in mine) and not any(
        e.status_id == ACTIVE_ENROLLED_STATUS_ID for e in mine
    )


def _request_shares(
    person: int,
    session: int,
    family: str,
    amount: Decimal,
    requests_by_person: Mapping[int, Sequence[RequestRef]],
    families: Mapping[tuple[int, int], str],
) -> tuple[RequestShare, ...]:
    """Ruling (item 4): split only across requests with a resolved session; an unmatched request
    (session_cm_id 0 -- name resolution never found it a session) takes no share, even when the
    grant itself carries no session or family to narrow the split by."""
    mine = [r for r in requests_by_person.get(person, ()) if r.status in LIVE_REQUEST_STATUSES and r.session_cm_id > 0]
    if session:
        mine = [r for r in mine if r.session_cm_id == session]
    elif family:
        mine = [r for r in mine if families.get((person, r.session_cm_id)) == family]
    return split_equally(amount, [r.id for r in sorted(mine, key=lambda r: (r.session_cm_id, r.id))])


def _household_shares(
    household: int,
    session: int,
    family: str,
    amount: Decimal,
    requests_by_household: Mapping[int, Sequence[RequestRef]],
    session_families: Mapping[int, str],
) -> tuple[RequestShare, ...]:
    """The target follows the program: a household program's grant sits on the household's own
    requests (person 0) -- that session's, else every one in the program -- split like any grant."""
    mine = [
        r
        for r in requests_by_household.get(household, ())
        if r.status in LIVE_REQUEST_STATUSES
        and r.session_cm_id > 0
        and (r.session_cm_id == session if session else session_families.get(r.session_cm_id) == family)
    ]
    return split_equally(amount, [r.id for r in sorted(mine, key=lambda r: (r.session_cm_id, r.id))])


def build_register(inputs: RegisterInputs) -> list[RegisterRow]:
    """Every grant line this season (live and reversed), then every open commitment no line has
    fulfilled. A withdrawn commitment is history (the change log), not a register row."""
    by_person: dict[int, list[Enrollment]] = defaultdict(list)
    for e in inputs.enrollments:
        by_person[e.person_cm_id].append(e)
    families = {(e.person_cm_id, e.session_cm_id): e.program_family for e in inputs.enrollments}
    session_families = {e.session_cm_id: e.program_family for e in inputs.enrollments}
    requests_by_person: dict[int, list[RequestRef]] = defaultdict(list)
    requests_by_household: dict[int, list[RequestRef]] = defaultdict(list)
    for r in inputs.requests:
        if r.person_cm_id > 0:
            requests_by_person[r.person_cm_id].append(r)
        else:
            requests_by_household[r.household_cm_id].append(r)
    enrolled = frozenset(by_person)
    campers = [_line_camper(ln, inputs.placements.get(ln.transaction_cm_id), enrolled) for ln in inputs.lines]
    household_lines = frozenset(
        line.transaction_cm_id
        for line, camper in zip(inputs.lines, campers, strict=True)
        if (_family(camper.person_cm_id, camper.session_cm_id, camper.program_family, families) or line.program_family)
        in HOUSEHOLD_PROGRAM_FAMILIES
    )
    fulfilled = _fulfilments(inputs, campers, household_lines)

    rows: list[RegisterRow] = []
    for line, camper in zip(inputs.lines, campers, strict=True):
        commitment = fulfilled.get(line.transaction_cm_id)
        if commitment is not None and not camper.session_cm_id and commitment.session_cm_id:
            # Item D2: the commitment knows the session the line doesn't name.
            camper = replace(camper, session_cm_id=commitment.session_cm_id, program_family=commitment.program_family)
        family = _family(camper.person_cm_id, camper.session_cm_id, camper.program_family, families)
        household_target = (family or line.program_family) in HOUSEHOLD_PROGRAM_FAMILIES
        if household_target:
            family = family or line.program_family
            session = camper.session_cm_id or line.attributed_session_cm_id
            basis: CamperBasis = camper.basis if camper.basis != "none" else "household"
            camper = replace(camper, session_cm_id=session, basis=basis)
        counts = not line.is_reversed and (camper.person_cm_id > 0 or household_target)
        recorded_at = parse_pb_datetime(line.post_date)
        if commitment is not None and commitment.created is not None:
            if recorded_at is None or commitment.created < recorded_at:
                recorded_at = commitment.created
        rows.append(
            RegisterRow(
                kind="ledger",
                transaction_cm_id=line.transaction_cm_id,
                commitment_id="",
                household_cm_id=line.household_cm_id,
                person_cm_id=camper.person_cm_id,
                camper_basis=camper.basis,
                session_cm_id=camper.session_cm_id,
                program_family=family,
                grantor_key=inputs.grantor_by_source.get(line.source_key, ""),
                source_key=line.source_key,
                source_family=line.source_family,
                funder_type=line.funder_type,
                amount=line.amount,
                recorded_on=line.post_date[:10],
                recorded_at=recorded_at,
                is_reversed=line.is_reversed,
                reversal_date=line.reversal_date,
                cancelled=_cancelled(camper.person_cm_id, camper.session_cm_id, family, by_person),
                counts=counts,
                fulfils_commitment_id=commitment.id if commitment is not None else "",
                requests=(
                    ()
                    if not counts
                    else _household_shares(
                        line.household_cm_id,
                        camper.session_cm_id,
                        family,
                        line.amount,
                        requests_by_household,
                        session_families,
                    )
                    if household_target
                    else _request_shares(
                        camper.person_cm_id, camper.session_cm_id, family, line.amount, requests_by_person, families
                    )
                ),
            )
        )
    fulfilled_ids = {c.id for c in fulfilled.values()}
    for c in inputs.commitments:
        if c.status != "open" or c.id in fulfilled_ids:
            continue
        family = _family(c.person_cm_id, c.session_cm_id, c.program_family, families)
        # Item D5: cancelled is derived from enrollment (a rule, not an inference), so a commitment
        # stops counting while every enrollment it covers is cancelled, as CampMinder reverses a
        # posted grant; it waits for staff to withdraw it, and counts again on re-enrolment.
        cancelled = _cancelled(c.person_cm_id, c.session_cm_id, family, by_person)
        rows.append(
            RegisterRow(
                kind="commitment",
                transaction_cm_id=0,
                commitment_id=c.id,
                household_cm_id=c.household_cm_id,
                person_cm_id=c.person_cm_id,
                camper_basis="commitment",
                session_cm_id=c.session_cm_id,
                program_family=family,
                grantor_key=c.grantor_key,
                source_key="",
                source_family="",
                funder_type="outside",
                amount=c.amount,
                recorded_on=c.committed_on.isoformat(),
                recorded_at=c.created,
                is_reversed=False,
                reversal_date="",
                cancelled=cancelled,
                counts=not cancelled,
                fulfils_commitment_id="",
                requests=(
                    ()
                    if cancelled
                    else _household_shares(
                        c.household_cm_id, c.session_cm_id, family, c.amount, requests_by_household, session_families
                    )
                    if family in HOUSEHOLD_PROGRAM_FAMILIES
                    else _request_shares(
                        c.person_cm_id, c.session_cm_id, family, c.amount, requests_by_person, families
                    )
                ),
            )
        )
    return rows


def grant_inputs_by_request(rows: Iterable[RegisterRow]) -> dict[str, list[GrantInput]]:
    """SP10's calculator input: the OUTSIDE grants that count, per request, each at its share
    (Decision 5). Incentives are left out (the rules meet them through grants.incentives), and so
    is Expected (D56). state is always "committed": receipts are parked (D55)."""
    out: dict[str, list[GrantInput]] = defaultdict(list)
    for row in rows:
        if not row.counts or row.funder_type != "outside":
            continue
        for share in row.requests:
            out[share.request_id].append(
                GrantInput(amount=share.amount, state="committed", recorded_at=row.recorded_at)
            )
    return dict(out)


# --- needs attention (spec §8.2) -------------------------------------------------------------


@dataclass(frozen=True)
class CamperSuggestion:
    """D16: Kindred's suggestion with its evidence; a person confirms (Task 7's placements).
    method is Go's attribution_method for an attribution suggestion ("" for a commitment); the
    screen turns it into words (slice 3's copy)."""

    person_cm_id: int
    session_cm_id: int
    program_family: str
    basis: Literal["commitment", "attribution"]
    method: str
    commitment_id: str
    amount_matches: bool


@dataclass(frozen=True)
class NeedsCamper:
    row: RegisterRow
    household_applied: bool  # the household has a live aid request (Decision 10)
    suggestion: CamperSuggestion | None
    candidates: tuple[int, ...]  # people enrolled this season in the line's family of households


@dataclass(frozen=True)
class UnmappedDescription:
    source_key: str
    lines: int
    amount: Decimal


WaitingReason = Literal["not_posted", "posted_then_reversed", "possible_match", "camper_cancelled"]


@dataclass(frozen=True)
class WaitingCommitment:
    """A commitment still counting on its own, with why (owner ruling 2026-09-29, item A): the
    evidence line is transaction_cm_id (0 when there is none)."""

    row: RegisterRow
    days_waiting: int
    reason: WaitingReason
    transaction_cm_id: int


@dataclass(frozen=True)
class NeedsAttention:
    needs_camper: tuple[NeedsCamper, ...]
    unmapped: tuple[UnmappedDescription, ...]
    waiting: tuple[WaitingCommitment, ...]


def _suggest(line: GrantLine, commitment: Commitment | None) -> CamperSuggestion | None:
    """The commitment assigned to this line is the strongest evidence; otherwise Go's attribution,
    when it placed the line on a person."""
    if commitment is not None:
        return CamperSuggestion(
            commitment.person_cm_id,
            commitment.session_cm_id,
            commitment.program_family,
            "commitment",
            "",
            commitment.id,
            commitment.amount == line.amount,
        )
    if line.attributed_person_cm_id > 0:
        return CamperSuggestion(
            line.attributed_person_cm_id,
            line.attributed_session_cm_id,
            line.program_family,
            "attribution",
            line.attribution_method,
            "",
            False,
        )
    return None


def _suggested_commitments(
    rows: Sequence[RegisterRow], lines: Mapping[int, GrantLine], open_commitments: Sequence[Commitment]
) -> dict[int, Commitment]:
    """Item D3: each open commitment is offered to one line only -- its best line needing a camper
    from the same grantor in the same household (an equal amount, then the earliest post) -- so a
    single grant can't be confirmed twice."""
    assigned: dict[int, Commitment] = {}
    for c in sorted(open_commitments, key=lambda c: (c.committed_on, c.id)):
        same = [
            lines[r.transaction_cm_id]
            for r in rows
            if r.transaction_cm_id not in assigned
            and r.grantor_key
            and r.grantor_key == c.grantor_key
            and r.household_cm_id == c.household_cm_id
        ]
        if same:
            best = min(same, key=lambda ln: (ln.amount != c.amount, ln.post_date, ln.transaction_cm_id))
            assigned[best.transaction_cm_id] = c
    return assigned


def _waiting_reason(
    commitment: Commitment, row: RegisterRow, ledger_rows: Sequence[RegisterRow]
) -> tuple[WaitingReason, int]:
    """Why a commitment still counts on its own (item A), with the line that shows it."""
    if row.cancelled:
        return "camper_cancelled", 0
    created = commitment.created
    reversed_after = [
        r
        for r in ledger_rows
        if r.is_reversed
        and r.person_cm_id == commitment.person_cm_id
        and r.grantor_key == commitment.grantor_key
        and created is not None
        and (reversal := parse_pb_datetime(r.reversal_date)) is not None
        and reversal >= created
    ]
    if reversed_after:
        return "posted_then_reversed", min(reversed_after, key=lambda r: r.transaction_cm_id).transaction_cm_id
    possible = [
        r
        for r in ledger_rows
        if not r.is_reversed
        and r.funder_type == "outside"
        and not r.fulfils_commitment_id
        and (
            (r.person_cm_id == commitment.person_cm_id and r.grantor_key in (commitment.grantor_key, ""))
            or (
                r.person_cm_id != commitment.person_cm_id
                and r.grantor_key == commitment.grantor_key
                and r.household_cm_id == commitment.household_cm_id
            )
        )
    ]
    if possible:
        return "possible_match", min(possible, key=lambda r: (r.recorded_on, r.transaction_cm_id)).transaction_cm_id
    return "not_posted", 0


def needs_attention(
    rows: Sequence[RegisterRow],
    inputs: RegisterInputs,
    *,
    candidates: Mapping[int, Sequence[int]],
    today: date,
) -> NeedsAttention:
    """Grants › Needs attention's three groups (spec §8.2): needs a camper, unmapped description,
    a commitment still not in CampMinder. The late-grant "contact the family" line is Today's and
    needs SP10's lock, so it isn't here."""
    lines = {ln.transaction_cm_id: ln for ln in inputs.lines}
    applied = {r.household_cm_id for r in inputs.requests if r.status in LIVE_REQUEST_STATUSES}
    fulfilled = {r.fulfils_commitment_id for r in rows if r.fulfils_commitment_id}
    open_commitments = [c for c in inputs.commitments if c.status == "open" and c.id not in fulfilled]

    # A household program's line (Family Camp) needs no camper: it sits on the household's request.
    need_rows = [
        row
        for row in rows
        if row.kind == "ledger" and not row.is_reversed and row.person_cm_id == 0 and row.camper_basis != "household"
    ]
    suggested = _suggested_commitments(need_rows, lines, open_commitments)
    needs = [
        NeedsCamper(
            row=row,
            household_applied=row.household_cm_id in applied,
            suggestion=_suggest(lines[row.transaction_cm_id], suggested.get(row.transaction_cm_id)),
            candidates=tuple(candidates.get(row.household_cm_id, ())),
        )
        for row in need_rows
    ]
    needs.sort(key=lambda n: (not n.household_applied, -n.row.amount, n.row.transaction_cm_id))

    unmapped_lines: dict[str, list[Decimal]] = defaultdict(list)
    for row in rows:
        if row.kind == "ledger" and not row.is_reversed and not row.grantor_key:
            unmapped_lines[row.source_key].append(row.amount)
    unmapped = sorted(
        (UnmappedDescription(key, len(amounts), sum(amounts, Decimal(0))) for key, amounts in unmapped_lines.items()),
        key=lambda u: (-u.amount, u.source_key),
    )

    commitments = {c.id: c for c in inputs.commitments}
    ledger_rows = [r for r in rows if r.kind == "ledger"]
    waiting = sorted(
        (
            # Ruling (item 5): never negative -- a future committed_on (a pre-dated pledge) waits 0.
            WaitingCommitment(
                row,
                max(0, (today - date.fromisoformat(row.recorded_on)).days),
                *_waiting_reason(commitments[row.commitment_id], row, ledger_rows),
            )
            for row in rows
            if row.kind == "commitment"
        ),
        key=lambda w: (-w.days_waiting, w.row.commitment_id),
    )
    return NeedsAttention(tuple(needs), tuple(unmapped), tuple(waiting))


# --- Expected (D56) -----------------------------------------------------------------------------

ExpectedKind = Literal["one_happy_camper", "synagogue"]
# The aid_sources source family a line of each Expected kind carries.
_EXPECTED_SOURCE_FAMILY: Final[Mapping[ExpectedKind, str]] = {
    "one_happy_camper": "one_happy_camper",
    "synagogue": "synagogue_federation",
}


@dataclass(frozen=True)
class FormAnswer:
    """One FA mirror row's grant answers: "applied or planning to apply" (never "received")."""

    person_cm_id: int
    household_cm_id: int
    one_happy_camper: bool
    synagogue: bool


@dataclass(frozen=True)
class ExpectedGrant:
    household_cm_id: int
    kind: ExpectedKind
    person_cm_ids: tuple[int, ...]


def expected_grants(
    answers: Iterable[FormAnswer], rows: Iterable[RegisterRow], grantor_families: Mapping[str, frozenset[str]]
) -> list[ExpectedGrant]:
    """D56: the aid form says the family applied, or plans to apply, for One Happy Camper or a
    synagogue campership, and no grant of that kind is in the household yet: no line of that
    source family (live or reversed: either way the application was answered), and no open
    commitment from a grantor with a description of that family. Never a grant: it clears itself
    when one arrives, and the calculator never reads it."""
    arrived: set[tuple[int, str]] = set()
    for row in rows:
        if row.kind == "ledger":
            arrived.add((row.household_cm_id, row.source_family))
        else:
            arrived.update((row.household_cm_id, f) for f in grantor_families.get(row.grantor_key, frozenset()))
    people: dict[tuple[int, ExpectedKind], set[int]] = defaultdict(set)
    for a in answers:
        if a.household_cm_id <= 0:
            continue
        if a.one_happy_camper:
            people[(a.household_cm_id, "one_happy_camper")].add(a.person_cm_id)
        if a.synagogue:
            people[(a.household_cm_id, "synagogue")].add(a.person_cm_id)
    return [
        ExpectedGrant(household, kind, tuple(sorted(persons)))
        for (household, kind), persons in sorted(people.items())
        if (household, _EXPECTED_SOURCE_FAMILY[kind]) not in arrived
    ]
