"""Tests for api.schemas.satisfaction Pydantic models."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from api.schemas.satisfaction import (
    BucketCount,
    CamperSatisfaction,
    PerRequestStatus,
    SatisfactionFlags,
    SatisfactionResponse,
)
from bunking.satisfaction.bucket import RequestBucket


class TestPerRequestStatus:
    def test_valid_construction(self) -> None:
        s = PerRequestStatus(request_id="abc123", bucket=RequestBucket.MATERIAL_PARENT, satisfied=True)
        assert s.satisfied
        assert s.bucket is RequestBucket.MATERIAL_PARENT


class TestBucketCount:
    def test_valid(self) -> None:
        c = BucketCount(satisfied=2, total=3)
        assert c.satisfied == 2
        assert c.total == 3

    def test_negative_satisfied_rejected(self) -> None:
        with pytest.raises(ValidationError):
            BucketCount(satisfied=-1, total=3)

    def test_negative_total_rejected(self) -> None:
        with pytest.raises(ValidationError):
            BucketCount(satisfied=0, total=-1)


class TestCamperSatisfaction:
    def test_minimal_construction(self) -> None:
        c = CamperSatisfaction(
            person_cm_id=12345,
            per_request=[],
            counted_totals={
                RequestBucket.MATERIAL_PARENT: BucketCount(satisfied=0, total=0),
                RequestBucket.STAFF: BucketCount(satisfied=0, total=0),
            },
            immaterial=BucketCount(satisfied=0, total=0),
            flags=SatisfactionFlags(
                parent_min_one_violation=False,
                staff_unsatisfied_alert=False,
                has_any_counted_request=False,
            ),
        )
        assert c.person_cm_id == 12345


class TestSatisfactionResponse:
    def test_round_trip(self) -> None:
        flags = SatisfactionFlags(
            parent_min_one_violation=False,
            staff_unsatisfied_alert=False,
            has_any_counted_request=True,
        )
        camper = CamperSatisfaction(
            person_cm_id=12345,
            per_request=[PerRequestStatus(request_id="r1", bucket=RequestBucket.MATERIAL_PARENT, satisfied=True)],
            counted_totals={
                RequestBucket.MATERIAL_PARENT: BucketCount(satisfied=1, total=1),
                RequestBucket.STAFF: BucketCount(satisfied=0, total=0),
            },
            immaterial=BucketCount(satisfied=0, total=0),
            flags=flags,
        )
        resp = SatisfactionResponse(campers={12345: camper}, session_cm_id=999, year=2026, scenario_id=None)
        # Serialise & re-parse — guards against forgotten field validators.
        clone = SatisfactionResponse.model_validate(resp.model_dump())
        assert clone == resp
