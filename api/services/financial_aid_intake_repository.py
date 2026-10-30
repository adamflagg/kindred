"""PocketBase access for campership intake (sub-project 5).

Through FastAPI's superuser client. Every aid_* collection has all five rules
null, and the router gates each call on a financial_aid.* permission first.

Two reads are narrowed on purpose, and tests pin both:

* `fetch_fa_rows` names its columns (FA_READ_FIELDS). financial_aid_applications
  also holds addresses and phone numbers that intake never needs. (The contact
  NAME is read, by `read_fa_contacts` below: the Requests grid's Requested by and
  the jump index's requesters, column-narrowed too.) Both are answered from
  layer 1 (aid_sync_inputs), whose one read of the mirror is projected to the
  union of its readers' columns and nothing wider.
* `fetch_equity_answers` reads person_custom_values through EQUITY_FIELD_CM_IDS,
  an ALLOWLIST (the precedent: ADULT_NEED_FIELD_CM_IDS in
  api/services/adult_need_answers.py). That table holds race,
  financial-aid and salary-bearing staff-history answers. A read not narrowed to
  named field ids is how one reaches the wire. Gender identity and pronouns are
  structured `persons` columns, not custom values.

`fetch_fa_rows` reads only `is_applicant` rows: SP1 leaves donation-only and
carry-over-only rows false, and neither is an application (spec 6.4). It also
reads `reported_income_fields` (Task 1b), which tells a blank income from a
reported 0.

Every paged read sorts on `id`, because get_full_list pages by LIMIT/OFFSET.

Writes have ONE path, `commit`: sub-project 4a's commit_aid_writes, which sends
each aid_* record write and its aid_change_log row in one PocketBase batch
(spec 14.4). There is deliberately no create/update/delete method here.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Sequence
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Final

from api.constants.collections import (
    AID_APPLICATION_CORRECTIONS,
    AID_APPLICATIONS,
    AID_DECISIONS,
    AID_FORM_RESPONSES,
    AID_GOOGLE_FORMS,
    AID_PAYER_SHARES,
    AID_REQUEST_ADDITIONS,
    AID_REQUESTS,
    ATTENDEES,
    CAMP_SESSIONS,
    FINANCIAL_TRANSACTIONS,
    PERSONS,
)
from api.services.aid_build_reads import shared_read
from api.services.aid_sync_inputs import aid_sync_inputs
from api.services.financial_aid_google_form import FormResponseRow
from api.services.financial_aid_household import HOUSEHOLD_ANSWER_FIELDS
from api.services.financial_aid_household_search import person_name_filter
from api.services.financial_aid_intake_types import (
    INTAKE_RULES_SECTIONS,
    REGISTERED_STATUS_IDS,
    STATUS_ACTIVE,
    UNKNOWN_EQUITY,
    AdditionRecord,
    ApplicationRecord,
    AttendeeRow,
    BillingLine,
    CorrectionRecord,
    EquityAnswers,
    FaRow,
    PayerShareRecord,
    RequestRecord,
    SessionRow,
    equity_from_json,
)
from api.services.financial_aid_registration_ask import (
    ASK_HISTORY_COLLECTION,
    REGISTRATION_ASK_FIELD_CM_ID,
    AskHistoryRow,
    AttendeeDates,
)
from api.services.financial_aid_repository import FinancialAidRepository
from api.services.financial_aid_requesters import FaContact
from api.services.financial_aid_rules_service import AidRulesRepository, FinancialAidRulesService
from api.services.pb_precise_datetime import aid_collection
from api.services.pb_read import pb_read
from api.utils.pb_filters import pb_escape
from bunking.financial_aid.change_log import AidOperationResult, AidWrite, commit_aid_writes
from bunking.financial_aid.rules.schema import AidRules, SectionName

PAGE_SIZE: Final = 500
_DAY: Final = re.compile(r"\d{4}-\d{2}-\d{2}")
STABLE_SORT: Final = "id"

# The registration-time ask (CA-FinancialAssistanceAmount for a camper, WW-FA
# Amount for an adult). SP1 renamed it from amount_awarded (migration 1500000184).
FA_REGISTRATION_ASK_FIELD: Final = "registration_request_amount"
# The same ask per program (IN-BUCKETS, migration 1500000253): the camper form's CA- pair and the adult-weekend form's
# WW- pair, which the legacy pair above holds together, first value wins.
FA_ASK_BY_PROGRAM_FIELDS: Final = (
    "camper_interest_expressed",
    "camper_registration_request_amount",
    "adult_weekend_interest_expressed",
    "adult_weekend_registration_request_amount",
)

CAMPER_POC_FIELD_CM_ID: Final = 165525  # CampMinder "Family Camp-POC", camper partition, stamped per season
ADULT_POC_FIELD_CM_ID: Final = 209079  # CampMinder "Folks of Color", adult partition
EQUITY_FIELD_CM_IDS: Final[tuple[int, ...]] = (CAMPER_POC_FIELD_CM_ID, ADULT_POC_FIELD_CM_ID)

# (Controller ruling C2, 2026-09-26) The four-decimal precision a stored share_pct is
# quantized to before its trailing zeros are stripped. Decimal.normalize() alone can
# then emit exponent notation (Decimal("100").normalize() == Decimal("1E+2")), which
# Pydantic would serialise as the string "1E+2" -- format(..., "f") forces fixed-point
# notation back, so a stored 100 always reads back as "100".
PCT: Final = Decimal("0.0001")

_FA_PROGRAM_FIELDS: Final = (
    "summer_program",
    "summer_amount_requested",
    "fc_program",
    "fc_amount_requested",
    "tbm_program",
    "tbm_amount_requested",
    "interest_expressed",
)
FA_READ_FIELDS: Final = ",".join(
    (
        "id",
        "person_id",
        *HOUSEHOLD_ANSWER_FIELDS,
        *_FA_PROGRAM_FIELDS,
        FA_REGISTRATION_ASK_FIELD,
        *FA_ASK_BY_PROGRAM_FIELDS,
        "reported_income_fields",
        "expand.household.cm_id",
    )
)
FA_CONTACT_FIELDS: Final = "id,person_id,contact_first_name,contact_last_name,expand.household.cm_id"
# The adult aid Google Form mirror's season read (PR 2), named column by column: aid_form_responses also holds the
# respondent email, the typed birthdate, POC, race/ethnicity and gender identity, and none of them is read here (the
# design's §8: stored in the locked mirror, returned by no operational endpoint). The email and typed birthdate have
# their own one-record read, for Link…'s candidates only (fetch_form_response_identity).
FORM_RESPONSE_READ_FIELDS: Final = ",".join(
    (
        "id",
        "year",
        "response_id",
        "form_status",
        "match_status",
        "person_cm_id",
        "household_cm_id",
        "program_key",
        "weekend_session_cm_id",
        "registered_session_cm_id",
        "program_choice",
        "ask",
        *HOUSEHOLD_ANSWER_FIELDS,
        "student_debt",  # shown on the opened row; never priced (CampMinder's twin is retired, owner 09-27)
        "reported_income_fields",
        "parse_notes",
        "created_at_google",
        "last_submitted_at",
        "superseded_by",
        "match_tier",
        "match_candidates",
        "linked_by",
        "linked_at",
        "ignored_reason",
        "ignored_kind",
        "ignored_by",
        "ignored_at",
        "name_typed",
        "county",
        "signature_typed",
        "agreement_date",
    )
)
GOOGLE_FORM_STATUS_FIELDS: Final = "id,year,last_pulled_at,last_pull_status"
_BILLING_FIELDS: Final = ",".join(
    (
        "id",
        "household_cm_id",
        "person_cm_id",
        "session_cm_id",
        "financial_category_cm_id",
        "description",
        "quantity",
        "amount",
        "is_reversed",
        "expand.financial_category.name",
    )
)
_REGISTERED_FILTER: Final = " || ".join(f"status_id = {int(s)}" for s in sorted(REGISTERED_STATUS_IDS))


def allowlist_filter(field_cm_ids: Sequence[int]) -> str:
    if not field_cm_ids:
        raise ValueError("an empty person custom-value allowlist would read every field")
    return " || ".join(f"field_definition.cm_id = {cm_id}" for cm_id in field_cm_ids)


def parse_poc_answer(value: str) -> bool | None:
    folded = value.strip().casefold()
    if folded == "yes":
        return True
    if folded == "no":
        return False
    return None


def _expanded(record: Any, name: str) -> Any:
    expand = getattr(record, "expand", None) or {}
    return expand.get(name) if isinstance(expand, dict) else None


def _int(value: Any) -> int:
    return int(float(value or 0))


def _float(value: Any) -> float:
    return float(value or 0)


def _str(value: Any) -> str:
    return str(value or "")


def _stamp(value: Any) -> str:
    """A PocketBase time as PocketBase writes it, "2026-10-16 01:44:02.377Z" (UTC), whatever the SDK hands back: it
    turns a date column into a naive datetime, whose str() has no zone, so a browser would read it as local time and
    name the wrong day. Blank stays blank."""
    if isinstance(value, datetime):
        at = value if value.tzinfo is None else value.astimezone(UTC)
        return at.strftime("%Y-%m-%d %H:%M:%S.") + f"{at.microsecond // 1000:03d}Z"
    return _str(value)


async def read_fa_contacts(pb: Any, year: int) -> list[FaContact]:
    """The contact name on every aid form row of the season, not only applicants, with the camper and household it
    belongs to: the Requests grid's Requested by, and the jump index's requesters (financial_aid_requesters). In
    PocketBase-id order. Answered from layer 1 (aid_sync_inputs), whose FA-mirror projection holds these columns
    (FA_CONTACT_FIELDS) and not the rest of the contact's details."""
    rows = (await aid_sync_inputs(pb, year)).fa_applications
    return [
        FaContact(
            _int(getattr(r, "person_id", 0)),
            _int(getattr(_expanded(r, "household"), "cm_id", 0)),
            _str(getattr(r, "contact_first_name", "")),
            _str(getattr(r, "contact_last_name", "")),
        )
        for r in rows
    ]


