"""An in-memory twin of FinancialAidDecisionsRepository for the decisions service tests (sub-project
10a). Every commit runs 4a's real commit_aid_writes over a fake batch, and each aid_decisions create
becomes an event through the repository's own record parser. Fictional only (tests/CLAUDE.md).

Prices under financial_aid_fakes.intake_rules(): Session 2 (1000101) costs 2,000, so a tier-2 family
(60,000) gets Round 1 = 1,500, and Round 2's cap is 1,800 less Round 1."""

from __future__ import annotations

from collections.abc import Collection, Sequence
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, cast

import httpx

from api.constants.collections import (
    AID_APPLICATION_CORRECTIONS,
    AID_APPLICATIONS,
    AID_ATTRIBUTION_OVERRIDES,
    AID_CANCELLATIONS,
    AID_DECISIONS,
    AID_GRANT_PLACEMENTS,
    AID_HOLD_EVENTS,
    AID_PAYER_SHARES,
    AID_REQUESTS,
    AID_RULES,
)
from api.services.financial_aid_cancellations import CancelEvent, EnrollmentState
from api.services.financial_aid_decisions_repository import cancel_event, decision_event, hold_event
from api.services.financial_aid_grant_placements import PlacementRecord, placement_record
from api.services.financial_aid_grants_register import Placement, RegisterRow, RequestShare
from api.services.financial_aid_intake_plan import application_fields, request_fields
from api.services.financial_aid_intake_types import (
    ApplicationRecord,
    CorrectionRecord,
    EquityAnswers,
    PayerShareRecord,
    RequestRecord,
    SessionRow,
)
from api.services.financial_aid_ledger_service import parse_pb_datetime
from api.services.financial_aid_reconciliation import CampLine, LineOverride, SplitPart
from api.services.financial_aid_rules_service import RulesVersion
from api.services.financial_aid_to_place import SinceCorrection, SinceLog, SinceRecords
from bunking.financial_aid.change_log import COLLECTION, AidOperationResult, AidWrite, commit_aid_writes
from bunking.financial_aid.change_replay import LogRow
from bunking.financial_aid.decisions import DecisionEvent, HoldEvent
from bunking.financial_aid.rules.lifecycle import SectionStatus
from bunking.financial_aid.rules.schema import SECTION_NAMES, AidRules, SectionName
from bunking.pocketbase_batch import IF_MATCH, if_match
from pocketbase import PocketBase
from tests.unit.api.services.financial_aid_fakes import (
    SESSIONS,
    YEAR,
    _BatchTwin,
    intake_rules,
    precondition_failed,
)

T0 = datetime(2027, 3, 9, 17, 0, tzinfo=UTC)
ACTOR = "registrar@example.com"
RULES_ID = "rul000000000001"  # the one aid_rules record approved() and FakeRules write to


