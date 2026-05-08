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
from bunking.sync.bunk_request_processor.shared.constants import SourceField


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
            source_field="bunk_with",
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
            source_field="bunk_with",
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
            source_field="bunk_with",
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
            source_field="bunk_with",
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
            source_field="not_bunk_with",
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
            source_field="bunk_with",
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

    def test_merge_metadata_with_empty_source_field(self, deduplicator, base_request):
        """Empty/unknown source_field on a duplicate must not crash the merge.

        Regression: source_from_field() raises ValueError on unknown values.
        Legacy DB rows can have source_field="" — without a guard, one bad row
        aborts the entire dedup pass.
        """
        duplicate = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=2,
            confidence_score=0.99,  # Higher than base, exercises confidence_boosted_from path too
            source=RequestSource.FAMILY,
            source_field="",  # Empty string — would raise ValueError without the guard
            csv_position=1,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        result = deduplicator.deduplicate_batch([base_request, duplicate])

        assert len(result.kept_requests) == 1
        kept = result.kept_requests[0]
        # Falls back to req.source.value rather than raising.
        assert kept.metadata["duplicate_sources"] == ["family"]
        assert kept.metadata["confidence_boosted_from"] == "family"

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
            source_field="bunk_with",
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
            source_field="bunk_with",
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
            source_field="not_bunk_with",
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
            source_field="not_bunk_with",
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
            source_field="bunk_with",
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
            source_field="bunk_with",
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

    def test_socialize_with_bunk_with_deduped_across_fields(self, deduplicator):
        """Test that non-AGE_PREFERENCE socialize_with requests cross-field dedupe normally.

        socialize_with only produces AGE_PREFERENCE requests in production
        (caught by the first branch). If a BUNK_WITH somehow came from
        socialize_with, it should dedupe across fields like any other source.
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
            source_field=SourceField.SOCIALIZE_WITH,
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
            source_field="bunking_notes",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        result = deduplicator.deduplicate_batch([socialize_request, notes_request])

        # Cross-field dedup merges them — same requester→target pair
        assert len(result.kept_requests) == 1
        assert len(result.duplicate_groups) == 1
        assert result.statistics["duplicates_removed"] == 1

    def test_bunk_with_deduplicated_across_source_fields(self, deduplicator):
        """Test that bunk_with/bunking_notes/internal_notes deduplicate across source fields.

        Unlike socialize_with, the other source fields should deduplicate when
        they have the same requester→target pair. This matches the database
        unique constraint which does NOT include source_field.

        Example: Parent mentions "wants to bunk with Sarah" in both:
        - share_bunk_with field (family form)
        - bunking_notes field (free text)
        → Only ONE request should be kept (FAMILY source wins — parent-paramount, #1088).
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
            source_field="bunk_with",  # Family form field
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
        # FAMILY source wins over STAFF (#1088 parent-paramount flip), keeps max confidence from both
        assert result.kept_requests[0].source == RequestSource.FAMILY
        assert result.kept_requests[0].confidence_score == 0.95  # Max confidence from both
        assert result.kept_requests[0].metadata["origin"] == "form"
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
            source_field="bunk_with",
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

    def test_family_over_staff_tiebreaker(self):
        """Test that FAMILY source wins over STAFF in dedup tiebreaker (#1088 parent-paramount).

        When same (requester, requestee, type, session, year) comes from both
        FAMILY and STAFF sources, FAMILY should win — origin of intent is authoritative.
        Staff corroborates but does not supersede parent input.
        """
        family_request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=67890,
            request_type=RequestType.NOT_BUNK_WITH,
            session_cm_id=1000002,
            priority=4,
            confidence_score=0.95,  # Higher confidence
            source=RequestSource.FAMILY,
            source_field="bunk_with",  # Parent embedded negative in bunk_with
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
            source_field=SourceField.NOT_BUNK_WITH,  # Staff explicit validation
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"original_text": "Neg req Ashley"},
        )

        deduplicator = Deduplicator()
        result = deduplicator.deduplicate_batch([family_request, staff_request])

        # Family wins even with staff having a different source_field (source > confidence)
        assert len(result.kept_requests) == 1
        assert result.kept_requests[0].source == RequestSource.FAMILY
        assert result.kept_requests[0].source_field == "bunk_with"
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
            source_field="bunk_with",
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
            source_field="bunk_with",
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

    def test_source_field_priority_structure(self):
        """SOURCE_FIELD_PRIORITY contains all 5 source fields with materiality-based ordering.

        Locks the Stage 3 ordering: bunk_with (material parent) > not_bunk_with
        (staff exclusion) > bunking_notes/internal_notes (staff observation, tied) >
        socialize_with (immaterial parent). Confidence breaks ties within rank.
        """
        from bunking.sync.bunk_request_processor.processing.deduplicator import SOURCE_FIELD_PRIORITY

        # All 5 canonical source_field values must be present
        assert len(SOURCE_FIELD_PRIORITY) == 5
        assert SourceField.BUNK_WITH in SOURCE_FIELD_PRIORITY
        assert SourceField.NOT_BUNK_WITH in SOURCE_FIELD_PRIORITY
        assert SourceField.BUNKING_NOTES in SOURCE_FIELD_PRIORITY
        assert SourceField.INTERNAL_NOTES in SOURCE_FIELD_PRIORITY
        assert SourceField.SOCIALIZE_WITH in SOURCE_FIELD_PRIORITY

        # Materiality ordering
        assert SOURCE_FIELD_PRIORITY[SourceField.BUNK_WITH] > SOURCE_FIELD_PRIORITY[SourceField.NOT_BUNK_WITH]
        assert SOURCE_FIELD_PRIORITY[SourceField.NOT_BUNK_WITH] > SOURCE_FIELD_PRIORITY[SourceField.BUNKING_NOTES]
        assert SOURCE_FIELD_PRIORITY[SourceField.BUNKING_NOTES] == SOURCE_FIELD_PRIORITY[SourceField.INTERNAL_NOTES]
        assert SOURCE_FIELD_PRIORITY[SourceField.BUNKING_NOTES] > SOURCE_FIELD_PRIORITY[SourceField.SOCIALIZE_WITH]

    def test_notes_enum_removed(self):
        """Test that RequestSource.NOTES no longer exists.

        All staff-written fields (bunking_notes, internal_notes, do_not_share_with)
        should use RequestSource.STAFF.
        """
        # NOTES should not be a valid enum value
        assert not hasattr(RequestSource, "NOTES")

    def test_not_bunk_with_beats_socialize_with_in_dedup(self):
        """Stage 3 ordering: not_bunk_with (STAFF exclusion, rank 3) outranks
        socialize_with (FAMILY immaterial, rank 1) regardless of confidence.

        Same dedup key (same requester/year/session, AGE_PREFERENCE).
        Lower-confidence not_bunk_with row must win over higher-confidence
        socialize_with row — proves rank dominates confidence.
        """
        not_bunk_with_req = BunkRequest(
            requester_cm_id=44444,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=4,
            confidence_score=0.70,  # Lower confidence
            source=RequestSource.STAFF,
            source_field=SourceField.NOT_BUNK_WITH,
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=True,
            metadata={"age_preference": "younger"},
        )

        socialize_with_req = BunkRequest(
            requester_cm_id=44444,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=0.95,  # Higher confidence
            source=RequestSource.FAMILY,
            source_field=SourceField.SOCIALIZE_WITH,
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=True,
            metadata={"age_preference": "younger"},
        )

        deduplicator = Deduplicator()
        result = deduplicator.deduplicate_batch([socialize_with_req, not_bunk_with_req])

        assert len(result.kept_requests) == 1
        assert result.kept_requests[0].source_field == SourceField.NOT_BUNK_WITH, (
            f"Expected not_bunk_with to win over socialize_with; got {result.kept_requests[0].source_field}"
        )

    def test_bunking_notes_beats_socialize_with_in_dedup(self):
        """Stage 3 ordering: bunking_notes (STAFF observation, rank 2) outranks
        socialize_with (FAMILY immaterial, rank 1) regardless of confidence.

        Same dedup key (same requester/year/session, AGE_PREFERENCE).
        Lower-confidence bunking_notes row must win over higher-confidence
        socialize_with row.
        """
        bunking_notes_req = BunkRequest(
            requester_cm_id=55555,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=2,
            confidence_score=0.70,  # Lower confidence
            source=RequestSource.STAFF,
            source_field=SourceField.BUNKING_NOTES,
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=True,
            metadata={"age_preference": "older"},
        )

        socialize_with_req = BunkRequest(
            requester_cm_id=55555,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=0.95,  # Higher confidence
            source=RequestSource.FAMILY,
            source_field=SourceField.SOCIALIZE_WITH,
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=True,
            metadata={"age_preference": "older"},
        )

        deduplicator = Deduplicator()
        result = deduplicator.deduplicate_batch([socialize_with_req, bunking_notes_req])

        assert len(result.kept_requests) == 1
        assert result.kept_requests[0].source_field == SourceField.BUNKING_NOTES, (
            f"Expected bunking_notes to win over socialize_with; got {result.kept_requests[0].source_field}"
        )

    def test_bunking_notes_and_internal_notes_tied_confidence_breaks(self):
        """Stage 3 ordering: bunking_notes and internal_notes share rank 2.
        Confidence breaks the tie within rank.

        Same dedup key (same requester/requestee/year/session, BUNK_WITH).
        Higher-confidence internal_notes row wins because the rank tie defers
        to the confidence_score secondary sort.
        """
        bunking_notes_req = BunkRequest(
            requester_cm_id=66666,
            requested_cm_id=77777,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=2,
            confidence_score=0.85,  # Lower confidence
            source=RequestSource.STAFF,
            source_field=SourceField.BUNKING_NOTES,
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"original_text": "wants to bunk with target"},
        )

        internal_notes_req = BunkRequest(
            requester_cm_id=66666,
            requested_cm_id=77777,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=2,
            confidence_score=0.95,  # Higher confidence
            source=RequestSource.STAFF,
            source_field=SourceField.INTERNAL_NOTES,
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"original_text": "internal: bunk with target"},
        )

        deduplicator = Deduplicator()
        result = deduplicator.deduplicate_batch([bunking_notes_req, internal_notes_req])

        assert len(result.kept_requests) == 1
        survivor = result.kept_requests[0]
        assert survivor.source_field == SourceField.INTERNAL_NOTES, (
            f"Expected higher-confidence internal_notes to win on confidence tiebreak; got {survivor.source_field}"
        )
        assert survivor.confidence_score == 0.95


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
            source_field="not_bunk_with",
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
        and socialize_with had different dedup keys and both attempted to save to the
        DB, violating the unique constraint.

        Under #1142 Stage 3 materiality ordering: bunking_notes (rank 2, staff
        observation) outranks socialize_with (rank 1, immaterial parent). The
        bunking_notes row survives as primary; confidence is boosted to max via
        merge_metadata.
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
            source_field=SourceField.BUNKING_NOTES,  # AI-parsed from staff notes
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
            source_field=SourceField.SOCIALIZE_WITH,  # Dropdown field (immaterial parent)
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

        # bunking_notes (rank 2) outranks socialize_with (rank 1) under #1142 Stage 3
        kept = result.kept_requests[0]
        assert kept.source == RequestSource.STAFF
        assert kept.source_field == SourceField.BUNKING_NOTES

        # Confidence is boosted to max from all sources via merge_metadata
        assert kept.confidence_score == 1.0

        # Metadata should be merged
        assert kept.metadata.get("is_merged_duplicate") is True

    def test_age_preference_conflicting_values_highest_priority_wins(self, deduplicator):
        """Test that conflicting age preferences resolve to highest priority source.

        Edge case: bunking_notes says "older" and socialize_with says "younger".
        Under #1142 Stage 3 materiality ordering, bunking_notes (rank 2, staff
        observation) outranks socialize_with (rank 1, immaterial parent), so
        the bunking_notes row's "older" value survives.

        Note: the conflict-target demotion path (_is_conflicting_age_preference_pair)
        only fires for BUNK_WITH vs SOCIALIZE_WITH source fields — this case uses
        bunking_notes vs socialize_with, so it falls through to the normal tiebreak.
        Confidence is still boosted to max via merge_metadata.
        """
        # AI-parsed says "older" (STAFF source, bunking_notes — rank 2)
        older_request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=0.80,
            source=RequestSource.STAFF,
            source_field=SourceField.BUNKING_NOTES,
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"age_preference": "older"},
        )

        # Dropdown says "younger" (FAMILY source, socialize_with — rank 1)
        younger_request = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=1.0,  # Higher confidence — but rank dominates
            source=RequestSource.FAMILY,
            source_field=SourceField.SOCIALIZE_WITH,
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"age_preference": "younger"},
        )

        result = deduplicator.deduplicate_batch([older_request, younger_request])

        # Deduplicated — bunking_notes (rank 2) wins over socialize_with (rank 1) under #1142 Stage 3
        assert len(result.kept_requests) == 1
        kept = result.kept_requests[0]
        assert kept.source == RequestSource.STAFF
        assert kept.source_field == SourceField.BUNKING_NOTES
        assert kept.metadata["age_preference"] == "older"
        # Confidence boosted to max from all sources via merge_metadata
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

    def test_age_preference_with_is_placeholder_true_not_duplicated(self, deduplicator):
        """BUG FIX: AGE_PREFERENCE with is_placeholder=True must not be added twice.

        Root cause: AGE_PREFERENCE requests have is_placeholder=True (no target person)
        but ALSO get a valid dedup key (requester, None, type, "", year, session).

        The buggy code:
        1. Lines 130-132: Adds ALL is_placeholder=True requests unconditionally
        2. Lines 135-138: Adds keyed requests from request_groups (including AGE_PREFERENCE)

        Result: Every AGE_PREFERENCE request is added to kept_requests TWICE,
        causing DB unique constraint violations even on an empty table.

        Fix: Use the key as source of truth. If key=None, add directly. Otherwise,
        only add via request_groups processing.
        """
        # Single AGE_PREFERENCE request with is_placeholder=True (real production behavior)
        age_pref = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=None,  # No target for age preferences
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=0.90,
            source=RequestSource.FAMILY,
            source_field="ret_parent_socialize_with_best",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=True,  # THE KEY: production AGE_PREFERENCE has this True
            metadata={"age_preference": "older"},
        )

        result = deduplicator.deduplicate_batch([age_pref])

        # MUST be exactly 1 - not duplicated
        assert len(result.kept_requests) == 1, (
            f"Expected 1 kept request, got {len(result.kept_requests)}. "
            f"Bug: AGE_PREFERENCE with is_placeholder=True being added twice."
        )
        assert result.statistics["unique_requests"] == 1
        assert result.statistics["duplicates_removed"] == 0

    def test_age_preference_with_is_placeholder_true_deduplicates_across_sources(self, deduplicator):
        """Test that AGE_PREFERENCE with is_placeholder=True still deduplicates across sources.

        Even though is_placeholder=True, multiple AGE_PREFERENCE requests for the same
        requester/session/year from different sources should deduplicate to 1.

        Under #1142 Stage 3, bunking_notes (rank 2) outranks socialize_with (rank 1).
        """
        # AI-parsed from bunking_notes (STAFF source — rank 2)
        ai_parsed = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=0.85,
            source=RequestSource.STAFF,
            source_field=SourceField.BUNKING_NOTES,
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=True,  # Production behavior
            metadata={"age_preference": "older", "origin": "ai_parsed"},
        )

        # Dropdown selection (FAMILY source, socialize_with — rank 1)
        dropdown = BunkRequest(
            requester_cm_id=12345,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=1,
            confidence_score=1.0,
            source=RequestSource.FAMILY,
            source_field=SourceField.SOCIALIZE_WITH,
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=True,  # Production behavior
            metadata={"age_preference": "older", "origin": "dropdown"},
        )

        result = deduplicator.deduplicate_batch([ai_parsed, dropdown])

        # Should deduplicate to 1 (not 2 from dedup, and not 4 from double-add bug)
        assert len(result.kept_requests) == 1, (
            f"Expected 1 kept request after dedup, got {len(result.kept_requests)}. "
            f"Possible bugs: double-add or no dedup across sources."
        )
        assert result.statistics["duplicates_removed"] == 1
        # bunking_notes (rank 2) wins over socialize_with (rank 1) under #1142 Stage 3
        assert result.kept_requests[0].source == RequestSource.STAFF
        assert result.kept_requests[0].source_field == SourceField.BUNKING_NOTES


