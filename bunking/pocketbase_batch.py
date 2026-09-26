"""Send PocketBase batch requests: several record writes in ONE transaction.

``POST /api/batch`` runs its sub-requests in one database transaction: all
commit, or a single failing sub-request rolls every one back. PocketBase's Go
record hooks run inside it (verified on v0.40.4, kindred#2865). Each
sub-request still passes its collection's API rules, as it would alone.

Why this module exists: the Python SDK's (``pocketbase`` 0.17.3)
``BatchService.send()`` posts ``{"@jsonPayload": ...}`` as a JSON body, which
the server answers with ``400 requests: Cannot be blank``, and it passes query
params as headers. This helper posts ``{"requests": [{"method", "url",
"body"}]}`` as plain JSON through the SDK's own httpx client, base URL and auth
token. The fix belongs upstream rather than in a fork (kindred#2865).

Batch is off in a fresh PocketBase. Migration 1500000195 enables it with the
limits pinned below; its tests keep the two in step.

Synchronous, like the SDK. Async callers use ``asyncio.to_thread``.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from pocketbase import PocketBase

# Pinned to pocketbase/pb_migrations/1500000195_batch_settings.js by
# tests/unit/bunking/test_pocketbase_batch.py. Change them together.
MAX_BATCH_REQUESTS = 2000
BATCH_TIMEOUT_SECONDS = 30

# The client waits past the server's own transaction timeout, so a batch the
# server is still committing is never reported as lost.
_CLIENT_TIMEOUT_SECONDS = BATCH_TIMEOUT_SECONDS + 15

# Collection names and record ids go into a URL path: only characters that
# cannot change the route are accepted.
_COLLECTION = re.compile(r"^[A-Za-z0-9_]+$")
_RECORD_ID = re.compile(r"^[A-Za-z0-9_]+$")

Method = Literal["POST", "PATCH", "DELETE"]


@dataclass(frozen=True)
class BatchRequest:
    """One sub-request. Build it with ``create``, ``update`` or ``delete``."""

    method: Method
    url: str
    body: Mapping[str, Any] | None = None

    @staticmethod
    def _records_url(collection: str) -> str:
        if not isinstance(collection, str) or not _COLLECTION.fullmatch(collection):
            raise ValueError(f"collection {collection!r} is not a plain collection name")
        return f"/api/collections/{collection}/records"

    @staticmethod
    def _record_url(collection: str, record_id: str) -> str:
        if not isinstance(record_id, str) or not _RECORD_ID.fullmatch(record_id):
            raise ValueError(f"record id {record_id!r} is not a plain record id")
        return f"{BatchRequest._records_url(collection)}/{record_id}"

    @classmethod
    def create(cls, collection: str, body: Mapping[str, Any]) -> BatchRequest:
        return cls("POST", cls._records_url(collection), body)

    @classmethod
    def update(cls, collection: str, record_id: str, body: Mapping[str, Any]) -> BatchRequest:
        return cls("PATCH", cls._record_url(collection, record_id), body)

    @classmethod
    def delete(cls, collection: str, record_id: str) -> BatchRequest:
        return cls("DELETE", cls._record_url(collection, record_id))

    def to_json(self) -> dict[str, Any]:
        item: dict[str, Any] = {"method": self.method, "url": self.url}
        if self.body is not None:
            item["body"] = dict(self.body)
        return item


@dataclass(frozen=True)
class BatchResult:
    """One sub-request's response: its HTTP status and JSON body (None for a delete)."""

    status: int
    body: Any


