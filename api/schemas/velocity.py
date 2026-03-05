"""Pydantic models for registration velocity response."""

from __future__ import annotations

from pydantic import BaseModel, Field


class WeeklyDataPoint(BaseModel):
    week_start: str = Field(description="ISO date of the start of this week bucket (YYYY-MM-DD)")
    week_label: str = Field(description="Human-readable label like 'Jan 6'")
    week_number: int = Field(description="0-based week offset from season start")
    enrolled: int = Field(description="Cumulative net enrolled count (enrolled minus cancellations)")
    waitlisted: int = Field(description="Cumulative waitlisted count")
    delta: int = Field(description="Change in enrolled from prior week")
    data_source: str = Field(description="'snapshot' or 'reconstructed'")
    gross_enrolled: int = Field(0, description="Cumulative gross enrollments (never decreases)")
    weekly_new: int = Field(0, description="New enrollments this week")
    weekly_cancelled: int = Field(0, description="Cancellations this week")
    is_partial: bool = Field(False, description="True if this week bucket is incomplete (less than 7 days of data)")
    days_in_week: int = Field(7, description="Number of days elapsed in this week bucket (1-7)")


class VelocityCurve(BaseModel):
    year: int
    session_cm_id: int | None = Field(None, description="None = combined across sessions")
    session_name: str | None = None
    gender: str | None = Field(None, description="None=all, 'M'=boys, 'F'=girls")
    weekly: list[WeeklyDataPoint]


class PhaseMarker(BaseModel):
    phase: str = Field(description="Registration phase: priority, early, open")
    date: str = Field(description="ISO date")
    label: str = Field(description="Display label")
    week_number: int = Field(description="0-based week offset from season start Monday for X-axis alignment")


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
    prior_years: list[VelocityCurve]
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
