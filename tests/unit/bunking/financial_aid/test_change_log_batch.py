"""bunking.financial_aid.change_log.commit_aid_writes -- a write and its log row, together.

Spec §14.4: "A write and its log row commit together through PocketBase's
batch API", and the rows of one staff action share an operation_id.
Fictional data only; ids are the tests/CLAUDE.md generic range.
"""

import json
import re
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest

from bunking.financial_aid.change_log import (
    AidOperationPartiallyCommittedError,
    AidWrite,
    commit_aid_writes,
    new_operation_id,
    new_record_id,
    record_change,
)
from bunking.pocketbase_batch import MAX_BATCH_REQUESTS, BatchLimitError, BatchRequestFailedError, BatchTransportError

REPO_ROOT = Path(__file__).resolve().parents[4]
MIGRATIONS = REPO_ROOT / "pocketbase" / "pb_migrations"
PB_ID = re.compile(r"[a-z0-9]{15}")
ACTOR = "finance-lead@example.com"
DECISION_ID = "decision0000001"


class FakePocketBase:
    """Answers /api/batch like PocketBase: each batch is one transaction.

    ``fail_batch`` makes that batch (0-based) fail on its sub-request
    ``fail_index``; nothing in a failed batch is kept in ``committed``.
    """

    def __init__(self, fail_batch: int | None = None, fail_index: int = 0) -> None:
        self.base_url = "http://pocketbase.test:8090"
        self.auth_store = SimpleNamespace(token="superuser-token")
        self.batches: list[list[dict[str, Any]]] = []
        self.committed: list[dict[str, Any]] = []

        def handle(request: httpx.Request) -> httpx.Response:
            items: list[dict[str, Any]] = json.loads(request.content)["requests"]
            number = len(self.batches)
            self.batches.append(items)
            if number == fail_batch:
                return httpx.Response(
                    400,
                    json={
                        "data": {
                            "requests": {
                                str(fail_index): {
                                    "code": "batch_request_failed",
                                    "message": "Batch request failed.",
                                    "response": {
                                        "data": {
                                            "stage": {"code": "validation_required", "message": "Cannot be blank."}
                                        },
                                        "message": "Failed to create record.",
                                        "status": 400,
                                    },
                                }
                            }
                        },
                        "message": "Batch transaction failed.",
                        "status": 400,
                    },
                )
            self.committed.extend(items)
            results = [
                {"status": 204, "body": None}
                if item["method"] == "DELETE"
                else {"status": 200, "body": {**item.get("body", {}), "id": item.get("body", {}).get("id", "x")}}
                for item in items
            ]
            return httpx.Response(200, json=results)

        self.http_client = httpx.Client(base_url=self.base_url, transport=httpx.MockTransport(handle))

    @property
    def sent(self) -> list[dict[str, Any]]:
        return [item for batch in self.batches for item in batch]


def _create(**overrides: Any) -> AidWrite:
    fields: dict[str, Any] = {
        "collection": "aid_decisions",
        "action": "create",
        "year": 2027,
        "data": {"request_id": "request00000001", "stage": "offered", "amount": Decimal("1250.50")},
    }
    fields.update(overrides)
    return AidWrite(**fields)


def _update(**overrides: Any) -> AidWrite:
    fields: dict[str, Any] = {
        "collection": "aid_decisions",
        "action": "update",
        "year": 2027,
        "record_id": DECISION_ID,
        "before": {"stage": "offered", "amount": Decimal("1250.50")},
        "data": {"stage": "held"},
    }
    fields.update(overrides)
    return AidWrite(**fields)


def _log_rows(pb: FakePocketBase) -> list[dict[str, Any]]:
    return [item["body"] for item in pb.sent if item["url"] == "/api/collections/aid_change_log/records"]


# --- ids -------------------------------------------------------------------------


def test_new_ids_are_pocketbase_shaped_and_distinct() -> None:
    """PocketBase accepts a client-supplied id only if it is 15 chars of [a-z0-9]
    (verified on v0.40.4; rbac/batch_booted_test.go keeps one on the real route)."""
    ids = {new_record_id() for _ in range(2000)} | {new_operation_id() for _ in range(2000)}
    assert len(ids) == 4000
    assert all(PB_ID.fullmatch(i) for i in ids)


