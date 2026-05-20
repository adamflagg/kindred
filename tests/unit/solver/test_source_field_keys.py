"""Tests for source field key alignment in solver components.

Verifies that solver files correctly use canonical SourceField values
(e.g., "Share Bunk With") rather than snake_case keys (e.g., "share_bunk_with").

Issue: #546 — solver stat/multiplier lookups use snake_case keys against
canonical source_field values, causing all lookups to silently fail.
"""

from __future__ import annotations

from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest

from bunking.config import ConfigLoader
from bunking.sync.bunk_request_processor.shared.constants import SourceField


class _CanonicalKeyConfig:
    """Stub loader for the centralized penalty keys (B1/B2/B4 fix; B5 PR #1331
    collapsed ``constraint.cabin_minimum_occupancy.min`` into a constant)."""

    _values: ClassVar[dict[str, int]] = {
        "constraint.grade_spread.penalty": 100,
        "constraint.cabin_capacity.penalty": 500,
        "constraint.cabin_minimum_occupancy.penalty": 50,
    }

    def get_int(self, key: str, default: int | None = None) -> int:
        v = self._values.get(key)
        return int(v) if v is not None else (default if default is not None else 0)

    def get_float(self, key: str, default: float | None = None) -> float:
        v = self._values.get(key)
        return float(v) if v is not None else (default if default is not None else 0.0)


class TestScoreEvaluatorCanonicalKeys:
    """score_evaluator.py must use canonical SourceField values."""

    @pytest.fixture(autouse=True)
    def _install_canonical_loader(self):
        """Install the canonical-keys stub for the centralized accessors."""
        with ConfigLoader.use(_CanonicalKeyConfig()):  # type: ignore[arg-type]
            yield

    @pytest.fixture
    def mock_config(self):
        config = MagicMock()
        config.get_int.side_effect = lambda key, default=0: {
            "objective.enable_diminishing_returns": 1,
            "objective.first_request_multiplier": 10,
            "objective.second_request_multiplier": 5,
            "objective.third_plus_request_multiplier": 1,
            # Legacy keys
            "penalty.grade_spread": 100,
            "penalty.over_capacity": 500,
            "constraint.cabin_occupancy.minimum": 8,
            "penalty.under_occupancy": 50,
            # Canonical keys (matched values)
            "constraint.grade_spread.penalty": 100,
            "constraint.cabin_capacity.penalty": 500,
            "constraint.cabin_minimum_occupancy.penalty": 50,
            "constraint.grade_spread.max_spread": 2,
            "constraint.cabin_capacity.standard": 12,
        }.get(key, default)
        config.get_float.side_effect = lambda key, default=1.0: {
            "objective.source_multipliers.share_bunk_with": 1.75,
            "objective.source_multipliers.do_not_share_with": 1.5,
            "objective.source_multipliers.bunking_notes": 1.0,
            "objective.source_multipliers.internal_notes": 1.0,
            "objective.source_multipliers.socialize_preference": 0.6,
        }.get(key, default)
        return config

    def test_source_multiplier_applied_with_canonical_source_field(self, mock_config):
        """A request with canonical source_field="Share Bunk With" must get the 1.75x multiplier."""
        from bunking.solver.score_evaluator import evaluate_scenario_score

        share_result = evaluate_scenario_score(
            requests=[
                {
                    "requester_id": 100,
                    "requestee_id": 200,
                    "request_type": "bunk_with",
                    "source_field": SourceField.BUNK_REQUEST_FORM,
                }
            ],
            assignments=[
                {"person_cm_id": 100, "bunk_cm_id": 1},
                {"person_cm_id": 200, "bunk_cm_id": 1},
            ],
            persons=[
                {"cm_id": 100, "grade": 5, "gender": "M"},
                {"cm_id": 200, "grade": 5, "gender": "M"},
            ],
            bunks=[{"cm_id": 1, "name": "B-1", "gender": "M", "max_size": 12}],
            config=mock_config,
        )

        # base_weight(40) * source_multiplier(1.75) = 70 (weighted_score)
        # slot-0 → FIRST_REQUEST_MULTIPLIER(10): 70 * 10 = 700
        # Priority was deleted — base_weight replaces priority * 10.
        assert share_result.request_satisfaction_score == 700

    def test_field_scores_keyed_by_canonical_values(self, mock_config):
        """field_scores breakdown must use canonical SourceField values as keys."""
        from bunking.solver.score_evaluator import evaluate_scenario_score

        result = evaluate_scenario_score(
            requests=[
                {
                    "requester_id": 100,
                    "requestee_id": 200,
                    "request_type": "bunk_with",
                    "priority": 5,
                    "source_field": SourceField.BUNK_REQUEST_FORM,
                },
                {
                    "requester_id": 300,
                    "requestee_id": 400,
                    "request_type": "bunk_with",
                    "priority": 5,
                    "source_field": SourceField.BUNKING_NOTES,
                },
            ],
            assignments=[
                {"person_cm_id": 100, "bunk_cm_id": 1},
                {"person_cm_id": 200, "bunk_cm_id": 1},
                {"person_cm_id": 300, "bunk_cm_id": 2},
                {"person_cm_id": 400, "bunk_cm_id": 3},
            ],
            persons=[
                {"cm_id": 100, "grade": 5, "gender": "M"},
                {"cm_id": 200, "grade": 5, "gender": "M"},
                {"cm_id": 300, "grade": 5, "gender": "M"},
                {"cm_id": 400, "grade": 5, "gender": "M"},
            ],
            bunks=[
                {"cm_id": 1, "name": "B-1", "gender": "M", "max_size": 12},
                {"cm_id": 2, "name": "B-2", "gender": "M", "max_size": 12},
                {"cm_id": 3, "name": "B-3", "gender": "M", "max_size": 12},
            ],
            config=mock_config,
        )

        assert SourceField.BUNK_REQUEST_FORM in result.field_scores
        assert result.field_scores[SourceField.BUNK_REQUEST_FORM]["satisfied"] == 1
        assert SourceField.BUNKING_NOTES in result.field_scores
        assert result.field_scores[SourceField.BUNKING_NOTES]["satisfied"] == 0

    def test_get_source_fields_returns_canonical_from_source_field(self):
        """_get_source_fields should return canonical value from source_field."""
        from bunking.solver.score_evaluator import _get_source_fields

        request = {"source_field": SourceField.BUNK_REQUEST_FORM}
        assert _get_source_fields(request) == [SourceField.BUNK_REQUEST_FORM]

    def test_get_source_fields_age_preference_returns_canonical(self):
        """age_preference requests should return SourceField.SOCIALIZE_WITH."""
        from bunking.solver.score_evaluator import _get_source_fields

        request: dict[str, Any] = {"request_type": "age_preference"}
        assert _get_source_fields(request) == [SourceField.SOCIALIZE_WITH]


