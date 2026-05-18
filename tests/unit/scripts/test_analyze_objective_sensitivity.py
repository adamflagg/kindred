"""Tests for the objective-sensitivity analysis script.

Locks in the arithmetic that drives the analysis. If `BASE_REQUEST_WEIGHT`,
slot multipliers, source multipliers, the mutual boost, or any soft-constraint
penalty changes, these tests fail and force a corresponding update to
`docs/reference/objective-sensitivity.md`.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).parents[3] / "scripts" / "analyze_objective_sensitivity.py"

spec = importlib.util.spec_from_file_location("analyze_objective_sensitivity", SCRIPT_PATH)
assert spec is not None
assert spec.loader is not None
aos = importlib.util.module_from_spec(spec)
sys.modules["analyze_objective_sensitivity"] = aos
spec.loader.exec_module(aos)


# ---------------------------------------------------------------------------
# Per-request weight arithmetic
# ---------------------------------------------------------------------------


def test_request_weight_mp_bunk_with_mutual_first_pick() -> None:
    """MP bunk_with at slot 0 with mutual boost: 40 × 1.5 × 2.0 × 10 = 1200."""
    cfg = aos.ObjectiveConfig()
    assert aos.request_weight("bunk_with", slot=0, mutual=True, config=cfg) == 1200


def test_request_weight_mp_bunk_with_one_way_first_pick() -> None:
    """MP bunk_with at slot 0, one-directional: 40 × 1.5 × 1.0 × 10 = 600."""
    cfg = aos.ObjectiveConfig()
    assert aos.request_weight("bunk_with", slot=0, mutual=False, config=cfg) == 600


def test_request_weight_mp_bunk_with_one_way_second() -> None:
    """MP bunk_with at slot 1, one-directional: 40 × 1.5 × 1.0 × 5 = 300."""
    cfg = aos.ObjectiveConfig()
    assert aos.request_weight("bunk_with", slot=1, mutual=False, config=cfg) == 300


def test_request_weight_mp_bunk_with_one_way_third_plus() -> None:
    """MP bunk_with at slot 2+, one-directional: 40 × 1.5 × 1.0 × 1 = 60."""
    cfg = aos.ObjectiveConfig()
    assert aos.request_weight("bunk_with", slot=2, mutual=False, config=cfg) == 60
    # Slot 5 still caps at the third+ multiplier (1):
    assert aos.request_weight("bunk_with", slot=5, mutual=False, config=cfg) == 60


def test_request_weight_mp_bunk_with_mutual_second() -> None:
    """MP bunk_with at slot 1 with mutual boost: 40 × 1.5 × 2.0 × 5 = 600."""
    cfg = aos.ObjectiveConfig()
    assert aos.request_weight("bunk_with", slot=1, mutual=True, config=cfg) == 600


def test_request_weight_socialize_with_first_pick() -> None:
    """IMP socialize_with at slot 0: 40 × 0.6 × 1.0 × 10 = 240."""
    cfg = aos.ObjectiveConfig()
    # socialize_with cannot be mutual-boosted (boost is bunk_with only)
    assert aos.request_weight("socialize_with", slot=0, mutual=False, config=cfg) == 240


def test_request_weight_mutual_boost_only_applies_to_bunk_with() -> None:
    """mutual=True on socialize_with must NOT apply the boost — boost is bunk_with only."""
    cfg = aos.ObjectiveConfig()
    boosted = aos.request_weight("socialize_with", slot=0, mutual=True, config=cfg)
    unboosted = aos.request_weight("socialize_with", slot=0, mutual=False, config=cfg)
    assert boosted == unboosted == 240


def test_request_weight_not_bunk_with_first_pick() -> None:
    """STAFF not_bunk_with at slot 0: 40 × 1.5 × 1.0 × 10 = 600."""
    cfg = aos.ObjectiveConfig()
    assert aos.request_weight("not_bunk_with", slot=0, mutual=False, config=cfg) == 600


def test_request_weight_internal_notes_first_pick() -> None:
    """STAFF internal_notes at slot 0: 40 × 0.8 × 1.0 × 10 = 320."""
    cfg = aos.ObjectiveConfig()
    assert aos.request_weight("internal_notes", slot=0, mutual=False, config=cfg) == 320


def test_request_weight_unknown_source_raises() -> None:
    """Unknown source_field must raise — no silent fallback (matches bucket.classify_request)."""
    cfg = aos.ObjectiveConfig()
    with pytest.raises(KeyError):
        aos.request_weight("bogus_source", slot=0, mutual=False, config=cfg)


def test_request_weight_negative_slot_raises() -> None:
    """Negative slot must raise — without the guard, slot=-2 silently returns slot_multipliers[-2]=5
    (i.e. 300 instead of 60), and slot=-1 returns the last multiplier (1) only by coincidence of tuple length."""
    cfg = aos.ObjectiveConfig()
    with pytest.raises(ValueError, match="slot"):
        aos.request_weight("bunk_with", slot=-1, mutual=False, config=cfg)
    with pytest.raises(ValueError, match="slot"):
        aos.request_weight("bunk_with", slot=-2, mutual=True, config=cfg)


# ---------------------------------------------------------------------------
# Penalty inventory
# ---------------------------------------------------------------------------


def test_penalty_grade_ratio() -> None:
    """grade_ratio penalty: 5000 per violation per bunk (single-grade > 67%)."""
    cfg = aos.ObjectiveConfig()
    assert cfg.penalties["grade_ratio"] == 5000


def test_penalty_grade_spread_soft() -> None:
    """grade_spread soft penalty: 3000 per excess unique grade per bunk."""
    cfg = aos.ObjectiveConfig()
    assert cfg.penalties["grade_spread_soft"] == 3000


def test_penalty_age_spread() -> None:
    """age_spread violation penalty: 1500 per bunk (spread > 24mo)."""
    cfg = aos.ObjectiveConfig()
    assert cfg.penalties["age_spread"] == 1500


def test_penalty_level_progression() -> None:
    """level_progression: 800 per returning camper × lower-level-bunk pairing."""
    cfg = aos.ObjectiveConfig()
    assert cfg.penalties["level_progression"] == 800


def test_penalty_cabin_minimum_occupancy() -> None:
    """cabin_minimum_occupancy soft: 2000 per spot underfill (max 2 spots → 4000/bunk)."""
    cfg = aos.ObjectiveConfig()
    assert cfg.penalties["cabin_minimum_occupancy"] == 2000


def test_bonus_age_grade_flow_max() -> None:
    """age_grade_flow: up to +300 per camper × bunk bonus."""
    cfg = aos.ObjectiveConfig()
    assert cfg.penalties["age_grade_flow_max"] == 300


def test_bonus_age_spread_preferred() -> None:
    """age_spread preferred bonus: +500 per bunk (spread ≤ 12mo)."""
    cfg = aos.ObjectiveConfig()
    assert cfg.penalties["age_spread_preferred_bonus"] == 500


# ---------------------------------------------------------------------------
# Archetype totals
# ---------------------------------------------------------------------------


def test_archetype_a_loner_mutual_total() -> None:
    """Archetype A: 1 MP bunk_with, mutual, slot 0 = 1200 earnable."""
    cfg = aos.ObjectiveConfig()
    arch = aos.ARCHETYPES["A_loner_mutual"]
    assert aos.archetype_total_weight(arch, cfg) == 1200


def test_archetype_b_loner_oneway_total() -> None:
    """Archetype B: 1 MP bunk_with, one-way, slot 0 = 600 earnable."""
    cfg = aos.ObjectiveConfig()
    arch = aos.ARCHETYPES["B_loner_oneway"]
    assert aos.archetype_total_weight(arch, cfg) == 600


def test_archetype_c_cluster_star_all_mutual_total() -> None:
    """Archetype C: 3 MP bunk_with all mutual, slots 0/1/2 = 1200+600+120 = 1920 earnable."""
    cfg = aos.ObjectiveConfig()
    arch = aos.ARCHETYPES["C_cluster_star"]
    # slot 0 mutual: 40×1.5×2×10 = 1200
    # slot 1 mutual: 40×1.5×2×5  = 600
    # slot 2 mutual: 40×1.5×2×1  = 120
    assert aos.archetype_total_weight(arch, cfg) == 1920


def test_archetype_d_mixed_multi_total() -> None:
    """Archetype D (residual): 3 MP, 1 mutual + 2 one-way = 1200+300+60 = 1560 earnable."""
    cfg = aos.ObjectiveConfig()
    arch = aos.ARCHETYPES["D_mixed_multi"]
    # slot 0 mutual:  40×1.5×2×10 = 1200
    # slot 1 one-way: 40×1.5×1×5  = 300
    # slot 2 one-way: 40×1.5×1×1  = 60
    assert aos.archetype_total_weight(arch, cfg) == 1560


def test_archetype_e_popular_target_total_own() -> None:
    """Archetype E: popular-target camper's own 2 MP one-way requests = 600+300 = 900 earnable from her side."""
    cfg = aos.ObjectiveConfig()
    arch = aos.ARCHETYPES["E_popular_target_own"]
    assert aos.archetype_total_weight(arch, cfg) == 900


