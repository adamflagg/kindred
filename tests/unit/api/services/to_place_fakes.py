"""An in-memory twin of the repository reads and writes To place uses (campership SP11-rest), on top of
the decisions service's FakeDecisionsStore. Every commit still runs 4a's real commit_aid_writes over a
fake batch; an aid_attribution_overrides write re-places the line for the next season read, as the
decisions service reads placements and splits from that table. Fictional only (tests/CLAUDE.md)."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx

from api.constants.collections import AID_ATTRIBUTION_OVERRIDES, AID_FLAG_DISPOSITIONS
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from api.services.financial_aid_grants_register import Placement, RegisterRow
from api.services.financial_aid_ledger_service import parse_pb_datetime
from api.services.financial_aid_money_ledger import LedgerLine
from api.services.financial_aid_reconciliation import CampLine, override_split
from api.services.financial_aid_to_place import (
    TO_PLACE_FLAG,
    LeftLine,
    LineDetail,
    OverrideRow,
    SinceCorrection,
    SinceLog,
    SinceRecords,
    SourceRow,
)
from api.services.financial_aid_to_place_service import ToPlaceService
from tests.unit.api.services.decisions_fakes import T0, FakeDecisionsStore, FakeRules, approved, seed_line, seed_request

EMMA = "reqemma00000001"
MAR8 = datetime(2027, 3, 8, 18, 0, tzinfo=UTC)

GRANT_KEY = "summer program grant"
CAMP_KEY = "camp fa"
QUEST_KEY = "camp fa quest"


def _sources() -> dict[str, SourceRow]:
    return {
        CAMP_KEY: SourceRow(CAMP_KEY, "Camp FA", classified=True, counts_as_aid=True, funder_type="camp"),
        QUEST_KEY: SourceRow(QUEST_KEY, "Camp FA Quest", classified=True, counts_as_aid=True, funder_type="camp"),
        GRANT_KEY: SourceRow(
            GRANT_KEY, "Summer Program Grant", classified=True, counts_as_aid=True, funder_type="outside"
        ),
        "refer a friend": SourceRow(
            "refer a friend", "Refer a Friend", classified=True, counts_as_aid=False, funder_type="unknown"
        ),
        "new description": SourceRow(
            "new description", "New Description", classified=False, counts_as_aid=False, funder_type="unknown"
        ),
    }


def _collection(item: dict[str, Any]) -> str:
    return str(item["url"].strip("/").split("/")[2])


def _failed(index: int, status: int, message: str, unique: str) -> httpx.Response:
    """PocketBase's answer when sub-request `index` fails: the batch is refused whole (400), and the
    failing sub-request's own response carries its status, and a unique-index clash names the field."""
    data = {"transaction_cm_id": {"code": "validation_not_unique", "message": unique}} if unique else {}
    failure = {"status": status, "message": message, "data": data}
    return httpx.Response(
        400,
        json={"message": "Batch transaction failed.", "data": {"requests": {str(index): {"response": failure}}}},
    )


