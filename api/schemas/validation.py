"""
Pydantic schemas for validation endpoints.
"""

from __future__ import annotations

from pydantic import BaseModel


class ValidateBunkingRequest(BaseModel):
    """Request to validate bunking assignments."""

    session_cm_id: int
    year: int
    scenario: str | None = None  # PocketBase ID of saved_scenario (relation)
