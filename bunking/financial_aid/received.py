"""When a campership request was received, and which requests were received through a date (D129, D138). Pure.

The one definition both reporting controls use: Scenarios' request sets (sub-project 9b) and the Reports "received
through" filter reuse it, so a figure means the same thing on both surfaces.

"Received" is a request's first-recorded moment: its earliest create row in aid_change_log (sub-project 4a logs one
per request, beside change_replay's rows). A request with no create row has no known received date: it is never
guessed. Known limit: a request synced late on deadline day counts by when intake recorded it, not by CampMinder's
submission time, which no request record carries (the runbook runs intake right after the deadline closes). If intake
later stores CampMinder's submitted date, `received_dates` prefers it.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from bunking.financial_aid.change_replay import LogRow


def received_dates(request_ids: Collection[str], log: Sequence[LogRow]) -> dict[str, datetime | None]:
    """Each request's first-recorded moment: the earliest create row `log` (aid_requests' rows) holds for it."""
    first: dict[str, datetime] = {}
    for row in log:
        if row.kind == "create" and (row.entity_id not in first or row.created < first[row.entity_id]):
            first[row.entity_id] = row.created
    return {request_id: first.get(request_id) for request_id in sorted(request_ids)}


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
    for request_id, at in received.items():
        if at is not None and at < cutoff:
            kept.add(request_id)
        elif request_id in live:
            (unknown if at is None else after).add(request_id)
    return RequestSplit(frozenset(kept), frozenset(after), frozenset(unknown))