class FakeToPlaceStore(FakeDecisionsStore):
    def __init__(self) -> None:
        super().__init__()
        self.details: dict[int, LineDetail] = {}
        self.override_rows: dict[int, OverrideRow] = {}
        self.left: dict[int, LeftLine] = {}
        self.sources: dict[str, SourceRow] = _sources()
        self.pending_reclass: dict[int, str] = {}  # every reclassification written, until "the sync" applies it
        self.since = SinceRecords()  # D16b: synced records, grant lines, links and sync removals a test seeds
        self.since_reads: list[datetime] = []  # each fetch_changed_since call's floor
        self.other_lines: list[LedgerLine] = []  # every other funder's lines (seed_grant_line): Money > Ledger

    async def fetch_line_details(self, year: int) -> dict[int, LineDetail]:
        """Every camp-aid line: its description (Camp FA unless a test says otherwise) and Go's flags."""
        return {
            line.transaction_cm_id: self.details.get(
                line.transaction_cm_id, LineDetail(line.transaction_cm_id, CAMP_KEY)
            )
            for line in self.camp_lines
        }

    async def fetch_ledger_lines(self, year: int) -> list[LedgerLine]:
        """Every aid_postings line, as the repository reads them: this twin's camp-aid lines (Camp FA unless a test
        says otherwise, with Go's flags, as fetch_line_details gives them), then the lines seed_grant_line added."""
        details = await self.fetch_line_details(year)
        camp = [
            LedgerLine(
                line,
                "camp",
                details[line.transaction_cm_id].description_key,
                "camp_fa",
                details[line.transaction_cm_id].flags,
            )
            for line in self.camp_lines
        ]
        return [*camp, *self.other_lines]

    async def fetch_override_rows(self, year: int) -> dict[int, OverrideRow]:
        return dict(self.override_rows)

    async def fetch_left_lines(self, year: int) -> dict[int, LeftLine]:
        return dict(self.left)

    async def fetch_source_rows(self) -> dict[str, SourceRow]:
        return dict(self.sources)

    async def fetch_changed_since(self, year: int, floor: datetime, *, persons: bool) -> SinceRecords:
        """As the repository reads them, after `floor`: the decision, hold and cancellation rows this twin
        records (each logged in the same batch, at its created), its seeded change log and corrections, and
        whatever a test seeds in `since`."""
        self.since_reads.append(floor)
        log = [
            *(SinceLog("aid_decisions", f"{e.request_id}:{e.round}", e.kind, e.created) for e in self.events),
            *(SinceLog("aid_hold_events", f"{e.request_id}:{e.code}", e.kind, e.created) for e in self.hold_events),
            *(SinceLog("aid_cancellations", e.request_id, e.kind, e.created) for e in self.cancel_events),
            *(SinceLog(r.entity, r.entity_id, "", r.created, r.before, r.after) for r in self.change_log),
            *self.since.log,
        ]
        corrections = [
            SinceCorrection(c.application_id, c.request_id, created)
            for c in self.corrections
            if (created := parse_pb_datetime(c.created)) is not None
        ]
        return SinceRecords(
            log=tuple(row for row in log if row.created > floor),
            corrections=tuple(c for c in (*corrections, *self.since.corrections) if c.created > floor),
            synced=tuple(s for s in self.since.synced if s.at > floor and (persons or s.collection != "persons")),
            grant_lines=tuple(
                g for g in self.since.grant_lines if any(t is not None and t > floor for t in (g.created, g.updated))
            ),
            links=self.since.links,
            removals=tuple(r for r in self.since.removals if r.ended > floor),
        )

    def apply_batch(self, requests: list[dict[str, Any]]) -> httpx.Response:
        """One transaction, as PocketBase runs a batch: every check runs before anything applies. This fake's
        own checks first (the unique indexes, a record already gone), then the decisions twin's (G6's
        If-Match on aid_rules) over ALL its sub-requests at once, and only then is anything recorded.
        Overrides and To place's dispositions are kept here; everything else as the decisions twin keeps it."""
        if (refused := self._refusal(requests)) is not None:
            return refused
        mine = {AID_ATTRIBUTION_OVERRIDES, AID_FLAG_DISPOSITIONS}
        theirs = [(i, item) for i, item in enumerate(requests) if _collection(item) not in mine]
        answer = super().apply_batch([item for _, item in theirs]) if theirs else httpx.Response(200, json=[])
        if answer.status_code >= 400:  # nothing of theirs applied: renumber the failing sub-request, apply nothing
            body = answer.json()
            failed = body["data"]["requests"]
            body["data"]["requests"] = {str(theirs[int(k)][0]): v for k, v in failed.items()}
            return httpx.Response(answer.status_code, json=body)
        results: dict[int, dict[str, Any]] = dict(zip((i for i, _ in theirs), answer.json(), strict=True))
        for i, item in enumerate(requests):
            if i in results:
                continue
            url = item["url"].strip("/").split("/")
            body = dict(item.get("body") or {})
            if url[2] == AID_ATTRIBUTION_OVERRIDES:
                self._override(url, body)
            else:
                self._disposition(item["method"], url, body)
            results[i] = {"status": 200, "body": {**body, "id": body.get("id", url[-1])}}
        return httpx.Response(200, json=[results[i] for i in range(len(requests))])

    def _refusal(self, requests: list[dict[str, Any]]) -> httpx.Response | None:
        """PocketBase's answer to a batch that meets a unique index or a record already deleted, or None."""
        for i, item in enumerate(requests):
            body = item.get("body") or {}
            url = item["url"].strip("/").split("/")
            txn = int(body.get("transaction_cm_id", 0) or 0)
            if item["method"] == "POST" and url[2] == AID_ATTRIBUTION_OVERRIDES and txn in self.override_rows:
                return _failed(i, 400, "Failed to create record.", "Value must be unique.")
            if item["method"] == "POST" and url[2] == AID_FLAG_DISPOSITIONS and txn in self.left:
                return _failed(i, 400, "Failed to create record.", "Value must be unique.")
            if item["method"] in ("PATCH", "DELETE") and url[2] == AID_FLAG_DISPOSITIONS:
                if all(left.id != url[4] for left in self.left.values()):
                    return _failed(i, 404, "The requested resource wasn't found.", "")
        return None

    def _override(self, url: list[str], body: dict[str, Any]) -> None:
        txn = int(body["transaction_cm_id"]) if "transaction_cm_id" in body else self._txn_of(url[-1])
        current = self.override_rows.get(txn)
        fields = {**(current.snapshot(0) if current else {}), **body}
        row = OverrideRow(
            id=str(body.get("id") or (current.id if current else url[-1])),
            transaction_cm_id=txn,
            attributed_person_cm_id=int(fields.get("attributed_person_cm_id") or 0),
            attributed_session_cm_id=int(fields.get("attributed_session_cm_id") or 0),
            program_family=str(fields.get("program_family") or ""),
            source_key_override=str(fields.get("source_key_override") or ""),
            source=str(fields.get("source") or ""),
            note=str(fields.get("note") or ""),
            split=override_split(fields),
        )
        self.override_rows[txn] = row
        self.placements.pop(txn, None)
        self.splits.pop(txn, None)
        if row.split:
            self.splits[txn] = row.split
        elif row.attributed_person_cm_id > 0 or row.attributed_session_cm_id > 0:
            self.placements[txn] = Placement(
                txn, row.attributed_person_cm_id, row.attributed_session_cm_id, row.program_family
            )
        if row.source_key_override:
            self.pending_reclass[txn] = row.source_key_override
        self._clock += timedelta(seconds=1)

    def _disposition(self, method: str, url: list[str], body: dict[str, Any]) -> None:
        if method == "DELETE":
            self.left = {txn: left for txn, left in self.left.items() if left.id != url[-1]}
            return
        if body.get("flag", TO_PLACE_FLAG) != TO_PLACE_FLAG:
            raise AssertionError("To place writes only its own disposition")
        txn = int(body["transaction_cm_id"]) if "transaction_cm_id" in body else self._left_txn(url[-1])
        current = self.left.get(txn)
        self.left[txn] = LeftLine(
            id=str(body.get("id") or (current.id if current else url[-1])),
            transaction_cm_id=txn,
            note=str(body.get("note") or (current.note if current else "")),
        )

    def _txn_of(self, record_id: str) -> int:
        return next(txn for txn, row in self.override_rows.items() if row.id == record_id)

    def _left_txn(self, record_id: str) -> int:
        return next(txn for txn, left in self.left.items() if left.id == record_id)


