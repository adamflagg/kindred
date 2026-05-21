"""Pydantic models for registration velocity response."""

from pydantic import BaseModel, Field


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
    gender: str | None = Field(None, description="None=all, 'M'=boys, 'F'=girls")
    weekly: list[WeeklyDataPoint]
    daily: list[DailyDataPoint] = Field(
        default_factory=list, description="Daily granularity data for cumulative charts"
    )


class PriorYearVelocity(BaseModel):
    year: int
    daily: list[DailyDataPoint] = Field(default_factory=list)
    weekly: list[WeeklyDataPoint] = Field(default_factory=list)


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


class PriorYearCancelledSummary(BaseModel):
    year: int
    cancelled_at_current_week: int | None = Field(
        None, description="Cancelled count at same week as current year's latest"
    )
    cancelled_final: int = Field(description="Total cancelled for that year")


class PriorYearSessionSummary(BaseModel):
    year: int
    session_name: str | None = None
    session_cm_id: int | None = None
    enrolled_at_current_week: int | None = Field(
        None, description="Prior year enrollment at same week_number as current"
    )
    final_enrolled: int = Field(description="Last enrollment value for this session in prior year")


class VelocityResponse(BaseModel):
    year: int
    season_start: str = Field(description="ISO date of season start (priority or early registration date)")
    combined: VelocityCurve
    by_session: list[VelocityCurve]
    by_gender: list[VelocityCurve] = Field(default_factory=list, description="Empty when not split, [M, F] when split")
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
    session_swap_count: int = Field(0, description="Cancellations that are session changes, not true departures")
    daily: list[DailyDataPoint] = Field(default_factory=list, description="Combined daily data for cumulative charts")
    weekly: list[WeeklyDataPoint] = Field(
        default_factory=list, description="Combined weekly data for delta chart + WoW table"
    )
