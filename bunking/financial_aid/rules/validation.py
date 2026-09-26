"""Policy checks over a structurally valid rules document.

Returns a report instead of raising, so a draft that is still wrong can be saved
and shown to staff with its problems listed. An ERROR blocks approving the
section it is in (lifecycle.approve); a WARNING never blocks.

"An unmapped session is an error, never a silent 0" needs the season's sessions,
which only the caller has: pass a ValidationContext listing them. Without one the
session-coverage check is skipped (the parity harness runs that way). A context
listing NO sessions (a season nothing has synced yet) warns instead of passing.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from bunking.financial_aid.money import pct_of
from bunking.financial_aid.rules.lookup import is_dependents_criterion, resolve_program, resolved_table
from bunking.financial_aid.rules.schema import (
    AidRules,
    QualityCheckKey,
    R1Percent,
    SectionName,
    TierTable,
    TotalPercent,
)

Severity = Literal["error", "warning"]


class ValidationIssue(BaseModel):
    model_config = ConfigDict(frozen=True)

    section: SectionName
    code: str
    severity: Severity
    path: str
    message: str


class ValidationReport(BaseModel):
    model_config = ConfigDict(frozen=True)

    issues: list[ValidationIssue] = Field(default_factory=list)

    @property
    def errors(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity == "error"]

    @property
    def warnings(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity == "warning"]

    @property
    def ok(self) -> bool:
        return not self.errors

    def errors_in(self, section: SectionName) -> list[ValidationIssue]:
        return [i for i in self.errors if i.section == section]

    def codes(self) -> set[str]:
        return {i.code for i in self.issues}


class SessionRef(BaseModel):
    model_config = ConfigDict(frozen=True)

    cm_id: int
    session_type: str | None = None
    name: str | None = None


class ValidationContext(BaseModel):
    model_config = ConfigDict(frozen=True)

    sessions: list[SessionRef] = Field(default_factory=list)


class _Issues:
    def __init__(self) -> None:
        self.items: list[ValidationIssue] = []

    def error(self, section: SectionName, code: str, path: str, message: str) -> None:
        self.items.append(ValidationIssue(section=section, code=code, severity="error", path=path, message=message))

    def warn(self, section: SectionName, code: str, path: str, message: str) -> None:
        self.items.append(ValidationIssue(section=section, code=code, severity="warning", path=path, message=message))


def validate_rules(rules: AidRules, context: ValidationContext | None = None) -> ValidationReport:
    issues = _Issues()
    _check_income(rules, issues)
    _check_tiers(rules, issues)
    _check_equity(rules, issues)
    _check_award_tables(rules, issues)
    _check_round2(rules, issues)
    _check_programs(rules, context, issues)
    _check_cost(rules, issues)
    _check_grants(rules, issues)
    _check_budget(rules, issues)
    _check_stages(rules, issues)
    _check_milestones(rules, issues)
    _check_quality_checks(rules, issues)
    return ValidationReport(issues=issues.items)


def _check_income(rules: AidRules, issues: _Issues) -> None:
    income = rules.income
    total = income.weights.prior_year + income.weights.current_year
    if total != 1:
        issues.warn(
            "income",
            "weights_do_not_sum_to_one",
            "income.weights",
            f"The prior-year and current-year weights sum to {total}, not 1",
        )
    if income.dependents_mode != "income_reduction" and income.per_dependent_reduction > 0:
        issues.warn(
            "income",
            "dependent_reduction_cannot_bind",
            "income.per_dependent_reduction",
            "The per-dependent reduction only applies when dependents_mode is income_reduction",
        )
    if (
        income.dependents_mode == "income_reduction"
        and income.per_dependent_reduction > 0
        and income.floor_applies_after == "deductions"
    ):
        issues.warn(
            "income",
            "negative_income_possible",
            "income.floor_applies_after",
            "The income floor is tested before the per-dependent reduction, so a large family can end "
            "below the first band and get no tier",
        )


def _check_tiers(rules: AidRules, issues: _Issues) -> None:
    bands = rules.tiers.bands
    if bands[0].lower != 0:
        issues.error("tiers", "first_band_not_zero", "tiers.bands.0", "The first band must start at 0")
    for i in range(1, len(bands)):
        if bands[i].lower <= bands[i - 1].lower:
            issues.error("tiers", "bands_not_increasing", f"tiers.bands.{i}", "Band lower bounds must rise")
    for i, band in enumerate(bands):
        if band.upper is not None and band.upper < band.lower:
            issues.error(
                "tiers", "band_upper_below_lower", f"tiers.bands.{i}", "A band's upper bound is below its lower"
            )
        if i + 1 < len(bands) and band.upper is not None and band.upper + 1 != bands[i + 1].lower:
            issues.warn(
                "tiers",
                "band_gap_or_overlap",
                f"tiers.bands.{i}",
                "This upper bound is not one below the next band's lower bound; the lookup uses lower bounds only",
            )
    if bands[-1].upper is not None:
        issues.warn(
            "tiers",
            "last_band_upper_not_enforced",
            f"tiers.bands.{len(bands) - 1}",
            "The last band's upper bound is not enforced; use income_ceiling to stop awards above an income",
        )
    if rules.tiers.floor_tier > len(bands):
        issues.error("tiers", "floor_tier_out_of_range", "tiers.floor_tier", "The floor tier is above the last band")


def _check_equity(rules: AidRules, issues: _Issues) -> None:
    counts = Counter(c.key for c in rules.equity.criteria)
    for key, n in counts.items():
        if n > 1:
            issues.error("equity", "duplicate_criterion", "equity.criteria", f"Criterion '{key}' appears {n} times")
    known = set(counts)
    dependents_keys = {c.key for c in rules.equity.criteria if is_dependents_criterion(c)}
    for cls, weights in rules.equity.weights.items():
        for key, weight in weights.items():
            path = f"equity.weights.{cls}.{key}"
            if key not in known:
                issues.error("equity", "unknown_criterion", path, f"Weight for unknown criterion '{key}'")
            elif key in dependents_keys and weight > 0 and rules.income.dependents_mode != "tier_shift":
                issues.warn(
                    "equity",
                    "dependents_weight_cannot_bind",
                    path,
                    "A dependents weight only applies when income.dependents_mode is tier_shift",
                )


def _check_award_tables(rules: AidRules, issues: _Issues) -> None:
    for name in _valid_tables(rules, "award_tables", rules.award_tables, "award_tables", issues):
        previous = None
        for tier, row in sorted(resolved_table(rules.award_tables, name).items()):
            if previous is not None and row.r1_pct > previous:
                issues.error(
                    "award_tables",
                    "r1_increases_with_tier",
                    f"award_tables.{name}.tiers.{tier}",
                    f"Tier {tier}: R1 % rises",
                )
            previous = row.r1_pct
        _warn_values_that_cannot_bind(rules, name, issues)


def _check_round2(rules: AidRules, issues: _Issues) -> None:
    tables = rules.round2.tables
    for name in _valid_tables(rules, "round2", tables, "round2.tables", issues):
        previous = None
        for tier, row in sorted(resolved_table(tables, name).items()):
            if previous is not None and row.total_pct > previous:
                issues.error(
                    "round2",
                    "total_increases_with_tier",
                    f"round2.tables.{name}.tiers.{tier}",
                    f"Tier {tier}: total % rises",
                )
            previous = row.total_pct
    routing = rules.round2.program_tables
    for key, table in routing.items():
        path = f"round2.program_tables.{key}"
        if key not in rules.programs:
            issues.error("round2", "unknown_program", path, f"No program '{key}'")
        if table is not None and table not in tables:
            issues.error("round2", "unknown_table", path, f"No Round 2 table '{table}'")
    for key, program in rules.programs.items():
        if program.open_to_aid and key not in routing:
            issues.error(
                "round2",
                "missing_round2_table",
                f"round2.program_tables.{key}",
                f"Program '{key}' is open to aid but does not say which Round 2 table it uses (null means none)",
            )
    _check_r1_within_total(rules, issues)


def _check_r1_within_total(rules: AidRules, issues: _Issues) -> None:
    """R1 % never above total % for any program's pair of tables. The error belongs to
    Round 2, the lever set later, so a locked Round 1 is never blamed for it."""
    pairs: set[tuple[str, str]] = set()
    for key, program in rules.programs.items():
        r2_name = rules.round2.program_tables.get(key)
        if program.open_to_aid and program.r1_table is not None and r2_name is not None:
            pairs.add((program.r1_table, r2_name))
    for r1_name, r2_name in sorted(pairs):
        try:
            r1 = resolved_table(rules.award_tables, r1_name)
            total = resolved_table(rules.round2.tables, r2_name)
        except KeyError, ValueError:
            continue  # reported where the table is defined or named
        for tier in sorted(r1.keys() & total.keys()):
            if r1[tier].r1_pct > total[tier].total_pct:
                issues.error(
                    "round2",
                    "r1_above_total",
                    f"round2.tables.{r2_name}.tiers.{tier}",
                    f"Tier {tier}: Round 1 table '{r1_name}' is above Round 2 table '{r2_name}'",
                )


def _valid_tables[V: (R1Percent, TotalPercent)](
    rules: AidRules,
    section: SectionName,
    tables: Mapping[str, TierTable[V]],
    prefix: str,
    issues: _Issues,
) -> list[str]:
    """The names of the tables that resolve, after reporting the ones that do not."""
    band_count = len(rules.tiers.bands)
    valid: list[str] = []
    for name, table in tables.items():
        path = f"{prefix}.{name}"
        if table.inherits is not None:
            parent = tables.get(table.inherits)
            if parent is None:
                issues.error(section, "unknown_parent_table", f"{path}.inherits", f"No table '{table.inherits}'")
                continue
            if parent.inherits is not None:
                issues.error(section, "nested_inheritance", f"{path}.inherits", "One level of inheritance only")
                continue
            for tier in table.overrides:
                if not 1 <= tier <= band_count:
                    issues.error(section, "override_tier_out_of_range", f"{path}.overrides.{tier}", "No such tier")
        elif set(table.tiers) != set(range(1, band_count + 1)):
            issues.error(
                section,
                "tiers_do_not_match_bands",
                f"{path}.tiers",
                f"The table must list tiers 1 to {band_count}, one per income band",
            )
            continue
        try:
            resolved_table(tables, name)
        except KeyError, ValueError:
            continue
        valid.append(name)
    return valid


def _warn_values_that_cannot_bind(rules: AidRules, name: str, issues: _Issues) -> None:
    prices = [
        rules.cost.tuition[s]
        for program in rules.programs.values()
        if program.open_to_aid and program.r1_table == name
        for s in program.session_cm_ids
        if s in rules.cost.tuition
    ]
    if not prices:
        return
    top = max(prices)
    minimum = rules.awards.minimum
    for tier, row in resolved_table(rules.award_tables, name).items():
        if pct_of(row.r1_pct, top) < minimum:
            issues.warn(
                "award_tables",
                "value_cannot_bind",
                f"award_tables.{name}.tiers.{tier}",
                f"At the dearest price routed to this table ({top}), tier {tier}'s R1 % gives "
                f"{pct_of(row.r1_pct, top)}, below the {minimum} minimum, so the minimum decides every award here",
            )


def _check_programs(rules: AidRules, context: ValidationContext | None, issues: _Issues) -> None:
    ids: dict[int, str] = {}
    types: dict[str, str] = {}
    for key, program in rules.programs.items():
        path = f"programs.{key}"
        if program.r1_table is not None and program.r1_table not in rules.award_tables:
            issues.error("programs", "unknown_table", f"{path}.r1_table", f"No award table '{program.r1_table}'")
        if program.equity_class is not None and program.equity_class not in rules.equity.weights:
            issues.error(
                "programs", "unknown_equity_class", f"{path}.equity_class", f"No equity class '{program.equity_class}'"
            )
        if program.budget_pool is not None and program.budget_pool not in rules.budget.pools:
            issues.error("programs", "unknown_budget_pool", f"{path}.budget_pool", f"No pool '{program.budget_pool}'")
        if program.open_to_aid and program.budget_pool is None:
            issues.warn("programs", "unclassified_program", f"{path}.budget_pool", "Open to aid but in no budget pool")
        if program.open_to_aid and program.r1_table is None:
            issues.warn(
                "programs",
                "no_round1_table",
                f"{path}.r1_table",
                "No Round 1 table: only the minimum award can apply in Round 1"
                if rules.awards.minimum_without_table
                else "No Round 1 table: every request in this program holds until finance names one",
            )
        for session in program.session_cm_ids:
            if session in ids and ids[session] != key:
                issues.error(
                    "programs",
                    "session_in_two_programs",
                    f"{path}.session_cm_ids",
                    f"Session {session} is in both '{ids[session]}' and '{key}'",
                )
            ids[session] = key
        for session_type in program.session_types:
            if session_type in types and types[session_type] != key:
                issues.error(
                    "programs",
                    "session_type_in_two_programs",
                    f"{path}.session_types",
                    f"Session type '{session_type}' is in both '{types[session_type]}' and '{key}'",
                )
            types[session_type] = key
    if context is None:
        return
    if not context.sessions:
        issues.warn(
            "programs",
            "no_sessions_to_check",
            "programs",
            "The season has no synced sessions, so no session could be checked for a program; "
            "approve again after the sessions sync",
        )
        return
    for ref in context.sessions:
        if resolve_program(rules, ref.cm_id, ref.session_type) is None:
            label = f" ({ref.name})" if ref.name else ""
            issues.error(
                "programs",
                "unmapped_session",
                "programs",
                f"Session {ref.cm_id}{label} belongs to no program; map it (or put it in a closed program)",
            )


def _check_cost(rules: AidRules, issues: _Issues) -> None:
    counts = Counter(r.session_cm_id for r in rules.cost.family_rates)
    for session, n in counts.items():
        if n > 1:
            issues.error("cost", "duplicate_family_rate", "cost.family_rates", f"Session {session} has {n} rates")
    for key, program in rules.programs.items():
        if not program.open_to_aid:
            continue
        path = f"programs.{key}.session_cm_ids"
        if program.cost_source == "per_person":
            missing = [s for s in program.session_cm_ids if s not in counts]
            if missing:
                issues.warn("cost", "family_rate_missing", path, f"No family-camp rate for sessions {missing}")
        elif program.cost_source == "catalog":
            missing = [s for s in program.session_cm_ids if s not in rules.cost.tuition]
            if missing:
                issues.warn("cost", "tuition_missing", path, f"No tuition for sessions {missing}")


def _check_grants(rules: AidRules, issues: _Issues) -> None:
    for key in rules.grants.offset_programs:
        if key not in rules.programs:
            issues.error("grants", "unknown_program", "grants.offset_programs", f"No program '{key}'")


def _check_budget(rules: AidRules, issues: _Issues) -> None:
    pools = rules.budget.pools
    kinds = {"share" if p.share_pct is not None else "amount" for p in pools.values()}
    if len(kinds) > 1:
        issues.error("budget", "mixed_pool_kinds", "budget.pools", "Pools must all be shares or all be amounts")
    elif kinds == {"share"}:
        total = sum((p.share_pct for p in pools.values() if p.share_pct is not None), start=0)
        if total != 100:
            issues.error("budget", "pool_shares_not_100", "budget.pools", f"Pool shares sum to {total}%, not 100%")
    elif kinds == {"amount"}:
        total = sum((p.amount for p in pools.values() if p.amount is not None), start=0)
        if total != rules.budget.total:
            issues.error(
                "budget", "pool_amounts_not_total", "budget.pools", f"Pools sum to {total}, not {rules.budget.total}"
            )
    for pool, per_round in rules.budget.reserves.items():
        path = f"budget.reserves.{pool}"
        if pool not in pools:
            issues.error("budget", "unknown_reserve_pool", path, f"No pool '{pool}'")
        if sum(per_round.values(), start=0) > 100:
            issues.error("budget", "reserves_exceed_pool", path, "Reserves exceed 100% of the pool")


def _check_stages(rules: AidRules, issues: _Issues) -> None:
    counts = Counter(s.code for s in rules.stages.stages)
    for code, n in counts.items():
        if n > 1:
            issues.error("stages", "duplicate_stage", "stages.stages", f"Stage '{code}' appears {n} times")
    for stage in rules.stages.stages:
        if stage.decision_type is not None and stage.decision_type not in rules.awards.decision_types:
            issues.error(
                "stages",
                "unknown_decision_type",
                "stages.stages",
                f"Stage '{stage.code}' names unknown decision type '{stage.decision_type}'",
            )


_MILESTONE_ORDER: tuple[tuple[str, str], ...] = (
    ("application_deadline", "r1_run"),
    ("r1_run", "response_deadline"),
    ("r2_window_start", "r2_window_end"),
    ("r3_window_start", "r3_window_end"),
)


def _check_milestones(rules: AidRules, issues: _Issues) -> None:
    milestones = rules.milestones
    for earlier, later in _MILESTONE_ORDER:
        a, b = getattr(milestones, earlier), getattr(milestones, later)
        if a is not None and b is not None and a > b:
            issues.error("milestones", "milestones_out_of_order", f"milestones.{later}", f"{later} is before {earlier}")


# Checks that compare against a threshold, and cannot fire without one.
_THRESHOLD_CHECKS: tuple[QualityCheckKey, ...] = (
    "income_above",
    "expense_above",
    "placeholder_income",
    "implausible_dependents",
)


def _check_quality_checks(rules: AidRules, issues: _Issues) -> None:
    above_cost = rules.quality_checks.checks.get("award_above_cost")
    if above_cost is not None and (not above_cost.enabled or above_cost.severity != "hold"):
        issues.error(
            "quality_checks",
            "award_above_cost_must_hold",
            "quality_checks.checks.award_above_cost",
            "The above-cost check always holds: it cannot be switched off or made a warning",
        )
    for key in _THRESHOLD_CHECKS:
        check = rules.quality_checks.checks.get(key)
        if check is not None and check.enabled and check.threshold is None:
            issues.warn(
                "quality_checks",
                "check_has_no_threshold",
                f"quality_checks.checks.{key}.threshold",
                f"The '{key}' check is on but has no threshold, so it can never fire",
            )
