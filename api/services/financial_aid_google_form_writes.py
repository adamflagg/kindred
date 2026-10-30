"""Staff's writes on adult aid form responses (adult-aid form design PR 2, §5; owner answers 2026-10-29).

  - Link…: the response is this person's, a person registered this season (any status intake reads: enrolled,
    applied, waitlisted, incomplete). match_status "staff" (PR 1's job never re-matches a staff row), linked_by /
    linked_at, and the person's own household as their registration names it. An ignored response can be Link…ed:
    that is how an Ignore is undone (owner Q3).
  - Ignore…: a test, a duplicate, someone not asking for aid, or other; a reason is required only for other. The
    kind, who and when are kept beside it.
  - Mark Reviewed (owner Q2): a request flagged form_changed_after_decision / form_response_deleted (GF-4) records
    the change staff reviewed, so the look stays cleared until a DIFFERENT change arrives. Nothing is applied.
  - link_candidates: Link…'s dialog, the only read of the respondent email (and the typed birthdate).

Every write is ONE aid_change_log operation (commit_aid_writes) with the actor and the reason, as casework's are.
aid_form_responses is locked (all five rules null): only this superuser client writes staff's fields, and the job
leaves a staff or ignored row's match alone. The caller rebuilds the season's intake afterwards.
"""

from __future__ import annotations

from collections.abc import Collection, Sequence
from datetime import UTC, datetime
from typing import Any, Final, Protocol

from api.constants.collections import AID_FORM_RESPONSES, AID_REQUESTS
from api.schemas.financial_aid_form_intake import (
    FormChangeReviewedOut,
    FormResponseActionOut,
    LinkCandidateOut,
    LinkCandidatesOut,
)
from api.services.financial_aid_casework_service import CaseworkNotFoundError, CaseworkValidationError
from api.services.financial_aid_form_intake import candidate_out
from api.services.financial_aid_google_form import (
    FORM_CHANGE_FLAGS,
    FORM_PROGRAMS,
    MATCH_IGNORED,
    MATCH_STAFF,
    FormResponseRow,
    is_form_request,
)
from api.services.financial_aid_intake_service import season_lock
from api.services.financial_aid_intake_types import AttendeeRow, RequestRecord
from bunking.financial_aid.change_log import AidOperationResult, AidWrite

ACTION_LINK: Final = "link_form_response"
ACTION_IGNORE: Final = "ignore_form_response"
ACTION_REVIEW: Final = "review_form_change"
# The staff-owned fields a Link… or Ignore… writes (and logs as its `before`).
_STAFF_FIELDS: Final = (
    "match_status",
    "person_cm_id",
    "household_cm_id",
    "linked_by",
    "linked_at",
    "ignored_kind",
    "ignored_reason",
    "ignored_by",
    "ignored_at",
)


class FormResponseStore(Protocol):
    async def fetch_form_response(self, record_id: str) -> FormResponseRow | None: ...
    async def fetch_form_response_identity(self, record_id: str) -> tuple[str, str]: ...
    async def fetch_registered_attendees(self, year: int) -> list[AttendeeRow]: ...
    async def search_registration_people(self, year: int, query: str) -> list[Any]: ...
    async def fetch_person_contacts(self, year: int, person_cm_ids: Sequence[int]) -> dict[int, tuple[str, str]]: ...
    async def fetch_request(self, record_id: str) -> RequestRecord | None: ...
    async def fetch_names(
        self, year: int, household_cm_ids: Collection[int], person_cm_ids: Collection[int]
    ) -> tuple[dict[int, str], dict[int, str]]: ...
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


IGNORE_OTHER: Final = "other"
IGNORE_KINDS: Final = frozenset({"test", "duplicate", "not_asking", IGNORE_OTHER})
CANDIDATES_MAX: Final = 25
# attendees.status_id -> the word Link… shows (the registered statuses intake reads).
_STATUS_WORDS: Final[dict[int, str]] = {2: "enrolled", 4: "applied", 8: "waitlisted", 512: "incomplete"}


