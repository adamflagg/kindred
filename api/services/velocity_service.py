"""Velocity service - business logic for registration velocity curves.

Computes week-over-week enrollment velocity using either enrollment snapshots
(fast path) or reconstruction from attendee enrollment dates (fallback).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING, Any

from api.schemas.velocity import (
    DailyDataPoint,
    PhaseMarker,
    PriorYearCancelledSummary,
    PriorYearSessionSummary,
    PriorYearVelocity,
    SessionGenderBreakdown,
    VelocityCurve,
    VelocityResponse,
    WeeklyDataPoint,
)
from api.services.camp_calendar import REGISTRATION_TIERS, SEASON_WEEKS, format_week_date_range
from api.services.extractors import extract_gender
from api.services.reconstruction import (
    CANCELLATION_STATUSES,
    ENROLLMENT_STATUSES,
    _get_enrollment_date,
    parse_date_only,
    reconstruct_daily_multi,
)
from api.utils.session_metrics import (
    build_ag_parent_map,
    get_person_from_expand,
    get_session_from_expand,
    resolve_duration_sessions,
)
from api.utils.session_swap import detect_session_swaps

if TYPE_CHECKING:
    from .metrics_repository import MetricsRepository


# Derived from shared REGISTRATION_TIERS: config_key -> (phase, label)
PHASE_KEY_MAP: dict[str, tuple[str, str]] = {
    config_key: (phase, label) for phase, config_key, label in REGISTRATION_TIERS
}


@dataclass(frozen=True)
class SeasonContext:
    """Bundles the four season-scoped parameters threaded through velocity methods."""

    year: int
    season_start: datetime
    season_end: datetime
    today: date


def rollup_daily_to_weekly(
    daily: list[DailyDataPoint],
    season_start: date,
    *,
    is_current_year: bool = False,
) -> list[WeeklyDataPoint]:
    """Derive weekly data points from daily data.

    Groups daily points into 7-day buckets anchored to season_start.
    Week 1 = day_offset 0-6, Week 2 = 7-13, etc.
    """
    if not daily:
        return []

    buckets: dict[int, list[DailyDataPoint]] = defaultdict(list)
    for dp in daily:
        week_num = (dp.day_offset // 7) + 1
        buckets[week_num].append(dp)

    result: list[WeeklyDataPoint] = []
    max_week = max(buckets.keys())

    for week_num in sorted(buckets.keys()):
        points = buckets[week_num]
        last = points[-1]

        # Week start/end dates (idealized bucket boundaries)
        week_start_date = season_start + timedelta(days=(week_num - 1) * 7)
        week_end_date = season_start + timedelta(days=week_num * 7 - 1)

        week_label = _week_label(week_start_date, season_start)

        # Aggregations
        weekly_new = sum(dp.daily_new for dp in points)
        weekly_cancelled = sum(dp.daily_cancelled for dp in points)
        is_partial = is_current_year and week_num == max_week and len(points) < 7

        # Gender: use last-day cumulatives if any point has gender data
        has_gender = any(dp.enrolled_boys is not None for dp in points)

        # Data source
        sources = {dp.data_source for dp in points}
        data_source = "mixed" if len(sources) > 1 else sources.pop()

        result.append(
            WeeklyDataPoint(
                week_number=week_num,
                week_label=week_label,
                week_start=week_start_date.isoformat(),
                week_end=week_end_date.isoformat(),
                is_partial=is_partial,
                days_in_week=len(points),
                enrolled=last.enrolled,
                gross_enrolled=last.gross_enrolled,
                weekly_new=weekly_new,
                weekly_cancelled=weekly_cancelled,
                delta=weekly_new - weekly_cancelled,
                enrolled_boys=last.enrolled_boys if has_gender else None,
                enrolled_girls=last.enrolled_girls if has_gender else None,
                gross_enrolled_boys=last.gross_enrolled_boys if has_gender else None,
                gross_enrolled_girls=last.gross_enrolled_girls if has_gender else None,
                weekly_new_boys=sum(dp.daily_new_boys or 0 for dp in points) if has_gender else None,
                weekly_new_girls=sum(dp.daily_new_girls or 0 for dp in points) if has_gender else None,
                weekly_cancelled_boys=sum(dp.daily_cancelled_boys or 0 for dp in points) if has_gender else None,
                weekly_cancelled_girls=sum(dp.daily_cancelled_girls or 0 for dp in points) if has_gender else None,
                data_source=data_source,
            )
        )

    return result


def _week_start(d: datetime, season_start: datetime) -> datetime:
    """Start of 7-day bucket containing d, anchored to season_start. Pre-anchor → anchor - 7d."""
    days_since = (d - season_start).days
    if days_since < 0:
        return season_start - timedelta(days=7)
    return season_start + timedelta(days=(days_since // 7) * 7)


def _week_label(d: datetime | date, season_start: datetime | date) -> str:
    """Format a date as a week label like 'Wk N (Jan 6–12)' or 'Wk 0 (Nov 5–11)'."""
    week_num = _week_number(d, season_start)
    anchor = season_start.date() if isinstance(season_start, datetime) else season_start
    return f"Wk {week_num} ({format_week_date_range(anchor, week_num)})"


def _compute_season_start(reg_dates: dict[str, str], year: int) -> datetime | None:
    """Compute season start from registration config.

    Tries priority_reg_date first (2021+), falls back to early_reg_date (pre-2021).
    Returns None if neither is configured.
    """
    for key in ("priority_reg_date", "early_reg_date"):
        date_str = reg_dates.get(key)
        if date_str:
            return datetime.strptime(date_str.split("T")[0].split(" ")[0], "%Y-%m-%d")
    return None


def _season_end(priority_reg_date: datetime) -> datetime:
    """Return the season end: priority_reg_date + SEASON_WEEKS * 7 days."""
    return priority_reg_date + timedelta(days=SEASON_WEEKS * 7)


def _week_number(d: datetime | date, priority_reg_date: datetime | date) -> int:
    """Compute week offset from priority_reg_date. Returns 0 for pre-anchor dates, 1+ otherwise."""
    d_date = d.date() if isinstance(d, datetime) else d
    ref_date = priority_reg_date.date() if isinstance(priority_reg_date, datetime) else priority_reg_date
    days = (d_date - ref_date).days
    if days < 0:
        return 0
    return days // 7 + 1


def _partial_week_info(week_start_str: str, year: int, *, today: date | None = None) -> tuple[bool, int]:
    """Check if a week bucket is partial (incomplete). Returns (is_partial, days_in_week).

    Only the current year can have partial weeks. A week is partial when
    today falls within the 7-day bucket starting at week_start_str.
    """
    ref = today or datetime.now(tz=UTC).date()
    if year != ref.year:
        return False, 7
    ws = datetime.strptime(week_start_str, "%Y-%m-%d").date()
    week_end = ws + timedelta(days=7)
    if ws <= ref < week_end:
        return True, (ref - ws).days + 1
    return False, 7


def _value_at_week(weekly: list[WeeklyDataPoint], target_wn: int) -> int | None:
    """Look up enrolled value at target week, falling back to closest prior week."""
    wn_map = {p.week_number: p.enrolled for p in weekly}
    value = wn_map.get(target_wn)
    if value is not None:
        return value
    closest_wn = None
    for wn in sorted(wn_map.keys()):
        if wn <= target_wn:
            closest_wn = wn
    if closest_wn is not None:
        return wn_map[closest_wn]
    return None


def _daily_counts_to_weekly_points(
    daily_counts: dict[str, int],
    season_start: datetime,
    *,
    track_gross: bool = False,
    year: int = 0,
    today: date | None = None,
) -> list[WeeklyDataPoint]:
    """Bucket daily counts into weekly periods and build cumulative WeeklyDataPoints.

    Args:
        daily_counts: date_key -> count mapping.
        season_start: priority_reg_date for bucketing.
        track_gross: If True, set gross_enrolled/weekly_new from the count
                     (used for enrollment). If False, leave them at 0
                     (used for cancellation curves).
        year: Data year, used for partial week detection.
        today: Override for current date (testing).
    """
    weekly_counts: dict[str, int] = defaultdict(int)
    for date_key, count in daily_counts.items():
        dt = datetime.strptime(date_key, "%Y-%m-%d")
        bucket = _week_start(dt, season_start)
        bucket_key = bucket.strftime("%Y-%m-%d")
        weekly_counts[bucket_key] += count

    cumulative = 0
    points: list[WeeklyDataPoint] = []

    for bucket_key in sorted(weekly_counts.keys()):
        new_count = weekly_counts[bucket_key]
        cumulative += new_count
        prev_val = points[-1].enrolled if points else 0
        delta = cumulative - prev_val

        bucket_dt = datetime.strptime(bucket_key, "%Y-%m-%d")
        wn = _week_number(bucket_dt, season_start)
        week_end_date = bucket_dt + timedelta(days=6)
        is_partial, days_in_week = _partial_week_info(bucket_key, year, today=today)
        points.append(
            WeeklyDataPoint(
                week_start=bucket_key,
                week_end=week_end_date.strftime("%Y-%m-%d"),
                week_label=_week_label(bucket_dt, season_start),
                week_number=wn,
                enrolled=cumulative,
                delta=delta,
                data_source="reconstructed",
                gross_enrolled=cumulative if track_gross else 0,
                weekly_new=new_count if track_gross else 0,
                weekly_cancelled=0,
                is_partial=is_partial,
                days_in_week=days_in_week,
            )
        )

    return points


class _CurveResult:
    """Internal result from curve building, includes extra metadata."""

    __slots__ = ("by_session", "by_session_daily", "cancelled_to_date", "combined")

    def __init__(
        self,
        combined: VelocityCurve,
        by_session: list[VelocityCurve],
        cancelled_to_date: int = 0,
        by_session_daily: dict[int, list[DailyDataPoint]] | None = None,
    ) -> None:
        self.combined = combined
        self.by_session = by_session
        self.cancelled_to_date = cancelled_to_date
        self.by_session_daily = by_session_daily or {}


class VelocityService:
    """Business logic for registration velocity curves."""

    def __init__(self, repository: MetricsRepository) -> None:
        self.repo = repository

    @staticmethod
    def _build_gender_breakdown(
        sessions: dict[int, Any],
        session_gender_totals: dict[int, dict[str, int]],
    ) -> list[SessionGenderBreakdown]:
        """Build per-session gender breakdown from accumulated totals."""
        return [
            SessionGenderBreakdown(
                session_cm_id=sid,
                session_name=getattr(sessions.get(sid), "name", f"Session {sid}"),
                boys_enrolled=totals["M"],
                girls_enrolled=totals["F"],
            )
            for sid, totals in sorted(session_gender_totals.items())
        ]

    @staticmethod
    def _attendee_session_in(attendee: Any, session_ids: set[int]) -> bool:
        """Check if an attendee's session cm_id is in the given set.

        Args:
            attendee: Attendee record with expand containing session.
            session_ids: Set of session cm_ids to check against.

        Returns:
            True if the attendee's session cm_id is in session_ids.
        """
        session_info = get_session_from_expand(attendee)
        if not session_info:
            return False
        sid = getattr(session_info, "cm_id", None)
        if sid is None:
            return False
        return int(sid) in session_ids

    @staticmethod
    def _snapshots_have_gender_data(snapshots: list[Any]) -> bool:
        """Check if snapshots contain gender count data.

        Old snapshots (pre-migration) will have None for gender fields.
        Returns True only if first snapshot has non-None enrolled_male_count.
        """
        if not snapshots:
            return False
        return getattr(snapshots[0], "enrolled_male_count", None) is not None

    def _gender_data_from_snapshots(
        self,
        ctx: SeasonContext,
        snapshots: list[Any],
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
    ) -> tuple[dict[str, dict[int, list[WeeklyDataPoint]]], dict[int, dict[str, int]]]:
        """Extract per-gender per-session weekly data from snapshot gender counts.

        Returns (gender_per_session, session_gender_totals) where:
        - gender_per_session["M"][sid] = list of WeeklyDataPoint
        - session_gender_totals[sid] = {"M": count, "F": count}
        """
        # Group snapshots by gender -> session -> date with enrolled counts
        gender_session_date: dict[str, dict[int, dict[str, int]]] = {
            "M": defaultdict(dict),
            "F": defaultdict(dict),
        }
        gender_session_cancelled: dict[str, dict[int, dict[str, int]]] = {
            "M": defaultdict(dict),
            "F": defaultdict(dict),
        }

        # Track latest snapshot per session for breakdown
        session_latest: dict[int, tuple[str, int, int]] = {}  # sid -> (date, male, female)

        # First pass: deduplicate — keep latest snapshot per raw session per date.
        raw_gender: dict[tuple[int, str], tuple[int, int, int, int]] = {}
        raw_gender_dt: dict[tuple[int, str], str] = {}
        for snap in snapshots:
            raw_sid = int(snap.session_cm_id)
            snap_dt = snap.snapshot_datetime
            date_str = snap_dt.split("T")[0].split(" ")[0]
            key = (raw_sid, date_str)
            if key not in raw_gender_dt or snap_dt > raw_gender_dt[key]:
                raw_gender[key] = (
                    int(getattr(snap, "enrolled_male_count", 0) or 0),
                    int(getattr(snap, "enrolled_female_count", 0) or 0),
                    int(getattr(snap, "cancelled_male_count", 0) or 0),
                    int(getattr(snap, "cancelled_female_count", 0) or 0),
                )
                raw_gender_dt[key] = snap_dt

        # Second pass: merge AG children into parent sessions
        for (raw_sid, date_str), (male, female, canc_m, canc_f) in raw_gender.items():
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)
            gender_session_date["M"][effective_sid][date_str] = (
                gender_session_date["M"][effective_sid].get(date_str, 0) + male
            )
            gender_session_date["F"][effective_sid][date_str] = (
                gender_session_date["F"][effective_sid].get(date_str, 0) + female
            )
            gender_session_cancelled["M"][effective_sid][date_str] = (
                gender_session_cancelled["M"][effective_sid].get(date_str, 0) + canc_m
            )
            gender_session_cancelled["F"][effective_sid][date_str] = (
                gender_session_cancelled["F"][effective_sid].get(date_str, 0) + canc_f
            )

            # Track latest snapshot per session for breakdown (accumulate AG)
            prev = session_latest.get(effective_sid)
            if prev is None or date_str >= prev[0]:
                if prev is not None and date_str == prev[0]:
                    session_latest[effective_sid] = (date_str, prev[1] + male, prev[2] + female)
                else:
                    session_latest[effective_sid] = (date_str, male, female)

        # Filter by session_cm_id if specified
        if session_cm_id is not None:
            for gender in ("M", "F"):
                gender_session_date[gender] = {
                    sid: dates for sid, dates in gender_session_date[gender].items() if sid == session_cm_id
                }
                gender_session_cancelled[gender] = {
                    sid: dates for sid, dates in gender_session_cancelled[gender].items() if sid == session_cm_id
                }
            session_latest = {sid: v for sid, v in session_latest.items() if sid == session_cm_id}

        # Filter out sessions not in the sessions dict
        for gender in ("M", "F"):
            gender_session_date[gender] = {
                sid: dates for sid, dates in gender_session_date[gender].items() if sid in sessions
            }
            gender_session_cancelled[gender] = {
                sid: dates for sid, dates in gender_session_cancelled[gender].items() if sid in sessions
            }
        session_latest = {sid: v for sid, v in session_latest.items() if sid in sessions}

        # Build per-session weekly data per gender
        gender_per_session: dict[str, dict[int, list[WeeklyDataPoint]]] = {}
        for gender in ("M", "F"):
            per_session_data: dict[int, list[WeeklyDataPoint]] = {}
            for sid, date_counts in gender_session_date[gender].items():
                date_data: dict[str, dict[str, int]] = {d: {"enrolled": c} for d, c in date_counts.items()}
                cancelled_for_session = gender_session_cancelled[gender].get(sid, {})
                weekly = self._aggregate_snapshots_to_weekly(date_data, cancelled_for_session, ctx)
                per_session_data[sid] = weekly
            gender_per_session[gender] = per_session_data

        session_gender_totals: dict[int, dict[str, int]] = {
            sid: {"M": vals[1], "F": vals[2]} for sid, vals in session_latest.items()
        }

        return gender_per_session, session_gender_totals

    @staticmethod
    def _build_cancellation_daily_per_session(
        date_counts: dict[int, dict[str, int]],
        sessions: dict[int, Any],
        session_cm_id: int | None,
        season_start: date,
        season_end: date | None,
        data_source: str,
        cumulative_input: bool = True,
    ) -> dict[int, list[DailyDataPoint]]:
        """Build per-session daily cancellation DailyDataPoint lists.

        Args:
            date_counts: {session_id: {date_str: count}} - per-session date counts.
            sessions: Known sessions dict (used for filtering).
            session_cm_id: If set, only build for this session.
            season_start: Season start date for day_offset calculation.
            season_end: If set, filter out dates outside [season_start, season_end].
            data_source: Label for DailyDataPoint.data_source.
            cumulative_input: If True, values in date_counts are cumulative totals
                (daily delta = current - previous). If False, values are daily counts
                (cumulative = running sum).
        """
        per_session_daily: dict[int, list[DailyDataPoint]] = {}
        for sid, date_data in date_counts.items():
            if sid not in sessions:
                continue
            if session_cm_id is not None and sid != session_cm_id:
                continue
            sid_daily_points: list[DailyDataPoint] = []
            prev_c = 0
            cum = 0
            for ds in sorted(date_data.keys()):
                dt = datetime.strptime(ds, "%Y-%m-%d").date()
                if season_end is not None and (dt < season_start or dt > season_end):
                    continue
                c = date_data[ds]
                if cumulative_input:
                    daily_cancelled = max(c - prev_c, 0)
                    cumulative_val = c
                    prev_c = c
                else:
                    daily_cancelled = c
                    cum += c
                    cumulative_val = cum
                sid_daily_points.append(
                    DailyDataPoint(
                        date=ds,
                        day_offset=(dt - season_start).days,
                        gross_enrolled=0,
                        enrolled=cumulative_val,
                        cancelled=cumulative_val,
                        daily_new=0,
                        daily_cancelled=daily_cancelled,
                        data_source=data_source,
                    )
                )
            if sid_daily_points:
                per_session_daily[sid] = sid_daily_points
        return per_session_daily

    @staticmethod
    def _build_session_curves(
        year: int,
        sessions: dict[int, Any],
        per_session_data: dict[int, list[WeeklyDataPoint]],
    ) -> list[VelocityCurve]:
        """Build per-session VelocityCurves from per_session_data."""
        return [
            VelocityCurve(
                year=year,
                session_cm_id=sid,
                session_name=getattr(sessions.get(sid), "name", f"Session {sid}"),
                gender=None,
                weekly=data,
            )
            for sid, data in sorted(per_session_data.items())
        ]

    async def get_velocity(
        self,
        year: int,
        session_cm_id: int | None = None,
        compare_years: list[int] | None = None,
        session_types: list[str] | None = None,
        split_by_gender: bool = False,
        metric: str = "enrollment",
        today: date | None = None,
        duration: str | None = None,
    ) -> VelocityResponse:
        """Get registration velocity curves with week-over-week data.

        Args:
            metric: 'enrollment' (default) or 'cancellation' to switch curve type.
        """
        # Pre-fetch reg dates for dynamic season start
        reg_dates = await self.repo.fetch_registration_dates(year)
        season_start_dt = _compute_season_start(reg_dates, year)
        warnings: list[str] = []

        # If no registration date configured, return empty response with warning
        if season_start_dt is None:
            empty_combined = VelocityCurve(year=year, session_cm_id=None, gender=None, weekly=[])
            warnings.append(
                f"Year {year} has no registration date configured (needs priority_reg_date or early_reg_date)"
            )
            return VelocityResponse(
                year=year,
                season_start="",
                combined=empty_combined,
                by_session=[],
                prior_years=[],
                phase_markers=[],
                warnings=warnings,
                cancelled_to_date=None,
                session_swap_count=0,
            )

        season_end_dt = _season_end(season_start_dt)
        # Fetch sessions for the year
        sessions = await self.repo.fetch_sessions(year, session_types=session_types)
        # Filter sessions by duration category
        if duration:
            duration_session_ids = resolve_duration_sessions(sessions, duration)
            sessions = {sid: s for sid, s in sessions.items() if sid in duration_session_ids}
        ag_parent_map = build_ag_parent_map(sessions)

        ref_today = today or datetime.now(tz=UTC).date()
        ctx = SeasonContext(year=year, season_start=season_start_dt, season_end=season_end_dt, today=ref_today)

        # Pre-fetch snapshots once for enrollment metric (avoids duplicate fetch
        # when both _build_curves and _build_gender_curves need the same data).
        snapshots: list[Any] | None = None
        if metric != "cancellation":
            snapshots = await self.repo.fetch_enrollment_snapshots(ctx.year, session_cm_id=session_cm_id)

        # Pre-fetch status transitions once for cancellation metric (avoids duplicate fetch
        # when both _build_cancellation_curves and _build_cancellation_gender_curves need the same data).
        # Fetch with expand_person=True so gender data is available for both consumers
        # (reconstruction only reads session from expand, so extra person data is harmless).
        cancellations: list[Any] | None = None
        if metric == "cancellation":
            cancellations = await self.repo.fetch_status_transitions(
                year, ["cancelled", "withdrawn", "dismissed"], expand_person=True
            )

        # Build curves for the primary year (dispatch by metric type)
        if metric == "cancellation":
            result = await self._build_cancellation_curves(
                ctx, sessions, ag_parent_map, session_cm_id, cancellations=cancellations
            )
        else:
            result = await self._build_curves(ctx, sessions, ag_parent_map, session_cm_id, snapshots=snapshots)

        combined = result.combined
        by_session = result.by_session
        cancelled_to_date = result.cancelled_to_date

        # Build gender-split curves if requested
        by_gender: list[VelocityCurve] = []
        session_gender_breakdown: list[SessionGenderBreakdown] = []
        if split_by_gender:
            if metric == "cancellation":
                by_gender, session_gender_breakdown = await self._build_cancellation_gender_curves(
                    ctx, sessions, ag_parent_map, session_cm_id, cancellations=cancellations
                )
            else:
                by_gender, session_gender_breakdown = await self._build_gender_curves(
                    ctx,
                    sessions,
                    ag_parent_map,
                    session_cm_id,
                    combined_daily=combined.daily,
                    snapshots=snapshots,
                )

        # Build prior year curves
        prior_years: list[PriorYearVelocity] = []
        prior_year_by_gender: list[VelocityCurve] = []
        prior_year_cancelled_to_date: list[PriorYearCancelledSummary] = []
        prior_year_session_summaries: list[PriorYearSessionSummary] = []
        prior_year_season_starts: dict[int, str] = {}

        # Get current year's latest week_number for prior year comparisons
        current_max_wn = combined.weekly[-1].week_number if combined.weekly else None

        if compare_years:
            for prior_year in compare_years:
                prior_reg_dates = await self.repo.fetch_registration_dates(prior_year)
                prior_season_start = _compute_season_start(prior_reg_dates, prior_year)
                if prior_season_start is None:
                    warnings.append(
                        f"Year {prior_year} has no registration date configured"
                        " (needs priority_reg_date or early_reg_date)"
                    )
                    continue
                prior_year_season_starts[prior_year] = prior_season_start.strftime("%Y-%m-%d")
                prior_season_end = _season_end(prior_season_start)
                prior_sessions = await self.repo.fetch_sessions(prior_year, session_types=session_types)
                if duration:
                    prior_duration_ids = resolve_duration_sessions(prior_sessions, duration)
                    prior_sessions = {sid: s for sid, s in prior_sessions.items() if sid in prior_duration_ids}
                prior_ag_map = build_ag_parent_map(prior_sessions)
                prior_ctx = SeasonContext(
                    year=prior_year,
                    season_start=prior_season_start,
                    season_end=prior_season_end,
                    today=ref_today,
                )

                if metric == "cancellation":
                    prior_result = await self._build_cancellation_curves(
                        prior_ctx,
                        prior_sessions,
                        prior_ag_map,
                        session_cm_id=None,
                    )
                else:
                    prior_result = await self._build_curves(
                        prior_ctx,
                        prior_sessions,
                        prior_ag_map,
                        session_cm_id=None,
                    )
                prior_years.append(
                    PriorYearVelocity(
                        year=prior_result.combined.year,
                        daily=prior_result.combined.daily,
                        weekly=prior_result.combined.weekly,
                    )
                )

                # Build prior year cancelled summary
                prior_year_cancelled_to_date.append(
                    self._build_prior_cancelled_summary(
                        prior_year,
                        prior_result,
                        current_max_wn,
                        metric=metric,
                    )
                )

                # Build prior year session summaries
                prior_year_session_summaries.extend(
                    self._build_prior_session_summaries(
                        prior_year,
                        prior_result.by_session,
                        current_max_wn,
                    )
                )

                if split_by_gender:
                    if metric == "cancellation":
                        prior_gender_curves, _ = await self._build_cancellation_gender_curves(
                            prior_ctx,
                            prior_sessions,
                            prior_ag_map,
                            session_cm_id=None,
                        )
                    else:
                        prior_gender_curves, _ = await self._build_gender_curves(
                            prior_ctx,
                            prior_sessions,
                            prior_ag_map,
                            session_cm_id=None,
                            combined_daily=prior_result.combined.daily,
                        )
                    prior_year_by_gender.extend(prior_gender_curves)

        # Add warning when reconstruction is used (pre-effective_date data has approximate timing)
        if any(p.data_source == "reconstructed" for p in combined.weekly):
            warnings.append(
                "Reconstruction used for some weeks: cancellation timing may be approximate "
                "for records synced before effective_date was stored."
            )

        # Fetch phase markers (pass reg_dates to avoid double fetch)
        phase_markers = self._build_phase_markers(reg_dates, season_start_dt)

        # Detect session swaps for cancellation metric
        session_swap_count = 0
        if metric == "cancellation":
            all_attendees = await self.repo.fetch_attendees_with_dates(year, session_cm_id=session_cm_id)
            # Filter attendees to duration-scoped sessions so swap count
            # reflects the same scope as the cancellation curves.
            duration_scoped_sids = set(sessions.keys())
            cancelled_atts = [
                a
                for a in all_attendees
                if getattr(a, "status", "") in ("cancelled", "withdrawn", "dismissed")
                and self._attendee_session_in(a, duration_scoped_sids)
            ]
            enrolled_atts = [
                a
                for a in all_attendees
                if getattr(a, "status", "") == "enrolled" and self._attendee_session_in(a, duration_scoped_sids)
            ]
            swap_pids = detect_session_swaps(cancelled_atts, enrolled_atts)
            if session_cm_id is not None:
                # Filter swap_pids to those with cancellations in the viewed session
                scoped_pids: set[int] = set()
                for a in cancelled_atts:
                    session_info = get_session_from_expand(a)
                    if session_info and int(getattr(session_info, "cm_id", 0)) == session_cm_id:
                        scoped_pids.add(int(getattr(a, "person_id", 0)))
                swap_pids = swap_pids & scoped_pids
            session_swap_count = len(swap_pids)

        return VelocityResponse(
            year=year,
            season_start=season_start_dt.strftime("%Y-%m-%d"),
            combined=combined,
            by_session=by_session,
            by_gender=by_gender,
            daily=combined.daily,
            weekly=combined.weekly,
            prior_years=prior_years,
            prior_year_by_gender=prior_year_by_gender,
            phase_markers=phase_markers,
            session_gender_breakdown=session_gender_breakdown,
            cancelled_to_date=cancelled_to_date,
            prior_year_cancelled_to_date=prior_year_cancelled_to_date,
            prior_year_session_summaries=prior_year_session_summaries,
            prior_year_season_starts=prior_year_season_starts,
            session_swap_count=session_swap_count,
            warnings=warnings,
        )

    @staticmethod
    def _find_earliest_snapshot_datetime(snapshots: list[Any], season_start: datetime) -> datetime | None:
        """Find the earliest snapshot_datetime >= season_start across all snapshots."""
        earliest: datetime | None = None
        for snap in snapshots:
            dt = datetime.strptime(snap.snapshot_datetime.split("T")[0].split(" ")[0], "%Y-%m-%d")
            if dt.date() < season_start.date():
                continue
            if earliest is None or dt < earliest:
                earliest = dt
        return earliest

    @staticmethod
    def _recompute_deltas(points: list[WeeklyDataPoint]) -> list[WeeklyDataPoint]:
        """Recompute delta, weekly_new, weekly_cancelled across a concatenated sequence.

        Handles both enrollment mode (has gross_enrolled) and cancellation mode
        (gross_enrolled=0, enrolled tracks cumulative cancelled count).
        """
        result: list[WeeklyDataPoint] = []
        prev_enrolled = 0
        prev_gross = 0
        prev_cancelled_cum = 0

        for p in points:
            delta = p.enrolled - prev_enrolled
            # For cancellation mode (gross_enrolled=0), keep weekly_new/weekly_cancelled as-is
            if p.gross_enrolled == 0:
                result.append(
                    WeeklyDataPoint(
                        week_start=p.week_start,
                        week_end=p.week_end,
                        week_label=p.week_label,
                        week_number=p.week_number,
                        enrolled=p.enrolled,
                        delta=delta,
                        data_source=p.data_source,
                        gross_enrolled=0,
                        weekly_new=0,
                        weekly_cancelled=0,
                        is_partial=p.is_partial,
                        days_in_week=p.days_in_week,
                    )
                )
            else:
                weekly_new = p.gross_enrolled - prev_gross
                weekly_cancelled = (p.gross_enrolled - p.enrolled) - prev_cancelled_cum
                result.append(
                    WeeklyDataPoint(
                        week_start=p.week_start,
                        week_end=p.week_end,
                        week_label=p.week_label,
                        week_number=p.week_number,
                        enrolled=p.enrolled,
                        delta=delta,
                        data_source=p.data_source,
                        gross_enrolled=p.gross_enrolled,
                        weekly_new=weekly_new,
                        weekly_cancelled=weekly_cancelled,
                        is_partial=p.is_partial,
                        days_in_week=p.days_in_week,
                    )
                )
                prev_gross = p.gross_enrolled
                prev_cancelled_cum = p.gross_enrolled - p.enrolled
            prev_enrolled = p.enrolled

        return result

    def _merge_hybrid_curves(
        self,
        recon_by_session: dict[int, list[WeeklyDataPoint]],
        snap_by_session: dict[int, list[WeeklyDataPoint]],
        season_start: datetime,
    ) -> dict[int, list[WeeklyDataPoint]]:
        """Per-session merge: reconstructed points before first snapshot, then snapshot points.

        For each session, find that session's first snapshot week, take reconstructed points
        before it, append all snapshot points, and recompute deltas across the boundary.
        Sessions in only one source use that source as-is.
        """
        all_sids = set(recon_by_session.keys()) | set(snap_by_session.keys())
        merged: dict[int, list[WeeklyDataPoint]] = {}

        for sid in all_sids:
            recon_points = recon_by_session.get(sid, [])
            snap_points = snap_by_session.get(sid, [])

            if not snap_points:
                merged[sid] = recon_points
                continue
            if not recon_points:
                merged[sid] = snap_points
                continue

            # Find this session's first snapshot week
            first_snap_week = _week_start(
                datetime.strptime(snap_points[0].week_start, "%Y-%m-%d"), season_start
            ).strftime("%Y-%m-%d")

            # Take reconstructed points strictly before first snapshot week
            pre_snap = [p for p in recon_points if p.week_start < first_snap_week]

            # Concatenate and recompute deltas
            combined = pre_snap + snap_points
            merged[sid] = self._recompute_deltas(combined)

        return merged

    @staticmethod
    def _merge_hybrid_daily(
        recon_daily: list[DailyDataPoint],
        snap_daily: list[DailyDataPoint],
    ) -> list[DailyDataPoint]:
        """Merge reconstruction and snapshot daily data for hybrid mode.

        Takes reconstruction daily points before the first snapshot date,
        then snapshot daily points from that date onward. Recomputes daily_new
        and daily_cancelled at the boundary so deltas are correct across the
        handoff from reconstruction to snapshots.
        """
        if not snap_daily:
            return recon_daily
        if not recon_daily:
            return snap_daily

        # Find the earliest snapshot date
        first_snap_date = snap_daily[0].date

        # Take reconstruction points strictly before first snapshot
        pre_snap = [dp for dp in recon_daily if dp.date < first_snap_date]

        if not pre_snap:
            # No reconstruction data before snapshots — use snapshot data as-is
            return snap_daily

        # Build merged list: pre-snapshot recon + snapshot points
        merged: list[DailyDataPoint] = list(pre_snap)

        # Recompute daily_new / daily_cancelled at the handoff boundary so that
        # rollup_daily_to_weekly produces correct deltas across the transition.
        prev_gross = pre_snap[-1].gross_enrolled
        prev_cancelled = pre_snap[-1].cancelled

        for dp in snap_daily:
            # Recompute daily_new and daily_cancelled relative to the previous point
            new_daily_new = dp.gross_enrolled - prev_gross
            new_daily_cancelled = dp.cancelled - prev_cancelled

            merged.append(
                DailyDataPoint(
                    date=dp.date,
                    day_offset=dp.day_offset,
                    gross_enrolled=dp.gross_enrolled,
                    enrolled=dp.enrolled,
                    cancelled=dp.cancelled,
                    daily_new=max(new_daily_new, 0),
                    daily_cancelled=max(new_daily_cancelled, 0),
                    daily_new_boys=dp.daily_new_boys,
                    daily_new_girls=dp.daily_new_girls,
                    daily_cancelled_boys=dp.daily_cancelled_boys,
                    daily_cancelled_girls=dp.daily_cancelled_girls,
                    gross_enrolled_boys=dp.gross_enrolled_boys,
                    gross_enrolled_girls=dp.gross_enrolled_girls,
                    enrolled_boys=dp.enrolled_boys,
                    enrolled_girls=dp.enrolled_girls,
                    data_source=dp.data_source,
                )
            )
            prev_gross = dp.gross_enrolled
            prev_cancelled = dp.cancelled

        return merged

    def _merge_hybrid_daily_per_session(
        self,
        recon_by_session_daily: dict[int, list[DailyDataPoint]],
        snap_by_session_daily: dict[int, list[DailyDataPoint]],
    ) -> dict[int, list[DailyDataPoint]]:
        """Per-session daily merge: apply _merge_hybrid_daily independently for each session.

        Each session uses its own first snapshot date as the cutover point, ensuring
        sessions with later snapshot coverage keep their reconstruction daily data
        until their own snapshots begin.
        """
        all_sids = set(recon_by_session_daily.keys()) | set(snap_by_session_daily.keys())
        merged: dict[int, list[DailyDataPoint]] = {}

        for sid in all_sids:
            recon_daily = recon_by_session_daily.get(sid, [])
            snap_daily = snap_by_session_daily.get(sid, [])
            merged[sid] = self._merge_hybrid_daily(recon_daily, snap_daily)

        return merged

    @staticmethod
    def _aggregate_per_session_daily(
        per_session_daily: dict[int, list[DailyDataPoint]],
    ) -> list[DailyDataPoint]:
        """Aggregate per-session daily data into a combined daily series.

        Sums enrolled/cancelled/gross_enrolled across sessions per date with
        carry-forward: if a session has no data point on a given date, its last
        known cumulative values are used. This prevents combined totals from
        dropping when one session has sparser data than another.
        """
        if not per_session_daily:
            return []

        # Build per-session lookup: sid -> {date -> DailyDataPoint}
        session_point_maps: dict[int, dict[str, DailyDataPoint]] = {}
        all_dates: set[str] = set()

        for sid, daily_points in per_session_daily.items():
            point_map: dict[str, DailyDataPoint] = {}
            for dp in daily_points:
                point_map[dp.date] = dp
                all_dates.add(dp.date)
            session_point_maps[sid] = point_map

        if not all_dates:
            return []

        sorted_dates = sorted(all_dates)

        # Track last known cumulative values per session for carry-forward
        last_known: dict[int, DailyDataPoint | None] = dict.fromkeys(per_session_daily)

        result: list[DailyDataPoint] = []
        prev_gross = 0
        prev_cancelled = 0

        for date_str in sorted_dates:
            total_gross = 0
            total_enrolled = 0
            total_cancelled = 0
            sources: set[str] = set()

            for sid, point_map in session_point_maps.items():
                if date_str in point_map:
                    dp = point_map[date_str]
                    last_known[sid] = dp
                    total_gross += dp.gross_enrolled
                    total_enrolled += dp.enrolled
                    total_cancelled += dp.cancelled
                    sources.add(dp.data_source)
                else:
                    # Carry forward last known cumulative values
                    lk = last_known[sid]
                    if lk is not None:
                        total_gross += lk.gross_enrolled
                        total_enrolled += lk.enrolled
                        total_cancelled += lk.cancelled
                        sources.add(lk.data_source)

            daily_new = total_gross - prev_gross
            daily_cancelled = total_cancelled - prev_cancelled
            data_source = (
                "snapshot"
                if sources == {"snapshot"}
                else ("reconstructed" if sources == {"reconstructed"} else "mixed")
            )

            # Compute day_offset from any session that has data on this date
            day_offset = 0
            for sid, point_map in session_point_maps.items():
                if date_str in point_map:
                    day_offset = point_map[date_str].day_offset
                    break

            result.append(
                DailyDataPoint(
                    date=date_str,
                    day_offset=day_offset,
                    gross_enrolled=total_gross,
                    enrolled=total_enrolled,
                    cancelled=total_cancelled,
                    daily_new=max(daily_new, 0),
                    daily_cancelled=max(daily_cancelled, 0),
                    data_source=data_source,
                )
            )
            prev_gross = total_gross
            prev_cancelled = total_cancelled

        return result

    async def _build_curves(
        self,
        ctx: SeasonContext,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        snapshots: list[Any] | None = None,
    ) -> _CurveResult:
        """Build combined and per-session velocity curves for a year.

        Uses hybrid mode when snapshots don't cover the full season: reconstruction
        fills pre-snapshot weeks, snapshots cover the rest.
        """
        if snapshots is None:
            snapshots = await self.repo.fetch_enrollment_snapshots(ctx.year, session_cm_id=session_cm_id)

        if not snapshots:
            return await self._curves_from_reconstruction(ctx, sessions, ag_parent_map, session_cm_id)

        snap_result = self._curves_from_snapshots(ctx, snapshots, sessions, ag_parent_map, session_cm_id)

        # Determine if we need hybrid mode
        earliest = self._find_earliest_snapshot_datetime(snapshots, ctx.season_start)
        if earliest is None:
            return snap_result

        first_snapshot_week = _week_start(earliest, ctx.season_start)
        if first_snapshot_week <= ctx.season_start:
            # Snapshots cover from the start — pure snapshot path
            return snap_result

        # Hybrid: need reconstruction for pre-snapshot weeks
        recon_result = await self._curves_from_reconstruction(ctx, sessions, ag_parent_map, session_cm_id)

        # Build per-session data maps from the curve results
        snap_by_session = {c.session_cm_id: c.weekly for c in snap_result.by_session if c.session_cm_id}
        recon_by_session = {c.session_cm_id: c.weekly for c in recon_result.by_session if c.session_cm_id}

        merged_by_session = self._merge_hybrid_curves(recon_by_session, snap_by_session, ctx.season_start)

        # Merge daily data per-session: each session uses its own first snapshot date as cutover
        merged_per_session_daily = self._merge_hybrid_daily_per_session(
            recon_result.by_session_daily, snap_result.by_session_daily
        )
        merged_daily = self._aggregate_per_session_daily(merged_per_session_daily)

        season_start_date = ctx.season_start.date() if isinstance(ctx.season_start, datetime) else ctx.season_start
        season_end_date = ctx.season_end.date() if isinstance(ctx.season_end, datetime) else ctx.season_end
        is_current_season = season_start_date <= ctx.today <= season_end_date
        combined_weekly = rollup_daily_to_weekly(merged_daily, season_start_date, is_current_year=is_current_season)

        # Fall back to weekly merge if daily merge produced no data
        if not combined_weekly:
            combined_weekly = self._combine_weekly_curves(merged_by_session)

        combined = VelocityCurve(
            year=ctx.year,
            session_cm_id=session_cm_id,
            session_name=None,
            gender=None,
            weekly=combined_weekly,
            daily=merged_daily,
        )
        by_session = self._build_session_curves(ctx.year, sessions, merged_by_session)

        return _CurveResult(
            combined=combined,
            by_session=by_session,
            cancelled_to_date=snap_result.cancelled_to_date,
        )

    def _curves_from_snapshots(
        self,
        ctx: SeasonContext,
        snapshots: list[Any],
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
    ) -> _CurveResult:
        """Build curves from enrollment snapshots (fast path)."""
        # Group snapshots by session, merging AG into parent
        session_date_data: dict[int, dict[str, dict[str, int]]] = defaultdict(
            lambda: defaultdict(lambda: {"enrolled": 0})
        )
        # Track cancelled counts per effective session per date (AG children summed into parent after dedup)
        session_date_cancelled: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))

        # First pass: deduplicate — keep latest snapshot per raw session per date.
        # With always-create snapshots, multiple records may exist per session per day.
        raw_latest: dict[tuple[int, str], tuple[int, int]] = {}
        raw_latest_dt: dict[tuple[int, str], str] = {}
        for snap in snapshots:
            raw_sid = int(snap.session_cm_id)
            snap_dt = snap.snapshot_datetime
            date_str = snap_dt.split("T")[0].split(" ")[0]
            key = (raw_sid, date_str)
            if key not in raw_latest_dt or snap_dt > raw_latest_dt[key]:
                raw_latest[key] = (
                    int(snap.enrolled_count),
                    int(getattr(snap, "cancelled_count", 0) or 0),
                )
                raw_latest_dt[key] = snap_dt

        # Second pass: merge AG children into parent sessions
        for (raw_sid, date_str), (enrolled, cancelled) in raw_latest.items():
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)
            session_date_data[effective_sid][date_str]["enrolled"] += enrolled
            session_date_cancelled[effective_sid][date_str] += cancelled

        # Filter by session if specified
        if session_cm_id is not None:
            session_date_data = {sid: dates for sid, dates in session_date_data.items() if sid == session_cm_id}

        # Filter out sessions not in the sessions dict (excludes non-summer types)
        session_date_data = {sid: d for sid, d in session_date_data.items() if sid in sessions}

        # Compute cancelled_to_date: sum of latest cancelled_count per session
        cancelled_to_date = 0
        for sid in session_date_data:
            if sid in session_date_cancelled:
                dates = session_date_cancelled[sid]
                if dates:
                    latest_date = max(dates.keys())
                    cancelled_to_date += dates[latest_date]

        # Aggregate to weekly per session (last snapshot per week wins)
        per_session_data: dict[int, list[WeeklyDataPoint]] = {}

        for sid, date_data in session_date_data.items():
            cancelled_data = session_date_cancelled.get(sid, {})
            weekly = self._aggregate_snapshots_to_weekly(date_data, cancelled_data, ctx)
            per_session_data[sid] = weekly

        # Build combined curve by summing across sessions per week
        combined_data = self._combine_weekly_curves(per_session_data)

        # Build daily data from snapshots (sum across sessions per date)
        season_start_date = ctx.season_start.date() if isinstance(ctx.season_start, datetime) else ctx.season_start
        daily_data = self._snapshots_to_daily(
            session_date_data, session_date_cancelled, season_start_date, ctx.season_end
        )

        # Build per-session daily for hybrid merging
        per_session_daily = self._snapshots_to_daily_per_session(
            session_date_data, session_date_cancelled, season_start_date, ctx.season_end
        )

        combined = VelocityCurve(
            year=ctx.year,
            session_cm_id=session_cm_id,
            session_name=None,
            gender=None,
            weekly=combined_data,
            daily=daily_data,
        )

        by_session = self._build_session_curves(ctx.year, sessions, per_session_data)

        return _CurveResult(
            combined=combined,
            by_session=by_session,
            cancelled_to_date=cancelled_to_date,
            by_session_daily=per_session_daily,
        )

    def _aggregate_snapshots_to_weekly(
        self,
        date_data: dict[str, dict[str, int]],
        cancelled_data: dict[str, int],
        ctx: SeasonContext,
    ) -> list[WeeklyDataPoint]:
        """Aggregate snapshot data to weekly points (priority_reg_date bucketing, last snapshot per week wins).

        Filters out data before season_start or after season_end.
        """
        # Bucket by 7-day periods anchored to season_start (= priority_reg_date)
        weekly_data: dict[str, dict[str, int]] = {}
        weekly_cancelled: dict[str, int] = {}

        for date_str, counts in sorted(date_data.items()):
            dt = datetime.strptime(date_str.split("T")[0].split(" ")[0], "%Y-%m-%d")
            if dt.date() < ctx.season_start.date():
                continue
            if dt.date() > ctx.season_end.date():
                continue
            bucket = _week_start(dt, ctx.season_start)
            bucket_key = bucket.strftime("%Y-%m-%d")
            # Last snapshot of the week wins (data is sorted by date)
            weekly_data[bucket_key] = counts
            weekly_cancelled[bucket_key] = cancelled_data.get(date_str, 0)

        # Build weekly data points with deltas
        points: list[WeeklyDataPoint] = []
        prev_enrolled = 0
        prev_gross = 0
        prev_cancelled = 0

        for bucket_key in sorted(weekly_data.keys()):
            counts = weekly_data[bucket_key]
            enrolled = counts["enrolled"]
            delta = enrolled - prev_enrolled
            cancelled = weekly_cancelled.get(bucket_key, 0)
            gross = enrolled + cancelled

            bucket_dt = datetime.strptime(bucket_key, "%Y-%m-%d")
            wn = _week_number(bucket_dt, ctx.season_start)
            week_end_date = bucket_dt + timedelta(days=6)
            is_partial, days_in_week = _partial_week_info(bucket_key, ctx.year, today=ctx.today)
            points.append(
                WeeklyDataPoint(
                    week_start=bucket_key,
                    week_end=week_end_date.strftime("%Y-%m-%d"),
                    week_label=_week_label(bucket_dt, ctx.season_start),
                    week_number=wn,
                    enrolled=enrolled,
                    delta=delta,
                    data_source="snapshot",
                    gross_enrolled=gross,
                    weekly_new=gross - prev_gross,
                    weekly_cancelled=cancelled - prev_cancelled,
                    is_partial=is_partial,
                    days_in_week=days_in_week,
                )
            )
            prev_enrolled = enrolled
            prev_gross = gross
            prev_cancelled = cancelled

        return points

    @staticmethod
    def _snapshots_to_daily(
        session_date_data: dict[int, dict[str, dict[str, int]]],
        session_date_cancelled: dict[int, dict[str, int]],
        season_start: date,
        season_end: datetime,
    ) -> list[DailyDataPoint]:
        """Convert deduplicated snapshot data to daily data points.

        Sums enrolled/cancelled across all sessions per date, sorted chronologically.
        Only includes dates within [season_start, season_end].
        """
        # Sum across sessions per date
        combined_dates: dict[str, dict[str, int]] = defaultdict(lambda: {"enrolled": 0, "cancelled": 0})
        for sid, date_data in session_date_data.items():
            for date_str, counts in date_data.items():
                dt = datetime.strptime(date_str.split("T")[0].split(" ")[0], "%Y-%m-%d")
                if dt.date() < season_start:
                    continue
                if dt.date() > season_end.date():
                    continue
                combined_dates[date_str]["enrolled"] += counts.get("enrolled", 0)
            # Add cancelled data
            for date_str, canc in session_date_cancelled.get(sid, {}).items():
                dt = datetime.strptime(date_str.split("T")[0].split(" ")[0], "%Y-%m-%d")
                if dt.date() < season_start:
                    continue
                if dt.date() > season_end.date():
                    continue
                combined_dates[date_str]["cancelled"] += canc

        if not combined_dates:
            return []

        # Build daily points
        result: list[DailyDataPoint] = []
        prev_cancelled = 0
        prev_gross = 0

        for date_str in sorted(combined_dates.keys()):
            data = combined_dates[date_str]
            enrolled = data["enrolled"]
            cancelled = data["cancelled"]
            gross = enrolled + cancelled
            day_offset = (datetime.strptime(date_str, "%Y-%m-%d").date() - season_start).days

            daily_new = gross - prev_gross
            daily_cancelled = cancelled - prev_cancelled

            result.append(
                DailyDataPoint(
                    date=date_str,
                    day_offset=day_offset,
                    gross_enrolled=gross,
                    enrolled=enrolled,
                    cancelled=cancelled,
                    daily_new=max(daily_new, 0),
                    daily_cancelled=max(daily_cancelled, 0),
                    data_source="snapshot",
                )
            )
            prev_cancelled = cancelled
            prev_gross = gross

        return result

    @staticmethod
    def _snapshots_to_daily_per_session(
        session_date_data: dict[int, dict[str, dict[str, int]]],
        session_date_cancelled: dict[int, dict[str, int]],
        season_start: date,
        season_end: datetime,
    ) -> dict[int, list[DailyDataPoint]]:
        """Build per-session daily data points from snapshot data.

        Like _snapshots_to_daily but returns a dict keyed by session ID instead of
        aggregating across sessions. Used for per-session hybrid daily merging.
        """
        result: dict[int, list[DailyDataPoint]] = {}

        for sid, date_data in session_date_data.items():
            session_dates: dict[str, dict[str, int]] = {}
            for date_str, counts in date_data.items():
                dt = datetime.strptime(date_str.split("T")[0].split(" ")[0], "%Y-%m-%d")
                if dt.date() < season_start or dt.date() > season_end.date():
                    continue
                clean_date = dt.strftime("%Y-%m-%d")
                session_dates[clean_date] = {
                    "enrolled": counts.get("enrolled", 0),
                    "cancelled": session_date_cancelled.get(sid, {}).get(date_str, 0),
                }

            if not session_dates:
                continue

            points: list[DailyDataPoint] = []
            prev_gross = 0
            prev_cancelled = 0

            for ds in sorted(session_dates.keys()):
                data = session_dates[ds]
                enrolled = data["enrolled"]
                cancelled = data["cancelled"]
                gross = enrolled + cancelled
                day_offset = (datetime.strptime(ds, "%Y-%m-%d").date() - season_start).days
                daily_new = gross - prev_gross
                daily_cancelled = cancelled - prev_cancelled

                points.append(
                    DailyDataPoint(
                        date=ds,
                        day_offset=day_offset,
                        gross_enrolled=gross,
                        enrolled=enrolled,
                        cancelled=cancelled,
                        daily_new=max(daily_new, 0),
                        daily_cancelled=max(daily_cancelled, 0),
                        data_source="snapshot",
                    )
                )
                prev_gross = gross
                prev_cancelled = cancelled

            result[sid] = points

        return result

    def _combine_weekly_curves(self, per_session_data: dict[int, list[WeeklyDataPoint]]) -> list[WeeklyDataPoint]:
        """Combine per-session weekly curves into a single combined curve.

        For sparse curves (sessions with data only in some weeks), carries
        forward the last known cumulative values for gap weeks. This prevents
        combined totals from dropping when a session has no new activity.
        """
        # Collect all week keys across all sessions
        all_weeks: set[str] = set()
        session_point_map: dict[int, dict[str, WeeklyDataPoint]] = {}
        for sid, data in per_session_data.items():
            point_map: dict[str, WeeklyDataPoint] = {}
            for point in data:
                all_weeks.add(point.week_start)
                point_map[point.week_start] = point
            session_point_map[sid] = point_map

        sorted_weeks = sorted(all_weeks)
        if not sorted_weeks:
            return []

        # Aggregate with carry-forward per session
        week_totals: dict[str, dict[str, int]] = {}
        week_labels: dict[str, str] = {}
        week_ends: dict[str, str] = {}
        data_sources: dict[str, str] = {}
        week_numbers: dict[str, int] = {}
        week_partial: dict[str, bool] = {}
        week_days: dict[str, int] = {}

        for week_key in sorted_weeks:
            totals = {"enrolled": 0, "gross_enrolled": 0, "weekly_new": 0, "weekly_cancelled": 0}

            for sid, point_map in session_point_map.items():
                if week_key in point_map:
                    # Session has data for this week — use actual values
                    point = point_map[week_key]
                    totals["enrolled"] += point.enrolled
                    totals["gross_enrolled"] += point.gross_enrolled
                    totals["weekly_new"] += point.weekly_new
                    totals["weekly_cancelled"] += point.weekly_cancelled
                    week_labels[week_key] = point.week_label
                    week_ends[week_key] = point.week_end
                    data_sources[week_key] = point.data_source
                    week_numbers[week_key] = point.week_number
                    if point.is_partial:
                        week_partial[week_key] = True
                        week_days[week_key] = point.days_in_week
                else:
                    # Session has no data — carry forward cumulative values if session has started
                    last_point = self._find_last_point_before(point_map, week_key, sorted_weeks)
                    if last_point is not None:
                        totals["enrolled"] += last_point.enrolled
                        totals["gross_enrolled"] += last_point.gross_enrolled
                        # weekly_new and weekly_cancelled are 0 for carried-forward weeks

            week_totals[week_key] = totals

        # Build combined points with deltas
        points: list[WeeklyDataPoint] = []
        prev_enrolled = 0

        for week_key in sorted_weeks:
            totals = week_totals[week_key]
            enrolled = totals["enrolled"]
            delta = enrolled - prev_enrolled

            # Compute week_end from week_start if not available from a child point
            we = week_ends.get(week_key)
            if not we:
                ws_dt = datetime.strptime(week_key, "%Y-%m-%d")
                we = (ws_dt + timedelta(days=6)).strftime("%Y-%m-%d")

            points.append(
                WeeklyDataPoint(
                    week_start=week_key,
                    week_end=we,
                    week_label=week_labels.get(week_key, week_key),
                    week_number=week_numbers.get(week_key, 1),
                    enrolled=enrolled,
                    delta=delta,
                    data_source=data_sources.get(week_key, "snapshot"),
                    gross_enrolled=totals["gross_enrolled"],
                    weekly_new=totals["weekly_new"],
                    weekly_cancelled=totals["weekly_cancelled"],
                    is_partial=week_partial.get(week_key, False),
                    days_in_week=week_days.get(week_key, 7),
                )
            )
            prev_enrolled = enrolled

        return points

    @staticmethod
    def _find_last_point_before(
        point_map: dict[str, WeeklyDataPoint], week_key: str, sorted_weeks: list[str]
    ) -> WeeklyDataPoint | None:
        """Find the most recent data point for a session before the given week."""
        for prev_week in reversed(sorted_weeks):
            if prev_week >= week_key:
                continue
            if prev_week in point_map:
                return point_map[prev_week]
        return None

    async def _curves_from_reconstruction(
        self,
        ctx: SeasonContext,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
    ) -> _CurveResult:
        """Build curves by reconstructing from attendee records.

        Uses effective_date (original registration) for enrollment events and
        enrollment_date (PostDate = status change date) for cancellation events.
        Only enrolled (2), cancelled (32), and withdrawn (256) statuses contribute.
        """
        attendees = await self.repo.fetch_attendees_with_dates(ctx.year, session_cm_id=session_cm_id)

        if not attendees:
            empty_combined = VelocityCurve(year=ctx.year, session_cm_id=None, gender=None, weekly=[])
            return _CurveResult(combined=empty_combined, by_session=[], cancelled_to_date=0)

        # Group enrollments and cancellations by session (date -> count), merging AG
        session_daily_enrollments: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        session_daily_cancellations: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        total_cancellation_count = 0

        for att in attendees:
            session = get_session_from_expand(att)
            if not session:
                continue

            status_id = getattr(att, "status_id", 0) or 0
            if status_id not in ENROLLMENT_STATUSES:
                continue

            raw_sid = int(session.cm_id)
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)

            # Enrollment event: use effective_date (original registration date)
            enroll_date_str = _get_enrollment_date(att)
            if enroll_date_str:
                dt = datetime.strptime(enroll_date_str, "%Y-%m-%d")
                if ctx.season_start.date() <= dt.date() <= ctx.season_end.date():
                    date_key = dt.strftime("%Y-%m-%d")
                    session_daily_enrollments[effective_sid][date_key] += 1

            # Cancellation event: for cancelled/withdrawn, use enrollment_date (PostDate = cancel date)
            if status_id in CANCELLATION_STATUSES:
                cancel_date_raw = getattr(att, "enrollment_date", "") or ""
                if cancel_date_raw:
                    cancel_date_str = parse_date_only(cancel_date_raw)
                    cancel_dt = datetime.strptime(cancel_date_str, "%Y-%m-%d")
                    if ctx.season_start.date() <= cancel_dt.date() <= ctx.season_end.date():
                        session_daily_cancellations[effective_sid][cancel_date_str] += 1
                        total_cancellation_count += 1

        # Filter by session if specified
        if session_cm_id is not None:
            session_daily_enrollments = {
                sid: dates for sid, dates in session_daily_enrollments.items() if sid == session_cm_id
            }
            session_daily_cancellations = {
                sid: dates for sid, dates in session_daily_cancellations.items() if sid == session_cm_id
            }
            total_cancellation_count = sum(
                count for dates in session_daily_cancellations.values() for count in dates.values()
            )

        # Filter out sessions not in the sessions dict (excludes non-summer types)
        session_daily_enrollments = {sid: w for sid, w in session_daily_enrollments.items() if sid in sessions}

        # Build per-session cumulative curves (bucket by Monday)
        per_session_data: dict[int, list[WeeklyDataPoint]] = {}

        for sid, daily_enrollments in session_daily_enrollments.items():
            # Collect all dates from both enrollments and cancellations
            all_dates = set(daily_enrollments.keys())
            if sid in session_daily_cancellations:
                all_dates |= set(session_daily_cancellations[sid].keys())

            # Bucket enrollments and cancellations separately by 7-day periods
            weekly_enrollments: dict[str, int] = defaultdict(int)
            weekly_cancellations: dict[str, int] = defaultdict(int)
            for date_key in all_dates:
                new_enrolled = daily_enrollments.get(date_key, 0)
                cancelled = session_daily_cancellations.get(sid, {}).get(date_key, 0)
                dt = datetime.strptime(date_key, "%Y-%m-%d")
                bucket = _week_start(dt, ctx.season_start)
                bucket_key = bucket.strftime("%Y-%m-%d")
                weekly_enrollments[bucket_key] += new_enrolled
                weekly_cancellations[bucket_key] += cancelled

            # Build cumulative weekly points
            gross_cumulative = 0
            cancel_cumulative = 0
            points: list[WeeklyDataPoint] = []

            all_bucket_keys = sorted(set(weekly_enrollments.keys()) | set(weekly_cancellations.keys()))
            for bucket_key in all_bucket_keys:
                week_new = weekly_enrollments.get(bucket_key, 0)
                week_cancel = weekly_cancellations.get(bucket_key, 0)
                gross_cumulative += week_new
                cancel_cumulative += week_cancel
                net = gross_cumulative - cancel_cumulative
                prev_enrolled_val = points[-1].enrolled if points else 0
                delta = net - prev_enrolled_val

                bucket_dt = datetime.strptime(bucket_key, "%Y-%m-%d")
                wn = _week_number(bucket_dt, ctx.season_start)
                week_end_date = bucket_dt + timedelta(days=6)
                is_partial, days_in_week = _partial_week_info(bucket_key, ctx.year, today=ctx.today)
                points.append(
                    WeeklyDataPoint(
                        week_start=bucket_key,
                        week_end=week_end_date.strftime("%Y-%m-%d"),
                        week_label=_week_label(bucket_dt, ctx.season_start),
                        week_number=wn,
                        enrolled=net,
                        delta=delta,
                        data_source="reconstructed",
                        gross_enrolled=gross_cumulative,
                        weekly_new=week_new,
                        weekly_cancelled=week_cancel,
                        is_partial=is_partial,
                        days_in_week=days_in_week,
                    )
                )

            per_session_data[sid] = points

        # Build combined weekly from per-session data
        combined_data = self._combine_weekly_curves(per_session_data)

        # Build daily data via reconstruct_daily_multi
        season_start_date = ctx.season_start.date() if isinstance(ctx.season_start, datetime) else ctx.season_start
        season_end_date = ctx.season_end.date() if isinstance(ctx.season_end, datetime) else ctx.season_end
        is_current_season = season_start_date <= ctx.today <= season_end_date
        end_date = ctx.today if is_current_season else season_end_date
        daily_data, per_session_daily = reconstruct_daily_multi(
            attendees=attendees,
            season_start=season_start_date,
            sessions=sessions,
            end_date=end_date,
            ag_parent_map=ag_parent_map,
            session_cm_id=session_cm_id,
            session_ids=list(per_session_data.keys()),
        )

        # Derive weekly from daily for combined curve
        combined_weekly = rollup_daily_to_weekly(daily_data, season_start_date, is_current_year=is_current_season)

        combined = VelocityCurve(
            year=ctx.year,
            session_cm_id=session_cm_id,
            gender=None,
            weekly=combined_weekly if combined_weekly else combined_data,
            daily=daily_data,
        )

        by_session = self._build_session_curves(ctx.year, sessions, per_session_data)

        return _CurveResult(
            combined=combined,
            by_session=by_session,
            cancelled_to_date=total_cancellation_count,
            by_session_daily=per_session_daily,
        )

    async def _gender_data_from_reconstruction(
        self,
        ctx: SeasonContext,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
    ) -> tuple[dict[str, dict[int, list[WeeklyDataPoint]]], dict[int, dict[str, int]]]:
        """Extract per-gender per-session weekly data by reconstructing from attendees.

        Returns (gender_per_session, session_gender_totals) — same shape as
        _gender_data_from_snapshots for hybrid merging.
        """
        attendees = await self.repo.fetch_attendees_with_dates(
            ctx.year, session_cm_id=session_cm_id, expand_person=True
        )

        gender_per_session: dict[str, dict[int, list[WeeklyDataPoint]]] = {"M": {}, "F": {}}
        session_gender_totals: dict[int, dict[str, int]] = defaultdict(lambda: {"M": 0, "F": 0})

        if not attendees:
            return gender_per_session, dict(session_gender_totals)

        # Group enrollments by gender -> session -> date
        gender_session_daily: dict[str, dict[int, dict[str, int]]] = defaultdict(
            lambda: defaultdict(lambda: defaultdict(int))
        )

        for att in attendees:
            session = get_session_from_expand(att)
            if not session:
                continue

            status_id = getattr(att, "status_id", 0) or 0
            if status_id not in ENROLLMENT_STATUSES:
                continue

            raw_sid = int(session.cm_id)
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)

            person = get_person_from_expand(att)
            gender = extract_gender(person) if person else "Unknown"
            if gender not in ("M", "F"):
                continue

            enroll_date_str = _get_enrollment_date(att)
            if not enroll_date_str:
                continue
            dt = datetime.strptime(enroll_date_str, "%Y-%m-%d")
            if not (ctx.season_start.date() <= dt.date() <= ctx.season_end.date()):
                continue
            date_key = dt.strftime("%Y-%m-%d")
            gender_session_daily[gender][effective_sid][date_key] += 1
            # Only count currently enrolled for totals (match snapshot behavior)
            if status_id == 2:
                session_gender_totals[effective_sid][gender] += 1

        # Filter out sessions not in the sessions dict
        for gender in ("M", "F"):
            gender_session_daily[gender] = {
                sid: w for sid, w in gender_session_daily.get(gender, {}).items() if sid in sessions
            }
        session_gender_totals = {sid: t for sid, t in session_gender_totals.items() if sid in sessions}

        # Build per-session weekly data per gender
        for gender in ("M", "F"):
            session_daily = gender_session_daily.get(gender, {})
            if session_cm_id is not None:
                session_daily = {sid: dates for sid, dates in session_daily.items() if sid == session_cm_id}

            gender_per_session[gender] = {
                sid: _daily_counts_to_weekly_points(
                    daily, ctx.season_start, track_gross=True, year=ctx.year, today=ctx.today
                )
                for sid, daily in session_daily.items()
            }

        return gender_per_session, dict(session_gender_totals)

    @staticmethod
    def _daily_for_gender(combined_daily: list[DailyDataPoint], gender: str) -> list[DailyDataPoint]:
        """Derive gender-specific daily data from the combined daily curve."""
        if not combined_daily:
            return []
        # Check if combined daily has gender data
        first_with_gender = next((d for d in combined_daily if d.enrolled_boys is not None), None)
        if first_with_gender is None:
            return []

        result: list[DailyDataPoint] = []
        for d in combined_daily:
            if gender == "M":
                result.append(
                    DailyDataPoint(
                        date=d.date,
                        day_offset=d.day_offset,
                        gross_enrolled=d.gross_enrolled_boys or 0,
                        enrolled=d.enrolled_boys or 0,
                        cancelled=(d.gross_enrolled_boys or 0) - (d.enrolled_boys or 0),
                        daily_new=d.daily_new_boys or 0,
                        daily_cancelled=d.daily_cancelled_boys or 0,
                        data_source=d.data_source,
                    )
                )
            else:
                result.append(
                    DailyDataPoint(
                        date=d.date,
                        day_offset=d.day_offset,
                        gross_enrolled=d.gross_enrolled_girls or 0,
                        enrolled=d.enrolled_girls or 0,
                        cancelled=(d.gross_enrolled_girls or 0) - (d.enrolled_girls or 0),
                        daily_new=d.daily_new_girls or 0,
                        daily_cancelled=d.daily_cancelled_girls or 0,
                        data_source=d.data_source,
                    )
                )
        return result

    def _assemble_gender_curves(
        self,
        year: int,
        session_cm_id: int | None,
        sessions: dict[int, Any],
        gender_per_session: dict[str, dict[int, list[WeeklyDataPoint]]],
        session_gender_totals: dict[int, dict[str, int]],
        combined_daily: list[DailyDataPoint] | None = None,
    ) -> tuple[list[VelocityCurve], list[SessionGenderBreakdown]]:
        """Assemble final gender curves and breakdown from intermediate per-session data."""
        curves: list[VelocityCurve] = []
        for gender in ("M", "F"):
            combined = self._combine_weekly_curves(gender_per_session.get(gender, {}))
            daily = self._daily_for_gender(combined_daily or [], gender)
            curves.append(
                VelocityCurve(
                    year=year,
                    session_cm_id=session_cm_id,
                    gender=gender,
                    weekly=combined,
                    daily=daily,
                )
            )
        breakdown = self._build_gender_breakdown(sessions, session_gender_totals)
        return curves, breakdown

    async def _build_gender_curves(
        self,
        ctx: SeasonContext,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        combined_daily: list[DailyDataPoint] | None = None,
        snapshots: list[Any] | None = None,
    ) -> tuple[list[VelocityCurve], list[SessionGenderBreakdown]]:
        """Build gender-split velocity curves with hybrid snapshot/reconstruction support.

        Three-way dispatch matching _build_curves:
        1. No gender data in snapshots → pure reconstruction
        2. Snapshots cover full season → pure snapshot fast path
        3. Snapshots start mid-season → hybrid (reconstruction pre-snapshot + snapshots post)
        """
        if snapshots is None:
            snapshots = await self.repo.fetch_enrollment_snapshots(ctx.year, session_cm_id=session_cm_id)

        if not snapshots or not self._snapshots_have_gender_data(snapshots):
            # No gender data → pure reconstruction
            gps, totals = await self._gender_data_from_reconstruction(ctx, sessions, ag_parent_map, session_cm_id)
            return self._assemble_gender_curves(
                ctx.year, session_cm_id, sessions, gps, totals, combined_daily=combined_daily
            )

        snap_gps, snap_totals = self._gender_data_from_snapshots(ctx, snapshots, sessions, ag_parent_map, session_cm_id)

        # Check if hybrid needed
        earliest = self._find_earliest_snapshot_datetime(snapshots, ctx.season_start)
        if earliest is None or _week_start(earliest, ctx.season_start) <= ctx.season_start:
            # Snapshots cover full season → pure snapshot fast path
            return self._assemble_gender_curves(
                ctx.year, session_cm_id, sessions, snap_gps, snap_totals, combined_daily=combined_daily
            )

        # Hybrid: reconstruction pre-snapshot + snapshots post
        recon_gps, _recon_totals = await self._gender_data_from_reconstruction(
            ctx, sessions, ag_parent_map, session_cm_id
        )

        merged_gps: dict[str, dict[int, list[WeeklyDataPoint]]] = {}
        for gender in ("M", "F"):
            merged_gps[gender] = self._merge_hybrid_curves(
                recon_gps.get(gender, {}), snap_gps.get(gender, {}), ctx.season_start
            )

        # Use snapshot totals for breakdown (latest actual counts)
        return self._assemble_gender_curves(
            ctx.year, session_cm_id, sessions, merged_gps, snap_totals, combined_daily=combined_daily
        )

    async def _build_cancellation_curves(
        self,
        ctx: SeasonContext,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        cancellations: list[Any] | None = None,
    ) -> _CurveResult:
        """Build cancellation velocity curves (cumulative cancelled count over time).

        Uses hybrid mode when snapshots don't cover the full season: reconstruction
        fills pre-snapshot weeks, snapshots cover the rest.
        """
        snapshots = await self.repo.fetch_enrollment_snapshots(ctx.year, session_cm_id=session_cm_id)

        if not snapshots:
            return await self._cancellation_curves_from_reconstruction(
                ctx, sessions, ag_parent_map, session_cm_id, cancellations=cancellations
            )

        snap_result = self._cancellation_curves_from_snapshots(ctx, snapshots, sessions, ag_parent_map, session_cm_id)

        # Determine if we need hybrid mode
        earliest = self._find_earliest_snapshot_datetime(snapshots, ctx.season_start)
        if earliest is None:
            return snap_result

        first_snapshot_week = _week_start(earliest, ctx.season_start)
        if first_snapshot_week <= ctx.season_start:
            return snap_result

        # Hybrid: need reconstruction for pre-snapshot weeks
        recon_result = await self._cancellation_curves_from_reconstruction(
            ctx, sessions, ag_parent_map, session_cm_id, cancellations=cancellations
        )

        snap_by_session = {c.session_cm_id: c.weekly for c in snap_result.by_session if c.session_cm_id}
        recon_by_session = {c.session_cm_id: c.weekly for c in recon_result.by_session if c.session_cm_id}

        merged_by_session = self._merge_hybrid_curves(recon_by_session, snap_by_session, ctx.season_start)

        # Merge daily data per-session for hybrid cancellation curves
        merged_per_session_daily = self._merge_hybrid_daily_per_session(
            recon_result.by_session_daily, snap_result.by_session_daily
        )
        merged_daily = self._aggregate_per_session_daily(merged_per_session_daily)

        combined_data = self._combine_weekly_curves(merged_by_session)
        combined = VelocityCurve(
            year=ctx.year, session_cm_id=session_cm_id, gender=None, weekly=combined_data, daily=merged_daily
        )
        by_session = self._build_session_curves(ctx.year, sessions, merged_by_session)

        cancelled_to_date = combined_data[-1].enrolled if combined_data else 0

        return _CurveResult(
            combined=combined,
            by_session=by_session,
            cancelled_to_date=cancelled_to_date,
        )

    def _cancellation_curves_from_snapshots(
        self,
        ctx: SeasonContext,
        snapshots: list[Any],
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
    ) -> _CurveResult:
        """Build cancellation curves from snapshot cancelled_count field."""
        # Group by session, merging AG — accumulate cancelled per date
        session_date_cancelled: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))

        # First: dedup per raw session per date (keep latest by timestamp)
        raw_cancelled: dict[tuple[int, str], int] = {}
        raw_cancelled_dt: dict[tuple[int, str], str] = {}
        for snap in snapshots:
            raw_sid = int(snap.session_cm_id)
            snap_dt = snap.snapshot_datetime
            date_str = snap_dt.split("T")[0].split(" ")[0]
            cancelled = int(getattr(snap, "cancelled_count", 0) or 0)
            key = (raw_sid, date_str)
            if key not in raw_cancelled_dt or snap_dt > raw_cancelled_dt[key]:
                raw_cancelled[key] = cancelled
                raw_cancelled_dt[key] = snap_dt

        # Second: merge AG children into parent sessions (sum, not max)
        for (raw_sid, date_str), cancelled in raw_cancelled.items():
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)
            current = session_date_cancelled[effective_sid].get(date_str, 0)
            session_date_cancelled[effective_sid][date_str] = current + cancelled

        if session_cm_id is not None:
            session_date_cancelled = {sid: d for sid, d in session_date_cancelled.items() if sid == session_cm_id}
        session_date_cancelled = {sid: d for sid, d in session_date_cancelled.items() if sid in sessions}

        # Aggregate to weekly per session (last snapshot per week wins)
        per_session_data: dict[int, list[WeeklyDataPoint]] = {}

        for sid, date_data in session_date_cancelled.items():
            weekly_data: dict[str, int] = {}
            for date_str, cancelled in sorted(date_data.items()):
                dt = datetime.strptime(date_str.split("T")[0].split(" ")[0], "%Y-%m-%d")
                if dt.date() < ctx.season_start.date() or dt.date() > ctx.season_end.date():
                    continue
                bucket = _week_start(dt, ctx.season_start)
                bucket_key = bucket.strftime("%Y-%m-%d")
                weekly_data[bucket_key] = cancelled  # Last wins

            points: list[WeeklyDataPoint] = []
            prev_val = 0
            for bucket_key in sorted(weekly_data.keys()):
                val = weekly_data[bucket_key]
                delta = val - prev_val
                bucket_dt = datetime.strptime(bucket_key, "%Y-%m-%d")
                wn = _week_number(bucket_dt, ctx.season_start)
                week_end_date = bucket_dt + timedelta(days=6)
                is_partial, days_in_week = _partial_week_info(bucket_key, ctx.year, today=ctx.today)
                points.append(
                    WeeklyDataPoint(
                        week_start=bucket_key,
                        week_end=week_end_date.strftime("%Y-%m-%d"),
                        week_label=_week_label(bucket_dt, ctx.season_start),
                        week_number=wn,
                        enrolled=val,
                        delta=delta,
                        data_source="snapshot",
                        gross_enrolled=0,
                        weekly_new=0,
                        weekly_cancelled=0,
                        is_partial=is_partial,
                        days_in_week=days_in_week,
                    )
                )
                prev_val = val
            per_session_data[sid] = points

        combined_data = self._combine_weekly_curves(per_session_data)

        # Build daily data from snapshot cancellation counts
        season_start_date = ctx.season_start.date() if isinstance(ctx.season_start, datetime) else ctx.season_start
        daily_data: list[DailyDataPoint] = []
        combined_dates: dict[str, int] = defaultdict(int)
        for sid, date_data in session_date_cancelled.items():
            if sid not in sessions:
                continue
            if session_cm_id is not None and sid != session_cm_id:
                continue
            for date_str, cancelled in date_data.items():
                dt = datetime.strptime(date_str, "%Y-%m-%d")
                if dt.date() < season_start_date or dt.date() > ctx.season_end.date():
                    continue
                combined_dates[date_str] += cancelled

        prev_cancelled = 0
        for date_str in sorted(combined_dates.keys()):
            cancelled = combined_dates[date_str]
            day_offset = (datetime.strptime(date_str, "%Y-%m-%d").date() - season_start_date).days
            daily_cancelled = cancelled - prev_cancelled
            daily_data.append(
                DailyDataPoint(
                    date=date_str,
                    day_offset=day_offset,
                    gross_enrolled=0,
                    enrolled=cancelled,
                    cancelled=cancelled,
                    daily_new=0,
                    daily_cancelled=max(daily_cancelled, 0),
                    data_source="snapshot",
                )
            )
            prev_cancelled = cancelled

        # Build per-session daily data for hybrid merging
        season_end_date = ctx.season_end.date() if isinstance(ctx.season_end, datetime) else ctx.season_end
        per_session_daily = self._build_cancellation_daily_per_session(
            date_counts=session_date_cancelled,
            sessions=sessions,
            session_cm_id=session_cm_id,
            season_start=season_start_date,
            season_end=season_end_date,
            data_source="snapshot",
            cumulative_input=True,
        )

        combined = VelocityCurve(
            year=ctx.year, session_cm_id=session_cm_id, gender=None, weekly=combined_data, daily=daily_data
        )

        # cancelled_to_date = final combined cancelled count
        cancelled_to_date = combined_data[-1].enrolled if combined_data else 0

        by_session = self._build_session_curves(ctx.year, sessions, per_session_data)

        return _CurveResult(
            combined=combined,
            by_session=by_session,
            cancelled_to_date=cancelled_to_date,
            by_session_daily=per_session_daily,
        )

    async def _cancellation_curves_from_reconstruction(
        self,
        ctx: SeasonContext,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        cancellations: list[Any] | None = None,
    ) -> _CurveResult:
        """Build cancellation curves from status_transitions (reconstruction fallback)."""
        if cancellations is None:
            cancellations = await self.repo.fetch_status_transitions(ctx.year, ["cancelled", "withdrawn", "dismissed"])

        if not cancellations:
            empty = VelocityCurve(year=ctx.year, session_cm_id=None, gender=None, weekly=[])
            return _CurveResult(combined=empty, by_session=[], cancelled_to_date=0)

        # Group cancellations by session and bucket by Monday
        session_weekly_cancels: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        session_daily_cancels: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        total_count = 0

        for cancel in cancellations:
            session = get_session_from_expand(cancel)
            if not session:
                continue
            raw_sid = int(session.cm_id)
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)
            if effective_sid not in sessions:
                continue
            if session_cm_id is not None and effective_sid != session_cm_id:
                continue

            dt = datetime.strptime(cancel.detected_at.split("T")[0].split(" ")[0], "%Y-%m-%d")
            if dt.date() < ctx.season_start.date() or dt.date() > ctx.season_end.date():
                continue
            bucket = _week_start(dt, ctx.season_start)
            bucket_key = bucket.strftime("%Y-%m-%d")
            session_weekly_cancels[effective_sid][bucket_key] += 1
            date_key = dt.strftime("%Y-%m-%d")
            session_daily_cancels[effective_sid][date_key] += 1
            total_count += 1

        # Build cumulative curves per session
        per_session_data: dict[int, list[WeeklyDataPoint]] = {}

        for sid, weekly_counts in session_weekly_cancels.items():
            cumulative = 0
            points: list[WeeklyDataPoint] = []
            for bucket_key in sorted(weekly_counts.keys()):
                cumulative += weekly_counts[bucket_key]
                prev_val = points[-1].enrolled if points else 0
                delta = cumulative - prev_val
                bucket_dt = datetime.strptime(bucket_key, "%Y-%m-%d")
                wn = _week_number(bucket_dt, ctx.season_start)
                week_end_date = bucket_dt + timedelta(days=6)
                is_partial, days_in_week = _partial_week_info(bucket_key, ctx.year, today=ctx.today)
                points.append(
                    WeeklyDataPoint(
                        week_start=bucket_key,
                        week_end=week_end_date.strftime("%Y-%m-%d"),
                        week_label=_week_label(bucket_dt, ctx.season_start),
                        week_number=wn,
                        enrolled=cumulative,
                        delta=delta,
                        data_source="reconstructed",
                        gross_enrolled=0,
                        weekly_new=0,
                        weekly_cancelled=0,
                        is_partial=is_partial,
                        days_in_week=days_in_week,
                    )
                )
            per_session_data[sid] = points

        combined_data = self._combine_weekly_curves(per_session_data)

        # Build daily data from reconstruction cancellation counts
        season_start_date = ctx.season_start.date() if isinstance(ctx.season_start, datetime) else ctx.season_start
        combined_daily_counts: dict[str, int] = defaultdict(int)
        for sid in session_daily_cancels:
            if sid not in sessions:
                continue
            if session_cm_id is not None and sid != session_cm_id:
                continue
            for date_str, count in session_daily_cancels[sid].items():
                combined_daily_counts[date_str] += count

        daily_data: list[DailyDataPoint] = []
        cumulative = 0
        for date_str in sorted(combined_daily_counts.keys()):
            count = combined_daily_counts[date_str]
            cumulative += count
            day_offset = (datetime.strptime(date_str, "%Y-%m-%d").date() - season_start_date).days
            daily_data.append(
                DailyDataPoint(
                    date=date_str,
                    day_offset=day_offset,
                    gross_enrolled=0,
                    enrolled=cumulative,
                    cancelled=cumulative,
                    daily_new=0,
                    daily_cancelled=count,
                    data_source="reconstructed",
                )
            )

        # Build per-session daily data for hybrid merging
        per_session_daily = self._build_cancellation_daily_per_session(
            date_counts=session_daily_cancels,
            sessions=sessions,
            session_cm_id=session_cm_id,
            season_start=season_start_date,
            season_end=None,
            data_source="reconstructed",
            cumulative_input=False,
        )

        combined = VelocityCurve(
            year=ctx.year, session_cm_id=session_cm_id, gender=None, weekly=combined_data, daily=daily_data
        )

        by_session = self._build_session_curves(ctx.year, sessions, per_session_data)

        return _CurveResult(
            combined=combined,
            by_session=by_session,
            cancelled_to_date=total_count,
            by_session_daily=per_session_daily,
        )

    async def _build_cancellation_gender_curves(
        self,
        ctx: SeasonContext,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        cancellations: list[Any] | None = None,
    ) -> tuple[list[VelocityCurve], list[SessionGenderBreakdown]]:
        """Build gender-split cancellation velocity curves from status transitions.

        Returns (gender_curves, session_gender_breakdown).
        """
        if cancellations is None:
            cancellations = await self.repo.fetch_status_transitions(
                ctx.year, ["cancelled", "withdrawn", "dismissed"], expand_person=True
            )

        if not cancellations:
            return [], []

        # Group cancellations by gender -> session -> date
        gender_session_daily: dict[str, dict[int, dict[str, int]]] = defaultdict(
            lambda: defaultdict(lambda: defaultdict(int))
        )
        session_gender_totals: dict[int, dict[str, int]] = defaultdict(lambda: {"M": 0, "F": 0})

        for cancel in cancellations:
            session = get_session_from_expand(cancel)
            if not session:
                continue

            raw_sid = int(session.cm_id)
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)
            if effective_sid not in sessions:
                continue
            if session_cm_id is not None and effective_sid != session_cm_id:
                continue

            person = get_person_from_expand(cancel)
            gender = extract_gender(person) if person else "Unknown"
            if gender not in ("M", "F"):
                continue

            dt = datetime.strptime(cancel.detected_at.split("T")[0].split(" ")[0], "%Y-%m-%d")
            if dt.date() < ctx.season_start.date() or dt.date() > ctx.season_end.date():
                continue
            date_key = dt.strftime("%Y-%m-%d")
            gender_session_daily[gender][effective_sid][date_key] += 1
            session_gender_totals[effective_sid][gender] += 1

        # Filter out sessions not in sessions dict
        for gender in ("M", "F"):
            gender_session_daily[gender] = {
                sid: w for sid, w in gender_session_daily.get(gender, {}).items() if sid in sessions
            }
        session_gender_totals = {sid: t for sid, t in session_gender_totals.items() if sid in sessions}

        # Build curves per gender
        gender_curves: list[VelocityCurve] = []

        for gender in ("M", "F"):
            session_daily = gender_session_daily.get(gender, {})

            per_session_data: dict[int, list[WeeklyDataPoint]] = {
                sid: _daily_counts_to_weekly_points(daily, ctx.season_start, year=ctx.year, today=ctx.today)
                for sid, daily in session_daily.items()
            }

            combined_data = self._combine_weekly_curves(per_session_data)

            gender_curves.append(
                VelocityCurve(
                    year=ctx.year,
                    session_cm_id=session_cm_id,
                    gender=gender,
                    weekly=combined_data,
                )
            )

        breakdown = self._build_gender_breakdown(sessions, session_gender_totals)

        return gender_curves, breakdown

    def _build_prior_cancelled_summary(
        self,
        prior_year: int,
        prior_result: _CurveResult,
        current_max_wn: int | None,
        metric: str = "enrollment",
    ) -> PriorYearCancelledSummary:
        """Build cancelled summary for a prior year."""
        cancelled_final = prior_result.cancelled_to_date

        cancelled_at_current_week: int | None = None
        if metric == "cancellation" and current_max_wn is not None and prior_result.combined.weekly:
            cancelled_at_current_week = _value_at_week(prior_result.combined.weekly, current_max_wn)

        return PriorYearCancelledSummary(
            year=prior_year,
            cancelled_at_current_week=cancelled_at_current_week,
            cancelled_final=cancelled_final,
        )

    def _build_prior_session_summaries(
        self,
        prior_year: int,
        prior_by_session: list[VelocityCurve],
        current_max_wn: int | None,
    ) -> list[PriorYearSessionSummary]:
        """Build per-session summaries for a prior year."""
        summaries: list[PriorYearSessionSummary] = []

        for curve in prior_by_session:
            if not curve.weekly:
                continue

            final_enrolled = curve.weekly[-1].enrolled

            enrolled_at_current_week: int | None = None
            if current_max_wn is not None:
                enrolled_at_current_week = _value_at_week(curve.weekly, current_max_wn)

            summaries.append(
                PriorYearSessionSummary(
                    year=prior_year,
                    session_name=curve.session_name,
                    session_cm_id=curve.session_cm_id,
                    enrolled_at_current_week=enrolled_at_current_week,
                    final_enrolled=final_enrolled,
                )
            )

        return summaries

    def _build_phase_markers(self, reg_dates: dict[str, str], season_start: datetime) -> list[PhaseMarker]:
        """Build registration phase markers from config.

        week_number is computed directly from season start (no Monday snapping).
        """
        markers: list[PhaseMarker] = []
        for config_key, (phase, label) in PHASE_KEY_MAP.items():
            date_str = reg_dates.get(config_key)
            if date_str:
                dt = datetime.strptime(date_str.split("T")[0].split(" ")[0], "%Y-%m-%d")
                wn = _week_number(dt, season_start)
                markers.append(PhaseMarker(phase=phase, date=dt.strftime("%Y-%m-%d"), label=label, week_number=wn))

        return markers
