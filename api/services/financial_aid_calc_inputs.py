"""Application + request (+ corrections, + the rules version pricing it) -> the calculator's
inputs (sub-project 3), and the checks only intake can see (spec 10.5).

The calculator is pure. This is the only bridge from intake's records to its input types,
and it reads EFFECTIVE values (spec 9.3), so a staff correction prices the award while the
synced value stays visible elsewhere.

Unknowns stay unknown (spec principle 5):
* a blank income figure is None, so the calculator returns needs_input instead of pricing a
  blank as $0 (tier 1, the most generous). A reported $0 is Decimal 0 and is priced; the
  rules' placeholder_income check then holds it (spec 2 item 22). A figure the family's
  applications disagree on is None too, until staff choose one (spec 8);
* a blank ask is None (SP3's ask cap then asks for input), never 0;
* a blank dependents count, expense, savings or figure is None, which SP3 counts as 0;
* a family-camp headcount with no source is None, not 0 heads;
* a household-level request has no single camper, so its equity answers are left out.
  A household is never treated as answering "no".

The calculator's program key is the RULES program that claims the request's session
(resolve_program), never intake's FA question: the rules name programs their own way
(the 2026 document keys B*Mitzvah as "tbm" and splits the adult weekends). A session no
program claims is blocked with a reason, never guessed.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Final, get_args

from api.services.financial_aid_corrections import (
    INCOME_OVERRIDE_FIELD,
    REQUEST_CORRECTABLE,
    STAFF_ENTERED,
    EffectiveValue,
    effective_values,
)
from api.services.financial_aid_household import BOOL_FIELDS
from api.services.financial_aid_intake_types import (
    FLAG_AWAITING_RULES,
    FLAG_DUPLICATE_SURVIVOR_WITHDRAWN,
    STATUS_ACTIVE,
    STATUS_UNMATCHED,
    UNKNOWN_EQUITY,
    ApplicationRecord,
    CorrectionRecord,
    EquityAnswers,
    PayerShareRecord,
    RequestRecord,
    SessionRow,
)
from api.services.financial_aid_payer_shares import share_status
from api.services.financial_aid_request_overrides import cost_override as request_cost_override
from bunking.financial_aid.calculator import ApplicationInputs, CalcIssue, CostOverride, IncomeOverride, RequestInputs
from bunking.financial_aid.calculator.inputs import AnswerValue, Headcount
from bunking.financial_aid.rules import resolve_program
from bunking.financial_aid.rules.schema import AidRules, IncomeFigure, QualityCheckKey

INTAKE_STEP: Final = "intake"
_LIVE: Final = frozenset({STATUS_ACTIVE, STATUS_UNMATCHED})


@dataclass(frozen=True)
class CalculatorInputs:
    request_id: str
    application: ApplicationInputs
    request: RequestInputs | None  # None when `blocked` says why the request cannot be priced
    issues: tuple[CalcIssue, ...] = ()
    blocked: str = ""


class NotCalculableError(ValueError):
    """The request is missing something the calculator cannot do without (a session)."""


def _money(value: EffectiveValue) -> Decimal | None:
    return Decimal(value.effective) if value.effective != "" else None


def _count(value: EffectiveValue) -> int | None:
    return int(value.effective) if value.effective != "" else None


def _yes_no(value: object) -> str | None:
    """CampMinder booleans arrive as bool or "true"/"false" text; unknown is None."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return "Yes" if value else "No"
    text = str(value).strip().lower()
    if text in {"true", "yes", "1"}:
        return "Yes"
    if text in {"false", "no", "0"}:
        return "No"
    return None


def _known(pairs: Mapping[str, AnswerValue]) -> dict[str, AnswerValue]:
    """Drop unknowns: a missing answer is never passed as "No" or ""."""
    return {k: v for k, v in pairs.items() if v not in (None, "")}


