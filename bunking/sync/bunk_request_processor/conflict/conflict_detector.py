"""V2 Conflict Detector - Simplified implementation for session mismatch detection

Only detects session mismatches - all other constraint checking is delegated
to the solver where it belongs. This keeps request processing focused on
parsing and resolution, not constraint satisfaction."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from ..core.models import ParsedRequest, RequestType

logger = logging.getLogger(__name__)


class ConflictType(Enum):
    """Types of conflicts that can occur"""

    SESSION_MISMATCH = "session_mismatch"  # Requests across different sessions - only real processing error


@dataclass
class V2Conflict:
    """A conflict detected between requests"""

    conflict_type: ConflictType
    person_a_cm_id: int
    person_b_cm_id: int | None
    description: str
    severity: str = "high"  # Session mismatches are always high severity
    auto_resolvable: bool = False  # Session mismatches cannot be auto-resolved
    resolution_suggestion: str | None = None
    affected_request_indices: list[int] = field(default_factory=list)
    conflict_group_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class V2ConflictResult:
    """Result of conflict detection"""

    has_conflicts: bool
    conflicts: list[V2Conflict]
    auto_resolvable_count: int
    manual_review_count: int
    affected_requests: list[int]  # Indices of requests with conflicts
    conflict_groups: dict[str, list[int]] = field(default_factory=dict)  # Group ID -> request indices


class ConflictDetector:
    """Native V2 implementation of conflict detection.

    Simplified to only detect session mismatches. All other constraint
    checking (reciprocal requests, circular dependencies, capacity, etc.)
    is delegated to the solver where it belongs.
    """

    def __init__(self, config: dict[str, Any] | None = None):
        """Initialize the conflict detector.

        Args:
            config: Configuration for conflict detection rules
        """
        self.config = config or {}

        # Statistics
        self._stats = {"total_conflicts": 0, "session_mismatches": 0}

    def detect_conflicts(self, resolved_requests: list[tuple[ParsedRequest, dict[str, Any]]]) -> V2ConflictResult:
        """Detect conflicts in resolved requests.

        Currently only detects session mismatches - requests between people
        in different sessions cannot be fulfilled.

        Args:
            resolved_requests: List of (parsed_request, resolution_info) tuples

        Returns:
            V2ConflictResult with detected conflicts
        """
        conflicts = []
        affected_indices = set()

        # Build session maps for efficient conflict detection
        session_maps = self._build_session_maps(resolved_requests)

        # Detect session mismatches
        session_conflicts = self._detect_session_conflicts(resolved_requests, session_maps)
        conflicts.extend(session_conflicts)

        # Collect affected request indices
        for conflict in conflicts:
            affected_indices.update(conflict.affected_request_indices)

        # All session conflicts require manual review
        manual_review = len(conflicts)

        # Update statistics
        self._update_stats(conflicts)

        return V2ConflictResult(
            has_conflicts=len(conflicts) > 0,
            conflicts=conflicts,
            auto_resolvable_count=0,  # Session conflicts cannot be auto-resolved
            manual_review_count=manual_review,
            affected_requests=sorted(list(affected_indices)),
            conflict_groups={},  # No grouping needed for simple session conflicts
        )

    def _build_session_maps(self, resolved_requests: list[tuple[ParsedRequest, dict[str, Any]]]) -> dict[str, Any]:
        """Build efficient lookup maps for session conflict detection"""
        maps: dict[str, dict[Any, Any]] = {
            "person_to_session": {},  # person_cm_id -> session_cm_id
            "positive_requests": {},  # (requester, target) -> (idx, session_info)
        }

        for idx, (parsed_req, resolution_info) in enumerate(resolved_requests):
            requester = resolution_info.get("requester_cm_id")
            target = resolution_info.get("person_cm_id")
            session = resolution_info.get("session_cm_id")

            if not requester or not session:
                continue

            # Track person to session mapping
            maps["person_to_session"][requester] = session

            # Track positive requests for session checking
            if parsed_req.request_type == RequestType.BUNK_WITH and target:
                maps["positive_requests"][(requester, target)] = (
                    idx,
                    {"requester_session": session, "target_session": maps["person_to_session"].get(target)},
                )

        return maps

    def _detect_session_conflicts(
        self, resolved_requests: list[tuple[ParsedRequest, dict[str, Any]]], maps: dict[str, Any]
    ) -> list[V2Conflict]:
        """Detect requests across different sessions

        Only detects conflicts when we can reliably determine both people's sessions.
        Negative (placeholder) IDs represent unresolved names where we cannot
        determine the actual session - these are skipped to avoid false positives.
        """
        conflicts = []

        # Check each bunk_with request
        for (requester, target), (idx, session_info) in maps["positive_requests"].items():
            # Skip negative/placeholder IDs - these are unresolved names
            # We cannot reliably determine their session
            if target is not None and target < 0:
                continue

            requester_session = session_info["requester_session"]

            # Get target's session from person_to_session map
            # This only works if the target is also a requester somewhere
            target_session = maps["person_to_session"].get(target)

            # Check if sessions match
            if target_session and requester_session != target_session:
                conflict = V2Conflict(
                    conflict_type=ConflictType.SESSION_MISMATCH,
                    person_a_cm_id=requester,
                    person_b_cm_id=target,
                    description=(
                        f"Session mismatch: Person {requester} (session {requester_session}) "
                        f"requested {target} (session {target_session})"
                    ),
                    severity="high",
                    auto_resolvable=False,
                    resolution_suggestion="Cannot bunk across different sessions",
                    affected_request_indices=[idx],
                    metadata={"requester_session": requester_session, "target_session": target_session},
                )
                conflicts.append(conflict)

        return conflicts

    def apply_conflict_resolution(
        self, resolved_requests: list[tuple[ParsedRequest, dict[str, Any]]], conflict_result: V2ConflictResult
    ) -> list[tuple[ParsedRequest, dict[str, Any]]]:
        """Apply conflict resolution strategies to requests.

        For session conflicts, marks requests for manual review.

        Args:
            resolved_requests: Original resolved requests
            conflict_result: Result from detect_conflicts

        Returns:
            Modified resolved requests with conflict flags
        """
        if not conflict_result.has_conflicts:
            return resolved_requests

        # Create a modified copy
        modified_requests = resolved_requests.copy()

        # Apply conflict information to affected requests
        for conflict in conflict_result.conflicts:
            for idx in conflict.affected_request_indices:
                if idx < len(modified_requests):
                    parsed_req, resolution_info = modified_requests[idx]

                    # Add conflict information
                    resolution_info["has_conflict"] = True
                    resolution_info["conflict_type"] = conflict.conflict_type.value
                    resolution_info["conflict_description"] = conflict.description
                    resolution_info["conflict_severity"] = conflict.severity
                    resolution_info["auto_resolvable"] = False
                    resolution_info["resolution_suggestion"] = conflict.resolution_suggestion
                    # Conflict detected - status will be set to PENDING or DECLINED

                    # Add conflict metadata
                    if "conflict_metadata" not in resolution_info:
                        resolution_info["conflict_metadata"] = {}
                    resolution_info["conflict_metadata"].update(conflict.metadata)

        return modified_requests

    def get_conflict_summary(self, conflict_result: V2ConflictResult) -> str:
        """Generate a human-readable summary of conflicts"""
        if not conflict_result.has_conflicts:
            return "No conflicts detected"

        summary_lines = [
            f"Detected {len(conflict_result.conflicts)} session mismatch conflicts:",
            "All require manual review",
            "",
        ]

        # Show all session conflicts (they're important)
        for conflict in conflict_result.conflicts:
            summary_lines.append(f"- {conflict.description}")
            if conflict.resolution_suggestion:
                summary_lines.append(f"  Suggestion: {conflict.resolution_suggestion}")

        return "\n".join(summary_lines)

    def get_stats(self) -> dict[str, Any]:
        """Get conflict detection statistics"""
        return self._stats.copy()

    def _update_stats(self, conflicts: list[V2Conflict]) -> None:
        """Update internal statistics"""
        self._stats["total_conflicts"] += len(conflicts)
        self._stats["session_mismatches"] += len(conflicts)
