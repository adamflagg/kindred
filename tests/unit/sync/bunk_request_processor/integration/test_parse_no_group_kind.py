"""Regression guard: AI parse schemas reject group_kind / group_metadata.

The group-expansion feature has been removed. AI responses are expected to
name specific individuals, or produce a single PENDING staff-review record
when that isn't possible. If a stale AI response sends group_kind or
group_metadata, the schema must fail loudly rather than silently drop it.
"""

import pytest

from bunking.sync.bunk_request_processor.integration.ai_schemas import (
    AIBunkRequestItem,
    AIFullParseRequestItem,
    AIParseResponse,
)


class TestAiSchemaRejectsGroupKind:
    """AIBunkRequestItem must not accept group_kind or group_metadata."""

    def test_ai_bunk_request_item_rejects_group_kind(self) -> None:
        """Sending group_kind to AIBunkRequestItem must raise a validation error.

        Pydantic models default to ignoring extras in permissive mode; the
        schema is configured (after this change) to forbid unknown fields so
        a stale AI response containing `group_kind` surfaces as a hard error
        rather than silently passing unused data.
        """
        with pytest.raises(Exception) as exc_info:
            AIBunkRequestItem.model_validate(
                {
                    "request_type": "bunk_with",
                    "target_name": "Emma Johnson",
                    "group_kind": "sibling",
                }
            )
        # Pydantic raises ValidationError; either way, the field name
        # should appear in the error message for clarity.
        assert "group_kind" in str(exc_info.value)

    def test_ai_bunk_request_item_rejects_group_metadata(self) -> None:
        """group_metadata must also be rejected as an unknown field."""
        with pytest.raises(Exception) as exc_info:
            AIBunkRequestItem.model_validate(
                {
                    "request_type": "bunk_with",
                    "target_name": "Emma Johnson",
                    "group_metadata": {"school_name": "Riverside Elementary"},
                }
            )
        assert "group_metadata" in str(exc_info.value)

    def test_ai_bunk_request_item_has_no_group_kind_attribute(self) -> None:
        """The schema class should not define group_kind at all."""
        item = AIBunkRequestItem(request_type="bunk_with", target_name="Liam Garcia")
        assert not hasattr(item, "group_kind")
        assert not hasattr(item, "group_metadata")

    def test_ai_full_parse_request_item_has_no_group_kind(self) -> None:
        """The Phase 1+2 combined schema also should not expose group_kind."""
        item = AIFullParseRequestItem(
            request_type="bunk_with",
            target_name="Olivia Chen",
        )
        assert not hasattr(item, "group_kind")
        assert not hasattr(item, "group_metadata")

    def test_ai_full_parse_request_item_rejects_group_kind(self) -> None:
        """A stale AI response sending group_kind to AIFullParseRequestItem
        must raise a validation error. The full-mode (attendee-context) code
        path uses this schema, so extra="forbid" must be exercised here too."""
        with pytest.raises(Exception) as exc_info:
            AIFullParseRequestItem.model_validate(
                {
                    "request_type": "bunk_with",
                    "target_name": "Olivia Chen",
                    "group_kind": "sibling",
                }
            )
        assert "group_kind" in str(exc_info.value)

    def test_ai_full_parse_request_item_rejects_group_metadata(self) -> None:
        """group_metadata must also be rejected on the full-mode schema."""
        with pytest.raises(Exception) as exc_info:
            AIFullParseRequestItem.model_validate(
                {
                    "request_type": "bunk_with",
                    "target_name": "Olivia Chen",
                    "group_metadata": {"school_name": "Oak Valley Middle"},
                }
            )
        assert "group_metadata" in str(exc_info.value)

    def test_ai_parse_response_rejects_group_kind_in_items(self) -> None:
        """A full parse response with nested group_kind should fail validation."""
        with pytest.raises(Exception) as exc_info:
            AIParseResponse.model_validate(
                {
                    "requests": [
                        {
                            "request_type": "bunk_with",
                            "target_name": "",
                            "group_kind": "last_year_bunkmates",
                        }
                    ]
                }
            )
        assert "group_kind" in str(exc_info.value)


class TestParsedRequestHasNoGroupKind:
    """The domain ParsedRequest model must not expose a group_kind field."""

    def test_parsed_request_no_group_kind_field(self) -> None:
        from bunking.sync.bunk_request_processor.core.models import (
            ParsedRequest,
            RequestType,
        )

        req = ParsedRequest(
            raw_text="bunk with Emma",
            request_type=RequestType.BUNK_WITH,
            target_name="Emma Johnson",
            age_preference=None,
            source_field="bunk_request_form",
            confidence=0.95,
            csv_position=0,
            metadata={},
        )

        # The group_kind attribute must not exist on ParsedRequest
        assert not hasattr(req, "group_kind")

    def test_group_kind_enum_not_exported(self) -> None:
        """GroupKind enum must not be importable from core.models."""
        import bunking.sync.bunk_request_processor.core.models as models

        assert not hasattr(models, "GroupKind")