class FakeDecisionsStore:
    def __init__(self) -> None:
        self.applications: list[ApplicationRecord] = []
        self.requests: dict[str, RequestRecord] = {}
        self.corrections: list[CorrectionRecord] = []
        self.sessions: list[SessionRow] = list(SESSIONS)
        self.shares: list[PayerShareRecord] = []
        self.equity: dict[int, EquityAnswers] = {}
        self.events: list[DecisionEvent] = []
        self.hold_events: list[HoldEvent] = []
        self.change_log: list[LogRow] = []
        self.operations: list[list[AidWrite]] = []  # every commit a service attempted
        self.log: list[dict[str, Any]] = []  # every aid_change_log row that committed
        self.rules_writes: list[dict[str, Any]] = []  # every aid_rules sub-request that committed
        self.rules_revision: dict[str, int] = {}  # aid_rules record id -> revision, as pocketbase/aidguard keeps it
        self.camp_lines: list[CampLine] = []
        self.camp_line_reads: list[bool] = []  # each fetch_camp_lines call's recorded_times, in order
        self.placements: dict[int, Placement] = {}
        self.splits: dict[int, tuple[SplitPart, ...]] = {}  # lines a person split across requests (SP11-rest)
        self.synced_at: datetime | None = None  # the last successful ledger sync covering YEAR; None = never
        self.cancel_events: list[CancelEvent] = []
        self.enrollments: list[EnrollmentState] = []
        self.enrollment_reads: list[tuple[frozenset[int], frozenset[int]]] = []  # each read's (persons, households)
        self.grant_placements: list[PlacementRecord] = []  # the grant placement log (3c-2)
        self.camper_names: dict[int, tuple[str, str]] = {}  # CampMinder's first and last names (the March file)
        self.since = SinceRecords()  # D16b: synced records, grant lines, links and sync removals a test seeds
        self.since_reads: list[datetime] = []  # each fetch_changed_since call's floor
        self._clock = T0

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
            SinceCorrection(c.application_id, c.request_id, created, c.field)
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

    async def fetch_applications(self, year: int) -> list[ApplicationRecord]:
        return [a for a in self.applications if a.year == year]

    async def fetch_requests(self, year: int, application_id: str | None = None) -> list[RequestRecord]:
        return [
            r
            for r in self.requests.values()
            if r.year == year and (application_id is None or r.application_id == application_id)
        ]

    async def fetch_request(self, record_id: str) -> RequestRecord | None:
        return self.requests.get(record_id)

    async def fetch_corrections(self, year: int, application_id: str | None) -> list[CorrectionRecord]:
        return [
            c
            for c in self.corrections
            if c.year == year and (application_id is None or c.application_id == application_id)
        ]

    async def fetch_sessions(self, year: int) -> list[SessionRow]:
        return list(self.sessions)

    async def fetch_change_log(self, year: int, entity: str) -> list[LogRow]:
        return [r for r in self.change_log if r.entity == entity]

    async def fetch_payer_shares(self, year: int, request_ids: Sequence[str] | None = None) -> list[PayerShareRecord]:
        return [s for s in self.shares if s.year == year and (request_ids is None or s.request_id in request_ids)]

    async def fetch_equity_answers(self, year: int, person_cm_ids: Sequence[int]) -> dict[int, EquityAnswers]:
        return {p: self.equity[p] for p in person_cm_ids if p in self.equity}

    async def fetch_decision_events(self, year: int) -> list[DecisionEvent]:
        return [e for e in self.events if self.requests[e.request_id].year == year]

    async def fetch_request_events(self, request_id: str) -> list[DecisionEvent]:
        return [e for e in self.events if e.request_id == request_id]

    async def fetch_hold_events(self, year: int) -> list[HoldEvent]:
        return [e for e in self.hold_events if self.requests[e.request_id].year == year]

    async def fetch_request_hold_events(self, request_id: str) -> list[HoldEvent]:
        return [e for e in self.hold_events if e.request_id == request_id]

    async def fetch_cancellations(self, year: int) -> list[CancelEvent]:
        return [e for e in self.cancel_events if self.requests[e.request_id].year == year]

    async def fetch_request_cancellations(self, request_id: str) -> list[CancelEvent]:
        return [e for e in self.cancel_events if e.request_id == request_id]

    async def fetch_enrollment_states(
        self, year: int, person_cm_ids: Collection[int], household_cm_ids: Collection[int]
    ) -> list[EnrollmentState]:
        """As the repository reads them: only the named campers' rows and the named households'."""
        self.enrollment_reads.append((frozenset(person_cm_ids), frozenset(household_cm_ids)))
        return [e for e in self.enrollments if e.person_cm_id in person_cm_ids or e.household_cm_id in household_cm_ids]

    async def fetch_camp_lines(self, year: int, *, recorded_times: bool = False) -> list[CampLine]:
        """As the repository reads them: without the recorded times unless asked for (a past read)."""
        self.camp_line_reads.append(recorded_times)
        if recorded_times:
            return list(self.camp_lines)
        return [replace(line, recorded_at=None, updated_at=None) for line in self.camp_lines]

    async def fetch_line_placements(self, year: int) -> dict[int, Placement]:
        return dict(self.placements)

    async def fetch_line_splits(self, year: int) -> dict[int, tuple[SplitPart, ...]]:
        return dict(self.splits)

    async def fetch_line_overrides(self, year: int) -> list[LineOverride]:
        whole = [
            LineOverride(
                f"ovr{p.transaction_cm_id:012d}", p.transaction_cm_id, p.person_cm_id, p.session_cm_id, p.program_family
            )
            for p in self.placements.values()
        ]
        split = [LineOverride(f"ovr{txn:012d}", txn, 0, 0, "", parts) for txn, parts in self.splits.items()]
        return [*whole, *split]

    async def fetch_last_ledger_sync(self, year: int) -> datetime | None:
        return self.synced_at

    async def fetch_grant_placements(self, year: int) -> list[PlacementRecord]:
        return list(self.grant_placements)

    async def fetch_names(
        self, year: int, household_cm_ids: Collection[int], person_cm_ids: Collection[int]
    ) -> tuple[dict[int, str], dict[int, str]]:
        return {h: f"Family {h}" for h in household_cm_ids}, {p: f"Camper {p}" for p in person_cm_ids}

    async def fetch_camper_names(self, year: int, person_cm_ids: Collection[int]) -> dict[int, tuple[str, str]]:
        """As the repository reads them: CampMinder's first and last names, only for the people asked for."""
        return {p: self.camper_names[p] for p in person_cm_ids if p in self.camper_names}

    async def commit(
        self,
        writes: Sequence[AidWrite],
        *,
        actor: str,
        operation_id: str | None = None,
        reason: str | None = None,
        require_reason: bool = False,
        allow_chunking: bool = False,
    ) -> AidOperationResult:
        self.operations.append(list(writes))
        return commit_aid_writes(
            cast(PocketBase, _BatchTwin(self)),
            writes,
            actor=actor,
            operation_id=operation_id,
            reason=reason,
            require_reason=require_reason,
            allow_chunking=allow_chunking,
        )

    def apply_batch(self, requests: list[dict[str, Any]]) -> httpx.Response:
        # pocketbase/aidguard (G6), checked before anything applies: one transaction, so a failed If-Match
        # anywhere leaves every collection untouched. Every aid_rules save moves its revision on by one.
        revisions = dict(self.rules_revision)
        for index, item in enumerate(requests):
            parts = item["url"].strip("/").split("/")
            if parts[2] != AID_RULES or item["method"] != "PATCH":
                continue
            stored = revisions.get(parts[4], 0)
            wanted = (item.get("headers") or {}).get(IF_MATCH)
            if wanted is not None and wanted != if_match(stored):
                return precondition_failed(index, f"aid_rules {parts[4]}")
            revisions[parts[4]] = stored + 1
        self.rules_revision = revisions
        results: list[dict[str, Any]] = []
        for item in requests:
            collection = item["url"].strip("/").split("/")[2]
            body = dict(item.get("body") or {})
            if collection == COLLECTION:
                self.log.append(body)
            elif collection == AID_DECISIONS:
                self._clock += timedelta(seconds=1)
                self.events.append(decision_event(SimpleNamespace(**body, created=self._clock.isoformat())))
            elif collection == AID_HOLD_EVENTS:
                self._clock += timedelta(seconds=1)
                self.hold_events.append(hold_event(SimpleNamespace(**body, created=self._clock.isoformat())))
            elif collection == AID_CANCELLATIONS:
                self._clock += timedelta(seconds=1)
                self.cancel_events.append(cancel_event(SimpleNamespace(**body, created=self._clock.isoformat())))
            elif collection == AID_GRANT_PLACEMENTS:
                self._clock += timedelta(seconds=1)
                self.grant_placements.append(placement_record(SimpleNamespace(**body, created=self._clock.isoformat())))
            elif collection == AID_APPLICATION_CORRECTIONS:
                self._clock += timedelta(seconds=1)
                self.corrections.append(
                    CorrectionRecord(
                        id=f"cor{len(self.corrections):012d}",
                        year=int(body["year"]),
                        application_id=str(body["application"]),
                        request_id=str(body["request"]),
                        field=str(body["field"]),
                        new_value=str(body["new_value"]),
                        original_value=str(body["original_value"]),
                        reason=str(body["reason"]),
                        actor=str(body["actor"]),
                        created=self._clock.strftime("%Y-%m-%d %H:%M:%S.000Z"),
                    )
                )
            elif collection == AID_RULES:
                self.rules_writes.append(body)
            else:
                raise AssertionError(f"the decisions service must not write {collection}")
            results.append({"status": 200, "body": {**body, "id": body.get("id", "x" * 15)}})
        return httpx.Response(200, json=results)