class TestDirectSolverCanonicalKeys:
    """direct_solver.py must map canonical source_field to config keys."""

    def test_multiplier_uses_config_key_not_canonical_value(self):
        """_get_csv_field_multiplier must look up the config key, not the canonical value."""
        from bunking.models_v2 import DirectBunkRequest
        from bunking.solver.direct_solver import DirectBunkingSolver

        config = MagicMock()
        config.get_float.side_effect = lambda key, default=1.0: {
            "objective.source_multipliers.share_bunk_with": 1.75,
        }.get(key, default)
        config.get_int.return_value = 0

        solver = DirectBunkingSolver.__new__(DirectBunkingSolver)
        solver.config = config

        request = DirectBunkRequest(
            id="req1",
            requester_person_cm_id=100,
            requested_person_cm_id=200,
            request_type="bunk_with",
            session_cm_id=1000,
            year=2025,
            source_field=SourceField.BUNK_REQUEST_FORM,
        )

        multiplier = solver._get_csv_field_multiplier(request)
        assert multiplier == 1.75

    def test_multiplier_uses_registry_default_when_config_missing_key(self):
        """#1530: when the config has no row for the key, fall back to the
        canonical per-key default in `_WEIGHT_DEFAULTS` — same as the
        evaluators via `weight_for` (PR #1552). The pre-fix generic
        `default=1.0` diverged from the evaluators for socialize_preference
        (registry default 0.6) and `do_not_share_with` (1.5)."""
        from bunking.models_v2 import DirectBunkRequest
        from bunking.solver.direct_solver import DirectBunkingSolver

        # Config has NO entry for the multiplier — any get_float call returns the default.
        config = MagicMock()
        config.get_float.side_effect = lambda key, default=None: default if default is not None else 1.0
        config.get_int.return_value = 0

        solver = DirectBunkingSolver.__new__(DirectBunkingSolver)
        solver.config = config

        # socialize_preference source paired with age_preference type → registry
        # row exists with weight_key=objective.source_multipliers.socialize_preference,
        # which has _WEIGHT_DEFAULTS = 0.6.
        request = DirectBunkRequest(
            id="req-soc",
            requester_person_cm_id=1000001,
            requested_person_cm_id=None,
            request_type="age_preference",
            session_cm_id=1000001,
            year=2025,
            source_field=SourceField.SOCIALIZE_WITH,
            age_preference_target="younger",
        )

        multiplier = solver._get_csv_field_multiplier(request)
        # Pre-fix: 1.0 (generic default). Post-fix: 0.6 (registry-aware default).
        assert multiplier == 0.6

    def test_multiplier_off_axis_combo_falls_back_to_neutral(self, caplog):
        """An off-axis (source, type) combo not in the 14-row registry falls back
        to a neutral 1.0 with a warning — matches the evaluators' handling
        (`objective_evaluator.py` / `score_evaluator.py` wrap `weight_for` in a
        try/except ValueError)."""
        import logging

        from bunking.models_v2 import DirectBunkRequest
        from bunking.solver.direct_solver import DirectBunkingSolver

        # Fail the test if the fallback path ever reads config — `weight_for`
        # raises ValueError via classify() BEFORE touching config for off-axis
        # combos, so a config.get_float call signals a regression to plain
        # lookup.
        config = MagicMock()
        config.get_float.side_effect = AssertionError("off-axis fallback should not rely on config.get_float lookup")
        config.get_int.return_value = 0

        solver = DirectBunkingSolver.__new__(DirectBunkingSolver)
        solver.config = config

        # socialize_with × bunk_with is genuinely off-axis: SOCIALIZE_WITH only
        # registers with age_preference, so classify() raises ValueError before
        # weight_for ever reads config.
        request = DirectBunkRequest(
            id="req-off",
            requester_person_cm_id=1000001,
            requested_person_cm_id=1000002,
            request_type="bunk_with",
            session_cm_id=1000001,
            year=2025,
            source_field=SourceField.SOCIALIZE_WITH,
        )

        with caplog.at_level(logging.WARNING, logger="bunking.solver.direct_solver"):
            multiplier = solver._get_csv_field_multiplier(request)

        assert multiplier == 1.0
        assert any(
            "objective_multiplier_fallback" in rec.getMessage() and "req-off" in rec.getMessage()
            for rec in caplog.records
        ), "expected warning emission on off-axis fallback"
