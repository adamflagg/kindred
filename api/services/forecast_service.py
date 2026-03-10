"""Forecast service - budget goals and revenue projections.

Computes per-session enrollment vs budget goals, prior year comparison,
and revenue projections.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING, Any

from api.schemas.forecast import ForecastResponse, SessionForecast, WeekOption
from api.services.camp_calendar import get_camp_today
from api.services.reconstruction import reconstruct_enrollment_at_offset
from api.utils.session_aliases import resolve_session_alias
from api.utils.session_metrics import (
    build_ag_parent_map,
    get_session_from_expand,
    resolve_duration_sessions,
)

if TYPE_CHECKING:
    from api.services.metrics_repository import MetricsRepository

logger = logging.getLogger(__name__)


class ForecastService:
    """Compute session enrollment forecasts with budget and revenue projections."""

    def __init__(self, repository: MetricsRepository) -> None:
        self.repository = repository

    async def get_week_options(self, year: int, today: date | None = None) -> list[WeekOption]:
        """Generate week-relative options from registration anchor through today.

        Returns a descending list (newest first) of week options:
        - First entry: Today with exact day_offset and "(Today)" suffix
        - Then each completed week from most recent down to Week 0
        - Week 0 gets "(Priority Reg)" suffix
        - If today falls on an exact week boundary, no duplicate is created

        Args:
            year: The camp year to look up registration dates for.
            today: Override for current date (for testing). Defaults to date.today().

        Returns:
            List of WeekOption, empty if no anchor date or today < anchor.
        """
        if today is None:
            today = get_camp_today()

        reg_dates = await self.repository.fetch_registration_dates(year)

        # Find anchor: priority_reg_date preferred, fall back to early_reg_date
        anchor_str = reg_dates.get("priority_reg_date") or reg_dates.get("early_reg_date")
        if not anchor_str:
            return []
        anchor_str = anchor_str.split("T")[0].split(" ")[0]
        anchor = date.fromisoformat(anchor_str)

        if today < anchor:
            return []

        total_days = (today - anchor).days
        today_week = total_days // 7
        today_on_boundary = total_days % 7 == 0

        options: list[WeekOption] = []

        # Today entry (always first)
        today_label = f"Week {today_week} · {today.strftime('%b %-d')} (Today)"
        options.append(
            WeekOption(
                week_number=today_week,
                day_offset=total_days,
                label=today_label,
                is_today=True,
            )
        )

        # Build set of week milestones to show below the Today entry.
        # All passed week boundaries (0 through today_week) as selectable milestones.
        # If today is on an exact boundary, that week is the Today entry — skip it.
        weeks_to_show: set[int] = set(range(0, today_week + 1))
        if today_on_boundary:
            weeks_to_show.discard(today_week)

        for week in sorted(weeks_to_show, reverse=True):
            week_date = anchor + timedelta(days=week * 7)
            label = f"Week {week} · {week_date.strftime('%b %-d')}"
            if week == 0:
                label += " (Priority Reg)"
            options.append(
                WeekOption(
                    week_number=week,
                    day_offset=week * 7,
                    label=label,
                    is_today=False,
                )
            )

        return options

    async def calculate_forecast(
        self,
        year: int = 2026,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
        day_offset: int | None = None,
        duration: str | None = None,
    ) -> ForecastResponse:
        """Calculate forecast for the given year.

        Args:
            year: The year to forecast.
            session_types: Session types to include (default: main, embedded, ag).
            session_cm_id: Filter to a specific session (AG children included).
            day_offset: Days since registration anchor. When set, compute enrollment
                at that offset using snapshots (preferred) or reconstruction.
                For prior years, always reconstructs at the same offset.
                When None, uses live attendee data (existing behavior).

        Returns:
            ForecastResponse with per-session and grand total data.
        """
        if session_types is None:
            session_types = ["main", "embedded", "ag", "quest"]

        # Fetch current year sessions
        sessions = await self.repository.fetch_sessions(year, session_types)

        # Filter sessions by duration category
        if duration:
            duration_session_ids = resolve_duration_sessions(sessions, duration)
            sessions = {sid: s for sid, s in sessions.items() if sid in duration_session_ids}

        # Historical day_offset mode: use snapshot or reconstruction for enrollment counts
        snapshot_counts: dict[int, dict[str, int | None]] | None = None
        reconstruction_counts: dict[int, int] | None = None
        if day_offset is not None:
            # Compute target date from registration anchor
            reg_dates = await self.repository.fetch_registration_dates(year)
            anchor_str = reg_dates.get("priority_reg_date") or reg_dates.get("early_reg_date") or ""
            if not anchor_str:
                raise ValueError(f"No registration anchor configured for {year}")
            season_start = datetime.strptime(anchor_str.split("T")[0].split(" ")[0], "%Y-%m-%d")
            anchor_date = date.fromisoformat(anchor_str.split("T")[0].split(" ")[0])
            target_camp_date = anchor_date + timedelta(days=day_offset)

            # Try camp-day-aligned snapshots first
            snapshot_counts = await self.repository.fetch_snapshot_counts_for_camp_day(year, target_camp_date)
            if not snapshot_counts:
                # No snapshot data — reconstruct from attendee records
                reconstruction_counts = await reconstruct_enrollment_at_offset(
                    self.repository, year, sessions, day_offset, season_start
                )
            enrolled_attendees: list[Any] = []
            waitlisted_attendees: list[Any] = []
            (budget_config,) = await asyncio.gather(
                self.repository.fetch_budget_config(year),
            )
        else:
            # Live mode: fetch all current-year data in parallel
            (
                enrolled_attendees,
                waitlisted_attendees,
                budget_config,
            ) = await asyncio.gather(
                self.repository.fetch_attendees(year),
                self.repository.fetch_attendees(year, status_filter="waitlisted"),
                self.repository.fetch_budget_config(year),
            )

        # Fetch prior year comparison data
        prior_counts, two_year_counts = await self._fetch_prior_year_counts(year, session_types, day_offset, duration)

        # Build AG parent map for session_cm_id filtering
        ag_parent_map = build_ag_parent_map(sessions)

        # Build per-session forecasts (AG sessions as separate rows)
        session_forecasts: list[SessionForecast] = []
        for sid, session in sessions.items():
            session_type = getattr(session, "session_type", "")

            # If filtering to specific session, include it + its AG children
            if session_cm_id is not None:
                if session_type == "ag":
                    parent_id = ag_parent_map.get(sid)
                    if parent_id != session_cm_id:
                        continue
                elif sid != session_cm_id:
                    continue

            # Each session counts only its own attendees (no AG merging)
            enrolled_boys: int | None = None
            enrolled_girls: int | None = None
            if snapshot_counts:
                sc = snapshot_counts.get(sid, {})
                enrolled = sc.get("enrolled", 0) or 0
                waitlisted = sc.get("waitlisted", 0) or 0
                enrolled_boys = sc.get("enrolled_boys")
                enrolled_girls = sc.get("enrolled_girls")
            elif reconstruction_counts is not None:
                enrolled = reconstruction_counts.get(sid, 0)
                waitlisted = 0  # Reconstruction doesn't distinguish waitlisted
            else:
                enrolled = self._count_attendees_for_session(enrolled_attendees, sid, set())
                waitlisted = self._count_attendees_for_session(waitlisted_attendees, sid, set())

            # Budget config
            budget = budget_config.get(sid, {})
            participant_goal = budget.get("participant_goal")
            session_fee = budget.get("session_fee")

            # Derived fields
            pct_of_goal = None
            if participant_goal and participant_goal > 0:
                pct_of_goal = round(enrolled / participant_goal * 100, 1)

            budget_revenue = None
            actual_revenue = None
            revenue_pct = None
            revenue_delta = None
            if participant_goal is not None and session_fee is not None:
                budget_revenue = participant_goal * session_fee
                actual_revenue = enrolled * session_fee
                revenue_delta = actual_revenue - budget_revenue
                if budget_revenue > 0:
                    revenue_pct = round(actual_revenue / budget_revenue * 100, 1)

            participants_vs_budget = enrolled - participant_goal if participant_goal is not None else None

            session_name = getattr(session, "name", "")
            canonical_name = resolve_session_alias(session_name)
            prior_year_count = prior_counts.get(canonical_name)
            two_year_prior_count = two_year_counts.get(canonical_name)
            participants_vs_prior_year = enrolled - prior_year_count if prior_year_count is not None else None

            session_forecasts.append(
                SessionForecast(
                    session_cm_id=sid,
                    session_name=session_name,
                    session_type=session_type,
                    participant_goal=participant_goal,
                    session_fee=session_fee,
                    enrolled=enrolled,
                    waitlisted=waitlisted,
                    pct_of_goal=pct_of_goal,
                    prior_year_count=prior_year_count,
                    two_year_prior_count=two_year_prior_count,
                    participants_vs_budget=participants_vs_budget,
                    participants_vs_prior_year=participants_vs_prior_year,
                    budget_revenue=budget_revenue,
                    actual_revenue=actual_revenue,
                    revenue_delta=revenue_delta,
                    revenue_pct=revenue_pct,
                    enrolled_boys=enrolled_boys,
                    enrolled_girls=enrolled_girls,
                )
            )

        # Grand total
        grand_total = self._compute_grand_total(session_forecasts)

        return ForecastResponse(
            year=year,
            sessions=session_forecasts,
            grand_total=grand_total,
            week_number=day_offset // 7 if day_offset is not None else None,
            day_offset=day_offset,
        )

    def _count_attendees_for_session(
        self,
        attendees: list[Any],
        session_cm_id: int,
        ag_children: set[int],
    ) -> int:
        """Count attendees for a session including AG children."""
        count = 0
        for a in attendees:
            session = get_session_from_expand(a)
            if not session:
                continue
            att_cm_id = getattr(session, "cm_id", None)
            if att_cm_id == session_cm_id or att_cm_id in ag_children:
                count += 1
        return count

    async def _fetch_prior_year_counts(
        self,
        year: int,
        session_types: list[str],
        day_offset: int | None,
        duration: str | None = None,
    ) -> tuple[dict[str, int], dict[str, int]]:
        """Fetch prior year and two-year-prior enrollment counts by canonical session name.

        When day_offset is set, uses reconstruction at the same offset relative to
        each prior year's own registration anchor. When None, uses live attendee data.

        Args:
            year: Current year.
            session_types: Session types to include.
            day_offset: Days since registration anchor, or None for live data.
            duration: Duration category filter (e.g., '1-week'). When set, only
                prior-year sessions matching this duration are included.

        Returns:
            Tuple of (prior_year_counts, two_year_prior_counts), each mapping
            canonical session name to enrolled count. Empty dicts on failure.
        """
        try:
            if day_offset is not None:
                return await self._reconstruct_prior_year_counts(year, session_types, day_offset, duration)
            else:
                return await self._fetch_live_prior_year_counts(year, session_types, duration)
        except Exception:
            logger.warning(
                "Failed to fetch prior year data, continuing without comparison",
                exc_info=True,
            )
            return {}, {}

    async def _fetch_live_prior_year_counts(
        self,
        year: int,
        session_types: list[str],
        duration: str | None = None,
    ) -> tuple[dict[str, int], dict[str, int]]:
        """Fetch prior year counts from live attendee data (existing behavior)."""
        prior_sessions, prior_attendees, two_year_sessions, two_year_attendees = await asyncio.gather(
            self.repository.fetch_sessions(year - 1, session_types),
            self.repository.fetch_attendees(year - 1),
            self.repository.fetch_sessions(year - 2, session_types),
            self.repository.fetch_attendees(year - 2),
        )

        # Filter prior-year sessions by duration category
        if duration:
            prior_duration_ids = resolve_duration_sessions(prior_sessions, duration)
            prior_sessions = {sid: s for sid, s in prior_sessions.items() if sid in prior_duration_ids}
            two_year_duration_ids = resolve_duration_sessions(two_year_sessions, duration)
            two_year_sessions = {sid: s for sid, s in two_year_sessions.items() if sid in two_year_duration_ids}

        prior_counts = self._count_by_session_name(prior_sessions, prior_attendees)
        two_year_counts = self._count_by_session_name(two_year_sessions, two_year_attendees)
        return prior_counts, two_year_counts

    async def _reconstruct_prior_year_counts(
        self,
        year: int,
        session_types: list[str],
        day_offset: int,
        duration: str | None = None,
    ) -> tuple[dict[str, int], dict[str, int]]:
        """Reconstruct prior year counts at the same day_offset using each year's anchor."""
        prior_counts: dict[str, int] = {}
        two_year_counts: dict[str, int] = {}

        for offset_years, target_counts in [(1, prior_counts), (2, two_year_counts)]:
            prior_year = year - offset_years
            try:
                prior_sessions = await self.repository.fetch_sessions(prior_year, session_types)
                if not prior_sessions:
                    continue

                # Filter prior-year sessions by duration category
                if duration:
                    dur_ids = resolve_duration_sessions(prior_sessions, duration)
                    prior_sessions = {sid: s for sid, s in prior_sessions.items() if sid in dur_ids}
                    if not prior_sessions:
                        continue

                prior_reg_dates = await self.repository.fetch_registration_dates(prior_year)
                prior_anchor_str = prior_reg_dates.get("priority_reg_date") or prior_reg_dates.get("early_reg_date")
                if not prior_anchor_str:
                    continue

                prior_season_start = datetime.strptime(prior_anchor_str.split("T")[0].split(" ")[0], "%Y-%m-%d")

                reconstructed = await reconstruct_enrollment_at_offset(
                    self.repository,
                    prior_year,
                    prior_sessions,
                    day_offset,
                    prior_season_start,
                    ag_parent_map=None,
                )

                # Convert cm_id → canonical name
                for cm_id, count in reconstructed.items():
                    session_obj = prior_sessions.get(cm_id)
                    if session_obj:
                        canonical = resolve_session_alias(getattr(session_obj, "name", ""))
                        if canonical:
                            target_counts[canonical] = target_counts.get(canonical, 0) + count
            except Exception:
                logger.warning(
                    "Failed to reconstruct %d-year-prior data, skipping",
                    offset_years,
                    exc_info=True,
                )

        return prior_counts, two_year_counts

    def _count_by_session_name(
        self,
        sessions: dict[int, Any],
        attendees: list[Any],
    ) -> dict[str, int]:
        """Count enrolled attendees by session name (each session uses its own name)."""
        cm_id_to_name: dict[int, str] = {}
        for sid, session in sessions.items():
            cm_id_to_name[sid] = resolve_session_alias(getattr(session, "name", ""))

        counts: dict[str, int] = {}
        for a in attendees:
            session = get_session_from_expand(a)
            if not session:
                continue
            att_cm_id: int | None = getattr(session, "cm_id", None)
            name = cm_id_to_name.get(att_cm_id, "") if att_cm_id is not None else ""
            if name:
                counts[name] = counts.get(name, 0) + 1
        return counts

    def _compute_grand_total(self, session_forecasts: list[SessionForecast]) -> SessionForecast:
        """Compute grand total across all sessions."""
        total_enrolled = sum(s.enrolled for s in session_forecasts)
        total_waitlisted = sum(s.waitlisted for s in session_forecasts)
        total_goal = sum(s.participant_goal or 0 for s in session_forecasts)
        total_prior = sum(s.prior_year_count or 0 for s in session_forecasts)
        total_two_year = sum(s.two_year_prior_count or 0 for s in session_forecasts)

        has_goal = any(s.participant_goal is not None for s in session_forecasts)
        has_prior = any(s.prior_year_count is not None for s in session_forecasts)
        has_two_year = any(s.two_year_prior_count is not None for s in session_forecasts)

        pct_of_goal = None
        if has_goal and total_goal > 0:
            pct_of_goal = round(total_enrolled / total_goal * 100, 1)

        # Delta fields from totals
        participants_vs_budget = total_enrolled - total_goal if has_goal else None
        participants_vs_prior_year = total_enrolled - total_prior if has_prior else None

        total_budget_rev = sum(s.budget_revenue or 0 for s in session_forecasts)
        total_actual_rev = sum(s.actual_revenue or 0 for s in session_forecasts)
        has_revenue = any(s.budget_revenue is not None for s in session_forecasts)
        revenue_delta = total_actual_rev - total_budget_rev if has_revenue else None
        revenue_pct = None
        if has_revenue and total_budget_rev > 0:
            revenue_pct = round(total_actual_rev / total_budget_rev * 100, 1)

        # Gender totals (null-aware)
        total_boys = sum(s.enrolled_boys or 0 for s in session_forecasts)
        total_girls = sum(s.enrolled_girls or 0 for s in session_forecasts)
        has_boys = any(s.enrolled_boys is not None for s in session_forecasts)
        has_girls = any(s.enrolled_girls is not None for s in session_forecasts)

        return SessionForecast(
            session_cm_id=0,
            session_name="Grand Total",
            session_type="total",
            participant_goal=total_goal if has_goal else None,
            session_fee=None,
            enrolled=total_enrolled,
            waitlisted=total_waitlisted,
            pct_of_goal=pct_of_goal,
            prior_year_count=total_prior if has_prior else None,
            two_year_prior_count=total_two_year if has_two_year else None,
            participants_vs_budget=participants_vs_budget,
            participants_vs_prior_year=participants_vs_prior_year,
            budget_revenue=total_budget_rev if has_revenue else None,
            actual_revenue=total_actual_rev if has_revenue else None,
            revenue_delta=revenue_delta,
            revenue_pct=revenue_pct,
            enrolled_boys=total_boys if has_boys else None,
            enrolled_girls=total_girls if has_girls else None,
        )