class TestParentAgePreferenceDeduplication:
    """Test Stage 1 parent-paramount fix: bunk_with source wins parent-vs-parent age_pref dedupe.

    When a parent submits an age preference both via bunk_with prose AND the
    socialize_with checkbox, both become RequestSource.FAMILY with the same dedupe key.
    The old sort was (SOURCE_PRIORITY, confidence_score) — the socialize_with dropdown
    gets a deterministic confidence=1.0 which beat the AI-parsed bunk_with at 0.85-0.95,
    so the wrong request was kept as primary.

    Stage 1 fix: insert bunk_with-source preference between SOURCE_PRIORITY and
    confidence_score so the prose-derived request wins.
    """

    @pytest.fixture
    def deduplicator(self):
        """Create a Deduplicator without repository (batch-only dedup)"""
        return Deduplicator()

    def _age_pref(
        self,
        source_field: str,
        confidence: float,
        source: RequestSource = RequestSource.FAMILY,
        requester_cm_id: int = 1001,
        year: int = 2025,
        session_cm_id: int = 1000001,
    ) -> BunkRequest:
        return BunkRequest(
            requester_cm_id=requester_cm_id,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=session_cm_id,
            priority=1,
            confidence_score=confidence,
            source=source,
            source_field=source_field,
            csv_position=0,
            year=year,
            status=RequestStatus.RESOLVED,
            is_placeholder=True,
            metadata={},
        )

    def test_dedupe_prefers_bunk_with_over_socialize_with_on_parent_age_pref_tie(self, deduplicator):
        """When a parent submits an age preference both via bunk_with prose AND the
        socialize_with checkbox, dedupe must keep the bunk_with-derived request as
        primary — the prose carries richer signal than a binary checkbox tick.

        Without this fix, confidence_score tiebreaks (checkbox=1.0 > AI parse=0.92)
        pick the wrong winner.
        """
        bunk_with_req = self._age_pref(SourceField.BUNK_WITH, confidence=0.92)
        socialize_req = self._age_pref(SourceField.SOCIALIZE_WITH, confidence=1.0)

        result = deduplicator.deduplicate_batch([socialize_req, bunk_with_req])

        assert len(result.kept_requests) == 1
        primary = result.kept_requests[0]
        assert primary.source_field == SourceField.BUNK_WITH, (
            f"Expected bunk_with to win parent-vs-parent age_pref dedupe; got {primary.source_field}"
        )
        assert len(result.duplicate_groups) == 1
        assert result.duplicate_groups[0].duplicates[0].source_field == SourceField.SOCIALIZE_WITH

    def test_bunk_with_wins_even_when_listed_second(self, deduplicator):
        """Input order must not affect outcome — bunk_with wins regardless of position."""
        bunk_with_req = self._age_pref(SourceField.BUNK_WITH, confidence=0.88)
        socialize_req = self._age_pref(SourceField.SOCIALIZE_WITH, confidence=1.0)

        # bunk_with listed second
        result = deduplicator.deduplicate_batch([socialize_req, bunk_with_req])
        assert result.kept_requests[0].source_field == SourceField.BUNK_WITH

        # bunk_with listed first
        result2 = deduplicator.deduplicate_batch([bunk_with_req, socialize_req])
        assert result2.kept_requests[0].source_field == SourceField.BUNK_WITH

    def test_family_paramount_dominates_bunk_with_bias(self, deduplicator):
        """SOURCE_PRIORITY (family > staff, #1088) dominates the bunk_with source_field tiebreaker.

        A FAMILY bunk_with request beats a STAFF socialize_with request because
        SOURCE_PRIORITY is the first sort key. The bunk_with bias is secondary and
        only changes outcomes within same-source (parent-vs-parent) ties.
        """
        family_bunk_with = self._age_pref(SourceField.BUNK_WITH, confidence=0.92, source=RequestSource.FAMILY)
        staff_socialize = self._age_pref(SourceField.SOCIALIZE_WITH, confidence=0.80, source=RequestSource.STAFF)

        result = deduplicator.deduplicate_batch([family_bunk_with, staff_socialize])

        assert len(result.kept_requests) == 1
        assert result.kept_requests[0].source == RequestSource.FAMILY, (
            "Family source must win over staff socialize_with; SOURCE_PRIORITY (family > staff) dominates"
        )

    def test_rank_dominates_confidence_when_both_non_bunk_with(self, deduplicator):
        """Even when neither request is bunk_with, source_field rank dominates confidence.

        Under #1142 Stage 3 materiality ordering, bunking_notes (rank 2) outranks
        socialize_with (rank 1). The lower-confidence bunking_notes row wins —
        confidence only breaks ties WITHIN the same rank (e.g., bunking_notes
        vs internal_notes, both rank 2).
        """
        high_conf = self._age_pref(SourceField.SOCIALIZE_WITH, confidence=1.0)
        low_conf = self._age_pref(SourceField.BUNKING_NOTES, confidence=0.75)

        result = deduplicator.deduplicate_batch([low_conf, high_conf])

        assert len(result.kept_requests) == 1
        # bunking_notes (rank 2) beats socialize_with (rank 1) regardless of confidence
        assert result.kept_requests[0].source_field == SourceField.BUNKING_NOTES


