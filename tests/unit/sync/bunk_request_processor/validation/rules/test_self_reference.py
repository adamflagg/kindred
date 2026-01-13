"""Test-Driven Development for SelfReferenceRule

Tests the self-reference detection validation."""

import sys
from pathlib import Path

import pytest

# Add the parent directory to the path
test_dir = Path(__file__).resolve().parent
project_root = test_dir.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import (
    BunkRequest,
    RequestSource,
    RequestStatus,
    RequestType,
)
from bunking.sync.bunk_request_processor.validation.rules.self_reference import SelfReferenceRule


class TestSelfReferenceRule:
    """Test the SelfReferenceRule validation"""

    @pytest.fixture
    def rule(self):
        """Create a SelfReferenceRule"""
        return SelfReferenceRule()

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

    def test_valid_request_passes(self, rule, base_request):
        """Test that a valid request passes"""
        result = rule.validate(base_request)

        assert result.is_valid
        assert len(result.errors) == 0
        assert len(result.warnings) == 0

    def test_matching_cm_ids_fails(self, rule, base_request):
        """Test that matching CM IDs are detected"""
        base_request.requester_cm_id = 12345
        base_request.requested_cm_id = 12345

        result = rule.validate(base_request)

        assert not result.is_valid
        assert len(result.errors) == 1
        assert "Self-referential request" in result.errors[0]
        assert "12345" in result.errors[0]
        assert result.metadata["self_ref_type"] == "cm_id_match"

    def test_placeholder_with_matching_names(self, rule, base_request):
        """Test placeholder request with matching full names"""
        base_request.is_placeholder = True
        base_request.requested_cm_id = None
        base_request.metadata = {"raw_target_name": "John Smith", "requester_full_name": "John Smith"}

        result = rule.validate(base_request)

        assert not result.is_valid
        assert len(result.errors) == 1
        assert "target name 'john smith' matches requester's full name" in result.errors[0]
        assert result.metadata["self_ref_type"] == "full_name_match"

    def test_placeholder_with_different_names(self, rule, base_request):
        """Test placeholder request with different names passes"""
        base_request.is_placeholder = True
        base_request.requested_cm_id = None
        base_request.metadata = {"raw_target_name": "Jane Doe", "requester_full_name": "John Smith"}

        result = rule.validate(base_request)

        assert result.is_valid
        assert len(result.errors) == 0

    def test_only_first_name_match_passes(self, rule, base_request):
        """Test that only matching first names is allowed"""
        base_request.is_placeholder = True
        base_request.requested_cm_id = None
        base_request.metadata = {"raw_target_name": "John Doe", "requester_full_name": "John Smith"}

        result = rule.validate(base_request)

        assert result.is_valid
        assert len(result.errors) == 0

    def test_case_insensitive_name_matching(self, rule, base_request):
        """Test that name matching is case-insensitive"""
        base_request.is_placeholder = True
        base_request.requested_cm_id = None
        base_request.metadata = {"raw_target_name": "JOHN SMITH", "requester_full_name": "john smith"}

        result = rule.validate(base_request)

        assert not result.is_valid
        assert len(result.errors) == 1
        assert result.metadata["self_ref_type"] == "full_name_match"

    def test_possible_self_reference_warning(self, rule, base_request):
        """Test warning for possible self-reference"""
        base_request.metadata = {"possible_self_reference": True}

        result = rule.validate(base_request)

        assert result.is_valid  # Still valid, just a warning
        assert len(result.errors) == 0
        assert len(result.warnings) == 1
        assert "Possible self-reference" in result.warnings[0]
        assert result.metadata["needs_review"] is True

    def test_high_priority(self, rule):
        """Test that rule has high priority"""
        assert rule.priority == 100

    def test_short_circuit_on_error(self, rule, base_request):
        """Test that self-reference errors cause short-circuit"""
        base_request.requester_cm_id = 12345
        base_request.requested_cm_id = 12345

        result = rule.validate(base_request)

        assert not result.is_valid
        assert rule.can_short_circuit(result) is True

    def test_no_short_circuit_on_warning(self, rule, base_request):
        """Test that warnings don't cause short-circuit"""
        base_request.metadata = {"possible_self_reference": True}

        result = rule.validate(base_request)

        assert result.is_valid
        assert rule.can_short_circuit(result) is False

    def test_empty_names_dont_match(self, rule, base_request):
        """Test that empty names don't cause false positives"""
        base_request.is_placeholder = True
        base_request.requested_cm_id = None
        base_request.metadata = {"raw_target_name": "", "requester_full_name": ""}

        result = rule.validate(base_request)

        assert result.is_valid
        assert len(result.errors) == 0

    def test_whitespace_trimmed_in_names(self, rule, base_request):
        """Test that whitespace is properly trimmed"""
        base_request.is_placeholder = True
        base_request.requested_cm_id = None
        base_request.metadata = {"raw_target_name": "  John Smith  ", "requester_full_name": "John Smith"}

        result = rule.validate(base_request)

        assert not result.is_valid
        assert result.metadata["self_ref_type"] == "full_name_match"

    def test_first_name_only_with_peers_passes(self, rule, base_request):
        """Test that first-name-only target matching requester's first name
        is NOT self-referential when other session peers have the same first name.

        When the target is just "John" and the requester is "John Smith", but there
        are other "John"s in the session, it's probably targeting one of them,
        not the requester themselves.
        """
        base_request.is_placeholder = True
        base_request.requested_cm_id = None
        base_request.metadata = {
            "raw_target_name": "John",  # First name only, no space
            "requester_first_name": "John",
            "requester_full_name": "John Smith",
            # Other people in session have the same first name
            "session_peers_with_same_first_name": 2,
        }

        result = rule.validate(base_request)

        # Should be valid because others have the same first name
        assert result.is_valid
        assert len(result.errors) == 0

    def test_first_name_only_without_peers_fails(self, rule, base_request):
        """Test that first-name-only target matching requester's first name
        IS self-referential when NO other session peers have the same first name.

        When the target is just "John" and the requester is "John Smith", and
        there are NO other "John"s in the session, this is likely self-referential.
        """
        base_request.is_placeholder = True
        base_request.requested_cm_id = None
        base_request.metadata = {
            "raw_target_name": "John",  # First name only
            "requester_first_name": "John",
            "requester_full_name": "John Smith",
            # No other people in session have the same first name
            "session_peers_with_same_first_name": 0,
        }

        result = rule.validate(base_request)

        # Should be invalid - unresolvable (no valid target in session)
        assert not result.is_valid
        assert "self_ref_type" in result.metadata
        assert result.metadata["self_ref_type"] == "unresolvable_first_name"

    def test_first_name_only_different_from_requester_passes(self, rule, base_request):
        """Test that first-name-only target NOT matching requester's first name passes.

        If the target is "Jane" but the requester is "John Smith", it's clearly
        not self-referential regardless of session peers.
        """
        base_request.is_placeholder = True
        base_request.requested_cm_id = None
        base_request.metadata = {
            "raw_target_name": "Jane",  # Different first name
            "requester_first_name": "John",
            "requester_full_name": "John Smith",
        }

        result = rule.validate(base_request)

        # Should be valid - different first names
        assert result.is_valid
        assert len(result.errors) == 0

    def test_first_name_with_peer_metadata_missing_passes(self, rule, base_request):
        """Test that missing peer metadata doesn't cause errors.

        If session_peers_with_same_first_name is not provided, the rule should
        be conservative and allow the request (avoid false positives).
        """
        base_request.is_placeholder = True
        base_request.requested_cm_id = None
        base_request.metadata = {
            "raw_target_name": "John",  # First name only
            "requester_first_name": "John",
            "requester_full_name": "John Smith",
            # Note: session_peers_with_same_first_name is NOT provided
        }

        result = rule.validate(base_request)

        # Should be valid when metadata not provided (conservative approach)
        assert result.is_valid


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
