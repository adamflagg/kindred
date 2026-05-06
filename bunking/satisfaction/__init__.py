"""bunking.satisfaction — single source of truth for "is request X satisfied?".

Public API:
- RequestBucket, COUNTED_BUCKETS, classify_request — bucket policy
- is_request_satisfied — per-request predicate
- camper_satisfaction — per-camper aggregator (pure)
- session_satisfaction — top-level entry (fetches PB data)
- bucket_status — single-bucket 3-state classification helper
- BucketCount, CamperSatisfaction, PerRequestStatus, SatisfactionFlags,
  SatisfactionResponse — Pydantic API shapes

Consumers: bunking.solver, bunking.graph, api.routers.satisfaction.
"""

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
)
from bunking.satisfaction.predicate import is_request_satisfied

__all__ = [
    "COUNTED_BUCKETS",
    "BucketCount",
    "CamperSatisfaction",
    "PerRequestStatus",
    "RequestBucket",
    "SatisfactionFlags",
    "SatisfactionResponse",
    "bucket_status",
    "camper_satisfaction",
    "classify_request",
    "is_request_satisfied",
    "session_satisfaction",
]
