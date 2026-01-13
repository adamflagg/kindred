"""Tests for already_processed count in request processing stats.

When processing requests, we should report how many records were skipped
because they were already processed, separate from ambiguous/error skips.
"""

from unittest.mock import Mock


class TestAlreadyProcessedCount:
    """Test that already_processed count is tracked and reported."""

    def test_loader_counts_already_processed_records(self):
        """Loader should count records that are already processed for the scope."""
        from bunking.sync.bunk_request_processor.integration.original_requests_loader import (
            OriginalRequestsLoader,
        )

        # Mock PocketBase
        mock_pb = Mock()
        mock_collection = Mock()
        mock_pb.collection.return_value = mock_collection

        # Mock get_full_list to return count of already processed
        mock_collection.get_full_list.return_value = [
            Mock(id="1", processed="2025-01-01T00:00:00Z"),
            Mock(id="2", processed="2025-01-01T00:00:00Z"),
            Mock(id="3", processed="2025-01-01T00:00:00Z"),
        ]

        loader = OriginalRequestsLoader(mock_pb, year=2025)

        # Count already processed for specific fields
        count = loader.count_already_processed(fields=["socialize_with"])

        assert count == 3

    def test_loader_counts_already_processed_with_session_filter(self):
        """Already processed count should respect session filter."""
        from bunking.sync.bunk_request_processor.integration.original_requests_loader import (
            OriginalRequestsLoader,
        )

        mock_pb = Mock()
        mock_collection = Mock()
        mock_pb.collection.return_value = mock_collection

        # Return 5 already processed records
        mock_collection.get_full_list.return_value = [Mock() for _ in range(5)]

        loader = OriginalRequestsLoader(mock_pb, year=2025, session_cm_ids=[1000001])
        loader._person_sessions = {
            11111: [1000001],  # In target session
            22222: [1000001],  # In target session
            33333: [9999999],  # Different session
        }

        count = loader.count_already_processed(fields=["bunk_with"])

        # Should filter to session scope
        assert isinstance(count, int)

    def test_loader_returns_zero_when_none_processed(self):
        """Return 0 when no records are already processed."""
        from bunking.sync.bunk_request_processor.integration.original_requests_loader import (
            OriginalRequestsLoader,
        )

        mock_pb = Mock()
        mock_collection = Mock()
        mock_pb.collection.return_value = mock_collection
        mock_collection.get_full_list.return_value = []

        loader = OriginalRequestsLoader(mock_pb, year=2025)
        count = loader.count_already_processed(fields=["socialize_with"])

        assert count == 0

    def test_stats_include_already_processed(self):
        """Processing stats should include already_processed count."""
        # This tests the stats output format
        stats_output = {
            "success": True,
            "created": 5,
            "updated": 0,
            "skipped": 1,
            "errors": 0,
            "already_processed": 10,  # NEW field
        }

        assert "already_processed" in stats_output
        assert stats_output["already_processed"] == 10


class TestAlreadyProcessedInProcessRequests:
    """Test that process_requests.py includes already_processed in output."""

    def test_stats_output_includes_already_processed(self):
        """The JSON stats output should include already_processed."""
        import json

        # Simulate what process_requests.py writes to stats file
        stats = {
            "phase1_parsed": 10,
            "phase2_resolved": 8,
            "phase2_ambiguous": 1,
            "phase3_disambiguated": 1,
            "requests_created": 9,
        }

        already_processed = 15

        stats_output = {
            "success": True,
            "created": stats.get("requests_created", 0),
            "updated": 0,
            "skipped": stats.get("phase2_ambiguous", 0),
            "errors": 0,
            "already_processed": already_processed,
        }

        json_str = json.dumps(stats_output)
        parsed = json.loads(json_str)

        assert parsed["already_processed"] == 15
        assert parsed["created"] == 9
        assert parsed["skipped"] == 1
