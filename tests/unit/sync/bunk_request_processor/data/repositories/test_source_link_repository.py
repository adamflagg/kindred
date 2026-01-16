"""Test-Driven Development for SourceLinkRepository

Tests the junction table access layer for linking bunk_requests to original_bunk_requests.
This enables cross-run deduplication and partial invalidation.

Schema: bunk_request_sources
- bunk_request (relation): FK to bunk_requests
- original_request (relation): FK to original_bunk_requests
- is_primary (bool): Which source "owns" the request
- created (autodate): When link was created
"""

import sys
from pathlib import Path
from unittest.mock import Mock, call

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))


class TestSourceLinkRepository:
    """Test the SourceLinkRepository for junction table access."""

    @pytest.fixture
    def mock_pb_client(self):
        """Create a mock PocketBase client"""
        mock_client = Mock()
        mock_collection = Mock()
        mock_client.collection.return_value = mock_collection
        return mock_client, mock_collection

    @pytest.fixture
    def repository(self, mock_pb_client):
        """Create a SourceLinkRepository with mocked client"""
        from bunking.sync.bunk_request_processor.data.repositories.source_link_repository import (
            SourceLinkRepository,
        )

        mock_client, _ = mock_pb_client
        return SourceLinkRepository(mock_client)

    def test_add_source_link_creates_junction_record(self, repository, mock_pb_client):
        """Test that add_source_link creates a new junction record."""
        mock_client, mock_collection = mock_pb_client
        mock_collection.create.return_value = Mock(id="link_123")

        result = repository.add_source_link(
            bunk_request_id="br_abc123",
            original_request_id="or_xyz789",
            is_primary=True,
        )

        assert result is True
        mock_collection.create.assert_called_once()

        # Verify the data sent to create
        create_args = mock_collection.create.call_args[0][0]
        assert create_args["bunk_request"] == "br_abc123"
        assert create_args["original_request"] == "or_xyz789"
        assert create_args["is_primary"] is True

    def test_add_source_link_non_primary(self, repository, mock_pb_client):
        """Test adding a non-primary source link (for merged requests)."""
        mock_client, mock_collection = mock_pb_client
        mock_collection.create.return_value = Mock(id="link_456")

        result = repository.add_source_link(
            bunk_request_id="br_abc123",
            original_request_id="or_second",
            is_primary=False,  # Non-primary for merged source
        )

        assert result is True
        create_args = mock_collection.create.call_args[0][0]
        assert create_args["is_primary"] is False

    def test_add_source_link_handles_duplicate_gracefully(self, repository, mock_pb_client):
        """Test that adding duplicate link handles unique constraint error."""
        mock_client, mock_collection = mock_pb_client

        # Simulate unique constraint violation
        mock_collection.create.side_effect = Exception("unique constraint failed")

        result = repository.add_source_link(
            bunk_request_id="br_abc123",
            original_request_id="or_xyz789",
            is_primary=True,
        )

        # Should return False, not raise
        assert result is False

    def test_get_sources_for_request_returns_all_linked_originals(self, repository, mock_pb_client):
        """Test fetching all original_request IDs linked to a bunk_request."""
        mock_client, mock_collection = mock_pb_client

        # Mock result with multiple source links
        mock_result = Mock()
        mock_result.items = [
            Mock(original_request="or_primary", is_primary=True),
            Mock(original_request="or_merged1", is_primary=False),
            Mock(original_request="or_merged2", is_primary=False),
        ]
        mock_result.total_items = 3
        mock_collection.get_list.return_value = mock_result

        sources = repository.get_sources_for_request("br_abc123")

        assert len(sources) == 3
        assert "or_primary" in sources
        assert "or_merged1" in sources
        assert "or_merged2" in sources

        # Verify filter was correct
        args = mock_collection.get_list.call_args[1]
        filter_str = args["query_params"]["filter"]
        assert 'bunk_request = "br_abc123"' in filter_str

    def test_get_sources_for_request_returns_empty_when_no_links(self, repository, mock_pb_client):
        """Test fetching sources when no links exist."""
        mock_client, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.items = []
        mock_result.total_items = 0
        mock_collection.get_list.return_value = mock_result

        sources = repository.get_sources_for_request("br_nonexistent")

        assert sources == []

    def test_get_requests_for_source_returns_all_linked_bunk_requests(self, repository, mock_pb_client):
        """Test fetching all bunk_request IDs linked to an original_request.

        This is crucial for partial invalidation - when an original_bunk_request
        changes, we need to find all bunk_requests that depend on it.
        """
        mock_client, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.items = [
            Mock(bunk_request="br_request1", is_primary=True),
            Mock(bunk_request="br_request2", is_primary=True),  # Different request, same source
        ]
        mock_result.total_items = 2
        mock_collection.get_list.return_value = mock_result

        requests = repository.get_requests_for_source("or_xyz789")

        assert len(requests) == 2
        assert "br_request1" in requests
        assert "br_request2" in requests

        # Verify filter
        args = mock_collection.get_list.call_args[1]
        filter_str = args["query_params"]["filter"]
        assert 'original_request = "or_xyz789"' in filter_str

    def test_remove_source_link_deletes_junction_record(self, repository, mock_pb_client):
        """Test removing a specific source link."""
        mock_client, mock_collection = mock_pb_client

        # Mock finding the link
        mock_result = Mock()
        mock_result.items = [Mock(id="link_to_delete")]
        mock_collection.get_list.return_value = mock_result

        result = repository.remove_source_link(
            bunk_request_id="br_abc123",
            original_request_id="or_xyz789",
        )

        assert result is True
        mock_collection.delete.assert_called_once_with("link_to_delete")

    def test_remove_source_link_returns_false_when_not_found(self, repository, mock_pb_client):
        """Test removing a link that doesn't exist."""
        mock_client, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.items = []
        mock_collection.get_list.return_value = mock_result

        result = repository.remove_source_link(
            bunk_request_id="br_nonexistent",
            original_request_id="or_nonexistent",
        )

        assert result is False
        mock_collection.delete.assert_not_called()

    def test_remove_all_links_for_request_deletes_all_junction_records(self, repository, mock_pb_client):
        """Test removing all source links for a bunk_request.

        Used when deleting a bunk_request - must clean up junction table.
        """
        mock_client, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.items = [
            Mock(id="link1"),
            Mock(id="link2"),
            Mock(id="link3"),
        ]
        mock_collection.get_list.return_value = mock_result

        count = repository.remove_all_links_for_request("br_abc123")

        assert count == 3
        assert mock_collection.delete.call_count == 3
        mock_collection.delete.assert_has_calls(
            [
                call("link1"),
                call("link2"),
                call("link3"),
            ]
        )

    def test_get_primary_source_returns_primary_link(self, repository, mock_pb_client):
        """Test fetching only the primary source for a request."""
        mock_client, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.items = [Mock(original_request="or_primary", is_primary=True)]
        mock_collection.get_list.return_value = mock_result

        primary = repository.get_primary_source("br_abc123")

        assert primary == "or_primary"

        # Verify filter includes is_primary
        args = mock_collection.get_list.call_args[1]
        filter_str = args["query_params"]["filter"]
        assert 'bunk_request = "br_abc123"' in filter_str
        assert "is_primary = true" in filter_str

    def test_get_primary_source_returns_none_when_no_primary(self, repository, mock_pb_client):
        """Test fetching primary when none exists (data integrity issue)."""
        mock_client, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.items = []
        mock_collection.get_list.return_value = mock_result

        primary = repository.get_primary_source("br_orphaned")

        assert primary is None

    def test_transfer_primary_status_updates_link(self, repository, mock_pb_client):
        """Test transferring primary status from one source to another.

        Used when merging requests - the new source becomes primary.
        """
        mock_client, mock_collection = mock_pb_client

        # Mock finding the old primary
        old_primary_result = Mock()
        old_primary_result.items = [Mock(id="old_link", original_request="or_old")]
        # Mock finding the new link
        new_link_result = Mock()
        new_link_result.items = [Mock(id="new_link", original_request="or_new")]

        mock_collection.get_list.side_effect = [old_primary_result, new_link_result]

        result = repository.transfer_primary_status(
            bunk_request_id="br_abc123",
            new_primary_original_id="or_new",
        )

        assert result is True

        # Should update both: old to false, new to true
        assert mock_collection.update.call_count == 2

    def test_count_sources_for_request(self, repository, mock_pb_client):
        """Test counting how many sources are linked to a request.

        Useful for determining if a request is merged (count > 1).
        """
        mock_client, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.total_items = 3
        mock_result.items = []  # Don't need items for count
        mock_collection.get_list.return_value = mock_result

        count = repository.count_sources_for_request("br_merged")

        assert count == 3


