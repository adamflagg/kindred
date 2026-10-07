"""The per-season financial-aid rules document (campership design section 7).

Every lever in the 2026 lever catalogue is a field here, the ones the sheet
hard-coded included, and so are the "quirk" switches that reproduce 2026 as it
actually behaved: ``income.floor_applies_after``, ``grants.minimum_after_grants``,
``round2.cap_subtracts_grants``, and a program's Round 1 table (``r1_table``) or
Round 2 table (``round2.program_tables``) that may be ``None`` (no table). The board
fixes a quirk by changing a setting, never code.

Structure only. Cross-field policy checks (tables that increase with tier, pools
that do not sum to 100%, a session no program claims) live in ``validation.py``
and return a report instead of raising, so a draft that is still wrong can be
saved and shown to staff with its problems listed.

Percentages are percentage POINTS (``42.5`` means 42.5%), as staff read them.
Money is ``Decimal``; JSON carries it as a string.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any, Literal, Self, get_args

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Money = Annotated[Decimal, Field(ge=0)]
Percent = Annotated[Decimal, Field(ge=0, le=100)]
Fraction = Annotated[Decimal, Field(ge=0, le=1)]
Weight = Annotated[Decimal, Field(ge=0)]
Key = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]*$", max_length=64)]
HUNDRED = Decimal(100)

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
    "quality_checks",
    "milestones",
]
# Removing one needs nothing: status_from_json reads only SECTION_NAMES. Adding a section here needs a
# data backfill of `section_status` on existing `aid_rules` rows: status_from_json refuses to load a
# partial status map, so a row with no stored entry for the new section would stop loading entirely.
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

# Synced application figures (sub-project 1) an income term may read, beyond the gross,
# AGI, expense and savings figures the income section already names. Government
# subsidies are a yes/no answer, so they are an equity criterion, not a term.
#
# LIVE QUESTIONS ONLY (owner ruling 2026-09-27): a figure or answer field here must be on
# the current CampMinder aid forms. The FA mirror still stores retired questions (the Go
# sync and its migration are unchanged), but no rule may read one: `student_debt`,
# `retirement_accounts` and `other_support_amount` were 0 in 2025 and 2026 alike and are
# dropped from here for that reason.
IncomeFigure = Literal[
    "total_housing_expenses",
    "total_rent",
]

# The household's yes/no answers a household equity criterion can read. The FA mirror
# stores each as a PocketBase bool, so a blank answer arrives as False: "No" and "never
# answered" cannot be told apart. Validation therefore refuses a criterion that matches No
# on one of them, and intake warns when no applicant in a season answered one yes.
#
# LIVE QUESTIONS ONLY (owner ruling 2026-09-27): `still_unemployed` (a retired 2020-21
# follow-up that a non-seasonal CampMinder field keeps returning under later years) and
# `owns_home` (0 since 2022) are retired, not live, and are not here. RETIRED_YES_NO_FIELDS
# below names them so validation.py can refuse a criterion that still points at one.
#
# `single_parent` is live and optional again (owner ruling D144 + the 2026-09-30
# follow-up: every tier-boost question stays on the aid form and is a toggle finance can
# switch). A household criterion may name it; it is off unless a season's rules add a
# criterion for it (2026 and 2027 v1 do not), so the answer moves no one's tier until then.
YES_NO_ANSWER_FIELDS: tuple[str, ...] = (
    "unemployment",
    "gov_subsidies",
    "single_parent",
)

# Former members of YES_NO_ANSWER_FIELDS the FA mirror still stores but the current
# CampMinder form no longer asks. A household equity criterion that names one would never
# fire (intake never carries the answer past the mirror), so validation.py refuses it
# outright instead of leaving a silently-dead criterion in the document.
RETIRED_YES_NO_FIELDS: tuple[str, ...] = (
    "still_unemployed",
    "owns_home",
)


class RulesModel(BaseModel):
    """Every rules model: unknown fields are errors, and values are immutable."""

    model_config = ConfigDict(extra="forbid", frozen=True)


# --- income ---------------------------------------------------------------------------


class IncomeWeights(RulesModel):
    """The prior-year / current-year blend. Independent; validation warns when they do not sum to 1."""

    prior_year: Fraction
    current_year: Fraction


class IncomeTerm(RulesModel):
    """One optional term over another synced figure: the amount above `threshold`
    (strictly), times `rate`, deducted from or added to the income."""

    figure: IncomeFigure
    direction: Literal["deduct", "add"]
    threshold: Money = Decimal(0)
    rate: Fraction = Decimal(1)


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
    # Every income field is stored and shown; these switch others into the formula. None by default.
    extra_terms: list[IncomeTerm] = Field(default_factory=list)
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
    # Adjusted income above this gets none of the camp's own money: Rounds 1-3 always, and
    # named top-ups and discretionary amounts unless the decision type is `ceiling_exempt`.
    # Outside grants are unaffected (the engine never pays them; they only offset). None: no ceiling.
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
    # Owner 10-06: an unchecked criterion counts for nobody and keeps its weights (flip it back on, they return).
    enabled: bool = True

    @model_validator(mode="after")
    def _match_has_its_operand(self) -> Self:
        if self.match == "at_least":
            if self.min_value is None:
                raise ValueError(f"criterion '{self.key}': match 'at_least' needs min_value")
        elif not self.values:
            raise ValueError(f"criterion '{self.key}': match '{self.match}' needs at least one value")
        return self


def _without(data: Any, *keys: str) -> Any:
    """A stored mapping with retired keys popped (owner 10-06 cull): stored documents keep loading; nothing stored is
    rewritten, and the next save simply doesn't carry them."""
    if isinstance(data, dict) and any(key in data for key in keys):
        return {k: v for k, v in data.items() if k not in keys}
    return data