def _json(value: Any, default: Any) -> Any:
    if isinstance(value, str):
        return json.loads(value) if value else default
    return default if value is None else value


def _exact_pct(value: Any) -> Decimal:
    """A stored share_pct as an exact four-decimal Decimal that never prints with an
    exponent (controller ruling C2). PocketBase numbers arrive as floats; str() first
    keeps the stored digits instead of a binary-float artifact."""
    return Decimal(format(Decimal(str(value)).quantize(PCT).normalize(), "f"))


_EQUITY_SECTION: tuple[SectionName, ...] = ("equity",)


def _fa_row(record: Any) -> FaRow:
    return FaRow(
        person_cm_id=_int(getattr(record, "person_id", 0)),
        household_cm_id=_int(getattr(_expanded(record, "household"), "cm_id", 0)),
        answers={name: getattr(record, name, None) for name in HOUSEHOLD_ANSWER_FIELDS},
        summer_program=_str(getattr(record, "summer_program", "")),
        summer_amount_requested=_float(getattr(record, "summer_amount_requested", 0)),
        fc_program=_str(getattr(record, "fc_program", "")),
        fc_amount_requested=_float(getattr(record, "fc_amount_requested", 0)),
        tbm_program=_str(getattr(record, "tbm_program", "")),
        tbm_amount_requested=_float(getattr(record, "tbm_amount_requested", 0)),
        interest_expressed=bool(getattr(record, "interest_expressed", False)),
        registration_ask=_float(getattr(record, FA_REGISTRATION_ASK_FIELD, 0)),
        reported_income_fields=frozenset(_json(getattr(record, "reported_income_fields", None), [])),
        camper_interest=bool(getattr(record, "camper_interest_expressed", False)),
        camper_registration_ask=_float(getattr(record, "camper_registration_request_amount", 0)),
        adult_weekend_interest=bool(getattr(record, "adult_weekend_interest_expressed", False)),
        adult_weekend_registration_ask=_float(getattr(record, "adult_weekend_registration_request_amount", 0)),
    )


