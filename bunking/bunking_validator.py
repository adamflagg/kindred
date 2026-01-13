"""
Bunking validation system to analyze assignments and report issues.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from bunking.models import Bunk, BunkAssignment, BunkRequest, FriendGroup, Person, Session
from bunking.solver.constraints.helpers import extract_bunk_level, get_level_order
from bunking.utils.age_preference import is_age_preference_satisfied


@dataclass
class HistoricalBunkingRecord:
    """Record of a camper's prior year bunk assignment."""

    person_cm_id: int
    bunk_name: str
    year: int
    session_cm_id: int | None = None  # For same-session regression comparison


logger = logging.getLogger(__name__)


class ValidationSeverity(str, Enum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


class ValidationIssue(BaseModel):
    """Single validation issue found during analysis."""

    severity: ValidationSeverity
    type: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)
    affected_ids: list[str] = Field(default_factory=list)


class SessionBreakdown(BaseModel):
    """Breakdown of statistics per session."""

    session_cm_id: int
    session_name: str
    total_campers: int = 0
    assigned_campers: int = 0
    unassigned_campers: int = 0
    total_capacity: int = 0
    used_capacity: int = 0
    bunks_count: int = 0


class ValidationStatistics(BaseModel):
    """Overall statistics from validation."""

    total_campers: int = 0
    assigned_campers: int = 0
    unassigned_campers: int = 0
    total_requests: int = 0
    satisfied_requests: int = 0
    request_satisfaction_rate: float = 0.0
    bunks_over_capacity: int = 0
    bunks_at_capacity: int = 0
    bunks_under_capacity: int = 0
    locked_bunks: int = 0
    campers_with_no_requests: int = 0
    friend_groups_split: int = 0
    friend_groups_intact: int = 0
    # Multi-session support
    session_breakdown: list[SessionBreakdown] = Field(default_factory=list)
    total_capacity: int = 0
    used_capacity: int = 0
    capacity_utilization_rate: float = 0.0

    # Per-field request tracking - keys match database source_field values (normalized to snake_case)
    field_stats: dict[str, dict[str, int | float]] = Field(
        default_factory=lambda: {
            "share_bunk_with": {"total": 0, "satisfied": 0, "satisfaction_rate": 0.0},
            "do_not_share_with": {"total": 0, "satisfied": 0, "satisfaction_rate": 0.0},
            "bunking_notes": {"total": 0, "satisfied": 0, "satisfaction_rate": 0.0},
            "internal_notes": {"total": 0, "satisfied": 0, "satisfaction_rate": 0.0},
            "socialize_with": {"total": 0, "satisfied": 0, "satisfaction_rate": 0.0},
        }
    )

    # Explicit CSV field request tracking (share_bunk_with, do_not_share_with, bunking_notes, internal_notes)
    explicit_csv_requests: int = 0
    satisfied_explicit_csv_requests: int = 0
    explicit_csv_request_satisfaction_rate: float = 0.0
    campers_with_unsatisfied_explicit_requests: int = 0

    # Level progression stats (comparing to prior year)
    level_progression: dict[str, int] = Field(
        default_factory=lambda: {
            "returning_campers": 0,
            "progressed": 0,
            "same_level": 0,
            "regressed": 0,
        }
    )

    # Age/grade flow validation (checking age progression across bunk levels)
    age_flow_violations: int = 0

    # Isolation risk detection (isolated campers in large friend groups)
    isolation_risks: int = 0

    # Negative request violations (all not_bunk_with violations)
    negative_request_violations: int = 0


class ValidationResult(BaseModel):
    """Complete validation result with statistics and issues."""

    statistics: ValidationStatistics
    issues: list[ValidationIssue]
    validated_at: datetime = Field(default_factory=datetime.utcnow)
    session_id: str
    scenario: str | None = None  # PocketBase ID of saved_scenario


