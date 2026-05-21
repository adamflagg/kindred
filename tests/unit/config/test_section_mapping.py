"""Verify config_sections collection content and SECTION_MAPPING correctness."""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
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
    # AI sections (ai-request-parsing, history-tracking, etc.) deleted in the
    # AI Config (Unified) Phase 2 cleanup.
    for section in ["cabin-occupancy"]:
        assert f'"{section}"' in text, f"required section {section} missing"


def test_ai_sections_removed():
    """AI-specific sections were deleted in the AI Config (Unified) Phase 2
    cleanup along with all 97 `ai.*` config rows. Guards against re-adding
    them by accident."""
    sections_text = SECTIONS_MIGRATION.read_text()
    main_text = MAIN_MIGRATION.read_text()
    for section in [
        "ai-model-settings",
        "ai-confidence-thresholds",
        "ai-name-matching",
        "ai-confidence-scoring",
        "ai-validation-rules",
        "ai-request-parsing",
        "history-tracking",
    ]:
        assert f'section_key: "{section}"' not in sections_text, (
            f"AI section {section} should be deleted from config_sections seed"
        )
        # The SECTION_MAPPING entries in 1500000011_config.js should not reference these sections.
        assert f"'{section}'" not in main_text, f"SECTION_MAPPING in 1500000011_config.js still references {section}"
