"""Test-Driven Development for Deduplicator

Tests the deduplication of bunk requests based on source priority."""

import sys
from pathlib import Path
from unittest.mock import Mock

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
from bunking.sync.bunk_request_processor.processing.deduplicator import (
    Deduplicator,
)


class TestDeduplicator:
    """Test the Deduplicator"""

    @pytest.fixture
    def mock_request_repo(self):
        """Create a mock request repository"""
        return Mock()

    @pytest.fixture
    def deduplicator(self, mock_request_repo):
        """Create a Deduplicator with mocked dependencies"""
        return Deduplicator(mock_request_repo)

    @pytest.fixture
    def base_request(self):
        """Create a base request for modification in tests"""
        return BunkRequest(
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

    def test_no_duplicates_single_request(self, deduplicator, base_request):
        """Test that single request has no duplicates"""
        requests = [base_request]
        result = deduplicator.deduplicate_batch(requests)

        assert len(result.kept_requests) == 1
        assert result.kept_requests[0] == base_request
        assert len(result.duplicate_groups) == 0
        assert result.statistics["total_requests"] == 1
        assert result.statistics["unique_requests"] == 1
        assert result.statistics["duplicates_removed"] == 0

    def test_cross_source_bunk_with_requests_are_deduplicated(self, deduplicator, base_request):
        """Test that bunk_with requests from different sources ARE deduplicated.

        Changed behavior (2025-01): Cross-source deduplication now occurs for
        most fields (share_bunk_with, bunking_notes, internal_notes, do_not_share_with).
        This matches the DB unique constraint which does NOT include source_field.

        Exception: socialize_with field is never deduplicated (see separate test).
        """
        # Create request from notes source (different source, same requester→target)
        notes_request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=1,
            confidence_score=0.80,
            source=RequestSource.STAFF,
            source_field="bunking_notes",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        requests = [base_request, notes_request]
        result = deduplicator.deduplicate_batch(requests)

        # Now deduplicated - only highest confidence kept
        assert len(result.kept_requests) == 1
        assert result.kept_requests[0].confidence_score == 0.95  # Higher confidence wins
        assert len(result.duplicate_groups) == 1
        assert result.statistics["duplicates_removed"] == 1

    def test_same_source_dedup_by_confidence(self, deduplicator):
        """Test that same-source duplicates are deduplicated by confidence.

        When multiple requests come from the same source (e.g., mentioned twice
        in bunking_notes), they should deduplicate with highest confidence winning.
        """
        # Same source, different confidence
        high_conf = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=200,
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
            metadata={"version": "high"},
        )
        low_conf = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=200,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.75,
            source=RequestSource.FAMILY,  # Same source!
            source_field="share_bunk_with",
            csv_position=1,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"version": "low"},
        )

        result = deduplicator.deduplicate_batch([low_conf, high_conf])

        assert len(result.kept_requests) == 1
        assert result.kept_requests[0].confidence_score == 0.95
        assert result.kept_requests[0].metadata["version"] == "high"
        assert result.statistics["duplicates_removed"] == 1

    def test_different_request_types_not_duplicates(self, deduplicator):
        """Test that different request types are not considered duplicates"""
        bunk_with = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=200,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.90,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        not_bunk_with = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=200,
            request_type=RequestType.NOT_BUNK_WITH,
            session_cm_id=1000002,
            priority=4,
            confidence_score=0.95,
            source=RequestSource.STAFF,
            source_field="do_not_share_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        requests = [bunk_with, not_bunk_with]
        result = deduplicator.deduplicate_batch(requests)

        assert len(result.kept_requests) == 2
        assert len(result.duplicate_groups) == 0

    def test_database_duplicates_check(self, deduplicator, base_request, mock_request_repo):
        """Test checking for duplicates in database"""
        # Mock existing request in database - use Mock object with id attribute
        # (find_existing returns BunkRequest, not dict)
        existing_mock = Mock()
        existing_mock.id = "existing_123"
        existing_mock.requester_cm_id = 12345
        existing_mock.requested_cm_id = 67890
        existing_mock.request_type = "bunk_with"
        existing_mock.session_cm_id = 1000002
        mock_request_repo.find_existing.return_value = existing_mock

        requests = [base_request]
        result = deduplicator.deduplicate_batch(requests, check_database=True)

        # Should still be kept but marked as database duplicate
        assert len(result.kept_requests) == 1
        assert result.kept_requests[0].metadata["has_database_duplicate"] is True
        assert result.kept_requests[0].metadata["database_duplicate_id"] == "existing_123"
        assert result.statistics["database_duplicates"] == 1

    def test_merge_metadata(self, deduplicator, base_request):
        """Test that metadata is merged from same-source duplicates"""
        base_request.metadata = {"field1": "value1", "shared": "base"}

        # Same source as base_request (FAMILY) - these WILL deduplicate
        duplicate = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=2,
            confidence_score=0.85,
            source=RequestSource.FAMILY,  # Same source!
            source_field="share_bunk_with",
            csv_position=1,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"field2": "value2", "shared": "duplicate"},
        )

        requests = [base_request, duplicate]
        result = deduplicator.deduplicate_batch(requests)

        assert len(result.kept_requests) == 1
        kept = result.kept_requests[0]
        # Should have merged metadata
        assert kept.metadata["field1"] == "value1"
        assert kept.metadata["field2"] == "value2"
        assert kept.metadata["shared"] == "base"  # Primary wins
        assert kept.metadata["duplicate_sources"] == ["family"]

    def test_multiple_duplicate_groups(self, deduplicator):
        """Test handling multiple separate duplicate groups (same source)"""
        # Group 1 - same requester/target, same source (FAMILY)
        req1a = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=200,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.90,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )
        req1b = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=200,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=1,
            confidence_score=0.80,
            source=RequestSource.FAMILY,  # Same source!
            source_field="share_bunk_with",
            csv_position=1,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        # Group 2 - different requester/target, same source (STAFF)
        req2a = BunkRequest(
            requester_cm_id=300,
            requested_cm_id=400,
            request_type=RequestType.NOT_BUNK_WITH,
            session_cm_id=1000002,
            priority=4,
            confidence_score=0.95,
            source=RequestSource.STAFF,
            source_field="do_not_share_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )
        req2b = BunkRequest(
            requester_cm_id=300,
            requested_cm_id=400,
            request_type=RequestType.NOT_BUNK_WITH,
            session_cm_id=1000002,
            priority=2,
            confidence_score=0.85,
            source=RequestSource.STAFF,  # Same source!
            source_field="do_not_share_with",
            csv_position=1,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        requests = [req1a, req1b, req2a, req2b]
        result = deduplicator.deduplicate_batch(requests)

        assert len(result.kept_requests) == 2
        assert len(result.duplicate_groups) == 2
        assert result.statistics["duplicates_removed"] == 2

    def test_preserve_highest_confidence(self, deduplicator):
        """Test that highest confidence is preserved when merging same-source duplicates"""
        # Both from same source - will deduplicate
        high_conf = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=200,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=1,
            confidence_score=0.99,  # Higher confidence
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=1,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        low_conf = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=200,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.70,  # Lower confidence
            source=RequestSource.FAMILY,  # Same source!
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        # high_conf has higher confidence, so it should be primary
        requests = [low_conf, high_conf]
        result = deduplicator.deduplicate_batch(requests)

        assert len(result.kept_requests) == 1
        kept = result.kept_requests[0]
        assert kept.confidence_score == 0.99  # Highest confidence wins
        assert result.statistics["duplicates_removed"] == 1

    def test_find_existing_called_with_correct_parameters(self, deduplicator, base_request, mock_request_repo):
        """Test that find_existing is called with year and session_cm_id.

        Bug fix: Deduplicator was passing session_cm_id to wrong parameter.
        find_existing() needs both year AND session_cm_id for proper filtering.
        """
        mock_request_repo.find_existing.return_value = None

        requests = [base_request]
        deduplicator.deduplicate_batch(requests, check_database=True)

        # Verify find_existing was called with correct parameters
        mock_request_repo.find_existing.assert_called_once()
        call_kwargs = mock_request_repo.find_existing.call_args.kwargs

        # Collect all failures to see full picture
        errors = []

        # Must have all required parameters
        if call_kwargs.get("requester_cm_id") != 12345:
            errors.append(f"requester_cm_id: expected 12345, got {call_kwargs.get('requester_cm_id')}")
        if call_kwargs.get("requested_cm_id") != 67890:
            errors.append(f"requested_cm_id: expected 67890, got {call_kwargs.get('requested_cm_id')}")
        # request_type should be passed as string value, not enum
        if call_kwargs.get("request_type") != "bunk_with":
            errors.append(
                f"request_type: expected 'bunk_with' (str), got {call_kwargs.get('request_type')} ({type(call_kwargs.get('request_type')).__name__})"
            )
        # CRITICAL: Both year AND session_cm_id must be passed
        if call_kwargs.get("year") != 2025:
            errors.append(f"year: expected 2025, got {call_kwargs.get('year')}")
        if call_kwargs.get("session_cm_id") != 1000002:
            errors.append(f"session_cm_id: expected 1000002, got {call_kwargs.get('session_cm_id')}")

        if errors:
            raise AssertionError("Parameter mismatches:\n  " + "\n  ".join(errors))

    def test_socialize_with_not_deduplicated_across_fields(self, deduplicator):
        """Test that socialize_with field preserves uniqueness across sources.

        The socialize_with (retparent_socialize) field outputs 1:1 known age
        preference requests per child. These should NEVER be deduplicated
        even if the same requester→target pair appears elsewhere.

        This test documents the business rule: socialize_with is special.
        """
        # Request from socialize_with field
        socialize_request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.95,
            source=RequestSource.FAMILY,
            source_field="socialize_with",  # Special field - should never dedupe
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        # Same requester→target from bunking_notes
        notes_request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=1,
            confidence_score=0.80,
            source=RequestSource.STAFF,
            source_field="bunking_notes",  # Different field
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        result = deduplicator.deduplicate_batch([socialize_request, notes_request])

        # Both should be kept - socialize_with is special
        assert len(result.kept_requests) == 2
        assert len(result.duplicate_groups) == 0
        assert result.statistics["duplicates_removed"] == 0

    def test_bunk_with_deduplicated_across_source_fields(self, deduplicator):
        """Test that bunk_with/bunking_notes/internal_notes deduplicate across source fields.

        Unlike socialize_with, the other source fields should deduplicate when
        they have the same requester→target pair. This matches the database
        unique constraint which does NOT include source_field.

        Example: Parent mentions "wants to bunk with Sarah" in both:
        - share_bunk_with field (family form)
        - bunking_notes field (free text)
        → Only ONE request should be kept (STAFF source wins over FAMILY).
        """
        # Request from share_bunk_with field
        form_request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.95,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",  # Family form field
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"origin": "form"},
        )

        # Same requester→target from bunking_notes
        notes_request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=1,
            confidence_score=0.80,
            source=RequestSource.STAFF,
            source_field="bunking_notes",  # Free text notes field
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"origin": "notes"},
        )

        result = deduplicator.deduplicate_batch([form_request, notes_request])

        # Should deduplicate - only ONE kept (source priority first, then max confidence)
        assert len(result.kept_requests) == 1
        # STAFF source wins over FAMILY, but keeps max confidence from both
        assert result.kept_requests[0].source == RequestSource.STAFF
        assert result.kept_requests[0].confidence_score == 0.95  # Max confidence from both
        assert result.kept_requests[0].metadata["origin"] == "notes"
        assert result.statistics["duplicates_removed"] == 1

    def test_internal_notes_deduplicated_across_source_fields(self, deduplicator):
        """Test that internal_notes also deduplicates with other non-socialize fields.

        internal_notes (staff internal notes) should deduplicate with
        share_bunk_with and bunking_notes for the same requester→target.
        """
        # Request from share_bunk_with
        form_request = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=200,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.90,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        # Same pair from internal_notes
        internal_request = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=200,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=2,
            confidence_score=0.85,
            source=RequestSource.STAFF,
            source_field="internal_notes",  # Staff internal notes
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        result = deduplicator.deduplicate_batch([form_request, internal_request])

        # Should deduplicate
        assert len(result.kept_requests) == 1
        assert result.statistics["duplicates_removed"] == 1


