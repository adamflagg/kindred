"""V2 Conflict Detector - Session and enrollment conflict detection

Detects session conflicts (BUNK_WITH across sessions → DECLINED,
NOT_BUNK_WITH across sessions → auto-RESOLVED) and enrollment conflicts
(TARGET_NOT_ENROLLED → DECLINED). All other constraint checking is
delegated to the solver where it belongs."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any

from bunking.logging_config import get_logger

from ..core.models import ParsedRequest, RequestType

if TYPE_CHECKING:
    from ..data.repositories.attendee_repository import AttendeeRepository

logger = get_logger(__name__)


class ConflictType(Enum):
    """Types of conflicts that can occur"""

    SESSION_MISMATCH = "session_mismatch"  # Requests across different sessions - only real processing error
    CROSS_SESSION_SATISFIED = "cross_session_satisfied"  # NOT_BUNK_WITH auto-satisfied by different sessions
    TARGET_NOT_ENROLLED = "target_not_enrolled"  # Target has no bunking enrollment at all
    TARGET_NOT_ATTENDING = "target_not_attending"  # Target enrolled but cancelled/dismissed/withdrawn


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

    Detects four conflict types:
    - SESSION_MISMATCH: BUNK_WITH across sessions → auto-DECLINED
    - CROSS_SESSION_SATISFIED: NOT_BUNK_WITH across sessions → auto-RESOLVED
    - TARGET_NOT_ENROLLED: target has no bunking enrollment → auto-DECLINED
    - TARGET_NOT_ATTENDING: target enrolled but cancelled/dismissed/withdrawn → auto-DECLINED

    All other constraint checking (reciprocal requests, circular dependencies,
    capacity, etc.) is delegated to the solver where it belongs.
    """

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        attendee_repo: AttendeeRepository | None = None,
        year: int | None = None,
    ):
        """Initialize the conflict detector.

        Args:
            config: Configuration for conflict detection rules
            attendee_repo: Optional attendee repository for session lookups
            year: Year for attendee queries
        """
        self.config = config or {}
        self.attendee_repo = attendee_repo
        self.year = year

        # Statistics
        self._stats = {
            "total_conflicts": 0,
            "session_mismatches": 0,
            "cross_session_satisfied": 0,
            "target_not_enrolled": 0,
            "target_not_attending": 0,
        }

    def detect_conflicts(self, resolved_requests: list[tuple[ParsedRequest, dict[str, Any]]]) -> V2ConflictResult:
        """Detect conflicts in resolved requests.

        Detects session mismatches, cross-session satisfaction, and
        unenrolled targets.

        Args:
            resolved_requests: List of (parsed_request, resolution_info) tuples

        Returns:
            V2ConflictResult with detected conflicts
        """
        conflicts = []
        affected_indices = set()

        # Build session maps for efficient conflict detection
        session_maps = self._build_session_maps(resolved_requests)

        # Detect target-not-enrolled (must check before session conflicts)
        not_enrolled_conflicts = self._detect_target_not_enrolled(resolved_requests, session_maps)
        conflicts.extend(not_enrolled_conflicts)
        not_enrolled_indices = {idx for c in not_enrolled_conflicts for idx in c.affected_request_indices}

        # Detect inactive targets (cancelled/dismissed/withdrawn) — after not-enrolled
        inactive_conflicts = self._detect_inactive_targets(resolved_requests, session_maps)
        conflicts.extend(inactive_conflicts)
        inactive_indices = {idx for c in inactive_conflicts for idx in c.affected_request_indices}

        # Combined skip set for session conflict detection
        skip_indices = not_enrolled_indices | inactive_indices

        # Detect session mismatches (BUNK_WITH) — skip already-declined
        session_conflicts = self._detect_session_conflicts(resolved_requests, session_maps, skip_indices)
        conflicts.extend(session_conflicts)

        # Detect cross-session satisfied (NOT_BUNK_WITH) — skip already-declined
        satisfied_conflicts = self._detect_cross_session_satisfied(resolved_requests, session_maps, skip_indices)
        conflicts.extend(satisfied_conflicts)

        # Collect affected request indices
        for conflict in conflicts:
            affected_indices.update(conflict.affected_request_indices)

        auto_resolvable = sum(1 for c in conflicts if c.auto_resolvable)
        manual_review = len(conflicts) - auto_resolvable

        # Update statistics
        self._update_stats(conflicts)

        return V2ConflictResult(
            has_conflicts=len(conflicts) > 0,
            conflicts=conflicts,
            auto_resolvable_count=auto_resolvable,
            manual_review_count=manual_review,
            affected_requests=sorted(affected_indices),
            conflict_groups={},
        )

    def _build_session_maps(self, resolved_requests: list[tuple[ParsedRequest, dict[str, Any]]]) -> dict[str, Any]:
        """Build efficient lookup maps for session conflict detection"""
        maps: dict[str, Any] = {
            "person_to_session": {},  # person_cm_id -> session_cm_id
            "positive_requests": {},  # (requester, target) -> (idx, session_info)
            "negative_requests": {},  # (requester, target) -> (idx, session_info)
        }

        for idx, (parsed_req, resolution_info) in enumerate(resolved_requests):
            requester = resolution_info.get("requester_cm_id")
            target = resolution_info.get("person_cm_id")
            session = resolution_info.get("session_cm_id")

            if not requester or not session:
                continue

            # Track person to session mapping
            maps["person_to_session"][requester] = session

            if target and target > 0:
                entry = (idx, {"requester_session": session})
                if parsed_req.request_type == RequestType.BUNK_WITH:
                    maps["positive_requests"][(requester, target)] = entry
                elif parsed_req.request_type == RequestType.NOT_BUNK_WITH:
                    maps["negative_requests"][(requester, target)] = entry

        # Enrich: look up sessions for targets not in the map
        all_targets_requested: set[int] = set()  # Track all targets we tried to enrich
        if self.attendee_repo and self.year:
            for requester, target in maps["positive_requests"]:
                if target not in maps["person_to_session"]:
                    all_targets_requested.add(target)
            for requester, target in maps["negative_requests"]:
                if target not in maps["person_to_session"]:
                    all_targets_requested.add(target)

            if all_targets_requested:
                enriched = self.attendee_repo.bulk_get_sessions_for_persons(list(all_targets_requested), self.year)
                maps["person_to_session"].update(enriched)

        # Track which targets were requested but not found (no bunking enrollment)
        maps["unenrolled_targets"] = all_targets_requested - set(maps["person_to_session"].keys())

        # Enrich with enrollment status info (cancelled/dismissed/withdrawn detection)
        maps["enrollment_info"] = {}
        maps["inactive_targets"] = set()
        if self.attendee_repo and self.year and all_targets_requested:
            try:
                enrollment_info = self.attendee_repo.bulk_get_enrollment_for_persons(
                    list(all_targets_requested), self.year
                )
                if isinstance(enrollment_info, dict):
                    maps["enrollment_info"] = enrollment_info
                    maps["inactive_targets"] = {cm_id for cm_id, info in enrollment_info.items() if info.is_inactive}
            except (AttributeError, TypeError):
                pass  # Method not available on this repo instance

        return maps

    def _detect_target_not_enrolled(
        self, resolved_requests: list[tuple[ParsedRequest, dict[str, Any]]], maps: dict[str, Any]
    ) -> list[V2Conflict]:
        """Detect requests where target has no bunking enrollment at all."""
        conflicts: list[V2Conflict] = []
        unenrolled = maps.get("unenrolled_targets", set())
        if not unenrolled:
            return conflicts

        # Check both positive and negative requests
        for request_map_key in ("positive_requests", "negative_requests"):
            for (requester, target), (idx, session_info) in maps[request_map_key].items():
                if target in unenrolled:
                    conflict = V2Conflict(
                        conflict_type=ConflictType.TARGET_NOT_ENROLLED,
                        person_a_cm_id=requester,
                        person_b_cm_id=target,
                        description=(f"Target {target} has no bunking session enrollment (requested by {requester})"),
                        severity="high",
                        auto_resolvable=False,
                        resolution_suggestion="Target is not enrolled in any bunking session",
                        affected_request_indices=[idx],
                        metadata={"requester_session": session_info["requester_session"]},
                    )
                    conflicts.append(conflict)

        return conflicts

    def _detect_inactive_targets(
        self, resolved_requests: list[tuple[ParsedRequest, dict[str, Any]]], maps: dict[str, Any]
    ) -> list[V2Conflict]:
        """Detect requests where target has an inactive enrollment (cancelled/dismissed/withdrawn)."""
        conflicts: list[V2Conflict] = []
        inactive = maps.get("inactive_targets", set())
        if not inactive:
            return conflicts

        enrollment_info = maps.get("enrollment_info", {})

        # Check both positive and negative requests
        for request_map_key in ("positive_requests", "negative_requests"):
            for (requester, target), (idx, session_info) in maps[request_map_key].items():
                if target in inactive:
                    info = enrollment_info.get(target)
                    status_id = info.status_id if info else None
                    conflict = V2Conflict(
                        conflict_type=ConflictType.TARGET_NOT_ATTENDING,
                        person_a_cm_id=requester,
                        person_b_cm_id=target,
                        description=(
                            f"Target {target} has inactive enrollment status "
                            f"(status_id={status_id}, requested by {requester})"
                        ),
                        severity="high",
                        auto_resolvable=True,
                        resolution_suggestion="Target is no longer attending (cancelled/dismissed/withdrawn)",
                        affected_request_indices=[idx],
                        metadata={
                            "requester_session": session_info["requester_session"],
                            "target_status_id": status_id,
                        },
                    )
                    conflicts.append(conflict)

        return conflicts

    def _detect_session_conflicts(
        self,
        resolved_requests: list[tuple[ParsedRequest, dict[str, Any]]],
        maps: dict[str, Any],
        skip_indices: set[int] | None = None,
    ) -> list[V2Conflict]:
        """Detect BUNK_WITH requests across different sessions.

        Only detects conflicts when we can reliably determine both people's sessions.
        Negative (placeholder) IDs are already filtered in _build_session_maps.
        """
        conflicts = []

        for (requester, target), (idx, session_info) in maps["positive_requests"].items():
            if skip_indices and idx in skip_indices:
                continue
            requester_session = session_info["requester_session"]
            target_session = maps["person_to_session"].get(target)

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

    def _detect_cross_session_satisfied(
        self,
        resolved_requests: list[tuple[ParsedRequest, dict[str, Any]]],
        maps: dict[str, Any],
        skip_indices: set[int] | None = None,
    ) -> list[V2Conflict]:
        """Detect NOT_BUNK_WITH requests that are automatically satisfied by different sessions."""
        conflicts = []

        for (requester, target), (idx, session_info) in maps["negative_requests"].items():
            if skip_indices and idx in skip_indices:
                continue
            requester_session = session_info["requester_session"]
            target_session = maps["person_to_session"].get(target)

            if target_session and requester_session != target_session:
                conflict = V2Conflict(
                    conflict_type=ConflictType.CROSS_SESSION_SATISFIED,
                    person_a_cm_id=requester,
                    person_b_cm_id=target,
                    description=(
                        f"Automatically satisfied: Person {requester} (session {requester_session}) "
                        f"NOT_BUNK_WITH {target} (session {target_session}) — different sessions"
                    ),
                    severity="info",
                    auto_resolvable=True,
                    resolution_suggestion="Automatically satisfied — different sessions",
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
                    _parsed_req, resolution_info = modified_requests[idx]

                    if conflict.conflict_type == ConflictType.CROSS_SESSION_SATISFIED:
                        resolution_info["auto_satisfied"] = True
                        resolution_info["satisfaction_reason"] = conflict.resolution_suggestion
                    else:
                        # SESSION_MISMATCH, TARGET_NOT_ENROLLED, and any future types
                        resolution_info["has_conflict"] = True
                        resolution_info["conflict_type"] = conflict.conflict_type.value
                        resolution_info["conflict_description"] = conflict.description
                        resolution_info["conflict_severity"] = conflict.severity
                        resolution_info["auto_resolvable"] = False
                        resolution_info["resolution_suggestion"] = conflict.resolution_suggestion

                    # Add conflict metadata
                    if "conflict_metadata" not in resolution_info:
                        resolution_info["conflict_metadata"] = {}
                    resolution_info["conflict_metadata"].update(conflict.metadata)

        return modified_requests

    def get_conflict_summary(self, conflict_result: V2ConflictResult) -> str:
        """Generate a human-readable summary of conflicts"""
        if not conflict_result.has_conflicts:
            return "No conflicts detected"

        mismatches = [c for c in conflict_result.conflicts if c.conflict_type == ConflictType.SESSION_MISMATCH]
        satisfied = [c for c in conflict_result.conflicts if c.conflict_type == ConflictType.CROSS_SESSION_SATISFIED]
        not_enrolled = [c for c in conflict_result.conflicts if c.conflict_type == ConflictType.TARGET_NOT_ENROLLED]
        not_attending = [c for c in conflict_result.conflicts if c.conflict_type == ConflictType.TARGET_NOT_ATTENDING]

        summary_lines = [f"Detected {len(conflict_result.conflicts)} conflict(s):"]
        if mismatches:
            summary_lines.append(f"  {len(mismatches)} session mismatch(es) → DECLINED")
        if not_enrolled:
            summary_lines.append(f"  {len(not_enrolled)} target not enrolled → DECLINED")
        if not_attending:
            summary_lines.append(f"  {len(not_attending)} target not attending → DECLINED")
        if satisfied:
            summary_lines.append(f"  {len(satisfied)} auto-satisfied NOT_BUNK_WITH → RESOLVED")
        summary_lines.append("")

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
        for c in conflicts:
            if c.conflict_type == ConflictType.SESSION_MISMATCH:
                self._stats["session_mismatches"] += 1
            elif c.conflict_type == ConflictType.CROSS_SESSION_SATISFIED:
                self._stats["cross_session_satisfied"] += 1
            elif c.conflict_type == ConflictType.TARGET_NOT_ENROLLED:
                self._stats["target_not_enrolled"] += 1
            elif c.conflict_type == ConflictType.TARGET_NOT_ATTENDING:
                self._stats["target_not_attending"] += 1
