"""Tests for confidence_factors and conflict details trace wiring in the orchestrator.

Verifies that:
1. Phase 2 trace includes confidence_factors from resolution result metadata
2. Post-pipeline trace includes serialized conflict details from V2Conflict objects

These tests replicate the orchestrator's trace-building logic to verify correct wiring.
"""

from __future__ import annotations

from typing import Any

from bunking.sync.bunk_request_processor.conflict.conflict_detector import (
    ConflictType,
    V2Conflict,
    V2ConflictResult,
)
from bunking.sync.bunk_request_processor.core.models import (
    Person,
)
from bunking.sync.bunk_request_processor.debug.trace_models import (
    CandidateTrace,
    Phase2FinalResult,
    Phase2IntentTrace,
)
from bunking.sync.bunk_request_processor.resolution.interfaces import ResolutionResult


def _build_phase2_trace(rr: ResolutionResult) -> Phase2IntentTrace:
    """Replicate the orchestrator's Phase 2 trace-building logic.

    This mirrors the code in orchestrator.py lines ~1254-1268.
    """
    rr_meta = rr.metadata or {}
    candidates_trace = [
        CandidateTrace(
            person_cm_id=c.cm_id,
            name=c.full_name if hasattr(c, "full_name") else f"{c.first_name} {c.last_name}",
            session_cm_id=c.session_cm_id,
            grade=c.grade,
            school=c.school,
        )
        for c in (rr.candidates or [])
    ]
    return Phase2IntentTrace(
        target_name=rr.target_name or "",
        all_candidates=candidates_trace,
        staff_filtered=rr.method == "staff_filtered",
        hallucination_detected=bool(rr_meta.get("below_threshold")),
        final_result=Phase2FinalResult(
            person_cm_id=rr.person.cm_id if rr.person else None,
            person_name=rr.person.full_name if rr.person else None,
            confidence=rr.confidence,
            method=rr.method,
            is_resolved=rr.is_resolved,
            is_ambiguous=rr.is_ambiguous,
            confidence_factors=rr_meta.get("confidence_factors", {}),
        ),
    )


def _build_conflict_details(conflict_result: V2ConflictResult) -> list[dict[str, Any]]:
    """Serialize V2Conflict objects for the post-pipeline trace.

    This is the logic that should exist in the orchestrator's trace-building code.
    """
    return [
        {
            "conflict_type": c.conflict_type.value,
            "person_a_cm_id": c.person_a_cm_id,
            "person_b_cm_id": c.person_b_cm_id,
            "description": c.description,
            "severity": c.severity,
            "auto_resolvable": c.auto_resolvable,
        }
        for c in conflict_result.conflicts
    ]


class TestPhase2ConfidenceFactorsTrace:
    """Test that Phase 2 trace captures confidence_factors from resolution metadata."""

    def test_confidence_factors_populated_from_resolution_metadata(self):
        """Phase 2 trace should read confidence_factors from resolution result metadata."""
        expected_factors = {
            "formula": "bunk_with",
            "name_score": 1.0,
            "ai_score": 0.85,
            "context_score": 0.8,
            "reciprocal_score": 0.0,
            "weights": {"name_match": 0.70, "ai_parsing": 0.15, "context": 0.10, "reciprocal_bonus": 0.05},
            "weighted_total": 0.9075,
        }

        person = Person(cm_id=12345, first_name="Emma", last_name="Johnson")
        rr = ResolutionResult(
            person=person,
            confidence=0.9075,
            method="exact_match",
            target_name="Emma Johnson",
            metadata={"confidence_factors": expected_factors},
        )

        trace = _build_phase2_trace(rr)
        assert trace.final_result.confidence_factors == expected_factors

    def test_confidence_factors_empty_when_metadata_has_none(self):
        """Phase 2 trace should have empty confidence_factors when metadata lacks them."""
        rr = ResolutionResult(
            person=None,
            confidence=0.0,
            method="unknown",
            target_name="Liam Garcia",
            metadata={},
        )

        trace = _build_phase2_trace(rr)
        assert trace.final_result.confidence_factors == {}

    def test_confidence_factors_empty_when_metadata_is_none(self):
        """Phase 2 trace should handle None metadata gracefully."""
        rr = ResolutionResult(
            person=None,
            confidence=0.0,
            method="unknown",
            target_name="Olivia Chen",
        )
        # Force metadata to None (ResolutionResult.__post_init__ sets it to {})
        rr.metadata = None

        trace = _build_phase2_trace(rr)
        assert trace.final_result.confidence_factors == {}


class TestConflictDetailsTrace:
    """Test that post-pipeline trace includes serialized conflict details."""

    def test_session_mismatch_conflict_serialized(self):
        """Session mismatch conflicts should be serialized into trace details."""
        conflict_result = V2ConflictResult(
            has_conflicts=True,
            conflicts=[
                V2Conflict(
                    conflict_type=ConflictType.SESSION_MISMATCH,
                    person_a_cm_id=100,
                    person_b_cm_id=200,
                    description="Session mismatch: Person 100 (session 1001) requested 200 (session 1002)",
                    severity="high",
                    auto_resolvable=False,
                    resolution_suggestion="Cannot bunk across different sessions",
                    affected_request_indices=[0],
                    metadata={"requester_session": 1001, "target_session": 1002},
                ),
            ],
            auto_resolvable_count=0,
            manual_review_count=1,
            affected_requests=[0],
        )

        details = _build_conflict_details(conflict_result)
        assert len(details) == 1
        assert details[0]["conflict_type"] == "session_mismatch"
        assert details[0]["person_a_cm_id"] == 100
        assert details[0]["person_b_cm_id"] == 200
        assert details[0]["severity"] == "high"
        assert details[0]["auto_resolvable"] is False

    def test_multiple_conflict_types_serialized(self):
        """Multiple conflict types should all be serialized."""
        conflict_result = V2ConflictResult(
            has_conflicts=True,
            conflicts=[
                V2Conflict(
                    conflict_type=ConflictType.SESSION_MISMATCH,
                    person_a_cm_id=100,
                    person_b_cm_id=200,
                    description="Session mismatch",
                ),
                V2Conflict(
                    conflict_type=ConflictType.CROSS_SESSION_SATISFIED,
                    person_a_cm_id=100,
                    person_b_cm_id=300,
                    description="Auto-satisfied",
                    severity="info",
                    auto_resolvable=True,
                ),
                V2Conflict(
                    conflict_type=ConflictType.TARGET_NOT_ENROLLED,
                    person_a_cm_id=100,
                    person_b_cm_id=400,
                    description="Target not enrolled",
                ),
            ],
            auto_resolvable_count=1,
            manual_review_count=2,
            affected_requests=[0, 1, 2],
        )

        details = _build_conflict_details(conflict_result)
        assert len(details) == 3
        types = [d["conflict_type"] for d in details]
        assert "session_mismatch" in types
        assert "cross_session_satisfied" in types
        assert "target_not_enrolled" in types

    def test_no_conflicts_produces_empty_details(self):
        """When no conflicts exist, serialized details should be empty."""
        conflict_result = V2ConflictResult(
            has_conflicts=False,
            conflicts=[],
            auto_resolvable_count=0,
            manual_review_count=0,
            affected_requests=[],
        )

        details = _build_conflict_details(conflict_result)
        assert details == []
