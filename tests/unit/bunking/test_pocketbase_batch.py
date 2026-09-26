"""bunking.pocketbase_batch -- the raw-HTTP client for PocketBase's /api/batch.

The Python SDK's (pocketbase 0.17.3) BatchService posts a shape the server
rejects (kindred#2865), so this helper posts {"requests": [...]} itself through
the SDK's own httpx client. The server responses below are verbatim shapes
captured from PocketBase v0.40.4 with this repo's migrations applied.
"""

import json
import re
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from bunking.pocketbase_batch import (
    BATCH_TIMEOUT_SECONDS,
    MAX_BATCH_REQUESTS,
    BatchError,
    BatchLimitError,
    BatchRequest,
    BatchRequestFailedError,
    BatchResult,
    BatchTransportError,
    send_batch,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
BATCH_MIGRATION = REPO_ROOT / "pocketbase" / "pb_migrations" / "1500000195_batch_settings.js"

TOKEN = "superuser-token"


class FakePocketBase:
    """The three SDK attributes the helper uses: base_url, auth_store.token, http_client."""

    def __init__(self, handler: Any, base_url: str = "http://pocketbase.test:8090") -> None:
        self.base_url = base_url
        self.auth_store = SimpleNamespace(token=TOKEN)
        self.sent: list[httpx.Request] = []

        def record(request: httpx.Request) -> httpx.Response:
            self.sent.append(request)
            response: httpx.Response = handler(request)
            return response

        self.http_client = httpx.Client(base_url=base_url, transport=httpx.MockTransport(record))


def _ok(request: httpx.Request) -> httpx.Response:
    items = json.loads(request.content)["requests"]
    return httpx.Response(200, json=[{"status": 200, "body": {"id": f"rec{i:012d}"}} for i in range(len(items))])


def _sub_failure(index: int, response: dict[str, Any]) -> dict[str, Any]:
    return {
        "data": {
            "requests": {
                str(index): {"code": "batch_request_failed", "message": "Batch request failed.", "response": response}
            }
        },
        "message": "Batch transaction failed.",
        "status": 400,
    }


# --- BatchRequest -----------------------------------------------------------


def test_request_builders_address_the_record_routes() -> None:
    assert BatchRequest.create("aid_decisions", {"stage": "offered"}) == BatchRequest(
        "POST", "/api/collections/aid_decisions/records", {"stage": "offered"}
    )
    assert BatchRequest.update("aid_decisions", "abc123def456ghi", {"stage": "held"}) == BatchRequest(
        "PATCH", "/api/collections/aid_decisions/records/abc123def456ghi", {"stage": "held"}
    )
    assert BatchRequest.delete("aid_decisions", "abc123def456ghi") == BatchRequest(
        "DELETE", "/api/collections/aid_decisions/records/abc123def456ghi", None
    )


@pytest.mark.parametrize("collection", ["", "aid decisions", "aid_decisions/../users", "aid_decisions?x=1"])
def test_a_collection_name_that_would_change_the_route_is_refused(collection: str) -> None:
    with pytest.raises(ValueError, match="collection"):
        BatchRequest.create(collection, {})


@pytest.mark.parametrize("record_id", ["", "abc/def", "abc?expand=x", "../users"])
def test_a_record_id_that_would_change_the_route_is_refused(record_id: str) -> None:
    with pytest.raises(ValueError, match="record id"):
        BatchRequest.update("aid_decisions", record_id, {})
    with pytest.raises(ValueError, match="record id"):
        BatchRequest.delete("aid_decisions", record_id)


# --- send_batch: the wire format ----------------------------------------------


def test_posts_the_requests_as_plain_json_with_the_superuser_token() -> None:
    pb = FakePocketBase(_ok)
    send_batch(
        pb,  # type: ignore[arg-type]
        [
            BatchRequest.create("aid_decisions", {"id": "abc123def456ghi", "stage": "offered"}),
            BatchRequest.delete("aid_holds", "zzz123def456ghi"),
        ],
    )
    (request,) = pb.sent
    assert request.method == "POST"
    assert str(request.url) == "http://pocketbase.test:8090/api/batch"
    assert request.headers["Authorization"] == TOKEN
    assert request.headers["Content-Type"] == "application/json"
    # Not the SDK's broken {"@jsonPayload": ...} shape (kindred#2865).
    assert json.loads(request.content) == {
        "requests": [
            {
                "method": "POST",
                "url": "/api/collections/aid_decisions/records",
                "body": {"id": "abc123def456ghi", "stage": "offered"},
            },
            {"method": "DELETE", "url": "/api/collections/aid_holds/records/zzz123def456ghi"},
        ]
    }


def test_a_base_url_with_a_path_prefix_is_respected() -> None:
    pb = FakePocketBase(_ok, base_url="http://proxy.test/pb/")
    send_batch(pb, [BatchRequest.create("aid_decisions", {})])  # type: ignore[arg-type]
    assert str(pb.sent[0].url) == "http://proxy.test/pb/api/batch"


def test_the_client_waits_longer_than_the_server_timeout() -> None:
    """A client that gives up first cannot tell a commit from a rollback."""
    pb = FakePocketBase(_ok)
    send_batch(pb, [BatchRequest.create("aid_decisions", {})])  # type: ignore[arg-type]
    timeout = pb.sent[0].extensions["timeout"]
    assert timeout["read"] > BATCH_TIMEOUT_SECONDS


def test_returns_each_sub_response_in_order() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"status": 200, "body": {"id": "a"}}, {"status": 204, "body": None}])

    results = send_batch(
        FakePocketBase(handler),  # type: ignore[arg-type]
        [BatchRequest.create("aid_decisions", {}), BatchRequest.delete("aid_decisions", "abc123def456ghi")],
    )
    assert results == [BatchResult(status=200, body={"id": "a"}), BatchResult(status=204, body=None)]


