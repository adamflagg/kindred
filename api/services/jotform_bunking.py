"""An adult-weekend guest's Jotform bunking request, for the roster (kindred#2759).

Pure: no I/O. The repository hands in rows; this builds the payload. The
change rule lives HERE rather than in the browser so the card's "changed" dot,
the panel's inline markup and the tests all read one computation.

Rules, verbatim from the issue body's 2026-09-24 rulings:
  * "no request", "no preference", "none", "n/a" and the like are NO request.
  * A request splits on , ; / & "and" and newlines.
  * Two items at Jaro-Winkler >= 0.88 are one name re-spelled, not a removal
    plus an addition.
  * A version with an item that is not name-shaped -- more than 4 words, or
    I/we/my/if/please/list/whoever/whomever, or "not sure" -- falls back to
    showing every version in full.
  * A dropped item keeps the position it had.
"""

from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from itertools import pairwise
from typing import Any, NamedTuple

from rapidfuzz.distance import JaroWinkler

from api.schemas.lodging import (
    BunkingRequestChange,
    BunkingRequestChangeItem,
    BunkingRequestSummary,
    BunkingRequestVersion,
    ComingWithToken,
    JotformNeedAnswer,
)
from api.services.adult_need_answers import (
    ADULT_CPAP_FIELD_CM_ID,
    HOUSING_ACCOMODATION_FIELD_CM_ID,
    classify_cpap_answer,
    parse_bool_field_value,
)

RESPELL_THRESHOLD = 0.88
MAX_NAME_WORDS = 4

_NO_REQUEST = re.compile(
    r"^(no|none|nope|n/?a|-+|no requests?|no preferences?|no special requests?|not applicable)\.?$",
    re.IGNORECASE,
)
_SPLIT = re.compile(r"[,;/&\n]|\band\b", re.IGNORECASE)
_PROSE_WORDS = frozenset({"i", "we", "my", "if", "please", "list", "whoever", "whomever"})
_NOT_SURE = re.compile(r"not sure", re.IGNORECASE)

_COMING_PATTERNS: tuple[tuple[ComingWithToken, re.Pattern[str]], ...] = (
    ("solo", re.compile(r"\bsolo\b", re.IGNORECASE)),
    ("family", re.compile(r"with family", re.IGNORECASE)),
    ("friends", re.compile(r"with friends", re.IGNORECASE)),
    ("partner", re.compile(r"partner", re.IGNORECASE)),
)


def normalize_request(text: str) -> str:
    """The bunking answer, trimmed, with "no request"-style words read as ""."""
    stripped = (text or "").strip()
    return "" if _NO_REQUEST.match(stripped) else stripped


def fold(name: str) -> str:
    """Case- and accent-folded, whitespace collapsed -- the identity of an item."""
    decomposed = unicodedata.normalize("NFKD", name)
    bare = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return " ".join(bare.lower().split())


def request_items(text: str) -> list[str]:
    """Split a request into its name items, keeping each item's own spelling."""
    items: list[str] = []
    for raw in _SPLIT.split(text or ""):
        item = raw.strip().rstrip(".").strip()
        if item:
            items.append(item)
    return items


def is_name_shaped(text: str) -> bool:
    if _NOT_SURE.search(text or ""):
        return False
    for item in request_items(text):
        words = item.split()
        if len(words) > MAX_NAME_WORDS:
            return False
        # The head of a contraction is the ruled word: "I'm" is "I", "we're" is "we".
        if any(re.sub(r"[^a-z']", "", word.lower()).split("'")[0] in _PROSE_WORDS for word in words):
            return False
    return True


def _similarity(a: str, b: str) -> float:
    return float(JaroWinkler.similarity(fold(a), fold(b)))


def _moved_words(old: str, new: str) -> str:
    """Only the words that changed ("Johnston"), when the word counts match and
    some words did not move; the whole old name otherwise."""
    old_words, new_words = old.split(), new.split()
    if len(old_words) == len(new_words):
        same = sum(1 for a, b in zip(old_words, new_words, strict=True) if a == b)
        if 0 < same < len(old_words):
            return " ".join(a for a, b in zip(old_words, new_words, strict=True) if a != b)
    return old


