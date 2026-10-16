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
from collections.abc import Callable
from dataclasses import dataclass
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
    *,
    earliest: date | None = None,
) -> dict[str, dict[str, int]]:
    """Proportionally compress pre-anchor events into a fixed display window.

    Maps N real pre-registration days into a ``window``-day display range
    (anchor - window .. anchor - 1).  Events on or after ``anchor`` are untouched.

    If the real span fits within ``window``, events are right-aligned against the
    anchor preserving their relative gaps.  If the span exceeds ``window``, events
    are proportionally compressed with totals preserved (multiple real days may
    merge into one display day).

    ``earliest`` fixes the start of the real span instead of this dict's own first pre-anchor day, so several
    subsets of one set of events (Velocity's gender identity groups) squeeze onto the same display days as the whole.

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
    if earliest is None:
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


def registered_day(att: Any) -> date | None:
    """The day a record counts as registered: effective_date, else enrollment_date."""
    day = get_enrollment_date(att)
    return date.fromisoformat(day) if day else None


def cancelled_day(att: Any) -> date | None:
    """The day a cancelled or withdrawn record left: its enrollment_date (PostDate). None otherwise."""
    if (getattr(att, "status_id", 0) or 0) not in CANCELLATION_STATUSES:
        return None
    raw = getattr(att, "enrollment_date", "") or ""
    return date.fromisoformat(parse_date_only(raw)) if raw else None


def _in_window(day: date | None, lower_bound: date | None, cutoff: date) -> bool:
    return day is not None and (lower_bound is None or lower_bound <= day) and day <= cutoff


def attendees_at_cutoff(attendees: list[Any], cutoff: date) -> tuple[list[Any], list[Any]]:
    """The records as they stood at the end of ``cutoff``: (enrolled, cancelled).

    Decision 7: enrolled at day N = registered by N and not cancelled by N, over the statuses the
    rebuild counts (enrolled, cancelled, withdrawn), the same rule ``_reconstruct_core`` counts per
    session for Velocity and Forecast, applied to records so every Overview breakdown can use it.
    ``cancelled`` holds the cancelled and withdrawn records that had left by ``cutoff``.
    No lower bound: this is the live "registered by day N" read, not Week-0 week mode.
    """
    enrolled: list[Any] = []
    cancelled: list[Any] = []
    for att in attendees:
        if (getattr(att, "status_id", 0) or 0) not in ENROLLMENT_STATUSES:
            continue
        if _in_window(cancelled_day(att), None, cutoff):
            cancelled.append(att)
        elif _in_window(registered_day(att), None, cutoff):
            enrolled.append(att)
    return enrolled, cancelled


def _reconstruct_core(
    attendees: list[Any],
    sessions: dict[int, Any],
    day_offset: int,
    season_start: datetime,
    ag_parent_map: dict[int, int] | None = None,
    week0_window: bool = True,
) -> dict[int, dict[str, int | None]]:
    """Core reconstruction loop — shared by both public functions.

    Iterates attendees once, counting enrollments and cancellations per session.
    Gender counts are populated per-session: if any attendee in a session has
    gender data, that session gets integer gender counts; otherwise None.

    ``waitlisted`` is always None: a past waitlist cannot be rebuilt from final
    attendee records, so callers must treat it as unknown rather than zero.

    ``week0_window=False`` drops the Week-0 lower bound for negative offsets, so
    "registered by day N" counts every registration up to the cutoff (live
    same-point comparison before the anchor). Week mode keeps the bound.
    """
    if not attendees:
        return {}

    cutoff_date = (season_start + timedelta(days=day_offset)).date()
    # Lower bound: with week0_window, clamp to anchor - 7 days for negative offsets (Week 0
    # forecast) to prevent counting enrollments from arbitrarily far back.  For positive
    # offsets pre-anchor enrollments are part of the cumulative total, so no bound.
    lower_bound = (season_start - timedelta(days=7)).date() if day_offset < 0 and week0_window else None

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
        if _in_window(registered_day(att), lower_bound, cutoff_date):
            session_enrollments[effective_sid] += 1
            if gender == "M":
                session_boys_enrolled[effective_sid] += 1
            elif gender == "F":
                session_girls_enrolled[effective_sid] += 1

        # Cancellation event: for cancelled/withdrawn, use enrollment_date (PostDate = cancel date)
        if _in_window(cancelled_day(att), lower_bound, cutoff_date):
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
            "waitlisted": None,
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
    week0_window: bool = True,
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
        week0_window: Apply the Week-0 lower bound for negative offsets (default).

    Returns:
        Dict of session cm_id -> net enrolled count at the given offset.
    """
    attendees = await repository.fetch_attendees_with_dates(year)
    full = _reconstruct_core(attendees, sessions, day_offset, season_start, ag_parent_map, week0_window)
    # "enrolled" is always int in _reconstruct_core result
    return {sid: counts["enrolled"] or 0 for sid, counts in full.items()}


