"""Objective Evaluator - Calculate EXACT solver objective scores for existing assignments.

This module provides read-only evaluation that produces the EXACT same score
the solver would report. It replicates all components of the solver's objective
function for comparing scenarios.

Components evaluated:
1. Request satisfaction (bunk_with, not_bunk_with) with:
   - First-pick boost (is_first_requested → 10x slot-0 multiplier)
   - Source field multipliers
   - Mutual-request boost for reciprocated bunk_with (Stream 4 / #1382)
   - Diminishing returns (always-on, module constants)
2. Age/grade flow bonuses (target grade distribution)
3. Cabin capacity penalties (soft constraint)
4. Minimum occupancy penalties

Grade spread is enforced as a hard solver constraint (see
``MAX_UNIQUE_GRADES_PER_BUNK``); there is no soft-path penalty to mirror.
"""

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from bunking.config import ConfigLoader
from bunking.logging_config import get_logger
from bunking.satisfaction import weight_for
from bunking.solver.bunk_ordering import get_bunk_rank
from bunking.solver.constants import AGE_GRADE_FLOW_WEIGHT, PREFERRED_BUNK_OCCUPANCY
from bunking.solver.direct_solver import (
    BASE_REQUEST_WEIGHT,
    FIRST_REQUEST_MULTIPLIER,
    SECOND_REQUEST_MULTIPLIER,
    THIRD_PLUS_REQUEST_MULTIPLIER,
    find_mutual_pairs,
)
from bunking.solver.penalties import (
    min_occupancy_penalty,
    min_occupancy_threshold,  # noqa: F401 — re-exported for centralization-invariant tests
)
from bunking.sync.bunk_request_processor.core.models import RequestType
from bunking.sync.bunk_request_processor.shared.constants import SourceField

logger = get_logger(__name__)


@dataclass
class ObjectiveBreakdown:
    """Complete breakdown matching solver's objective calculation."""

    # Final score (same as solver.ObjectiveValue())
    total_score: int

    # Component scores
    request_satisfaction_score: int
    age_grade_flow_score: int
    penalty_score: int  # Total penalties (negative contribution)

    # Request details
    total_requests: int
    satisfied_requests: int
    satisfaction_rate: float

    # Per-field breakdown
    field_breakdown: dict[str, dict[str, Any]] = field(default_factory=dict)

    # Penalty breakdown
    penalties: dict[str, int] = field(default_factory=dict)

    # Age/grade flow details
    grade_flow_details: dict[str, Any] = field(default_factory=dict)


