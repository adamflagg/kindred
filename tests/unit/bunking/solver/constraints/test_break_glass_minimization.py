"""Unit tests for the break-glass lexicographic penalty module (Stream D).

Two layers of correctness are exercised:

1. **Arithmetic dominance** — ``compute_break_glass_weights`` must return weights
   where each lex level strictly dominates the *maximum possible magnitude* of
   every lower level combined. The pivotal case is ``W_L2``: total-unmet (L3) is
   bounded by the number of sat-var-bearing **requests** (``R_sat``), NOT by the
   camper count. A regression test pins the ``sat_var_count > n_persons`` case
   that the original ``(n_persons + 1)`` draft formula would silently break.

2. **Behavioral wiring** — building a tiny CP-SAT model, calling
   ``add_break_glass_penalties``, then ``Maximize``-ing the terms must drive every
   slack toward its non-penalized value (mso_unmet→0, sat_var→1), proving the
   terms are negated; and a forced-loss model must prefer paying the smaller L3
   penalty over the larger L1 penalty, proving the lex order collapses correctly.
"""

from dataclasses import dataclass, field
from typing import Any

import pytest
from ortools.sat.python import cp_model

from bunking.models_v2 import DirectBunkRequest
from bunking.solver.constraints.break_glass_minimization import (
    W_L4_OVERFLOW,
    add_break_glass_penalties,
    compute_break_glass_weights,
)


# ----------------------------------------------------------------------------
# Arithmetic dominance — the core lexicographic proof.
# ----------------------------------------------------------------------------
class TestComputeBreakGlassWeights:
    def test_l3_dominates_max_overflow(self):
        """W_L3 must strictly exceed the maximum L4 (overflow) contribution.

        Max overflow magnitude == W_L4_OVERFLOW * n_bunks (every bunk overflowed).
        """
        n_persons, n_bunks, sat_var_count = 150, 12, 600
        _, _, w_l3 = compute_break_glass_weights(n_persons, n_bunks, sat_var_count)
        assert w_l3 > W_L4_OVERFLOW * n_bunks

    def test_l2_dominates_max_total_unmet_with_more_requests_than_campers(self):
        """W_L2 must dominate max L3 == W_L3 * sat_var_count.

        REGRESSION for the weight-bound fix: with sat_var_count > n_persons the
        original draft formula ``W_L2 = W_L3 * (n_persons + 1)`` would be too
        small (W_L3 * 4 < W_L3 * 20), letting an L3 sum out-weigh a single L2
        unit and breaking the lex order. The correct ``(sat_var_count + 1)``
        formula must dominate.
        """
        n_persons, n_bunks, sat_var_count = 3, 2, 20  # sat_var_count >> n_persons
        _, w_l2, w_l3 = compute_break_glass_weights(n_persons, n_bunks, sat_var_count)
        # L2 unit must out-weigh the worst-case L3 sum.
        assert w_l2 > w_l3 * sat_var_count
        # And explicitly: the buggy person-count formula would have failed here.
        buggy_w_l2 = w_l3 * (n_persons + 1)
        assert buggy_w_l2 <= w_l3 * sat_var_count  # the bug: too small to dominate

    def test_l1_dominates_max_impacted(self):
        """W_L1 must dominate max L2 == W_L2 * n_persons (all campers impacted)."""
        n_persons, n_bunks, sat_var_count = 150, 12, 600
        w_l1, w_l2, _ = compute_break_glass_weights(n_persons, n_bunks, sat_var_count)
        assert w_l1 > w_l2 * n_persons

    def test_int64_guard_holds_for_large_realistic_case(self):
        """A large-but-realistic roster stays well within signed int64."""
        n_persons, n_bunks, sat_var_count = 200, 20, 800
        w_l1, _, _ = compute_break_glass_weights(n_persons, n_bunks, sat_var_count)
        # The dominant objective term is W_L1 * (max MSO losses) ~= W_L1 * n_persons.
        assert w_l1 * n_persons < 2**62

    def test_int64_guard_trips_on_absurd_inputs(self):
        """The assertion must actually fire when the dominant term overflows."""
        with pytest.raises(AssertionError):
            # Astronomically large counts blow past 2**62.
            compute_break_glass_weights(10**6, 10**6, 10**6)


# ----------------------------------------------------------------------------
# Behavioral wiring — signs and lex preference via a real solve.
# ----------------------------------------------------------------------------
@dataclass
class _StubCtx:
    """Lightweight stand-in exposing exactly the attributes the builder reads."""

    model: cp_model.CpModel
    person_ids: list[int]
    bunks: list[Any]
    requests_by_person: dict[int, list[DirectBunkRequest]]
    request_satisfied_vars: dict[str, cp_model.IntVar] = field(default_factory=dict)
    break_glass_mso_unmet_vars: dict[int, cp_model.IntVar] = field(default_factory=dict)


