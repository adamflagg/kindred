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
from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from api.schemas.velocity import DailyDataPoint
    from api.services.metrics_repository import MetricsRepository

# Statuses that count as enrollments in reconstruction
ENROLLMENT_STATUSES: set[int] = {2, 32, 256}  # enrolled, cancelled, withdrawn
CANCELLATION_STATUSES: set[int] = {32, 256}  # cancelled, withdrawn


def parse_date_only(value: str) -> str:
    """Extract YYYY-MM-DD from a datetime string that may include time/timezone."""
    return value.split("T")[0].split(" ")[0]


def _get_enrollment_date(att: Any) -> str | None:
    """Get the enrollment date for an attendee, preferring effective_date over enrollment_date."""
    ed = getattr(att, "effective_date", "") or ""
    if ed:
        return parse_date_only(ed)
    fallback = getattr(att, "enrollment_date", "") or ""
    if fallback:
        return parse_date_only(fallback)
    return None


def _reconstruct_core(
    attendees: list[Any],
    sessions: dict[int, Any],
    day_offset: int,
    season_start: datetime,
    ag_parent_map: dict[int, int] | None = None,
) -> dict[int, dict[str, int | None]]:
    """Core reconstruction loop — shared by both public functions.

    Iterates attendees once, counting enrollments and cancellations per session.
    Gender counts are populated per-session: if any attendee in a session has
    gender data, that session gets integer gender counts; otherwise None.
    """
    if not attendees:
        return {}

    cutoff_date = (season_start + timedelta(days=day_offset)).date()

    # Per-session counters
    session_enrollments: dict[int, int] = defaultdict(int)
    session_cancellations: dict[int, int] = defaultdict(int)
    session_boys_enrolled: dict[int, int] = defaultdict(int)
    session_girls_enrolled: dict[int, int] = defaultdict(int)
    session_boys_cancelled: dict[int, int] = defaultdict(int)
    session_girls_cancelled: dict[int, int] = defaultdict(int)
    session_has_gender: set[int] = set()

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

        # Get gender from person expand (may be absent)
        person = expand.get("person") if isinstance(expand, dict) else None
        gender = getattr(person, "gender", None) if person else None
        if gender is not None:
            session_has_gender.add(effective_sid)

        # Enrollment event: use effective_date (original registration date)
        enroll_date_str = _get_enrollment_date(att)
        if enroll_date_str:
            dt = datetime.strptime(enroll_date_str, "%Y-%m-%d")
            if season_start.date() <= dt.date() <= cutoff_date:
                session_enrollments[effective_sid] += 1
                if gender == "M":
                    session_boys_enrolled[effective_sid] += 1
                elif gender == "F":
                    session_girls_enrolled[effective_sid] += 1

        # Cancellation event: for cancelled/withdrawn, use enrollment_date (PostDate = cancel date)
        if status_id in CANCELLATION_STATUSES:
            cancel_date_raw = getattr(att, "enrollment_date", "") or ""
            if cancel_date_raw:
                cancel_date_str = parse_date_only(cancel_date_raw)
                cancel_dt = datetime.strptime(cancel_date_str, "%Y-%m-%d")
                if season_start.date() <= cancel_dt.date() <= cutoff_date:
                    session_cancellations[effective_sid] += 1
                    if gender == "M":
                        session_boys_cancelled[effective_sid] += 1
                    elif gender == "F":
                        session_girls_cancelled[effective_sid] += 1

    # Build result — gender availability tracked per-session
    result: dict[int, dict[str, int | None]] = {}
    all_sids = set(session_enrollments.keys()) | set(session_cancellations.keys())
    for sid in all_sids:
        if sid not in sessions:
            continue
        net = session_enrollments.get(sid, 0) - session_cancellations.get(sid, 0)
        if sid in session_has_gender:
            boys = session_boys_enrolled.get(sid, 0) - session_boys_cancelled.get(sid, 0)
            girls = session_girls_enrolled.get(sid, 0) - session_girls_cancelled.get(sid, 0)
        else:
            boys = None
            girls = None
        result[sid] = {
            "enrolled": net,
            "waitlisted": 0,
            "cancelled": session_cancellations.get(sid, 0),
            "enrolled_boys": boys,
            "enrolled_girls": girls,
        }

    return result


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
    full = _reconstruct_core(attendees, sessions, day_offset, season_start, ag_parent_map)
    # "enrolled" is always int in _reconstruct_core result
    return {sid: counts["enrolled"] or 0 for sid, counts in full.items()}


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
    is available, gender counts are populated per-session; otherwise None.
    """
    attendees = await repository.fetch_attendees_with_dates(year, expand_person=True)
    return _reconstruct_core(attendees, sessions, day_offset, season_start, ag_parent_map)


def reconstruct_daily(
    *,
    attendees: list[Any],
    season_start: date,
    sessions: dict[int, Any],
    end_date: date,
    ag_parent_map: dict[int, int] | None = None,
    session_cm_id: int | None = None,
) -> list[DailyDataPoint]:
    """Reconstruct daily enrollment data from attendee records.

    Produces one DailyDataPoint per day from season_start through end_date,
    with running cumulative totals.
    """
    from api.schemas.velocity import DailyDataPoint as DailyPoint

    # Build daily event buckets: date_str -> {new, cancelled, new_boys, ...}
    daily_events: dict[str, dict[str, int]] = {}
    sessions_with_gender: set[int] = set()

    for att in attendees:
        # Access session via expand dict — matches _reconstruct_core pattern
        expand = getattr(att, "expand", {}) or {}
        session = expand.get("session") if isinstance(expand, dict) else None
        if not session:
            continue
        sid = int(session.cm_id)
        status = getattr(att, "status_id", 0) or 0

        if status not in ENROLLMENT_STATUSES:
            continue

        # AG parent mapping
        if ag_parent_map and sid in ag_parent_map:
            sid = ag_parent_map[sid]

        # Session filter
        if session_cm_id is not None and sid != session_cm_id:
            continue

        # Skip if session not in our set
        if sid not in sessions:
            continue

        # Gender — access via expand dict, matching _reconstruct_core
        person = expand.get("person") if isinstance(expand, dict) else None
        gender = getattr(person, "gender", None) if person else None
        if gender is not None:
            sessions_with_gender.add(sid)

        _empty_bucket: dict[str, int] = {
            "new": 0,
            "cancelled": 0,
            "new_boys": 0,
            "new_girls": 0,
            "canc_boys": 0,
            "canc_girls": 0,
        }

        # Enrollment event: bucket by effective_date
        enroll_date_str = _get_enrollment_date(att)
        if enroll_date_str:
            enroll_day = parse_date_only(enroll_date_str)
            bucket = daily_events.setdefault(enroll_day, dict(_empty_bucket))
            bucket["new"] += 1
            if gender == "M":
                bucket["new_boys"] += 1
            elif gender == "F":
                bucket["new_girls"] += 1

        # Cancellation event: bucket by enrollment_date (processing date)
        if status in CANCELLATION_STATUSES:
            canc_date_raw = getattr(att, "enrollment_date", "") or ""
            if canc_date_raw:
                canc_day = parse_date_only(canc_date_raw)
                bucket = daily_events.setdefault(canc_day, dict(_empty_bucket))
                bucket["cancelled"] += 1
                if gender == "M":
                    bucket["canc_boys"] += 1
                elif gender == "F":
                    bucket["canc_girls"] += 1

    has_gender = len(sessions_with_gender) > 0

    # Build daily points with running cumulatives
    result: list[DailyPoint] = []
    cum_gross = 0
    cum_cancelled = 0
    cum_gross_boys = 0
    cum_gross_girls = 0
    cum_canc_boys = 0
    cum_canc_girls = 0

    empty: dict[str, int] = {
        "new": 0,
        "cancelled": 0,
        "new_boys": 0,
        "new_girls": 0,
        "canc_boys": 0,
        "canc_girls": 0,
    }

    current = season_start
    day_offset = 0
    while current <= end_date:
        date_str = current.isoformat()
        events = daily_events.get(date_str, empty)

        cum_gross += events["new"]
        cum_cancelled += events["cancelled"]
        cum_gross_boys += events["new_boys"]
        cum_gross_girls += events["new_girls"]
        cum_canc_boys += events["canc_boys"]
        cum_canc_girls += events["canc_girls"]

        result.append(
            DailyPoint(
                date=date_str,
                day_offset=day_offset,
                gross_enrolled=cum_gross,
                enrolled=cum_gross - cum_cancelled,
                cancelled=cum_cancelled,
                daily_new=events["new"],
                daily_cancelled=events["cancelled"],
                daily_new_boys=events["new_boys"] if has_gender else None,
                daily_new_girls=events["new_girls"] if has_gender else None,
                daily_cancelled_boys=events["canc_boys"] if has_gender else None,
                daily_cancelled_girls=events["canc_girls"] if has_gender else None,
                gross_enrolled_boys=cum_gross_boys if has_gender else None,
                gross_enrolled_girls=cum_gross_girls if has_gender else None,
                enrolled_boys=(cum_gross_boys - cum_canc_boys) if has_gender else None,
                enrolled_girls=(cum_gross_girls - cum_canc_girls) if has_gender else None,
                data_source="reconstructed",
            )
        )

        current += timedelta(days=1)
        day_offset += 1

    return result
