"""Shared validation helpers for API routers."""

from fastapi import HTTPException

from api.utils.session_metrics import DISPLAY_SESSION_TYPES


def check_duration_session_exclusive(
    duration: str | None,
    session_cm_id: int | None,
) -> None:
    """Raise 422 if both duration and session_cm_id filters are provided."""
    if duration is not None and session_cm_id is not None:
        raise HTTPException(status_code=422, detail="duration and session_cm_id are mutually exclusive")


def parse_summer_session_types(raw: str | None) -> list[str] | None:
    """Parse a comma-separated ``session_types`` query value for a summer metrics endpoint.

    Blanks are dropped. Returns ``None`` when nothing was requested. Raises 422 naming
    the allowed set when any type is outside ``DISPLAY_SESSION_TYPES``: Family Camp,
    adult and B*Mitzvah/Hebrew never fold into summer metrics (#2435).
    """
    if not raw:
        return None
    types = [t for t in (part.strip() for part in raw.split(",")) if t]
    if not types:
        return None
    invalid = sorted({t for t in types if t not in DISPLAY_SESSION_TYPES})
    if invalid:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported session_types {invalid}; summer metrics accept only {list(DISPLAY_SESSION_TYPES)}",
        )
    return types
