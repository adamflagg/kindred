"""Pydantic models for registration velocity response."""

from __future__ import annotations

from pydantic import BaseModel, Field


class WeeklyDataPoint(BaseModel):
    week_start: str = Field(description="ISO date (YYYY-MM-DD)")
    week_label: str = Field(description="Human-readable label like 'Jan 6'")
    enrolled: int = Field(description="Cumulative enrolled count")
    waitlisted: int = Field(description="Cumulative waitlisted count")
    delta: int = Field(description="Change in enrolled from prior week")
    data_source: str = Field(description="'snapshot' or 'reconstructed'")


class VelocityCurve(BaseModel):
    year: int
    session_cm_id: int | None = Field(None, description="None = combined across sessions")
    session_name: str | None = None
    weekly: list[WeeklyDataPoint]


class PhaseMarker(BaseModel):
    phase: str = Field(description="Registration phase: priority, early, open")
    date: str = Field(description="ISO date")
    label: str = Field(description="Display label")


class VelocityResponse(BaseModel):
    year: int
    combined: VelocityCurve
    by_session: list[VelocityCurve]
    prior_years: list[VelocityCurve]
    phase_markers: list[PhaseMarker]
