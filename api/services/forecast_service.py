"""Forecast service - budget goals, capacity, and revenue projections.

Computes per-session enrollment vs budget goals, prior year comparison,
capacity from bunk plans, and revenue projections.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from api.schemas.forecast import ForecastResponse, SessionForecast
from api.utils.session_aliases import resolve_session_alias
from api.utils.session_metrics import (
    build_ag_parent_map,
    get_session_from_expand,
)

if TYPE_CHECKING:
    from api.services.metrics_repository import MetricsRepository

logger = logging.getLogger(__name__)


class ForecastService:
    """Compute session enrollment forecasts with budget and revenue projections."""

    def __init__(self, repository: MetricsRepository) -> None:
        self.repository = repository

    async def get_filtered_snapshot_dates(self, year: int) -> list[str]:
        """Return snapshot dates filtered to registration anchor + subsequent Mondays.

        Dates are filtered to:
        1. The registration anchor date (priority_reg_date or early_reg_date)
        2. Every subsequent Monday
        3. Capped at July 31 of the camp year
        4. Only dates that have actual snapshot data

        Returns dates sorted descending (newest first).
        """
        from datetime import date, timedelta

        reg_dates = await self.repository.fetch_registration_dates(year)

        # Find anchor date
        anchor_str = reg_dates.get("priority_reg_date") or reg_dates.get("early_reg_date")
        if not anchor_str:
            return []
        anchor_str = anchor_str.split("T")[0].split(" ")[0]
        anchor = date.fromisoformat(anchor_str)

        # Cap at July 31 of the camp year
        cap = date(year, 7, 31)

        # Build set of valid dates: anchor + every Monday from first Monday after anchor through cap
        valid_dates: set[str] = {anchor_str}
        # Find first Monday after anchor (if anchor is Monday, start from next week)
        days_until_monday = (7 - anchor.weekday()) % 7
        if days_until_monday == 0:
            next_monday = anchor + timedelta(days=7)
        else:
            next_monday = anchor + timedelta(days=days_until_monday)

        current = next_monday
        while current <= cap:
            valid_dates.add(current.isoformat())
            current += timedelta(days=7)

        # Intersect with actual snapshot dates
        all_dates = await self.repository.fetch_available_snapshot_dates(year)
        return [d for d in all_dates if d in valid_dates]

    async def calculate_forecast(
        self,
        year: int = 2026,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
        snapshot_date: str | None = None,
    ) -> ForecastResponse:
        """Calculate forecast for the given year.

        Args:
            year: The year to forecast.
            session_types: Session types to include (default: main, embedded, ag).
            session_cm_id: Filter to a specific session (AG children included).
            snapshot_date: If set, use historical snapshot counts instead of live data.

        Returns:
            ForecastResponse with per-session and grand total data.
        """
        if session_types is None:
            session_types = ["main", "embedded", "ag", "quest"]

        # Fetch current year sessions
        sessions = await self.repository.fetch_sessions(year, session_types)

        # Historical snapshot mode: use snapshot counts instead of live attendee data
        snapshot_counts: dict[int, dict[str, int]] | None = None
        if snapshot_date is not None:
            # Snapshot mode: skip current-year attendee fetches (counts come from snapshot)
            snapshot_counts = await self.repository.fetch_snapshot_counts(year, snapshot_date)
            enrolled_attendees: list[Any] = []
            waitlisted_attendees: list[Any] = []
            bunk_plans, default_capacity, budget_config = await asyncio.gather(
                self.repository.fetch_bunk_plans(year),
                self.repository.fetch_capacity_config(),
                self.repository.fetch_budget_config(year),
            )
        else:
            # Live mode: fetch all current-year data in parallel
            (
                enrolled_attendees,
                waitlisted_attendees,
                bunk_plans,
                default_capacity,
                budget_config,
            ) = await asyncio.gather(
                self.repository.fetch_attendees(year),
                self.repository.fetch_attendees(year, status_filter="waitlisted"),
                self.repository.fetch_bunk_plans(year),
                self.repository.fetch_capacity_config(),
                self.repository.fetch_budget_config(year),
            )

        # Fetch prior year and two-year-prior data in parallel
        # These are "nice to have" — failures degrade gracefully (show "---" instead)
        try:
            prior_sessions, prior_attendees, two_year_sessions, two_year_attendees = await asyncio.gather(
                self.repository.fetch_sessions(year - 1, session_types),
                self.repository.fetch_attendees(year - 1),
                self.repository.fetch_sessions(year - 2, session_types),
                self.repository.fetch_attendees(year - 2),
            )
        except Exception:
            logger.warning(
                "Failed to fetch prior year data, continuing without comparison",
                exc_info=True,
            )
            prior_sessions, prior_attendees = {}, []
            two_year_sessions, two_year_attendees = {}, []

        # Build name-to-count maps for prior years
        prior_counts = self._count_by_session_name(prior_sessions, prior_attendees)
        two_year_counts = self._count_by_session_name(two_year_sessions, two_year_attendees)

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
            if snapshot_counts is not None:
                sc = snapshot_counts.get(sid, {})
                enrolled = sc.get("enrolled", 0)
                waitlisted = sc.get("waitlisted", 0)
            else:
                enrolled = self._count_attendees_for_session(enrolled_attendees, sid, set())
                waitlisted = self._count_attendees_for_session(waitlisted_attendees, sid, set())

            # Count bunk plans for this session only (no AG merging)
            session_pb_id = getattr(session, "id", None)

            bunk_plan_count = sum(1 for bp in bunk_plans if getattr(bp, "session", None) == session_pb_id)
            capacity = bunk_plan_count * default_capacity if bunk_plan_count > 0 else None

            # Budget config
            budget = budget_config.get(sid, {})
            participant_goal = budget.get("participant_goal")
            session_fee = budget.get("session_fee")

            # Derived fields
            pct_of_goal = None
            if participant_goal and participant_goal > 0:
                pct_of_goal = round(enrolled / participant_goal * 100, 1)

            utilization_pct = None
            if capacity and capacity > 0:
                utilization_pct = round(enrolled / capacity * 100, 1)

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
                    capacity=capacity,
                    utilization_pct=utilization_pct,
                    participants_vs_budget=participants_vs_budget,
                    participants_vs_prior_year=participants_vs_prior_year,
                    budget_revenue=budget_revenue,
                    actual_revenue=actual_revenue,
                    revenue_delta=revenue_delta,
                    revenue_pct=revenue_pct,
                )
            )

        # Grand total
        grand_total = self._compute_grand_total(session_forecasts)

        return ForecastResponse(
            year=year,
            sessions=session_forecasts,
            grand_total=grand_total,
            snapshot_date=snapshot_date,
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
        total_capacity = sum(s.capacity or 0 for s in session_forecasts)
        total_goal = sum(s.participant_goal or 0 for s in session_forecasts)
        total_prior = sum(s.prior_year_count or 0 for s in session_forecasts)
        total_two_year = sum(s.two_year_prior_count or 0 for s in session_forecasts)

        has_capacity = any(s.capacity is not None for s in session_forecasts)
        has_goal = any(s.participant_goal is not None for s in session_forecasts)
        has_prior = any(s.prior_year_count is not None for s in session_forecasts)
        has_two_year = any(s.two_year_prior_count is not None for s in session_forecasts)

        pct_of_goal = None
        if has_goal and total_goal > 0:
            pct_of_goal = round(total_enrolled / total_goal * 100, 1)

        utilization_pct = None
        if has_capacity and total_capacity > 0:
            utilization_pct = round(total_enrolled / total_capacity * 100, 1)

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
            capacity=total_capacity if has_capacity else None,
            utilization_pct=utilization_pct,
            participants_vs_budget=participants_vs_budget,
            participants_vs_prior_year=participants_vs_prior_year,
            budget_revenue=total_budget_rev if has_revenue else None,
            actual_revenue=total_actual_rev if has_revenue else None,
            revenue_delta=revenue_delta,
            revenue_pct=revenue_pct,
        )
