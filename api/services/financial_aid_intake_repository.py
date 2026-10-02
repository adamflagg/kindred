"""PocketBase access for campership intake (sub-project 5).

Through FastAPI's superuser client. Every aid_* collection has all five rules
null, and the router gates each call on a financial_aid.* permission first.

Two reads are narrowed on purpose, and tests pin both:

* `fetch_fa_rows` names its columns. financial_aid_applications also holds
  addresses and phone numbers that intake never needs. (The contact NAME is
  read, by `read_fa_contacts` below: the Requests grid's Requested by and the
  jump index's requesters, each column-narrowed too.)
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
from collections.abc import Awaitable, Callable, Iterator, Sequence
from decimal import Decimal
from typing import Any, Final

from api.constants.collections import (
    AID_APPLICATION_CORRECTIONS,
    AID_APPLICATIONS,
    AID_PAYER_SHARES,
    AID_REQUESTS,
    AID_SESSION_CAPACITY,
    ATTENDEES,
    CAMP_SESSIONS,
    FINANCIAL_AID_APPLICATIONS,
    FINANCIAL_TRANSACTIONS,
    PERSON_CUSTOM_VALUES,
    PERSONS,
)
from api.services.financial_aid_household import HOUSEHOLD_ANSWER_FIELDS
from api.services.financial_aid_intake_types import (
    INTAKE_RULES_SECTIONS,
    REGISTERED_STATUS_IDS,
    STATUS_ACTIVE,
    UNKNOWN_EQUITY,
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
from api.services.financial_aid_requesters import FaContact
from api.services.financial_aid_rules_service import AidRulesRepository, FinancialAidRulesService
from api.services.pb_precise_datetime import aid_collection
from api.utils.pb_filters import pb_escape
from bunking.financial_aid.change_log import AidOperationResult, AidWrite, commit_aid_writes
from bunking.financial_aid.rules.schema import AidRules, SectionName

PAGE_SIZE: Final = 500
STABLE_SORT: Final = "id"
PERSON_FILTER_CHUNK: Final = 50

# The registration-time ask (CA-FinancialAssistanceAmount for a camper, WW-FA
# Amount for an adult). SP1 renamed it from amount_awarded (migration 1500000184).
FA_REGISTRATION_ASK_FIELD: Final = "registration_request_amount"

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
        "reported_income_fields",
        "expand.household.cm_id",
    )
)
FA_CONTACT_FIELDS: Final = "id,person_id,contact_first_name,contact_last_name,expand.household.cm_id"
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
_REGISTERED_FILTER: Final = " || ".join(f"status_id = {s}" for s in sorted(REGISTERED_STATUS_IDS))


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


def _chunks(values: Sequence[int], size: int) -> Iterator[Sequence[int]]:
    for start in range(0, len(values), size):
        yield values[start : start + size]


def _expanded(record: Any, name: str) -> Any:
    expand = getattr(record, "expand", None) or {}
    return expand.get(name) if isinstance(expand, dict) else None


def _int(value: Any) -> int:
    return int(float(value or 0))


def _float(value: Any) -> float:
    return float(value or 0)


def _str(value: Any) -> str:
    return str(value or "")


async def read_fa_contacts(page: Callable[[str, dict[str, Any]], Awaitable[list[Any]]], year: int) -> list[FaContact]:
    """The contact name on every aid form row of the season, not only applicants, with the camper and household it
    belongs to: the Requests grid's Requested by, and the jump index's requesters (financial_aid_requesters). Only
    those columns are read. `page` is a repository's `_page`, so every aid repository shares this one query."""
    rows = await page(
        FINANCIAL_AID_APPLICATIONS,
        {
            "filter": f"year = {int(year)}",
            "expand": "household",
            "fields": FA_CONTACT_FIELDS,
            "sort": STABLE_SORT,
        },
    )
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


