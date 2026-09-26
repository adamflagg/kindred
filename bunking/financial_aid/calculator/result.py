"""What the calculator returns: the award, every intermediate figure, and the trace.

The application screen renders `trace` directly (it replaces the sheet's "read
across the row"): each step has a label, its inputs, its value, and which limit
bound it -- "ask", "table", "minimum", "cap", "full_cost", and so on.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

TraceValue = Decimal | int | str | bool | None
IssueSeverity = Literal["error", "needs_input", "hold", "warn"]
CalcStatus = Literal["ok", "needs_input", "error"]


class TraceStep(BaseModel):
    model_config = ConfigDict(frozen=True)

    key: str
    label: str
    value: TraceValue = None
    inputs: dict[str, TraceValue] = Field(default_factory=dict)
    bound: str | None = None
    note: str | None = None


class CalcIssue(BaseModel):
    """error / needs_input set the result's status; hold / warn come from quality checks."""

    model_config = ConfigDict(frozen=True)

    code: str
    severity: IssueSeverity
    message: str
    step: str | None = None


class CalcResult(BaseModel):
    """One request's award.

    Every figure is None until the step that computes it has run: a result that
    stops early (an unknown program, missing income, a rules error) leaves the later
    figures None, never 0. A figure that WAS evaluated and came to nothing is 0.

    `status` says whether the award could be computed: "error", "needs_input" or
    "ok". It does not summarise the data-quality checks. An "ok" result can still
    carry a `hold` issue, which means "do not finalize until staff look" -- so a
    caller must check `issues` for severity "hold" as well as `status`.
    """

    model_config = ConfigDict(frozen=True)

    status: CalcStatus
    adjusted_income: Decimal | None
    income_tier: int | None
    equity_shift: int | None
    final_tier: int | None
    cost: Decimal | None
    grants_offset: Decimal | None
    r1_potential: Decimal | None
    r1: Decimal | None
    r1_bound: str | None
    r2_cap: Decimal | None
    r2: Decimal | None
    r2_bound: str | None
    r3: Decimal | None
    r3_bound: str | None
    top_up: Decimal | None
    discretionary: Decimal
    total: Decimal | None
    trace: list[TraceStep]
    issues: list[CalcIssue]

    def step(self, key: str) -> TraceStep:
        for s in self.trace:
            if s.key == key:
                return s
        raise KeyError(key)

    def issue_codes(self) -> set[str]:
        return {i.code for i in self.issues}


def status_of(issues: list[CalcIssue]) -> CalcStatus:
    severities = {i.severity for i in issues}
    if "error" in severities:
        return "error"
    if "needs_input" in severities:
        return "needs_input"
    return "ok"
