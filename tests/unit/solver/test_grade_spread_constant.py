"""Pin the single source of truth for grade_spread.

Phase 2 collapsed four sources of the ``max unique grades per bunk`` value into
``bunking.solver.constants.MAX_UNIQUE_GRADES_PER_BUNK``:

1. ``spread.max_grade`` (PB config row, sync-side filter) — deleted.
2. ``constraint.grade_spread.max_spread`` (phantom; solver + evaluator reads,
   never seeded) — replaced with the constant.
3. ``constraint.grade_spread.mode`` + ``constraint.grade_spread.penalty`` (soft
   path) — both deleted; the soft constraint code path is gone.
4. ``BunkingValidator.max_grade_spread`` (parallel hardcode of literal ``2``) —
   replaced with the constant.

These tests make sure no consumer drifts back to reading a config key.
"""

from __future__ import annotations

import inspect

import pytest


def test_constant_value_is_two() -> None:
    """MAX_UNIQUE_GRADES_PER_BUNK is 2 — that's the staff-set ceiling."""
    from bunking.solver.constants import MAX_UNIQUE_GRADES_PER_BUNK

    assert MAX_UNIQUE_GRADES_PER_BUNK == 2


def test_solver_constraint_module_imports_constant() -> None:
    """grade_spread module reads the constant, not the phantom config key."""
    from bunking.solver.constraints import grade_spread as module

    source = inspect.getsource(module)

    # No phantom key reads. The four phantom reads were at:
    # - add_grade_spread_constraints (hard path)
    # - add_grade_spread_soft_constraint (soft path)
    # - GradeCompatibilityImpossibility._max_gap (pre-flight pair detector)
    # - objective_evaluator + score_evaluator mirrors
    assert "constraint.grade_spread.max_spread" not in source, (
        "phantom key constraint.grade_spread.max_spread is still referenced"
    )
    assert 'get_constraint("grade_spread"' not in source, (
        "grade_spread module still reads grade_spread config keys via get_constraint"
    )

    # The constant must be imported (so callers can grep the constraint module
    # and find the single source of truth).
    assert "MAX_UNIQUE_GRADES_PER_BUNK" in source


def test_soft_constraint_path_is_deleted() -> None:
    """The soft path is gone; only the hard constraint remains."""
    from bunking.solver.constraints import grade_spread as module

    assert not hasattr(module, "add_grade_spread_soft_constraint"), (
        "add_grade_spread_soft_constraint should have been deleted with the soft path"
    )


def test_grade_spread_penalty_accessor_is_deleted() -> None:
    """penalties.grade_spread_penalty has no consumer after the soft-path delete."""
    from bunking.solver import penalties

    assert not hasattr(penalties, "grade_spread_penalty"), (
        "grade_spread_penalty accessor should be deleted with the soft path"
    )


def test_loader_weight_mapping_drops_grade_spread() -> None:
    """No mapping for grade_spread in get_soft_constraint_weight — soft path is gone."""
    from bunking.config.loader import ConfigLoader

    source = inspect.getsource(ConfigLoader.get_soft_constraint_weight)
    assert '"grade_spread"' not in source, "loader weight_mappings still references grade_spread — soft path is dead"


def test_evaluator_grade_spread_mirror_is_deleted() -> None:
    """objective_evaluator no longer mirrors the soft grade_spread penalty."""
    from bunking.solver import objective_evaluator

    assert not hasattr(objective_evaluator.ObjectiveEvaluator, "_calculate_grade_spread_penalty"), (
        "_calculate_grade_spread_penalty mirror should be deleted with the soft path"
    )


def test_score_evaluator_grade_spread_b3_block_is_deleted() -> None:
    """score_evaluator's B3-fix block at lines 260-281 is obsolete dead weight."""
    from bunking.solver import score_evaluator

    source = inspect.getsource(score_evaluator._calculate_penalties)
    # No live code that registers a grade_spread penalty key on the dict
    assert 'penalties["grade_spread"]' not in source
    assert "penalties['grade_spread']" not in source
    # No active config-key read either
    assert "constraint.grade_spread" not in source


