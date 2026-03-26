"""Tests for V2 Conflict Detector

Specifically tests the session mismatch detection logic."""

from __future__ import annotations

from unittest.mock import Mock

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


def make_mock_attendee_repo(session_map: dict[int, int] | None = None) -> Mock:
    """Create a mock AttendeeRepository that returns sessions from a map.

    Args:
        session_map: {person_cm_id: session_cm_id} for bulk lookups
    """
    repo = Mock()
    session_map = session_map or {}
    repo.bulk_get_sessions_for_persons.return_value = session_map
    return repo


class TestConflictDetectorWithAttendeeRepo:
    """Tests for ConflictDetector with attendee_repo session enrichment."""

    def test_bunk_with_cross_session_via_attendee_repo_is_declined(self):
        """BUNK_WITH where target session comes from attendee_repo (not another request) → conflict."""
        attendee_repo = make_mock_attendee_repo({7777777: 1309513})  # target in Session 1
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {
                    "requester_cm_id": 4146291,
                    "person_cm_id": 7777777,
                    "session_cm_id": 1371793,  # requester in Session 3
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert result.has_conflicts
        assert len(result.conflicts) == 1
        assert result.conflicts[0].conflict_type == ConflictType.SESSION_MISMATCH
        assert result.conflicts[0].metadata["requester_session"] == 1371793
        assert result.conflicts[0].metadata["target_session"] == 1309513

    def test_bunk_with_same_session_via_attendee_repo_no_conflict(self):
        """BUNK_WITH where target is in same session per attendee_repo → no conflict."""
        attendee_repo = make_mock_attendee_repo({7777777: 1371793})  # target in same Session 3
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {
                    "requester_cm_id": 4146291,
                    "person_cm_id": 7777777,
                    "session_cm_id": 1371793,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert not result.has_conflicts

    def test_target_not_enrolled_no_conflict(self):
        """Target not in attendee_repo at all → no conflict (can't determine session)."""
        attendee_repo = make_mock_attendee_repo({})  # empty — target not enrolled
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {
                    "requester_cm_id": 4146291,
                    "person_cm_id": 7777777,
                    "session_cm_id": 1371793,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert not result.has_conflicts

    def test_no_attendee_repo_falls_back_to_existing_behavior(self):
        """Without attendee_repo, only detects conflicts where target is also a requester (existing behavior)."""
        detector = ConflictDetector()  # no attendee_repo

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {
                    "requester_cm_id": 4146291,
                    "person_cm_id": 7777777,
                    "session_cm_id": 1371793,  # Session 3
                },
            ),
            # Target NOT a requester → session unknown → no conflict
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert not result.has_conflicts

    def test_negative_placeholder_ids_skipped(self):
        """Negative/placeholder target IDs are skipped even with attendee_repo."""
        attendee_repo = make_mock_attendee_repo({-12345: 1309513})
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Unknown Person"),
                {
                    "requester_cm_id": 4146291,
                    "person_cm_id": -12345,
                    "session_cm_id": 1371793,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert not result.has_conflicts

    def test_bulk_query_batches_unknown_targets(self):
        """Attendee_repo is called once with all unknown target IDs, not per-request."""
        attendee_repo = make_mock_attendee_repo(
            {
                7777777: 1309513,
                8888888: 1309513,
            }
        )
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {"requester_cm_id": 4146291, "person_cm_id": 7777777, "session_cm_id": 1371793},
            ),
            (
                make_parsed_request("Joe Brown"),
                {"requester_cm_id": 4146291, "person_cm_id": 8888888, "session_cm_id": 1371793},
            ),
        ]

        detector.detect_conflicts(resolved_requests)

        # Should be called once with both IDs
        attendee_repo.bulk_get_sessions_for_persons.assert_called_once()
        call_args = attendee_repo.bulk_get_sessions_for_persons.call_args
        assert set(call_args[0][0]) == {7777777, 8888888}
        assert call_args[0][1] == 2026


class TestCrossSessionNotBunkWith:
    """Tests for NOT_BUNK_WITH cross-session auto-satisfy."""

    def test_not_bunk_with_cross_session_is_satisfied(self):
        """NOT_BUNK_WITH where target is in different session → CROSS_SESSION_SATISFIED."""
        attendee_repo = make_mock_attendee_repo({7777777: 1309513})  # target in Session 1
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith", request_type=RequestType.NOT_BUNK_WITH),
                {
                    "requester_cm_id": 4146291,
                    "person_cm_id": 7777777,
                    "session_cm_id": 1371793,  # requester in Session 3
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert result.has_conflicts
        assert len(result.conflicts) == 1
        assert result.conflicts[0].conflict_type == ConflictType.CROSS_SESSION_SATISFIED
        assert result.conflicts[0].auto_resolvable is True
        assert result.conflicts[0].metadata["requester_session"] == 1371793
        assert result.conflicts[0].metadata["target_session"] == 1309513

    def test_not_bunk_with_same_session_no_conflict(self):
        """NOT_BUNK_WITH where target is in same session → no conflict (normal processing)."""
        attendee_repo = make_mock_attendee_repo({7777777: 1371793})  # same session
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith", request_type=RequestType.NOT_BUNK_WITH),
                {
                    "requester_cm_id": 4146291,
                    "person_cm_id": 7777777,
                    "session_cm_id": 1371793,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert not result.has_conflicts

    def test_apply_conflict_resolution_sets_auto_satisfied(self):
        """apply_conflict_resolution sets auto_satisfied for CROSS_SESSION_SATISFIED conflicts."""
        attendee_repo = make_mock_attendee_repo({7777777: 1309513})
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith", request_type=RequestType.NOT_BUNK_WITH),
                {
                    "requester_cm_id": 4146291,
                    "person_cm_id": 7777777,
                    "session_cm_id": 1371793,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)
        modified = detector.apply_conflict_resolution(resolved_requests, result)

        _, resolution_info = modified[0]
        assert resolution_info.get("auto_satisfied") is True
        assert "requester_session" in resolution_info.get("conflict_metadata", {})
        assert "target_session" in resolution_info.get("conflict_metadata", {})

    def test_apply_conflict_resolution_bunk_with_still_sets_has_conflict(self):
        """apply_conflict_resolution still sets has_conflict for SESSION_MISMATCH (BUNK_WITH)."""
        attendee_repo = make_mock_attendee_repo({7777777: 1309513})
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith", request_type=RequestType.BUNK_WITH),
                {
                    "requester_cm_id": 4146291,
                    "person_cm_id": 7777777,
                    "session_cm_id": 1371793,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)
        modified = detector.apply_conflict_resolution(resolved_requests, result)

        _, resolution_info = modified[0]
        assert resolution_info.get("has_conflict") is True
        assert resolution_info.get("auto_satisfied") is None
