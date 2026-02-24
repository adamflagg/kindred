"""Pydantic models for registration velocity response."""

from __future__ import annotations

from pydantic import BaseModel, Field


class WeeklyDataPoint(BaseModel):
    week_start: str = Field(description="ISO date of the Monday starting this week (YYYY-MM-DD)")
    week_label: str = Field(description="Human-readable label like 'Jan 6'")
    week_number: int = Field(description="0-based week offset from season start Monday")
    enrolled: int = Field(description="Cumulative enrolled count")
    waitlisted: int = Field(description="Cumulative waitlisted count")
    delta: int = Field(description="Change in enrolled from prior week")
    data_source: str = Field(description="'snapshot' or 'reconstructed'")


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


class VelocityResponse(BaseModel):
    year: int
    season_start: str = Field(description="ISO date of season start (priority_reg - 7 days, or Nov 1 fallback)")
    combined: VelocityCurve
    by_session: list[VelocityCurve]
    by_gender: list[VelocityCurve] = Field(default_factory=list, description="Empty when not split, [M, F] when split")
    prior_years: list[VelocityCurve]
    prior_year_by_gender: list[VelocityCurve] = Field(default_factory=list, description="Prior year gender curves")
    phase_markers: list[PhaseMarker]
    session_gender_breakdown: list[SessionGenderBreakdown] = Field(default_factory=list)