def _capacity(record: Any) -> CapacityRecord:
    return CapacityRecord(
        id=record.id,
        year=_int(record.year),
        session_cm_id=_int(record.session_cm_id),
        capacity=_int(getattr(record, "capacity", 0)),
        note=_str(getattr(record, "note", "")),
        actor=_str(record.actor),
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
        rows: list[Any] = await asyncio.to_thread(
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
        rows = await self._page(
            FINANCIAL_AID_APPLICATIONS,
            {
                "filter": f"year = {year} && is_applicant = true",
                "expand": "household",
                "fields": FA_READ_FIELDS,
                "sort": STABLE_SORT,
            },
        )
        return [_fa_row(r) for r in rows]

    async def fetch_fa_contacts(self, year: int) -> list[FaContact]:
        return await read_fa_contacts(self._page, year)

    async def fetch_sessions(self, year: int) -> list[SessionRow]:
        rows = await self._page(
            CAMP_SESSIONS,
            {
                "filter": f"year = {year}",
                "fields": "id,cm_id,name,session_type,start_date,end_date",
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
            )
            for r in rows
        ]

    async def fetch_birthdates(self, year: int, person_cm_ids: Sequence[int]) -> dict[int, str]:
        ids = sorted({p for p in person_cm_ids if p > 0})
        found: dict[int, str] = {}
        for chunk in _chunks(ids, PERSON_FILTER_CHUNK):
            rows = await self._page(
                PERSONS,
                {
                    "filter": f"year = {year} && ({' || '.join(f'cm_id = {p}' for p in chunk)})",
                    "fields": "id,cm_id,birthdate",
                    "sort": STABLE_SORT,
                },
            )
            found.update({_int(r.cm_id): _str(getattr(r, "birthdate", "")) for r in rows})
        return found

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
        scope = f" && application = '{pb_escape(application_id)}'" if application_id is not None else ""
        rows = await self._page(AID_REQUESTS, {"filter": f"year = {year}{scope}", "sort": STABLE_SORT})
        return [_request(r) for r in rows]

    # -- single-record reads -------------------------------------------------

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
                "filter": f"year = {year} && {subject} && session_cm_id = {session_cm_id} && status = '{STATUS_ACTIVE}'",
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

    async def fetch_capacity(self, year: int, session_cm_id: int) -> CapacityRecord | None:
        rows = await self._page(
            AID_SESSION_CAPACITY, {"filter": f"year = {year} && session_cm_id = {session_cm_id}", "sort": STABLE_SORT}
        )
        return _capacity(rows[0]) if rows else None

    async def fetch_capacities(self, year: int) -> list[CapacityRecord]:
        rows = await self._page(
            AID_SESSION_CAPACITY, {"filter": f"year = {int(year)}", "sort": f"session_cm_id,{STABLE_SORT}"}
        )
        return [_capacity(row) for row in rows]

    # -- equity (ALLOWLIST) -----------------------------------------------

    async def fetch_equity_answers(self, year: int, person_cm_ids: Sequence[int]) -> dict[int, EquityAnswers]:
        ids = sorted({p for p in person_cm_ids if p > 0})
        if not ids:
            return {}
        field_filter = allowlist_filter(EQUITY_FIELD_CM_IDS)
        poc: dict[int, dict[int, bool | None]] = {}
        gender: dict[int, tuple[str, str]] = {}
        for chunk in _chunks(ids, PERSON_FILTER_CHUNK):
            people = " || ".join(f"person.cm_id = {p}" for p in chunk)
            values = await self._page(
                PERSON_CUSTOM_VALUES,
                {
                    "filter": f"year = {year} && ({field_filter}) && ({people})",
                    "expand": "person,field_definition",
                    "fields": "id,value,expand.person.cm_id,expand.field_definition.cm_id",
                    "sort": STABLE_SORT,
                },
            )
            for row in values:
                person = _int(getattr(_expanded(row, "person"), "cm_id", 0))
                field_cm_id = _int(getattr(_expanded(row, "field_definition"), "cm_id", 0))
                poc.setdefault(person, {})[field_cm_id] = parse_poc_answer(_str(getattr(row, "value", "")))
            persons = await self._page(
                PERSONS,
                {
                    "filter": f"year = {year} && ({' || '.join(f'cm_id = {p}' for p in chunk)})",
                    "fields": "id,cm_id,gender_identity_name,gender_pronoun_name",
                    "sort": STABLE_SORT,
                },
            )
            for row in persons:
                gender[_int(row.cm_id)] = (
                    _str(getattr(row, "gender_identity_name", "")),
                    _str(getattr(row, "gender_pronoun_name", "")),
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
