"""Shared validation helpers for API routers."""

from fastapi import HTTPException


def check_duration_session_exclusive(
    duration: str | None,
    session_cm_id: int | None,
) -> None:
    """Raise 422 if both duration and session_cm_id filters are provided."""
    if duration is not None and session_cm_id is not None:
        raise HTTPException(status_code=422, detail="duration and session_cm_id are mutually exclusive")
