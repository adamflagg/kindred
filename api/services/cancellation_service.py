"""Cancellation service - business logic for cancellation analysis metrics.

Analyzes cancelled/withdrawn/dismissed attendees to understand:
- Whether they were enrolled or waitlisted before cancelling
- Whether they still attend camp in other sessions
- Recovery rate (re-enrolled after cancellation)
- Demographics breakdowns with was_enrolled/was_waitlisted splits
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import TYPE_CHECKING, Any

from api.schemas.metrics import (
    CancellationMetricsResponse,
    CancellationSessionBreakdown,
    GenderBreakdown,
    GradeBreakdown,
)
from api.services.breakdown_calculator import calculate_percentage, compute_registration_breakdown
from api.services.extractors import extract_gender, extract_grade
from api.utils.session_metrics import build_ag_parent_map, get_session_from_expand

if TYPE_CHECKING:
    from .metrics_repository import MetricsRepository

logger = logging.getLogger(__name__)

# Summer session types to include in analysis
SUMMER_SESSION_TYPES = ("main", "embedded", "ag", "quest")

# Statuses that indicate cancellation
CANCELLED_STATUSES = ["cancelled", "withdrawn", "dismissed"]


class CancellationService:
    """Business logic for cancellation analysis - fully testable with mocked repository."""

    def __init__(self, repository: MetricsRepository) -> None:
        self.repository = repository

    async def calculate_cancellations(
        self,
        year: int,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
    ) -> CancellationMetricsResponse:
        """Calculate cancellation metrics.

        Args:
            year: The year to analyze.
            session_types: Optional session type filter (default: all summer).
            session_cm_id: Optional specific session filter.

        Returns:
            CancellationMetricsResponse with summary counts and breakdowns.
        """
        # Fetch ALL sessions for enrollment lookup (cross-type visibility)
        all_sessions = await self.repository.fetch_sessions(year, list(SUMMER_SESSION_TYPES))

        # Fetch filtered sessions for display
        effective_types = session_types or list(SUMMER_SESSION_TYPES)
        if effective_types == list(SUMMER_SESSION_TYPES):
            filtered_sessions = all_sessions
        else:
            filtered_sessions = await self.repository.fetch_sessions(year, effective_types)

        # Build session cm_id set for filtering
        valid_session_ids = set(filtered_sessions.keys())
        if session_cm_id is not None:
            valid_session_ids = {sid for sid in valid_session_ids if sid == session_cm_id}

        # --- Fetch cancelled and enrolled attendees ---
        cancelled_attendees = await self.repository.fetch_attendees(year, status_filter=CANCELLED_STATUSES)
        enrolled_attendees = await self.repository.fetch_attendees(year, status_filter="enrolled")

        # Filter cancelled to selected sessions, enrolled to ALL session types
        cancelled_attendees = self._filter_to_sessions(cancelled_attendees, valid_session_ids)
        enrolled_attendees = self._filter_to_sessions(enrolled_attendees, set(all_sessions.keys()))

        # Build enrolled person set
        enrolled_person_ids: set[int] = set()
        for att in enrolled_attendees:
            pid = getattr(att, "person_id", None)
            if pid is not None:
                enrolled_person_ids.add(int(pid))

        # --- Fetch status history for was_enrolled / was_waitlisted ---
        enrolled_to_cancelled = await self.repository.fetch_status_history(
            year, old_status="enrolled", new_statuses=CANCELLED_STATUSES
        )
        waitlisted_to_cancelled = await self.repository.fetch_status_history(
            year, old_status="waitlisted", new_statuses=CANCELLED_STATUSES
        )

        # Build per-person and per-session lookup for was_enrolled / was_waitlisted
        was_enrolled_persons: set[int] = set()
        was_waitlisted_persons: set[int] = set()
        was_enrolled_by_session: dict[int, set[int]] = defaultdict(set)
        was_waitlisted_by_session: dict[int, set[int]] = defaultdict(set)

        for record in enrolled_to_cancelled:
            pid = int(getattr(record, "person_id", 0))
            if not pid:
                continue
            session_info = get_session_from_expand(record)
            session_cmid = int(getattr(session_info, "cm_id", 0)) if session_info else 0
            was_enrolled_persons.add(pid)
            if session_cmid:
                was_enrolled_by_session[session_cmid].add(pid)

        for record in waitlisted_to_cancelled:
            pid = int(getattr(record, "person_id", 0))
            if not pid:
                continue
            session_info = get_session_from_expand(record)
            session_cmid = int(getattr(session_info, "cm_id", 0)) if session_info else 0
            was_waitlisted_persons.add(pid)
            if session_cmid:
                was_waitlisted_by_session[session_cmid].add(pid)

        # --- Fetch re-enrolled (cancelled -> enrolled) ---
        re_enrolled_history = await self.repository.fetch_status_history(
            year, old_status="cancelled", new_statuses=["enrolled"]
        )
        re_enrolled_persons: set[int] = set()
        for record in re_enrolled_history:
            pid = int(getattr(record, "person_id", 0))
            if pid:
                re_enrolled_persons.add(pid)

        # --- Partition cancelled persons ---
        cancelled_by_session: dict[int, dict[str, int]] = defaultdict(
            lambda: {
                "total_cancelled": 0,
                "was_enrolled": 0,
                "was_waitlisted": 0,
                "has_other_sessions": 0,
                "no_other_sessions": 0,
            }
        )

        seen_per_session: dict[int, set[int]] = defaultdict(set)
        seen_for_summary: set[int] = set()
        summary_has_other: int = 0
        summary_no_other: int = 0

        for att in cancelled_attendees:
            pid = int(getattr(att, "person_id", 0))
            session_info = get_session_from_expand(att)
            session_cmid = int(getattr(session_info, "cm_id", 0)) if session_info else 0

            if session_cmid:
                # Per-session counting (no cross-session dedup)
                if pid not in seen_per_session[session_cmid]:
                    seen_per_session[session_cmid].add(pid)
                    cancelled_by_session[session_cmid]["total_cancelled"] += 1

                    if pid in was_enrolled_by_session.get(session_cmid, set()):
                        cancelled_by_session[session_cmid]["was_enrolled"] += 1
                    elif pid in was_waitlisted_by_session.get(session_cmid, set()):
                        cancelled_by_session[session_cmid]["was_waitlisted"] += 1

                    if pid in enrolled_person_ids:
                        cancelled_by_session[session_cmid]["has_other_sessions"] += 1
                    else:
                        cancelled_by_session[session_cmid]["no_other_sessions"] += 1

            # Global dedup for summary
            if pid in seen_for_summary:
                continue
            seen_for_summary.add(pid)

            if pid in enrolled_person_ids:
                summary_has_other += 1
            else:
                summary_no_other += 1

        # --- Merge AG session counts into parent ---
        ag_parent_map = build_ag_parent_map(filtered_sessions)
        merged_by_session: dict[int, dict[str, int]] = {}

        for sid, counts in cancelled_by_session.items():
            target_sid = ag_parent_map.get(sid, sid)
            if target_sid not in merged_by_session:
                merged_by_session[target_sid] = {
                    "total_cancelled": 0,
                    "was_enrolled": 0,
                    "was_waitlisted": 0,
                    "has_other_sessions": 0,
                    "no_other_sessions": 0,
                }
            for key in (
                "total_cancelled",
                "was_enrolled",
                "was_waitlisted",
                "has_other_sessions",
                "no_other_sessions",
            ):
                merged_by_session[target_sid][key] += counts[key]

        # --- Build per-session breakdown ---
        by_session: list[CancellationSessionBreakdown] = []
        for sid, counts in sorted(merged_by_session.items()):
            session = filtered_sessions.get(sid)
            if session:
                by_session.append(
                    CancellationSessionBreakdown(
                        session_cm_id=sid,
                        session_name=getattr(session, "name", f"Session {sid}"),
                        total_cancelled=counts["total_cancelled"],
                        was_enrolled=counts["was_enrolled"],
                        was_waitlisted=counts["was_waitlisted"],
                        has_other_sessions=counts["has_other_sessions"],
                        no_other_sessions=counts["no_other_sessions"],
                    )
                )

        # --- Build demographics ---
        persons = await self.repository.fetch_persons(year)
        by_grade, by_gender = self._compute_demographics(
            seen_for_summary, persons, was_enrolled_persons, was_waitlisted_persons
        )

        # Summary counts for was_enrolled/was_waitlisted (unique persons)
        summary_was_enrolled = len(was_enrolled_persons & seen_for_summary)
        summary_was_waitlisted = len(was_waitlisted_persons & seen_for_summary)

        return CancellationMetricsResponse(
            year=year,
            total_cancelled=len(seen_for_summary),
            was_enrolled=summary_was_enrolled,
            was_waitlisted=summary_was_waitlisted,
            has_other_sessions=summary_has_other,
            no_other_sessions=summary_no_other,
            total_re_enrolled=len(re_enrolled_persons),
            by_session=by_session,
            by_grade=by_grade,
            by_gender=by_gender,
        )

    def _filter_to_sessions(
        self,
        attendees: list[Any],
        valid_session_ids: set[int],
    ) -> list[Any]:
        """Filter attendees to only those in valid sessions."""
        result = []
        for att in attendees:
            session = get_session_from_expand(att)
            if session:
                session_cmid = int(getattr(session, "cm_id", 0))
                if session_cmid in valid_session_ids:
                    result.append(att)
        return result

    def _compute_demographics(
        self,
        person_ids: set[int],
        persons: dict[int, Any],
        was_enrolled_persons: set[int],
        was_waitlisted_persons: set[int],
    ) -> tuple[list[GradeBreakdown], list[GenderBreakdown]]:
        """Compute grade and gender breakdowns with was_enrolled/was_waitlisted splits."""
        total = len(person_ids)
        if total == 0:
            return [], []

        # Build per-category enrollment splits
        grade_split: dict[int | None, tuple[int, int]] = {}
        gender_split: dict[str, tuple[int, int]] = {}

        for pid in person_ids:
            person = persons.get(pid)
            if not person:
                continue
            grade = extract_grade(person)
            gender = extract_gender(person)
            is_was_enrolled = pid in was_enrolled_persons
            is_was_waitlisted = pid in was_waitlisted_persons

            g_enrolled, g_waitlisted = grade_split.get(grade, (0, 0))
            grade_split[grade] = (
                g_enrolled + (1 if is_was_enrolled else 0),
                g_waitlisted + (1 if is_was_waitlisted else 0),
            )

            gn_enrolled, gn_waitlisted = gender_split.get(gender, (0, 0))
            gender_split[gender] = (
                gn_enrolled + (1 if is_was_enrolled else 0),
                gn_waitlisted + (1 if is_was_waitlisted else 0),
            )

        grade_stats = compute_registration_breakdown(person_ids, persons, extract_grade)
        by_grade = [
            GradeBreakdown(
                grade=g,
                count=s.count,
                percentage=round(calculate_percentage(s.count, total), 1),
                was_enrolled=grade_split.get(g, (0, 0))[0],
                was_waitlisted=grade_split.get(g, (0, 0))[1],
            )
            for g, s in sorted(grade_stats.items(), key=lambda x: (x[0] is None, x[0]))
        ]

        gender_stats = compute_registration_breakdown(person_ids, persons, extract_gender)
        by_gender = [
            GenderBreakdown(
                gender=g,
                count=s.count,
                percentage=round(calculate_percentage(s.count, total), 1),
                was_enrolled=gender_split.get(g, (0, 0))[0],
                was_waitlisted=gender_split.get(g, (0, 0))[1],
            )
            for g, s in sorted(gender_stats.items())
        ]

        return by_grade, by_gender
