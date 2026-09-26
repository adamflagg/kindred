"""Campership casework: staff reads and writes over intake (sub-project 5).

Every write is validated here, then committed as ONE operation through the
store's `commit` (sub-project 4a's commit_aid_writes): each record write and its
aid_change_log row in one batch, with the staff member as actor and the
reason (spec 14.4). Nothing writes first and logs after.
Nothing here edits a synced value: corrections are rows in
aid_application_corrections (spec 3.3), and session, duplicate and headcount
edits are fields intake treats as staff-owned (financial_aid_intake_plan).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import replace
from decimal import Decimal
from typing import Any, Protocol

from api.constants.collections import (
    AID_APPLICATION_CORRECTIONS,
    AID_REQUESTS,
    AID_SESSION_ALIASES,
    AID_SESSION_CAPACITY,
)
from api.schemas.financial_aid_intake import (
    AnswerOut,
    CapacityOut,
    CorrectionOut,
    FlagOut,
    IssueOut,
    PayerShareOut,
    RequestOut,
)
from api.services.financial_aid_corrections import (
    APPLICATION_CORRECTABLE,
    REQUEST_CORRECTABLE,
    CorrectionError,
    EffectiveValue,
    effective_values,
    parse_new_value,
)
from api.services.financial_aid_intake_plan import request_fields
from api.services.financial_aid_intake_types import (
    PROGRAM_FAMILY_CAMP,
    RESOLUTION_STAFF,
    STAFF_HEADCOUNT_SOURCES,
    STATUS_ACTIVE,
    STATUS_DUPLICATE,
    STATUS_WITHDRAWN,
    AliasRow,
    ApplicationRecord,
    CapacityRecord,
    CorrectionRecord,
    EquityAnswers,
    PayerShareRecord,
    RequestRecord,
    SessionRow,
)
from api.services.financial_aid_session_resolver import PROGRAM_SESSION_TYPES
from bunking.financial_aid.change_diff import values_equal
from bunking.financial_aid.change_log import AidOperationResult, AidWrite


class CaseworkNotFoundError(LookupError):
    """The named application, request or session does not exist."""


class CaseworkValidationError(ValueError):
    """A staff write that cannot be applied; the message is safe to show."""


class DuplicateRequestError(RuntimeError):
    """The camper or family already holds an active request for that session."""

    def __init__(self, holder_id: str) -> None:
        super().__init__("an active request for this camper or family and session already exists")
        self.holder_id = holder_id


class CaseworkStore(Protocol):
    async def fetch_application(self, year: int, household_cm_id: int) -> ApplicationRecord | None: ...
    async def fetch_applications(self, year: int) -> list[ApplicationRecord]: ...
    async def fetch_request(self, record_id: str) -> RequestRecord | None: ...
    async def fetch_requests(self, year: int, application_id: str | None = None) -> list[RequestRecord]: ...
    async def find_active_request(
        self, year: int, household_cm_id: int, person_cm_id: int, session_cm_id: int
    ) -> RequestRecord | None: ...
    async def fetch_sessions(self, year: int) -> list[SessionRow]: ...
    async def fetch_aliases(self, year: int) -> list[AliasRow]: ...
    async def fetch_corrections(self, year: int, application_id: str | None) -> list[CorrectionRecord]: ...
    async def fetch_capacity(self, year: int, session_cm_id: int) -> CapacityRecord | None: ...
    async def fetch_payer_shares(
        self, year: int, request_ids: Sequence[str] | None = None
    ) -> list[PayerShareRecord]: ...
    async def fetch_equity_answers(self, year: int, person_cm_ids: Sequence[int]) -> dict[int, EquityAnswers]: ...
    async def commit(
        self,
        writes: Sequence[AidWrite],
        *,
        actor: str,
        operation_id: str | None = None,
        reason: str | None = None,
        require_reason: bool = False,
        allow_chunking: bool = False,
    ) -> AidOperationResult: ...


def correction_out(record: CorrectionRecord) -> CorrectionOut:
    return CorrectionOut(
        id=record.id,
        field=record.field,
        request_id=record.request_id,
        new_value=record.new_value,
        original_value=record.original_value,
        reason=record.reason,
        actor=record.actor,
        created=record.created,
    )


_CLOSED = frozenset({STATUS_DUPLICATE, STATUS_WITHDRAWN})


def _changed(current: Mapping[str, Any], wanted: Mapping[str, Any]) -> dict[str, Any]:
    """The fields of `wanted` that differ from `current`, as the change log judges it."""
    return {key: value for key, value in wanted.items() if not values_equal(current.get(key), value)}


def answer_out(value: EffectiveValue) -> AnswerOut:
    return AnswerOut(
        field=value.field,
        synced=value.synced,
        effective=value.effective,
        corrected=value.corrected,
        changed_since_correction=value.changed_since_correction,
        history=[correction_out(c) for c in value.history],
    )


def payer_share_out(share: PayerShareRecord, amount: Decimal | None = None) -> PayerShareOut:
    return PayerShareOut(
        id=share.id,
        household_cm_id=share.household_cm_id,
        share_pct=share.share_pct,
        amount=amount,
        source=share.source,
        actor=share.actor,
        note=share.note,
    )


def request_out(
    record: RequestRecord,
    corrections: Sequence[CorrectionRecord],
    shares: Sequence[PayerShareRecord] = (),
    issues: Sequence[IssueOut] = (),
) -> RequestOut:
    # The mirror stores a blank ask as 0; a 0 ask is unknown (Task 11), so it shows blank.
    ask = effective_values({"ask": record.ask or None}, REQUEST_CORRECTABLE, corrections, record.id)["ask"]
    return RequestOut(
        id=record.id,
        household_cm_id=record.household_cm_id,
        person_cm_id=record.person_cm_id,
        session_cm_id=record.session_cm_id,
        program_key=record.program_key,
        program_option_text=record.program_option_text,
        session_resolution=record.session_resolution,
        status=record.status,
        duplicate_of=record.duplicate_of,
        ask=answer_out(ask),
        headcount_non_infant=record.headcount_non_infant,
        headcount_infant=record.headcount_infant,
        headcount_source=record.headcount_source,
        flags=[FlagOut(code=str(f.get("code", "")), detail=dict(f.get("detail", {}))) for f in record.flags],
        payer_shares=[payer_share_out(s) for s in shares if s.request_id == record.id],
        issues=list(issues),
    )


class FinancialAidCaseworkService:
    def __init__(
        self,
        store: CaseworkStore,
        rebuild: Callable[[int], Awaitable[object]] | None = None,
    ) -> None:
        self._store = store
        self._rebuild = rebuild

    async def _require_application(self, year: int, household_cm_id: int) -> ApplicationRecord:
        application = await self._store.fetch_application(year, household_cm_id)
        if application is None:
            raise CaseworkNotFoundError("no application for that family and season")
        return application

    async def add_correction(
        self,
        year: int,
        household_cm_id: int,
        field: str,
        new_value: str | None,
        reason: str,
        actor: str,
        request_id: str = "",
    ) -> CorrectionOut:
        application = await self._require_application(year, household_cm_id)
        if request_id:
            request = await self._store.fetch_request(request_id)
            if request is None or request.application_id != application.id:
                raise CaseworkNotFoundError("no such request on this application")
            kinds, synced = REQUEST_CORRECTABLE, {"ask": request.ask or None}  # a 0 ask is a blank
        else:
            kinds, synced = APPLICATION_CORRECTABLE, dict(application.answers)
        kind = kinds.get(field)
        if kind is None:
            raise CorrectionError(f"{field} cannot be corrected here")
        if not reason.strip():
            raise CorrectionError("a reason is required")
        value = parse_new_value(kind, new_value)
        existing = await self._store.fetch_corrections(year, application.id)
        current = effective_values(synced, {field: kind}, existing, request_id)[field]
        row = {
            "year": year,
            "application": application.id,
            "request": request_id,
            "field": field,
            "new_value": value,
            "original_value": current.synced,
            "reason": reason.strip(),
            "actor": actor,
        }
        # A create carries no `before`, so the log's `after` names the value it replaced.
        write = AidWrite(
            collection=AID_APPLICATION_CORRECTIONS,
            action="create",
            year=year,
            data=row,
            log_action="correct",
            after={"field": field, "value": value or current.synced, "previous_value": current.effective},
        )
        result = await self._store.commit([write], actor=actor, reason=reason.strip(), require_reason=True)
        stored = result.records[0] or {}
        return correction_out(
            CorrectionRecord(
                id=result.record_ids[0],
                year=year,
                application_id=application.id,
                request_id=request_id,
                field=field,
                new_value=value,
                original_value=current.synced,
                reason=reason.strip(),
                actor=actor,
                created=str(stored.get("created", "")),
            )
        )

    async def _require_request(self, request_id: str) -> RequestRecord:
        request = await self._store.fetch_request(request_id)
        if request is None:
            raise CaseworkNotFoundError("no such request")
        return request

    async def _request_out(self, record: RequestRecord) -> RequestOut:
        corrections = await self._store.fetch_corrections(record.year, record.application_id)
        return request_out(record, corrections, await self._store.fetch_payer_shares(record.year, [record.id]))

    def _request_update(self, request: RequestRecord, changes: Mapping[str, Any], log_action: str) -> AidWrite:
        return AidWrite(
            collection=AID_REQUESTS,
            action="update",
            year=request.year,
            record_id=request.id,
            before=request_fields(request),
            data=changes,
            log_action=log_action,
        )

    async def _commit_request_change(
        self,
        request: RequestRecord,
        wanted: Mapping[str, Any],
        log_action: str,
        *,
        actor: str,
        reason: str,
    ) -> RequestRecord:
        """Update one request as one operation, with a required reason. Nothing changed:
        nothing is written (the helper refuses an empty change)."""
        changes = _changed(request_fields(request), wanted)
        if changes:
            await self._store.commit(
                [self._request_update(request, changes, log_action)],
                actor=actor,
                reason=reason.strip(),
                require_reason=True,
            )
        return replace(request, **changes)

    async def resolve_session(
        self,
        request_id: str,
        session_cm_id: int,
        reason: str,
        remember_alias: bool,
        actor: str,
    ) -> RequestOut:
        request = await self._require_request(request_id)
        if request.status in _CLOSED:
            raise CaseworkValidationError(f"a {request.status} request cannot be re-pointed")
        if not reason.strip():
            raise CaseworkValidationError("a reason is required")
        sessions = await self._store.fetch_sessions(request.year)
        session = next((s for s in sessions if s.cm_id == session_cm_id), None)
        if session is None or session.session_type not in PROGRAM_SESSION_TYPES[request.program_key]:
            raise CaseworkValidationError("that session is not one this program's requests can name")
        holder = await self._store.find_active_request(
            request.year, request.household_cm_id, request.person_cm_id, session_cm_id
        )
        if holder is not None and holder.id != request.id:
            raise DuplicateRequestError(holder.id)
        changes = _changed(
            request_fields(request),
            {
                "session_cm_id": session_cm_id,
                "session_resolution": RESOLUTION_STAFF,
                "status": STATUS_ACTIVE,
                "duplicate_of": "",
            },
        )
        writes = [self._request_update(request, changes, "resolve_session")] if changes else []
        remember = remember_alias and bool(request.program_option_key)
        alias = AliasRow(request.program_key, request.program_option_key, session_cm_id)
        if remember and alias not in await self._store.fetch_aliases(request.year):
            writes.append(
                AidWrite(
                    collection=AID_SESSION_ALIASES,
                    action="create",
                    year=request.year,
                    data={
                        "year": request.year,
                        "program_key": request.program_key,
                        "option_key": request.program_option_key,
                        "option_text": request.program_option_text,
                        "session_cm_id": session_cm_id,
                        "actor": actor,
                        "note": reason.strip(),
                    },
                    log_action="create_alias",
                )
            )
        if writes:  # the resolution and its alias: one staff action, one operation, one batch
            await self._store.commit(writes, actor=actor, reason=reason.strip(), require_reason=True)
            if remember and self._rebuild is not None:
                await self._rebuild(request.year)  # intake's own system:intake operation (Task 7)
        return await self._request_out(replace(request, **changes))

    async def mark_duplicate(self, request_id: str, duplicate_of: str, reason: str, actor: str) -> RequestOut:
        request = await self._require_request(request_id)
        survivor = await self._require_request(duplicate_of)
        if request.id == survivor.id:
            raise CaseworkValidationError("a request cannot duplicate itself")
        # Camper (or adult) grain: the same person, whichever household filed it -- a second
        # parent's request is a duplicate that becomes a payer share (spec 9.2). Family-camp
        # grain: the same household.
        same_subject = (
            request.person_cm_id == survivor.person_cm_id
            if request.person_cm_id
            else (survivor.person_cm_id == 0 and request.household_cm_id == survivor.household_cm_id)
        )
        if request.year != survivor.year or not same_subject:
            raise CaseworkValidationError("the two requests are not for the same camper or family")
        # Spec 2 item 9: a duplicate is the same camper AND the same session. 0 keeps "this
        # unmatched request is really that one" resolvable once it names a real session.
        if request.program_key != survivor.program_key or request.session_cm_id not in (0, survivor.session_cm_id):
            raise CaseworkValidationError("the two requests are not for the same program and session")
        if survivor.status != STATUS_ACTIVE:
            raise CaseworkValidationError("the request kept must be active")
        if request.status in _CLOSED:
            raise CaseworkValidationError(f"a {request.status} request cannot be marked again")
        if not reason.strip():
            raise CaseworkValidationError("a reason is required")
        updated = await self._commit_request_change(
            request,
            {"status": STATUS_DUPLICATE, "duplicate_of": survivor.id},
            "mark_duplicate",
            actor=actor,
            reason=reason,
        )
        return await self._request_out(updated)

    async def set_headcount(
        self,
        request_id: str,
        non_infant: int,
        infant: int,
        source: str,
        reason: str,
        actor: str,
    ) -> RequestOut:
        request = await self._require_request(request_id)
        if request.person_cm_id != 0 or request.program_key != PROGRAM_FAMILY_CAMP:
            raise CaseworkValidationError("a headcount belongs to a family-camp request")
        if request.status in _CLOSED:
            raise CaseworkValidationError(f"a {request.status} request cannot be priced")
        if source not in STAFF_HEADCOUNT_SOURCES:
            raise CaseworkValidationError("source must be declared or override")
        if non_infant < 0 or infant < 0 or non_infant + infant == 0:
            raise CaseworkValidationError("a family needs at least one person")
        if not reason.strip():
            raise CaseworkValidationError("a reason is required")
        updated = await self._commit_request_change(
            request,
            {"headcount_non_infant": non_infant, "headcount_infant": infant, "headcount_source": source},
            "set_headcount",
            actor=actor,
            reason=reason,
        )
        return await self._request_out(updated)

    async def set_capacity(self, year: int, session_cm_id: int, capacity: int, note: str, actor: str) -> CapacityOut:
        if capacity < 0:
            raise CaseworkValidationError("capacity cannot be negative")
        sessions = await self._store.fetch_sessions(year)
        if not any(s.cm_id == session_cm_id for s in sessions):
            raise CaseworkNotFoundError("no such session in that season")
        current = await self._store.fetch_capacity(year, session_cm_id)
        data = {
            "year": year,
            "session_cm_id": session_cm_id,
            "capacity": capacity,
            "note": note.strip(),
            "actor": actor,
        }
        if current is None:
            write = AidWrite(
                collection=AID_SESSION_CAPACITY, action="create", year=year, data=data, log_action="set_capacity"
            )
            should_write = True
        else:
            before = {
                "year": current.year,
                "session_cm_id": current.session_cm_id,
                "capacity": current.capacity,
                "note": current.note,
                "actor": current.actor,
            }
            changes = _changed(before, data)
            # A different staff member re-entering the same figure is not a change (the brief):
            # `actor` alone never triggers a write, though it IS written when something real did.
            should_write = any(key != "actor" for key in changes)
            write = AidWrite(
                collection=AID_SESSION_CAPACITY,
                action="update",
                year=year,
                record_id=current.id,
                before=before,
                data=changes,
                log_action="set_capacity",
            )
        if should_write:
            await self._store.commit([write], actor=actor, reason=note.strip())
        return CapacityOut(year=year, session_cm_id=session_cm_id, capacity=capacity, note=note.strip(), actor=actor)