class BatchError(Exception):
    """PocketBase refused or failed the batch. Nothing in it was committed.

    ``status`` is the HTTP status of the whole batch response (or of the failing
    sub-request, for ``BatchRequestFailedError``); ``response`` its parsed body.
    """

    def __init__(self, message: str, *, status: int | None = None, response: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.response = response


class BatchLimitError(BatchError, ValueError):
    """The batch holds more requests than PocketBase allows. Refused before sending."""


class BatchTransportError(BatchError):
    """The outcome is unknown: the batch MAY OR MAY NOT have committed.

    The connection failed mid-batch, or PocketBase answered success (sent only
    after the transaction commits) with a body that could not be read.
    """


class BatchRequestFailedError(BatchError):
    """One sub-request failed, so the whole batch rolled back.

    ``index`` is the failing sub-request's 0-based position and ``request`` the
    request itself; ``status``/``message`` are that sub-request's own response;
    ``field_errors`` maps each invalid field to PocketBase's message.
    """

    def __init__(
        self,
        *,
        index: int,
        total: int,
        request: BatchRequest | None,
        status: int | None,
        message: str,
        field_errors: dict[str, str],
        response: Any,
    ) -> None:
        self.index = index
        self.total = total
        self.request = request
        self.message = message
        self.field_errors = field_errors
        target = f"{request.method} {request.url}" if request is not None else "an unknown request"
        detail = "; ".join(f"{name}: {text}" for name, text in field_errors.items())
        text = f"batch request {index + 1} of {total} ({target}) failed with {status}: {message}"
        if detail:
            text += f" [{detail}]"
        text += " -- the batch rolled back; nothing was committed"
        super().__init__(text, status=status, response=response)


def _encode(requests: Sequence[BatchRequest]) -> bytes:
    payload = {"requests": [r.to_json() for r in requests]}
    try:
        return json.dumps(payload, allow_nan=False).encode()
    except TypeError as exc:
        raise TypeError(f"a batch body holds a value JSON cannot encode: {exc}; convert it before sending") from exc


def _field_errors(data: object) -> dict[str, str]:
    if not isinstance(data, Mapping):
        return {}
    out: dict[str, str] = {}
    for name, err in data.items():
        if isinstance(err, Mapping):
            out[str(name)] = str(err.get("message", err.get("code", err)))
        else:
            out[str(name)] = str(err)
    return out


def _raise_for_failure(response: httpx.Response, requests: Sequence[BatchRequest]) -> None:
    try:
        body: Any = response.json()
    except ValueError:
        snippet = response.text[:200]
        raise BatchError(
            f"PocketBase answered the batch with {response.status_code}: {snippet}",
            status=response.status_code,
            response=snippet,
        ) from None
    message = body.get("message", "") if isinstance(body, Mapping) else ""
    data = body.get("data") if isinstance(body, Mapping) else None
    failed = data.get("requests") if isinstance(data, Mapping) else None
    # A sub-request failure is keyed by its index: {"requests": {"1": {...}}}.
    if isinstance(failed, Mapping) and failed and all(str(k).isdigit() for k in failed):
        key = min(failed, key=lambda k: int(k))
        index = int(key)
        item: Mapping[str, Any] = failed[key] if isinstance(failed[key], Mapping) else {}
        raw_sub = item.get("response")
        sub: Mapping[str, Any] = raw_sub if isinstance(raw_sub, Mapping) else {}
        raise BatchRequestFailedError(
            index=index,
            total=len(requests),
            request=requests[index] if 0 <= index < len(requests) else None,
            status=sub.get("status"),
            message=str(sub.get("message") or item.get("message") or message),
            field_errors=_field_errors(sub.get("data")),
            response=body,
        )
    detail = "; ".join(f"{k}: {v}" for k, v in _field_errors(data).items())
    text = f"PocketBase refused the batch with {response.status_code}: {message or 'no message'}"
    if detail:
        text += f" [{detail}]"
    raise BatchError(text, status=response.status_code, response=body)


def send_batch(
    pb: PocketBase, requests: Sequence[BatchRequest], *, max_requests: int = MAX_BATCH_REQUESTS
) -> list[BatchResult]:
    """Run ``requests`` as one transaction and return each sub-response in order.

    Raises before sending: ``BatchLimitError`` over ``max_requests`` (which may
    be lowered, never raised past the server's limit), ``TypeError``/``ValueError``
    for a body JSON cannot hold (convert Decimal and dates first; NaN is refused).
    Raises after sending: ``BatchRequestFailedError`` naming the sub-request that
    failed and why; ``BatchError`` for a refusal of the whole batch (batch
    disabled, auth, malformed); ``BatchTransportError`` when the outcome is
    unknown (the connection failed, or a success answer could not be read). In
    every ``BatchError`` case except the last, nothing was committed.

    An empty sequence sends nothing and returns ``[]``.
    """
    if not 1 <= max_requests <= MAX_BATCH_REQUESTS:
        raise ValueError(f"max_requests must be 1-{MAX_BATCH_REQUESTS} (the server's limit), got {max_requests}")
    if not requests:
        return []
    if len(requests) > max_requests:
        raise BatchLimitError(
            f"a batch of {len(requests)} requests is over the limit of {max_requests}; "
            "PocketBase would refuse it whole, so nothing was sent"
        )
    content = _encode(requests)
    url = str(pb.base_url).rstrip("/") + "/api/batch"
    headers = {"Content-Type": "application/json"}
    if pb.auth_store.token:
        headers["Authorization"] = pb.auth_store.token
    try:
        response = pb.http_client.request(
            "POST", url, content=content, headers=headers, timeout=_CLIENT_TIMEOUT_SECONDS
        )
    except httpx.HTTPError as exc:
        raise BatchTransportError(
            f"the batch of {len(requests)} requests failed in transit ({type(exc).__name__}: {exc}); "
            "it may or may not have committed -- check before retrying"
        ) from exc
    if response.status_code >= 400:
        _raise_for_failure(response, requests)
    try:
        results: Any = response.json()
    except ValueError:
        results = response.text[:200]
    if not isinstance(results, list) or len(results) != len(requests):
        count = len(results) if isinstance(results, list) else "no list of"
        # A success status is sent only after the commit: this is not "nothing was committed".
        raise BatchTransportError(
            f"PocketBase answered {response.status_code} with {count} results for {len(requests)} requests; "
            "the batch most likely committed -- check before retrying",
            status=response.status_code,
            response=results,
        )
    return [BatchResult(status=int(r.get("status", 0)), body=r.get("body")) for r in results]
