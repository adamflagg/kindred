"""
Bunking validation system to analyze assignments and report issues.
"""

import json
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any, TypedDict

from pydantic import BaseModel, Field

from bunking.logging_config import get_logger
from bunking.models import Bunk, BunkAssignment, BunkRequest, Person, Session
from bunking.satisfaction.bucket import MaterialReqRow, compute_material_request_ids
from bunking.satisfaction.predicate import is_request_satisfied
from bunking.solver.constants import (
    DEFAULT_BUNK_CAPACITY,
    MAX_AGE_SPREAD_MONTHS,
    MAX_SINGLE_GRADE_PERCENTAGE,
    MAX_UNIQUE_GRADES_PER_BUNK,
)
from bunking.solver.constraints.helpers import extract_bunk_level, get_level_order
from bunking.sync.bunk_request_processor.core.models import source_from_field
from bunking.sync.bunk_request_processor.shared.constants import (
    SOURCE_FIELD_TO_CONFIG_KEY,
    SourceField,
)

# Canonical SourceField value → field_stats key used by the validator.
# This is the single source of truth: adding a new SourceField means adding one
# entry here, and all input variations are handled automatically.
_SOURCEFIELD_TO_STATS_KEY: dict[str, str] = {
    SourceField.BUNK_REQUEST_FORM: "share_bunk_with",
    SourceField.STAFF_NOT_BUNK_WITH: "do_not_share_with",
    SourceField.BUNKING_NOTES: "bunking_notes",
    SourceField.INTERNAL_NOTES: "internal_notes",
    SourceField.SOCIALIZE_WITH: "socialize_with",
}

# Build a single lookup dict for normalize_source_field().
# Maps all known lowered variations → field_stats keys.
_SOURCE_FIELD_NORMALIZE_LOOKUP: dict[str, str] = {}
# 1. Canonical SourceField values (case-insensitive)
for _src_val, _stats_key in _SOURCEFIELD_TO_STATS_KEY.items():
    _SOURCE_FIELD_NORMALIZE_LOOKUP[_src_val.lower()] = _stats_key
# 2. Stats keys themselves (identity: "socialize_with" → "socialize_with")
_SOURCE_FIELD_NORMALIZE_LOOKUP.update({k: k for k in _SOURCEFIELD_TO_STATS_KEY.values()})
# 3. Config key values (e.g., "socialize_preference" → "socialize_with")
for _src_val, _config_key in SOURCE_FIELD_TO_CONFIG_KEY.items():
    if _src_val in _SOURCEFIELD_TO_STATS_KEY:
        _SOURCE_FIELD_NORMALIZE_LOOKUP[_config_key] = _SOURCEFIELD_TO_STATS_KEY[_src_val]


@dataclass
class HistoricalBunkingRecord:
    """Record of a camper's prior year bunk assignment."""

    person_cm_id: int
    bunk_name: str
    year: int
    session_cm_id: int | None = None  # For same-session regression comparison


logger = get_logger(__name__)


class NegativeRequestViolation(TypedDict):
    """Detail record for a single not_bunk_with violation where both campers share a bunk."""

    requester_cm_id: str
    target_cm_id: str
    requester_name: str
    target_name: str
    bunk_cm_id: str
    bunk_name: str
    session_cm_id: str
    requester_grade: int | None


class PriorityUnsuccessful(TypedDict):
    """Detail record for a priority-keyword-flagged bunk_with request that was not satisfied."""

    requester_cm_id: str
    target_cm_id: str
    requester_name: str
    target_name: str
    raw_text: str  # parent's original wording snippet
    session_cm_id: str
    requester_grade: int | None


