#!/usr/bin/env python3
"""Objective-sensitivity analysis for the bunking solver.

Computes per-request weights, per-constraint penalties, and per-archetype
totals from the current seed-config values. Outputs markdown tables ready to
drop into `docs/reference/objective-sensitivity.md`.

Source values are snapshotted from migration `1500000011_config.js` and the
`BASE_REQUEST_WEIGHT` / slot-multiplier constants hardcoded in
`bunking/solver/direct_solver.py:67-72` (formerly config, deleted in
migration `1500000100_priority_deletion.js`).

Regenerate the doc tables:
    uv run python scripts/analyze_objective_sensitivity.py

If `BASE_REQUEST_WEIGHT`, slot multipliers, source multipliers, the mutual
boost, or any seeded penalty changes, update `ObjectiveConfig` defaults below
and re-run; the doc's tables and the test suite both lock in the current
values.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ObjectiveConfig:
    base_request_weight: int = 40
    slot_multipliers: tuple[int, ...] = (10, 5, 1)
    source_multipliers: dict[str, float] = field(
        default_factory=lambda: {
            "bunk_with": 1.5,
            "not_bunk_with": 1.5,
            "bunking_notes": 1.0,
            "internal_notes": 0.8,
            "socialize_with": 0.6,
        }
    )
    mutual_boost: float = 2.0
    penalties: dict[str, int] = field(
        default_factory=lambda: {
            "grade_ratio": 5000,
            "grade_spread_soft": 3000,
            "cabin_minimum_occupancy": 2000,
            "age_spread": 1500,
            "level_progression": 800,
            "age_grade_flow_max": 300,
            "age_spread_preferred_bonus": 500,
        }
    )


SOURCE_BUCKET: dict[str, str] = {
    "bunk_with": "MP",
    "not_bunk_with": "STAFF",
    "bunking_notes": "STAFF",
    "internal_notes": "STAFF",
    "socialize_with": "IMP",
}


def request_weight(source: str, slot: int, mutual: bool, config: ObjectiveConfig) -> int:
    """Return the objective coefficient for a single satisfied request.

    Mirrors the arithmetic in `direct_solver.py:562-583`:
        int(BASE_REQUEST_WEIGHT × source_multiplier × mutual_boost × slot_multiplier)

    The mutual boost only applies to `bunk_with` (per `score_evaluator`); other
    sources ignore the `mutual` flag.

    Raises:
        KeyError: if `source` is not in `config.source_multipliers`.
        ValueError: if `slot` is negative — would otherwise silently wrap to
            the tail of `slot_multipliers` via Python's negative indexing and
            return a wrong coefficient.
    """
    if slot < 0:
        raise ValueError(f"slot must be >= 0, got {slot}")
    source_mult = config.source_multipliers[source]
    slot_idx = min(slot, len(config.slot_multipliers) - 1)
    slot_mult = config.slot_multipliers[slot_idx]
    boost = config.mutual_boost if (mutual and source == "bunk_with") else 1.0
    return int(config.base_request_weight * source_mult * boost * slot_mult)


@dataclass(frozen=True)
class RequestSpec:
    source: str
    slot: int
    mutual: bool


@dataclass(frozen=True)
class Archetype:
    name: str
    description: str
    requests: tuple[RequestSpec, ...]


ARCHETYPES: dict[str, Archetype] = {
    "A_loner_mutual": Archetype(
        name="A. Loner mutual",
        description="Singleton MP camper, 1 reciprocated bunk_with request.",
        requests=(RequestSpec("bunk_with", 0, mutual=True),),
    ),
    "B_loner_oneway": Archetype(
        name="B. Loner one-way",
        description="Singleton MP camper, 1 unreciprocated bunk_with request.",
        requests=(RequestSpec("bunk_with", 0, mutual=False),),
    ),
    "C_cluster_star": Archetype(
        name="C. Cluster star",
        description="Multi-MP camper, 3 reciprocated bunk_with requests forming a tight cluster.",
        requests=(
            RequestSpec("bunk_with", 0, mutual=True),
            RequestSpec("bunk_with", 1, mutual=True),
            RequestSpec("bunk_with", 2, mutual=True),
        ),
    ),
    "D_mixed_multi": Archetype(
        name="D. Mixed multi (THE RESIDUAL ARCHETYPE)",
        description=(
            "Multi-MP camper, 1 reciprocated bunk_with at first-pick + 2 unreciprocated "
            "at slots 1-2. Matches the partial-tail pattern of the 21 S2 / 17 S4 unmet residuals."
        ),
        requests=(
            RequestSpec("bunk_with", 0, mutual=True),
            RequestSpec("bunk_with", 1, mutual=False),
            RequestSpec("bunk_with", 2, mutual=False),
        ),
    ),
    "E_popular_target_own": Archetype(
        name="E. Popular target (own requests)",
        description=(
            "A camper named by multiple other campers but with her own 2 unreciprocated MP "
            "requests elsewhere. Modeled here from her side; demand from other campers does "
            "not appear in her own objective contribution — see threshold analysis."
        ),
        requests=(
            RequestSpec("bunk_with", 0, mutual=False),
            RequestSpec("bunk_with", 1, mutual=False),
        ),
    ),
}


def archetype_total_weight(arch: Archetype, config: ObjectiveConfig) -> int:
    """Sum the objective coefficient of every request in the archetype, assuming all satisfied."""
    return sum(request_weight(r.source, r.slot, r.mutual, config) for r in arch.requests)


def threshold_ratio(arch: Archetype, penalty_module: str, config: ObjectiveConfig) -> float:
    """Penalty magnitude divided by archetype total weight.

    A ratio of 4.17 means the dominant penalty is 4.17× larger than the maximum
    objective benefit the solver can earn by satisfying every request in the
    archetype — so the solver will only honor those requests when the placement
    is 'free' (does not trigger the penalty).
    """
    penalty = config.penalties[penalty_module]
    total = archetype_total_weight(arch, config)
    return penalty / total


def render_request_weight_table(config: ObjectiveConfig) -> str:
    """Markdown table: per-source weights at each slot, with/without mutual boost where applicable."""
    rows: list[str] = [
        "| Source | Bucket | Slot 0 (first) | Slot 1 (second) | Slot 2+ (third+) | Mutual boost applies? |",
        "|---|---|---|---|---|---|",
    ]
    for source in ("bunk_with", "not_bunk_with", "bunking_notes", "internal_notes", "socialize_with"):
        bucket = SOURCE_BUCKET[source]
        mutual_applies = source == "bunk_with"
        s0 = request_weight(source, 0, mutual=False, config=config)
        s1 = request_weight(source, 1, mutual=False, config=config)
        s2 = request_weight(source, 2, mutual=False, config=config)
        if mutual_applies:
            s0m = request_weight(source, 0, mutual=True, config=config)
            s1m = request_weight(source, 1, mutual=True, config=config)
            s2m = request_weight(source, 2, mutual=True, config=config)
            s0_cell = f"{s0} ({s0m} mutual)"
            s1_cell = f"{s1} ({s1m} mutual)"
            s2_cell = f"{s2} ({s2m} mutual)"
            applies = f"Yes (×{config.mutual_boost})"
        else:
            s0_cell, s1_cell, s2_cell = str(s0), str(s1), str(s2)
            applies = "No"
        rows.append(f"| `{source}` | {bucket} | {s0_cell} | {s1_cell} | {s2_cell} | {applies} |")
    return "\n".join(rows)


def render_penalty_table(config: ObjectiveConfig) -> str:
    """Markdown table: per-constraint penalty magnitudes with per-what semantics."""
    rows: list[str] = [
        "| Module | Penalty / Bonus | Magnitude | Per-what | Trigger |",
        "|---|---|---|---|---|",
        f"| `grade_ratio` | Penalty | {config.penalties['grade_ratio']} | per grade × bunk | Single grade exceeds 67% of multi-grade bunk; edge bunks exempt |",
        f"| `grade_spread_soft` | Penalty | {config.penalties['grade_spread_soft']} | per excess unique grade × bunk | Unique-grade count above `max_spread` (2) |",
        f"| `cabin_minimum_occupancy` | Penalty | {config.penalties['cabin_minimum_occupancy']} | per spot × bunk | Used bunk below `PREFERRED_BUNK_OCCUPANCY` (10); capped at 2 spots / 4000 per bunk |",
        f"| `age_spread` | Penalty | {config.penalties['age_spread']} | per bunk | Age spread > 24 months |",
        f"| `level_progression` | Penalty | {config.penalties['level_progression']} | per camper × eligible lower-level bunk | Returning camper placed in lower-level bunk than prior year |",
        f"| `age_grade_flow` | Bonus (up to) | +{config.penalties['age_grade_flow_max']} | per camper × bunk | Continuous: `fit_score × weight`; camper's grade matches bunk's target grade |",
        f"| `age_spread_preferred_bonus` | Bonus | +{config.penalties['age_spread_preferred_bonus']} | per bunk | Age spread ≤ 12 months |",
    ]
    return "\n".join(rows)


def render_archetype_table(config: ObjectiveConfig) -> str:
    """Markdown table: per-archetype objective totals + threshold ratios vs dominant penalties."""
    gr = config.penalties["grade_ratio"]
    gs = config.penalties["grade_spread_soft"]
    lp = config.penalties["level_progression"]
    rows: list[str] = [
        f"| Archetype | Description | Total earnable | vs grade_ratio ({gr}) | vs grade_spread ({gs}) | vs level_progression ({lp}) |",
        "|---|---|---|---|---|---|",
    ]
    for arch in ARCHETYPES.values():
        total = archetype_total_weight(arch, config)
        ratio_gr = threshold_ratio(arch, "grade_ratio", config)
        ratio_gs = threshold_ratio(arch, "grade_spread_soft", config)
        ratio_lp = threshold_ratio(arch, "level_progression", config)
        rows.append(
            f"| **{arch.name}** | {arch.description} | {total} | {ratio_gr:.2f}× | {ratio_gs:.2f}× | {ratio_lp:.2f}× |"
        )
    return "\n".join(rows)


def render_full_report(config: ObjectiveConfig) -> str:
    """Concatenated markdown for all three tables, with section headers."""
    return "\n\n".join(
        [
            "## Per-request weights (current seed values)",
            render_request_weight_table(config),
            "## Per-constraint penalty inventory",
            render_penalty_table(config),
            "## Per-archetype totals + threshold ratios",
            render_archetype_table(config),
        ]
    )


def main() -> None:
    print(render_full_report(ObjectiveConfig()))


if __name__ == "__main__":
    main()
