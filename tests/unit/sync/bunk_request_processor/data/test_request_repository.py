"""Test-Driven Development for RequestRepository

Tests the data access layer for BunkRequest entities.
Updated for new PocketBase schema:
- requester_id (was requester_person_id)
- requestee_id (was requested_person_id)
- session_id (direct field with CM ID)"""

import sys
from pathlib import Path
from unittest.mock import Mock, call

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import (
    BunkRequest,
    RequestSource,
    RequestStatus,
    RequestType,
)
from bunking.sync.bunk_request_processor.data.repositories.request_repository import RequestRepository


class TestRequestRepository:
    """Test the RequestRepository data access"""

    @pytest.fixture
    def mock_pb_client(self):
        """Create a mock PocketBase client"""
        mock_client = Mock()
        mock_collection = Mock()
        mock_client.collection.return_value = mock_collection
        return mock_client, mock_collection

    @pytest.fixture
    def repository(self, mock_pb_client):
        """Create a RequestRepository with mocked client"""
        mock_client, _ = mock_pb_client
        return RequestRepository(mock_client)

    def _create_request_mock(
        self,
        id,
        requester_id,
        requestee_id,
        request_type,
        session_id,
        year,
        priority=4,
        confidence_score=0.95,
        source="family",
        source_field="share_bunk_with",
        csv_position=0,
        status="resolved",
        is_placeholder=False,
        metadata="{}",
    ):
        """Helper to create a properly structured request mock with new field names"""
        mock = Mock()
        mock.id = id
        mock.requester_id = requester_id
        mock.requestee_id = requestee_id
        mock.request_type = request_type
        mock.session_id = session_id
        mock.year = year
        mock.priority = priority
        mock.confidence_score = confidence_score
        mock.source = source
        mock.source_field = source_field
        mock.csv_position = csv_position
        mock.status = status
        mock.is_placeholder = is_placeholder
        mock.metadata = metadata
        return mock

    def test_create_bunk_request(self, repository, mock_pb_client):
        """Test creating a new bunk request"""
        mock_client, mock_collection = mock_pb_client

        # Create a request object
        request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=4,
            confidence_score=0.95,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"resolution_method": "exact_match"},
        )

        # Mock successful creation
        mock_created = Mock(id="abc123")
        mock_collection.create.return_value = mock_created

        # Test creation
        result = repository.create(request)

        assert result is True

        # Verify the data sent to create uses new field names
        # create() is called with positional arg: create(data)
        create_args = mock_collection.create.call_args[0][0]
        assert create_args["requester_id"] == 12345
        assert create_args["requestee_id"] == 67890
        assert create_args["request_type"] == "bunk_with"
        assert create_args["session_id"] == 1000002
        assert create_args["priority"] == 4
        assert create_args["confidence_score"] == 0.95
        assert create_args["source"] == "family"
        assert create_args["source_field"] == "share_bunk_with"
        assert create_args["csv_position"] == 0
        assert create_args["year"] == 2025
        assert create_args["status"] == "resolved"
        assert create_args["is_placeholder"] is False
        assert "metadata" in create_args

    def test_create_age_preference_request(self, repository, mock_pb_client):
        """Test creating an age preference request (no requestee_id)"""
        mock_client, mock_collection = mock_pb_client

        request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=None,  # No target for age preference
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=1.0,
            source=RequestSource.FAMILY,
            source_field="ret_parent_socialize_with_best",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"age_preference": "older"},
        )

        mock_collection.create.return_value = Mock(id="xyz789")

        result = repository.create(request)
        assert result is True

        # Verify null requestee_id is handled
        # create() is called with positional arg: create(data)
        create_args = mock_collection.create.call_args[0][0]
        assert create_args["requestee_id"] is None
        assert create_args["request_type"] == "age_preference"

    def test_find_existing_request(self, repository, mock_pb_client):
        """Test finding an existing request"""
        mock_client, mock_collection = mock_pb_client

        # Mock existing request with new field names
        mock_result = Mock()
        mock_result.items = [
            self._create_request_mock(
                id="abc123",
                requester_id=12345,
                requestee_id=67890,
                request_type="bunk_with",
                session_id=1000002,
                year=2025,
                priority=4,
                confidence_score=0.95,
                source="family",
                source_field="share_bunk_with",
                csv_position=0,
                status="resolved",
                is_placeholder=False,
                metadata='{"resolution_method": "exact_match"}',
            )
        ]
        mock_collection.get_list.return_value = mock_result

        # Test finding
        request = repository.find_existing(12345, 67890, "bunk_with", 2025)

        assert request is not None
        assert request.requester_cm_id == 12345
        assert request.requested_cm_id == 67890
        assert request.request_type == RequestType.BUNK_WITH
        assert request.year == 2025

        # Verify query uses new field names
        args = mock_collection.get_list.call_args[1]
        filter_str = args["query_params"]["filter"]
        assert "requester_id = 12345" in filter_str
        assert "requestee_id = 67890" in filter_str
        assert "request_type = 'bunk_with'" in filter_str
        assert "year = 2025" in filter_str

    def test_clear_by_source_fields(self, repository, mock_pb_client):
        """Test clearing requests by source fields"""
        mock_client, mock_collection = mock_pb_client

        # Mock finding requests to delete
        mock_result = Mock()
        mock_result.items = [Mock(id="req1"), Mock(id="req2"), Mock(id="req3")]
        mock_collection.get_list.return_value = mock_result

        # Test clearing
        count = repository.clear_by_source_fields(12345, ["share_bunk_with", "internal_notes"], 2025)

        assert count == 3

        # Verify the query uses new field name
        args = mock_collection.get_list.call_args[1]
        filter_str = args["query_params"]["filter"]
        assert "requester_id = 12345" in filter_str
        assert "year = 2025" in filter_str
        assert "(source_field = 'share_bunk_with' || source_field = 'internal_notes')" in filter_str

        # Verify deletes were called
        assert mock_collection.delete.call_count == 3
        mock_collection.delete.assert_has_calls([call("req1"), call("req2"), call("req3")])

    def test_update_request(self, repository, mock_pb_client):
        """Test updating an existing request"""
        mock_client, mock_collection = mock_pb_client

        # Create a request with an ID (simulating it was loaded from DB)
        request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,  # Changed from 4
            confidence_score=0.85,  # Changed from 0.95
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.PENDING,  # Changed from RESOLVED
            is_placeholder=False,
            metadata={"resolution_method": "fuzzy_match", "updated": True},
        )
        # Add ID to simulate loaded record
        request.id = "abc123"  # type: ignore[attr-defined]

        # Mock successful update
        mock_collection.update.return_value = Mock()

        result = repository.update(request)

        assert result is True

        # Verify update was called with correct data
        # update() is called with positional args: update(record_id, data)
        mock_collection.update.assert_called_once()
        update_args = mock_collection.update.call_args
        assert update_args[0][0] == "abc123"  # ID
        update_data = update_args[0][1]
        assert update_data["priority"] == 3
        assert update_data["confidence_score"] == 0.85
        assert update_data["status"] == "pending"

    def test_json_metadata_handling(self, repository, mock_pb_client):
        """Test that metadata is properly serialized/deserialized"""
        mock_client, mock_collection = mock_pb_client

        # Test with complex metadata
        metadata = {
            "resolution_method": "fuzzy_match",
            "alternate_matches": [{"cm_id": 11111, "confidence": 0.75}, {"cm_id": 22222, "confidence": 0.70}],
            "ai_tokens_used": 245,
            "processed_at": "2025-01-15T10:30:00Z",
        }

        request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=4,
            confidence_score=0.95,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata=metadata,
        )

        mock_collection.create.return_value = Mock(id="abc123")

        repository.create(request)

        # Verify metadata was JSON serialized
        # create() is called with positional arg: create(data)
        create_args = mock_collection.create.call_args[0][0]
        assert isinstance(create_args["metadata"], str)

        # Verify it can be deserialized back
        import json

        deserialized = json.loads(create_args["metadata"])
        assert deserialized["resolution_method"] == "fuzzy_match"
        assert len(deserialized["alternate_matches"]) == 2