def _application(record: Any) -> ApplicationRecord:
    return ApplicationRecord(
        id=record.id,
        year=_int(record.year),
        household_cm_id=_int(record.household_cm_id),
        status=_str(record.status),
        answers=dict(_json(getattr(record, "answers", None), {})),
        member_person_cm_ids=tuple(int(p) for p in _json(getattr(record, "member_person_cm_ids", None), [])),
        flags=tuple(_json(getattr(record, "flags", None), [])),
    )


def _request(record: Any) -> RequestRecord:
    return RequestRecord(
        id=record.id,
        year=_int(record.year),
        application_id=_str(record.application),
        household_cm_id=_int(record.household_cm_id),
        person_cm_id=_int(getattr(record, "person_cm_id", 0)),
        session_cm_id=_int(getattr(record, "session_cm_id", 0)),
        program_key=_str(record.program_key),
        program_option_text=_str(getattr(record, "program_option_text", "")),
        program_option_key=_str(getattr(record, "program_option_key", "")),
        session_resolution=_str(record.session_resolution),
        ask=_float(getattr(record, "ask", 0)),
        headcount_non_infant=_int(getattr(record, "headcount_non_infant", 0)),
        headcount_infant=_int(getattr(record, "headcount_infant", 0)),
        headcount_source=_str(getattr(record, "headcount_source", "")),
        status=_str(record.status),
        duplicate_of=_str(getattr(record, "duplicate_of", "")),
        flags=tuple(_json(getattr(record, "flags", None), [])),
        equity=equity_from_json(_json(getattr(record, "equity", None), None)),
        answers=_answers_json(getattr(record, "answers", None)),
        answers_source=_str(getattr(record, "answers_source", "")),
        form_response_id=_str(getattr(record, "form_response_id", "")),
        form_submitted_at=_str(getattr(record, "form_submitted_at", "")),
        form_change_reviewed=_str(getattr(record, "form_change_reviewed", "")),
        form_change_reviewed_by=_str(getattr(record, "form_change_reviewed_by", "")),
        form_change_reviewed_at=_stamp(getattr(record, "form_change_reviewed_at", "")),
    )


