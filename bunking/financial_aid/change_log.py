"""Append-only change history for financial aid (campership spec §14.4).

Every staff write to an ``aid_*`` collection records one ``aid_change_log``
row: who (``actor``, the real signed-in person, plus ``persona`` during an admin
"view as"), when, what (``entity``, ``entity_id``, ``action``), from what and to
what (``before``/``after``, holding only the changed fields), why (``reason``),
and which staff action it belongs to (``operation_id``). A business record,
not an access log.

**Writes go through ``commit_aid_writes``** (sub-project 4a). It sends each
record write and its log row in ONE PocketBase batch (``bunking.pocketbase_batch``),
so they commit together or not at all, and every row of the operation shares
one ``operation_id``: "make Round 1 offers" is one operation of hundreds of
rows; a single appeal is an operation of one. A create's record id is generated
here (``new_record_id``) so its log row can name it inside the same batch.

``record_change`` writes a lone row outside a batch. It exists for a change
with no accompanying ``aid_*`` record write; a write and its row must go
through ``commit_aid_writes``, or a failure between the two leaves one without
the other.

Both paths build their rows with ``change_row``. It raises on bad input and
lets any PocketBase error propagate: a change that could not be recorded must
not look recorded.

Synchronous because the PocketBase SDK is. Async FastAPI services call it as
``await asyncio.to_thread(commit_aid_writes, pb, writes, actor=...)``.

Snapshots are stored as JSON. ``Decimal`` becomes its exact string (money is
Decimal throughout the calculator, spec §8), dates and datetimes become ISO
8601, NaN and infinity are refused, keys must be text at every depth, and anything else JSON cannot hold raises
``TypeError`` naming the type. Record write bodies are encoded the same way;
PocketBase parses a numeric string into a number field exactly.
"""

from __future__ import annotations

import json
import re
import secrets
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from bunking.financial_aid.change_diff import changed_fields
from bunking.financial_aid.errors import FinancialAidError
from bunking.pocketbase_batch import (
    MAX_BATCH_REQUESTS,
    BatchLimitError,
    BatchRequest,
    BatchRequestFailedError,
    send_batch,
)
from pocketbase import PocketBase

COLLECTION = "aid_change_log"

_MIN_YEAR = 2000
_MAX_YEAR = 2100

# A PocketBase record id: 15 chars of [a-z0-9]. operation_id has the same
# shape (migration 1500000194 enforces it with a pattern).
_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
_ID_LENGTH = 15
_PB_ID = re.compile(r"^[a-z0-9]{15}$")

_WRITE_ACTIONS = ("create", "update", "delete")


def _new_id() -> str:
    return "".join(secrets.choice(_ID_ALPHABET) for _ in range(_ID_LENGTH))


def new_record_id() -> str:
    """A PocketBase-valid record id, so a create's log row can name it before it exists."""
    return _new_id()


def new_operation_id() -> str:
    """A fresh ``operation_id`` for one staff action."""
    return _new_id()


def _json_default(value: object) -> str:
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError(f"aid_change_log cannot store a non-finite Decimal ({value!s}); refuse the write")
        return str(value)
    if isinstance(value, date):  # datetime is a date subclass
        return value.isoformat()
    raise TypeError(f"aid_change_log cannot store a {type(value).__name__}; convert it before recording")


def _require_string_keys(value: object, label: str) -> None:
    # json.dumps would silently turn 1 into "1", and {1: a, "1": b} into one key.
    if isinstance(value, Mapping):
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError(f"{label} has a {type(key).__name__} key ({key!r}); snapshot keys must be text")
            _require_string_keys(item, label)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _require_string_keys(item, label)


def _snapshot(value: Mapping[str, Any] | None, label: str) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise TypeError(f"{label} must be a dict or None, got {type(value).__name__}")
    _require_string_keys(value, label)
    encoded = json.dumps(dict(value), default=_json_default, allow_nan=False)
    decoded: dict[str, Any] = json.loads(encoded)
    return decoded


def _required_text(value: str, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} is required and must be non-blank text")
    return value.strip()