def test_validator_imports_constant() -> None:
    """BunkingValidator uses the constant, not a literal 2."""
    from bunking.bunking_validator import BunkingValidator
    from bunking.solver.constants import MAX_UNIQUE_GRADES_PER_BUNK

    validator = BunkingValidator()
    assert validator.max_grade_spread == MAX_UNIQUE_GRADES_PER_BUNK


def test_orchestrator_uses_constant_for_spread_filter() -> None:
    """Sync-time spread filter reads the constant, not the deleted config row."""
    from bunking.sync.bunk_request_processor.orchestrator import orchestrator

    source = inspect.getsource(orchestrator)
    assert "spread.max_grade" not in source, (
        "orchestrator still reads spread.max_grade config key — should use the constant"
    )
    assert "MAX_UNIQUE_GRADES_PER_BUNK" in source, "orchestrator must import the constant for the spread filter"


def test_schema_drops_three_grade_spread_keys() -> None:
    """Schema no longer carries the deleted grade_spread / spread.max_grade keys."""
    from bunking.config.schema import CONFIG_SCHEMA

    assert "spread.max_grade" not in CONFIG_SCHEMA
    assert "constraint.grade_spread.mode" not in CONFIG_SCHEMA
    assert "constraint.grade_spread.penalty" not in CONFIG_SCHEMA


@pytest.mark.parametrize(
    "deleted_key",
    [
        "spread.max_grade",
        "constraint.grade_spread.mode",
        "constraint.grade_spread.penalty",
    ],
)
def test_seed_migration_drops_deleted_keys(deleted_key: str) -> None:
    """Seed migration no longer has live string-keyed entries for the deleted keys.

    Strip JS line-comments first so historical mentions in ``// removed in ...``
    breadcrumbs don't trip the check. The intent is "no live dict entries", not
    "the string can never appear in a comment".
    """
    import re
    from pathlib import Path

    repo_root = Path(__file__).resolve().parents[3]
    seed_path = repo_root / "pocketbase" / "pb_migrations" / "1500000011_config.js"
    raw = seed_path.read_text(encoding="utf-8")

    # Remove single-line JS comments (// ...) so commented-out references don't
    # count. Block comments (/* */) shouldn't be in this file but we strip them
    # for completeness.
    no_line_comments = re.sub(r"//[^\n]*", "", raw)
    cleaned = re.sub(r"/\*.*?\*/", "", no_line_comments, flags=re.DOTALL)

    for quote in ('"', "'"):
        live = f"{quote}{deleted_key}{quote}"
        assert live not in cleaned, f"seed migration still has a live {live} entry"


def test_drop_migration_uses_null_subcategory_for_two_part_key() -> None:
    """The drop migration must filter / reseed ``spread.max_grade`` with NULL,
    not empty string.

    The seed migration stores 2-part keys with ``subcategory = NULL`` (see
    ``transformKey`` + the ``subcategory ? ... : subcategory = null`` filter
    pattern at the bottom of ``1500000011_config.js``). In SQLite,
    ``column = ""`` does NOT match ``NULL``, so filtering on ``""`` leaves the
    row stranded on up-migrate and breaks the idempotency check + reseed on
    down-migrate.
    """
    import re
    from pathlib import Path

    repo_root = Path(__file__).resolve().parents[3]
    drop_path = repo_root / "pocketbase" / "pb_migrations" / "1500000105_drop_grade_spread_config.js"
    raw = drop_path.read_text(encoding="utf-8")

    # Strip JS comments so the prose explanation of the bug doesn't count.
    no_line_comments = re.sub(r"//[^\n]*", "", raw)
    cleaned = re.sub(r"/\*.*?\*/", "", no_line_comments, flags=re.DOTALL)

    assert 'subcategory: ""' not in cleaned, (
        'drop migration uses subcategory: "" for a 2-part key — should be null. '
        'Seed stores spread.max_grade with subcategory=NULL; "" does not match NULL.'
    )
    assert 'subcategory = ""' not in cleaned, (
        'drop migration filter uses subcategory = "" — SQLite does not match NULL with "". '
        "Use ``subcategory = null`` (or build the filter conditionally) for 2-part keys."
    )