def approved(rules: AidRules | None = None, version: int = 1) -> RulesVersion:
    """A rules version with every section approved (the pricing sections included)."""
    return RulesVersion(
        record_id=RULES_ID,
        year=YEAR,
        version=version,
        document=rules or intake_rules(),
        section_status={name: SectionStatus(state="approved") for name in SECTION_NAMES},
        parent_year=None,
        parent_version=None,
    )


class FakeRules:
    """latest_approved returns `version`; lock_writes returns one aid_rules update per section, except
    the ones listed in `not_locked`, which it reports as not locked (a rules validation error).

    Each lock_writes call reads the record at the next of `revision_reads` (then 0 once they run out) and
    its writes carry that as expected_revision (G6): a test makes a read stale by giving the store a newer one.
    """

    def __init__(self, version: RulesVersion | None) -> None:
        self.version = version
        self.as_of_version: RulesVersion | Exception | None = version
        self.as_of_calls: list[datetime] = []
        self.not_locked: list[SectionName] = []
        self.lock_calls: list[tuple[int, int, tuple[SectionName, ...]]] = []
        self.revision_reads: list[int] = []

    async def latest_approved(self, year: int, sections: Collection[SectionName]) -> RulesVersion | None:
        return self.version

    async def approved_as_of(self, year: int, sections: Collection[SectionName], at: datetime) -> RulesVersion | None:
        self.as_of_calls.append(at)
        if isinstance(self.as_of_version, Exception):
            raise self.as_of_version
        return self.as_of_version

    async def approved_as_of_each(
        self, year: int, sections: Collection[SectionName], ats: Collection[datetime]
    ) -> tuple[dict[datetime, RulesVersion | None], frozenset[datetime]]:
        """approved_as_of at each instant, from one call (as the rules service reads its history once)."""
        self.as_of_calls.extend(ats)
        if isinstance(self.as_of_version, Exception):
            return {}, frozenset(ats)
        return dict.fromkeys(ats, self.as_of_version), frozenset()

    async def lock_writes(
        self, year: int, version: int, sections: Collection[SectionName]
    ) -> tuple[list[AidWrite], list[SectionName]]:
        named = tuple(sections)
        self.lock_calls.append((year, version, named))
        read = self.revision_reads.pop(0) if self.revision_reads else 0
        writes = [
            AidWrite(
                collection=AID_RULES,
                action="update",
                year=year,
                record_id=RULES_ID,
                before={"section_status": {section: "approved"}},
                data={"section_status": {section: "locked"}},
                log_action="lock",
                entity_id=f"{year}:{version}:{section}",
                expected_revision=read,
            )
            for section in named
            if section not in self.not_locked
        ]
        return writes, [s for s in named if s in self.not_locked]


