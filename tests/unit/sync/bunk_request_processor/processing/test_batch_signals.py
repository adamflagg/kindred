"""Tests for batch signal detection on resolution results."""

import logging
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


class TestBatchSignalLogging:
    """Tests for batch signal detection logging output."""

    def test_logs_summary_with_reciprocal_and_household_counts(self, caplog):
        """detect_batch_signals logs INFO summary with reciprocal pair and household co-request counts."""
        requests = [
            _req(1001, 2001, session=5001),  # A -> B
            _req(2001, 1001, session=5001),  # B -> A (reciprocal)
            _req(3001, 4001, household=9001, session=5001),  # sibling C -> target
            _req(5001, 4001, household=9001, session=5001),  # sibling D -> target
        ]
        with caplog.at_level(logging.INFO):
            detect_batch_signals(requests)

        info_messages = [r.message for r in caplog.records if r.levelno == logging.INFO]
        assert any("Batch signals:" in msg for msg in info_messages), (
            f"Expected INFO log with 'Batch signals:' but got: {info_messages}"
        )
        summary = next(msg for msg in info_messages if "Batch signals:" in msg)
        assert "1 reciprocal" in summary
        assert "2 household" in summary

    def test_logs_zero_counts_when_no_signals(self, caplog):
        """detect_batch_signals logs INFO summary even when no signals found."""
        requests = [
            _req(1001, 2001, session=5001),
            _req(3001, 4001, session=5001),
        ]
        with caplog.at_level(logging.INFO):
            detect_batch_signals(requests)

        info_messages = [r.message for r in caplog.records if r.levelno == logging.INFO]
        assert any("Batch signals:" in msg for msg in info_messages)
        summary = next(msg for msg in info_messages if "Batch signals:" in msg)
        assert "0 reciprocal" in summary
        assert "0 household" in summary

    def test_no_log_for_empty_input(self, caplog):
        """detect_batch_signals does not log when given empty input."""
        with caplog.at_level(logging.DEBUG):
            detect_batch_signals([])

        assert len(caplog.records) == 0

    def test_logs_debug_reciprocal_pair_detail(self, caplog):
        """detect_batch_signals logs DEBUG detail for each reciprocal pair."""
        requests = [
            _req(1001, 2001, session=5001),
            _req(2001, 1001, session=5001),
        ]
        with caplog.at_level(logging.DEBUG):
            detect_batch_signals(requests)

        debug_messages = [r.message for r in caplog.records if r.levelno == logging.DEBUG]
        assert any("Reciprocal pair:" in msg for msg in debug_messages), (
            f"Expected DEBUG log with 'Reciprocal pair:' but got: {debug_messages}"
        )
        detail = next(msg for msg in debug_messages if "Reciprocal pair:" in msg)
        assert "1001" in detail
        assert "2001" in detail
