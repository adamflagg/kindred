"""bunking.satisfaction — single source of truth for "is request X satisfied?".

Public API:
- RequestBucket, COUNTED_BUCKETS, classify_request — bucket policy
- is_request_satisfied — per-request predicate
- camper_satisfaction — per-camper aggregator (pure)
- session_satisfaction — top-level entry (fetches PB data)
- bucket_status — single-bucket 3-state classification helper
- BucketCount, CamperSatisfaction, PerRequestStatus, SatisfactionFlags,
  SatisfactionResponse — Pydantic API shapes
- PB_RECORD_ID_PATTERN — shared regex pattern for PocketBase record ID validation

Consumers: bunking.solver, bunking.graph, api.routers.satisfaction.
"""

from bunking.satisfaction.aggregate import _PB_RECORD_ID_PATTERN as PB_RECORD_ID_PATTERN
from bunking.satisfaction.aggregate import bucket_status, camper_satisfaction, session_satisfaction
from bunking.satisfaction.api_shape import (
    BucketCount,
    CamperSatisfaction,
    PerRequestStatus,
    SatisfactionFlags,
    SatisfactionResponse,
)
from bunking.satisfaction.bucket import (
    COUNTED_BUCKETS,
    RequestBucket,
    classify_request,
    is_material_parent_request,
)
from bunking.satisfaction.predicate import is_request_satisfied

__all__ = [
    "COUNTED_BUCKETS",
    "PB_RECORD_ID_PATTERN",
    "BucketCount",
    "CamperSatisfaction",
    "PerRequestStatus",
    "RequestBucket",
    "SatisfactionFlags",
    "SatisfactionResponse",
    "bucket_status",
    "camper_satisfaction",
    "classify_request",
    "is_material_parent_request",
    "is_request_satisfied",
    "session_satisfaction",
]
