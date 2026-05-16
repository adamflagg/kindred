"""ImpossibilityReport.by_bucket_count — request-id-unique counts per bucket."""

from __future__ import annotations

from bunking.solver.impossibility import validate_impossibility

from .conftest import make_bunk, make_input, make_person, make_request


def test_by_bucket_count_dedupes_multi_reason_request(mock_config):
    """A request matching two predicates (multi-reason) counts as 1, not 2.

    Setup: cross-gender (M+F) + 3-grade gap with no mixed bunks →
    triggers BOTH pair_no_shared_bunk (no shared bunk) and grade_compatibility
    (span too wide). The same request_id lands in flat twice but in
    by_bucket_count once.
    """
    p1 = make_person(1, session=100, gender="M", grade=5)
    p2 = make_person(2, session=100, gender="F", grade=8)
    bunks = [
        make_bunk(10, session=100, gender="M", capacity=12),
        make_bunk(11, session=100, gender="F", capacity=12),
    ]
    req = make_request("r1", requester=1, requestee=2, source_field="bunk_with", session=100)
    inp = make_input([p1, p2], bunks, [req])

    report = validate_impossibility(inp, mock_config)
    # Confirm multi-reason structure produced two flat items for r1
    flat_for_r1 = [i for i in report.flat if i.request_id == "r1"]
    assert len(flat_for_r1) >= 2, "expected multi-reason rows for r1"
    # And by_bucket_count dedupes them
    assert report.by_bucket_count.get("material_parent") == 1


def test_by_bucket_count_excludes_bucket_none_items(mock_config):
    """Items with bucket=None (unknown source_field) are not counted."""
    p1 = make_person(1, session=1000001, gender="F", grade=5)
    p2 = make_person(2, session=1000002, gender="F", grade=5)
    bunks = [make_bunk(10, session=1000001, gender="F", capacity=12)]
    # Two requests: one valid bunk_with, one with bogus source_field
    req1 = make_request("r1", requester=1, requestee=2, source_field="bunk_with")
    req2 = make_request("r2", requester=2, requestee=1, source_field="bogus_field")
    # r1: cross-session bunk_with triggers cross_session impossibility → lands in flat
    # with bucket="material_parent". r2: same cross-session trigger but bogus_field
    # classifies as bucket=None and should be excluded from by_bucket_count.
    inp = make_input([p1, p2], bunks, [req1, req2])

    report = validate_impossibility(inp, mock_config)
    # r1 lands in material_parent count; r2's bucket=None and is excluded
    assert report.by_bucket_count.get("material_parent") == 1
    assert "bogus_field" not in report.by_bucket_count
    # Sanity: r2 is still in flat
    assert any(i.request_id == "r2" for i in report.flat)
