"""The Jotform admin's pure logic (kindred#2759).

Form references, the field-map suggester, what a submission says it is, the
labelled suggestions for the unmatched queue, and the duplicates view. No I/O:
`JotformAdminService` reads and writes; this decides.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from urllib.parse import urlparse

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
