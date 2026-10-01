"""commit_aid_writes -- write only if unchanged (campership G6).

A write that names the revision it read is sent with If-Match, and pocketbase/aidguard refuses it inside the
batch transaction when the record moved on: nothing in the operation is written, and the helper raises
AidWriteConflictError (a FinancialAidError, so routers answer 409). Fictional data only.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from bunking.financial_aid.change_log import (
    CONFLICT_MESSAGE,
    REVISIONED_COLLECTIONS,
    AidGuard,
    AidOperationPartiallyCommittedError,
    AidWrite,
    AidWriteConflictError,
    commit_aid_writes,
    if_match_values,
)
from bunking.financial_aid.errors import FinancialAidError
from bunking.pocketbase_batch import BatchRequestFailedError

REPO_ROOT = Path(__file__).resolve().parents[4]
ACTOR = "finance-lead@example.com"
RULES_A = "rulesaaaaaaaaa1"
RULES_B = "rulesbbbbbbbbb1"
SOURCE = "sourceaaaaaaaa1"


class RevisionedPocketBase:
    """Answers /api/batch as pocketbase/aidguard does: every PATCH of a known record must match its revision
    when it carries If-Match, and moves it on by one either way. One transaction per batch: a failed check
    anywhere leaves every revision as it was and commits nothing."""

    def __init__(self, revisions: dict[str, int]) -> None:
        self.base_url = "http://pocketbase.test:8090"
        self.auth_store = SimpleNamespace(token="superuser-token")
        self.revisions = dict(revisions)
        self.batches: list[list[dict[str, Any]]] = []
        self.committed: list[dict[str, Any]] = []

        def handle(request: httpx.Request) -> httpx.Response:
            items: list[dict[str, Any]] = json.loads(request.content)["requests"]
            self.batches.append(items)
            staged = dict(self.revisions)
            for index, item in enumerate(items):
                record_id = item["url"].rstrip("/").split("/")[-1]
                if item["method"] != "PATCH" or record_id not in staged:
                    continue
                wanted = (item.get("headers") or {}).get("If-Match")
                if wanted is not None and wanted != f'"{staged[record_id]}"':
                    return httpx.Response(400, json=_refusal(index))
                staged[record_id] += 1
            self.revisions = staged
            self.committed.extend(items)
            return httpx.Response(
                200,
                json=[{"status": 200, "body": {**(item.get("body") or {}), "n": i}} for i, item in enumerate(items)],
            )

        self.http_client = httpx.Client(base_url=self.base_url, transport=httpx.MockTransport(handle))


def _refusal(index: int) -> dict[str, Any]:
    return {
        "data": {
            "requests": {
                str(index): {
                    "code": "batch_request_failed",
                    "message": "Batch request failed.",
                    "response": {"data": {}, "message": "the record changed since it was read", "status": 412},
                }
            }
        },
        "message": "Batch transaction failed.",
        "status": 400,
    }


def _status(record_id: str, section: str, revision: int | None) -> AidWrite:
    return AidWrite(
        collection="aid_rules",
        action="update",
        year=2031,
        record_id=record_id,
        before={"section_status": {section: "draft"}},
        data={"section_status": {section: "approved"}},
        expected_revision=revision,
    )


def _headers(items: list[dict[str, Any]]) -> list[str | None]:
    return [(item.get("headers") or {}).get("If-Match") for item in items]


def test_aid_rules_is_revisioned() -> None:
    assert frozenset({"aid_rules"}) == REVISIONED_COLLECTIONS


def test_the_revisioned_set_matches_the_go_guard_and_the_migration() -> None:
    """Python requires a revision where Go checks one and the migration stores one: a collection in only one
    of the three is either never guarded or refused on every write."""
    guard = (REPO_ROOT / "pocketbase" / "aidguard" / "guard.go").read_text()
    listed = re.search(r"var Collections = \[\]string\{([^}]*)\}", guard)
    assert listed is not None
    assert set(re.findall(r'"([a-z_]+)"', listed.group(1))) == set(REVISIONED_COLLECTIONS)
    [migration] = sorted((REPO_ROOT / "pocketbase" / "pb_migrations").glob("*_aid_rules_revision.js"))
    up = migration.read_text().split("}, (app) => {")[0]
    assert set(re.findall(r'findCollectionByNameOrId\("([a-z_]+)"\)', up)) == set(REVISIONED_COLLECTIONS)


def test_an_aid_rules_update_without_the_revision_it_read_is_refused_before_anything_is_sent() -> None:
    pb = RevisionedPocketBase({RULES_A: 0})
    with pytest.raises(ValueError, match="must carry the revision it read"):
        commit_aid_writes(pb, [_status(RULES_A, "income", None)], actor=ACTOR)  # type: ignore[arg-type]
    assert pb.batches == []


def test_a_create_carrying_a_revision_is_refused() -> None:
    write = AidWrite(collection="aid_rules", action="create", year=2031, data={"year": 2031}, expected_revision=0)
    with pytest.raises(ValueError, match="a create has no revision"):
        if_match_values([write])


def test_two_read_revisions_for_one_record_are_refused() -> None:
    with pytest.raises(ValueError, match="two revisions"):
        if_match_values([_status(RULES_A, "income", 2), _status(RULES_A, "tiers", 3)])


def test_the_kth_save_of_a_record_expects_the_read_revision_plus_k() -> None:
    pb = RevisionedPocketBase({RULES_A: 4, RULES_B: 9})
    writes = [_status(RULES_A, "income", 4), _status(RULES_B, "income", 9), _status(RULES_A, "tiers", 4)]
    commit_aid_writes(pb, writes, actor=ACTOR)  # type: ignore[arg-type]
    [batch] = pb.batches
    assert _headers(batch) == ['"4"', None, '"9"', None, '"5"', None]  # each write, then its log row
    assert pb.revisions == {RULES_A: 6, RULES_B: 10}


def test_a_collection_outside_the_set_may_still_write_unguarded() -> None:
    pb = RevisionedPocketBase({})
    write = AidWrite(
        collection="aid_sources",
        action="update",
        year=2031,
        record_id=SOURCE,
        before={"note": ""},
        data={"note": "checked"},
    )
    commit_aid_writes(pb, [write], actor=ACTOR)  # type: ignore[arg-type]
    assert _headers(pb.batches[0]) == [None, None]


def test_a_stale_write_writes_nothing_and_names_the_record() -> None:
    pb = RevisionedPocketBase({RULES_A: 5})  # someone saved twice since this caller read revision 3
    with pytest.raises(AidWriteConflictError) as raised:
        commit_aid_writes(pb, [_status(RULES_A, "income", 3)], actor=ACTOR)  # type: ignore[arg-type]
    assert (raised.value.collection, raised.value.record_id) == ("aid_rules", RULES_A)
    assert str(raised.value) == CONFLICT_MESSAGE
    assert isinstance(raised.value, FinancialAidError)
    assert isinstance(raised.value.__cause__, BatchRequestFailedError)
    assert (pb.committed, pb.revisions) == ([], {RULES_A: 5})


def test_a_guard_goes_first_as_an_empty_update_with_no_log_row() -> None:
    pb = RevisionedPocketBase({RULES_A: 2})
    create = AidWrite(collection="aid_rules", action="create", year=2031, data={"year": 2031, "version": 2})
    result = commit_aid_writes(
        pb,  # type: ignore[arg-type]
        [create],
        actor=ACTOR,
        guards=[AidGuard(collection="aid_rules", record_id=RULES_A, expected_revision=2)],
    )
    [batch] = pb.batches
    assert [(item["method"], item["url"].split("/")[3]) for item in batch] == [
        ("PATCH", "aid_rules"),
        ("POST", "aid_rules"),
        ("POST", "aid_change_log"),
    ]
    assert (batch[0]["body"], _headers(batch)) == ({}, ['"2"', None, None])
    assert pb.revisions == {RULES_A: 3}
    assert result.records[0] is not None
    assert result.records[0]["version"] == 2  # the create's own response, not the guard's


def test_a_write_after_a_guard_on_the_same_record_expects_one_more() -> None:
    guards, writes = if_match_values(
        [_status(RULES_A, "income", 6)], [AidGuard(collection="aid_rules", record_id=RULES_A, expected_revision=6)]
    )
    assert (guards, writes) == ([6], [7])


def test_a_failed_guard_refuses_the_whole_operation() -> None:
    pb = RevisionedPocketBase({RULES_A: 3})
    create = AidWrite(collection="aid_rules", action="create", year=2031, data={"year": 2031, "version": 2})
    with pytest.raises(AidWriteConflictError) as raised:
        commit_aid_writes(
            pb,  # type: ignore[arg-type]
            [create],
            actor=ACTOR,
            guards=[AidGuard(collection="aid_rules", record_id=RULES_A, expected_revision=2)],
        )
    assert raised.value.record_id == RULES_A
    assert pb.committed == []


def test_guards_never_ride_in_a_chunked_operation() -> None:
    guard = AidGuard(collection="aid_rules", record_id=RULES_A, expected_revision=0)
    with pytest.raises(ValueError, match="can't be chunked"):
        commit_aid_writes(
            RevisionedPocketBase({RULES_A: 0}),  # type: ignore[arg-type]
            [_status(RULES_A, "income", 0)],
            actor=ACTOR,
            guards=[guard],
            allow_chunking=True,
        )


def test_a_conflict_in_a_later_chunk_is_a_partial_commit_not_a_clean_refusal() -> None:
    pb = RevisionedPocketBase({RULES_A: 1})
    first = AidWrite(
        collection="aid_sources", action="update", year=2031, record_id=SOURCE, before={"note": ""}, data={"note": "x"}
    )
    with pytest.raises(AidOperationPartiallyCommittedError) as raised:
        commit_aid_writes(
            pb,  # type: ignore[arg-type]
            [first, _status(RULES_A, "income", 0)],
            actor=ACTOR,
            allow_chunking=True,
            max_requests=2,
        )
    assert (raised.value.committed, raised.value.total) == (1, 2)


def test_a_revision_or_guard_outside_the_revisioned_collections_is_refused() -> None:
    """Ruling 2026-10-01 (plan review): PocketBase ignores If-Match on a collection aidguard doesn't guard, so a
    write there would look guarded and not be."""
    unguarded = AidWrite(
        collection="aid_sources",
        action="update",
        year=2031,
        record_id=SOURCE,
        before={"note": ""},
        data={"note": "checked"},
        expected_revision=0,
    )
    with pytest.raises(ValueError, match="has no revision"):
        if_match_values([unguarded])
    with pytest.raises(ValueError, match="has no revision"):
        if_match_values([], [AidGuard(collection="aid_sources", record_id=SOURCE, expected_revision=0)])