def diff_items(before: Sequence[str], after: Sequence[str]) -> list[BunkingRequestChangeItem]:
    """`after` in its own order, each item keep/add/respell, with every dropped
    `before` item re-inserted after its nearest surviving predecessor."""
    before_keys = {fold(n) for n in before}
    after_keys = {fold(n) for n in after}
    removed = [n for n in before if fold(n) not in after_keys]
    added = [n for n in after if fold(n) not in before_keys]

    respelled: dict[str, str] = {}  # new spelling -> old spelling
    for gone in list(removed):
        if not added:
            break
        best, best_score = added[0], _similarity(gone, added[0])
        for candidate in added[1:]:
            score = _similarity(gone, candidate)
            if score > best_score:
                best, best_score = candidate, score
        if best_score >= RESPELL_THRESHOLD:
            respelled[best] = gone
            removed.remove(gone)
            added.remove(best)

    out: list[BunkingRequestChangeItem] = []
    for name in after:
        if name in respelled:
            out.append(BunkingRequestChangeItem(text=name, op="respell", was=_moved_words(respelled[name], name)))
        elif name in added:
            out.append(BunkingRequestChangeItem(text=name, op="add"))
        else:
            out.append(BunkingRequestChangeItem(text=name, op="keep"))

    renamed_to = {old: new for new, old in respelled.items()}

    def position(name: str) -> int:
        target = fold(renamed_to.get(name, name))
        for index, item in enumerate(out):
            if item.op != "remove" and fold(item.text) == target:
                return index
        return -1

    removed_set = set(removed)
    for index, name in enumerate(before):
        if name not in removed_set:
            continue
        anchor = -1
        for earlier in reversed(before[:index]):
            found = position(earlier)
            if found >= 0:
                anchor = found
                break
        at = anchor + 1
        while at < len(out) and out[at].op == "remove":
            at += 1
        out.insert(at, BunkingRequestChangeItem(text=name, op="remove"))
    return out


def _key(text: str) -> str:
    return "|".join(fold(item) for item in request_items(text))


def request_changed(versions: Sequence[BunkingRequestVersion]) -> bool:
    """True when ANY two consecutive filings differ, compared as normalized
    item lists (P15, owner 2026-09-24). The card's amber dot reads this.

    Deliberately NOT derived from `resolve_change`, which is the NET change
    between the first and latest filings: a request that moved and moved back
    (A -> A+B -> A) has changed, though its net markup is all keep. Every
    filing counts, blank ones included -- a blank re-file withdraws the
    request, so it is a change.
    """
    keys = [_key(v.text) for v in versions]
    return any(a != b for a, b in pairwise(keys))


def resolve_change(versions: Sequence[BunkingRequestVersion]) -> BunkingRequestChange | None:
    """How the request moved. A blank LATEST filing withdraws the request
    (owner ruling 2026-09-24): every name of the last named filing reads as
    removed. Blank filings between named ones are skipped."""
    named = [v for v in versions if v.text]
    latest = versions[-1] if versions else None
    if latest is not None and not latest.text and named:
        last_named = named[-1]
        if not is_name_shaped(last_named.text):
            return BunkingRequestChange(
                kind="prose",
                versions=[last_named, latest],
                from_date=last_named.submitted_at,
                to_date=latest.submitted_at,
            )
        return BunkingRequestChange(
            kind="list",
            items=diff_items(request_items(last_named.text), []),
            from_date=last_named.submitted_at,
            to_date=latest.submitted_at,
        )
    if len(named) < 2:
        return None
    first, current = named[0], named[-1]
    if all(_key(v.text) == _key(first.text) for v in named):
        return BunkingRequestChange(
            kind="identical", count=len(named), from_date=first.submitted_at, to_date=current.submitted_at
        )
    if not all(is_name_shaped(v.text) for v in named):
        return BunkingRequestChange(
            kind="prose", versions=list(named), from_date=first.submitted_at, to_date=current.submitted_at
        )
    return BunkingRequestChange(
        kind="list",
        items=diff_items(request_items(first.text), request_items(current.text)),
        from_date=first.submitted_at,
        to_date=current.submitted_at,
    )


def coming_with_tokens(answer_text: str, answer_json: object) -> list[ComingWithToken]:
    """Every ticked "coming with" option, ordered solo, family, friends,
    partner. Read from the checkbox's JSON list when stored, else its text."""
    if isinstance(answer_json, list):
        raw = " ; ".join(str(value) for value in answer_json)
    else:
        raw = answer_text or ""
    return [token for token, pattern in _COMING_PATTERNS if pattern.search(raw)]


# Field-map roles the ROSTER reads. Identity and emergency roles are the
# ingest's and the admin queue's, never the board's.
ROLE_BUNKING_REQUEST = "bunking_request"
ROLE_COMING_WITH = "coming_with"
ROLE_HOUSING_ACCOMMODATION = "housing_accommodation"
ROLE_ACCOMMODATION_DETAILS = "accommodation_details"
ROLE_CPAP = "cpap"
ROSTER_ROLES: tuple[str, ...] = (
    ROLE_BUNKING_REQUEST,
    ROLE_COMING_WITH,
    ROLE_HOUSING_ACCOMMODATION,
    ROLE_ACCOMMODATION_DETAILS,
    ROLE_CPAP,
)
_LIVE_MATCHES = frozenset({"auto", "staff"})


class JotformBunkingRows(NamedTuple):
    """One year's Jotform rows for the board, as the repository reads them."""

    forms: list[Any]
    submissions: list[Any]
    answers: list[Any]


@dataclass(frozen=True)
class JotformFiling:
    """One matched submission, reduced to what the board shows."""

    submission_id: str
    submitted_at: str
    bunking_request: str = ""
    coming_with: tuple[ComingWithToken, ...] = ()
    housing_accommodation: str = ""
    accommodation_details: str = ""
    cpap: str = ""
    staff_linked: bool = False


def _role_answer(by_question: Mapping[str, Any], field_map: Mapping[str, Any], role: str) -> Any | None:
    qid = str(field_map.get(role, "") or "")
    return by_question.get(qid) if qid else None