# --- one write, one row, one batch ---------------------------------------------


def test_a_create_and_its_log_row_go_in_one_batch_and_the_row_names_the_new_id() -> None:
    pb = FakePocketBase()
    result = commit_aid_writes(pb, [_create()], actor=ACTOR)  # type: ignore[arg-type]
    assert len(pb.batches) == 1
    write, log = pb.batches[0]
    assert write["method"] == "POST"
    assert write["url"] == "/api/collections/aid_decisions/records"
    record_id = write["body"]["id"]
    assert PB_ID.fullmatch(record_id)
    # Money goes to PocketBase as its exact string; PocketBase parses a numeric
    # string into a number field exactly (verified on v0.40.4).
    assert write["body"] == {"id": record_id, "request_id": "request00000001", "stage": "offered", "amount": "1250.50"}
    assert log["method"] == "POST"
    assert log["body"] == {
        "entity": "aid_decisions",
        "entity_id": record_id,
        "year": 2027,
        "action": "create",
        "before": None,
        "after": {"request_id": "request00000001", "stage": "offered", "amount": "1250.50"},
        "actor": ACTOR,
        "reason": "",
        "operation_id": result.operation_id,
        "persona": "",
    }
    assert result.record_ids == (record_id,)
    assert result.records[0] is not None
    assert result.records[0]["id"] == record_id
    assert result.batches == 1


def test_a_supplied_create_id_is_kept() -> None:
    pb = FakePocketBase()
    result = commit_aid_writes(pb, [_create(record_id="grant0000000001")], actor=ACTOR)  # type: ignore[arg-type]
    assert pb.sent[0]["body"]["id"] == "grant0000000001"
    assert result.record_ids == ("grant0000000001",)


def test_an_update_logs_only_the_changed_fields() -> None:
    pb = FakePocketBase()
    commit_aid_writes(pb, [_update()], actor=ACTOR, reason="Family asked to wait")  # type: ignore[arg-type]
    write, log = pb.sent
    assert write == {
        "method": "PATCH",
        "url": f"/api/collections/aid_decisions/records/{DECISION_ID}",
        "body": {"stage": "held"},
    }
    assert log["body"]["before"] == {"stage": "offered"}
    assert log["body"]["after"] == {"stage": "held"}
    assert log["body"]["entity_id"] == DECISION_ID
    assert log["body"]["action"] == "update"
    assert log["body"]["reason"] == "Family asked to wait"


def test_an_explicit_after_and_a_log_action_name_the_business_event() -> None:
    pb = FakePocketBase()
    write = _update(
        log_action="hold",
        entity_id="2027:1000001:1000002",
        after={"stage": "held", "amount": Decimal("1250.5")},
    )
    commit_aid_writes(pb, [write], actor=ACTOR, reason="Balance outstanding")  # type: ignore[arg-type]
    log = _log_rows(pb)[0]
    assert log["action"] == "hold"
    assert log["entity_id"] == "2027:1000001:1000002"
    # Decimal("1250.5") equals Decimal("1250.50"): not a change.
    assert (log["before"], log["after"]) == ({"stage": "offered"}, {"stage": "held"})


def test_a_delete_sends_no_body_and_logs_the_whole_before() -> None:
    pb = FakePocketBase()
    delete = AidWrite(
        collection="aid_decisions",
        action="delete",
        year=2027,
        record_id=DECISION_ID,
        before={"stage": "offered", "decided_on": date(2027, 3, 1)},
    )
    result = commit_aid_writes(pb, [delete], actor=ACTOR)  # type: ignore[arg-type]
    write, log = pb.sent
    assert write == {"method": "DELETE", "url": f"/api/collections/aid_decisions/records/{DECISION_ID}"}
    assert log["body"]["before"] == {"stage": "offered", "decided_on": "2027-03-01"}
    assert log["body"]["after"] is None
    assert result.records == (None,)


