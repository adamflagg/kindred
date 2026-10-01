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
from collections.abc import Callable, Collection, Sequence
from datetime import UTC, date, datetime
from typing import Final, Protocol

from api.schemas.financial_aid_to_place import (
    CandidateOut,
    EvidenceOut,
    LeftToTickOut,
    PartOut,
    SuggestionOut,
    TickedOut,
    ToPlaceGroupOut,
    ToPlaceLineOut,
    ToPlaceResponse,
)
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_decisions_service import FIRST_TICKED_SEASON, FinancialAidDecisionsService, Season
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
    REASONS,
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
from bunking.financial_aid.change_log import AidOperationResult, AidWrite
from bunking.financial_aid.decisions import PricedRequest
from bunking.financial_aid.money import ZERO

GROUP_LABELS: Final[dict[Reason, str]] = {
    "several": "Several requests could take this",
    "no_request": "No request behind it",
    "program_mismatch": "The description names a program this camper isn't in",
}


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
