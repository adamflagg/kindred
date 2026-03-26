"""Tests for group_kind field in AI parse schema."""

from bunking.sync.bunk_request_processor.integration.ai_schemas import AIBunkRequestItem


class TestAIBunkRequestItemGroupKind:
    def test_group_kind_defaults_none(self):
        item = AIBunkRequestItem(request_type="bunk_with")
        assert item.group_kind is None
        assert item.group_metadata is None

    def test_group_kind_classmates(self):
        item = AIBunkRequestItem(
            request_type="bunk_with",
            group_kind="classmates",
            group_metadata={"school_name": "Park Day"},
        )
        assert item.group_kind == "classmates"
        assert item.group_metadata["school_name"] == "Park Day"

    def test_group_kind_sibling(self):
        item = AIBunkRequestItem(
            request_type="bunk_with",
            group_kind="sibling",
        )
        assert item.group_kind == "sibling"

    def test_group_kind_last_year_bunkmates(self):
        item = AIBunkRequestItem(
            request_type="bunk_with",
            group_kind="last_year_bunkmates",
        )
        assert item.group_kind == "last_year_bunkmates"

    def test_group_kind_congregation(self):
        item = AIBunkRequestItem(
            request_type="bunk_with",
            group_kind="congregation",
            group_metadata={"congregation_name": "Beth Am"},
        )
        assert item.group_kind == "congregation"
        assert item.group_metadata["congregation_name"] == "Beth Am"
