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
read before. Corrections are not intake's and do not wait.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, replace
from dataclasses import field as dataclass_field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Final, Protocol

from api.constants.collections import (
    AID_APPLICATION_CORRECTIONS,
    AID_APPLICATIONS,
    AID_PAYER_SHARES,
    AID_REQUEST_ADDITIONS,
    AID_REQUESTS,
)
from api.schemas.financial_aid_intake import (
    AddedRequestOut,
    AdditionBulkResult,
    AdditionItemReport,
    AdditionOut,
    AnswerOut,
    ApplicationDetailResponse,
    ApplicationListResponse,
    ApplicationSummaryOut,
    CorrectionOut,
    FlagOut,
    IssueOut,
    PayerShareOut,
    RequestOut,
    RequestQueueResponse,
    UseFormOut,
)
from api.services.camp_calendar import CAMP_TZ
from api.services.financial_aid_calc_inputs import (
    CalculatorInputs,
    calculator_inputs,
    request_issues,
)
from api.services.financial_aid_campminder_money import (
    D170Reads,
    NoRequestAid,
    aid_on_no_request_lines,
    d170_person,
    family_camp_sessions,
)
from api.services.financial_aid_cancellations import CancelEvent, fold_cancellations
from api.services.financial_aid_corrections import (
    APPLICATION_CORRECTABLE,
    INCOME_OVERRIDE_FIELD,
    REQUEST_CORRECTABLE,
    REVERT,
    CorrectionError,
    EffectiveValue,
    FieldKind,
    effective_values,
    parse_new_value,
)
from api.services.financial_aid_decisions_service import decision_write
from api.services.financial_aid_household import (
    HOUSEHOLD_ANSWER_FIELDS,
    TEXT_FIELDS,
    addition_request_spec,
    choose_household_answers,
    enrolled_for,
)
from api.services.financial_aid_intake_plan import (
    application_payload,
    planned_request,
    request_fields,
    share_entity_id,
)
from api.services.financial_aid_intake_service import billed_for, rules_check_for, season_lock
from api.services.financial_aid_intake_types import (
    ADDITION_SOURCE_REGISTRATION_ASK,
    ADDITION_SOURCE_STAFF,
    INTAKE_ACTOR,
    PROGRAM_FAMILY_CAMP,
    RESOLUTION_STAFF,
    SHARE_SOURCE_INTAKE,
    SHARE_SOURCE_STAFF,
    STAFF_HEADCOUNT_SOURCES,
    STATUS_ACTIVE,
    STATUS_DUPLICATE,
    STATUS_DUPLICATE_PENDING,
    STATUS_UNMATCHED,
    STATUS_WITHDRAWN,
    AdditionRecord,
    ApplicationRecord,
    AttendeeRow,
    BillingLine,
    CorrectionRecord,
    EquityAnswers,
    FaRow,
    PayerShareRecord,
    RequestKey,
    RequestRecord,
    SessionRow,
    request_origin,
)
from api.services.financial_aid_ledger_service import family_household_set
from api.services.financial_aid_payer_shares import (
    PayerShareError,
    ShareSpec,
    fill_remainder,
    share_status,
    split_award,
    validate_shares,
)
from api.services.financial_aid_reconciliation import CampLine
from api.services.financial_aid_request_overrides import DEFAULT_REASON_CODES
from api.services.financial_aid_session_resolver import PROGRAM_SESSION_TYPES
from bunking.financial_aid.change_diff import values_equal
from bunking.financial_aid.change_log import AidOperationResult, AidWrite, new_record_id
from bunking.financial_aid.decisions.rounds import ADDED_AT_CAMPMINDER, DecisionEvent, fold_rounds
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
    async def fetch_request_events(self, request_id: str) -> list[DecisionEvent]: ...
    async def fetch_payer_shares(
        self, year: int, request_ids: Sequence[str] | None = None
    ) -> list[PayerShareRecord]: ...
    async def fetch_equity_answers(self, year: int, person_cm_ids: Sequence[int]) -> dict[int, EquityAnswers]: ...
    # What an added request is checked and planned against (add_request): intake's own reads.
    async def fetch_request_additions(self, year: int) -> list[AdditionRecord]: ...
    async def fetch_request_addition(self, record_id: str) -> AdditionRecord | None: ...
    async def fetch_registered_attendees(self, year: int) -> list[AttendeeRow]: ...
    async def fetch_fa_rows(self, year: int) -> list[FaRow]: ...
    async def fetch_family_camp_billing(self, year: int) -> list[BillingLine]: ...
    async def fetch_birthdates(self, year: int, person_cm_ids: Sequence[int]) -> dict[int, str]: ...
    async def load_intake_rules(self, year: int) -> AidRules | None: ...
    # Add a Request…'s Round 1 at CampMinder's money (owner Q5-A): D170's own reads.
    async def fetch_camp_lines(self, year: int, *, recorded_times: bool = False) -> list[CampLine]: ...
    async def fetch_household_links(self, year: int) -> list[Any]: ...
    async def fetch_request_cancellations(self, request_id: str) -> list[CancelEvent]: ...
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


