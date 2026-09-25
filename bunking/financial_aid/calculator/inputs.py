"""What the calculator reads: one household application and one request.

Income, and so the income tier, belong to the HOUSEHOLD (ApplicationInputs).
The final tier belongs to each REQUEST: it adds the program's equity class and
that camper's own answers (RequestInputs.equity_answers). Nothing here is
computed. Sub-project 5 builds these from the synced application with staff
corrections already applied.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Literal, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from bunking.financial_aid.rules.schema import Money

AnswerValue = str | int | Decimal | bool | None


class _Input(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class IncomeOverride(_Input):
    """A reviewer's choice of which income figure to trust for this household."""

    mode: Literal["prior_year_only", "current_year_only", "confirmed_prior_year", "staff_entered"]
    amount: Decimal | None = None

    @model_validator(mode="after")
    def _amount_only_when_staff_entered(self) -> Self:
        if (self.mode == "staff_entered") != (self.amount is not None):
            raise ValueError("amount is required for staff_entered and not allowed for the other modes")
        return self


class ApplicationInputs(_Input):
    """One household's application for one season.

    Income figures left as None are UNKNOWN, not 0. When the season's rules need a
    figure (its weight is above 0, or an override picks it) and it is None, the
    calculator returns needs_input rather than pricing it (spec principle 5). A
    reported 0 is a real answer and is priced.

    Expenses, savings and dependents left as None DO count as 0: a blank there means
    the family has none, so 0 is the honest reading, not a guess.
    """

    household_cm_id: int | None = None
    prior_year_gross: Decimal | None = None
    prior_year_agi: Decimal | None = None
    prior_year_confirmed: Decimal | None = None
    current_year_gross: Decimal | None = None
    medical_expenses: Decimal | None = None
    education_expenses: Decimal | None = None
    savings: Decimal | None = None
    dependents: int | None = Field(default=None, ge=0)
    # Household-level equity answers, keyed by the criterion's `field` (e.g. "unemployment").
    answers: dict[str, AnswerValue] = Field(default_factory=dict)
    income_override: IncomeOverride | None = None


class GrantInput(_Input):
    """One outside grant already matched to this camper by person id (sub-project 6)."""

    amount: Money
    state: Literal["committed", "received"]
    recorded_at: AwareDatetime | None = None


class IncentiveInput(_Input):
    key: str
    amount: Money


class CostOverride(_Input):
    amount: Money
    reason: str = Field(min_length=1)


class Headcount(_Input):
    """Family-camp headcount.

    `standard` counts every non-infant person priced at the standard rate, parents
    included. `children` counts the children priced at the season's child rate, and
    a child counted there must NOT also be counted in `standard` -- the three counts
    are disjoint and the cost is standard x rate + infants x rate + children x rate.
    When the season sets no child rate, children are priced at the standard rate, so
    counting them in either field gives the same cost; count each person once.
    """

    standard: int = Field(ge=0)
    infants: int = Field(default=0, ge=0)
    children: int = Field(default=0, ge=0)


class RequestInputs(_Input):
    """One request: a camper x session, or a household x session for family camp.

    `ask` must be given, and may be None when the family left it blank. When the
    ask caps an award (awards.ask_cap, round2.cap_by_original_ask) a None ask makes
    the result needs_input; it is never read as an ask of 0.

    `discretionary_amount` is always added to the total, whatever the decision
    type -- including under a full_cost decision, where it comes on top of the
    top-up that already brings the award to cost. Staff who do not want both must
    leave it at 0.
    """

    person_cm_id: int | None = None
    session_cm_id: int | None = None
    program_key: str
    ask: Money | None
    # This camper's own equity answers, keyed by the criterion's `field` (e.g. "bipoc").
    equity_answers: dict[str, AnswerValue] = Field(default_factory=dict)
    cost_override: CostOverride | None = None
    headcount: Headcount | None = None
    grants_applicable: list[GrantInput] = Field(default_factory=list)
    incentives: list[IncentiveInput] = Field(default_factory=list)
    appeal_amount: Money | None = None
    round2_decided: bool = False
    round3_amount: Money | None = None
    round3_statement_of_need: bool = False
    decision_type: str | None = None
    discretionary_amount: Money = Decimal(0)
    r1_decided_at: AwareDatetime | None = None
