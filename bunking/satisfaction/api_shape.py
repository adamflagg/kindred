"""Pydantic schemas for the satisfaction endpoint.

Co-located with `bucket.py` and `aggregate.py` to avoid a circular import
that previously formed when `api/schemas/satisfaction.py` imported
`RequestBucket` from `bunking.satisfaction.bucket` while
`bunking.satisfaction.aggregate` imported the Pydantic types back.

Hand-mirrored TypeScript types live in frontend/src/types/satisfaction.ts
(Task 10 will hand-mirror these). A future codegen pass (#1155) will
replace the hand-mirroring with output from FastAPI's OpenAPI spec.
"""

from pydantic import BaseModel, Field, model_validator

from bunking.satisfaction.bucket import COUNTED_BUCKETS, RequestBucket


class PerRequestStatus(BaseModel):
    """Satisfaction status of a single bunk request."""

    # min_length=1 so PB-schema regressions producing empty ids surface as 422
    # instead of silent collisions on the frontend's bucketByRequestId Map.
    request_id: str = Field(..., min_length=1, description="PocketBase record id of the bunk_request row.")
    bucket: RequestBucket
    satisfied: bool
    detail: str | None = Field(
        default=None,
        description=(
            "Short human-readable explanation suitable for a UI tooltip "
            "(e.g. 'Same bunk', 'Different bunks', 'No grade on file'). "
            "Optional for forward-compat — older clients ignore."
        ),
    )


class BucketCount(BaseModel):
    """Satisfied / total request count for a bucket."""

    satisfied: int = Field(..., ge=0)
    total: int = Field(..., ge=0)

    @model_validator(mode="after")
    def _check_satisfied_le_total(self) -> BucketCount:
        if self.satisfied > self.total:
            raise ValueError(f"satisfied ({self.satisfied}) must not exceed total ({self.total})")
        return self


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

    @model_validator(mode="after")
    def _check_counted_keys(self) -> CamperSatisfaction:
        # Equality, not subset — extra buckets like IMMATERIAL_PARENT in
        # counted_totals would silently inflate sums (visible-uncounted requests
        # would be counted), violating the "covers material_parent + staff per
        # COUNTED_BUCKETS" contract.
        keys = set(self.counted_totals.keys())
        missing = COUNTED_BUCKETS - keys
        extra = keys - COUNTED_BUCKETS
        if missing:
            raise ValueError(f"counted_totals missing buckets: {sorted(missing)}")
        if extra:
            raise ValueError(f"counted_totals has unexpected buckets: {sorted(extra)}")
        return self


class SatisfactionResponse(BaseModel):
    """Top-level response from GET /api/satisfaction."""

    campers: dict[int, CamperSatisfaction]
    session_cm_id: int
    year: int
    scenario_id: str | None
