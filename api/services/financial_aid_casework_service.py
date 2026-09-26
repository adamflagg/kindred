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

from collections.abc import Awaitable, Callable, Sequence
from typing import Protocol

from api.constants.collections import AID_APPLICATION_CORRECTIONS
from api.schemas.financial_aid_intake import CorrectionOut
from api.services.financial_aid_corrections import (
    APPLICATION_CORRECTABLE,
    REQUEST_CORRECTABLE,
    CorrectionError,
    effective_values,
    parse_new_value,
)
from api.services.financial_aid_intake_types import (
    AliasRow,
    ApplicationRecord,
    CapacityRecord,
    CorrectionRecord,
    EquityAnswers,
    RequestRecord,
    SessionRow,
)
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
