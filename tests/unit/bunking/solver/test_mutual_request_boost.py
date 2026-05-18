"""Tests for Stream 4 mutual-request boost (#1382).

When both directions of a bunk_with request exist (A→B AND B→A both filed
as bunk_with), the objective weight on each direction gets multiplied by
`objective.mutual_request_boost` (default 2.0). The boost is always-on and
applies to every mutual request (any slot in the diminishing-returns stack);
set the config to 1.0 to disable in-place. Only `bunk_with` is eligible —
reciprocal `not_bunk_with` is meaningless to boost.
"""

from __future__ import annotations

import inspect
from collections import defaultdict
from typing import Any

import pytest

from bunking.models import RequestType
from bunking.models_v2 import DirectBunkRequest
from bunking.solver.direct_solver import (
    BASE_REQUEST_WEIGHT,
    FIRST_REQUEST_MULTIPLIER,
    SECOND_REQUEST_MULTIPLIER,
    compute_mutual_bunk_with_pairs,
    find_mutual_pairs,
)
from bunking.solver.objective_evaluator import ObjectiveEvaluator


def _req(
    rid: str,
    requester: int,
    requested: int | None,
    request_type: RequestType,
) -> DirectBunkRequest:
    return DirectBunkRequest(
        id=rid,
        requester_person_cm_id=requester,
        requested_person_cm_id=requested,
        request_type=request_type.value,
        session_cm_id=1000,
        year=2025,
        confidence_score=1.0,
        status="resolved",
    )


def _group(reqs: list[DirectBunkRequest]) -> dict[int, list[DirectBunkRequest]]:
    out: dict[int, list[DirectBunkRequest]] = defaultdict(list)
    for r in reqs:
        out[r.requester_person_cm_id].append(r)
    return dict(out)


# ---------------------------------------------------------------------------
# find_mutual_pairs — shared helper. Takes pre-filtered directed edges, returns
# the unordered pairs that appear in both directions. Both solver-side
# (compute_mutual_bunk_with_pairs) and evaluator-side detection sit on top.
# ---------------------------------------------------------------------------


def test_find_mutual_pairs_detects_reciprocal_edges():
    assert find_mutual_pairs([(1, 2), (2, 1)]) == {frozenset({1, 2})}


def test_find_mutual_pairs_ignores_one_way_edges():
    assert find_mutual_pairs([(1, 2), (3, 4)]) == set()


def test_find_mutual_pairs_handles_multiple_disjoint_pairs():
    edges = [(1, 2), (2, 1), (3, 4), (4, 3)]
    assert find_mutual_pairs(edges) == {frozenset({1, 2}), frozenset({3, 4})}


def test_find_mutual_pairs_empty_input():
    assert find_mutual_pairs([]) == set()


def test_find_mutual_pairs_dedupes_repeated_edges():
    """Repeated directed edges collapse via set semantics; the result is the
    same as if each direction appeared once."""
    assert find_mutual_pairs([(1, 2), (1, 2), (2, 1), (2, 1)]) == {frozenset({1, 2})}


# ---------------------------------------------------------------------------
# compute_mutual_bunk_with_pairs — bunk_with-specific wrapper over find_mutual_pairs.
# ---------------------------------------------------------------------------


def test_compute_mutual_pairs_detects_reciprocal_bunk_with():
    """A→B and B→A both as bunk_with → returns {frozenset({A, B})}."""
    pairs = compute_mutual_bunk_with_pairs(
        _group(
            [
                _req("r1", 1, 2, RequestType.BUNK_WITH),
                _req("r2", 2, 1, RequestType.BUNK_WITH),
            ]
        )
    )
    assert pairs == {frozenset({1, 2})}


def test_compute_mutual_pairs_ignores_one_way():
    """A→B exists but B→A does not → empty set."""
    pairs = compute_mutual_bunk_with_pairs(_group([_req("r1", 1, 2, RequestType.BUNK_WITH)]))
    assert pairs == set()


