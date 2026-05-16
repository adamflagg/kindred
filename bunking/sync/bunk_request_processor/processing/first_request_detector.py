"""First-request detector for bunk requests.

Replaces the legacy PriorityCalculator's slot-0 selection logic with a
boolean producer signal. The solver objective uses this flag to award the
10x first_request_multiplier to one request per camper.

Only family BUNK_WITH requests (BUNK_REQUEST_FORM source) carry a
'first pick' semantic. Other request types/sources always return False —
they compete on bucket weight (Material/Immaterial/Staff), not on slot-0.
"""

from __future__ import annotations

from ..core.constants import PRIORITY_KEYWORDS
from ..core.models import ParsedRequest, RequestType
from ..shared.constants import SourceField


def is_first_requested(
    parsed: ParsedRequest,
    all_parsed_requests_for_person: list[ParsedRequest],
) -> bool:
    """Return True iff this is the family's 'first pick' for the slot-0 boost.

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
    if parsed.source_field != SourceField.BUNK_REQUEST_FORM:
        return False
    if parsed.request_type != RequestType.BUNK_WITH:
        return False

    if _has_priority_keyword(parsed.raw_text):
        return True

    any_other_has_keyword = any(
        _has_priority_keyword(r.raw_text)
        for r in all_parsed_requests_for_person
        if r is not parsed
        and r.source_field == SourceField.BUNK_REQUEST_FORM
        and r.request_type == RequestType.BUNK_WITH
    )
    if any_other_has_keyword:
        return False

    return parsed.csv_position == 1


def _has_priority_keyword(text: str) -> bool:
    if not text:
        return False
    # "IMPORTANT" is matched case-sensitively: the all-caps shout is a priority
    # signal (7 occurrences in OBR corpus), but lowercase "important" is too
    # common a word to be a reliable signal (e.g. "it is important to Eliana
    # that she be able to be in a bunk with her cousin").
    if "IMPORTANT" in text:
        return True
    text_lower = text.lower()
    return any(keyword in text_lower for keyword in PRIORITY_KEYWORDS)
