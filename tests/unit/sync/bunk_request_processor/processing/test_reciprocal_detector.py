"""Test-Driven Development for ReciprocalDetector

Tests the detection of reciprocal bunk requests."""

import sys
from pathlib import Path

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
from bunking.sync.bunk_request_processor.processing.reciprocal_detector import (
    ReciprocalDetector,
)


class TestReciprocalDetector:
    """Test the ReciprocalDetector"""

    @pytest.fixture
    def detector(self):
        """Create a ReciprocalDetector"""
        return ReciprocalDetector()

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

    def test_detect_simple_reciprocal(self, detector, base_request):
        """Test detecting a simple reciprocal pair"""
        # Create reciprocal request
        reciprocal = BunkRequest(
            requester_cm_id=67890,  # Swapped
            requested_cm_id=12345,  # Swapped
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=2,
            confidence_score=0.88,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        requests = [base_request, reciprocal]
        pairs = detector.detect_reciprocals(requests)

        assert len(pairs) == 1
        pair = pairs[0]
        assert pair.request1 == base_request
        assert pair.request2 == reciprocal
        assert pair.is_mutual is True
        assert pair.combined_priority == 5  # 3 + 2
        assert pair.confidence_boost == 0.1  # Default boost

    def test_no_reciprocal_different_types(self, detector, base_request):
        """Test that different request types don't form reciprocals"""
        not_reciprocal = BunkRequest(
            requester_cm_id=67890,
            requested_cm_id=12345,
            request_type=RequestType.NOT_BUNK_WITH,  # Different type
            session_cm_id=1000002,
            priority=4,
            confidence_score=0.90,
            source=RequestSource.STAFF,
            source_field="do_not_share_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        requests = [base_request, not_reciprocal]
        pairs = detector.detect_reciprocals(requests)

        assert len(pairs) == 0

    def test_no_reciprocal_different_sessions(self, detector, base_request):
        """Test that different sessions don't form reciprocals"""
        different_session = BunkRequest(
            requester_cm_id=67890,
            requested_cm_id=12345,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000021,  # Different session
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

        requests = [base_request, different_session]
        pairs = detector.detect_reciprocals(requests)

        assert len(pairs) == 0

    def test_multiple_reciprocal_pairs(self, detector):
        """Test detecting multiple reciprocal pairs"""
        requests = [
            # First pair
            BunkRequest(
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
                metadata={},
            ),
            BunkRequest(
                requester_cm_id=200,
                requested_cm_id=100,
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
            ),
            # Second pair
            BunkRequest(
                requester_cm_id=300,
                requested_cm_id=400,
                request_type=RequestType.BUNK_WITH,
                session_cm_id=1000002,
                priority=4,
                confidence_score=0.90,
                source=RequestSource.FAMILY,
                source_field="share_bunk_with",
                csv_position=0,
                year=2025,
                status=RequestStatus.RESOLVED,
                is_placeholder=False,
                metadata={},
            ),
            BunkRequest(
                requester_cm_id=400,
                requested_cm_id=300,
                request_type=RequestType.BUNK_WITH,
                session_cm_id=1000002,
                priority=2,
                confidence_score=0.85,
                source=RequestSource.STAFF,
                source_field="internal_notes",
                csv_position=0,
                year=2025,
                status=RequestStatus.RESOLVED,
                is_placeholder=False,
                metadata={},
            ),
        ]

        pairs = detector.detect_reciprocals(requests)

        assert len(pairs) == 2
        # Check first pair
        assert pairs[0].request1.requester_cm_id == 100
        assert pairs[0].request2.requester_cm_id == 200
        # Check second pair
        assert pairs[1].request1.requester_cm_id == 300
        assert pairs[1].request2.requester_cm_id == 400

    def test_apply_confidence_boost(self, detector, base_request):
        """Test applying confidence boost to reciprocal pairs"""
        reciprocal = BunkRequest(
            requester_cm_id=67890,
            requested_cm_id=12345,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.80,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        requests = [base_request, reciprocal]
        detector.apply_reciprocal_boost(requests)

        # Check that confidence was boosted
        assert base_request.confidence_score == min(1.0, 0.95 + 0.1)  # 1.0 max
        assert reciprocal.confidence_score == 0.80 + 0.1  # 0.90

        # Check metadata was updated
        assert base_request.metadata["is_reciprocal"] is True
        assert base_request.metadata["reciprocal_with"] == 67890
        assert reciprocal.metadata["is_reciprocal"] is True
        assert reciprocal.metadata["reciprocal_with"] == 12345

    def test_no_duplicate_pairs(self, detector):
        """Test that pairs are not duplicated (A->B and B->A are the same pair)"""
        requests = [
            BunkRequest(
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
                metadata={},
            ),
            BunkRequest(
                requester_cm_id=200,
                requested_cm_id=100,
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
            ),
        ]

        pairs = detector.detect_reciprocals(requests)

        # Should only have one pair, not two
        assert len(pairs) == 1

    def test_placeholder_requests_ignored(self, detector, base_request):
        """Test that placeholder requests are ignored"""
        placeholder = BunkRequest(
            requester_cm_id=67890,
            requested_cm_id=None,  # Placeholder
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.50,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.PENDING,
            is_placeholder=True,
            metadata={"raw_target_name": "John Doe"},
        )

        requests = [base_request, placeholder]
        pairs = detector.detect_reciprocals(requests)

        assert len(pairs) == 0

    def test_age_preference_ignored(self, detector):
        """Test that age preference requests are ignored"""
        age_pref1 = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=4,
            confidence_score=1.0,
            source=RequestSource.FAMILY,
            source_field="bunk_preference",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"preference_value": "younger"},
        )

        age_pref2 = BunkRequest(
            requester_cm_id=200,
            requested_cm_id=None,
            request_type=RequestType.AGE_PREFERENCE,
            session_cm_id=1000002,
            priority=4,
            confidence_score=1.0,
            source=RequestSource.FAMILY,
            source_field="bunk_preference",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={"preference_value": "older"},
        )

        requests = [age_pref1, age_pref2]
        pairs = detector.detect_reciprocals(requests)

        assert len(pairs) == 0

    def test_custom_confidence_boost(self, detector):
        """Test using custom confidence boost value"""
        detector = ReciprocalDetector(confidence_boost=0.2)

        request1 = BunkRequest(
            requester_cm_id=100,
            requested_cm_id=200,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.70,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        request2 = BunkRequest(
            requester_cm_id=200,
            requested_cm_id=100,
            request_type=RequestType.BUNK_WITH,
            session_cm_id=1000002,
            priority=3,
            confidence_score=0.70,
            source=RequestSource.FAMILY,
            source_field="share_bunk_with",
            csv_position=0,
            year=2025,
            status=RequestStatus.RESOLVED,
            is_placeholder=False,
            metadata={},
        )

        requests = [request1, request2]
        detector.apply_reciprocal_boost(requests)

        # Check custom boost was applied
        assert abs(request1.confidence_score - 0.90) < 0.001  # 0.70 + 0.20
        assert abs(request2.confidence_score - 0.90) < 0.001  # 0.70 + 0.20


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
