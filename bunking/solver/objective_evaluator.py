"""Objective Evaluator - Calculate EXACT solver objective scores for existing assignments.

This module provides read-only evaluation that produces the EXACT same score
the solver would report. It replicates all components of the solver's objective
function for comparing scenarios.

Components evaluated:
1. Request satisfaction (bunk_with, not_bunk_with) with:
   - Priority weighting
   - Source field multipliers
   - Diminishing returns
2. Age/grade flow bonuses (target grade distribution)
3. Grade spread penalties (soft constraint)
4. Cabin capacity penalties (soft constraint)
5. Minimum occupancy penalties
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from bunking.config import ConfigLoader
from bunking.solver.bunk_ordering import get_bunk_rank

logger = logging.getLogger(__name__)


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

        Exactly mirrors solver's add_objective() logic.
        """
        # Config values (same as solver)
        enable_diminishing = self.config.get_int("objective.enable_diminishing_returns", default=1)
        first_multiplier = self.config.get_int("objective.first_request_multiplier", default=10)
        second_multiplier = self.config.get_int("objective.second_request_multiplier", default=5)
        third_plus_multiplier = self.config.get_int("objective.third_plus_request_multiplier", default=1)

        # Source field multipliers (same as solver)
        source_multipliers = {
            "share_bunk_with": self.config.get_float("objective.source_multipliers.share_bunk_with", default=1.5),
            "do_not_share_with": self.config.get_float("objective.source_multipliers.do_not_share_with", default=1.5),
            "bunking_notes": self.config.get_float("objective.source_multipliers.bunking_notes", default=1.2),
            "internal_notes": self.config.get_float("objective.source_multipliers.internal_notes", default=1.0),
            "socialize_with": self.config.get_float("objective.source_multipliers.socialize_with", default=0.8),
        }

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
            if request_type not in ("bunk_with", "not_bunk_with"):
                continue

            if not requestee_id:
                continue

            requestee_id = int(requestee_id)
            total_requests += 1
            field_stats[source_field]["total"] += 1

            # Check satisfaction
            is_satisfied = False

            if request_type == "bunk_with":
                # Satisfied if both in same bunk
                if requestee_id in assignments:
                    is_satisfied = assignments[requester_id] == assignments[requestee_id]
            elif request_type == "not_bunk_with":
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

        for person_cm_id, person_requests in requests_by_person.items():
            # Sort by priority descending (same as solver)
            person_requests.sort(key=lambda x: x[0].get("priority", 5), reverse=True)

            satisfied_count_for_person = 0

            for i, (request, is_satisfied) in enumerate(person_requests):
                if not is_satisfied:
                    continue

                satisfied_count_for_person += 1

                # Base weight (same as solver: priority * 10)
                priority = request.get("priority", 5)
                base_weight = float(priority * 10)

                # Apply source field multiplier
                source_fields = self._get_source_fields(request)
                if source_fields:
                    multiplier = max(source_multipliers.get(f, 1.0) for f in source_fields)
                else:
                    multiplier = 1.0
                base_weight = base_weight * multiplier

                # Apply diminishing returns based on satisfaction order
                if enable_diminishing:
                    # Use satisfied_count_for_person - 1 as index (0-based)
                    order_idx = satisfied_count_for_person - 1
                    if order_idx == 0:
                        weight = base_weight * first_multiplier
                    elif order_idx == 1:
                        weight = base_weight * second_multiplier
                    else:
                        weight = base_weight * third_plus_multiplier
                else:
                    weight = base_weight

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
        grade_target_weight = self.config.get_soft_constraint_weight("age_grade_flow", default=300)

        if grade_target_weight <= 0:
            return 0, {"enabled": False}

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

        # Grade spread penalty (if soft mode)
        grade_spread_mode = self.config.get_str("constraint.grade_spread.mode", default="hard")
        if grade_spread_mode == "soft":
            penalty = self._calculate_grade_spread_penalty(bunk_to_persons, person_by_cm_id, bunk_by_cm_id)
            if penalty > 0:
                penalties["grade_spread"] = penalty

        # Capacity penalty (if soft mode)
        capacity_mode = self.config.get_str("constraint.cabin_capacity.mode", default="hard")
        if capacity_mode == "soft":
            penalty = self._calculate_capacity_penalty(bunk_to_persons, bunk_by_cm_id)
            if penalty > 0:
                penalties["over_capacity"] = penalty

        # Minimum occupancy penalty (always active)
        penalty = self._calculate_occupancy_penalty(bunk_to_persons, bunk_by_cm_id)
        if penalty > 0:
            penalties["under_occupancy"] = penalty

        return penalties

    def _calculate_grade_spread_penalty(
        self,
        bunk_to_persons: dict[int, list[int]],
        person_by_cm_id: dict[int, dict[str, Any]],
        bunk_by_cm_id: dict[int, dict[str, Any]],
    ) -> int:
        """Calculate grade spread soft constraint penalty."""
        max_spread = self.config.get_int("constraint.grade_spread.max_spread", default=2)
        penalty_per_grade = self.config.get_int("penalty.grade_spread_per_grade", default=100)

        total_penalty = 0

        for bunk_cm_id, person_ids in bunk_to_persons.items():
            grades: list[int] = []
            for pid in person_ids:
                if pid in person_by_cm_id:
                    grade = person_by_cm_id[pid].get("grade")
                    if grade is not None:
                        grades.append(grade)

            if len(grades) >= 2:
                spread = max(grades) - min(grades)
                if spread > max_spread:
                    excess = spread - max_spread
                    total_penalty += excess * penalty_per_grade

        return total_penalty

    def _calculate_capacity_penalty(
        self,
        bunk_to_persons: dict[int, list[int]],
        bunk_by_cm_id: dict[int, dict[str, Any]],
    ) -> int:
        """Calculate over-capacity soft constraint penalty."""
        penalty_per_person = self.config.get_int("penalty.over_capacity", default=500)
        default_capacity = self.config.get_int("constraint.cabin_capacity.standard", default=12)

        total_penalty = 0

        for bunk_cm_id, person_ids in bunk_to_persons.items():
            bunk = bunk_by_cm_id.get(bunk_cm_id, {})
            max_capacity = bunk.get("capacity") or bunk.get("max_size") or default_capacity
            occupancy = len(person_ids)

            if occupancy > max_capacity:
                excess = occupancy - max_capacity
                total_penalty += excess * penalty_per_person

        return total_penalty

    def _calculate_occupancy_penalty(
        self,
        bunk_to_persons: dict[int, list[int]],
        bunk_by_cm_id: dict[int, dict[str, Any]],
    ) -> int:
        """Calculate under-occupancy penalty (prefer fuller bunks)."""
        min_occupancy = self.config.get_int("constraint.cabin_occupancy.minimum", default=8)
        penalty_per_person = self.config.get_int("penalty.under_occupancy", default=50)

        total_penalty = 0

        for bunk_cm_id, person_ids in bunk_to_persons.items():
            occupancy = len(person_ids)
            if 0 < occupancy < min_occupancy:
                deficit = min_occupancy - occupancy
                total_penalty += deficit * penalty_per_person

        return total_penalty

    def _get_source_fields(self, request: dict[str, Any]) -> list[str]:
        """Extract source fields from a request (same logic as solver)."""
        # Try csv_source_fields first
        csv_fields = request.get("csv_source_fields")
        if csv_fields:
            return list(csv_fields)

        # Try ai_reasoning
        ai_reasoning = request.get("ai_reasoning")
        if isinstance(ai_reasoning, dict):
            fields = ai_reasoning.get("csv_source_fields", [])
            if fields:
                return list(fields)

        # Fallback to source_field
        source_field = request.get("source_field")
        if source_field:
            return [str(source_field)]

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
