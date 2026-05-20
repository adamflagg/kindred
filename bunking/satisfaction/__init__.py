"""bunking.satisfaction — single source of truth for "is request X satisfied?".

Public API:
- RequestBucket, COUNTED_BUCKETS, classify_request — bucket policy
- SolverRule, rule_for, weight_key_for, weight_for, RequestClass — (source,type)
  solver-rule + objective-weight resolver (request_registry)
- is_request_satisfied — per-request predicate
- satisfied_request_ids_by_person — batch predicate over a finished assignment set
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
from bunking.satisfaction.batch import satisfied_request_ids_by_person
from bunking.satisfaction.bucket import (
    COUNTED_BUCKETS,
    RequestBucket,
    classify_request,
    is_material_parent_request,
)
from bunking.satisfaction.predicate import is_request_satisfied
from bunking.satisfaction.request_registry import (
    RequestClass,
    SolverRule,
    rule_for,
    weight_for,
    weight_key_for,
)

__all__ = [
    "COUNTED_BUCKETS",
    "PB_RECORD_ID_PATTERN",
    "BucketCount",
    "CamperSatisfaction",
    "PerRequestStatus",
    "RequestBucket",
    "RequestClass",
    "SatisfactionFlags",
    "SatisfactionResponse",
    "SolverRule",
    "bucket_status",
    "camper_satisfaction",
    "classify_request",
    "is_material_parent_request",
    "is_request_satisfied",
    "rule_for",
    "satisfied_request_ids_by_person",
    "session_satisfaction",
    "weight_for",
    "weight_key_for",
]
