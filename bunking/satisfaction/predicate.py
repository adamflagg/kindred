"""Per-request satisfaction predicate.

Replaces the inline branching in:
- bunking/solver/score_evaluator.py (evaluate_scenario_score)
- bunking/graph/social_graph_builder.py (_calculate_node_metrics._bucket)
- frontend/src/utils/computeSatisfiedRequestInfo.ts (deleted by this refactor)

frontend/src/utils/requestSatisfaction.ts is the parallel TypeScript
implementation pending #1155 (OpenAPI codegen). Keep its branching in sync
with this module manually until that codegen lands.

Behavior is identical to those predicates — no behavior delta tolerated.

requester_id / requestee_id zero handling — intentional asymmetry:
- requester_id == 0 is treated as a literal id (no fallback chain).
- requestee_id == 0 falls through `or request.get("requested_person_cm_id")`.
Production cm_ids are always positive, so the asymmetry has no practical
effect; the docstring just records the intent so future readers don't
silently flip one branch and break the other.

Two parallel impls — `is_request_satisfied` (bool-only, solver hot path) and
`evaluate_request` (detail-bearing, /api/satisfaction). They MUST stay in
sync; their branching is identical, only the return shape differs.
"""

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

    Canonical bool-only impl, called per-request in the solver hot path
    (`bunking/solver/score_evaluator.py`) and the bunking_validator adapter.
    Allocation-free along the happy path — does not construct or destructure
    the (bool, detail) tuple that `evaluate_request` builds for tooltip
    consumers.

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

    Note:
        `source_field` is not read here; bucket classification is the caller's
        responsibility (see bunking.satisfaction.aggregate.camper_satisfaction).
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
        bunkmates_for_requester = bunkmate_grades.get(requester_id, [])
        requester_grade = request.get("requester_grade")
        if requester_grade is None:
            return False
        grade_int = int(requester_grade)
        if grade_int not in range(0, 13):
            raise ValueError(f"requester_grade {grade_int} out of valid range 0-12")
        satisfied, _ = is_age_preference_satisfied(grade_int, bunkmates_for_requester, str(target))
        return satisfied

    raise ValueError(f"unknown request_type {request_type!r}")


def evaluate_request(
    request: Mapping[str, Any],
    person_to_bunk: dict[int, int],
    *,
    bunkmate_grades: dict[int, list[int]] | None = None,
) -> tuple[bool, str | None]:
    """Return (satisfied, detail) for a request.

    `detail` is a short human-readable explanation suitable for a UI tooltip
    (e.g. "Same bunk", "Different bunks", "No grade on file"). Used by
    `/api/satisfaction` to surface tooltips on the Met/Unmet pill.

    Branching MUST mirror `is_request_satisfied` exactly — only return shape
    differs. Mirrors detail strings in `frontend/src/utils/requestSatisfaction.ts`
    so the drag-preview path (Path 1) and persisted path (Path 2) tooltips
    agree until #1155 OpenAPI codegen lands.

    Args / Raises: see `is_request_satisfied`.
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
        return False, "Requester not assigned"

    if request_type == "bunk_with":
        if not requestee_id_raw:
            return False, "Target not assigned"
        requestee_id = int(requestee_id_raw)
        if requestee_id not in person_to_bunk:
            return False, "Target not assigned"
        if person_to_bunk[requester_id] == person_to_bunk[requestee_id]:
            return True, "Same bunk"
        return False, "Different bunks"

    if request_type == "not_bunk_with":
        if not requestee_id_raw:
            return False, "Target not assigned"
        requestee_id = int(requestee_id_raw)
        if requestee_id not in person_to_bunk:
            return True, "Target not assigned"  # unassigned — no conflict possible
        if person_to_bunk[requester_id] != person_to_bunk[requestee_id]:
            return True, "Different bunks"
        return False, "Same bunk (conflict!)"

    if request_type == "age_preference":
        target = request.get("age_preference_target")
        if not target:
            return False, "No target set"
        if bunkmate_grades is None:
            raise ValueError("bunkmate_grades is required for age_preference requests")
        bunkmates_for_requester = bunkmate_grades.get(requester_id, [])
        requester_grade = request.get("requester_grade")
        if requester_grade is None:
            return False, "No grade on file"
        grade_int = int(requester_grade)
        if grade_int not in range(0, 13):
            raise ValueError(f"requester_grade {grade_int} out of valid range 0-12")
        return is_age_preference_satisfied(grade_int, bunkmates_for_requester, str(target))

    raise ValueError(f"unknown request_type {request_type!r}")