# ---------------------------------------------------------------------------
# Threshold analysis
# ---------------------------------------------------------------------------


def test_threshold_ratio_loner_oneway_vs_grade_ratio() -> None:
    """Archetype B (600) vs grade_ratio (5000): 8.33× below — solver only honors if 'free'."""
    cfg = aos.ObjectiveConfig()
    arch = aos.ARCHETYPES["B_loner_oneway"]
    ratio = aos.threshold_ratio(arch, "grade_ratio", cfg)
    assert round(ratio, 2) == 8.33


def test_threshold_ratio_loner_mutual_vs_grade_ratio() -> None:
    """Archetype A (1200) vs grade_ratio (5000): 4.17× below."""
    cfg = aos.ObjectiveConfig()
    arch = aos.ARCHETYPES["A_loner_mutual"]
    ratio = aos.threshold_ratio(arch, "grade_ratio", cfg)
    assert round(ratio, 2) == 4.17


def test_threshold_ratio_cluster_star_vs_grade_ratio() -> None:
    """Archetype C (1920) vs grade_ratio (5000): 2.60× below — cluster placement can override a single ratio violation when stacked."""
    cfg = aos.ObjectiveConfig()
    arch = aos.ARCHETYPES["C_cluster_star"]
    ratio = aos.threshold_ratio(arch, "grade_ratio", cfg)
    assert round(ratio, 2) == 2.60