class TestSimplifiedSourcePriority:
    """Test simplified source priority (STAFF > FAMILY only, no NOTES category)."""

    @pytest.fixture
    def deduplicator(self):
        """Create a Deduplicator without repository (batch-only dedup)"""
        return Deduplicator()

    def test_staff_over_family_tiebreaker(self):
        """Test that STAFF source wins over FAMILY in dedup tiebreaker.

        When same (requester, requestee, type, session, year) comes from both
        FAMILY and STAFF sources, STAFF should win because staff validates
        family input.
        """
        family_request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.NOT_BUNK_WITH,
            session_cm_id=1000002,
            priority=4,
            confidence_score=0.95,  # Higher confidence
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",  # Parent embedded negative in bunk_with
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"original_text": "Please don't put with Ashley"},
        )

        staff_request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.NOT_BUNK_WITH,
            session_cm_id=1000002,
            priority=4,
            confidence_score=0.90,  # Lower confidence
            source=RequestSource.STAFF,
            source_field="do_not_share_with",  # Staff explicit validation
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"original_text": "Neg req Ashley"},
        )

        deduplicator = Deduplicator()
        result = deduplicator.deduplicate_batch([family_request, staff_request])

        # Staff should win even with lower confidence (source > confidence)
        assert len(result.kept_requests) == 1
        assert result.kept_requests[0].source == RequestSource.STAFF
        assert result.kept_requests[0].source_field == "do_not_share_with"
        assert result.statistics["duplicates_removed"] == 1

    def test_confidence_tiebreaker_same_source(self):
        """Test that confidence is tiebreaker when sources are equal.

        When both requests have same source priority, higher confidence wins.
        """
        high_conf = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=200,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.98,  # Higher confidence
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        low_conf = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=200,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.75,  # Lower confidence
            source=RequestSource.FAMILY,  # Same source
            source_field="share_bunk_with",
            csv_position=1,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        deduplicator = Deduplicator()
        result = deduplicator.deduplicate_batch([low_conf, high_conf])

        # Higher confidence wins when source priority is equal
        assert len(result.kept_requests) == 1
        assert result.kept_requests[0].confidence_score == 0.98
        assert result.statistics["duplicates_removed"] == 1

    def test_source_priority_only_staff_and_family(self):
        """Test that SOURCE_PRIORITY only contains STAFF and FAMILY.

        NOTES category should not exist - bunking_notes and internal_notes
        should map to STAFF source.
        """
        from bunking.sync.bunk_request_processor.processing.deduplicator import SOURCE_PRIORITY

        # Should only have two entries
        assert len(SOURCE_PRIORITY) == 2
        assert RequestSource.STAFF in SOURCE_PRIORITY
        assert RequestSource.FAMILY in SOURCE_PRIORITY

        # STAFF should have higher priority than FAMILY
        assert SOURCE_PRIORITY[RequestSource.STAFF] > SOURCE_PRIORITY[RequestSource.FAMILY]

    def test_notes_enum_removed(self):
        """Test that RequestSource.NOTES no longer exists.

        All staff-written fields (bunking_notes, internal_notes, do_not_share_with)
        should use RequestSource.STAFF.
        """
        # NOTES should not be a valid enum value
        assert not hasattr(RequestSource, "NOTES")


