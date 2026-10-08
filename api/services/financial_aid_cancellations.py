"""A request's cancellation (campership sub-project 10b; clean spec §5.3, §5.6, §6.2, §6.3; main spec
§10.5 as amended; D54, D101 as amended by D141).

A request is CANCELLED when either:

  * CampMinder cancelled its enrollment: its camper (for a Family Camp request, its household) has a
    cancelled (32) or withdrawn (256) registration and no enrolled (2) one (the grants register's own
    rule, registrations_cancelled; applied and waitlisted keep nothing on), in the request's session
    when it has one, otherwise in any session of the request's program. The program rule matters
    because intake re-resolves every request from registration on every run and only an enrolled
    registration sets a session, so a cancelled camper's request turns unmatched (session 0) the
    night after. A session STAFF set is kept on every run (intake's _session_choice), so for one an
    enrolled registration anywhere in the program also means not cancelled (the camper switched), and
    a cancelled one there cancels it, as for an unmatched request.
    The day is the latest cancelled row's enrollment_date, CampMinder's PostDate, which is the
    cancellation date (spec §6.2); or
  * the registrar cancelled it in Kindred (an aid_cancellations "cancel" with in_kindred): the family
    declined, or no longer wants aid, while the camper stays enrolled.

A cancelled request is not live (clean spec §5.3: "a cancellation before posting simply leaves Needs
an offer"; owner ruling 2026-09-30): its unposted rounds count nowhere, so it leaves Needs an offer
and Held, and the ledger never ticks it. Its posted rounds stay in Posted until CampMinder's reversal
posts (D54).

The reason is one of D141's nine, and it is OPTIONAL (owner ruling B, 2026-10-04, retiring D101's
"Cancelled: give a reason" to-do, its queue and its Today line): nothing asks for a missing one. Staff
can still record it (the Cancel dialog, a To reverse row, the household page's cancelled request card).
The reports read a cancellation with none as "no reason recorded", on its own line. Only live
requests (active, unmatched) take a cancellation: a withdrawn or duplicate request already counts
nowhere.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Final, Literal, get_args

from api.services.financial_aid_grants_register import (
    CANCELLED_STATUS_IDS,
    LIVE_REQUEST_STATUSES,
    registrations_cancelled,
)
from api.services.financial_aid_intake_types import RESOLUTION_STAFF, RequestRecord, SessionRow
from api.services.financial_aid_reconciliation import camp_date
from api.services.financial_aid_session_resolver import PROGRAM_SESSION_TYPES

# D141 (owner, 2026-09-30): nine reasons, amending D101's three. The order is the picker's.
CancelReason = Literal[
    "aid_not_enough",
    "medical",
    "schedule",
    "not_ready",
    "did_not_want_to_appeal",
    "not_financially_related",
    "early_cancel",
    "another_reason",
    "not_known",
]
CANCEL_REASONS: Final[tuple[CancelReason, ...]] = get_args(CancelReason)
# Staff-facing, as clean spec §6.3 words them; the change log's reason. "aid not enough" is shown in
# full: it is the one Development counts (D101).
CANCEL_REASON_LABELS: Final[Mapping[CancelReason, str]] = {
    "aid_not_enough": "declined: aid not enough / financial constraints",
    "medical": "medical",
    "schedule": "schedule",
    "not_ready": "not ready",
    "did_not_want_to_appeal": "did not want to appeal",
    "not_financially_related": "not financially related",
    "early_cancel": "early cancel",
    "another_reason": "another reason",
    "not_known": "not known",
}


def parse_reason(value: Any) -> CancelReason | None:
    text = str(value or "")
    if not text:
        return None
    for reason in CANCEL_REASONS:
        if reason == text:
            return reason
    raise ValueError(f"{text!r} is not one of the cancel reasons")


@dataclass(frozen=True)
class CancelEvent:
    """One aid_cancellations row."""

    id: str
    request_id: str
    kind: Literal["cancel", "reopen"]
    created: datetime
    reason: CancelReason | None = None
    in_kindred: bool = False
    note: str = ""
    actor: str = ""


@dataclass(frozen=True)
class CancelState:
    in_kindred: bool = False
    reason: CancelReason | None = None
    note: str = ""
    at: datetime | None = None


def fold_cancellations(events: Iterable[CancelEvent], *, as_of: datetime | None = None) -> dict[str, CancelState]:
    """request id -> its state, from the events recorded up to `as_of` (every event when None). The
    latest wins; a reopen clears everything. The record id breaks a tie in the same instant."""
    out: dict[str, CancelState] = {}
    kept = (e for e in events if as_of is None or e.created <= as_of)
    for event in sorted(kept, key=lambda e: (e.created, e.id)):
        out[event.request_id] = (
            CancelState(event.in_kindred, event.reason, event.note, event.created)
            if event.kind == "cancel"
            else CancelState()
        )
    return out


@dataclass(frozen=True)
class EnrollmentState:
    """One attendees row: enrolled (2), cancelled (32) or withdrawn (256). changed_on is its
    enrollment_date: for a cancelled row, the day it was cancelled."""

    person_cm_id: int
    household_cm_id: int
    session_cm_id: int
    status_id: int
    changed_on: date | None


def _scope(
    request: RequestRecord, enrollments: Sequence[EnrollmentState], session_types: Mapping[int, str]
) -> list[EnrollmentState]:
    """The registrations that say whether CampMinder cancelled this request's enrollment."""
    if request.person_cm_id > 0:
        mine = [e for e in enrollments if e.person_cm_id == request.person_cm_id]
    else:
        mine = [e for e in enrollments if e.household_cm_id == request.household_cm_id]
    program = PROGRAM_SESSION_TYPES.get(request.program_key, frozenset())
    in_program = [e for e in mine if session_types.get(e.session_cm_id, "") in program]
    in_session = [e for e in mine if e.session_cm_id == request.session_cm_id]
    if request.session_cm_id <= 0:
        return in_program
    if request.session_resolution == RESOLUTION_STAFF:
        # Intake keeps a staff session on every run, so the program counts both ways (final review,
        # ruled): an enrolment elsewhere in it is a switch, a cancellation elsewhere in it still cancels.
        return [*in_program, *(e for e in in_session if e not in in_program)]
    return in_session