async def reconstruct_enrollment_with_gender(
    repository: MetricsRepository,
    year: int,
    sessions: dict[int, Any],
    day_offset: int,
    season_start: datetime,
    ag_parent_map: dict[int, int] | None = None,
    week0_window: bool = True,
) -> dict[int, dict[str, int | None]]:
    """Reconstruct enrollment counts with gender breakdown.

    Returns {session_cm_id: {
        "enrolled": int, "waitlisted": None (unknown), "cancelled": int,
        "enrolled_boys": int | None, "enrolled_girls": int | None
    }}

    Gender is derived from the person relation. If expand_person data
    is available, gender counts are populated per-session; otherwise None.
    """
    attendees = await repository.fetch_attendees_with_dates(year, expand_person=True)
    return _reconstruct_core(attendees, sessions, day_offset, season_start, ag_parent_map, week0_window)


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


@dataclass
class _EventBuckets:
    """Daily event buckets from one pass over attendees: combined, per session, and per group when asked."""

    combined: dict[str, dict[str, int]]
    per_session: dict[int, dict[str, dict[str, int]]]
    combined_has_gender: bool
    per_session_has_gender: dict[int, bool]
    by_group: dict[str, dict[str, dict[str, int]]]
    by_session_group: dict[tuple[int, str], dict[str, dict[str, int]]]


def _bucket_events(
    attendees: list[Any],
    sessions: dict[int, Any],
    end_iso: str,
    ag_parent_map: dict[int, int] | None,
    session_cm_id: int | None,
    session_ids: list[int] | None,
    group_of: Callable[[Any], str] | None = None,
) -> _EventBuckets:
    """Bucket attendees' registration and cancellation days: combined (``session_cm_id``), per session
    (``session_ids``), and, with ``group_of``, per group of the combined attendees."""
    # Build daily event buckets: one for combined, one per session
    combined_events: dict[str, dict[str, int]] = {}
    group_events: dict[str, dict[str, dict[str, int]]] = {}
    session_group_events: dict[tuple[int, str], dict[str, dict[str, int]]] = {}
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
        group = group_of(att) if group_of is not None and include_in_combined else None

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
        enroll_day: str | None = None
        if enroll_date_str:
            enroll_day = parse_date_only(enroll_date_str)

            if include_in_combined:
                bucket = combined_events.setdefault(enroll_day, dict(_empty_bucket))
                bucket["new"] += 1
                if gender == "M":
                    bucket["new_boys"] += 1
                elif gender == "F":
                    bucket["new_girls"] += 1
                if group is not None:
                    group_events.setdefault(group, {}).setdefault(enroll_day, dict(_empty_bucket))["new"] += 1
                    session_group = session_group_events.setdefault((sid, group), {})
                    session_group.setdefault(enroll_day, dict(_empty_bucket))["new"] += 1

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
                # A cancellation dated after the output range whose registration falls
                # inside it is clipped onto the last day, so the final point reads who is
                # actually still enrolled. Left alone, the registration would count and
                # the cancellation would not, and a past season's final would run high.
                if canc_day > end_iso and enroll_day is not None and enroll_day <= end_iso:
                    canc_day = end_iso

                if include_in_combined:
                    bucket = combined_events.setdefault(canc_day, dict(_empty_bucket))
                    bucket["cancelled"] += 1
                    if gender == "M":
                        bucket["canc_boys"] += 1
                    elif gender == "F":
                        bucket["canc_girls"] += 1
                    if group is not None:
                        group_bucket = group_events.setdefault(group, {}).setdefault(canc_day, dict(_empty_bucket))
                        group_bucket["cancelled"] += 1
                        session_group = session_group_events.setdefault((sid, group), {})
                        session_group.setdefault(canc_day, dict(_empty_bucket))["cancelled"] += 1

                if include_in_per_session:
                    sid_events = per_session_events.setdefault(sid, {})
                    bucket = sid_events.setdefault(canc_day, dict(_empty_bucket))
                    bucket["cancelled"] += 1
                    if gender == "M":
                        bucket["canc_boys"] += 1
                    elif gender == "F":
                        bucket["canc_girls"] += 1

    return _EventBuckets(
        combined_events,
        per_session_events,
        combined_has_gender,
        per_session_has_gender,
        group_events,
        session_group_events,
    )


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
    b = _bucket_events(attendees, sessions, end_date.isoformat(), ag_parent_map, session_cm_id, session_ids)
    combined_events = b.combined
    per_session_events = b.per_session
    combined_has_gender = b.combined_has_gender
    per_session_has_gender = b.per_session_has_gender

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


