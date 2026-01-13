"""Test-Driven Development for SessionCompatibilityRule

Tests the session compatibility validation."""

import sys
from pathlib import Path
from unittest.mock import Mock

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
from bunking.sync.bunk_request_processor.validation.rules.session_compatibility import (
    SessionCompatibilityRule,
)


class TestSessionCompatibilityRule:
    """Test the SessionCompatibilityRule validation"""

    @pytest.fixture
    def mock_attendee_repo(self):
        """Create a mock attendee repository"""
        return Mock()

    @pytest.fixture
    def mock_session_repo(self):
        """Create a mock session repository with friendly names"""
        repo = Mock()
        repo.get_friendly_name.side_effect = lambda x: {
            1000002: "Session 2",
            1000021: "Session 2a",
            1000023: "AG 2 (9-10)",
        }.get(x, f"Session {x}")
        return repo

    @pytest.fixture
    def rule(self, mock_attendee_repo, mock_session_repo):
        """Create a SessionCompatibilityRule with mocked dependencies"""
        return SessionCompatibilityRule(mock_attendee_repo, mock_session_repo)

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

    def test_same_session_passes(self, rule, base_request, mock_attendee_repo):
        """Test that same session requests pass"""
        # Both in Session 2
        mock_attendee_repo.get_by_person_and_year.side_effect = [
            {"person_cm_id": 12345, "session_cm_id": 1000002},  # requester
            {"person_cm_id": 67890, "session_cm_id": 1000002},  # requested
        ]

        result = rule.validate(base_request)

        assert result.is_valid
        assert len(result.errors) == 0
        assert result.metadata["session_cm_id"] == 1000002
        assert result.metadata["session_name"] == "Session 2"

    def test_different_sessions_fails(self, rule, base_request, mock_attendee_repo):
        """Test that cross-session requests fail"""
        # Requester in Session 2, requested in Session 2a
        mock_attendee_repo.get_by_person_and_year.side_effect = [
            {"person_cm_id": 12345, "session_cm_id": 1000002},  # Session 2
            {"person_cm_id": 67890, "session_cm_id": 1000021},  # Session 2a
        ]

        result = rule.validate(base_request)

        assert not result.is_valid
        assert len(result.errors) == 1
        assert "Cross-session request not allowed" in result.errors[0]
        assert "Session 2" in result.errors[0]
        assert "Session 2a" in result.errors[0]
        assert result.requires_conversion
        assert result.conversion_reason == "cross_session_request"
        assert result.metadata["requester_session"] == 1000002
        assert result.metadata["requested_session"] == 1000021

    def test_placeholder_requests_skip_validation(self, rule, base_request, mock_attendee_repo):
        """Test that placeholder requests skip validation"""
        base_request.is_placeholder = True

        result = rule.validate(base_request)

        assert result.is_valid
        assert len(result.errors) == 0
        # Should not have called repository
        mock_attendee_repo.get_by_person_and_year.assert_not_called()

    def test_age_preference_skips_validation(self, rule, base_request, mock_attendee_repo):
        """Test that age preference requests skip validation"""
        base_request.request_type = RequestType.AGE_PREFERENCE
        base_request.requested_cm_id = None

        result = rule.validate(base_request)

        assert result.is_valid
        assert len(result.errors) == 0
        mock_attendee_repo.get_by_person_and_year.assert_not_called()

    def test_missing_requester_session_warning(self, rule, base_request, mock_attendee_repo):
        """Test warning when requester session not found"""
        mock_attendee_repo.get_by_person_and_year.side_effect = [
            None,  # requester not found
            {"person_cm_id": 67890, "session_cm_id": 1000002},
        ]

        result = rule.validate(base_request)

        assert result.is_valid  # Still valid, just a warning
        assert len(result.errors) == 0
        assert len(result.warnings) == 1
        assert "Could not find session info for requester 12345" in result.warnings[0]
        assert result.metadata["requester_session_missing"] is True

    def test_missing_requested_session_warning(self, rule, base_request, mock_attendee_repo):
        """Test warning when requested person session not found"""
        mock_attendee_repo.get_by_person_and_year.side_effect = [
            {"person_cm_id": 12345, "session_cm_id": 1000002},
            None,  # requested not found
        ]

        result = rule.validate(base_request)

        assert result.is_valid
        assert len(result.errors) == 0
        assert len(result.warnings) == 1
        assert "Could not find session info for requested person 67890" in result.warnings[0]
        assert result.metadata["requested_session_missing"] is True

    def test_session_caching(self, rule, base_request, mock_attendee_repo):
        """Test that sessions are cached to avoid duplicate lookups"""
        mock_attendee_repo.get_by_person_and_year.side_effect = [
            {"person_cm_id": 12345, "session_cm_id": 1000002},
            {"person_cm_id": 67890, "session_cm_id": 1000002},
        ]

        # First validation
        rule.validate(base_request)

        # Reset mock to track new calls
        mock_attendee_repo.get_by_person_and_year.reset_mock()

        # Second validation with same people
        rule.validate(base_request)

        # Should not have made new repository calls
        mock_attendee_repo.get_by_person_and_year.assert_not_called()

    def test_high_priority(self, rule):
        """Test that rule has high priority"""
        assert rule.priority == 90

    def test_short_circuit_on_cross_session(self, rule, base_request, mock_attendee_repo):
        """Test short-circuit behavior for cross-session requests"""
        mock_attendee_repo.get_by_person_and_year.side_effect = [
            {"person_cm_id": 12345, "session_cm_id": 1000002},
            {"person_cm_id": 67890, "session_cm_id": 1000021},
        ]

        result = rule.validate(base_request)

        assert not result.is_valid
        assert rule.can_short_circuit(result) is True

    def test_no_short_circuit_on_warnings(self, rule, base_request, mock_attendee_repo):
        """Test no short-circuit on warnings"""
        mock_attendee_repo.get_by_person_and_year.side_effect = [None, None]

        result = rule.validate(base_request)

        assert result.is_valid
        assert rule.can_short_circuit(result) is False

    def test_ag_to_main_session_fails(self, rule, base_request, mock_attendee_repo):
        """Test that AG to main session requests fail"""
        # AG 2 trying to bunk with Session 2
        mock_attendee_repo.get_by_person_and_year.side_effect = [
            {"person_cm_id": 12345, "session_cm_id": 1000023},  # AG 2 (9-10)
            {"person_cm_id": 67890, "session_cm_id": 1000002},  # Session 2
        ]

        result = rule.validate(base_request)

        assert not result.is_valid
        assert "AG 2 (9-10)" in result.errors[0]
        assert "Session 2" in result.errors[0]

    def test_unknown_session_handling(self, rule, base_request, mock_attendee_repo):
        """Test handling of unknown session IDs"""
        # Use a session ID not in the mapping
        mock_attendee_repo.get_by_person_and_year.side_effect = [
            {"person_cm_id": 12345, "session_cm_id": 9999999},
            {"person_cm_id": 67890, "session_cm_id": 1000002},
        ]

        result = rule.validate(base_request)

        assert not result.is_valid
        assert "9999999" in result.errors[0]  # Should show the ID
        assert "Session 2" in result.errors[0]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