class EquitySection(RulesModel):
    criteria: list[EquityCriterion] = Field(default_factory=list)
    # equity class -> criterion key -> weight. A class with {} never shifts.
    weights: dict[Key, dict[Key, Weight]] = Field(default_factory=dict)
    # How the summed weights become whole tiers. The 2026 sheet used ROUNDUP ("ceil").
    aggregation: Literal["ceil", "round", "floor"] = "ceil"
    max_shift: int | None = Field(default=None, ge=0)

    @model_validator(mode="before")
    @classmethod
    def _full_matrix(cls, data: Any) -> Any:
        """Every class carries a weight for every criterion, 0 where none was stored (a missing weight already counted
        as 0), so the editor shows every box and saves the full matrix (§9.9)."""
        if not isinstance(data, dict):
            return data
        # A criterion arrives as stored JSON (a dict) or, from code, as an EquityCriterion.
        found = (c.get("key") if isinstance(c, dict) else getattr(c, "key", None) for c in data.get("criteria") or [])
        keys = [key for key in found if isinstance(key, str)]
        weights = data.get("weights")
        if not isinstance(weights, dict):
            return data
        filled = {
            name: (dict.fromkeys(keys, "0") | dict(row)) if isinstance(row, dict) else row
            for name, row in weights.items()
        }
        return {**data, "weights": filled}


# --- award tables ---------------------------------------------------------------------


class R1Percent(RulesModel):
    r1_pct: Percent


class TotalPercent(RulesModel):
    """The appeal cap: Round 1 + Round 2 may reach this % of cost."""

    total_pct: Percent


class TierTable[TierValue: (R1Percent, TotalPercent)](RulesModel):
    """A percentage per tier.

    A table either lists every tier (`tiers`) or inherits another table in the same
    section and overrides some tiers (`inherits` + `overrides`), so a what-if on the
    parent moves every child with it. One level of inheritance only.
    """

    inherits: Key | None = None
    tiers: dict[int, TierValue] = Field(default_factory=dict)
    overrides: dict[int, TierValue] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _either_tiers_or_overrides(self) -> Self:
        if self.inherits is None and self.overrides:
            raise ValueError("a table that inherits nothing lists tiers, not overrides")
        if self.inherits is not None and self.tiers:
            raise ValueError("a table that inherits sets overrides, not tiers")
        return self


class AwardTable(TierTable[R1Percent]):
    """Round 1 % per tier. Round 2's appeal cap % is a separate table in `round2.tables`,
    so it stays editable after the Round 1 sections lock (spec section 7.1)."""


class Round2Table(TierTable[TotalPercent]):
    """The appeal cap (total %) per tier."""


