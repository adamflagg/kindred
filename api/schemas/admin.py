"""
Pydantic schemas for admin endpoints.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class UpdateSyncSchedule(BaseModel):
    """Request model for updating sync schedule."""

    schedule_type: str = Field(..., description="Schedule type: 'cron' or 'friendly'")
    schedule_value: str = Field(..., description="Cron expression or friendly value")
    enabled: bool = Field(..., description="Whether the job is enabled")


class ValidateCronRequest(BaseModel):
    """Request model for validating cron expression."""

    expression: str = Field(..., description="Cron expression to validate")


class UpdateAdminSetting(BaseModel):
    """Request model for updating admin setting."""

    value: str = Field(..., description="Setting value")


class BunkRequestUpload(BaseModel):
    """Request body for bunk request CSV upload."""

    csv_data_base64: str
    filename: str
    test_limit: int | None = None
    session_filter: int | None = None
    no_history: bool = False
