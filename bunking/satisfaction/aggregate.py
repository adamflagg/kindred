"""Per-camper and per-session aggregators over bunking.satisfaction.predicate.

The aggregation policy ("immaterial parent requests are visible per-request
but excluded from totals/coverage") is enforced in this module via
COUNTED_BUCKETS — exactly once.

camper_satisfaction is pure (no IO). session_satisfaction is the synchronous
IO-bound entry point that fetches PocketBase data and calls camper_satisfaction
per person. The caller wraps it in asyncio.to_thread to avoid blocking the
event loop.
"""

import concurrent.futures
import re
from collections import defaultdict
from itertools import batched
from typing import Any, Literal, NotRequired, TypedDict

from api.constants.collections import (
    BUNK_ASSIGNMENTS,
    BUNK_ASSIGNMENTS_DRAFT,
    BUNK_REQUESTS,
    PERSONS,
)
from api.utils.session_metrics import get_bunk_from_expand, get_person_from_expand
from bunking.logging_config import get_logger
from bunking.satisfaction.api_shape import (
    BucketCount,
    CamperSatisfaction,
    PerRequestStatus,
    SatisfactionFlags,
    SatisfactionResponse,
)
from bunking.satisfaction.bucket import (
    COUNTED_BUCKETS,
    MaterialReqRow,
    RequestBucket,
    classify_request,
    compute_material_request_ids,
)
from bunking.satisfaction.predicate import evaluate_request

logger = get_logger(__name__)

