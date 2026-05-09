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
    RequestType,
)


def make_parsed_request(
    text: str = "Someone",
    request_type: RequestType = RequestType.BUNK_WITH,
    target_name: str | None = None,
) -> ParsedRequest:
    """Helper to create a ParsedRequest with required fields.

    source_field defaults to "bunk_with" (the parent-input field) regardless
    of request_type — this models the most common production case where a
    parent types "NOT Jake" in the bunk_with column and the AI parses it as
    NOT_BUNK_WITH semantics. source_field and request_type are independent
    axes (input column vs semantic meaning); pairing NOT_BUNK_WITH with
    source_field="not_bunk_with" would only match the staff-input path, which
    isn't what these tests exercise. Once #1142 stage 3 removes the parallel
    `source` field entirely, this helper simplifies further.
    """
    return ParsedRequest(
        raw_text=text,
        request_type=request_type,
        target_name=target_name or text,
        age_preference=None,
        source_field="bunk_with",
        confidence=0.9,
        csv_position=0,
        metadata={},
    )


class TestConflictDetector:
    """Tests for ConflictDetector"""

    def test_no_conflicts_same_session(self):
        """No conflicts when requester and target are in same session"""
        detector = ConflictDetector()

        # Both requester and resolved target in same session
        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 1234567,  # Resolved Ivy
                    "session_cm_id": 1000010,  # Session 3
                },
            ),
            # Add target as a requester in the same session so we can find their session
            (
                make_parsed_request("Someone"),
                {
                    "requester_cm_id": 1234567,  # Ivy (target is now a requester)
                    "person_cm_id": 9999999,
                    "session_cm_id": 1000010,  # Same Session 3
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
                    "requester_cm_id": 1000001,
                    "person_cm_id": 1234567,  # Resolved Ivy
                    "session_cm_id": 1000010,  # Session 3
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
                    "requester_cm_id": 1000001,
                    "person_cm_id": placeholder_ivy_id,  # Unresolved placeholder
                    "session_cm_id": 1000010,  # Session 3
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
                    "session_cm_id": 1000010,
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
                    "session_cm_id": 1000010,
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
        attendee_repo = make_mock_attendee_repo({7777777: 1000020})  # target in Session 1
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 7777777,
                    "session_cm_id": 1000010,  # requester in Session 3
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert result.has_conflicts
        assert len(result.conflicts) == 1
        assert result.conflicts[0].conflict_type == ConflictType.SESSION_MISMATCH
        assert result.conflicts[0].metadata["requester_session"] == 1000010
        assert result.conflicts[0].metadata["target_session"] == 1000020

    def test_bunk_with_same_session_via_attendee_repo_no_conflict(self):
        """BUNK_WITH where target is in same session per attendee_repo → no conflict."""
        attendee_repo = make_mock_attendee_repo({7777777: 1000010})  # target in same Session 3
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 7777777,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert not result.has_conflicts

    def test_target_not_enrolled_is_declined(self):
        """Target with no bunking session enrollment → TARGET_NOT_ENROLLED conflict."""
        attendee_repo = make_mock_attendee_repo({})  # empty — target not enrolled
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 7777777,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert result.has_conflicts
        assert len(result.conflicts) == 1
        assert result.conflicts[0].conflict_type == ConflictType.TARGET_NOT_ENROLLED

    def test_no_attendee_repo_falls_back_to_existing_behavior(self):
        """Without attendee_repo, only detects conflicts where target is also a requester (existing behavior)."""
        detector = ConflictDetector()  # no attendee_repo

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 7777777,
                    "session_cm_id": 1000010,  # Session 3
                },
            ),
            # Target NOT a requester → session unknown → no conflict
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert not result.has_conflicts

    def test_negative_placeholder_ids_skipped(self):
        """Negative/placeholder target IDs are skipped even with attendee_repo."""
        attendee_repo = make_mock_attendee_repo({-12345: 1000020})
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Unknown Person"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": -12345,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert not result.has_conflicts

    def test_bulk_query_batches_unknown_targets(self):
        """Attendee_repo is called once with all unknown target IDs, not per-request."""
        attendee_repo = make_mock_attendee_repo(
            {
                7777777: 1000020,
                8888888: 1000020,
            }
        )
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {"requester_cm_id": 1000001, "person_cm_id": 7777777, "session_cm_id": 1000010},
            ),
            (
                make_parsed_request("Joe Brown"),
                {"requester_cm_id": 1000001, "person_cm_id": 8888888, "session_cm_id": 1000010},
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
        attendee_repo = make_mock_attendee_repo({7777777: 1000020})  # target in Session 1
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith", request_type=RequestType.NOT_BUNK_WITH),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 7777777,
                    "session_cm_id": 1000010,  # requester in Session 3
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert result.has_conflicts
        assert len(result.conflicts) == 1
        assert result.conflicts[0].conflict_type == ConflictType.CROSS_SESSION_SATISFIED
        assert result.conflicts[0].auto_resolvable is True
        assert result.conflicts[0].metadata["requester_session"] == 1000010
        assert result.conflicts[0].metadata["target_session"] == 1000020

    def test_not_bunk_with_same_session_no_conflict(self):
        """NOT_BUNK_WITH where target is in same session → no conflict (normal processing)."""
        attendee_repo = make_mock_attendee_repo({7777777: 1000010})  # same session
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith", request_type=RequestType.NOT_BUNK_WITH),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 7777777,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert not result.has_conflicts

    def test_apply_conflict_resolution_sets_conflict_type_for_cross_session(self):
        """apply_conflict_resolution sets conflict_type for CROSS_SESSION_SATISFIED conflicts."""
        attendee_repo = make_mock_attendee_repo({7777777: 1000020})
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith", request_type=RequestType.NOT_BUNK_WITH),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 7777777,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)
        modified = detector.apply_conflict_resolution(resolved_requests, result)

        _, resolution_info = modified[0]
        assert resolution_info.get("has_conflict") is True
        assert resolution_info.get("conflict_type") == "cross_session_satisfied"
        assert "requester_session" in resolution_info.get("conflict_metadata", {})
        assert "target_session" in resolution_info.get("conflict_metadata", {})

    def test_apply_conflict_resolution_bunk_with_still_sets_has_conflict(self):
        """apply_conflict_resolution still sets has_conflict for SESSION_MISMATCH (BUNK_WITH)."""
        attendee_repo = make_mock_attendee_repo({7777777: 1000020})
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith", request_type=RequestType.BUNK_WITH),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 7777777,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)
        modified = detector.apply_conflict_resolution(resolved_requests, result)

        _, resolution_info = modified[0]
        assert resolution_info.get("has_conflict") is True
        assert resolution_info.get("conflict_type") == "session_mismatch"


class TestTargetNotEnrolled:
    """Tests for TARGET_NOT_ENROLLED conflict type."""

    def test_bunk_with_target_no_bunking_enrollment_declined(self):
        """Target with no bunking session enrollment → TARGET_NOT_ENROLLED."""
        attendee_repo = make_mock_attendee_repo({})  # empty — target not found
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {
                    "requester_cm_id": 1111,
                    "session_cm_id": 1000010,
                    "person_cm_id": 9999,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)
        modified = detector.apply_conflict_resolution(resolved_requests, result)
        _, resolution_info = modified[0]

        assert resolution_info.get("has_conflict") is True
        assert resolution_info.get("conflict_type") == "target_not_enrolled"

    def test_target_waitlisted_for_bunking_no_decline(self):
        """Target waitlisted for a bunking session → no conflict (keep PENDING)."""
        # Enrichment returns the session even for waitlisted (status-aware enrichment includes them)
        attendee_repo = make_mock_attendee_repo({9999: 1000010})
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {
                    "requester_cm_id": 1111,
                    "session_cm_id": 1000010,
                    "person_cm_id": 9999,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)
        assert not result.has_conflicts  # same session, no conflict

    def test_not_bunk_with_target_not_enrolled_also_declined(self):
        """NOT_BUNK_WITH with target not enrolled → TARGET_NOT_ENROLLED (no need for constraint)."""
        attendee_repo = make_mock_attendee_repo({})
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith", request_type=RequestType.NOT_BUNK_WITH),
                {
                    "requester_cm_id": 1111,
                    "session_cm_id": 1000010,
                    "person_cm_id": 9999,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)
        assert result.has_conflicts
        assert result.conflicts[0].conflict_type == ConflictType.TARGET_NOT_ENROLLED

    def test_no_attendee_repo_skips_not_enrolled_check(self):
        """Without attendee_repo, can't detect target-not-enrolled."""
        detector = ConflictDetector()  # no attendee_repo

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {
                    "requester_cm_id": 1111,
                    "session_cm_id": 1000010,
                    "person_cm_id": 9999,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)
        assert not result.has_conflicts


class TestAGSiloCrossSession:
    """Tests that AG sessions are treated as a separate silo for cross-session conflicts."""

    def test_bunk_with_ag_target_non_ag_requester_declined(self):
        """Requester in main session, target in AG → SESSION_MISMATCH."""
        attendee_repo = make_mock_attendee_repo({7777: 1000099})  # AG session
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("AG Kid"),
                {
                    "requester_cm_id": 1111,
                    "session_cm_id": 1000010,  # main session
                    "person_cm_id": 7777,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)
        assert result.has_conflicts
        assert result.conflicts[0].conflict_type == ConflictType.SESSION_MISMATCH

    def test_not_bunk_with_ag_cross_auto_resolved(self):
        """NOT_BUNK_WITH across AG/non-AG → CROSS_SESSION_SATISFIED."""
        attendee_repo = make_mock_attendee_repo({7777: 1000099})  # AG session
        detector = ConflictDetector(attendee_repo=attendee_repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("AG Kid", request_type=RequestType.NOT_BUNK_WITH),
                {
                    "requester_cm_id": 1111,
                    "session_cm_id": 1000010,  # main session
                    "person_cm_id": 7777,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)
        modified = detector.apply_conflict_resolution(resolved_requests, result)
        _, resolution_info = modified[0]
        assert resolution_info.get("has_conflict") is True
        assert resolution_info.get("conflict_type") == "cross_session_satisfied"


class TestEnrollmentAwareConflicts:
    """Tests for enrollment-status-aware conflict detection."""

    def _make_mock_attendee_repo(self, enrollment_map=None, sessions_map=None):
        """Create mock attendee repo with both old and new methods."""
        repo = Mock()
        repo.bulk_get_sessions_for_persons.return_value = sessions_map or {}
        repo.bulk_get_enrollment_for_persons.return_value = enrollment_map or {}
        return repo

    def test_cancelled_target_creates_not_attending_conflict(self):
        """Target with cancelled enrollment -> TARGET_NOT_ATTENDING conflict."""
        from bunking.sync.bunk_request_processor.core.models import EnrollmentInfo

        enrollment_map = {
            1234567: EnrollmentInfo(session_cm_id=1000010, status_id=32),  # cancelled
        }
        # bulk_get_sessions_for_persons has no status filter — returns cancelled targets too
        sessions_map = {1234567: 1000010}
        repo = self._make_mock_attendee_repo(enrollment_map=enrollment_map, sessions_map=sessions_map)
        detector = ConflictDetector(attendee_repo=repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Emma Johnson"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 1234567,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert result.has_conflicts
        conflict = result.conflicts[0]
        assert conflict.conflict_type == ConflictType.TARGET_NOT_ATTENDING
        assert conflict.auto_resolvable is True
        assert conflict.person_b_cm_id == 1234567

    def test_waitlisted_target_no_conflict(self):
        """Target with waitlisted enrollment -> no enrollment-related conflict."""
        from bunking.sync.bunk_request_processor.core.models import EnrollmentInfo

        enrollment_map = {
            1234567: EnrollmentInfo(session_cm_id=1000010, status_id=8),  # waitlisted
        }
        sessions_map = {1234567: 1000010}
        repo = self._make_mock_attendee_repo(enrollment_map=enrollment_map, sessions_map=sessions_map)
        detector = ConflictDetector(attendee_repo=repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Olivia Chen"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 1234567,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        not_attending = [c for c in result.conflicts if c.conflict_type == ConflictType.TARGET_NOT_ATTENDING]
        assert len(not_attending) == 0

    def test_enrolled_target_unchanged(self):
        """Enrolled target -> no enrollment-related conflict (existing behavior)."""
        from bunking.sync.bunk_request_processor.core.models import EnrollmentInfo

        enrollment_map = {
            1234567: EnrollmentInfo(session_cm_id=1000010, status_id=2),  # enrolled
        }
        sessions_map = {1234567: 1000010}
        repo = self._make_mock_attendee_repo(enrollment_map=enrollment_map, sessions_map=sessions_map)
        detector = ConflictDetector(attendee_repo=repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 1234567,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert not result.has_conflicts

    def test_unenrolled_target_still_detected(self):
        """Target with no bunking enrollment -> TARGET_NOT_ENROLLED (existing behavior preserved)."""
        enrollment_map: dict[int, object] = {}
        sessions_map: dict[int, int] = {}
        repo = self._make_mock_attendee_repo(enrollment_map=enrollment_map, sessions_map=sessions_map)
        detector = ConflictDetector(attendee_repo=repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Unknown Person"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 9999999,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert result.has_conflicts
        conflict = result.conflicts[0]
        assert conflict.conflict_type == ConflictType.TARGET_NOT_ENROLLED

    def test_dismissed_target_creates_not_attending(self):
        """Dismissed (status_id=64) treated same as cancelled."""
        from bunking.sync.bunk_request_processor.core.models import EnrollmentInfo

        enrollment_map = {
            1234567: EnrollmentInfo(session_cm_id=1000010, status_id=64),
        }
        # bulk_get_sessions_for_persons has no status filter — returns dismissed targets too
        sessions_map = {1234567: 1000010}
        repo = self._make_mock_attendee_repo(enrollment_map=enrollment_map, sessions_map=sessions_map)
        detector = ConflictDetector(attendee_repo=repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Dismissed Kid"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 1234567,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        assert result.has_conflicts
        assert result.conflicts[0].conflict_type == ConflictType.TARGET_NOT_ATTENDING

    def test_not_attending_conflict_is_auto_resolvable(self):
        """TARGET_NOT_ATTENDING conflicts have auto_resolvable=True and include status metadata."""
        from bunking.sync.bunk_request_processor.core.models import EnrollmentInfo

        enrollment_map = {
            1234567: EnrollmentInfo(session_cm_id=1000010, status_id=32),
        }
        # bulk_get_sessions_for_persons has no status filter — returns cancelled targets too
        sessions_map = {1234567: 1000010}
        repo = self._make_mock_attendee_repo(enrollment_map=enrollment_map, sessions_map=sessions_map)
        detector = ConflictDetector(attendee_repo=repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Emma Johnson"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 1234567,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        conflict = result.conflicts[0]
        assert conflict.auto_resolvable is True
        assert conflict.metadata["target_status_id"] == 32

    def test_applied_target_no_conflict(self):
        """Applied target (status_id=4) -> no enrollment-related conflict, same as waitlisted."""
        from bunking.sync.bunk_request_processor.core.models import EnrollmentInfo

        enrollment_map = {
            1234567: EnrollmentInfo(session_cm_id=1000010, status_id=4),  # applied
        }
        sessions_map = {1234567: 1000010}
        repo = self._make_mock_attendee_repo(enrollment_map=enrollment_map, sessions_map=sessions_map)
        detector = ConflictDetector(attendee_repo=repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Ivy Smith"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 1234567,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        not_attending = [c for c in result.conflicts if c.conflict_type == ConflictType.TARGET_NOT_ATTENDING]
        assert len(not_attending) == 0

    def test_waitlisted_target_annotated_after_apply(self):
        """Waitlisted target gets target_waitlisted=True metadata after apply_conflict_resolution."""
        from bunking.sync.bunk_request_processor.core.models import EnrollmentInfo

        enrollment_map = {
            1234567: EnrollmentInfo(session_cm_id=1000010, status_id=8),  # waitlisted
        }
        sessions_map = {1234567: 1000010}
        repo = self._make_mock_attendee_repo(enrollment_map=enrollment_map, sessions_map=sessions_map)
        detector = ConflictDetector(attendee_repo=repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Olivia Chen"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 1234567,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)
        modified = detector.apply_conflict_resolution(resolved_requests, result)
        _, resolution_info = modified[0]

        assert resolution_info.get("target_waitlisted") is True

    def test_apply_conflict_resolution_not_attending_auto_resolvable(self):
        """TARGET_NOT_ATTENDING resolution_info preserves auto_resolvable=True."""
        from bunking.sync.bunk_request_processor.core.models import EnrollmentInfo

        enrollment_map = {
            1234567: EnrollmentInfo(session_cm_id=1000010, status_id=32),  # cancelled
        }
        sessions_map = {1234567: 1000010}
        repo = self._make_mock_attendee_repo(enrollment_map=enrollment_map, sessions_map=sessions_map)
        detector = ConflictDetector(attendee_repo=repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Emma Johnson"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 1234567,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)
        modified = detector.apply_conflict_resolution(resolved_requests, result)
        _, resolution_info = modified[0]

        assert resolution_info.get("has_conflict") is True
        assert resolution_info.get("conflict_type") == "target_not_attending"
        assert resolution_info.get("auto_resolvable") is True

    def test_cancelled_requester_creates_not_attending_conflict(self):
        """Requester with cancelled enrollment -> REQUESTER_NOT_ATTENDING conflict."""
        from bunking.sync.bunk_request_processor.core.models import EnrollmentInfo

        enrollment_map = {
            1000001: EnrollmentInfo(session_cm_id=1000010, status_id=32),  # requester cancelled
            1234567: EnrollmentInfo(session_cm_id=1000010, status_id=2),  # target enrolled
        }
        sessions_map = {1000001: 1000010, 1234567: 1000010}
        repo = self._make_mock_attendee_repo(enrollment_map=enrollment_map, sessions_map=sessions_map)
        detector = ConflictDetector(attendee_repo=repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Olivia Chen"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 1234567,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        requester_conflicts = [c for c in result.conflicts if c.conflict_type == ConflictType.REQUESTER_NOT_ATTENDING]
        assert len(requester_conflicts) == 1
        assert requester_conflicts[0].person_a_cm_id == 1000001
        assert requester_conflicts[0].auto_resolvable is True

    def test_enrolled_requester_no_conflict(self):
        """Enrolled requester -> no REQUESTER_NOT_ATTENDING conflict."""
        from bunking.sync.bunk_request_processor.core.models import EnrollmentInfo

        enrollment_map = {
            1000001: EnrollmentInfo(session_cm_id=1000010, status_id=2),  # requester enrolled
            1234567: EnrollmentInfo(session_cm_id=1000010, status_id=2),  # target enrolled
        }
        sessions_map = {1000001: 1000010, 1234567: 1000010}
        repo = self._make_mock_attendee_repo(enrollment_map=enrollment_map, sessions_map=sessions_map)
        detector = ConflictDetector(attendee_repo=repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Olivia Chen"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 1234567,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        requester_conflicts = [c for c in result.conflicts if c.conflict_type == ConflictType.REQUESTER_NOT_ATTENDING]
        assert len(requester_conflicts) == 0

    def test_ghost_record_both_sides_not_attending(self):
        """Neither requester nor target enrolled -> target conflict wins, no double-conflict."""
        from bunking.sync.bunk_request_processor.core.models import EnrollmentInfo

        enrollment_map = {
            1000001: EnrollmentInfo(session_cm_id=1000010, status_id=32),  # requester cancelled
            1234567: EnrollmentInfo(session_cm_id=1000010, status_id=32),  # target cancelled
        }
        sessions_map = {1000001: 1000010, 1234567: 1000010}
        repo = self._make_mock_attendee_repo(enrollment_map=enrollment_map, sessions_map=sessions_map)
        detector = ConflictDetector(attendee_repo=repo, year=2026)

        resolved_requests = [
            (
                make_parsed_request("Olivia Chen"),
                {
                    "requester_cm_id": 1000001,
                    "person_cm_id": 1234567,
                    "session_cm_id": 1000010,
                },
            ),
        ]

        result = detector.detect_conflicts(resolved_requests)

        requester_conflicts = [c for c in result.conflicts if c.conflict_type == ConflictType.REQUESTER_NOT_ATTENDING]
        target_conflicts = [c for c in result.conflicts if c.conflict_type == ConflictType.TARGET_NOT_ATTENDING]
        # Target is detected first, so requester detection skips this already-flagged index
        assert len(target_conflicts) == 1
        assert len(requester_conflicts) == 0
