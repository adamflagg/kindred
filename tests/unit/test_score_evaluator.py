"""Tests for score_evaluator module."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from bunking.solver.score_evaluator import (
    ScoreBreakdown,
    _calculate_penalties,
    _get_source_fields,
    evaluate_scenario_score,
)


class TestGetSourceFields:
    """Tests for _get_source_fields helper function."""

    def test_csv_source_fields_present(self):
        request = {"csv_source_fields": ["share_bunk_with", "bunking_notes"]}
        result = _get_source_fields(request)
        assert result == ["share_bunk_with", "bunking_notes"]

    def test_ai_reasoning_with_fields(self):
        request = {
            "ai_reasoning": {
                "csv_source_fields": ["internal_notes"],
                "confidence": 0.9,
            }
        }
        result = _get_source_fields(request)
        assert result == ["internal_notes"]

    def test_source_field_fallback(self):
        request = {"source_field": "bunking_notes"}
        result = _get_source_fields(request)
        assert result == ["bunking_notes"]

    def test_age_preference_maps_to_socialize_with(self):
        request = {"request_type": "age_preference"}
        result = _get_source_fields(request)
        assert result == ["socialize_with"]

    def test_empty_request(self):
        request: dict[str, Any] = {}
        result = _get_source_fields(request)
        assert result == []

    def test_csv_source_fields_empty(self):
        request: dict[str, Any] = {"csv_source_fields": []}
        result = _get_source_fields(request)
        assert result == []

    def test_ai_reasoning_empty_fields(self):
        request: dict[str, Any] = {"ai_reasoning": {"csv_source_fields": []}}
        result = _get_source_fields(request)
        assert result == []

    def test_ai_reasoning_not_dict(self):
        request = {"ai_reasoning": "string value"}
        result = _get_source_fields(request)
        assert result == []


class TestCalculatePenalties:
    """Tests for _calculate_penalties function."""

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

    def test_no_violations(self, mock_config):
        """Test with no constraint violations."""
        person_to_bunk = {1: 100, 2: 100, 3: 100}
        bunk_to_persons = {100: [1, 2, 3]}
        person_by_cm_id = {
            1: {"cm_id": 1, "grade": 5},
            2: {"cm_id": 2, "grade": 5},
            3: {"cm_id": 3, "grade": 6},
        }
        bunk_by_cm_id = {100: {"cm_id": 100, "max_size": 12}}

        # Under 8 persons but that's expected
        penalties = _calculate_penalties(person_to_bunk, bunk_to_persons, person_by_cm_id, bunk_by_cm_id, mock_config)

        # Under occupancy penalty expected (3 < 8 minimum)
        assert "grade_spread" not in penalties
        assert "over_capacity" not in penalties
        assert "under_occupancy" in penalties

    def test_grade_spread_violation(self, mock_config):
        """Test grade spread penalty calculation."""
        person_to_bunk = {1: 100, 2: 100, 3: 100, 4: 100}
        bunk_to_persons = {100: [1, 2, 3, 4]}
        person_by_cm_id = {
            1: {"cm_id": 1, "grade": 3},  # Wide spread: 3 to 8 = 5 grades
            2: {"cm_id": 2, "grade": 5},
            3: {"cm_id": 3, "grade": 7},
            4: {"cm_id": 4, "grade": 8},
        }
        bunk_by_cm_id = {100: {"cm_id": 100, "max_size": 12}}

        penalties = _calculate_penalties(person_to_bunk, bunk_to_persons, person_by_cm_id, bunk_by_cm_id, mock_config)

        # Grade spread 5 > max 2, so one violation = 100 penalty
        assert "grade_spread" in penalties
        assert penalties["grade_spread"] == 100

    def test_over_capacity_violation(self, mock_config):
        """Test over capacity penalty calculation."""
        # 5 persons in a bunk with max_size=3
        person_to_bunk = {1: 100, 2: 100, 3: 100, 4: 100, 5: 100}
        bunk_to_persons = {100: [1, 2, 3, 4, 5]}
        person_by_cm_id = {
            1: {"cm_id": 1, "grade": 5},
            2: {"cm_id": 2, "grade": 5},
            3: {"cm_id": 3, "grade": 5},
            4: {"cm_id": 4, "grade": 5},
            5: {"cm_id": 5, "grade": 5},
        }
        bunk_by_cm_id = {100: {"cm_id": 100, "max_size": 3}}

        penalties = _calculate_penalties(person_to_bunk, bunk_to_persons, person_by_cm_id, bunk_by_cm_id, mock_config)

        # 5 - 3 = 2 over capacity, 2 * 500 = 1000
        assert "over_capacity" in penalties
        assert penalties["over_capacity"] == 1000

    def test_under_occupancy_penalty(self, mock_config):
        """Test under occupancy penalty calculation."""
        person_to_bunk = {1: 100, 2: 100}
        bunk_to_persons = {100: [1, 2]}  # Only 2, minimum is 8
        person_by_cm_id = {
            1: {"cm_id": 1, "grade": 5},
            2: {"cm_id": 2, "grade": 5},
        }
        bunk_by_cm_id = {100: {"cm_id": 100, "max_size": 12}}

        penalties = _calculate_penalties(person_to_bunk, bunk_to_persons, person_by_cm_id, bunk_by_cm_id, mock_config)

        # 8 - 2 = 6 under minimum, 6 * 50 = 300
        assert "under_occupancy" in penalties
        assert penalties["under_occupancy"] == 300

    def test_empty_bunks(self, mock_config):
        """Test with empty data."""
        penalties = _calculate_penalties({}, {}, {}, {}, mock_config)
        assert penalties == {}

    def test_missing_grades(self, mock_config):
        """Test with persons missing grade data."""
        person_to_bunk = {1: 100, 2: 100}
        bunk_to_persons = {100: [1, 2]}
        person_by_cm_id = {
            1: {"cm_id": 1},  # No grade
            2: {"cm_id": 2, "grade": 5},
        }
        bunk_by_cm_id = {100: {"cm_id": 100}}

        penalties = _calculate_penalties(person_to_bunk, bunk_to_persons, person_by_cm_id, bunk_by_cm_id, mock_config)

        # Should not crash, only one grade so no spread calculation
        assert "grade_spread" not in penalties


class TestEvaluateScenarioScore:
    """Tests for the main evaluate_scenario_score function."""

    @pytest.fixture
    def mock_config(self):
        """Create a mock config with default values."""
        config = MagicMock()

        def get_int_side_effect(key, default=0):
            values = {
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
            }
            return values.get(key, default)

        def get_float_side_effect(key, default=0.0):
            values = {
                "objective.source_multipliers.share_bunk_with": 1.5,
                "objective.source_multipliers.do_not_share_with": 1.5,
                "objective.source_multipliers.bunking_notes": 1.2,
                "objective.source_multipliers.internal_notes": 1.0,
                "objective.source_multipliers.socialize_with": 0.8,
            }
            return values.get(key, default)

        config.get_int.side_effect = get_int_side_effect
        config.get_float.side_effect = get_float_side_effect
        return config

    def test_empty_data(self, mock_config):
        """Test with empty data."""
        result = evaluate_scenario_score([], [], [], [], config=mock_config)

        assert isinstance(result, ScoreBreakdown)
        assert result.total_score == 0
        assert result.total_requests == 0
        assert result.satisfied_requests == 0
        assert result.satisfaction_rate == 0.0

    def test_bunk_with_satisfied(self, mock_config):
        """Test satisfied bunk_with request."""
        requests = [
            {
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "bunk_with",
                "priority": 5,
                "source_field": "share_bunk_with",
            }
        ]
        assignments = [
            {"person_cm_id": 1, "bunk_cm_id": 100},
            {"person_cm_id": 2, "bunk_cm_id": 100},  # Same bunk
        ]
        persons = [
            {"cm_id": 1, "grade": 5},
            {"cm_id": 2, "grade": 5},
        ]
        bunks = [{"cm_id": 100, "max_size": 12}]

        result = evaluate_scenario_score(requests, assignments, persons, bunks, config=mock_config)

        assert result.total_requests == 1
        assert result.satisfied_requests == 1
        assert result.satisfaction_rate == 1.0
        assert result.request_satisfaction_score > 0

    def test_bunk_with_unsatisfied(self, mock_config):
        """Test unsatisfied bunk_with request."""
        requests = [
            {
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "bunk_with",
                "priority": 5,
            }
        ]
        assignments = [
            {"person_cm_id": 1, "bunk_cm_id": 100},
            {"person_cm_id": 2, "bunk_cm_id": 200},  # Different bunk
        ]
        persons = [
            {"cm_id": 1, "grade": 5},
            {"cm_id": 2, "grade": 5},
        ]
        bunks = [
            {"cm_id": 100, "max_size": 12},
            {"cm_id": 200, "max_size": 12},
        ]

        result = evaluate_scenario_score(requests, assignments, persons, bunks, config=mock_config)

        assert result.total_requests == 1
        assert result.satisfied_requests == 0
        assert result.satisfaction_rate == 0.0

    def test_not_bunk_with_satisfied(self, mock_config):
        """Test satisfied not_bunk_with request."""
        requests = [
            {
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "not_bunk_with",
                "priority": 5,
            }
        ]
        assignments = [
            {"person_cm_id": 1, "bunk_cm_id": 100},
            {"person_cm_id": 2, "bunk_cm_id": 200},  # Different bunk - satisfied
        ]
        persons = [
            {"cm_id": 1, "grade": 5},
            {"cm_id": 2, "grade": 5},
        ]
        bunks = [
            {"cm_id": 100, "max_size": 12},
            {"cm_id": 200, "max_size": 12},
        ]

        result = evaluate_scenario_score(requests, assignments, persons, bunks, config=mock_config)

        assert result.total_requests == 1
        assert result.satisfied_requests == 1

    def test_not_bunk_with_unsatisfied(self, mock_config):
        """Test unsatisfied not_bunk_with request."""
        requests = [
            {
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "not_bunk_with",
                "priority": 5,
            }
        ]
        assignments = [
            {"person_cm_id": 1, "bunk_cm_id": 100},
            {"person_cm_id": 2, "bunk_cm_id": 100},  # Same bunk - violated
        ]
        persons = [
            {"cm_id": 1, "grade": 5},
            {"cm_id": 2, "grade": 5},
        ]
        bunks = [{"cm_id": 100, "max_size": 12}]

        result = evaluate_scenario_score(requests, assignments, persons, bunks, config=mock_config)

        assert result.total_requests == 1
        assert result.satisfied_requests == 0

    def test_not_bunk_with_requestee_unassigned(self, mock_config):
        """Test not_bunk_with when requestee is not assigned (satisfied)."""
        requests = [
            {
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "not_bunk_with",
                "priority": 5,
            }
        ]
        assignments = [
            {"person_cm_id": 1, "bunk_cm_id": 100},
            # Person 2 not assigned
        ]
        persons = [
            {"cm_id": 1, "grade": 5},
            {"cm_id": 2, "grade": 5},
        ]
        bunks = [{"cm_id": 100, "max_size": 12}]

        result = evaluate_scenario_score(requests, assignments, persons, bunks, config=mock_config)

        # not_bunk_with should be satisfied if requestee not assigned
        assert result.satisfied_requests == 1

    def test_requester_unassigned(self, mock_config):
        """Test request when requester is not assigned."""
        requests = [
            {
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "bunk_with",
                "priority": 5,
            }
        ]
        assignments = [
            {"person_cm_id": 2, "bunk_cm_id": 100},
            # Person 1 not assigned
        ]
        persons = [
            {"cm_id": 1, "grade": 5},
            {"cm_id": 2, "grade": 5},
        ]
        bunks = [{"cm_id": 100, "max_size": 12}]

        result = evaluate_scenario_score(requests, assignments, persons, bunks, config=mock_config)

        assert result.satisfied_requests == 0

    def test_priority_weighting(self, mock_config):
        """Test that higher priority requests contribute more to score."""
        high_priority_request = [
            {
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "bunk_with",
                "priority": 10,  # High priority
            }
        ]
        low_priority_request = [
            {
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "bunk_with",
                "priority": 1,  # Low priority
            }
        ]
        assignments = [
            {"person_cm_id": 1, "bunk_cm_id": 100},
            {"person_cm_id": 2, "bunk_cm_id": 100},
        ]
        persons = [
            {"cm_id": 1, "grade": 5},
            {"cm_id": 2, "grade": 5},
        ]
        bunks = [{"cm_id": 100, "max_size": 12}]

        high_result = evaluate_scenario_score(high_priority_request, assignments, persons, bunks, config=mock_config)
        low_result = evaluate_scenario_score(low_priority_request, assignments, persons, bunks, config=mock_config)

        assert high_result.request_satisfaction_score > low_result.request_satisfaction_score

    def test_source_field_multiplier(self, mock_config):
        """Test that source field multipliers affect score."""
        share_bunk_request = [
            {
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "bunk_with",
                "priority": 5,
                "source_field": "share_bunk_with",  # 1.5x multiplier
            }
        ]
        socialize_request = [
            {
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "bunk_with",
                "priority": 5,
                "source_field": "socialize_with",  # 0.8x multiplier
            }
        ]
        assignments = [
            {"person_cm_id": 1, "bunk_cm_id": 100},
            {"person_cm_id": 2, "bunk_cm_id": 100},
        ]
        persons = [
            {"cm_id": 1, "grade": 5},
            {"cm_id": 2, "grade": 5},
        ]
        bunks = [{"cm_id": 100, "max_size": 12}]

        share_result = evaluate_scenario_score(share_bunk_request, assignments, persons, bunks, config=mock_config)
        socialize_result = evaluate_scenario_score(socialize_request, assignments, persons, bunks, config=mock_config)

        # share_bunk_with (1.5x) should score higher than socialize_with (0.8x)
        assert share_result.request_satisfaction_score > socialize_result.request_satisfaction_score

    def test_field_scores_breakdown(self, mock_config):
        """Test field-level score breakdown."""
        requests = [
            {
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "bunk_with",
                "priority": 5,
                "source_field": "share_bunk_with",
            },
            {
                "requester_id": 3,
                "requestee_id": 4,
                "request_type": "bunk_with",
                "priority": 5,
                "source_field": "bunking_notes",
            },
        ]
        assignments = [
            {"person_cm_id": 1, "bunk_cm_id": 100},
            {"person_cm_id": 2, "bunk_cm_id": 100},  # 1&2 together
            {"person_cm_id": 3, "bunk_cm_id": 200},
            {"person_cm_id": 4, "bunk_cm_id": 300},  # 3&4 not together
        ]
        persons = [
            {"cm_id": 1, "grade": 5},
            {"cm_id": 2, "grade": 5},
            {"cm_id": 3, "grade": 5},
            {"cm_id": 4, "grade": 5},
        ]
        bunks = [
            {"cm_id": 100, "max_size": 12},
            {"cm_id": 200, "max_size": 12},
            {"cm_id": 300, "max_size": 12},
        ]

        result = evaluate_scenario_score(requests, assignments, persons, bunks, config=mock_config)

        assert "share_bunk_with" in result.field_scores
        assert "bunking_notes" in result.field_scores
        assert result.field_scores["share_bunk_with"]["satisfied"] == 1
        assert result.field_scores["bunking_notes"]["satisfied"] == 0

    def test_penalties_applied(self, mock_config):
        """Test that penalties are subtracted from total score."""
        requests = [
            {
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "bunk_with",
                "priority": 10,
                "source_field": "share_bunk_with",
            }
        ]
        assignments = [
            {"person_cm_id": 1, "bunk_cm_id": 100},
            {"person_cm_id": 2, "bunk_cm_id": 100},
        ]
        persons = [
            {"cm_id": 1, "grade": 3},  # Wide grade spread
            {"cm_id": 2, "grade": 8},
        ]
        bunks = [{"cm_id": 100, "max_size": 12}]

        result = evaluate_scenario_score(requests, assignments, persons, bunks, config=mock_config)

        # Should have grade spread penalty
        assert result.soft_penalty_score > 0
        assert "grade_spread" in result.penalties
        assert result.total_score == result.request_satisfaction_score - result.soft_penalty_score

    def test_alternative_field_names(self, mock_config):
        """Test with alternative field names (person_id vs person_cm_id)."""
        requests = [
            {
                "requester_person_cm_id": 1,  # Alternative name
                "requested_person_cm_id": 2,  # Alternative name
                "request_type": "bunk_with",
                "priority": 5,
            }
        ]
        assignments = [
            {"person_id": 1, "bunk_id": 100},  # Alternative names
            {"person_id": 2, "bunk_id": 100},
        ]
        persons = [
            {"cm_id": 1, "grade": 5},
            {"cm_id": 2, "grade": 5},
        ]
        bunks = [{"cm_id": 100, "max_size": 12}]

        result = evaluate_scenario_score(requests, assignments, persons, bunks, config=mock_config)

        assert result.satisfied_requests == 1


class TestScoreBreakdown:
    """Tests for ScoreBreakdown dataclass."""

    def test_dataclass_creation(self):
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
        assert breakdown.satisfaction_rate == 0.8
        assert "share_bunk_with" in breakdown.field_scores
