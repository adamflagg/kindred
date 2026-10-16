"""Pydantic models for registration velocity response."""

from typing import Literal

from pydantic import BaseModel, Field

# #2898 owner answer #78: Velocity's split reads the Gender field (cabin pacing, the default) or gender identity.
GenderBasis = Literal["field", "identity"]


class DailyDataPoint(BaseModel):
    date: str = Field(description="ISO date YYYY-MM-DD")
    day_offset: int = Field(description="Days since season start. 0 = Day 1 (priority reg day)")
    gross_enrolled: int = Field(description="Cumulative gross enrollments through this day")
    enrolled: int = Field(description="Cumulative net enrolled (gross - cancelled) through this day")
    cancelled: int = Field(description="Cumulative cancellations through this day")
    daily_new: int = Field(0, description="New enrollments on this day")
    daily_cancelled: int = Field(0, description="Cancellations on this day")
    daily_new_boys: int | None = Field(None, description="New boy enrollments on this day")
    daily_new_girls: int | None = Field(None, description="New girl enrollments on this day")
    daily_cancelled_boys: int | None = Field(None, description="Boy cancellations on this day")
    daily_cancelled_girls: int | None = Field(None, description="Girl cancellations on this day")
    gross_enrolled_boys: int | None = Field(None)
    gross_enrolled_girls: int | None = Field(None)
    enrolled_boys: int | None = Field(None)
    enrolled_girls: int | None = Field(None)
    data_source: str = Field(description="'snapshot', 'reconstructed', or 'mixed'")


class WeeklyDataPoint(BaseModel):
    week_number: int = Field(description="1-based week offset from season start")
    week_label: str = Field(description="Human-readable label like 'Wk 1 (Nov 12–18)'")
    week_start: str = Field(description="ISO date of the first day of this week bucket")
    week_end: str = Field(description="ISO date of the last day of this week bucket")
    is_partial: bool = Field(False, description="True if current week is incomplete")
    days_in_week: int = Field(7, description="Days elapsed in this week bucket (1-7)")
    enrolled: int = Field(description="Cumulative net enrolled at end of this week")
    gross_enrolled: int = Field(0, description="Cumulative gross enrolled at end of this week")
    weekly_new: int = Field(0, description="Sum of daily new enrollments across this week")
    weekly_cancelled: int = Field(0, description="Sum of daily cancellations across this week")
    delta: int = Field(description="weekly_new - weekly_cancelled")
    enrolled_boys: int | None = Field(None)
    enrolled_girls: int | None = Field(None)
    gross_enrolled_boys: int | None = Field(None)
    gross_enrolled_girls: int | None = Field(None)
    weekly_new_boys: int | None = Field(None)
    weekly_new_girls: int | None = Field(None)
    weekly_cancelled_boys: int | None = Field(None)
    weekly_cancelled_girls: int | None = Field(None)
    data_source: str = Field(description="'snapshot', 'reconstructed', or 'mixed'")


class VelocityCurve(BaseModel):
    year: int
    session_cm_id: int | None = Field(None, description="None = combined across sessions")
    session_name: str | None = None
    gender: str | None = Field(
        None,
        description=(
            "None=all; Gender field split: 'M'=boys, 'F'=girls; gender identity split: one of the five groups "
            "(Girl/woman, Boy/man, Non-binary, Another identity, No answer)"
        ),
    )
    weekly: list[WeeklyDataPoint]
    daily: list[DailyDataPoint] = Field(
        default_factory=list, description="Daily granularity data for cumulative charts"
    )


class PriorYearVelocity(BaseModel):
    year: int
    daily: list[DailyDataPoint] = Field(default_factory=list)
    weekly: list[WeeklyDataPoint] = Field(default_factory=list)
    at_current_point: int | None = Field(
        None,
        description=(
            "This year's value on the same registration day as the current year's latest point "
            "(greatest day_offset <= current_day_offset). Enrollment metric: net enrolled; "
            "cancellation metric: cumulative cancelled. Falls back to the week lookup when daily data is missing."
        ),
    )


class PhaseMarker(BaseModel):
    phase: str = Field(description="Registration phase: priority, early, open")
    date: str = Field(description="ISO date")
    label: str = Field(description="Display label")
    week_number: int = Field(description="1-based week offset from season start")


class SessionGenderBreakdown(BaseModel):
    session_cm_id: int
    session_name: str | None = None
    boys_enrolled: int
    girls_enrolled: int
    by_identity: dict[str, int] = Field(
        default_factory=dict,
        description="Gender identity split only: count per identity group with any campers; empty on the Gender field",
    )


