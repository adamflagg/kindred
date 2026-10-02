"""Shared fixtures for the campership intake tests (sub-project 5).

Fictional data only: generic session names, and person/household ids from
1000001 up (tests/CLAUDE.md). Nothing here is, or resembles, a real family.
"""

from __future__ import annotations

import asyncio
import copy
import json
from collections.abc import Mapping, Sequence
from dataclasses import replace
from types import SimpleNamespace
from typing import Any, Protocol, cast

import httpx

from api.constants.collections import (
    AID_APPLICATION_CORRECTIONS,
    AID_APPLICATIONS,
    AID_PAYER_SHARES,
    AID_REQUESTS,
    AID_SESSION_CAPACITY,
)
from api.services.financial_aid_intake_repository import _exact_pct
from api.services.financial_aid_intake_types import (
    ApplicationRecord,
    AttendeeRow,
    BillingLine,
    CapacityRecord,
    CorrectionRecord,
    EquityAnswers,
    FaRow,
    PayerShareRecord,
    RequestRecord,
    SessionRow,
    equity_from_json,
)
from bunking.financial_aid.change_log import COLLECTION, AidOperationResult, AidWrite, commit_aid_writes
from bunking.financial_aid.rules.schema import AidRules
from bunking.pocketbase_batch import MAX_BATCH_REQUESTS
from pocketbase import PocketBase
from tests.unit.bunking.financial_aid.fixtures import fictional_rules, with_levers

YEAR = 2027

# The fourth field is the session's first day (camp_sessions.start_date); the
# infant cutoff is measured on it (spec 2 item 22).
SESSIONS: tuple[SessionRow, ...] = (
    SessionRow(1000101, "Session 2", "main", "2027-06-20"),
    SessionRow(1000102, "Session 2a", "embedded", "2027-06-20"),
    SessionRow(1000103, "All-Gender Cabin-Session 2 (7th & 8th grades)", "ag", "2027-06-20"),
    SessionRow(1000104, "Taste of Camp 1", "main", "2027-06-13"),
    SessionRow(1000105, "Taste of Camp 2", "embedded", "2027-07-25"),
    SessionRow(1000106, "River `n` Ridge Quest", "quest", "2027-07-05"),
    SessionRow(1000107, "Counselor In-Training", "scit", "2027-06-20"),
    SessionRow(1000108, "Specialist In-Training", "scit", "2027-06-20"),
    SessionRow(1000201, "Family Camp 3: Riverside Weekend (w/ kids 10 and under)", "family", "2027-05-28"),
    SessionRow(1000202, "Family Camp 6", "family", "2027-08-20"),
    SessionRow(1000301, "The Camp's B*Mitzvah Program Year 1 - North", "bmitzvah", "2027-01-10"),
    SessionRow(1000401, "Adult Weekend A", "adult", "2027-09-10"),
    SessionRow(1000402, "Adult Weekend B", "adult", "2027-09-24"),
)

_INCOME_COLUMNS = ("total_gross_income", "expected_gross_income", "total_adjusted_income", "income_confirmed")


def fa_row(
    person_cm_id: int,
    household_cm_id: int = 1000001,
    *,
    summer: str = "",
    summer_ask: float = 0.0,
    fc: str = "",
    fc_ask: float = 0.0,
    tbm: str = "",
    tbm_ask: float = 0.0,
    interest: bool = False,
    registration_ask: float = 0.0,
    reported: tuple[str, ...] | None = None,
    **answers: Any,
) -> FaRow:
    """`reported` names the income columns the family answered (Task 1b). Left as None,
    it is every income column given a non-zero value here, so `total_gross_income=0.0`
    alone reads as a BLANK; pass `reported=("total_gross_income",)` for a real $0."""
    if reported is None:
        reported = tuple(name for name in _INCOME_COLUMNS if answers.get(name))
    return FaRow(
        person_cm_id=person_cm_id,
        household_cm_id=household_cm_id,
        answers=answers,
        summer_program=summer,
        summer_amount_requested=summer_ask,
        fc_program=fc,
        fc_amount_requested=fc_ask,
        tbm_program=tbm,
        tbm_amount_requested=tbm_ask,
        interest_expressed=interest,
        registration_ask=registration_ask,
        reported_income_fields=frozenset(reported),
    )


