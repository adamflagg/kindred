"""Velocity service - business logic for registration velocity curves.

Computes week-over-week enrollment velocity using either enrollment snapshots
(fast path) or reconstruction from attendee enrollment dates (fallback).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING, Any

from api.schemas.velocity import (
    PhaseMarker,
    PriorYearCancelledSummary,
    PriorYearSessionSummary,
    SessionGenderBreakdown,
    VelocityCurve,
    VelocityResponse,
    WeeklyDataPoint,
)
from api.services.extractors import extract_gender
from api.utils.session_metrics import build_ag_parent_map

if TYPE_CHECKING:
    from .metrics_repository import MetricsRepository


# Map config keys to phase names and labels
PHASE_KEY_MAP: dict[str, tuple[str, str]] = {
    "priority_reg_date": ("priority", "Priority Registration"),
    "early_reg_date": ("early", "Early Registration"),
    "open_reg_date": ("open", "Open Registration"),
}


def _week_start(d: datetime, priority_reg_date: datetime) -> datetime:
    """Start of 7-day bucket containing d, anchored to priority_reg_date."""
    days_since = (d - priority_reg_date).days
    return priority_reg_date + timedelta(days=(days_since // 7) * 7)


def _week_label(d: datetime) -> str:
    """Format a date as a short week label like 'Jan 6'."""
    return d.strftime("%b %-d")


def _compute_season_start(priority_reg_date_str: str | None, year: int) -> datetime | None:
    """Compute the season start date from priority registration config.

    Returns the exact priority_reg_date if configured, else None.
    Years without a configured priority_reg_date simply don't get velocity data.
    """
    if priority_reg_date_str:
        return datetime.strptime(priority_reg_date_str.split("T")[0].split(" ")[0], "%Y-%m-%d")
    return None


# Maximum number of weeks from season start that contains meaningful
# registration data.  Camp historically ends between week 39.6 and 41.3
# relative to season start Monday (derived from 2017-2026 data).
SEASON_WEEKS = 41


def _season_end(priority_reg_date: datetime) -> datetime:
    """Return the season end: priority_reg_date + SEASON_WEEKS * 7 days."""
    return priority_reg_date + timedelta(days=SEASON_WEEKS * 7)


def _week_number(d: datetime, priority_reg_date: datetime) -> int:
    """Compute 0-based week offset from priority_reg_date."""
    return (d - priority_reg_date).days // 7


def _partial_week_info(week_start_str: str, year: int, *, today: date | None = None) -> tuple[bool, int]:
    """Check if a week bucket is partial (incomplete). Returns (is_partial, days_in_week).

    Only the current year can have partial weeks. A week is partial when
    today falls within the 7-day bucket starting at week_start_str.
    """
    ref = today or date.today()
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
        is_partial, days_in_week = _partial_week_info(bucket_key, year, today=today)
        points.append(
            WeeklyDataPoint(
                week_start=bucket_key,
                week_label=_week_label(bucket_dt),
                week_number=wn,
                enrolled=cumulative,
                waitlisted=0,
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

    __slots__ = ("combined", "by_session", "cancelled_to_date")

    def __init__(
        self,
        combined: VelocityCurve,
        by_session: list[VelocityCurve],
        cancelled_to_date: int = 0,
    ) -> None:
        self.combined = combined
        self.by_session = by_session
        self.cancelled_to_date = cancelled_to_date


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
        snapshots: list[Any],
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_end: datetime,
        year: int = 0,
        today: date | None = None,
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

        # Track latest snapshot per session for breakdown
        session_latest: dict[int, tuple[str, int, int]] = {}  # sid -> (date, male, female)

        for snap in snapshots:
            raw_sid = int(snap.session_cm_id)
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)
            date_str = snap.snapshot_date

            male_count = int(getattr(snap, "enrolled_male_count", 0) or 0)
            female_count = int(getattr(snap, "enrolled_female_count", 0) or 0)

            # Accumulate into per-gender per-session per-date
            gender_session_date["M"][effective_sid][date_str] = (
                gender_session_date["M"][effective_sid].get(date_str, 0) + male_count
            )
            gender_session_date["F"][effective_sid][date_str] = (
                gender_session_date["F"][effective_sid].get(date_str, 0) + female_count
            )

            # Track latest snapshot per session for breakdown (accumulate AG)
            prev = session_latest.get(effective_sid)
            if prev is None or date_str >= prev[0]:
                if prev is not None and date_str == prev[0]:
                    # Same date, accumulate (AG merging)
                    session_latest[effective_sid] = (date_str, prev[1] + male_count, prev[2] + female_count)
                else:
                    session_latest[effective_sid] = (date_str, male_count, female_count)

        # Filter by session_cm_id if specified
        if session_cm_id is not None:
            for gender in ("M", "F"):
                gender_session_date[gender] = {
                    sid: dates for sid, dates in gender_session_date[gender].items() if sid == session_cm_id
                }
            session_latest = {sid: v for sid, v in session_latest.items() if sid == session_cm_id}

        # Filter out sessions not in the sessions dict
        for gender in ("M", "F"):
            gender_session_date[gender] = {
                sid: dates for sid, dates in gender_session_date[gender].items() if sid in sessions
            }
        session_latest = {sid: v for sid, v in session_latest.items() if sid in sessions}

        # Build per-session weekly data per gender
        gender_per_session: dict[str, dict[int, list[WeeklyDataPoint]]] = {}
        for gender in ("M", "F"):
            per_session_data: dict[int, list[WeeklyDataPoint]] = {}
            for sid, date_counts in gender_session_date[gender].items():
                date_data: dict[str, dict[str, int]] = {
                    d: {"enrolled": c, "waitlisted": 0} for d, c in date_counts.items()
                }
                weekly = self._aggregate_snapshots_to_weekly(
                    date_data, {}, season_start, season_end, year=year, today=today
                )
                per_session_data[sid] = weekly
            gender_per_session[gender] = per_session_data

        session_gender_totals: dict[int, dict[str, int]] = {
            sid: {"M": vals[1], "F": vals[2]} for sid, vals in session_latest.items()
        }

        return gender_per_session, session_gender_totals

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
    ) -> VelocityResponse:
        """Get registration velocity curves with week-over-week data.

        Args:
            metric: 'enrollment' (default) or 'cancellation' to switch curve type.
        """
        # Pre-fetch reg dates for dynamic season start
        reg_dates = await self.repo.fetch_registration_dates(year)
        season_start_dt = _compute_season_start(reg_dates.get("priority_reg_date"), year)
        warnings: list[str] = []

        # If no priority_reg_date configured, return empty response with warning
        if season_start_dt is None:
            empty_combined = VelocityCurve(year=year, session_cm_id=None, gender=None, weekly=[])
            warnings.append(f"Year {year} has no priority registration date configured")
            return VelocityResponse(
                year=year,
                season_start="",
                combined=empty_combined,
                by_session=[],
                prior_years=[],
                phase_markers=[],
                warnings=warnings,
                cancelled_to_date=None,
            )

        season_end_dt = _season_end(season_start_dt)
        # Fetch sessions for the year
        sessions = await self.repo.fetch_sessions(year, session_types=session_types)
        ag_parent_map = build_ag_parent_map(sessions)

        # Build curves for the primary year (dispatch by metric type)
        if metric == "cancellation":
            result = await self._build_cancellation_curves(
                year, sessions, ag_parent_map, session_cm_id, season_start_dt, season_end_dt, today=today
            )
        else:
            result = await self._build_curves(
                year, sessions, ag_parent_map, session_cm_id, season_start_dt, season_end_dt, today=today
            )

        combined = result.combined
        by_session = result.by_session
        cancelled_to_date = result.cancelled_to_date

        # Build gender-split curves if requested
        by_gender: list[VelocityCurve] = []
        session_gender_breakdown: list[SessionGenderBreakdown] = []
        if split_by_gender:
            if metric == "cancellation":
                by_gender, session_gender_breakdown = await self._build_cancellation_gender_curves(
                    year, sessions, ag_parent_map, session_cm_id, season_start_dt, season_end_dt, today=today
                )
            else:
                by_gender, session_gender_breakdown = await self._build_gender_curves(
                    year, sessions, ag_parent_map, session_cm_id, season_start_dt, season_end_dt, today=today
                )

        # Build prior year curves
        prior_years: list[VelocityCurve] = []
        prior_year_by_gender: list[VelocityCurve] = []
        prior_year_cancelled_to_date: list[PriorYearCancelledSummary] = []
        prior_year_session_summaries: list[PriorYearSessionSummary] = []

        # Get current year's latest week_number for prior year comparisons
        current_max_wn = combined.weekly[-1].week_number if combined.weekly else None

        if compare_years:
            for prior_year in compare_years:
                prior_reg_dates = await self.repo.fetch_registration_dates(prior_year)
                prior_season_start = _compute_season_start(prior_reg_dates.get("priority_reg_date"), prior_year)
                if prior_season_start is None:
                    warnings.append(f"Year {prior_year} has no priority registration date configured")
                    continue
                prior_season_end = _season_end(prior_season_start)
                prior_sessions = await self.repo.fetch_sessions(prior_year, session_types=session_types)
                prior_ag_map = build_ag_parent_map(prior_sessions)

                if metric == "cancellation":
                    prior_result = await self._build_cancellation_curves(
                        prior_year,
                        prior_sessions,
                        prior_ag_map,
                        session_cm_id=None,
                        season_start=prior_season_start,
                        season_end=prior_season_end,
                        today=today,
                    )
                else:
                    prior_result = await self._build_curves(
                        prior_year,
                        prior_sessions,
                        prior_ag_map,
                        session_cm_id=None,
                        season_start=prior_season_start,
                        season_end=prior_season_end,
                        today=today,
                    )
                prior_years.append(prior_result.combined)

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
                            prior_year,
                            prior_sessions,
                            prior_ag_map,
                            session_cm_id=None,
                            season_start=prior_season_start,
                            season_end=prior_season_end,
                            today=today,
                        )
                    else:
                        prior_gender_curves, _ = await self._build_gender_curves(
                            prior_year,
                            prior_sessions,
                            prior_ag_map,
                            session_cm_id=None,
                            season_start=prior_season_start,
                            season_end=prior_season_end,
                            today=today,
                        )
                    prior_year_by_gender.extend(prior_gender_curves)

        # Fetch phase markers (pass reg_dates to avoid double fetch)
        phase_markers = self._build_phase_markers(reg_dates, season_start_dt)

        return VelocityResponse(
            year=year,
            season_start=season_start_dt.strftime("%Y-%m-%d"),
            combined=combined,
            by_session=by_session,
            by_gender=by_gender,
            prior_years=prior_years,
            prior_year_by_gender=prior_year_by_gender,
            phase_markers=phase_markers,
            session_gender_breakdown=session_gender_breakdown,
            cancelled_to_date=cancelled_to_date,
            prior_year_cancelled_to_date=prior_year_cancelled_to_date,
            prior_year_session_summaries=prior_year_session_summaries,
            warnings=warnings,
        )

    @staticmethod
    def _find_earliest_snapshot_date(snapshots: list[Any], season_start: datetime) -> datetime | None:
        """Find the earliest snapshot_date >= season_start across all snapshots."""
        earliest: datetime | None = None
        for snap in snapshots:
            dt = datetime.strptime(snap.snapshot_date.split("T")[0].split(" ")[0], "%Y-%m-%d")
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
                        week_label=p.week_label,
                        week_number=p.week_number,
                        enrolled=p.enrolled,
                        waitlisted=p.waitlisted,
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
                        week_label=p.week_label,
                        week_number=p.week_number,
                        enrolled=p.enrolled,
                        waitlisted=p.waitlisted,
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

    async def _build_curves(
        self,
        year: int,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_end: datetime,
        today: date | None = None,
    ) -> _CurveResult:
        """Build combined and per-session velocity curves for a year.

        Uses hybrid mode when snapshots don't cover the full season: reconstruction
        fills pre-snapshot weeks, snapshots cover the rest.
        """
        snapshots = await self.repo.fetch_enrollment_snapshots(year, session_cm_id=session_cm_id)

        if not snapshots:
            return await self._curves_from_reconstruction(
                year, sessions, ag_parent_map, session_cm_id, season_start, season_end, today=today
            )

        snap_result = self._curves_from_snapshots(
            year, snapshots, sessions, ag_parent_map, session_cm_id, season_start, season_end, today=today
        )

        # Determine if we need hybrid mode
        earliest = self._find_earliest_snapshot_date(snapshots, season_start)
        if earliest is None:
            return snap_result

        first_snapshot_week = _week_start(earliest, season_start)
        if first_snapshot_week <= season_start:
            # Snapshots cover from the start — pure snapshot path
            return snap_result

        # Hybrid: need reconstruction for pre-snapshot weeks
        recon_result = await self._curves_from_reconstruction(
            year, sessions, ag_parent_map, session_cm_id, season_start, season_end, today=today
        )

        # Build per-session data maps from the curve results
        snap_by_session = {c.session_cm_id: c.weekly for c in snap_result.by_session if c.session_cm_id}
        recon_by_session = {c.session_cm_id: c.weekly for c in recon_result.by_session if c.session_cm_id}

        merged_by_session = self._merge_hybrid_curves(recon_by_session, snap_by_session, season_start)
        combined_data = self._combine_weekly_curves(merged_by_session)
        combined = VelocityCurve(
            year=year, session_cm_id=session_cm_id, session_name=None, gender=None, weekly=combined_data
        )
        by_session = self._build_session_curves(year, sessions, merged_by_session)

        return _CurveResult(
            combined=combined,
            by_session=by_session,
            cancelled_to_date=snap_result.cancelled_to_date,
        )

    def _curves_from_snapshots(
        self,
        year: int,
        snapshots: list[Any],
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_end: datetime,
        today: date | None = None,
    ) -> _CurveResult:
        """Build curves from enrollment snapshots (fast path)."""
        # Group snapshots by session, merging AG into parent
        session_date_data: dict[int, dict[str, dict[str, int]]] = defaultdict(
            lambda: defaultdict(lambda: {"enrolled": 0, "waitlisted": 0})
        )
        # Track cancelled counts per session (latest snapshot per session per date)
        session_date_cancelled: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))

        for snap in snapshots:
            raw_sid = int(snap.session_cm_id)
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)
            date_str = snap.snapshot_date

            session_date_data[effective_sid][date_str]["enrolled"] += int(snap.enrolled_count)
            session_date_data[effective_sid][date_str]["waitlisted"] += int(snap.waitlisted_count)
            cancelled = int(getattr(snap, "cancelled_count", 0) or 0)
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
            weekly = self._aggregate_snapshots_to_weekly(
                date_data, cancelled_data, season_start, season_end, year=year, today=today
            )
            per_session_data[sid] = weekly

        # Build combined curve by summing across sessions per week
        combined_data = self._combine_weekly_curves(per_session_data)

        combined = VelocityCurve(
            year=year,
            session_cm_id=session_cm_id,
            session_name=None,
            gender=None,
            weekly=combined_data,
        )

        by_session = self._build_session_curves(year, sessions, per_session_data)

        return _CurveResult(combined=combined, by_session=by_session, cancelled_to_date=cancelled_to_date)

    def _aggregate_snapshots_to_weekly(
        self,
        date_data: dict[str, dict[str, int]],
        cancelled_data: dict[str, int],
        season_start: datetime,
        season_end: datetime,
        year: int = 0,
        today: date | None = None,
    ) -> list[WeeklyDataPoint]:
        """Aggregate snapshot data to weekly points (priority_reg_date bucketing, last snapshot per week wins).

        Filters out data before season_start or after season_end.
        """
        # Bucket by 7-day periods anchored to season_start (= priority_reg_date)
        weekly_data: dict[str, dict[str, int]] = {}
        weekly_cancelled: dict[str, int] = {}

        for date_str, counts in sorted(date_data.items()):
            dt = datetime.strptime(date_str.split("T")[0].split(" ")[0], "%Y-%m-%d")
            if dt.date() < season_start.date():
                continue
            if dt.date() > season_end.date():
                continue
            bucket = _week_start(dt, season_start)
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
            waitlisted = counts["waitlisted"]
            delta = enrolled - prev_enrolled
            cancelled = weekly_cancelled.get(bucket_key, 0)
            gross = enrolled + cancelled

            bucket_dt = datetime.strptime(bucket_key, "%Y-%m-%d")
            wn = _week_number(bucket_dt, season_start)
            is_partial, days_in_week = _partial_week_info(bucket_key, year, today=today)
            points.append(
                WeeklyDataPoint(
                    week_start=bucket_key,
                    week_label=_week_label(bucket_dt),
                    week_number=wn,
                    enrolled=enrolled,
                    waitlisted=waitlisted,
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
        data_sources: dict[str, str] = {}
        week_numbers: dict[str, int] = {}
        week_partial: dict[str, bool] = {}
        week_days: dict[str, int] = {}

        for week_key in sorted_weeks:
            totals = {"enrolled": 0, "waitlisted": 0, "gross_enrolled": 0, "weekly_new": 0, "weekly_cancelled": 0}

            for sid, point_map in session_point_map.items():
                if week_key in point_map:
                    # Session has data for this week — use actual values
                    point = point_map[week_key]
                    totals["enrolled"] += point.enrolled
                    totals["waitlisted"] += point.waitlisted
                    totals["gross_enrolled"] += point.gross_enrolled
                    totals["weekly_new"] += point.weekly_new
                    totals["weekly_cancelled"] += point.weekly_cancelled
                    week_labels[week_key] = point.week_label
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
                        totals["waitlisted"] += last_point.waitlisted
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

            points.append(
                WeeklyDataPoint(
                    week_start=week_key,
                    week_label=week_labels.get(week_key, week_key),
                    week_number=week_numbers.get(week_key, 0),
                    enrolled=enrolled,
                    waitlisted=totals["waitlisted"],
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
        year: int,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_end: datetime,
        today: date | None = None,
    ) -> _CurveResult:
        """Build curves by reconstructing from enrollment dates (fallback)."""
        attendees = await self.repo.fetch_attendees_with_dates(year, session_cm_id=session_cm_id)
        cancellations = await self.repo.fetch_status_transitions(year, ["cancelled", "withdrawn"])

        if not attendees:
            empty_combined = VelocityCurve(year=year, session_cm_id=None, gender=None, weekly=[])
            return _CurveResult(combined=empty_combined, by_session=[], cancelled_to_date=0)

        # Group enrollments by session (date -> count), merging AG
        session_daily_enrollments: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))

        for att in attendees:
            expand = getattr(att, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else None
            if not session:
                continue

            raw_sid = int(session.cm_id)
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)

            dt = datetime.strptime(att.enrollment_date.split("T")[0].split(" ")[0], "%Y-%m-%d")
            if dt.date() < season_start.date():
                continue
            if dt.date() > season_end.date():
                continue
            date_key = dt.strftime("%Y-%m-%d")
            session_daily_enrollments[effective_sid][date_key] += 1

        # Group cancellations by session and date
        session_daily_cancellations: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        total_cancellation_count = 0

        for cancel in cancellations:
            expand = getattr(cancel, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else None
            if not session:
                continue
            raw_sid = int(session.cm_id)
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)

            dt = datetime.strptime(cancel.detected_at.split("T")[0].split(" ")[0], "%Y-%m-%d")
            if dt.date() < season_start.date():
                continue
            if dt.date() > season_end.date():
                continue
            date_key = dt.strftime("%Y-%m-%d")
            session_daily_cancellations[effective_sid][date_key] += 1
            total_cancellation_count += 1

        # Filter by session if specified
        if session_cm_id is not None:
            session_daily_enrollments = {
                sid: dates for sid, dates in session_daily_enrollments.items() if sid == session_cm_id
            }

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
                bucket = _week_start(dt, season_start)
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
                wn = _week_number(bucket_dt, season_start)
                is_partial, days_in_week = _partial_week_info(bucket_key, year, today=today)
                points.append(
                    WeeklyDataPoint(
                        week_start=bucket_key,
                        week_label=_week_label(bucket_dt),
                        week_number=wn,
                        enrolled=net,
                        waitlisted=0,
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

        # Build combined
        combined_data = self._combine_weekly_curves(per_session_data)

        combined = VelocityCurve(
            year=year,
            session_cm_id=session_cm_id,
            gender=None,
            weekly=combined_data,
        )

        by_session = self._build_session_curves(year, sessions, per_session_data)

        return _CurveResult(
            combined=combined,
            by_session=by_session,
            cancelled_to_date=total_cancellation_count,
        )

    async def _gender_data_from_reconstruction(
        self,
        year: int,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_end: datetime,
        today: date | None = None,
    ) -> tuple[dict[str, dict[int, list[WeeklyDataPoint]]], dict[int, dict[str, int]]]:
        """Extract per-gender per-session weekly data by reconstructing from attendees.

        Returns (gender_per_session, session_gender_totals) — same shape as
        _gender_data_from_snapshots for hybrid merging.
        """
        attendees = await self.repo.fetch_attendees_with_dates(year, session_cm_id=session_cm_id, expand_person=True)

        gender_per_session: dict[str, dict[int, list[WeeklyDataPoint]]] = {"M": {}, "F": {}}
        session_gender_totals: dict[int, dict[str, int]] = defaultdict(lambda: {"M": 0, "F": 0})

        if not attendees:
            return gender_per_session, dict(session_gender_totals)

        # Group enrollments by gender -> session -> date
        gender_session_daily: dict[str, dict[int, dict[str, int]]] = defaultdict(
            lambda: defaultdict(lambda: defaultdict(int))
        )

        for att in attendees:
            expand = getattr(att, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else None
            if not session:
                continue

            raw_sid = int(session.cm_id)
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)

            person = expand.get("person") if isinstance(expand, dict) else None
            gender = extract_gender(person) if person else "Unknown"
            if gender not in ("M", "F"):
                continue

            dt = datetime.strptime(att.enrollment_date.split("T")[0].split(" ")[0], "%Y-%m-%d")
            if dt.date() < season_start.date():
                continue
            if dt.date() > season_end.date():
                continue
            date_key = dt.strftime("%Y-%m-%d")
            gender_session_daily[gender][effective_sid][date_key] += 1
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
                sid: _daily_counts_to_weekly_points(daily, season_start, track_gross=True, year=year, today=today)
                for sid, daily in session_daily.items()
            }

        return gender_per_session, dict(session_gender_totals)

    def _assemble_gender_curves(
        self,
        year: int,
        session_cm_id: int | None,
        sessions: dict[int, Any],
        gender_per_session: dict[str, dict[int, list[WeeklyDataPoint]]],
        session_gender_totals: dict[int, dict[str, int]],
    ) -> tuple[list[VelocityCurve], list[SessionGenderBreakdown]]:
        """Assemble final gender curves and breakdown from intermediate per-session data."""
        curves: list[VelocityCurve] = []
        for gender in ("M", "F"):
            combined = self._combine_weekly_curves(gender_per_session.get(gender, {}))
            curves.append(VelocityCurve(year=year, session_cm_id=session_cm_id, gender=gender, weekly=combined))
        breakdown = self._build_gender_breakdown(sessions, session_gender_totals)
        return curves, breakdown

    async def _build_gender_curves(
        self,
        year: int,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_end: datetime,
        today: date | None = None,
    ) -> tuple[list[VelocityCurve], list[SessionGenderBreakdown]]:
        """Build gender-split velocity curves with hybrid snapshot/reconstruction support.

        Three-way dispatch matching _build_curves:
        1. No gender data in snapshots → pure reconstruction
        2. Snapshots cover full season → pure snapshot fast path
        3. Snapshots start mid-season → hybrid (reconstruction pre-snapshot + snapshots post)
        """
        snapshots = await self.repo.fetch_enrollment_snapshots(year, session_cm_id=session_cm_id)

        if not snapshots or not self._snapshots_have_gender_data(snapshots):
            # No gender data → pure reconstruction
            gps, totals = await self._gender_data_from_reconstruction(
                year, sessions, ag_parent_map, session_cm_id, season_start, season_end, today=today
            )
            return self._assemble_gender_curves(year, session_cm_id, sessions, gps, totals)

        snap_gps, snap_totals = self._gender_data_from_snapshots(
            snapshots, sessions, ag_parent_map, session_cm_id, season_start, season_end, year=year, today=today
        )

        # Check if hybrid needed
        earliest = self._find_earliest_snapshot_date(snapshots, season_start)
        if earliest is None or _week_start(earliest, season_start) <= season_start:
            # Snapshots cover full season → pure snapshot fast path
            return self._assemble_gender_curves(year, session_cm_id, sessions, snap_gps, snap_totals)

        # Hybrid: reconstruction pre-snapshot + snapshots post
        recon_gps, recon_totals = await self._gender_data_from_reconstruction(
            year, sessions, ag_parent_map, session_cm_id, season_start, season_end, today=today
        )

        merged_gps: dict[str, dict[int, list[WeeklyDataPoint]]] = {}
        for gender in ("M", "F"):
            merged_gps[gender] = self._merge_hybrid_curves(
                recon_gps.get(gender, {}), snap_gps.get(gender, {}), season_start
            )

        # Use snapshot totals for breakdown (latest actual counts)
        return self._assemble_gender_curves(year, session_cm_id, sessions, merged_gps, snap_totals)

    async def _build_cancellation_curves(
        self,
        year: int,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_end: datetime,
        today: date | None = None,
    ) -> _CurveResult:
        """Build cancellation velocity curves (cumulative cancelled count over time).

        Uses hybrid mode when snapshots don't cover the full season: reconstruction
        fills pre-snapshot weeks, snapshots cover the rest.
        """
        snapshots = await self.repo.fetch_enrollment_snapshots(year, session_cm_id=session_cm_id)

        if not snapshots:
            return await self._cancellation_curves_from_reconstruction(
                year, sessions, ag_parent_map, session_cm_id, season_start, season_end, today=today
            )

        snap_result = self._cancellation_curves_from_snapshots(
            year, snapshots, sessions, ag_parent_map, session_cm_id, season_start, season_end, today=today
        )

        # Determine if we need hybrid mode
        earliest = self._find_earliest_snapshot_date(snapshots, season_start)
        if earliest is None:
            return snap_result

        first_snapshot_week = _week_start(earliest, season_start)
        if first_snapshot_week <= season_start:
            return snap_result

        # Hybrid: need reconstruction for pre-snapshot weeks
        recon_result = await self._cancellation_curves_from_reconstruction(
            year, sessions, ag_parent_map, session_cm_id, season_start, season_end, today=today
        )

        snap_by_session = {c.session_cm_id: c.weekly for c in snap_result.by_session if c.session_cm_id}
        recon_by_session = {c.session_cm_id: c.weekly for c in recon_result.by_session if c.session_cm_id}

        merged_by_session = self._merge_hybrid_curves(recon_by_session, snap_by_session, season_start)
        combined_data = self._combine_weekly_curves(merged_by_session)
        combined = VelocityCurve(year=year, session_cm_id=session_cm_id, gender=None, weekly=combined_data)
        by_session = self._build_session_curves(year, sessions, merged_by_session)

        cancelled_to_date = combined_data[-1].enrolled if combined_data else 0

        return _CurveResult(
            combined=combined,
            by_session=by_session,
            cancelled_to_date=cancelled_to_date,
        )

    def _cancellation_curves_from_snapshots(
        self,
        year: int,
        snapshots: list[Any],
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_end: datetime,
        today: date | None = None,
    ) -> _CurveResult:
        """Build cancellation curves from snapshot cancelled_count field."""
        # Group by session, merging AG — accumulate cancelled per date
        session_date_cancelled: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))

        for snap in snapshots:
            raw_sid = int(snap.session_cm_id)
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)
            date_str = snap.snapshot_date
            cancelled = int(getattr(snap, "cancelled_count", 0) or 0)
            # Accumulate (multiple sessions on same date get summed per effective session)
            current = session_date_cancelled[effective_sid].get(date_str, 0)
            if cancelled >= current:
                session_date_cancelled[effective_sid][date_str] = cancelled

        if session_cm_id is not None:
            session_date_cancelled = {sid: d for sid, d in session_date_cancelled.items() if sid == session_cm_id}
        session_date_cancelled = {sid: d for sid, d in session_date_cancelled.items() if sid in sessions}

        # Aggregate to weekly per session (last snapshot per week wins)
        per_session_data: dict[int, list[WeeklyDataPoint]] = {}

        for sid, date_data in session_date_cancelled.items():
            weekly_data: dict[str, int] = {}
            for date_str, cancelled in sorted(date_data.items()):
                dt = datetime.strptime(date_str.split("T")[0].split(" ")[0], "%Y-%m-%d")
                if dt.date() < season_start.date() or dt.date() > season_end.date():
                    continue
                bucket = _week_start(dt, season_start)
                bucket_key = bucket.strftime("%Y-%m-%d")
                weekly_data[bucket_key] = cancelled  # Last wins

            points: list[WeeklyDataPoint] = []
            prev_val = 0
            for bucket_key in sorted(weekly_data.keys()):
                val = weekly_data[bucket_key]
                delta = val - prev_val
                bucket_dt = datetime.strptime(bucket_key, "%Y-%m-%d")
                wn = _week_number(bucket_dt, season_start)
                is_partial, days_in_week = _partial_week_info(bucket_key, year, today=today)
                points.append(
                    WeeklyDataPoint(
                        week_start=bucket_key,
                        week_label=_week_label(bucket_dt),
                        week_number=wn,
                        enrolled=val,
                        waitlisted=0,
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
        combined = VelocityCurve(year=year, session_cm_id=session_cm_id, gender=None, weekly=combined_data)

        # cancelled_to_date = final combined cancelled count
        cancelled_to_date = combined_data[-1].enrolled if combined_data else 0

        by_session = self._build_session_curves(year, sessions, per_session_data)

        return _CurveResult(combined=combined, by_session=by_session, cancelled_to_date=cancelled_to_date)

    async def _cancellation_curves_from_reconstruction(
        self,
        year: int,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_end: datetime,
        today: date | None = None,
    ) -> _CurveResult:
        """Build cancellation curves from status_transitions (reconstruction fallback)."""
        cancellations = await self.repo.fetch_status_transitions(year, ["cancelled", "withdrawn", "dismissed"])

        if not cancellations:
            empty = VelocityCurve(year=year, session_cm_id=None, gender=None, weekly=[])
            return _CurveResult(combined=empty, by_session=[], cancelled_to_date=0)

        # Group cancellations by session and bucket by Monday
        session_weekly_cancels: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        total_count = 0

        for cancel in cancellations:
            expand = getattr(cancel, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else None
            if not session:
                continue
            raw_sid = int(session.cm_id)
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)
            if effective_sid not in sessions:
                continue
            if session_cm_id is not None and effective_sid != session_cm_id:
                continue

            dt = datetime.strptime(cancel.detected_at.split("T")[0].split(" ")[0], "%Y-%m-%d")
            if dt.date() < season_start.date() or dt.date() > season_end.date():
                continue
            bucket = _week_start(dt, season_start)
            bucket_key = bucket.strftime("%Y-%m-%d")
            session_weekly_cancels[effective_sid][bucket_key] += 1
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
                wn = _week_number(bucket_dt, season_start)
                is_partial, days_in_week = _partial_week_info(bucket_key, year, today=today)
                points.append(
                    WeeklyDataPoint(
                        week_start=bucket_key,
                        week_label=_week_label(bucket_dt),
                        week_number=wn,
                        enrolled=cumulative,
                        waitlisted=0,
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
        combined = VelocityCurve(year=year, session_cm_id=session_cm_id, gender=None, weekly=combined_data)

        by_session = self._build_session_curves(year, sessions, per_session_data)

        return _CurveResult(combined=combined, by_session=by_session, cancelled_to_date=total_count)

    async def _build_cancellation_gender_curves(
        self,
        year: int,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_end: datetime,
        today: date | None = None,
    ) -> tuple[list[VelocityCurve], list[SessionGenderBreakdown]]:
        """Build gender-split cancellation velocity curves from status transitions.

        Returns (gender_curves, session_gender_breakdown).
        """
        cancellations = await self.repo.fetch_status_transitions(
            year, ["cancelled", "withdrawn", "dismissed"], expand_person=True
        )

        if not cancellations:
            return [], []

        # Group cancellations by gender -> session -> date
        gender_session_daily: dict[str, dict[int, dict[str, int]]] = defaultdict(
            lambda: defaultdict(lambda: defaultdict(int))
        )
        session_gender_totals: dict[int, dict[str, int]] = defaultdict(lambda: {"M": 0, "F": 0})

        for cancel in cancellations:
            expand = getattr(cancel, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else None
            if not session:
                continue

            raw_sid = int(session.cm_id)
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)
            if effective_sid not in sessions:
                continue
            if session_cm_id is not None and effective_sid != session_cm_id:
                continue

            person = expand.get("person") if isinstance(expand, dict) else None
            gender = extract_gender(person) if person else "Unknown"
            if gender not in ("M", "F"):
                continue

            dt = datetime.strptime(cancel.detected_at.split("T")[0].split(" ")[0], "%Y-%m-%d")
            if dt.date() < season_start.date() or dt.date() > season_end.date():
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
                sid: _daily_counts_to_weekly_points(daily, season_start, year=year, today=today)
                for sid, daily in session_daily.items()
            }

            combined_data = self._combine_weekly_curves(per_session_data)

            gender_curves.append(
                VelocityCurve(
                    year=year,
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

        week_number is computed directly from priority_reg_date (no Monday snapping).
        """
        markers: list[PhaseMarker] = []
        for config_key, (phase, label) in PHASE_KEY_MAP.items():
            date_str = reg_dates.get(config_key)
            if date_str:
                dt = datetime.strptime(date_str.split("T")[0].split(" ")[0], "%Y-%m-%d")
                wn = _week_number(dt, season_start)
                markers.append(PhaseMarker(phase=phase, date=dt.strftime("%Y-%m-%d"), label=label, week_number=wn))

        return markers