def test_compute_mutual_pairs_ignores_not_bunk_with_reciprocals():
    """Reciprocal not_bunk_with is meaningless to boost (symmetric by intent
    and the solver penalty already treats both directions equally)."""
    pairs = compute_mutual_bunk_with_pairs(
        _group(
            [
                _req("r1", 1, 2, RequestType.NOT_BUNK_WITH),
                _req("r2", 2, 1, RequestType.NOT_BUNK_WITH),
            ]
        )
    )
    assert pairs == set()


def test_compute_mutual_pairs_does_not_pair_mixed_types():
    """A→B bunk_with paired with B→A not_bunk_with is NOT mutual.

    These two requests are in direct conflict, not in agreement; the boost
    must not apply to either.
    """
    pairs = compute_mutual_bunk_with_pairs(
        _group(
            [
                _req("r1", 1, 2, RequestType.BUNK_WITH),
                _req("r2", 2, 1, RequestType.NOT_BUNK_WITH),
            ]
        )
    )
    assert pairs == set()


def test_compute_mutual_pairs_handles_multiple_disjoint_pairs():
    """Two independent reciprocal pairs (A↔B and C↔D) → both returned."""
    pairs = compute_mutual_bunk_with_pairs(
        _group(
            [
                _req("r1", 1, 2, RequestType.BUNK_WITH),
                _req("r2", 2, 1, RequestType.BUNK_WITH),
                _req("r3", 3, 4, RequestType.BUNK_WITH),
                _req("r4", 4, 3, RequestType.BUNK_WITH),
            ]
        )
    )
    assert pairs == {frozenset({1, 2}), frozenset({3, 4})}


def test_compute_mutual_pairs_handles_self_loop_defensively():
    """A→A self-request: pathological data, must not crash and must not
    register as mutual (a single self-edge does not satisfy reciprocity)."""
    pairs = compute_mutual_bunk_with_pairs(_group([_req("r1", 1, 1, RequestType.BUNK_WITH)]))
    assert pairs == set()


def test_compute_mutual_pairs_ignores_requests_with_null_requestee():
    """Malformed bunk_with with no target → skip; don't fault."""
    pairs = compute_mutual_bunk_with_pairs(
        _group(
            [
                _req("r1", 1, None, RequestType.BUNK_WITH),
                _req("r2", 2, 1, RequestType.BUNK_WITH),
            ]
        )
    )
    assert pairs == set()


# ---------------------------------------------------------------------------
# ObjectiveEvaluator — post-solve scoring mirror of the solver's logic.
# ---------------------------------------------------------------------------


class _StubConfig:
    """Pure-Python config stub for evaluator tests."""

    def __init__(self, overrides: dict[str, Any] | None = None):
        self._values: dict[str, Any] = {
            "objective.enable_first_boost": 1,
            "objective.mutual_request_boost": 2.0,
            "objective.source_multipliers.share_bunk_with": 1.0,
            "objective.source_multipliers.do_not_share_with": 1.0,
            "objective.source_multipliers.bunking_notes": 1.0,
            "objective.source_multipliers.internal_notes": 1.0,
            "objective.source_multipliers.socialize_preference": 1.0,
        }
        if overrides:
            self._values.update(overrides)

    def get_int(self, key: str, default: int = 0) -> int:
        v = self._values.get(key, default)
        return int(v) if v is not None else default

    def get_float(self, key: str, default: float = 0.0) -> float:
        v = self._values.get(key, default)
        return float(v) if v is not None else default

    def get_str(self, key: str, default: str = "") -> str:
        v = self._values.get(key, default)
        return str(v) if v is not None else default

    def get_bool(self, key: str, default: bool = False) -> bool:
        v = self._values.get(key, default)
        return bool(v) if v is not None else default

    def get(self, key: str) -> Any:
        return self._values.get(key)


def _dict_req(
    requester: int,
    requestee: int,
    request_type: str = "bunk_with",
    is_first_requested: bool = False,
) -> dict[str, Any]:
    """Build the dict shape the evaluator consumes."""
    return {
        "id": f"r{requester}_{requestee}",
        "requester_id": requester,
        "requestee_id": requestee,
        "request_type": request_type,
        "is_first_requested": is_first_requested,
        "source_field": None,
        "csv_source_fields": None,
    }


