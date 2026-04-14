"""Tests for AI Pydantic schemas."""

from bunking.sync.bunk_request_processor.integration.ai_schemas import (
    AIBunkRequestItem,
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