def _registration_status(rows: Sequence[AttendeeRow], candidate: LinkCandidateOut) -> str:
    """The candidate's best registration status in the sessions the evidence names (else any of theirs): enrolled
    before applied, waitlisted, incomplete."""
    named = [a for a in rows if a.session_cm_id in candidate.session_cm_ids] or list(rows)
    for status in (2, 4, 8, 512):
        if any(a.status_id == status for a in named):
            return _STATUS_WORDS[status]
    return ""


def _now() -> str:
    """A PocketBase date as PocketBase writes one."""
    at = datetime.now(UTC)
    return at.strftime("%Y-%m-%d %H:%M:%S.") + f"{at.microsecond // 1000:03d}Z"


def _staff_fields(row: FormResponseRow) -> dict[str, Any]:
    return {name: getattr(row, name) for name in _STAFF_FIELDS}


def _action_out(row: FormResponseRow, fields: dict[str, Any]) -> FormResponseActionOut:
    merged = {**_staff_fields(row), **fields}
    return FormResponseActionOut(id=row.id, response_id=row.response_id, **merged)


class FormResponseCaseworkService:
    def __init__(self, store: FormResponseStore) -> None:
        self._store = store

    async def _require(self, year: int, record_id: str) -> FormResponseRow:
        row = await self._store.fetch_form_response(record_id)
        if row is None or row.year != year:
            raise CaseworkNotFoundError("no such adult aid form response this season")
        return row

    async def _write(
        self, row: FormResponseRow, fields: dict[str, Any], action: str, *, actor: str, reason: str, required: bool
    ) -> None:
        before = _staff_fields(row)
        changed = {k: v for k, v in fields.items() if before.get(k) != v}
        if not changed:
            return
        await self._store.commit(
            [
                AidWrite(
                    collection=AID_FORM_RESPONSES,
                    action="update",
                    year=row.year,
                    record_id=row.id,
                    before={k: before[k] for k in changed},
                    data=changed,
                    log_action=action,
                )
            ],
            actor=actor,
            reason=reason,
            require_reason=required,
        )

    async def link(
        self, year: int, record_id: str, person_cm_id: int, reason: str, actor: str
    ) -> FormResponseActionOut:
        row = await self._require(year, record_id)
        if row.program_key not in FORM_PROGRAMS:
            # It would make no request whoever it is linked to; Ignore… clears it from Responses to link.
            raise CaseworkValidationError("that response names no Family Camp or adult weekend program")
        registered = [a for a in await self._store.fetch_registered_attendees(year) if a.person_cm_id == person_cm_id]
        if not registered:
            raise CaseworkValidationError(f"that person is not registered for a {year} session")
        households = sorted({a.household_cm_id for a in registered if a.household_cm_id > 0})
        if not households:
            raise CaseworkValidationError("that person's registration names no household")
        fields = {
            "match_status": MATCH_STAFF,
            "person_cm_id": int(person_cm_id),
            "household_cm_id": households[0],
            "linked_by": actor,
            "linked_at": _now(),
            "ignored_kind": "",
            "ignored_reason": "",
            "ignored_by": "",
            "ignored_at": "",
        }
        await self._write(row, fields, ACTION_LINK, actor=actor, reason=reason.strip(), required=False)
        return _action_out(row, fields)

    async def ignore(self, year: int, record_id: str, kind: str, reason: str, actor: str) -> FormResponseActionOut:
        """Ignore…: a test, a duplicate, someone not asking for aid, or (with a reason) something else."""
        if kind not in IGNORE_KINDS:
            raise CaseworkValidationError(f"unknown ignore kind {kind!r}")
        if kind == IGNORE_OTHER and not reason.strip():
            raise CaseworkValidationError("a reason is required to ignore a response as other")
        row = await self._require(year, record_id)
        fields = {
            "match_status": MATCH_IGNORED,
            "ignored_kind": kind,
            "ignored_reason": reason.strip(),
            "ignored_by": actor,
            "ignored_at": _now(),
        }
        logged = reason.strip() or f"Ignored: {kind}"
        await self._write(row, fields, ACTION_IGNORE, actor=actor, reason=logged, required=True)
        return _action_out(row, fields)

    async def link_candidates(self, year: int, record_id: str, query: str = "") -> LinkCandidatesOut:
        """Link…'s dialog: the response's evidence and its candidates, or with `query` the season's registered people
        a search by CampMinder id, birthdate or name finds, in the same shape (no signals: nothing matched them)."""
        row = await self._require(year, record_id)
        email, birthdate = await self._store.fetch_form_response_identity(record_id)
        attendees = await self._store.fetch_registered_attendees(year)
        registered: dict[int, list[AttendeeRow]] = {}
        for a in attendees:
            registered.setdefault(a.person_cm_id, []).append(a)
        if query.strip():
            found = await self._store.search_registration_people(year, query)
            candidates = [
                LinkCandidateOut(
                    person_cm_id=int(p.cm_id),
                    household_cm_id=int(getattr(p, "household_id", 0) or 0),
                    session_cm_ids=sorted({a.session_cm_id for a in registered[int(p.cm_id)]}),
                )
                for p in found
                if int(getattr(p, "cm_id", 0) or 0) in registered
            ][:CANDIDATES_MAX]
        else:
            candidates = [LinkCandidateOut(**candidate_out(c).model_dump()) for c in row.match_candidates]
        people = [c.person_cm_id for c in candidates]
        households, names = await self._store.fetch_names(
            year, {c.household_cm_id for c in candidates if c.household_cm_id > 0}, set(people)
        )
        contacts = await self._store.fetch_person_contacts(year, people)
        return LinkCandidatesOut(
            id=row.id,
            response_id=row.response_id,
            respondent_email=email,
            name_typed=row.name_typed,
            birthdate_typed=birthdate,
            program_choice=row.program_choice,
            candidates=[
                c.model_copy(
                    update={
                        "camper_name": names.get(c.person_cm_id, ""),
                        "household_label": households.get(c.household_cm_id, ""),
                        "registration_status": _registration_status(registered.get(c.person_cm_id, []), c),
                        "birthdate": contacts.get(c.person_cm_id, ("", ""))[0],
                        "email": contacts.get(c.person_cm_id, ("", ""))[1],
                    }
                )
                for c in candidates
            ],
        )

    async def review_form_change(self, year: int, request_id: str, actor: str) -> FormChangeReviewedOut:
        # It rewrites the request's flags, which intake's build plans and writes too: take the build's season_lock
        # and read the request inside it, as casework's writers do, so neither commits over the other.
        async with season_lock(year):
            return await self._review_form_change(year, request_id, actor)

    async def _review_form_change(self, year: int, request_id: str, actor: str) -> FormChangeReviewedOut:
        request = await self._store.fetch_request(request_id)
        if request is None or request.year != year or not is_form_request(request):
            raise CaseworkNotFoundError("no such adult aid form request this season")
        flags = [dict(f) for f in request.flags]
        found = [f for f in flags if f.get("code") in FORM_CHANGE_FLAGS]
        if not found:
            raise CaseworkValidationError("nothing on this request changed after its decision")
        fingerprint = str(dict(found[0].get("detail") or {}).get("fingerprint") or "")
        at = _now()
        data = {
            "form_change_reviewed": fingerprint,
            "form_change_reviewed_by": actor,
            "form_change_reviewed_at": at,
            # The look leaves now; intake's next build keeps it off while the change is this one.
            "flags": [f for f in flags if f.get("code") not in FORM_CHANGE_FLAGS],
        }
        await self._store.commit(
            [
                AidWrite(
                    collection=AID_REQUESTS,
                    action="update",
                    year=year,
                    record_id=request.id,
                    before={
                        "form_change_reviewed": request.form_change_reviewed,
                        "form_change_reviewed_by": request.form_change_reviewed_by,
                        "form_change_reviewed_at": request.form_change_reviewed_at,
                        "flags": flags,
                    },
                    data=data,
                    log_action=ACTION_REVIEW,
                )
            ],
            actor=actor,
            reason="Mark Reviewed: the adult aid form changed after a decision",
        )
        return FormChangeReviewedOut(request_id=request.id, reviewed_by=actor, reviewed_at=at)
