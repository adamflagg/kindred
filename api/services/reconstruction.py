"""Shared reconstruction module for enrollment history aggregation.

Extracts the core daily-aggregation logic from velocity service so both
velocity and forecast can reconstruct enrollment counts from attendee records.

Data flow:
1. Fetch attendees with effective_date (original reg) and enrollment_date (PostDate/cancel)
2. For each attendee with status in {2, 32, 256} (enrolled, cancelled, withdrawn):
   - Enrollment event: use effective_date if available, else enrollment_date
   - Cancellation event (status 32 or 256 only): use enrollment_date
3. Aggregate by session, counting events within [lower_bound, season_start + day_offset]
   where lower_bound = season_start - 7 days when day_offset < 0 (Week 0), else season_start
4. Net enrolled = gross enrollments - cancellations
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING, Any

from api.schemas.velocity import DailyDataPoint
from api.utils.session_metrics import get_person_from_expand, get_session_from_expand

if TYPE_CHECKING:
    from api.services.metrics_repository import MetricsRepository

# Statuses that count as enrollments in reconstruction
ENROLLMENT_STATUSES: set[int] = {2, 32, 256}  # enrolled, cancelled, withdrawn
CANCELLATION_STATUSES: set[int] = {32, 256}  # cancelled, withdrawn

# Canonical bucket fields for daily event aggregation.  Used by _empty_bucket,
# _merge_buckets, and _build_daily_points — change once here if schema evolves.
_BUCKET_FIELDS: tuple[str, ...] = ("new", "cancelled", "new_boys", "new_girls", "canc_boys", "canc_girls")


def compress_pre_anchor_events(
    daily_events: dict[str, dict[str, int]],
    anchor: date,
    window: int = 7,
) -> dict[str, dict[str, int]]:
    """Proportionally compress pre-anchor events into a fixed display window.

    Maps N real pre-registration days into a ``window``-day display range
    (anchor - window .. anchor - 1).  Events on or after ``anchor`` are untouched.

    If the real span fits within ``window``, events are right-aligned against the
    anchor preserving their relative gaps.  If the span exceeds ``window``, events
    are proportionally compressed with totals preserved (multiple real days may
    merge into one display day).

    Returns a **new** dict — the input is not mutated.
    """
    anchor_str = anchor.isoformat()

    pre: dict[str, dict[str, int]] = {}
    post: dict[str, dict[str, int]] = {}
    for k, v in daily_events.items():
        if k < anchor_str:
            pre[k] = v
        else:
            post[k] = v

    if not pre:
        return dict(daily_events)

    sorted_keys = sorted(pre.keys())
    earliest = date.fromisoformat(sorted_keys[0])
    real_span = (anchor - earliest).days  # calendar days, exclusive of anchor

    result: dict[str, dict[str, int]] = {}
    base = anchor - timedelta(days=window)

    if real_span <= window:
        shift = window - real_span

        def _remap(i: int) -> int:
            return shift + i
    else:
        scale = window / real_span

        def _remap(i: int) -> int:
            return min(int(i * scale), window - 1)

    for key in sorted_keys:
        i = (date.fromisoformat(key) - earliest).days
        target_str = (base + timedelta(days=_remap(i))).isoformat()
        if target_str in result:
            _merge_buckets(result[target_str], pre[key])
        else:
            result[target_str] = dict(pre[key])

    # Add post-anchor events unchanged
    result.update(post)
    return result


def _merge_buckets(target: dict[str, int], source: dict[str, int]) -> None:
    """Sum all fields from source into target bucket (in-place)."""
    for field in _BUCKET_FIELDS:
        target[field] = target.get(field, 0) + source.get(field, 0)


def parse_date_only(value: str) -> str:
    """Extract YYYY-MM-DD from a datetime string that may include time/timezone."""
    return value.split("T")[0].split(" ")[0]


def get_enrollment_date(att: Any) -> str | None:
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
    # Lower bound: clamp to anchor - 7 days for negative offsets (Week 0 forecast)
    # to prevent counting enrollments from arbitrarily far back.  For positive
    # offsets pre-anchor enrollments are part of the cumulative total, so no bound.
    lower_bound = (season_start - timedelta(days=7)).date() if day_offset < 0 else None

    # Per-session counters
    session_enrollments: dict[int, int] = defaultdict(int)
    session_cancellations: dict[int, int] = defaultdict(int)
    session_boys_enrolled: dict[int, int] = defaultdict(int)
    session_girls_enrolled: dict[int, int] = defaultdict(int)
    session_boys_cancelled: dict[int, int] = defaultdict(int)
    session_girls_cancelled: dict[int, int] = defaultdict(int)
    session_has_gender: set[int] = set()

    for att in attendees:
        session = get_session_from_expand(att)
        if not session:
            continue

        status_id = getattr(att, "status_id", 0) or 0
        if status_id not in ENROLLMENT_STATUSES:
            continue

        raw_sid = int(session.cm_id)
        effective_sid = ag_parent_map.get(raw_sid, raw_sid) if ag_parent_map is not None else raw_sid

        # Get gender from person expand (may be absent)
        person = get_person_from_expand(att)
        gender = getattr(person, "gender", None) if person else None
        if gender is not None:
            session_has_gender.add(effective_sid)

        # Enrollment event: use effective_date (original registration date)
        enroll_date_str = get_enrollment_date(att)
        if enroll_date_str:
            dt = datetime.strptime(enroll_date_str, "%Y-%m-%d")
            if (lower_bound is None or lower_bound <= dt.date()) and dt.date() <= cutoff_date:
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
                if (lower_bound is None or lower_bound <= cancel_dt.date()) and cancel_dt.date() <= cutoff_date:
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


def _build_daily_points(
    daily_events: dict[str, dict[str, int]],
    has_gender: bool,
    season_start: date,
    end_date: date,
    *,
    week0: bool = False,
) -> list[DailyDataPoint]:
    """Convert daily event buckets into a list of DailyDataPoint with running cumulatives."""
    result: list[DailyDataPoint] = []
    cum_gross = 0
    cum_cancelled = 0
    cum_gross_boys = 0
    cum_gross_girls = 0
    cum_canc_boys = 0
    cum_canc_girls = 0

    empty: dict[str, int] = dict.fromkeys(_BUCKET_FIELDS, 0)

    if week0:
        current = season_start - timedelta(days=7)
        day_offset = -7
    else:
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
            DailyDataPoint(
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


def reconstruct_daily_multi(
    *,
    attendees: list[Any],
    season_start: date,
    sessions: dict[int, Any],
    end_date: date,
    ag_parent_map: dict[int, int] | None = None,
    session_cm_id: int | None = None,
    session_ids: list[int] | None = None,
    week0: bool = False,
) -> tuple[list[DailyDataPoint], dict[int, list[DailyDataPoint]]]:
    """Reconstruct daily enrollment data for combined and per-session in a single pass.

    Iterates attendees once and buckets events into both combined and per-session
    event dicts simultaneously.

    Args:
        attendees: List of attendee records with expand.session and expand.person.
        season_start: Start date of the enrollment season.
        sessions: Dict of session cm_id -> session object.
        end_date: Last date to include in output.
        ag_parent_map: Optional AG child -> parent session mapping.
        session_cm_id: Optional session filter for the combined output.
        session_ids: Session IDs to include in per-session output. None = all.

    Returns:
        Tuple of (combined_daily, per_session_daily) where per_session_daily
        maps session cm_id to its daily data points.
    """
    # Build daily event buckets: one for combined, one per session
    combined_events: dict[str, dict[str, int]] = {}
    per_session_events: dict[int, dict[str, dict[str, int]]] = {}
    combined_has_gender = False
    per_session_has_gender: dict[int, bool] = {}

    _empty_bucket: dict[str, int] = dict.fromkeys(_BUCKET_FIELDS, 0)

    for att in attendees:
        session = get_session_from_expand(att)
        if not session:
            continue
        sid = int(session.cm_id)
        status = getattr(att, "status_id", 0) or 0

        if status not in ENROLLMENT_STATUSES:
            continue

        # AG parent mapping
        if ag_parent_map and sid in ag_parent_map:
            sid = ag_parent_map[sid]

        # Skip if session not in our set
        if sid not in sessions:
            continue

        # Gender
        person = get_person_from_expand(att)
        gender = getattr(person, "gender", None) if person else None

        # Determine if this attendee passes the combined filter
        include_in_combined = session_cm_id is None or sid == session_cm_id

        # Determine if this attendee should go into a per-session bucket
        include_in_per_session = session_ids is None or sid in session_ids

        # Track gender availability
        if gender is not None:
            if include_in_combined:
                combined_has_gender = True
            if include_in_per_session:
                per_session_has_gender[sid] = True

        # Enrollment event
        enroll_date_str = get_enrollment_date(att)
        if enroll_date_str:
            enroll_day = parse_date_only(enroll_date_str)

            if include_in_combined:
                bucket = combined_events.setdefault(enroll_day, dict(_empty_bucket))
                bucket["new"] += 1
                if gender == "M":
                    bucket["new_boys"] += 1
                elif gender == "F":
                    bucket["new_girls"] += 1

            if include_in_per_session:
                sid_events = per_session_events.setdefault(sid, {})
                bucket = sid_events.setdefault(enroll_day, dict(_empty_bucket))
                bucket["new"] += 1
                if gender == "M":
                    bucket["new_boys"] += 1
                elif gender == "F":
                    bucket["new_girls"] += 1

        # Cancellation event
        if status in CANCELLATION_STATUSES:
            canc_date_raw = getattr(att, "enrollment_date", "") or ""
            if canc_date_raw:
                canc_day = parse_date_only(canc_date_raw)

                if include_in_combined:
                    bucket = combined_events.setdefault(canc_day, dict(_empty_bucket))
                    bucket["cancelled"] += 1
                    if gender == "M":
                        bucket["canc_boys"] += 1
                    elif gender == "F":
                        bucket["canc_girls"] += 1

                if include_in_per_session:
                    sid_events = per_session_events.setdefault(sid, {})
                    bucket = sid_events.setdefault(canc_day, dict(_empty_bucket))
                    bucket["cancelled"] += 1
                    if gender == "M":
                        bucket["canc_boys"] += 1
                    elif gender == "F":
                        bucket["canc_girls"] += 1

    # Proportionally compress pre-anchor events into the Week 0 display window
    if week0:
        combined_events = compress_pre_anchor_events(combined_events, season_start)
        for sid in per_session_events:
            per_session_events[sid] = compress_pre_anchor_events(per_session_events[sid], season_start)

    # Build combined daily points
    combined = _build_daily_points(combined_events, combined_has_gender, season_start, end_date, week0=week0)

    # Build per-session daily points
    per_session_daily: dict[int, list[DailyDataPoint]] = {}
    for sid, events in per_session_events.items():
        has_gender = per_session_has_gender.get(sid, False)
        points = _build_daily_points(events, has_gender, season_start, end_date, week0=week0)
        if points:
            per_session_daily[sid] = points

    return combined, per_session_daily
