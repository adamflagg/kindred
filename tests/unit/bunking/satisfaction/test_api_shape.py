"""Tests for bunking.satisfaction.api_shape Pydantic models."""

import pytest
from pydantic import ValidationError

from bunking.satisfaction.api_shape import (
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

    def test_empty_request_id_rejected(self) -> None:
        """Scan-it round 3 #7: empty request_id would collide on the frontend's
        bucketByRequestId Map (multiple empty-id rows overwrite each other).
        Reject at the boundary so PB schema regressions surface as 422.
        """
        with pytest.raises(ValidationError, match="request_id"):
            PerRequestStatus(request_id="", bucket=RequestBucket.MATERIAL_PARENT, satisfied=True)


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

    def test_satisfied_exceeding_total_rejected(self) -> None:
        """Finding #11: satisfied must not exceed total. Defends against caller bugs
        producing nonsensical ratios that render as e.g. '5/2 met' in SliceLine.
        """
        with pytest.raises(ValidationError, match="satisfied"):
            BucketCount(satisfied=5, total=2)

    def test_satisfied_equal_to_total_allowed(self) -> None:
        c = BucketCount(satisfied=3, total=3)
        assert c.satisfied == c.total == 3


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


class TestCamperSatisfactionCountedBuckets:
    def test_camper_satisfaction_rejects_missing_counted_bucket(self) -> None:
        """counted_totals must contain every key in COUNTED_BUCKETS."""
        with pytest.raises(ValidationError, match="missing buckets"):
            CamperSatisfaction(
                person_cm_id=1,
                per_request=[],
                counted_totals={
                    RequestBucket.MATERIAL_PARENT: BucketCount(satisfied=0, total=0)
                    # STAFF missing
                },
                immaterial=BucketCount(satisfied=0, total=0),
                flags=SatisfactionFlags(
                    parent_min_one_violation=False,
                    staff_unsatisfied_alert=False,
                    has_any_counted_request=False,
                ),
            )

    def test_camper_satisfaction_rejects_extra_counted_bucket(self) -> None:
        """Scan-it round 3 #10: counted_totals must equal COUNTED_BUCKETS, not
        be a superset. An extra bucket like IMMATERIAL_PARENT in counted_totals
        would silently inflate sums (visible-uncounted requests get counted).
        """
        with pytest.raises(ValidationError, match="unexpected buckets"):
            CamperSatisfaction(
                person_cm_id=1,
                per_request=[],
                counted_totals={
                    RequestBucket.MATERIAL_PARENT: BucketCount(satisfied=0, total=0),
                    RequestBucket.STAFF: BucketCount(satisfied=0, total=0),
                    RequestBucket.IMMATERIAL_PARENT: BucketCount(satisfied=1, total=1),
                },
                immaterial=BucketCount(satisfied=0, total=0),
                flags=SatisfactionFlags(
                    parent_min_one_violation=False,
                    staff_unsatisfied_alert=False,
                    has_any_counted_request=False,
                ),
            )


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