class TestSourceLinkRepositoryMergeScenarios:
    """Test source link repository in merge scenarios."""

    @pytest.fixture
    def mock_pb_client(self):
        """Create a mock PocketBase client"""
        mock_client = Mock()
        mock_collection = Mock()
        mock_client.collection.return_value = mock_collection
        return mock_client, mock_collection

    @pytest.fixture
    def repository(self, mock_pb_client):
        """Create a SourceLinkRepository with mocked client"""
        from bunking.sync.bunk_request_processor.data.repositories.source_link_repository import (
            SourceLinkRepository,
        )

        mock_client, _ = mock_pb_client
        return SourceLinkRepository(mock_client)

    def test_add_multiple_sources_for_merge(self, repository, mock_pb_client):
        """Test adding multiple source links when merging requests.

        When Field A and Field B both resolve to the same target, the merged
        request should have links to both original_bunk_requests.
        """
        mock_client, mock_collection = mock_pb_client
        mock_collection.create.return_value = Mock(id="link_new")

        # Add primary source (from Field A)
        result1 = repository.add_source_link(
            bunk_request_id="br_merged",
            original_request_id="or_field_a",
            is_primary=True,
        )
        assert result1 is True

        # Add secondary source (from Field B)
        result2 = repository.add_source_link(
            bunk_request_id="br_merged",
            original_request_id="or_field_b",
            is_primary=False,
        )
        assert result2 is True

        assert mock_collection.create.call_count == 2

    def test_merge_links_transfers_all_sources(self, repository, mock_pb_client):
        """Test transferring all source links from one request to another.

        When merging request B into request A:
        - Keep A's sources
        - Transfer B's sources to A (as non-primary)
        - Delete B's original links
        """
        mock_client, mock_collection = mock_pb_client

        # Mock: B has 2 sources
        mock_result_b_sources = Mock()
        mock_result_b_sources.items = [
            Mock(id="b_link1", original_request="or_b1", is_primary=True),
            Mock(id="b_link2", original_request="or_b2", is_primary=False),
        ]
        mock_result_b_sources.total_items = 2
        mock_collection.get_list.return_value = mock_result_b_sources
        mock_collection.create.return_value = Mock(id="new_link")

        # Transfer sources from B to A
        transferred = repository.transfer_all_sources(
            from_request_id="br_to_delete",
            to_request_id="br_to_keep",
        )

        assert transferred == 2

        # Should have created 2 new links (for A) and deleted 2 old links (from B)
        assert mock_collection.create.call_count == 2
        assert mock_collection.delete.call_count == 2