_PB_RECORD_ID_PATTERN = r"^[a-zA-Z0-9]{15}$"
_PB_RECORD_ID_RE = re.compile(_PB_RECORD_ID_PATTERN)


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

    Raises ValueError when requester_id is missing or None — the row cannot
    be aggregated without it. session_satisfaction catches this and skips
    the row so one bad row doesn't 500 the whole /api/satisfaction call.
    """
    raw_requester = r.get("requester_id") if isinstance(r, dict) else getattr(r, "requester_id", None)
    if raw_requester is None:
        raise ValueError("row missing requester_id; cannot aggregate")

    def _get(key: str, default: Any = None) -> Any:
        return r.get(key, default) if isinstance(r, dict) else getattr(r, key, default)

    return BunkRequestRow(
        id=_coerce_str(_get("id")),
        requester_id=int(raw_requester),
        requestee_id=_get("requestee_id"),
        request_type=_coerce_str(_get("request_type")),
        source_field=_coerce_str(_get("source_field")),
        age_preference_target=_get("age_preference_target"),
        requester_grade=_get("requester_grade"),
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
    # #1664/#1672: a form age_preference is material only as a sole form request.
    # Suppress it (count as immaterial) when a coexisting resolved form
    # bunk_with/not_bunk_with exists. This path has no impossibility data and is
    # frontend-polled, so we pass an empty impossible set (option (b)): suppression
    # fires on any resolved coexisting real form request. A coexisting *impossible*
    # form request would over-suppress vs the solver/validator — an accepted,
    # documented divergence for this hot read path. Per-request statuses are untouched.
    material_rows = [
        MaterialReqRow(
            id=str(req.get("id", "")),
            source_field=_coerce_str(req.get("source_field")),
            request_type=_coerce_str(req.get("request_type")),
            status="resolved",
        )
        for req in person_requests
    ]
    material_ids = compute_material_request_ids({person_cm_id: material_rows}, set())

    per_request: list[PerRequestStatus] = []
    counted: dict[RequestBucket, list[bool]] = {b: [] for b in COUNTED_BUCKETS}
    immaterial: list[bool] = []

    for req in person_requests:
        bucket = classify_request(_coerce_str(req.get("source_field")))
        detail: str | None = None
        try:
            satisfied, detail = evaluate_request(req, person_to_bunk, bunkmate_grades=bunkmate_grades)
        except ValueError as exc:
            # One malformed row should not 500 the whole /api/satisfaction call.
            # Solver's score_evaluator wraps with the same try/except — match that.
            logger.warning(
                "treating request as unsatisfied: %s (request_id=%s)",
                exc,
                req.get("id"),
            )
            satisfied = False
        req_id = str(req.get("id", ""))
        per_request.append(PerRequestStatus(request_id=req_id, bucket=bucket, satisfied=satisfied, detail=detail))
        if bucket == RequestBucket.MATERIAL_PARENT and req_id not in material_ids:
            # #1664: suppressed coexisting form age-pref — visible per-request, uncounted.
            immaterial.append(satisfied)
        elif bucket in COUNTED_BUCKETS:
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

    # Same defense-in-depth for year — interpolated raw into PB filter strings
    # (`year = {year}`), so a non-int caller (test/script bypassing the router)
    # could inject filter syntax. Coerce + range-check matching the router's
    # ge=2000, le=2100.
    try:
        year = int(year)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid year {year!r}; must be an int") from exc
    if not 2000 <= year <= 2100:
        raise ValueError(f"invalid year {year}; must be between 2000 and 2100")

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
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        # bunk_assignments has person/bunk as relation fields (PB record ids), not
        # flat person_cm_id/bunk_cm_id attributes. expand=person,bunk populates the
        # SDK's expand payload so cm_ids resolve via expand.person.cm_id /
        # expand.bunk.cm_id — matches social_graph_builder.py's pattern.
        assignments_future = executor.submit(
            pb_client.collection(assignments_collection).get_full_list,
            query_params={"filter": assignments_filter, "expand": "person,bunk"},
        )
        requests_future = executor.submit(
            pb_client.collection(BUNK_REQUESTS).get_full_list,
            query_params={"filter": requests_filter},
        )
        try:
            assignments = assignments_future.result(timeout=30.0)
        except Exception:
            logger.exception("failed to fetch %s", assignments_collection)
            raise
        try:
            raw_requests = requests_future.result(timeout=30.0)
        except Exception:
            logger.exception("failed to fetch %s", BUNK_REQUESTS)
            raise

    # Build person_to_bunk from assignments so we can scope the persons fetch.
    person_to_bunk: dict[int, int] = {}
    bunk_to_persons: dict[int, list[int]] = defaultdict(list)
    for a in assignments:
        person_data = get_person_from_expand(a)
        bunk_data = get_bunk_from_expand(a)
        # Distinguish "intentionally unassigned" from "dangling FK". The
        # stranded_assignment_cleanup clears `bunk` to '' on draft rows whose
        # (session, bunk) pair drops out of bunk_plans so the camper falls
        # back into the Unassigned pool — empty rel is the canonical signal
        # for that, not corruption. A non-empty rel that fails to expand
        # IS corruption and must still surface.
        person_rel = getattr(a, "person", "") or ""
        bunk_rel = getattr(a, "bunk", "") or ""
        if not person_rel or not bunk_rel:
            continue
        if person_data is None or bunk_data is None:
            logger.warning(
                "skipping assignment with unresolved expand (person/bunk missing): assignment_id=%s",
                getattr(a, "id", "<unknown>"),
            )
            continue
        # Mirror the dual-shape contract of get_person_from_expand / get_bunk_from_expand:
        # the expand payload may be either a dict or an attribute-style object, so cm_id
        # has to be read accordingly.
        person_cm_id_val = (
            person_data.get("cm_id") if isinstance(person_data, dict) else getattr(person_data, "cm_id", None)
        )
        bunk_cm_id_val = bunk_data.get("cm_id") if isinstance(bunk_data, dict) else getattr(bunk_data, "cm_id", None)
        if person_cm_id_val is None or bunk_cm_id_val is None:
            logger.warning(
                "skipping assignment with missing cm_id on expanded relation: assignment_id=%s",
                getattr(a, "id", "<unknown>"),
            )
            continue
        try:
            pid = int(person_cm_id_val)
            bid = int(bunk_cm_id_val)
        except TypeError, ValueError:
            # Non-numeric cm_id — data hygiene gap (manual edit, partial sync,
            # schema regression). Skip rather than 500 the whole aggregation.
            logger.warning(
                "skipping assignment with non-numeric cm_id on expanded relation: "
                "assignment_id=%s person_cm_id=%r bunk_cm_id=%r",
                getattr(a, "id", "<unknown>"),
                person_cm_id_val,
                bunk_cm_id_val,
            )
            continue
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
        for chunk in batched(needed_cm_ids, chunk_size, strict=False):
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
        try:
            row = _coerce_row(r)
        except ValueError as exc:
            row_id = (r.get("id") if isinstance(r, dict) else getattr(r, "id", None)) or "<unknown>"
            logger.warning("skipping malformed bunk_request: %s (request_id=%s)", exc, row_id)
            continue
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