def _operation_id(value: str | None) -> str:
    if value is None:
        return new_operation_id()
    if not isinstance(value, str) or not _PB_ID.fullmatch(value):
        raise ValueError(f"operation_id {value!r} must be 15 characters of [a-z0-9] (use new_operation_id())")
    return value


def change_row(
    *,
    entity: str,
    entity_id: str,
    year: int,
    action: str,
    before: Mapping[str, Any] | None,
    after: Mapping[str, Any] | None,
    actor: str,
    reason: str | None,
    operation_id: str,
    persona: str | None = None,
    require_reason: bool = False,
) -> dict[str, Any]:
    """Validate one change and return its ``aid_change_log`` body.

    ``before`` and ``after`` may not both be None. A create carries no
    ``before``, a delete no ``after``. When both are given, only the changed
    fields are kept (``change_diff.changed_fields``); a change that changes
    nothing is refused. ``require_reason`` refuses a blank reason (spec §14.4:
    overrides, holds, hold releases and exceptions).
    """
    if isinstance(year, bool) or not isinstance(year, int):
        raise TypeError(f"year must be an int season, got {type(year).__name__}")
    if not _MIN_YEAR <= year <= _MAX_YEAR:
        raise ValueError(f"year {year} is outside {_MIN_YEAR}-{_MAX_YEAR}")
    action = _required_text(action, "action")
    # Encode first: this is what refuses NaN, non-text keys and unknown types.
    full_before = _snapshot(before, "before")
    full_after = _snapshot(after, "after")
    if full_before is None and full_after is None:
        raise ValueError("a change needs a before or an after snapshot")
    if action == "create" and full_before is not None:
        raise ValueError("a create change must not carry a before snapshot")
    if action == "delete" and full_after is not None:
        raise ValueError("a delete change must not carry an after snapshot")
    if full_before is not None and full_after is not None:
        diff_before, diff_after = changed_fields(before, after)
        if not diff_before and not diff_after:
            raise ValueError(f"nothing changed in this {action}: before and after are equal")
        full_before, full_after = _snapshot(diff_before, "before"), _snapshot(diff_after, "after")
    reason_text = (reason or "").strip()
    if require_reason and not reason_text:
        raise ValueError(f"a reason is required for this {action}")
    return {
        "entity": _required_text(entity, "entity"),
        "entity_id": _required_text(entity_id, "entity_id"),
        "year": year,
        "action": action,
        "before": full_before,
        "after": full_after,
        "actor": _required_text(actor, "actor"),
        "reason": reason_text,
        "operation_id": _operation_id(operation_id),
        "persona": (persona or "").strip(),
    }


def record_change(
    pb: PocketBase,
    *,
    entity: str,
    entity_id: str,
    year: int,
    action: str,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    actor: str,
    reason: str | None,
    operation_id: str | None = None,
    persona: str | None = None,
    require_reason: bool = False,
) -> None:
    """Append one row to ``aid_change_log``, outside any batch.

    Only for a change with no accompanying ``aid_*`` record write. A record
    write and its row go through ``commit_aid_writes`` so they commit together.

    ``entity`` names the collection or concept changed (for example
    ``"aid_decisions"``); ``entity_id`` its key as text; ``year`` the season;
    ``action`` a short verb (``"create"``, ``"update"``, ``"delete"``,
    ``"approve"``...); ``actor`` the staff user's email; ``persona`` the "view
    as" persona, if one applied. ``operation_id`` defaults to a new operation
    of one. Snapshot rules: see ``change_row``.
    """
    body = change_row(
        entity=entity,
        entity_id=entity_id,
        year=year,
        action=action,
        before=before,
        after=after,
        actor=actor,
        reason=reason,
        operation_id=_operation_id(operation_id),
        persona=persona,
        require_reason=require_reason,
    )
    pb.collection(COLLECTION).create(body)


