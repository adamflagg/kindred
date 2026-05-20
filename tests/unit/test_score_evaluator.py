"""Tests for score_evaluator module."""

from __future__ import annotations

from typing import Any, ClassVar
from unittest.mock import MagicMock

import pytest

from bunking.config import ConfigLoader
from bunking.solver.score_evaluator import (
    ScoreBreakdown,
    _calculate_penalties,
    _get_source_fields,
    evaluate_scenario_score,
)
from bunking.sync.bunk_request_processor.shared.constants import SourceField


class _CanonicalKeyConfig:
    """Stub loader for the four centralized penalty keys.

    The score_evaluator reads grade_spread / over_capacity / under_occupancy /
    min_occupancy via the centralized accessors in ``bunking.solver.penalties``,
    which use ``ConfigLoader.get_instance()``. Tests in this module install one
    of these via ``ConfigLoader.use(...)`` so the canonical reads see the same
    numeric values the local MagicMock config does (matched values keep the
    tests' magnitude assertions stable across the B1/B2/B4 centralization).
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


class TestGetSourceFields:
    """Tests for _get_source_fields helper function."""

    def test_source_field_fallback(self):
        request = {"source_field": SourceField.BUNKING_NOTES}
        result = _get_source_fields(request)
        assert result == [SourceField.BUNKING_NOTES]

    def test_age_preference_maps_to_socialize_with(self):
        request = {"request_type": "age_preference"}
        result = _get_source_fields(request)
        assert result == [SourceField.SOCIALIZE_WITH]

    def test_empty_request(self):
        request: dict[str, Any] = {}
        result = _get_source_fields(request)
        assert result == []


class TestCalculatePenalties:
    """Tests for _calculate_penalties function."""

    @pytest.fixture(autouse=True)
    def _install_canonical_loader(self):
        """Install the canonical-keys stub for the centralized accessors."""
        with ConfigLoader.use(_CanonicalKeyConfig()):  # type: ignore[arg-type]
            yield

    @pytest.fixture
    def mock_config(self):
        """Create a mock config with default penalty values.

        Includes both legacy and canonical keys at matched values so that
        tests can pass this directly to ``_calculate_penalties`` via the
        ``config=`` parameter (used for non-centralized reads such as
        ``constraint.grade_spread.max_spread`` and
        ``constraint.cabin_capacity.standard``).
        """
        config = MagicMock()
        config.get_int.side_effect = lambda key, default=0: {
            # Legacy keys (no longer read by score_evaluator)
            "penalty.grade_spread": 100,
            "penalty.over_capacity": 500,
            "constraint.cabin_occupancy.minimum": 8,
            "penalty.under_occupancy": 50,
            # Canonical keys read via centralized accessors
            "constraint.grade_spread.penalty": 100,
            "constraint.cabin_capacity.penalty": 500,
            "constraint.cabin_minimum_occupancy.penalty": 50,
            # Other keys still read via the config= parameter
            "constraint.grade_spread.max_spread": 2,
            "constraint.cabin_capacity.standard": 12,
            # First-pick boost — pinned ON so tests validate ordering, not
            # the production default. If someone flips the production default
            # to 0, test_first_requested_boost would silently revalidate the
            # wrong code path without this explicit pin.
            "objective.enable_first_boost": 1,
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

        # Under-occupancy is expected (3 campers, well below preferred=10)
        penalties = _calculate_penalties(person_to_bunk, bunk_to_persons, person_by_cm_id, bunk_by_cm_id, mock_config)

        # Under occupancy penalty expected (3 < 10 preferred)
        assert "grade_spread" not in penalties
        assert "over_capacity" not in penalties
        assert "under_occupancy" in penalties

    # Phase 2 grade-spread cleanup: removed test_grade_spread_violation —
    # the score evaluator no longer reports a "grade_spread" penalty term.
    # Solver enforces a hard MAX_UNIQUE_GRADES_PER_BUNK ceiling; if 3+ unique
    # grades land in one bunk that's a staff manual override on the bunking
    # board, surfaced by the validator's grade_spread_warning, not by score.

    # Phase 2 cabin-capacity cleanup: removed test_over_capacity_violation —
    # the score evaluator no longer reports an "over_capacity" penalty term.
    # The soft cabin_capacity path was deleted; solver enforces capacity as a
    # hard constraint at DEFAULT_BUNK_CAPACITY, so over-capacity assignments
    # cannot appear in solved scenarios.

    def test_under_occupancy_penalty(self, mock_config):
        """Test under occupancy penalty calculation.

        B5 fix: under-occupancy is charged against PREFERRED_BUNK_OCCUPANCY=10,
        not the hard minimum, so the displayed score matches what the OR-Tools
        cost path actually optimized.
        """
        person_to_bunk = {1: 100, 2: 100}
        bunk_to_persons = {100: [1, 2]}  # Only 2 campers, preferred is 10
        person_by_cm_id = {
            1: {"cm_id": 1, "grade": 5},
            2: {"cm_id": 2, "grade": 5},
        }
        bunk_by_cm_id = {100: {"cm_id": 100, "max_size": 12}}

        penalties = _calculate_penalties(person_to_bunk, bunk_to_persons, person_by_cm_id, bunk_by_cm_id, mock_config)

        # preferred 10 - occupancy 2 = 8 under preferred, 8 * 50 = 400
        assert "under_occupancy" in penalties
        assert penalties["under_occupancy"] == 400

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

    @pytest.fixture(autouse=True)
    def _install_canonical_loader(self):
        """Install the canonical-keys stub for the centralized accessors."""
        with ConfigLoader.use(_CanonicalKeyConfig()):  # type: ignore[arg-type]
            yield

    @pytest.fixture
    def mock_config(self):
        """Create a mock config with default values.

        Includes both legacy and canonical keys at matched values; the
        centralized accessor path is covered by the autouse fixture above.
        """
        config = MagicMock()

        def get_int_side_effect(key, default=0):
            values = {
                "objective.enable_diminishing_returns": 1,
                "objective.first_request_multiplier": 10,
                "objective.second_request_multiplier": 5,
                "objective.third_plus_request_multiplier": 1,
                # Pinned ON so test_first_requested_boost validates ordering,
                # not the production default. Flipping the production default
                # to 0 would otherwise silently re-validate the wrong path.
                "objective.enable_first_boost": 1,
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
            }
            return values.get(key, default)

        def get_float_side_effect(key, default=0.0):
            values = {
                "objective.source_multipliers.share_bunk_with": 1.75,
                "objective.source_multipliers.do_not_share_with": 1.5,
                "objective.source_multipliers.bunking_notes": 1.0,
                "objective.source_multipliers.internal_notes": 1.0,
                "objective.source_multipliers.socialize_preference": 0.6,
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
                "source_field": SourceField.BUNK_REQUEST_FORM,
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

    def test_first_requested_boost(self, mock_config):
        """Test that is_first_requested=True gets the 10x slot-0 multiplier.

        Priority was deleted — is_first_requested is the new signal for
        high-importance requests (the former P1 bucket). The flag's job is to
        decide WHICH request gets slot-0 when a camper has multiple satisfied
        requests; a single-request scenario can't exercise it (slot-0 always
        applies). So we pin a two-request control: flip the flag between two
        requests with different source-field multipliers, assert the slot-0
        multiplier follows the flag.
        """
        assignments = [
            {"person_cm_id": 1, "bunk_cm_id": 100},
            {"person_cm_id": 2, "bunk_cm_id": 100},
            {"person_cm_id": 3, "bunk_cm_id": 100},
        ]
        persons = [
            {"cm_id": 1, "grade": 5},
            {"cm_id": 2, "grade": 5},
            {"cm_id": 3, "grade": 5},
        ]
        bunks = [{"cm_id": 100, "max_size": 12}]

        # Two satisfied requests for person 1; different source_field multipliers
        # so the slot-0 vs slot-1 difference shows up in the score.
        # bunk_with → 1.75x, internal_notes → 1.0x.
        # If first-pick flag works, the bunk_with request lands in slot-0:
        #   slot-0: 40*1.75*10 = 700, slot-1: 40*1.0*5 = 200 → total 900.
        # If we flip the flag (internal_notes is first-pick instead):
        #   slot-0: 40*1.0*10 = 400, slot-1: 40*1.75*5 = 350 → total 750.
        bunk_with_first = [
            {
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "bunk_with",
                "source_field": SourceField.BUNK_REQUEST_FORM,
                "is_first_requested": True,
            },
            {
                "requester_id": 1,
                "requestee_id": 3,
                "request_type": "bunk_with",
                "source_field": SourceField.INTERNAL_NOTES,
                "is_first_requested": False,
            },
        ]
        internal_notes_first = [
            {**bunk_with_first[0], "is_first_requested": False},
            {**bunk_with_first[1], "is_first_requested": True},
        ]

        result_a = evaluate_scenario_score(bunk_with_first, assignments, persons, bunks, config=mock_config)
        result_b = evaluate_scenario_score(internal_notes_first, assignments, persons, bunks, config=mock_config)

        assert result_a.request_satisfaction_score == 900
        assert result_b.request_satisfaction_score == 750
        assert result_a.request_satisfaction_score > result_b.request_satisfaction_score

    def test_source_field_multiplier(self, mock_config):
        """Test that source field multipliers affect score.

        Pairs two valid (source, type) combos with distinct multipliers so the
        test exercises the same axis without relying on off-axis pairings —
        the registry rejects pairs like (socialize_with, bunk_with) which is
        a strict source pinned to age_preference (#1142 Phase 3).
        """
        share_bunk_request = [
            {
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "bunk_with",
                "source_field": SourceField.BUNK_REQUEST_FORM,  # 1.75x (share_bunk_with)
            }
        ]
        notes_request = [
            {
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "bunk_with",
                "source_field": SourceField.BUNKING_NOTES,  # 1.0x (bunking_notes)
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
        notes_result = evaluate_scenario_score(notes_request, assignments, persons, bunks, config=mock_config)

        # BUNK_REQUEST_FORM (1.75x) should score higher than BUNKING_NOTES (1.0x).
        assert share_result.request_satisfaction_score > notes_result.request_satisfaction_score

    def test_field_scores_breakdown(self, mock_config):
        """Test field-level score breakdown."""
        requests = [
            {
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "bunk_with",
                "source_field": SourceField.BUNK_REQUEST_FORM,
            },
            {
                "requester_id": 3,
                "requestee_id": 4,
                "request_type": "bunk_with",
                "source_field": SourceField.BUNKING_NOTES,
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

        assert SourceField.BUNK_REQUEST_FORM in result.field_scores
        assert SourceField.BUNKING_NOTES in result.field_scores
        assert result.field_scores[SourceField.BUNK_REQUEST_FORM]["satisfied"] == 1
        assert result.field_scores[SourceField.BUNKING_NOTES]["satisfied"] == 0

    def test_penalties_applied(self, mock_config):
        """Test that penalties are subtracted from total score.

        Phase 2 (grade_spread) deleted the grade_spread penalty line; the
        remaining soft-penalty source available in this fixture is the
        under-occupancy charge (one bunk holding 3 < PREFERRED_BUNK_OCCUPANCY).
        """
        requests = [
            {
                "requester_id": 1,
                "requestee_id": 2,
                "request_type": "bunk_with",
                "source_field": SourceField.BUNK_REQUEST_FORM,
            }
        ]
        assignments = [
            {"person_cm_id": 1, "bunk_cm_id": 100},
            {"person_cm_id": 2, "bunk_cm_id": 100},
            {"person_cm_id": 3, "bunk_cm_id": 100},
        ]
        persons = [
            {"cm_id": 1, "grade": 3},
            {"cm_id": 2, "grade": 5},
            {"cm_id": 3, "grade": 8},
        ]
        bunks = [{"cm_id": 100, "max_size": 12}]

        result = evaluate_scenario_score(requests, assignments, persons, bunks, config=mock_config)

        # Should have under-occupancy penalty (3 campers < PREFERRED_BUNK_OCCUPANCY)
        assert result.soft_penalty_score > 0
        assert "under_occupancy" in result.penalties
        assert result.total_score == result.request_satisfaction_score - result.soft_penalty_score

    def test_alternative_field_names(self, mock_config):
        """Test with alternative field names (person_id vs person_cm_id)."""
        requests = [
            {
                "requester_person_cm_id": 1,  # Alternative name
                "requested_person_cm_id": 2,  # Alternative name
                "request_type": "bunk_with",
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
            field_scores={SourceField.BUNK_REQUEST_FORM: {"total": 5, "satisfied": 4}},
            penalties={"grade_spread": 100},
        )

        assert breakdown.total_score == 1000
        assert breakdown.satisfaction_rate == 0.8
        assert SourceField.BUNK_REQUEST_FORM in breakdown.field_scores