class TestConflictTargetDemotion:
    """Test Stage 3a: conflict-target case demotes bunk_with-parsed age_preference to pending.

    When a parent submits BOTH bunk_with prose (AI-parsed to age_preference) AND a
    socialize_with boolean (also age_preference), and their targets differ (e.g., prose
    says "older" but boolean says "younger"), the bunk_with-parsed row is demoted to
    status=pending for staff review. The socialize_with row stays resolved.

    Both rows survive in output (no merge).
    """

    @pytest.fixture
    def deduplicator(self):
        """Create a Deduplicator without repository (batch-only dedup)"""
        return Deduplicator()

    def _age_pref(
        self,
        source_field: str,
        age_target: str,
        confidence: float = 0.90,
        source: RequestSource = RequestSource.FAMILY,
        requester_cm_id: int = 4001,
        year: int = 2025,
        session_cm_id: int = 1000001,
    ) -> BunkRequest:
        return BunkRequest(
            requester_cm_id=requester_cm_id,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=session_cm_id,
            priority=1,
            confidence_score=confidence,
            source=source,
            source_field=source_field,
            csv_position=0,
            year=year,
            status=RequestStatus.RESOLVED,
            is_placeholder=True,
            metadata={"age_preference": age_target},
        )

    def test_conflict_target_demotes_bunk_with_parsed_to_pending(self, deduplicator):
        """When bunk_with prose parses to age_preference target=older and
        socialize_with boolean is target=younger, the bunk_with-parsed row
        is demoted to status=pending. socialize_with stays resolved.

        Both rows survive (no merge).

        Represents Olivia Chen (cm_id=4001) whose prose says "older" but
        checkbox says "younger".
        """
        bunk_with_row = self._age_pref(
            source_field=SourceField.BUNK_WITH,
            age_target="older",
            confidence=0.85,
        )
        socialize_row = self._age_pref(
            source_field=SourceField.SOCIALIZE_WITH,
            age_target="younger",
            confidence=1.0,
        )

        result = deduplicator.deduplicate_batch([bunk_with_row, socialize_row])

        # Both rows must survive (no merge happened)
        assert len(result.kept_requests) == 2, f"Expected 2 rows (no merge), got {len(result.kept_requests)}"

        # Find each row by source_field
        kept_by_field = {r.source_field: r for r in result.kept_requests}
        assert SourceField.BUNK_WITH in kept_by_field, "bunk_with row must be in output"
        assert SourceField.SOCIALIZE_WITH in kept_by_field, "socialize_with row must be in output"

        # bunk_with-parsed row demoted to pending
        bunk_with_kept = kept_by_field[SourceField.BUNK_WITH]
        assert bunk_with_kept.status == RequestStatus.PENDING, (
            f"Expected bunk_with row status=pending, got {bunk_with_kept.status!r}"
        )

        # socialize_with row stays resolved
        socialize_kept = kept_by_field[SourceField.SOCIALIZE_WITH]
        assert socialize_kept.status == RequestStatus.RESOLVED, (
            f"Expected socialize_with row status=resolved, got {socialize_kept.status!r}"
        )

    def test_conflict_target_other_direction_also_demotes(self, deduplicator):
        """Same demotion fires when prose=younger and boolean=older (reverse direction)."""
        bunk_with_row = self._age_pref(
            source_field=SourceField.BUNK_WITH,
            age_target="younger",
            confidence=0.88,
        )
        socialize_row = self._age_pref(
            source_field=SourceField.SOCIALIZE_WITH,
            age_target="older",
            confidence=1.0,
        )

        result = deduplicator.deduplicate_batch([bunk_with_row, socialize_row])

        assert len(result.kept_requests) == 2

        kept_by_field = {r.source_field: r for r in result.kept_requests}
        assert kept_by_field[SourceField.BUNK_WITH].status == RequestStatus.PENDING
        assert kept_by_field[SourceField.SOCIALIZE_WITH].status == RequestStatus.RESOLVED

    def test_same_target_age_preference_still_merges(self, deduplicator):
        """Regression: when bunk_with prose parses age_pref=older AND boolean is older,
        they merge as before — bunk_with-source survivor at standard priority.

        Exactly ONE row remains with source_field=bunk_with.
        """
        bunk_with_row = self._age_pref(
            source_field=SourceField.BUNK_WITH,
            age_target="older",
            confidence=0.92,
        )
        socialize_row = self._age_pref(
            source_field=SourceField.SOCIALIZE_WITH,
            age_target="older",
            confidence=1.0,
        )

        result = deduplicator.deduplicate_batch([bunk_with_row, socialize_row])

        # Same-target: merges to ONE row
        assert len(result.kept_requests) == 1, f"Expected 1 row (same-target merge), got {len(result.kept_requests)}"
        assert result.kept_requests[0].source_field == SourceField.BUNK_WITH, (
            f"Expected bunk_with to survive merge; got {result.kept_requests[0].source_field}"
        )
        # Merged row stays resolved
        assert result.kept_requests[0].status == RequestStatus.RESOLVED

    def test_null_age_target_falls_back_to_same_target_merge(self, deduplicator):
        """When the bunk_with row's age_preference is None (parse failure),
        the conflict-target check returns False, so the same-target merge
        path runs and produces ONE surviving row — the bunk_with row,
        which beats socialize_with under the standard preference order.
        Status stays resolved.
        """
        bunk_with_row = self._age_pref(
            source_field=SourceField.BUNK_WITH,
            age_target="older",
            confidence=0.85,
        )
        # Override to None to simulate parse failure
        bunk_with_row.metadata["age_preference"] = None

        socialize_row = self._age_pref(
            source_field=SourceField.SOCIALIZE_WITH,
            age_target="younger",
            confidence=1.0,
        )

        result = deduplicator.deduplicate_batch([bunk_with_row, socialize_row])

        assert len(result.kept_requests) == 1, (
            f"None target falls back to same-target merge → exactly 1 row; "
            f"got {len(result.kept_requests)}: "
            f"{[(r.source_field, r.status) for r in result.kept_requests]}"
        )
        survivor = result.kept_requests[0]
        assert survivor.source_field == SourceField.BUNK_WITH, (
            f"bunk_with must beat socialize_with in fallback merge; got source_field={survivor.source_field}"
        )
        assert survivor.status == RequestStatus.RESOLVED, (
            f"fallback merge must NOT promote to pending (only conflicting "
            f"non-null targets do); got status={survivor.status}"
        )


