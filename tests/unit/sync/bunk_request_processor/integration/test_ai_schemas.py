"""Tests for AI Pydantic schemas."""

import pytest
from pydantic import ValidationError

from bunking.sync.bunk_request_processor.integration.ai_schemas import (
    AIBunkRequestItem,
    AIDisambiguationCandidate,
    AIDisambiguationResponse,
    AIFullParseRequestItem,
    AIFullParseResponse,
    AIParseResponse,
    TemporalInfo,
)


class TestAIBunkRequestItemSourceFragment:
    def test_defaults_to_empty_string(self) -> None:
        item = AIBunkRequestItem(request_type="bunk_with", target_name="Emma")
        assert item.source_fragment == ""

    def test_accepts_fragment_value(self) -> None:
        item = AIBunkRequestItem(
            request_type="bunk_with",
            target_name="Emma",
            source_fragment="wants to be with Emma",
        )
        assert item.source_fragment == "wants to be with Emma"

    def test_accepts_empty_when_ai_inferred(self) -> None:
        # Placeholder expansion / age preference / AI inference cases
        # should be allowed to return empty string explicitly
        item = AIBunkRequestItem(
            request_type="age_preference",
            target_name="older",
            source_fragment="",
        )
        assert item.source_fragment == ""


class TestAIFullParseRequestItemSourceFragment:
    def test_defaults_to_empty_string(self) -> None:
        item = AIFullParseRequestItem(request_type="bunk_with", target_name="Emma")
        assert item.source_fragment == ""

    def test_accepts_fragment_value(self) -> None:
        item = AIFullParseRequestItem(
            request_type="bunk_with",
            target_name="Emma",
            source_fragment="Emma Johnson from last year",
        )
        assert item.source_fragment == "Emma Johnson from last year"


class TestSourceFragmentMaxLength:
    def test_bunk_request_item_rejects_fragment_over_2000_chars(self) -> None:
        with pytest.raises(ValidationError):
            AIBunkRequestItem(
                request_type="bunk_with",
                target_name="Emma",
                source_fragment="x" * 2001,
            )

    def test_full_parse_request_item_rejects_fragment_over_2000_chars(self) -> None:
        with pytest.raises(ValidationError):
            AIFullParseRequestItem(
                request_type="bunk_with",
                target_name="Emma",
                source_fragment="x" * 2001,
            )

    def test_bunk_request_item_accepts_fragment_at_exactly_2000_chars(self) -> None:
        item = AIBunkRequestItem(
            request_type="bunk_with",
            target_name="Emma",
            source_fragment="x" * 2000,
        )
        assert len(item.source_fragment) == 2000


class TestAIDisambiguationResponseValidator:
    """The validator should normalize (not reject) when ranked_selections is populated.

    After #944, `selected_person_id` has been removed from the schema; ranked_selections
    is the canonical path, with no_match as the alternative terminal state.
    """

    def test_ranked_selections_with_default_fields_is_accepted(self) -> None:
        # Regression for #925.
        response = AIDisambiguationResponse(
            ranked_selections=[
                AIDisambiguationCandidate(person_id=111, confidence=0.9),
                AIDisambiguationCandidate(person_id=222, confidence=0.7),
            ],
        )
        assert len(response.ranked_selections) == 2
        assert response.no_match is False

    def test_ranked_selections_with_explicit_no_match_true_raises(self) -> None:
        with pytest.raises(ValidationError):
            AIDisambiguationResponse(
                ranked_selections=[AIDisambiguationCandidate(person_id=111)],
                no_match=True,
            )

    def test_no_match_only_still_works(self) -> None:
        response = AIDisambiguationResponse(no_match=True, no_match_reason="no plausible match")
        assert response.no_match is True
        assert response.ranked_selections == []

    def test_empty_response_all_defaults_is_accepted(self) -> None:
        response = AIDisambiguationResponse()
        assert response.ranked_selections == []
        assert response.no_match is False

    def test_schema_has_no_selected_person_id_field(self) -> None:
        """#944: selected_person_id was removed from the schema as dead legacy."""
        assert "selected_person_id" not in AIDisambiguationResponse.model_fields


class TestExtraForbidOnAllAISchemas:
    """#949: All AI boundary schemas must reject unknown fields (extra='forbid').

    Silently-ignored extra fields cause stale cached responses or provider swaps to
    pass validation while dropping data the pipeline no longer understands.
    """

    def test_disambiguation_response_rejects_unknown_field(self) -> None:
        with pytest.raises(ValidationError):
            AIDisambiguationResponse(**{"unknown_field": "x"})

    def test_disambiguation_candidate_rejects_unknown_field(self) -> None:
        with pytest.raises(ValidationError):
            AIDisambiguationCandidate(**{"person_id": 1, "unknown_field": "x"})

    def test_temporal_info_rejects_unknown_field(self) -> None:
        with pytest.raises(ValidationError):
            TemporalInfo(**{"unknown_field": "x"})

    def test_parse_response_rejects_unknown_field(self) -> None:
        with pytest.raises(ValidationError):
            AIParseResponse(**{"unknown_field": "x"})

    def test_full_parse_response_rejects_unknown_field(self) -> None:
        with pytest.raises(ValidationError):
            AIFullParseResponse(**{"unknown_field": "x"})


class TestAIBunkRequestItemAgeDirection:
    """#1401: age_direction is a first-class structured field on AI bunk requests.

    Direction was previously overloaded onto target_name (e.g. target_name="older").
    A dedicated Literal-constrained field eliminates that overload. The schema does
    NOT police cross-field semantics — provider enforcement handles drift salvage.
    """

    def test_age_direction_defaults_to_none(self) -> None:
        item = AIBunkRequestItem(request_type="age_preference")
        assert item.age_direction is None

    def test_age_direction_accepts_older(self) -> None:
        item = AIBunkRequestItem(request_type="age_preference", age_direction="older")
        assert item.age_direction == "older"

    def test_age_direction_accepts_younger(self) -> None:
        item = AIBunkRequestItem(request_type="age_preference", age_direction="younger")
        assert item.age_direction == "younger"

    def test_age_direction_rejects_invalid_value(self) -> None:
        with pytest.raises(ValidationError):
            AIBunkRequestItem(request_type="age_preference", age_direction="middle")

    def test_age_direction_accepted_on_bunk_with_but_meaningless(self) -> None:
        """Schema allows age_direction on any request type; semantic enforcement is in provider."""
        item = AIBunkRequestItem(
            request_type="bunk_with",
            target_name="Emma",
            age_direction="older",
        )
        assert item.request_type == "bunk_with"
        assert item.age_direction == "older"