def seed_request(
    store: FakeDecisionsStore,
    request_id: str,
    *,
    household: int = 1000001,
    person: int = 1000011,
    session: int = 1000101,
    ask: float = 4000.0,
    status: str = "active",
    income: float = 60000.0,
) -> RequestRecord:
    """A summer request with its application and a 100% payer share (no share holds the request)."""
    application_id = f"app{household:012d}"
    if not any(a.id == application_id for a in store.applications):
        store.applications.append(
            ApplicationRecord(
                id=application_id,
                year=YEAR,
                household_cm_id=household,
                status="active",
                answers={"total_gross_income": income, "expected_gross_income": income},
                member_person_cm_ids=(person,),
                flags=(),
            )
        )
    request = RequestRecord(
        id=request_id,
        year=YEAR,
        application_id=application_id,
        household_cm_id=household,
        person_cm_id=person,
        session_cm_id=session,
        program_key="summer",
        program_option_text="Session 2",
        program_option_key="session 2",
        session_resolution="enrollment" if session else "unmatched",
        ask=ask,
        headcount_non_infant=0,
        headcount_infant=0,
        headcount_source="",
        status=status,
        duplicate_of="",
        flags=(),
    )
    store.requests[request_id] = request
    store.shares.append(
        PayerShareRecord(
            id=f"shr{request_id[3:]}",
            year=YEAR,
            request_id=request_id,
            household_cm_id=household,
            share_pct=Decimal(100),
            source="intake_default",
            actor="system:intake",
            note="",
        )
    )
    return request


def grant_row(
    request_id: str,
    amount: str,
    *,
    funder_type: str = "outside",
    on_request: bool = True,
    pays_after_camp_aid: bool = False,
) -> RegisterRow:
    """One counted grants-register row, placed on `request_id` unless `on_request` is False."""
    value = Decimal(amount)
    return RegisterRow(
        kind="ledger",
        transaction_cm_id=9001,
        commitment_id="",
        household_cm_id=1000001,
        person_cm_id=1000011,
        camper_basis="ledger",
        session_cm_id=1000101,
        program_family="summer",
        grantor_key="regional_fund",
        source_key="regional grant",
        source_family="other_outside",
        funder_type=funder_type,
        amount=value,
        recorded_on="2027-02-10",
        recorded_at=datetime(2027, 2, 10, 17, 0, tzinfo=UTC),
        is_reversed=False,
        reversal_date="",
        cancelled=False,
        counts=True,
        fulfils_commitment_id="",
        requests=(RequestShare(request_id, value),) if on_request else (),
        pays_after_camp_aid=pays_after_camp_aid,
    )


