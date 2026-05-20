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

__all__ = ["COUNTED_BUCKETS", "RequestBucket", "classify_request", "is_material_parent_request"]


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
    Used by the solver hard constraint and the post-solve diagnostic.
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
