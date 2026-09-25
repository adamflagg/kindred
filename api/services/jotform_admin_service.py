"""The Jotform admin (kindred#2759): per-weekend form settings, the unmatched
queue with labelled suggestions, duplicates, and staff link/ignore/unlink.

Every write clears the weekend year cache, because the roster's
`fetch_jotform_bunking_rows` is cached per year and a staff link changes whose
card a request lands on. The cache has no per-read eviction, so the whole year
cache goes, followed -- as after every other clear -- by a background re-warm.
"""

from __future__ import annotations

import secrets
from collections import Counter, defaultdict
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError

from api.constants.collections import LODGING_WRITE_INS, LODGING_WRITE_INS_DRAFT
from api.dependencies import lodging_cache
from api.schemas.jotform import (
    JotformActionResult,
    JotformFormRow,
    JotformFormsResponse,
    JotformFormWrite,
    JotformGuest,
    JotformQuestion,
    JotformQueueItem,
    JotformQueueResponse,
    JotformRoleMeta,
    JotformSiblingFiling,
    JotformUnmappedForm,
    MatchStatus,
)
from api.services.jotform_queue import (
    JOTFORM_ROLES,
    FormReferenceError,
    QueueGuest,
    QueueSubmission,
    WriteInRow,
    duplicate_groups,
    identity_from_answers,
    link_suggestions,
    parse_form_id,
    queue_item,
    same_link_siblings,
    suggest_write_in,
    suggestions_for,
    waiting_siblings,
    write_in_options,
)
from api.services.jotform_repository import JotformRepository
from api.services.lodging_cache_warm import schedule_lodging_warm

_MATCH_STATUSES: dict[str, MatchStatus] = {
    "auto": "auto",
    "staff": "staff",
    "unmatched": "unmatched",
    "ignored": "ignored",
    "cancelled": "cancelled",
    "write_in": "write_in",
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


def _questions(form: Any) -> list[JotformQuestion]:
    """The form's questions from the snapshot the pull took of its definition,
    in form order. Unreadable entries are skipped: this is a display read."""
    ordered: list[tuple[int, str, JotformQuestion]] = []
    for raw in getattr(form, "questions", None) or []:
        if not isinstance(raw, dict) or not str(raw.get("question_id", "") or ""):
            continue
        qid = str(raw["question_id"])
        try:
            order = int(raw.get("order", 0) or 0)
        except TypeError, ValueError:
            order = 0
        question = JotformQuestion(
            question_id=qid, text=str(raw.get("text", "") or ""), type=str(raw.get("type", "") or "")
        )
        ordered.append((order, qid, question))
    return [q for _, _, q in sorted(ordered, key=lambda entry: (entry[0], entry[1]))]


def _field_map_meta(form: Any) -> dict[str, JotformRoleMeta]:
    """Per-role resolution meta the pull wrote. An entry that does not parse
    (an unknown source, say) is dropped rather than failing the whole read."""
    out: dict[str, JotformRoleMeta] = {}
    for role, raw in (getattr(form, "field_map_meta", None) or {}).items():
        if role not in JOTFORM_ROLES or not isinstance(raw, dict):
            continue
        try:
            out[role] = JotformRoleMeta.model_validate(raw)
        except ValidationError:
            continue
    return out


def _has_identity(field_map: dict[str, Any]) -> bool:
    """Mirrors Go's `FieldMap.HasIdentity`: matching needs first AND last name."""
    return bool(str(field_map.get("first_name", "") or "").strip()) and bool(
        str(field_map.get("last_name", "") or "").strip()
    )


def _guest_key(guest: JotformGuest) -> tuple[int, str]:
    return (guest.session_cm_id, guest.display_name.casefold())


def _write_in_row(row: Any, *, draft: bool = False) -> WriteInRow:
    unit = (getattr(row, "expand", None) or {}).get("unit")
    return WriteInRow(
        unit_id=str(getattr(row, "unit", "") or ""),
        unit_name=str(getattr(unit, "name", "") or "") if unit is not None else "",
        occupant_name=str(getattr(row, "occupant_name", "") or ""),
        session_cm_id=int(getattr(row, "session_cm_id", 0) or 0),
        write_in_key=str(getattr(row, "write_in_key", "") or ""),
        # A live row has no scenario column; a draft row always names one.
        scenario=str(getattr(row, "scenario", "") or "") if draft else "",
    )


def _cleared_links(record: Any) -> dict[str, str]:
    """Blank whichever of a row's link columns are set: a staff decision that
    is not a write-in link or a cancelled match must not leave one behind."""
    return {field: "" for field in ("write_in_key", "registration_status") if str(getattr(record, field, "") or "")}


def _queue_submissions(
    submissions: Sequence[Any], answers: Sequence[Any], field_maps: dict[str, dict[str, Any]]
) -> list[QueueSubmission]:
    """Each submission as the queue reads it: what the form says, through its field map."""
    by_submission: dict[str, dict[str, Any]] = defaultdict(dict)
    for answer in answers:
        by_submission[str(answer.submission)][str(answer.question_id)] = answer
    subs: list[QueueSubmission] = []
    for record in submissions:
        identity = identity_from_answers(by_submission.get(str(record.id), {}), field_maps.get(str(record.form), {}))
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
                registration_status=str(getattr(record, "registration_status", "") or ""),
                write_in_key=str(getattr(record, "write_in_key", "") or ""),
            )
        )
    return subs


