"""calculate(): one request's award under one season's rules (campership design section 8).

Pure: no I/O, no clock, no logging of amounts. The order is the 2026 sheet's,
because the 2026 rules document must reproduce it row for row:

  household income -> income tier -> equity shift -> final tier (per request)
  -> cost -> outside grants -> Round 1 potential -> minimum -> ask cap -> R1
  -> Round 2 cap -> R2 -> Round 3 -> total-aid cap -> named top-ups -> total

Each quirk the sheet had is a setting, never a branch on the year: the income
floor tested before the dependent reduction (income.floor_applies_after), the
minimum paid on top of grants (grants.minimum_after_grants), the Round 2 cap
that ignores grants (round2.cap_subtracts_grants), a program with no Round 1
table (programs.<key>.r1_table = null).

An unknown -- a program not in the rules, a cost nobody set, an income below
the first band, an income figure the rules need that was not reported, a rules
draft naming a table, tier or equity class that is not there -- is an explicit
issue on the result, never a silent 0.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from decimal import Decimal

from bunking.financial_aid.calculator.cost import CostResolution, resolve_cost
from bunking.financial_aid.calculator.grants import grants_offset, grants_since_round1, incentive_adjustments
from bunking.financial_aid.calculator.income import describe_missing, household_income, nothing_reported
from bunking.financial_aid.calculator.inputs import ApplicationInputs, RequestInputs
from bunking.financial_aid.calculator.quality import run_quality_checks
from bunking.financial_aid.calculator.result import (
    CalcIssue,
    CalcResult,
    IssueSeverity,
    TraceStep,
    TraceValue,
    status_of,
)
from bunking.financial_aid.calculator.tiers import UnknownEquityClassError, equity_shift, final_tier, income_tier
from bunking.financial_aid.money import HUNDRED, ZERO, floor_dollars, pct_of, round_dollars
from bunking.financial_aid.rules.lookup import resolved_table
from bunking.financial_aid.rules.schema import (
    AidRules,
    DecisionType,
    ProgramProfile,
    R1Percent,
    TierTable,
    TotalPercent,
)


@dataclass
class _Work:
    """Working state for one calculation, frozen into a CalcResult at the end."""

    trace: list[TraceStep] = field(default_factory=list)
    issues: list[CalcIssue] = field(default_factory=list)
    adjusted_income: Decimal | None = None
    income_tier: int | None = None
    equity_shift: int | None = None
    final_tier: int | None = None
    cost: Decimal | None = None
    grants_offset: Decimal | None = None
    # Grants Round 1 left out as late that count in the appeal and after it (owner ruling S5).
    grants_since_round1: Decimal = ZERO
    r1_potential: Decimal | None = None
    r1: Decimal | None = None
    r1_bound: str | None = None
    r2_cap: Decimal | None = None
    r2: Decimal | None = None
    r2_bound: str | None = None
    r3: Decimal | None = None
    r3_bound: str | None = None
    top_up: Decimal | None = None
    discretionary: Decimal = ZERO
    total: Decimal | None = None

    def step(
        self,
        key: str,
        label: str,
        value: TraceValue,
        *,
        inputs: dict[str, TraceValue] | None = None,
        bound: str | None = None,
        note: str | None = None,
    ) -> None:
        self.trace.append(TraceStep(key=key, label=label, value=value, inputs=inputs or {}, bound=bound, note=note))

    def retrace(self, key: str, value: Decimal, bound: str, *, before: Decimal | None) -> None:
        """Rewrite step `key` to the value a later limit cut it to, so the trace never disagrees with the result."""
        for i, existing in enumerate(self.trace):
            if existing.key == key:
                self.trace[i] = existing.model_copy(
                    update={
                        "value": value,
                        "bound": bound,
                        "inputs": {**existing.inputs, "before_total_cap": before},
                        "note": "Cut to fit the total-aid cap",
                    }
                )

    def issue(self, code: str, severity: IssueSeverity, message: str, step: str | None = None) -> None:
        self.issues.append(CalcIssue(code=code, severity=severity, message=message, step=step))

    def result(self) -> CalcResult:
        return CalcResult(
            status=status_of(self.issues),
            adjusted_income=self.adjusted_income,
            income_tier=self.income_tier,
            equity_shift=self.equity_shift,
            final_tier=self.final_tier,
            cost=self.cost,
            grants_offset=self.grants_offset,
            r1_potential=self.r1_potential,
            r1=self.r1,
            r1_bound=self.r1_bound,
            r2_cap=self.r2_cap,
            r2=self.r2,
            r2_bound=self.r2_bound,
            r3=self.r3,
            r3_bound=self.r3_bound,
            top_up=self.top_up,
            discretionary=self.discretionary,
            total=self.total,
            trace=list(self.trace),
            issues=list(self.issues),
        )


def calculate(application: ApplicationInputs, request: RequestInputs, rules: AidRules) -> CalcResult:
    work = _Work(discretionary=request.discretionary_amount)
    income = household_income(application, rules)
    work.trace.extend(income.trace)
    work.adjusted_income = income.adjusted_income

    program = rules.programs.get(request.program_key)
    if program is None:
        work.issue(
            "unknown_program", "error", f"Program '{request.program_key}' is not in the {rules.year} rules", "program"
        )
        return work.result()
    if not program.open_to_aid:
        work.issue(
            "program_closed", "error", f"Program '{request.program_key}' is not open to aid in {rules.year}", "program"
        )
        return work.result()
    decision = _decision_type(work, request, rules)
    if request.decision_type is not None and decision is None:
        return work.result()
    adjusted_income = income.adjusted_income
    if adjusted_income is None:
        # An unreported figure is not an income of 0: pricing it would land on a lower tier
        # (all of them absent lands on tier 1, the most generous). A reported 0 is a real
        # answer and is priced normally. See income.py for which figures are "needed".
        if nothing_reported(application):
            message = "No income figure was reported and there is no income override, so the request cannot be priced"
        else:
            message = (
                f"The {describe_missing(income.missing_figures)} income figure is needed by the {rules.year} "
                "rules but was not reported, so the request cannot be priced"
            )
        work.issue("income_missing", "needs_input", message, "adjusted_income")
        return work.result()

    tier = income_tier(adjusted_income, rules)
    if tier is None:
        work.issue(
            "income_below_first_band",
            "error",
            "Adjusted income is below the first income band, so it has no tier",
            "income_tier",
        )
        return work.result()
    work.income_tier = tier
    work.step("income_tier", "Income tier", tier, inputs={"adjusted_income": adjusted_income})
    try:
        shift, shift_step = equity_shift(application, request, program, rules)
    except UnknownEquityClassError as exc:
        # Ruling P2 extended (I2): a draft naming an equity class with no weights is a
        # rules error, never a silent shift of 0.
        work.issue(
            "rules_error",
            "error",
            f"Program '{request.program_key}' names equity class '{exc.equity_class}', "
            f"which has no weights in the {rules.year} rules",
            "equity_shift",
        )
        return work.result()
    work.trace.append(shift_step)
    work.equity_shift = shift
    final, tier_bound = final_tier(tier, shift, rules)
    work.final_tier = final
    work.step("final_tier", "Final tier", final, inputs={"income_tier": tier, "equity_shift": shift}, bound=tier_bound)

    cost = resolve_cost(request, rules)
    work.issues.extend(cost.issues)
    reduce_cost, reduce_award, incentive_issues = incentive_adjustments(request, rules)
    work.issues.extend(incentive_issues)
    work.cost = None if cost.amount is None else max(cost.amount - reduce_cost, ZERO)
    work.step(
        "cost",
        "Cost",
        work.cost,
        inputs={"source": cost.source, "resolved": cost.amount, "incentive_reduction": reduce_cost},
        note=cost.missing,
    )

    grants, grant_issues, grant_step = grants_offset(request, rules)
    work.issues.extend(grant_issues)
    work.trace.append(grant_step)
    work.grants_offset = grants
    work.grants_since_round1 = grants_since_round1(request, rules)

    ceiling = rules.tiers.income_ceiling
    above_ceiling = ceiling is not None and adjusted_income > ceiling
    _round1(work, request, rules, program, decision, cost, final, reduce_award, above_ceiling=above_ceiling)
    _round2(work, request, rules, decision, final, above_ceiling=above_ceiling)
    _round3(work, request, rules, decision, above_ceiling=above_ceiling)
    _total_cap(work, rules)
    _top_up(work, decision, above_ceiling=above_ceiling)
    _discretionary(work, decision, above_ceiling=above_ceiling)
    _total(work)
    work.issues.extend(
        run_quality_checks(
            application,
            request,
            rules,
            program,
            income,
            income_tier=tier,
            cost=work.cost,
            total=work.total,
            r1=work.r1,
            later_rounds=(work.r2 or ZERO) + (work.r3 or ZERO),
            extra_amount=decision.extra_amount if decision is not None else ZERO,
        )
    )
    return work.result()


def _decision_type(work: _Work, request: RequestInputs, rules: AidRules) -> DecisionType | None:
    if request.decision_type is None:
        return None
    decision = rules.awards.decision_types.get(request.decision_type)
    if decision is None:
        work.issue(
            "unknown_decision_type",
            "error",
            f"Decision type '{request.decision_type}' is not in the {rules.year} rules",
            "decision_type",
        )
    return decision


def _tier_value[V: (R1Percent, TotalPercent)](
    work: _Work, tables: Mapping[str, TierTable[V]], kind: str, table: str, tier: int, step: str
) -> V | None:
    """Table `table`'s value for `tier` (`kind` names the table for staff), or None with a rules_error issue.

    Scenarios run the engine against rules DRAFTS, which may name a table that is
    not there, lack a tier, or inherit too deeply. Only those lookup failures
    (KeyError, ValueError) become an issue; anything else is a bug and propagates.
    """
    try:
        return resolved_table(tables, table)[tier]
    except KeyError as exc:
        missing = exc.args[0] if exc.args else None
        if isinstance(missing, int):
            message = f"{kind} '{table}' (with what it inherits) has no tier {missing}; final tier is {tier}"
        else:
            message = f"{kind} '{missing}' does not exist (needed to resolve table '{table}')"
    except ValueError as exc:
        message = f"{kind} '{table}' cannot be resolved: {exc}"
    work.issue("rules_error", "error", message, step)
    return None


def _round1(
    work: _Work,
    request: RequestInputs,
    rules: AidRules,
    program: ProgramProfile,
    decision: DecisionType | None,
    cost: CostResolution,
    tier: int,
    reduce_award: Decimal,
    *,
    above_ceiling: bool,
) -> None:
    awards = rules.awards
    if above_ceiling:
        work.r1_potential, work.r1, work.r1_bound = ZERO, ZERO, "income_ceiling"
        work.step(
            "r1", "Round 1 award", ZERO, bound="income_ceiling", note="Adjusted income is above the income ceiling"
        )
        return
    if decision is not None and decision.kind == "full_cost":
        pct, source = HUNDRED, "full_cost"
    elif program.r1_table is None:
        if not awards.minimum_without_table:
            # Holds until finance names a table (owner ruling 2026-09-25), never a silent $0.
            work.r1_bound = "no_table"
            work.issue(
                "no_round1_table",
                "needs_input",
                f"Program '{request.program_key}' has no Round 1 table and the minimum does not apply without "
                "one; the request holds until finance names a table",
                "r1",
            )
            return
        pct, source = ZERO, "no_table"
    else:
        row = _tier_value(work, rules.award_tables, "Award table", program.r1_table, tier, "r1_pct")
        if row is None:
            return
        pct, source = row.r1_pct, "table"
    work.step("r1_pct", "Round 1 percentage", pct, inputs={"table": program.r1_table, "tier": tier, "source": source})

    grants = work.grants_offset or ZERO  # set by the grants step, which always runs before Round 1
    if work.cost is None:
        if not awards.minimum_when_cost_unknown:
            work.issue(
                "cost_unknown", "needs_input", f"Cost is unknown ({cost.missing}); Round 1 cannot be computed", "r1"
            )
            work.r1_bound = "cost_unknown"
            return
        work.issue("cost_unknown", "warn", f"Cost is unknown ({cost.missing}); the minimum award was used", "r1")
        potential, bound = awards.minimum, "minimum"
    else:
        base = pct_of(pct, work.cost)
        if rules.grants.offset_mode == "dollar":
            before_minimum = base - grants
        else:
            before_minimum = pct_of(pct, max(work.cost - grants, ZERO))
        fully_covered = grants > 0 and grants >= work.cost
        if fully_covered and not rules.grants.minimum_when_fully_covered:
            potential = max(before_minimum, ZERO)
        elif rules.grants.minimum_after_grants:
            potential = max(before_minimum, awards.minimum)
        else:
            potential = max(before_minimum, awards.minimum - grants, ZERO)
        bound = source
        if potential > before_minimum:
            bound = "grants_cover" if potential == ZERO else "minimum"
    work.r1_potential = potential
    work.step(
        "r1_potential",
        "Round 1 potential",
        potential,
        inputs={"pct": pct, "cost": work.cost, "grants": grants, "minimum": awards.minimum},
        bound=bound,
    )
    raw = potential
    if awards.ask_cap:
        if request.ask is None:
            work.issue(
                "ask_missing",
                "needs_input",
                "No ask was entered, and the ask caps Round 1 this season; Round 1 cannot be computed",
                "r1",
            )
            work.r1_bound = "ask_missing"
            return
        if request.ask < potential:
            raw, bound = request.ask, "ask"
    r1 = round_dollars(raw)
    note = None
    if reduce_award > 0:
        r1 = max(r1 - reduce_award, ZERO)
        note = f"Reduced by an incentive of {reduce_award}"
    work.r1, work.r1_bound = r1, bound
    work.step("r1", "Round 1 award", r1, inputs={"ask": request.ask, "potential": potential}, bound=bound, note=note)


def _round2(
    work: _Work,
    request: RequestInputs,
    rules: AidRules,
    decision: DecisionType | None,
    tier: int,
    *,
    above_ceiling: bool,
) -> None:
    appeal = request.appeal_amount
    if appeal is None:
        return
    if above_ceiling:
        work.r2, work.r2_bound = ZERO, "income_ceiling"
        work.step("r2", "Round 2 award", ZERO, inputs={"appeal": appeal}, bound="income_ceiling")
        return
    if decision is not None and not decision.allows_appeal:
        work.issue(
            "appeal_not_allowed",
            "warn",
            f"Decision type '{request.decision_type}' does not allow an appeal; Round 2 is 0",
            "r2",
        )
        work.r2, work.r2_bound = ZERO, "not_allowed"
        work.step("r2", "Round 2 award", ZERO, inputs={"appeal": appeal}, bound="not_allowed")
        return
    if request.program_key not in rules.round2.program_tables:
        work.issue(
            "rules_error",
            "error",
            f"Program '{request.program_key}' does not say which Round 2 table it uses in the {rules.year} rules",
            "r2_cap",
        )
        return
    r2_table = rules.round2.program_tables[request.program_key]
    if r2_table is None:
        work.r2, work.r2_bound = ZERO, "no_table"
        work.step("r2", "Round 2 award", ZERO, inputs={"appeal": appeal}, bound="no_table", note="No Round 2 table")
        return
    if work.cost is None:
        work.issue("cost_unknown", "needs_input", "Cost is unknown; the Round 2 cap cannot be computed", "r2_cap")
        work.r2_bound = "cost_unknown"
        return
    if work.r1 is None:
        # Round 1 already failed and said why (a rules error, a missing ask); Round 2 is
        # built on it, so it is not computed either -- without blaming the cost.
        work.r2_bound = "r1_unknown"
        return
    row = _tier_value(work, rules.round2.tables, "Round 2 table", r2_table, tier, "r2_cap")
    if row is None:
        return
    total_pct = row.total_pct
    cap = pct_of(total_pct, work.cost) - work.r1
    if rules.round2.cap_subtracts_grants:
        cap -= (work.grants_offset or ZERO) + work.grants_since_round1
    cap_bound = "cap"
    if rules.round2.cap_by_original_ask:
        if request.ask is None:
            work.issue(
                "ask_missing",
                "needs_input",
                "No ask was entered, and the original ask caps Round 2 this season; Round 2 cannot be computed",
                "r2_cap",
            )
            work.r2_bound = "ask_missing"
            return
        if request.ask - work.r1 < cap:
            cap, cap_bound = request.ask - work.r1, "original_ask"
    work.r2_cap = cap
    work.step(
        "r2_cap",
        "Round 2 cap",
        cap,
        inputs={
            "total_pct": total_pct,
            "cost": work.cost,
            "r1": work.r1,
            "grants_subtracted": rules.round2.cap_subtracts_grants,
            "grants_since_round1": work.grants_since_round1,
        },
        bound=cap_bound,
    )
    raw, bound = (appeal, "appeal") if appeal <= cap else (cap, cap_bound)
    r2 = round_dollars(raw)
    if r2 < 0:
        work.issue(
            "r2_cap_negative", "warn", "Round 1 is already above the Round 2 cap; Round 2 is 0, not negative", "r2"
        )
        r2 = ZERO
    work.r2, work.r2_bound = r2, bound
    work.step("r2", "Round 2 award", r2, inputs={"appeal": appeal, "cap": cap}, bound=bound)


def _round3(
    work: _Work,
    request: RequestInputs,
    rules: AidRules,
    decision: DecisionType | None,
    *,
    above_ceiling: bool,
) -> None:
    amount = request.round3_amount
    if amount is None:
        return
    settings = rules.round3
    if above_ceiling:
        work.r3, work.r3_bound = ZERO, "income_ceiling"
        work.step("r3", "Round 3 award", ZERO, inputs={"requested": amount}, bound="income_ceiling")
        return
    if decision is not None and not decision.allows_appeal:
        work.issue(
            "round3_not_allowed",
            "warn",
            f"Decision type '{request.decision_type}' does not allow an appeal; Round 3 is 0",
            "r3",
        )
        work.r3, work.r3_bound = ZERO, "not_allowed"
        work.step("r3", "Round 3 award", ZERO, inputs={"requested": amount}, bound="not_allowed")
        return
    missing = []
    if settings.require_round2 and not request.round2_decided:
        missing.append("a Round 2 decision")
    if settings.require_statement_of_need and not request.round3_statement_of_need:
        missing.append("a statement of need")
    if missing:
        work.issue("round3_not_eligible", "warn", "Round 3 needs " + " and ".join(missing), "r3")
        work.r3, work.r3_bound = ZERO, "not_eligible"
        work.step("r3", "Round 3 award", ZERO, inputs={"requested": amount}, bound="not_eligible")
        return
    raw, bound = amount, "request"
    if settings.max_amount is not None and settings.max_amount < raw:
        raw, bound = settings.max_amount, "max_amount"
    if settings.max_total_pct_of_cost is not None:
        if work.cost is None:
            work.issue("cost_unknown", "needs_input", "Cost is unknown; the Round 3 limit cannot be computed", "r3")
            work.r3_bound = "cost_unknown"
            return
        if work.r1 is None:
            work.r3_bound = "r1_unknown"  # Round 1 already said why
            return
        room = max(pct_of(settings.max_total_pct_of_cost, work.cost) - work.r1 - (work.r2 or ZERO), ZERO)
        if room < raw:
            raw, bound = room, "cap"
    work.r3 = floor_dollars(raw) if bound == "cap" else round_dollars(raw)
    work.r3_bound = bound
    work.step("r3", "Round 3 award", work.r3, inputs={"requested": amount}, bound=bound)


def _total_cap(work: _Work, rules: AidRules) -> None:
    """Caps Round 2 then Round 3. Round 1, top-ups and discretionary money are never cut."""
    cap = rules.round2.total_cap
    if cap is None or (work.r2 is None and work.r3 is None):
        return
    if work.cost is None:
        work.issue("cost_unknown", "needs_input", "Cost is unknown; the total-aid cap cannot be computed", "total_cap")
        return
    if work.r1 is None:
        return  # Round 1 already said why; there is nothing to cap against
    grants = (work.grants_offset or ZERO) + work.grants_since_round1
    limit = pct_of(cap.pct_of_cost, work.cost) - (grants if cap.include_grants else ZERO)
    r2_before, r3_before = work.r2, work.r3
    room = max(limit - work.r1, ZERO)
    if work.r2 is not None and work.r2 > room:
        work.r2, work.r2_bound = floor_dollars(room), "total_cap"
        work.retrace("r2", work.r2, "total_cap", before=r2_before)
    room = max(room - (work.r2 or ZERO), ZERO)
    if work.r3 is not None and work.r3 > room:
        work.r3, work.r3_bound = floor_dollars(room), "total_cap"
        work.retrace("r3", work.r3, "total_cap", before=r3_before)
    work.step(
        "total_cap",
        "Total-aid cap",
        limit,
        inputs={
            "pct_of_cost": cap.pct_of_cost,
            "include_grants": cap.include_grants,
            "r2_before": r2_before,
            "r2_after": work.r2,
            "r3_before": r3_before,
            "r3_after": work.r3,
        },
    )


def _top_up(work: _Work, decision: DecisionType | None, *, above_ceiling: bool) -> None:
    if decision is None or decision.kind == "discretionary":
        work.top_up = ZERO  # evaluated: this request has no named top-up
        return
    if above_ceiling and not decision.ceiling_exempt:
        work.top_up = ZERO
        work.step(
            "top_up",
            f"Top-up: {decision.label}",
            ZERO,
            inputs={"kind": decision.kind},
            bound="income_ceiling",
            note="Adjusted income is above the income ceiling",
        )
        return
    note = None
    if decision.kind == "top_up":
        amount = decision.amount if decision.amount is not None else ZERO
    else:
        if work.cost is None:
            work.issue(
                "cost_unknown", "needs_input", "Cost is unknown; the full-cost top-up cannot be computed", "top_up"
            )
            return
        if work.r1 is None:
            return  # Round 1 already said why; the top-up is measured against it
        target = work.cost - (work.grants_offset or ZERO) + decision.extra_amount
        amount = max(round_dollars(target - work.r1 - (work.r2 or ZERO) - (work.r3 or ZERO)), ZERO)
        note = "Brings the total to the cost, less grants, plus the named extra"
    work.top_up = amount
    work.step("top_up", f"Top-up: {decision.label}", amount, inputs={"kind": decision.kind}, note=note)


def _discretionary(work: _Work, decision: DecisionType | None, *, above_ceiling: bool) -> None:
    """Withholds a typed discretionary amount above the income ceiling, and says so."""
    typed = work.discretionary
    if typed == 0 or not above_ceiling or (decision is not None and decision.ceiling_exempt):
        return
    work.discretionary = ZERO
    work.issue(
        "above_income_ceiling",
        "warn",
        "Adjusted income is above the income ceiling, so the typed discretionary amount was withheld",
        "discretionary",
    )
    work.step("discretionary", "Discretionary amount", ZERO, inputs={"withheld": typed}, bound="income_ceiling")


def _total(work: _Work) -> None:
    # A rules_error already blanks r1 by returning before it is set (see _tier_value).
    # A Round 2/3 rules_error or a cost_unknown needs_input can strike after r1 is already
    # computed, so the total needs its own guard: neither an error nor an unresolved
    # needs_input ever produces a total, only r1/r2/r3 taken individually do.
    if work.r1 is None or work.top_up is None or status_of(work.issues) in ("error", "needs_input"):
        return
    work.total = work.r1 + (work.r2 or ZERO) + (work.r3 or ZERO) + work.top_up + work.discretionary
    work.step(
        "total",
        "Total award",
        work.total,
        inputs={
            "r1": work.r1,
            "r2": work.r2,
            "r3": work.r3,
            "top_up": work.top_up,
            "discretionary": work.discretionary,
        },
    )
