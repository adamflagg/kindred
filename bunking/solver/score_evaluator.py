"""Score Evaluator - Calculate objective scores for existing assignments.

This module provides functionality to evaluate the "solver score" for any
given assignment state, allowing comparison of scenarios without running
the full solver.

The scoring logic mirrors the solver's objective function:
1. Request satisfaction (bunk_with, not_bunk_with, age_preference)
2. Priority weighting (1-10)
3. Source field multipliers (share_bunk_with, bunking_notes, etc.)
4. Diminishing returns for multiple satisfied requests per person
5. Soft constraint penalties (grade spread, capacity violations, etc.)
"""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from bunking.config import ConfigLoader
from bunking.utils.age_preference import is_age_preference_satisfied

logger = logging.getLogger(__name__)


@dataclass
class ScoreBreakdown:
    """Breakdown of score components for transparency."""

    total_score: int
    request_satisfaction_score: int
    soft_penalty_score: int

    # Request stats
    total_requests: int
    satisfied_requests: int
    satisfaction_rate: float

    # Per-field breakdown
    field_scores: dict[str, dict[str, Any]]

    # Penalties breakdown
    penalties: dict[str, int]


def evaluate_scenario_score(
    requests: list[dict[str, Any]],
    assignments: list[dict[str, Any]],
    persons: list[dict[str, Any]],
    bunks: list[dict[str, Any]],
    config: Any | None = None,
) -> ScoreBreakdown:
    """Evaluate the objective score for a given assignment state.

    This mirrors the solver's objective function calculation to provide
    comparable scores between scenarios.

    Args:
        requests: List of bunk requests with fields:
            - requester_id (cm_id), requestee_id (cm_id), request_type,
            - priority, source_field/csv_source_fields, age_preference_target
        assignments: List of assignments with fields:
            - person_cm_id, bunk_cm_id
        persons: List of persons with fields:
            - cm_id, grade, gender
        bunks: List of bunks with fields:
            - cm_id, name, gender, max_size

    Returns:
        ScoreBreakdown with total score and component breakdown
    """
    if config is None:
        config = ConfigLoader.get_instance()

    # Build lookup maps
    person_to_bunk: dict[int, int] = {}
    bunk_to_persons: dict[int, list[int]] = defaultdict(list)

    for assignment in assignments:
        person_cm_id = assignment.get("person_cm_id") or assignment.get("person_id")
        bunk_cm_id = assignment.get("bunk_cm_id") or assignment.get("bunk_id")
        if person_cm_id and bunk_cm_id:
            person_to_bunk[int(person_cm_id)] = int(bunk_cm_id)
            bunk_to_persons[int(bunk_cm_id)].append(int(person_cm_id))

    person_by_cm_id = {int(p.get("cm_id", 0)): p for p in persons if p.get("cm_id")}
    bunk_by_cm_id = {int(b.get("cm_id", 0)): b for b in bunks if b.get("cm_id")}

    # Get config values
    enable_diminishing = config.get_int("objective.enable_diminishing_returns", default=1)
    first_multiplier = config.get_int("objective.first_request_multiplier", default=10)
    second_multiplier = config.get_int("objective.second_request_multiplier", default=5)
    third_plus_multiplier = config.get_int("objective.third_plus_request_multiplier", default=1)

    # Source field multipliers
    source_multipliers = {
        "share_bunk_with": config.get_float("objective.source_multipliers.share_bunk_with", default=1.5),
        "do_not_share_with": config.get_float("objective.source_multipliers.do_not_share_with", default=1.5),
        "bunking_notes": config.get_float("objective.source_multipliers.bunking_notes", default=1.2),
        "internal_notes": config.get_float("objective.source_multipliers.internal_notes", default=1.0),
        "socialize_with": config.get_float("objective.source_multipliers.socialize_with", default=0.8),
    }

    # Track request satisfaction per person
    person_satisfaction: dict[int, list[tuple[dict[str, Any], int]]] = defaultdict(list)

    # Field-level stats
    field_stats: dict[str, dict[str, Any]] = defaultdict(lambda: {"total": 0, "satisfied": 0, "raw_score": 0})

    total_requests = 0
    satisfied_count = 0

    for request in requests:
        requester_id = int(request.get("requester_id") or request.get("requester_person_cm_id") or 0)
        requestee_id = request.get("requestee_id") or request.get("requested_person_cm_id")
        request_type = request.get("request_type", "")
        priority = int(request.get("priority", 5))
        age_pref_target = request.get("age_preference_target")

        # Get source fields
        source_fields = _get_source_fields(request)
        primary_field = source_fields[0] if source_fields else "other"

        if requester_id == 0:
            continue

        total_requests += 1
        field_stats[primary_field]["total"] += 1

        # Check if request is satisfied
        is_satisfied = False

        if requester_id not in person_to_bunk:
            # Requester not assigned - can't be satisfied
            pass
        elif request_type == "bunk_with" and requestee_id:
            requestee_id = int(requestee_id)
            if requestee_id in person_to_bunk:
                is_satisfied = person_to_bunk[requester_id] == person_to_bunk[requestee_id]
        elif request_type == "not_bunk_with" and requestee_id:
            requestee_id = int(requestee_id)
            if requestee_id in person_to_bunk:
                is_satisfied = person_to_bunk[requester_id] != person_to_bunk[requestee_id]
            else:
                # Requestee not assigned - not_bunk_with is satisfied
                is_satisfied = True
        elif request_type == "age_preference" and age_pref_target:
            person = person_by_cm_id.get(requester_id)
            requester_grade = person.get("grade") if person else None
            if person and requester_grade is not None:
                requester_bunk = person_to_bunk.get(requester_id)
                if requester_bunk:
                    bunkmate_grades: list[int] = []
                    for pid in bunk_to_persons[requester_bunk]:
                        if pid != requester_id and pid in person_by_cm_id:
                            grade = person_by_cm_id[pid].get("grade")
                            if grade is not None:
                                bunkmate_grades.append(grade)
                    is_satisfied, _ = is_age_preference_satisfied(requester_grade, bunkmate_grades, age_pref_target)

        if is_satisfied:
            satisfied_count += 1
            field_stats[primary_field]["satisfied"] += 1

            # Calculate base weight (priority scaled)
            base_weight = priority * 10  # Scale up for visibility

            # Apply source field multiplier
            multiplier = max(source_multipliers.get(f, 1.0) for f in source_fields) if source_fields else 1.0
            weighted_score = int(base_weight * multiplier)

            person_satisfaction[requester_id].append((request, weighted_score))
            field_stats[primary_field]["raw_score"] += weighted_score

    # Apply diminishing returns and calculate final request score
    request_score = 0

    for person_cm_id, satisfactions in person_satisfaction.items():
        # Sort by weighted score descending (prioritize highest value requests)
        satisfactions.sort(key=lambda x: x[1], reverse=True)

        for i, (request, base_score) in enumerate(satisfactions):
            if enable_diminishing:
                if i == 0:
                    final_score = base_score * first_multiplier
                elif i == 1:
                    final_score = base_score * second_multiplier
                else:
                    final_score = base_score * third_plus_multiplier
            else:
                final_score = base_score

            request_score += final_score

    # Calculate soft constraint penalties
    penalties = _calculate_penalties(person_to_bunk, bunk_to_persons, person_by_cm_id, bunk_by_cm_id, config)
    total_penalty = sum(penalties.values())

    # Calculate final score
    total_score = request_score - total_penalty

    return ScoreBreakdown(
        total_score=total_score,
        request_satisfaction_score=request_score,
        soft_penalty_score=total_penalty,
        total_requests=total_requests,
        satisfied_requests=satisfied_count,
        satisfaction_rate=satisfied_count / total_requests if total_requests > 0 else 0.0,
        field_scores=dict(field_stats),
        penalties=penalties,
    )