def reconstruct_daily_by_group(
    *,
    attendees: list[Any],
    group_of: Callable[[Any], str],
    season_start: date,
    sessions: dict[int, Any],
    end_date: date,
    ag_parent_map: dict[int, int] | None = None,
    session_cm_id: int | None = None,
    week0: bool = False,
    squeeze_per_session: bool = False,
) -> dict[str, list[DailyDataPoint]]:
    """Daily curves per group (Velocity's gender identity groups, #2898 answer #78) from ONE pass, squeezing the
    pre-season week the way the total it sits beside was squeezed, so the groups add up to it on every day: from
    the whole set's first day (``reconstruct_daily_multi``'s combined curve), or with ``squeeze_per_session`` from
    each session's own first day (Velocity's hybrid total, summed from per-session rebuilds). A group with no events
    is left out."""
    b = _bucket_events(attendees, sessions, end_date.isoformat(), ag_parent_map, session_cm_id, [], group_of)
    if not week0:
        return {
            group: _build_daily_points(events, False, season_start, end_date) for group, events in b.by_group.items()
        }
    anchor_iso = season_start.isoformat()
    if not squeeze_per_session:
        pre_days = [day for day in b.combined if day < anchor_iso]
        earliest = date.fromisoformat(min(pre_days)) if pre_days else None
        return {
            group: _build_daily_points(
                compress_pre_anchor_events(events, season_start, earliest=earliest),
                False,
                season_start,
                end_date,
                week0=True,
            )
            for group, events in b.by_group.items()
        }
    session_earliest: dict[int, str] = {}
    for (sid, _group), events in b.by_session_group.items():
        for day in events:
            if day < anchor_iso and (sid not in session_earliest or day < session_earliest[sid]):
                session_earliest[sid] = day
    squeezed_by_group: dict[str, dict[str, dict[str, int]]] = {}
    for (sid, group), events in b.by_session_group.items():
        earliest_day = session_earliest.get(sid)
        squeezed = compress_pre_anchor_events(
            events, season_start, earliest=date.fromisoformat(earliest_day) if earliest_day else None
        )
        merged = squeezed_by_group.setdefault(group, {})
        for day, bucket in squeezed.items():
            if day in merged:
                _merge_buckets(merged[day], bucket)
            else:
                merged[day] = dict(bucket)
    return {
        group: _build_daily_points(events, False, season_start, end_date, week0=True)
        for group, events in squeezed_by_group.items()
    }