class TestSourceLinkRepositoryPartialInvalidation:
    """Test source link repository for partial invalidation scenarios."""

    @pytest.fixture
    def mock_pb_client(self):
        """Create a mock PocketBase client"""
        mock_client = Mock()
        mock_collection = Mock()
        mock_client.collection.return_value = mock_collection
        return mock_client, mock_collection

    @pytest.fixture
    def repository(self, mock_pb_client):
        """Create a SourceLinkRepository with mocked client"""
        from bunking.sync.bunk_request_processor.data.repositories.source_link_repository import (
            SourceLinkRepository,
        )

        mock_client, _ = mock_pb_client
        return SourceLinkRepository(mock_client)

    def test_find_affected_requests_when_source_changes(self, repository, mock_pb_client):
        """Test finding all bunk_requests affected by a source change.

        When original_bunk_request OR123 content_hash changes:
        1. Find all bunk_requests linked to OR123
        2. For single-source requests: flag for deletion
        3. For multi-source requests: flag for source removal (not deletion)
        """
        mock_client, mock_collection = mock_pb_client

        # OR123 is linked to 3 bunk_requests
        mock_result = Mock()
        mock_result.items = [
            Mock(bunk_request="br_single", is_primary=True),
            Mock(bunk_request="br_merged1", is_primary=True),  # Primary in merged
            Mock(bunk_request="br_merged2", is_primary=False),  # Secondary in merged
        ]
        mock_result.total_items = 3
        mock_collection.get_list.return_value = mock_result

        affected = repository.get_requests_for_source("or_changed")

        assert len(affected) == 3
        assert "br_single" in affected
        assert "br_merged1" in affected
        assert "br_merged2" in affected

    def test_is_single_source_request(self, repository, mock_pb_client):
        """Test checking if a request has only one source (should be deleted on change)."""
        mock_client, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.total_items = 1
        mock_result.items = []
        mock_collection.get_list.return_value = mock_result

        is_single = repository.is_single_source("br_single")

        assert is_single is True

    def test_is_multi_source_request(self, repository, mock_pb_client):
        """Test checking if a request has multiple sources (should preserve on change)."""
        mock_client, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.total_items = 3
        mock_result.items = []
        mock_collection.get_list.return_value = mock_result

        is_single = repository.is_single_source("br_merged")

        assert is_single is False