def enrollment_cancelled(
    request: RequestRecord, enrollments: Sequence[EnrollmentState], session_types: Mapping[int, str]
) -> tuple[bool, date | None]:
    """Whether CampMinder cancelled this request's enrollment, and the day (None if unknown)."""
    scope = _scope(request, enrollments, session_types)
    if not registrations_cancelled(e.status_id for e in scope):
        return False, None
    days = [e.changed_on for e in scope if e.status_id in CANCELLED_STATUS_IDS and e.changed_on is not None]
    return True, max(days) if days else None


def first_cancelled_on(
    request: RequestRecord, enrollments: Sequence[EnrollmentState], session_types: Mapping[int, str]
) -> tuple[bool, date | None]:
    """Whether CampMinder cancelled this request's enrollment, and the EARLIEST cancelled registration's
    date (None when a cancelled one has none): a past read (3c-2) masks the request on any day by which
    the live read would already have seen a cancelled registration."""
    scope = _scope(request, enrollments, session_types)
    if not registrations_cancelled(e.status_id for e in scope):
        return False, None
    days = [e.changed_on for e in scope if e.status_id in CANCELLED_STATUS_IDS]
    return True, None if None in days else min(d for d in days if d is not None)


def cancelled_days(
    request: RequestRecord, enrollments: Sequence[EnrollmentState], session_types: Mapping[int, str]
) -> list[date | None]:
    """The date of each registration CampMinder cancelled for this request (None: undated), the registrations
    enrollment_cancelled and first_cancelled_on read."""
    return [e.changed_on for e in _scope(request, enrollments, session_types) if e.status_id in CANCELLED_STATUS_IDS]


@dataclass(frozen=True)
class Cancellation:
    by: Literal["campminder", "kindred"]
    on: date | None
    reason: CancelReason | None  # None: none recorded; optional (owner ruling B, 2026-10-04)
    note: str


def _by_person_and_household(
    enrollments: Iterable[EnrollmentState],
) -> tuple[dict[int, list[EnrollmentState]], dict[int, list[EnrollmentState]]]:
    by_person: dict[int, list[EnrollmentState]] = defaultdict(list)
    by_household: dict[int, list[EnrollmentState]] = defaultdict(list)
    for e in enrollments:
        by_person[e.person_cm_id].append(e)
        by_household[e.household_cm_id].append(e)
    return by_person, by_household


def _rows(
    request: RequestRecord,
    by_person: Mapping[int, list[EnrollmentState]],
    by_household: Mapping[int, list[EnrollmentState]],
) -> list[EnrollmentState]:
    if request.person_cm_id > 0:
        return by_person.get(request.person_cm_id, [])
    return by_household.get(request.household_cm_id, [])


def cancellations_by_request(
    requests: Iterable[RequestRecord],
    events: Iterable[CancelEvent],
    enrollments: Iterable[EnrollmentState],
    sessions: Iterable[SessionRow],
) -> dict[str, Cancellation]:
    """Each cancelled live request's cancellation. CampMinder's comes first: once CampMinder has
    cancelled the enrollment, a Kindred cancellation only gave the reason."""
    states = fold_cancellations(events)
    by_person, by_household = _by_person_and_household(enrollments)
    session_types = {s.cm_id: s.session_type for s in sessions}
    out: dict[str, Cancellation] = {}
    for request in requests:
        if request.status not in LIVE_REQUEST_STATUSES:
            continue
        state = states.get(request.id, CancelState())
        cancelled, day = enrollment_cancelled(request, _rows(request, by_person, by_household), session_types)
        if cancelled:
            # A family cancels once (owner 2026-10-01), so a recorded reason answers this cancellation
            # even if CampMinder later moves its date.
            out[request.id] = Cancellation("campminder", day, state.reason, state.note)
        elif state.in_kindred:
            out[request.id] = Cancellation(
                "kindred", camp_date(state.at) if state.at is not None else None, state.reason, state.note
            )
    return out