def _income_override(value: EffectiveValue) -> IncomeOverride | None:
    if not value.effective:
        return None
    mode, _, amount = value.effective.partition(":")
    if mode == STAFF_ENTERED:
        return IncomeOverride(mode="staff_entered", amount=Decimal(amount))
    return IncomeOverride.model_validate({"mode": mode})


def to_application_inputs(household_cm_id: int, answers: Mapping[str, EffectiveValue]) -> ApplicationInputs:
    figures: dict[Any, Decimal | None] = {figure: _money(answers[figure]) for figure in get_args(IncomeFigure)}
    return ApplicationInputs(
        household_cm_id=household_cm_id,
        prior_year_gross=_money(answers["total_gross_income"]),
        prior_year_agi=_money(answers["total_adjusted_income"]),
        prior_year_confirmed=_money(answers["income_confirmed"]),
        current_year_gross=_money(answers["expected_gross_income"]),
        medical_expenses=_money(answers["total_medical_expenses"]),
        education_expenses=_money(answers["total_edu_expenses"]),
        savings=_money(answers["non_retirement_savings"]),
        dependents=_count(answers["num_children"]),
        figures=figures,
        answers=_known({name: _yes_no(answers[name].effective) for name in BOOL_FIELDS}),
        income_override=_income_override(answers[INCOME_OVERRIDE_FIELD]),
    )


def rules_program_key(request: RequestRecord, sessions: Mapping[int, SessionRow], rules: AidRules) -> str | None:
    session = sessions.get(request.session_cm_id)
    return resolve_program(rules, request.session_cm_id, session.session_type if session is not None else None)


def to_request_inputs(
    request: RequestRecord,
    ask: EffectiveValue,
    equity: EquityAnswers | None,
    program_key: str,
    cost_override: CostOverride | None = None,
) -> RequestInputs:
    if request.session_cm_id <= 0:
        raise NotCalculableError("an unmatched request has no session and cannot be priced")
    household_level = request.person_cm_id == 0
    known_headcount = household_level and request.headcount_source != ""
    answers = UNKNOWN_EQUITY if household_level or equity is None else equity
    return RequestInputs(
        person_cm_id=None if household_level else request.person_cm_id,
        session_cm_id=request.session_cm_id,
        program_key=program_key,
        ask=_money(ask),
        cost_override=cost_override,
        headcount=(
            Headcount(standard=request.headcount_non_infant, infants=request.headcount_infant)
            if known_headcount
            else None
        ),
        equity_answers=_known(
            {
                "bipoc": _yes_no(answers.bipoc),
                "gender_identity": answers.gender_identity or None,
                "pronouns": answers.pronouns or None,
            }
        ),
    )


def _hold(code: str, message: str) -> CalcIssue:
    return CalcIssue(code=code, severity="hold", message=message, step=INTAKE_STEP)


def _check_issue(rules: AidRules | None, key: QualityCheckKey, message: str) -> CalcIssue | None:
    """At the rules' severity when they list the check (none when they switch it off);
    otherwise hold, the default for every check (spec 10.5)."""
    check = rules.quality_checks.checks.get(key) if rules is not None else None
    if check is not None and not check.enabled:
        return None
    severity = check.severity if check is not None else "hold"
    return CalcIssue(code=key, severity=severity, message=message, step=INTAKE_STEP)


def awaiting_approved_rules(request: RequestRecord) -> bool:
    return any(flag.get("code") == FLAG_AWAITING_RULES for flag in request.flags)


def unresolved_income_conflict(
    application_flags: Sequence[Mapping[str, Any]], answers: Mapping[str, EffectiveValue]
) -> bool:
    """An income_conflict whose fields staff have not all corrected, and no income override."""
    if answers[INCOME_OVERRIDE_FIELD].effective:
        return False
    for flag in application_flags:
        if flag.get("code") == "income_conflict":
            fields = dict(flag.get("detail", {})).get("fields", {})
            return any(not answers[name].corrected for name in fields if name in answers)
    return False