class TestSourceLinkRepositoryBulkOperations:
    """Test bulk operations for efficiency."""

    @pytest.fixture
    def mock_pb_client(self):
        """Create a mock PocketBase client"""
        mock_client = Mock()
        mock_collection = Mock()
        mock_client.collection.return_value = mock_collection
        return mock_client, mock_collection

    @pytest.fixture
    def repository(self, mock_pb_client):
        """Create a SourceLinkRepository with mocked client"""
        from bunking.sync.bunk_request_processor.data.repositories.source_link_repository import (
            SourceLinkRepository,
        )

        mock_client, _ = mock_pb_client
        return SourceLinkRepository(mock_client)

    def test_add_source_links_batch(self, repository, mock_pb_client):
        """Test adding multiple source links in batch.

        Optimization for initial sync - avoid N individual API calls.
        """
        mock_client, mock_collection = mock_pb_client
        mock_collection.create.return_value = Mock(id="new_link")

        links = [
            {"bunk_request_id": "br_1", "original_request_id": "or_a", "is_primary": True},
            {"bunk_request_id": "br_2", "original_request_id": "or_b", "is_primary": True},
            {"bunk_request_id": "br_3", "original_request_id": "or_c", "is_primary": True},
        ]

        count = repository.add_source_links_batch(links)

        assert count == 3
        assert mock_collection.create.call_count == 3

    def test_get_sources_for_requests_batch(self, repository, mock_pb_client):
        """Test fetching sources for multiple requests at once.

        Optimization for partial invalidation checks.
        """
        mock_client, mock_collection = mock_pb_client

        # Mock returns all links for the batch
        mock_result = Mock()
        mock_result.items = [
            Mock(bunk_request="br_1", original_request="or_a", is_primary=True),
            Mock(bunk_request="br_1", original_request="or_b", is_primary=False),
            Mock(bunk_request="br_2", original_request="or_c", is_primary=True),
        ]
        mock_result.total_items = 3
        mock_collection.get_list.return_value = mock_result

        sources_map = repository.get_sources_for_requests_batch(["br_1", "br_2"])

        assert len(sources_map) == 2
        assert sources_map["br_1"] == ["or_a", "or_b"]
        assert sources_map["br_2"] == ["or_c"]


