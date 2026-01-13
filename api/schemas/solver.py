"""
Pydantic schemas for solver endpoints.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SolverRequest(BaseModel):
    """Request to run the solver for a session."""

    session_cm_id: int
    year: int
    respect_locks: bool = True
    apply_results: bool = False
    time_limit: int | None = Field(default=None, ge=1, le=600, description="Override config time limit")
    include_analysis: bool = False
    scenario: str | None = None  # PocketBase ID of saved_scenario (relation)
    debug_constraints: dict[str, Any] | None = None
    debug_mode: bool = False
    config: dict[str, Any] | None = None


class MultiSessionSolverRequest(BaseModel):
    """Request to run the solver for multiple sessions."""

    parent_session_cm_id: int
    year: int
    respect_locks: bool = True
    apply_results: bool = False
    time_limit_per_session: int | None = Field(default=None, ge=1, le=600, description="Override config time limit")
    include_analysis: bool = False
    scenario: str | None = None  # PocketBase ID of saved_scenario (relation)
    solve_by_sex: bool = True


class SolverResponse(BaseModel):
    """Response from solver run."""

    run_id: str
    status: str
    message: str


class ClearAssignmentsRequest(BaseModel):
    """Request model for clearing assignments."""

    session_cm_id: int
    year: int
    scenario: str | None = None  # PocketBase ID of saved_scenario (relation)
