"""The Jotform admin's pure logic (kindred#2759).

Form references, the field-map suggester, what a submission says it is, the
labelled suggestions for the unmatched queue, and the duplicates view. No I/O:
`JotformAdminService` reads and writes; this decides.
"""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from rapidfuzz import fuzz
from rapidfuzz.distance import JaroWinkler

from api.schemas.jotform import (
    JotformDuplicateGroup,
    JotformQueueItem,
    JotformSuggestion,
    MatchStatus,
    SuggestionKind,
)
from api.schemas.lodging import BunkingRequestVersion
from api.services.jotform_bunking import fold, normalize_request, resolve_change
from bunking.sync.bunk_request_processor.shared.nickname_groups import names_match_via_nicknames

JOTFORM_ROLES: tuple[str, ...] = (
    "first_name",
    "last_name",
    "nametag_name",
    "respondent_email",
    "bunking_request",
    "coming_with",
    "emergency_name",
    "emergency_phone",
    "emergency_email",
    "housing_accommodation",
    "accommodation_details",
    "cpap",
)

_BARE_ID = re.compile(r"^\d{12,20}$")
_ID_SEGMENT = re.compile(r"(?:^|/)(\d{12,20})(?=/|$)")


class FormReferenceError(ValueError):
    """The pasted value does not identify a form."""


def parse_form_id(ref: str) -> str:
    """The numeric form id from a bare id or any Jotform link that carries it.

    A form's PUBLIC link is often a vanity path (`form.jotform.com/<Account>/<Slug>`)
    with no id in it -- the 2026 adult forms are exactly that -- so it is
    refused with a pointer to where the id is, never guessed.
    """
    value = (ref or "").strip()
    if _BARE_ID.match(value):
        return value
    if value:
        path = urlparse(value if "://" in value else f"https://{value}").path
        match = _ID_SEGMENT.search(path)
        if match:
            return match.group(1)
    raise FormReferenceError(
        "That link does not contain the form's ID. Open the form in the Jotform builder and paste "
        "that address (it ends /build/<ID>), or paste the numeric ID itself."
    )


@dataclass(frozen=True)
class Question:
    question_id: str
    text: str
    type: str
    order: int = 0


def _t(question: Question) -> str:
    return " ".join(question.text.lower().split())


def _emergency(question: Question) -> bool:
    return "emergency" in _t(question)


# First match (by question order) wins for each role. Emergency questions are
# claimed by their own rules and excluded from the identity ones.
_RULES: tuple[tuple[str, Callable[[Question], bool]], ...] = (
    ("emergency_name", lambda q: _emergency(q) and "name" in _t(q)),
    ("emergency_phone", lambda q: _emergency(q) and "phone" in _t(q)),
    ("emergency_email", lambda q: _emergency(q) and "email" in _t(q)),
    ("nametag_name", lambda q: "nametag" in _t(q) or "name tag" in _t(q)),
    ("first_name", lambda q: not _emergency(q) and (_t(q).startswith("first name") or q.type == "control_fullname")),
    ("last_name", lambda q: not _emergency(q) and (_t(q).startswith("last name") or q.type == "control_fullname")),
    ("bunking_request", lambda q: "bunking request" in _t(q)),
    ("coming_with", lambda q: "coming" in _t(q) and "with" in _t(q)),
    ("housing_accommodation", lambda q: "housing accommodation" in _t(q)),
    ("accommodation_details", lambda q: _t(q).startswith("if yes, please comment") or "live alone" in _t(q)),
    ("cpap", lambda q: "cpap" in _t(q)),
    ("respondent_email", lambda q: not _emergency(q) and (q.type == "control_email" or _t(q) == "email")),
)


def suggest_field_map(questions: Sequence[Question]) -> dict[str, str]:
    """Role -> question id, suggested from the question text. Staff confirm it:
    question ids change every year, and labels drift."""
    ordered = sorted(questions, key=lambda q: (q.order, q.question_id))
    suggested: dict[str, str] = {}
    for role, rule in _RULES:
        for question in ordered:
            if rule(question):
                suggested[role] = question.question_id
                break
    return {role: suggested[role] for role in JOTFORM_ROLES if role in suggested}


# --- The unmatched queue ------------------------------------------------------

SUGGEST_THRESHOLD = 0.90
_KIND_RANK: dict[SuggestionKind, int] = {"likely_duplicate": 0, "did_you_mean": 1, "probably_different": 2}
_LIVE_MATCHES = frozenset({"auto", "staff"})
_JUST = re.compile(r"just (\w+)")


