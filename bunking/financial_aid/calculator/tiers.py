"""Income tier, equity shift and final tier (catalogue sections 2.2-2.3).

The income tier is the household's. The final tier is the request's:
    final = max(floor_tier, income tier - shift)
where the shift sums this program's equity-class weights over the criteria the
household and this camper meet, then rounds to whole tiers (ceil in 2026, so
one 0.5 weight is a full tier, and 0.5 + 0.5 is still one).

A criterion is met if its `field` OR any of its `also_fields` qualifies under
the criterion's match rule (ruling P6a) -- it still contributes its weight
once, however many of its fields match.
"""

from __future__ import annotations

from decimal import ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP, Decimal

from bunking.financial_aid.calculator.inputs import AnswerValue, ApplicationInputs, RequestInputs
from bunking.financial_aid.calculator.result import TraceStep
from bunking.financial_aid.errors import FinancialAidError
from bunking.financial_aid.money import ONE, ZERO
from bunking.financial_aid.rules.lookup import is_dependents_criterion
from bunking.financial_aid.rules.schema import AidRules, EquityCriterion, ProgramProfile

_ROUNDING = {"ceil": ROUND_CEILING, "round": ROUND_HALF_UP, "floor": ROUND_FLOOR}


class UnknownEquityClassError(FinancialAidError, KeyError):
    """A program names an equity class the season defines no weights for.

    A shift of 0 there would be a silent 0 (spec principle 5); the engine turns
    this into a rules_error result, as it does a missing award table (ruling P2).
    """

    def __init__(self, program_class: str) -> None:
        super().__init__(program_class)
        self.equity_class = program_class

    def __str__(self) -> str:
        return f"Equity class '{self.equity_class}' has no weights in this season's rules"


def income_tier(income: Decimal, rules: AidRules) -> int | None:
    """The highest band whose lower bound the income reaches, or None below the first."""
    tier: int | None = None
    for number, band in enumerate(rules.tiers.bands, start=1):
        if income >= band.lower:
            tier = number
    return tier


def _answer(
    criterion: EquityCriterion, field: str, application: ApplicationInputs, request: RequestInputs
) -> AnswerValue:
    if criterion.source == "household":
        if is_dependents_criterion(criterion) and field == criterion.field:
            return application.dependents
        return application.answers.get(field)
    return request.equity_answers.get(field)


def _value_matches(criterion: EquityCriterion, value: AnswerValue) -> bool:
    if criterion.match == "at_least":
        if isinstance(value, bool) or not isinstance(value, int | Decimal) or criterion.min_value is None:
            return False
        return Decimal(value) >= criterion.min_value
    if not isinstance(value, str):
        return False
    text = value.lower()
    wanted = [v.lower() for v in criterion.values]
    if criterion.match == "equals_any":
        return text in wanted
    return any(v in text for v in wanted)


def criterion_met(criterion: EquityCriterion, application: ApplicationInputs, request: RequestInputs) -> bool:
    for field in (criterion.field, *criterion.also_fields):
        value = _answer(criterion, field, application, request)
        if _value_matches(criterion, value):
            return True
    return False


def equity_shift(
    application: ApplicationInputs, request: RequestInputs, program: ProgramProfile, rules: AidRules
) -> tuple[int, TraceStep]:
    equity = rules.equity
    if program.equity_class is None:
        return 0, TraceStep(key="equity_shift", label="Equity shift", value=0, note="This program has no equity class")
    if program.equity_class not in equity.weights:
        raise UnknownEquityClassError(program.equity_class)
    weights = equity.weights[program.equity_class]
    total = ZERO
    met: list[str] = []
    for criterion in equity.criteria:
        if is_dependents_criterion(criterion) and rules.income.dependents_mode != "tier_shift":
            continue
        if criterion_met(criterion, application, request):
            met.append(criterion.key)
            total += weights.get(criterion.key, ZERO)
    shift = int(total.quantize(ONE, rounding=_ROUNDING[equity.aggregation]))
    bound = None
    if equity.max_shift is not None and shift > equity.max_shift:
        shift, bound = equity.max_shift, "max_shift"
    step = TraceStep(
        key="equity_shift",
        label="Equity shift",
        value=shift,
        inputs={
            "equity_class": program.equity_class,
            "criteria_met": ",".join(met),
            "weight_sum": total,
            "aggregation": equity.aggregation,
        },
        bound=bound,
    )
    return shift, step


def final_tier(tier: int, shift: int, rules: AidRules) -> tuple[int, str | None]:
    shifted = tier - shift
    if shifted < rules.tiers.floor_tier:
        return rules.tiers.floor_tier, "tier_floor"
    return shifted, None
