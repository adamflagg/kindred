"""First-request detector for bunk requests.

Replaces the legacy PriorityCalculator's slot-0 selection logic with a
boolean producer signal. The solver objective uses this flag to award the
10x first_request_multiplier to one request per camper.

Only family BUNK_WITH requests (BUNK_REQUEST_FORM source) carry a
'first pick' semantic. Other request types/sources always return False —
they compete on bucket weight (Material/Immaterial/Staff), not on slot-0.

TG-3 adds ``DetectionResult`` / ``detect_first_request`` to split the
explicit-keyword signal (``priority_keyword_detected``) from the
positional-fallback signal (``is_first_requested`` via csv_position==1).
Consumers that need only the bool can still use the legacy
``is_first_requested()`` wrapper.

Fix #1612: ``detect_first_request`` now attributes priority keywords to
the per-name fragment rather than the whole comma-joined line. When all
members of a "line-group" (requests sharing the same ``raw_text``) are
present, the line is split on commas/semicolons and each request is
evaluated against only the fragment at its ``csv_position``. If the
fragment count doesn't match the group size (e.g. a single prose phrase
covering multiple names), the logic falls back to whole-line scanning so
that intentional multi-pick phrases ("must have Emma and Liam") still
flag both requests.
"""

import re
from dataclasses import dataclass

from ..core.constants import PRIORITY_KEYWORDS
from ..core.models import ParsedRequest, RequestType
from ..shared.constants import SourceField

# Separator pattern for splitting a raw field value into per-name fragments.
_FRAGMENT_SPLIT_RE = re.compile(r"[,;]")


@dataclass(frozen=True)
class DetectionResult:
    """Result of first-request detection for a single bunk request.

    Attributes:
        is_first_requested: True iff this request earns the slot-0
            first-pick multiplier (keyword match OR positional fallback).
        priority_keyword_detected: True iff the request's raw_text
            contained an explicit priority keyword. Always False when
            ``is_first_requested`` is False, and False even when
            ``is_first_requested`` is True via positional fallback only.
    """

    is_first_requested: bool
    priority_keyword_detected: bool


def detect_first_request(
    parsed: ParsedRequest,
    family_siblings: list[ParsedRequest],
) -> DetectionResult:
    """Return a DetectionResult for this family BUNK_WITH request.

    ``family_siblings`` should be the *other* family BUNK_WITH requests
    for the same requester (not including ``parsed`` itself). The caller
    is responsible for filtering to BUNK_REQUEST_FORM + BUNK_WITH only.

    Non-family / non-bunk_with requests always return both fields False —
    they carry no first-pick semantic.

    Logic (scoped to BUNK_REQUEST_FORM + BUNK_WITH):
      1. Own keyword present in this request's fragment → is_first_requested=True,
         priority_keyword_detected=True
      2. A sibling has keyword in its fragment → is_first_requested=False,
         priority_keyword_detected=False
      3. Positional fallback → is_first_requested=(csv_position==1),
         priority_keyword_detected=False

    "Own fragment" is determined by splitting the shared raw_text on commas/
    semicolons and aligning by csv_position within the line-group (all requests
    that share the same raw_text). If the fragment count doesn't match the
    line-group size, the whole raw_text is used as the fragment (fallback).
    """
    if parsed.source_field != SourceField.BUNK_REQUEST_FORM:
        return DetectionResult(is_first_requested=False, priority_keyword_detected=False)
    if parsed.request_type != RequestType.BUNK_WITH:
        return DetectionResult(is_first_requested=False, priority_keyword_detected=False)

    line_group = [parsed, *family_siblings]
    own_fragment = _own_fragment(parsed, line_group)
    if _has_priority_keyword(own_fragment):
        return DetectionResult(is_first_requested=True, priority_keyword_detected=True)

    sibling_has_keyword = any(_has_priority_keyword(_own_fragment(s, line_group)) for s in family_siblings)
    if sibling_has_keyword:
        return DetectionResult(is_first_requested=False, priority_keyword_detected=False)

    return DetectionResult(is_first_requested=(parsed.csv_position == 1), priority_keyword_detected=False)


def _own_fragment(parsed: ParsedRequest, line_group: list[ParsedRequest]) -> str:
    """Return the text fragment for this request within its line-group.

    If all members share the same raw_text AND the line splits into exactly
    as many fragments as there are group members, return the fragment at
    index ``csv_position - 1`` (0-based). Otherwise return the full raw_text
    so that whole-line scanning preserves existing multi-pick behavior.

    Args:
        parsed: The request whose fragment to extract.
        line_group: All requests (including ``parsed``) that share the same
            raw_text. Single-element groups (unique raw_text) always fall back
            to whole-line.
    """
    raw = parsed.raw_text
    # Fast path: single-element group — no shared line, no alignment needed.
    if len(line_group) <= 1:
        return raw

    # Only align when every member of the group has the same raw_text.
    if any(r.raw_text != raw for r in line_group):
        return raw

    fragments = [f.strip() for f in _FRAGMENT_SPLIT_RE.split(raw)]
    # Alignment only when fragment count matches group size.
    if len(fragments) != len(line_group):
        return raw  # count mismatch → fall back to whole-line

    idx = parsed.csv_position - 1  # csv_position is 1-based
    if 0 <= idx < len(fragments):
        return fragments[idx]
    return raw  # out-of-bounds guard


def is_first_requested(
    parsed: ParsedRequest,
    all_parsed_requests_for_person: list[ParsedRequest],
) -> bool:
    """Return True iff this is the family's 'first pick' for the slot-0 boost.

    Thin wrapper around ``detect_first_request`` for callers that only need
    the boolean. ``all_parsed_requests_for_person`` may include ``parsed``
    itself; it is filtered to the relevant sibling set internally.

    Logic, scoped to family BUNK_WITH requests (BUNK_REQUEST_FORM source):
      - If this request's fragment contains a priority keyword → True.
        Multiple keyword-marked fragments in the same list all return True
        (intentional: a line like "must have Emma and Liam" with one fragment
        produces a count mismatch → whole-line fallback → both requests see it).
      - Else, if ANY other family BUNK_WITH request's fragment has a keyword
        → False (the keyword-marked one(s) won; this one didn't).
      - Else, only csv_position == 1 → True. (csv_position is 1-based in
        practice; see `openai_provider.py` where AI's 0-based list_position
        is converted with `+ 1`.)

    Every non-family or non-bunk_with request returns False — they don't
    carry a first-pick semantic. Their objective weight is governed by
    source-bucket weighting (forthcoming Source Multipliers domain) and
    the second/third diminishing-returns multipliers.
    """
    siblings = [
        r
        for r in all_parsed_requests_for_person
        if r is not parsed
        and r.source_field == SourceField.BUNK_REQUEST_FORM
        and r.request_type == RequestType.BUNK_WITH
    ]
    return detect_first_request(parsed, family_siblings=siblings).is_first_requested


def _has_priority_keyword(text: str) -> bool:
    if not text:
        return False
    # "IMPORTANT" is matched case-sensitively: the all-caps shout is a priority
    # signal (7 occurrences in OBR corpus), but lowercase "important" is too
    # common a word to be a reliable signal (e.g. "it is important to Eliana
    # that she be able to be in a bunk with her cousin").
    if re.search(r"\bIMPORTANT\b", text):
        return True
    text_lower = text.lower()
    return any(keyword in text_lower for keyword in PRIORITY_KEYWORDS)
