"""Per-camper and per-session aggregators over bunking.satisfaction.predicate.

The aggregation policy ("immaterial parent requests are visible per-request
but excluded from totals/coverage") is enforced in this module via
COUNTED_BUCKETS — exactly once.

camper_satisfaction is pure (no IO). session_satisfaction (added in Task 5)
is the IO-bound top-level entry that fetches data and calls camper_satisfaction
per person.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from api.constants.collections import (
    BUNK_ASSIGNMENTS,
    BUNK_ASSIGNMENTS_DRAFT,
    BUNK_REQUESTS,
    PERSONS,
)
from bunking.satisfaction.api_shape import (
    BucketCount,
    CamperSatisfaction,
    PerRequestStatus,
    SatisfactionFlags,
    SatisfactionResponse,
)
from bunking.satisfaction.bucket import COUNTED_BUCKETS, RequestBucket, classify_request
from bunking.satisfaction.predicate import is_request_satisfied


def camper_satisfaction(
    person_cm_id: int,
    person_requests: list[dict[str, Any]],
    person_to_bunk: dict[int, int],
    *,
    bunkmate_grades: dict[int, list[int]] | None = None,
) -> CamperSatisfaction:
    """Aggregate one camper's request statuses.

    Args:
        person_cm_id: Camper cm_id.
        person_requests: Bunk request rows where this camper is the requester.
        person_to_bunk: Mapping of cm_id → bunk_cm_id for assigned campers.
        bunkmate_grades: For age_preference requests; mapping of requester
            cm_id → grades of OTHER campers in their bunk.

    Returns:
        CamperSatisfaction with per_request statuses, counted_totals,
        immaterial visible-uncounted bucket, and derived flags.
    """
    per_request: list[PerRequestStatus] = []
    counted: dict[RequestBucket, list[bool]] = {b: [] for b in COUNTED_BUCKETS}
    immaterial: list[bool] = []

    for req in person_requests:
        bucket = classify_request(str(req["source_field"]))
        satisfied = is_request_satisfied(req, person_to_bunk, bunkmate_grades=bunkmate_grades)
        per_request.append(PerRequestStatus(request_id=str(req.get("id", "")), bucket=bucket, satisfied=satisfied))
        if bucket in COUNTED_BUCKETS:
            counted[bucket].append(satisfied)
        else:
            immaterial.append(satisfied)

    counted_totals = {
        bucket: BucketCount(satisfied=sum(results), total=len(results)) for bucket, results in counted.items()
    }

    material = counted_totals[RequestBucket.MATERIAL_PARENT]
    staff = counted_totals[RequestBucket.STAFF]
    flags = SatisfactionFlags(
        parent_min_one_violation=material.total > 0 and material.satisfied == 0,
        staff_unsatisfied_alert=staff.total > 0 and staff.satisfied < staff.total,
        has_any_counted_request=any(bucket_list for bucket_list in counted.values()),
    )

    return CamperSatisfaction(
        person_cm_id=person_cm_id,
        per_request=per_request,
        counted_totals=counted_totals,
        immaterial=BucketCount(satisfied=sum(immaterial), total=len(immaterial)),
        flags=flags,
    )


def session_satisfaction(
    session_cm_ids: list[int],
    year: int,
    scenario_id: str | None,
    pb_client: Any,
) -> SatisfactionResponse:
    """Compute per-camper satisfaction for an entire session or AG cluster.

    Mirrors OptimizedSocialGraphBuilder.build_social_network's data sourcing:
    - scenario_id set → assignments from BUNK_ASSIGNMENTS_DRAFT for that scenario.
    - scenario_id None → assignments from production BUNK_ASSIGNMENTS.

    Args:
        session_cm_ids: One or more CampMinder session ids to compute
            satisfaction across. For AG-clustered work this includes the
            primary session plus its related AG sessions, sourced from
            SessionContext.related_session_ids. Single-session use passes
            a one-element list.
        year: Camp year.
        scenario_id: Optional PocketBase ID of a saved scenario. When provided,
            bunk assignments are sourced from bunk_assignments_draft; otherwise
            from the production bunk_assignments collection.
        pb_client: PocketBase client instance.

    Returns:
        SatisfactionResponse with per-camper satisfaction keyed by cm_id.
        session_cm_id in the response is the first (primary) id in session_cm_ids.
    """
    if not session_cm_ids:
        raise ValueError("session_cm_ids must contain at least one id")

    # Filter strings for 1-or-N session ids.
    # session_id_filter covers bunk_requests (direct cm_id field).
    session_id_filter = " || ".join(f"session_id = {sid}" for sid in session_cm_ids)
    # session_relation_filter covers bunk_assignments (relation field).
    session_relation_filter = " || ".join(f"session.cm_id = {sid}" for sid in session_cm_ids)

    persons = pb_client.collection(PERSONS).get_full_list(filter=f"year = {year}")
    person_grades: dict[int, int] = {}
    for p in persons:
        cm_id = getattr(p, "cm_id", None)
        grade = getattr(p, "grade", None)
        if cm_id is not None and grade is not None:
            person_grades[int(cm_id)] = int(grade)

    # TODO(security): scenario_id is interpolated into a PB filter string.
    # Validate it matches the PB record-id format (alphanumeric, 15 chars)
    # before reaching this point. Existing pattern across the codebase has the
    # same exposure; auth-gated endpoint mitigates risk for now.
    if scenario_id:
        assignments = pb_client.collection(BUNK_ASSIGNMENTS_DRAFT).get_full_list(
            filter=(f"scenario = '{scenario_id}' && year = {year} && ({session_relation_filter})")
        )
    else:
        assignments = pb_client.collection(BUNK_ASSIGNMENTS).get_full_list(
            filter=f"year = {year} && ({session_relation_filter})"
        )

    person_to_bunk: dict[int, int] = {}
    bunk_to_persons: dict[int, list[int]] = defaultdict(list)
    for a in assignments:
        pid = int(a.person_cm_id)
        bid = int(a.bunk_cm_id)
        person_to_bunk[pid] = bid
        bunk_to_persons[bid].append(pid)

    bunkmate_grades: dict[int, list[int]] = {}
    for pid, bid in person_to_bunk.items():
        bunkmate_grades[pid] = [
            person_grades[other] for other in bunk_to_persons[bid] if other != pid and other in person_grades
        ]

    raw_requests = pb_client.collection(BUNK_REQUESTS).get_full_list(
        filter=(
            f"({session_id_filter}) && year = {year} "
            f'&& status = "resolved" '
            f"&& (merged_into = '' || merged_into = null)"
        )
    )

    requests_by_requester: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in raw_requests:
        if isinstance(r, dict):
            row = dict(r)
            rid = int(row["requester_id"])
        else:
            rid = int(r.requester_id)
            row = {
                "id": getattr(r, "id", ""),
                "requester_id": rid,
                "requestee_id": getattr(r, "requestee_id", None),
                "request_type": getattr(r, "request_type", ""),
                "source_field": getattr(r, "source_field", ""),
                "age_preference_target": getattr(r, "age_preference_target", None),
            }
        if "requester_grade" not in row:
            row["requester_grade"] = person_grades.get(rid)
        requests_by_requester[rid].append(row)

    campers = {}
    for person_cm_id, person_requests in requests_by_requester.items():
        campers[person_cm_id] = camper_satisfaction(
            person_cm_id=person_cm_id,
            person_requests=person_requests,
            person_to_bunk=person_to_bunk,
            bunkmate_grades=bunkmate_grades,
        )

    return SatisfactionResponse(
        campers=campers,
        session_cm_id=session_cm_ids[0],
        year=year,
        scenario_id=scenario_id,
    )
