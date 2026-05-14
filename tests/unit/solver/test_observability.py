"""Unit tests for the per-bucket Tier 1 stats helpers (issue #1388).

Implementation must conform to these tests, not the other way around.
"""

from __future__ import annotations

import logging
from unittest.mock import MagicMock

import pytest
from ortools.sat.python import cp_model

from bunking.models_v2 import DirectBunkRequest
from bunking.solver.observability import (
    _build_impossible_by_reason_by_bucket,
    _build_request_density_histogram_by_bucket,
    _count_presolve_compression,
    _derive_plateau_scalars,
    _lp_root_gap,
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
        # Emma: 1 MP + 1 IMMATERIAL + 2 STAFF requests. Liam: 1 MP request.
        requests_by_person = {
            1001: [
                _req("r1", 1001, "bunk_with"),
                _req("r2", 1001, "not_bunk_with"),
                _req("r3", 1001, "internal_notes"),
                _req("r5", 1001, "socialize_with"),
            ],
            1002: [_req("r4", 1002, "bunk_with")],
        }
        result = _build_request_density_histogram_by_bucket(requests_by_person)
        assert result == {
            "material_parent": {1: 2},  # Emma 1 MP, Liam 1 MP
            "immaterial_parent": {1: 1},  # Emma 1 IMMATERIAL
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
            (_req("r3", 1003, "socialize_with"), "age_pref_no_eligible_grade"),
        ]
        assert _build_impossible_by_reason_by_bucket(pairs) == {
            "material_parent": {"target_not_in_solver": 1},
            "immaterial_parent": {"age_pref_no_eligible_grade": 1},
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


class TestCountPresolveCompression:
    def test_counts_booleans_pre_and_ratio(self) -> None:
        model = cp_model.CpModel()
        model.NewBoolVar("a")
        model.NewBoolVar("b")
        model.NewBoolVar("c")
        model.NewIntVar(0, 10, "x")
        solver = MagicMock()
        solver.NumBooleans.return_value = 2
        result = _count_presolve_compression(model.Proto(), solver)
        assert result == {"presolve_compression_ratio": 2 / 3, "presolve_booleans_pre": 3}

    def test_zero_pre_booleans_yields_none_ratio(self) -> None:
        model = cp_model.CpModel()
        model.NewIntVar(0, 10, "x")
        solver = MagicMock()
        solver.NumBooleans.return_value = 0
        result = _count_presolve_compression(model.Proto(), solver)
        assert result == {"presolve_compression_ratio": None, "presolve_booleans_pre": 0}


class TestLpRootGap:
    def test_uses_first_bound_point_vs_objective(self) -> None:
        # _compute_optimality_gap(100, 120) = |100-120| / max(100,1) = 0.2
        assert _lp_root_gap([{"t": 0.1, "bound": 120.0}, {"t": 5.0, "bound": 105.0}], 100.0) == 0.2

    def test_empty_trajectory_returns_none(self) -> None:
        assert _lp_root_gap([], 100.0) is None

    def test_none_objective_returns_none(self) -> None:
        assert _lp_root_gap([{"t": 0.0, "bound": 50.0}], None) is None


class TestDerivePlateauScalars:
    def test_normal_trajectories(self) -> None:
        obj = [
            {"t": 1.0, "objective": 500.0, "bound": 900.0},
            {"t": 5.0, "objective": 600.0, "bound": 850.0},
        ]
        bnd = [{"t": 0.5, "bound": 1000.0}, {"t": 60.0, "bound": 700.0}]
        assert _derive_plateau_scalars(obj, bnd) == {
            "objective_plateau_time": 5.0,
            "bound_gain_after_plateau": 150.0,  # abs(700 - 850)
            "time_to_first_solution": 1.0,
        }

    def test_empty_objective_trajectory_all_none(self) -> None:
        assert _derive_plateau_scalars([], []) == {
            "objective_plateau_time": None,
            "bound_gain_after_plateau": None,
            "time_to_first_solution": None,
        }

    def test_single_solution_point(self) -> None:
        obj = [{"t": 3.0, "objective": 500.0, "bound": 900.0}]
        assert _derive_plateau_scalars(obj, []) == {
            "objective_plateau_time": 3.0,
            "bound_gain_after_plateau": 0.0,  # abs(900 - 900), bound_traj empty -> fallback
            "time_to_first_solution": 3.0,
        }

    def test_bound_trajectory_empty_falls_back_to_solution_bound(self) -> None:
        obj = [
            {"t": 1.0, "objective": 500.0, "bound": 900.0},
            {"t": 5.0, "objective": 600.0, "bound": 850.0},
        ]
        # final_bound falls back to last solution's bound (850) -> abs(850 - 850) = 0
        assert _derive_plateau_scalars(obj, [])["bound_gain_after_plateau"] == 0.0
