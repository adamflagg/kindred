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


def _season_start(year: int) -> datetime:
    """Return the season start date: Nov 1 of year-1."""
    return datetime(year - 1, 11, 1)


def _season_end_monday(year: int) -> datetime:
    """Return the Monday of the week containing Dec 31 of the season year."""
    return _monday_of_week(datetime(year, 12, 31))


def _week_number(monday: datetime, season_start_monday: datetime) -> int:
    """Compute 0-based week offset from season start Monday."""
    return (monday - season_start_monday).days // 7


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
    ) -> VelocityResponse:
        """Get registration velocity curves with week-over-week enrollment data."""
        season_start_dt = _season_start(year)
        season_start_monday = _monday_of_week(season_start_dt)
        end_monday = _season_end_monday(year)

        # Fetch sessions for the year
        sessions = await self.repo.fetch_sessions(year, session_types=session_types)
        ag_parent_map = build_ag_parent_map(sessions)

        # Build curves for the primary year
        combined, by_session = await self._build_curves(
            year, sessions, ag_parent_map, session_cm_id, season_start_monday, end_monday
        )

        # Build gender-split curves if requested
        by_gender: list[VelocityCurve] = []
        session_gender_breakdown: list[SessionGenderBreakdown] = []
        if split_by_gender:
            by_gender, session_gender_breakdown = await self._build_gender_curves(
                year, sessions, ag_parent_map, session_cm_id, season_start_monday, end_monday
            )

        # Build prior year curves
        prior_years: list[VelocityCurve] = []
        prior_year_by_gender: list[VelocityCurve] = []
        if compare_years:
            for prior_year in compare_years:
                prior_season_start_monday = _monday_of_week(_season_start(prior_year))
                prior_end_monday = _season_end_monday(prior_year)
                prior_sessions = await self.repo.fetch_sessions(prior_year, session_types=session_types)
                prior_ag_map = build_ag_parent_map(prior_sessions)
                prior_combined, _ = await self._build_curves(
                    prior_year,
                    prior_sessions,
                    prior_ag_map,
                    session_cm_id=None,
                    season_start_monday=prior_season_start_monday,
                    season_end_monday=prior_end_monday,
                )
                prior_years.append(prior_combined)

                if split_by_gender:
                    prior_gender_curves, _ = await self._build_gender_curves(
                        prior_year,
                        prior_sessions,
                        prior_ag_map,
                        session_cm_id=None,
                        season_start_monday=prior_season_start_monday,
                        season_end_monday=prior_end_monday,
                    )
                    prior_year_by_gender.extend(prior_gender_curves)

        # Fetch phase markers
        phase_markers = await self._build_phase_markers(year)

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
        )

    async def _build_curves(
        self,
        year: int,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start_monday: datetime,
        season_end_monday: datetime,
    ) -> tuple[VelocityCurve, list[VelocityCurve]]:
        """Build combined and per-session velocity curves for a year."""
        snapshots = await self.repo.fetch_enrollment_snapshots(year, session_cm_id=session_cm_id)

        if snapshots:
            return self._curves_from_snapshots(
                year, snapshots, sessions, ag_parent_map, session_cm_id, season_start_monday, season_end_monday
            )

        return await self._curves_from_reconstruction(
            year, sessions, ag_parent_map, session_cm_id, season_start_monday, season_end_monday
        )

    def _curves_from_snapshots(
        self,
        year: int,
        snapshots: list[Any],
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start_monday: datetime,
        season_end_monday: datetime,
    ) -> tuple[VelocityCurve, list[VelocityCurve]]:
        """Build curves from enrollment snapshots (fast path)."""
        # Group snapshots by session, merging AG into parent
        # Key: effective session cm_id -> date -> snapshot data
        session_date_data: dict[int, dict[str, dict[str, int]]] = defaultdict(
            lambda: defaultdict(lambda: {"enrolled": 0, "waitlisted": 0})
        )

        for snap in snapshots:
            raw_sid = int(snap.session_cm_id)
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)
            date_str = snap.snapshot_date

            session_date_data[effective_sid][date_str]["enrolled"] += int(snap.enrolled_count)
            session_date_data[effective_sid][date_str]["waitlisted"] += int(snap.waitlisted_count)

        # Filter by session if specified
        if session_cm_id is not None:
            session_date_data = {sid: dates for sid, dates in session_date_data.items() if sid == session_cm_id}

        # Filter out sessions not in the sessions dict (excludes non-summer types)
        session_date_data = {sid: d for sid, d in session_date_data.items() if sid in sessions}

        # Aggregate to weekly per session (last snapshot of each week)
        per_session_weekly: dict[int, list[WeeklyDataPoint]] = {}

        for sid, date_data in session_date_data.items():
            weekly = self._aggregate_snapshots_to_weekly(date_data, season_start_monday, season_end_monday)
            per_session_weekly[sid] = weekly

        # Build combined curve by summing across sessions per week
        combined_weekly = self._combine_weekly_curves(per_session_weekly)

        combined = VelocityCurve(
            year=year,
            session_cm_id=session_cm_id,
            session_name=None,
            weekly=combined_weekly,
        )

        by_session = [
            VelocityCurve(
                year=year,
                session_cm_id=sid,
                session_name=getattr(sessions.get(sid), "name", f"Session {sid}"),
                weekly=weekly,
            )
            for sid, weekly in sorted(per_session_weekly.items())
        ]

        return combined, by_session

    def _aggregate_snapshots_to_weekly(
        self, date_data: dict[str, dict[str, int]], season_start_monday: datetime, season_end_monday: datetime
    ) -> list[WeeklyDataPoint]:
        """Aggregate daily snapshot data to weekly, taking last snapshot per week.

        Filters out data before season_start_monday or after season_end_monday,
        and tags each point with week_number.
        """
        # Group by week (Monday boundary)
        weekly_data: dict[str, dict[str, int]] = {}

        for date_str, counts in sorted(date_data.items()):
            dt = datetime.strptime(date_str.split("T")[0].split(" ")[0], "%Y-%m-%d")
            monday = _monday_of_week(dt)
            if monday < season_start_monday:
                continue
            if monday > season_end_monday:
                continue
            week_key = monday.strftime("%Y-%m-%d")
            # Last snapshot of the week wins (data is sorted by date)
            weekly_data[week_key] = counts

        # Build weekly data points with deltas
        points: list[WeeklyDataPoint] = []
        prev_enrolled = 0

        for week_key in sorted(weekly_data.keys()):
            counts = weekly_data[week_key]
            enrolled = counts["enrolled"]
            waitlisted = counts["waitlisted"]
            delta = enrolled - prev_enrolled

            monday = datetime.strptime(week_key, "%Y-%m-%d")
            wn = _week_number(monday, season_start_monday)
            points.append(
                WeeklyDataPoint(
                    week_start=week_key,
                    week_label=_week_label(monday),
                    enrolled=enrolled,
                    waitlisted=waitlisted,
                    delta=delta,
                    data_source="snapshot",
                    week_number=wn,
                )
            )
            prev_enrolled = enrolled

        return points

    def _combine_weekly_curves(self, per_session_weekly: dict[int, list[WeeklyDataPoint]]) -> list[WeeklyDataPoint]:
        """Combine per-session weekly curves into a single combined curve."""
        # Collect all weeks across sessions
        week_totals: dict[str, dict[str, int]] = defaultdict(lambda: {"enrolled": 0, "waitlisted": 0})
        week_labels: dict[str, str] = {}
        data_sources: dict[str, str] = {}
        week_numbers: dict[str, int] = {}

        for weekly in per_session_weekly.values():
            for point in weekly:
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
                    enrolled=enrolled,
                    waitlisted=totals["waitlisted"],
                    delta=delta,
                    data_source=data_sources.get(week_key, "snapshot"),
                    week_number=week_numbers.get(week_key, 0),
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
        season_start_monday: datetime,
        season_end_monday: datetime,
    ) -> tuple[VelocityCurve, list[VelocityCurve]]:
        """Build curves by reconstructing from enrollment dates (fallback)."""
        attendees = await self.repo.fetch_attendees_with_dates(year, session_cm_id=session_cm_id)
        cancellations = await self.repo.fetch_status_transitions(year, ["cancelled", "withdrawn"])

        if not attendees:
            empty_combined = VelocityCurve(year=year, session_cm_id=None, weekly=[])
            return empty_combined, []

        # Group enrollments by session (week -> count), merging AG
        # session_id -> week_key -> enrollment count
        session_weekly_enrollments: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))

        for att in attendees:
            expand = getattr(att, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else None
            if not session:
                continue

            raw_sid = int(session.cm_id)
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)

            dt = datetime.strptime(att.enrollment_date.split("T")[0].split(" ")[0], "%Y-%m-%d")
            monday = _monday_of_week(dt)
            if monday < season_start_monday:
                continue
            if monday > season_end_monday:
                continue
            week_key = monday.strftime("%Y-%m-%d")
            session_weekly_enrollments[effective_sid][week_key] += 1

        # Group cancellations by session and week
        session_weekly_cancellations: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))

        for cancel in cancellations:
            expand = getattr(cancel, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else None
            if not session:
                continue
            raw_sid = int(session.cm_id)
            effective_sid = ag_parent_map.get(raw_sid, raw_sid)

            dt = datetime.strptime(cancel.detected_at.split("T")[0].split(" ")[0], "%Y-%m-%d")
            monday = _monday_of_week(dt)
            if monday < season_start_monday:
                continue
            if monday > season_end_monday:
                continue
            week_key = monday.strftime("%Y-%m-%d")
            session_weekly_cancellations[effective_sid][week_key] += 1

        # Filter by session if specified
        if session_cm_id is not None:
            session_weekly_enrollments = {
                sid: weeks for sid, weeks in session_weekly_enrollments.items() if sid == session_cm_id
            }

        # Filter out sessions not in the sessions dict (excludes non-summer types)
        session_weekly_enrollments = {sid: w for sid, w in session_weekly_enrollments.items() if sid in sessions}

        # Build per-session cumulative curves
        per_session_weekly: dict[int, list[WeeklyDataPoint]] = {}

        for sid, weekly_enrollments in session_weekly_enrollments.items():
            # Collect all weeks from both enrollments and cancellations
            all_weeks = set(weekly_enrollments.keys())
            if sid in session_weekly_cancellations:
                all_weeks |= set(session_weekly_cancellations[sid].keys())

            cumulative = 0
            points: list[WeeklyDataPoint] = []

            for week_key in sorted(all_weeks):
                new_enrolled = weekly_enrollments.get(week_key, 0)
                cancelled = session_weekly_cancellations.get(sid, {}).get(week_key, 0)
                cumulative += new_enrolled - cancelled
                prev_enrolled_val = points[-1].enrolled if points else 0
                delta = cumulative - prev_enrolled_val

                monday = datetime.strptime(week_key, "%Y-%m-%d")
                wn = _week_number(monday, season_start_monday)
                points.append(
                    WeeklyDataPoint(
                        week_start=week_key,
                        week_label=_week_label(monday),
                        enrolled=cumulative,
                        waitlisted=0,
                        delta=delta,
                        data_source="reconstructed",
                        week_number=wn,
                    )
                )

            per_session_weekly[sid] = points

        # Build combined
        combined_weekly = self._combine_weekly_curves(per_session_weekly)

        combined = VelocityCurve(
            year=year,
            session_cm_id=session_cm_id,
            weekly=combined_weekly,
        )

        by_session = [
            VelocityCurve(
                year=year,
                session_cm_id=sid,
                session_name=getattr(sessions.get(sid), "name", f"Session {sid}"),
                weekly=weekly,
            )
            for sid, weekly in sorted(per_session_weekly.items())
        ]

        return combined, by_session

    async def _build_gender_curves(
        self,
        year: int,
        sessions: dict[int, Any],
        ag_parent_map: dict[int, int],
        session_cm_id: int | None,
        season_start_monday: datetime,
        season_end_monday: datetime,
    ) -> tuple[list[VelocityCurve], list[SessionGenderBreakdown]]:
        """Build gender-split velocity curves from attendee reconstruction.

        Gender split always uses reconstruction (enrollment snapshots have no gender).
        Returns (gender_curves, session_gender_breakdown).
        """
        attendees = await self.repo.fetch_attendees_with_dates(year, session_cm_id=session_cm_id, expand_person=True)

        if not attendees:
            return [], []

        # Group enrollments by gender -> session -> week
        gender_session_weekly: dict[str, dict[int, dict[str, int]]] = defaultdict(
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
            monday = _monday_of_week(dt)
            if monday < season_start_monday:
                continue
            if monday > season_end_monday:
                continue
            week_key = monday.strftime("%Y-%m-%d")
            gender_session_weekly[gender][effective_sid][week_key] += 1
            session_gender_totals[effective_sid][gender] += 1

        # Build cancellation map (not gender-split — apply proportionally or skip)
        # For simplicity, gender cancellations are not tracked separately
        # since status_transitions don't have person expansion

        # Filter out sessions not in the sessions dict (excludes non-summer types)
        for gender in ("M", "F"):
            gender_session_weekly[gender] = {
                sid: w for sid, w in gender_session_weekly.get(gender, {}).items() if sid in sessions
            }
        session_gender_totals = {sid: t for sid, t in session_gender_totals.items() if sid in sessions}

        # Build curves per gender
        gender_curves: list[VelocityCurve] = []

        for gender in ("M", "F"):
            session_weekly = gender_session_weekly.get(gender, {})
            if session_cm_id is not None:
                session_weekly = {sid: weeks for sid, weeks in session_weekly.items() if sid == session_cm_id}

            # Build per-session cumulative curves
            per_session_weekly: dict[int, list[WeeklyDataPoint]] = {}

            for sid, weekly_enrollments in session_weekly.items():
                cumulative = 0
                points: list[WeeklyDataPoint] = []

                for week_key in sorted(weekly_enrollments.keys()):
                    new_enrolled = weekly_enrollments[week_key]
                    cumulative += new_enrolled
                    prev_enrolled_val = points[-1].enrolled if points else 0
                    delta = cumulative - prev_enrolled_val

                    monday = datetime.strptime(week_key, "%Y-%m-%d")
                    wn = _week_number(monday, season_start_monday)
                    points.append(
                        WeeklyDataPoint(
                            week_start=week_key,
                            week_label=_week_label(monday),
                            enrolled=cumulative,
                            waitlisted=0,
                            delta=delta,
                            data_source="reconstructed",
                            week_number=wn,
                        )
                    )

                per_session_weekly[sid] = points

            # Combine across sessions for this gender
            combined_weekly = self._combine_weekly_curves(per_session_weekly)

            gender_curves.append(
                VelocityCurve(
                    year=year,
                    session_cm_id=session_cm_id,
                    gender=gender,
                    weekly=combined_weekly,
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

    async def _build_phase_markers(self, year: int) -> list[PhaseMarker]:
        """Build registration phase markers from config.

        Snaps each date to the containing Monday so markers align with weekly data.
        """
        reg_dates = await self.repo.fetch_registration_dates(year)

        markers: list[PhaseMarker] = []
        for config_key, (phase, label) in PHASE_KEY_MAP.items():
            date_str = reg_dates.get(config_key)
            if date_str:
                dt = datetime.strptime(date_str.split("T")[0].split(" ")[0], "%Y-%m-%d")
                monday = _monday_of_week(dt)
                markers.append(PhaseMarker(phase=phase, date=monday.strftime("%Y-%m-%d"), label=label))

        return markers
