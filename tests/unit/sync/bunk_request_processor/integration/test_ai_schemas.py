"""Tests for AI Pydantic schemas."""

import pytest
from pydantic import ValidationError

from bunking.sync.bunk_request_processor.integration.ai_schemas import (
    AIBunkRequestItem,
    AIDisambiguationCandidate,
    AIDisambiguationResponse,
    AIFullParseRequestItem,
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
        import pytest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            AIBunkRequestItem(
                request_type="bunk_with",
                target_name="Emma",
                source_fragment="x" * 2001,
            )

    def test_full_parse_request_item_rejects_fragment_over_2000_chars(self) -> None:
        import pytest
        from pydantic import ValidationError

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
    """The validator should normalize (not reject) when ranked_selections is populated
    alongside the default values for legacy fields (no_match=False, selected_person_id=None).
    """

    def test_ranked_selections_with_default_legacy_fields_is_accepted(self) -> None:
        # Regression for #925: GPT-5-nano returns ranked_selections AND the legacy fields
        # at their defaults. This previously raised ValidationError and dropped the request.
        response = AIDisambiguationResponse(
            ranked_selections=[
                AIDisambiguationCandidate(person_id=111, confidence=0.9),
                AIDisambiguationCandidate(person_id=222, confidence=0.7),
            ],
        )
        assert len(response.ranked_selections) == 2
        assert response.no_match is False
        assert response.selected_person_id is None

    def test_ranked_selections_with_explicit_no_match_true_raises(self) -> None:
        # Genuine conflict: ranked_selections implies matches exist; no_match=True contradicts.
        with pytest.raises(ValidationError):
            AIDisambiguationResponse(
                ranked_selections=[AIDisambiguationCandidate(person_id=111)],
                no_match=True,
            )

    def test_ranked_selections_with_explicit_selected_person_id_raises(self) -> None:
        # Genuine conflict: both fields carry authoritative selection info.
        with pytest.raises(ValidationError):
            AIDisambiguationResponse(
                ranked_selections=[AIDisambiguationCandidate(person_id=111)],
                selected_person_id=222,
            )

    def test_legacy_path_selected_person_id_only_still_works(self) -> None:
        # Backwards compat: responses using only the legacy selected_person_id field.
        response = AIDisambiguationResponse(selected_person_id=333, confidence=0.8)
        assert response.selected_person_id == 333
        assert response.ranked_selections == []
        assert response.no_match is False

    def test_no_match_only_still_works(self) -> None:
        # Backwards compat: no_match response without ranked_selections or selected_person_id.
        response = AIDisambiguationResponse(no_match=True, no_match_reason="no plausible match")
        assert response.no_match is True
        assert response.selected_person_id is None
        assert response.ranked_selections == []

    def test_no_match_true_with_selected_person_id_raises(self) -> None:
        # Genuine conflict: can't both explicitly have no match AND pick a person.
        with pytest.raises(ValidationError):
            AIDisambiguationResponse(no_match=True, selected_person_id=444)

    def test_empty_response_all_defaults_is_accepted(self) -> None:
        # A fully-default response (no selections, no_match=False, no selected id) is benign.
        response = AIDisambiguationResponse()
        assert response.ranked_selections == []
        assert response.no_match is False
        assert response.selected_person_id is None