def test_an_empty_batch_sends_nothing() -> None:
    pb = FakePocketBase(_ok)
    assert send_batch(pb, []) == []  # type: ignore[arg-type]
    assert pb.sent == []


def test_a_response_count_mismatch_is_an_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"status": 200, "body": {}}])

    with pytest.raises(BatchError, match="2 requests"):
        send_batch(
            FakePocketBase(handler),  # type: ignore[arg-type]
            [BatchRequest.create("aid_decisions", {}), BatchRequest.create("aid_decisions", {})],
        )


def test_a_success_whose_body_cannot_be_read_says_the_batch_committed() -> None:
    """PocketBase answers 2xx only after the transaction commits, so an unreadable
    success is NOT "nothing was committed": it is the unknown-outcome error."""

    def not_json(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>not json</html>")

    def short(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"status": 200, "body": {}}])

    for handler in (not_json, short):
        with pytest.raises(BatchTransportError, match="committed"):
            send_batch(
                FakePocketBase(handler),  # type: ignore[arg-type]
                [BatchRequest.create("aid_decisions", {}), BatchRequest.create("aid_decisions", {})],
            )


# --- send_batch: refusing before sending --------------------------------------


def test_an_over_limit_batch_is_refused_before_anything_is_sent() -> None:
    pb = FakePocketBase(_ok)
    requests = [BatchRequest.create("aid_decisions", {})] * (MAX_BATCH_REQUESTS + 1)
    with pytest.raises(BatchLimitError, match=f"{MAX_BATCH_REQUESTS + 1} requests.*{MAX_BATCH_REQUESTS}"):
        send_batch(pb, requests)  # type: ignore[arg-type]
    assert pb.sent == []


def test_the_limit_can_be_lowered_but_not_raised() -> None:
    pb = FakePocketBase(_ok)
    with pytest.raises(BatchLimitError):
        send_batch(pb, [BatchRequest.create("aid_decisions", {})] * 3, max_requests=2)  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="max_requests"):
        send_batch(pb, [BatchRequest.create("aid_decisions", {})], max_requests=MAX_BATCH_REQUESTS + 1)  # type: ignore[arg-type]
    assert pb.sent == []


def test_a_body_json_cannot_hold_is_refused_before_sending() -> None:
    pb = FakePocketBase(_ok)
    with pytest.raises(TypeError, match="Decimal"):
        send_batch(pb, [BatchRequest.create("aid_decisions", {"amount": Decimal("1.50")})])  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        send_batch(pb, [BatchRequest.create("aid_decisions", {"amount": float("nan")})])  # type: ignore[arg-type]
    assert pb.sent == []


# --- send_batch: reporting a failure ------------------------------------------


