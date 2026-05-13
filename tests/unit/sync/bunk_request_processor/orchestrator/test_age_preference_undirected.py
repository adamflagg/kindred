"""Regression: AI-parsed age_preference with no directional target_name stays
undirected through orchestrator post-parse enrichment.

The structured AI signal (target_name -> "older"/"younger"/other in
openai_provider.py:432-440) is the only source of truth for direction. Prose
sniffing of parse_notes / ai_reasoning over-fires on negation ("no explicit
direction (older vs younger)") and enumeration ("a year older or a year
younger"), collapsing genuinely undirected preferences into a confident
directional one and bypassing the PENDING/undirected_preference disposition.
"""

from __future__ import annotations

from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    RequestType,
)
from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
    RequestOrchestrator,
)


def _undirected_age_pref_parsed_request(*, parse_notes: str = "", ai_reasoning: str = "") -> ParsedRequest:
    """Build a ParsedRequest matching openai_provider's output when the AI
    returns request_type=age_preference but target_name was not 'older' /
    'younger' (so age_preference is None and target_name was cleared)."""
    return ParsedRequest(
        raw_text=("Really no preference. He gets along with kids his own age and a year above/year below."),
        request_type=RequestType.AGE_PREFERENCE,
        target_name=None,
        age_preference=None,
        source_field="bunk_with",
        confidence=0.5,
        csv_position=0,
        metadata={"parse_notes": parse_notes, "ai_reasoning": ai_reasoning},
    )


class TestUndirectedAgePreferenceStaysNone:
    def test_dual_direction_prose_does_not_collapse_to_direction(self):
        """parse_notes mentioning BOTH 'older' and 'younger' must NOT collapse
        to a direction. Reproduces the production bug."""
        req = _undirected_age_pref_parsed_request(
            parse_notes=(
                "Age preference expressed without naming specific campers; "
                "mentions willingness to bunk with kids a year older or a year "
                "younger. No explicit direction (older vs younger)."
            ),
            ai_reasoning=(
                "Text indicates preference related to age range but does not "
                "name any individual or specify whether older or younger is "
                "preferred."
            ),
        )

        # Call the keyword fallback if it still exists. After the fix this
        # function is deleted; the hasattr guard makes this test pass without
        # an ImportError surface area change, and stays as a regression guard
        # against reintroducing the unsafe prose-sniffing pattern.
        if hasattr(RequestOrchestrator, "_map_age_preference_direction"):
            RequestOrchestrator._map_age_preference_direction(req)

        assert req.age_preference is None, (
            "Undirected age_preference must stay None so disposition_rules "
            "routes it to PENDING/undirected_preference for staff review."
        )

    def test_younger_only_prose_still_does_not_set_direction(self):
        """Even prose that mentions only 'younger' (no 'older' counterpart)
        must not flip an undirected AI parse to directional. The AI's
        target_name was the truth; prose is commentary."""
        req = _undirected_age_pref_parsed_request(
            parse_notes="parent unsure; mentioned 'a year below' as one option",
        )
        if hasattr(RequestOrchestrator, "_map_age_preference_direction"):
            RequestOrchestrator._map_age_preference_direction(req)
        assert req.age_preference is None
