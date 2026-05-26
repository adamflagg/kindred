"""Request-source bucket classification (compatibility shim).

The canonical table lives in `bunking.satisfaction.request_registry`. This
module preserves the historical public surface (`RequestBucket`,
`COUNTED_BUCKETS`, `classify_request`, `is_material_parent_request`) so existing
imports keep working, delegating all classification to the registry.

`classify_request` takes source_field only — `report_group` is source-determined
(enforced by `request_registry._build_source_to_group`). Callers that also have
`request_type` and need the solver rule or weight should use
`request_registry.rule_for` / `weight_key_for` directly.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from bunking.logging_config import get_logger
from bunking.satisfaction.request_registry import (
    COUNTED_BUCKETS,
    RequestBucket,
    report_group_for,
)

if TYPE_CHECKING:
    from bunking.models_v2 import DirectBunkRequest

logger = get_logger(__name__)

__all__ = [
    "COUNTED_BUCKETS",
    "RequestBucket",
    "classify_request",
    "compute_material_request_ids",
    "is_material_parent_request",
]


def classify_request(source_field: str) -> RequestBucket:
    """Map source_field → reporting bucket. Raises on unknown — no valid fallback.

    source_field is required at the PB schema level; an unknown value indicates a
    data-hygiene regression or a new source_field the registry doesn't cover, and
    must surface loudly rather than be silently misbucketed.
    """
    return report_group_for(source_field)


def is_material_parent_request(request: DirectBunkRequest) -> bool:
    """True iff the request's source_field classifies as MATERIAL_PARENT.

    Defensive: missing or unknown source_field returns False with a debug log.
    Called by ``compute_material_request_ids``; solver constraints and the
    post-solve diagnostic read the resulting ``material_request_ids`` set rather
    than calling this directly, so the #1664 age-preference suppression applies.
    """
    sf = request.source_field
    if not sf:
        return False
    try:
        return classify_request(sf) == RequestBucket.MATERIAL_PARENT
    except ValueError:
        logger.debug(
            "is_material_parent_request: unknown source_field %r on request %s — treating as non-material",
            sf,
            getattr(request, "id", "<unknown>"),
        )
        return False


def compute_material_request_ids(
    requests_by_person: dict[int, list[DirectBunkRequest]],
    impossible_request_ids: set[str],
) -> set[str]:
    """Material-parent request IDs, with the #1664 age-preference suppression.

    A request is material when ``is_material_parent_request`` is True (source →
    MATERIAL_PARENT bucket; only ``bunk_request_form`` qualifies — ``manual`` and
    the note sources are STAFF, ``socialize_with`` is IMMATERIAL_PARENT). The ONE
    exception (#1664): a ``bunk_request_form`` AGE_PREFERENCE is dropped when its
    requester also has a resolved-and-possible ``bunk_request_form``
    BUNK_WITH/NOT_BUNK_WITH. When the only real form request(s) are impossible or
    unresolved, the age-preference reverts to material (the child's sole viable
    parent ask).

    The output is NOT filtered by status/possibility: ``r.id in result`` is
    equivalent to ``is_material_parent_request(r)`` for every non-suppressed
    request, so consumers (including the entirely-impossible-MP rollup, which
    must see impossible material requests) behave identically. The
    resolved-and-possible test is applied ONLY when deciding suppression.

    ``impossible_request_ids`` is the request-id set from the shared
    ImpossibilityReport — the same "possible" determination used everywhere.
    """
    from bunking.sync.bunk_request_processor.core.models import RequestType  # noqa: PLC0415
    from bunking.sync.bunk_request_processor.shared.constants import SourceField  # noqa: PLC0415

    real_types = (RequestType.BUNK_WITH.value, RequestType.NOT_BUNK_WITH.value)
    material: set[str] = set()
    for reqs in requests_by_person.values():
        has_possible_real_form_request = any(
            r.source_field == SourceField.BUNK_REQUEST_FORM
            and r.request_type in real_types
            and r.status == "resolved"
            and r.id not in impossible_request_ids
            for r in reqs
        )
        for r in reqs:
            if not is_material_parent_request(r):
                continue
            if (
                r.request_type == RequestType.AGE_PREFERENCE.value
                and r.source_field == SourceField.BUNK_REQUEST_FORM
                and has_possible_real_form_request
            ):
                continue  # #1664: immaterial when a real form request is satisfiable
            material.add(r.id)
    return material


def is_counted_request(request: DirectBunkRequest) -> bool:
    """True iff the request's source_field classifies into a COUNTED bucket.

    COUNTED = MATERIAL_PARENT ∪ STAFF — the buckets that contribute to user-facing
    totals and action lists. IMMATERIAL_PARENT (socialize_with) is excluded
    because parent age-pref dropdowns are not actionable signals for staff.

    Defensive: missing or unknown source_field returns False with a debug log.
    Used by pre-check / post-check / solver-finish counts that surface
    actionable issues to staff.
    """
    sf = request.source_field
    if not sf:
        return False
    try:
        return classify_request(sf) in COUNTED_BUCKETS
    except ValueError:
        logger.debug(
            "is_counted_request: unknown source_field %r on request %s — treating as not-counted",
            sf,
            getattr(request, "id", "<unknown>"),
        )
        return False