def _role_text(by_question: Mapping[str, Any], field_map: Mapping[str, Any], role: str) -> str:
    answer = _role_answer(by_question, field_map, role)
    return str(getattr(answer, "answer_text", "") or "").strip() if answer is not None else ""


def filings_by_person(rows: JotformBunkingRows, *, session_cm_id: int) -> dict[int, list[JotformFiling]]:
    """Each guest's live, matched filings for ONE weekend, oldest first.

    Live = auto- or staff-matched, not DELETED on Jotform. Unmatched and
    ignored submissions belong to the admin queue, not the board.
    """
    field_maps = {str(form.id): dict(getattr(form, "field_map", None) or {}) for form in rows.forms}
    answers: dict[str, dict[str, Any]] = defaultdict(dict)
    for answer in rows.answers:
        answers[str(answer.submission)][str(answer.question_id)] = answer

    out: dict[int, list[JotformFiling]] = defaultdict(list)
    for sub in rows.submissions:
        if int(getattr(sub, "session_cm_id", 0) or 0) != session_cm_id:
            continue
        if str(getattr(sub, "jotform_status", "") or "").upper() == "DELETED":
            continue
        status = str(getattr(sub, "match_status", "") or "")
        person_cm_id = int(getattr(sub, "person_cm_id", 0) or 0)
        if status not in _LIVE_MATCHES or person_cm_id <= 0:
            continue
        field_map = field_maps.get(str(sub.form), {})
        by_question = answers.get(str(sub.id), {})
        coming = _role_answer(by_question, field_map, ROLE_COMING_WITH)
        out[person_cm_id].append(
            JotformFiling(
                submission_id=str(sub.submission_id),
                submitted_at=str(getattr(sub, "submitted_at", "") or ""),
                bunking_request=_role_text(by_question, field_map, ROLE_BUNKING_REQUEST),
                coming_with=tuple(
                    coming_with_tokens(
                        str(getattr(coming, "answer_text", "") or "") if coming is not None else "",
                        getattr(coming, "answer_json", None) if coming is not None else None,
                    )
                ),
                housing_accommodation=_role_text(by_question, field_map, ROLE_HOUSING_ACCOMMODATION),
                accommodation_details=_role_text(by_question, field_map, ROLE_ACCOMMODATION_DETAILS),
                cpap=_role_text(by_question, field_map, ROLE_CPAP),
                staff_linked=status == "staff",
            )
        )
    for filings in out.values():
        filings.sort(key=lambda filing: filing.submitted_at)
    return dict(out)


def _registration_label(raw: str | None, yes: bool) -> str:
    if raw is None or not raw.strip():
        return "blank"
    return "Yes" if yes else "No"


def jotform_need_disagreements(latest: JotformFiling, registration: Mapping[int, str]) -> list[JotformNeedAnswer]:
    """Where the latest filing's housing-accommodation or CPAP answer differs
    from the guest's CampMinder registration (kindred#2766's source). A blank
    registration counts as No; an unanswered Jotform question says nothing.
    """
    says: list[JotformNeedAnswer] = []
    if latest.housing_accommodation:
        jot = parse_bool_field_value(latest.housing_accommodation)
        raw = registration.get(HOUSING_ACCOMODATION_FIELD_CM_ID)
        reg = parse_bool_field_value(raw or "")
        if jot != reg:
            says.append(
                JotformNeedAnswer(
                    need="accommodation",
                    registration=_registration_label(raw, reg),
                    jotform="Yes" if jot else "No",
                    detail=latest.accommodation_details,
                    submitted_at=latest.submitted_at,
                )
            )
    if latest.cpap:
        jot = parse_bool_field_value(latest.cpap)
        raw = registration.get(ADULT_CPAP_FIELD_CM_ID)
        reg = classify_cpap_answer(raw or "").power
        if jot != reg:
            says.append(
                JotformNeedAnswer(
                    need="cpap",
                    registration=_registration_label(raw, reg),
                    jotform="Yes" if jot else "No",
                    submitted_at=latest.submitted_at,
                )
            )
    return says


def build_bunking_request(
    filings: Sequence[JotformFiling], registration: Mapping[int, str] | None = None
) -> BunkingRequestSummary:
    """One guest's `bunking_request` block. `filings` oldest first."""
    if not filings:
        return BunkingRequestSummary(state="no_form")
    versions = [
        BunkingRequestVersion(submitted_at=f.submitted_at, text=normalize_request(f.bunking_request)) for f in filings
    ]
    # Owner ruling 2026-09-24: the latest filing is current even when blank.
    current = versions[-1].text
    latest = filings[-1]
    return BunkingRequestSummary(
        state="request" if current else "none",
        current_text=current,
        versions=versions,
        change=resolve_change(versions),
        changed=request_changed(versions),
        coming_with=list(latest.coming_with),
        submitted=[f.submitted_at for f in filings],
        staff_linked=any(f.staff_linked for f in filings),
        jotform_says=jotform_need_disagreements(latest, registration or {}),
    )
