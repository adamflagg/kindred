"""
Pydantic schemas for config endpoints.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class SolverConfigUpdate(BaseModel):
    """Request model for updating solver configuration values."""

    value: str = Field(..., min_length=1, max_length=500)
    description: str | None = Field(None, max_length=500)