class PriorYearCancelledSummary(BaseModel):
    year: int
    cancelled_at_current_week: int | None = Field(
        None, description="Cancelled count on the same registration day (day offset) as the current year's latest"
    )
    cancelled_final: int | None = Field(
        None, description="Total cancelled for that year; None when the year has no cancellation data"
    )
    has_cancellation_data: bool = Field(
        True, description="False exactly when cancelled_final is None for lack of cancellation history"
    )


class PriorYearSessionSummary(BaseModel):
    year: int
    session_name: str | None = None
    session_cm_id: int | None = None
    current_session_cm_id: int | None = Field(
        None,
        description=(
            "The current-year session this prior session is 'the same session' as "
            "(cm_id, then alias group, then exact name); None when no current session matches"
        ),
    )
    enrolled_at_current_week: int | None = Field(
        None,
        description=(
            "Prior session's value on the same registration day (day offset) as the current year's latest point "
            "(cancellation metric: cumulative cancelled); field name kept for API stability"
        ),
    )
    final_enrolled: int = Field(description="Last enrollment value for this session in prior year")


class GenderHistoryGap(BaseModel):
    """Cancellation Velocity, split by gender: how much of a season's total the gender lines cannot show.

    Campers already cancelled when the dashboard first saw them have no status history row, so they are in the
    snapshot total but never on a line.
    """

    year: int
    unseen_count: int = Field(description="The season's cancellation total minus the gender lines' sum (never below 0)")
    no_history: bool = Field(
        description="True when the season has no day-by-day cancellation history at all (the lines draw nothing)"
    )


class VelocityResponse(BaseModel):
    year: int
    season_start: str = Field(description="ISO date of season start (priority or early registration date)")
    combined: VelocityCurve
    by_session: list[VelocityCurve]
    by_gender: list[VelocityCurve] = Field(
        default_factory=list,
        description="Empty when not split; [M, F] on the Gender field; the identity groups with any campers on identity",
    )
    gender_basis: GenderBasis = Field("field", description="Which gender the split reads (#2898 answer #78)")
    gender_fallback_count: int = Field(
        0,
        description=(
            "Gender identity split: this season's campers with no identity answer, counted by the Gender field "
            "(ruling 58). 0 on the Gender field or when not split"
        ),
    )
    prior_year_gender_fallback_counts: dict[int, int] = Field(
        default_factory=dict,
        description="The same count for each compared prior year above 0 (gender identity split only)",
    )
    gender_history_gaps: list[GenderHistoryGap] = Field(
        default_factory=list,
        description=(
            "Cancellation metric split by gender only: one entry for this season, then each compared prior season "
            "in request order, saying how many cancellations the gender lines cannot show"
        ),
    )
    prior_years: list[PriorYearVelocity]
    prior_year_by_gender: list[VelocityCurve] = Field(default_factory=list, description="Prior year gender curves")
    phase_markers: list[PhaseMarker]
    warnings: list[str] = Field(default_factory=list)
    session_gender_breakdown: list[SessionGenderBreakdown] = Field(default_factory=list)
    cancelled_to_date: int | None = Field(None, description="Total cancellations for current year through latest week")
    prior_year_cancelled_to_date: list[PriorYearCancelledSummary] = Field(default_factory=list)
    prior_year_session_summaries: list[PriorYearSessionSummary] = Field(default_factory=list)
    prior_year_season_starts: dict[int, str] = Field(
        default_factory=dict,
        description="Season start date (ISO) for each prior year, for tooltip date computation",
    )
    current_day_offset: int | None = Field(
        None, description="Day offset of the current year's latest daily point; None when there is no daily data"
    )
    prior_day_offset: int | None = Field(
        None,
        description=(
            "The day the prior years were read at: one more than current_day_offset on a priority, early or open "
            "date, where the prior is read through the next day (decision 45); None when current_day_offset is"
        ),
    )
    today_day_offset: int | None = Field(
        None, description="(today - season_start) in days while the season is live, else None; drives the TODAY line"
    )
    status_history_start: str | None = Field(
        None,
        description="ISO date of the earliest attendee_status_history row of any year; cancellation metric only",
    )
    snapshots_start: str | None = Field(
        None,
        description=(
            "ISO date of the first nightly enrollment snapshot of any year (enrollment metric). Every point "
            "before it is rebuilt from registration dates, so every season before it is rebuilt (K13)"
        ),
    )
    session_swap_count: int = Field(0, description="Cancellations that are session changes, not true departures")
    daily: list[DailyDataPoint] = Field(default_factory=list, description="Combined daily data for cumulative charts")
    weekly: list[WeeklyDataPoint] = Field(
        default_factory=list, description="Combined weekly data for delta chart + WoW table"
    )