# --- programs -------------------------------------------------------------------------


class ProgramProfile(RulesModel):
    """One program's settings. Its equity class picks both its row of equity weights and its award tables (owner
    10-06: "the equity class determines the table - its a 1:1 relationship"): Round 1 is `award_tables[class]` and
    the appeal cap `round2.tables[class]` (`table_from_equity_class`, the default).

    LEGACY: a program stored with `r1_table` and no flag (every program in 2026's file) loads with the flag False and
    prices exactly as stored, from `r1_table` (None: no table, the minimum only), `round2.program_tables` and
    `awards.minimum_without_table`. The new programs editor never writes them.
    """

    label: str = Field(min_length=1)
    session_cm_ids: list[int] = Field(default_factory=list)
    session_types: list[str] = Field(default_factory=list)
    r1_table: Key | None = None
    equity_class: Key | None
    budget_pool: Key | None
    cost_source: Literal["catalog", "per_person", "typed"]
    open_to_aid: bool = True
    # The CampMinder description to post this program's aid under (app spec §6.2 Needs an offer, §13). Blank: none
    # named. Whether 2027 has per-program descriptions at all is O-930-26 (D128); a blank field decides nothing.
    campminder_description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    table_from_equity_class: bool = True

    @model_validator(mode="before")
    @classmethod
    def _legacy_routing(cls, data: Any) -> Any:
        """A stored program with `r1_table` and no flag is legacy, so 2026 replays from its own file (§8.5)."""
        if isinstance(data, dict) and "r1_table" in data and "table_from_equity_class" not in data:
            return {**data, "table_from_equity_class": False}
        return data


# --- cost -----------------------------------------------------------------------------


class FamilyRate(RulesModel):
    """Per-person family-camp rates for one session this season: everyone but infants pays the standard rate
    (CampMinder bills adults and children alike; owner 10-06: the child rate removed)."""

    session_cm_id: int
    standard: Money
    infant: Money

    @model_validator(mode="before")
    @classmethod
    def _culled(cls, data: Any) -> Any:
        return _without(data, "child")


def _default_override_reasons() -> list[str]:
    return ["headcount", "partial_session", "discount", "missing_catalog", "typed_household_total"]


class CostSection(RulesModel):
    # CampMinder session cm_id -> this season's tuition.
    tuition: dict[int, Money] = Field(default_factory=dict)
    family_rates: list[FamilyRate] = Field(default_factory=list)
    # A person under this many months on the SESSION'S FIRST DAY is an infant (spec 2 item 22).
    # Intake (sub-project 5) reads it through bunking/financial_aid/headcount.py to pre-fill and
    # cross-check family-camp headcounts; the calculator does not read it.
    infant_age_cutoff_months: int | None = Field(default=None, ge=0)
    override_reasons: list[Key] = Field(default_factory=_default_override_reasons)
    # This season's sessions finance marked not running (spec §7.1): their live requests are on hold until the
    # session runs again or the request moves. CampMinder session ids, this season only: Start From Last Year clears
    # it, since CampMinder reuses ids across years. Stored documents without it load as [].
    not_running_session_cm_ids: list[int] = Field(default_factory=list)


# --- grants ---------------------------------------------------------------------------


class GrantsSection(RulesModel):
    # The program keys outside grants offset. 2026: Summer only (a staff ruling).
    offset_programs: list[Key] = Field(default_factory=list)
    # "dollar": R1 potential = R1% x cost - grants. "reduce_cost_basis": R1% x (cost - grants).
    offset_mode: Literal["dollar", "reduce_cost_basis"] = "dollar"
    # True (2026): the minimum award is paid on top of grants. False: grants may cover it.
    minimum_after_grants: bool
    # Whether the minimum is still paid when grants cover the whole cost. True (2026) pays it
    # anyway; False (the owner's 2027 ruling) pays nothing. A partial grant follows
    # `minimum_after_grants` alone.
    minimum_when_fully_covered: bool
    # True (owner ruling D140, 2027 on): the minimum is capped at what is left of the cost after
    # counted grants, so a grant plus the minimum never passes the cost and nothing is left means
    # no minimum. False (2026 as operated): `minimum_after_grants` and `minimum_when_fully_covered`
    # decide alone. Defaults False so a document without it prices as the 2026 sheet did.
    minimum_capped_at_share: bool = False
    count_when: Literal["committed", "received"] = "committed"
    # A grant recorded after the Round 1 decision: leave it out, leave it out and flag it,
    # or count it.
    late_grant_policy: Literal["ignore", "flag", "recalculate"] = "flag"

    @model_validator(mode="before")
    @classmethod
    def _culled(cls, data: Any) -> Any:
        return _without(data, "incentives")


