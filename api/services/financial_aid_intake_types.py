"""Plain value types for campership intake (sub-project 5).

The repository turns PocketBase records into these. Every pure rule and the
planner work on them, so no rule test needs a PocketBase mock.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Final

from api.constants.filters import ACTIVE_ENROLLED_STATUS_ID
from bunking.financial_aid.rules.schema import SectionName

PROGRAM_SUMMER: Final = "summer"
PROGRAM_FAMILY_CAMP: Final = "family_camp"
PROGRAM_BMITZVAH: Final = "bmitzvah"
PROGRAM_ADULT_WEEKEND: Final = "adult_weekend"

STATUS_ACTIVE: Final = "active"
STATUS_UNMATCHED: Final = "unmatched_session"
STATUS_DUPLICATE_PENDING: Final = "duplicate_pending"
STATUS_DUPLICATE: Final = "duplicate"
STATUS_WITHDRAWN: Final = "withdrawn"

APPLICATION_ACTIVE: Final = "active"
APPLICATION_WITHDRAWN: Final = "withdrawn"

HEADCOUNT_DECLARED: Final = "declared"
HEADCOUNT_BILLED: Final = "billed"
HEADCOUNT_OVERRIDE: Final = "override"
STAFF_HEADCOUNT_SOURCES: Final = frozenset({HEADCOUNT_DECLARED, HEADCOUNT_OVERRIDE})

RESOLUTION_STAFF: Final = "staff"
RESOLUTION_UNMATCHED: Final = "unmatched"

# The attendee statuses that count as "registered" for an adult weekend, so an
# adult-weekend request is created: enrolled (2), applied (4), waitlisted (8),
# incomplete (512). An FA applicant is often waitlisted. Only enrolled (2) ever
# SETS a session (owner ruling 2026-09-27). See pocketbase/sync/attendees.go.
REGISTERED_STATUS_IDS: Final = frozenset({ACTIVE_ENROLLED_STATUS_ID, 4, 8, 512})

INTAKE_ACTOR: Final = "system:intake"

# aid_requests field limits (pocketbase/pb_migrations/1500000201). PocketBase refuses a value
# outside them, and one refusal rolls back the season's whole intake batch, so intake never
# writes one: option text is clipped, and a headcount beyond them counts as no headcount.
OPTION_TEXT_MAX_LENGTH: Final = 500
HEADCOUNT_NON_INFANT_MAX: Final = 50
HEADCOUNT_INFANT_MAX: Final = 20

SHARE_SOURCE_INTAKE: Final = "intake_default"
SHARE_SOURCE_STAFF: Final = "staff"

# The rules sections intake waits on (owner ruling Q4, 2026-09-25): `programs`, which it reads to
# check that a resolved session belongs to a program, and `cost`, which it no longer reads (infants
# are under 2, a constant) but keeps so intake waits for the whole Programs and costs card, approved
# together. Intake only ever uses a version in which BOTH are approved or locked, never a draft.
INTAKE_RULES_SECTIONS: Final[tuple[SectionName, ...]] = ("programs", "cost")
# No version has those sections approved yet: the request is recorded, and waits visibly.
FLAG_AWAITING_RULES: Final = "awaiting_approved_rules"
# The approved rules claim no program for the request's session.
FLAG_NO_PROGRAM: Final = "no_program_for_session"
# The answer's option text names exactly one in-program session and the request sits on
# another (registration decides; owner ruling 2026-09-27). Information for staff, NEVER a
# hold: financial_aid_calc_inputs.request_issues does not read it.
FLAG_SESSION_DIFFERS: Final = "session_differs_from_answer"
# A staff `duplicate` came back to life because the request it duplicated is no longer active
# and nothing else holds its slot. Sticky across rebuilds, and always a hold: the payer shares
# and any decision stayed on the withdrawn survivor, named in the detail.
FLAG_DUPLICATE_SURVIVOR_WITHDRAWN: Final = "duplicate_survivor_withdrawn"

RequestKey = tuple[int, int, str, str]


@dataclass(frozen=True)
class Flag:
    """A data-quality state shown to staff. Never a silent default (spec 3.5)."""

    code: str
    detail: Mapping[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        return {"code": self.code, "detail": dict(self.detail)}


@dataclass(frozen=True)
class FaRow:
    """One financial_aid_applications record: only the columns intake reads."""

    person_cm_id: int
    household_cm_id: int  # 0 when the FA row carries no household
    answers: Mapping[str, Any]
    summer_program: str
    summer_amount_requested: float
    fc_program: str
    fc_amount_requested: float
    tbm_program: str
    tbm_amount_requested: float
    interest_expressed: bool
    registration_ask: float
    # The income columns the family actually answered (Task 1b), 0 included. An
    # income column that is 0 and NOT listed here was left blank: unknown.
    reported_income_fields: frozenset[str] = frozenset()


@dataclass(frozen=True)
class SessionRow:
    cm_id: int
    name: str
    session_type: str
    start_date: str = ""  # camp_sessions.start_date, "YYYY-MM-DD..."; "" when unknown
    end_date: str = ""  # camp_sessions.end_date, the same shape; "" when unknown
    # camp_sessions.parent_id: the main session an AG (or embedded) session sits under, a CampMinder id; 0 when none.
    # The sync sets it for an AG session only on an exact start-and-end match (pocketbase/sync/sessions.go:346-366).
    parent_cm_id: int = 0


@dataclass(frozen=True)
class AttendeeRow:
    person_cm_id: int
    household_cm_id: int
    session_cm_id: int
    status_id: int


@dataclass(frozen=True)
class BillingLine:
    household_cm_id: int
    person_cm_id: int
    session_cm_id: int
    category_cm_id: int
    category_name: str
    description: str
    quantity: float
    amount: float
    is_reversed: bool


@dataclass(frozen=True)
class SessionResolution:
    session_cm_id: int  # 0 = unmatched
    method: str  # enrollment | enrollment_text | unmatched ("staff" is set by casework only)
    candidates: tuple[int, ...]


@dataclass(frozen=True)
class ApplicationRecord:
    id: str
    year: int
    household_cm_id: int
    status: str
    answers: Mapping[str, Any]
    member_person_cm_ids: tuple[int, ...]
    flags: tuple[Mapping[str, Any], ...] = ()


@dataclass(frozen=True)
class EquityAnswers:
    """A camper's own equity answers. None / "" means unanswered, never "no"."""

    bipoc: bool | None
    gender_identity: str
    pronouns: str