def intake_rules() -> AidRules:
    """SP3's fictional rules fitted to this plan's season and SESSIONS: summer takes every
    summer session type, family camp takes Family Camp 6, and the two checks SP5 evaluates
    hold. The infant cutoff stays 24 months (the fixture's value)."""
    return with_levers(
        fictional_rules(),
        {
            "year": YEAR,
            "programs.summer.session_types": ["main", "embedded", "ag"],
            "programs.quest.session_types": ["quest"],
            "programs.family_camp.session_cm_ids": [1000201, 1000202],
            "quality_checks.checks.household_income_conflict": {"severity": "hold"},
            "quality_checks.checks.unmatched_session": {"severity": "hold"},
        },
    )


def _tupled(changes: Mapping[str, Any]) -> dict[str, Any]:
    return {k: tuple(v) if isinstance(v, list) else v for k, v in changes.items()}


def _request_changes(changes: Mapping[str, Any]) -> dict[str, Any]:
    """A request update's fields as the record holds them: the equity copy parsed as the repository does."""
    out = _tupled(changes)
    if "equity" in out:
        out["equity"] = equity_from_json(out["equity"])
    return out


# Everything a batch can change; a failed batch restores all of it.
_TABLES = ("applications", "requests", "payer_shares", "corrections", "capacity", "change_log", "writes")


class _BatchStore(Protocol):
    """A store that applies one PocketBase batch (FakeAidStore, and the decisions fake)."""

    def apply_batch(self, requests: list[dict[str, Any]]) -> httpx.Response: ...


class _BatchTwin:
    """Just enough of the PocketBase client for bunking.pocketbase_batch.send_batch:
    base_url, auth_store.token and http_client.request. Every batch goes to the store."""

    def __init__(self, store: _BatchStore) -> None:
        self.base_url = "http://pocketbase.test"
        self.auth_store = SimpleNamespace(token="")
        self.http_client = SimpleNamespace(request=self._request)
        self._store = store

    def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        return self._store.apply_batch(json.loads(kwargs["content"])["requests"])


def precondition_failed(index: int, record: str) -> httpx.Response:
    """PocketBase's answer when sub-request `index` fails pocketbase/aidguard's If-Match check: the batch is
    refused whole (400) and the failing sub-request's own response carries 412 (G6)."""
    return httpx.Response(
        400,
        json={
            "data": {
                "requests": {
                    str(index): {
                        "code": "batch_request_failed",
                        "message": "Batch request failed.",
                        "response": {"data": {}, "message": f"{record} changed since it was read.", "status": 412},
                    }
                }
            },
            "message": "Batch transaction failed.",
            "status": 400,
        },
    )


