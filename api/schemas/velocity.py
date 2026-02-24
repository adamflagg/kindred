"""Pydantic models for registration velocity response."""

from __future__ import annotations

from pydantic import BaseModel, Field


class VelocityDataPoint(BaseModel):
    date: str = Field(description="ISO date (YYYY-MM-DD)")
    label: str = Field(description="Human-readable label like 'Jan 6'")
    enrolled: int = Field(description="Cumulative enrolled count")
    waitlisted: int = Field(description="Cumulative waitlisted count")
    delta: int = Field(description="Change in enrolled from prior data point")
    data_source: str = Field(description="'snapshot' or 'reconstructed'")
    day_number: int = Field(description="0-based day offset from season start (Nov 1)")


class VelocityCurve(BaseModel):
    year: int
    session_cm_id: int | None = Field(None, description="None = combined across sessions")
    session_name: str | None = None
    gender: str | None = Field(None, description="None=all, 'M'=boys, 'F'=girls")
    data: list[VelocityDataPoint]


class PhaseMarker(BaseModel):
    phase: str = Field(description="Registration phase: priority, early, open")
    date: str = Field(description="ISO date")
    label: str = Field(description="Display label")
    day_number: int = Field(description="0-based day offset from season start for X-axis alignment")


class SessionGenderBreakdown(BaseModel):
    session_cm_id: int
    session_name: str | None = None
    boys_enrolled: int
    girls_enrolled: int


class VelocityResponse(BaseModel):
    year: int
    season_start: str = Field(description="ISO date of season start (Nov 1 of year-1)")
    combined: VelocityCurve
    by_session: list[VelocityCurve]
    by_gender: list[VelocityCurve] = Field(default_factory=list, description="Empty when not split, [M, F] when split")
    prior_years: list[VelocityCurve]
    prior_year_by_gender: list[VelocityCurve] = Field(default_factory=list, description="Prior year gender curves")
    phase_markers: list[PhaseMarker]
    session_gender_breakdown: list[SessionGenderBreakdown] = Field(default_factory=list)
