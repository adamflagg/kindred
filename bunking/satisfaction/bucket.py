"""Request-source bucket classification.

source_field values originate from a custom CampMinder report:
- bunk_request_form:    parent bunk request form
- socialize_with:       parent "socialize with / age preference" dropdown
- staff_not_bunk_with:  hidden CampMinder staff "do not bunk with" field
- bunking_notes:        most recent staff bunk note pulled by the report
- internal_notes:       staff internal notes pulled by the report

This is the canonical helper #1142 will eventually flip every read site to
use, replacing the redundant `source` column on bunk_requests.
"""

from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING

from bunking.logging_config import get_logger
from bunking.sync.bunk_request_processor.shared.constants import SourceField

if TYPE_CHECKING:
    from bunking.models_v2 import DirectBunkRequest

logger = get_logger(__name__)


class RequestBucket(StrEnum):
    """Classification of a bunk request by origin and staff/parent intent."""

    MATERIAL_PARENT = "material_parent"
    IMMATERIAL_PARENT = "immaterial_parent"
    STAFF = "staff"


_BUCKET_MAP: dict[str, RequestBucket] = {
    SourceField.BUNK_REQUEST_FORM: RequestBucket.MATERIAL_PARENT,
    SourceField.SOCIALIZE_WITH: RequestBucket.IMMATERIAL_PARENT,
    SourceField.STAFF_NOT_BUNK_WITH: RequestBucket.STAFF,
    SourceField.BUNKING_NOTES: RequestBucket.STAFF,
    SourceField.INTERNAL_NOTES: RequestBucket.STAFF,
}


# Buckets that contribute to "totals" / coverage metrics.
# Immaterial parent requests are visible per-request but excluded from sums.
COUNTED_BUCKETS: frozenset[RequestBucket] = frozenset({RequestBucket.MATERIAL_PARENT, RequestBucket.STAFF})


def classify_request(source_field: str) -> RequestBucket:
    """Map source_field → bucket. Raises on unknown — there is no valid fallback.

    source_field is required at the PB schema level
    (pb_migrations/1500000018_bunk_requests.js:246), and the legacy null
    fallback was removed in PR #1086 after Stage 3a's audit confirmed zero
    affected rows in production. Any unknown value indicates a data-hygiene
    regression or a new source_field the map doesn't cover, and must surface
    loudly rather than be silently misbucketed.
    """
    bucket = _BUCKET_MAP.get(source_field)
    if bucket is None:
        raise ValueError(f"unknown source_field {source_field!r}; expected one of {sorted(_BUCKET_MAP)}")
    return bucket


def is_material_parent_request(request: DirectBunkRequest) -> bool:
    """True iff the request's source_field classifies as MATERIAL_PARENT.

    Defensive: missing or unknown source_field returns False with a debug
    log. Used by the solver hard constraint and the post-solve diagnostic.
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
