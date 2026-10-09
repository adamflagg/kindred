"""Finance's "as reported" history (clean spec §5.6, §9.5, §9.7; D132, D133; O-930-13's default): the figures
finance already took to the committee before Kindred had the data, typed ONCE into `aid_reported_history`, each
with its as-of date, marked r. Pure: the catalogue and its validation.

Dollars and counts only: Kindred computes every percentage (§9.7). The one exception is the committee's target
band per phase (RPT-1), which is not an outcome but finance's own target, typed per season from its "Recommend"
column (§5.3, D120): it is a percentage of budget by definition.

Each metric names the dimensions it may carry (a pool, an income tier, a Round 1 phase) and when it was read:
`pull` (a dated pull before the season ended, e.g. the deadline figures a deck showed) or `season_end` (the
season's final figure). A dimension the metric doesn't carry must be empty. Development's own as-reported rows
(§9.4) are the "development" view's metrics (Reports Part B).
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Final, Literal, get_args

ReportView = Literal["finance", "development"]
Unit = Literal["dollars", "count", "percent"]
At = Literal["pull", "season_end"]
Dimension = Literal["pool", "tier", "phase"]
VIEWS: Final[tuple[ReportView, ...]] = get_args(ReportView)
ATS: Final[tuple[At, ...]] = get_args(At)
PHASES: Final[tuple[int, ...]] = (1, 2, 3)  # RPT-1: by the deadline, rolling after it, appeals (Rounds 2 and 3)
ENTITY_MAX: Final = 64  # aid_change_log.entity_id's limit (1500000187_aid_change_log.js)
_KEY: Final = re.compile(r"^[a-z][a-z0-9_]{0,59}$")


@dataclass(frozen=True)
class Metric:
    key: str
    view: ReportView
    unit: Unit
    dims: frozenset[Dimension]
    ats: frozenset[At]
    rpt: tuple[str, ...]
    label: str


_POOL: Final[frozenset[Dimension]] = frozenset({"pool"})
_DEV_ATS: Final[frozenset[At]] = frozenset({"pull", "season_end"})
# One basis, all money (D87). Unlike finance's, "% of need met" is typed: no per-round asks exist before 2026 to
# rebuild it from (§9.5). The summer-only typed lines (% of need met, TLI + SCIT; ages are always Kindred's by age, D158) carry the summer group's
# pool, so a typed figure reaches the row that shows it.
_DEVELOPMENT: Final[tuple[tuple[str, Unit, frozenset[Dimension], str], ...]] = (
    ("total_awards", "dollars", _POOL, "Total Awards Granted (all money)"),
    ("awards", "count", _POOL, "Grants/Awards"),  # owner ruling L (10-08)
    ("total_requests", "dollars", _POOL, "Total requests (demand) = Σ need"),
    ("need_met", "percent", _POOL, "% of need met"),
    ("recipients", "count", _POOL, "Recipients (attended and got money, any source)"),
    ("families", "count", _POOL, "Families (CampMinder households)"),
    ("teen_programs", "count", _POOL, "TLI + SCIT"),
    ("first_time", "count", _POOL, "First-time"),
    ("returning", "count", _POOL, "Returning"),
    ("appeals_submitted", "count", _POOL, "Appeals (asks in Round 2 or later, campers who attended)"),
    ("appeals_approved", "count", _POOL, "Appeals approved"),
    ("declined_insufficient", "count", _POOL, "Declined enrollment due to insufficient aid"),
)
METRICS: Final[tuple[Metric, ...]] = (
    Metric(
        "budget",
        "finance",
        "dollars",
        frozenset({"pool"}),
        frozenset({"season_end"}),
        ("RPT-7", "RPT-24", "RPT-1"),
        "Approved budget",
    ),
    Metric(
        "awarded",
        "finance",
        "dollars",
        frozenset({"pool"}),
        frozenset({"season_end"}),
        ("RPT-7", "RPT-1"),
        "Total aid distributed",
    ),
    Metric(
        "phase_awarded",
        "finance",
        "dollars",
        frozenset({"phase"}),
        # RPT-1's two columns (owner N2 = C): `pull` is "As offered" (a deck's snapshot, its own as-of date; the latest
        # pull of a phase counts) and `season_end` is "End of season" (net of cancellations).
        frozenset({"pull", "season_end"}),
        ("RPT-1",),
        "Phase dollars",
    ),
    Metric(
        "phase_band_low",
        "finance",
        "percent",
        frozenset({"phase"}),
        frozenset({"season_end"}),
        ("RPT-1",),
        "Target band, low (% of budget)",
    ),
    Metric(
        "phase_band_high",
        "finance",
        "percent",
        frozenset({"phase"}),
        frozenset({"season_end"}),
        ("RPT-1",),
        "Target band, high (% of budget)",
    ),
    Metric(
        "r1_apps",
        "finance",
        "count",
        frozenset({"pool", "tier"}),
        frozenset({"pull", "season_end"}),
        ("RPT-2", "RPT-6", "RPT-8", "RPT-9"),
        "Round 1 applications",
    ),
    Metric(
        "r1_asked",
        "finance",
        "dollars",
        frozenset({"pool"}),
        frozenset({"pull", "season_end"}),
        ("RPT-2", "RPT-6", "RPT-13"),
        "Round 1 asks",
    ),
    Metric(
        "r1_awarded",
        "finance",
        "dollars",
        frozenset({"pool"}),
        frozenset({"season_end"}),
        ("RPT-13",),
        "Round 1 awarded",
    ),
    Metric(
        "appeals", "finance", "count", frozenset({"tier"}), frozenset({"season_end"}), ("RPT-8", "RPT-9"), "Appeals"
    ),
    Metric(
        "r3_awarded",
        "finance",
        "dollars",
        frozenset({"tier"}),
        frozenset({"season_end"}),
        ("RPT-9",),
        "Round 3 awarded",
    ),
    # Development's rows as development reported them (§9.4: 2022 to 2025, and 2026's "as reported" row, D102).
    *(Metric(key, "development", unit, dims, _DEV_ATS, ("§9.4",), label) for key, unit, dims, label in _DEVELOPMENT),
)
METRICS_BY_KEY: Final[Mapping[str, Metric]] = {m.key: m for m in METRICS}


@dataclass(frozen=True)
class ReportedFigure:
    """One typed figure. `pool` "" and `tier` / `phase` 0 mean the dimension is not used (the season's total)."""

    year: int
    view: ReportView
    metric: str
    pool: str
    tier: int
    phase: int
    at: At
    as_of: date
    value: Decimal
    source: str = ""  # where it was typed from, e.g. "Oct 2025 deck, slide 8"
    note: str = ""  # finance's own note, shown beside the figure (RPT-24)

    @property
    def key(self) -> tuple[int, str, str, str, int, int, str, date]:
        """The natural key: one value per figure, so a second load updates it instead of adding a row."""
        return (self.year, self.view, self.metric, self.pool, self.tier, self.phase, self.at, self.as_of)


def problems(figure: ReportedFigure) -> list[str]:
    """Why a typed figure can't be stored (empty: it can)."""
    metric = METRICS_BY_KEY.get(figure.metric)
    if metric is None:
        return [f"{figure.metric!r} is not a reported metric ({', '.join(sorted(METRICS_BY_KEY))})"]
    out: list[str] = []
    if metric.view != figure.view:
        out.append(f"{figure.metric} is a {metric.view} figure, not {figure.view}")
    if figure.at not in metric.ats:
        out.append(f"{figure.metric} is read at {' or '.join(sorted(metric.ats))}, not {figure.at}")
    used = {"pool": figure.pool != "", "tier": figure.tier != 0, "phase": figure.phase != 0}
    for dim, present in used.items():
        if present and dim not in metric.dims:
            out.append(f"{figure.metric} has no {dim}")
    if "phase" in metric.dims and figure.phase not in PHASES:
        out.append(f"{figure.metric} needs a phase: 1 by the deadline, 2 rolling after it, 3 appeals")
    if figure.pool and not _KEY.match(figure.pool):
        out.append(f"pool {figure.pool!r} is not a pool key")
    if figure.tier < 0:
        out.append("a tier is 1 or more")
    if figure.value < 0:
        out.append("a reported figure is never negative: over/under is computed, never typed")
    if metric.unit == "count" and figure.value != figure.value.to_integral_value():
        out.append(f"{figure.metric} is a count")
    if metric.unit == "percent" and figure.value > 100:
        out.append(f"{figure.metric} is a percentage of budget, 0 to 100")
    if not figure.year - 1 <= figure.as_of.year <= figure.year + 1:
        out.append(f"as of {figure.as_of} is not in {figure.year}'s season")
    return out


def figure_entity(figure: ReportedFigure) -> str:
    """The change log's key for a typed figure, within aid_change_log.entity_id's 64 characters:
    "<year>:<view>:<metric, at most 32 characters>:<12 hex digits of the SHA-1 of the whole natural key>". The year,
    view and metric keep the history readable; the digest keeps two figures of one metric apart (their pool, tier,
    phase, at and as-of are in the row's before/after)."""
    digest = hashlib.sha1(":".join(str(part) for part in figure.key).encode(), usedforsecurity=False).hexdigest()
    return f"{figure.year}:{figure.view}:{figure.metric[:32]}:{digest[:12]}"
