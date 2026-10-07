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
from collections.abc import Mapping, Sequence
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from bunking.financial_aid.money import dollars, pct_of
from bunking.financial_aid.rules.groups import group_of_class
from bunking.financial_aid.rules.lookup import (
    Round2TableNotListedError,
    is_dependents_criterion,
    resolve_program,
    resolved_table,
    round1_table,
    round2_table,
)
from bunking.financial_aid.rules.schema import (
    RETIRED_YES_NO_FIELDS,
    YES_NO_ANSWER_FIELDS,
    AidRules,
    EquityCriterion,
    ProgramProfile,
    QualityCheckKey,
    R1Percent,
    SectionName,
    TierTable,
    TotalPercent,
)

Severity = Literal["error", "warning", "note"]


class ValidationIssue(BaseModel):
    model_config = ConfigDict(frozen=True)

    section: SectionName
    code: str
    severity: Severity
    path: str
    message: str
    # The sessions the issue is about (a missing price or rate), so the UI can mark them. Optional: most issues name none.
    session_cm_ids: list[int] = Field(default_factory=list)


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
    def notes(self) -> list[ValidationIssue]:
        """Information, not a problem: never counted as a warning and never blocks anything."""
        return [i for i in self.issues if i.severity == "note"]

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
    # camp_sessions.parent_id: an AG session's main session (spec §8). None when it has none.
    parent_id: int | None = None


def _ag_children(context: ValidationContext | None) -> frozenset[int]:
    """AG sessions with a parent: priced at their parent's price, so never listed as missing one (spec §8)."""
    if context is None:
        return frozenset()
    return frozenset(r.cm_id for r in context.sessions if r.session_type == "ag" and r.parent_id)


def _not_running(rules: AidRules, context: ValidationContext | None) -> frozenset[int]:
    """Sessions finance marked not running, and the AG sessions under them (spec §7.1: derived, never stored)."""
    listed = set(rules.cost.not_running_session_cm_ids)
    children = {
        r.cm_id for r in (context.sessions if context else []) if r.parent_id in listed and r.session_type == "ag"
    }
    return frozenset(listed | children)


class ValidationContext(BaseModel):
    model_config = ConfigDict(frozen=True)

    sessions: list[SessionRef] = Field(default_factory=list)


class _Issues:
    def __init__(self) -> None:
        self.items: list[ValidationIssue] = []

    def error(
        self, section: SectionName, code: str, path: str, message: str, session_cm_ids: Sequence[int] = ()
    ) -> None:
        self._add("error", section, code, path, message, session_cm_ids)

    def warn(
        self, section: SectionName, code: str, path: str, message: str, session_cm_ids: Sequence[int] = ()
    ) -> None:
        self._add("warning", section, code, path, message, session_cm_ids)

    def note(self, section: SectionName, code: str, path: str, message: str) -> None:
        self._add("note", section, code, path, message, ())

    def _add(
        self,
        severity: Severity,
        section: SectionName,
        code: str,
        path: str,
        message: str,
        session_cm_ids: Sequence[int],
    ) -> None:
        self.items.append(
            ValidationIssue(
                section=section,
                code=code,
                severity=severity,
                path=path,
                message=message,
                session_cm_ids=list(session_cm_ids),
            )
        )


def validate_rules(rules: AidRules, context: ValidationContext | None = None) -> ValidationReport:
    issues = _Issues()
    _check_income(rules, issues)
    _check_tiers(rules, issues)
    _check_equity(rules, issues)
    _check_award_tables(rules, issues)
    _check_round2(rules, issues)
    _check_programs(rules, context, issues)
    _check_cost(rules, context, issues)
    _check_grants(rules, issues)
    _check_budget(rules, issues)
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
    dependents_keys = {c.key for c in rules.equity.criteria if is_dependents_criterion(c) and c.enabled}
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
    for i, criterion in enumerate(rules.equity.criteria):
        field = _yes_no_field_matching_no(criterion)
        if field is not None:
            issues.error(
                "equity",
                "yes_no_criterion_matches_no",
                f"equity.criteria.{i}.values",
                f"Criterion '{criterion.key}' matches No on the yes/no answer '{field}'. A blank answer is "
                "stored as No, so this would give the weight to every family that never answered; match yes only",
            )
        retired = _retired_field_referenced(criterion)
        if retired is not None:
            issues.error(
                "equity",
                "retired_household_field",
                f"equity.criteria.{i}",
                f"Criterion '{criterion.key}' points at '{retired}', a household question retired from the "
                "aid form: it is never live, so this criterion would never fire. Remove it or point it at a "
                "live field",
            )


