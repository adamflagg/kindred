"""Velocity service - business logic for registration velocity curves.

Computes week-over-week enrollment velocity using either enrollment snapshots
(fast path) or reconstruction from attendee enrollment dates (fallback).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
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


def _monday_of_week(d: datetime) -> datetime:
    """Return the Monday of the ISO week containing the given date."""
    return d - timedelta(days=d.weekday())


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


def _season_end(season_start_monday: datetime) -> datetime:
    """Return the season end: season_start_monday + SEASON_WEEKS weeks."""
    return season_start_monday + timedelta(weeks=SEASON_WEEKS)


def _week_number(monday: datetime, season_start_monday: datetime) -> int:
    """Compute 0-based week offset from season start Monday."""
    return (monday - season_start_monday).days // 7


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

    async def get_velocity(
        self,
        year: int,
        session_cm_id: int | None = None,
        compare_years: list[int] | None = None,
        session_types: list[str] | None = None,
        split_by_gender: bool = False,
        metric: str = "enrollment",
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
            )

        season_start_monday = _monday_of_week(season_start_dt)
        season_end_dt = _season_end(season_start_monday)
        # Fetch sessions for the year
        sessions = await self.repo.fetch_sessions(year, session_types=session_types)
        ag_parent_map = build_ag_parent_map(sessions)

        # Build curves for the primary year (dispatch by metric type)
        if metric == "cancellation":
            result = await self._build_cancellation_curves(
                year, sessions, ag_parent_map, session_cm_id, season_start_dt, season_start_monday, season_end_dt
            )
        else:
            result = await self._build_curves(
                year, sessions, ag_parent_map, session_cm_id, season_start_dt, season_start_monday, season_end_dt
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
                    year, sessions, ag_parent_map, session_cm_id, season_start_dt, season_start_monday, season_end_dt
                )
            else:
                by_gender, session_gender_breakdown = await self._build_gender_curves(
                    year, sessions, ag_parent_map, session_cm_id, season_start_dt, season_start_monday, season_end_dt
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
                prior_season_start_monday = _monday_of_week(prior_season_start)
                prior_season_end = _season_end(prior_season_start_monday)
                prior_sessions = await self.repo.fetch_sessions(prior_year, session_types=session_types)
                prior_ag_map = build_ag_parent_map(prior_sessions)

                if metric == "cancellation":
                    prior_result = await self._build_cancellation_curves(
                        prior_year,
                        prior_sessions,
                        prior_ag_map,
                        session_cm_id=None,
                        season_start=prior_season_start,
                        season_start_monday=prior_season_start_monday,
                        season_end=prior_season_end,
                    )
                else:
                    prior_result = await self._build_curves(
                        prior_year,
                        prior_sessions,
                        prior_ag_map,
                        session_cm_id=None,
                        season_start=prior_season_start,
                        season_start_monday=prior_season_start_monday,
                        season_end=prior_season_end,
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
                            season_start_monday=prior_season_start_monday,
                            season_end=prior_season_end,
                        )
                    else:
                        prior_gender_curves, _ = await self._build_gender_curves(
                            prior_year,
                            prior_sessions,
                            prior_ag_map,
                            session_cm_id=None,
                            season_start=prior_season_start,
                            season_start_monday=prior_season_start_monday,
                            season_end=prior_season_end,
                        )
                    prior_year_by_gender.extend(prior_gender_curves)

        # Fetch phase markers (pass reg_dates to avoid double fetch)
        phase_markers = self._build_phase_markers(reg_dates, season_start_monday)

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

    async def _build_curves(
        self,
        year: int,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_start_monday: datetime,
        season_end: datetime,
    ) -> _CurveResult:
        """Build combined and per-session velocity curves for a year."""
        snapshots = await self.repo.fetch_enrollment_snapshots(year, session_cm_id=session_cm_id)

        if snapshots:
            return self._curves_from_snapshots(
                year,
                snapshots,
                sessions,
                ag_parent_map,
                session_cm_id,
                season_start,
                season_start_monday,
                season_end,
            )

        return await self._curves_from_reconstruction(
            year,
            sessions,
            ag_parent_map,
            session_cm_id,
            season_start,
            season_start_monday,
            season_end,
        )

    def _curves_from_snapshots(
        self,
        year: int,
        snapshots: list[Any],
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_start_monday: datetime,
        season_end: datetime,
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
            weekly = self._aggregate_snapshots_to_weekly(date_data, season_start, season_start_monday, season_end)
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

        by_session = [
            VelocityCurve(
                year=year,
                session_cm_id=sid,
                session_name=getattr(sessions.get(sid), "name", f"Session {sid}"),
                gender=None,
                weekly=data,
            )
            for sid, data in sorted(per_session_data.items())
        ]

        return _CurveResult(combined=combined, by_session=by_session, cancelled_to_date=cancelled_to_date)

    def _aggregate_snapshots_to_weekly(
        self,
        date_data: dict[str, dict[str, int]],
        season_start: datetime,
        season_start_monday: datetime,
        season_end: datetime,
    ) -> list[WeeklyDataPoint]:
        """Aggregate snapshot data to weekly points (Monday bucketing, last snapshot per week wins).

        Filters out data before season_start or after season_end.
        """
        # Bucket by Monday
        weekly_data: dict[str, dict[str, int]] = {}

        for date_str, counts in sorted(date_data.items()):
            dt = datetime.strptime(date_str.split("T")[0].split(" ")[0], "%Y-%m-%d")
            if dt.date() < season_start.date():
                continue
            if dt.date() > season_end.date():
                continue
            monday = _monday_of_week(dt)
            monday_key = monday.strftime("%Y-%m-%d")
            # Last snapshot of the week wins (data is sorted by date)
            weekly_data[monday_key] = counts

        # Build weekly data points with deltas
        points: list[WeeklyDataPoint] = []
        prev_enrolled = 0

        for monday_key in sorted(weekly_data.keys()):
            counts = weekly_data[monday_key]
            enrolled = counts["enrolled"]
            waitlisted = counts["waitlisted"]
            delta = enrolled - prev_enrolled

            monday_dt = datetime.strptime(monday_key, "%Y-%m-%d")
            wn = _week_number(monday_dt, season_start_monday)
            points.append(
                WeeklyDataPoint(
                    week_start=monday_key,
                    week_label=_week_label(monday_dt),
                    week_number=wn,
                    enrolled=enrolled,
                    waitlisted=waitlisted,
                    delta=delta,
                    data_source="snapshot",
                )
            )
            prev_enrolled = enrolled

        return points

    def _combine_weekly_curves(self, per_session_data: dict[int, list[WeeklyDataPoint]]) -> list[WeeklyDataPoint]:
        """Combine per-session weekly curves into a single combined curve."""
        week_totals: dict[str, dict[str, int]] = defaultdict(lambda: {"enrolled": 0, "waitlisted": 0})
        week_labels: dict[str, str] = {}
        data_sources: dict[str, str] = {}
        week_numbers: dict[str, int] = {}

        for data in per_session_data.values():
            for point in data:
                week_totals[point.week_start]["enrolled"] += point.enrolled
                week_totals[point.week_start]["waitlisted"] += point.waitlisted
                week_labels[point.week_start] = point.week_label
                data_sources[point.week_start] = point.data_source
                week_numbers[point.week_start] = point.week_number

        # Build combined points with deltas
        points: list[WeeklyDataPoint] = []
        prev_enrolled = 0

        for week_key in sorted(week_totals.keys()):
            totals = week_totals[week_key]
            enrolled = totals["enrolled"]
            delta = enrolled - prev_enrolled

            points.append(
                WeeklyDataPoint(
                    week_start=week_key,
                    week_label=week_labels[week_key],
                    week_number=week_numbers.get(week_key, 0),
                    enrolled=enrolled,
                    waitlisted=totals["waitlisted"],
                    delta=delta,
                    data_source=data_sources.get(week_key, "snapshot"),
                )
            )
            prev_enrolled = enrolled

        return points

    async def _curves_from_reconstruction(
        self,
        year: int,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_start_monday: datetime,
        season_end: datetime,
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

            # Bucket net changes by Monday
            weekly_net: dict[str, int] = defaultdict(int)
            for date_key in all_dates:
                new_enrolled = daily_enrollments.get(date_key, 0)
                cancelled = session_daily_cancellations.get(sid, {}).get(date_key, 0)
                dt = datetime.strptime(date_key, "%Y-%m-%d")
                monday = _monday_of_week(dt)
                monday_key = monday.strftime("%Y-%m-%d")
                weekly_net[monday_key] += new_enrolled - cancelled

            # Build cumulative weekly points
            cumulative = 0
            points: list[WeeklyDataPoint] = []

            for monday_key in sorted(weekly_net.keys()):
                cumulative += weekly_net[monday_key]
                prev_enrolled_val = points[-1].enrolled if points else 0
                delta = cumulative - prev_enrolled_val

                monday_dt = datetime.strptime(monday_key, "%Y-%m-%d")
                wn = _week_number(monday_dt, season_start_monday)
                points.append(
                    WeeklyDataPoint(
                        week_start=monday_key,
                        week_label=_week_label(monday_dt),
                        week_number=wn,
                        enrolled=cumulative,
                        waitlisted=0,
                        delta=delta,
                        data_source="reconstructed",
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

        by_session = [
            VelocityCurve(
                year=year,
                session_cm_id=sid,
                session_name=getattr(sessions.get(sid), "name", f"Session {sid}"),
                gender=None,
                weekly=data,
            )
            for sid, data in sorted(per_session_data.items())
        ]

        return _CurveResult(
            combined=combined,
            by_session=by_session,
            cancelled_to_date=total_cancellation_count,
        )

    async def _build_gender_curves(
        self,
        year: int,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_start_monday: datetime,
        season_end: datetime,
    ) -> tuple[list[VelocityCurve], list[SessionGenderBreakdown]]:
        """Build gender-split velocity curves from attendee reconstruction.

        Gender split always uses reconstruction (enrollment snapshots have no gender).
        Returns (gender_curves, session_gender_breakdown).
        """
        attendees = await self.repo.fetch_attendees_with_dates(year, session_cm_id=session_cm_id, expand_person=True)

        if not attendees:
            return [], []

        # Group enrollments by gender -> session -> date
        gender_session_daily: dict[str, dict[int, dict[str, int]]] = defaultdict(
            lambda: defaultdict(lambda: defaultdict(int))
        )
        # Track per-session gender totals for breakdown
        session_gender_totals: dict[int, dict[str, int]] = defaultdict(lambda: {"M": 0, "F": 0})

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
                continue  # Skip unknown gender for split curves

            dt = datetime.strptime(att.enrollment_date.split("T")[0].split(" ")[0], "%Y-%m-%d")
            if dt.date() < season_start.date():
                continue
            if dt.date() > season_end.date():
                continue
            date_key = dt.strftime("%Y-%m-%d")
            gender_session_daily[gender][effective_sid][date_key] += 1
            session_gender_totals[effective_sid][gender] += 1

        # Filter out sessions not in the sessions dict (excludes non-summer types)
        for gender in ("M", "F"):
            gender_session_daily[gender] = {
                sid: w for sid, w in gender_session_daily.get(gender, {}).items() if sid in sessions
            }
        session_gender_totals = {sid: t for sid, t in session_gender_totals.items() if sid in sessions}

        # Build curves per gender
        gender_curves: list[VelocityCurve] = []

        for gender in ("M", "F"):
            session_daily = gender_session_daily.get(gender, {})
            if session_cm_id is not None:
                session_daily = {sid: dates for sid, dates in session_daily.items() if sid == session_cm_id}

            # Build per-session cumulative curves (bucket by Monday)
            per_session_data: dict[int, list[WeeklyDataPoint]] = {}

            for sid, daily_enrollments in session_daily.items():
                # Bucket by Monday
                weekly_counts: dict[str, int] = defaultdict(int)
                for date_key in daily_enrollments:
                    dt = datetime.strptime(date_key, "%Y-%m-%d")
                    monday = _monday_of_week(dt)
                    monday_key = monday.strftime("%Y-%m-%d")
                    weekly_counts[monday_key] += daily_enrollments[date_key]

                cumulative = 0
                points: list[WeeklyDataPoint] = []

                for monday_key in sorted(weekly_counts.keys()):
                    new_enrolled = weekly_counts[monday_key]
                    cumulative += new_enrolled
                    prev_enrolled_val = points[-1].enrolled if points else 0
                    delta = cumulative - prev_enrolled_val

                    monday_dt = datetime.strptime(monday_key, "%Y-%m-%d")
                    wn = _week_number(monday_dt, season_start_monday)
                    points.append(
                        WeeklyDataPoint(
                            week_start=monday_key,
                            week_label=_week_label(monday_dt),
                            week_number=wn,
                            enrolled=cumulative,
                            waitlisted=0,
                            delta=delta,
                            data_source="reconstructed",
                        )
                    )

                per_session_data[sid] = points

            # Combine across sessions for this gender
            combined_data = self._combine_weekly_curves(per_session_data)

            gender_curves.append(
                VelocityCurve(
                    year=year,
                    session_cm_id=session_cm_id,
                    gender=gender,
                    weekly=combined_data,
                )
            )

        # Build session gender breakdown
        breakdown: list[SessionGenderBreakdown] = []
        for sid in sorted(session_gender_totals.keys()):
            totals = session_gender_totals[sid]
            breakdown.append(
                SessionGenderBreakdown(
                    session_cm_id=sid,
                    session_name=getattr(sessions.get(sid), "name", f"Session {sid}"),
                    boys_enrolled=totals["M"],
                    girls_enrolled=totals["F"],
                )
            )

        return gender_curves, breakdown

    async def _build_cancellation_curves(
        self,
        year: int,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_start_monday: datetime,
        season_end: datetime,
    ) -> _CurveResult:
        """Build cancellation velocity curves (cumulative cancelled count over time).

        Uses snapshot cancelled_count when available, falls back to status transitions.
        """
        snapshots = await self.repo.fetch_enrollment_snapshots(year, session_cm_id=session_cm_id)

        if snapshots:
            return self._cancellation_curves_from_snapshots(
                year,
                snapshots,
                sessions,
                ag_parent_map,
                session_cm_id,
                season_start,
                season_start_monday,
                season_end,
            )

        return await self._cancellation_curves_from_reconstruction(
            year,
            sessions,
            ag_parent_map,
            session_cm_id,
            season_start,
            season_start_monday,
            season_end,
        )

    def _cancellation_curves_from_snapshots(
        self,
        year: int,
        snapshots: list[Any],
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_start_monday: datetime,
        season_end: datetime,
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
                monday = _monday_of_week(dt)
                monday_key = monday.strftime("%Y-%m-%d")
                weekly_data[monday_key] = cancelled  # Last wins

            points: list[WeeklyDataPoint] = []
            prev_val = 0
            for monday_key in sorted(weekly_data.keys()):
                val = weekly_data[monday_key]
                delta = val - prev_val
                monday_dt = datetime.strptime(monday_key, "%Y-%m-%d")
                wn = _week_number(monday_dt, season_start_monday)
                points.append(
                    WeeklyDataPoint(
                        week_start=monday_key,
                        week_label=_week_label(monday_dt),
                        week_number=wn,
                        enrolled=val,
                        waitlisted=0,
                        delta=delta,
                        data_source="snapshot",
                    )
                )
                prev_val = val
            per_session_data[sid] = points

        combined_data = self._combine_weekly_curves(per_session_data)
        combined = VelocityCurve(year=year, session_cm_id=session_cm_id, gender=None, weekly=combined_data)

        # cancelled_to_date = final combined cancelled count
        cancelled_to_date = combined_data[-1].enrolled if combined_data else 0

        by_session = [
            VelocityCurve(
                year=year,
                session_cm_id=sid,
                session_name=getattr(sessions.get(sid), "name", f"Session {sid}"),
                gender=None,
                weekly=data,
            )
            for sid, data in sorted(per_session_data.items())
        ]

        return _CurveResult(combined=combined, by_session=by_session, cancelled_to_date=cancelled_to_date)

    async def _cancellation_curves_from_reconstruction(
        self,
        year: int,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_start_monday: datetime,
        season_end: datetime,
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
            monday = _monday_of_week(dt)
            monday_key = monday.strftime("%Y-%m-%d")
            session_weekly_cancels[effective_sid][monday_key] += 1
            total_count += 1

        # Build cumulative curves per session
        per_session_data: dict[int, list[WeeklyDataPoint]] = {}

        for sid, weekly_counts in session_weekly_cancels.items():
            cumulative = 0
            points: list[WeeklyDataPoint] = []
            for monday_key in sorted(weekly_counts.keys()):
                cumulative += weekly_counts[monday_key]
                prev_val = points[-1].enrolled if points else 0
                delta = cumulative - prev_val
                monday_dt = datetime.strptime(monday_key, "%Y-%m-%d")
                wn = _week_number(monday_dt, season_start_monday)
                points.append(
                    WeeklyDataPoint(
                        week_start=monday_key,
                        week_label=_week_label(monday_dt),
                        week_number=wn,
                        enrolled=cumulative,
                        waitlisted=0,
                        delta=delta,
                        data_source="reconstructed",
                    )
                )
            per_session_data[sid] = points

        combined_data = self._combine_weekly_curves(per_session_data)
        combined = VelocityCurve(year=year, session_cm_id=session_cm_id, gender=None, weekly=combined_data)

        by_session = [
            VelocityCurve(
                year=year,
                session_cm_id=sid,
                session_name=getattr(sessions.get(sid), "name", f"Session {sid}"),
                gender=None,
                weekly=data,
            )
            for sid, data in sorted(per_session_data.items())
        ]

        return _CurveResult(combined=combined, by_session=by_session, cancelled_to_date=total_count)

    async def _build_cancellation_gender_curves(
        self,
        year: int,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start: datetime,
        season_start_monday: datetime,
        season_end: datetime,
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

            per_session_data: dict[int, list[WeeklyDataPoint]] = {}

            for sid, daily_cancellations in session_daily.items():
                weekly_counts: dict[str, int] = defaultdict(int)
                for date_key in daily_cancellations:
                    dt = datetime.strptime(date_key, "%Y-%m-%d")
                    monday = _monday_of_week(dt)
                    monday_key = monday.strftime("%Y-%m-%d")
                    weekly_counts[monday_key] += daily_cancellations[date_key]

                cumulative = 0
                points: list[WeeklyDataPoint] = []

                for monday_key in sorted(weekly_counts.keys()):
                    new_cancelled = weekly_counts[monday_key]
                    cumulative += new_cancelled
                    prev_val = points[-1].enrolled if points else 0
                    delta = cumulative - prev_val

                    monday_dt = datetime.strptime(monday_key, "%Y-%m-%d")
                    wn = _week_number(monday_dt, season_start_monday)
                    points.append(
                        WeeklyDataPoint(
                            week_start=monday_key,
                            week_label=_week_label(monday_dt),
                            week_number=wn,
                            enrolled=cumulative,
                            waitlisted=0,
                            delta=delta,
                            data_source="reconstructed",
                        )
                    )

                per_session_data[sid] = points

            combined_data = self._combine_weekly_curves(per_session_data)

            gender_curves.append(
                VelocityCurve(
                    year=year,
                    session_cm_id=session_cm_id,
                    gender=gender,
                    weekly=combined_data,
                )
            )

        # Build session gender breakdown
        breakdown: list[SessionGenderBreakdown] = []
        for sid in sorted(session_gender_totals.keys()):
            totals = session_gender_totals[sid]
            breakdown.append(
                SessionGenderBreakdown(
                    session_cm_id=sid,
                    session_name=getattr(sessions.get(sid), "name", f"Session {sid}"),
                    boys_enrolled=totals["M"],
                    girls_enrolled=totals["F"],
                )
            )

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
            # Look up cumulative cancelled at the current week_number
            # (.enrolled holds cumulative cancelled for cancellation metric)
            wn_map = {p.week_number: p.enrolled for p in prior_result.combined.weekly}
            cancelled_at_current_week = wn_map.get(current_max_wn)
            # Fallback to closest prior week if exact match not found
            if cancelled_at_current_week is None:
                closest_wn = None
                for wn in sorted(wn_map.keys()):
                    if wn <= current_max_wn:
                        closest_wn = wn
                if closest_wn is not None:
                    cancelled_at_current_week = wn_map[closest_wn]

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

            # Find enrolled_at_current_week
            enrolled_at_current_week: int | None = None
            if current_max_wn is not None:
                wn_map = {p.week_number: p.enrolled for p in curve.weekly}
                enrolled_at_current_week = wn_map.get(current_max_wn)
                # If exact match not found, use closest prior week
                if enrolled_at_current_week is None:
                    closest_wn = None
                    for wn in sorted(wn_map.keys()):
                        if wn <= current_max_wn:
                            closest_wn = wn
                    if closest_wn is not None:
                        enrolled_at_current_week = wn_map[closest_wn]

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

    def _build_phase_markers(self, reg_dates: dict[str, str], season_start_monday: datetime) -> list[PhaseMarker]:
        """Build registration phase markers from config.

        Snaps phase dates to Monday for week_number computation.
        """
        markers: list[PhaseMarker] = []
        for config_key, (phase, label) in PHASE_KEY_MAP.items():
            date_str = reg_dates.get(config_key)
            if date_str:
                dt = datetime.strptime(date_str.split("T")[0].split(" ")[0], "%Y-%m-%d")
                monday = _monday_of_week(dt)
                wn = _week_number(monday, season_start_monday)
                markers.append(PhaseMarker(phase=phase, date=dt.strftime("%Y-%m-%d"), label=label, week_number=wn))

        return markers
