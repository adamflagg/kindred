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
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..core.constants import PRIORITY_KEYWORDS
from ..core.models import ParsedRequest, RequestType
from ..shared.constants import SourceField


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
      1. Own keyword present  → is_first_requested=True,  priority_keyword_detected=True
      2. A sibling has keyword → is_first_requested=False, priority_keyword_detected=False
      3. Positional fallback   → is_first_requested=(csv_position==1), priority_keyword_detected=False
    """
    if parsed.source_field != SourceField.BUNK_REQUEST_FORM:
        return DetectionResult(is_first_requested=False, priority_keyword_detected=False)
    if parsed.request_type != RequestType.BUNK_WITH:
        return DetectionResult(is_first_requested=False, priority_keyword_detected=False)

    if _has_priority_keyword(parsed.raw_text):
        return DetectionResult(is_first_requested=True, priority_keyword_detected=True)

    sibling_has_keyword = any(_has_priority_keyword(s.raw_text) for s in family_siblings)
    if sibling_has_keyword:
        return DetectionResult(is_first_requested=False, priority_keyword_detected=False)

    return DetectionResult(is_first_requested=(parsed.csv_position == 1), priority_keyword_detected=False)


def is_first_requested(
    parsed: ParsedRequest,
    all_parsed_requests_for_person: list[ParsedRequest],
) -> bool:
    """Return True iff this is the family's 'first pick' for the slot-0 boost.

    Thin wrapper around ``detect_first_request`` for callers that only need
    the boolean. ``all_parsed_requests_for_person`` may include ``parsed``
    itself; it is filtered to the relevant sibling set internally.

    Logic, scoped to family BUNK_WITH requests (BUNK_REQUEST_FORM source):
      - If this request's raw_text contains a priority keyword → True.
        Multiple keyword-marked requests in the same list all return True
        (intentional: "must have Emma and Liam" reads as two top picks).
      - Else, if ANY other family BUNK_WITH request in the list has a
        keyword → False (the keyword-marked one(s) won; this one didn't).
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
