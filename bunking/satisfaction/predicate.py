"""Per-request satisfaction predicate.

Replaces the inline branching in:
- bunking/solver/score_evaluator.py (evaluate_scenario_score)
- bunking/graph/social_graph_builder.py (_calculate_node_metrics._bucket)
- frontend/src/utils/computeSatisfiedRequestInfo.ts (deleted by this refactor)

Behavior is identical to those predicates — no behavior delta tolerated.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from bunking.utils.age_preference import is_age_preference_satisfied


def is_request_satisfied(
    request: Mapping[str, Any],
    person_to_bunk: dict[int, int],
    *,
    bunkmate_grades: dict[int, list[int]] | None = None,
) -> bool:
    """Return whether `request` is satisfied under the given assignments.

    Args:
        request: Bunk request row. Must have `requester_id`, `requestee_id`,
            `request_type`, and (for age_preference) `age_preference_target`
            and `requester_grade`.
        person_to_bunk: Mapping from person cm_id → bunk cm_id for currently
            assigned campers. Unassigned campers must NOT be present in the
            map (callers should not insert sentinel values). All bunk_cm_id
            values must be positive ints (> 0); zero and negative values are
            filtered at the boundary by session_satisfaction.
        bunkmate_grades: For age_preference requests only — mapping from
            requester cm_id → grades of OTHER campers in the same bunk.
            Required when request_type == 'age_preference'.

    Raises:
        ValueError: if request is missing requester_id (and requester_person_cm_id),
            if request_type is unknown, if request_type is 'age_preference' and
            bunkmate_grades is None, or if requester_grade is outside 0-12.
    """
    raw = request.get("requester_id")
    if raw is None:
        raw = request.get("requester_person_cm_id")
    if raw is None:
        raise ValueError("request missing requester_id")
    requester_id = int(raw)
    requestee_id_raw = request.get("requestee_id") or request.get("requested_person_cm_id")
    request_type = request.get("request_type", "")

    if requester_id not in person_to_bunk:
        return False

    if request_type == "bunk_with":
        if not requestee_id_raw:
            return False
        requestee_id = int(requestee_id_raw)
        if requestee_id not in person_to_bunk:
            return False
        return person_to_bunk[requester_id] == person_to_bunk[requestee_id]

    if request_type == "not_bunk_with":
        if not requestee_id_raw:
            return False
        requestee_id = int(requestee_id_raw)
        if requestee_id not in person_to_bunk:
            return True  # requestee unassigned — no conflict possible
        return person_to_bunk[requester_id] != person_to_bunk[requestee_id]

    if request_type == "age_preference":
        target = request.get("age_preference_target")
        if not target:
            return False
        if bunkmate_grades is None:
            raise ValueError("bunkmate_grades is required for age_preference requests")
        requester_grades = bunkmate_grades.get(requester_id, [])
        requester_grade = request.get("requester_grade")
        if requester_grade is None:
            return False
        grade_int = int(requester_grade)
        if grade_int not in range(0, 13):
            raise ValueError(f"requester_grade {grade_int} out of valid range 0-12")
        satisfied, _ = is_age_preference_satisfied(grade_int, requester_grades, str(target))
        return satisfied

    raise ValueError(f"unknown request_type {request_type!r}")