def request_issues(
    request: RequestRecord,
    application_flags: Sequence[Mapping[str, Any]],
    answers: Mapping[str, EffectiveValue],
    shares: Sequence[PayerShareRecord],
    rules: AidRules | None,
) -> list[CalcIssue]:
    found: list[CalcIssue | None] = []
    if unresolved_income_conflict(application_flags, answers):
        # Always a hold, whatever the rules list (owner ruling 2026-09-25; validation refuses anything else).
        found.append(
            _hold(
                "household_income_conflict",
                "The family's applications report different income figures: call the family and enter the one to use",
            )
        )
    if awaiting_approved_rules(request):
        found.append(
            _hold(
                FLAG_AWAITING_RULES,
                "Waiting for finance to approve this season's programs and cost rules; intake resolves it after",
            )
        )
    if any(flag.get("code") == FLAG_DUPLICATE_SURVIVOR_WITHDRAWN for flag in request.flags):
        # Always a hold (owner ruling 2026-09-26): the shares and any decision are on the old request.
        found.append(
            _hold(
                FLAG_DUPLICATE_SURVIVOR_WITHDRAWN,
                "The request this one duplicated was withdrawn, so this one is live again: its payer "
                "shares and any decision stayed on the withdrawn request; check them before awarding",
            )
        )
    if request.session_cm_id <= 0:
        found.append(_check_issue(rules, "unmatched_session", "The requested session is not matched: resolve it"))
    if request.status in _LIVE and share_status([s for s in shares if s.request_id == request.id]) == "incomplete":
        found.append(_hold("payer_shares_incomplete", "The payer shares do not add up to 100%"))
    return [issue for issue in found if issue is not None]


def effective_ask(request: RequestRecord, corrections: Sequence[CorrectionRecord]) -> EffectiveValue:
    """The request's ask after staff corrections (a blank ask stays blank, never 0)."""
    return effective_values({"ask": request.ask or None}, REQUEST_CORRECTABLE, corrections, request.id)["ask"]


def priced_program(
    request: RequestRecord, sessions: Mapping[int, SessionRow], rules: AidRules
) -> tuple[str | None, str]:
    """The program a live request with an application is priced under, or None and why it has none.
    The decisions service's past-date read resolves a request's program and pool through it too, so a
    past date and today place a request alike."""
    if awaiting_approved_rules(request):
        return None, "waiting for approved rules: the next intake run after finance approves them resolves it"
    if request.session_cm_id <= 0:
        return None, "the session is unmatched"
    program_key = rules_program_key(request, sessions, rules)
    if program_key is None:
        return None, f"no program in the {rules.year} rules claims session {request.session_cm_id}"
    return program_key, ""


def calculator_inputs(
    request: RequestRecord,
    application: ApplicationRecord,
    answers: Mapping[str, EffectiveValue],
    corrections: Sequence[CorrectionRecord],
    sessions: Mapping[int, SessionRow],
    shares: Sequence[PayerShareRecord],
    equity: EquityAnswers | None,
    rules: AidRules,
) -> CalculatorInputs:
    """One live request converted under `rules`, the version the caller prices with. Nothing is
    dropped: a request that can't be priced comes back with request=None and the reason in
    `blocked`. Shared by casework (one family) and the decisions service (the season, sub-project 10a)."""
    issues = tuple(request_issues(request, application.flags, answers, shares, rules))
    app_inputs = to_application_inputs(application.household_cm_id, answers)
    program_key, reason = priced_program(request, sessions, rules)
    if program_key is None:
        return CalculatorInputs(request.id, app_inputs, None, issues, reason)
    ask = effective_ask(request, corrections)
    override = request_cost_override(request.id, corrections)
    return CalculatorInputs(
        request.id, app_inputs, to_request_inputs(request, ask, equity, program_key, cost_override=override), issues
    )
