"""Verify Group A orphan config keys are absent from schema and migrations."""

from pathlib import Path

from bunking.config.schema import CONFIG_SCHEMA

REPO_ROOT = Path(__file__).resolve().parents[3]
MAIN_MIGRATION = REPO_ROOT / "pocketbase/pb_migrations/1500000011_config.js"


def test_solver_time_limit_seconds_absent_from_schema():
    assert "solver.time_limit.seconds" not in CONFIG_SCHEMA


def test_solver_time_limit_seconds_absent_from_migration():
    text = MAIN_MIGRATION.read_text()
    assert "solver.time_limit.seconds" not in text


def test_overflow_preference_keys_absent_from_schema():
    assert "constraint.overflow_preference.penalty" not in CONFIG_SCHEMA
    assert "constraint.overflow_preference.threshold" not in CONFIG_SCHEMA


def test_soft_namespace_keys_absent_from_migration():
    text = MAIN_MIGRATION.read_text()
    assert "soft.grade_spread.penalty" not in text
    assert "soft.age_spread.penalty" not in text


def test_enabled_orphan_labels_absent_from_migration_metadata():
    text = MAIN_MIGRATION.read_text()
    # These keys should appear in NO metadata dict (friendly_name, description, section).
    for key in [
        "constraint.age_spread.enabled",
        "constraint.cabin_capacity.enabled",
        "constraint.grade_spread.enabled",
    ]:
        assert key not in text, f"orphan label {key} still in migration"


# Age Spread Phase 2: 3 keys deleted, 1 kept.
# - spread.max_age_months          → MAX_AGE_SPREAD_MONTHS constant
# - constraint.age_spread.penalty  → deleted (soft path gone)
# - constraint.age_spread.preferred_months → PREFERRED_AGE_SPREAD_MONTHS constant
# - constraint.age_spread.preferred_bonus  → KEPT (lone tunable in domain)


def test_age_spread_deleted_keys_absent_from_schema():
    assert "spread.max_age_months" not in CONFIG_SCHEMA
    assert "constraint.age_spread.penalty" not in CONFIG_SCHEMA
    assert "constraint.age_spread.preferred_months" not in CONFIG_SCHEMA


def test_age_spread_preferred_bonus_still_in_schema():
    assert "constraint.age_spread.preferred_bonus" in CONFIG_SCHEMA


def test_age_spread_deleted_keys_absent_from_migration_metadata():
    """Seed migration must not declare FRIENDLY_NAMES/TOOLTIPS/SECTION/configDef rows for the deleted keys.

    Comment lines naming the keys are OK (they document the removal). Active
    quoted dict-key declarations are not. The check below distinguishes by
    looking for the JS-string form (``'key':`` or ``"key":``).
    """
    text = MAIN_MIGRATION.read_text()
    for key in [
        "spread.max_age_months",
        "constraint.age_spread.penalty",
        "constraint.age_spread.preferred_months",
    ]:
        assert f"'{key}':" not in text, f"single-quoted key {key!r} still in migration"
        assert f'"{key}":' not in text, f"double-quoted key {key!r} still in migration"


def test_age_spread_preferred_bonus_still_in_migration():
    text = MAIN_MIGRATION.read_text()
    assert "'constraint.age_spread.preferred_bonus':" in text
    assert '"constraint.age_spread.preferred_bonus":' in text
