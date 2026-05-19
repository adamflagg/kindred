"""Verify constraint modules and evaluators read penalty config via centralized accessors.

These tests pin the *plumbing* (how the value is read), not the *math* (how the
penalty is applied to the OR-Tools cost or to the displayed score).

Why this matters: we centralize config reads
(`bunking.solver.penalties.{min_occupancy_penalty, min_occupancy_threshold}`)
so the OR-Tools constraint modules and the post-solve evaluators cannot drift
out of sync. If a future change reads the canonical key directly instead of
calling the accessor, the centralization invariant breaks.

(``cabin_capacity_penalty`` was removed in Phase 2 cabin-capacity cleanup.
``grade_spread_penalty`` was removed in Phase 2 grade-spread cleanup — the
soft path is gone and the hard threshold is hardcoded in
``bunking/solver/constants.py:MAX_UNIQUE_GRADES_PER_BUNK``.)
"""

from __future__ import annotations

import bunking.solver.constraints.cabin_occupancy as cabin_occupancy_mod
import bunking.solver.constraints.grade_spread as grade_spread_mod


def test_cabin_occupancy_module_imports_centralized_accessors():
    """The constraint module must reference both centralized accessors."""
    assert hasattr(cabin_occupancy_mod, "min_occupancy_penalty"), (
        "cabin_occupancy.py must import min_occupancy_penalty from bunking.solver.penalties"
    )
    assert hasattr(cabin_occupancy_mod, "min_occupancy_threshold"), (
        "cabin_occupancy.py must import min_occupancy_threshold from bunking.solver.penalties"
    )


def test_grade_spread_module_uses_hardcoded_constant():
    """Phase 2: grade_spread reads the hardcoded constant, not a penalty accessor."""
    assert hasattr(grade_spread_mod, "MAX_UNIQUE_GRADES_PER_BUNK"), (
        "grade_spread.py must import MAX_UNIQUE_GRADES_PER_BUNK from bunking.solver.constants"
    )
    # The penalty accessor was deleted with the soft path
    assert not hasattr(grade_spread_mod, "grade_spread_penalty")


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


def test_grade_spread_module_has_no_config_reads():
    """Phase 2: grade_spread is fully hardcoded; no config-key reads remain."""
    import inspect

    src = inspect.getsource(grade_spread_mod)
    assert 'get_int("constraint.grade_spread' not in src
    assert 'get_constraint("grade_spread"' not in src
    assert 'get_str("constraint.grade_spread' not in src
    assert 'get_float("constraint.grade_spread' not in src


# --- Evaluator migration (Task 3.3, B1/B2/B4) ----------------------------------
# The post-solve evaluators previously read four LEGACY keys with their own
# hardcoded fallbacks (penalty.grade_spread, penalty.over_capacity,
# penalty.under_occupancy, constraint.cabin_occupancy.minimum). They must now
# read the four CANONICAL keys via the centralized accessors so the displayed
# score matches what the OR-Tools constraints actually optimized.


def test_objective_evaluator_imports_centralized_accessors():
    import bunking.solver.objective_evaluator as obj_mod

    for name in (
        "min_occupancy_penalty",
        "min_occupancy_threshold",
    ):
        assert hasattr(obj_mod, name), f"objective_evaluator.py must import {name} from bunking.solver.penalties"


def test_score_evaluator_imports_centralized_accessors():
    import bunking.solver.score_evaluator as score_mod

    for name in (
        "min_occupancy_penalty",
        "min_occupancy_threshold",
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
        # Phase 2: cabin_capacity.{standard, max, mode, penalty} are gone —
        # ensure no straggler reads remain.
        '"constraint.cabin_capacity.standard"',
        '"constraint.cabin_capacity.max"',
        '"constraint.cabin_capacity.mode"',
        '"constraint.cabin_capacity.penalty"',
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
        # Phase 2: cabin_capacity.{standard, max, mode, penalty} are gone.
        '"constraint.cabin_capacity.standard"',
        '"constraint.cabin_capacity.max"',
        '"constraint.cabin_capacity.mode"',
        '"constraint.cabin_capacity.penalty"',
    ):
        assert legacy_key not in src, (
            f"score_evaluator.py still reads legacy key {legacy_key} — "
            "must read the canonical key via the centralized accessor."
        )
