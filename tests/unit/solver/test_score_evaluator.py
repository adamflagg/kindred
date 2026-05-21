"""Tests for score_evaluator module.

TDD tests to define expected behavior for scenario scoring.
Written BEFORE fixing implementation (tests should initially fail due to import error).
"""

from typing import ClassVar
from unittest.mock import MagicMock

import pytest

from bunking.config import ConfigLoader
from bunking.sync.bunk_request_processor.shared.constants import SourceField


class _CanonicalKeyConfig:
    """Stub loader for the four centralized penalty keys.

    score_evaluator now reads grade_spread / over_capacity / under_occupancy /
    min_occupancy via the centralized accessors (B1/B2/B4 fix), which call
    ``ConfigLoader.get_instance()``. This stub installs values matching the
    legacy keys used by the local MagicMock so the tests' magnitude assertions
    stay stable across the centralization.
    """

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
            field_scores={SourceField.BUNK_REQUEST_FORM: {"total": 5, "satisfied": 4}},
            penalties={"under_occupancy": 100},
        )

        assert breakdown.total_score == 1000
        assert breakdown.request_satisfaction_score == 1200
        assert breakdown.soft_penalty_score == 200
        assert breakdown.total_requests == 10
        assert breakdown.satisfied_requests == 8
        assert breakdown.satisfaction_rate == 0.8
        assert SourceField.BUNK_REQUEST_FORM in breakdown.field_scores
        assert "under_occupancy" in breakdown.penalties