def test_every_row_of_an_operation_shares_its_operation_id() -> None:
    pb = FakePocketBase()
    result = commit_aid_writes(pb, [_create(), _create(), _update()], actor=ACTOR)  # type: ignore[arg-type]
    rows = _log_rows(pb)
    assert len(rows) == 3
    assert {row["operation_id"] for row in rows} == {result.operation_id}
    assert PB_ID.fullmatch(result.operation_id)


def test_each_write_is_followed_by_its_own_log_row() -> None:
    pb = FakePocketBase()
    commit_aid_writes(pb, [_create(), _update()], actor=ACTOR)  # type: ignore[arg-type]
    urls = [item["url"] for item in pb.sent]
    assert urls == [
        "/api/collections/aid_decisions/records",
        "/api/collections/aid_change_log/records",
        f"/api/collections/aid_decisions/records/{DECISION_ID}",
        "/api/collections/aid_change_log/records",
    ]
    assert pb.sent[1]["body"]["entity_id"] == pb.sent[0]["body"]["id"]


def test_a_supplied_operation_id_is_used() -> None:
    pb = FakePocketBase()
    result = commit_aid_writes(pb, [_create()], actor=ACTOR, operation_id="round1offers001")  # type: ignore[arg-type]
    assert result.operation_id == "round1offers001"
    assert _log_rows(pb)[0]["operation_id"] == "round1offers001"


def test_a_malformed_operation_id_is_refused() -> None:
    pb = FakePocketBase()
    with pytest.raises(ValueError, match="operation_id"):
        commit_aid_writes(pb, [_create()], actor=ACTOR, operation_id="Round 1")  # type: ignore[arg-type]
    assert pb.batches == []


def test_the_persona_is_recorded_beside_the_real_actor() -> None:
    """Spec §14.4: during "view as", both the real person and the persona are recorded."""
    pb = FakePocketBase()
    commit_aid_writes(pb, [_create()], actor=ACTOR, persona="financial_aid.casework,financial_aid.view")  # type: ignore[arg-type]
    row = _log_rows(pb)[0]
    assert row["actor"] == ACTOR
    assert row["persona"] == "financial_aid.casework,financial_aid.view"


def test_a_writes_own_reason_overrides_the_operations() -> None:
    pb = FakePocketBase()
    commit_aid_writes(pb, [_create(reason="Appeal granted"), _create()], actor=ACTOR, reason="Round 1")  # type: ignore[arg-type]
    assert [row["reason"] for row in _log_rows(pb)] == ["Appeal granted", "Round 1"]


# --- refusing before anything is sent --------------------------------------------


def _refused(writes: list[AidWrite], match: str, exc: type[Exception] = ValueError, **kwargs: Any) -> None:
    pb = FakePocketBase()
    with pytest.raises(exc, match=match):
        commit_aid_writes(pb, writes, **{"actor": ACTOR, **kwargs})  # type: ignore[arg-type]
    assert pb.batches == [], "nothing may be sent when any write in the operation is invalid"


def test_a_required_reason_must_be_given_for_every_write() -> None:
    """Spec §14.4: overrides, holds, releases and exceptions need a reason."""
    _refused([_update(reason="Balance outstanding"), _update(reason="  ")], "reason", require_reason=True)
    pb = FakePocketBase()
    commit_aid_writes(pb, [_update()], actor=ACTOR, reason="Board exception", require_reason=True)  # type: ignore[arg-type]
    assert _log_rows(pb)[0]["reason"] == "Board exception"


def test_the_last_invalid_write_stops_the_whole_operation() -> None:
    _refused([_create(), _create(), _create(year=1999)], "year")


@pytest.mark.parametrize("collection", ["aid_change_log", "persons", "financial_transactions", ""])
def test_only_aid_collections_other_than_the_log_are_written(collection: str) -> None:
    _refused([_create(collection=collection)], "collection")


def test_an_update_needs_a_record_id_and_a_before() -> None:
    _refused([_update(record_id=None)], "record_id")
    _refused([_update(before=None)], "before")


