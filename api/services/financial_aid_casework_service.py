"""Campership casework: staff reads and writes over intake (sub-project 5).

Every write is validated here, then committed as ONE operation through the
store's `commit` (sub-project 4a's commit_aid_writes): each record write and its
aid_change_log row in one batch, with the staff member as actor and the
reason (spec 14.4). Nothing writes first and logs after.
Nothing here edits a synced value: corrections are rows in
aid_application_corrections (spec 3.3), and session, duplicate and headcount
edits are fields intake treats as staff-owned (financial_aid_intake_plan).

The writers that touch what an intake build plans (a request's session, status,
headcount and payer shares) take the build's per-season lock (`season_lock`) and
re-read the request inside it, so a build cannot commit over a staff write it
read before. Corrections and capacity are not intake's and do not wait.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from contextlib import asynccontextmanager
from dataclasses import replace
from decimal import Decimal
from typing import Any, Final, Protocol

from api.constants.collections import (
    AID_APPLICATION_CORRECTIONS,
    AID_PAYER_SHARES,
    AID_REQUESTS,
    AID_SESSION_CAPACITY,
)
from api.schemas.financial_aid_intake import (
    AnswerOut,
    ApplicationDetailResponse,
    ApplicationListResponse,
    ApplicationSummaryOut,
    CapacityOut,
    CorrectionOut,
    FlagOut,
    IssueOut,
    PayerShareOut,
    RequestOut,
    RequestQueueResponse,
)
from api.services.financial_aid_calc_inputs import (
    CalculatorInputs,
    calculator_inputs,
    request_issues,
)
from api.services.financial_aid_corrections import (
    APPLICATION_CORRECTABLE,
    INCOME_OVERRIDE_FIELD,
    REQUEST_CORRECTABLE,
    REVERT,
    CorrectionError,
    EffectiveValue,
    effective_values,
    parse_new_value,
)
from api.services.financial_aid_household import TEXT_FIELDS
from api.services.financial_aid_intake_plan import request_fields, share_entity_id
from api.services.financial_aid_intake_service import season_lock
from api.services.financial_aid_intake_types import (
    PROGRAM_FAMILY_CAMP,
    RESOLUTION_STAFF,
    SHARE_SOURCE_STAFF,
    STAFF_HEADCOUNT_SOURCES,
    STATUS_ACTIVE,
    STATUS_DUPLICATE,
    STATUS_UNMATCHED,
    STATUS_WITHDRAWN,
    ApplicationRecord,
    CapacityRecord,
    CorrectionRecord,
    EquityAnswers,
    PayerShareRecord,
    RequestRecord,
    SessionRow,
)
from api.services.financial_aid_payer_shares import (
    PayerShareError,
    ShareSpec,
    fill_remainder,
    pct_from_dollars,
    share_status,
    split_award,
    validate_shares,
)
from api.services.financial_aid_request_overrides import DEFAULT_REASON_CODES
from api.services.financial_aid_session_resolver import PROGRAM_SESSION_TYPES
from bunking.financial_aid.change_diff import values_equal
from bunking.financial_aid.change_log import AidOperationResult, AidWrite
from bunking.financial_aid.rules.schema import AidRules


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


_CONFLICT_CODES = frozenset({"income_conflict", "household_answer_conflict"})


_ANSWER_FIELDS: Final = frozenset(APPLICATION_CORRECTABLE) | frozenset(REQUEST_CORRECTABLE)


def _live_correction_count(corrections: Sequence[CorrectionRecord]) -> int:
    """The family's corrected intake answers. A request override (cost, Include) is a correction row too
    (financial_aid_request_overrides) but no corrected answer, so it never counts here."""
    latest: dict[tuple[str, str], CorrectionRecord] = {}
    for c in sorted(corrections, key=lambda c: (c.created, c.id)):
        if c.field in _ANSWER_FIELDS:
            latest[(c.request_id, c.field)] = c
    return sum(1 for c in latest.values() if c.new_value != REVERT)


def _application_flags(flags: Sequence[Mapping[str, Any]], answers: Mapping[str, EffectiveValue]) -> list[FlagOut]:
    out: list[FlagOut] = []
    for flag in flags:
        code = str(flag.get("code", ""))
        detail = dict(flag.get("detail", {}))
        if code in _CONFLICT_CODES:
            fields = dict(detail.get("fields", {}))
            # An income override settles an income conflict, as unresolved_income_conflict
            # (financial_aid_calc_inputs) already rules for the hold.
            overridden = code == "income_conflict" and bool(answers[INCOME_OVERRIDE_FIELD].effective)
            detail["resolved_by_correction"] = overridden or (
                bool(fields) and all(answers[name].corrected for name in fields if name in answers)
            )
        out.append(FlagOut(code=code, detail=detail))
    return out


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


class AwardSource(Protocol):
    """A request's current priced amount: its decided award, or a calculator result.
    Sub-project 10 supplies it. Until then there is none, so only a % can be entered and
    no dollars are shown."""

    async def __call__(self, request: RequestRecord) -> Decimal | None: ...


def request_out(
    record: RequestRecord,
    corrections: Sequence[CorrectionRecord],
    shares: Sequence[PayerShareRecord] = (),
    issues: Sequence[IssueOut] = (),
    award: Decimal | None = None,
) -> RequestOut:
    # The mirror stores a blank ask as 0; a 0 ask is unknown (Task 11), so it shows blank.
    ask = effective_values({"ask": record.ask or None}, REQUEST_CORRECTABLE, corrections, record.id)["ask"]
    own = [s for s in shares if s.request_id == record.id]
    status = share_status(own) if record.status in (STATUS_ACTIVE, STATUS_UNMATCHED) else ""
    # Dollars are read-only: computed from the current award, never stored (owner ruling 2026-09-25).
    amounts = split_award(award, own, record.household_cm_id) if award is not None and status == "complete" else {}
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
        payer_shares=[payer_share_out(s, amounts.get(s.household_cm_id)) for s in own],
        payer_share_status=status,
        issues=list(issues),
    )


def _pct_text(pct: Decimal) -> str:
    return f"{pct.normalize():f}"


def _share_fields(share: PayerShareRecord) -> dict[str, Any]:
    """A stored share as its log `before` (4a keeps only what changed)."""
    return {
        "year": share.year,
        "request": share.request_id,
        "household_cm_id": share.household_cm_id,
        "share_pct": _pct_text(share.share_pct),
        "source": share.source,
        "actor": share.actor,
        "note": share.note,
    }


ReasonCodes = Callable[[int], Awaitable[tuple[str, ...]]]  # the season's cost.override_reasons (Decision 6)


class FinancialAidCaseworkService:
    def __init__(
        self,
        store: CaseworkStore,
        award_source: AwardSource | None = None,
        reason_codes: ReasonCodes | None = None,
    ) -> None:
        self._store = store
        self._award_source = award_source
        self._reason_codes = reason_codes

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

    @asynccontextmanager
    async def _locked(self, request_id: str) -> AsyncIterator[RequestRecord]:
        """The request, read again under its season's lock: what a build left, never what
        was there before it. Validate and commit inside; trigger no build until it exits."""
        year = (await self._require_request(request_id)).year
        async with season_lock(year):
            yield await self._require_request(request_id)

    async def _award(self, request: RequestRecord) -> Decimal | None:
        return None if self._award_source is None else await self._award_source(request)

    async def _request_out(self, record: RequestRecord) -> RequestOut:
        corrections = await self._store.fetch_corrections(record.year, record.application_id)
        shares = await self._store.fetch_payer_shares(record.year, [record.id])
        return request_out(record, corrections, shares, award=await self._award(record))

    @staticmethod
    def _require_live(request: RequestRecord, reason: str) -> None:
        if request.status in _CLOSED:
            raise CaseworkValidationError(f"a {request.status} request has no payers to set")
        if not reason.strip():
            raise CaseworkValidationError("a reason is required")

    async def _replace_shares(
        self,
        request: RequestRecord,
        shares: Sequence[ShareSpec],
        *,
        reason: str,
        actor: str,
        action: str,
        entered: Mapping[str, Any] | None = None,
    ) -> RequestOut:
        """Replace the request's shares with `shares` as ONE operation: every create, update
        and delete, each with its log row, in one batch (sub-project 4a). All or nothing."""
        try:
            validate_shares(shares)
        except PayerShareError as exc:
            raise CaseworkValidationError(str(exc)) from exc
        existing = await self._store.fetch_payer_shares(request.year, [request.id])
        by_household = {s.household_cm_id: s for s in existing}
        wanted = {s.household_cm_id: s for s in shares}
        entered_household = None if entered is None else entered["household_cm_id"]
        writes: list[AidWrite] = []
        for household_cm_id, old in sorted(by_household.items()):
            if household_cm_id not in wanted:
                writes.append(
                    AidWrite(
                        collection=AID_PAYER_SHARES,
                        action="delete",
                        year=request.year,
                        record_id=old.id,
                        before=_share_fields(old),
                        log_action=action,
                        entity_id=share_entity_id(request.id, household_cm_id),
                    )
                )
        for household_cm_id, new in sorted(wanted.items()):
            # "60", never Decimal's "6E+1": the log shows what staff typed (PocketBase parses the text).
            fields: dict[str, Any] = {
                "share_pct": _pct_text(new.share_pct),
                "source": SHARE_SOURCE_STAFF,
                "actor": actor,
                "note": reason.strip(),
            }
            extra = {"entered": dict(entered)} if entered is not None and household_cm_id == entered_household else {}
            current = by_household.get(household_cm_id)
            if current is None:
                data = {"year": request.year, "request": request.id, "household_cm_id": household_cm_id, **fields}
                writes.append(
                    AidWrite(
                        collection=AID_PAYER_SHARES,
                        action="create",
                        year=request.year,
                        data=data,
                        after={**data, **extra},
                        log_action=action,
                        entity_id=share_entity_id(request.id, household_cm_id),
                    )
                )
            elif (current.share_pct, current.source) != (new.share_pct, SHARE_SOURCE_STAFF):
                before = _share_fields(current)
                writes.append(
                    AidWrite(
                        collection=AID_PAYER_SHARES,
                        action="update",
                        year=request.year,
                        record_id=current.id,
                        before=before,
                        data=fields,
                        after={**before, **fields, **extra},
                        log_action=action,
                        entity_id=share_entity_id(request.id, household_cm_id),
                    )
                )
        if writes:  # the whole set, including a two-way split's remainder: one operation, one batch
            await self._store.commit(writes, actor=actor, reason=reason.strip(), require_reason=True)
        return await self._request_out(request)

    async def set_payer_shares(
        self, request_id: str, shares: Sequence[ShareSpec], reason: str, actor: str
    ) -> RequestOut:
        async with self._locked(request_id) as request:
            self._require_live(request, reason)
            return await self._replace_shares(request, shares, reason=reason, actor=actor, action="set_payer_shares")

    async def set_household_share(
        self,
        request_id: str,
        household_cm_id: int,
        *,
        share_pct: Decimal | None,
        amount: Decimal | None,
        reason: str,
        actor: str,
    ) -> RequestOut:
        async with self._locked(request_id) as request:
            self._require_live(request, reason)
            entered: dict[str, Any] = {"household_cm_id": household_cm_id}
            try:
                if amount is not None and share_pct is None:
                    award = await self._award(request)
                    if award is None:
                        raise CaseworkValidationError("this request has no priced amount yet: enter a percentage")
                    pct = pct_from_dollars(amount, award)
                    entered.update({"amount": f"{amount:.2f}", "award": f"{award:.2f}"})
                elif share_pct is not None and amount is None:
                    pct = share_pct
                else:
                    raise CaseworkValidationError("enter a percentage or a dollar amount, exactly one")
                entered["share_pct"] = _pct_text(pct)
                existing = await self._store.fetch_payer_shares(request.year, [request.id])
                shares = fill_remainder(existing, household_cm_id, pct)
            except PayerShareError as exc:
                raise CaseworkValidationError(str(exc)) from exc
            return await self._replace_shares(
                request, shares, reason=reason, actor=actor, action="set_household_share", entered=entered
            )

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
        actor: str,
    ) -> RequestOut:
        async with self._locked(request_id) as request:
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
            # A staff resolution is the one session intake's rebuild keeps (registration decides
            # every other request's session; owner ruling 2026-09-27).
            resolved = await self._commit_request_change(
                request,
                {
                    "session_cm_id": session_cm_id,
                    "session_resolution": RESOLUTION_STAFF,
                    "status": STATUS_ACTIVE,
                    "duplicate_of": "",
                },
                "resolve_session",
                actor=actor,
                reason=reason,
            )
        return await self._request_out(resolved)

    async def mark_duplicate(self, request_id: str, duplicate_of: str, reason: str, actor: str) -> RequestOut:
        async with self._locked(request_id) as request:
            return await self._mark_duplicate(request, duplicate_of, reason, actor)

    async def _mark_duplicate(self, request: RequestRecord, duplicate_of: str, reason: str, actor: str) -> RequestOut:
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
        reason_code: str | None = None,
    ) -> RequestOut:
        async with self._locked(request_id) as request:
            return await self._set_headcount(request, non_infant, infant, source, reason, actor, reason_code)

    async def _set_headcount(
        self,
        request: RequestRecord,
        non_infant: int,
        infant: int,
        source: str,
        reason: str,
        actor: str,
        reason_code: str | None = None,
    ) -> RequestOut:
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
        if reason_code is not None:
            codes = await self._reason_codes(request.year) if self._reason_codes is not None else DEFAULT_REASON_CODES
            if reason_code not in codes:
                raise CaseworkValidationError(
                    f"{reason_code} is not one of {request.year}'s reason codes ({', '.join(codes)})"
                )
        updated = await self._commit_request_change(
            request,
            {"headcount_non_infant": non_infant, "headcount_infant": infant, "headcount_source": source},
            "set_headcount",
            actor=actor,
            # The code leads the operation's reason, the one place a log row keeps it.
            reason=f"{reason_code}: {reason.strip()}" if reason_code else reason,
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

    async def calculator_inputs_for(self, year: int, household_cm_id: int, rules: AidRules) -> list[CalculatorInputs]:
        """Every live request (active or unmatched) on the family's application, converted under
        `rules`, the version the caller prices with. Nothing is dropped: a request that cannot be
        priced comes back with request=None and the reason in `blocked`.

        These are UNLOCKED inputs: no posted round's lock is applied. A preview that must agree with
        the Requests grid prices through `bunking.financial_aid.decisions.request_inputs` instead."""
        if rules.year != year:
            raise CaseworkValidationError(f"the rules are for {rules.year}, not {year}")
        application = await self._require_application(year, household_cm_id)
        live = (STATUS_ACTIVE, STATUS_UNMATCHED)
        requests = [r for r in await self._store.fetch_requests(year, application.id) if r.status in live]
        corrections = await self._store.fetch_corrections(year, application.id)
        answers = effective_values(application.answers, APPLICATION_CORRECTABLE, corrections)
        sessions = {s.cm_id: s for s in await self._store.fetch_sessions(year)}
        shares = await self._store.fetch_payer_shares(year, [r.id for r in requests])
        equity = await self._store.fetch_equity_answers(year, [r.person_cm_id for r in requests if r.person_cm_id])
        return [
            calculator_inputs(
                request, application, answers, corrections, sessions, shares, equity.get(request.person_cm_id), rules
            )
            for request in requests
        ]

    async def list_applications(self, year: int) -> ApplicationListResponse:
        applications = await self._store.fetch_applications(year)
        requests = await self._store.fetch_requests(year)
        corrections = await self._store.fetch_corrections(year, None)
        requests_by_app: dict[str, list[RequestRecord]] = defaultdict(list)
        for request in requests:
            requests_by_app[request.application_id].append(request)
        corrections_by_app: dict[str, list[CorrectionRecord]] = defaultdict(list)
        for c in corrections:
            corrections_by_app[c.application_id].append(c)
        rows: list[ApplicationSummaryOut] = []
        for application in sorted(applications, key=lambda a: a.household_cm_id):
            own = requests_by_app[application.id]
            codes = {str(f.get("code", "")) for f in application.flags}
            codes.update(str(f.get("code", "")) for r in own for f in r.flags)
            rows.append(
                ApplicationSummaryOut(
                    household_cm_id=application.household_cm_id,
                    status=application.status,
                    member_person_cm_ids=list(application.member_person_cm_ids),
                    requests_by_status=dict(Counter(r.status for r in own)),
                    flag_codes=sorted(codes - {""}),
                    corrected_fields=_live_correction_count(corrections_by_app[application.id]),
                )
            )
        return ApplicationListResponse(year=year, applications=rows)

    async def application_detail(self, year: int, household_cm_id: int) -> ApplicationDetailResponse:
        application = await self._require_application(year, household_cm_id)
        requests = sorted(await self._store.fetch_requests(year, application.id), key=lambda r: r.id)
        corrections = await self._store.fetch_corrections(year, application.id)
        answers = effective_values(application.answers, APPLICATION_CORRECTABLE, corrections)
        shares = await self._store.fetch_payer_shares(year, [r.id for r in requests])

        def issues_of(request: RequestRecord) -> list[IssueOut]:
            # No rules: every issue here is a fixed or default hold, never read from a draft.
            found = request_issues(request, application.flags, answers, shares, None)
            return [IssueOut(code=i.code, severity=i.severity, message=i.message) for i in found]

        return ApplicationDetailResponse(
            year=year,
            household_cm_id=household_cm_id,
            status=application.status,
            member_person_cm_ids=list(application.member_person_cm_ids),
            answers=[answer_out(v) for v in answers.values()],
            notes={name: str(application.answers.get(name) or "") for name in TEXT_FIELDS},
            # Dollars per share are read-only, from the current award (none until sub-project 10).
            requests=[request_out(r, corrections, shares, issues_of(r), await self._award(r)) for r in requests],
            flags=_application_flags(application.flags, answers),
        )

    async def list_requests(self, year: int, status: str, flag: str | None = None) -> RequestQueueResponse:
        requests = sorted(
            (
                r
                for r in await self._store.fetch_requests(year)
                if r.status == status and (flag is None or any(f.get("code") == flag for f in r.flags))
            ),
            key=lambda r: (r.household_cm_id, r.id),
        )
        corrections = await self._store.fetch_corrections(year, None)
        shares = await self._store.fetch_payer_shares(year)
        return RequestQueueResponse(
            year=year,
            status=status,
            requests=[request_out(r, corrections, shares, award=await self._award(r)) for r in requests],
        )
