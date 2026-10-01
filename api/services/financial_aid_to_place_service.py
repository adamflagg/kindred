"""Money > To place (campership SP11-rest; clean spec §8.1; D12, D16, D26, D58, D62, D81, D104, D146).

One read and four writes over the season the decisions service prices (D21: the server decides).

  read        the open lines by reason, with Kindred's suggestions and what confirming each would lock
              (financial_aid.view; §4.10: the confirmation shows the total it locks);
  place       Confirm or Split, one line or a whole class (casework): one aid_attribution_overrides row
              (source `staff`) per line that puts it, or each part of it, on its request, AND the Posted ticks
              the placed money makes, as ONE operation (D12, D16, D81). A placement ticks the rounds the money
              covers in full, oldest first, at their decided amounts, dated the latest live line's day on the
              request: the ledger's own walk (ledger_ticks, D146), so a person's placement and the overnight
              tick never disagree;
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
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, Final, Protocol

from api.constants.collections import AID_ATTRIBUTION_OVERRIDES, AID_FLAG_DISPOSITIONS
from api.schemas.financial_aid_to_place import (
    CandidateOut,
    EvidenceOut,
    LeaveLineIn,
    LeftToTickOut,
    PartOut,
    PlaceLineIn,
    PlaceLinesIn,
    PlaceLinesRow,
    PlaceOut,
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
    SeasonLedger,
    SplitPart,
    camp_date,
    dollars,
    live_net,
    locked_total,
)
from api.services.financial_aid_to_place import (
    LEFT_DISPOSITION,
    REASONS,
    TO_PLACE_FLAG,
    Candidate,
    LeftLine,
    LineDetail,
    Outcome,
    OverrideRow,
    Reason,
    SourceRow,
    Suggestion,
    ToPlaceItem,
    page_scope,
    placement_outcome,
    to_place,
)
from bunking.financial_aid.change_diff import changed_fields
from bunking.financial_aid.change_log import AidOperationResult, AidWrite, AidWriteConflictError
from bunking.financial_aid.decisions import PricedRequest
from bunking.financial_aid.money import ZERO
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


def _left_to_tick(
    priced: Sequence[PricedRequest],
    ledger: SeasonLedger,
    ticked: Collection[tuple[str, int]],
    undone: Collection[tuple[str, int]],
) -> list[LeftToTickOut]:
    """Each placed request's first round still waiting for a tick, and why the placement left it."""
    out: list[LeftToTickOut] = []
    for request in priced:
        held = live_net(ledger.lines(request.request_id))
        locked = locked_total(request)
        for view in sorted(request.rounds, key=lambda v: v.round):
            key = (request.request_id, view.round)
            if key in ticked:
                locked += view.decided or ZERO
                continue
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


def _ticked_out(outcome: Outcome) -> list[TickedOut]:
    return [TickedOut(request_id=t.request_id, round=t.round, amount=money(t.amount)) for t in outcome.ticks]


def _left_out(outcome: Outcome, season: Season) -> list[LeftToTickOut]:
    ticked = {(t.request_id, t.round) for t in outcome.ticks}
    return _left_to_tick(outcome.priced, outcome.ledger, ticked, season.undone)


def _suggested(
    item: ToPlaceItem, suggestion: Suggestion
) -> tuple[dict[int, Placement], dict[int, tuple[SplitPart, ...]]]:
    """A suggestion as the placement (one part) or split (several) confirming it would write."""
    txn = item.line.transaction_cm_id
    by_id = {c.request_id: c for c in item.candidates}
    if len(suggestion.parts) == 1:
        return {txn: by_id[suggestion.parts[0].request_id].placement(txn)}, {}
    return {}, {txn: tuple(by_id[p.request_id].part(p.amount) for p in suggestion.parts)}


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

        def suggestion_out(item: ToPlaceItem) -> SuggestionOut | None:
            if item.suggestion is None:
                return None
            placements, splits = _suggested(item, item.suggestion)
            targets = [p.request_id for p in item.suggestion.parts]
            outcome = placement_outcome(season, placements, splits, targets, today=today)
            return SuggestionOut(
                parts=[PartOut(request_id=p.request_id, amount=money(p.amount)) for p in item.suggestion.parts],
                evidence=[EvidenceOut(kind=e.kind, text=e.text) for e in item.suggestion.evidence],
                would_tick=_ticked_out(outcome),
                would_leave=_left_out(outcome, season),
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
            still_due=money(c.still_due),
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
            raise DecisionRefusedError(f"the parts add up to {dollars(total)}; the line is {dollars(item.line.amount)}")
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

    async def place_lines(self, year: int, body: PlaceLinesIn, actor: str) -> PlaceOut:
        """Confirm or Split one line, or confirm a whole class of them (D16), all or nothing: each line's
        override, the Posted ticks the placed money makes, and the end of any Leave at family level on those
        lines, as ONE operation (D12, D81)."""
        if skipped := _gate(year):
            raise DecisionRefusedError(skipped)
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
        for row in body.lines:
            txn = row.transaction_cm_id
            try:
                item = self._pool_item(season, txn, pool)
                placement, split, write = self._staged(
                    year, item, overrides.get(txn), details.get(txn), row, body.note, actor
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
        targets = [p.request_id for row in body.lines for p in row.parts]
        outcome = placement_outcome(season, whole, splits, targets, today=self._today())
        for row in body.lines:
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
                    problems.append(
                        f"line {row.transaction_cm_id}: it would not land on {part.request_id} (its camper has "
                        "another request and this one's session is not known yet): resolve the request's session "
                        "first"
                    )
        if problems:
            raise DecisionRefusedError("; ".join(problems))
        locking = sum((t.amount for t in outcome.ticks), ZERO)
        if body.expected_locked is not None and locking != body.expected_locked:
            raise DecisionRefusedError(
                f"this now locks {dollars(locking)}, not the {dollars(Decimal(body.expected_locked))} you confirmed: "
                "reload To place and check it again"
            )
        posts: list[AidWrite] = []
        locks: list[AidWrite] = []
        not_locked: list[str] = []
        if outcome.ticks:
            posts, locks, sections = await self._decisions.tick_writes(
                season,
                outcome.ticks,
                actor,
                lock_source="placement",
                note=lambda tick: (
                    f"Ticked by placing family-level money: CampMinder shows {dollars(tick.in_campminder)} "
                    "on this request"
                ),
            )
            not_locked = list(sections)
        try:
            result = await self._commit([*writes, *posts, *locks], actor=actor, reason=body.note or None)
        except BatchLimitError as exc:
            raise DecisionRefusedError(
                f"{len(body.lines)} lines are too many to place at once; place them in smaller groups"
            ) from exc
        return PlaceOut(
            year=year,
            operation_id=result.operation_id,
            placed=[row.transaction_cm_id for row in body.lines],
            ticked=_ticked_out(outcome),
            left_to_tick=_left_out(outcome, season),
            sections_not_locked=not_locked,
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
        season, details, overrides, sources = await asyncio.gather(
            self._decisions.season(year),
            self._store.fetch_line_details(year),
            self._store.fetch_override_rows(year),
            self._store.fetch_source_rows(),
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
        result = await self._commit([write], actor=actor, reason=body.reason, require_reason=True)
        return ToPlaceWriteOut(
            year=year, transaction_cm_id=transaction_cm_id, written=1, operation_id=result.operation_id
        )
