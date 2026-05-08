"""Tests for AI age_preference → AgePreference enum mapping.

Task 0e: When AI parse returns age_preference request_type, the orchestrator
should map directional keywords in parse_notes/reasoning to AgePreference enum,
and Phase 2 should assign appropriate confidence levels."""

from __future__ import annotations

from bunking.sync.bunk_request_processor.core.models import (
    AgePreference,
    ParsedRequest,
    RequestType,
)
from bunking.sync.bunk_request_processor.orchestrator.orchestrator import RequestOrchestrator


def _make_age_pref_request(
    parse_notes: str = "",
    ai_reasoning: str = "",
    age_preference: AgePreference | None = None,
) -> ParsedRequest:
    return ParsedRequest(
        raw_text="age preference request",
        request_type=RequestType.AGE_PREFERENCE,
        target_name="",
        age_preference=age_preference,
        source_field="socialize_with",
        confidence=0.5,
        csv_position=0,
        metadata={"parse_notes": parse_notes, "ai_reasoning": ai_reasoning},
    )


class TestAgePreferenceDirectionMapping:
    """Test that AI-parsed age preferences get mapped to AgePreference enum."""

    def test_older_keyword_in_notes_mapped(self):
        """parse_notes containing 'older' → AgePreference.OLDER."""
        req = _make_age_pref_request(parse_notes="same grade or older")
        RequestOrchestrator._map_age_preference_direction(req)
        assert req.age_preference == AgePreference.OLDER

    def test_younger_keyword_in_notes_mapped(self):
        """parse_notes containing 'younger' → AgePreference.YOUNGER."""
        req = _make_age_pref_request(parse_notes="does better with younger kids")
        RequestOrchestrator._map_age_preference_direction(req)
        assert req.age_preference == AgePreference.YOUNGER

    def test_higher_grade_keyword_mapped(self):
        """parse_notes containing 'higher grade' → AgePreference.OLDER."""
        req = _make_age_pref_request(parse_notes="higher grade if possible")
        RequestOrchestrator._map_age_preference_direction(req)
        assert req.age_preference == AgePreference.OLDER

    def test_lower_grade_keyword_mapped(self):
        """parse_notes containing 'lower grade' → AgePreference.YOUNGER."""
        req = _make_age_pref_request(parse_notes="lower grade preferred")
        RequestOrchestrator._map_age_preference_direction(req)
        assert req.age_preference == AgePreference.YOUNGER

    def test_undirected_stays_none(self):
        """parse_notes like 'similar age bunkmates' → age_preference stays None."""
        req = _make_age_pref_request(parse_notes="similar age bunkmates please")
        RequestOrchestrator._map_age_preference_direction(req)
        assert req.age_preference is None

    def test_reasoning_field_checked(self):
        """ai_reasoning is also checked for directional keywords."""
        req = _make_age_pref_request(ai_reasoning="Parent wants child with older kids")
        RequestOrchestrator._map_age_preference_direction(req)
        assert req.age_preference == AgePreference.OLDER

    def test_already_set_not_overwritten(self):
        """If age_preference is already set, don't overwrite it."""
        req = _make_age_pref_request(parse_notes="younger kids", age_preference=AgePreference.OLDER)
        RequestOrchestrator._map_age_preference_direction(req)
        assert req.age_preference == AgePreference.OLDER  # not overwritten

    def test_non_age_preference_ignored(self):
        """Non-AGE_PREFERENCE requests are not modified."""
        req = ParsedRequest(
            raw_text="bunk with",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma Johnson",
            age_preference=None,
            source_field="bunk_with",
            confidence=0.9,
            csv_position=0,
            metadata={"parse_notes": "older"},
        )
        RequestOrchestrator._map_age_preference_direction(req)
        assert req.age_preference is None