def _get_source_fields(request: dict[str, Any]) -> list[str]:
    """Extract source fields from a request."""
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

    # Map age_preference to socialize_with
    if request.get("request_type") == "age_preference":
        return ["socialize_with"]

    return []


def _calculate_penalties(
    person_to_bunk: dict[int, int],
    bunk_to_persons: dict[int, list[int]],
    person_by_cm_id: dict[int, dict[str, Any]],
    bunk_by_cm_id: dict[int, dict[str, Any]],
    config: Any,
) -> dict[str, int]:
    """Calculate soft constraint penalties for the current state."""
    penalties: dict[str, int] = {}

    # Grade spread penalty
    grade_spread_penalty = config.get_int("penalty.grade_spread", default=100)
    max_grade_spread = config.get_int("constraint.grade_spread.max_spread", default=2)

    grade_spread_violations = 0
    for bunk_cm_id, person_ids in bunk_to_persons.items():
        grades: list[int] = []
        for pid in person_ids:
            if pid in person_by_cm_id:
                grade = person_by_cm_id[pid].get("grade")
                if grade is not None:
                    grades.append(grade)
        if len(grades) >= 2:
            spread = max(grades) - min(grades)
            if spread > max_grade_spread:
                grade_spread_violations += 1

    if grade_spread_violations > 0:
        penalties["grade_spread"] = grade_spread_violations * grade_spread_penalty

    # Capacity penalty
    capacity_penalty = config.get_int("penalty.over_capacity", default=500)
    standard_capacity = config.get_int("constraint.cabin_capacity.standard", default=12)

    over_capacity_count = 0
    for bunk_cm_id, person_ids in bunk_to_persons.items():
        bunk = bunk_by_cm_id.get(bunk_cm_id, {})
        max_size = bunk.get("max_size") or standard_capacity
        if len(person_ids) > max_size:
            over_capacity_count += len(person_ids) - max_size

    if over_capacity_count > 0:
        penalties["over_capacity"] = over_capacity_count * capacity_penalty

    # Under-occupancy penalty (prefer fuller bunks)
    min_occupancy = config.get_int("constraint.cabin_occupancy.minimum", default=8)
    under_occupancy_penalty = config.get_int("penalty.under_occupancy", default=50)

    under_occupancy_count = 0
    for bunk_cm_id, person_ids in bunk_to_persons.items():
        if len(person_ids) > 0 and len(person_ids) < min_occupancy:
            under_occupancy_count += min_occupancy - len(person_ids)

    if under_occupancy_count > 0:
        penalties["under_occupancy"] = under_occupancy_count * under_occupancy_penalty

    return penalties