def _answers_json(value: Any) -> dict[str, Any] | None:
    """aid_requests.answers: a request's own answer set (GF-2 = B), or None (a json field never written is null)."""
    parsed = _json(value, None)
    return dict(parsed) if isinstance(parsed, dict) else None


def _form_response(record: Any) -> FormResponseRow:
    return FormResponseRow(
        id=record.id,
        year=_int(getattr(record, "year", 0)),
        response_id=_str(getattr(record, "response_id", "")),
        form_status=_str(getattr(record, "form_status", "")),
        match_status=_str(getattr(record, "match_status", "")),
        person_cm_id=_int(getattr(record, "person_cm_id", 0)),
        household_cm_id=_int(getattr(record, "household_cm_id", 0)),
        program_key=_str(getattr(record, "program_key", "")),
        weekend_session_cm_id=_int(getattr(record, "weekend_session_cm_id", 0)),
        program_choice=_str(getattr(record, "program_choice", "")),
        ask=_float(getattr(record, "ask", 0)),
        answers={name: getattr(record, name, None) for name in (*HOUSEHOLD_ANSWER_FIELDS, "student_debt")},
        reported_income_fields=frozenset(_json(getattr(record, "reported_income_fields", None), []) or []),
        parse_notes=dict(_json(getattr(record, "parse_notes", None), {}) or {}),
        created_at_google=_str(getattr(record, "created_at_google", "")),
        last_submitted_at=_str(getattr(record, "last_submitted_at", "")),
        superseded_by=_str(getattr(record, "superseded_by", "")),
        registered_session_cm_id=_int(getattr(record, "registered_session_cm_id", 0)),
        match_tier=_int(getattr(record, "match_tier", 0)),
        match_candidates=tuple(
            c for c in (_json(getattr(record, "match_candidates", None), []) or []) if isinstance(c, dict)
        ),
        linked_by=_str(getattr(record, "linked_by", "")),
        linked_at=_stamp(getattr(record, "linked_at", "")),
        ignored_reason=_str(getattr(record, "ignored_reason", "")),
        ignored_kind=_str(getattr(record, "ignored_kind", "")),
        ignored_by=_str(getattr(record, "ignored_by", "")),
        ignored_at=_stamp(getattr(record, "ignored_at", "")),
        name_typed=_str(getattr(record, "name_typed", "")),
        county=_str(getattr(record, "county", "")),
        signature_typed=_str(getattr(record, "signature_typed", "")),
        agreement_date=_str(getattr(record, "agreement_date", "")),
    )


def _addition(record: Any) -> AdditionRecord:
    return AdditionRecord(
        id=record.id,
        year=_int(record.year),
        household_cm_id=_int(record.household_cm_id),
        person_cm_id=_int(getattr(record, "person_cm_id", 0)),
        program_key=_str(record.program_key),
        session_cm_id=_int(record.session_cm_id),
        ask=_float(getattr(record, "ask", 0)),
        source=_str(record.source),
        reason=_str(getattr(record, "reason", "")),
        actor=_str(getattr(record, "actor", "")),
        created=_stamp(getattr(record, "created", "")),
        retired_at=_stamp(getattr(record, "retired_at", "")),
        retired_by=_str(getattr(record, "retired_by", "")),
        retire_reason=_str(getattr(record, "retire_reason", "")),
        reviewed_at=_stamp(getattr(record, "reviewed_at", "")),
        reviewed_by=_str(getattr(record, "reviewed_by", "")),
    )


def _correction(record: Any) -> CorrectionRecord:
    return CorrectionRecord(
        id=record.id,
        year=_int(record.year),
        application_id=_str(record.application),
        request_id=_str(getattr(record, "request", "")),
        field=_str(record.field),
        new_value=_str(getattr(record, "new_value", "")),
        original_value=_str(getattr(record, "original_value", "")),
        reason=_str(record.reason),
        actor=_str(record.actor),
        created=_str(getattr(record, "created", "")),
    )