def _waits_on(pending: RequestRecord, holder: RequestRecord) -> bool:
    """`pending` is a possible duplicate (duplicate_pending) that names `holder` as the request it waits on."""
    return pending.status == STATUS_DUPLICATE_PENDING and pending.duplicate_of == holder.id


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


def disagreeing_fields(flags: Sequence[Mapping[str, Any]]) -> dict[str, list[Mapping[str, Any]]]:
    """Every answer the household's forms disagree on (income_conflict and household_answer_conflict alike), with
    its variants ({"value", "person_cm_ids"}), in the household answers' own order, so a reply never depends on how
    the flag's JSON was stored. Only correctable answers: a conflict is cleared by correcting it."""
    found: dict[str, list[Mapping[str, Any]]] = {}
    for flag in flags:
        if str(flag.get("code", "")) in _CONFLICT_CODES:
            for name, variants in dict(dict(flag.get("detail", {})).get("fields", {})).items():
                if name in APPLICATION_CORRECTABLE:
                    found[name] = [v for v in variants if isinstance(v, Mapping)]
    order = {name: i for i, name in enumerate(HOUSEHOLD_ANSWER_FIELDS)}
    return dict(sorted(found.items(), key=lambda item: order.get(item[0], len(order))))


def _form_text(kind: FieldKind, value: Any) -> str:
    """A conflict variant's number (a float in the flag) as the text a correction parses: a count is a whole number."""
    number = Decimal(str(value))
    if kind is FieldKind.COUNT and number == number.to_integral_value():
        return str(int(number))
    return str(number)


def _live_correction_count(corrections: Sequence[CorrectionRecord]) -> int:
    """The family's corrected intake answers. The request cost override is a correction row too
    (financial_aid_request_overrides) but no corrected answer, so it never counts here; nor does a legacy
    include_override row, which nothing reads."""
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
    Sub-project 10 supplies it. Until then there is none and no dollars are shown.
    It only decides what is displayed: shares are entered as a % (owner ruling 2026-10-02)."""

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
        origin=request_origin(record.program_option_key),
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


@dataclass(frozen=True)
class AdditionItem:
    """One request staff add (add_request / add_requests). person_cm_id 0 is a Family Camp household request."""

    household_cm_id: int
    person_cm_id: int
    session_cm_id: int
    ask: float
    reason: str
    # Owner Q5-A: record CampMinder's posted money on this family x session as Round 1, posted, in the same operation.
    # The amount the screen showed; refused unless it is CampMinder's to the cent. None: the request only.
    round1_campminder: float | None = None


# Remove… on a request cancelled in Kindred (scan row 3, coordinator ruling): staff-safe, and the page says it up front.
REMOVE_CANCELLED_REFUSAL: Final = (
    "The request is cancelled: Reopen… it first (the cancellation would stay), then remove it"
)


def _program_for(session: SessionRow) -> str | None:
    """The program whose requests can name `session`: the same session-type sets Settle session checks
    (PROGRAM_SESSION_TYPES), which never overlap. None when no program names it (an Adult Reg session)."""
    return next((p for p, types in PROGRAM_SESSION_TYPES.items() if session.session_type in types), None)


def _addition_fields(addition: AdditionRecord) -> dict[str, Any]:
    """A stored addition as its log `before` (4a keeps only what changed)."""
    return {
        "year": addition.year,
        "household_cm_id": addition.household_cm_id,
        "person_cm_id": addition.person_cm_id,
        "program_key": addition.program_key,
        "session_cm_id": addition.session_cm_id,
        "ask": addition.ask,
        "source": addition.source,
        "reason": addition.reason,
        "actor": addition.actor,
        "retired_at": addition.retired_at,
        "retired_by": addition.retired_by,
        "retire_reason": addition.retire_reason,
    }


def addition_out(addition: AdditionRecord, request_id: str, round1_posted: Decimal | None = None) -> AdditionOut:
    return AdditionOut(
        id=addition.id,
        year=addition.year,
        household_cm_id=addition.household_cm_id,
        person_cm_id=addition.person_cm_id,
        program_key=addition.program_key,
        session_cm_id=addition.session_cm_id,
        ask=addition.ask,
        source=addition.source,
        reason=addition.reason,
        actor=addition.actor,
        retired_at=addition.retired_at,
        retired_by=addition.retired_by,
        retire_reason=addition.retire_reason,
        request_id=request_id,
        reviewed_at=addition.reviewed_at,
        reviewed_by=addition.reviewed_by,
        round1_posted=float(round1_posted) if round1_posted is not None else None,
    )


def _subject_slot(household_cm_id: int, person_cm_id: int, session_cm_id: int) -> tuple[str, int, int]:
    """The one-active-request slot: the camper's, or the household's for a Family Camp request."""
    return ("person", person_cm_id, session_cm_id) if person_cm_id else ("household", household_cm_id, session_cm_id)


@dataclass
class _AdditionContext:
    """One season's reads for a load of additions, taken once under the season lock."""

    year: int
    sessions: list[SessionRow]
    attendees: list[AttendeeRow]
    fa_rows: list[FaRow]
    applications: dict[int, ApplicationRecord]
    requests: dict[RequestKey, RequestRecord]
    additions: list[AdditionRecord]
    rules_check: Any
    # Filled as items plan: the slots this load claims and the applications it creates.
    claimed: set[tuple[str, int, int]] = dataclass_field(default_factory=set)
    new_applications: dict[int, str] = dataclass_field(default_factory=dict)
    # Read only when an item records CampMinder's money as Round 1 (Q5-A): D170's lines and the season's links, and
    # the family x camper x sessions whose money this load has already recorded.
    no_request: list[NoRequestAid] | None = None
    links: list[Any] = dataclass_field(default_factory=list)
    recorded: set[tuple[int, int, int]] = dataclass_field(default_factory=set)