UNKNOWN_EQUITY: Final = EquityAnswers(bipoc=None, gender_identity="", pronouns="")


def equity_json(answers: EquityAnswers) -> dict[str, Any]:
    """The recorded copy's shape on aid_requests.equity (3c-2)."""
    return {"bipoc": answers.bipoc, "gender_identity": answers.gender_identity, "pronouns": answers.pronouns}


def equity_from_json(value: Any) -> EquityAnswers | None:
    """aid_requests.equity back into answers; None when no copy is recorded (null, or not an object)."""
    if not isinstance(value, Mapping):
        return None
    bipoc = value.get("bipoc")
    return EquityAnswers(
        bipoc=bipoc if isinstance(bipoc, bool) else None,
        gender_identity=str(value.get("gender_identity") or ""),
        pronouns=str(value.get("pronouns") or ""),
    )


@dataclass(frozen=True)
class RequestRecord:
    id: str
    year: int
    application_id: str
    household_cm_id: int
    person_cm_id: int
    session_cm_id: int
    program_key: str
    program_option_text: str
    program_option_key: str
    session_resolution: str
    ask: float
    headcount_non_infant: int
    headcount_infant: int
    headcount_source: str
    status: str
    duplicate_of: str
    flags: tuple[Mapping[str, Any], ...] = ()
    # Intake's recorded copy of the camper's equity answers (3c-2), logged like every intake field, so
    # a past date prices the answers as intake had recorded them. Live pricing still reads the synced
    # answers (owner ruling 2026-09-30). None: no copy yet (always so for a household-level request).
    equity: EquityAnswers | None = None

    @property
    def key(self) -> RequestKey:
        return (self.household_cm_id, self.person_cm_id, self.program_key, self.program_option_key)


@dataclass(frozen=True)
class CorrectionRecord:
    id: str
    year: int
    application_id: str
    request_id: str
    field: str
    new_value: str
    original_value: str
    reason: str
    actor: str
    created: str


@dataclass(frozen=True)
class PayerShareRecord:
    """One aid_payer_shares row: a household and its percentage of the request. Dollars are
    never stored; they are computed from the current award (financial_aid_payer_shares)."""

    id: str
    year: int
    request_id: str
    household_cm_id: int
    share_pct: Decimal
    source: str
    actor: str
    note: str = ""
