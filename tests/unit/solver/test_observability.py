"""Unit tests for the per-bucket Tier 1 stats helpers (issue #1388).

Implementation must conform to these tests, not the other way around.
"""

from __future__ import annotations

import logging

import pytest

from bunking.models_v2 import DirectBunkRequest
from bunking.solver.observability import (
    _build_impossible_by_reason_by_bucket,
    _build_request_density_histogram_by_bucket,
)


def _req(req_id: str, requester: int, source_field: str | None) -> DirectBunkRequest:
    return DirectBunkRequest(
        id=req_id,
        requester_person_cm_id=requester,
        request_type="bunk_with",
        session_cm_id=1000001,
        year=2026,
        source_field=source_field,
    )


class TestRequestDensityHistogramByBucket:
    def test_empty_input_returns_three_empty_buckets(self) -> None:
        assert _build_request_density_histogram_by_bucket({}) == {
            "material_parent": {},
            "immaterial_parent": {},
            "staff": {},
        }

    def test_buckets_per_camper_per_bucket(self) -> None:
        # Emma: 1 MP + 2 STAFF requests. Liam: 1 MP request.
        requests_by_person = {
            1001: [
                _req("r1", 1001, "bunk_with"),
                _req("r2", 1001, "not_bunk_with"),
                _req("r3", 1001, "internal_notes"),
            ],
            1002: [_req("r4", 1002, "bunk_with")],
        }
        result = _build_request_density_histogram_by_bucket(requests_by_person)
        assert result == {
            "material_parent": {1: 2},  # Emma 1 MP, Liam 1 MP
            "immaterial_parent": {},
            "staff": {2: 1},  # Emma 2 STAFF
        }

    def test_skips_campers_with_zero_requests(self) -> None:
        result = _build_request_density_histogram_by_bucket({1001: [_req("r1", 1001, "bunk_with")], 1002: []})
        assert result == {"material_parent": {1: 1}, "immaterial_parent": {}, "staff": {}}

    def test_unknown_source_field_is_dropped_and_logged(self, caplog: pytest.LogCaptureFixture) -> None:
        with caplog.at_level(logging.DEBUG):
            result = _build_request_density_histogram_by_bucket({1001: [_req("r1", 1001, "garbage_field")]})
        assert result == {"material_parent": {}, "immaterial_parent": {}, "staff": {}}
        assert any("garbage_field" in r.message for r in caplog.records)

    def test_missing_source_field_is_dropped(self, caplog: pytest.LogCaptureFixture) -> None:
        with caplog.at_level(logging.DEBUG):
            result = _build_request_density_histogram_by_bucket({1001: [_req("r1", 1001, None)]})
        assert result == {"material_parent": {}, "immaterial_parent": {}, "staff": {}}
        assert any("source_field" in r.message for r in caplog.records)


class TestImpossibleByReasonByBucket:
    def test_empty_input_returns_three_empty_buckets(self) -> None:
        assert _build_impossible_by_reason_by_bucket([]) == {
            "material_parent": {},
            "immaterial_parent": {},
            "staff": {},
        }

    def test_each_reason_lands_in_its_bucket(self) -> None:
        pairs = [
            (_req("r1", 1001, "bunk_with"), "target_not_in_solver"),
            (_req("r2", 1002, "not_bunk_with"), "malformed"),
        ]
        assert _build_impossible_by_reason_by_bucket(pairs) == {
            "material_parent": {"target_not_in_solver": 1},
            "immaterial_parent": {},
            "staff": {"malformed": 1},
        }

    def test_multi_reason_same_request_counts_each(self) -> None:
        # Layer 2 records one request under multiple reason codes — non-deduped.
        req = _req("r1", 1001, "bunk_with")
        pairs = [(req, "cross_session"), (req, "pair_no_shared_bunk")]
        assert _build_impossible_by_reason_by_bucket(pairs) == {
            "material_parent": {"cross_session": 1, "pair_no_shared_bunk": 1},
            "immaterial_parent": {},
            "staff": {},
        }

    def test_two_requests_same_bucket_same_reason_accumulates(self) -> None:
        pairs = [
            (_req("r1", 1001, "bunk_with"), "cross_session"),
            (_req("r2", 1002, "bunk_with"), "cross_session"),
        ]
        assert _build_impossible_by_reason_by_bucket(pairs) == {
            "material_parent": {"cross_session": 2},
            "immaterial_parent": {},
            "staff": {},
        }

    def test_unknown_source_field_is_dropped_and_logged(self, caplog: pytest.LogCaptureFixture) -> None:
        with caplog.at_level(logging.DEBUG):
            result = _build_impossible_by_reason_by_bucket([(_req("r1", 1001, "garbage_field"), "malformed")])
        assert result == {"material_parent": {}, "immaterial_parent": {}, "staff": {}}
        assert any("garbage_field" in r.message for r in caplog.records)
