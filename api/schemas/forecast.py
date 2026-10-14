"""Pydantic models for registration forecast response.

Per-session forecast data with budget goals and revenue projections.
"""

from typing import Literal

from pydantic import BaseModel, Field


class WeekOption(BaseModel):
    week_number: int = Field(description="1-based week number from registration anchor")
    day_offset: int = Field(description="Days since registration anchor (canonical param for forecast)")
    label: str = Field(description="Display label, e.g. 'Week 5 · Nov 19'")
    is_today: bool = Field(description="Whether this entry represents today's live data")


class SessionForecast(BaseModel):
    session_cm_id: int = Field(description="Session CampMinder ID")
    session_name: str = Field(description="Session display name")
    session_type: str = Field(description="main, embedded, ag")
    participant_goal: int | None = Field(None, description="Target enrollment from budget config")
    session_fee: float | None = Field(None, description="Per-participant fee from budget config")
    enrolled: int = Field(description="Current enrolled count")
    waitlisted: int | None = Field(
        description="Current waitlist count; None in week mode (a past waitlist cannot be rebuilt)"
    )
    pct_of_goal: float | None = Field(None, description="enrolled / goal * 100")
    prior_year_count: int | None = Field(None, description="Same session name, year-1")
    two_year_prior_count: int | None = Field(None, description="Same session name, year-2")
    participants_vs_budget: int | None = Field(None, description="enrolled - participant_goal")
    participants_vs_prior_year: int | None = Field(None, description="enrolled - prior_year_count")
    budget_revenue: float | None = Field(None, description="goal * fee")
    actual_revenue: float | None = Field(None, description="enrolled * fee")
    revenue_delta: float | None = Field(None, description="actual_revenue - budget_revenue")
    revenue_pct: float | None = Field(None, description="actual / budget * 100")
    enrolled_boys: int | None = Field(None, description="Enrolled male count (from reconstruction or live)")
    enrolled_girls: int | None = Field(None, description="Enrolled female count (from reconstruction or live)")


class ForecastPriorTotals(BaseModel):
    prior_year_count: int | None = Field(None, description="Last year's whole-scope total for this section")
    two_year_prior_count: int | None = Field(None, description="Two years ago's whole-scope total for this section")


class ForecastResponse(BaseModel):
    year: int
    sessions: list[SessionForecast] = Field(description="Per-session forecast data")
    grand_total: SessionForecast = Field(description="Summed totals across sessions")
    week_number: int | None = Field(None, description="Week number relative to registration anchor")
    day_offset: int | None = Field(None, description="Days since registration anchor")
    prior_basis: Literal["same_point", "final"] = Field(
        "final",
        description="same_point: prior years counted at the same registration day; final: their final enrollment",
    )
    section_priors: dict[str, ForecastPriorTotals] = Field(
        default_factory=dict,
        description="Prior whole-scope totals by section: camp (main/embedded/ag), quest, teen (scit/tli)",
    )
