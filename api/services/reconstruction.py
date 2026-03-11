"""Shared reconstruction module for enrollment history aggregation.

Extracts the core daily-aggregation logic from velocity service so both
velocity and forecast can reconstruct enrollment counts from attendee records.

Data flow:
1. Fetch attendees with effective_date (original reg) and enrollment_date (PostDate/cancel)
2. For each attendee with status in {2, 32, 256} (enrolled, cancelled, withdrawn):
   - Enrollment event: use effective_date if available, else enrollment_date
   - Cancellation event (status 32 or 256 only): use enrollment_date
3. Aggregate by session, counting events within [season_start, season_start + day_offset]
4. Net enrolled = gross enrollments - cancellations
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from api.services.metrics_repository import MetricsRepository

# Statuses that count as enrollments in reconstruction
ENROLLMENT_STATUSES: set[int] = {2, 32, 256}  # enrolled, cancelled, withdrawn
CANCELLATION_STATUSES: set[int] = {32, 256}  # cancelled, withdrawn


def _parse_date_only(value: str) -> str:
    """Extract YYYY-MM-DD from a datetime string that may include time/timezone."""
    return value.split("T")[0].split(" ")[0]


def _get_enrollment_date(att: Any) -> str | None:
    """Get the enrollment date for an attendee, preferring effective_date over enrollment_date."""
    ed = getattr(att, "effective_date", "") or ""
    if ed:
        return _parse_date_only(ed)
    fallback = getattr(att, "enrollment_date", "") or ""
    if fallback:
        return _parse_date_only(fallback)
    return None


async def reconstruct_enrollment_at_offset(
    repository: MetricsRepository,
    year: int,
    sessions: dict[int, Any],
    day_offset: int,
    season_start: datetime,
    ag_parent_map: dict[int, int] | None = None,
) -> dict[int, int]:
    """Reconstruct net enrollment counts per session at a given day offset.

    Args:
        repository: Data access layer for fetching attendees.
        year: The enrollment year to query.
        sessions: Dict of session cm_id -> session object. Only sessions in this
            dict are included in results.
        day_offset: Number of days from season_start. Events up to and including
            season_start + day_offset are counted.
        season_start: The start of the enrollment season (datetime).
        ag_parent_map: Optional mapping of AG child session cm_id -> parent cm_id.
            When provided, child sessions are merged into their parent.

    Returns:
        Dict of session cm_id -> net enrolled count at the given offset.
    """
    attendees = await repository.fetch_attendees_with_dates(year)

    if not attendees:
        return {}

    cutoff_date = (season_start + timedelta(days=day_offset)).date()

    # Count enrollments and cancellations per session
    session_enrollments: dict[int, int] = defaultdict(int)
    session_cancellations: dict[int, int] = defaultdict(int)

    for att in attendees:
        expand = getattr(att, "expand", {}) or {}
        session = expand.get("session") if isinstance(expand, dict) else None
        if not session:
            continue

        status_id = getattr(att, "status_id", 0) or 0
        if status_id not in ENROLLMENT_STATUSES:
            continue

        raw_sid = int(session.cm_id)
        effective_sid = ag_parent_map.get(raw_sid, raw_sid) if ag_parent_map is not None else raw_sid

        # Enrollment event: use effective_date (original registration date)
        enroll_date_str = _get_enrollment_date(att)
        if enroll_date_str:
            dt = datetime.strptime(enroll_date_str, "%Y-%m-%d")
            if season_start.date() <= dt.date() <= cutoff_date:
                session_enrollments[effective_sid] += 1

        # Cancellation event: for cancelled/withdrawn, use enrollment_date (PostDate = cancel date)
        if status_id in CANCELLATION_STATUSES:
            cancel_date_raw = getattr(att, "enrollment_date", "") or ""
            if cancel_date_raw:
                cancel_date_str = _parse_date_only(cancel_date_raw)
                cancel_dt = datetime.strptime(cancel_date_str, "%Y-%m-%d")
                if season_start.date() <= cancel_dt.date() <= cutoff_date:
                    session_cancellations[effective_sid] += 1

    # Filter to known sessions and compute net
    result: dict[int, int] = {}
    all_sids = set(session_enrollments.keys()) | set(session_cancellations.keys())
    for sid in all_sids:
        if sid not in sessions:
            continue
        net = session_enrollments.get(sid, 0) - session_cancellations.get(sid, 0)
        result[sid] = net

    return result


async def reconstruct_enrollment_with_gender(
    repository: MetricsRepository,
    year: int,
    sessions: dict[int, Any],
    day_offset: int,
    season_start: datetime,
    ag_parent_map: dict[int, int] | None = None,
) -> dict[int, dict[str, int | None]]:
    """Reconstruct enrollment counts with gender breakdown.

    Returns {session_cm_id: {
        "enrolled": int, "waitlisted": int, "cancelled": int,
        "enrolled_boys": int | None, "enrolled_girls": int | None
    }}

    Gender is derived from the person relation. If expand_person data
    is available, gender counts are populated; otherwise None.
    """
    raise NotImplementedError("Gender-aware reconstruction not yet implemented")
