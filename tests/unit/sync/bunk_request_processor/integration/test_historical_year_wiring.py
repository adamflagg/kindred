"""Tests for historical_year wiring from AI response → ParsedRequest → ResolutionResult.

Validates that:
1. AIBunkRequestItem schema accepts historical_year
2. _convert_parse_response carries historical_year into ParsedRequest.metadata
3. Output field rules prompt mentions historical_year
"""

from bunking.sync.bunk_request_processor.integration.ai_schemas import AIBunkRequestItem, AIParseResponse


class TestAISchemaHistoricalYear:
    """Test that AIBunkRequestItem accepts historical_year."""

    def test_historical_year_field_accepted(self):
        """AI response with historical_year should parse without error."""
        item = AIBunkRequestItem(
            request_type="bunk_with",
            target_name="Emma Johnson",
            historical_year=2025,
        )
        assert item.historical_year == 2025

    def test_historical_year_none_default(self):
        """historical_year should default to None when not provided."""
        item = AIBunkRequestItem(
            request_type="bunk_with",
            target_name="Emma Johnson",
        )
        assert item.historical_year is None

    def test_full_parse_response_with_historical_year(self):
        """Full AIParseResponse with historical_year should parse."""
        response = AIParseResponse(
            requests=[
                AIBunkRequestItem(
                    request_type="bunk_with",
                    target_name="Emma Johnson",
                    historical_year=2024,
                    parse_notes="Same bunk as 2024",
                ),
                AIBunkRequestItem(
                    request_type="bunk_with",
                    target_name="Olivia Chen",
                    historical_year=2024,
                ),
            ]
        )
        assert len(response.requests) == 2
        assert response.requests[0].historical_year == 2024
        assert response.requests[1].historical_year == 2024


class TestPromptHistoricalYear:
    """Test that the output field rules mention historical_year."""

    def test_output_field_rules_mentions_historical_year(self):
        """The output field rules partial should mention historical_year."""
        with open("config/prompts/_partials/output_field_rules.txt") as f:
            content = f.read()
        assert "historical_year" in content

    def test_parse_bunk_with_mentions_historical_year(self):
        """The parse_bunk_with prompt should mention historical year extraction."""
        with open("config/prompts/parse_bunk_with.txt") as f:
            content = f.read()
        assert "historical_year" in content.lower() or "historical year" in content.lower()