@dataclass(frozen=True)
class AidWrite:
    """One record write to an ``aid_*`` collection, and what its log row says.

    - ``create``: ``data`` is the new record (without ``id``). ``record_id`` is
      generated unless given. The log's ``after`` defaults to ``data``.
    - ``update``: ``record_id``, ``before`` (the record as it was) and ``data``
      (the fields to set) are required. The log's ``after`` defaults to
      ``before`` with ``data`` applied, and only changed fields are logged.
    - ``delete``: ``record_id`` and ``before`` are required; no ``data``, no ``after``.

    ``log_action`` names the business event when it is more than the write
    ("approve", "hold", "release"); ``entity_id`` overrides the logged key (for
    example a composite "2027:1000001:1000002"; default: the record id);
    ``reason`` overrides the operation's reason for this write.
    """

    collection: str
    action: str
    year: int
    data: Mapping[str, Any] | None = None
    record_id: str | None = None
    before: Mapping[str, Any] | None = None
    after: Mapping[str, Any] | None = None
    reason: str | None = None
    log_action: str | None = None
    entity_id: str | None = None


@dataclass(frozen=True)
class AidOperationResult:
    """What ``commit_aid_writes`` committed.

    ``record_ids`` and ``records`` follow the order of the writes; ``records``
    holds PocketBase's response body for each write (None for a delete).
    ``batches`` is how many transactions it took (1 unless chunking was allowed).
    """

    operation_id: str
    record_ids: tuple[str, ...]
    records: tuple[dict[str, Any] | None, ...]
    batches: int


class AidOperationPartiallyCommittedError(FinancialAidError):
    """A chunked operation failed after its earlier chunks committed.

    ``committed`` of ``total`` writes (the first ``committed``, in order) are in
    the database with their log rows, all under ``operation_id``; nothing from
    the failing chunk onward is. The cause is the chunk's ``BatchError``.
    """

    def __init__(self, *, operation_id: str, committed: int, total: int, detail: str) -> None:
        self.operation_id = operation_id
        self.committed = committed
        self.total = total
        super().__init__(
            f"operation {operation_id}: {committed} of {total} writes committed before a later chunk failed "
            f"({detail}); the committed writes and their log rows stand"
        )


def _check_collection(collection: str) -> str:
    if not isinstance(collection, str) or not collection.startswith("aid_") or collection == COLLECTION:
        raise ValueError(f"collection {collection!r} is not a financial-aid collection this helper writes")
    return collection


def _write_body(data: Mapping[str, Any], label: str) -> dict[str, Any]:
    return _snapshot(data, label) or {}


def _pair(
    write: AidWrite, *, actor: str, persona: str | None, operation_id: str, reason: str | None, require_reason: bool
) -> tuple[str, BatchRequest, BatchRequest]:
    """Validate one write and build (record_id, write request, log request)."""
    collection = _check_collection(write.collection)
    if write.action not in _WRITE_ACTIONS:
        raise ValueError(f"action {write.action!r} must be one of {', '.join(_WRITE_ACTIONS)}")
    if write.record_id is not None and not (isinstance(write.record_id, str) and _PB_ID.fullmatch(write.record_id)):
        raise ValueError(f"record_id {write.record_id!r} must be 15 characters of [a-z0-9] (use new_record_id())")
    if write.data is not None and "id" in write.data:
        raise ValueError("data must not carry an id; pass it as record_id")

    after: Mapping[str, Any] | None
    if write.action == "create":
        if write.data is None:
            raise ValueError("a create needs data")
        if write.before is not None:
            raise ValueError("a create must not carry a before snapshot")
        record_id = write.record_id or new_record_id()
        request = BatchRequest.create(collection, {"id": record_id, **_write_body(write.data, "data")})
        after = write.after if write.after is not None else write.data
    else:
        if write.record_id is None:
            raise ValueError(f"an {write.action} needs a record_id")
        if write.before is None:
            raise ValueError(f"an {write.action} needs a before snapshot")
        record_id = write.record_id
        if write.action == "update":
            if write.data is None:
                raise ValueError("an update needs data")
            request = BatchRequest.update(collection, record_id, _write_body(write.data, "data"))
            after = write.after if write.after is not None else {**write.before, **write.data}
        else:
            if write.data is not None:
                raise ValueError("a delete carries no data")
            if write.after is not None:
                raise ValueError("a delete must not carry an after snapshot")
            request = BatchRequest.delete(collection, record_id)
            after = None

    row = change_row(
        entity=collection,
        entity_id=write.entity_id if write.entity_id is not None else record_id,
        year=write.year,
        action=write.log_action if write.log_action is not None else write.action,
        before=write.before,
        after=after,
        actor=actor,
        reason=write.reason if write.reason is not None else reason,
        operation_id=operation_id,
        persona=persona,
        require_reason=require_reason,
    )
    return record_id, request, BatchRequest.create(COLLECTION, row)