def _log(store: FakeDecisionsStore, entity: str, entity_id: str, before: Any, after: Any, at: datetime) -> None:
    store.change_log.append(
        LogRow(
            id=f"log{len(store.change_log):012d}",
            entity=entity,
            entity_id=entity_id,
            before=before,
            after=after,
            created=at,
        )
    )


def log_seeded(store: FakeDecisionsStore, at: datetime) -> None:
    """Create rows for every seeded application, request and payer share, as intake logs them."""
    for application in store.applications:
        body = {
            "year": application.year,
            "household_cm_id": application.household_cm_id,
            **application_fields(application),
        }
        _log(store, AID_APPLICATIONS, application.id, None, body, at)
    for request in store.requests.values():
        body = {
            "year": request.year,
            "application": request.application_id,
            "household_cm_id": request.household_cm_id,
            "person_cm_id": request.person_cm_id,
            "program_key": request.program_key,
            "program_option_key": request.program_option_key,
            **request_fields(request),
        }
        _log(store, AID_REQUESTS, request.id, None, body, at)
    for share in store.shares:
        body = {
            "year": share.year,
            "request": share.request_id,
            "household_cm_id": share.household_cm_id,
            "share_pct": str(share.share_pct),
            "source": share.source,
            "actor": share.actor,
            "note": share.note,
        }
        _log(store, AID_PAYER_SHARES, f"{share.request_id}:{share.household_cm_id}", None, body, at)


def log_update(
    store: FakeDecisionsStore, entity: str, entity_id: str, before: dict[str, Any], after: dict[str, Any], at: datetime
) -> None:
    """One logged update (changed fields only, as 4a trims them)."""
    _log(store, entity, entity_id, before, after, at)


def seed_line(
    store: FakeDecisionsStore,
    txn: int,
    amount: str,
    *,
    household: int = 1000001,
    person: int = 1000011,
    posted: datetime | None = datetime(2027, 3, 8, 18, 0, tzinfo=UTC),
    reversed_at: datetime | None = None,
    recorded: datetime | None = None,
    rewritten: datetime | None = None,
    description_key: str = "",
) -> CampLine:
    """One camp-aid line in the ledger: CampMinder posted it to `person` (0 = the household). Kindred
    recorded it (the aid_postings row's created) when it posted unless `recorded` says otherwise, and
    last wrote it (updated) when it was reversed, never before it recorded it, unless `rewritten` says otherwise."""
    recorded = recorded or posted
    written = [t for t in (recorded, reversed_at) if t is not None]
    line = CampLine(
        transaction_cm_id=txn,
        household_cm_id=household,
        person_cm_id=person,
        amount=Decimal(amount),
        post_date=posted,
        is_reversed=reversed_at is not None,
        reversal_date=reversed_at,
        recorded_at=recorded,
        updated_at=rewritten or (max(written) if written else None),
        description_key=description_key,
    )
    store.camp_lines.append(line)
    return line


def share_row(request_id: str, household: int, pct: str) -> PayerShareRecord:
    return PayerShareRecord(
        id=f"shr{household:012d}",
        year=YEAR,
        request_id=request_id,
        household_cm_id=household,
        share_pct=Decimal(pct),
        source="staff",
        actor=ACTOR,
    )


def seed_override(
    store: FakeDecisionsStore, txn: int, person: int, at: datetime, *, session: int = 0, family: str = ""
) -> None:
    """A staff placement of one line, as the write path logs it: created at `at`."""
    store.placements[txn] = Placement(txn, person, session, family)
    body = {
        "transaction_cm_id": txn,
        "year": YEAR,
        "attributed_person_cm_id": person,
        "attributed_session_cm_id": session,
        "program_family": family,
    }
    _log(store, AID_ATTRIBUTION_OVERRIDES, f"ovr{txn:012d}", None, body, at)


def log_delete(store: FakeDecisionsStore, entity: str, entity_id: str, before: dict[str, Any], at: datetime) -> None:
    """One logged delete (its `before` is the whole record)."""
    _log(store, entity, entity_id, before, None, at)


def seed_split(store: FakeDecisionsStore, txn: int, parts: tuple[SplitPart, ...], at: datetime) -> None:
    """A staff split of one line across requests (SP11-rest), as the write path logs it: created at `at`."""
    store.splits[txn] = parts
    body = {
        "transaction_cm_id": txn,
        "year": YEAR,
        "attributed_person_cm_id": 0,
        "attributed_session_cm_id": 0,
        "program_family": "",
        "split": [part.fields() for part in parts],
    }
    _log(store, AID_ATTRIBUTION_OVERRIDES, f"ovr{txn:012d}", None, body, at)
