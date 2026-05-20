"""TDD tests for ``filter_immaterial_requests``.

Group 65 #1537 moved the IMMATERIAL_PARENT (socialize_with) filtering out of the
FastAPI router and into ``bunking.solver.impossibility`` so business logic lives
under ``bunking/`` (api/CLAUDE.md: routers stay thin).

#1549 dedup fix: a request impossible for >1 reason appears once per reason in
``report.flat`` (Layer 2 records every overlapping blocker). The re-derived
``total_impossible`` MUST dedup by ``request_id`` — counting flat rows directly
double-counts multi-reason requests, mirroring the bug that ``validate_impossibility``
already guards against.
"""

from __future__ import annotations

from bunking.solver.impossibility import (
    ImpossibilityReport,
    ImpossibleItem,
    filter_immaterial_requests,
)


def _item(request_id: str, reason_code: str, bucket: str, cm_id: int = 10) -> ImpossibleItem:
    return ImpossibleItem(
        request_id=request_id,
        reason_code=reason_code,
        reason_message="…",
        request_type="bunk_with",
        requester={"cm_id": cm_id, "name": "Emma Johnson", "grade": 6, "gender": "F"},
        requestee={"cm_id": 20, "name": "Liam Garcia", "grade": 6, "gender": "M"},
        detail={},
        bucket=bucket,
    )


def test_strips_immaterial_items_and_buckets() -> None:
    mat = _item("r_bw", "cross_gender", "material_parent")
    imm = _item("r_sw", "cross_session", "immaterial_parent", cm_id=30)
    report = ImpossibilityReport(
        total_impossible=2,
        affected_campers=2,
        by_reason={"cross_gender": [mat], "cross_session": [imm]},
        flat=[mat, imm],
        by_bucket_count={"material_parent": 1, "immaterial_parent": 1},
    )

    out = filter_immaterial_requests(report)

    assert all(i.bucket != "immaterial_parent" for i in out.flat)
    assert out.total_impossible == 1
    assert out.affected_campers == 1
    assert "immaterial_parent" not in out.by_bucket_count
    for items in out.by_reason.values():
        assert all(i.bucket != "immaterial_parent" for i in items)


def test_multi_reason_material_request_counted_once() -> None:
    """A single material request impossible for two reasons → two flat rows, but
    one impossible request. ``total_impossible`` must dedup by request_id."""
    a = _item("r1", "cross_gender", "material_parent")
    b = _item("r1", "grade_distant", "material_parent")
    report = ImpossibilityReport(
        total_impossible=1,  # validate_impossibility already dedups by request_id
        affected_campers=1,
        by_reason={"cross_gender": [a], "grade_distant": [b]},
        flat=[a, b],
        by_bucket_count={"material_parent": 1},
    )

    out = filter_immaterial_requests(report)

    assert out.total_impossible == 1, f"multi-reason request double-counted: {out.total_impossible}"
    assert out.affected_campers == 1


def test_returns_copy_without_mutating_input() -> None:
    mat = _item("r_bw", "cross_gender", "material_parent")
    report = ImpossibilityReport(
        total_impossible=1,
        affected_campers=1,
        by_reason={"cross_gender": [mat]},
        flat=[mat],
        by_bucket_count={"material_parent": 1},
    )

    out = filter_immaterial_requests(report)

    assert out is not report
    assert report.flat == [mat]
    assert report.total_impossible == 1