def _make_request(req_id: str, cm_id: int) -> DirectBunkRequest:
    return DirectBunkRequest(
        id=req_id,
        requester_person_cm_id=cm_id,
        request_type="bunk_with",
        session_cm_id=1000001,
        year=2026,
    )


class TestAddBreakGlassPenaltiesBehavior:
    def test_maximizer_drives_all_slacks_to_zero_when_unconstrained(self):
        """Unconstrained, a maximizer sets mso_unmet=0 and sat_vars=1.

        Proves the appended terms are NEGATIVE: a maximizer avoids paying them.
        """
        model = cp_model.CpModel()
        sat_a = model.NewBoolVar("sat_a")
        sat_b = model.NewBoolVar("sat_b")
        mso = model.NewBoolVar("mso_unmet")

        ctx = _StubCtx(
            model=model,
            person_ids=[1001, 1002],
            bunks=[object(), object()],  # only len() is read
            requests_by_person={
                1001: [_make_request("r-a", 1001)],
                1002: [_make_request("r-b", 1002)],
            },
            request_satisfied_vars={"r-a": sat_a, "r-b": sat_b},
            break_glass_mso_unmet_vars={1001: mso},
        )

        terms: list[Any] = []
        add_break_glass_penalties(ctx, terms)  # type: ignore[arg-type]  # _StubCtx duck-types the attrs read
        assert len(terms) == 3  # L1 + L2 + L3 all present

        model.Maximize(sum(terms))
        solver = cp_model.CpSolver()
        status = solver.Solve(model)
        assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        # No penalties paid: every slack at its happy value, objective == 0.
        assert solver.Value(sat_a) == 1
        assert solver.Value(sat_b) == 1
        assert solver.Value(mso) == 0
        assert solver.ObjectiveValue() == 0

    def test_prefers_paying_smaller_l3_loss_over_larger_l1_loss(self):
        """Forced to lose exactly one of {an MSO (L1)} XOR {a request (L3)},
        the maximizer pays the cheaper L3 penalty and keeps the MSO.

        This proves the lexicographic weight ordering: a single L1 loss is
        strictly more expensive than any number of L3 losses, so when the two
        are mutually exclusive the solver sacrifices L3.
        """
        model = cp_model.CpModel()
        sat = model.NewBoolVar("sat")  # request satisfaction (L3 axis)
        mso = model.NewBoolVar("mso_unmet")  # 1 == MSO lost (L1 axis)
        unmet = model.NewBoolVar("unmet")  # 1 == request unmet
        model.Add(unmet == 1 - sat)
        # Exactly one of {request unmet, MSO lost} must occur — they are mutually
        # exclusive and one is unavoidable.
        model.Add(unmet + mso == 1)

        ctx = _StubCtx(
            model=model,
            person_ids=[1001],
            bunks=[object()],
            requests_by_person={1001: [_make_request("r-1", 1001)]},
            request_satisfied_vars={"r-1": sat},
            break_glass_mso_unmet_vars={1001: mso},
        )

        terms: list[Any] = []
        add_break_glass_penalties(ctx, terms)  # type: ignore[arg-type]  # _StubCtx duck-types the attrs read
        model.Maximize(sum(terms))
        solver = cp_model.CpSolver()
        status = solver.Solve(model)
        assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
        # Cheaper to lose the request (L3) than the MSO (L1).
        assert solver.Value(mso) == 0  # MSO preserved
        assert solver.Value(sat) == 0  # request sacrificed

    def test_age_pref_only_mso_loser_counts_as_impacted(self):
        """A camper with NO sat-var-bearing requests but a lost MSO (age-pref
        case) is still counted as impacted via the MSO-loss var in the L2 OR."""
        model = cp_model.CpModel()
        mso = model.NewBoolVar("mso_unmet")

        ctx = _StubCtx(
            model=model,
            person_ids=[1001],
            bunks=[object()],
            requests_by_person={1001: []},  # no sat-var-bearing requests
            request_satisfied_vars={},
            break_glass_mso_unmet_vars={1001: mso},
        )

        terms: list[Any] = []
        add_break_glass_penalties(ctx, terms)  # type: ignore[arg-type]  # _StubCtx duck-types the attrs read
        # L1 (mso) and L2 (impacted) present; L3 absent (no unmet terms).
        assert len(terms) == 2
        # The impacted var must exist in the model (proves OR included the MSO).
        var_names = {model.proto.variables[i].name for i in range(len(model.proto.variables))}
        assert any(n.startswith("bg_impacted_") for n in var_names)
