"""Score Evaluator - Calculate objective scores for existing assignments.

This module provides functionality to evaluate the "solver score" for any
given assignment state, allowing comparison of scenarios without running
the full solver.

The scoring logic *approximately* mirrors the solver's objective function
for diagnostic and scenario-comparison purposes. Components:

1. Request satisfaction reward — `bunk_with`, `not_bunk_with`, and
   `age_preference`. NOTE: `age_preference` is included here as a
   diagnostic reward, but the live solver's CP-SAT objective
   (`direct_solver.py:562-583`) does NOT include `age_preference` terms.
   In the solver, MP `age_preference` is enforced as a HARD constraint via
   `parent_paramount` (forcing indicators), and non-MP `age_preference`
   has no solver representation at all. This evaluator's score therefore
   over-counts relative to the solver's true objective when an assignment
   satisfies `age_preference` requests; that is intentional for analysis.
2. First-pick boost (is_first_requested → 10x slot-0 multiplier)
3. Source field multipliers (keyed by canonical SourceField values)
4. Mutual-request boost for reciprocated bunk_with (Stream 4 / #1382)
5. Diminishing returns for multiple satisfied requests per person
6. Soft constraint penalties (capacity violations, minimum occupancy). Grade
   spread is hard-enforced by the solver and is not mirrored here.

See `docs/reference/objective-sensitivity.md` for the per-component
magnitudes and the canonical solver-objective composition.
"""

from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from bunking.config import ConfigLoader
from bunking.logging_config import get_logger
from bunking.satisfaction import is_request_satisfied, weight_for
from bunking.solver.constants import PREFERRED_BUNK_OCCUPANCY
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
    mutual_request_boost = config.get_float("objective.mutual_request_boost", default=2.0)

    # Stream 4 (#1382): pairs where both directions filed bunk_with. Same
    # detection as solver / objective_evaluator via the shared helper.
    mutual_bunk_with_pairs = find_mutual_pairs(
        (int(r["requester_id"]), int(r["requestee_id"]))
        for r in requests
        if r.get("request_type") == RequestType.BUNK_WITH.value
        and r.get("requester_id")
        and r.get("requestee_id")
        and int(r["requester_id"]) != int(r["requestee_id"])
    )

    # Track request satisfaction per person. Holds (request, weighted_score, is_satisfied)
    # for every request, not just satisfied ones — the diminishing-returns loop
    # iterates the full list to advance `i` across unsatisfied slots (matching
    # the solver's full-list ordering — see #1524).
    person_satisfaction: dict[int, list[tuple[dict[str, Any], int, bool]]] = defaultdict(list)

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

        # Compute the per-request weight only when satisfied — unsatisfied
        # requests contribute 0 to request_score (the diminishing-returns loop
        # `continue`s past them), and calling weight_for() on an unknown
        # (source, type) combo would raise. The placeholder 0 keeps the
        # full-list position so `i` matches the solver's ordering (#1524).
        if is_satisfied:
            satisfied_count += 1
            field_stats[primary_field]["satisfied"] += 1

            base_weight: float = float(BASE_REQUEST_WEIGHT)
            multiplier = max(weight_for(f, request_type, config) for f in source_fields) if source_fields else 1.0
            base_weight = base_weight * multiplier

            # Stream 4 (#1382): mutual bunk_with boost (mirrors solver).
            if request_type == RequestType.BUNK_WITH.value:
                requestee_id = request.get("requestee_id")
                if requestee_id and frozenset({requester_id, int(requestee_id)}) in mutual_bunk_with_pairs:
                    base_weight = base_weight * mutual_request_boost

            weighted_score = int(base_weight)
            field_stats[primary_field]["raw_score"] += weighted_score
        else:
            weighted_score = 0

        person_satisfaction[requester_id].append((request, weighted_score, is_satisfied))

    # Apply diminishing returns and calculate final request score
    request_score = 0

    for person_cm_id, satisfactions in person_satisfaction.items():
        if enable_first_boost:
            satisfactions.sort(key=lambda x: x[0].get("is_first_requested", False), reverse=True)

        for i, (request, base_score, is_satisfied) in enumerate(satisfactions):
            if not is_satisfied:
                continue
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

    # NOTE: grade_spread penalty removed in Phase 2. Solver enforces the
    # MAX_UNIQUE_GRADES_PER_BUNK ceiling as a hard constraint; the prior B3-fix
    # mirror was tied to the soft path and is obsolete dead weight under
    # soft-path deletion.

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