class FakeAidStore:
    """In-memory twin of FinancialAidIntakeRepository. Each read yields once so
    concurrent builds really interleave (the year-lock test depends on it), and
    records the season it was asked for (the season-scope test depends on it).
    Writes go only through `commit`, which runs 4a's real commit_aid_writes."""

    def __init__(self) -> None:
        self.fa_rows: list[FaRow] = []
        self.sessions: list[SessionRow] = list(SESSIONS)
        self.attendees: list[AttendeeRow] = []
        self.billing: list[BillingLine] = []
        self.applications: dict[str, ApplicationRecord] = {}
        self.requests: dict[str, RequestRecord] = {}
        self.payer_shares: dict[str, PayerShareRecord] = {}
        self.corrections: list[CorrectionRecord] = []
        self.capacity: dict[tuple[int, int], CapacityRecord] = {}
        self.equity: dict[int, EquityAnswers] = {}
        self.birthdates: dict[int, str] = {}
        self.rules: AidRules | None = None
        self.equity_rules: AidRules | None = None
        self.years_read: set[int] = set()
        self.writes: list[tuple[str, str]] = []  # every record write that committed (not log rows)
        self.change_log: list[dict[str, Any]] = []  # every aid_change_log row that committed
        self.operations: list[dict[str, Any]] = []  # every commit a service attempted
        self.results: list[AidOperationResult] = []
        self.max_batch_requests = MAX_BATCH_REQUESTS
        self.fail_on: tuple[str, str] | None = None  # (collection, method): that sub-request fails
        self._next = 0

    def _id(self) -> str:
        self._next += 1
        return f"rec{self._next:012d}"

    async def _read(self, year: int) -> None:
        self.years_read.add(year)
        await asyncio.sleep(0)

    async def fetch_fa_rows(self, year: int) -> list[FaRow]:
        await self._read(year)
        return list(self.fa_rows)

    async def fetch_sessions(self, year: int) -> list[SessionRow]:
        await self._read(year)
        return list(self.sessions)

    async def fetch_registered_attendees(self, year: int) -> list[AttendeeRow]:
        await self._read(year)
        return list(self.attendees)

    async def fetch_family_camp_billing(self, year: int) -> list[BillingLine]:
        await self._read(year)
        return list(self.billing)

    async def fetch_applications(self, year: int) -> list[ApplicationRecord]:
        await self._read(year)
        return [a for a in self.applications.values() if a.year == year]

    async def fetch_requests(self, year: int, application_id: str | None = None) -> list[RequestRecord]:
        await self._read(year)
        return [
            r
            for r in self.requests.values()
            if r.year == year and (application_id is None or r.application_id == application_id)
        ]

    async def fetch_payer_shares(self, year: int, request_ids: Sequence[str] | None = None) -> list[PayerShareRecord]:
        await self._read(year)
        return [
            s
            for s in self.payer_shares.values()
            if s.year == year and (request_ids is None or s.request_id in request_ids)
        ]

    async def fetch_birthdates(self, year: int, person_cm_ids: Sequence[int]) -> dict[int, str]:
        await self._read(year)
        return {p: self.birthdates[p] for p in person_cm_ids if p in self.birthdates}

    async def fetch_application(self, year: int, household_cm_id: int) -> ApplicationRecord | None:
        found = [a for a in self.applications.values() if a.year == year and a.household_cm_id == household_cm_id]
        return found[0] if found else None

    async def fetch_request(self, record_id: str) -> RequestRecord | None:
        return self.requests.get(record_id)

    async def find_active_request(
        self, year: int, household_cm_id: int, person_cm_id: int, session_cm_id: int
    ) -> RequestRecord | None:
        for r in self.requests.values():
            same_subject = (
                r.person_cm_id == person_cm_id
                if person_cm_id
                else (r.household_cm_id == household_cm_id and r.person_cm_id == 0)
            )
            if r.year == year and same_subject and r.session_cm_id == session_cm_id and r.status == "active":
                return r
        return None

    async def fetch_corrections(self, year: int, application_id: str | None) -> list[CorrectionRecord]:
        return [
            c
            for c in self.corrections
            if c.year == year and (application_id is None or c.application_id == application_id)
        ]

    async def fetch_capacity(self, year: int, session_cm_id: int) -> CapacityRecord | None:
        return self.capacity.get((year, session_cm_id))

    async def fetch_equity_answers(self, year: int, person_cm_ids: Sequence[int]) -> dict[int, EquityAnswers]:
        return {p: self.equity[p] for p in person_cm_ids if p in self.equity}

    async def load_intake_rules(self, year: int) -> AidRules | None:
        """`rules` stands for the newest version with programs and cost approved; None = none yet."""
        await self._read(year)
        return self.rules

    async def load_equity_rules(self, year: int) -> AidRules | None:
        """`equity_rules` stands for the newest version with its equity section approved."""
        await self._read(year)
        return self.equity_rules

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
        self.operations.append(
            {
                "writes": tuple(writes),
                "actor": actor,
                "reason": reason,
                "require_reason": require_reason,
                "allow_chunking": allow_chunking,
            }
        )
        result = commit_aid_writes(
            cast(PocketBase, _BatchTwin(self)),
            writes,
            actor=actor,
            operation_id=operation_id,
            reason=reason,
            require_reason=require_reason,
            allow_chunking=allow_chunking,
            max_requests=self.max_batch_requests,
        )
        self.results.append(result)
        return result

    def apply_batch(self, requests: list[dict[str, Any]]) -> httpx.Response:
        """One PocketBase batch: every sub-request applies, or none does."""
        saved = {name: copy.copy(getattr(self, name)) for name in _TABLES}
        results: list[dict[str, Any]] = []
        for index, item in enumerate(requests):
            parts = item["url"].strip("/").split("/")  # api/collections/<name>/records[/<id>]
            collection, record_id = parts[2], (parts[4] if len(parts) > 4 else "")
            try:
                if self.fail_on == (collection, item["method"]):
                    raise ValueError(f"{collection} refused the write")
                body = self._apply(item["method"], collection, record_id, item.get("body") or {})
                self._enforce(collection)
            except (KeyError, ValueError) as exc:
                for name, value in saved.items():
                    setattr(self, name, value)
                failed = {
                    str(index): {
                        "code": "batch_request_failed",
                        "message": "Batch request failed.",
                        "response": {"status": 400, "message": str(exc), "data": {}},
                    }
                }
                return httpx.Response(
                    400, json={"status": 400, "message": "Batch transaction failed.", "data": {"requests": failed}}
                )
            results.append({"status": 204 if body is None else 200, "body": body})
        return httpx.Response(200, json=results)

    def _apply(self, method: str, collection: str, record_id: str, body: dict[str, Any]) -> dict[str, Any] | None:
        if collection == COLLECTION:
            self.change_log.append(dict(body))
            return {**body, "id": self._id()}
        rid = record_id or str(body["id"])
        self.writes.append((f"{method} {collection}", rid))
        if collection == AID_APPLICATIONS and method == "POST":
            self.applications[rid] = ApplicationRecord(
                id=rid,
                year=body["year"],
                household_cm_id=body["household_cm_id"],
                status=body["status"],
                answers=dict(body["answers"]),
                member_person_cm_ids=tuple(body["member_person_cm_ids"]),
                flags=tuple(body["flags"]),
            )
        elif collection == AID_APPLICATIONS:
            self.applications[rid] = replace(self.applications[rid], **_tupled(body))
        elif collection == AID_REQUESTS and method == "POST":
            self.requests[rid] = RequestRecord(
                id=rid,
                year=body["year"],
                application_id=body["application"],
                household_cm_id=body["household_cm_id"],
                person_cm_id=body["person_cm_id"],
                session_cm_id=body["session_cm_id"],
                program_key=body["program_key"],
                program_option_text=body["program_option_text"],
                program_option_key=body["program_option_key"],
                session_resolution=body["session_resolution"],
                ask=body["ask"],
                headcount_non_infant=body.get("headcount_non_infant", 0),
                headcount_infant=body.get("headcount_infant", 0),
                headcount_source=body.get("headcount_source", ""),
                status=body["status"],
                duplicate_of=body.get("duplicate_of", ""),
                flags=tuple(body["flags"]),
                equity=equity_from_json(body.get("equity")),
            )
        elif collection == AID_REQUESTS:
            self.requests[rid] = replace(self.requests[rid], **_request_changes(body))
        elif collection == AID_PAYER_SHARES and method == "POST":
            self.payer_shares[rid] = PayerShareRecord(
                id=rid,
                year=body["year"],
                request_id=body["request"],
                household_cm_id=body["household_cm_id"],
                share_pct=_exact_pct(body["share_pct"]),
                source=body["source"],
                actor=body["actor"],
                note=body.get("note", ""),
            )
        elif collection == AID_PAYER_SHARES and method == "PATCH":
            converted: dict[str, Any] = {k: _exact_pct(v) if k == "share_pct" else v for k, v in body.items()}
            self.payer_shares[rid] = replace(self.payer_shares[rid], **converted)
        elif collection == AID_PAYER_SHARES:
            del self.payer_shares[rid]
            return None
        elif collection == AID_APPLICATION_CORRECTIONS:
            created = f"2027-01-01 00:00:{len(self.corrections):02d}.000Z"
            self.corrections.append(
                CorrectionRecord(
                    id=rid,
                    year=body["year"],
                    application_id=body["application"],
                    request_id=body.get("request", ""),
                    field=body["field"],
                    new_value=body["new_value"],
                    original_value=body["original_value"],
                    reason=body["reason"],
                    actor=body["actor"],
                    created=created,
                )
            )
            return {**body, "id": rid, "created": created}
        elif collection == AID_SESSION_CAPACITY and method == "POST":
            if (body["year"], body["session_cm_id"]) in self.capacity:
                raise ValueError("UNIQUE constraint failed: idx_aid_session_capacity_year_session")
            self.capacity[(body["year"], body["session_cm_id"])] = CapacityRecord(
                rid, body["year"], body["session_cm_id"], body["capacity"], body["note"], body["actor"]
            )
        elif collection == AID_SESSION_CAPACITY:
            key = next(k for k, c in self.capacity.items() if c.id == rid)
            self.capacity[key] = replace(self.capacity[key], **body)
        else:
            raise ValueError(f"the fake has no {method} for {collection}")
        return {**body, "id": rid}

    def _enforce(self, collection: str) -> None:
        """PocketBase's own refusals, checked after every sub-request the way SQLite checks
        each statement: the unique indexes (the partial ones on aid_requests only count
        `active` rows), the relations a create names, and the field limits a value can
        break (pocketbase/pb_migrations/1500000200-1500000204). Any breach fails the batch."""
        if collection == AID_APPLICATIONS:
            _unique(
                "aid_applications (year, household_cm_id)",
                [(a.year, a.household_cm_id) for a in self.applications.values()],
            )
        elif collection == AID_REQUESTS:
            requests = list(self.requests.values())
            _unique(
                "idx_aid_requests_intake_key",
                [(r.year, r.household_cm_id, r.person_cm_id, r.program_key, r.program_option_key) for r in requests],
            )
            active = [r for r in requests if r.session_cm_id > 0 and r.status == "active"]
            _unique(
                "idx_aid_requests_person_session",
                [(r.year, r.person_cm_id, r.session_cm_id) for r in active if r.person_cm_id > 0],
            )
            _unique(
                "idx_aid_requests_household_session",
                [(r.year, r.household_cm_id, r.session_cm_id) for r in active if r.person_cm_id == 0],
            )
            for r in requests:
                if r.application_id not in self.applications:
                    raise ValueError(f"aid_requests.application {r.application_id!r} does not exist")
                if r.ask < 0:
                    raise ValueError(f"aid_requests.ask {r.ask} is below its minimum 0")
                if not (0 <= r.headcount_non_infant <= 50 and 0 <= r.headcount_infant <= 20):
                    raise ValueError(
                        f"aid_requests headcount {r.headcount_non_infant}/{r.headcount_infant} is out of range"
                    )
                if len(r.program_option_text) > 500 or len(r.program_option_key) > 500:
                    raise ValueError("aid_requests option text is longer than 500 characters")
        elif collection == AID_PAYER_SHARES:
            shares = list(self.payer_shares.values())
            _unique("idx_aid_payer_shares_request_household", [(s.request_id, s.household_cm_id) for s in shares])
            for share in shares:
                if share.request_id not in self.requests:
                    raise ValueError(f"aid_payer_shares.request {share.request_id!r} does not exist")
        elif collection == AID_APPLICATION_CORRECTIONS:
            for c in self.corrections:
                if c.application_id not in self.applications or (c.request_id and c.request_id not in self.requests):
                    raise ValueError("aid_application_corrections names a record that does not exist")

    # helpers for assertions
    def request_for(
        self, *, person: int = 0, household: int = 0, program: str, status: str | None = None
    ) -> RequestRecord:
        found = [
            r
            for r in self.requests.values()
            if r.program_key == program
            and (not person or r.person_cm_id == person)
            and (not household or r.household_cm_id == household)
            and (status is None or r.status == status)
        ]
        assert len(found) == 1, found
        return found[0]