@pytest.fixture
def evaluator() -> ObjectiveEvaluator:
    return ObjectiveEvaluator(config=_StubConfig())  # type: ignore[arg-type]


def test_evaluator_mutual_bunk_with_doubles_weight(evaluator):
    """A↔B reciprocal bunk_with, both satisfied (in the same bunk).
    Each direction's weight = BASE × source(1.0) × mutual(2.0) × diminishing[0](FIRST=10).
    """
    assignments = {1: 100, 2: 100}  # both in bunk 100
    requests = [_dict_req(1, 2), _dict_req(2, 1)]
    person_by_cm_id = {1: {"campminder_person_id": 1}, 2: {"campminder_person_id": 2}}

    score, _ = evaluator._calculate_request_satisfaction(assignments, requests, person_by_cm_id)

    expected_per_request = int(BASE_REQUEST_WEIGHT * 1.0 * 2.0 * FIRST_REQUEST_MULTIPLIER)
    assert score == 2 * expected_per_request


def test_evaluator_one_way_bunk_with_no_boost(evaluator):
    """A→B but no B→A. Both satisfied (B happens to be in A's bunk).
    A's weight = BASE × source × 1.0 (no mutual) × FIRST.
    B's request doesn't exist, so only A's weight counted.
    """
    assignments = {1: 100, 2: 100}
    requests = [_dict_req(1, 2)]
    person_by_cm_id = {1: {"campminder_person_id": 1}, 2: {"campminder_person_id": 2}}

    score, _ = evaluator._calculate_request_satisfaction(assignments, requests, person_by_cm_id)

    expected = int(BASE_REQUEST_WEIGHT * 1.0 * 1.0 * FIRST_REQUEST_MULTIPLIER)
    assert score == expected


def test_evaluator_not_bunk_with_never_boosts(evaluator):
    """Reciprocal not_bunk_with does NOT get the boost (only bunk_with does).
    Both satisfied (placed in different bunks).
    """
    assignments = {1: 100, 2: 200}  # different bunks
    requests = [
        _dict_req(1, 2, request_type="not_bunk_with"),
        _dict_req(2, 1, request_type="not_bunk_with"),
    ]
    person_by_cm_id = {1: {"campminder_person_id": 1}, 2: {"campminder_person_id": 2}}

    score, _ = evaluator._calculate_request_satisfaction(assignments, requests, person_by_cm_id)

    expected_per_request = int(BASE_REQUEST_WEIGHT * 1.0 * 1.0 * FIRST_REQUEST_MULTIPLIER)
    assert score == 2 * expected_per_request


def test_evaluator_mutual_boost_applies_to_every_slot(evaluator):
    """A has two requests: A→B (mutual with B→A) and A→C (one-way).
    Both satisfied. With enable_first_boost=true and is_first_requested=true
    on A→B, A→B lands in slot 0 (FIRST=10) and A→C in slot 1 (SECOND=5).

    A→B: BASE × source × mutual(2.0) × FIRST(10) = mutual-boosted slot 0.
    A→C: BASE × source × 1.0 (no mutual) × SECOND(5) = one-way slot 1.
    B→A: BASE × source × mutual(2.0) × FIRST(10) (B's only request).
    Total = (40 × 2 × 10) + (40 × 1 × 5) + (40 × 2 × 10) = 800 + 200 + 800 = 1800.
    """
    assignments = {1: 100, 2: 100, 3: 100}  # all in bunk 100
    requests = [
        _dict_req(1, 2, is_first_requested=True),  # A→B mutual, first-pick
        _dict_req(1, 3),  # A→C one-way
        _dict_req(2, 1, is_first_requested=True),  # B→A reciprocal, first-pick
    ]
    person_by_cm_id = {
        1: {"campminder_person_id": 1},
        2: {"campminder_person_id": 2},
        3: {"campminder_person_id": 3},
    }

    score, _ = evaluator._calculate_request_satisfaction(assignments, requests, person_by_cm_id)

    a_b = int(BASE_REQUEST_WEIGHT * 1.0 * 2.0 * FIRST_REQUEST_MULTIPLIER)
    a_c = int(BASE_REQUEST_WEIGHT * 1.0 * 1.0 * SECOND_REQUEST_MULTIPLIER)
    b_a = int(BASE_REQUEST_WEIGHT * 1.0 * 2.0 * FIRST_REQUEST_MULTIPLIER)
    assert score == a_b + a_c + b_a


