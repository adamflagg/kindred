"""The Jotform admin (kindred#2759): per-weekend form settings, the unmatched
queue with labelled suggestions, duplicates, and staff link/ignore/unlink.

Every write clears the weekend year cache, because the roster's
`fetch_jotform_bunking_rows` is cached per year and a staff link changes whose
card a request lands on. The cache has no per-read eviction, so the whole year
cache goes, followed -- as after every other clear -- by a background re-warm.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import UTC, datetime
from typing import Any

from api.dependencies import lodging_cache
from api.schemas.jotform import (
    JotformFormRow,
    JotformFormsResponse,
    JotformFormWrite,
    JotformGuest,
    JotformQuestion,
    JotformQueueItem,
    JotformQueueResponse,
    MatchStatus,
)
from api.services.jotform_queue import (
    JOTFORM_ROLES,
    FormReferenceError,
    Question,
    QueueGuest,
    QueueSubmission,
    duplicate_groups,
    identity_from_answers,
    parse_form_id,
    queue_item,
    suggest_field_map,
    suggestions_for,
)
from api.services.jotform_repository import JotformRepository
from api.services.lodging_cache_warm import schedule_lodging_warm

_MATCH_STATUSES: dict[str, MatchStatus] = {
    "auto": "auto",
    "staff": "staff",
    "unmatched": "unmatched",
    "ignored": "ignored",
}


class JotformNotFoundError(LookupError):
    """No such adult weekend or submission."""


class JotformValidationError(ValueError):
    """A write the admin cannot accept, worded for staff."""


def _pb_now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S.000Z")


def _roster_changed() -> None:
    """Drop the roster's cached Jotform read (and, the cache being keyed by
    year with no per-read eviction, the rest of the year cache), then re-warm."""
    lodging_cache.invalidate_all()
    schedule_lodging_warm()


def _match_status(value: Any) -> MatchStatus:
    # A blank status (a row the pull has not classified) reads as unmatched.
    return _MATCH_STATUSES.get(str(value or ""), "unmatched")


def _guest(row: Any) -> QueueGuest | None:
    expand = getattr(row, "expand", None) or {}
    person, session = expand.get("person"), expand.get("session")
    if person is None or session is None:
        return None
    return QueueGuest(
        person_cm_id=int(getattr(person, "cm_id", 0) or 0),
        session_cm_id=int(getattr(session, "cm_id", 0) or 0),
        first=str(getattr(person, "first_name", "") or ""),
        preferred=str(getattr(person, "preferred_name", "") or ""),
        last=str(getattr(person, "last_name", "") or ""),
    )


def _guests(rows: list[Any]) -> list[QueueGuest]:
    return [guest for guest in (_guest(row) for row in rows) if guest is not None]


def _question_key(question: Question) -> tuple[int, str]:
    return (question.order, question.question_id)


def _guest_key(guest: JotformGuest) -> tuple[int, str]:
    return (guest.session_cm_id, guest.display_name.casefold())


class JotformAdminService:
    def __init__(self, repository: JotformRepository) -> None:
        self.repository = repository

    async def build_forms(self, year: int) -> JotformFormsResponse:
        sessions = await self.repository.fetch_adult_sessions(year)
        forms = await self.repository.fetch_forms(year)
        submissions = await self.repository.fetch_submissions(year)
        answers = await self.repository.fetch_answers(year)

        form_of_submission = {str(s.id): str(s.form) for s in submissions}
        counts = Counter(str(s.form) for s in submissions)
        questions: dict[str, dict[str, Question]] = defaultdict(dict)
        for answer in answers:
            form_pb_id = form_of_submission.get(str(answer.submission))
            if form_pb_id is None:
                continue
            qid = str(answer.question_id)
            questions[form_pb_id].setdefault(
                qid,
                Question(
                    question_id=qid,
                    text=str(getattr(answer, "question_text", "") or ""),
                    type=str(getattr(answer, "question_type", "") or ""),
                    order=int(getattr(answer, "order", 0) or 0),
                ),
            )

        by_session = {int(f.session_cm_id): f for f in forms}
        rows: list[JotformFormRow] = []
        for session in sessions:
            cm_id = int(session.cm_id)
            form = by_session.get(cm_id)
            if form is None:
                rows.append(JotformFormRow(session_cm_id=cm_id, session_name=str(session.name)))
                continue
            form_questions = sorted(questions.get(str(form.id), {}).values(), key=_question_key)
            rows.append(
                JotformFormRow(
                    session_cm_id=cm_id,
                    session_name=str(session.name),
                    form_id=str(getattr(form, "form_id", "") or ""),
                    field_map=dict(getattr(form, "field_map", None) or {}),
                    suggested_field_map=suggest_field_map(form_questions),
                    questions=[
                        JotformQuestion(question_id=q.question_id, text=q.text, type=q.type) for q in form_questions
                    ],
                    enabled=bool(getattr(form, "enabled", False)),
                    last_pulled_at=str(getattr(form, "last_pulled_at", "") or ""),
                    last_pull_status=str(getattr(form, "last_pull_status", "") or ""),
                    submission_count=counts.get(str(form.id), 0),
                )
            )
        return JotformFormsResponse(year=year, rows=rows)

    async def save_form(self, year: int, session_cm_id: int, body: JotformFormWrite) -> JotformFormRow:
        sessions = await self.repository.fetch_adult_sessions(year)
        if not any(int(s.cm_id) == session_cm_id for s in sessions):
            raise JotformNotFoundError(f"No adult weekend with CampMinder id {session_cm_id} in {year}")
        try:
            form_id = parse_form_id(body.form_ref)
        except FormReferenceError as exc:
            raise JotformValidationError(str(exc)) from exc
        unknown = sorted(set(body.field_map) - set(JOTFORM_ROLES))
        if unknown:
            raise JotformValidationError(f"Unknown field role(s): {', '.join(unknown)}")
        field_map = {role: qid.strip() for role, qid in body.field_map.items() if qid.strip()}
        bad = sorted(role for role, qid in field_map.items() if not qid.isdigit())
        if bad:
            raise JotformValidationError(f"Question ids must be numbers: {', '.join(bad)}")
        await self.repository.upsert_form(
            year=year, session_cm_id=session_cm_id, form_id=form_id, field_map=field_map, enabled=body.enabled
        )
        _roster_changed()
        forms = await self.build_forms(year)
        return next(row for row in forms.rows if row.session_cm_id == session_cm_id)

    async def build_queue(self, year: int) -> JotformQueueResponse:
        """Read-only: suggestions are labels for staff, and nothing here links."""
        sessions = await self.repository.fetch_adult_sessions(year)
        forms = await self.repository.fetch_forms(year)
        submissions = await self.repository.fetch_submissions(year)
        answers = await self.repository.fetch_answers(year)
        guests = _guests(await self.repository.fetch_enrolled_guests(year))

        session_names = {int(s.cm_id): str(s.name) for s in sessions}
        field_maps = {str(f.id): dict(getattr(f, "field_map", None) or {}) for f in forms}
        by_submission: dict[str, dict[str, Any]] = defaultdict(dict)
        for answer in answers:
            by_submission[str(answer.submission)][str(answer.question_id)] = answer

        subs: list[QueueSubmission] = []
        for record in submissions:
            identity = identity_from_answers(
                by_submission.get(str(record.id), {}), field_maps.get(str(record.form), {})
            )
            subs.append(
                QueueSubmission(
                    record_id=str(record.id),
                    submission_id=str(record.submission_id),
                    session_cm_id=int(record.session_cm_id),
                    submitted_at=str(record.submitted_at),
                    first=identity["first"],
                    last=identity["last"],
                    nametag=identity["nametag"],
                    email=identity["email"],
                    emergency_phone=identity["emergency_phone"],
                    emergency_email=identity["emergency_email"],
                    bunking_request=identity["bunking_request"],
                    match_status=_match_status(getattr(record, "match_status", "")),
                    person_cm_id=int(getattr(record, "person_cm_id", 0) or 0),
                )
            )

        names = {g.person_cm_id: g.display_name for g in guests}
        filed = {s.person_cm_id for s in subs if s.person_cm_id > 0 and s.match_status in ("auto", "staff")}
        unmatched: list[JotformQueueItem] = []
        resolved: list[JotformQueueItem] = []
        for sub in subs:
            session_name = session_names.get(sub.session_cm_id, "")
            if sub.match_status == "unmatched":
                item = queue_item(sub, session_name=session_name)
                item.suggestions = suggestions_for(sub, guests, subs)
                unmatched.append(item)
            elif sub.match_status in ("staff", "ignored"):
                resolved.append(queue_item(sub, session_name=session_name, guest_name=names.get(sub.person_cm_id, "")))
        listed = [
            JotformGuest(
                person_cm_id=g.person_cm_id,
                display_name=g.display_name,
                session_cm_id=g.session_cm_id,
                has_submission=g.person_cm_id in filed,
            )
            for g in guests
        ]
        return JotformQueueResponse(
            year=year,
            unmatched=unmatched,
            resolved=resolved,
            duplicates=duplicate_groups(subs, guests),
            guests=sorted(listed, key=_guest_key),
        )

    async def _submission(self, submission_id: str) -> Any:
        record = await self.repository.fetch_submission(submission_id)
        if record is None:
            raise JotformNotFoundError(f"No Jotform submission {submission_id}")
        return record

    async def link(self, submission_id: str, person_cm_id: int, actor: str) -> None:
        record = await self._submission(submission_id)
        guests = _guests(await self.repository.fetch_enrolled_guests(int(record.year)))
        session_cm_id = int(record.session_cm_id)
        if not any(g.person_cm_id == person_cm_id and g.session_cm_id == session_cm_id for g in guests):
            raise JotformValidationError("That person is not an enrolled guest of this weekend")
        await self.repository.update_submission(
            str(record.id),
            {
                "match_status": "staff",
                "person_cm_id": person_cm_id,
                "match_tier": 0,
                "linked_by": actor,
                "linked_at": _pb_now(),
            },
        )
        _roster_changed()

    async def ignore(self, submission_id: str, actor: str) -> None:
        record = await self._submission(submission_id)
        await self.repository.update_submission(
            str(record.id),
            {"match_status": "ignored", "person_cm_id": 0, "match_tier": 0, "linked_by": actor, "linked_at": _pb_now()},
        )
        _roster_changed()

    async def unlink(self, submission_id: str) -> None:
        """Back to the queue; the next pull may auto-match it again (use ignore to stop that)."""
        record = await self._submission(submission_id)
        await self.repository.update_submission(
            str(record.id),
            {"match_status": "unmatched", "person_cm_id": 0, "match_tier": 0, "linked_by": "", "linked_at": ""},
        )
        _roster_changed()