def _payer_share(record: Any) -> PayerShareRecord:
    return PayerShareRecord(
        id=record.id,
        year=_int(record.year),
        request_id=_str(record.request),
        household_cm_id=_int(record.household_cm_id),
        share_pct=_exact_pct(getattr(record, "share_pct", 0) or 0),
        source=_str(record.source),
        actor=_str(record.actor),
        note=_str(getattr(record, "note", "")),
    )


def _billing_line(record: Any) -> BillingLine:
    return BillingLine(
        household_cm_id=_int(getattr(record, "household_cm_id", 0)),
        person_cm_id=_int(getattr(record, "person_cm_id", 0)),
        session_cm_id=_int(getattr(record, "session_cm_id", 0)),
        category_cm_id=_int(getattr(record, "financial_category_cm_id", 0)),
        category_name=_str(getattr(_expanded(record, "financial_category"), "name", "")),
        description=_str(getattr(record, "description", "")),
        quantity=_float(getattr(record, "quantity", 0)),
        amount=_float(getattr(record, "amount", 0)),
        is_reversed=bool(getattr(record, "is_reversed", False)),
    )


class FinancialAidIntakeRepository:
    def __init__(self, pb: Any) -> None:
        self.pb = pb

    async def _page(self, collection: str, query_params: dict[str, Any]) -> list[Any]:
        rows: list[Any] = await pb_read(
            aid_collection(self.pb, collection).get_full_list, batch=PAGE_SIZE, query_params=query_params
        )
        return rows

    # -- the one write path (sub-project 4a) -------------------------------

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
        """Commit `writes` and one aid_change_log row each, as one operation (spec 14.4).
        commit_aid_writes is synchronous PocketBase I/O, so it runs off the event loop."""
        return await asyncio.to_thread(
            commit_aid_writes,
            self.pb,
            writes,
            actor=actor,
            operation_id=operation_id,
            reason=reason,
            require_reason=require_reason,
            allow_chunking=allow_chunking,
        )

    # -- season reads ------------------------------------------------------

    async def fetch_fa_rows(self, year: int) -> list[FaRow]:
        """The season's applicant rows (`is_applicant = true`), in PocketBase-id order. Answered from layer 1
        (aid_sync_inputs), which holds every row of the season projected to FA_READ_FIELDS and the other readers'
        columns."""
        rows = (await aid_sync_inputs(self.pb, year)).fa_applications
        return [_fa_row(r) for r in rows if getattr(r, "is_applicant", False) is True]

    async def fetch_fa_contacts(self, year: int) -> list[FaContact]:
        return await read_fa_contacts(self.pb, year)

    async def fetch_sessions(self, year: int) -> list[SessionRow]:
        rows = await self._page(
            CAMP_SESSIONS,
            {
                "filter": f"year = {year}",
                "fields": "id,cm_id,name,session_type,start_date,end_date,parent_id",
                "sort": STABLE_SORT,
            },
        )
        return [
            SessionRow(
                _int(r.cm_id),
                _str(r.name),
                _str(r.session_type),
                _str(getattr(r, "start_date", "")),
                _str(getattr(r, "end_date", "")),
                _int(getattr(r, "parent_id", 0)),
            )
            for r in rows
        ]

    async def fetch_birthdates(self, year: int, person_cm_ids: Sequence[int]) -> dict[int, str]:
        """Each named person's birthdate this season (blank when CampMinder holds none); a person with no record this
        season is left out. Answered from layer 1 (aid_sync_inputs)."""
        ids = sorted({p for p in person_cm_ids if p > 0})
        if not ids:
            return {}
        people = (await aid_sync_inputs(self.pb, year)).person_by_cm_id
        return {p: _str(getattr(people[p], "birthdate", "")) for p in ids if p in people}

    async def load_intake_rules(self, year: int) -> AidRules | None:
        """The newest version of the season whose `programs` and `cost` sections are both
        approved or locked (owner ruling 2026-09-25: never a draft), or None -- which is
        normal before finance approves them, and intake then waits visibly (Task 7)."""
        service = FinancialAidRulesService(AidRulesRepository(self.pb, read_only=True))
        version = await service.latest_approved(year, INTAKE_RULES_SECTIONS)
        return None if version is None else version.document

    async def load_equity_rules(self, year: int) -> AidRules | None:
        """The newest version of the season whose `equity` section is approved or locked, or
        None. Read only for the season warning on unanswered yes/no fields, never a draft."""
        service = FinancialAidRulesService(AidRulesRepository(self.pb, read_only=True))
        version = await service.latest_approved(year, _EQUITY_SECTION)
        return None if version is None else version.document

    async def fetch_payer_shares(self, year: int, request_ids: Sequence[str] | None = None) -> list[PayerShareRecord]:
        scope = ""
        if request_ids is not None:
            if not request_ids:
                return []
            scope = " && (" + " || ".join(f"request = '{pb_escape(r)}'" for r in request_ids) + ")"
        rows = await self._page(AID_PAYER_SHARES, {"filter": f"year = {year}{scope}", "sort": STABLE_SORT})
        return [_payer_share(r) for r in rows]

    async def fetch_registered_attendees(self, year: int) -> list[AttendeeRow]:
        rows = await self._page(
            ATTENDEES,
            {
                "filter": f"year = {year} && ({_REGISTERED_FILTER})",
                "expand": "person,session",
                "fields": "id,person_id,status_id,expand.person.household_id,expand.session.cm_id",
                "sort": STABLE_SORT,
            },
        )
        return [
            AttendeeRow(
                person_cm_id=_int(r.person_id),
                household_cm_id=_int(getattr(_expanded(r, "person"), "household_id", 0)),
                session_cm_id=_int(getattr(_expanded(r, "session"), "cm_id", 0)),
                status_id=_int(r.status_id),
            )
            for r in rows
        ]

    async def fetch_registration_ask_history(self, year: int) -> list[AskHistoryRow]:
        """The season's dated camper registration asks (PR 4a's aid_registration_ask_history, field 28906 only: the
        rule never reads the adult-weekend slot). All five rules are null; this client is the superuser."""
        rows = await self._page(
            ASK_HISTORY_COLLECTION,
            {
                "filter": f"year = {int(year)} && field_cm_id = {REGISTRATION_ASK_FIELD_CM_ID}",
                "fields": "id,person_cm_id,amount,source_changed_at,observed_at,created",
                "sort": STABLE_SORT,
            },
        )
        return [
            AskHistoryRow(
                person_cm_id=_int(getattr(r, "person_cm_id", 0)),
                amount=_float(getattr(r, "amount", 0)),
                source_changed_at=_str(getattr(r, "source_changed_at", "")),
                observed_at=_stamp(getattr(r, "observed_at", "")),
                created=_stamp(getattr(r, "created", "")),
            )
            for r in rows
        ]

    async def fetch_attendee_dates(self, year: int) -> list[AttendeeDates]:
        """Every registration of the season, ANY status, with its registration day (effective_date) and status date
        (enrollment_date): the registration-ask rule's match. A cancelled same-day registration still makes an ask
        ambiguous, so this is wider than fetch_registered_attendees, which reads registered statuses and no dates."""
        rows = await self._page(
            ATTENDEES,
            {
                "filter": f"year = {int(year)}",
                "expand": "person,session",
                "fields": "id,person_id,status_id,effective_date,enrollment_date,"
                "expand.person.household_id,expand.session.cm_id",
                "sort": STABLE_SORT,
            },
        )
        return [
            AttendeeDates(
                person_cm_id=_int(r.person_id),
                household_cm_id=_int(getattr(_expanded(r, "person"), "household_id", 0)),
                session_cm_id=_int(getattr(_expanded(r, "session"), "cm_id", 0)),
                status_id=_int(r.status_id),
                effective_date=_stamp(getattr(r, "effective_date", "")),
                enrollment_date=_stamp(getattr(r, "enrollment_date", "")),
            )
            for r in rows
        ]

    async def fetch_family_camp_billing(self, year: int) -> list[BillingLine]:
        rows = await self._page(
            FINANCIAL_TRANSACTIONS,
            {
                "filter": f"year = {year} && financial_category.name ~ 'Family Camp'",
                "expand": "financial_category",
                "fields": _BILLING_FIELDS,
                "sort": STABLE_SORT,
            },
        )
        return [_billing_line(r) for r in rows]

    async def fetch_applications(self, year: int) -> list[ApplicationRecord]:
        rows = await self._page(AID_APPLICATIONS, {"filter": f"year = {year}", "sort": STABLE_SORT})
        return [_application(r) for r in rows]

    async def fetch_requests(self, year: int, application_id: str | None = None) -> list[RequestRecord]:
        """The season's requests, or one application's. An empty id names no application,
        so it reads nothing rather than widening to the whole season."""
        if application_id == "":
            return []
        if application_id is None:
            # The whole season: inside a season build, one read shared with the grants register (aid_build_reads).
            # The same query GrantsRepository.fetch_request_refs shares, whole records, so neither loses a column.
            rows = await shared_read(
                (AID_REQUESTS, int(year), id(self.pb)),
                lambda: self._page(AID_REQUESTS, {"filter": f"year = {int(year)}", "sort": STABLE_SORT}),
            )
            return [_request(r) for r in rows]
        scope = f" && application = '{pb_escape(application_id)}'"
        rows = await self._page(AID_REQUESTS, {"filter": f"year = {year}{scope}", "sort": STABLE_SORT})
        return [_request(r) for r in rows]

    async def fetch_household_links(self, year: int) -> list[Any]:
        """The season's aid_household_links rows (D26), staff links included: intake reads them to know when a camper's
        household change stays within one aid family (family_household_set)."""
        return await FinancialAidRepository(self.pb).fetch_links(year)

    async def fetch_request_additions(self, year: int) -> list[AdditionRecord]:
        """The season's added requests, staff-added and (2027 on) rule-made, retired ones included
        (aid_request_additions; no sync writes it). Keep the retired ones: the registration-ask rule never re-makes a
        slot any addition held."""
        rows = await self._page(AID_REQUEST_ADDITIONS, {"filter": f"year = {int(year)}", "sort": STABLE_SORT})
        return [_addition(r) for r in rows]

    async def fetch_form_response_rows(self, year: int) -> list[FormResponseRow]:
        """The season's adult aid Google Form responses (aid_form_responses, every status), narrowed to
        FORM_RESPONSE_READ_FIELDS. All five rules are null; this client is the superuser."""
        rows = await self._page(
            AID_FORM_RESPONSES,
            {"filter": f"year = {int(year)}", "fields": FORM_RESPONSE_READ_FIELDS, "sort": STABLE_SORT},
        )
        return [_form_response(r) for r in rows]

    async def fetch_google_form_status(self, year: int) -> dict[str, str] | None:
        """The season's aid_google_forms row: when the job last read the form and what it said. None when the job has
        never run for the season (no form configured, or not yet pulled)."""
        rows = await self._page(
            AID_GOOGLE_FORMS,
            {"filter": f"year = {int(year)}", "fields": GOOGLE_FORM_STATUS_FIELDS, "sort": STABLE_SORT},
        )
        if not rows:
            return None
        return {
            "last_pulled_at": _stamp(getattr(rows[0], "last_pulled_at", "")),
            "last_pull_status": _str(getattr(rows[0], "last_pull_status", "")),
        }

    async def fetch_decided_request_ids(self, year: int) -> frozenset[str]:
        """The season's requests with a decision (financial_aid_google_form.decided_request_ids): every aid_decisions
        row but a family's ask. Two columns only."""
        rows = await self._page(
            AID_DECISIONS,
            {"filter": f"year = {int(year)} && event != 'ask'", "fields": "id,request,event", "sort": STABLE_SORT},
        )
        return frozenset(_str(getattr(r, "request", "")) for r in rows if getattr(r, "event", "") != "ask")

    # -- single-record reads -------------------------------------------------

    async def fetch_form_response(self, record_id: str) -> FormResponseRow | None:
        rows = await self._page(
            AID_FORM_RESPONSES,
            {"filter": f"id = '{pb_escape(record_id)}'", "fields": FORM_RESPONSE_READ_FIELDS, "sort": STABLE_SORT},
        )
        return _form_response(rows[0]) if rows else None

    async def search_registration_people(self, year: int, query: str) -> list[Any]:
        """Link…'s search: the season's persons by CampMinder id, birthdate (YYYY-MM-DD) or name words. The caller
        keeps those registered this season."""
        text = query.strip()
        if text.isdecimal():
            clause = f"cm_id = {int(text)}"
        elif _DAY.fullmatch(text):
            clause = f"birthdate ~ '{pb_escape(text)}'"
        else:
            words = [w[:40] for w in text.split()][:4]
            if not words:
                return []
            return await self._page(
                PERSONS,
                {"filter": person_name_filter(year, words), "fields": "cm_id,household_id", "sort": STABLE_SORT},
            )
        return await self._page(
            PERSONS, {"filter": f"year = {int(year)} && {clause}", "fields": "cm_id,household_id", "sort": STABLE_SORT}
        )

    async def fetch_person_contacts(self, year: int, person_cm_ids: Sequence[int]) -> dict[int, tuple[str, str]]:
        """Each named person's CampMinder birthdate and primary email this season: Link…'s evidence beside the
        response's own, for the candidates read only."""
        ids = sorted({int(p) for p in person_cm_ids if p > 0})
        if not ids:
            return {}
        scope = " || ".join(f"cm_id = {int(p)}" for p in ids)
        rows = await self._page(
            PERSONS,
            {
                "filter": f"year = {int(year)} && ({scope})",
                "fields": "cm_id,birthdate,primary_email",
                "sort": STABLE_SORT,
            },
        )
        return {
            _int(r.cm_id): (_str(getattr(r, "birthdate", ""))[:10], _str(getattr(r, "primary_email", ""))) for r in rows
        }

    async def fetch_form_response_identity(self, record_id: str) -> tuple[str, str]:
        """One response's respondent email and typed birthdate: Link…'s match evidence, read for that dialog only and
        never by a list (FORM_RESPONSE_READ_FIELDS leaves both out)."""
        rows = await self._page(
            AID_FORM_RESPONSES,
            {
                "filter": f"id = '{pb_escape(record_id)}'",
                "fields": "id,respondent_email,birthdate_typed",
                "sort": STABLE_SORT,
            },
        )
        if not rows:
            return "", ""
        return _str(getattr(rows[0], "respondent_email", "")), _str(getattr(rows[0], "birthdate_typed", ""))

    async def fetch_request_addition(self, record_id: str) -> AdditionRecord | None:
        rows = await self._page(
            AID_REQUEST_ADDITIONS, {"filter": f"id = '{pb_escape(record_id)}'", "sort": STABLE_SORT}
        )
        return _addition(rows[0]) if rows else None

    async def fetch_application(self, year: int, household_cm_id: int) -> ApplicationRecord | None:
        rows = await self._page(
            AID_APPLICATIONS, {"filter": f"year = {year} && household_cm_id = {household_cm_id}", "sort": STABLE_SORT}
        )
        return _application(rows[0]) if rows else None

    async def fetch_request(self, record_id: str) -> RequestRecord | None:
        rows = await self._page(AID_REQUESTS, {"filter": f"id = '{pb_escape(record_id)}'", "sort": STABLE_SORT})
        return _request(rows[0]) if rows else None

    async def find_active_request(
        self, year: int, household_cm_id: int, person_cm_id: int, session_cm_id: int
    ) -> RequestRecord | None:
        subject = (
            f"person_cm_id = {person_cm_id}"
            if person_cm_id
            else f"household_cm_id = {household_cm_id} && person_cm_id = 0"
        )
        rows = await self._page(
            AID_REQUESTS,
            {
                "filter": f"year = {year} && {subject} && session_cm_id = {session_cm_id} && status = '{pb_escape(STATUS_ACTIVE)}'",
                "sort": STABLE_SORT,
            },
        )
        return _request(rows[0]) if rows else None

    async def fetch_corrections(self, year: int, application_id: str | None) -> list[CorrectionRecord]:
        """See fetch_requests: an empty id reads nothing."""
        if application_id == "":
            return []
        scope = f" && application = '{pb_escape(application_id)}'" if application_id is not None else ""
        rows = await self._page(
            AID_APPLICATION_CORRECTIONS, {"filter": f"year = {year}{scope}", "sort": f"created,{STABLE_SORT}"}
        )
        return [_correction(r) for r in rows]

    # -- equity (ALLOWLIST) -----------------------------------------------

    async def fetch_equity_answers(self, year: int, person_cm_ids: Sequence[int]) -> dict[int, EquityAnswers]:
        """Each named person's equity answers. Answered from layer 1 (aid_sync_inputs), whose custom values are read
        through EQUITY_FIELD_CM_IDS and nothing wider; each person's values are in PocketBase-id order, so a field
        answered twice keeps its last answer, as the by-person read this replaces did."""
        ids = sorted({p for p in person_cm_ids if p > 0})
        if not ids:
            return {}
        inputs = await aid_sync_inputs(self.pb, year)
        poc: dict[int, dict[int, bool | None]] = {}
        gender: dict[int, tuple[str, str]] = {}
        for person in ids:
            for value in inputs.equity_values_by_person_cm_id.get(person, ()):
                poc.setdefault(person, {})[value.field_cm_id] = parse_poc_answer(_str(value.value))
            record = inputs.person_by_cm_id.get(person)
            if record is not None:
                gender[person] = (
                    _str(getattr(record, "gender_identity_name", "")),
                    _str(getattr(record, "gender_pronoun_name", "")),
                )
        result: dict[int, EquityAnswers] = {}
        for person in ids:
            answers = poc.get(person, {})
            bipoc = next((answers[f] for f in EQUITY_FIELD_CM_IDS if answers.get(f) is not None), None)
            identity, pronouns = gender.get(person, (UNKNOWN_EQUITY.gender_identity, UNKNOWN_EQUITY.pronouns))
            result[person] = EquityAnswers(bipoc, identity, pronouns)
        return result


# Public names for the as-of reads (3c), which parse records rebuilt from aid_change_log. 3c-1 rebuilds
# requests only; 3c-2 (pricing from the log) rebuilds applications and payer shares with the other two.
request_record = _request
application_record = _application
payer_share_record = _payer_share
