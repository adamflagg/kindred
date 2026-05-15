"""Score Evaluator - Calculate objective scores for existing assignments.

This module provides functionality to evaluate the "solver score" for any
given assignment state, allowing comparison of scenarios without running
the full solver.

The scoring logic mirrors the solver's objective function:
1. Request satisfaction (bunk_with, not_bunk_with, age_preference)
2. First-pick boost (is_first_requested → 10x slot-0 multiplier)
3. Source field multipliers (keyed by canonical SourceField values)
4. Diminishing returns for multiple satisfied requests per person
5. Soft constraint penalties (grade spread, capacity violations, etc.)
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from bunking.config import ConfigLoader
from bunking.logging_config import get_logger
from bunking.satisfaction import is_request_satisfied
from bunking.solver.constants import PREFERRED_BUNK_OCCUPANCY
from bunking.solver.direct_solver import (
    BASE_REQUEST_WEIGHT,
    FIRST_REQUEST_MULTIPLIER,
    SECOND_REQUEST_MULTIPLIER,
    THIRD_PLUS_REQUEST_MULTIPLIER,
)
from bunking.solver.penalties import (
    grade_spread_penalty,
    min_occupancy_penalty,
    min_occupancy_threshold,  # noqa: F401 — re-exported for centralization-invariant tests
)
from bunking.sync.bunk_request_processor.core.models import RequestType
from bunking.sync.bunk_request_processor.shared.constants import SourceField

logger = get_logger(__name__)


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
            - is_first_requested, source_field, age_preference_target
        assignments: List of assignments with fields:
            - person_cm_id, bunk_cm_id
        persons: List of persons with fields:
            - cm_id, grade, gender
        bunks: List of bunks with fields:
            - cm_id, name, gender

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
    enable_first_boost = bool(config.get_int("objective.enable_first_boost", default=1))

    # Source field multipliers
    source_multipliers = {
        SourceField.BUNK_REQUEST_FORM: config.get_float("objective.source_multipliers.share_bunk_with", default=1.5),
        SourceField.STAFF_NOT_BUNK_WITH: config.get_float(
            "objective.source_multipliers.do_not_share_with", default=1.5
        ),
        SourceField.BUNKING_NOTES: config.get_float("objective.source_multipliers.bunking_notes", default=1.2),
        SourceField.INTERNAL_NOTES: config.get_float("objective.source_multipliers.internal_notes", default=1.0),
        SourceField.SOCIALIZE_WITH: config.get_float("objective.source_multipliers.socialize_preference", default=0.8),
    }

    # Track request satisfaction per person
    person_satisfaction: dict[int, list[tuple[dict[str, Any], int]]] = defaultdict(list)

    # Field-level stats
    field_stats: dict[str, dict[str, Any]] = defaultdict(lambda: {"total": 0, "satisfied": 0, "raw_score": 0})

    total_requests = 0
    satisfied_count = 0

    for request in requests:
        requester_id = int(request.get("requester_id") or request.get("requester_person_cm_id") or 0)
        request_type = request.get("request_type", "")

        # Get source fields
        source_fields = _get_source_fields(request)
        primary_field = source_fields[0] if source_fields else "other"

        if requester_id == 0:
            continue

        total_requests += 1
        field_stats[primary_field]["total"] += 1

        # Check if request is satisfied — delegated to the canonical predicate
        # in bunking.satisfaction. We pre-build bunkmate_grades for age_preference
        # and pad requester_grade onto the request dict for the predicate to read.
        bunkmate_grades_map: dict[int, list[int]] | None = None
        if request_type == RequestType.AGE_PREFERENCE.value:
            requester_bunk = person_to_bunk.get(requester_id)
            grades: list[int] = []
            if requester_bunk is not None:
                for pid in bunk_to_persons[requester_bunk]:
                    if pid != requester_id and pid in person_by_cm_id:
                        grade = person_by_cm_id[pid].get("grade")
                        if grade is not None:
                            grades.append(int(grade))
            bunkmate_grades_map = {requester_id: grades}

        # Backfill when the field is missing OR present-and-None. PB rows can
        # carry requester_grade=None explicitly (legacy rows pre-backfill); the
        # bare `not in` check missed those, treating age_preference as unsatisfied.
        # Skip the dict copy on the common path where requester_grade is already set.
        request_for_predicate: Mapping[str, Any] = request
        if request.get("requester_grade") is None:
            person_for_grade = person_by_cm_id.get(requester_id)
            if person_for_grade is not None:
                request_for_predicate = {
                    **request,
                    "requester_grade": person_for_grade.get("grade"),
                }

        try:
            is_satisfied = is_request_satisfied(
                request_for_predicate,
                person_to_bunk,
                bunkmate_grades=bunkmate_grades_map,
            )
        except ValueError as e:
            logger.warning(
                "treating request as unsatisfied: %s (request_id=%s)",
                e,
                request.get("id"),
            )
            is_satisfied = False

        if is_satisfied:
            satisfied_count += 1
            field_stats[primary_field]["satisfied"] += 1

            # Calculate base weight
            base_weight = BASE_REQUEST_WEIGHT

            # Apply source field multiplier
            multiplier = max(source_multipliers.get(f, 1.0) for f in source_fields) if source_fields else 1.0
            weighted_score = int(base_weight * multiplier)

            person_satisfaction[requester_id].append((request, weighted_score))
            field_stats[primary_field]["raw_score"] += weighted_score

    # Apply diminishing returns and calculate final request score
    request_score = 0

    for person_cm_id, satisfactions in person_satisfaction.items():
        if enable_first_boost:
            satisfactions.sort(key=lambda x: x[0].get("is_first_requested", False), reverse=True)

        for i, (request, base_score) in enumerate(satisfactions):
            if i == 0:
                final_score = base_score * FIRST_REQUEST_MULTIPLIER
            elif i == 1:
                final_score = base_score * SECOND_REQUEST_MULTIPLIER
            else:
                final_score = base_score * THIRD_PLUS_REQUEST_MULTIPLIER

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
    """Extract source field from a request.

    Returns the canonical SourceField value from the source_field key.
    Falls back to SourceField.SOCIALIZE_WITH for age_preference requests.
    """
    source_field = request.get("source_field")
    if source_field:
        return [source_field]

    if request.get("request_type") == RequestType.AGE_PREFERENCE.value:
        return [SourceField.SOCIALIZE_WITH]

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

    # Grade spread penalty (B3 fix). Mirrors the OR-Tools cost term in
    # ``bunking/solver/constraints/grade_spread.py:add_grade_spread_soft_constraint``,
    # which uses ``excess = max(0, unique_grade_count - max_unique_grades)``
    # and contributes ``-penalty_weight * excess`` to the objective. The
    # previous formula counted bunks with ANY range > max_spread once each,
    # which both over-counted in some cases (range=5 but unique=2) and
    # under-counted in others (range=2 but unique=3 with two equal-distance
    # gaps).
    grade_spread_penalty_weight = grade_spread_penalty()
    max_unique_grades = config.get_int("constraint.grade_spread.max_spread", default=2)

    total_grade_spread_excess = 0
    for person_ids in bunk_to_persons.values():
        unique_grades = {
            person_by_cm_id[pid].get("grade")
            for pid in person_ids
            if pid in person_by_cm_id and person_by_cm_id[pid].get("grade") is not None
        }
        total_grade_spread_excess += max(0, len(unique_grades) - max_unique_grades)

    if total_grade_spread_excess > 0:
        penalties["grade_spread"] = total_grade_spread_excess * grade_spread_penalty_weight

    # NOTE: over_capacity penalty removed in Phase 2. Solver enforces capacity
    # as a hard constraint, so no over-capacity assignments can appear in
    # solved scenarios. This penalty term used to back-fill the displayed
    # score; with the soft path gone there's nothing to back-fill.

    # Under-occupancy penalty (B5 fix — charge against PREFERRED_BUNK_OCCUPANCY,
    # not the hard minimum, so the displayed score matches what the OR-Tools
    # cost path actually optimized. The cost path adds
    # ``-penalty * max(0, preferred - occupancy)`` for each used non-AG bunk.
    # Reading ``min_occupancy_threshold()`` here used to make every feasible
    # bunk in the (min, preferred] band contribute 0 to the displayed score.
    under_occupancy_penalty = min_occupancy_penalty()

    under_occupancy_count = 0
    for person_ids in bunk_to_persons.values():
        if 0 < len(person_ids) < PREFERRED_BUNK_OCCUPANCY:
            under_occupancy_count += PREFERRED_BUNK_OCCUPANCY - len(person_ids)

    if under_occupancy_count > 0:
        penalties["under_occupancy"] = under_occupancy_count * under_occupancy_penalty

    return penalties
