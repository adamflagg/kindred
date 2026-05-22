"""Waitlist service - business logic for waitlist analysis metrics.

Implements four use cases:
- UC1: Currently waitlisted, no other enrolled summer sessions
- UC2: Currently waitlisted, has other enrolled summer sessions
- UC3: Previously waitlisted, accepted (now enrolled) - from status history
- UC4: Previously waitlisted, declined (cancelled/withdrawn/dismissed) - from status history
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import TYPE_CHECKING, Any

from api.schemas.metrics import (
    GenderBreakdown,
    GradeBreakdown,
    WaitlistEnrolledSessionCount,
    WaitlistMetricsResponse,
    WaitlistSessionBreakdown,
)
from api.services.breakdown_calculator import calculate_percentage, compute_registration_breakdown
from api.services.extractors import extract_gender, extract_grade
from api.utils.session_metrics import (
    DEFAULT_SUMMER_SESSION_TYPES,
    build_ag_parent_map,
    get_session_from_expand,
    resolve_duration_sessions,
)
from bunking.logging_config import get_logger

# Back-compat alias as an explicit module export (shared default lives in session_metrics).
SUMMER_SESSION_TYPES = DEFAULT_SUMMER_SESSION_TYPES

if TYPE_CHECKING:
    from .metrics_repository import MetricsRepository

logger = get_logger(__name__)

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
        duration: str | None = None,
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
        if duration:
            duration_session_ids = resolve_duration_sessions(filtered_sessions, duration)
            valid_session_ids = valid_session_ids & duration_session_ids

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
                session_info = get_session_from_expand(att)
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
            session_info = get_session_from_expand(att)
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
            session_info = get_session_from_expand(record)
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
            session_info = get_session_from_expand(record)
            session_cmid = int(getattr(session_info, "cm_id", 0)) if session_info else 0
            if session_cmid and session_cmid not in valid_session_ids:
                continue
            declined_persons.add(pid)
            if session_cmid:
                waitlisted_by_session[session_cmid]["declined"] += 1

        # --- Waitlist duration tracking ---
        # Fetch cancelled attendees so declined persons appear in duration lookup
        cancelled_attendees = await self.repository.fetch_attendees(
            year, status_filter=["cancelled", "withdrawn", "dismissed"]
        )
        cancelled_attendees = self._filter_to_sessions(cancelled_attendees, set(all_sessions.keys()))

        # Build attendee lookup by person_id for date access
        all_fetched_attendees = waitlisted_attendees + enrolled_attendees + cancelled_attendees
        attendee_by_person: dict[int, Any] = {}
        for att in all_fetched_attendees:
            pid = getattr(att, "person_id", None)
            if pid is not None:
                attendee_by_person[int(pid)] = att

        acceptance_duration = self._compute_waitlist_duration(accepted_persons, attendee_by_person)
        decline_duration = self._compute_waitlist_duration(declined_persons, attendee_by_person)

        # --- Merge AG session counts into parent main sessions ---
        ag_parent_map = build_ag_parent_map(filtered_sessions)
        merged_by_session: dict[int, dict[str, int]] = {}
        merged_enrolled_in: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))

        for sid, counts in waitlisted_by_session.items():
            target_sid = ag_parent_map.get(sid, sid)
            if target_sid not in merged_by_session:
                merged_by_session[target_sid] = {
                    "waitlisted": 0,
                    "no_enrollment": 0,
                    "has_enrollment": 0,
                    "accepted": 0,
                    "declined": 0,
                }
            for key in ("waitlisted", "no_enrollment", "has_enrollment", "accepted", "declined"):
                merged_by_session[target_sid][key] += counts[key]
            # Merge enrolled_in counts
            for enrolled_sid, enrolled_count in enrolled_in_counts.get(sid, {}).items():
                merged_enrolled_in[target_sid][enrolled_sid] += enrolled_count

        # --- Build per-session breakdown ---
        by_session: list[WaitlistSessionBreakdown] = []
        for sid, counts in sorted(merged_by_session.items()):
            session = filtered_sessions.get(sid)
            if session:
                # Build enrolled_in list for this waitlist session
                enrolled_in_list: list[WaitlistEnrolledSessionCount] = []
                for enrolled_sid, enrolled_count in sorted(merged_enrolled_in.get(sid, {}).items()):
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
        by_grade, by_gender = self._compute_demographics(all_waitlisted_pids, persons, enrolled_person_ids)

        total_waitlisted = len(seen_for_summary)

        return WaitlistMetricsResponse(
            year=year,
            total_waitlisted=total_waitlisted,
            waitlisted_no_enrollment=len(waitlisted_no_enrollment),
            waitlisted_has_enrollment=len(waitlisted_has_enrollment),
            total_accepted=len(accepted_persons),
            total_declined=len(declined_persons),
            avg_days_to_acceptance=acceptance_duration["avg"],
            median_days_to_acceptance=acceptance_duration["median"],
            avg_days_to_decline=decline_duration["avg"],
            median_days_to_decline=decline_duration["median"],
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
        enrolled_person_ids: set[int] | None = None,
    ) -> tuple[list[GradeBreakdown], list[GenderBreakdown]]:
        """Compute grade and gender breakdowns for a set of person IDs.

        When enrolled_person_ids is provided, each bucket is split into
        no_enrollment / has_enrollment counts for waitlist visualization.
        """
        total = len(person_ids)
        if total == 0:
            return [], []

        # Build per-category enrollment splits
        grade_enrollment: dict[int | None, tuple[int, int]] = {}
        gender_enrollment: dict[str, tuple[int, int]] = {}
        if enrolled_person_ids is not None:
            for pid in person_ids:
                person = persons.get(pid)
                if not person:
                    continue
                grade = extract_grade(person)
                gender = extract_gender(person)
                has_enroll = pid in enrolled_person_ids

                g_no, g_has = grade_enrollment.get(grade, (0, 0))
                grade_enrollment[grade] = (g_no + (0 if has_enroll else 1), g_has + (1 if has_enroll else 0))

                gn_no, gn_has = gender_enrollment.get(gender, (0, 0))
                gender_enrollment[gender] = (gn_no + (0 if has_enroll else 1), gn_has + (1 if has_enroll else 0))

        grade_stats = compute_registration_breakdown(person_ids, persons, extract_grade)
        by_grade = [
            GradeBreakdown(
                grade=g,
                count=s.count,
                percentage=round(calculate_percentage(s.count, total), 1),
                no_enrollment=grade_enrollment.get(g, (0, 0))[0],
                has_enrollment=grade_enrollment.get(g, (0, 0))[1],
            )
            for g, s in sorted(grade_stats.items(), key=lambda x: (x[0] is None, x[0]))
        ]

        gender_stats = compute_registration_breakdown(person_ids, persons, extract_gender)
        by_gender = [
            GenderBreakdown(
                gender=g,
                count=s.count,
                percentage=round(calculate_percentage(s.count, total), 1),
                no_enrollment=gender_enrollment.get(g, (0, 0))[0],
                has_enrollment=gender_enrollment.get(g, (0, 0))[1],
            )
            for g, s in sorted(gender_stats.items())
        ]

        return by_grade, by_gender

    @staticmethod
    def _parse_date(value: Any) -> datetime | None:
        """Parse a date string to datetime, returning None on failure."""
        if not value:
            return None
        try:
            return datetime.strptime(str(value)[:10], "%Y-%m-%d")
        except ValueError, IndexError:
            return None

    @classmethod
    def _compute_waitlist_duration(
        cls,
        person_ids: set[int],
        attendee_by_person: dict[int, Any],
    ) -> dict[str, float | None]:
        """Compute avg/median days between effective_date and enrollment_date for a set of persons.

        Returns dict with 'avg' and 'median' keys, both None if no valid records found.
        """
        days_list: list[int] = []

        for pid in person_ids:
            att = attendee_by_person.get(pid)
            if att is None:
                continue

            eff_date = cls._parse_date(getattr(att, "effective_date", None))
            enr_date = cls._parse_date(getattr(att, "enrollment_date", None))
            if not eff_date or not enr_date:
                continue

            days = (enr_date - eff_date).days
            if days >= 0:
                days_list.append(days)

        if not days_list:
            return {"avg": None, "median": None}

        avg_days = sum(days_list) / len(days_list)
        sorted_days = sorted(days_list)
        n = len(sorted_days)
        median_days = sorted_days[n // 2] if n % 2 == 1 else (sorted_days[n // 2 - 1] + sorted_days[n // 2]) / 2.0

        return {"avg": round(avg_days, 1), "median": round(median_days, 1)}