@dataclass(frozen=True)
class QueueSubmission:
    record_id: str
    submission_id: str
    session_cm_id: int
    submitted_at: str
    first: str
    last: str
    nametag: str = ""
    email: str = ""
    emergency_phone: str = ""
    emergency_email: str = ""
    bunking_request: str = ""
    match_status: MatchStatus = "unmatched"
    person_cm_id: int = 0

    @property
    def submitted_name(self) -> str:
        return f"{self.first} {self.last}".strip()


@dataclass(frozen=True)
class QueueGuest:
    person_cm_id: int
    session_cm_id: int
    first: str
    preferred: str
    last: str

    @property
    def display_name(self) -> str:
        return f"{self.preferred or self.first} {self.last}".strip()

    @property
    def firsts(self) -> set[str]:
        return {f for f in (fold(self.first), fold(self.preferred)) if f}


def _answer_part(answer: Any, part: str) -> str:
    if answer is None:
        return ""
    data = getattr(answer, "answer_json", None)
    if getattr(answer, "question_type", "") == "control_fullname" and isinstance(data, dict):
        return str(data.get(part, "") or "").strip()
    return str(getattr(answer, "answer_text", "") or "").strip()


def identity_from_answers(by_question: Mapping[str, Any], field_map: Mapping[str, str]) -> dict[str, str]:
    """What a submission says it is, read through the form's field map. Mirrors
    Go's `jotform.ExtractIdentity`; the emergency fields are read here ONLY for
    the same-person signal, never to match."""

    def answer(role: str) -> Any:
        qid = str(field_map.get(role, "") or "")
        return by_question.get(qid) if qid else None

    def text(role: str) -> str:
        found = answer(role)
        return str(getattr(found, "answer_text", "") or "").strip() if found is not None else ""

    return {
        "first": _answer_part(answer("first_name"), "first"),
        "last": _answer_part(answer("last_name"), "last"),
        "nametag": text("nametag_name"),
        "email": text("respondent_email"),
        "emergency_phone": text("emergency_phone"),
        "emergency_email": text("emergency_email"),
        "bunking_request": text("bunking_request"),
    }


def _nametag_first(nametag: str) -> str:
    value = fold(nametag)
    if not value:
        return ""
    if value.startswith("prefer"):
        match = _JUST.search(value)
        return match.group(1) if match else ""
    return value.split(" ")[0]


def _firsts(sub: QueueSubmission) -> set[str]:
    return {f for f in (fold(sub.first), _nametag_first(sub.nametag)) if f}