def seed_override_row(store: FakeToPlaceStore, txn: int, *, source_key: str = "", person: int = 0) -> OverrideRow:
    """An existing override (a reclassification, or a placement of `person`) the write path will update."""
    row = OverrideRow(
        id=f"ovr{txn:012d}",
        transaction_cm_id=txn,
        attributed_person_cm_id=person,
        attributed_session_cm_id=0,
        program_family="",
        source_key_override=source_key,
        source="staff",
        note="",
    )
    store.override_rows[txn] = row
    if person:
        store.placements[txn] = Placement(txn, person, 0, "")
    return row


def seed_grant_line(
    store: FakeToPlaceStore,
    txn: int,
    amount: str,
    *,
    household: int = 1000001,
    person: int = 0,
    posted: datetime | None = MAR8,
    reversed_at: datetime | None = None,
    funder_type: str = "outside",
    source_family: str = "other_outside",
    source_key: str = GRANT_KEY,
) -> LedgerLine:
    """Another funder's line in the ledger (an outside grant unless a test says otherwise): Money > Ledger's Outside
    grants. Kindred recorded it when it posted and last wrote it when it was reversed, as seed_line does."""
    written = [t for t in (posted, reversed_at) if t is not None]
    line = LedgerLine(
        CampLine(
            transaction_cm_id=txn,
            household_cm_id=household,
            person_cm_id=person,
            amount=Decimal(amount),
            post_date=posted,
            is_reversed=reversed_at is not None,
            reversal_date=reversed_at,
            recorded_at=posted,
            updated_at=max(written) if written else None,
        ),
        funder_type,
        source_key,
        source_family,
    )
    store.other_lines.append(line)
    return line


def to_place_service(store: FakeToPlaceStore, rules: FakeRules | None = None) -> ToPlaceService:
    """The To place service over `store`, its decisions service pricing with every section approved, today Mar 9."""

    async def no_grants(year: int) -> Sequence[RegisterRow]:
        return []

    decisions = FinancialAidDecisionsService(store, rules or FakeRules(approved()), no_grants, clock=lambda: T0)
    return ToPlaceService(decisions, store, clock=lambda: T0)


def one_line(amount: str = "1500") -> FakeToPlaceStore:
    """Emma's one request (Round 1 decided 1,500) and one camp-aid line posted to her household on Mar 8."""
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_line(store, 9001, amount, person=0, posted=MAR8)
    return store