def _field_maps(forms: Sequence[Any]) -> dict[str, dict[str, Any]]:
    return {str(f.id): dict(getattr(f, "field_map", None) or {}) for f in forms}


_Siblings = Callable[[QueueSubmission, Sequence[QueueSubmission]], list[QueueSubmission]]


class JotformAdminService:
    def __init__(self, repository: JotformRepository) -> None:
        self.repository = repository

    async def build_forms(self, year: int) -> JotformFormsResponse:
        sessions = await self.repository.fetch_adult_sessions(year)
        forms = await self.repository.fetch_forms(year)
        submissions = await self.repository.fetch_submissions(year)
        counts = Counter(str(s.form) for s in submissions)

        by_session = {int(f.session_cm_id): f for f in forms}
        rows: list[JotformFormRow] = []
        for session in sessions:
            cm_id = int(session.cm_id)
            form = by_session.get(cm_id)
            if form is None:
                rows.append(JotformFormRow(session_cm_id=cm_id, session_name=str(session.name)))
                continue
            rows.append(
                JotformFormRow(
                    session_cm_id=cm_id,
                    session_name=str(session.name),
                    form_id=str(getattr(form, "form_id", "") or ""),
                    form_title=str(getattr(form, "form_title", "") or ""),
                    field_map=dict(getattr(form, "field_map", None) or {}),
                    field_map_meta=_field_map_meta(form),
                    questions=_questions(form),
                    enabled=bool(getattr(form, "enabled", False)),
                    last_pulled_at=str(getattr(form, "last_pulled_at", "") or ""),
                    last_pull_status=str(getattr(form, "last_pull_status", "") or ""),
                    submission_count=counts.get(str(form.id), 0),
                )
            )
        return JotformFormsResponse(year=year, rows=rows)

    async def save_form(self, year: int, session_cm_id: int, body: JotformFormWrite) -> JotformFormRow:
        """Save staff's form setting. A role staff picked (or that was already
        staff-set) becomes staff-set, stamped with its question's wording now
        (kindred#2828): the pull keeps a staff role and flags it if that wording
        later moves. A carried or guessed role saved on its same question keeps
        its source -- Save confirms what staff changed, not every guess. A
        role that had a question and was cleared is recorded as "staff chose
        none" -- dropped from the meta, the next pull would guess it straight
        back. A staff role the pull flagged missing (its question left the
        form, so the card cannot send it) keeps its staff pick, so the next
        pull flags it again instead of it quietly becoming "chose none"."""
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
        previous = next(
            (f for f in await self.repository.fetch_forms(year) if int(f.session_cm_id) == session_cm_id), None
        )
        # Question ids belong to one form. A save that points this weekend at a
        # DIFFERENT form drops the mapping, its meta, and the old form's
        # questions and title: carried over, the old ids would name the wrong
        # questions. The next pull reads the new form and resolves afresh.
        repointed = previous is not None and str(getattr(previous, "form_id", "") or "") not in ("", form_id)
        field_map_meta: dict[str, dict[str, str]] = {}
        if repointed:
            field_map = {}
        else:
            wording = {q.question_id: q.text for q in _questions(previous)} if previous is not None else {}
            before = dict(getattr(previous, "field_map", None) or {}) if previous is not None else {}
            raw_meta = dict(getattr(previous, "field_map_meta", None) or {}) if previous is not None else {}
            before_meta = _field_map_meta(previous) if previous is not None else {}
            for role, qid in field_map.items():
                kept = before_meta.get(role)
                # Owner ruling 2026-09-24 (kindred#2828): Save confirms only what
                # staff changed. A carried or guessed role saved on the same
                # question keeps its source, so an unreviewed guess never
                # becomes "staff-confirmed" wording carried into next year.
                if (
                    kept is not None
                    and kept.source in ("carried", "guessed")
                    and str(before.get(role, "") or "").strip() == qid
                    and isinstance(raw_meta.get(role), dict)
                ):
                    field_map_meta[role] = dict(raw_meta[role])
                else:
                    field_map_meta[role] = {"question_id": qid, "text": wording.get(qid, ""), "source": "staff"}
            if previous is not None:
                for role in JOTFORM_ROLES:
                    had_question = bool(str(before.get(role, "") or "").strip())
                    was_staff = role in before_meta and before_meta[role].source == "staff"
                    if role in field_map:
                        continue
                    if was_staff and before_meta[role].flag == "missing":
                        # The pull dropped this staff role because its question
                        # left the form, so the card could not send it. Keep the
                        # staff pick: the next pull flags it missing again,
                        # rather than it silently becoming "staff chose none".
                        field_map_meta[role] = {
                            "question_id": before_meta[role].question_id,
                            "text": before_meta[role].text,
                            "source": "staff",
                        }
                    elif had_question or was_staff:
                        field_map_meta[role] = {"question_id": "", "text": "", "source": "staff"}
        await self.repository.upsert_form(
            year=year,
            session_cm_id=session_cm_id,
            form_id=form_id,
            field_map=field_map,
            field_map_meta=field_map_meta,
            enabled=body.enabled,
            clear_definition=repointed,
        )
        _roster_changed()
        forms = await self.build_forms(year)
        return next(row for row in forms.rows if row.session_cm_id == session_cm_id)

    async def build_queue(
        self, year: int, *, session_cm_id: int | None = None, scenario: str = ""
    ) -> JotformQueueResponse:
        """Read-only: suggestions are labels for staff, and nothing here links.

        With no weekend this is the year's queue: the Manage tab's counts and
        the board's "From Jotform" picker read it. With `session_cm_id` it is
        that adult weekend's Requests tab (kindred#2828 ruling 2026-09-25), read
        in `scenario` ("" = the live board): who a filing belongs to reads the
        same in every scenario, while a write-in link is "placed" only where a
        write-in of the viewed scope carries its key, and the Write-in dropdown
        and the suggested links offer the viewed scope's write-ins alone.

        A filing whose key NO row of its weekend carries, in any scope, still
        goes back to Needs a guest: the write-in is gone everywhere.
        """
        if scenario and session_cm_id is None:
            raise JotformValidationError("A scenario is read for one weekend: name the weekend too")
        sessions = await self.repository.fetch_adult_sessions(year)
        scenario_names: dict[str, str] = {}
        if session_cm_id is not None:
            sessions = [s for s in sessions if int(s.cm_id) == session_cm_id]
            if not sessions:
                # Family Camp included: its share requests come from CampMinder.
                raise JotformNotFoundError(f"No adult weekend with CampMinder id {session_cm_id} in {year}")
            scenario_names = {
                str(row.id): str(getattr(row, "name", "") or "")
                for row in await self.repository.fetch_weekend_scenarios(year, session_cm_id)
            }
            if scenario and scenario not in scenario_names:
                raise JotformNotFoundError(f"No scenario {scenario} for this weekend in {year}")

        def in_scope(cm_id: int) -> bool:
            return session_cm_id is None or cm_id == session_cm_id

        forms = await self.repository.fetch_forms(year)
        submissions = [r for r in await self.repository.fetch_submissions(year) if in_scope(int(r.session_cm_id))]
        answers = await self.repository.fetch_answers(year)
        guests = [g for g in _guests(await self.repository.fetch_enrolled_guests(year)) if in_scope(g.session_cm_id)]
        # The live board's write-ins first, so an option and a link name read
        # the live row's spelling wherever a scenario copy exists too.
        write_in_rows = [
            row
            for row in [
                *(_write_in_row(r) for r in await self.repository.fetch_live_write_ins(year)),
                *(_write_in_row(r, draft=True) for r in await self.repository.fetch_draft_write_ins(year)),
            ]
            if in_scope(row.session_cm_id)
        ]
        # The viewed scope: the live board's rows, or the one scenario's.
        viewed = [row for row in write_in_rows if row.scenario == scenario]
        elsewhere = [row for row in write_in_rows if row.scenario != scenario]
        options = write_in_options(viewed if session_cm_id is not None else write_in_rows)
        # A link is live while ANY row of its weekend, live or in a scenario,
        # carries its key; the first such row names it.
        linked_rows: dict[tuple[int, str], WriteInRow] = {}
        for row in write_in_rows:
            if row.write_in_key:
                linked_rows.setdefault((row.session_cm_id, row.write_in_key), row)
        viewed_rows: dict[tuple[int, str], WriteInRow] = {}
        for row in viewed:
            if row.write_in_key:
                viewed_rows.setdefault((row.session_cm_id, row.write_in_key), row)

        session_names = {int(s.cm_id): str(s.name) for s in sessions}
        field_maps = _field_maps(forms)
        unmapped_forms = {form_pb_id for form_pb_id, fm in field_maps.items() if not _has_identity(fm)}
        subs = _queue_submissions(submissions, answers, field_maps)

        names = {g.person_cm_id: g.display_name for g in guests}
        # Per (guest, weekend): filing for one adult weekend is not a submission for another.
        filed = {
            (s.person_cm_id, s.session_cm_id)
            for s in subs
            if s.person_cm_id > 0 and s.match_status in ("auto", "staff")
        }
        unmatched: list[JotformQueueItem] = []
        resolved: list[JotformQueueItem] = []
        cancelled: list[JotformQueueItem] = []
        written_in: list[JotformQueueItem] = []
        linked_subs: list[QueueSubmission] = []
        unlinked_subs: list[QueueSubmission] = []
        # kindred#2828: matching never ran for a form without first + last name
        # mapped, so its submissions are not "needs a guest"; the weekend is
        # reported once instead.
        unmapped_sessions: set[int] = set()
        form_of = {str(r.id): str(r.form) for r in submissions}
        for sub in subs:
            session_name = session_names.get(sub.session_cm_id, "")
            if sub.match_status == "write_in":
                link = linked_rows.get((sub.session_cm_id, sub.write_in_key)) if sub.write_in_key else None
                if link is not None:
                    item = queue_item(sub, session_name=session_name)
                    item.write_in_name = link.occupant_name.strip()
                    item.write_in_unit = link.unit_name
                    if session_cm_id is not None:
                        # The Requests tab: placed only where the viewed scope carries it.
                        here = viewed_rows.get((sub.session_cm_id, sub.write_in_key))
                        item.write_in_placed = here is not None
                        if here is not None:
                            item.write_in_name = here.occupant_name.strip()
                        item.write_in_unit = here.unit_name if here is not None else ""
                    written_in.append(item)
                    linked_subs.append(sub)
                    continue
                # The write-in was removed everywhere: the link went with it,
                # and the filing needs a guest again (the next pull re-decides it).
                sub = QueueSubmission(**{**vars(sub), "match_status": "unmatched", "write_in_key": ""})
            if sub.match_status == "unmatched" and form_of.get(sub.record_id) in unmapped_forms:
                unmapped_sessions.add(sub.session_cm_id)
            elif sub.match_status == "unmatched":
                item = queue_item(sub, session_name=session_name)
                item.suggestions = suggestions_for(sub, guests, subs)
                item.write_in_suggestion = suggest_write_in(sub, options)
                unmatched.append(item)
                unlinked_subs.append(sub)
            elif sub.match_status == "cancelled":
                cancelled.append(queue_item(sub, session_name=session_name))
            elif sub.match_status in ("staff", "ignored"):
                resolved.append(queue_item(sub, session_name=session_name, guest_name=names.get(sub.person_cm_id, "")))
        listed = [
            JotformGuest(
                person_cm_id=g.person_cm_id,
                display_name=g.display_name,
                session_cm_id=g.session_cm_id,
                has_submission=(g.person_cm_id, g.session_cm_id) in filed,
            )
            for g in guests
        ]
        return JotformQueueResponse(
            year=year,
            session_cm_id=session_cm_id,
            scenario=scenario,
            unmatched=unmatched,
            unmapped=[
                JotformUnmappedForm(session_cm_id=int(s.cm_id), session_name=str(s.name))
                for s in sessions
                if int(s.cm_id) in unmapped_sessions
            ],
            resolved=resolved,
            cancelled=cancelled,
            write_ins=written_in,
            write_in_options=options,
            write_in_link_suggestions=(
                link_suggestions(viewed, elsewhere, linked_subs, unlinked_subs, scenario_names)
                if session_cm_id is not None
                else []
            ),
            duplicates=duplicate_groups(subs, guests),
            guests=sorted(listed, key=_guest_key),
        )

    async def _submission(self, submission_id: str) -> Any:
        record = await self.repository.fetch_submission(submission_id)
        if record is None:
            raise JotformNotFoundError(f"No Jotform submission {submission_id}")
        return record

    async def _siblings(self, record: Any, pick: _Siblings) -> list[QueueSubmission]:
        """The filer's other filings of this weekend a decision on `record`
        also reaches (kindred#2839 follow-up: one filer, one decision), read
        BEFORE anything is written: `pick` compares against its state now."""
        year = int(record.year)
        subs = _queue_submissions(
            await self.repository.fetch_submissions(year),
            await self.repository.fetch_answers(year),
            _field_maps(await self.repository.fetch_forms(year)),
        )
        me = next((sub for sub in subs if sub.record_id == str(record.id)), None)
        return pick(me, subs) if me is not None else []

    async def _decide(
        self, record: Any, siblings: list[QueueSubmission], body: dict[str, Any], action: str
    ) -> JotformActionResult:
        """Write one decision to the clicked filing and each sibling, blanking
        whatever link columns each one had set, then drop the roster cache once."""
        # The body wins: a write-in link sets the very key column the clear blanks.
        # One write per row, not a transaction: a sibling write that fails
        # leaves the rows before it decided, so the cache drops either way.
        try:
            await self.repository.update_submission(str(record.id), {**_cleared_links(record), **body})
            for sibling in siblings:
                await self.repository.update_submission(sibling.record_id, {**_cleared_links(sibling), **body})
        finally:
            _roster_changed()
        return JotformActionResult.model_validate(
            {
                "action": action,
                "also": [
                    JotformSiblingFiling(
                        submission_id=sub.submission_id,
                        submitted_name=sub.submitted_name,
                        submitted_at=sub.submitted_at,
                    )
                    for sub in sorted(siblings, key=lambda sub: sub.submitted_at)
                ],
            }
        )

    async def link(self, submission_id: str, person_cm_id: int, actor: str) -> JotformActionResult:
        """Link a filing to an enrolled guest, and with it the same filer's
        other filings of the weekend that are still waiting."""
        record = await self._submission(submission_id)
        guests = _guests(await self.repository.fetch_enrolled_guests(int(record.year)))
        session_cm_id = int(record.session_cm_id)
        if not any(g.person_cm_id == person_cm_id and g.session_cm_id == session_cm_id for g in guests):
            raise JotformValidationError("That person is not an enrolled guest of this weekend")
        siblings = await self._siblings(record, waiting_siblings)
        return await self._decide(
            record,
            siblings,
            {
                "match_status": "staff",
                "person_cm_id": person_cm_id,
                "match_tier": 0,
                "linked_by": actor,
                "linked_at": _pb_now(),
            },
            "linked",
        )

    async def ignore(self, submission_id: str, actor: str) -> JotformActionResult:
        """Ignore a filing, and the same filer's other filings still waiting."""
        record = await self._submission(submission_id)
        siblings = await self._siblings(record, waiting_siblings)
        return await self._decide(
            record,
            siblings,
            {"match_status": "ignored", "person_cm_id": 0, "match_tier": 0, "linked_by": actor, "linked_at": _pb_now()},
            "ignored",
        )

    async def unlink(self, submission_id: str) -> JotformActionResult:
        """Back to the queue; the next pull may auto-match it again (use ignore
        to stop that). The same filer's other filings carrying the same link --
        the same guest, the same write-in, or ignored alike -- go back too."""
        record = await self._submission(submission_id)
        restored = str(getattr(record, "match_status", "") or "") == "ignored"
        siblings = await self._siblings(record, same_link_siblings)
        return await self._decide(
            record,
            siblings,
            {"match_status": "unmatched", "person_cm_id": 0, "match_tier": 0, "linked_by": "", "linked_at": ""},
            "restored" if restored else "unlinked",
        )

    async def check_write_in_filing(self, submission_id: str, year: int, session_cm_id: int) -> None:
        """Refuse, before the board writes anything, a filing that is not this
        weekend's: a write-in made from it would be linked to the wrong board."""
        record = await self._submission(submission_id)
        if int(record.year) != year or int(record.session_cm_id) != session_cm_id:
            raise JotformValidationError("That Jotform filing belongs to another weekend")

    async def link_write_in(
        self, submission_id: str, unit_id: str, occupant_name: str, actor: str
    ) -> JotformActionResult:
        """Link a filing to one of its weekend's board write-ins (kindred#2759
        follow-up), addressed as the board addresses it: (unit, occupant name).

        The link is a key. The write-in's rows -- the live board's and every
        scenario's copy of it -- carry it, and so does the filing -- and so do the same filer's other
        filings of the weekend still waiting (one filer, one decision). An existing
        key on the write-in is reused (a party of several may have several
        filings); otherwise one is minted and stamped on every copy that has
        none. A rename leaves the key where it is, and every path that copies
        write-in rows carries it, so the link survives both."""
        record = await self._submission(submission_id)
        year, session_cm_id = int(record.year), int(record.session_cm_id)
        name = occupant_name.strip()
        weekend_rows: list[tuple[str, Any]] = [
            (table, row)
            for table, fetched in (
                (LODGING_WRITE_INS, await self.repository.fetch_live_write_ins(year)),
                (LODGING_WRITE_INS_DRAFT, await self.repository.fetch_draft_write_ins(year)),
            )
            for row in fetched
            if int(getattr(row, "session_cm_id", 0) or 0) == session_cm_id
        ]
        rows = [
            (table, row)
            for table, row in weekend_rows
            if str(getattr(row, "unit", "") or "") == unit_id
            and str(getattr(row, "occupant_name", "") or "").strip() == name
        ]
        if not rows:
            raise JotformValidationError("That write-in is not on this weekend's board")

        def key_of(row: Any) -> str:
            return str(getattr(row, "write_in_key", "") or "")

        # A filing already linked elsewhere -- the Requests tab's suggested
        # link, made in another scenario (kindred#2828 ruling 2026-09-25) --
        # keeps its key, so linking it here does not unlink it there. Only a
        # key another filing holds wins over it (a party of several); a key
        # nobody holds any more is stale and is replaced.
        #
        # "Linked elsewhere" means some row of the weekend still carries the
        # key. One no row carries was dropped with its write-in, and a pull
        # planned since then clears the filing by comparing against exactly
        # that key (sync `saveMatch`): re-using it would let that pull erase
        # the link being made now, so such a filing gets a fresh key.
        own = key_of(record) if str(getattr(record, "match_status", "") or "") == "write_in" else ""
        if own and not any(key_of(row) == own for _, row in weekend_rows):
            own = ""
        held: set[str] = set()
        if own:
            held = {
                key_of(other)
                for other in await self.repository.fetch_submissions(year)
                if str(other.id) != str(record.id)
                and str(getattr(other, "match_status", "") or "") == "write_in"
                and key_of(other)
            }
            key = next((key_of(row) for _, row in rows if key_of(row) in held), "") or own
        else:
            key = next((key_of(row) for _, row in rows if key_of(row)), "") or secrets.token_hex(8)
        siblings = await self._siblings(record, waiting_siblings)
        for table, row in rows:
            current = key_of(row)
            if not current or (own and current != key and current not in held):
                await self.repository.set_write_in_key(table, str(row.id), key)
        return await self._decide(
            record,
            siblings,
            {
                "match_status": "write_in",
                "write_in_key": key,
                "person_cm_id": 0,
                "match_tier": 0,
                "registration_status": "",
                "linked_by": actor,
                "linked_at": _pb_now(),
            },
            "linked",
        )