# How a No can reach a criterion: the calculator passes "No", and other spellings of it are
# refused too, so a rules author cannot mean No by another name.
_NO_SPELLINGS = frozenset({"no", "n", "false", "f", "0"})


def _yes_no_field_matching_no(criterion: EquityCriterion) -> str | None:
    """The household yes/no field this criterion would meet on a No, or None."""
    if criterion.source != "household" or criterion.match == "at_least":
        return None
    values = [v.lower() for v in criterion.values]
    matches_no = any(v in _NO_SPELLINGS for v in values) or (
        criterion.match == "contains_any" and any(v in "no" for v in values)
    )
    if not matches_no:
        return None
    return next((f for f in (criterion.field, *criterion.also_fields) if f in YES_NO_ANSWER_FIELDS), None)


def _retired_field_referenced(criterion: EquityCriterion) -> str | None:
    """The retired household field this criterion (or one of its also_fields) points at, or
    None. Guarded by source the same way as the No-matching check: a camper-sourced field
    happens to share a name with a household one sometimes, and that is not this."""
    if criterion.source != "household":
        return None
    return next((f for f in (criterion.field, *criterion.also_fields) if f in RETIRED_YES_NO_FIELDS), None)


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
        _note_values_that_cannot_bind(rules, name, issues)


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
        # §9.9: only a legacy program says which Round 2 table it uses; by class, the class says.
        if program.open_to_aid and not program.table_from_equity_class and key not in routing:
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
        if not program.open_to_aid:
            continue
        r1_name = round1_table(rules, program)
        try:
            r2_name = round2_table(rules, key)
        except Round2TableNotListedError:
            continue  # reported as missing_round2_table
        if r1_name is not None and r2_name is not None:
            pairs.add((r1_name, r2_name))
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


def _class_words(rules: AidRules, key: str) -> str:
    """An award table's or an equity class's staff-facing words (spec §9.2): the label of the group whose class it
    is, else the key's words in sentence case, as the front end's keyWords. Never `.title()`: an acronym key would
    read "Ffp". A12 adds the borrowed-label fallback here, between the two."""
    group = group_of_class(rules, key)
    if group is not None:
        return group.label
    words = key.replace("_", " ")
    return words[:1].upper() + words[1:]


def _table_label(rules: AidRules, name: str) -> str:
    """The award table's staff-facing name: "‹group label› table" (spec §9.2), else "‹key words› table"."""
    return f"{_class_words(rules, name)} table"


def _catalog_price(rules: AidRules, program: ProgramProfile) -> Decimal | None:
    """The dearest catalog tuition among the program's sessions, or None when none has one."""
    prices = [rules.cost.tuition[s] for s in program.session_cm_ids if s in rules.cost.tuition]
    return max(prices) if prices else None


