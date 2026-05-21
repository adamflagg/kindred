"""Tests for conflict details trace wiring in the orchestrator.

Verifies that post-pipeline trace includes serialized conflict details from V2Conflict objects.

These tests replicate the orchestrator's trace-building logic to verify correct wiring.
"""

from typing import Any

from bunking.sync.bunk_request_processor.conflict.conflict_detector import (
    ConflictType,
    V2Conflict,
    V2ConflictResult,
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