class TestEvaluateScenarioScore:
    """Test the main evaluate_scenario_score function."""

    @pytest.fixture(autouse=True)
    def _install_canonical_loader(self):
        """Install the canonical-keys stub for the centralized accessors."""
        with ConfigLoader.use(_CanonicalKeyConfig()):  # type: ignore[arg-type]
            yield

    @pytest.fixture
    def mock_config(self):
        """Create a mock config with default values."""
        config = MagicMock()
        config.get_int.side_effect = lambda key, default=0: {
            "objective.enable_diminishing_returns": 1,
            "objective.first_request_multiplier": 10,
            "objective.second_request_multiplier": 5,
            "objective.third_plus_request_multiplier": 1,
            # Legacy keys (no longer read by score_evaluator)
            "penalty.grade_spread": 100,
            "penalty.over_capacity": 500,
            "constraint.cabin_occupancy.minimum": 8,
            "penalty.under_occupancy": 50,
            # Canonical keys (matched values; consulted by the autouse loader)
            "constraint.grade_spread.penalty": 100,
            "constraint.cabin_capacity.penalty": 500,
            "constraint.cabin_minimum_occupancy.penalty": 50,
            # Other keys read via the config= parameter
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
                "source_field": SourceField.BUNK_REQUEST_FORM,
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
                "source_field": SourceField.BUNK_REQUEST_FORM,
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
                "source_field": SourceField.STAFF_NOT_BUNK_WITH,
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

    def test_first_requested_boost_affects_score(self, mock_config):
        """is_first_requested=True requests should receive the 10x slot-0 multiplier.

        Priority was deleted — is_first_requested is the new mechanism for
        boosting high-signal requests (the former P1 bucket).
        """
        from bunking.solver.score_evaluator import evaluate_scenario_score

        # First-pick request (is_first_requested=True → slot-0 → FIRST_REQUEST_MULTIPLIER)
        first_pick = evaluate_scenario_score(
            requests=[
                {
                    "requester_id": 100,
                    "requestee_id": 200,
                    "request_type": "bunk_with",
                    "is_first_requested": True,
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

        # Verify the first-pick gets slot-0 boost: score = 70 * 10 = 700
        # (base_weight=40 * source_mult=1.75 * FIRST_REQUEST_MULTIPLIER=10)
        assert first_pick.request_satisfaction_score == 700

    def test_first_requested_flag_determines_slot_0(self, mock_config):
        """Two-request control: flipping is_first_requested between two
        requests with different source-mults must change the total score.

        Slot-0 (10x) goes to whichever request is flagged. With
        BUNK_REQUEST_FORM(1.75) flagged first: 70*10 + 40*5 = 900.
        With INTERNAL_NOTES(1.0) flagged first: 40*10 + 70*5 = 750.
        """
        from bunking.solver.score_evaluator import evaluate_scenario_score

        assignments = [
            {"person_cm_id": 100, "bunk_cm_id": 1},
            {"person_cm_id": 200, "bunk_cm_id": 1},
            {"person_cm_id": 300, "bunk_cm_id": 1},
        ]
        persons = [
            {"cm_id": 100, "grade": 5, "gender": "M"},
            {"cm_id": 200, "grade": 5, "gender": "M"},
            {"cm_id": 300, "grade": 5, "gender": "M"},
        ]
        bunks = [{"cm_id": 1, "name": "B-1", "gender": "M", "max_size": 12}]

        bunk_with_first = [
            {
                "requester_id": 100,
                "requestee_id": 200,
                "request_type": "bunk_with",
                "is_first_requested": True,
                "source_field": SourceField.BUNK_REQUEST_FORM,
            },
            {
                "requester_id": 100,
                "requestee_id": 300,
                "request_type": "bunk_with",
                "is_first_requested": False,
                "source_field": SourceField.INTERNAL_NOTES,
            },
        ]
        internal_notes_first = [
            {**bunk_with_first[0], "is_first_requested": False},
            {**bunk_with_first[1], "is_first_requested": True},
        ]

        a = evaluate_scenario_score(
            requests=bunk_with_first, assignments=assignments, persons=persons, bunks=bunks, config=mock_config
        )
        b = evaluate_scenario_score(
            requests=internal_notes_first, assignments=assignments, persons=persons, bunks=bunks, config=mock_config
        )

        assert a.request_satisfaction_score == 900
        assert b.request_satisfaction_score == 750
        assert a.request_satisfaction_score > b.request_satisfaction_score

    # Phase 2 grade-spread cleanup: removed test_grade_spread_penalty —
    # the soft grade-spread path was deleted and the score evaluator no
    # longer reports a "grade_spread" penalty term. Solver now enforces a
    # hard MAX_UNIQUE_GRADES_PER_BUNK ceiling, so the only way 3+ unique
    # grades land in one bunk in a solved scenario is via staff manual
    # override on the bunking board (flagged with grade_spread_warning by
    # the validator, not the score evaluator).

    # Phase 2 cabin-capacity cleanup: removed test_over_capacity_penalty —
    # the soft-cabin-capacity path was deleted and the score evaluator no
    # longer reports an "over_capacity" penalty term. Solver now enforces
    # capacity as a hard constraint at DEFAULT_BUNK_CAPACITY, so an
    # over-capacity assignment cannot appear in a solved scenario.

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
                "source_field": SourceField.BUNK_REQUEST_FORM,
            },
            {
                "requester_id": 100,
                "requestee_id": 300,
                "request_type": "bunk_with",
                "priority": 5,
                "source_field": SourceField.BUNK_REQUEST_FORM,
            },
            {
                "requester_id": 100,
                "requestee_id": 400,
                "request_type": "bunk_with",
                "priority": 5,
                "source_field": SourceField.BUNK_REQUEST_FORM,
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

    def test_fallback_to_source_field(self):
        """Should return source_field as list."""
        from bunking.solver.score_evaluator import _get_source_fields

        request = {"source_field": SourceField.BUNKING_NOTES}

        result = _get_source_fields(request)
        assert result == [SourceField.BUNKING_NOTES]

    def test_age_preference_maps_to_socialize_with(self):
        """age_preference requests should map to SOCIALIZE_WITH source."""
        from bunking.solver.score_evaluator import _get_source_fields

        request = {"request_type": "age_preference"}

        result = _get_source_fields(request)
        assert result == [SourceField.SOCIALIZE_WITH]

    def test_empty_request_returns_empty_list(self):
        """Empty request should return empty list."""
        from bunking.solver.score_evaluator import _get_source_fields

        result = _get_source_fields({})
        assert result == []


class TestCalculatePenalties:
    """Test the _calculate_penalties helper function."""

    @pytest.fixture(autouse=True)
    def _install_canonical_loader(self):
        """Install the canonical-keys stub for the centralized accessors."""
        with ConfigLoader.use(_CanonicalKeyConfig()):  # type: ignore[arg-type]
            yield

    @pytest.fixture
    def mock_config(self):
        """Create a mock config with default penalty values.

        Includes both legacy and canonical keys at matched values; the
        centralized accessors are served by the autouse loader fixture.
        """
        config = MagicMock()
        config.get_int.side_effect = lambda key, default=0: {
            # Legacy keys
            "penalty.grade_spread": 100,
            "penalty.over_capacity": 500,
            "constraint.cabin_occupancy.minimum": 8,
            "penalty.under_occupancy": 50,
            # Canonical keys
            "constraint.grade_spread.penalty": 100,
            "constraint.cabin_capacity.penalty": 500,
            "constraint.cabin_minimum_occupancy.penalty": 50,
            "constraint.grade_spread.max_spread": 2,
            "constraint.cabin_capacity.standard": 12,
        }.get(key, default)
        return config

    def test_no_penalties_for_good_state(self, mock_config):
        """Good assignment state should have no penalties.

        Uses a 10-camper bunk: at or above PREFERRED_BUNK_OCCUPANCY=10 so the
        soft underfill path contributes 0.
        """
        from bunking.solver.score_evaluator import _calculate_penalties

        person_to_bunk = dict.fromkeys(range(1, 11), 100)
        bunk_to_persons = {100: list(range(1, 11))}
        person_by_cm_id = {i: {"cm_id": i, "grade": 5} for i in range(1, 11)}
        bunk_by_cm_id = {100: {"cm_id": 100, "max_size": 12}}

        penalties = _calculate_penalties(person_to_bunk, bunk_to_persons, person_by_cm_id, bunk_by_cm_id, mock_config)

        # All grades are 5, so no spread violation
        # 10 campers meets preferred occupancy
        # Not over capacity
        assert penalties.get("grade_spread", 0) == 0
        assert penalties.get("over_capacity", 0) == 0
        assert penalties.get("under_occupancy", 0) == 0

    def test_under_occupancy_penalty_charges_against_preferred(self, mock_config):
        """Bunks below PREFERRED_BUNK_OCCUPANCY=10 should be penalized.

        B5 drift fix: the OR-Tools cost path charges underfill against the
        preferred threshold (10), so the post-solve evaluator must do the
        same. Previously it charged against the hard minimum (8), which made
        the displayed score silently 0 for any feasible bunk between 8 and 9.
        """
        from bunking.solver.score_evaluator import _calculate_penalties

        # 3 campers in bunk; preferred=10 → deficit 7, penalty 50 per spot → 350
        person_to_bunk = {1: 100, 2: 100, 3: 100}
        bunk_to_persons = {100: [1, 2, 3]}
        person_by_cm_id = {i: {"cm_id": i, "grade": 5} for i in [1, 2, 3]}
        bunk_by_cm_id = {100: {"cm_id": 100, "max_size": 12}}

        penalties = _calculate_penalties(person_to_bunk, bunk_to_persons, person_by_cm_id, bunk_by_cm_id, mock_config)

        assert penalties.get("under_occupancy", 0) == 7 * 50

    def test_under_occupancy_charges_for_bunks_between_min_and_preferred(self, mock_config):
        """The B5 regression case: a feasibly-filled bunk at 9 was invisible.

        With hard floor 8 and preferred 10, a 9-camper bunk used to evaluate to
        0 (because 9 >= min=8). After the fix it charges (10-9)*50 = 50.
        """
        from bunking.solver.score_evaluator import _calculate_penalties

        person_to_bunk = dict.fromkeys(range(1, 10), 100)
        bunk_to_persons = {100: list(range(1, 10))}  # 9 campers
        person_by_cm_id = {i: {"cm_id": i, "grade": 5} for i in range(1, 10)}
        bunk_by_cm_id = {100: {"cm_id": 100, "max_size": 12}}

        penalties = _calculate_penalties(person_to_bunk, bunk_to_persons, person_by_cm_id, bunk_by_cm_id, mock_config)

        assert penalties.get("under_occupancy", 0) == 1 * 50