def test_evaluator_disabled_boost_via_config_1():
    """Setting objective.mutual_request_boost=1.0 disables the boost without
    removing the code path. Mutual pair scores as if non-mutual."""
    ev = ObjectiveEvaluator(
        config=_StubConfig({"objective.mutual_request_boost": 1.0}),  # type: ignore[arg-type]
    )
    assignments = {1: 100, 2: 100}
    requests = [_dict_req(1, 2), _dict_req(2, 1)]
    person_by_cm_id = {1: {"campminder_person_id": 1}, 2: {"campminder_person_id": 2}}

    score, _ = ev._calculate_request_satisfaction(assignments, requests, person_by_cm_id)
    # No mutual boost — each direction is just BASE × source × FIRST.
    expected_per_request = int(BASE_REQUEST_WEIGHT * 1.0 * 1.0 * FIRST_REQUEST_MULTIPLIER)
    assert score == 2 * expected_per_request


# ---------------------------------------------------------------------------
# Solver source inspection — light guard that the new config key is consumed
# in add_objective. Full integration coverage lives in test_score_evaluator.py
# golden tests.
# ---------------------------------------------------------------------------


def test_add_objective_consumes_mutual_request_boost():
    """add_objective() must read objective.mutual_request_boost from config
    and reference the precomputed mutual-pair set. Source inspection only —
    full integration tested in objective end-to-end fixtures."""
    from bunking.solver import direct_solver

    src = inspect.getsource(direct_solver.DirectBunkingSolver.add_objective)
    assert "objective.mutual_request_boost" in src, "add_objective must read the mutual_request_boost config key"
    assert "compute_mutual_bunk_with_pairs" in src or "mutual_bunk_with_pairs" in src, (
        "add_objective must use the precomputed mutual pairs set"
    )


# ---------------------------------------------------------------------------
# score_evaluator.py — third evaluator path, must mirror the same boost as
# the solver (else baseline-regression goldens silently drift on reciprocal
# pairs). The boost is "always-on" so it has to land here too.
# ---------------------------------------------------------------------------


class _ScoreEvalConfig:
    """Config stub for score_evaluator tests. Keeps source multipliers at 1.0
    so the test math reduces to BASE × mutual × slot."""

    def __init__(self, mutual_boost: float = 2.0):
        self._values: dict[str, Any] = {
            "objective.enable_first_boost": 1,
            "objective.mutual_request_boost": mutual_boost,
            "objective.source_multipliers.share_bunk_with": 1.0,
            "objective.source_multipliers.do_not_share_with": 1.0,
            "objective.source_multipliers.bunking_notes": 1.0,
            "objective.source_multipliers.internal_notes": 1.0,
            "objective.source_multipliers.socialize_preference": 1.0,
            "constraint.grade_spread.max_spread": 99,
            "constraint.grade_spread.penalty": 0,
            "constraint.cabin_minimum_occupancy.penalty": 0,
            "constraint.cabin_capacity.penalty": 0,
            "constraint.cabin_capacity.standard": 12,
        }

    def get_int(self, key: str, default: int = 0) -> int:
        v = self._values.get(key, default)
        return int(v) if v is not None else default

    def get_float(self, key: str, default: float = 0.0) -> float:
        v = self._values.get(key, default)
        return float(v) if v is not None else default

    def get_str(self, key: str, default: str = "") -> str:
        v = self._values.get(key, default)
        return str(v) if v is not None else default

    def get_bool(self, key: str, default: bool = False) -> bool:
        v = self._values.get(key, default)
        return bool(v) if v is not None else default


def _se_req(requester: int, requestee: int, request_type: str = "bunk_with") -> dict[str, Any]:
    return {
        "id": f"r{requester}_{requestee}",
        "requester_id": requester,
        "requestee_id": requestee,
        "request_type": request_type,
        "is_first_requested": True,
        "source_field": None,
    }


