"""Tests for batch signal detection on resolution results."""

import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import RequestType
from bunking.sync.bunk_request_processor.processing.batch_signals import (
    ResolvedRequest,
    detect_batch_signals,
)


def _req(requester=1001, target=2001, rtype=RequestType.BUNK_WITH, session=5001, household=None):
    return ResolvedRequest(
        requester_cm_id=requester,
        target_cm_id=target,
        request_type=rtype,
        session_cm_id=session,
        household_id=household,
    )


class TestReciprocalDetection:
    def test_simple_reciprocal_pair(self):
        """A->B and B->A in same session = reciprocal."""
        requests = [_req(1001, 2001, session=5001), _req(2001, 1001, session=5001)]
        signals = detect_batch_signals(requests)
        assert signals[(1001, 2001, 5001)].is_reciprocal is True
        assert signals[(2001, 1001, 5001)].is_reciprocal is True
        assert signals[(1001, 2001, 5001)].reciprocal_with == 2001
        assert signals[(2001, 1001, 5001)].reciprocal_with == 1001

    def test_no_reciprocal_one_direction(self):
        """A->B without B->A is not reciprocal."""
        requests = [_req(1001, 2001)]
        signals = detect_batch_signals(requests)
        assert signals[(1001, 2001, 5001)].is_reciprocal is False

    def test_cross_session_not_reciprocal(self):
        """A->B in session 1, B->A in session 2 = NOT reciprocal."""
        requests = [_req(1001, 2001, session=5001), _req(2001, 1001, session=5002)]
        signals = detect_batch_signals(requests)
        assert signals[(1001, 2001, 5001)].is_reciprocal is False
        assert signals[(2001, 1001, 5002)].is_reciprocal is False

    def test_not_bunk_with_reciprocal(self):
        """NOT_BUNK_WITH reciprocals also detected."""
        requests = [
            _req(1001, 2001, rtype=RequestType.NOT_BUNK_WITH),
            _req(2001, 1001, rtype=RequestType.NOT_BUNK_WITH),
        ]
        signals = detect_batch_signals(requests)
        assert signals[(1001, 2001, 5001)].is_reciprocal is True

    def test_empty_input(self):
        assert detect_batch_signals([]) == {}

    def test_multiple_reciprocal_pairs(self):
        requests = [
            _req(1001, 2001),
            _req(2001, 1001),
            _req(3001, 4001),
            _req(4001, 3001),
        ]
        signals = detect_batch_signals(requests)
        assert signals[(1001, 2001, 5001)].is_reciprocal is True
        assert signals[(3001, 4001, 5001)].is_reciprocal is True


class TestHouseholdCoRequest:
    def test_siblings_request_same_target(self):
        """Two siblings (same household) request same target."""
        requests = [
            _req(1001, 3001, household=9001),
            _req(2001, 3001, household=9001),
        ]
        signals = detect_batch_signals(requests)
        assert signals[(1001, 3001, 5001)].household_co_request is True
        assert signals[(2001, 3001, 5001)].household_co_request is True

    def test_different_households_no_signal(self):
        requests = [
            _req(1001, 3001, household=9001),
            _req(2001, 3001, household=9002),
        ]
        signals = detect_batch_signals(requests)
        assert signals[(1001, 3001, 5001)].household_co_request is False

    def test_no_household_no_signal(self):
        requests = [
            _req(1001, 3001, household=None),
            _req(2001, 3001, household=None),
        ]
        signals = detect_batch_signals(requests)
        assert signals[(1001, 3001, 5001)].household_co_request is False

    def test_same_person_not_co_request(self):
        """Same requester twice is NOT a household co-request."""
        requests = [
            _req(1001, 3001, household=9001, session=5001),
            _req(1001, 3001, household=9001, session=5002),
        ]
        signals = detect_batch_signals(requests)
        assert signals[(1001, 3001, 5001)].household_co_request is False

    def test_reciprocal_and_household_combined(self):
        """Request that is both reciprocal and household co-request."""
        requests = [
            _req(1001, 3001, household=9001, session=5001),  # sibling A -> target
            _req(2001, 3001, household=9001, session=5001),  # sibling B -> target
            _req(3001, 1001, session=5001),  # target -> sibling A (reciprocal)
        ]
        signals = detect_batch_signals(requests)
        assert signals[(1001, 3001, 5001)].is_reciprocal is True
        assert signals[(1001, 3001, 5001)].household_co_request is True