class TestClearAllForYear:
    """Test the clear_all_for_year functionality (test/reset mode).

    GAP (Parity Tracker Line 230): Monolith supports person_cm_ids=None to clear
    ALL requests for the year; modular only supports per-person clearing.

    This is needed for admin/testing scenarios where you want to reset the
    database state for a year.
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
        """Create a RequestRepository with mocked client"""
        mock_client, _ = mock_pb_client
        return RequestRepository(mock_client)

    def test_clear_all_for_year_deletes_all_requests(self, repository, mock_pb_client):
        """Verify clear_all_for_year deletes ALL requests for the specified year.

        - Fetches requests in batches (page 1 repeatedly as deletions happen)
        - Deletes each one
        - Returns total count deleted
        """
        mock_client, mock_collection = mock_pb_client

        # First call: returns 3 requests
        first_batch = Mock()
        first_batch.items = [Mock(id="req1", year=2025), Mock(id="req2", year=2025), Mock(id="req3", year=2025)]
        first_batch.total_items = 3

        # Second call: returns empty (all deleted)
        second_batch = Mock()
        second_batch.items = []
        second_batch.total_items = 0

        mock_collection.get_list.side_effect = [first_batch, second_batch]

        # Test clearing all for year
        count = repository.clear_all_for_year(2025)

        assert count == 3, f"Should delete all 3 requests, got {count}"

        # Verify delete was called for each request
        assert mock_collection.delete.call_count == 3
        mock_collection.delete.assert_any_call("req1")
        mock_collection.delete.assert_any_call("req2")
        mock_collection.delete.assert_any_call("req3")

    def test_clear_all_for_year_handles_multiple_batches(self, repository, mock_pb_client):
        """Verify clear_all_for_year handles pagination correctly.

        Should fetch page 1 repeatedly since deletions make new items "first".
        """
        mock_client, mock_collection = mock_pb_client

        # First batch: 2 requests
        batch1 = Mock()
        batch1.items = [Mock(id="req1", year=2025), Mock(id="req2", year=2025)]
        batch1.total_items = 5

        # Second batch: 2 more requests (after first 2 deleted)
        batch2 = Mock()
        batch2.items = [Mock(id="req3", year=2025), Mock(id="req4", year=2025)]
        batch2.total_items = 3

        # Third batch: 1 more request
        batch3 = Mock()
        batch3.items = [Mock(id="req5", year=2025)]
        batch3.total_items = 1

        # Fourth batch: empty
        batch4 = Mock()
        batch4.items = []
        batch4.total_items = 0

        mock_collection.get_list.side_effect = [batch1, batch2, batch3, batch4]

        count = repository.clear_all_for_year(2025)

        assert count == 5, f"Should delete all 5 requests across batches, got {count}"
        assert mock_collection.delete.call_count == 5

    def test_clear_all_for_year_filters_by_year(self, repository, mock_pb_client):
        """Verify clear_all_for_year only deletes requests for the specified year.

        Important: If the DB returns mixed years, we should only delete matching year.
        """
        mock_client, mock_collection = mock_pb_client

        batch = Mock()
        batch.items = [
            Mock(id="req1", year=2025),
            Mock(id="req2", year=2024),  # Different year - should NOT be deleted
            Mock(id="req3", year=2025),
        ]
        batch.total_items = 3

        empty_batch = Mock()
        empty_batch.items = []
        empty_batch.total_items = 0

        mock_collection.get_list.side_effect = [batch, empty_batch]

        count = repository.clear_all_for_year(2025)

        # Should only delete the 2025 requests
        assert count == 2, f"Should only delete year 2025 requests, got {count}"
        mock_collection.delete.assert_any_call("req1")
        mock_collection.delete.assert_any_call("req3")

        # Should NOT have deleted req2 (year 2024)
        delete_calls = [c[0][0] for c in mock_collection.delete.call_args_list]
        assert "req2" not in delete_calls, "Should not delete requests from other years"

    def test_clear_all_for_year_returns_zero_when_empty(self, repository, mock_pb_client):
        """Verify clear_all_for_year returns 0 when no requests exist for the year."""
        mock_client, mock_collection = mock_pb_client

        empty_batch = Mock()
        empty_batch.items = []
        empty_batch.total_items = 0

        mock_collection.get_list.return_value = empty_batch

        count = repository.clear_all_for_year(2025)

        assert count == 0
        assert mock_collection.delete.call_count == 0

    def test_clear_all_for_year_with_verification(self, repository, mock_pb_client):
        """Verify clear_all_for_year can verify the clearing succeeded.

        is empty for that year and logs warning if not.
        """
        mock_client, mock_collection = mock_pb_client

        # First call: batch to delete
        batch = Mock()
        batch.items = [Mock(id="req1", year=2025)]
        batch.total_items = 1

        # Second call: empty (done deleting)
        empty_after_delete = Mock()
        empty_after_delete.items = []
        empty_after_delete.total_items = 0

        # Third call: verification query returns empty (success)
        verification = Mock()
        verification.total_items = 0

        mock_collection.get_list.side_effect = [batch, empty_after_delete, verification]

        count, verified = repository.clear_all_for_year(2025, verify=True)

        assert count == 1
        assert verified is True, "Should verify clearing succeeded"

    def test_clear_all_for_year_verification_detects_remaining(self, repository, mock_pb_client):
        """Verify clear_all_for_year reports when verification finds remaining records."""
        mock_client, mock_collection = mock_pb_client

        # First call: batch to delete
        batch = Mock()
        batch.items = [Mock(id="req1", year=2025)]
        batch.total_items = 1

        # Second call: empty (done with main loop)
        empty_after_delete = Mock()
        empty_after_delete.items = []
        empty_after_delete.total_items = 0

        # Third call: verification finds remaining records (deletion failed somehow)
        verification = Mock()
        verification.total_items = 2  # Still have records!

        mock_collection.get_list.side_effect = [batch, empty_after_delete, verification]

        count, verified = repository.clear_all_for_year(2025, verify=True)

        assert count == 1
        assert verified is False, "Should report verification failed when records remain"


class TestClearBySourceFieldsPagination:
    """Test pagination in clear_by_source_fields (BUG FIX).

    The current implementation only fetches page 1 (max 1000 records) and never
    paginates. This causes silent data loss when clearing >1000 records per person.

    Issue: request_repository.py:139-141 - only fetches first page.
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
        """Create a RequestRepository with mocked client"""
        mock_client, _ = mock_pb_client
        return RequestRepository(mock_client)

    def test_clear_by_source_fields_paginates_when_more_than_page_size(
        self, repository, mock_pb_client
    ):
        """FAILING TEST: Verify clear_by_source_fields handles >1000 records.

        This test should FAIL with the current implementation because it only
        fetches page 1 and never checks for more pages.
        """
        mock_client, mock_collection = mock_pb_client

        # Simulate 1500 records - more than one page (assuming page size of 500-1000)
        # First page: 500 records
        page1_items = [Mock(id=f"req_{i}") for i in range(500)]
        page1_result = Mock()
        page1_result.items = page1_items
        page1_result.total_items = 1500

        # Second page: 500 more records
        page2_items = [Mock(id=f"req_{i}") for i in range(500, 1000)]
        page2_result = Mock()
        page2_result.items = page2_items
        page2_result.total_items = 1500

        # Third page: 500 more records
        page3_items = [Mock(id=f"req_{i}") for i in range(1000, 1500)]
        page3_result = Mock()
        page3_result.items = page3_items
        page3_result.total_items = 1500

        # Fourth page: empty (done)
        page4_result = Mock()
        page4_result.items = []
        page4_result.total_items = 1500

        mock_collection.get_list.side_effect = [
            page1_result,
            page2_result,
            page3_result,
            page4_result,
        ]

        # Test clearing - should delete ALL 1500 records
        count = repository.clear_by_source_fields(
            requester_cm_id=12345,
            source_fields=["share_bunk_with"],
            year=2025,
        )

        # This assertion should FAIL with current buggy implementation
        # Current implementation only deletes first 500-1000 records
        assert count == 1500, f"Should delete all 1500 records, but only deleted {count}"

        # Verify all records were actually deleted
        assert mock_collection.delete.call_count == 1500, (
            f"Should have called delete 1500 times, "
            f"but only called {mock_collection.delete.call_count} times"
        )

    def test_clear_by_source_fields_single_page_still_works(
        self, repository, mock_pb_client
    ):
        """Verify single page (< page_size records) still works correctly.

        This should pass with both old and new implementation.
        """
        mock_client, mock_collection = mock_pb_client

        # Only 50 records - fits in one page
        page1_items = [Mock(id=f"req_{i}") for i in range(50)]
        page1_result = Mock()
        page1_result.items = page1_items
        page1_result.total_items = 50

        mock_collection.get_list.return_value = page1_result

        count = repository.clear_by_source_fields(
            requester_cm_id=12345,
            source_fields=["share_bunk_with"],
            year=2025,
        )

        assert count == 50
        assert mock_collection.delete.call_count == 50

    def test_clear_by_source_fields_handles_exactly_page_size(
        self, repository, mock_pb_client
    ):
        """Verify exact page size boundary is handled correctly.

        Edge case: exactly 500 (or 1000) records should work without pagination.
        """
        mock_client, mock_collection = mock_pb_client

        # Exactly 500 records (typical page size)
        page1_items = [Mock(id=f"req_{i}") for i in range(500)]
        page1_result = Mock()
        page1_result.items = page1_items
        page1_result.total_items = 500

        # Second page: empty (confirms no more records)
        page2_result = Mock()
        page2_result.items = []
        page2_result.total_items = 500

        mock_collection.get_list.side_effect = [page1_result, page2_result]

        count = repository.clear_by_source_fields(
            requester_cm_id=12345,
            source_fields=["share_bunk_with"],
            year=2025,
        )

        assert count == 500
        assert mock_collection.delete.call_count == 500

    def test_clear_by_source_fields_with_session_filter_paginates(
        self, repository, mock_pb_client
    ):
        """Verify pagination works with session filter applied.

        The session filter shouldn't break pagination behavior.
        """
        mock_client, mock_collection = mock_pb_client

        # 600 records across 2 pages
        page1_items = [Mock(id=f"req_{i}") for i in range(500)]
        page1_result = Mock()
        page1_result.items = page1_items
        page1_result.total_items = 600

        page2_items = [Mock(id=f"req_{i}") for i in range(500, 600)]
        page2_result = Mock()
        page2_result.items = page2_items
        page2_result.total_items = 600

        page3_result = Mock()
        page3_result.items = []
        page3_result.total_items = 600

        mock_collection.get_list.side_effect = [page1_result, page2_result, page3_result]

        count = repository.clear_by_source_fields(
            requester_cm_id=12345,
            source_fields=["share_bunk_with"],
            year=2025,
            session_cm_ids=[1000002, 1000003],  # Multiple sessions
        )

        # Should delete ALL 600 records even with session filter
        assert count == 600, f"Should delete all 600 records, but only deleted {count}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