def _unique(index: str, keys: Sequence[object]) -> None:
    if len(set(keys)) != len(keys):
        raise ValueError(f"UNIQUE constraint failed: {index}")


def seeded_store() -> FakeAidStore:
    """Two families plus two rows intake must skip. Fictional throughout."""
    store = FakeAidStore()
    store.rules = intake_rules()
    store.fa_rows = [
        fa_row(1000011, 1000001, summer="Session 2", summer_ask=1500.0, total_gross_income=85000.0),
        fa_row(1000012, 1000001, fc="Family Camp 6", fc_ask=900.0, total_gross_income=85000.0),
        fa_row(1000021, 1000002, summer="Taste of Camp", summer_ask=800.0, total_gross_income=60000.0),
        fa_row(1000031, 0, summer="Session 2", summer_ask=500.0),  # no household
        fa_row(1000041, 1000004, interest=True, registration_ask=500.0),  # registration interest only
    ]
    store.attendees = [
        AttendeeRow(1000011, 1000001, 1000101, 2),
        AttendeeRow(1000012, 1000001, 1000202, 2),
        AttendeeRow(1000021, 1000002, 1000105, 8),
    ]
    store.billing = [
        BillingLine(1000001, 0, 0, 17006, "Family Camp 6", "Family Camp 6 - Adult", 2, 600.0, False),
        BillingLine(1000001, 1000012, 1000202, 17006, "Family Camp 6", "Family Camp 6 - Child", 1, 600.0, False),
    ]
    return store
