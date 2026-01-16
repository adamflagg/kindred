"""Test-Driven Development for Cross-Run Deduplication

Tests the deduplicator's ability to detect and handle duplicates that exist
across different processing runs (not just within a single batch).

Problem: When a camper updates their bunk request form, only modified source
fields are reprocessed. But if Field B (updated) produces the same target as
Field A (already processed), we need to merge rather than create a duplicate.

Solution: Deduplicator checks database for existing matches and flags them
for merge handling by the orchestrator.
"""

import sys
from pathlib import Path
from unittest.mock import Mock

import pytest

test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import (
    BunkRequest,
    RequestSource,
    RequestStatus,
    RequestType,
)
from bunking.sync.bunk_request_processor.processing.deduplicator import (
    Deduplicator,
)


class TestCrossRunDeduplication:
    """Test cross-run deduplication when Field B matches existing Field A request."""

    @pytest.fixture
    def mock_request_repo(self):
        """Create a mock request repository"""
        return Mock()

    @pytest.fixture
    def deduplicator(self, mock_request_repo):
        """Create a Deduplicator with mocked dependencies"""
        return Deduplicator(mock_request_repo)

    def _create_request(
        self,
        requester_cm_id=12345,
        requested_cm_id=67890,
        request_type=RequestType.BUNK_WITH,
        session_cm_id=1000002,
        source_field="share_bunk_with",
        source=RequestSource.FAMILY,
        confidence_score=0.95,
        year=2025,
    ):
        """Helper to create a BunkRequest."""
        return BunkRequest(
            requester_cm_id=requester_cm_id,
            requested_cm_id=requested_cm_id,
            request_type=request_type,
            session_cm_id=session_cm_id,
            priority=3,
            confidence_score=confidence_score,
            source=source,
            source_field=source_field,
            csv_position=0,
            year=year,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

    def test_database_match_flagged_for_merge(self, deduplicator, mock_request_repo):
        """Test that matching database record is flagged for merge.

        Scenario:
        - Field A (share_bunk_with) already processed → request exists in DB
        - Field B (bunking_notes) now processed → same requester→target
        - Result: New request flagged with database_match_id for merge
        """
        # Existing request in database (from Field A, processed earlier)
        existing = Mock()
        existing.id = "existing_from_field_a"
        existing.source_field = "share_bunk_with"
        existing.metadata = {"original_text": "Sarah Johnson"}
        mock_request_repo.find_existing.return_value = existing

        # New request from Field B
        new_request = self._create_request(
            source_field="bunking_notes",
            source=RequestSource.STAFF,
            confidence_score=0.88,
        )

        result = deduplicator.deduplicate_batch([new_request], check_database=True)

        assert len(result.kept_requests) == 1
        kept = result.kept_requests[0]

        # Should be flagged for merge handling
        assert kept.metadata.get("has_database_duplicate") is True
        assert kept.metadata.get("database_duplicate_id") == "existing_from_field_a"

    def test_database_match_action_set_to_merge(self, deduplicator, mock_request_repo):
        """Test that database match action is explicitly set for orchestrator.

        The orchestrator needs to know whether to merge or update.
        """
        existing = Mock()
        existing.id = "existing_record"
        mock_request_repo.find_existing.return_value = existing

        new_request = self._create_request(source_field="bunking_notes")

        result = deduplicator.deduplicate_batch([new_request], check_database=True)

        kept = result.kept_requests[0]
        assert kept.metadata.get("database_match_action") == "merge"

    def test_no_database_match_not_flagged(self, deduplicator, mock_request_repo):
        """Test that requests without database matches are not flagged."""
        mock_request_repo.find_existing.return_value = None

        new_request = self._create_request()

        result = deduplicator.deduplicate_batch([new_request], check_database=True)

        kept = result.kept_requests[0]
        assert "has_database_duplicate" not in kept.metadata
        assert "database_match_id" not in kept.metadata
        assert "database_match_action" not in kept.metadata

    def test_placeholder_requests_skip_database_check(self, deduplicator, mock_request_repo):
        """Test that placeholder requests don't check database.

        Placeholders are unique (unresolved names) and shouldn't merge.
        """
        placeholder = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=-1000000,  # Negative ID = unresolved
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.5,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.PENDING,
            is_placeholder=True,  # This is a placeholder
            metadata={},
        )

        deduplicator.deduplicate_batch([placeholder], check_database=True)

        # find_existing should NOT be called for placeholders
        mock_request_repo.find_existing.assert_not_called()

    def test_batch_dedup_happens_before_database_check(self, deduplicator, mock_request_repo):
        """Test that in-batch deduplication happens before database check.

        If batch has 2 duplicates and 1 exists in DB, we should:
        1. First dedupe the batch (keep 1)
        2. Then check that 1 against database
        """
        mock_request_repo.find_existing.return_value = None

        # Two identical requests in same batch
        req1 = self._create_request(source_field="share_bunk_with")
        req2 = self._create_request(source_field="bunking_notes")

        result = deduplicator.deduplicate_batch([req1, req2], check_database=True)

        # Batch dedup: 2 → 1
        assert len(result.kept_requests) == 1
        assert result.statistics["duplicates_removed"] == 1

        # Database check only called once (for the kept request)
        assert mock_request_repo.find_existing.call_count == 1

    def test_cross_run_merge_preserves_source_field_info(self, deduplicator, mock_request_repo):
        """Test that merge metadata includes source field for tracking.

        When merging, we need to preserve info about which source fields
        contributed to this request for partial invalidation.
        """
        existing = Mock()
        existing.id = "existing_record"
        existing.source_field = "share_bunk_with"
        mock_request_repo.find_existing.return_value = existing

        new_request = self._create_request(source_field="bunking_notes")

        result = deduplicator.deduplicate_batch([new_request], check_database=True)

        kept = result.kept_requests[0]
        # New request's source_field is preserved
        assert kept.source_field == "bunking_notes"
        # Existing request's ID is available for merge
        assert kept.metadata["database_duplicate_id"] == "existing_record"