# --- awards ---------------------------------------------------------------------------


class DecisionType(RulesModel):
    """A named kind of decision.

    full_cost: Round 1 potential is 100% of cost less grants, and a top-up brings the
      total to cost - grants + extra_amount (a categorical full-funding program).
    full_cost_after_aid: the family's normal award first (it counts toward the budget as usual); the type then pays
      what that award and the request's outside grants leave of the cost, never below $0 and with no extra amount
      (owner 10-06).
    top_up: a fixed amount added to the award (the appeal top-up).
    discretionary: staff type the amount on the request (`discretionary_amount`).

    `counts_toward_budget` says whether this type's money is the camp's own budget money. When
    false, the type's WHOLE round (base and extra; posted, offered or pending approval) sits below the
    line, never lowers Remaining and adds no forward demand (owner ruling 2026-09-30).
    `ceiling_exempt` lets this type's own money (its top-up or discretionary amount) pay above
    `tiers.income_ceiling`; Rounds 1-3 stop at the ceiling either way.
    """

    label: str = Field(min_length=1)
    kind: Literal["full_cost", "full_cost_after_aid", "top_up", "discretionary"]
    round: int = Field(ge=1, le=3)
    amount: Money | None = None
    extra_amount: Money = Decimal(0)
    allows_appeal: bool = True
    counts_toward_budget: bool = True
    ceiling_exempt: bool = False

    @model_validator(mode="before")
    @classmethod
    def _culled(cls, data: Any) -> Any:
        return _without(data, "budget_line")

    @model_validator(mode="after")
    def _amounts_fit_the_kind(self) -> Self:
        if self.kind == "top_up" and self.amount is None:
            raise ValueError("a top_up decision type needs amount")
        if self.kind != "top_up" and self.amount is not None:
            raise ValueError("only a top_up decision type has a fixed amount")
        if self.kind != "full_cost" and self.extra_amount != 0:
            raise ValueError("only a full_cost decision type has extra_amount")
        if self.kind == "full_cost_after_aid" and self.counts_toward_budget:
            # Owner 10-06: its camp award counts as usual and only its remainder sits below the line; a type that
            # counts would take the whole round into the budget (budget.counted_part), the remainder included.
            raise ValueError("a full_cost_after_aid decision type doesn't count toward the budget")
        return self


class TotalCap(RulesModel):
    """Caps Round 2 and Round 3 so that R1 + R2 + R3 (+ grants) stays within a % of cost.

    Named top-ups and discretionary amounts are the allowances: they are never cut.
    """

    pct_of_cost: Percent
    # False (owner ruling D139): an appeal never subtracts outside grants, whenever recorded.
    include_grants: bool = False


class AwardsSection(RulesModel):
    minimum: Money
    minimum_when_cost_unknown: bool
    minimum_without_table: bool = True  # LEGACY: read only for a legacy program with no Round 1 table
    rounding: Literal["half_up"] = "half_up"
    ask_cap: bool = True
    decision_types: dict[Key, DecisionType] = Field(default_factory=dict)


class Round2Section(RulesModel):
    """Every Round 2 lever, apart from the Round 1 sections: staff set Round 2 after Round 1
    results, while Round 1 keeps rolling, so these must stay editable once Round 1 locks."""

    # False (2026): the appeal cap ignores grants, so a capped appeal hands the offset back.
    cap_subtracts_grants: bool
    cap_by_original_ask: bool
    tables: dict[Key, Round2Table] = Field(default_factory=dict)
    # program -> its Round 2 table; None means no Round 2 table (Round 2 is 0). Every
    # program open to aid must be listed. LEGACY: read only for a program without table_from_equity_class.
    program_tables: dict[Key, Key | None] = Field(default_factory=dict)
    total_cap: TotalCap | None = None


