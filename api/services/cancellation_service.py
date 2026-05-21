"""Cancellation service - business logic for cancellation analysis metrics.

Analyzes cancelled/withdrawn/dismissed attendees to understand:
- Prior status before cancellation (enrolled, waitlisted, applied, other)
- Whether they still attend camp in other sessions
- Recovery rate (re-enrolled after cancellation)
- Demographics breakdowns with prior status splits
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import TYPE_CHECKING, Any

from api.schemas.metrics import (
    CancellationMetricsResponse,
    CancellationSessionBreakdown,
    GenderBreakdown,
    GradeBreakdown,
    RegistrationMonthBreakdown,
    TimeBucket,
)
from api.services.breakdown_calculator import calculate_percentage, compute_registration_breakdown
from api.services.extractors import extract_gender, extract_grade
from api.utils.session_metrics import (
    DEFAULT_SUMMER_SESSION_TYPES as SUMMER_SESSION_TYPES,
)
from api.utils.session_metrics import (
    build_ag_parent_map,
    get_session_from_expand,
    resolve_duration_sessions,
)
from api.utils.session_swap import detect_session_swaps
from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from .metrics_repository import MetricsRepository

logger = get_logger(__name__)

# Statuses that indicate cancellation
CANCELLED_STATUSES = ["cancelled", "withdrawn", "dismissed"]

# Prior statuses grouped into categories
_ENROLLED_STATUS = "enrolled"
_WAITLISTED_STATUS = "waitlisted"
_APPLIED_STATUS = "applied"
# Everything else (inquiry, incomplete, none, left_early) → other_prior_status


class CancellationService:
    """Business logic for cancellation analysis - fully testable with mocked repository."""

    def __init__(self, repository: MetricsRepository) -> None:
        self.repository = repository

    async def calculate_cancellations(
        self,
        year: int,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
        duration: str | None = None,
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
        if duration:
            duration_session_ids = resolve_duration_sessions(filtered_sessions, duration)
            valid_session_ids = valid_session_ids & duration_session_ids

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

        # --- Fetch ALL status transitions to cancelled in a single call ---
        all_to_cancelled = await self.repository.fetch_status_history(
            year, old_status=None, new_statuses=CANCELLED_STATUSES
        )

        # Build per-person and per-session lookups for all prior statuses
        prior_status_persons: dict[str, set[int]] = {
            "enrolled": set(),
            "waitlisted": set(),
            "applied": set(),
            "other": set(),
        }
        prior_status_by_session: dict[str, dict[int, set[int]]] = {
            "enrolled": defaultdict(set),
            "waitlisted": defaultdict(set),
            "applied": defaultdict(set),
            "other": defaultdict(set),
        }

        for record in all_to_cancelled:
            pid = int(getattr(record, "person_id", 0))
            if not pid:
                continue
            old_status = getattr(record, "old_status", "") or ""
            session_info = get_session_from_expand(record)
            session_cmid = int(getattr(session_info, "cm_id", 0)) if session_info else 0

            category = self._classify_prior_status(old_status)
            prior_status_persons[category].add(pid)
            if session_cmid:
                prior_status_by_session[category][session_cmid].add(pid)

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
        session_keys = (
            "total_cancelled",
            "was_enrolled",
            "was_waitlisted",
            "was_applied",
            "other_prior_status",
            "has_other_sessions",
            "no_other_sessions",
        )
        cancelled_by_session: dict[int, dict[str, int]] = defaultdict(lambda: dict.fromkeys(session_keys, 0))

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

                    # Classify prior status for this session
                    if pid in prior_status_by_session["enrolled"].get(session_cmid, set()):
                        cancelled_by_session[session_cmid]["was_enrolled"] += 1
                    elif pid in prior_status_by_session["waitlisted"].get(session_cmid, set()):
                        cancelled_by_session[session_cmid]["was_waitlisted"] += 1
                    elif pid in prior_status_by_session["applied"].get(session_cmid, set()):
                        cancelled_by_session[session_cmid]["was_applied"] += 1
                    elif pid in prior_status_by_session["other"].get(session_cmid, set()):
                        cancelled_by_session[session_cmid]["other_prior_status"] += 1

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
                merged_by_session[target_sid] = dict.fromkeys(session_keys, 0)
            for key in session_keys:
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
                        was_applied=counts["was_applied"],
                        other_prior_status=counts["other_prior_status"],
                        has_other_sessions=counts["has_other_sessions"],
                        no_other_sessions=counts["no_other_sessions"],
                    )
                )

        # --- Build demographics ---
        persons = await self.repository.fetch_persons(year)
        by_grade, by_gender = self._compute_demographics(seen_for_summary, persons, prior_status_persons)

        # Summary counts (unique persons intersected with cancelled persons)
        summary_was_enrolled = len(prior_status_persons["enrolled"] & seen_for_summary)
        summary_was_waitlisted = len(prior_status_persons["waitlisted"] & seen_for_summary)
        summary_was_applied = len(prior_status_persons["applied"] & seen_for_summary)
        summary_other_prior = len(prior_status_persons["other"] & seen_for_summary)

        # --- Session swap detection ---
        swap_pids = detect_session_swaps(cancelled_attendees, enrolled_attendees)
        # Only count swaps that are in our summary set
        swap_pids = swap_pids & seen_for_summary
        session_swap_count = len(swap_pids)
        true_departure_count = len(seen_for_summary) - session_swap_count

        # --- Time-to-cancellation (non-swap records with both dates) ---
        timing_data = self._compute_timing_stats(cancelled_attendees, seen_for_summary, swap_pids)

        # --- Registration month breakdown ---
        by_registration_month = self._compute_registration_month_breakdown(cancelled_attendees, seen_for_summary)

        return CancellationMetricsResponse(
            year=year,
            total_cancelled=len(seen_for_summary),
            was_enrolled=summary_was_enrolled,
            was_waitlisted=summary_was_waitlisted,
            was_applied=summary_was_applied,
            other_prior_status=summary_other_prior,
            has_other_sessions=summary_has_other,
            no_other_sessions=summary_no_other,
            total_re_enrolled=len(re_enrolled_persons & seen_for_summary) if duration else len(re_enrolled_persons),
            session_swap_count=session_swap_count,
            true_departure_count=true_departure_count,
            avg_days_to_cancellation=timing_data["avg"],
            median_days_to_cancellation=timing_data["median"],
            time_to_cancellation_buckets=timing_data["buckets"],
            by_registration_month=by_registration_month,
            by_session=by_session,
            by_grade=by_grade,
            by_gender=by_gender,
        )

    @staticmethod
    def _classify_prior_status(old_status: str) -> str:
        """Classify an old_status into one of the four prior status categories."""
        if old_status == _ENROLLED_STATUS:
            return "enrolled"
        if old_status == _WAITLISTED_STATUS:
            return "waitlisted"
        if old_status == _APPLIED_STATUS:
            return "applied"
        return "other"

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
        prior_status_persons: dict[str, set[int]],
    ) -> tuple[list[GradeBreakdown], list[GenderBreakdown]]:
        """Compute grade and gender breakdowns with prior status splits."""
        total = len(person_ids)
        if total == 0:
            return [], []

        # Build per-category prior status splits
        _zero = {"enrolled": 0, "waitlisted": 0, "applied": 0, "other": 0}
        grade_split: dict[int | None, dict[str, int]] = {}
        gender_split: dict[str, dict[str, int]] = {}

        for pid in person_ids:
            person = persons.get(pid)
            if not person:
                continue
            grade = extract_grade(person)
            gender = extract_gender(person)

            if grade not in grade_split:
                grade_split[grade] = {**_zero}
            if gender not in gender_split:
                gender_split[gender] = {**_zero}

            for cat in ("enrolled", "waitlisted", "applied", "other"):
                if pid in prior_status_persons[cat]:
                    grade_split[grade][cat] += 1
                    gender_split[gender][cat] += 1

        grade_stats = compute_registration_breakdown(person_ids, persons, extract_grade)
        by_grade = [
            GradeBreakdown(
                grade=g,
                count=s.count,
                percentage=round(calculate_percentage(s.count, total), 1),
                was_enrolled=grade_split.get(g, _zero)["enrolled"],
                was_waitlisted=grade_split.get(g, _zero)["waitlisted"],
                was_applied=grade_split.get(g, _zero)["applied"],
                other_prior_status=grade_split.get(g, _zero)["other"],
            )
            for g, s in sorted(grade_stats.items(), key=lambda x: (x[0] is None, x[0]))
        ]

        gender_stats = compute_registration_breakdown(person_ids, persons, extract_gender)
        by_gender = [
            GenderBreakdown(
                gender=g,
                count=s.count,
                percentage=round(calculate_percentage(s.count, total), 1),
                was_enrolled=gender_split.get(g, _zero)["enrolled"],
                was_waitlisted=gender_split.get(g, _zero)["waitlisted"],
                was_applied=gender_split.get(g, _zero)["applied"],
                other_prior_status=gender_split.get(g, _zero)["other"],
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

    @staticmethod
    def _compute_median(sorted_values: list[int]) -> float:
        """Compute median of a pre-sorted list of integers."""
        n = len(sorted_values)
        if n % 2 == 1:
            return float(sorted_values[n // 2])
        return (sorted_values[n // 2 - 1] + sorted_values[n // 2]) / 2.0

    @classmethod
    def _compute_timing_stats(
        cls,
        cancelled_attendees: list[Any],
        seen_for_summary: set[int],
        swap_pids: set[int],
    ) -> dict[str, Any]:
        """Compute time-to-cancellation statistics for non-swap cancelled records.

        Returns dict with 'avg', 'median', and 'buckets' keys.
        """
        days_list: list[int] = []
        seen: set[int] = set()

        for att in cancelled_attendees:
            pid = int(getattr(att, "person_id", 0))
            if not pid or pid not in seen_for_summary or pid in swap_pids or pid in seen:
                continue
            seen.add(pid)

            eff_date = cls._parse_date(getattr(att, "effective_date", None))
            enr_date = cls._parse_date(getattr(att, "enrollment_date", None))
            if not eff_date or not enr_date:
                continue

            days = (enr_date - eff_date).days
            if days >= 0:
                days_list.append(days)

        if not days_list:
            return {"avg": None, "median": None, "buckets": []}

        avg_days = sum(days_list) / len(days_list)
        sorted_days = sorted(days_list)
        median_days = cls._compute_median(sorted_days)

        # Bucket distribution
        bucket_defs = [
            ("< 30 days", 0, 30),
            ("30\u201390 days", 30, 90),
            ("90\u2013180 days", 90, 180),
            ("180+ days", 180, 999999),
        ]
        total = len(days_list)
        buckets: list[TimeBucket] = []
        for label, lo, hi in bucket_defs:
            count = sum(1 for d in days_list if lo <= d < hi)
            buckets.append(
                TimeBucket(
                    label=label,
                    count=count,
                    percentage=round(count / total * 100, 1) if total else 0,
                )
            )

        return {"avg": round(avg_days, 1), "median": round(median_days, 1), "buckets": buckets}

    @classmethod
    def _compute_registration_month_breakdown(
        cls,
        cancelled_attendees: list[Any],
        seen_for_summary: set[int],
    ) -> list[RegistrationMonthBreakdown]:
        """Group cancellations by effective_date month."""
        month_counts: dict[str, int] = {}
        seen: set[int] = set()

        for att in cancelled_attendees:
            pid = int(getattr(att, "person_id", 0))
            if not pid or pid not in seen_for_summary or pid in seen:
                continue
            seen.add(pid)

            eff_date = cls._parse_date(getattr(att, "effective_date", None))
            if not eff_date:
                continue

            month_key = eff_date.strftime("%b %Y")
            month_counts[month_key] = month_counts.get(month_key, 0) + 1

        total = sum(month_counts.values())
        return [
            RegistrationMonthBreakdown(
                month=month,
                count=count,
                percentage=round(count / total * 100, 1) if total else 0,
            )
            for month, count in sorted(month_counts.items(), key=lambda x: datetime.strptime(x[0], "%b %Y"))
        ]
