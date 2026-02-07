"""Waitlist service - business logic for waitlist analysis metrics.

Implements four use cases:
- UC1: Currently waitlisted, no other enrolled summer sessions
- UC2: Currently waitlisted, has other enrolled summer sessions
- UC3: Previously waitlisted, accepted (now enrolled) - from status history
- UC4: Previously waitlisted, declined (cancelled/withdrawn/dismissed) - from status history
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import TYPE_CHECKING, Any

from api.schemas.metrics import (
    GenderBreakdown,
    GradeBreakdown,
    WaitlistEnrolledSessionCount,
    WaitlistMetricsResponse,
    WaitlistSessionBreakdown,
)

if TYPE_CHECKING:
    from .metrics_repository import MetricsRepository

logger = logging.getLogger(__name__)

# Summer session types to include in analysis
SUMMER_SESSION_TYPES = ("main", "embedded", "ag", "quest")

# Statuses that indicate a camper declined placement
DECLINED_STATUSES = ["cancelled", "withdrawn", "dismissed"]


class WaitlistService:
    """Business logic for waitlist analysis - fully testable with mocked repository."""

    def __init__(self, repository: MetricsRepository) -> None:
        self.repository = repository

    async def calculate_waitlist(
        self,
        year: int,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
    ) -> WaitlistMetricsResponse:
        """Calculate waitlist metrics for all four use cases.

        Args:
            year: The year to analyze.
            session_types: Optional session type filter (default: all summer).
            session_cm_id: Optional specific session filter.

        Returns:
            WaitlistMetricsResponse with summary counts and breakdowns.
        """
        # Fetch ALL sessions for enrollment lookup (cross-type visibility)
        all_sessions = await self.repository.fetch_sessions(year, list(SUMMER_SESSION_TYPES))

        # Fetch filtered sessions for waitlist display
        effective_types = session_types or list(SUMMER_SESSION_TYPES)
        if effective_types == list(SUMMER_SESSION_TYPES):
            filtered_sessions = all_sessions
        else:
            filtered_sessions = await self.repository.fetch_sessions(year, effective_types)

        # Build session cm_id set for filtering waitlisted attendees
        valid_session_ids = set(filtered_sessions.keys())
        if session_cm_id is not None:
            valid_session_ids = {sid for sid in valid_session_ids if sid == session_cm_id}

        # --- UC1 & UC2: Current waitlist ---
        waitlisted_attendees = await self.repository.fetch_attendees(year, status_filter="waitlisted")
        enrolled_attendees = await self.repository.fetch_attendees(year, status_filter="enrolled")

        # Filter waitlisted to selected session types, enrolled to ALL types
        waitlisted_attendees = self._filter_to_sessions(waitlisted_attendees, valid_session_ids)
        enrolled_attendees = self._filter_to_sessions(enrolled_attendees, set(all_sessions.keys()))

        # Build mapping: person_id -> list of (session_cm_id, session_name) they're enrolled in
        enrolled_sessions_by_person: dict[int, list[tuple[int, str]]] = defaultdict(list)
        for att in enrolled_attendees:
            pid = getattr(att, "person_id", None)
            if pid is not None:
                session_info = self._get_session_from_attendee(att)
                if session_info:
                    cmid = int(getattr(session_info, "cm_id", 0))
                    name = getattr(session_info, "name", f"Session {cmid}")
                    enrolled_sessions_by_person[int(pid)].append((cmid, name))
        enrolled_person_ids = set(enrolled_sessions_by_person.keys())

        # Partition waitlisted persons
        waitlisted_no_enrollment: list[dict[str, Any]] = []
        waitlisted_has_enrollment: list[dict[str, Any]] = []
        waitlisted_by_session: dict[int, dict[str, int]] = defaultdict(
            lambda: {"waitlisted": 0, "no_enrollment": 0, "has_enrollment": 0, "accepted": 0, "declined": 0}
        )
        # Track enrolled-in-session counts per waitlisted session
        # Key: waitlist_session_id -> {enrolled_session_id: count}
        enrolled_in_counts: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))

        # Per-session dedup for breakdown, global dedup for summary
        seen_per_session: dict[int, set[int]] = defaultdict(set)
        seen_for_summary: set[int] = set()
        for att in waitlisted_attendees:
            pid = int(getattr(att, "person_id", 0))
            session_info = self._get_session_from_attendee(att)
            session_cmid = getattr(session_info, "cm_id", 0) if session_info else 0

            if session_cmid:
                waitlisted_by_session[int(session_cmid)]["waitlisted"] += 1

                # Per-session dedup for breakdown counts
                if pid not in seen_per_session[int(session_cmid)]:
                    seen_per_session[int(session_cmid)].add(pid)
                    if pid in enrolled_person_ids:
                        waitlisted_by_session[int(session_cmid)]["has_enrollment"] += 1
                        for enrolled_sid, _enrolled_name in enrolled_sessions_by_person.get(pid, []):
                            enrolled_in_counts[int(session_cmid)][enrolled_sid] += 1
                    else:
                        waitlisted_by_session[int(session_cmid)]["no_enrollment"] += 1

            # Global dedup for summary counts
            if pid in seen_for_summary:
                continue
            seen_for_summary.add(pid)

            entry = {"person_id": pid, "session_cm_id": int(session_cmid)}
            if pid in enrolled_person_ids:
                waitlisted_has_enrollment.append(entry)
            else:
                waitlisted_no_enrollment.append(entry)

        # --- UC3 & UC4: Historical transitions ---
        accepted_history = await self.repository.fetch_status_history(
            year, old_status="waitlisted", new_statuses=["enrolled"]
        )
        declined_history = await self.repository.fetch_status_history(
            year, old_status="waitlisted", new_statuses=DECLINED_STATUSES
        )

        # Count accepted/declined (unique by person, filtered by session)
        accepted_persons: set[int] = set()
        for record in accepted_history:
            pid = int(getattr(record, "person_id", 0))
            if not pid:
                continue
            session_info = self._get_session_from_history(record)
            session_cmid = int(getattr(session_info, "cm_id", 0)) if session_info else 0
            if session_cmid and session_cmid not in valid_session_ids:
                continue
            accepted_persons.add(pid)
            if session_cmid:
                waitlisted_by_session[session_cmid]["accepted"] += 1

        declined_persons: set[int] = set()
        for record in declined_history:
            pid = int(getattr(record, "person_id", 0))
            if not pid:
                continue
            session_info = self._get_session_from_history(record)
            session_cmid = int(getattr(session_info, "cm_id", 0)) if session_info else 0
            if session_cmid and session_cmid not in valid_session_ids:
                continue
            declined_persons.add(pid)
            if session_cmid:
                waitlisted_by_session[session_cmid]["declined"] += 1

        # --- Build per-session breakdown ---
        by_session: list[WaitlistSessionBreakdown] = []
        for sid, counts in sorted(waitlisted_by_session.items()):
            session = filtered_sessions.get(sid)
            if session:
                # Build enrolled_in list for this waitlist session
                enrolled_in_list: list[WaitlistEnrolledSessionCount] = []
                for enrolled_sid, enrolled_count in sorted(enrolled_in_counts.get(sid, {}).items()):
                    enrolled_session = all_sessions.get(enrolled_sid)
                    enrolled_name = (
                        getattr(enrolled_session, "name", f"Session {enrolled_sid}")
                        if enrolled_session
                        else f"Session {enrolled_sid}"
                    )
                    enrolled_in_list.append(
                        WaitlistEnrolledSessionCount(
                            session_cm_id=enrolled_sid,
                            session_name=enrolled_name,
                            count=enrolled_count,
                        )
                    )

                by_session.append(
                    WaitlistSessionBreakdown(
                        session_cm_id=sid,
                        session_name=getattr(session, "name", f"Session {sid}"),
                        waitlisted=counts["waitlisted"],
                        no_enrollment=counts["no_enrollment"],
                        has_enrollment=counts["has_enrollment"],
                        accepted=counts["accepted"],
                        declined=counts["declined"],
                        enrolled_in=enrolled_in_list,
                    )
                )

        # --- Build grade/gender breakdowns from waitlisted persons ---
        persons = await self.repository.fetch_persons(year)
        all_waitlisted_pids = seen_for_summary
        by_grade, by_gender = self._compute_demographics(all_waitlisted_pids, persons)

        total_waitlisted = len(seen_for_summary)

        return WaitlistMetricsResponse(
            year=year,
            total_waitlisted=total_waitlisted,
            waitlisted_no_enrollment=len(waitlisted_no_enrollment),
            waitlisted_has_enrollment=len(waitlisted_has_enrollment),
            total_accepted=len(accepted_persons),
            total_declined=len(declined_persons),
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
            session = self._get_session_from_attendee(att)
            if session:
                session_cmid = int(getattr(session, "cm_id", 0))
                if session_cmid in valid_session_ids:
                    result.append(att)
        return result

    def _get_session_from_attendee(self, attendee: Any) -> Any:
        """Extract session from attendee's expand dict."""
        expand = getattr(attendee, "expand", {}) or {}
        if isinstance(expand, dict):
            return expand.get("session")
        return getattr(expand, "session", None)

    def _get_session_from_history(self, record: Any) -> Any:
        """Extract session from status history record's expand dict."""
        expand = getattr(record, "expand", {}) or {}
        if isinstance(expand, dict):
            return expand.get("session")
        return getattr(expand, "session", None)

    def _compute_demographics(
        self,
        person_ids: set[int],
        persons: dict[int, Any],
    ) -> tuple[list[GradeBreakdown], list[GenderBreakdown]]:
        """Compute grade and gender breakdowns for a set of person IDs."""
        total = len(person_ids)
        if total == 0:
            return [], []

        grade_counts: dict[int | None, int] = defaultdict(int)
        gender_counts: dict[str, int] = defaultdict(int)

        for pid in person_ids:
            person = persons.get(pid)
            if person:
                grade = getattr(person, "grade", None)
                gender = getattr(person, "gender", None) or "Unknown"
                grade_counts[grade] += 1
                gender_counts[gender] += 1

        by_grade = [
            GradeBreakdown(
                grade=g,
                count=c,
                percentage=round(c / total * 100, 1) if total > 0 else 0.0,
            )
            for g, c in sorted(grade_counts.items(), key=lambda x: (x[0] is None, x[0]))
        ]
        by_gender = [
            GenderBreakdown(
                gender=g,
                count=c,
                percentage=round(c / total * 100, 1) if total > 0 else 0.0,
            )
            for g, c in sorted(gender_counts.items())
        ]

        return by_grade, by_gender