class Round3Section(RulesModel):
    require_round2: bool = True
    require_statement_of_need: bool = True
    max_amount: Money | None = None
    max_total_pct_of_cost: Percent | None = None
    # The most staff with casework only (the registrar) may give in Round 3 on their own; a larger
    # Round 3 amount waits for finance as "Pending approval" (D22, D79; main spec 7.2 "the
    # registrar's ceiling"). None: the season sets no limit, so every Round 3 amount waits.
    registrar_limit: Money | None = None


# --- budget ---------------------------------------------------------------------------


class BudgetPool(RulesModel):
    """One program's pool: its % of the season's total (owner 10-06: every pool is a %)."""

    label: str = Field(min_length=1)
    share_pct: Percent


class BudgetSection(RulesModel):
    """The season's budget plan: a total and a program split (owner 10-06: no reserves, no round plan; the split is
    finance's guess at each program's need, not a cap). Edited on Rounds & budget (Edit Plan...)."""

    total: Money
    pools: dict[Key, BudgetPool] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _tolerant(cls, data: Any) -> Any:
        """Stored versions and kept scenarios load: reserves, spillover and commit_on are dropped (owner 10-06), and
        a pool stored as an `amount` becomes its exact share of the total. The stored document is never rewritten;
        the next save simply doesn't carry them."""
        if not isinstance(data, dict):
            return data
        out = {k: v for k, v in data.items() if k not in ("reserves", "spillover", "commit_on")}
        pools = out.get("pools")
        if isinstance(pools, dict):
            try:
                total = Decimal(str(out.get("total", "0")))
            except InvalidOperation:
                total = Decimal(0)  # a bad total is refused by the field itself; no share is derived from it
            converted: dict[str, Any] = {}
            for key, pool in pools.items():
                if isinstance(pool, dict) and "amount" in pool:
                    pool = dict(pool)
                    amount = pool.pop("amount")
                    if pool.get("share_pct") is None and amount is not None and total > 0:
                        try:
                            pool["share_pct"] = str(Decimal(str(amount)) / total * HUNDRED)
                        except InvalidOperation:
                            pass  # a non-numeric amount derives no share; the missing share is refused (422)
                converted[key] = pool
            out["pools"] = converted
        return out


# --- quality checks -------------------------------------------------------------------


class QualityCheck(RulesModel):
    """One data-quality check. "hold": do not finalize until staff look. "warn": inform only.

    `award_above_cost` always holds: validation refuses a warning or a disabled one, and
    the calculator runs it whether or not the season lists it. `household_income_conflict`
    also always holds: validation refuses a warning or a disabled one here too, and
    sub-project 5 raises it at `hold` whatever the season lists.
    """

    enabled: bool = True
    severity: Literal["hold", "warn"] = "hold"
    threshold: Decimal | None = None


class QualityChecksSection(RulesModel):
    checks: dict[QualityCheckKey, QualityCheck] = Field(default_factory=dict)


# --- milestones -----------------------------------------------------------------------


class MilestonesSection(RulesModel):
    application_deadline: date | None = None
    r1_run: date | None = None
    response_deadline: date | None = None
    r2_window_start: date | None = None
    r2_window_end: date | None = None
    r3_window_start: date | None = None
    r3_window_end: date | None = None


# --- the document ---------------------------------------------------------------------


class AidRules(RulesModel):
    """One season's rules. The version number and section approvals live on the
    `aid_rules` record beside it, not in the document."""

    schema_version: Literal[1] = 1
    year: int = Field(ge=2000, le=2100)
    income: IncomeSection
    tiers: TiersSection
    equity: EquitySection
    award_tables: dict[Key, AwardTable]
    programs: dict[Key, ProgramProfile]
    cost: CostSection
    grants: GrantsSection
    awards: AwardsSection
    round2: Round2Section
    round3: Round3Section = Field(default_factory=Round3Section)
    budget: BudgetSection
    quality_checks: QualityChecksSection = Field(default_factory=QualityChecksSection)
    milestones: MilestonesSection = Field(default_factory=MilestonesSection)

    @model_validator(mode="before")
    @classmethod
    def _culled(cls, data: Any) -> Any:
        return _without(data, "stages")