class TestFamilyParamountTiebreak:
    """Test #1088: FAMILY beats STAFF in dedup tiebreak (parent-paramount policy).

    Origin of intent is authoritative — a parent-sourced request must survive
    as primary even when staff also records the same logical request.

    These tests lock in the FAMILY > STAFF policy introduced in #1088.
    """

    @pytest.fixture
    def deduplicator(self):
        return Deduplicator()

    def test_family_beats_staff_bunk_with_tiebreak(self, deduplicator):
        """When a FAMILY bunk_with and a STAFF bunking_notes share the same dedup key,
        the FAMILY row must survive as primary.

        Scenario: Emma Johnson's parent submits "bunk with Liam Garcia" via the family
        form (source_field=bunk_with). Staff also notes it in bunking_notes.
        The parent-sourced row must win — origin of intent is authoritative.
        """
        family_request = BunkRequest(
            requester_cm_id=11111,
            requested_cm_id=22222,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000001,
            priority=3,
            confidence_score=0.90,
            source=RequestSource.FAMILY,
            source_field=SourceField.BUNK_WITH,
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"source_detail": "parent_form", "original_text": "Please bunk with Liam Garcia"},
        )

        staff_request = BunkRequest(
            requester_cm_id=11111,
            requested_cm_id=22222,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000001,
            priority=1,
            confidence_score=0.85,
            source=RequestSource.STAFF,
            source_field=SourceField.BUNKING_NOTES,
            csv_position=1,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"source_detail": "staff_observation", "original_text": "Liam Garcia - bunk with"},
        )

        result = deduplicator.deduplicate_batch([family_request, staff_request])

        assert len(result.kept_requests) == 1
        assert result.statistics["duplicates_removed"] == 1

        survivor = result.kept_requests[0]

        # FAMILY is primary — origin of intent is authoritative
        assert survivor.source == RequestSource.FAMILY, (
            f"Expected FAMILY to be primary (parent-paramount); got {survivor.source}"
        )
        assert survivor.source_field == SourceField.BUNK_WITH, (
            f"Expected source_field=bunk_with on survivor; got {survivor.source_field}"
        )

        # Staff row is the dropped duplicate
        assert len(result.duplicate_groups) == 1
        assert result.duplicate_groups[0].primary.source == RequestSource.FAMILY
        dropped = result.duplicate_groups[0].duplicates
        assert len(dropped) == 1
        assert dropped[0].source == RequestSource.STAFF

        # _merge_metadata must have folded the staff row's metadata into the survivor
        assert survivor.metadata.get("is_merged_duplicate") is True
        merged_sources = survivor.metadata.get("merged_sources", [])
        assert len(merged_sources) == 2, (
            f"merged_sources should have 2 entries (family + staff); got {len(merged_sources)}"
        )
        # Both family and staff sources are represented in merged_sources
        merged_source_values = [s.get("source") for s in merged_sources]
        assert "family" in merged_source_values, "FAMILY source must appear in merged_sources"
        assert "staff" in merged_source_values, "STAFF source must appear in merged_sources (preserved as metadata)"
        # The staff row's original_text must appear in merged_sources
        merged_texts = [s.get("original_text") for s in merged_sources]
        assert "Liam Garcia - bunk with" in merged_texts, (
            "Staff row's original_text must be preserved in merged_sources metadata"
        )

    def test_family_beats_staff_age_preference_tiebreak(self, deduplicator):
        """When a FAMILY age_preference (AI-parsed from bunk_with prose) and a STAFF
        age_preference (from bunking_notes) share the same dedup key, FAMILY wins.

        Scenario: Liam Garcia's parent writes "prefers younger bunk-mates" in the
        bunk_with text field (AI-parsed to age_preference/FAMILY). Staff also notes
        the same preference in bunking_notes (STAFF). The parent-sourced row must win.
        """
        family_age_pref = BunkRequest(
            requester_cm_id=33333,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000001,
            priority=1,
            confidence_score=0.88,
            source=RequestSource.FAMILY,
            source_field=SourceField.BUNK_WITH,  # Parent prose AI-parsed to age_preference
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=True,
            metadata={"age_preference": "younger", "original_text": "prefers younger bunk-mates"},
        )

        staff_age_pref = BunkRequest(
            requester_cm_id=33333,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000001,
            priority=1,
            confidence_score=0.80,
            source=RequestSource.STAFF,
            source_field=SourceField.BUNKING_NOTES,
            csv_position=1,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=True,
            metadata={"age_preference": "younger", "original_text": "Liam likes younger kids"},
        )

        result = deduplicator.deduplicate_batch([family_age_pref, staff_age_pref])

        assert len(result.kept_requests) == 1
        assert result.statistics["duplicates_removed"] == 1

        survivor = result.kept_requests[0]

        # FAMILY wins as primary — parent-paramount
        assert survivor.source == RequestSource.FAMILY, (
            f"Expected FAMILY to win age_preference tiebreak (parent-paramount); got {survivor.source}"
        )

        # Staff row recorded as the dropped duplicate
        assert len(result.duplicate_groups) == 1
        dropped = result.duplicate_groups[0].duplicates
        assert len(dropped) == 1
        assert dropped[0].source == RequestSource.STAFF


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