class TestCrossRunAgePreferenceDeduplication:
    """Test cross-run deduplication for age_preference requests.

    Age preferences are special because they have no target (requestee_id=None)
    but still need cross-run deduplication when the same requester has
    age_preference from different sources.
    """

    @pytest.fixture
    def mock_request_repo(self):
        """Create a mock request repository"""
        return Mock()

    @pytest.fixture
    def deduplicator(self, mock_request_repo):
        """Create a Deduplicator with mocked dependencies"""
        return Deduplicator(mock_request_repo)

    def test_age_preference_cross_run_merge(self, deduplicator, mock_request_repo):
        """Test age_preference from Field B merges with existing Field A.

        Scenario:
        - ret_parent_socialize_with_best dropdown already processed
        - bunking_notes now mentions "prefers older kids"
        - Should merge, not create duplicate
        """
        existing = Mock()
        existing.id = "existing_age_pref"
        mock_request_repo.find_existing.return_value = existing

        new_request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=None,  # No target for age_preference
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=0.85,
            source=RequestSource.STAFF,
            source_field="bunking_notes",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"age_preference": "older"},
        )

        result = deduplicator.deduplicate_batch([new_request], check_database=True)

        kept = result.kept_requests[0]
        assert kept.metadata.get("has_database_duplicate") is True
        assert kept.metadata.get("database_duplicate_id") == "existing_age_pref"


class TestCrossRunDeduplicationStatistics:
    """Test statistics tracking for cross-run deduplication."""

    @pytest.fixture
    def mock_request_repo(self):
        """Create a mock request repository"""
        return Mock()

    @pytest.fixture
    def deduplicator(self, mock_request_repo):
        """Create a Deduplicator with mocked dependencies"""
        return Deduplicator(mock_request_repo)

    def test_statistics_track_cross_run_merges(self, deduplicator, mock_request_repo):
        """Test that statistics differentiate cross-run from in-batch duplicates."""
        # 2 requests: one matches database, one doesn't
        existing = Mock()
        existing.id = "existing_record"

        # First call returns match, second returns None
        mock_request_repo.find_existing.side_effect = [existing, None]

        req1 = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.95,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        req2 = BunkRequest(
            requester_cm_id=11111,  # Different requester
            requested_cm_id=22222,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.90,
            source=RequestSource.STAFF,
            source_field="bunking_notes",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        result = deduplicator.deduplicate_batch([req1, req2], check_database=True)

        # Both kept (no in-batch duplicates)
        assert len(result.kept_requests) == 2
        # One database duplicate detected
        assert result.statistics["database_duplicates"] == 1


class TestLockedRequestHandling:
    """Test handling of locked requests in cross-run deduplication.

    Locked requests (request_locked=True) indicate staff has validated/edited
    the request. These need special handling:
    - If source changes, we shouldn't auto-delete the locked request
    - Should flag for manual review instead
    """

    @pytest.fixture
    def mock_request_repo(self):
        """Create a mock request repository"""
        return Mock()

    @pytest.fixture
    def deduplicator(self, mock_request_repo):
        """Create a Deduplicator with mocked dependencies"""
        return Deduplicator(mock_request_repo)

    def test_database_match_includes_locked_status(self, deduplicator, mock_request_repo):
        """Test that database match metadata includes locked status.

        The orchestrator needs to know if the existing request is locked
        to decide whether to merge or flag for review.
        """
        existing = Mock()
        existing.id = "existing_locked"
        existing.request_locked = True
        mock_request_repo.find_existing.return_value = existing

        new_request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.95,
            source=RequestSource.STAFF,
            source_field="bunking_notes",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        result = deduplicator.deduplicate_batch([new_request], check_database=True)

        kept = result.kept_requests[0]
        # Should include locked status for orchestrator decision
        assert kept.metadata.get("database_match_locked") is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