class BunkingValidator:
    """Validates bunking assignments and reports issues."""

    def __init__(self) -> None:
        # Spread validation limits (from former SpreadValidator)
        self.max_grade_spread = 2  # Maximum number of different grades allowed in a bunk
        self.max_age_spread_months = 24  # Maximum age difference (2 years)

    def validate_bunking(
        self,
        session: Session,
        bunks: list[Bunk],
        assignments: list[BunkAssignment],
        persons: list[Person],
        requests: list[BunkRequest],
        scenario: str | None = None,
        all_sessions: list[Session] | None = None,
        bunk_plans: list[Any] | None = None,
        attendees: list[Any] | None = None,
        historical_bunking: list[HistoricalBunkingRecord] | None = None,
    ) -> ValidationResult:
        """
        Perform comprehensive validation of bunking assignments.

        Args:
            session: The session being validated
            bunks: All bunks for the session
            assignments: Current bunk assignments (filtered by scenario if provided)
            persons: All persons in the session
            requests: All bunk requests for the session
            scenario: Optional scenario PocketBase ID to validate
            historical_bunking: Prior year bunk assignments for level regression checks

        Returns:
            ValidationResult with statistics and issues
        """
        issues: list[ValidationIssue] = []
        stats = ValidationStatistics()

        # Create lookup structures
        person_by_id = {p.campminder_id: p for p in persons}
        assignments_by_person = {a.person_cm_id: a for a in assignments}
        assignments_by_bunk = defaultdict(list)
        for assignment in assignments:
            assignments_by_bunk[assignment.bunk_cm_id].append(assignment)

        # Basic statistics
        stats.total_campers = len(persons)
        stats.assigned_campers = len(assignments)
        stats.unassigned_campers = stats.total_campers - stats.assigned_campers

        # Check for unassigned campers
        if stats.unassigned_campers > 0:
            unassigned_ids = []
            for person in persons:
                if person.campminder_id not in assignments_by_person:
                    unassigned_ids.append(person.campminder_id)

            issues.append(
                ValidationIssue(
                    severity=ValidationSeverity.ERROR,
                    type="unassigned_campers",
                    message=f"{stats.unassigned_campers} campers are not assigned to any bunk",
                    details={"count": stats.unassigned_campers},
                    affected_ids=unassigned_ids[:10],  # Limit to first 10 for UI
                )
            )

        # Validate bunk capacities
        self._validate_bunk_capacities(bunks, assignments_by_bunk, stats, issues)

        # Validate request satisfaction
        self._validate_requests(requests, assignments_by_person, person_by_id, stats, issues)

        # Validate age/grade spreads
        self._validate_spreads(bunks, assignments_by_bunk, person_by_id, stats, issues)

        # Validate grade ratios
        self._validate_grade_ratios(bunks, assignments_by_bunk, person_by_id, stats, issues)

        # Validate grade adjacency (non-adjacent grades like 4 and 6) - NEW
        self._validate_grade_adjacency(bunks, assignments_by_bunk, person_by_id, stats, issues)

        # Validate level progression (regression detection) - NEW
        if historical_bunking:
            self._validate_level_progression(
                bunks, assignments_by_person, person_by_id, historical_bunking, stats, issues
            )

        # Validate age/grade flow (younger kids in lower bunks) - NEW
        self._validate_age_grade_flow(bunks, assignments_by_bunk, person_by_id, stats, issues)

        # Validate isolation risk (isolated campers in large friend groups) - NEW
        self._validate_isolation_risk(bunks, assignments_by_bunk, requests, person_by_id, stats, issues)

        # Count locked bunks
        stats.locked_bunks = sum(1 for b in bunks if b.is_locked)

        # Find campers with no requests
        persons_with_requests = set()
        for request in requests:
            persons_with_requests.add(request.requester_person_cm_id)
            if request.requested_person_cm_id:
                persons_with_requests.add(request.requested_person_cm_id)

        campers_no_requests = []
        for person in persons:
            if person.campminder_id not in persons_with_requests:
                campers_no_requests.append(person.campminder_id)

        stats.campers_with_no_requests = len(campers_no_requests)
        if stats.campers_with_no_requests > 0:
            issues.append(
                ValidationIssue(
                    severity=ValidationSeverity.INFO,
                    type="no_requests",
                    message=f"{stats.campers_with_no_requests} campers have no bunk requests",
                    details={"count": stats.campers_with_no_requests},
                    affected_ids=campers_no_requests[:10],
                )
            )

        # Compute per-session breakdown if multiple sessions provided
        if all_sessions and bunk_plans:
            self._compute_session_breakdown(
                all_sessions, bunk_plans, persons, assignments_by_person, bunks, assignments_by_bunk, stats, attendees
            )

        # Calculate total capacity and utilization
        stats.total_capacity = sum(bunk.max_size for bunk in bunks)
        stats.used_capacity = stats.assigned_campers
        if stats.total_capacity > 0:
            stats.capacity_utilization_rate = stats.used_capacity / stats.total_capacity

        return ValidationResult(statistics=stats, issues=issues, session_id=session.campminder_id, scenario=scenario)

    def _validate_bunk_capacities(
        self,
        bunks: list[Bunk],
        assignments_by_bunk: dict[str, list[BunkAssignment]],
        stats: ValidationStatistics,
        issues: list[ValidationIssue],
    ) -> None:
        """Validate bunk capacity constraints."""
        for bunk in bunks:
            assigned_count = len(assignments_by_bunk.get(bunk.campminder_id, []))

            if assigned_count > bunk.max_size:
                stats.bunks_over_capacity += 1
                issues.append(
                    ValidationIssue(
                        severity=ValidationSeverity.ERROR,
                        type="capacity_violation",
                        message=f"Bunk {bunk.name} is over capacity ({assigned_count}/{bunk.max_size})",
                        details={
                            "bunk_id": bunk.campminder_id,
                            "bunk_name": bunk.name,
                            "assigned": assigned_count,
                            "max_size": bunk.max_size,
                        },
                        affected_ids=[bunk.campminder_id],
                    )
                )
            elif assigned_count == bunk.max_size:
                stats.bunks_at_capacity += 1
            else:
                stats.bunks_under_capacity += 1

    def _validate_requests(
        self,
        requests: list[BunkRequest],
        assignments_by_person: dict[str, BunkAssignment],
        person_by_id: dict[str, Person],
        stats: ValidationStatistics,
        issues: list[ValidationIssue],
    ) -> None:
        """Validate request satisfaction - tracking by source field."""
        # Valid statuses are 'resolved' (accepted/approved)
        valid_statuses = {"resolved"}

        # Define explicit CSV fields for must-satisfy-one constraint (using normalized names)
        explicit_csv_fields = {
            "share_bunk_with",
            "do_not_share_with",
            "bunking_notes",
            "internal_notes",
            "bunk_with",
            "not_bunk_with",
        }

        # Build assignments_by_bunk for age_preference satisfaction checking
        assignments_by_bunk: dict[str, list[BunkAssignment]] = defaultdict(list)
        for assignment in assignments_by_person.values():
            assignments_by_bunk[assignment.bunk_cm_id].append(assignment)

        # Track requests per person
        requests_by_person = defaultdict(list)
        valid_requests_by_person = defaultdict(list)
        satisfied_requests_by_person = defaultdict(list)
        explicit_requests_by_person = defaultdict(list)
        satisfied_explicit_by_person = defaultdict(list)

        def normalize_source_field(raw_field: str) -> str | None:
            """Normalize database source_field values to consistent snake_case keys.

            Maps values like 'Share Bunk With' -> 'share_bunk_with'
            Returns None if the field cannot be mapped to a known field.
            """
            if not raw_field:
                return None

            # Direct mappings for known source_field values
            field_mappings = {
                # Standard field names
                "share bunk with": "share_bunk_with",
                "do not share bunk with": "do_not_share_with",
                "bunkingnotes notes": "bunking_notes",
                "bunking_notes": "bunking_notes",
                "internal bunk notes": "internal_notes",
                "internal_notes": "internal_notes",
                # Socialize variations
                "ret_parent_socialize_with_best": "socialize_with",
                "socialize_preference": "socialize_with",
                "socialize_with": "socialize_with",
                # Already normalized
                "share_bunk_with": "share_bunk_with",
                "do_not_share_with": "do_not_share_with",
            }

            normalized = raw_field.strip().lower()
            if normalized in field_mappings:
                return field_mappings[normalized]

            # Fallback: convert to snake_case and check if it's a known field
            import re

            snake_case = re.sub(r"[\s\-]+", "_", normalized)
            snake_case = re.sub(r"[^a-z0-9_]", "", snake_case)

            # Only return if it maps to a known field
            known_fields = {"share_bunk_with", "do_not_share_with", "bunking_notes", "internal_notes", "socialize_with"}
            return snake_case if snake_case in known_fields else None

        def get_source_fields(request: BunkRequest) -> list[str]:
            """Extract and normalize source fields from request."""
            raw_fields = []

            # Try ai_p1_reasoning first (newer format)
            if hasattr(request, "ai_p1_reasoning") and request.ai_p1_reasoning:
                ai_reasoning = request.ai_p1_reasoning
                if isinstance(ai_reasoning, str):
                    try:
                        ai_reasoning = json.loads(ai_reasoning)
                    except (json.JSONDecodeError, ValueError):
                        ai_reasoning = {}

                if isinstance(ai_reasoning, dict):
                    csv_fields = ai_reasoning.get("csv_source_fields", [])
                    if csv_fields:
                        raw_fields = csv_fields

            # Try legacy ai_reasoning if newer format not available
            if not raw_fields and hasattr(request, "ai_reasoning") and request.ai_reasoning:
                ai_reasoning = request.ai_reasoning
                if isinstance(ai_reasoning, str):
                    try:
                        ai_reasoning = json.loads(ai_reasoning)
                    except (json.JSONDecodeError, ValueError):
                        ai_reasoning = {}

                if isinstance(ai_reasoning, dict):
                    csv_fields = ai_reasoning.get("csv_source_fields", [])
                    if csv_fields:
                        raw_fields = csv_fields

            # Try direct csv_source_fields attribute
            if not raw_fields and hasattr(request, "csv_source_fields") and request.csv_source_fields:
                raw_fields = request.csv_source_fields

            # Fallback to source_field
            if not raw_fields and hasattr(request, "source_field") and request.source_field:
                raw_fields = [request.source_field]

            # For age_preference requests, map to socialize_with if no explicit source
            # These come from the "socialize with" dropdown in CampMinder
            if not raw_fields and request.request_type == "age_preference":
                return ["socialize_with"]

            # Normalize all fields, filtering out None (unknown fields)
            if raw_fields:
                normalized = [f for f in (normalize_source_field(rf) for rf in raw_fields) if f is not None]
                # If this is an age_preference request and didn't resolve to socialize_with,
                # ensure it's properly categorized
                if request.request_type == "age_preference" and "socialize_with" not in normalized:
                    normalized.append("socialize_with")
                return normalized

            return []

        def is_request_satisfied(
            request: BunkRequest,
            person_assignment: BunkAssignment | None,
            assignments_by_person: dict[str, BunkAssignment],
        ) -> bool:
            """Check if a request is satisfied."""
            if not person_assignment:
                return False

            if request.request_type == "bunk_with" and request.requested_person_cm_id:
                requested_assignment = assignments_by_person.get(request.requested_person_cm_id)
                return bool(requested_assignment and requested_assignment.bunk_cm_id == person_assignment.bunk_cm_id)
            elif request.request_type == "not_bunk_with" and request.requested_person_cm_id:
                requested_assignment = assignments_by_person.get(request.requested_person_cm_id)
                return bool(not requested_assignment or requested_assignment.bunk_cm_id != person_assignment.bunk_cm_id)
            elif request.request_type == "age_preference":
                # Check if the bunk has older/younger bunkmates based on age_preference_target
                age_pref_target = getattr(request, "age_preference_target", None)
                if not age_pref_target:
                    return False

                # Get all bunkmates in the same bunk
                bunk_assignments = assignments_by_bunk.get(person_assignment.bunk_cm_id, [])
                if len(bunk_assignments) < 2:
                    return False  # No bunkmates to compare

                # Get the requester's grade
                requester_person = person_by_id.get(request.requester_person_cm_id)
                if not requester_person or requester_person.grade is None:
                    return False

                requester_grade = requester_person.grade

                # Collect grades of all bunkmates (excluding the requester)
                bunkmate_grades = []
                for assignment in bunk_assignments:
                    if assignment.person_cm_id != request.requester_person_cm_id:
                        bunkmate = person_by_id.get(assignment.person_cm_id)
                        if bunkmate and bunkmate.grade is not None:
                            bunkmate_grades.append(bunkmate.grade)

                # Use shared utility for consistent satisfaction logic
                satisfied, _ = is_age_preference_satisfied(requester_grade, bunkmate_grades, age_pref_target)
                return satisfied

            return False

        # Process each request
        for request in requests:
            requester_id = request.requester_person_cm_id
            requests_by_person[requester_id].append(request)

            # Only consider valid requests (resolved status)
            if request.status in valid_statuses:
                valid_requests_by_person[requester_id].append(request)

                # Get source fields (only known fields, unknown fields filtered out)
                source_fields = get_source_fields(request)

                # Check if this is an explicit CSV field request
                is_explicit = any(field in explicit_csv_fields for field in source_fields)
                if is_explicit:
                    explicit_requests_by_person[requester_id].append(request)

                # Update field stats (only for known fields)
                for field in source_fields:
                    if field in stats.field_stats:
                        stats.field_stats[field]["total"] += 1

                # Check if this valid request is satisfied
                person_assignment = assignments_by_person.get(requester_id)
                if is_request_satisfied(request, person_assignment, assignments_by_person):
                    satisfied_requests_by_person[requester_id].append(request)
                    if is_explicit:
                        satisfied_explicit_by_person[requester_id].append(request)

                    # Update satisfied field stats (only for known fields)
                    for field in source_fields:
                        if field in stats.field_stats:
                            stats.field_stats[field]["satisfied"] += 1

        # Calculate per-field satisfaction rates
        for field_key, field_data in stats.field_stats.items():
            if field_data["total"] > 0:
                field_data["satisfaction_rate"] = field_data["satisfied"] / field_data["total"]

        # Find campers with valid requests but NONE satisfied
        campers_with_unsatisfied_valid_requests = []
        campers_with_unsatisfied_explicit_requests = []

        for person_id, valid_requests in valid_requests_by_person.items():
            if len(valid_requests) > 0 and len(satisfied_requests_by_person[person_id]) == 0:
                # This person has valid requests but none are satisfied
                campers_with_unsatisfied_valid_requests.append(person_id)

                # Check if they have unsatisfied explicit requests
                if (
                    len(explicit_requests_by_person[person_id]) > 0
                    and len(satisfied_explicit_by_person[person_id]) == 0
                ):
                    campers_with_unsatisfied_explicit_requests.append(person_id)

                # Get person info for reporting
                person = person_by_id.get(person_id)
                person_name = person.name if person else f"Person {person_id}"

                # Report each unsatisfied valid request for this person
                for request in valid_requests:
                    source_fields = get_source_fields(request)
                    if request.request_type == "bunk_with" and request.requested_person_cm_id:
                        requested_person = person_by_id.get(request.requested_person_cm_id)
                        requested_name = (
                            requested_person.name if requested_person else f"Person {request.requested_person_cm_id}"
                        )
                        issues.append(
                            ValidationIssue(
                                severity=ValidationSeverity.WARNING,
                                type="valid_request_unsatisfied",
                                message=f"{person_name} has a valid 'bunk with' request for {requested_name} that is not satisfied",
                                details={
                                    "request_type": request.request_type,
                                    "priority": request.priority,
                                    "person_id": person_id,
                                    "requested_person_id": request.requested_person_cm_id,
                                    "status": request.status,
                                    "source_fields": source_fields,
                                },
                                affected_ids=[person_id, request.requested_person_cm_id],
                            )
                        )
                    elif request.request_type == "not_bunk_with" and request.requested_person_cm_id:
                        requested_person = person_by_id.get(request.requested_person_cm_id)
                        requested_name = (
                            requested_person.name if requested_person else f"Person {request.requested_person_cm_id}"
                        )
                        person_assignment = assignments_by_person.get(person_id)
                        requested_assignment = assignments_by_person.get(request.requested_person_cm_id)
                        if (
                            person_assignment
                            and requested_assignment
                            and person_assignment.bunk_cm_id == requested_assignment.bunk_cm_id
                        ):
                            issues.append(
                                ValidationIssue(
                                    severity=ValidationSeverity.ERROR,
                                    type="valid_negative_request_violated",
                                    message=f"{person_name} has a valid 'not bunk with' request but is bunked with {requested_name}",
                                    details={
                                        "request_type": request.request_type,
                                        "priority": request.priority,
                                        "person_id": person_id,
                                        "requested_person_id": request.requested_person_cm_id,
                                        "status": request.status,
                                        "source_fields": source_fields,
                                    },
                                    affected_ids=[person_id, request.requested_person_cm_id],
                                )
                            )

        # Update statistics
        total_valid_requests = sum(len(reqs) for reqs in valid_requests_by_person.values())
        total_satisfied_valid_requests = sum(len(reqs) for reqs in satisfied_requests_by_person.values())

        stats.total_requests = total_valid_requests
        stats.satisfied_requests = total_satisfied_valid_requests

        if stats.total_requests > 0:
            stats.request_satisfaction_rate = stats.satisfied_requests / stats.total_requests

        # Calculate explicit CSV field stats
        stats.explicit_csv_requests = sum(len(reqs) for reqs in explicit_requests_by_person.values())
        stats.satisfied_explicit_csv_requests = sum(len(reqs) for reqs in satisfied_explicit_by_person.values())
        if stats.explicit_csv_requests > 0:
            stats.explicit_csv_request_satisfaction_rate = (
                stats.satisfied_explicit_csv_requests / stats.explicit_csv_requests
            )
        stats.campers_with_unsatisfied_explicit_requests = len(campers_with_unsatisfied_explicit_requests)

        # Add summary issue if there are campers with unsatisfied valid requests
        if campers_with_unsatisfied_valid_requests:
            issues.insert(
                0,
                ValidationIssue(
                    severity=ValidationSeverity.WARNING,
                    type="campers_with_unsatisfied_valid_requests",
                    message=f"{len(campers_with_unsatisfied_valid_requests)} campers have valid requests but NONE are satisfied",
                    details={
                        "count": len(campers_with_unsatisfied_valid_requests),
                        "total_valid_requests": total_valid_requests,
                        "total_satisfied": total_satisfied_valid_requests,
                        "explicit_unsatisfied_count": len(campers_with_unsatisfied_explicit_requests),
                    },
                    affected_ids=campers_with_unsatisfied_valid_requests[:10],  # First 10 for UI
                ),
            )

    def _validate_spreads(
        self,
        bunks: list[Bunk],
        assignments_by_bunk: dict[str, list[BunkAssignment]],
        person_by_id: dict[str, Person],
        stats: ValidationStatistics,
        issues: list[ValidationIssue],
    ) -> None:
        """Validate age and grade spreads within bunks.

        Note: AG (All-Gender) bunks are exempt from spread checks since they
        intentionally have mixed ages/grades.
        """
        for bunk in bunks:
            # Skip AG bunks - they intentionally have mixed ages/grades
            bunk_gender = getattr(bunk, "gender", None)
            if bunk_gender in ("Mixed", "AG") or "AG" in bunk.name.upper():
                continue

            assignments = assignments_by_bunk.get(bunk.campminder_id, [])
            if len(assignments) < 2:
                continue

            # Get persons for this bunk
            bunk_persons = []
            for assignment in assignments:
                person = person_by_id.get(assignment.person_cm_id)
                if person:
                    bunk_persons.append(person)

            # Debug logging for B-3 and G-8B bunks
            if bunk.name in ("G-8B", "B-3"):
                logger.info(
                    f"[Grade Debug] {bunk.name} (cm_id={bunk.campminder_id}) has {len(bunk_persons)} persons found out of {len(assignments)} assignments"
                )
                logger.info(
                    f"[Grade Debug] {bunk.name} assignments with sessions: {[(a.person_cm_id, a.session_cm_id) for a in assignments]}"
                )
                logger.info(
                    f"[Grade Debug] {bunk.name} person grades: {[(p.campminder_id, p.grade) for p in bunk_persons]}"
                )

            if len(bunk_persons) < 2:
                continue

            # Calculate grade spread (max - min)
            grades = []
            for person in bunk_persons:
                if hasattr(person, "grade") and person.grade is not None:
                    try:
                        grades.append(int(person.grade))
                    except (ValueError, TypeError):
                        continue

            # Calculate age spread in months
            ages_in_months = []
            for person in bunk_persons:
                if hasattr(person, "age") and person.age is not None:
                    # Age is in years, convert to months
                    ages_in_months.append(int(person.age * 12))

            age_spread = max(ages_in_months) - min(ages_in_months) if ages_in_months else 0

            # Check if number of unique grades exceeds limit
            unique_grades = len(set(grades))
            if unique_grades > self.max_grade_spread:  # Using max_grade_spread as max number of grades
                # Debug logging for any bunk with grade spread issues
                logger.warning(
                    f"[Grade Spread] {bunk.name} has {unique_grades} unique grades: "
                    f"{sorted(set(grades))} from {len(bunk_persons)} campers"
                )
                issues.append(
                    ValidationIssue(
                        severity=ValidationSeverity.WARNING,
                        type="grade_spread_warning",
                        message=f"Bunk {bunk.name} has too many different grades ({unique_grades} grades, max allowed: {self.max_grade_spread})",
                        details={
                            "bunk_id": bunk.campminder_id,
                            "bunk_name": bunk.name,
                            "unique_grades": unique_grades,
                            "grades": sorted(set(grades)),
                            "max_allowed": self.max_grade_spread,
                        },
                        affected_ids=[bunk.campminder_id],
                    )
                )

            if age_spread > self.max_age_spread_months:
                issues.append(
                    ValidationIssue(
                        severity=ValidationSeverity.WARNING,
                        type="age_spread_warning",
                        message=f"Bunk {bunk.name} has excessive age spread ({age_spread:.1f} months)",
                        details={
                            "bunk_id": bunk.campminder_id,
                            "bunk_name": bunk.name,
                            "age_spread_months": age_spread,
                            "max_allowed": self.max_age_spread_months,
                        },
                        affected_ids=[bunk.campminder_id],
                    )
                )

    def _validate_grade_ratios(
        self,
        bunks: list[Bunk],
        assignments_by_bunk: dict[str, list[BunkAssignment]],
        person_by_id: dict[str, Person],
        stats: ValidationStatistics,
        issues: list[ValidationIssue],
    ) -> None:
        """Validate grade ratio constraints within bunks.

        Note: AG (All-Gender) bunks are exempt from grade ratio checks since they
        intentionally have mixed ages/grades.
        """
        max_percentage = 67  # Maximum percentage of any single grade in a bunk

        for bunk in bunks:
            # Skip AG bunks - they intentionally have mixed ages/grades
            bunk_gender = getattr(bunk, "gender", None)
            if bunk_gender in ("Mixed", "AG") or "AG" in bunk.name.upper():
                continue

            assignments = assignments_by_bunk.get(bunk.campminder_id, [])
            if len(assignments) < 2:
                continue

            # Count campers by grade
            grade_counts: dict[int | None, int] = defaultdict(int)
            total_campers = 0

            for assignment in assignments:
                person = person_by_id.get(assignment.person_cm_id)
                if person and person.grade is not None:
                    grade_counts[person.grade] += 1
                    total_campers += 1

            if total_campers == 0:
                continue

            # Skip validation if all campers are from the same grade (100% of one grade)
            if len(grade_counts) == 1:
                continue

            # Check if any grade exceeds the maximum percentage
            for grade, count in grade_counts.items():
                percentage = (count * 100) / total_campers
                if percentage > max_percentage:
                    issues.append(
                        ValidationIssue(
                            severity=ValidationSeverity.WARNING,
                            type="grade_ratio_warning",
                            message=f"Bunk {bunk.name} has {percentage:.1f}% of campers from grade {grade} (exceeds {max_percentage}% limit)",
                            details={
                                "bunk_id": bunk.campminder_id,
                                "bunk_name": bunk.name,
                                "grade": grade,
                                "count": count,
                                "total": total_campers,
                                "percentage": percentage,
                                "max_allowed": max_percentage,
                                # All grades with counts, sorted by count descending
                                "all_grades": dict(sorted(grade_counts.items(), key=lambda x: -x[1])),
                            },
                            affected_ids=[bunk.campminder_id],
                        )
                    )

    def _validate_grade_adjacency(
        self,
        bunks: list[Bunk],
        assignments_by_bunk: dict[str, list[BunkAssignment]],
        person_by_id: dict[str, Person],
        stats: ValidationStatistics,
        issues: list[ValidationIssue],
    ) -> None:
        """Validate that bunks have adjacent grades only.

        Flags bunks where grades are not consecutive (e.g., grades 4 and 6).
        AG bunks are exempt (they intentionally have mixed ages/grades).
        """
        for bunk in bunks:
            # Skip AG bunks - they intentionally have mixed ages/grades
            bunk_gender = getattr(bunk, "gender", None)
            if bunk_gender in ("Mixed", "AG") or "AG" in bunk.name.upper():
                continue

            assignments = assignments_by_bunk.get(bunk.campminder_id, [])
            if len(assignments) < 2:
                continue

            # Get grades for this bunk
            grades = []
            for assignment in assignments:
                person = person_by_id.get(assignment.person_cm_id)
                if person and hasattr(person, "grade") and person.grade is not None:
                    try:
                        grades.append(int(person.grade))
                    except (ValueError, TypeError):
                        continue

            if len(grades) < 2:
                continue

            # Get unique grades sorted
            unique_grades = sorted(set(grades))

            if len(unique_grades) < 2:
                continue

            # Check for non-adjacent grade pairs
            for i in range(len(unique_grades) - 1):
                grade1 = unique_grades[i]
                grade2 = unique_grades[i + 1]
                gap = grade2 - grade1

                if gap > 1:
                    # Find missing grades
                    missing_grades = list(range(grade1 + 1, grade2))
                    issues.append(
                        ValidationIssue(
                            severity=ValidationSeverity.WARNING,
                            type="grade_adjacency_warning",
                            message=f"Bunk {bunk.name} has non-adjacent grades {unique_grades} (missing grade{'s' if len(missing_grades) > 1 else ''} {missing_grades})",
                            details={
                                "bunk_id": bunk.campminder_id,
                                "bunk_name": bunk.name,
                                "grades_present": unique_grades,
                                "missing_grades": missing_grades,
                                "gap": gap,
                            },
                            affected_ids=[bunk.campminder_id],
                        )
                    )

    def _validate_friend_groups(
        self,
        friend_groups: list[FriendGroup],
        assignments_by_person: dict[str, BunkAssignment],
        stats: ValidationStatistics,
        issues: list[ValidationIssue],
    ) -> None:
        """Deprecated - friend groups now handled by NetworkX social graph"""
        # Friend groups validation removed - now handled by NetworkX social graph
        pass

    def _compute_session_breakdown(
        self,
        all_sessions: list[Session],
        bunk_plans: list[Any],
        persons: list[Person],
        assignments_by_person: dict[str, BunkAssignment],
        bunks: list[Bunk],
        assignments_by_bunk: dict[str, list[BunkAssignment]],
        stats: ValidationStatistics,
        attendees: list[Any] | None = None,
    ) -> None:
        """Compute per-session breakdown of statistics."""
        # Create session lookup
        session_by_id = {int(s.campminder_id): s for s in all_sessions}

        # Group bunk plans by session
        bunks_by_session = defaultdict(list)
        bunk_to_session = {}
        for plan in bunk_plans:
            session_cm_id = getattr(plan, "session_cm_id", None)
            bunk_cm_id = getattr(plan, "bunk_cm_id", None)
            if session_cm_id and bunk_cm_id:
                bunks_by_session[session_cm_id].append(bunk_cm_id)
                bunk_to_session[str(bunk_cm_id)] = session_cm_id

        # Count attendees by session using attendee enrollment data
        attendees_by_session = defaultdict(set)

        if attendees:
            # Use actual attendee data to map persons to sessions
            for attendee in attendees:
                person_cm_id = getattr(attendee, "person_cm_id", None)
                session_cm_id = getattr(attendee, "session_cm_id", None)
                if person_cm_id and session_cm_id:
                    attendees_by_session[session_cm_id].add(str(person_cm_id))
        else:
            # Fallback: use assignment data if attendees not provided
            for person in persons:
                assignment = assignments_by_person.get(person.campminder_id)
                if assignment and assignment.session_cm_id:
                    session_id = int(assignment.session_cm_id)
                    attendees_by_session[session_id].add(person.campminder_id)

        # Compute breakdown for each session
        for session_cm_id, session in session_by_id.items():
            breakdown = SessionBreakdown(session_cm_id=session_cm_id, session_name=session.name)

            # Count campers in this session
            session_attendees = attendees_by_session.get(session_cm_id, set())
            breakdown.total_campers = len(session_attendees)

            # Count assigned/unassigned
            assigned_count = 0
            for attendee_id in session_attendees:
                if attendee_id in assignments_by_person:
                    assigned_count += 1

            breakdown.assigned_campers = assigned_count
            breakdown.unassigned_campers = breakdown.total_campers - assigned_count

            # Calculate capacity for this session
            session_bunk_ids = bunks_by_session.get(session_cm_id, [])
            breakdown.bunks_count = len(session_bunk_ids)

            session_capacity = 0
            session_used = 0

            for bunk in bunks:
                if int(bunk.campminder_id) in session_bunk_ids:
                    session_capacity += bunk.max_size
                    session_used += len(assignments_by_bunk.get(bunk.campminder_id, []))

            breakdown.total_capacity = session_capacity
            breakdown.used_capacity = session_used

            stats.session_breakdown.append(breakdown)

    def _validate_level_progression(
        self,
        bunks: list[Bunk],
        assignments_by_person: dict[str, BunkAssignment],
        person_by_id: dict[str, Person],
        historical_bunking: list[HistoricalBunkingRecord],
        stats: ValidationStatistics,
        issues: list[ValidationIssue],
    ) -> None:
        """Validate that returning campers haven't regressed to lower bunk levels.

        IMPORTANT: Only compares campers in the SAME session as last year.
        Different sessions have different age ranges, so G-10B → G-3 when moving
        from Session 4 to ToC is expected, not a regression.
        CampMinder reuses session IDs across years, so we can compare directly.
        """
        level_order = get_level_order()

        # Build bunk name lookup from bunk_cm_id
        bunk_by_cm_id = {bunk.campminder_id: bunk for bunk in bunks}

        # Build prior bunk lookup: person_cm_id -> (bunk_name, session_cm_id)
        prior_bunks: dict[int, tuple[str, int | None]] = {}
        for h in historical_bunking:
            prior_bunks[h.person_cm_id] = (h.bunk_name, h.session_cm_id)

        regressions = []
        progressions = 0
        same_level = 0
        returning_count = 0
        skipped_different_session = 0

        for person_cm_id, assignment in assignments_by_person.items():
            # Convert person_cm_id to int if needed for lookup
            person_key = int(person_cm_id) if isinstance(person_cm_id, str) else person_cm_id

            if person_key not in prior_bunks:
                continue  # New camper

            prior_bunk, prior_session_cm_id = prior_bunks[person_key]

            # Get current session from assignment
            current_session_cm_id_raw = assignment.session_cm_id
            # Convert to int for comparison if needed
            current_session_cm_id: int | str = current_session_cm_id_raw
            if isinstance(current_session_cm_id_raw, str):
                try:
                    current_session_cm_id = int(current_session_cm_id_raw)
                except ValueError:
                    current_session_cm_id = current_session_cm_id_raw

            # ONLY compare same-session campers
            # Different sessions have different age ranges - G-10 in Session 4 ≠ G-10 in ToC
            if prior_session_cm_id is None or prior_session_cm_id != current_session_cm_id:
                skipped_different_session += 1
                continue

            returning_count += 1
            prior_level = extract_bunk_level(prior_bunk)

            # Get current bunk name from lookup (BunkAssignment has bunk_cm_id, not bunk_name)
            current_bunk = bunk_by_cm_id.get(assignment.bunk_cm_id)
            current_bunk_name = current_bunk.name if current_bunk else None
            current_level = extract_bunk_level(current_bunk_name) if current_bunk_name else None

            if not prior_level or not current_level:
                continue

            prior_idx = level_order.get(prior_level, -1)
            current_idx = level_order.get(current_level, -1)

            if prior_idx == -1 or current_idx == -1:
                continue

            if current_idx < prior_idx:
                person = person_by_id.get(person_cm_id)
                regressions.append(
                    {
                        "person_cm_id": str(person_cm_id),
                        "person_name": person.name if person else f"Person {person_cm_id}",
                        "prior_bunk": prior_bunk,
                        "current_bunk": current_bunk_name,
                        "levels_regressed": prior_idx - current_idx,
                    }
                )
            elif current_idx > prior_idx:
                progressions += 1
            else:
                same_level += 1

        # Log skipped campers for debugging
        if skipped_different_session > 0:
            logger.debug(
                f"Level progression: skipped {skipped_different_session} campers in different sessions from last year"
            )

        # Update statistics
        stats.level_progression = {
            "returning_campers": returning_count,
            "progressed": progressions,
            "same_level": same_level,
            "regressed": len(regressions),
        }

        # Create issues for regressions
        for reg in regressions:
            person_cm_id_val = reg["person_cm_id"]
            issues.append(
                ValidationIssue(
                    severity=ValidationSeverity.WARNING,
                    type="level_regression",
                    message=f"{reg['person_name']} was in {reg['prior_bunk']} last year but is now in {reg['current_bunk']} (regression of {reg['levels_regressed']} level(s))",
                    details=reg,
                    affected_ids=[str(person_cm_id_val)] if person_cm_id_val is not None else [],
                )
            )

    def _validate_age_grade_flow(
        self,
        bunks: list[Bunk],
        assignments_by_bunk: dict[str, list[BunkAssignment]],
        person_by_id: dict[str, Person],
        stats: ValidationStatistics,
        issues: list[ValidationIssue],
    ) -> None:
        """Validate that younger campers are in lower-numbered bunks (age/grade flow)."""
        level_order = get_level_order()

        # Group bunks by gender (excluding AG/Mixed)
        bunks_by_gender: dict[str, list[Bunk]] = {"M": [], "F": []}
        for bunk in bunks:
            gender = getattr(bunk, "gender", None)
            if gender in bunks_by_gender:
                bunks_by_gender[gender].append(bunk)

        flow_violations: list[dict[str, Any]] = []

        for gender, gender_bunks in bunks_by_gender.items():
            # Calculate average age for each bunk
            bunk_avg_ages: dict[str, dict[str, Any]] = {}
            for bunk in gender_bunks:
                assignments = assignments_by_bunk.get(bunk.campminder_id, [])
                ages: list[int | float] = []
                for a in assignments:
                    person = person_by_id.get(a.person_cm_id)
                    if person and person.age:
                        ages.append(person.age)
                if ages:
                    level = extract_bunk_level(bunk.name)
                    if level:
                        bunk_avg_ages[bunk.campminder_id] = {
                            "bunk": bunk,
                            "avg_age": sum(ages) / len(ages),
                            "level": level,
                        }

            # Sort by level and check for inversions
            sorted_bunks = sorted(
                bunk_avg_ages.values(),
                key=lambda x: level_order.get(str(x.get("level") or ""), 999),
            )

            for i in range(len(sorted_bunks) - 1):
                lower = sorted_bunks[i]
                higher = sorted_bunks[i + 1]

                # Violation: lower-level bunk has HIGHER avg age than higher-level bunk
                # Allow 0.5 year tolerance
                lower_avg_age = float(lower.get("avg_age", 0))
                higher_avg_age = float(higher.get("avg_age", 0))
                if lower_avg_age > higher_avg_age + 0.5:
                    lower_bunk: Bunk = lower["bunk"]
                    higher_bunk: Bunk = higher["bunk"]
                    flow_violations.append(
                        {
                            "gender": "Boys" if gender == "M" else "Girls",
                            "lower_bunk": lower_bunk.name,
                            "lower_avg_age": round(lower_avg_age, 1),
                            "higher_bunk": higher_bunk.name,
                            "higher_avg_age": round(higher_avg_age, 1),
                        }
                    )

        # Update statistics
        stats.age_flow_violations = len(flow_violations)

        for violation in flow_violations:
            issues.append(
                ValidationIssue(
                    severity=ValidationSeverity.WARNING,
                    type="age_flow_inversion",
                    message=f"{violation['lower_bunk']} (avg age {violation['lower_avg_age']}) has older campers than {violation['higher_bunk']} (avg age {violation['higher_avg_age']})",
                    details=violation,
                    affected_ids=[],
                )
            )

    def _validate_isolation_risk(
        self,
        bunks: list[Bunk],
        assignments_by_bunk: dict[str, list[BunkAssignment]],
        requests: list[BunkRequest],
        person_by_id: dict[str, Person],
        stats: ValidationStatistics,
        issues: list[ValidationIssue],
    ) -> None:
        """Detect isolation risk: 1-2 isolated campers in bunks dominated by large friend groups."""
        # Build request graph (same approach as solver isolation.py)
        request_graph: dict[int, set[int]] = defaultdict(set)

        for request in requests:
            if request.request_type == "bunk_with" and request.requested_person_cm_id:
                requester = (
                    int(request.requester_person_cm_id)
                    if isinstance(request.requester_person_cm_id, str)
                    else request.requester_person_cm_id
                )
                requestee = (
                    int(request.requested_person_cm_id)
                    if isinstance(request.requested_person_cm_id, str)
                    else request.requested_person_cm_id
                )
                request_graph[requester].add(requestee)

        # Find connected components via BFS
        def find_component(start: int, visited: set[int]) -> set[int]:
            component: set[int] = set()
            queue: deque[int] = deque([start])

            while queue:
                node = queue.popleft()
                if node in visited:
                    continue
                visited.add(node)
                component.add(node)

                # Follow outgoing edges
                for neighbor in request_graph.get(node, set()):
                    if neighbor not in visited:
                        queue.append(neighbor)

                # Follow incoming edges (bidirectional)
                for other, targets in request_graph.items():
                    if node in targets and other not in visited:
                        queue.append(other)

            return component

        # Find all large components (9+ people)
        visited: set[int] = set()
        large_components: list[set[int]] = []

        for person in request_graph:
            if person not in visited:
                comp = find_component(person, visited)
                if len(comp) >= 9:
                    large_components.append(comp)

        # Check each bunk for isolation risk
        isolation_risks: list[dict[str, Any]] = []

        for bunk in bunks:
            bunk_assignments = assignments_by_bunk.get(bunk.campminder_id, [])
            bunk_people = set()
            for a in bunk_assignments:
                person_id = int(a.person_cm_id) if isinstance(a.person_cm_id, str) else a.person_cm_id
                bunk_people.add(person_id)

            for component in large_components:
                group_in_bunk = bunk_people & component
                others_in_bunk = bunk_people - component

                # Risk: 9-10 from group + 1-2 isolated others
                if 9 <= len(group_in_bunk) <= 10 and 1 <= len(others_in_bunk) <= 2:
                    # Check if "others" have any connections to group
                    isolated: list[dict[str, Any]] = []
                    for other in others_in_bunk:
                        connections = request_graph.get(other, set()) & group_in_bunk
                        incoming = {p for p, t in request_graph.items() if other in t} & group_in_bunk
                        if not connections and not incoming:
                            person_record = person_by_id.get(str(other))
                            isolated.append(
                                {
                                    "cm_id": other,
                                    "name": person_record.name if person_record else f"Person {other}",
                                }
                            )

                    if isolated:
                        isolation_risks.append(
                            {
                                "bunk_name": bunk.name,
                                "group_size": len(group_in_bunk),
                                "isolated_campers": isolated,
                            }
                        )

        # Update statistics
        stats.isolation_risks = len(isolation_risks)

        for risk in isolation_risks:
            isolated_campers: list[dict[str, Any]] = risk.get("isolated_campers", [])
            isolated_names = [str(c.get("name", "")) for c in isolated_campers]
            issues.append(
                ValidationIssue(
                    severity=ValidationSeverity.WARNING,
                    type="isolation_risk",
                    message=f"{risk['bunk_name']} has {risk['group_size']} connected friends + {len(isolated_campers)} isolated camper(s): {', '.join(isolated_names)}",
                    details=risk,
                    affected_ids=[str(c.get("cm_id", "")) for c in isolated_campers],
                )
            )
