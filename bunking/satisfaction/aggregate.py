"""Per-camper and per-session aggregators over bunking.satisfaction.predicate.

The aggregation policy ("immaterial parent requests are visible per-request
but excluded from totals/coverage") is enforced in this module via
COUNTED_BUCKETS — exactly once.

camper_satisfaction is pure (no IO). session_satisfaction (added in Task 5)
is the IO-bound top-level entry that fetches data and calls camper_satisfaction
per person.
"""

from __future__ import annotations

from typing import Any

from api.schemas.satisfaction import (
    BucketCount,
    CamperSatisfaction,
    PerRequestStatus,
    SatisfactionFlags,
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
