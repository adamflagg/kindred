"""Per-camper and per-session aggregators over bunking.satisfaction.predicate.

The aggregation policy ("immaterial parent requests are visible per-request
but excluded from totals/coverage") is enforced in this module via
COUNTED_BUCKETS — exactly once.

camper_satisfaction is pure (no IO). session_satisfaction is the synchronous
IO-bound entry point that fetches PocketBase data and calls camper_satisfaction
per person. The caller wraps it in asyncio.to_thread to avoid blocking the
event loop.
"""

from __future__ import annotations

import concurrent.futures
import re
from collections import defaultdict
from typing import Any, Literal, NotRequired, TypedDict

from api.constants.collections import (
    BUNK_ASSIGNMENTS,
    BUNK_ASSIGNMENTS_DRAFT,
    BUNK_REQUESTS,
    PERSONS,
)
from bunking.logging_config import get_logger
from bunking.satisfaction.api_shape import (
    BucketCount,
    CamperSatisfaction,
    PerRequestStatus,
    SatisfactionFlags,
    SatisfactionResponse,
)
from bunking.satisfaction.bucket import COUNTED_BUCKETS, RequestBucket, classify_request
from bunking.satisfaction.predicate import is_request_satisfied

logger = get_logger(__name__)

_PB_RECORD_ID_RE = re.compile(r"^[a-zA-Z0-9]{15}$")
_PB_FETCH_TIMEOUT_S = 30.0


def _coerce_str(v: Any) -> str:
    """Coerce a PB field value to a string, mapping None to '' (not 'None')."""
    return "" if v is None else str(v)


def bucket_status(count: BucketCount) -> Literal["no_requests", "satisfied", "unsatisfied"]:
    """3-state classification of a single bucket's coverage.

    Returns "satisfied" if at least one request in the bucket is satisfied,
    "unsatisfied" if requests exist but none are satisfied, or "no_requests"
    if the bucket has no requests at all.
    """
    if count.total == 0:
        return "no_requests"
    if count.satisfied == 0:
        return "unsatisfied"
    return "satisfied"


class BunkRequestRow(TypedDict):
    id: str
    requester_id: int
    requestee_id: NotRequired[int | None]
    request_type: str
    source_field: str
    age_preference_target: NotRequired[str | None]
    requester_grade: NotRequired[int | None]


def _coerce_row(r: Any) -> BunkRequestRow:
    """Coerce a PocketBase record or plain dict into a BunkRequestRow.

    Uses _coerce_str for string-typed fields so that explicit None values
    (which PB can return for legacy rows) become "" instead of the literal
    string "None" — the latter would defeat downstream missing-field
    fallbacks (bucket.classify_request, source-field backfill).
    """
    if isinstance(r, dict):
        return BunkRequestRow(
            id=_coerce_str(r.get("id")),
            requester_id=int(r["requester_id"]),
            requestee_id=r.get("requestee_id"),
            request_type=_coerce_str(r.get("request_type")),
            source_field=_coerce_str(r.get("source_field")),
            age_preference_target=r.get("age_preference_target"),
            requester_grade=r.get("requester_grade"),
        )
    return BunkRequestRow(
        id=_coerce_str(getattr(r, "id", None)),
        requester_id=int(r.requester_id),
        requestee_id=getattr(r, "requestee_id", None),
        request_type=_coerce_str(getattr(r, "request_type", None)),
        source_field=_coerce_str(getattr(r, "source_field", None)),
        age_preference_target=getattr(r, "age_preference_target", None),
        requester_grade=getattr(r, "requester_grade", None),
    )


