"""
Pydantic schemas for solver endpoints.
"""

from typing import Any

from pydantic import BaseModel, Field, model_validator


class SolverRequest(BaseModel):
    """Request to run the solver for a session."""

    session_cm_id: int
    year: int
    apply_results: bool = False
    time_limit: int | None = Field(default=None, ge=1, le=600, description="Override config time limit")
    scenario: str | None = None  # PocketBase ID of saved_scenario (relation)
    debug_constraints: dict[str, Any] | None = None
    debug_mode: bool = False
    config: dict[str, Any] | None = None
    respect_locks: bool = Field(default=True, description="Whether to respect locked bunk assignments")
    locked_bunk_cm_ids: list[int] = Field(
        default_factory=list,
        description="Bunk CM IDs to freeze in place during a partial re-solve (#1609)",
    )


class MultiSessionSolverRequest(BaseModel):
    """Request to run the solver for multiple sessions."""

    parent_session_cm_id: int
    year: int
    apply_results: bool = False
    time_limit_per_session: int | None = Field(default=None, ge=1, le=600, description="Override config time limit")
    scenario: str | None = None  # PocketBase ID of saved_scenario (relation)
    solve_by_sex: bool = True
    respect_locks: bool = Field(default=True, description="Whether to respect locked bunk assignments")


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


class SweepRequest(BaseModel):
    """Request to run a benchmark sweep across multiple time budgets.

    Exactly one of session_cm_id or scenario_id must be set.
    """

    session_cm_id: int | None = None
    year: int | None = None
    scenario_id: str | None = None
    time_budgets: list[int] = Field(default_factory=lambda: [30, 60, 180, 300])
    label: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def _exactly_one_source(self) -> SweepRequest:
        has_session = self.session_cm_id is not None
        has_scenario = self.scenario_id is not None
        if has_session == has_scenario:
            raise ValueError("Exactly one of session_cm_id or scenario_id must be set")
        if has_session and self.year is None:
            raise ValueError("year is required when session_cm_id is set")
        if not self.time_budgets:
            raise ValueError("time_budgets must contain at least one value")
        if any(b <= 0 for b in self.time_budgets):
            raise ValueError("All time_budgets must be > 0")
        if any(b > 3600 for b in self.time_budgets):
            raise ValueError("Each time_budget must be <= 3600 seconds")
        return self


class SweepResponse(BaseModel):
    """Response from kicking off a benchmark sweep."""

    sweep_id: str
    run_ids: list[str]
