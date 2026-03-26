"""Tests for GroupKind enum and ParsedRequest.group_kind field.

These tests define the expected behavior for group reference types
that can be expanded into individual bunk requests."""

from typing import Any

from bunking.sync.bunk_request_processor.core.models import (
    GroupKind,
    ParsedRequest,
    RequestSource,
    RequestType,
)


class TestGroupKind:
    """Test the GroupKind enum values."""

    def test_sibling_value(self):
        """GroupKind.SIBLING should have value 'sibling'."""
        assert GroupKind.SIBLING.value == "sibling"

    def test_last_year_bunkmates_value(self):
        """GroupKind.LAST_YEAR_BUNKMATES should have value 'last_year_bunkmates'."""
        assert GroupKind.LAST_YEAR_BUNKMATES.value == "last_year_bunkmates"

    def test_classmates_value(self):
        """GroupKind.CLASSMATES should have value 'classmates'."""
        assert GroupKind.CLASSMATES.value == "classmates"

    def test_congregation_value(self):
        """GroupKind.CONGREGATION should have value 'congregation'."""
        assert GroupKind.CONGREGATION.value == "congregation"

    def test_all_members(self):
        """GroupKind should have exactly 4 members."""
        assert len(GroupKind) == 4


class TestParsedRequestGroupKind:
    """Test the group_kind field on ParsedRequest."""

    def _make_parsed_request(self, **overrides: Any) -> ParsedRequest:
        """Helper to create a ParsedRequest with sensible defaults."""
        defaults: dict[str, Any] = {
            "raw_text": "bunk with sibling",
            "request_type": RequestType.BUNK_WITH,
            "target_name": None,
            "age_preference": None,
            "source_field": "share_bunk_with",
            "source": RequestSource.FAMILY,
            "confidence": 0.95,
            "csv_position": 0,
            "metadata": {},
            "notes": None,
        }
        defaults.update(overrides)
        return ParsedRequest(**defaults)

    def test_group_kind_defaults_to_none(self):
        """ParsedRequest.group_kind should default to None."""
        request = self._make_parsed_request()
        assert request.group_kind is None

    def test_group_kind_can_be_set_to_classmates(self):
        """ParsedRequest.group_kind can be set to GroupKind.CLASSMATES."""
        request = self._make_parsed_request(group_kind=GroupKind.CLASSMATES)
        assert request.group_kind == GroupKind.CLASSMATES

    def test_group_kind_can_be_set_to_sibling(self):
        """ParsedRequest.group_kind can be set to GroupKind.SIBLING."""
        request = self._make_parsed_request(group_kind=GroupKind.SIBLING)
        assert request.group_kind == GroupKind.SIBLING

    def test_group_kind_can_be_set_to_last_year_bunkmates(self):
        """ParsedRequest.group_kind can be set to GroupKind.LAST_YEAR_BUNKMATES."""
        request = self._make_parsed_request(group_kind=GroupKind.LAST_YEAR_BUNKMATES)
        assert request.group_kind == GroupKind.LAST_YEAR_BUNKMATES

    def test_group_kind_can_be_set_to_congregation(self):
        """ParsedRequest.group_kind can be set to GroupKind.CONGREGATION."""
        request = self._make_parsed_request(group_kind=GroupKind.CONGREGATION)
        assert request.group_kind == GroupKind.CONGREGATION
