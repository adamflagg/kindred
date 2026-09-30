"""When a campership request was received, and which requests were received through a date (D129, D138). Pure.

The one definition both reporting controls use: Scenarios' request sets (sub-project 9b) and the Reports "received
through" filter reuse it, so a figure means the same thing on both surfaces.

"Received" is a request's first-recorded moment: its earliest create row in aid_change_log (sub-project 4a logs one
per request, beside change_replay's rows). A request with no create row has no known received date: it is never
guessed.

A family that edits its answer keeps the date it first applied (final review 4). Intake's identity is (household,
person, program, normalised option text): an edited answer is a new key, so intake withdraws the old request (never
deleting it) and creates a new one, and records no link between them. The rule is therefore the one intake
guarantees: a request's predecessors (`edit_predecessors`) are the WITHDRAWN requests of the same household, person
and program, and it was received at the earliest create row among it and them. A withdrawn request keeps its own
date. Consequence to know: a camper whose request was withdrawn and who applies again for the same program later
also counts from the first application. Known limit: a request synced late on deadline day counts by when intake recorded it, not by CampMinder's
submission time, which no request record carries (the runbook runs intake right after the deadline closes). If intake
later stores CampMinder's submitted date, `received_dates` should prefer it (not built: it reads only the log).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final, Protocol

from bunking.financial_aid.change_replay import LogRow

WITHDRAWN: Final = "withdrawn"  # intake's STATUS_WITHDRAWN (api.services.financial_aid_intake_types)


class ReceivedRequest(Protocol):
    """What `edit_predecessors` reads of a request (intake's RequestRecord has it)."""

    @property
    def id(self) -> str: ...
    @property
    def household_cm_id(self) -> int: ...
    @property
    def person_cm_id(self) -> int: ...
    @property
    def program_key(self) -> str: ...
    @property
    def status(self) -> str: ...


def edit_predecessors(requests: Iterable[ReceivedRequest]) -> dict[str, frozenset[str]]:
    """Each request's predecessors: the withdrawn requests of the same household, person and program, which an edited
    answer leaves behind. A withdrawn request has none."""
    every = list(requests)
    withdrawn: dict[tuple[int, int, str], set[str]] = defaultdict(set)
    for request in every:
        if request.status == WITHDRAWN:
            withdrawn[(request.household_cm_id, request.person_cm_id, request.program_key)].add(request.id)
    return {
        request.id: frozenset()
        if request.status == WITHDRAWN
        else frozenset(withdrawn.get((request.household_cm_id, request.person_cm_id, request.program_key), ()))
        - {request.id}
        for request in every
    }


def received_dates(
    request_ids: Collection[str],
    log: Sequence[LogRow],
    *,
    predecessors: Mapping[str, Collection[str]] | None = None,
) -> dict[str, datetime | None]:
    """Each request's first-recorded moment: the earliest create row `log` (aid_requests' rows) holds for it or for
    any of its `predecessors` (`edit_predecessors`)."""
    first: dict[str, datetime] = {}
    for row in log:
        if row.kind == "create" and (row.entity_id not in first or row.created < first[row.entity_id]):
            first[row.entity_id] = row.created
    lineage = predecessors or {}
    received: dict[str, datetime | None] = {}
    for request_id in sorted(request_ids):
        known = [first[rid] for rid in (request_id, *lineage.get(request_id, ())) if rid in first]
        received[request_id] = min(known) if known else None
    return received


@dataclass(frozen=True)
class RequestSplit:
    kept: frozenset[str]  # every request received before the cutoff, live or not
    after: frozenset[str]  # live requests received at or after it
    unknown: frozenset[str]  # live requests with no received date: left out too


def split_by_received(received: Mapping[str, datetime | None], cutoff: datetime, live: Collection[str]) -> RequestSplit:
    """Each request by when it was first recorded: before `cutoff` (kept), at or after it, or never recorded. `cutoff`
    is the first instant after the chosen day. What is left out is counted over the `live` requests only."""
    kept: set[str] = set()
    after: set[str] = set()
    unknown: set[str] = set()
    for request_id in received.keys() | set(live):
        at = received.get(request_id)  # a live request the dates never saw is unknown, like one with no create row
        if at is not None and at < cutoff:
            kept.add(request_id)
        elif request_id in live:
            (unknown if at is None else after).add(request_id)
    return RequestSplit(frozenset(kept), frozenset(after), frozenset(unknown))
