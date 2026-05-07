"""Verify constraint modules and evaluators read penalty config via centralized accessors.

These tests pin the *plumbing* (how the value is read), not the *math* (how the
penalty is applied to the OR-Tools cost or to the displayed score). The math is
covered by other tests (e.g. ``test_grade_spread_formula.py``).

Why this matters: in PR 3 we centralize four config reads
(`bunking.solver.penalties.{cabin_capacity_penalty,min_occupancy_penalty,
min_occupancy_threshold,grade_spread_penalty}`) so the OR-Tools constraint
modules and the post-solve evaluators cannot drift out of sync. If a future
change reads `config.get_int("constraint.cabin_capacity.penalty")` directly
instead of calling the accessor, the centralization invariant breaks. These
tests catch that by monkeypatching the accessor on the *consumer* module and
asserting it gets invoked.
"""

from __future__ import annotations

import bunking.solver.constraints.cabin_capacity as cabin_capacity_mod
import bunking.solver.constraints.cabin_occupancy as cabin_occupancy_mod
import bunking.solver.constraints.grade_spread as grade_spread_mod


def test_cabin_capacity_module_imports_centralized_accessor():
    """The constraint module must reference ``cabin_capacity_penalty`` so its
    callsite goes through the centralized read.
    """
    assert hasattr(cabin_capacity_mod, "cabin_capacity_penalty"), (
        "cabin_capacity.py must import cabin_capacity_penalty from bunking.solver.penalties"
    )


def test_cabin_occupancy_module_imports_centralized_accessors():
    """The constraint module must reference both centralized accessors."""
    assert hasattr(cabin_occupancy_mod, "min_occupancy_penalty"), (
        "cabin_occupancy.py must import min_occupancy_penalty from bunking.solver.penalties"
    )
    assert hasattr(cabin_occupancy_mod, "min_occupancy_threshold"), (
        "cabin_occupancy.py must import min_occupancy_threshold from bunking.solver.penalties"
    )


def test_grade_spread_module_imports_centralized_accessor():
    """The constraint module must reference ``grade_spread_penalty``."""
    assert hasattr(grade_spread_mod, "grade_spread_penalty"), (
        "grade_spread.py must import grade_spread_penalty from bunking.solver.penalties"
    )


def test_cabin_capacity_module_does_not_read_canonical_key_directly():
    """The constraint module must NOT contain a literal direct read of the
    canonical key; that read must come from the centralized accessor.

    Reading the source text catches the subtle regression where a developer
    keeps the import but reverts the callsite to a direct config read.
    """
    import inspect

    src = inspect.getsource(cabin_capacity_mod)
    # The accessor is named cabin_capacity_penalty(); a direct read would be
    # ctx.config.get_int("constraint.cabin_capacity.penalty", ...).
    assert 'get_int("constraint.cabin_capacity.penalty"' not in src, (
        "cabin_capacity.py must read the penalty via cabin_capacity_penalty(), not via a direct config.get_int() call."
    )


def test_cabin_occupancy_module_does_not_read_canonical_keys_directly():
    import inspect

    src = inspect.getsource(cabin_occupancy_mod)
    assert 'get_int("constraint.cabin_minimum_occupancy.penalty"' not in src, (
        "cabin_occupancy.py must read the penalty via min_occupancy_penalty(), not via a direct config.get_int() call."
    )
    # The threshold read on line ~158 is the soft-penalty read; the hard-constraint
    # read on line ~45 is also the same key. Both must use the accessor.
    direct_min_reads = src.count('get_int("constraint.cabin_minimum_occupancy.min"')
    assert direct_min_reads == 0, (
        f"cabin_occupancy.py contains {direct_min_reads} direct reads of "
        "constraint.cabin_minimum_occupancy.min — must use min_occupancy_threshold() "
        "instead."
    )


def test_grade_spread_module_does_not_read_canonical_key_directly():
    import inspect

    src = inspect.getsource(grade_spread_mod)
    assert 'get_int("constraint.grade_spread.penalty"' not in src, (
        "grade_spread.py must read the penalty via grade_spread_penalty(), not via a direct config.get_int() call."
    )


# --- Evaluator migration (Task 3.3, B1/B2/B4) ----------------------------------
# The post-solve evaluators previously read four LEGACY keys with their own
# hardcoded fallbacks (penalty.grade_spread, penalty.over_capacity,
# penalty.under_occupancy, constraint.cabin_occupancy.minimum). They must now
# read the four CANONICAL keys via the centralized accessors so the displayed
# score matches what the OR-Tools constraints actually optimized.


def test_objective_evaluator_imports_centralized_accessors():
    import bunking.solver.objective_evaluator as obj_mod

    for name in (
        "cabin_capacity_penalty",
        "min_occupancy_penalty",
        "min_occupancy_threshold",
        "grade_spread_penalty",
    ):
        assert hasattr(obj_mod, name), f"objective_evaluator.py must import {name} from bunking.solver.penalties"


def test_score_evaluator_imports_centralized_accessors():
    import bunking.solver.score_evaluator as score_mod

    for name in (
        "cabin_capacity_penalty",
        "min_occupancy_penalty",
        "min_occupancy_threshold",
        "grade_spread_penalty",
    ):
        assert hasattr(score_mod, name), f"score_evaluator.py must import {name} from bunking.solver.penalties"


def test_objective_evaluator_drops_legacy_penalty_keys():
    """The four legacy keys must no longer be read in objective_evaluator."""
    import inspect

    import bunking.solver.objective_evaluator as obj_mod

    src = inspect.getsource(obj_mod)
    for legacy_key in (
        '"penalty.grade_spread_per_grade"',
        '"penalty.over_capacity"',
        '"penalty.under_occupancy"',
        '"constraint.cabin_occupancy.minimum"',
    ):
        assert legacy_key not in src, (
            f"objective_evaluator.py still reads legacy key {legacy_key} — "
            "must read the canonical key via the centralized accessor."
        )


def test_score_evaluator_drops_legacy_penalty_keys():
    """The four legacy keys must no longer be read in score_evaluator."""
    import inspect

    import bunking.solver.score_evaluator as score_mod

    src = inspect.getsource(score_mod)
    for legacy_key in (
        '"penalty.grade_spread"',
        '"penalty.over_capacity"',
        '"penalty.under_occupancy"',
        '"constraint.cabin_occupancy.minimum"',
    ):
        assert legacy_key not in src, (
            f"score_evaluator.py still reads legacy key {legacy_key} — "
            "must read the canonical key via the centralized accessor."
        )