def test_score_evaluator_mutual_bunk_with_doubles_weight():
    """score_evaluator must apply the mutual boost — without this the third
    evaluator path silently undercounts mutual pairs vs. the solver and
    objective_evaluator. Both A↔B in the same bunk; default boost 2.0."""
    from bunking.solver.score_evaluator import evaluate_scenario_score

    requests = [_se_req(1, 2), _se_req(2, 1)]
    assignments = [{"person_cm_id": 1, "bunk_cm_id": 100}, {"person_cm_id": 2, "bunk_cm_id": 100}]
    persons = [{"cm_id": 1, "grade": 5}, {"cm_id": 2, "grade": 5}]
    bunks = [{"cm_id": 100, "max_size": 12}]
    result = evaluate_scenario_score(requests, assignments, persons, bunks, config=_ScoreEvalConfig())

    expected_per_request = int(BASE_REQUEST_WEIGHT * 1.0 * 2.0 * FIRST_REQUEST_MULTIPLIER)
    assert result.request_satisfaction_score == 2 * expected_per_request


def test_score_evaluator_one_way_bunk_with_no_boost():
    """One-way request gets no boost — baseline slot-0 weight only."""
    from bunking.solver.score_evaluator import evaluate_scenario_score

    requests = [_se_req(1, 2)]
    assignments = [{"person_cm_id": 1, "bunk_cm_id": 100}, {"person_cm_id": 2, "bunk_cm_id": 100}]
    persons = [{"cm_id": 1, "grade": 5}, {"cm_id": 2, "grade": 5}]
    bunks = [{"cm_id": 100, "max_size": 12}]
    result = evaluate_scenario_score(requests, assignments, persons, bunks, config=_ScoreEvalConfig())

    expected = int(BASE_REQUEST_WEIGHT * 1.0 * 1.0 * FIRST_REQUEST_MULTIPLIER)
    assert result.request_satisfaction_score == expected


def test_score_evaluator_disabled_boost_via_config_1():
    """objective.mutual_request_boost=1.0 disables the boost in-place."""
    from bunking.solver.score_evaluator import evaluate_scenario_score

    requests = [_se_req(1, 2), _se_req(2, 1)]
    assignments = [{"person_cm_id": 1, "bunk_cm_id": 100}, {"person_cm_id": 2, "bunk_cm_id": 100}]
    persons = [{"cm_id": 1, "grade": 5}, {"cm_id": 2, "grade": 5}]
    bunks = [{"cm_id": 100, "max_size": 12}]
    result = evaluate_scenario_score(requests, assignments, persons, bunks, config=_ScoreEvalConfig(mutual_boost=1.0))

    expected_per_request = int(BASE_REQUEST_WEIGHT * 1.0 * 1.0 * FIRST_REQUEST_MULTIPLIER)
    assert result.request_satisfaction_score == 2 * expected_per_request


def test_score_evaluator_not_bunk_with_never_boosts():
    """Reciprocal not_bunk_with must NOT be boosted (symmetric by intent)."""
    from bunking.solver.score_evaluator import evaluate_scenario_score

    requests = [_se_req(1, 2, "not_bunk_with"), _se_req(2, 1, "not_bunk_with")]
    # Place in different bunks so both not_bunk_with are satisfied.
    assignments = [{"person_cm_id": 1, "bunk_cm_id": 100}, {"person_cm_id": 2, "bunk_cm_id": 200}]
    persons = [{"cm_id": 1, "grade": 5}, {"cm_id": 2, "grade": 5}]
    bunks = [{"cm_id": 100, "max_size": 12}, {"cm_id": 200, "max_size": 12}]
    result = evaluate_scenario_score(requests, assignments, persons, bunks, config=_ScoreEvalConfig())

    expected_per_request = int(BASE_REQUEST_WEIGHT * 1.0 * 1.0 * FIRST_REQUEST_MULTIPLIER)
    assert result.request_satisfaction_score == 2 * expected_per_request
