"""Tests for post-resolution disposition rules.

Rules only apply to resolved matches (person found). Unresolved names
are PENDING by definition — handled upstream in request_builder — with
one exception: stale dated notes (#1801) decline even when unresolved.
"""

import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
sys.path.insert(0, str(project_root))

from bunking.sync.bunk_request_processor.core.models import RequestStatus, RequestType
from bunking.sync.bunk_request_processor.disposition.disposition_rules import (
    determine_disposition,
)


class TestBunkWithBusinessGates:
    """Rules 1-3: Business gates for BUNK_WITH (require resolved match)."""

    def test_inactive_target_declined(self):
        d = determine_disposition(RequestType.BUNK_WITH, target_is_inactive=True)
        assert d.status == RequestStatus.DECLINED
        assert d.reason == "target_not_attending"

    def test_no_bunking_session_declined(self):
        d = determine_disposition(RequestType.BUNK_WITH, target_has_bunking_session=False)
        assert d.status == RequestStatus.DECLINED
        assert d.reason == "target_not_enrolled"

    def test_waitlisted_target_pending(self):
        d = determine_disposition(RequestType.BUNK_WITH, target_waitlisted=True)
        assert d.status == RequestStatus.PENDING
        assert d.reason == "target_waitlisted"

    def test_session_mismatch_declined(self):
        d = determine_disposition(RequestType.BUNK_WITH, session_match=False)
        assert d.status == RequestStatus.DECLINED
        assert d.reason == "session_mismatch"


class TestBunkWithResolutionQuality:
    """Rules 4-7: Resolution quality checks for BUNK_WITH."""

    def test_exact_match_resolved(self):
        d = determine_disposition(RequestType.BUNK_WITH, resolution_method="exact_match")
        assert d.status == RequestStatus.RESOLVED
        assert d.reason == "exact_match"

    def test_reciprocal_resolved(self):
        d = determine_disposition(
            RequestType.BUNK_WITH,
            resolution_method="fuzzy_match",
            match_confidence=0.75,
            is_reciprocal=True,
        )
        assert d.status == RequestStatus.RESOLVED
        assert d.reason == "reciprocal_match"

    def test_high_confidence_resolved(self):
        d = determine_disposition(
            RequestType.BUNK_WITH,
            resolution_method="fuzzy_match",
            match_confidence=0.85,
        )
        assert d.status == RequestStatus.RESOLVED
        assert d.reason == "high_confidence_match"

    def test_low_confidence_pending(self):
        d = determine_disposition(
            RequestType.BUNK_WITH,
            resolution_method="fuzzy_match",
            match_confidence=0.75,
        )
        assert d.status == RequestStatus.PENDING
        assert d.reason == "needs_review"


class TestBunkWithPriorityOrder:
    """Business gates take precedence over resolution quality."""

    def test_inactive_overrides_exact_match(self):
        d = determine_disposition(
            RequestType.BUNK_WITH,
            resolution_method="exact_match",
            target_is_inactive=True,
        )
        assert d.status == RequestStatus.DECLINED

    def test_session_mismatch_overrides_reciprocal(self):
        d = determine_disposition(
            RequestType.BUNK_WITH,
            is_reciprocal=True,
            session_match=False,
        )
        assert d.status == RequestStatus.DECLINED


class TestBunkWithBoundary:
    """Boundary cases for confidence threshold."""

    def test_confidence_exactly_085_resolved(self):
        d = determine_disposition(RequestType.BUNK_WITH, match_confidence=0.85)
        assert d.status == RequestStatus.RESOLVED

    def test_confidence_084_pending(self):
        d = determine_disposition(RequestType.BUNK_WITH, match_confidence=0.84)
        assert d.status == RequestStatus.PENDING


class TestReciprocalConfidenceFloor:
    """Reciprocal match requires >= 0.70 confidence floor to auto-resolve."""

    def test_reciprocal_above_floor_resolved(self):
        d = determine_disposition(
            RequestType.BUNK_WITH,
            resolution_method="fuzzy_match",
            match_confidence=0.85,
            is_reciprocal=True,
        )
        assert d.status == RequestStatus.RESOLVED
        assert d.reason == "reciprocal_match"

    def test_reciprocal_at_floor_resolved(self):
        d = determine_disposition(
            RequestType.BUNK_WITH,
            resolution_method="ai_disambiguation",
            match_confidence=0.70,
            is_reciprocal=True,
        )
        assert d.status == RequestStatus.RESOLVED
        assert d.reason == "reciprocal_match"

    def test_reciprocal_below_floor_pending(self):
        d = determine_disposition(
            RequestType.BUNK_WITH,
            resolution_method="ai_disambiguation",
            match_confidence=0.45,
            is_reciprocal=True,
        )
        assert d.status == RequestStatus.PENDING
        assert d.reason == "needs_review"

    def test_reciprocal_at_030_pending(self):
        d = determine_disposition(
            RequestType.BUNK_WITH,
            resolution_method="ai_disambiguation",
            match_confidence=0.30,
            is_reciprocal=True,
        )
        assert d.status == RequestStatus.PENDING

    def test_reciprocal_069_pending(self):
        d = determine_disposition(
            RequestType.BUNK_WITH,
            resolution_method="ai_disambiguation",
            match_confidence=0.69,
            is_reciprocal=True,
        )
        assert d.status == RequestStatus.PENDING

    def test_reciprocal_below_floor_pending_even_with_low_auto_threshold(self):
        """Reciprocal floor must hold even when auto_resolve_threshold is below 0.70."""
        d = determine_disposition(
            RequestType.BUNK_WITH,
            resolution_method="ai_disambiguation",
            match_confidence=0.69,
            is_reciprocal=True,
            auto_resolve_threshold=0.60,
        )
        assert d.status == RequestStatus.PENDING
        assert d.reason == "needs_review"