def test_a_delete_carries_no_data_and_no_after() -> None:
    base = {"collection": "aid_decisions", "action": "delete", "year": 2027, "record_id": DECISION_ID}
    _refused([AidWrite(**base, before={"stage": "offered"}, data={"stage": "x"})], "data")  # type: ignore[arg-type]
    _refused([AidWrite(**base, before={"stage": "offered"}, after={"stage": "x"})], "delete")  # type: ignore[arg-type]
    _refused([AidWrite(**base)], "before")  # type: ignore[arg-type]


def test_a_create_has_data_and_no_before() -> None:
    _refused([_create(data=None)], "data")
    _refused([_create(before={"stage": "draft"})], "create")


def test_data_may_not_smuggle_its_own_id() -> None:
    _refused([_create(data={"id": "grant0000000001", "stage": "offered"})], "record_id")


@pytest.mark.parametrize("record_id", ["short", "UPPERCASE000001", "has/slash00001"])
def test_a_malformed_record_id_is_refused(record_id: str) -> None:
    _refused([_create(record_id=record_id)], "record_id")


def test_an_update_that_changes_nothing_is_refused() -> None:
    _refused([_update(data={"stage": "offered"})], "nothing changed")


def test_an_unknown_action_is_refused() -> None:
    _refused([_create(action="upsert")], "action")


def test_an_empty_operation_is_refused() -> None:
    _refused([], "no writes")


def test_blank_actor_is_refused() -> None:
    _refused([_create()], "actor", actor="  ")


# --- size: one atomic batch, or explicit chunking --------------------------------


def test_the_round_1_scale_operation_fits_one_atomic_batch() -> None:
    """ "Make Round 1 offers" is about 500 decisions: 1000 sub-requests."""
    pb = FakePocketBase()
    result = commit_aid_writes(pb, [_create() for _ in range(500)], actor=ACTOR)  # type: ignore[arg-type]
    assert result.batches == 1
    assert len(pb.batches[0]) == 1000