# ---------------------------------------------------------------------------
# Markdown rendering smoke test
# ---------------------------------------------------------------------------


def test_render_request_weight_table_smoke() -> None:
    """The weight table renders with all expected rows and contains the canonical 1200 figure."""
    cfg = aos.ObjectiveConfig()
    md = aos.render_request_weight_table(cfg)
    assert "bunk_with" in md
    assert "1200" in md
    assert "600" in md
    assert "240" in md  # socialize_with


def test_render_penalty_table_smoke() -> None:
    """The penalty table renders with all module names and seed values."""
    cfg = aos.ObjectiveConfig()
    md = aos.render_penalty_table(cfg)
    assert "grade_ratio" in md
    assert "5000" in md
    assert "level_progression" in md
    assert "800" in md


def test_render_archetype_table_smoke() -> None:
    """The archetype table renders rows for A-E with correct totals."""
    cfg = aos.ObjectiveConfig()
    md = aos.render_archetype_table(cfg)
    assert "A_loner_mutual" in md or "Loner mutual" in md
    assert "1200" in md
    assert "1920" in md  # cluster_star


def test_render_archetype_table_header_uses_config() -> None:
    """Header penalty values in the archetype table must come from config, not be hardcoded.

    Regression for the CodeRabbit finding on PR #1529: if someone passes a non-default
    config, the body rows compute ratios from `config.penalties[...]` but the header
    should not say "(5000)" while the rows use a different penalty.
    """
    custom_cfg = aos.ObjectiveConfig(
        penalties={
            "grade_ratio": 7777,
            "grade_spread_soft": 3333,
            "cabin_minimum_occupancy": 2000,
            "age_spread": 1500,
            "level_progression": 999,
            "age_grade_flow_max": 300,
            "age_spread_preferred_bonus": 500,
        }
    )
    md = aos.render_archetype_table(custom_cfg)
    assert "7777" in md, "Header should reflect the custom grade_ratio penalty"
    assert "3333" in md, "Header should reflect the custom grade_spread_soft penalty"
    assert "999" in md, "Header should reflect the custom level_progression penalty"


# ---------------------------------------------------------------------------
# Linkage to solver constants — drift defense
# ---------------------------------------------------------------------------


def test_objective_config_defaults_match_solver_constants() -> None:
    """`ObjectiveConfig` defaults must equal the hardcoded constants in
    `bunking/solver/direct_solver.py`. If that file's constants change, this
    test fails and forces a corresponding update to the script + doc + test suite.

    Without this linkage, all 28 magnitude tests in this file could keep passing
    while the analysis silently goes wrong (the script's `ObjectiveConfig` is a
    parallel copy of the solver constants).
    """
    from bunking.solver.direct_solver import (
        BASE_REQUEST_WEIGHT,
        FIRST_REQUEST_MULTIPLIER,
        SECOND_REQUEST_MULTIPLIER,
        THIRD_PLUS_REQUEST_MULTIPLIER,
    )

    cfg = aos.ObjectiveConfig()
    assert cfg.base_request_weight == BASE_REQUEST_WEIGHT
    assert cfg.slot_multipliers == (
        FIRST_REQUEST_MULTIPLIER,
        SECOND_REQUEST_MULTIPLIER,
        THIRD_PLUS_REQUEST_MULTIPLIER,
    )
