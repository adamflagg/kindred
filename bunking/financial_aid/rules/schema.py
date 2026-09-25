"""The per-season financial-aid rules document (campership design section 7).

Every lever in the 2026 lever catalogue is a field here, the ones the sheet
hard-coded included, and so are the "quirk" switches that reproduce 2026 as it
actually behaved: ``income.floor_applies_after``, ``grants.minimum_after_grants``,
``round2.cap_subtracts_grants``, and per-program ``r1_table`` / ``r2_table`` that
may be ``None`` (no table). The board fixes a quirk by changing a setting, never code.

Structure only. Cross-field policy checks (tables that increase with tier, pools
that do not sum to 100%, a session no program claims) live in ``validation.py``
and return a report instead of raising, so a draft that is still wrong can be
saved and shown to staff with its problems listed.

Percentages are percentage POINTS (``42.5`` means 42.5%), as staff read them.
Money is ``Decimal``; JSON carries it as a string.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Literal, Self, get_args

from pydantic import BaseModel, ConfigDict, Field, model_validator

Money = Annotated[Decimal, Field(ge=0)]
Percent = Annotated[Decimal, Field(ge=0, le=100)]
Fraction = Annotated[Decimal, Field(ge=0, le=1)]
Weight = Annotated[Decimal, Field(ge=0)]
Key = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]*$", max_length=64)]

SectionName = Literal[
    "income",
    "tiers",
    "equity",
    "award_tables",
    "programs",
    "cost",
    "grants",
    "awards",
    "round2",
    "round3",
    "budget",
    "stages",
    "quality_checks",
    "milestones",
]
SECTION_NAMES: tuple[SectionName, ...] = get_args(SectionName)

QualityCheckKey = Literal[
    "ask_above_cost",
    "py_confirm_tier_change",
    "income_above",
    "expense_above",
    "multiple_grants",
    "placeholder_income",
    "award_above_cost",
    "appeal_above_ask",
    "stage_enrollment_mismatch",
    "implausible_dependents",
    "unmatched_session",
    "family_cost_missing",
    "household_income_conflict",
]
QUALITY_CHECK_KEYS: tuple[QualityCheckKey, ...] = get_args(QualityCheckKey)


class RulesModel(BaseModel):
    """Every rules model: unknown fields are errors, and values are immutable."""

    model_config = ConfigDict(extra="forbid", frozen=True)


# --- income ---------------------------------------------------------------------------


class IncomeWeights(RulesModel):
    """The prior-year / current-year blend. Independent; validation warns when they do not sum to 1."""

    prior_year: Fraction
    current_year: Fraction


class IncomeSection(RulesModel):
    weights: IncomeWeights
    # Which prior-year figure is "prior-year income": gross, AGI, or the confirmed figure
    # (falling back to gross when a family has none).
    basis: Literal["gross", "agi", "confirmed"] = "gross"
    # current year 0 while prior year > 0: keep the blend, or use the prior year alone.
    current_year_zero_fallback: Literal["blend", "prior_year_only"] = "blend"
    # Expenses above a threshold are deducted at a rate; savings above one are ADDED at a rate.
    # All three comparisons are strict (>), as the sheet's were.
    medical_threshold: Money
    medical_rate: Fraction = Decimal(1)
    education_threshold: Money
    education_rate: Fraction = Decimal(1)
    savings_threshold: Money
    savings_inclusion_rate: Fraction = Decimal(1)
    # Dependents move the income (a reduction per dependent) or the tier (the equity
    # criterion that reads `dependents`), never both.
    dependents_mode: Literal["none", "income_reduction", "tier_shift"]
    per_dependent_reduction: Money = Decimal(0)
    floor: Money = Decimal(0)
    # "deductions": the floor is tested BEFORE the per-dependent reduction (the 2026 sheet's
    # order, a latent bug). "all_reductions": tested on the final figure.
    floor_applies_after: Literal["deductions", "all_reductions"]


# --- tiers ----------------------------------------------------------------------------


class TierBand(RulesModel):
    """One income band. The tier lookup uses lower bounds only; `upper` is for display."""

    lower: Money
    upper: Money | None = None


class TiersSection(RulesModel):
    bands: list[TierBand] = Field(min_length=1)
    # Adjusted income above this gets no award at all. None: no ceiling.
    income_ceiling: Money | None = None
    # The lowest final tier: final tier = max(floor_tier, income tier - equity shift).
    floor_tier: int = Field(default=1, ge=1)


# --- equity ---------------------------------------------------------------------------


class EquityCriterion(RulesModel):
    """One intake answer that can shift a request toward more aid.

    `source` says whose answer it is: the household's (on the application) or this
    camper's own (on the request). A household criterion whose `field` is
    "dependents" reads the application's dependents count, and it only counts when
    ``income.dependents_mode == "tier_shift"``.

    Matching is case-insensitive and does not trim. `contains_any` is substring
    matching against each value, which is how a list of spellings replaces the
    sheet's regular expression.
    """

    key: Key
    label: str = Field(min_length=1)
    source: Literal["household", "camper"]
    field: str = Field(min_length=1)
    # Further fields, from the same source, that also satisfy this criterion; the
    # criterion is met if `field` or any of these qualifies, and counts once.
    also_fields: list[str] = Field(default_factory=list)
    match: Literal["equals_any", "contains_any", "at_least"]
    values: list[str] = Field(default_factory=list)
    min_value: Decimal | None = None

    @model_validator(mode="after")
    def _match_has_its_operand(self) -> Self:
        if self.match == "at_least":
            if self.min_value is None:
                raise ValueError(f"criterion '{self.key}': match 'at_least' needs min_value")
        elif not self.values:
            raise ValueError(f"criterion '{self.key}': match '{self.match}' needs at least one value")
        return self


class EquitySection(RulesModel):
    criteria: list[EquityCriterion] = Field(default_factory=list)
    # equity class -> criterion key -> weight. A class with {} never shifts.
    weights: dict[Key, dict[Key, Weight]] = Field(default_factory=dict)
    # How the summed weights become whole tiers. The 2026 sheet used ROUNDUP ("ceil").
    aggregation: Literal["ceil", "round", "floor"] = "ceil"
    max_shift: int | None = Field(default=None, ge=0)


# --- award tables ---------------------------------------------------------------------


class TierPercents(RulesModel):
    r1_pct: Percent
    total_pct: Percent


class TierPercentOverride(RulesModel):
    r1_pct: Percent | None = None
    total_pct: Percent | None = None


class AwardTable(RulesModel):
    """R1 % and total (appeal cap) % per tier.

    A table either lists every tier (`tiers`) or inherits another table and
    overrides some tiers (`inherits` + `overrides`), so a what-if on the parent
    moves every child with it. One level of inheritance only.
    """

    inherits: Key | None = None
    tiers: dict[int, TierPercents] = Field(default_factory=dict)
    overrides: dict[int, TierPercentOverride] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _either_tiers_or_overrides(self) -> Self:
        if self.inherits is None and self.overrides:
            raise ValueError("a table that inherits nothing lists tiers, not overrides")
        if self.inherits is not None and self.tiers:
            raise ValueError("a table that inherits sets overrides, not tiers")
        return self


# --- programs -------------------------------------------------------------------------


class ProgramProfile(RulesModel):
    """One program's settings. Replaces the sheet's single "award class".

    `r1_table` / `r2_table` of None means "no table": the R1 percentage is 0 (so
    only the minimum award can apply) and Round 2 is 0. That is how 2026 routed
    four of its adult and family programs.
    """

    label: str = Field(min_length=1)
    session_cm_ids: list[int] = Field(default_factory=list)
    session_types: list[str] = Field(default_factory=list)
    r1_table: Key | None
    r2_table: Key | None
    equity_class: Key | None
    budget_pool: Key | None
    cost_source: Literal["catalog", "per_person", "typed"]
    open_to_aid: bool = True


# --- cost -----------------------------------------------------------------------------


class FamilyRate(RulesModel):
    """Per-person family-camp rates for one session this season.

    `standard` prices every non-infant person (CampMinder bills adults and children
    at the same rate). `child`, when set, prices children separately.
    """

    session_cm_id: int
    standard: Money
    infant: Money
    child: Money | None = None


def _default_override_reasons() -> list[str]:
    return ["headcount", "partial_session", "discount", "missing_catalog", "typed_household_total"]


class CostSection(RulesModel):
    # CampMinder session cm_id -> this season's tuition.
    tuition: dict[int, Money] = Field(default_factory=dict)
    family_rates: list[FamilyRate] = Field(default_factory=list)
    # Used by intake to pre-fill headcounts (sub-project 5); the calculator does not read it.
    infant_age_cutoff_months: int | None = Field(default=None, ge=0)
    override_reasons: list[Key] = Field(default_factory=_default_override_reasons)
