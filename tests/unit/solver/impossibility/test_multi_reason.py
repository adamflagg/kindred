"""Multi-reason recording: a single impossible request must show up in every
applicable by_reason bucket, but totals dedupe at the request and camper level.

This lets staff see ALL of why a request is impossible (e.g. cross-gender
AND grade-distant) rather than triaging into whichever bucket Python's
import order happened to register first.
"""

import pytest

from bunking.solver.impossibility import _build_context, validate_impossibility

from .conftest import make_bunk, make_input, make_person, make_request


@pytest.fixture
def cross_gender_and_grade_distant_input(mock_config):
    # Samuel (M, grade 5) ↔ Emma (F, grade 8): cross-gender AND 3 grades apart.
    # In session 100 there are no Mixed/AG bunks, so cross-gender fails.
    # max_grade_range default is 2 (max_gap=1), so a 3-grade gap also fails.
    p1 = make_person(1, session=100, gender="M", grade=5)
    p2 = make_person(2, session=100, gender="F", grade=8)
    req = make_request(
        "r_multi",
        requester=1,
        requestee=2,
        request_type="bunk_with",
        session=100,
    )
    input_data = make_input(
        [p1, p2],
        [make_bunk(10, session=100, gender="M"), make_bunk(11, session=100, gender="F")],
        [req],
    )
    return input_data


def test_cross_gender_and_grade_distant_request_appears_in_both_buckets(
    cross_gender_and_grade_distant_input, mock_config
):
    report = validate_impossibility(cross_gender_and_grade_distant_input, mock_config)

    bucket_codes = {code for code, items in report.by_reason.items() if items}
    assert "grade_compatibility" in bucket_codes, f"Expected grade_compatibility bucket. Got: {bucket_codes}"
    assert "pair_no_shared_bunk" in bucket_codes, f"Expected pair_no_shared_bunk bucket. Got: {bucket_codes}"

    # Per-bucket counts: each bucket counts THIS request once.
    assert len(report.by_reason["grade_compatibility"]) == 1
    assert len(report.by_reason["pair_no_shared_bunk"]) == 1


def test_total_impossible_dedupes_requests_across_reasons(cross_gender_and_grade_distant_input, mock_config):
    report = validate_impossibility(cross_gender_and_grade_distant_input, mock_config)

    # ONE request is impossible, even though it shows in TWO buckets.
    assert report.total_impossible == 1


def test_affected_campers_dedupes_across_reasons(cross_gender_and_grade_distant_input, mock_config):
    report = validate_impossibility(cross_gender_and_grade_distant_input, mock_config)

    # The single request has ONE requester — affected_campers must be 1, not 2.
    assert report.affected_campers == 1


def test_single_reason_request_still_appears_in_one_bucket(mock_config):
    """Multi-reason support must not double-record a request that only matches
    ONE predicate."""
    # Same-gender, grade-distant pair → grade_compatibility only.
    p1 = make_person(1, session=100, gender="F", grade=5)
    p2 = make_person(2, session=100, gender="F", grade=8)
    req = make_request("r1", requester=1, requestee=2, request_type="bunk_with", session=100)
    input_data = make_input([p1, p2], [make_bunk(10, session=100, gender="F")], [req])

    report = validate_impossibility(input_data, mock_config)

    assert "grade_compatibility" in report.by_reason
    assert len(report.by_reason["grade_compatibility"]) == 1
    assert "pair_no_shared_bunk" not in report.by_reason or not report.by_reason["pair_no_shared_bunk"]
    assert report.total_impossible == 1
    assert report.affected_campers == 1


# Build context import wiring sanity-check — guard against an accidental
# regression where _build_context falls out of the public module surface.
def test_build_context_is_importable():
    assert _build_context is not None