def _cents(amount: Decimal) -> str:
    return f"${amount:,.2f}"


@dataclass
class _PlannedAddition:
    addition: AdditionRecord
    request_id: str
    writes: list[AidWrite]


def _campminder_post(
    year: int, request_id: str, amount: Decimal, lines: Sequence[CampLine], addition_id: str, actor: str, reason: str
) -> AidWrite:
    """Round 1's Posted row at CampMinder's money (owner Q5-A), through the decisions service's own row writer. A
    posted round's decided amount IS its locked amount (pricing.posted_view), so this one row is the Round 1 decision
    and its posted mark. Dated the posting's day: the latest of the lines, camp time (today when none has a date)."""
    days = [line.post_date.astimezone(CAMP_TZ).date() for line in lines if line.post_date is not None]
    posted_on = max(days) if days else datetime.now(UTC).astimezone(CAMP_TZ).date()
    return replace(
        decision_write(
            year,
            request_id,
            1,
            "post",
            actor,
            record_id=new_record_id(),
            amount=float(amount),
            effective_on=posted_on.isoformat(),
            lock_source=ADDED_AT_CAMPMINDER,
            snapshot={
                "round": 1,
                "decided": str(amount),
                "result": None,
                "inputs": None,
                "campminder": str(amount),
                "added": {"addition": addition_id, "transactions": sorted(line.transaction_cm_id for line in lines)},
            },
            note=f"Recorded at CampMinder's posted {_cents(amount)} when the request was added",
        ),
        reason=reason,
    )


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
        # B30 (owner 2026-10-05): the reason is optional, so a blank one is logged as "" rather than refused.
        result = await self._store.commit([write], actor=actor, reason=reason.strip(), require_reason=False)
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

    async def use_form(self, year: int, household_cm_id: int, person_cm_id: int, reason: str, actor: str) -> UseFormOut:
        """Use X's Form (owner-approved, household-v3 section 3): one sibling's form answers every question the
        household's forms disagree on (both conflict flags), as ONE atomic operation of ordinary corrections, so the
        income hold clears once no income answer still disagrees. Each value passes the same validation as a hand
        correction. The chosen form overwrites a hand correction (its log row keeps the value it replaced); an answer
        already corrected to this form's value gets no write; one this form left blank is skipped. Each log row is a
        "correct" with `form_person_cm_id` in its `after`, which is how History groups the operation."""
        application = await self._require_application(year, household_cm_id)
        if person_cm_id not in application.member_person_cm_ids:
            raise CorrectionError("that is not one of this household's forms")
        fields = disagreeing_fields(application.flags)
        if not fields:
            raise CorrectionError("nothing on this application disagrees")
        existing = await self._store.fetch_corrections(year, application.id)
        current = effective_values(dict(application.answers), APPLICATION_CORRECTABLE, existing)
        reason = reason.strip()
        writes: list[AidWrite] = []
        planned: list[tuple[str, str, str]] = []  # field, value, synced
        skipped: list[str] = []
        unchanged: list[str] = []
        for field, variants in fields.items():
            raw = next((v.get("value") for v in variants if person_cm_id in v.get("person_cm_ids", ())), None)
            if raw is None:
                skipped.append(field)
                continue
            value = parse_new_value(APPLICATION_CORRECTABLE[field], _form_text(APPLICATION_CORRECTABLE[field], raw))
            now = current[field]
            if now.corrected and now.effective == value:
                unchanged.append(field)
                continue
            planned.append((field, value, now.synced))
            writes.append(
                AidWrite(
                    collection=AID_APPLICATION_CORRECTIONS,
                    action="create",
                    year=year,
                    data={
                        "year": year,
                        "application": application.id,
                        "request": "",
                        "field": field,
                        "new_value": value,
                        "original_value": now.synced,
                        "reason": reason,
                        "actor": actor,
                    },
                    log_action="correct",
                    after={
                        "field": field,
                        "value": value,
                        "previous_value": now.effective,
                        "form_person_cm_id": person_cm_id,
                    },
                )
            )
        if not writes and not unchanged:
            raise CorrectionError("that form leaves every disagreeing answer blank")
        corrected = {f for f in fields if current[f].corrected} | {f for f, _, _ in planned}
        still = [f for f in fields if f not in corrected]
        if not writes:
            return UseFormOut(
                household_cm_id=household_cm_id,
                person_cm_id=person_cm_id,
                operation_id="",
                applied=[],
                skipped_blank=skipped,
                unchanged=unchanged,
                still_disagreeing=still,
            )
        result = await self._store.commit(writes, actor=actor, reason=reason, require_reason=False)
        applied = [
            correction_out(
                CorrectionRecord(
                    id=record_id,
                    year=year,
                    application_id=application.id,
                    request_id="",
                    field=field,
                    new_value=value,
                    original_value=synced,
                    reason=reason,
                    actor=actor,
                    created=str((stored or {}).get("created", "")),
                )
            )
            for (field, value, synced), record_id, stored in zip(
                planned, result.record_ids, result.records, strict=True
            )
        ]
        return UseFormOut(
            household_cm_id=household_cm_id,
            person_cm_id=person_cm_id,
            operation_id=result.operation_id,
            applied=applied,
            skipped_blank=skipped,
            unchanged=unchanged,
            still_disagreeing=still,
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
        share_pct: Decimal,
        reason: str,
        actor: str,
    ) -> RequestOut:
        async with self._locked(request_id) as request:
            self._require_live(request, reason)
            entered: dict[str, Any] = {"household_cm_id": household_cm_id, "share_pct": _pct_text(share_pct)}
            try:
                existing = await self._store.fetch_payer_shares(request.year, [request.id])
                shares = fill_remainder(existing, household_cm_id, share_pct)
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
        if request.status == STATUS_ACTIVE and _waits_on(survivor, request):
            return await self._keep_pending(request, survivor, reason, actor)
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

    async def _keep_pending(self, active: RequestRecord, pending: RequestRecord, reason: str, actor: str) -> RequestOut:
        """Keep the pending request of a possible-duplicate pair instead of the active one (owner 2026-10-05):
        the two trade places as ONE operation. The active one is written first, because PocketBase allows
        one active request per camper and session. The newly active one gets the default share intake gives
        a live request (a pending one has none). Posted money never moves to another request."""
        if not reason.strip():
            raise CaseworkValidationError("a reason is required")
        rounds = sorted(fold_rounds(await self._store.fetch_request_events(active.id)).get(active.id, {}).items())
        for n, state in rounds:
            if state.posted:
                raise CaseworkValidationError(f"Round {n} is posted: keep this request, or undo Posted first")
        for n, state in rounds:
            # An ask or an award not yet posted would be left behind on the request that closes.
            if state.ask is not None or state.award is not None or state.discretionary is not None:
                raise CaseworkValidationError(
                    f"Round {n} has a decision on record: keep this request, so no recorded decision is left behind"
                )
        writes = [
            self._request_update(
                active,
                _changed(request_fields(active), {"status": STATUS_DUPLICATE, "duplicate_of": pending.id}),
                "keep_duplicate",
            ),
            self._request_update(
                pending,
                _changed(request_fields(pending), {"status": STATUS_ACTIVE, "duplicate_of": ""}),
                "keep_duplicate",
            ),
        ]
        # Any other possible duplicate of the old active request now waits on the kept one.
        writes.extend(
            self._request_update(other, {"duplicate_of": pending.id}, "keep_duplicate")
            for other in await self._store.fetch_requests(active.year)
            if other.id != pending.id and _waits_on(other, active)
        )
        if not await self._store.fetch_payer_shares(pending.year, [pending.id]):
            writes.append(
                AidWrite(
                    collection=AID_PAYER_SHARES,
                    action="create",
                    year=pending.year,
                    data={
                        "year": pending.year,
                        "request": pending.id,
                        "household_cm_id": pending.household_cm_id,
                        "share_pct": 100,
                        "source": SHARE_SOURCE_INTAKE,
                        "actor": INTAKE_ACTOR,
                        "note": "",
                    },
                    log_action="keep_duplicate",
                    entity_id=share_entity_id(pending.id, pending.household_cm_id),
                )
            )
        await self._store.commit(writes, actor=actor, reason=reason.strip(), require_reason=True)
        return await self._request_out(replace(active, status=STATUS_DUPLICATE, duplicate_of=pending.id))

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
            raise CaseworkValidationError("only a family-camp request has a number of people")
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

    # -- staff-added requests (aid_request_additions) ------------------------------------------------------------------

    async def _addition_context(self, year: int) -> _AdditionContext:
        store = self._store
        sessions = await store.fetch_sessions(year)
        return _AdditionContext(
            year=year,
            sessions=sessions,
            attendees=await store.fetch_registered_attendees(year),
            fa_rows=await store.fetch_fa_rows(year),
            applications={a.household_cm_id: a for a in await store.fetch_applications(year)},
            requests={r.key: r for r in await store.fetch_requests(year)},
            additions=await store.fetch_request_additions(year),
            rules_check=rules_check_for(await store.load_intake_rules(year), sessions),
        )

    def _belongs(self, ctx: _AdditionContext, item: AdditionItem) -> bool:
        """The camper is the household's: registered under it, or named by its aid form or application (a second
        parent's household files for the camper too)."""
        p, h = item.person_cm_id, item.household_cm_id
        application = ctx.applications.get(h)
        return (
            any(a.person_cm_id == p and a.household_cm_id == h for a in ctx.attendees)
            or any(r.person_cm_id == p and r.household_cm_id == h for r in ctx.fa_rows)
            or (application is not None and p in application.member_person_cm_ids)
        )

    async def _plan_addition(
        self, ctx: _AdditionContext, item: AdditionItem, operation_reason: str, actor: str
    ) -> _PlannedAddition:
        """Check one addition and plan its writes: the addition, its request (created, or a retired addition's
        withdrawn request revived on the same key), the application when the household has none, and the default
        payer share. Raises the casework errors; writes nothing."""
        year, hh, person, sid = ctx.year, item.household_cm_id, item.person_cm_id, item.session_cm_id
        reason = item.reason.strip() or operation_reason.strip()
        if not reason:
            raise CaseworkValidationError("a reason is required")
        # New guard: an addition is a request, and a request asks for something.
        if not item.ask > 0:
            raise CaseworkValidationError("the ask must be above $0")
        session = next((s for s in ctx.sessions if s.cm_id == sid), None)
        if session is None:
            raise CaseworkNotFoundError(f"no session {sid} in {year}")
        # Reused from Settle session: the session is one a program's requests can name. The program follows it.
        program = _program_for(session)
        if program is None:
            raise CaseworkValidationError("that session is not one any program's requests can name")
        if (program == PROGRAM_FAMILY_CAMP) != (person == 0):
            raise CaseworkValidationError(
                "a Family Camp request is the household's (no camper); every other request is one camper's"
            )
        if person and not self._belongs(ctx, item):
            raise CaseworkValidationError("that camper is not in that household's registration or aid form")
        # New guard: the camper (or, for Family Camp, someone in the household) is ENROLLED in it: status 2.
        if sid not in enrolled_for(hh, person, ctx.sessions, ctx.attendees):
            raise CaseworkValidationError(
                "no one in that household is enrolled in that session"
                if person == 0
                else "that camper is not enrolled in that session"
            )
        # Reused from Settle session: no live request already holds the slot.
        slot = _subject_slot(hh, person, sid)
        holder = await self._store.find_active_request(year, hh, person, sid)
        if holder is not None:
            raise DuplicateRequestError(holder.id)
        if slot in ctx.claimed:
            raise CaseworkValidationError("this load adds that request twice")
        if any(
            a.live and (a.household_cm_id, a.person_cm_id, a.session_cm_id) == (hh, person, sid) for a in ctx.additions
        ):
            raise CaseworkValidationError("that request is already added")
        campminder = await self._campminder_round1(ctx, item) if item.round1_campminder is not None else None

        addition = AdditionRecord(
            id=new_record_id(),
            year=year,
            household_cm_id=hh,
            person_cm_id=person,
            program_key=program,
            session_cm_id=sid,
            ask=round(float(item.ask), 2),
            source=ADDITION_SOURCE_STAFF,
            reason=reason,
            actor=actor,
        )
        spec = addition_request_spec(addition, ctx.sessions, ctx.attendees)
        billed = await billed_for(self._store, year, ctx.sessions, [hh]) if person == 0 else {}
        equity = await self._store.fetch_equity_answers(year, [person]) if person else None
        existing = ctx.requests.get(addition.request_key)
        target = planned_request(spec, billed, ctx.rules_check, equity, existing)

        writes: list[AidWrite] = []
        application = ctx.applications.get(hh)
        application_id = application.id if application is not None else ctx.new_applications.get(hh, "")
        if not application_id:
            # The application intake would build: from the household's form rows, or blank when it has none.
            rows = [r for r in ctx.fa_rows if r.household_cm_id == hh]
            answers, flags = choose_household_answers(rows)
            members = sorted({r.person_cm_id for r in rows})
            application_id = ctx.new_applications[hh] = new_record_id()
            writes.append(
                AidWrite(
                    collection=AID_APPLICATIONS,
                    action="create",
                    year=year,
                    record_id=application_id,
                    data={**application_payload(members, answers, flags), "year": year, "household_cm_id": hh},
                )
            )
        writes.append(
            AidWrite(
                collection=AID_REQUEST_ADDITIONS,
                action="create",
                year=year,
                record_id=addition.id,
                data=_addition_fields(addition),
                log_action="add_request",
                reason=reason,
            )
        )
        if existing is None:
            request_id = new_record_id()
            writes.append(
                AidWrite(
                    collection=AID_REQUESTS,
                    action="create",
                    year=year,
                    record_id=request_id,
                    data={
                        "household_cm_id": hh,
                        "person_cm_id": person,
                        "program_key": program,
                        "program_option_key": spec.program_option_key,
                        **target,
                        "year": year,
                        "application": application_id,
                    },
                    log_action="add_request",
                    reason=reason,
                )
            )
            has_share = False
        else:
            # A retired addition's request, withdrawn on its key: revived, with every decision still on it.
            request_id = existing.id
            changes = _changed(request_fields(existing), target)
            if changes:
                writes.append(replace(self._request_update(existing, changes, "add_request"), reason=reason))
            has_share = bool(await self._store.fetch_payer_shares(year, [request_id]))
        if not has_share:
            writes.append(
                AidWrite(
                    collection=AID_PAYER_SHARES,
                    action="create",
                    year=year,
                    data={
                        "year": year,
                        "request": request_id,
                        "household_cm_id": hh,
                        "share_pct": 100,
                        "source": SHARE_SOURCE_INTAKE,
                        "actor": INTAKE_ACTOR,
                        "note": "",
                    },
                    log_action="add_request",
                    entity_id=share_entity_id(request_id, hh),
                    reason=reason,
                )
            )
        if campminder is not None:
            if existing is not None:
                earlier = fold_rounds(await self._store.fetch_request_events(existing.id)).get(existing.id, {}).get(1)
                if earlier is not None and earlier.posted:
                    raise CaseworkValidationError("Round 1 is already posted on that request")
            amount, lines, family_key = campminder
            writes.append(_campminder_post(year, request_id, amount, lines, addition.id, actor, reason))
            ctx.recorded.add(family_key)
        ctx.claimed.add(slot)
        return _PlannedAddition(addition, request_id, writes)

    async def _campminder_round1(
        self, ctx: _AdditionContext, item: AdditionItem
    ) -> tuple[Decimal, list[CampLine], tuple[int, int, int]]:
        """Owner Q5-A's guard: the Round 1 to record is, to the cent, CampMinder's live camp aid on this family x
        session that no request holds (D170's own lines, so the money then leaves that line and counts in the pool;
        since #49 a sibling's request does not hold this camper's money),
        and that is this camper's (d170_person, coordinator ruling): the lines credited to the camper, plus lines
        credited to no camper when the camper is the household's one camper enrolled in the session. A household
        (Family Camp) request takes the household x session's. This is the amount Form intake offers on the row.
        The family is the household and the households linked to it, as D170 reads a line. Recorded once per
        family x camper x session in a load."""
        if ctx.no_request is None:
            lines = await self._store.fetch_camp_lines(ctx.year)
            ctx.links = list(await self._store.fetch_household_links(ctx.year))
            # D170's own read: the raw requests and additions (an added request staff removed holds no money), and
            # #49's per-camper holding. Read once per load from the state before it, so a bulk load and the same adds
            # one at a time agree (a camper's money is held only by their own request, never a sibling's).
            reads = D170Reads(
                list(ctx.requests.values()),
                list(ctx.additions),
                ctx.links,
                family_camp_sessions(ctx.sessions),
                list(ctx.attendees),
            )
            ctx.no_request = aid_on_no_request_lines(lines, reads)
        hh, person, sid = item.household_cm_id, item.person_cm_id, item.session_cm_id
        family = set(family_household_set(ctx.links, hh) or [hh])
        family_camp = family_camp_sessions(ctx.sessions)
        found = [
            a.line
            for a in ctx.no_request
            if a.group is not None
            and a.group[1] == sid
            and a.group[0] in family
            and d170_person(a, family_camp, ctx.attendees) == person
        ]
        key = (min(family), person, sid)
        # Whose money the guard took (d170_person): the camper's, or a household (Family Camp) request's household's.
        whose = "that camper" if person else "that household"
        if key in ctx.recorded:
            raise CaseworkValidationError(
                f"CampMinder's money on {whose} and session is already recorded on another item in this load"
            )
        if not found:
            raise CaseworkValidationError(f"CampMinder shows no aid on no request for {whose} and session")
        amount = sum((line.amount for line in found), Decimal(0))
        given = Decimal(str(item.round1_campminder)).quantize(Decimal("0.01"))
        if amount.quantize(Decimal("0.01")) != given:
            raise CaseworkValidationError(
                f"CampMinder shows {_cents(amount)} on no request for {whose} and session, not {_cents(given)}"
            )
        return amount, found, key

    async def add_request(
        self,
        year: int,
        household_cm_id: int,
        person_cm_id: int,
        session_cm_id: int,
        ask: float,
        reason: str,
        actor: str,
        *,
        round1_campminder: float | None = None,
    ) -> AddedRequestOut:
        """Add a request the aid form never named, as ONE operation: the addition, its request and the default
        payer share (and the household's application when it has none), each with its aid_change_log row, logged
        `add_request`. Intake's next run reads the addition and finds the request already matched.

        `round1_campminder` (owner Q5-A, "Record CampMinder's $X as Round 1, posted"): the same operation also writes
        the request's Round 1 `post` at that amount (lock_source campminder_added, dated the posting's day), so the
        money counts in Committed and Posted at once. Refused unless it is CampMinder's money on that family x
        session with no request (_campminder_round1)."""
        item = AdditionItem(household_cm_id, person_cm_id, session_cm_id, ask, reason, round1_campminder)
        async with season_lock(year):
            ctx = await self._addition_context(year)
            planned = await self._plan_addition(ctx, item, "", actor)
            await self._store.commit(planned.writes, actor=actor, reason=planned.addition.reason, require_reason=True)
        return await self._added_out(planned.addition, planned.request_id)

    async def add_requests(
        self, year: int, items: Sequence[AdditionItem], reason: str, actor: str, *, dry_run: bool
    ) -> AdditionBulkResult:
        """A load of additions, ALL OR NOTHING: every item is checked (each against the season and the items before
        it); any refusal writes nothing, and the report says which item and why. A clean load commits as one
        operation unless `dry_run`."""
        reports: list[AdditionItemReport] = []
        planned: list[_PlannedAddition] = []
        async with season_lock(year):
            ctx = await self._addition_context(year)
            for index, item in enumerate(items):
                session = next((s for s in ctx.sessions if s.cm_id == item.session_cm_id), None)
                report = AdditionItemReport(
                    index=index,
                    household_cm_id=item.household_cm_id,
                    person_cm_id=item.person_cm_id,
                    session_cm_id=item.session_cm_id,
                    ask=item.ask,
                    program_key=(_program_for(session) or "") if session is not None else "",
                    ok=False,
                    round1_campminder=item.round1_campminder,
                )
                try:
                    one = await self._plan_addition(ctx, item, reason, actor)
                except DuplicateRequestError as exc:
                    reports.append(report.model_copy(update={"error": str(exc), "holder_id": exc.holder_id}))
                    continue
                except (CaseworkValidationError, CaseworkNotFoundError) as exc:
                    reports.append(report.model_copy(update={"error": str(exc)}))
                    continue
                planned.append(one)
                reports.append(report.model_copy(update={"ok": True}))
            clean = len(planned) == len(items)
            if dry_run or not clean:
                return AdditionBulkResult(year=year, dry_run=dry_run, written=False, items=reports)
            result = await self._store.commit(
                [w for one in planned for w in one.writes], actor=actor, reason=reason.strip(), require_reason=True
            )
        written = [
            r.model_copy(update={"addition_id": one.addition.id, "request_id": one.request_id})
            for r, one in zip(reports, planned, strict=True)
        ]
        return AdditionBulkResult(
            year=year, dry_run=False, written=True, operation_id=result.operation_id, items=written
        )

    async def _added_out(self, addition: AdditionRecord, request_id: str) -> AddedRequestOut:
        request = await self._require_request(request_id)
        round1 = fold_rounds(await self._store.fetch_request_events(request_id)).get(request_id, {}).get(1)
        posted = round1.locked_amount if round1 is not None and round1.posted else None
        return AddedRequestOut(
            addition=addition_out(addition, request_id, posted), request=await self._request_out(request)
        )

    async def review_addition(self, year: int, addition_id: str, actor: str) -> AddedRequestOut:
        """Mark Reviewed (owner Q2-A): a person checked a request the dashboard made from a registration ask, so it
        leaves Form intake's Needs a look. Stamps reviewed_at / reviewed_by once, logged `review_added_request`; a
        second call changes nothing (the first stamp stands). Only a live rule-made addition is reviewed."""
        async with season_lock(year):
            addition = await self._store.fetch_request_addition(addition_id)
            if addition is None or addition.year != year:
                raise CaseworkNotFoundError("no such added request in that season")
            if addition.source != ADDITION_SOURCE_REGISTRATION_ASK:
                raise CaseworkValidationError("only a request made from a registration ask is reviewed")
            if not addition.live:
                raise CaseworkValidationError("that added request is removed")
            if not addition.reviewed:
                stamp = {"reviewed_at": datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S.000Z"), "reviewed_by": actor}
                write = AidWrite(
                    collection=AID_REQUEST_ADDITIONS,
                    action="update",
                    year=year,
                    record_id=addition.id,
                    before={**_addition_fields(addition), "reviewed_at": "", "reviewed_by": ""},
                    data=stamp,
                    log_action="review_added_request",
                )
                await self._store.commit([write], actor=actor, reason="Mark Reviewed")
                addition = replace(addition, reviewed_at=stamp["reviewed_at"], reviewed_by=actor)
            request = next((r for r in await self._store.fetch_requests(year) if r.key == addition.request_key), None)
        if request is None:
            raise CaseworkNotFoundError("the added request's own request is missing")
        return await self._added_out(addition, request.id)

    async def retire_addition(self, year: int, addition_id: str, reason: str, actor: str) -> AddedRequestOut:
        """Retire an addition and withdraw its request at once, as one operation. Nothing is deleted: the addition
        keeps who retired it and why, and the request keeps its decisions and payer shares (a family that declines
        uses Cancel… instead). Refused while a round is posted. Logged `remove_added_request`, plus the request's
        status change."""
        if not reason.strip():
            raise CaseworkValidationError("a reason is required")
        async with season_lock(year):
            addition = await self._store.fetch_request_addition(addition_id)
            if addition is None or addition.year != year:
                raise CaseworkNotFoundError("no such added request in that season")
            if not addition.live:
                raise CaseworkValidationError("that added request is already removed")
            request = next((r for r in await self._store.fetch_requests(year) if r.key == addition.request_key), None)
            if request is not None:
                # Aid CampMinder shows as posted keeps a request that counts (owner): as keeping a duplicate pair's
                # other request does, a posted round is undone first.
                rounds = fold_rounds(await self._store.fetch_request_events(request.id)).get(request.id, {})
                for n, state in sorted(rounds.items()):
                    if state.posted:
                        raise CaseworkValidationError(f"Round {n} is posted: undo Posted first, then remove it")
                # Scan row 3 (coordinator ruling): retiring a request cancelled in Kindred would leave the cancellation
                # on it (a re-add would come back cancelled), so it is reopened first. CampMinder's own cancellation
                # is not a record here: it follows the enrollment.
                cancel = fold_cancellations(await self._store.fetch_request_cancellations(request.id)).get(request.id)
                if cancel is not None and cancel.in_kindred:
                    raise CaseworkValidationError(REMOVE_CANCELLED_REFUSAL)
            updated = replace(
                addition,
                retired_at=datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S.000Z"),
                retired_by=actor,
                retire_reason=reason.strip(),
            )
            retired = {k: getattr(updated, k) for k in ("retired_at", "retired_by", "retire_reason")}
            writes = [
                AidWrite(
                    collection=AID_REQUEST_ADDITIONS,
                    action="update",
                    year=year,
                    record_id=addition.id,
                    before=_addition_fields(addition),
                    data=retired,
                    log_action="remove_added_request",
                )
            ]
            if request is not None and request.status != STATUS_WITHDRAWN:
                writes.append(self._request_update(request, {"status": STATUS_WITHDRAWN}, "status"))
            await self._store.commit(writes, actor=actor, reason=reason.strip(), require_reason=True)
        if request is None:
            raise CaseworkNotFoundError("the added request's own request is missing")
        return await self._added_out(updated, request.id)

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