class TestNotBunkWith:
    """NOT_BUNK_WITH disposition rules."""

    def test_inactive_target_declined(self):
        d = determine_disposition(RequestType.NOT_BUNK_WITH, target_is_inactive=True)
        assert d.status == RequestStatus.DECLINED

    def test_cross_session_auto_resolved(self):
        d = determine_disposition(
            RequestType.NOT_BUNK_WITH,
            session_match=False,
            match_confidence=0.85,
        )
        assert d.status == RequestStatus.RESOLVED
        assert d.reason == "cross_session_satisfied"

    def test_same_session_high_confidence_resolved(self):
        d = determine_disposition(
            RequestType.NOT_BUNK_WITH,
            match_confidence=0.80,
        )
        assert d.status == RequestStatus.RESOLVED
        assert d.reason == "auto_resolved"

    def test_low_confidence_pending(self):
        d = determine_disposition(
            RequestType.NOT_BUNK_WITH,
            match_confidence=0.70,
        )
        assert d.status == RequestStatus.PENDING


class TestAgePreference:
    def test_directional_resolved(self):
        d = determine_disposition(RequestType.AGE_PREFERENCE, age_direction="older")
        assert d.status == RequestStatus.RESOLVED

    def test_undirected_pending(self):
        d = determine_disposition(RequestType.AGE_PREFERENCE, age_direction=None)
        assert d.status == RequestStatus.PENDING


class TestRequesterNotAttending:
    """Tests for #830: requester_not_attending must be a distinct disposition reason.

    Previously requester_not_attending was conflated with target_is_inactive,
    causing a misleading "target_not_attending" reason when the REQUESTER is
    the one not attending.
    """

    def test_requester_inactive_declined_with_correct_reason(self):
        """BUNK_WITH where the requester is inactive should produce 'requester_not_attending'."""
        d = determine_disposition(
            RequestType.BUNK_WITH,
            requester_is_inactive=True,
        )
        assert d.status == RequestStatus.DECLINED
        assert d.reason == "requester_not_attending"

    def test_target_inactive_still_target_not_attending(self):
        """BUNK_WITH where the target is inactive should still produce 'target_not_attending'."""
        d = determine_disposition(
            RequestType.BUNK_WITH,
            target_is_inactive=True,
        )
        assert d.status == RequestStatus.DECLINED
        assert d.reason == "target_not_attending"

    def test_requester_inactive_overrides_resolution_quality(self):
        """requester_is_inactive should take priority over high confidence match."""
        d = determine_disposition(
            RequestType.BUNK_WITH,
            requester_is_inactive=True,
            resolution_method="exact_match",
            match_confidence=1.0,
        )
        assert d.status == RequestStatus.DECLINED
        assert d.reason == "requester_not_attending"

    def test_not_bunk_with_requester_inactive(self):
        """NOT_BUNK_WITH where the requester is inactive should produce 'requester_not_attending'."""
        d = determine_disposition(
            RequestType.NOT_BUNK_WITH,
            requester_is_inactive=True,
        )
        assert d.status == RequestStatus.DECLINED
        assert d.reason == "requester_not_attending"

    def test_both_inactive_requester_takes_priority(self):
        """If both are inactive, requester_not_attending should take priority."""
        d = determine_disposition(
            RequestType.BUNK_WITH,
            requester_is_inactive=True,
            target_is_inactive=True,
        )
        assert d.status == RequestStatus.DECLINED
        assert d.reason == "requester_not_attending"


class TestStaleDatedNoteGate:
    """#1801: stale dated staff notes auto-decline across all request types."""

    def test_stale_declines_age_preference(self):
        d = determine_disposition(RequestType.AGE_PREFERENCE, age_direction="younger", is_stale_dated_note=True)
        assert d.status == RequestStatus.DECLINED
        assert d.reason == "stale_dated_note"

    def test_stale_declines_bunk_with_even_on_exact_match(self):
        d = determine_disposition(
            RequestType.BUNK_WITH,
            resolution_method="exact_match",
            match_confidence=1.0,
            is_stale_dated_note=True,
        )
        assert d.status == RequestStatus.DECLINED
        assert d.reason == "stale_dated_note"

    def test_stale_declines_not_bunk_with(self):
        d = determine_disposition(RequestType.NOT_BUNK_WITH, match_confidence=0.95, is_stale_dated_note=True)
        assert d.status == RequestStatus.DECLINED
        assert d.reason == "stale_dated_note"

    def test_requester_not_attending_still_wins(self):
        d = determine_disposition(RequestType.BUNK_WITH, requester_is_inactive=True, is_stale_dated_note=True)
        assert d.reason == "requester_not_attending"

    def test_default_false_leaves_behavior_unchanged(self):
        d = determine_disposition(RequestType.AGE_PREFERENCE, age_direction="younger", is_stale_dated_note=False)
        assert d.status == RequestStatus.RESOLVED
        assert d.reason == "directional_preference"