def camper_satisfaction(
    person_cm_id: int,
    person_requests: list[BunkRequestRow] | list[dict[str, Any]],
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
        bucket = classify_request(_coerce_str(req.get("source_field")))
        try:
            satisfied = is_request_satisfied(req, person_to_bunk, bunkmate_grades=bunkmate_grades)
        except ValueError as exc:
            # One malformed row should not 500 the whole /api/satisfaction call.
            # Solver's score_evaluator wraps with the same try/except — match that.
            logger.warning(
                "treating request as unsatisfied: %s (request_id=%s)",
                exc,
                req.get("id"),
            )
            satisfied = False
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

    This function is synchronous (blocking IO via a concurrent.futures thread
    pool). Callers from async contexts must wrap it in asyncio.to_thread.

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

    # Defense-in-depth: the router validates scenario_id with the same pattern,
    # but session_satisfaction is public and direct callers (tests, scripts,
    # future routers) can bypass it. Validating here prevents PB filter injection.
    if scenario_id is not None and not _PB_RECORD_ID_RE.fullmatch(scenario_id):
        raise ValueError(f"invalid scenario_id {scenario_id!r}; must match {_PB_RECORD_ID_RE.pattern}")

    # Coerce session ids to int defensively in case a caller passes a stringly-typed list.
    session_cm_ids = [int(sid) for sid in session_cm_ids]

    # Filter strings for 1-or-N session ids.
    # session_id_filter covers bunk_requests (direct cm_id field).
    session_id_filter = " || ".join(f"session_id = {sid}" for sid in session_cm_ids)
    # session_relation_filter covers bunk_assignments (relation field).
    session_relation_filter = " || ".join(f"session.cm_id = {sid}" for sid in session_cm_ids)

    if scenario_id:
        assignments_collection = BUNK_ASSIGNMENTS_DRAFT
        assignments_filter = f"scenario = '{scenario_id}' && year = {year} && ({session_relation_filter})"
    else:
        assignments_collection = BUNK_ASSIGNMENTS
        assignments_filter = f"year = {year} && ({session_relation_filter})"

    requests_filter = (
        f"({session_id_filter}) && year = {year} && status = 'resolved' && (merged_into = '' || merged_into = null)"
    )

    # Task 36: fetch assignments + requests in parallel — they are independent queries.
    # persons must come AFTER assignments because we scope it to person_to_bunk.keys().
    def _fetch_assignments() -> list[Any]:
        rows: list[Any] = pb_client.collection(assignments_collection).get_full_list(
            query_params={"filter": assignments_filter}
        )
        return rows

    def _fetch_requests() -> list[Any]:
        rows: list[Any] = pb_client.collection(BUNK_REQUESTS).get_full_list(query_params={"filter": requests_filter})
        return rows

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        assignments_future = executor.submit(_fetch_assignments)
        requests_future = executor.submit(_fetch_requests)
        try:
            assignments = assignments_future.result(timeout=_PB_FETCH_TIMEOUT_S)
        except Exception:
            logger.exception("failed to fetch %s", assignments_collection)
            raise
        try:
            raw_requests = requests_future.result(timeout=_PB_FETCH_TIMEOUT_S)
        except Exception:
            logger.exception("failed to fetch %s", BUNK_REQUESTS)
            raise

    # Build person_to_bunk from assignments so we can scope the persons fetch.
    person_to_bunk: dict[int, int] = {}
    bunk_to_persons: dict[int, list[int]] = defaultdict(list)
    for a in assignments:
        pid = int(a.person_cm_id)
        bid = int(a.bunk_cm_id)
        if bid <= 0:
            logger.warning("skipping assignment with invalid bunk_cm_id=%d for person %d", bid, pid)
            continue
        person_to_bunk[pid] = bid
        bunk_to_persons[bid].append(pid)

    # Task 34: fetch only the persons whose cm_id appears in assignments, in chunks of 100
    # to keep PocketBase filter strings under the practical URL length limit.
    needed_cm_ids = sorted(person_to_bunk.keys())
    person_grades: dict[int, int] = {}
    if needed_cm_ids:
        chunk_size = 100
        for chunk_start in range(0, len(needed_cm_ids), chunk_size):
            chunk = needed_cm_ids[chunk_start : chunk_start + chunk_size]
            cm_id_filter = " || ".join(f"cm_id = {cid}" for cid in chunk)
            persons = pb_client.collection(PERSONS).get_full_list(
                query_params={"filter": f"year = {year} && ({cm_id_filter})"}
            )
            for p in persons:
                cm_id = getattr(p, "cm_id", None)
                grade = getattr(p, "grade", None)
                if cm_id is not None and grade is not None:
                    person_grades[int(cm_id)] = int(grade)

    bunkmate_grades: dict[int, list[int]] = {}
    for pid, bid in person_to_bunk.items():
        bunkmates = [other for other in bunk_to_persons[bid] if other != pid]
        bunkmate_grades[pid] = [person_grades[other] for other in bunkmates if other in person_grades]
        if len(bunkmates) > len(bunkmate_grades[pid]):
            logger.warning(
                "incomplete bunkmate grades",
                extra={
                    "satisfaction": {
                        "person_cm_id": pid,
                        "bunk_cm_id": bid,
                        "bunkmate_count": len(bunkmates),
                        "graded_count": len(bunkmate_grades[pid]),
                    }
                },
            )

    requests_by_requester: dict[int, list[BunkRequestRow]] = defaultdict(list)
    for r in raw_requests:
        row = _coerce_row(r)
        rid = row["requester_id"]
        if row.get("requester_grade") is None:
            row["requester_grade"] = person_grades.get(rid)
        requests_by_requester[rid].append(row)

    # Pre-populate assigned campers without requests so they still appear in the
    # response with zero counts. Skip campers who have requests — those will be
    # computed below; pre-populating them is wasted work.
    campers: dict[int, CamperSatisfaction] = {
        pid: camper_satisfaction(person_cm_id=pid, person_requests=[], person_to_bunk=person_to_bunk)
        for pid in person_to_bunk
        if pid not in requests_by_requester
    }
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