class TestSourceLinkRepositoryWithFieldInfo:
    """Test source link repository methods that return field information.

    TDD: These tests define behavior for get_source_links_with_fields(),
    needed for split endpoint to match absorbed requests by source_field.
    """

    @pytest.fixture
    def mock_pb_client(self):
        """Create a mock PocketBase client"""
        mock_client = Mock()
        mock_collection = Mock()
        mock_client.collection.return_value = mock_collection
        return mock_client, mock_collection

    @pytest.fixture
    def repository(self, mock_pb_client):
        """Create a SourceLinkRepository with mocked client"""
        from bunking.sync.bunk_request_processor.data.repositories.source_link_repository import (
            SourceLinkRepository,
        )

        mock_client, _ = mock_pb_client
        return SourceLinkRepository(mock_client)

    def test_get_source_links_with_fields_returns_all_link_info(self, repository, mock_pb_client):
        """Test fetching source links with their source_field values.

        This is needed for split endpoint to match absorbed requests by source_field
        when the source links have been transferred to the kept request.
        """
        mock_client, mock_collection = mock_pb_client

        # Mock result with source links that have source_field populated
        mock_result = Mock()
        mock_result.items = [
            Mock(original_request="or_primary", source_field="Share Bunk With", is_primary=True),
            Mock(original_request="or_merged", source_field="BunkingNotes Notes", is_primary=False),
        ]
        mock_result.total_items = 2
        mock_collection.get_list.return_value = mock_result

        links = repository.get_source_links_with_fields("br_merged_request")

        assert len(links) == 2

        # First link
        assert links[0]["original_request_id"] == "or_primary"
        assert links[0]["source_field"] == "Share Bunk With"
        assert links[0]["is_primary"] is True

        # Second link
        assert links[1]["original_request_id"] == "or_merged"
        assert links[1]["source_field"] == "BunkingNotes Notes"
        assert links[1]["is_primary"] is False

        # Verify filter was correct
        args = mock_collection.get_list.call_args[1]
        filter_str = args["query_params"]["filter"]
        assert 'bunk_request = "br_merged_request"' in filter_str

    def test_get_source_links_with_fields_returns_empty_when_no_links(self, repository, mock_pb_client):
        """Test fetching source links when no links exist."""
        mock_client, mock_collection = mock_pb_client

        mock_result = Mock()
        mock_result.items = []
        mock_result.total_items = 0
        mock_collection.get_list.return_value = mock_result

        links = repository.get_source_links_with_fields("br_nonexistent")

        assert links == []

    def test_get_source_links_with_fields_handles_missing_source_field(self, repository, mock_pb_client):
        """Test that missing source_field attribute is handled gracefully.

        Some older records may not have source_field populated.
        """
        mock_client, mock_collection = mock_pb_client

        # Mock item without source_field attribute
        mock_item = Mock(spec=["original_request", "is_primary"])
        mock_item.original_request = "or_legacy"
        mock_item.is_primary = True

        mock_result = Mock()
        mock_result.items = [mock_item]
        mock_result.total_items = 1
        mock_collection.get_list.return_value = mock_result

        links = repository.get_source_links_with_fields("br_legacy")

        assert len(links) == 1
        assert links[0]["original_request_id"] == "or_legacy"
        assert links[0]["source_field"] is None
        assert links[0]["is_primary"] is True

    def test_get_source_links_with_fields_handles_api_error(self, repository, mock_pb_client):
        """Test that API errors return empty list."""
        mock_client, mock_collection = mock_pb_client

        mock_collection.get_list.side_effect = Exception("API error")

        links = repository.get_source_links_with_fields("br_error")

        assert links == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
