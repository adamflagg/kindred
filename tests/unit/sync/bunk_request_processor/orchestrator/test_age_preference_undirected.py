"""Regression guard: the unsafe prose-sniffing fallback that auto-classified
undirected age_preference requests must not be reintroduced.

The deleted ``RequestOrchestrator._map_age_preference_direction`` substring-
matched the AI's free-text rationale (parse_notes + ai_reasoning) for direction
keywords ("older", "younger", "above", "below", "grade up", etc.) and overrode
``openai_provider``'s structured ``target_name`` -> ``AgePreference`` mapping.
It over-fired on prose where the AI used direction words to *describe* the
absence of a direction. Examples from production:

- "No explicit direction (older vs younger)."          -> wrongly OLDER
- "kids a year older or a year younger"                -> wrongly OLDER (if/elif bias)
- "parent unsure; 'a year below' as one option"        -> wrongly YOUNGER

Direction now comes solely from the structured AI signal in
``openai_provider.py:432-440`` (``target_name.lower()`` ->
``AgePreference.OLDER`` / ``AgePreference.YOUNGER`` / ``None``). When ``None``,
``disposition_rules._age_preference_rules`` PENDs the request with reason
``undirected_preference`` for staff review. This is the intended design; the
fallback was a hack that bypassed it.

If you find yourself wanting to infer direction from any free-text source after
the AI parse, **stop** — the AI's structured target_name is the only trusted
signal. If structured signal isn't enough, change the AI schema (see issue
#1401) rather than re-introducing prose sniffing.
"""

from __future__ import annotations

from bunking.sync.bunk_request_processor.orchestrator.orchestrator import (
    RequestOrchestrator,
)


class TestKeywordFallbackNotReintroduced:
    def test_map_age_preference_direction_does_not_exist(self):
        """``_map_age_preference_direction`` must not be reintroduced on
        ``RequestOrchestrator``. Direction comes from the structured AI signal,
        not from substring-matching the AI's free-text rationale."""
        assert not hasattr(RequestOrchestrator, "_map_age_preference_direction"), (
            "Do not reintroduce _map_age_preference_direction. Direction must "
            "come from openai_provider's structured target_name -> "
            "AgePreference mapping; undirected parses must stay None and route "
            "to PENDING/undirected_preference via "
            "disposition_rules._age_preference_rules. See PR #1402 for the "
            "bug class this guards against."
        )
