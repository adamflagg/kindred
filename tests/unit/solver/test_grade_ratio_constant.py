"""Pin the single source of truth for grade_ratio + age_grade_flow.

Phase 2 (Grade Ratio domain) collapsed four PB config rows — none ever tuned at
runtime (live config DB: all four ``updated == created``) — into hardcoded
constants in ``bunking.solver.constants``:

1. ``constraint.grade_ratio.max_percentage`` → ``MAX_SINGLE_GRADE_PERCENTAGE`` (67).
   Dedups the parallel hardcode of ``67`` in ``bunking_validator.py``.
2. ``constraint.grade_ratio.penalty`` → ``GRADE_RATIO_PENALTY`` (5000).
3. ``constraint.age_grade_flow.weight`` → ``AGE_GRADE_FLOW_WEIGHT`` (300).
4. ``constraint.grade_cohesion.weight`` → DELETED outright (confirmed orphan:
   no constraint module, evaluator, validator, or frontend ever read it; only a
   dead ``loader.py`` weight-mapping entry referenced the key).

These tests make sure no consumer drifts back to reading a config key.
"""

import inspect
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SEED_MIGRATION = REPO_ROOT / "pocketbase" / "pb_migrations" / "1500000011_config.js"
SECTIONS_MIGRATION = REPO_ROOT / "pocketbase" / "pb_migrations" / "1500000012_config_sections.js"
DROP_MIGRATION = REPO_ROOT / "pocketbase" / "pb_migrations" / "1500000112_drop_grade_ratio_config.js"


def _strip_js_comments(raw: str) -> str:
    """Drop // line comments and /* */ block comments so historical breadcrumbs
    naming a removed key don't count as live references."""
    no_line = re.sub(r"//[^\n]*", "", raw)
    return re.sub(r"/\*.*?\*/", "", no_line, flags=re.DOTALL)


# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------


def test_constant_values() -> None:
    """The three hardcoded values match the never-tuned seed values."""
    from bunking.solver.constants import (
        AGE_GRADE_FLOW_WEIGHT,
        GRADE_RATIO_PENALTY,
        MAX_SINGLE_GRADE_PERCENTAGE,
    )

    assert MAX_SINGLE_GRADE_PERCENTAGE == 67
    assert GRADE_RATIO_PENALTY == 5000
    assert AGE_GRADE_FLOW_WEIGHT == 300


# --------------------------------------------------------------------------
# Solver constraint modules read the constants, not config keys
# --------------------------------------------------------------------------


def test_grade_ratio_module_imports_constants() -> None:
    """grade_ratio reads the constants, not ``get_constraint("grade_ratio", ...)``."""
    from bunking.solver.constraints import grade_ratio as module

    source = inspect.getsource(module)

    assert re.search(r"get_constraint\(\s*['\"]grade_ratio['\"]", source) is None, (
        "grade_ratio still reads grade_ratio config keys via get_constraint"
    )
    assert "MAX_SINGLE_GRADE_PERCENTAGE" in source
    assert "GRADE_RATIO_PENALTY" in source


def test_age_grade_flow_module_uses_constant() -> None:
    """age_grade_flow reads ``AGE_GRADE_FLOW_WEIGHT``, not the soft-weight accessor."""
    from bunking.solver.constraints import age_grade_flow as module

    source = inspect.getsource(module)

    assert re.search(r"get_soft_constraint_weight\(\s*['\"]age_grade_flow['\"]", source) is None, (
        "age_grade_flow still reads the config key via get_soft_constraint_weight"
    )
    assert "AGE_GRADE_FLOW_WEIGHT" in source


def test_objective_evaluator_age_grade_flow_uses_constant() -> None:
    """The post-solve evaluator mirror reads the same constant (no drift)."""
    from bunking.solver.objective_evaluator import ObjectiveEvaluator

    source = inspect.getsource(ObjectiveEvaluator._calculate_age_grade_flow)

    assert re.search(r"get_soft_constraint_weight\(\s*['\"]age_grade_flow['\"]", source) is None, (
        "objective_evaluator still reads age_grade_flow via get_soft_constraint_weight"
    )
    assert "AGE_GRADE_FLOW_WEIGHT" in source


# --------------------------------------------------------------------------
# Loader weight-mappings drop the two dead entries
# --------------------------------------------------------------------------


