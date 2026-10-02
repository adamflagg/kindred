"""Money > To place (campership SP11-rest; clean spec §8.1; D12, D16, D26, D58, D62, D81, D104, D146).

One read and four writes over the season the decisions service prices (D21: the server decides).

  read        the open lines by reason, with Kindred's suggestions and what confirming each would lock
              (financial_aid.view; §4.10: the confirmation shows the total it locks);
  place       Confirm or Split, one line or a whole class (casework): one aid_attribution_overrides row
              (source `staff`) per line that puts it, or each part of it, on its request, AND the Posted ticks
              the placed money makes, as ONE operation (D12, D16, D81). A placement ticks the rounds the money
              covers in full, oldest first, at their decided amounts, dated the latest live line's day on the
              request: the ledger's own walk (ledger_ticks, D146), so a person's placement and the overnight
              tick never disagree. A round whose request something re-priced after its posting day is not
              ticked: the money is placed and the response names the round for a person to tick (D16);
  leave       Leave at family level, with a note (casework): an aid_flag_dispositions row, flag `to_place`;
  reopen      undo that (casework);
  reclassify  Reclassify (rules, D104): the override's source_key_override, with a reason. Go applies it on
              the next aid_postings run; until then the line is listed apart as reclassified.

Every write goes through 4a's commit_aid_writes (the store's `commit`), and a write that changes nothing
writes nothing (change_row refuses a no-op). A write that lost a race (someone created or removed the same
row first) is AidWriteConflictError, answered 409 (G6); any other refused batch is a 422. Nothing here works
before FIRST_TICKED_SEASON: 2026's money was never ticked (SP10b Decision 9).
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, Final, Protocol

from api.constants.collections import AID_ATTRIBUTION_OVERRIDES, AID_FLAG_DISPOSITIONS
from api.schemas.financial_aid_to_place import (
    CandidateOut,
    EvidenceOut,
    LeaveLineIn,
    LeftToTickOut,
    NotTickedOut,
    PartOut,
    PlaceLineIn,
    PlaceLinesIn,
    PlaceLinesRow,
    PlaceOut,
    PlacePreviewIn,
    PlacePreviewOut,
    ReclassifyLineIn,
    SuggestionOut,
    TickedOut,
    ToPlaceGroupOut,
    ToPlaceLineOut,
    ToPlaceResponse,
    ToPlaceWriteOut,
)
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_decisions_service import (
    FIRST_TICKED_SEASON,
    DecisionNotFoundError,
    DecisionRefusedError,
    FinancialAidDecisionsService,
    Season,
)
from api.services.financial_aid_grants_register import Placement
from api.services.financial_aid_ledger_service import money
from api.services.financial_aid_reconciliation import (
    LedgerTick,
    SeasonLedger,
    SplitPart,
    camp_date,
    live_net,
    locked_total,
)
from api.services.financial_aid_to_place import (
    LEFT_DISPOSITION,
    REASONS,
    TO_PLACE_FLAG,
    Candidate,
    ChangedReason,
    LeftLine,
    LineDetail,
    Outcome,
    OverrideRow,
    Reason,
    SinceInputs,
    SourceRow,
    Suggestion,
    ToPlaceItem,
    page_scope,
    placement_outcome,
    to_place,
    withhold,
)
from bunking.financial_aid.change_diff import changed_fields
from bunking.financial_aid.change_log import AidOperationResult, AidWrite, AidWriteConflictError
from bunking.financial_aid.decisions import PricedRequest
from bunking.financial_aid.money import ZERO, dollars
from bunking.pocketbase_batch import BatchLimitError, BatchRequestFailedError

GROUP_LABELS: Final[dict[Reason, str]] = {
    "several": "Several requests could take this",
    "no_request": "No request behind it",
    "program_mismatch": "The description names a program this camper isn't in",
}

PENDING_RECLASS: Final = "its reclassification waits for tonight's ledger sync"


class ToPlaceStore(Protocol):
    async def fetch_line_details(self, year: int) -> dict[int, LineDetail]: ...
    async def fetch_override_rows(self, year: int) -> dict[int, OverrideRow]: ...
    async def fetch_left_lines(self, year: int) -> dict[int, LeftLine]: ...
    async def fetch_source_rows(self) -> dict[str, SourceRow]: ...
    async def fetch_names(
        self, year: int, household_cm_ids: Collection[int], person_cm_ids: Collection[int]
    ) -> tuple[dict[int, str], dict[int, str]]: ...
    async def commit(
        self,
        writes: Sequence[AidWrite],
        *,
        actor: str,
        operation_id: str | None = None,
        reason: str | None = None,
        require_reason: bool = False,
        allow_chunking: bool = False,
    ) -> AidOperationResult: ...


def _gate(year: int) -> str:
    """Why To place has nothing for this season, or ""."""
    if year < FIRST_TICKED_SEASON:
        return f"{year} predates To place (the first ticked season is {FIRST_TICKED_SEASON})"
    return ""


def pending_reclass(override: OverrideRow | None, detail: LineDetail | None) -> str:
    """The source a reclassification names while Go hasn't applied it yet (the line's effective description
    is still another); "" when there is none, or once it is applied (D104)."""
    if override is None or not override.source_key_override:
        return ""
    if detail is not None and detail.description_key == override.source_key_override:
        return ""
    return override.source_key_override


@dataclass(frozen=True)
class SortedLines:
    """To place's items as its read lists them: the open lines by reason (every reason, in §8.1's order), the lines
    left at family level (D58), and the lines whose reclassification waits for tonight's sync (D104), each with the
    source it names. Only the open lines are counted (open_count, open_total, and Today's line)."""

    groups: dict[Reason, list[ToPlaceItem]]
    left: list[ToPlaceItem]
    reclassified: list[tuple[ToPlaceItem, str]]

    @property
    def open(self) -> list[ToPlaceItem]:
        return [item for found in self.groups.values() for item in found]


def sort_lines(
    items: Sequence[ToPlaceItem],
    overrides: Mapping[int, OverrideRow],
    details: Mapping[int, LineDetail],
    left: Mapping[int, LeftLine],
) -> SortedLines:
    """Each item to its list: a pending reclassification first, then a line left at family level, else open."""
    groups: dict[Reason, list[ToPlaceItem]] = {reason: [] for reason in REASONS}
    left_items: list[ToPlaceItem] = []
    reclassified: list[tuple[ToPlaceItem, str]] = []
    for item in items:
        txn = item.line.transaction_cm_id
        pending = pending_reclass(overrides.get(txn), details.get(txn))
        if pending:
            reclassified.append((item, pending))
        elif txn in left:
            left_items.append(item)
        else:
            groups[item.reason].append(item)
    return SortedLines(groups=groups, left=left_items, reclassified=reclassified)


@dataclass(frozen=True)
class OpenToPlace:
    """Today's To place line (§6.4, §8.1): the open lines Money › To place counts (open_count, open_total), and the
    households CampMinder posted them to. `skipped` is To place's reason for an empty season (SP11 Decision 12)."""

    lines: int
    households: int
    total: Decimal
    skipped: str = ""


NO_OPEN_LINES: Final = OpenToPlace(lines=0, households=0, total=ZERO)


class ToPlaceCounts(Protocol):
    """The three reads To place's open lines need beyond the priced season (the repository's own)."""

    async def fetch_line_details(self, year: int) -> dict[int, LineDetail]: ...
    async def fetch_override_rows(self, year: int) -> dict[int, OverrideRow]: ...
    async def fetch_left_lines(self, year: int) -> dict[int, LeftLine]: ...


async def open_to_place(season: Season, store: ToPlaceCounts) -> OpenToPlace:
    """The season's open To place lines, counted exactly as ToPlaceService.read counts open_count and open_total
    (the same to_place and sort_lines), over a season the caller already priced: Today prices once (D21). Nothing
    before FIRST_TICKED_SEASON (SP10b Decision 9)."""
    if skipped := _gate(season.year):
        return OpenToPlace(lines=0, households=0, total=ZERO, skipped=skipped)
    details, overrides, left = await asyncio.gather(
        store.fetch_line_details(season.year),
        store.fetch_override_rows(season.year),
        store.fetch_left_lines(season.year),
    )
    items = to_place(season, details)
    found = sort_lines(items, overrides, details, left).open
    return OpenToPlace(
        lines=len(found),
        households=len({item.line.household_cm_id for item in found}),
        total=sum((item.unplaced for item in found), ZERO),
    )


def _left_to_tick(
    priced: Sequence[PricedRequest],
    ledger: SeasonLedger,
    ticked: Collection[tuple[str, int]],
    undone: Collection[tuple[str, int]],
    withheld: Collection[tuple[str, int]] = frozenset(),
) -> list[LeftToTickOut]:
    """Each placed request's first round still waiting for a tick, and why the placement left it. A round whose
    tick was withheld (D16) is named apart, with its reasons, so the walk stops there without naming it."""
    out: list[LeftToTickOut] = []
    for request in priced:
        held = live_net(ledger.lines(request.request_id))
        locked = locked_total(request)
        for view in sorted(request.rounds, key=lambda v: v.round):
            key = (request.request_id, view.round)
            if key in ticked:
                locked += view.decided or ZERO
                continue
            if key in withheld:
                break
            if view.status == "posted":
                continue
            if view.status != "needs_offer" or view.decided is None:
                break
            if key in undone:
                why = "You un-ticked this round: tick it again by hand if that is right"
            else:
                why = (
                    f"CampMinder holds {dollars(held)} on this request; Round {view.round} needs "
                    f"{dollars(locked + view.decided)}: tick it by hand if that is right"
                )
            out.append(LeftToTickOut(request_id=request.request_id, round=view.round, why=why))
            break
    return out


Withheld = Sequence[tuple[LedgerTick, tuple[ChangedReason, ...]]]


@dataclass(frozen=True)
class _Plan:
    """What placing some lines would do, before anything is written: the season it was worked out on, the override
    and leave-end writes it would make (built in memory: _staged checks a placement by building its write), the
    outcome, the ticks it writes and the ones D16 withholds (named in not_ticked), and the total it locks. The write
    commits it; the preview (slice 3, ask 8) reads it and writes nothing."""

    season: Season
    writes: tuple[AidWrite, ...]
    outcome: Outcome
    ticks: tuple[LedgerTick, ...]
    held: tuple[tuple[LedgerTick, tuple[ChangedReason, ...]], ...]
    not_ticked: tuple[NotTickedOut, ...]
    locking: Decimal


def _ticked_out(ticks: Sequence[LedgerTick]) -> list[TickedOut]:
    return [TickedOut(request_id=t.request_id, round=t.round, amount=money(t.amount)) for t in ticks]


def _left_out(outcome: Outcome, season: Season, ticks: Sequence[LedgerTick], withheld: Withheld) -> list[LeftToTickOut]:
    ticked = {(t.request_id, t.round) for t in ticks}
    held = {(t.request_id, t.round) for t, _ in withheld}
    return _left_to_tick(outcome.priced, outcome.ledger, ticked, season.undone, held)


def _suggested(
    item: ToPlaceItem, suggestion: Suggestion
) -> tuple[dict[int, Placement], dict[int, tuple[SplitPart, ...]]]:
    """A suggestion as the placement (one part) or split (several) confirming it would write."""
    txn = item.line.transaction_cm_id
    by_id = {c.request_id: c for c in item.candidates}
    if len(suggestion.parts) == 1:
        return {txn: by_id[suggestion.parts[0].request_id].placement(txn)}, {}
    return {}, {txn: tuple(by_id[p.request_id].part(p.amount) for p in suggestion.parts)}


def _joined(texts: Sequence[str]) -> str:
    return texts[0] if len(texts) == 1 else f"{', '.join(texts[:-1])} and {texts[-1]}"


def not_ticked_out(transaction_cm_id: int, tick: LedgerTick, reasons: Sequence[ChangedReason]) -> NotTickedOut:
    """D16, owner ruling 2026-10-01, refined (option a): the money is placed, and this round's automatic tick is
    withheld, at night too. A person's tick locks the higher of its decided amount at the end of the posting day
    (where 3c-2 rebuilds it) and today's (D152; owner, B1 Q1 2026-10-02), so the text says that."""
    n, day = tick.round, f"{tick.posted_on:%b} {tick.posted_on.day}"
    why = (
        f"Round {n} was not ticked automatically: after CampMinder posted it on {day}, "
        f"{_joined([r.text for r in reasons])}. The nightly ledger sync leaves it too: tick it by hand. That locks "
        f"the higher of its decided amount on {day} (where Kindred can rebuild that day) and today's. Check it "
        "against what the family was offered first."
    )
    return NotTickedOut(
        transaction_cm_id=transaction_cm_id,
        request_id=tick.request_id,
        round=n,
        posted_on=tick.posted_on,
        reasons=[r.text for r in reasons],
        why=why,
    )


def _raced(exc: BatchRequestFailedError) -> bool:
    """Someone created the same row first (a unique index) or removed it first (404): a race, not a refusal."""
    return exc.status == 404 or any("unique" in message.lower() for message in exc.field_errors.values())


class ToPlaceService:
    def __init__(
        self,
        decisions: FinancialAidDecisionsService,
        store: ToPlaceStore,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._decisions = decisions
        self._store = store
        self._clock: Callable[[], datetime] = clock or (lambda: datetime.now(UTC))

    def _today(self) -> date:
        return self._clock().astimezone(CAMP_TZ).date()

    async def _since(self, season: Season, ticks: Sequence[LedgerTick]) -> SinceInputs | None:
        """D16b's loads for these ticks, once: the decisions service's, which its overnight and hand ticks read too."""
        return await self._decisions.since_inputs(season, ticks)

    @staticmethod
    def _withhold(
        season: Season, ticks: Sequence[LedgerTick], since: SinceInputs | None
    ) -> tuple[list[LedgerTick], list[tuple[LedgerTick, tuple[ChangedReason, ...]]]]:
        """The one check the preview and the write both run (§4.10): `withhold`, which the overnight tick and a
        person's tick run too (D152)."""
        return withhold(season, ticks, since)

    # --- the read ---------------------------------------------------------------------------------

    async def read(self, year: int, household_cm_id: int | None = None) -> ToPlaceResponse:
        """The season's To place, or one household page's part of it (D26: the page's scope)."""
        if skipped := _gate(year):
            return ToPlaceResponse(
                year=year, household_cm_id=household_cm_id, open_count=0, open_total=0, groups=[], skipped=skipped
            )
        season, details, overrides, left, sources = await asyncio.gather(
            self._decisions.season(year),
            self._store.fetch_line_details(year),
            self._store.fetch_override_rows(year),
            self._store.fetch_left_lines(year),
            self._store.fetch_source_rows(),
        )
        items = to_place(season, details)
        if household_cm_id is not None:
            scope = page_scope(household_cm_id, season)
            items = [i for i in items if i.line.household_cm_id in scope]
        households = {i.line.household_cm_id for i in items} | {c.household_cm_id for i in items for c in i.candidates}
        people = {i.line.person_cm_id for i in items if i.line.person_cm_id > 0} | {
            c.person_cm_id for i in items for c in i.candidates if c.person_cm_id > 0
        }
        families, persons = await self._store.fetch_names(year, households, people)
        today = self._today()

        def described(key: str) -> str:
            source = sources.get(key)
            return source.description if source is not None else key

        outcomes: dict[int, Outcome] = {}
        for item in items:
            txn = item.line.transaction_cm_id
            if item.suggestion is not None and not pending_reclass(overrides.get(txn), details.get(txn)):
                placements, splits = _suggested(item, item.suggestion)
                targets = [p.request_id for p in item.suggestion.parts]
                outcomes[txn] = placement_outcome(season, placements, splits, targets, today=today)
        since = await self._since(season, [t for outcome in outcomes.values() for t in outcome.ticks])

        def suggestion_out(item: ToPlaceItem) -> SuggestionOut | None:
            outcome = outcomes.get(item.line.transaction_cm_id)
            if item.suggestion is None or outcome is None:
                return None
            ticks, held = self._withhold(season, outcome.ticks, since)
            return SuggestionOut(
                parts=[PartOut(request_id=p.request_id, amount=money(p.amount)) for p in item.suggestion.parts],
                evidence=[EvidenceOut(kind=e.kind, text=e.text) for e in item.suggestion.evidence],
                would_tick=_ticked_out(ticks),
                would_lock=money(sum((t.amount for t in ticks), ZERO)),
                would_leave=_left_out(outcome, season, ticks, held),
                would_not_tick=[not_ticked_out(item.line.transaction_cm_id, t, reasons) for t, reasons in held],
            )

        def line_out(item: ToPlaceItem, pending: str, note: str) -> ToPlaceLineOut:
            line = item.line
            detail = details.get(line.transaction_cm_id)
            return ToPlaceLineOut(
                transaction_cm_id=line.transaction_cm_id,
                household_cm_id=line.household_cm_id,
                family=families.get(line.household_cm_id, ""),
                person_cm_id=line.person_cm_id,
                person=persons.get(line.person_cm_id, "") if line.person_cm_id > 0 else "",
                amount=money(line.amount),
                unplaced=money(item.unplaced),
                posted_on=camp_date(line.post_date) if line.post_date is not None else None,
                description=described(detail.description_key) if detail is not None else "",
                reason=item.reason,
                candidates=[self._candidate_out(c, season, families, persons) for c in item.candidates],
                suggestion=suggestion_out(item) if not pending else None,
                left_note=note,
                reclassified_to=described(pending) if pending else "",
            )

        sorted_lines = sort_lines(items, overrides, details, left)
        groups, left_items, reclassified = sorted_lines.groups, sorted_lines.left, sorted_lines.reclassified

        def total(found: Sequence[ToPlaceItem]) -> float:
            return money(sum((i.unplaced for i in found), ZERO))

        return ToPlaceResponse(
            year=year,
            household_cm_id=household_cm_id,
            open_count=sum(len(found) for found in groups.values()),
            open_total=total([i for found in groups.values() for i in found]),
            groups=[
                ToPlaceGroupOut(
                    reason=reason,
                    label=GROUP_LABELS[reason],
                    count=len(found),
                    total=total(found),
                    lines=[line_out(i, "", "") for i in found],
                )
                for reason, found in groups.items()
            ],
            left=[line_out(i, "", left[i.line.transaction_cm_id].note) for i in left_items],
            left_total=total(left_items),
            reclassified=[line_out(i, pending, "") for i, pending in reclassified],
            reclassified_total=total([i for i, _ in reclassified]),
        )

    @staticmethod
    def _candidate_out(c: Candidate, season: Season, families: dict[int, str], persons: dict[int, str]) -> CandidateOut:
        session = season.sessions.get(c.session_cm_id)
        return CandidateOut(
            request_id=c.request_id,
            household_cm_id=c.household_cm_id,
            family=families.get(c.household_cm_id, ""),
            person_cm_id=c.person_cm_id,
            camper=persons.get(c.person_cm_id, "") if c.person_cm_id > 0 else "",
            session_cm_id=c.session_cm_id,
            session=session.name if session is not None else "",
            not_yet_in_campminder=money(c.not_yet_in_campminder),
            cancelled=c.cancelled,
        )

    # --- the writes ---------------------------------------------------------------------------------

    @staticmethod
    def _pool_item(
        season: Season, transaction_cm_id: int, pool: Mapping[int, ToPlaceItem] | None = None
    ) -> ToPlaceItem:
        """The line's To place item, or why it has none."""
        items = pool if pool is not None else {i.line.transaction_cm_id: i for i in to_place(season, {})}
        item = items.get(transaction_cm_id)
        if item is not None:
            return item
        if any(line.transaction_cm_id == transaction_cm_id and line.live() for line in season.camp_lines):
            raise DecisionRefusedError(f"line {transaction_cm_id} is already on a request")
        raise DecisionNotFoundError(f"no live camp-aid line {transaction_cm_id} in {season.year}")

    async def _commit(
        self, writes: Sequence[AidWrite], *, actor: str, reason: str | None, require_reason: bool = False
    ) -> AidOperationResult:
        """One operation. Nothing is written when PocketBase refuses the batch: a row someone created or removed
        first (a double click, two staff) is a race, AidWriteConflictError (409, G6's wording); anything else
        is a refusal (422). G6's own stale-revision refusal arrives as AidWriteConflictError already."""
        try:
            return await self._store.commit(writes, actor=actor, reason=reason, require_reason=require_reason)
        except BatchRequestFailedError as exc:
            if _raced(exc):
                url = exc.request.url.strip("/").split("/") if exc.request is not None else []
                collection = url[2] if len(url) > 2 else ""
                record_id = url[4] if len(url) > 4 else ""
                raise AidWriteConflictError(collection=collection, record_id=record_id) from exc
            raise DecisionRefusedError(f"nothing was written: {exc.message}") from exc

    async def place(self, year: int, transaction_cm_id: int, body: PlaceLineIn, actor: str) -> PlaceOut:
        """Confirm (one part) or Split (several) one line."""
        row = PlaceLinesRow(transaction_cm_id=transaction_cm_id, parts=body.parts)
        lines = PlaceLinesIn(lines=[row], note=body.note, expected_locked=body.expected_locked)
        return await self.place_lines(year, lines, actor)

    def _staged(
        self,
        year: int,
        item: ToPlaceItem,
        current: OverrideRow | None,
        detail: LineDetail | None,
        row: PlaceLinesRow,
        note: str,
        actor: str,
    ) -> tuple[Placement | None, tuple[SplitPart, ...], AidWrite]:
        """One line's placement (or split) and its override write, checked against the line and its family.
        A reclassification Go already applied stays on the override (D104)."""
        txn = row.transaction_cm_id
        if pending_reclass(current, detail):
            raise DecisionRefusedError(PENDING_RECLASS)
        by_id = {c.request_id: c for c in item.candidates}
        for part in row.parts:
            if part.request_id not in by_id:
                raise DecisionRefusedError(f"{part.request_id} is not a request this family holds")
        total = sum((p.amount for p in row.parts), ZERO)
        if total != item.line.amount:
            partly = (
                "; this line is partly placed; a placement replaces all of it, so its parts must add up to the "
                "whole line."
                if item.unplaced != item.line.amount
                else ""
            )
            raise DecisionRefusedError(
                f"the parts add up to {dollars(total)}; the line is {dollars(item.line.amount)}{partly}"
            )
        whole = by_id[row.parts[0].request_id].placement(txn) if len(row.parts) == 1 else None
        split = () if whole is not None else tuple(by_id[p.request_id].part(p.amount) for p in row.parts)
        payload: dict[str, Any] = {
            "transaction_cm_id": txn,
            "year": year,
            "attributed_person_cm_id": whole.person_cm_id if whole is not None else 0,
            "attributed_session_cm_id": whole.session_cm_id if whole is not None else 0,
            "program_family": whole.program_family if whole is not None else "",
            "source_key_override": current.source_key_override if current is not None else "",
            "source": "staff",
            "note": note or (current.note if current is not None else ""),
            "split": [part.fields() for part in split],
        }
        write = self._override_write(year, current, payload, actor, "place_line", reason=note or None)
        if write is None:
            raise DecisionRefusedError("it is already placed that way")
        return whole, split, write

    async def _plan(self, year: int, rows: Sequence[PlaceLinesRow], note: str, actor: str) -> _Plan:
        """One plan for the write and its preview (§4.10: what you confirm is what's written). Each line's override,
        the end of any Leave at family level, where the money lands, and the Posted ticks it makes, less the ticks
        D16 withholds. Reads only: every write is built in memory and returned, never committed here."""
        season, overrides, details, left = await asyncio.gather(
            self._decisions.season(year),
            self._store.fetch_override_rows(year),
            self._store.fetch_line_details(year),
            self._store.fetch_left_lines(year),
        )
        pool = {i.line.transaction_cm_id: i for i in to_place(season, {})}
        whole: dict[int, Placement] = {}
        splits: dict[int, tuple[SplitPart, ...]] = {}
        writes: list[AidWrite] = []
        problems: list[str] = []
        for row in rows:
            txn = row.transaction_cm_id
            try:
                item = self._pool_item(season, txn, pool)
                placement, split, write = self._staged(
                    year, item, overrides.get(txn), details.get(txn), row, note, actor
                )
            except DecisionRefusedError as exc:
                problems.append(f"line {txn}: {exc}")
                continue
            if placement is not None:
                whole[txn] = placement
            else:
                splits[txn] = split
            writes.append(write)
            if txn in left:
                writes.append(self._left_delete(year, txn, left[txn]))
        if problems:
            raise DecisionRefusedError("; ".join(problems))
        targets = [p.request_id for row in rows for p in row.parts]
        outcome = placement_outcome(season, whole, splits, targets, today=self._today())
        for row in rows:
            for part in row.parts:
                landed = sum(
                    (
                        ln.amount
                        for ln in outcome.ledger.lines(part.request_id)
                        if ln.transaction_cm_id == row.transaction_cm_id
                    ),
                    ZERO,
                )
                if landed != part.amount:
                    cause = next(
                        (c for c in pool[row.transaction_cm_id].candidates if c.request_id == part.request_id), None
                    )
                    why = (
                        " (its session is not known yet and its camper has another request): resolve the "
                        "request's session first"
                        if cause is not None and cause.session_cm_id == 0
                        else ""
                    )
                    problems.append(f"line {row.transaction_cm_id}: this part would not land on {part.request_id}{why}")
        if problems:
            raise DecisionRefusedError("; ".join(problems))
        # D16, owner ruling 2026-10-01, refined (option a): each round locks at its decided amount as of its posting
        # day. Where something that prices the request was recorded after that day, the money is still placed and
        # only that round's automatic tick is withheld (no Posted row, no rules lock), named per line for a person.
        since = await self._since(season, outcome.ticks)
        ticks, held = self._withhold(season, outcome.ticks, since)
        first_line: dict[str, int] = {}  # each withheld round named once, against the first line on its request
        for row in rows:
            for part in row.parts:
                first_line.setdefault(part.request_id, row.transaction_cm_id)
        not_ticked = [not_ticked_out(first_line[tick.request_id], tick, reasons) for tick, reasons in held]
        return _Plan(
            season=season,
            writes=tuple(writes),
            outcome=outcome,
            ticks=tuple(ticks),
            held=tuple(held),
            not_ticked=tuple(not_ticked),
            locking=sum((t.amount for t in ticks), ZERO),
        )

    async def place_lines(self, year: int, body: PlaceLinesIn, actor: str) -> PlaceOut:
        """Confirm or Split one line, or confirm a whole class of them (D16), all or nothing: each line's
        override, the Posted ticks the placed money makes, and the end of any Leave at family level on those
        lines, as ONE operation (D12, D81). The ticks D16 withholds are not written; they come back in
        `not_ticked`, per line."""
        if skipped := _gate(year):
            raise DecisionRefusedError(skipped)
        if len(body.lines) > 1 and body.expected_locked is not None:
            raise DecisionRefusedError(
                "a confirm of several lines shows an estimate; confirm lines one by one to check the exact total"
            )
        plan = await self._plan(year, body.lines, body.note, actor)
        if body.expected_locked is not None and plan.locking != body.expected_locked:
            raise DecisionRefusedError(
                f"this now locks {dollars(plan.locking)}, not the {dollars(Decimal(body.expected_locked))} you "
                "confirmed: reload To place and check it again"
            )
        posts: list[AidWrite] = []
        locks: list[AidWrite] = []
        not_locked: list[str] = []
        if plan.ticks:
            posts, locks, sections = await self._decisions.tick_writes(
                plan.season,
                plan.ticks,
                actor,
                lock_source="placement",
                note=lambda tick: (
                    f"Ticked by placing family-level money: CampMinder shows {dollars(tick.in_campminder)} "
                    "on this request"
                ),
            )
            not_locked = list(sections)
        try:
            result = await self._commit([*locks, *plan.writes, *posts], actor=actor, reason=body.note or None)
        except BatchLimitError as exc:
            raise DecisionRefusedError(
                f"{len(body.lines)} lines are too many to place at once; place them in smaller groups"
            ) from exc
        return PlaceOut(
            year=year,
            operation_id=result.operation_id,
            placed=[row.transaction_cm_id for row in body.lines],
            ticked=_ticked_out(plan.ticks),
            left_to_tick=_left_out(plan.outcome, plan.season, plan.ticks, plan.held),
            not_ticked=list(plan.not_ticked),
            sections_not_locked=not_locked,
        )

    async def preview(self, year: int, transaction_cm_id: int, body: PlacePreviewIn, actor: str) -> PlacePreviewOut:
        """A typed Split… or Place on another request, before the click (slice 3, ask 8): the write's own plan,
        stopped before anything is written. It refuses as the write would, with the write's own words."""
        if skipped := _gate(year):
            raise DecisionRefusedError(skipped)
        row = PlaceLinesRow(transaction_cm_id=transaction_cm_id, parts=body.parts)
        plan = await self._plan(year, [row], body.note, actor)
        return PlacePreviewOut(
            year=year,
            transaction_cm_id=transaction_cm_id,
            parts=[PartOut(request_id=p.request_id, amount=money(p.amount)) for p in body.parts],
            would_tick=_ticked_out(plan.ticks),
            would_lock=money(plan.locking),
            would_leave=_left_out(plan.outcome, plan.season, plan.ticks, plan.held),
            would_not_tick=list(plan.not_ticked),
        )

    @staticmethod
    def _override_write(
        year: int, current: OverrideRow | None, payload: dict[str, Any], actor: str, action: str, reason: str | None
    ) -> AidWrite | None:
        """The override's create or update and its log row; None when it would change nothing. The record
        also stores who wrote it; the log row's actor column says that, so the logged diff is the payload."""
        if current is None:
            return AidWrite(
                collection=AID_ATTRIBUTION_OVERRIDES,
                action="create",
                year=year,
                data={**payload, "actor": actor},
                after=payload,
                log_action=action,
                reason=reason,
            )
        before = current.snapshot(year)
        if changed_fields(before, payload) == ({}, {}):
            return None
        return AidWrite(
            collection=AID_ATTRIBUTION_OVERRIDES,
            action="update",
            year=year,
            record_id=current.id,
            before=before,
            data={**payload, "actor": actor},
            after=payload,
            log_action=action,
            reason=reason,
        )

    @staticmethod
    def _left_snapshot(year: int, transaction_cm_id: int, note: str) -> dict[str, Any]:
        return {
            "transaction_cm_id": transaction_cm_id,
            "year": year,
            "flag": TO_PLACE_FLAG,
            "disposition": LEFT_DISPOSITION,
            "note": note,
        }

    def _left_delete(self, year: int, transaction_cm_id: int, current: LeftLine, action: str = "placed") -> AidWrite:
        return AidWrite(
            collection=AID_FLAG_DISPOSITIONS,
            action="delete",
            year=year,
            record_id=current.id,
            before=self._left_snapshot(year, transaction_cm_id, current.note),
            log_action=action,
        )

    def _unchanged(self, year: int, transaction_cm_id: int) -> ToPlaceWriteOut:
        return ToPlaceWriteOut(year=year, transaction_cm_id=transaction_cm_id, written=0, operation_id="")

    async def leave(self, year: int, transaction_cm_id: int, body: LeaveLineIn, actor: str) -> ToPlaceWriteOut:
        """Leave at family level, with a note (D58): the line leaves the open count; the Note on the family's
        requests stays (D81), since CampMinder still holds the money. Refused while a reclassification of the
        line waits for the sync: it is already out of the open count."""
        if skipped := _gate(year):
            raise DecisionRefusedError(skipped)
        season, left, overrides, details = await asyncio.gather(
            self._decisions.season(year),
            self._store.fetch_left_lines(year),
            self._store.fetch_override_rows(year),
            self._store.fetch_line_details(year),
        )
        self._pool_item(season, transaction_cm_id)
        if pending_reclass(overrides.get(transaction_cm_id), details.get(transaction_cm_id)):
            raise DecisionRefusedError(PENDING_RECLASS)
        current = left.get(transaction_cm_id)
        if current is not None and current.note == body.note:
            return self._unchanged(year, transaction_cm_id)
        payload = self._left_snapshot(year, transaction_cm_id, body.note)
        write = (
            AidWrite(
                collection=AID_FLAG_DISPOSITIONS,
                action="create",
                year=year,
                data=payload,
                log_action="leave_at_family_level",
            )
            if current is None
            else AidWrite(
                collection=AID_FLAG_DISPOSITIONS,
                action="update",
                year=year,
                record_id=current.id,
                before=self._left_snapshot(year, transaction_cm_id, current.note),
                data={"note": body.note},
                log_action="leave_at_family_level",
            )
        )
        result = await self._commit([write], actor=actor, reason=body.note, require_reason=True)
        return ToPlaceWriteOut(
            year=year, transaction_cm_id=transaction_cm_id, written=1, operation_id=result.operation_id
        )

    async def reopen(self, year: int, transaction_cm_id: int, reason: str, actor: str) -> ToPlaceWriteOut:
        """Undo Leave at family level: the line is open in To place again."""
        if skipped := _gate(year):
            raise DecisionRefusedError(skipped)
        current = (await self._store.fetch_left_lines(year)).get(transaction_cm_id)
        if current is None:
            return self._unchanged(year, transaction_cm_id)
        write = self._left_delete(year, transaction_cm_id, current, action="reopen")
        result = await self._commit([write], actor=actor, reason=reason, require_reason=True)
        return ToPlaceWriteOut(
            year=year, transaction_cm_id=transaction_cm_id, written=1, operation_id=result.operation_id
        )

    async def reclassify(
        self, year: int, transaction_cm_id: int, body: ReclassifyLineIn, actor: str
    ) -> ToPlaceWriteOut:
        """Reclassify (D104, `rules`): the line's money is really another source's. Writes the override's
        source_key_override (keeping any placement it holds), with a reason. Go applies it on the next
        aid_postings run, which is when the line leaves camp aid (or moves within it). The target must be a
        classified aid source: this plan's choice, D104 doesn't make it."""
        if skipped := _gate(year):
            raise DecisionRefusedError(skipped)
        season, details, overrides, sources, left = await asyncio.gather(
            self._decisions.season(year),
            self._store.fetch_line_details(year),
            self._store.fetch_override_rows(year),
            self._store.fetch_source_rows(),
            self._store.fetch_left_lines(year),
        )
        self._pool_item(season, transaction_cm_id)
        key = body.source_key
        target = sources.get(key)
        if target is None:
            raise DecisionRefusedError(f"source {key!r} is not in aid_sources")
        if not target.classified or not target.counts_as_aid:
            raise DecisionRefusedError(f"source {key!r} is not classified as aid")
        detail = details.get(transaction_cm_id)
        current = overrides.get(transaction_cm_id)
        if not pending_reclass(current, detail) and detail is not None and detail.description_key == key:
            raise DecisionRefusedError(f"line {transaction_cm_id} is already {target.description}")
        base = (
            current.snapshot(year)
            if current is not None
            else {
                "transaction_cm_id": transaction_cm_id,
                "year": year,
                "attributed_person_cm_id": 0,
                "attributed_session_cm_id": 0,
                "program_family": "",
                "split": [],
            }
        )
        payload = {**base, "source_key_override": key, "source": "staff", "note": body.reason}
        write = self._override_write(year, current, payload, actor, "reclassify", reason=body.reason)
        if write is None:
            return self._unchanged(year, transaction_cm_id)
        writes = [write]
        if transaction_cm_id in left:  # a reclassified line is out of the count; its leave ends with it
            writes.append(self._left_delete(year, transaction_cm_id, left[transaction_cm_id], action="reclassified"))
        result = await self._commit(writes, actor=actor, reason=body.reason, require_reason=True)
        return ToPlaceWriteOut(
            year=year, transaction_cm_id=transaction_cm_id, written=1, operation_id=result.operation_id
        )
