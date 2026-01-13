"""Tests for V2 Conflict Detector

Specifically tests the session mismatch detection logic."""

from __future__ import annotations

from bunking.sync.bunk_request_processor.conflict.conflict_detector import (
    ConflictDetector,
    ConflictType,
)
from bunking.sync.bunk_request_processor.core.models import (
    ParsedRequest,
    RequestSource,
    RequestType,
)


def make_parsed_request(
    text: str = "Someone",
    request_type: RequestType = RequestType.BUNK_WITH,
    target_name: str | None = None,
) -> ParsedRequest:
    """Helper to create a ParsedRequest with required fields"""
    return ParsedRequest(
        raw_text=text,
        request_type=request_type,
        target_name=target_name or text,
        age_preference=None,
        source_field="share_bunk_with",
        source=RequestSource.FAMILY,
        confidence=0.9,
        csv_position=0,
        metadata={},
    )


class TestConflictDetector:
    """Tests for ConflictDetector"""

    def test_no_conflicts_same_session(self):
        """No conflicts when requester and target are in same session"""
        detector = ConflictDetector()

        # Both Eden and resolved target in Session 3
        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {
                    "requester_cm_id": 4146291,  # Eden
                    "person_cm_id": 1234567,  # Resolved Ivy
                    "session_cm_id": 1371793,  # Session 3
                },
            ),
            # Add target as a requester in the same session so we can find their session
            (
                make_parsed_request("Someone"),
                {
                    "requester_cm_id": 1234567,  # Ivy (target is now a requester)
                    "person_cm_id": 9999999,
                    "session_cm_id": 1371793,  # Same Session 3
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert not result.has_conflicts
        assert len(result.conflicts) == 0

    def test_conflict_different_sessions_resolved_targets(self):
        """Detect conflict when requester and resolved target are in different sessions"""
        detector = ConflictDetector()

        # Eden in Session 3, resolved target in Session 2
        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {
                    "requester_cm_id": 4146291,  # Eden
                    "person_cm_id": 1234567,  # Resolved Ivy
                    "session_cm_id": 1371793,  # Session 3
                },
            ),
            # Add target as a requester in different session
            (
                make_parsed_request("Someone"),
                {
                    "requester_cm_id": 1234567,  # Ivy
                    "person_cm_id": 9999999,
                    "session_cm_id": 1000024,  # Session 2 - DIFFERENT!
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert result.has_conflicts
        assert len(result.conflicts) == 1
        assert result.conflicts[0].conflict_type == ConflictType.SESSION_MISMATCH

    def test_no_false_conflict_for_unresolved_placeholder_ids(self):
        """REGRESSION TEST: Negative placeholder IDs should NOT trigger false session conflicts.

        Bug scenario:
        - Eden (Session 3) requests "Ivy" -> unresolved, placeholder -808318632
        - A.l Lange (AG Session 2) also requests "Ivy" -> same placeholder -808318632
        - OLD BUG: Detector would find A.l's request and incorrectly use A.l's session
          as "Ivy's session", causing false session mismatch for Eden
        - FIX: Skip conflict detection for negative (placeholder) person_cm_ids
        """
        detector = ConflictDetector()

        placeholder_ivy_id = -808318632  # Hash placeholder for unresolved "Ivy"

        resolved_requests = [
            # Eden in Session 3 requests unresolved "Ivy"
            (
                make_parsed_request("Ivy"),
                {
                    "requester_cm_id": 4146291,  # Eden
                    "person_cm_id": placeholder_ivy_id,  # Unresolved placeholder
                    "session_cm_id": 1371793,  # Session 3
                },
            ),
            # A.l Lange in AG Session 2 also requests unresolved "Ivy"
            (
                make_parsed_request("Ivy"),
                {
                    "requester_cm_id": 18345017,  # A.l Lange
                    "person_cm_id": placeholder_ivy_id,  # Same unresolved placeholder
                    "session_cm_id": 1000024,  # AG Session 2 - DIFFERENT SESSION
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        # Should NOT have conflicts - we don't know Ivy's actual session
        # because she wasn't resolved to a real person
        assert not result.has_conflicts, (
            f"False session conflict detected for unresolved placeholder ID. "
            f"Conflicts: {[c.description for c in result.conflicts]}"
        )

    def test_negative_person_cm_id_always_skipped(self):
        """Any negative person_cm_id should be skipped in conflict detection"""
        detector = ConflictDetector()

        resolved_requests = [
            (
                make_parsed_request("Unknown Person"),
                {
                    "requester_cm_id": 1111111,
                    "person_cm_id": -999999,  # Negative = placeholder
                    "session_cm_id": 1371793,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        # Should not crash and should not flag conflicts for unresolved targets
        assert not result.has_conflicts

    def test_skip_non_bunk_with_requests(self):
        """Only BUNK_WITH requests should be checked for session conflicts"""
        detector = ConflictDetector()

        resolved_requests = [
            (
                make_parsed_request("Someone", request_type=RequestType.NOT_BUNK_WITH),
                {
                    "requester_cm_id": 1111111,
                    "person_cm_id": 2222222,
                    "session_cm_id": 1371793,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        # NOT_BUNK_WITH requests shouldn't be tracked for session conflicts
        assert not result.has_conflicts