class ObjectiveEvaluator:
    """Evaluates solver objective for existing assignments.

    Produces the EXACT same score the solver would report.
    """

    def __init__(
        self,
        config: ConfigLoader | None = None,
    ):
        self.config = config or ConfigLoader.get_instance()

    def evaluate(
        self,
        assignments: dict[int, int],  # person_cm_id -> bunk_cm_id
        requests: list[dict[str, Any]],
        persons: list[dict[str, Any]],
        bunks: list[dict[str, Any]],
    ) -> ObjectiveBreakdown:
        """Evaluate objective score for given assignments.

        Args:
            assignments: Map of person_cm_id to bunk_cm_id
            requests: List of bunk requests with requester_id, requestee_id, etc.
            persons: List of persons with cm_id, grade, gender, session_cm_id
            bunks: List of bunks with cm_id, name, gender, capacity, session_cm_id

        Returns:
            ObjectiveBreakdown with full score details
        """
        # Build lookup structures
        person_by_cm_id = {int(p["cm_id"]): p for p in persons if p.get("cm_id")}
        bunk_by_cm_id = {int(b["cm_id"]): b for b in bunks if b.get("cm_id")}
        bunk_to_persons: dict[int, list[int]] = defaultdict(list)

        for person_cm_id, bunk_cm_id in assignments.items():
            bunk_to_persons[bunk_cm_id].append(person_cm_id)

        # Calculate each component
        request_score, request_details = self._calculate_request_satisfaction(assignments, requests, person_by_cm_id)

        age_grade_score, grade_flow_details = self._calculate_age_grade_flow(
            assignments, persons, bunks, person_by_cm_id, bunk_by_cm_id
        )

        penalties = self._calculate_penalties(bunk_to_persons, person_by_cm_id, bunk_by_cm_id)
        penalty_score = sum(penalties.values())

        # Total score (same formula as solver)
        total_score = request_score + age_grade_score - penalty_score

        return ObjectiveBreakdown(
            total_score=total_score,
            request_satisfaction_score=request_score,
            age_grade_flow_score=age_grade_score,
            penalty_score=penalty_score,
            total_requests=request_details["total"],
            satisfied_requests=request_details["satisfied"],
            satisfaction_rate=(
                request_details["satisfied"] / request_details["total"] if request_details["total"] > 0 else 0.0
            ),
            field_breakdown=request_details["by_field"],
            penalties=penalties,
            grade_flow_details=grade_flow_details,
        )

    def _calculate_request_satisfaction(
        self,
        assignments: dict[int, int],
        requests: list[dict[str, Any]],
        person_by_cm_id: dict[int, dict[str, Any]],
    ) -> tuple[int, dict[str, Any]]:
        """Calculate request satisfaction score with diminishing returns.

        Mirrors solver's add_objective() logic. Off-axis (source_field, request_type)
        combos log a warning and fall back to multiplier 1.0.
        """
        # Config values (same as solver)
        enable_first_boost = bool(self.config.get_int("objective.enable_first_boost", default=1))
        mutual_request_boost = self.config.get_float("objective.mutual_request_boost", default=2.0)

        # Mirror solver's mutual-pair detection on the dict-shaped requests
        # the evaluator consumes. Shared with compute_mutual_bunk_with_pairs
        # via find_mutual_pairs — feed bunk_with edges only, skip self-loops
        # and null requestees.
        mutual_bunk_with_pairs = find_mutual_pairs(
            (int(r["requester_id"]), int(r["requestee_id"]))
            for r in requests
            if r.get("request_type") == RequestType.BUNK_WITH.value
            and r.get("requester_id")
            and r.get("requestee_id")
            and int(r["requester_id"]) != int(r["requestee_id"])
        )

        # Group requests by person (same as solver)
        requests_by_person: dict[int, list[tuple[dict[str, Any], bool]]] = defaultdict(list)
        field_stats: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "satisfied": 0})

        total_requests = 0
        satisfied_count = 0

        for request in requests:
            requester_id = request.get("requester_id")
            requestee_id = request.get("requestee_id")
            request_type = request.get("request_type", "")

            if not requester_id:
                continue

            requester_id = int(requester_id)

            # Skip if requester not in assignments
            if requester_id not in assignments:
                continue

            # Get source field for tracking
            source_field = self._get_primary_source_field(request)

            # Only count bunk_with and not_bunk_with (age_preference handled separately)
            if request_type not in (RequestType.BUNK_WITH.value, RequestType.NOT_BUNK_WITH.value):
                continue

            if not requestee_id:
                continue

            requestee_id = int(requestee_id)
            total_requests += 1
            field_stats[source_field]["total"] += 1

            # Check satisfaction
            is_satisfied = False

            if request_type == RequestType.BUNK_WITH.value:
                # Satisfied if both in same bunk
                if requestee_id in assignments:
                    is_satisfied = assignments[requester_id] == assignments[requestee_id]
            elif request_type == RequestType.NOT_BUNK_WITH.value:
                # Satisfied if in different bunks (or requestee not assigned)
                if requestee_id in assignments:
                    is_satisfied = assignments[requester_id] != assignments[requestee_id]
                else:
                    is_satisfied = True  # Can't be in same bunk if not assigned

            if is_satisfied:
                satisfied_count += 1
                field_stats[source_field]["satisfied"] += 1

            requests_by_person[requester_id].append((request, is_satisfied))

        # Apply diminishing returns (same logic as solver)
        total_score = 0

        for person_requests in requests_by_person.values():
            if enable_first_boost:
                # Sort by is_first_requested DESC (same as solver)
                person_requests.sort(key=lambda x: x[0].get("is_first_requested", False), reverse=True)

            # #1524: use the outer enumerate's `i` so the slot index reflects
            # full-list position (matching the solver's `weight * satisfied_var`
            # accumulator). An unsatisfied first-pick still advances `i`, so a
            # satisfied second-pick lands at SECOND_REQUEST_MULTIPLIER, not
            # FIRST. Pre-fix this tracked a satisfied-only counter, overcounting
            # by 2x relative to the solver's ObjectiveValue.
            for i, (request, is_satisfied) in enumerate(person_requests):
                if not is_satisfied:
                    continue

                # Base weight (same as solver)
                base_weight = float(BASE_REQUEST_WEIGHT)

                # Apply source field multiplier
                source_fields = self._get_source_fields(request)
                if source_fields:
                    try:
                        multiplier = max(
                            weight_for(f, request.get("request_type", ""), self.config) for f in source_fields
                        )
                    except ValueError:
                        logger.warning(
                            "off-axis (source, type) combo in request %s — using multiplier 1.0",
                            request.get("id"),
                        )
                        multiplier = 1.0
                else:
                    multiplier = 1.0
                base_weight = base_weight * multiplier

                # Stream 4 (#1382): mutual bunk_with boost (mirrors solver).
                if request.get("request_type") == RequestType.BUNK_WITH.value:
                    req_id = request.get("requester_id")
                    tgt_id = request.get("requestee_id")
                    if req_id and tgt_id and frozenset({int(req_id), int(tgt_id)}) in mutual_bunk_with_pairs:
                        base_weight = base_weight * mutual_request_boost

                # Apply diminishing returns based on full-list position.
                if i == 0:
                    weight = base_weight * FIRST_REQUEST_MULTIPLIER
                elif i == 1:
                    weight = base_weight * SECOND_REQUEST_MULTIPLIER
                else:
                    weight = base_weight * THIRD_PLUS_REQUEST_MULTIPLIER

                total_score += int(weight)

        return total_score, {
            "total": total_requests,
            "satisfied": satisfied_count,
            "by_field": dict(field_stats),
        }

    def _calculate_age_grade_flow(
        self,
        assignments: dict[int, int],
        persons: list[dict[str, Any]],
        bunks: list[dict[str, Any]],
        person_by_cm_id: dict[int, dict[str, Any]],
        bunk_by_cm_id: dict[int, dict[str, Any]],
    ) -> tuple[int, dict[str, Any]]:
        """Calculate age/grade flow bonuses.

        Exactly mirrors add_age_grade_flow_objective() logic.
        """
        # Hardcoded bonus weight — same constant the solver objective reads, so
        # the displayed score can't drift from what was optimized.
        grade_target_weight = AGE_GRADE_FLOW_WEIGHT

        total_bonus = 0
        details: dict[str, Any] = {"enabled": True, "weight": grade_target_weight, "by_group": {}}

        # Group bunks by gender AND session
        bunks_by_gender_session: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)

        for bunk in bunks:
            gender = bunk.get("gender")
            session_cm_id = bunk.get("session_cm_id")
            if gender in ("M", "F") and session_cm_id:
                bunks_by_gender_session[(gender, session_cm_id)].append(bunk)

        # Sort bunks by level
        def bunk_sort_key(bunk: dict[str, Any]) -> tuple[int, int]:
            rank = get_bunk_rank(bunk.get("name", ""))
            if rank is None:
                return (999, 0)
            return rank

        for key in bunks_by_gender_session:
            bunks_by_gender_session[key].sort(key=bunk_sort_key)

        # Process each gender/session group
        for (gender, session_cm_id), session_bunks in bunks_by_gender_session.items():
            if len(session_bunks) < 2:
                continue

            # Get campers for this group, sorted by grade
            group_campers = sorted(
                [
                    p
                    for p in persons
                    if p.get("cm_id") in assignments
                    and p.get("gender") == gender
                    and p.get("session_cm_id") == session_cm_id
                    and p.get("grade") is not None
                ],
                key=lambda p: (p.get("grade", 0), p.get("age", 0)),
            )

            if not group_campers:
                continue

            num_bunks = len(session_bunks)
            campers_per_bunk = len(group_campers) / num_bunks

            # Calculate target grade for each bunk
            bunk_targets: dict[int, float] = {}

            for bunk_idx, bunk in enumerate(session_bunks):
                start = int(bunk_idx * campers_per_bunk)
                end = int((bunk_idx + 1) * campers_per_bunk)
                if bunk_idx == num_bunks - 1:
                    end = len(group_campers)

                slice_campers = group_campers[start:end]
                if slice_campers:
                    avg_grade = sum(c.get("grade", 0) for c in slice_campers) / len(slice_campers)
                    bunk_targets[bunk["cm_id"]] = avg_grade

            # Calculate grade range for normalization
            all_grades = [c.get("grade", 0) for c in group_campers]
            min_grade = min(all_grades)
            max_grade = max(all_grades)
            grade_range = max(1, max_grade - min_grade)

            # Calculate bonuses for actual assignments
            group_bonus = 0
            for camper in group_campers:
                person_cm_id = camper.get("cm_id")
                if person_cm_id not in assignments:
                    continue

                assigned_bunk_cm_id = assignments[person_cm_id]
                target = bunk_targets.get(assigned_bunk_cm_id)

                if target is not None:
                    grade_diff = abs(camper.get("grade", 0) - target)
                    fit_score = max(0.0, 1.0 - grade_diff / grade_range)
                    bonus = int(fit_score * grade_target_weight)
                    group_bonus += bonus

            total_bonus += group_bonus
            details["by_group"][f"{gender}_{session_cm_id}"] = {
                "campers": len(group_campers),
                "bunks": len(session_bunks),
                "bonus": group_bonus,
            }

        details["total_bonus"] = total_bonus
        return total_bonus, details

    def _calculate_penalties(
        self,
        bunk_to_persons: dict[int, list[int]],
        person_by_cm_id: dict[int, dict[str, Any]],
        bunk_by_cm_id: dict[int, dict[str, Any]],
    ) -> dict[str, int]:
        """Calculate all penalty components.

        Mirrors solver's penalty calculations.
        """
        penalties: dict[str, int] = {}

        # NOTE: grade_spread soft penalty removed in Phase 2. The constraint is
        # now a hard cap (MAX_UNIQUE_GRADES_PER_BUNK in solver/constants.py);
        # there is no soft path for evaluators to mirror.

        # NOTE: cabin_capacity soft penalty removed in Phase 2. Solver enforces
        # capacity as a hard constraint, so over-capacity assignments cannot
        # occur in solved scenarios. The post-solve evaluator no longer reports
        # an "over_capacity" penalty term.

        # Minimum occupancy penalty (always active)
        penalty = self._calculate_occupancy_penalty(bunk_to_persons, bunk_by_cm_id)
        if penalty > 0:
            penalties["under_occupancy"] = penalty

        return penalties

    def _calculate_occupancy_penalty(
        self,
        bunk_to_persons: dict[int, list[int]],
        bunk_by_cm_id: dict[int, dict[str, Any]],
    ) -> int:
        """Calculate under-occupancy penalty (prefer fuller bunks).

        Charges against ``PREFERRED_BUNK_OCCUPANCY`` to match the OR-Tools cost
        path in ``cabin_occupancy.add_cabin_minimum_occupancy_soft_penalty``,
        which adds ``-penalty * max(0, preferred - occupancy)`` per used
        non-AG bunk. The previous implementation charged against the hard
        minimum (B5 drift) so any feasible bunk in the (min, preferred] band
        contributed 0 to the displayed score even though the solver was
        actively pushing toward preferred.
        """
        penalty_per_person = min_occupancy_penalty()

        total_penalty = 0

        for person_ids in bunk_to_persons.values():
            occupancy = len(person_ids)
            if 0 < occupancy < PREFERRED_BUNK_OCCUPANCY:
                deficit = PREFERRED_BUNK_OCCUPANCY - occupancy
                total_penalty += deficit * penalty_per_person

        return total_penalty

    def _get_source_fields(self, request: dict[str, Any]) -> list[str]:
        """Extract source field from a request."""
        source_field = request.get("source_field")
        if source_field:
            return [source_field]

        if request.get("request_type") == RequestType.AGE_PREFERENCE.value:
            return [SourceField.SOCIALIZE_WITH]

        return []

    def _get_primary_source_field(self, request: dict[str, Any]) -> str:
        """Get primary source field for tracking."""
        fields = self._get_source_fields(request)
        return fields[0] if fields else "other"


def evaluate_objective(
    assignments: dict[int, int],
    requests: list[dict[str, Any]],
    persons: list[dict[str, Any]],
    bunks: list[dict[str, Any]],
    config: ConfigLoader | None = None,
) -> ObjectiveBreakdown:
    """Convenience function to evaluate objective score.

    Args:
        assignments: Map of person_cm_id to bunk_cm_id
        requests: List of bunk requests
        persons: List of persons
        bunks: List of bunks
        config: Optional config loader

    Returns:
        ObjectiveBreakdown with full score details
    """
    evaluator = ObjectiveEvaluator(config=config)
    return evaluator.evaluate(assignments, requests, persons, bunks)