def test_loader_weight_mappings_drop_age_grade_flow_and_grade_cohesion() -> None:
    """No mapping for age_grade_flow / grade_cohesion — both are hardcoded/deleted.

    The method itself stays (its fall-through-and-fail contract is exercised by
    ``tests/config/test_loader.py``); only the two dead entries are removed.
    """
    from bunking.config.loader import ConfigLoader

    source = inspect.getsource(ConfigLoader.get_soft_constraint_weight)
    assert re.search(r"['\"]age_grade_flow['\"]", source) is None, (
        "loader weight_mappings still references age_grade_flow"
    )
    assert re.search(r"['\"]grade_cohesion['\"]", source) is None, (
        "loader weight_mappings still references grade_cohesion"
    )


# --------------------------------------------------------------------------
# Validator uses the constant instead of a parallel literal 67
# --------------------------------------------------------------------------


def test_validator_grade_ratio_uses_constant() -> None:
    """BunkingValidator's grade-ratio check imports the constant, not a literal 67."""
    from bunking.bunking_validator import BunkingValidator

    source = inspect.getsource(BunkingValidator._validate_grade_ratios)
    assert "MAX_SINGLE_GRADE_PERCENTAGE" in source, (
        "validator should import MAX_SINGLE_GRADE_PERCENTAGE, not hardcode 67"
    )
    assert "max_percentage = 67" not in source, "validator still hardcodes the literal 67"


# --------------------------------------------------------------------------
# Schema drops all four keys
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "deleted_key",
    [
        "constraint.grade_ratio.max_percentage",
        "constraint.grade_ratio.penalty",
        "constraint.age_grade_flow.weight",
        "constraint.grade_cohesion.weight",
    ],
)
def test_schema_drops_four_keys(deleted_key: str) -> None:
    from bunking.config.schema import CONFIG_SCHEMA

    assert deleted_key not in CONFIG_SCHEMA


# --------------------------------------------------------------------------
# Seed migration drops all four keys (live quoted entries only)
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "deleted_key",
    [
        "constraint.grade_ratio.max_percentage",
        "constraint.grade_ratio.penalty",
        "constraint.age_grade_flow.weight",
        "constraint.grade_cohesion.weight",
    ],
)
def test_seed_migration_drops_four_keys(deleted_key: str) -> None:
    cleaned = _strip_js_comments(SEED_MIGRATION.read_text(encoding="utf-8"))
    for quote in ('"', "'"):
        assert f"{quote}{deleted_key}{quote}" not in cleaned, f"seed migration still has a live {deleted_key} entry"


def test_age_grade_flow_kept_keys_absent_but_age_spread_bonus_remains() -> None:
    """Sanity: the lone-tunable from the Age Spread domain is untouched."""
    from bunking.config.schema import CONFIG_SCHEMA

    assert "constraint.age_spread.preferred_bonus" in CONFIG_SCHEMA


# --------------------------------------------------------------------------
# flow-cohesion section is removed (it had only the two now-gone keys)
# --------------------------------------------------------------------------


def test_config_sections_seed_drops_flow_cohesion() -> None:
    cleaned = _strip_js_comments(SECTIONS_MIGRATION.read_text(encoding="utf-8"))
    assert "flow-cohesion" not in cleaned, "config_sections seed still defines the flow-cohesion section (now empty)"


# --------------------------------------------------------------------------
# Drop migration cleans already-migrated DBs
# --------------------------------------------------------------------------


def test_drop_migration_exists_and_targets_keys_and_section() -> None:
    assert DROP_MIGRATION.exists(), "drop migration 1500000112_drop_grade_ratio_config.js missing"
    # Strip comments so the header docstring (which names every key) can't satisfy
    # these asserts — only executable target/seed entries should count.
    cleaned = _strip_js_comments(DROP_MIGRATION.read_text(encoding="utf-8"))
    # Subcategory + config_key targets for the four config rows.
    for sub, cfg_key in (
        ("grade_ratio", "max_percentage"),
        ("grade_ratio", "penalty"),
        ("age_grade_flow", "weight"),
        ("grade_cohesion", "weight"),
    ):
        assert re.search(
            rf'subcategory:\s*"{sub}"\s*,\s*config_key:\s*"{cfg_key}"',
            cleaned,
        ), f"drop migration does not target {sub}.{cfg_key}"
    # The empty flow-cohesion section row is removed too.
    assert 'section_key = "flow-cohesion"' in cleaned, "drop migration does not remove the flow-cohesion section row"
