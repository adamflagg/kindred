"""Verify Group A orphan config keys are absent from schema and migrations."""

from pathlib import Path

from bunking.config.schema import CONFIG_SCHEMA

REPO_ROOT = Path(__file__).resolve().parents[2]
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
