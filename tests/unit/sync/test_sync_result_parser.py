from __future__ import annotations

#!/usr/bin/env python3
"""Tests for sync result parser."""

import pytest

from bunking.sync.sync_result_parser import SyncResult, SyncResultParser


class TestSyncResultParser:
    """Test sync result parsing functionality."""

    def test_parse_successful_sync_with_changes(self):
        """Test parsing a successful sync with created and updated records."""
        log_output = """
────────────────────────────────────────────────────────────
2025-01-09 13:01:59,004 - INFO - STARTING FRESH SESSIONS SYNC
────────────────────────────────────────────────────────────
2025-01-09 13:01:59,005 - INFO - Fetching sessions from CampMinder...
2025-01-09 13:01:59,183 - INFO - STARTING FRESH: Processing all 55 items
2025-01-09 13:01:59,195 - INFO - Progress: 10/55 items processed
2025-01-09 13:01:59,206 - INFO - Progress: 20/55 items processed
2025-01-09 13:01:59,216 - INFO - Progress: 30/55 items processed
2025-01-09 13:01:59,227 - INFO - Progress: 40/55 items processed
2025-01-09 13:01:59,237 - INFO - Progress: 50/55 items processed
2025-01-09 13:01:59,243 - INFO - Processing complete: 55 items in 0.1s (915.6 items/sec)
2025-01-09 13:01:59,243 - INFO - 
────────────────────────────────────────────────────────────
2025-01-09 13:01:59,243 - INFO - SESSIONS SYNC COMPLETE
2025-01-09 13:01:59,243 - INFO - Created: 3
2025-01-09 13:01:59,243 - INFO - Updated: 7
2025-01-09 13:01:59,243 - INFO - Skipped: 45
2025-01-09 13:01:59,243 - INFO - Errors:  0
2025-01-09 13:01:59,243 - INFO - ────────────────────────────────────────────────────────────
"""
        parser = SyncResultParser()
        result = parser.parse(log_output)

        assert result.status == "success"
        assert result.created == 3
        assert result.updated == 7
        assert result.skipped == 45
        assert result.errors == 0
        assert result.duration_seconds == pytest.approx(0.239, rel=0.01)
        assert result.message == "Sync completed successfully"

    def test_parse_successful_sync_no_changes(self):
        """Test parsing a successful sync with no changes."""
        log_output = """
────────────────────────────────────────────────────────────
2025-01-09 13:01:59,004 - INFO - STARTING FRESH SESSIONS SYNC
────────────────────────────────────────────────────────────
2025-01-09 13:01:59,005 - INFO - Fetching sessions from CampMinder...
2025-01-09 13:01:59,243 - INFO - Processing complete: 55 items in 0.1s (915.6 items/sec)
2025-01-09 13:01:59,243 - INFO - 
────────────────────────────────────────────────────────────
2025-01-09 13:01:59,243 - INFO - SESSIONS SYNC COMPLETE
2025-01-09 13:01:59,243 - INFO - Created: 0
2025-01-09 13:01:59,243 - INFO - Updated: 0
2025-01-09 13:01:59,243 - INFO - Skipped: 55
2025-01-09 13:01:59,243 - INFO - Errors:  0
2025-01-09 13:01:59,243 - INFO - ────────────────────────────────────────────────────────────
"""
        parser = SyncResultParser()
        result = parser.parse(log_output)

        assert result.status == "success"
        assert result.created == 0
        assert result.updated == 0
        assert result.skipped == 55
        assert result.errors == 0

    def test_parse_sync_with_errors(self):
        """Test parsing a sync with errors."""
        log_output = """
2025-01-09 13:01:59,004 - INFO - STARTING FRESH SESSIONS SYNC
2025-01-09 13:01:59,243 - ERROR - Failed to sync session 123: Connection timeout
2025-01-09 13:01:59,243 - INFO - SESSIONS SYNC COMPLETE
2025-01-09 13:01:59,243 - INFO - Created: 10
2025-01-09 13:01:59,243 - INFO - Updated: 5
2025-01-09 13:01:59,243 - INFO - Skipped: 20
2025-01-09 13:01:59,243 - INFO - Errors:  2
"""
        parser = SyncResultParser()
        result = parser.parse(log_output)

        assert result.status == "failed"
        assert result.created == 10
        assert result.updated == 5
        assert result.skipped == 20
        assert result.errors == 2
        assert "errors occurred" in result.message

    def test_parse_incomplete_sync(self):
        """Test parsing an incomplete sync that was interrupted."""
        log_output = """
2025-01-09 13:01:59,004 - INFO - STARTING FRESH SESSIONS SYNC
2025-01-09 13:01:59,005 - INFO - Fetching sessions from CampMinder...
2025-01-09 13:01:59,183 - INFO - STARTING FRESH: Processing all 55 items
2025-01-09 13:01:59,195 - INFO - Progress: 10/55 items processed
2025-01-09 13:01:59,206 - ERROR - Critical error: Database connection lost
"""
        parser = SyncResultParser()
        result = parser.parse(log_output)

        assert result.status == "failed"
        assert result.created == 0
        assert result.updated == 0
        assert result.skipped == 0
        assert result.errors == 1
        assert "Critical error" in result.message or "incomplete" in result.message

    def test_parse_attendees_sync(self):
        """Test parsing attendees sync with specific format."""
        log_output = """
2025-01-09 20:08:00,000 - INFO - STARTING ATTENDEES SYNC
2025-01-09 20:08:00,500 - INFO - Processing 1500 attendees...
2025-01-09 20:08:05,000 - INFO - ATTENDEES SYNC COMPLETE
2025-01-09 20:08:05,000 - INFO - Created: 150
2025-01-09 20:08:05,000 - INFO - Updated: 300
2025-01-09 20:08:05,000 - INFO - Skipped: 1050
2025-01-09 20:08:05,000 - INFO - Errors:  0
"""
        parser = SyncResultParser()
        result = parser.parse(log_output)

        assert result.status == "success"
        assert result.created == 150
        assert result.updated == 300
        assert result.skipped == 1050
        assert result.errors == 0
        assert result.duration_seconds == pytest.approx(5.0, rel=0.01)

    def test_parse_bunk_requests_sync(self):
        """Test parsing bunk requests sync with AI processing info."""
        log_output = """
2025-01-09 21:00:00,000 - INFO - STARTING BUNK REQUESTS SYNC
2025-01-09 21:00:00,100 - INFO - Processing CSV file...
2025-01-09 21:00:00,200 - INFO - Using AI to parse 50 requests
2025-01-09 21:00:03,000 - INFO - AI processing complete
2025-01-09 21:00:03,100 - INFO - BUNK REQUESTS SYNC COMPLETE
2025-01-09 21:00:03,100 - INFO - Created: 45
2025-01-09 21:00:03,100 - INFO - Updated: 5
2025-01-09 21:00:03,100 - INFO - Skipped: 0
2025-01-09 21:00:03,100 - INFO - Errors:  0
"""
        parser = SyncResultParser()
        result = parser.parse(log_output)

        assert result.status == "success"
        assert result.created == 45
        assert result.updated == 5
        assert result.duration_seconds == pytest.approx(3.1, rel=0.01)

    def test_parse_with_alternate_formats(self):
        """Test parsing with alternate log formats."""
        # Format with lowercase
        log_output = """
2025-01-09 21:00:00,000 - INFO - sync complete
2025-01-09 21:00:00,000 - INFO - created: 10
2025-01-09 21:00:00,000 - INFO - updated: 20
2025-01-09 21:00:00,000 - INFO - skipped: 30
2025-01-09 21:00:00,000 - INFO - errors: 0
"""
        parser = SyncResultParser()
        result = parser.parse(log_output)

        assert result.created == 10
        assert result.updated == 20
        assert result.skipped == 30
        assert result.errors == 0

    def test_parse_duration_calculation(self):
        """Test duration calculation from timestamps."""
        log_output = """
2025-01-09 13:01:59,004 - INFO - STARTING SYNC
2025-01-09 13:02:14,567 - INFO - SYNC COMPLETE
2025-01-09 13:02:14,567 - INFO - Created: 5
2025-01-09 13:02:14,567 - INFO - Updated: 10
2025-01-09 13:02:14,567 - INFO - Skipped: 15
2025-01-09 13:02:14,567 - INFO - Errors:  0
"""
        parser = SyncResultParser()
        result = parser.parse(log_output)

        # Should be approximately 15.563 seconds
        assert result.duration_seconds == pytest.approx(15.563, rel=0.01)

    def test_to_dict(self):
        """Test conversion to dictionary for JSON storage."""
        result = SyncResult(
            status="success",
            created=10,
            updated=20,
            skipped=30,
            errors=0,
            duration_seconds=5.5,
            message="Test complete",
        )

        result_dict = result.to_dict()

        assert result_dict == {
            "status": "success",
            "created": 10,
            "updated": 20,
            "skipped": 30,
            "locked": 0,
            "orphaned": 0,
            "errors": 0,
            "duration_seconds": 5.5,
            "message": "Test complete",
        }

    def test_empty_log_output(self):
        """Test parsing empty log output."""
        parser = SyncResultParser()
        result = parser.parse("")

        assert result.status == "failed"
        assert result.message == "No sync output to parse"
        assert result.created == 0
        assert result.updated == 0
        assert result.skipped == 0
        assert result.errors == 0