class TestDatabaseDuplicateMerge:
    """Test database duplicate detection and merge metadata."""

    @pytest.fixture
    def mock_request_repo(self):
        """Create a mock request repository"""
        return Mock()

    def test_database_duplicate_flagged_with_all_metadata(self, mock_request_repo):
        """Test that database duplicates are flagged with ID for merge handling."""
        existing_mock = Mock()
        existing_mock.id = "existing_record_123"
        mock_request_repo.find_existing.return_value = existing_mock

        new_request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.NOT_BUNK_WITH,
            session_cm_id=1000002,
            priority=4,
            confidence_score=0.95,
            source=RequestSource.STAFF,
            source_field="do_not_share_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"ai_p1_reasoning": {"parsed": True}},
        )

        deduplicator = Deduplicator(mock_request_repo)
        result = deduplicator.deduplicate_batch([new_request], check_database=True)

        # Should be flagged for merge handling
        assert len(result.kept_requests) == 1
        assert result.kept_requests[0].metadata["has_database_duplicate"] is True
        assert result.kept_requests[0].metadata["database_duplicate_id"] == "existing_record_123"
        assert result.statistics["database_duplicates"] == 1


class TestAgePreferenceDeduplication:
    """Test age_preference request deduplication across source fields.

    Bug fix: age_preference requests from different sources (e.g., AI-parsed from
    bunking_notes vs dropdown from ret_parent_socialize_with_best) were NOT being
    deduplicated, causing DB unique constraint violations.

    The DB unique constraint is: (requester_id, requestee_id, request_type, year, session_id)
    It does NOT include source_field, so we must dedupe across all source fields.
    """

    @pytest.fixture
    def deduplicator(self):
        """Create a Deduplicator without repository (batch-only dedup)"""
        return Deduplicator()

    def test_age_preference_from_different_sources_deduplicated(self, deduplicator):
        """Test that age_preference from different sources ARE deduplicated.

        This is the bug fix test. Previously, age_preference requests from bunking_notes
        and ret_parent_socialize_with_best had different dedup keys and both attempted
        to save to the DB, violating the unique constraint.
        """
        # Age preference from bunking_notes (AI-parsed)
        ai_parsed = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=None,  # age_preference has no target
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=0.85,
            source=RequestSource.STAFF,
            source_field="bunking_notes",  # AI-parsed from staff notes
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"age_preference": "older", "origin": "ai_parsed"},
        )

        # Age preference from dropdown (direct parse)
        dropdown_parsed = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=None,  # age_preference has no target
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=1.0,  # Dropdown is 100% confidence
            source=RequestSource.FAMILY,
            source_field="ret_parent_socialize_with_best",  # Dropdown field
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"age_preference": "older", "origin": "dropdown"},
        )

        result = deduplicator.deduplicate_batch([ai_parsed, dropdown_parsed])

        # MUST deduplicate - only ONE kept (otherwise DB constraint violation)
        assert len(result.kept_requests) == 1
        assert result.statistics["duplicates_removed"] == 1

        # STAFF wins over FAMILY (source priority)
        kept = result.kept_requests[0]
        assert kept.source == RequestSource.STAFF

        # But confidence is boosted to max from all sources
        assert kept.confidence_score == 1.0

        # Metadata should be merged
        assert kept.metadata.get("is_merged_duplicate") is True

    def test_age_preference_conflicting_values_highest_priority_wins(self, deduplicator):
        """Test that conflicting age preferences resolve to highest priority source.

        Edge case: What if bunking_notes says "older" but dropdown says "younger"?
        Higher priority source wins (STAFF > FAMILY), consistent with other request types.
        """
        # AI-parsed says "older" (STAFF source)
        older_request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=0.80,
            source=RequestSource.STAFF,
            source_field="bunking_notes",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"age_preference": "older"},
        )

        # Dropdown says "younger" (FAMILY source)
        younger_request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=1.0,  # Higher confidence
            source=RequestSource.FAMILY,
            source_field="ret_parent_socialize_with_best",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"age_preference": "younger"},
        )

        result = deduplicator.deduplicate_batch([older_request, younger_request])

        # Deduplicated - STAFF wins despite lower confidence
        assert len(result.kept_requests) == 1
        kept = result.kept_requests[0]
        assert kept.source == RequestSource.STAFF
        assert kept.metadata["age_preference"] == "older"
        # Confidence boosted from family's higher value
        assert kept.confidence_score == 1.0

    def test_age_preference_same_source_same_field_deduplicated(self, deduplicator):
        """Test that multiple age_preference from same source/field are deduplicated."""
        req1 = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=0.90,
            source=RequestSource.STAFF,
            source_field="bunking_notes",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        req2 = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=0.85,
            source=RequestSource.STAFF,
            source_field="bunking_notes",
            csv_position=1,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        result = deduplicator.deduplicate_batch([req1, req2])

        assert len(result.kept_requests) == 1
        assert result.kept_requests[0].confidence_score == 0.90
        assert result.statistics["duplicates_removed"] == 1

    def test_age_preference_different_sessions_not_deduplicated(self, deduplicator):
        """Test that age_preference for different sessions are NOT deduplicated."""
        session1 = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,  # Session 2
            priority=1,
            confidence_score=0.90,
            source=RequestSource.FAMILY,
            source_field="ret_parent_socialize_with_best",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        session2 = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000003,  # Session 3 - different!
            priority=1,
            confidence_score=0.90,
            source=RequestSource.FAMILY,
            source_field="ret_parent_socialize_with_best",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        result = deduplicator.deduplicate_batch([session1, session2])

        # Different sessions - both kept
        assert len(result.kept_requests) == 2
        assert result.statistics["duplicates_removed"] == 0

    def test_age_preference_different_requesters_not_deduplicated(self, deduplicator):
        """Test that age_preference for different people are NOT deduplicated."""
        person1 = BunkRequest(
            requester_cm_id=12345,  # Person 1
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=0.90,
            source=RequestSource.FAMILY,
            source_field="ret_parent_socialize_with_best",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        person2 = BunkRequest(
            requester_cm_id=67890,  # Person 2 - different!
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=0.90,
            source=RequestSource.FAMILY,
            source_field="ret_parent_socialize_with_best",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        result = deduplicator.deduplicate_batch([person1, person2])

        # Different people - both kept
        assert len(result.kept_requests) == 2
        assert result.statistics["duplicates_removed"] == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