def test_a_failing_sub_request_is_named_with_its_reason() -> None:
    body = _sub_failure(
        1,
        {
            "data": {"entity": {"code": "validation_required", "message": "Cannot be blank."}},
            "message": "Failed to create record.",
            "status": 400,
        },
    )
    requests = [
        BatchRequest.create("aid_decisions", {"stage": "offered"}),
        BatchRequest.create("aid_change_log", {"entity": ""}),
        BatchRequest.create("aid_decisions", {"stage": "offered"}),
    ]
    with pytest.raises(BatchRequestFailedError) as caught:
        send_batch(FakePocketBase(lambda _: httpx.Response(400, json=body)), requests)  # type: ignore[arg-type]
    err = caught.value
    assert err.index == 1
    assert err.request == requests[1]
    assert err.status == 400
    assert err.message == "Failed to create record."
    assert err.field_errors == {"entity": "Cannot be blank."}
    text = str(err)
    assert "request 2 of 3" in text
    assert "POST /api/collections/aid_change_log/records" in text
    assert "entity: Cannot be blank." in text
    assert "nothing was committed" in text
    assert isinstance(err, BatchError)


def test_a_missing_record_names_the_404() -> None:
    body = _sub_failure(0, {"data": {}, "message": "The requested resource wasn't found.", "status": 404})
    request = BatchRequest.update("aid_decisions", "nosuchrecord001", {"stage": "held"})
    with pytest.raises(BatchRequestFailedError) as caught:
        send_batch(FakePocketBase(lambda _: httpx.Response(400, json=body)), [request])  # type: ignore[arg-type]
    assert caught.value.status == 404
    assert "request 1 of 1" in str(caught.value)
    assert "wasn't found" in str(caught.value)


def test_batch_disabled_says_so() -> None:
    body = {"data": {}, "message": "Batch requests are not allowed.", "status": 403}
    with pytest.raises(BatchError, match="Batch requests are not allowed") as caught:
        send_batch(
            FakePocketBase(lambda _: httpx.Response(403, json=body)),  # type: ignore[arg-type]
            [BatchRequest.create("aid_decisions", {})],
        )
    assert not isinstance(caught.value, BatchRequestFailedError)
    assert caught.value.status == 403


def test_a_whole_batch_refusal_keeps_the_server_detail() -> None:
    body = {
        "data": {
            "requests": {"code": "validation_length_too_long", "message": "The length must be no more than 2000."}
        },
        "message": "Invalid batch request data.",
        "status": 400,
    }
    with pytest.raises(BatchError, match=r"Invalid batch request data.*no more than 2000"):
        send_batch(
            FakePocketBase(lambda _: httpx.Response(400, json=body)),  # type: ignore[arg-type]
            [BatchRequest.create("aid_decisions", {})],
        )


def test_a_non_json_error_response_is_still_reported() -> None:
    with pytest.raises(BatchError, match=r"502.*Bad Gateway"):
        send_batch(
            FakePocketBase(lambda _: httpx.Response(502, text="<html>Bad Gateway</html>")),  # type: ignore[arg-type]
            [BatchRequest.create("aid_decisions", {})],
        )


def test_a_lost_connection_says_the_outcome_is_unknown() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out")

    with pytest.raises(BatchTransportError, match="may or may not have committed"):
        send_batch(FakePocketBase(handler), [BatchRequest.create("aid_decisions", {})])  # type: ignore[arg-type]


# --- the limits are the migration's -------------------------------------------


def _migration_up() -> str:
    text = BATCH_MIGRATION.read_text()
    return text[text.index("migrate((app) =>") : text.index("}, (app) =>")]


def test_max_batch_requests_is_the_migrations_limit() -> None:
    match = re.search(r"settings\.batch\.maxRequests = (\d+);", _migration_up())
    assert match, "1500000195 no longer sets settings.batch.maxRequests"
    assert int(match.group(1)) == MAX_BATCH_REQUESTS


def test_batch_timeout_is_the_migrations_timeout() -> None:
    match = re.search(r"settings\.batch\.timeout = (\d+);", _migration_up())
    assert match, "1500000195 no longer sets settings.batch.timeout"
    assert int(match.group(1)) == BATCH_TIMEOUT_SECONDS


@pytest.mark.parametrize("caddyfile", ["docker/Caddyfile", "frontend/Caddyfile"])
def test_caddy_does_not_route_the_batch_api_to_pocketbase(caddyfile: str) -> None:
    """A batch's sub-requests pass PocketBase's rules but not Caddy's path gates
    (the _superusers IP allowlist sees only /api/batch). Only Kindred's services,
    on the internal network, may reach it (migration 1500000195)."""
    text = (REPO_ROOT / caddyfile).read_text()
    matchers = [line for line in text.splitlines() if line.strip().startswith("@pocketbase ")]
    assert matchers, f"{caddyfile} has no @pocketbase matcher to check"
    for line in matchers:
        assert "/api/batch" not in line, line
        assert "/api/*" not in line.split("path", 1)[1], line
