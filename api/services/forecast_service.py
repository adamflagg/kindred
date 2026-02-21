"""Forecast service - budget goals, capacity, and revenue projections.

Computes per-session enrollment vs budget goals, prior year comparison,
capacity from bunk plans, and revenue projections.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

from api.schemas.forecast import ForecastResponse, SessionForecast
from api.utils.session_metrics import (
    build_ag_parent_map,
    find_ag_sessions_for_parent,
    get_session_from_expand,
)

if TYPE_CHECKING:
    from api.services.metrics_repository import MetricsRepository

logger = logging.getLogger(__name__)


class ForecastService:
    """Compute session enrollment forecasts with budget and revenue projections."""

    def __init__(self, repository: MetricsRepository) -> None:
        self.repository = repository

    async def calculate_forecast(
        self,
        year: int = 2026,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
    ) -> ForecastResponse:
        """Calculate forecast for the given year.

        Args:
            year: The year to forecast.
            session_types: Session types to include (default: main, embedded, ag).
            session_cm_id: Filter to a specific session (AG children included).

        Returns:
            ForecastResponse with per-session and grand total data.
        """
        if session_types is None:
            session_types = ["main", "embedded", "ag"]

        # Fetch current year sessions
        sessions = await self.repository.fetch_sessions(year, session_types)

        # Parallel fetches: enrolled, waitlisted, bunk_plans, capacity config, budget config
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
        prior_sessions, prior_attendees, two_year_sessions, two_year_attendees = await asyncio.gather(
            self.repository.fetch_sessions(year - 1, session_types),
            self.repository.fetch_attendees(year - 1),
            self.repository.fetch_sessions(year - 2, session_types),
            self.repository.fetch_attendees(year - 2),
        )

        # Build prior year AG maps
        prior_ag_map = build_ag_parent_map(prior_sessions)
        two_year_ag_map = build_ag_parent_map(two_year_sessions)

        # Build name-to-count maps for prior years
        prior_counts = self._count_by_session_name(prior_sessions, prior_attendees, prior_ag_map)
        two_year_counts = self._count_by_session_name(two_year_sessions, two_year_attendees, two_year_ag_map)

        # Build per-session forecasts (skip AG sessions - they merge into parent)
        session_forecasts: list[SessionForecast] = []
        for sid, session in sessions.items():
            session_type = getattr(session, "session_type", "")
            if session_type == "ag":
                continue  # AG merges into parent

            # If filtering to specific session, skip others
            if session_cm_id is not None and sid != session_cm_id:
                continue

            ag_children = find_ag_sessions_for_parent(sessions, sid)

            # Count enrolled and waitlisted
            enrolled = self._count_attendees_for_session(enrolled_attendees, sid, ag_children)
            waitlisted = self._count_attendees_for_session(waitlisted_attendees, sid, ag_children)

            # Count bunk plans for this session's PB id (and AG children)
            session_pb_id = getattr(session, "id", None)
            ag_pb_ids = set()
            for ag_id in ag_children:
                ag_session = sessions.get(ag_id)
                if ag_session:
                    ag_pb_ids.add(getattr(ag_session, "id", None))

            bunk_plan_count = sum(
                1
                for bp in bunk_plans
                if getattr(bp, "session", None) == session_pb_id or getattr(bp, "session", None) in ag_pb_ids
            )
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
            if participant_goal is not None and session_fee is not None:
                budget_revenue = participant_goal * session_fee
                actual_revenue = enrolled * session_fee
                if budget_revenue > 0:
                    revenue_pct = round(actual_revenue / budget_revenue * 100, 1)

            session_name = getattr(session, "name", "")
            prior_year_count = prior_counts.get(session_name)
            two_year_prior_count = two_year_counts.get(session_name)

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
                    budget_revenue=budget_revenue,
                    actual_revenue=actual_revenue,
                    revenue_pct=revenue_pct,
                )
            )

        # Grand total
        grand_total = self._compute_grand_total(session_forecasts)

        return ForecastResponse(
            year=year,
            sessions=session_forecasts,
            grand_total=grand_total,
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
        ag_parent_map: dict[int, int],
    ) -> dict[str, int]:
        """Count enrolled attendees by session name, merging AG into parent."""
        cm_id_to_name: dict[int, str] = {}
        for sid, session in sessions.items():
            session_type = getattr(session, "session_type", "")
            if session_type == "ag":
                parent_id = ag_parent_map.get(sid)
                if parent_id and parent_id in sessions:
                    cm_id_to_name[sid] = getattr(sessions[parent_id], "name", "")
            else:
                cm_id_to_name[sid] = getattr(session, "name", "")

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
            budget_revenue=None,
            actual_revenue=None,
            revenue_pct=None,
        )