def test_an_operation_over_the_limit_is_refused_unless_chunking_is_allowed() -> None:
    too_many = [_create() for _ in range(MAX_BATCH_REQUESTS // 2 + 1)]
    _refused(too_many, "allow_chunking", exc=BatchLimitError)


def test_chunking_never_separates_a_write_from_its_log_row() -> None:
    pb = FakePocketBase()
    writes = [_create() for _ in range(7)]
    result = commit_aid_writes(pb, writes, actor=ACTOR, allow_chunking=True, max_requests=5)  # type: ignore[arg-type]
    # 5 sub-requests hold two whole pairs; the fifth slot is left empty rather
    # than split a pair across two transactions.
    assert [len(b) for b in pb.batches] == [4, 4, 4, 2]
    for batch in pb.batches:
        for write, log in zip(batch[::2], batch[1::2], strict=True):
            assert write["url"] == "/api/collections/aid_decisions/records"
            assert log["url"] == "/api/collections/aid_change_log/records"
            assert log["body"]["entity_id"] == write["body"]["id"]
    assert result.batches == 4
    assert len(result.record_ids) == 7
    assert {row["operation_id"] for row in _log_rows(pb)} == {result.operation_id}


def test_a_failed_chunk_reports_what_already_committed() -> None:
    pb = FakePocketBase(fail_batch=1, fail_index=3)
    writes = [_create() for _ in range(5)]
    with pytest.raises(AidOperationPartiallyCommittedError) as caught:
        commit_aid_writes(pb, writes, actor=ACTOR, allow_chunking=True, max_requests=4)  # type: ignore[arg-type]
    err = caught.value
    assert err.committed == 2
    assert err.total == 5
    assert len(pb.committed) == 4  # the first chunk's two pairs
    assert err.operation_id == pb.committed[1]["body"]["operation_id"]
    assert isinstance(err.__cause__, BatchRequestFailedError)
    # The failing sub-request is named in the operation's numbering, not the chunk's.
    assert "write 4 of 5" in str(err)
    assert "2 of 5 writes committed" in str(err)


def test_a_lost_connection_on_a_later_chunk_reports_that_chunk_as_in_doubt() -> None:
    """A connection lost mid-chunk leaves that chunk's outcome unknown: the error
    must not claim it was rolled back."""
    calls = {"n": 0}
    pb = FakePocketBase()
    answer = pb.http_client._transport.handle_request

    def flaky(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 2:
            raise httpx.ReadTimeout("timed out")
        response: httpx.Response = answer(request)
        return response

    pb.http_client = httpx.Client(base_url=pb.base_url, transport=httpx.MockTransport(flaky))
    writes = [_create() for _ in range(5)]
    with pytest.raises(AidOperationPartiallyCommittedError) as caught:
        commit_aid_writes(pb, writes, actor=ACTOR, allow_chunking=True, max_requests=4)  # type: ignore[arg-type]
    err = caught.value
    assert err.committed == 2
    assert err.in_doubt == 2  # the second chunk's two writes
    assert err.total == 5
    assert isinstance(err.__cause__, BatchTransportError)
    assert "may or may not" in str(err)


def test_a_rolled_back_chunk_is_not_in_doubt() -> None:
    pb = FakePocketBase(fail_batch=1, fail_index=3)
    with pytest.raises(AidOperationPartiallyCommittedError) as caught:
        commit_aid_writes(pb, [_create() for _ in range(5)], actor=ACTOR, allow_chunking=True, max_requests=4)  # type: ignore[arg-type]
    assert caught.value.in_doubt == 0


def test_a_failed_first_chunk_is_the_plain_batch_error() -> None:
    pb = FakePocketBase(fail_batch=0, fail_index=1)
    with pytest.raises(BatchRequestFailedError):
        commit_aid_writes(pb, [_create(), _create()], actor=ACTOR, allow_chunking=True, max_requests=2)  # type: ignore[arg-type]
    assert pb.committed == []


def test_max_requests_must_hold_a_whole_pair() -> None:
    _refused([_create()], "max_requests", max_requests=1)


# --- the single-row path shares the builder ---------------------------------------


def test_record_change_stores_operation_and_persona() -> None:
    pb = MagicMock()
    record_change(
        pb,
        entity="aid_rules",
        entity_id="rules0000000001",
        year=2027,
        action="approve",
        before={"status": "draft"},
        after={"status": "approved"},
        actor=ACTOR,
        reason="Board minute 4",
        operation_id="rulesapprove001",
        persona="financial_aid.rules",
    )
    body = pb.collection.return_value.create.call_args.args[0]
    assert body["operation_id"] == "rulesapprove001"
    assert body["persona"] == "financial_aid.rules"


def test_record_change_honours_require_reason() -> None:
    pb = MagicMock()
    with pytest.raises(ValueError, match="reason"):
        record_change(
            pb,
            entity="aid_holds",
            entity_id="hold00000000001",
            year=2027,
            action="release",
            before={"held": True},
            after={"held": False},
            actor=ACTOR,
            reason=None,
            require_reason=True,
        )
    pb.collection.assert_not_called()


def test_every_log_key_the_batch_path_writes_is_a_field_of_the_migrations() -> None:
    files = sorted(MIGRATIONS.glob("*_aid_change_log*.js"))
    declared = {name for f in files for name in re.findall(r'name:\s*"([a-z_]+)"', f.read_text())}
    pb = FakePocketBase()
    commit_aid_writes(pb, [_create()], actor=ACTOR, persona="none")  # type: ignore[arg-type]
    assert sorted(set(_log_rows(pb)[0]) - declared) == []


def test_partial_commit_is_not_a_refusal() -> None:
    # FinancialAidError means "understood and refused": routers map it to a 4xx. A half-committed
    # operation is not a refusal, so it must reach the global 500 handler with its message intact.
    from bunking.financial_aid.errors import FinancialAidError

    assert not issubclass(AidOperationPartiallyCommittedError, FinancialAidError)
    assert issubclass(AidOperationPartiallyCommittedError, RuntimeError)