def _phone(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    return digits[-10:] if len(digits) >= 10 else ""


def _email(value: str) -> str:
    folded = fold(value)
    return folded if "@" in folded else ""


def name_score(sub: QueueSubmission, guest: QueueGuest) -> float:
    full = fold(sub.submitted_name)
    best = 0.0
    for first in guest.firsts:
        candidate = fold(f"{first} {guest.last}")
        best = max(best, JaroWinkler.similarity(full, candidate), fuzz.token_set_ratio(full, candidate) / 100)
    return float(best)


def same_person(a: QueueSubmission, b: QueueSubmission) -> str | None:
    """The measured same-person signal (20/20 duplicates, 0 false alarms over
    11,488 pairs): an identical name, or a shared emergency phone/email AND the
    same first name or nickname. A shared contact alone is NOT enough --
    relatives and friends list each other."""
    if fold(a.first) and fold(a.first) == fold(b.first) and fold(a.last) == fold(b.last):
        return "identical name"
    phone = _phone(a.emergency_phone)
    email = _email(a.emergency_email)
    shared = (phone != "" and phone == _phone(b.emergency_phone)) or (
        email != "" and email == _email(b.emergency_email)
    )
    first_ok = any(x == y or names_match_via_nicknames(x, y) for x in _firsts(a) for y in _firsts(b))
    return "shared emergency contact and the same first name" if shared and first_ok else None


def _named_in_request(request: str, guest: QueueGuest) -> bool:
    text = fold(request)
    return bool(text) and fold(guest.last) in text and any(first in text for first in guest.firsts)


def _rank(suggestion: JotformSuggestion) -> tuple[bool, int, float]:
    return (suggestion.demoted, _KIND_RANK[suggestion.kind], -suggestion.score)


def suggestions_for(
    sub: QueueSubmission, guests: Sequence[QueueGuest], others: Sequence[QueueSubmission]
) -> list[JotformSuggestion]:
    """Labelled candidates for one unmatched submission, best first. Kindred
    never picks between them; staff do.

    Candidates are the session's enrolled guests scoring >= SUGGEST_THRESHOLD
    on name similarity -- INCLUDING guests who already have a submission,
    labelled by whether this one looks like the same person re-filing
    ("likely duplicate") or someone else with a similar name ("probably
    different"). A guest named in this submission's own bunking request is
    demoted: a respondent listing a friend is not that friend.
    """
    peers = [o for o in others if o.record_id != sub.record_id and o.session_cm_id == sub.session_cm_id]
    filed: dict[int, list[QueueSubmission]] = defaultdict(list)
    for other in peers:
        if other.person_cm_id > 0 and other.match_status in _LIVE_MATCHES:
            filed[other.person_cm_id].append(other)
    by_id = {g.person_cm_id: g for g in guests}

    out: list[JotformSuggestion] = []
    for guest in guests:
        if guest.session_cm_id != sub.session_cm_id:
            continue
        score = name_score(sub, guest)
        if score < SUGGEST_THRESHOLD:
            continue
        theirs = filed.get(guest.person_cm_id, [])
        kind: SuggestionKind
        if not theirs:
            kind, label = "did_you_mean", f"Did you mean {guest.display_name}?"
        elif any(same_person(sub, other) for other in theirs):
            kind, label = "likely_duplicate", f"Likely a duplicate of {guest.display_name}'s submission (typo)"
        else:
            kind = "probably_different"
            label = f"Similar name, but {guest.display_name} already has a submission; probably a different person"
        out.append(
            JotformSuggestion(
                kind=kind,
                label=label,
                person_cm_id=guest.person_cm_id,
                guest_name=guest.display_name,
                score=round(score, 3),
                demoted=_named_in_request(sub.bunking_request, guest),
            )
        )

    # A strong same-person signal is flagged even when the names are too far
    # apart to score (a middle name typed as the surname).
    covered = {s.person_cm_id for s in out}
    for other in peers:
        if other.person_cm_id in covered and other.person_cm_id > 0:
            continue
        reason = same_person(sub, other)
        if reason is None or reason == "identical name":
            continue
        known = by_id.get(other.person_cm_id)
        name = known.display_name if known is not None else other.submitted_name
        out.append(
            JotformSuggestion(
                kind="likely_duplicate",
                label=f"Likely a duplicate of {name}'s submission",
                person_cm_id=other.person_cm_id,
                guest_name=name,
                other_submission_id=other.submission_id,
                score=1.0,
            )
        )
        covered.add(other.person_cm_id)
    return sorted(out, key=_rank)


def queue_item(sub: QueueSubmission, *, session_name: str = "", guest_name: str = "") -> JotformQueueItem:
    return JotformQueueItem(
        submission_id=sub.submission_id,
        session_cm_id=sub.session_cm_id,
        session_name=session_name,
        submitted_name=sub.submitted_name,
        nametag=sub.nametag,
        submitted_at=sub.submitted_at,
        bunking_request=sub.bunking_request,
        match_status=sub.match_status,
        person_cm_id=sub.person_cm_id,
        guest_name=guest_name,
    )


def duplicate_groups(subs: Sequence[QueueSubmission], guests: Sequence[QueueGuest]) -> list[JotformDuplicateGroup]:
    """Guests with 2+ live matched filings, each with how the request moved."""
    by_guest: dict[int, list[QueueSubmission]] = defaultdict(list)
    for sub in subs:
        if sub.person_cm_id > 0 and sub.match_status in _LIVE_MATCHES:
            by_guest[sub.person_cm_id].append(sub)
    names = {g.person_cm_id: g.display_name for g in guests}
    groups: list[JotformDuplicateGroup] = []
    for person_cm_id, filings in by_guest.items():
        if len(filings) < 2:
            continue
        filings.sort(key=lambda s: s.submitted_at)
        change = resolve_change(
            [
                BunkingRequestVersion(submitted_at=s.submitted_at, text=normalize_request(s.bunking_request))
                for s in filings
            ]
        )
        name = names.get(person_cm_id, filings[-1].submitted_name)
        groups.append(
            JotformDuplicateGroup(
                person_cm_id=person_cm_id,
                guest_name=name,
                session_cm_id=filings[-1].session_cm_id,
                change_kind=change.kind if change is not None else "none",
                submissions=[queue_item(s, guest_name=name) for s in filings],
            )
        )
    return sorted(groups, key=lambda g: g.guest_name.casefold())