class ValidationSeverity(StrEnum):
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

    # Material parent (bunk_with-source only) — drives orange-triangle / parent-min-one rule.
    material_parent_requests: int = 0
    satisfied_material_parent_requests: int = 0
    material_parent_request_satisfaction_rate: float = 0.0
    campers_with_unsatisfied_material_parent_requests: int = 0
    # Persons with ≥1 unmet material parent request — used by the Check Bunking
    # modal drill-down (#1105). Each entry is {cm_id, name}.
    unsatisfied_material_parent_persons: list[dict[str, Any]] = Field(default_factory=list)
    # One entry per unsatisfied MP request with requester_cm_id, requester_name,
    # target_cm_id, target_name, requester_bunk_name, target_bunk_name. Emitted on
    # the validation payload (typed in solver.ts). The post-check modal drill-down
    # this once fed was removed in Group 65 (de-duped against "Families to contact");
    # the field is retained for the API contract / future consumers.
    unsatisfied_material_parent_detail: list[dict[str, str]] = Field(
        default_factory=list,
        description=(
            "One entry per unsatisfied MP request with requester_cm_id, requester_name, "
            "target_cm_id, target_name, requester_bunk_name, target_bunk_name. Emitted on the "
            "validation payload; no longer rendered (the post-check 'Unmet parent requests' "
            "drill-down was removed in Group 65)."
        ),
    )

    # Best-effort parent (socialize_with-source only) — emitted for modal display, drives no alarm.
    best_effort_parent_requests: int = 0
    satisfied_best_effort_parent_requests: int = 0
    best_effort_parent_request_satisfaction_rate: float = 0.0

    # Staff-source request tracking (source_from_field returns "staff"). Source fields:
    # SourceField.STAFF_NOT_BUNK_WITH (stats key "do_not_share_with"), BUNKING_NOTES,
    # INTERNAL_NOTES. Tracked separately because they don't satisfy the
    # "every camper gets one parent request" rule that Stage 4 will enforce.
    staff_requests: int = 0
    satisfied_staff_requests: int = 0
    staff_request_satisfaction_rate: float = 0.0
    campers_with_unsatisfied_staff_requests: int = 0

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
    # Detail list for not_bunk_with violations — one entry per violated pair.
    # Added in TG-4 alongside the existing count field.
    negative_request_violations_detail: list[NegativeRequestViolation] = Field(default_factory=list)

    # Priority-keyword-flagged bunk_with requests that were not satisfied (TG-4/TG-3).
    # Populated by cross-referencing priority_keyword_detected=True requests against
    # the satisfaction loop — only unsatisfied ones appear here.
    priority_unsuccessfuls: list[PriorityUnsuccessful] = Field(default_factory=list)

    # Camper-level two-tier MP coverage (bunk_request_form source only).
    # mp_campers_total = number of distinct requesters with ≥1 MP request.
    # mp_campers_with_at_least_one_satisfied = campers where ≥1 of their MP requests is satisfied.
    # mp_campers_with_all_satisfied = campers where ALL of their MP requests are satisfied.
    mp_campers_total: int = 0
    mp_campers_with_at_least_one_satisfied: int = 0
    mp_campers_with_all_satisfied: int = 0

    # Entirely-impossible MP cohort (the families-to-contact list), reconciled
    # against the final plan. Each entry mirrors impossibility_report's
    # mp_campers_entirely_impossible {cm_id, name, grade, gender, session_cm_id,
    # reason_codes} PLUS honored_in_plan: did the final assignment satisfy any of
    # their (flagged) MP requests anyway? Empty unless impossible_mp_cohort is
    # passed in. These campers are excluded from mp_campers_total (gated), so the
    # post-check renders the full MP camper count as mp_campers_total + len(this list).
    mp_campers_entirely_impossible: list[dict[str, Any]] = Field(default_factory=list)

    # Per-gender bunk capacity and assigned-camper counts.
    # Splits bunks and assignments by bunk.gender (F/M) so the post-check
    # modal and PDF can render capacity-vs-assigned per gender.
    capacity_by_gender: dict[str, dict[str, int]] = Field(
        default_factory=lambda: {"female": {"capacity": 0, "assigned": 0}, "male": {"capacity": 0, "assigned": 0}},
        description="Per-gender bunk capacity and assigned-camper counts. Keys: 'female', 'male'.",
    )


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
        # Spread validation limits (from former SpreadValidator).
        # Grade spread mirrors the solver's hard ceiling so board-side warnings
        # fire on the same threshold the solver enforced (with staff overrides
        # permitted on the bunking board — flagged via grade_spread_warning).
        self.max_grade_spread = MAX_UNIQUE_GRADES_PER_BUNK
        self.max_age_spread_months = MAX_AGE_SPREAD_MONTHS

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
        impossible_request_ids: set[str] | None = None,
        impossible_mp_cohort: list[dict[str, Any]] | None = None,
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

        # Split out assignments for campers who are no longer actively enrolled.
        # ``persons`` is the active-enrolled set (status_id=2); a saved scenario's
        # draft can still hold rows for campers who cancelled after it was built.
        # Counting those stale rows inflates per-bunk occupancy, capacity_by_gender,
        # and assigned_campers (and drives unassigned negative). We exclude them
        # from all occupancy/spread math below — but keep them in the
        # request-satisfaction lookup, which has its own missing-person fallback
        # (a transient sync gap must not silently drop request detail rows; see
        # ``unsatisfied_material_parent_detail``). The next sync's orphan sweep
        # removes the stale rows at the source. Surfaced as an INFO issue.
        active_ids = {p.campminder_id for p in persons}
        active_assignments = [a for a in assignments if a.person_cm_id in active_ids]
        stale_assignments = [a for a in assignments if a.person_cm_id not in active_ids]
        if stale_assignments:
            issues.append(
                ValidationIssue(
                    severity=ValidationSeverity.INFO,
                    type="stale_assignments",
                    message=(
                        f"{len(stale_assignments)} assigned campers are no longer enrolled "
                        f"and were excluded from capacity counts"
                    ),
                    details={"count": len(stale_assignments)},
                    affected_ids=[a.person_cm_id for a in stale_assignments][:10],
                )
            )

        # Create lookup structures
        person_by_id = {p.campminder_id: p for p in persons}
        # Request satisfaction reads the FULL set — its missing-person fallback
        # keeps detail rows from dropping during a sync gap.
        assignments_by_person = {a.person_cm_id: a for a in assignments}
        # Occupancy, capacity, and spread checks read the active-enrolled subset
        # so cancelled campers don't inflate counts or trip spread warnings.
        assignments_by_bunk = defaultdict(list)
        for assignment in active_assignments:
            assignments_by_bunk[assignment.bunk_cm_id].append(assignment)

        # Basic statistics
        stats.total_campers = len(persons)
        stats.assigned_campers = len(active_assignments)
        stats.unassigned_campers = stats.total_campers - stats.assigned_campers

        # Check for unassigned campers
        if stats.unassigned_campers > 0:
            unassigned_ids = [
                person.campminder_id for person in persons if person.campminder_id not in assignments_by_person
            ]

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
        bunk_by_id: dict[str, Bunk] = {b.campminder_id: b for b in bunks}
        self._validate_requests(
            requests,
            assignments_by_person,
            person_by_id,
            stats,
            issues,
            bunk_by_id=bunk_by_id,
            impossible_request_ids=impossible_request_ids,
            impossible_mp_cohort=impossible_mp_cohort,
        )

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

        campers_no_requests = [
            person.campminder_id for person in persons if person.campminder_id not in persons_with_requests
        ]

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

        # Calculate total capacity and utilization. DEFAULT_BUNK_CAPACITY is
        # the hardcoded standard (Phase 2 cabin-capacity cleanup); previously
        # this read ``DEFAULT_BUNK_CAPACITY`` which always defaulted to 12 because the
        # PB ``bunks`` collection had no capacity column.
        stats.total_capacity = len(bunks) * DEFAULT_BUNK_CAPACITY
        stats.used_capacity = stats.assigned_campers
        if stats.total_capacity > 0:
            stats.capacity_utilization_rate = stats.used_capacity / stats.total_capacity

        # Per-gender capacity and assigned counts — Boys (M) and Girls (F) cabins only.
        # Both numerator and denominator come from the BUNK, never person gender:
        #   capacity = (#M/F bunks) × DEFAULT_BUNK_CAPACITY
        #   assigned = bodies sitting in those bunks (heads in the cabin)
        # A camper's own recorded gender is irrelevant — we count cabin occupancy.
        # Non-gendered bunks (family-camp "" / co-ed "Mixed"/"AG") have no M/F gender
        # and fall out of both sides. Capacity is headcount-based because the Bunk
        # model has no per-bunk size column (removed in Phase 2 cleanup).
        capacity_by_gender: dict[str, dict[str, int]] = {
            "female": {"capacity": 0, "assigned": 0},
            "male": {"capacity": 0, "assigned": 0},
        }
        for bunk in bunks:
            gender_key = "female" if bunk.gender == "F" else "male" if bunk.gender == "M" else None
            if gender_key is None:
                continue
            capacity_by_gender[gender_key]["capacity"] += DEFAULT_BUNK_CAPACITY
            capacity_by_gender[gender_key]["assigned"] += len(assignments_by_bunk.get(bunk.campminder_id, []))
        stats.capacity_by_gender = capacity_by_gender

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

            if assigned_count > DEFAULT_BUNK_CAPACITY:
                stats.bunks_over_capacity += 1
                issues.append(
                    ValidationIssue(
                        severity=ValidationSeverity.ERROR,
                        type="capacity_violation",
                        message=f"Bunk {bunk.name} is over capacity ({assigned_count}/{DEFAULT_BUNK_CAPACITY})",
                        details={
                            "bunk_id": bunk.campminder_id,
                            "bunk_name": bunk.name,
                            "assigned": assigned_count,
                            "max_size": DEFAULT_BUNK_CAPACITY,
                        },
                        affected_ids=[bunk.campminder_id],
                    )
                )
            elif assigned_count == DEFAULT_BUNK_CAPACITY:
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
        bunk_by_id: dict[str, Bunk] | None = None,
        impossible_request_ids: set[str] | None = None,
        impossible_mp_cohort: list[dict[str, Any]] | None = None,
    ) -> None:
        """Validate request satisfaction - tracking by source field.

        Aggregate rate metrics (``material_parent_*``, ``staff_*``, ``total_*``,
        ``mp_campers_*``) gate on ``impossible_request_ids`` so the post-check
        denominators match the solver-side ones produced by PR #1463
        (``direct_solver._check_must_satisfy_one_violations``). Without that
        gating, structurally-impossible requests (cross-gender pairs, oldest-grade
        kid asking for "older", etc.) drag the validator's rates below the
        solver's even though no feasible assignment can fix them.
        See #1520.

        Issue listings (``valid_request_unsatisfied`` warnings,
        ``unsatisfied_material_parent_persons`` drill-down) intentionally stay
        ungated — the staff modal still surfaces every unmet request so
        per-camper detail remains visible.
        """
        # Valid statuses are 'resolved' (accepted/approved)
        valid_statuses = {"resolved"}

        # Build assignments_by_bunk for age_preference satisfaction checking
        assignments_by_bunk: dict[str, list[BunkAssignment]] = defaultdict(list)
        for assignment in assignments_by_person.values():
            assignments_by_bunk[assignment.bunk_cm_id].append(assignment)

        # Track requests per person
        requests_by_person = defaultdict(list)
        valid_requests_by_person = defaultdict(list)
        satisfied_requests_by_person = defaultdict(list)
        material_parent_by_person = defaultdict(list)
        satisfied_material_parent_by_person = defaultdict(list)
        best_effort_parent_by_person = defaultdict(list)
        satisfied_best_effort_parent_by_person = defaultdict(list)
        staff_requests_by_person = defaultdict(list)
        satisfied_staff_by_person = defaultdict(list)
        # Alerting bucket = material parent ∪ staff. Best-effort drives no
        # alarms, so socialize_with rows are intentionally absent.
        alerting_requests_by_person: dict[Any, list[Any]] = defaultdict(list)
        satisfied_alerting_by_person: dict[Any, list[Any]] = defaultdict(list)

        def normalize_source_field(raw_field: str) -> str | None:
            """Normalize database source_field values to consistent snake_case keys.

            Maps values like 'Share Bunk With' -> 'share_bunk_with'
            Returns None if the field cannot be mapped to a known field.

            Derives all mappings from the canonical constants in
            bunking.sync.bunk_request_processor.shared.constants so that new
            SourceField values are handled automatically.
            """
            if not raw_field:
                return None
            return _SOURCE_FIELD_NORMALIZE_LOOKUP.get(raw_field.strip().lower())

        def get_source_fields(request: BunkRequest) -> list[str]:
            """Extract and normalize source fields from request."""
            raw_fields = []

            # Try ai_p1_reasoning first (newer format)
            if hasattr(request, "ai_p1_reasoning") and request.ai_p1_reasoning:
                ai_reasoning = request.ai_p1_reasoning
                if isinstance(ai_reasoning, str):
                    try:
                        ai_reasoning = json.loads(ai_reasoning)
                    except json.JSONDecodeError, ValueError:
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
                    except json.JSONDecodeError, ValueError:
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

        # Build the inputs the canonical predicate expects (#1170): person_to_bunk
        # mapping (cm_id ints → bunk cm_id ints) and bunkmate_grades (cm_id →
        # grades of OTHER campers in the same bunk). Built once per validation
        # pass; reused for every request.
        person_to_bunk_canon: dict[int, int] = {}
        for cm_id_str, asgn in assignments_by_person.items():
            try:
                pid_int = int(cm_id_str)
                bid_int = int(asgn.bunk_cm_id)
            except TypeError, ValueError:
                continue
            if bid_int <= 0:
                continue
            person_to_bunk_canon[pid_int] = bid_int

        bunkmate_grades_canon: dict[int, list[int]] = {}
        for cm_id_str, asgn in assignments_by_person.items():
            try:
                pid_int = int(cm_id_str)
            except TypeError, ValueError:
                continue
            grades: list[int] = []
            for other in assignments_by_bunk.get(asgn.bunk_cm_id, []):
                if other.person_cm_id == cm_id_str:
                    continue
                bunkmate = person_by_id.get(other.person_cm_id)
                if bunkmate is None or bunkmate.grade is None:
                    continue
                try:
                    grades.append(int(bunkmate.grade))
                except TypeError, ValueError:
                    continue
            bunkmate_grades_canon[pid_int] = grades

        def _is_satisfied(request: BunkRequest) -> bool:
            """Adapter to bunking.satisfaction.predicate.is_request_satisfied.

            Wraps ALL int() conversions and the canonical call in a single try/except
            so any data-hygiene gap (non-numeric cm_id, non-numeric grade, unknown
            request_type, out-of-range grade) returns False instead of crashing the
            whole validation pass — matching the legacy local predicate's contract.
            """
            try:
                requester_int = int(request.requester_person_cm_id)
                if requester_int not in person_to_bunk_canon:
                    return False
                requester_grade: int | None = None
                requester_person = person_by_id.get(request.requester_person_cm_id)
                if requester_person is not None and requester_person.grade is not None:
                    requester_grade = int(requester_person.grade)
                row: dict[str, Any] = {
                    "requester_id": requester_int,
                    "requestee_id": int(request.requested_person_cm_id) if request.requested_person_cm_id else None,
                    "request_type": request.request_type,
                    "age_preference_target": getattr(request, "age_preference_target", None),
                    "requester_grade": requester_grade,
                }
                return is_request_satisfied(row, person_to_bunk_canon, bunkmate_grades=bunkmate_grades_canon)
            except TypeError, ValueError:
                return False

        # #1664/#1671: contextual material-parent set. A form age_preference is
        # material only as a sole form request — suppressed when its requester
        # also has a resolved-and-possible form bunk_with/not_bunk_with. Computed
        # once from the full request list with the impossibility report the
        # validator already receives, mirroring the solver's single source of truth.
        material_grouping: dict[int, list[MaterialReqRow]] = defaultdict(list)
        for r in requests:
            try:
                material_grouping[int(r.requester_person_cm_id)].append(
                    MaterialReqRow(
                        id=r.id or "",
                        source_field=r.source_field,
                        request_type=r.request_type,
                        status=r.status,
                    )
                )
            except TypeError, ValueError:
                pass  # non-numeric requester_person_cm_id — skipped, matching rest of validator
        material_request_ids = compute_material_request_ids(material_grouping, impossible_request_ids or set())

        # Process each request
        for request in requests:
            requester_id = request.requester_person_cm_id
            requests_by_person[requester_id].append(request)

            # Only consider valid requests (resolved status)
            if request.status in valid_statuses:
                # Skip requests from campers who have no bunk assignment.
                # An unassigned requester cannot be evaluated for satisfaction,
                # so the request is excluded from all totals entirely.
                if requester_id not in assignments_by_person:
                    continue

                valid_requests_by_person[requester_id].append(request)

                # Get source fields (only known fields, unknown fields filtered out)
                source_fields = get_source_fields(request)

                # Bin by source_field for material vs best-effort parent tracking.
                # material = bunk_with source_field; best_effort = socialize_with source_field.
                # Staff binning derived from source_field via source_from_field helper (#1142).
                raw_source_field = getattr(request, "source_field", None)
                try:
                    is_staff = source_from_field(raw_source_field) == "staff" if raw_source_field else False
                except ValueError:
                    is_staff = False

                # Warn when a resolved age_preference row has no source_field.
                # The legacy fallback that treated these as best_effort has been removed (#1086).
                # Such rows should not exist in current data; the warning helps surface data gaps.
                if raw_source_field is None and request.request_type == "age_preference":
                    logger.warning(
                        "resolved age_preference request has null source_field — "
                        "not binned (requester_id=%s, status=%s); "
                        "legacy best_effort fallback removed in #1086",
                        requester_id,
                        request.status,
                    )

                is_best_effort = raw_source_field == SourceField.SOCIALIZE_WITH
                # #1664/#1671: a form age-pref suppressed from material_request_ids
                # is not a material request — drop it from material/alerting (it
                # becomes an immaterial, uncounted row like socialize_with).
                is_material = (
                    raw_source_field == SourceField.BUNK_REQUEST_FORM and (request.id or "") in material_request_ids
                )
                if is_material:
                    material_parent_by_person[requester_id].append(request)
                    alerting_requests_by_person[requester_id].append(request)
                elif is_best_effort:
                    best_effort_parent_by_person[requester_id].append(request)
                elif is_staff:
                    staff_requests_by_person[requester_id].append(request)
                    alerting_requests_by_person[requester_id].append(request)

                # Update field stats (only for known fields)
                for field in source_fields:
                    if field in stats.field_stats:
                        stats.field_stats[field]["total"] += 1

                # Check if this valid request is satisfied (#1170 — canonical predicate via _is_satisfied adapter).
                if _is_satisfied(request):
                    satisfied_requests_by_person[requester_id].append(request)
                    if is_material:
                        satisfied_material_parent_by_person[requester_id].append(request)
                        satisfied_alerting_by_person[requester_id].append(request)
                    elif is_best_effort:
                        satisfied_best_effort_parent_by_person[requester_id].append(request)
                    elif is_staff:
                        satisfied_staff_by_person[requester_id].append(request)
                        satisfied_alerting_by_person[requester_id].append(request)

                    # Update satisfied field stats (only for known fields)
                    for field in source_fields:
                        if field in stats.field_stats:
                            stats.field_stats[field]["satisfied"] += 1
                else:
                    # Unsatisfied request: check for priority keyword flag (TG-3/TG-4).
                    # Only bunk_with requests from a parent with a priority keyword that
                    # ended up unmet should appear in the priority_unsuccessfuls action list.
                    if (
                        request.request_type == "bunk_with"
                        and request.requested_person_cm_id
                        and getattr(request, "priority_keyword_detected", False)
                    ):
                        requester_person = person_by_id.get(requester_id)
                        requested_person = person_by_id.get(request.requested_person_cm_id)
                        requester_grade_val: int | None = None
                        if requester_person is not None and requester_person.grade is not None:
                            requester_grade_val = int(requester_person.grade)
                        stats.priority_unsuccessfuls.append(
                            PriorityUnsuccessful(
                                requester_cm_id=requester_id,
                                target_cm_id=request.requested_person_cm_id,
                                requester_name=requester_person.name if requester_person else f"Person {requester_id}",
                                target_name=requested_person.name
                                if requested_person
                                else f"Person {request.requested_person_cm_id}",
                                raw_text=getattr(request, "raw_text", ""),
                                session_cm_id=request.session_cm_id,
                                requester_grade=requester_grade_val,
                            )
                        )

        # Calculate per-field satisfaction rates
        for field_data in stats.field_stats.values():
            if field_data["total"] > 0:
                field_data["satisfaction_rate"] = field_data["satisfied"] / field_data["total"]

        # Find campers with valid alerting requests (material parent or staff)
        # but NONE satisfied. Best-effort socialize_with rows are excluded
        # because best-effort drives no alarms.
        campers_with_unsatisfied_valid_requests = []

        for person_id, alerting_requests in alerting_requests_by_person.items():
            if len(alerting_requests) == 0:
                continue

            person = person_by_id.get(person_id)
            person_name = person.name if person else f"Person {person_id}"

            # not_bunk_with violation detection runs for ALL campers with any alerting
            # requests, regardless of whether other requests are satisfied. A camper with
            # a satisfied bunk_with AND a violated not_bunk_with must still appear in
            # negative_request_violations_detail ("Families to call").
            for request in alerting_requests:
                if request.request_type == "not_bunk_with" and request.requested_person_cm_id:
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
                        stats.negative_request_violations += 1
                        # Find the bunk name for the detail record.
                        violated_bunk_cm_id = person_assignment.bunk_cm_id
                        violated_bunk = (bunk_by_id or {}).get(violated_bunk_cm_id)
                        violated_bunk_name = violated_bunk.name if violated_bunk else violated_bunk_cm_id
                        requester_person = person_by_id.get(person_id)
                        requester_grade_val = None
                        if requester_person is not None and requester_person.grade is not None:
                            requester_grade_val = int(requester_person.grade)
                        stats.negative_request_violations_detail.append(
                            NegativeRequestViolation(
                                requester_cm_id=person_id,
                                target_cm_id=request.requested_person_cm_id,
                                requester_name=person_name,
                                target_name=requested_name,
                                bunk_cm_id=violated_bunk_cm_id,
                                bunk_name=violated_bunk_name,
                                session_cm_id=request.session_cm_id,
                                requester_grade=requester_grade_val,
                            )
                        )
                        source_fields = get_source_fields(request)
                        issues.append(
                            ValidationIssue(
                                severity=ValidationSeverity.ERROR,
                                type="valid_negative_request_violated",
                                message=f"{person_name} has a valid 'not bunk with' request but is bunked with {requested_name}",
                                details={
                                    "request_type": request.request_type,
                                    "is_first_requested": getattr(request, "is_first_requested", False),
                                    "person_id": person_id,
                                    "requested_person_id": request.requested_person_cm_id,
                                    "status": request.status,
                                    "source_fields": source_fields,
                                },
                                affected_ids=[person_id, request.requested_person_cm_id],
                            )
                        )

            # bunk_with unsatisfied warnings are only emitted when the camper has NO
            # satisfied alerting requests (the "zero satisfied" guard stays here).
            if len(satisfied_alerting_by_person[person_id]) == 0:
                campers_with_unsatisfied_valid_requests.append(person_id)

                # Report each unsatisfied alerting bunk_with request for this person
                for request in alerting_requests:
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
                                    "is_first_requested": getattr(request, "is_first_requested", False),
                                    "person_id": person_id,
                                    "requested_person_id": request.requested_person_cm_id,
                                    "status": request.status,
                                    "source_fields": source_fields,
                                },
                                affected_ids=[person_id, request.requested_person_cm_id],
                            )
                        )

        # Aggregate totals narrow to material_parent + staff (the alerting
        # bucket). Best-effort socialize_with is reported only in its own
        # slice and never contributes to the aggregate or the summary issue.
        total_alerting_requests = sum(len(reqs) for reqs in alerting_requests_by_person.values())
        total_satisfied_alerting_requests = sum(len(reqs) for reqs in satisfied_alerting_by_person.values())

        # #1520: gate aggregate counters on the impossibility set so the
        # post-check denominators match solver-side (PR #1463). Empty/None set
        # = legacy ungated behavior (preserved for callers that don't compute
        # impossibility).
        _impossible_ids: set[str] = impossible_request_ids or set()

        def _gated(reqs: list[BunkRequest]) -> list[BunkRequest]:
            if not _impossible_ids:
                return reqs
            return [r for r in reqs if getattr(r, "id", None) not in _impossible_ids]

        # Material parent (bunk_with source_field) stats.
        stats.material_parent_requests = sum(len(_gated(reqs)) for reqs in material_parent_by_person.values())
        stats.satisfied_material_parent_requests = sum(
            len(_gated(reqs)) for reqs in satisfied_material_parent_by_person.values()
        )
        if stats.material_parent_requests > 0:
            stats.material_parent_request_satisfaction_rate = (
                stats.satisfied_material_parent_requests / stats.material_parent_requests
            )
        stats.campers_with_unsatisfied_material_parent_requests = sum(
            1
            for pid, reqs in material_parent_by_person.items()
            if reqs and not satisfied_material_parent_by_person.get(pid)
        )
        # Match the canonical satisfaction policy from `bunking/satisfaction/aggregate.bucket_status`:
        # the bucket is "unsatisfied" only when total > 0 AND zero satisfied. Partial satisfaction
        # (≥1 of N) classifies as "satisfied" and must NOT appear here, otherwise the drill-down
        # contradicts `campers_with_unsatisfied_material_parent_requests` above.
        unmet_persons: list[dict[str, Any]] = []
        for pid, reqs in material_parent_by_person.items():
            if not reqs or satisfied_material_parent_by_person.get(pid):
                continue
            try:
                cm_id = int(pid)
            except TypeError, ValueError:
                # Non-numeric requester id — same data-hygiene class the canonical
                # predicate already absorbs. Skip rather than crash the summary.
                continue
            person = person_by_id.get(pid)
            unmet_persons.append({"cm_id": cm_id, "name": person.name if person else f"Person {pid}"})
        stats.unsatisfied_material_parent_persons = sorted(unmet_persons, key=lambda entry: entry["name"])

        # Per-request detail for unsatisfied MP requests — one entry per request (not per requester).
        # Reuses material_parent_by_person, satisfied_material_parent_by_person, person_by_id,
        # assignments_by_person, and bunk_by_id — no new lookups needed.
        unsatisfied_material_parent_detail: list[dict[str, str]] = []
        for pid, reqs in material_parent_by_person.items():
            if not reqs or satisfied_material_parent_by_person.get(pid):
                # Camper has ≥1 satisfied MP request → canonical "satisfied" bucket, skip all.
                continue
            for req in reqs:
                if not req.requested_person_cm_id:
                    continue
                # Fall back to a Person {pid} label when person_by_id is incomplete
                # (degraded-data scenarios e.g. partial sync). Mirrors the sibling
                # `unsatisfied_material_parent_persons` block above so the modal's
                # count stays accurate when one variant has data the other lacks.
                requester = person_by_id.get(pid)
                target = person_by_id.get(req.requested_person_cm_id)
                requester_asgn = assignments_by_person.get(pid)
                target_asgn = assignments_by_person.get(req.requested_person_cm_id)
                bunks_map = bunk_by_id or {}
                requester_bunk = bunks_map.get(requester_asgn.bunk_cm_id) if requester_asgn else None
                target_bunk = bunks_map.get(target_asgn.bunk_cm_id) if target_asgn else None
                unsatisfied_material_parent_detail.append(
                    {
                        "requester_cm_id": str(req.requester_person_cm_id),
                        "requester_name": requester.name if requester else f"Person {pid}",
                        "target_cm_id": str(req.requested_person_cm_id),
                        "target_name": (target.name if target else f"Person {req.requested_person_cm_id}"),
                        "requester_bunk_name": requester_bunk.name if requester_bunk else "unassigned",
                        "target_bunk_name": target_bunk.name if target_bunk else "unassigned",
                    }
                )
        stats.unsatisfied_material_parent_detail = unsatisfied_material_parent_detail

        # Camper-level two-tier MP coverage.
        # mp_campers_total = distinct requesters with ≥1 *possible* MP request.
        # at_least_one = requester has ≥1 satisfied (possible) MP request.
        # all_satisfied = requester has ≥1 MP request AND every *possible* MP request is satisfied.
        # #1520: counts gate on impossibility so a camper whose entire MP set is
        # impossible drops out of the denominator (matches solver-side parity).
        stats.mp_campers_total = sum(1 for reqs in material_parent_by_person.values() if _gated(reqs))
        stats.mp_campers_with_at_least_one_satisfied = sum(
            1
            for pid, reqs in material_parent_by_person.items()
            if _gated(reqs) and _gated(satisfied_material_parent_by_person.get(pid, []))
        )
        stats.mp_campers_with_all_satisfied = sum(
            1
            for pid, reqs in material_parent_by_person.items()
            if _gated(reqs) and len(_gated(satisfied_material_parent_by_person.get(pid, []))) == len(_gated(reqs))
        )

        # Reconcile the entirely-impossible MP cohort (the families-to-contact
        # list) against the final plan. An age preference at the extreme grade
        # (oldest "older" / youngest "younger") is flagged impossible — kept out
        # of MSO so it never distorts cabin shape — yet the final assignment may
        # satisfy it anyway when the camper lands in a single-grade cabin.
        # honored_in_plan lets the post-check show "flagged but met anyway"
        # instead of the contradiction. A camper is honored iff ANY of their MP
        # requests is satisfied in the final plan (satisfied_material_parent_by_person
        # is populated ungated above), so cross-gender / cross-session rows stay False.
        # cohort cm_id is an int; satisfied_material_parent_by_person keys are the
        # raw requester ids (str), so normalize to int before membership-testing.
        satisfied_mp_requesters: set[int] = set()
        for pid in satisfied_material_parent_by_person:
            try:
                satisfied_mp_requesters.add(int(pid))
            except TypeError, ValueError:
                continue
        bunks_map = bunk_by_id or {}
        for entry in impossible_mp_cohort or []:
            entry_cm_id = entry.get("cm_id")
            honored = entry_cm_id in satisfied_mp_requesters
            # When honored, name the cabin that met the preference. assignments_by_person
            # is keyed by str person_cm_id; the cohort cm_id is an int — normalize.
            # Mirrors the not-bunk-with violation detail's bunk_name so the post-check reads alike.
            bunk_name: str | None = None
            if honored:
                honored_asgn = assignments_by_person.get(str(entry_cm_id))
                honored_bunk = bunks_map.get(honored_asgn.bunk_cm_id) if honored_asgn else None
                bunk_name = honored_bunk.name if honored_bunk else None
            stats.mp_campers_entirely_impossible.append({**entry, "honored_in_plan": honored, "bunk_name": bunk_name})

        # Best-effort parent (socialize_with source_field) stats.
        stats.best_effort_parent_requests = sum(len(reqs) for reqs in best_effort_parent_by_person.values())
        stats.satisfied_best_effort_parent_requests = sum(
            len(reqs) for reqs in satisfied_best_effort_parent_by_person.values()
        )
        if stats.best_effort_parent_requests > 0:
            stats.best_effort_parent_request_satisfaction_rate = (
                stats.satisfied_best_effort_parent_requests / stats.best_effort_parent_requests
            )

        # #1520: staff requests gate on impossibility too, so `total_requests`
        # (= MP + staff) stays internally consistent.
        stats.staff_requests = sum(len(_gated(reqs)) for reqs in staff_requests_by_person.values())
        stats.satisfied_staff_requests = sum(len(_gated(reqs)) for reqs in satisfied_staff_by_person.values())
        if stats.staff_requests > 0:
            stats.staff_request_satisfaction_rate = stats.satisfied_staff_requests / stats.staff_requests

        stats.campers_with_unsatisfied_staff_requests = sum(
            1 for requester_id in staff_requests_by_person if not satisfied_staff_by_person.get(requester_id)
        )

        # total_requests / satisfied_requests = material_parent + staff.
        # Best-effort socialize_with is reported only in its own slice; an
        # aggregate that included it would surface unactionable noise on
        # the orange-triangle and amber-dot tiles.
        stats.total_requests = stats.material_parent_requests + stats.staff_requests
        stats.satisfied_requests = stats.satisfied_material_parent_requests + stats.satisfied_staff_requests
        if stats.total_requests > 0:
            stats.request_satisfaction_rate = stats.satisfied_requests / stats.total_requests

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
                        "total_valid_requests": total_alerting_requests,
                        "total_satisfied": total_satisfied_alerting_requests,
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
                    except ValueError, TypeError:
                        continue

            # Calculate age spread in months
            ages_in_months = [
                int(person.age * 12) for person in bunk_persons if hasattr(person, "age") and person.age is not None
            ]

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
        max_percentage = MAX_SINGLE_GRADE_PERCENTAGE  # max % of any single grade in a bunk

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
                    except ValueError, TypeError:
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
                    session_capacity += DEFAULT_BUNK_CAPACITY
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
                            "bunk_name": lower_bunk.name,
                            "gender": "Boys" if gender == "M" else "Girls",
                            "lower_bunk": lower_bunk.name,
                            "lower_avg_age": round(lower_avg_age, 1),
                            "higher_bunk": higher_bunk.name,
                            "higher_avg_age": round(higher_avg_age, 1),
                        }
                    )

        # Update statistics
        stats.age_flow_violations = len(flow_violations)

        issues.extend(
            ValidationIssue(
                severity=ValidationSeverity.WARNING,
                type="age_flow_inversion",
                message=f"{violation['lower_bunk']} (avg age {violation['lower_avg_age']}) has older campers than {violation['higher_bunk']} (avg age {violation['higher_avg_age']})",
                details=violation,
                affected_ids=[],
            )
            for violation in flow_violations
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
