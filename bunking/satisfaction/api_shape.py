"""Pydantic schemas for the satisfaction endpoint.

Co-located with `bucket.py` and `aggregate.py` to avoid a circular import
that previously formed when `api/schemas/satisfaction.py` imported
`RequestBucket` from `bunking.satisfaction.bucket` while
`bunking.satisfaction.aggregate` imported the Pydantic types back.

Hand-mirrored TypeScript types live in frontend/src/types/satisfaction.ts
(Task 10 will hand-mirror these). A future codegen pass (#1155) will
replace the hand-mirroring with output from FastAPI's OpenAPI spec.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from bunking.satisfaction.bucket import RequestBucket


class PerRequestStatus(BaseModel):
    """Satisfaction status of a single bunk request."""

    request_id: str = Field(..., description="PocketBase record id of the bunk_request row.")
    bucket: RequestBucket
    satisfied: bool


class BucketCount(BaseModel):
    """Satisfied / total request count for a bucket."""

    satisfied: int = Field(..., ge=0)
    total: int = Field(..., ge=0)


class SatisfactionFlags(BaseModel):
    """Derived boolean flags driving frontend alerts and graph node colors."""

    parent_min_one_violation: bool = Field(..., description="Camper has ≥1 material_parent request and none satisfied.")
    staff_unsatisfied_alert: bool = Field(..., description="Camper has any staff request unsatisfied.")
    has_any_counted_request: bool = Field(
        ...,
        description=(
            "Camper has at least one request in a counted bucket "
            "(material_parent or staff). False ⇒ graph 'no_requests' gray state."
        ),
    )


class CamperSatisfaction(BaseModel):
    """Per-camper satisfaction aggregate.

    `counted_totals` covers material_parent + staff per COUNTED_BUCKETS.
    `immaterial` is visible to UI but excluded from totals/coverage metrics.
    """

    person_cm_id: int
    per_request: list[PerRequestStatus]
    counted_totals: dict[RequestBucket, BucketCount]
    immaterial: BucketCount
    flags: SatisfactionFlags


class SatisfactionResponse(BaseModel):
    """Top-level response from GET /api/satisfaction."""

    campers: dict[int, CamperSatisfaction]
    session_cm_id: int
    year: int
    scenario_id: str | None