def commit_aid_writes(
    pb: PocketBase,
    writes: Sequence[AidWrite],
    *,
    actor: str,
    persona: str | None = None,
    operation_id: str | None = None,
    reason: str | None = None,
    require_reason: bool = False,
    allow_chunking: bool = False,
    max_requests: int = MAX_BATCH_REQUESTS,
) -> AidOperationResult:
    """Commit ``writes`` and one ``aid_change_log`` row each, as one operation.

    Every write is validated and every row built before anything is sent, so
    an invalid write anywhere refuses the whole operation with nothing written.
    Each write is followed by its own log row in the batch; the batch is one
    transaction, so a failure anywhere rolls back every write and row
    (``BatchRequestFailedError`` names the sub-request and why).

    ``actor`` is the real signed-in person (``AuthUser.email``); ``persona`` the
    "view as" persona (``AuthUser.view_as``), recorded beside it. ``reason`` is
    the operation's default reason; ``require_reason`` refuses any write left
    without one.

    **Size.** An operation of N writes is 2N sub-requests. Up to
    ``max_requests`` (default: the server's limit, 2000, so about 1000 writes)
    it is ONE atomic batch. Over it, the operation is refused with
    ``BatchLimitError`` unless ``allow_chunking=True``: then it is sent as
    consecutive batches that never split a write from its log row. Each chunk is
    atomic; the operation as a whole is not. If a later chunk fails,
    ``AidOperationPartiallyCommittedError`` reports how many writes committed,
    and the ``operation_id`` ties the committed chunks together. Allow chunking
    only for an operation that is safe to leave part-done and re-run.
    """
    if not 2 <= max_requests <= MAX_BATCH_REQUESTS:
        raise ValueError(f"max_requests must be 2-{MAX_BATCH_REQUESTS} to hold a write and its log row")
    if not writes:
        raise ValueError("an operation needs at least one write; there are no writes")
    actor = _required_text(actor, "actor")
    op_id = _operation_id(operation_id)
    pairs = [
        _pair(w, actor=actor, persona=persona, operation_id=op_id, reason=reason, require_reason=require_reason)
        for w in writes
    ]

    per_batch = max_requests // 2
    if len(pairs) > per_batch and not allow_chunking:
        raise BatchLimitError(
            f"an operation of {len(pairs)} writes needs {2 * len(pairs)} batch requests, over the limit of "
            f"{max_requests}; split it, or pass allow_chunking=True if it is safe to commit in parts"
        )

    record_ids: list[str] = []
    records: list[dict[str, Any] | None] = []
    batches = 0
    for start in range(0, len(pairs), per_batch):
        chunk = pairs[start : start + per_batch]
        requests = [r for _, write_request, log_request in chunk for r in (write_request, log_request)]
        try:
            results = send_batch(pb, requests, max_requests=max_requests)
        except BatchRequestFailedError as exc:
            if start == 0:
                raise
            failed_write = start + exc.index // 2 + 1
            raise AidOperationPartiallyCommittedError(
                operation_id=op_id,
                committed=start,
                total=len(pairs),
                detail=f"write {failed_write} of {len(pairs)}: {exc.message}",
            ) from exc
        except Exception as exc:
            if start == 0:
                raise
            raise AidOperationPartiallyCommittedError(
                operation_id=op_id, committed=start, total=len(pairs), detail=str(exc)
            ) from exc
        batches += 1
        record_ids.extend(record_id for record_id, _, _ in chunk)
        records.extend(result.body if isinstance(result.body, dict) else None for result in results[::2])
    return AidOperationResult(operation_id=op_id, record_ids=tuple(record_ids), records=tuple(records), batches=batches)