def _note_values_that_cannot_bind(rules: AidRules, name: str, issues: _Issues) -> None:
    """A note for each tier where the minimum award, not the table, decides a routed program's award.

    Judged per program, and only for programs priced from the catalog: a per-person or typed program's real
    price is not the catalog's. If the minimum decides at the dearest routed program it decides for every
    cheaper one, so the note says so; otherwise it names the dearest program it does decide for."""
    routed = [
        (program, price)
        for program in rules.programs.values()
        if program.open_to_aid
        and program.cost_source == "catalog"
        and round1_table(rules, program) == name
        and (price := _catalog_price(rules, program)) is not None
    ]
    if not routed:
        return
    minimum = rules.awards.minimum
    for tier, row in sorted(resolved_table(rules.award_tables, name).items()):
        decided = [(program, price) for program, price in routed if pct_of(row.r1_pct, price) < minimum]
        if not decided:
            continue
        program, price = max(decided, key=lambda pair: pair[1])
        award = pct_of(row.r1_pct, price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        message = (
            f"{_table_label(rules, name)}, tier {tier}: {program.label} at {dollars(price)} gets {dollars(award)}, "
            f"so the {dollars(minimum)} minimum applies"
        )
        if len(routed) > 1 and len(decided) == len(routed):
            message += ", and to every cheaper program on this table"
        issues.note("award_tables", "value_cannot_bind", f"award_tables.{name}.tiers.{tier}", message)


def _check_programs(rules: AidRules, context: ValidationContext | None, issues: _Issues) -> None:
    ids: dict[int, str] = {}
    types: dict[str, str] = {}
    for key, program in rules.programs.items():
        path = f"programs.{key}"
        label = program.label
        # A program that claims no sessions prices nothing yet: no table or pool is missing from anything real.
        claims_sessions = bool(program.session_cm_ids or program.session_types)
        if program.equity_class is not None and program.equity_class not in rules.equity.weights:
            issues.error(
                "programs",
                "unknown_equity_class",
                f"{path}.equity_class",
                f"{label}: no equity class '{program.equity_class}'",
            )
        if program.budget_pool is not None and program.budget_pool not in rules.budget.pools:
            issues.error(
                "programs", "unknown_budget_pool", f"{path}.budget_pool", f"{label}: no pool '{program.budget_pool}'"
            )
        if program.open_to_aid and program.budget_pool is None and claims_sessions:
            issues.warn(
                "programs", "unclassified_program", f"{path}.budget_pool", f"{label}: open to aid but in no budget pool"
            )
        if not program.table_from_equity_class:
            if program.r1_table is not None and program.r1_table not in rules.award_tables:
                issues.error(
                    "programs", "unknown_table", f"{path}.r1_table", f"{label}: no award table '{program.r1_table}'"
                )
            if program.open_to_aid and program.r1_table is None and claims_sessions:
                issues.warn(
                    "programs",
                    "no_round1_table",
                    f"{path}.r1_table",
                    f"{label}: no Round 1 table: only the minimum award can apply in Round 1"
                    if rules.awards.minimum_without_table
                    else f"{label}: no Round 1 table: every request in this program holds until finance names one",
                )
        elif program.open_to_aid and program.equity_class is None:
            issues.warn(
                "programs",
                "no_equity_class",
                f"{path}.equity_class",
                f"Open to aid but no equity class, so no award table: its requests hold ({program.label})",
            )
        # A closed program prices nothing, and an unknown class is already its own error above.
        elif (
            program.open_to_aid
            and program.equity_class in rules.equity.weights
            and (program.equity_class not in rules.award_tables or program.equity_class not in rules.round2.tables)
        ):
            missing = "Round 1 award table" if program.equity_class not in rules.award_tables else "appeal caps table"
            issues.error(
                "programs",
                "class_without_table",
                f"{path}.equity_class",
                f"{label}: equity class '{program.equity_class}' has no {missing}",
            )
        for session in program.session_cm_ids:
            if session in ids and ids[session] != key:
                issues.error(
                    "programs",
                    "session_in_two_programs",
                    f"{path}.session_cm_ids",
                    f"{label}: session {session} is also in {rules.programs[ids[session]].label}",
                )
            ids[session] = key
        for session_type in program.session_types:
            if session_type in types and types[session_type] != key:
                issues.error(
                    "programs",
                    "session_type_in_two_programs",
                    f"{path}.session_types",
                    f"{label}: session type '{session_type}' is also in {rules.programs[types[session_type]].label}",
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
    refs = {r.cm_id: r for r in context.sessions}
    skip = _not_running(rules, context)
    for ref in context.sessions:
        if ref.cm_id in skip:
            continue
        ag_parent = (
            (ref.parent_id, refs[ref.parent_id].session_type if ref.parent_id in refs else None)
            if ref.parent_id
            else None
        )
        if resolve_program(rules, ref.cm_id, ref.session_type, ag_parent=ag_parent) is None:
            label = f" ({ref.name})" if ref.name else ""
            issues.error(
                "programs",
                "unmapped_session",
                "programs",
                f"Session {ref.cm_id}{label} belongs to no program; map it (or put it in a closed program)",
            )


def _session_names(ids: Sequence[int], context: ValidationContext | None) -> str:
    """ "Session One, Session Two and session 1000123": the season's names where it has them."""
    names = {ref.cm_id: ref.name for ref in context.sessions if ref.name} if context is not None else {}
    parts = [names.get(i) or f"session {i}" for i in ids]
    return parts[0] if len(parts) == 1 else f"{', '.join(parts[:-1])} and {parts[-1]}"


def _check_cost(rules: AidRules, context: ValidationContext | None, issues: _Issues) -> None:
    counts = Counter(r.session_cm_id for r in rules.cost.family_rates)
    skip = _ag_children(context) | _not_running(rules, context)
    for session, n in counts.items():
        if n > 1:
            issues.error("cost", "duplicate_family_rate", "cost.family_rates", f"Session {session} has {n} rates")
    for key, program in rules.programs.items():
        if not program.open_to_aid:
            continue
        path = f"programs.{key}.session_cm_ids"
        if program.cost_source == "per_person":
            missing = [s for s in program.session_cm_ids if s not in counts and s not in skip]
            if missing:
                issues.warn(
                    "cost",
                    "family_rate_missing",
                    path,
                    f"{program.label}: no family-camp rate for {_session_names(missing, context)}",
                    missing,
                )
        elif program.cost_source == "catalog":
            missing = [s for s in program.session_cm_ids if s not in rules.cost.tuition and s not in skip]
            if missing:
                issues.warn(
                    "cost",
                    "tuition_missing",
                    path,
                    f"{program.label}: no tuition for {_session_names(missing, context)}",
                    missing,
                )
    if context is not None and context.sessions:
        known = {r.cm_id for r in context.sessions}
        unknown = [s for s in dict.fromkeys(rules.cost.not_running_session_cm_ids) if s not in known]
        if unknown:
            issues.warn(
                "cost",
                "not_running_unknown_session",
                "cost.not_running_session_cm_ids",
                f"{', '.join(str(s) for s in unknown)} is marked not running but isn't a session in {rules.year}",
                unknown,
            )


def _check_grants(rules: AidRules, issues: _Issues) -> None:
    for key in rules.grants.offset_programs:
        if key not in rules.programs:
            issues.error("grants", "unknown_program", "grants.offset_programs", f"No program '{key}'")
    # Spec §13 / D55: grant receipts are parked, so no grant is ever "received"; under that
    # setting no grant would offset any award. Remove this when receipts are built.
    if rules.grants.count_when == "received":
        issues.error(
            "grants",
            "grants_count_when_received",
            "grants.count_when",
            "Grant receipts aren't recorded yet, so under 'received' no grant would offset any award; keep 'committed'",
        )


def _check_budget(rules: AidRules, issues: _Issues) -> None:
    pools = rules.budget.pools
    total = sum((p.share_pct for p in pools.values()), start=Decimal(0))
    if pools and total != 100:
        issues.error(
            "budget", "pool_shares_not_100", "budget.pools", f"Pool shares sum to {total.normalize():f}%, not 100%"
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


# Checks that always hold (owner rulings 2026-09-25): never above cost, and an income
# conflict across a family's applications. Neither can be switched off or made a warning.
_HOLD_ONLY_CHECKS: tuple[tuple[QualityCheckKey, str], ...] = (
    ("award_above_cost", "The above-cost check always holds: it cannot be switched off or made a warning"),
    (
        "household_income_conflict",
        "The income-conflict check always holds (staff call the family and choose the figure): "
        "it cannot be switched off or made a warning",
    ),
)


def _check_quality_checks(rules: AidRules, issues: _Issues) -> None:
    for key, message in _HOLD_ONLY_CHECKS:
        check = rules.quality_checks.checks.get(key)
        if check is not None and (not check.enabled or check.severity != "hold"):
            issues.error("quality_checks", f"{key}_must_hold", f"quality_checks.checks.{key}", message)
    for key in _THRESHOLD_CHECKS:
        check = rules.quality_checks.checks.get(key)
        if check is not None and check.enabled and check.threshold is None:
            issues.warn(
                "quality_checks",
                "check_has_no_threshold",
                f"quality_checks.checks.{key}.threshold",
                f"The '{key}' check is on but has no threshold, so it can never fire",
            )
