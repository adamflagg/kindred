"""Verify config_sections collection content and SECTION_MAPPING correctness."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SECTIONS_MIGRATION = REPO_ROOT / "pocketbase/pb_migrations/1500000012_config_sections.js"
MAIN_MIGRATION = REPO_ROOT / "pocketbase/pb_migrations/1500000011_config.js"


def test_empty_sections_removed():
    text = SECTIONS_MIGRATION.read_text()
    # Sections that have NO config keys mapped to them should not be defined.
    for section in [
        "ai-processing",
        "batch-processing",
        "penalties",
        "spread-controls",
        "system-settings",
        "ai-batch-processing",
    ]:
        assert f'"{section}"' not in text, f"empty section {section} still defined"


def test_required_sections_present():
    text = SECTIONS_MIGRATION.read_text()
    # Sections referenced in SECTION_MAPPING but missing from config_sections.
    for section in ["cabin-occupancy", "ai-request-parsing", "history-tracking"]:
        assert f'"{section}"' in text, f"required section {section} missing"


def test_ui_preferences_kept():
    text = SECTIONS_MIGRATION.read_text()
    assert '"ui-preferences"' in text  # holds tour.staleness_days


def test_historical_context_keys_in_history_tracking_section():
    text = MAIN_MIGRATION.read_text()
    # Both groups should be mapped to 'history-tracking', not 'ai-validation-rules'.
    assert "'ai.historical_context.enabled': 'history-tracking'" in text
    assert "'ai.history_tracking.enabled': 'history-tracking'" in text


def test_history_tracking_fixup_migration_exists():
    matches = list((REPO_ROOT / "pocketbase/pb_migrations").glob("*history_tracking_section_split*"))
    assert matches, "fix-up migration for history-tracking split not found"
