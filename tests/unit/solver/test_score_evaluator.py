"""Tests for score_evaluator module.

TDD tests to define expected behavior for scenario scoring.
Written BEFORE fixing implementation (tests should initially fail due to import error).
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest


class TestScoreBreakdown:
    """Test the ScoreBreakdown dataclass."""

    def test_score_breakdown_has_required_fields(self):
        """ScoreBreakdown should have all required fields."""
        from bunking.solver.score_evaluator import ScoreBreakdown

        breakdown = ScoreBreakdown(
            total_score=1000,
            request_satisfaction_score=1200,
            soft_penalty_score=200,
            total_requests=10,
            satisfied_requests=8,
            satisfaction_rate=0.8,
            field_scores={"share_bunk_with": {"total": 5, "satisfied": 4}},
            penalties={"grade_spread": 100},
        )

        assert breakdown.total_score == 1000
        assert breakdown.request_satisfaction_score == 1200
        assert breakdown.soft_penalty_score == 200
        assert breakdown.total_requests == 10
        assert breakdown.satisfied_requests == 8
        assert breakdown.satisfaction_rate == 0.8
        assert "share_bunk_with" in breakdown.field_scores
        assert "grade_spread" in breakdown.penalties


class TestEvaluateScenarioScore:
    """Test the main evaluate_scenario_score function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock config with default values."""
        config = MagicMock()
        config.get_int.side_effect = lambda key, default=0: {
            "objective.enable_diminishing_returns": 1,
            "objective.first_request_multiplier": 10,
            "objective.second_request_multiplier": 5,
            "objective.third_plus_request_multiplier": 1,
            "penalty.grade_spread": 100,
            "constraint.grade_spread.max_spread": 2,
            "penalty.over_capacity": 500,
            "constraint.cabin_capacity.standard": 12,
            "constraint.cabin_occupancy.minimum": 8,
            "penalty.under_occupancy": 50,
        }.get(key, default)

        config.get_float.side_effect = lambda key, default=1.0: {
            "objective.source_multipliers.share_bunk_with": 1.5,
            "objective.source_multipliers.do_not_share_with": 1.5,
            "objective.source_multipliers.bunking_notes": 1.2,
            "objective.source_multipliers.internal_notes": 1.0,
            "objective.source_multipliers.socialize_with": 0.8,
        }.get(key, default)

        return config

    def test_empty_inputs_return_zero_score(self, mock_config):
        """Empty inputs should return a score breakdown with zeros."""
        from bunking.solver.score_evaluator import evaluate_scenario_score

        result = evaluate_scenario_score(
            requests=[],
            assignments=[],
            persons=[],
            bunks=[],
            config=mock_config,
        )

        assert result.total_score == 0
        assert result.total_requests == 0
        assert result.satisfied_requests == 0
        assert result.satisfaction_rate == 0.0

    def test_satisfied_bunk_with_request(self, mock_config):
        """A satisfied bunk_with request should contribute to the score."""
        from bunking.solver.score_evaluator import evaluate_scenario_score

        requests = [
            {
                "requester_id": 100,
                "requestee_id": 200,
                "request_type": "bunk_with",
                "priority": 5,
                "source_field": "share_bunk_with",
            }
        ]
        assignments = [
            {"person_cm_id": 100, "bunk_cm_id": 1},
            {"person_cm_id": 200, "bunk_cm_id": 1},  # Same bunk = satisfied
        ]
        persons = [
            {"cm_id": 100, "grade": 5, "gender": "M"},
            {"cm_id": 200, "grade": 5, "gender": "M"},
        ]
        bunks = [{"cm_id": 1, "name": "B-1", "gender": "M", "max_size": 12}]

        result = evaluate_scenario_score(
            requests=requests,
            assignments=assignments,
            persons=persons,
            bunks=bunks,
            config=mock_config,
        )

        assert result.total_requests == 1
        assert result.satisfied_requests == 1
        assert result.satisfaction_rate == 1.0
        assert result.request_satisfaction_score > 0

    def test_unsatisfied_bunk_with_request(self, mock_config):
        """An unsatisfied bunk_with request should not contribute to satisfaction."""
        from bunking.solver.score_evaluator import evaluate_scenario_score

        requests = [
            {
                "requester_id": 100,
                "requestee_id": 200,
                "request_type": "bunk_with",
                "priority": 5,
                "source_field": "share_bunk_with",
            }
        ]
        assignments = [
            {"person_cm_id": 100, "bunk_cm_id": 1},
            {"person_cm_id": 200, "bunk_cm_id": 2},  # Different bunks = unsatisfied
        ]
        persons = [
            {"cm_id": 100, "grade": 5, "gender": "M"},
            {"cm_id": 200, "grade": 5, "gender": "M"},
        ]
        bunks = [
            {"cm_id": 1, "name": "B-1", "gender": "M", "max_size": 12},
            {"cm_id": 2, "name": "B-2", "gender": "M", "max_size": 12},
        ]

        result = evaluate_scenario_score(
            requests=requests,
            assignments=assignments,
            persons=persons,
            bunks=bunks,
            config=mock_config,
        )

        assert result.total_requests == 1
        assert result.satisfied_requests == 0
        assert result.satisfaction_rate == 0.0

    def test_satisfied_not_bunk_with_request(self, mock_config):
        """A satisfied not_bunk_with request (different bunks) should add to score."""
        from bunking.solver.score_evaluator import evaluate_scenario_score

        requests = [
            {
                "requester_id": 100,
                "requestee_id": 200,
                "request_type": "not_bunk_with",
                "priority": 8,
                "source_field": "do_not_share_with",
            }
        ]
        assignments = [
            {"person_cm_id": 100, "bunk_cm_id": 1},
            {"person_cm_id": 200, "bunk_cm_id": 2},  # Different bunks = satisfied
        ]
        persons = [
            {"cm_id": 100, "grade": 5, "gender": "M"},
            {"cm_id": 200, "grade": 5, "gender": "M"},
        ]
        bunks = [
            {"cm_id": 1, "name": "B-1", "gender": "M", "max_size": 12},
            {"cm_id": 2, "name": "B-2", "gender": "M", "max_size": 12},
        ]

        result = evaluate_scenario_score(
            requests=requests,
            assignments=assignments,
            persons=persons,
            bunks=bunks,
            config=mock_config,
        )

        assert result.total_requests == 1
        assert result.satisfied_requests == 1

    def test_priority_affects_score(self, mock_config):
        """Higher priority requests should contribute more to score."""
        from bunking.solver.score_evaluator import evaluate_scenario_score

        # Low priority request
        low_priority = evaluate_scenario_score(
            requests=[
                {
                    "requester_id": 100,
                    "requestee_id": 200,
                    "request_type": "bunk_with",
                    "priority": 1,
                    "source_field": "share_bunk_with",
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

        # High priority request
        high_priority = evaluate_scenario_score(
            requests=[
                {
                    "requester_id": 100,
                    "requestee_id": 200,
                    "request_type": "bunk_with",
                    "priority": 10,
                    "source_field": "share_bunk_with",
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

        assert high_priority.request_satisfaction_score > low_priority.request_satisfaction_score

    def test_grade_spread_penalty(self, mock_config):
        """Bunks with grade spread > max should incur penalty."""
        from bunking.solver.score_evaluator import evaluate_scenario_score

        # Grade spread of 4 exceeds max of 2
        result = evaluate_scenario_score(
            requests=[],
            assignments=[
                {"person_cm_id": 100, "bunk_cm_id": 1},
                {"person_cm_id": 200, "bunk_cm_id": 1},
            ],
            persons=[
                {"cm_id": 100, "grade": 3, "gender": "M"},
                {"cm_id": 200, "grade": 7, "gender": "M"},  # Spread = 4
            ],
            bunks=[{"cm_id": 1, "name": "B-1", "gender": "M", "max_size": 12}],
            config=mock_config,
        )

        assert "grade_spread" in result.penalties
        assert result.penalties["grade_spread"] > 0
        assert result.soft_penalty_score > 0

    def test_over_capacity_penalty(self, mock_config):
        """Bunks over capacity should incur penalty."""
        from bunking.solver.score_evaluator import evaluate_scenario_score

        # 13 campers in a bunk with max 12
        assignments = [{"person_cm_id": i, "bunk_cm_id": 1} for i in range(1, 14)]
        persons = [{"cm_id": i, "grade": 5, "gender": "M"} for i in range(1, 14)]

        result = evaluate_scenario_score(
            requests=[],
            assignments=assignments,
            persons=persons,
            bunks=[{"cm_id": 1, "name": "B-1", "gender": "M", "max_size": 12}],
            config=mock_config,
        )

        assert "over_capacity" in result.penalties
        assert result.penalties["over_capacity"] > 0

    def test_diminishing_returns(self, mock_config):
        """Multiple satisfied requests for same person should have diminishing returns."""
        from bunking.solver.score_evaluator import evaluate_scenario_score

        # Three satisfied requests for same person
        requests = [
            {
                "requester_id": 100,
                "requestee_id": 200,
                "request_type": "bunk_with",
                "priority": 5,
                "source_field": "share_bunk_with",
            },
            {
                "requester_id": 100,
                "requestee_id": 300,
                "request_type": "bunk_with",
                "priority": 5,
                "source_field": "share_bunk_with",
            },
            {
                "requester_id": 100,
                "requestee_id": 400,
                "request_type": "bunk_with",
                "priority": 5,
                "source_field": "share_bunk_with",
            },
        ]
        assignments = [
            {"person_cm_id": 100, "bunk_cm_id": 1},
            {"person_cm_id": 200, "bunk_cm_id": 1},
            {"person_cm_id": 300, "bunk_cm_id": 1},
            {"person_cm_id": 400, "bunk_cm_id": 1},
        ]
        persons = [
            {"cm_id": 100, "grade": 5, "gender": "M"},
            {"cm_id": 200, "grade": 5, "gender": "M"},
            {"cm_id": 300, "grade": 5, "gender": "M"},
            {"cm_id": 400, "grade": 5, "gender": "M"},
        ]

        result = evaluate_scenario_score(
            requests=requests,
            assignments=assignments,
            persons=persons,
            bunks=[{"cm_id": 1, "name": "B-1", "gender": "M", "max_size": 12}],
            config=mock_config,
        )

        assert result.satisfied_requests == 3

        # With diminishing returns, score should be less than 3x single request
        single_request = evaluate_scenario_score(
            requests=[requests[0]],
            assignments=assignments[:2],
            persons=persons[:2],
            bunks=[{"cm_id": 1, "name": "B-1", "gender": "M", "max_size": 12}],
            config=mock_config,
        )

        # Should be significantly less than 3x due to diminishing returns
        assert result.request_satisfaction_score < single_request.request_satisfaction_score * 3


class TestGetSourceFields:
    """Test the _get_source_fields helper function."""

    def test_csv_source_fields_takes_priority(self):
        """csv_source_fields should be used if present."""
        from bunking.solver.score_evaluator import _get_source_fields

        request = {
            "csv_source_fields": ["share_bunk_with", "bunking_notes"],
            "source_field": "other",
        }

        result = _get_source_fields(request)
        assert result == ["share_bunk_with", "bunking_notes"]

    def test_ai_reasoning_source_fields(self):
        """Should extract from ai_reasoning.csv_source_fields."""
        from bunking.solver.score_evaluator import _get_source_fields

        request = {
            "ai_reasoning": {"csv_source_fields": ["internal_notes"]},
        }

        result = _get_source_fields(request)
        assert result == ["internal_notes"]

    def test_fallback_to_source_field(self):
        """Should fall back to source_field as list."""
        from bunking.solver.score_evaluator import _get_source_fields

        request = {"source_field": "bunking_notes"}

        result = _get_source_fields(request)
        assert result == ["bunking_notes"]

    def test_age_preference_maps_to_socialize_with(self):
        """age_preference requests should map to socialize_with source."""
        from bunking.solver.score_evaluator import _get_source_fields

        request = {"request_type": "age_preference"}

        result = _get_source_fields(request)
        assert result == ["socialize_with"]

    def test_empty_request_returns_empty_list(self):
        """Empty request should return empty list."""
        from bunking.solver.score_evaluator import _get_source_fields

        result = _get_source_fields({})
        assert result == []


class TestCalculatePenalties:
    """Test the _calculate_penalties helper function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock config with default penalty values."""
        config = MagicMock()
        config.get_int.side_effect = lambda key, default=0: {
            "penalty.grade_spread": 100,
            "constraint.grade_spread.max_spread": 2,
            "penalty.over_capacity": 500,
            "constraint.cabin_capacity.standard": 12,
            "constraint.cabin_occupancy.minimum": 8,
            "penalty.under_occupancy": 50,
        }.get(key, default)
        return config

    def test_no_penalties_for_good_state(self, mock_config):
        """Good assignment state should have no penalties."""
        from bunking.solver.score_evaluator import _calculate_penalties

        person_to_bunk = {1: 100, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 7: 100, 8: 100}
        bunk_to_persons = {100: [1, 2, 3, 4, 5, 6, 7, 8]}
        person_by_cm_id = {i: {"cm_id": i, "grade": 5} for i in range(1, 9)}
        bunk_by_cm_id = {100: {"cm_id": 100, "max_size": 12}}

        penalties = _calculate_penalties(person_to_bunk, bunk_to_persons, person_by_cm_id, bunk_by_cm_id, mock_config)

        # All grades are 5, so no spread violation
        # 8 campers meets minimum
        # Not over capacity
        assert penalties.get("grade_spread", 0) == 0
        assert penalties.get("over_capacity", 0) == 0
        assert penalties.get("under_occupancy", 0) == 0

    def test_under_occupancy_penalty(self, mock_config):
        """Bunks with fewer than minimum should get penalty."""
        from bunking.solver.score_evaluator import _calculate_penalties

        # Only 3 campers in bunk (minimum is 8)
        person_to_bunk = {1: 100, 2: 100, 3: 100}
        bunk_to_persons = {100: [1, 2, 3]}
        person_by_cm_id = {i: {"cm_id": i, "grade": 5} for i in [1, 2, 3]}
        bunk_by_cm_id = {100: {"cm_id": 100, "max_size": 12}}

        penalties = _calculate_penalties(person_to_bunk, bunk_to_persons, person_by_cm_id, bunk_by_cm_id, mock_config)

        # 8 - 3 = 5 under minimum, * 50 penalty each
        assert penalties.get("under_occupancy", 0) == 5 * 50
