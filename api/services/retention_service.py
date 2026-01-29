"""Retention service - business logic for retention metrics.

This service moves business logic out of the retention endpoint into a
testable service that uses the MetricsRepository for data access.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from api.schemas.metrics import (
    RetentionByCity,
    RetentionByFirstSummerYear,
    RetentionByFirstYear,
    RetentionByGender,
    RetentionByGrade,
    RetentionByPriorSession,
    RetentionBySchool,
    RetentionBySession,
    RetentionBySessionBunk,
    RetentionBySummerYears,
    RetentionBySynagogue,
    RetentionByYearsAtCamp,
    RetentionMetricsResponse,
)
from api.utils.session_metrics import SUMMER_PROGRAM_SESSION_TYPES

from .breakdown_calculator import compute_breakdown, safe_rate
from .extractors import (
    extract_city,
    extract_first_year_attended,
    extract_gender,
    extract_grade,
    extract_school,
    extract_synagogue,
    extract_years_at_camp,
)

if TYPE_CHECKING:
    from .metrics_repository import MetricsRepository


class RetentionService:
    """Business logic for retention metrics - fully testable with mocked repository."""

    def __init__(self, repository: MetricsRepository) -> None:
        """Initialize with repository for data access.

        Args:
            repository: MetricsRepository instance for data access.
        """
        self.repo = repository

    async def calculate_retention(
        self,
        base_year: int,
        compare_year: int,
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
    ) -> RetentionMetricsResponse:
        """Calculate retention metrics comparing two years.

        Args:
            base_year: The base year (e.g., 2025).
            compare_year: The comparison year (e.g., 2026).
            session_types: Optional list of session types to filter.
            session_cm_id: Optional specific session ID to filter.

        Returns:
            RetentionMetricsResponse with all breakdown metrics.
        """
        # Fetch data in parallel
        import asyncio

        (
            attendees_base,
            attendees_compare,
            persons_base,
            sessions_base,
            camper_history_base,
        ) = await asyncio.gather(
            self.repo.fetch_attendees(base_year),
            self.repo.fetch_attendees(compare_year),
            self.repo.fetch_persons(base_year),
            self.repo.fetch_sessions(base_year, session_types),
            self.repo.fetch_camper_history(base_year, session_types=session_types),
        )

        # Get unique person IDs for base year, filtered by session
        person_ids_base, attendee_sessions = self._filter_base_attendees(attendees_base, session_types, session_cm_id)

        # Get person IDs for compare year (no session filter needed)
        person_ids_compare = {getattr(a, "person_id", None) for a in attendees_compare if getattr(a, "person_id", None)}

        # Calculate returned campers
        returned_ids = person_ids_base & person_ids_compare

        # Overall metrics
        base_total = len(person_ids_base)
        compare_total = len(person_ids_compare)
        returned_count = len(returned_ids)
        overall_rate = safe_rate(returned_count, base_total)

        # Compute breakdowns using generic calculator
        by_gender = self._build_retention_breakdown(
            person_ids_base, returned_ids, persons_base, extract_gender, RetentionByGender, "gender"
        )

        by_grade = self._build_retention_breakdown(
            person_ids_base,
            returned_ids,
            persons_base,
            extract_grade,
            RetentionByGrade,
            "grade",
            sort_key=lambda x: (x.grade is None, x.grade),
        )

        # Session breakdown with AG merging
        by_session = self._build_session_breakdown(person_ids_base, returned_ids, attendee_sessions, sessions_base)

        by_years_at_camp = self._build_retention_breakdown(
            person_ids_base, returned_ids, persons_base, extract_years_at_camp, RetentionByYearsAtCamp, "years"
        )

        # Demographic breakdowns from camper_history
        history_by_person = self.repo.build_history_by_person(camper_history_base)

        by_school = self._build_retention_breakdown(
            person_ids_base,
            returned_ids,
            history_by_person,
            extract_school,
            RetentionBySchool,
            "school",
            sort_key=lambda x: -x.base_count,
            filter_empty=True,
        )

        by_city = self._build_retention_breakdown(
            person_ids_base,
            returned_ids,
            history_by_person,
            extract_city,
            RetentionByCity,
            "city",
            sort_key=lambda x: -x.base_count,
            filter_empty=True,
        )

        by_synagogue = self._build_retention_breakdown(
            person_ids_base,
            returned_ids,
            history_by_person,
            extract_synagogue,
            RetentionBySynagogue,
            "synagogue",
            sort_key=lambda x: -x.base_count,
            filter_empty=True,
        )

        by_first_year = self._build_retention_breakdown(
            person_ids_base,
            returned_ids,
            history_by_person,
            extract_first_year_attended,
            RetentionByFirstYear,
            "first_year",
            filter_none=True,
        )

        by_session_bunk = self._build_session_bunk_breakdown(person_ids_base, returned_ids, history_by_person)

        # Summer enrollment breakdowns (calculated from attendees history)
        enrollment_history = await self.repo.fetch_summer_enrollment_history(person_ids_base, base_year)
        prior_year = base_year - 1

        summer_years_by_person, first_year_by_person, prior_sessions_by_person = self._compute_summer_metrics(
            enrollment_history, person_ids_base, prior_year
        )

        by_summer_years = self._build_summer_years_breakdown(person_ids_base, returned_ids, summer_years_by_person)

        by_first_summer_year = self._build_first_summer_year_breakdown(
            person_ids_base, returned_ids, first_year_by_person
        )

        by_prior_session = self._build_prior_session_breakdown(person_ids_base, returned_ids, prior_sessions_by_person)

        return RetentionMetricsResponse(
            base_year=base_year,
            compare_year=compare_year,
            base_year_total=base_total,
            compare_year_total=compare_total,
            returned_count=returned_count,
            overall_retention_rate=overall_rate,
            by_gender=by_gender,
            by_grade=by_grade,
            by_session=by_session,
            by_years_at_camp=by_years_at_camp,
            by_school=by_school,
            by_city=by_city,
            by_synagogue=by_synagogue,
            by_first_year=by_first_year,
            by_session_bunk=by_session_bunk,
            by_summer_years=by_summer_years,
            by_first_summer_year=by_first_summer_year,
            by_prior_session=by_prior_session,
        )

    def _filter_base_attendees(
        self,
        attendees: list[Any],
        session_types: list[str] | None,
        session_cm_id: int | None,
    ) -> tuple[set[int], dict[int, list[int]]]:
        """Filter base year attendees and collect session mappings.

        Args:
            attendees: List of attendee records with session expansion.
            session_types: Optional session types to filter.
            session_cm_id: Optional specific session ID to filter.

        Returns:
            Tuple of (person_ids set, dict mapping person_id to session cm_ids).
        """
        person_ids: set[int] = set()
        attendee_sessions: dict[int, list[int]] = {}

        for a in attendees:
            person_id = getattr(a, "person_id", None)
            if person_id is None:
                continue

            # Get session from expand
            expand = getattr(a, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            attendee_session_cm_id = getattr(session, "cm_id", None) if session else None

            # Filter by session type if specified
            if session_types and session:
                session_type = getattr(session, "session_type", None)
                if session_type not in session_types:
                    continue

            # Filter by specific session if specified
            if session_cm_id is not None and attendee_session_cm_id != session_cm_id:
                continue

            person_ids.add(person_id)
            if person_id not in attendee_sessions:
                attendee_sessions[person_id] = []
            if attendee_session_cm_id:
                attendee_sessions[person_id].append(attendee_session_cm_id)

        return person_ids, attendee_sessions

    def _build_retention_breakdown[T, M](
        self,
        person_ids: set[int],
        returned_ids: set[int],
        persons: dict[int, Any],
        extractor: Any,
        model_class: type[M],
        key_name: str,
        sort_key: Any | None = None,
        filter_empty: bool = False,
        filter_none: bool = False,
    ) -> list[M]:
        """Build retention breakdown using generic calculator.

        Args:
            person_ids: Set of person IDs in base year.
            returned_ids: Set of person IDs who returned.
            persons: Dictionary mapping person_id to record.
            extractor: Function to extract category value.
            model_class: Pydantic model class for the breakdown.
            key_name: Name of the key field in the model.
            sort_key: Optional sorting function.
            filter_empty: If True, filter out empty string values.
            filter_none: If True, filter out None values.

        Returns:
            List of breakdown models.
        """
        stats = compute_breakdown(person_ids, returned_ids, persons, extractor)

        # Filter if needed
        if filter_empty:
            stats = {k: v for k, v in stats.items() if k}
        if filter_none:
            stats = {k: v for k, v in stats.items() if k is not None}

        # Build model instances
        items = [
            model_class(
                **{
                    key_name: key,
                    "base_count": s.base_count,
                    "returned_count": s.returned_count,
                    "retention_rate": s.retention_rate,
                }
            )
            for key, s in stats.items()
        ]

        # Sort
        if sort_key:
            items.sort(key=sort_key)
        else:
            items.sort(key=lambda x: getattr(x, key_name))

        return items

    def _build_session_breakdown(
        self,
        person_ids: set[int],
        returned_ids: set[int],
        attendee_sessions: dict[int, list[int]],
        sessions: dict[int, Any],
    ) -> list[RetentionBySession]:
        """Build session breakdown with AG session merging.

        Args:
            person_ids: Set of person IDs in base year.
            returned_ids: Set of person IDs who returned.
            attendee_sessions: Dict mapping person_id to session cm_ids.
            sessions: Dict mapping session cm_id to session record.

        Returns:
            List of RetentionBySession models.
        """
        # Build AG -> parent mapping
        ag_parent_map: dict[int, int] = {}
        for sid, session in sessions.items():
            if getattr(session, "session_type", None) == "ag":
                parent_id = getattr(session, "parent_id", None)
                if parent_id:
                    ag_parent_map[int(sid)] = int(parent_id)

        # Compute session stats
        session_stats: dict[int, dict[str, int]] = {}
        for pid in person_ids:
            session_ids = attendee_sessions.get(pid, [])
            for sid in session_ids:
                # Merge AG into parent
                target_sid = ag_parent_map.get(sid, sid)
                if target_sid not in session_stats:
                    session_stats[target_sid] = {"base": 0, "returned": 0}
                session_stats[target_sid]["base"] += 1
                if pid in returned_ids:
                    session_stats[target_sid]["returned"] += 1

        # Build response, filtering to main/embedded sessions only
        result = []
        for sid, stats in sorted(session_stats.items()):
            session = sessions.get(sid)
            if not session:
                continue
            session_type = getattr(session, "session_type", None)
            if session_type not in SUMMER_PROGRAM_SESSION_TYPES:
                continue

            result.append(
                RetentionBySession(
                    session_cm_id=sid,
                    session_name=getattr(session, "name", f"Session {sid}"),
                    base_count=stats["base"],
                    returned_count=stats["returned"],
                    retention_rate=safe_rate(stats["returned"], stats["base"]),
                )
            )

        return result

    def _build_session_bunk_breakdown(
        self,
        person_ids: set[int],
        returned_ids: set[int],
        history_by_person: dict[int, Any],
    ) -> list[RetentionBySessionBunk]:
        """Build session+bunk breakdown from camper_history.

        Args:
            person_ids: Set of person IDs in base year.
            returned_ids: Set of person IDs who returned.
            history_by_person: Dict mapping person_id to camper_history record.

        Returns:
            List of top 10 RetentionBySessionBunk models.
        """
        session_bunk_stats: dict[tuple[str, str], dict[str, int]] = {}

        for pid in person_ids:
            history = history_by_person.get(pid)
            if not history:
                continue

            sessions_str = getattr(history, "sessions", "") or ""
            bunks_str = getattr(history, "bunks", "") or ""

            session_list = [s.strip() for s in sessions_str.split(",") if s.strip()]
            bunk_list = [b.strip() for b in bunks_str.split(",") if b.strip()]

            # Pair sessions and bunks
            pairs: list[tuple[str, str]] = []
            if len(session_list) == len(bunk_list):
                pairs = list(zip(session_list, bunk_list, strict=True))
            elif session_list and bunk_list:
                # Cross-product when lengths don't match
                pairs = [(s, b) for s in session_list for b in bunk_list]

            for sess, bunk in pairs:
                key = (sess, bunk)
                if key not in session_bunk_stats:
                    session_bunk_stats[key] = {"base": 0, "returned": 0}
                session_bunk_stats[key]["base"] += 1
                if pid in returned_ids:
                    session_bunk_stats[key]["returned"] += 1

        # Sort by base_count descending, take top 10
        sorted_items = sorted(session_bunk_stats.items(), key=lambda x: -x[1]["base"])[:10]

        return [
            RetentionBySessionBunk(
                session=sess,
                bunk=bunk,
                base_count=stats["base"],
                returned_count=stats["returned"],
                retention_rate=safe_rate(stats["returned"], stats["base"]),
            )
            for (sess, bunk), stats in sorted_items
        ]

    def _compute_summer_metrics(
        self,
        enrollment_history: list[Any],
        person_ids: set[int],
        prior_year: int,
    ) -> tuple[dict[int, int], dict[int, int], dict[int, list[str]]]:
        """Compute summer enrollment metrics from batch-fetched history.

        Args:
            enrollment_history: List of attendee records with session expansion.
            person_ids: Set of person_ids in the base year.
            prior_year: Year before base year (for prior session analysis).

        Returns:
            Tuple of:
            - summer_years_by_person: person_id -> count of distinct summer years
            - first_year_by_person: person_id -> first summer enrollment year
            - prior_sessions_by_person: person_id -> list of prior year session names
        """
        # Group records by person_id
        by_person: dict[int, list[Any]] = {}
        for record in enrollment_history:
            pid = getattr(record, "person_id", None)
            if pid is None or pid not in person_ids:
                continue

            # Filter to summer session types
            expand = getattr(record, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            if not session:
                continue

            session_type = getattr(session, "session_type", None)
            if session_type not in SUMMER_PROGRAM_SESSION_TYPES:
                continue

            if pid not in by_person:
                by_person[pid] = []
            by_person[pid].append(record)

        # Compute aggregations
        summer_years_by_person: dict[int, int] = {}
        first_year_by_person: dict[int, int] = {}
        prior_sessions_by_person: dict[int, list[str]] = {}

        for pid, records in by_person.items():
            # Summer years: count distinct years
            years = {getattr(r, "year", 0) for r in records}
            summer_years_by_person[pid] = len(years)

            # First summer year: min year
            if years:
                first_year_by_person[pid] = min(years)

            # Prior year sessions
            prior_sessions = []
            for r in records:
                if getattr(r, "year", 0) == prior_year:
                    expand = getattr(r, "expand", {}) or {}
                    session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
                    if session:
                        session_name = getattr(session, "name", "")
                        if session_name:
                            prior_sessions.append(session_name)
            prior_sessions_by_person[pid] = prior_sessions

        return summer_years_by_person, first_year_by_person, prior_sessions_by_person

    def _build_summer_years_breakdown(
        self,
        person_ids: set[int],
        returned_ids: set[int],
        summer_years_by_person: dict[int, int],
    ) -> list[RetentionBySummerYears]:
        """Build summer years breakdown.

        Args:
            person_ids: Set of person IDs in base year.
            returned_ids: Set of person IDs who returned.
            summer_years_by_person: Dict mapping person_id to summer years count.

        Returns:
            List of RetentionBySummerYears models.
        """
        stats: dict[int, dict[str, int]] = {}
        for pid in person_ids:
            years_count = summer_years_by_person.get(pid, 0)
            if years_count not in stats:
                stats[years_count] = {"base": 0, "returned": 0}
            stats[years_count]["base"] += 1
            if pid in returned_ids:
                stats[years_count]["returned"] += 1

        return [
            RetentionBySummerYears(
                summer_years=y,
                base_count=s["base"],
                returned_count=s["returned"],
                retention_rate=safe_rate(s["returned"], s["base"]),
            )
            for y, s in sorted(stats.items())
        ]

    def _build_first_summer_year_breakdown(
        self,
        person_ids: set[int],
        returned_ids: set[int],
        first_year_by_person: dict[int, int],
    ) -> list[RetentionByFirstSummerYear]:
        """Build first summer year breakdown.

        Args:
            person_ids: Set of person IDs in base year.
            returned_ids: Set of person IDs who returned.
            first_year_by_person: Dict mapping person_id to first summer year.

        Returns:
            List of RetentionByFirstSummerYear models.
        """
        stats: dict[int, dict[str, int]] = {}
        for pid in person_ids:
            first_year = first_year_by_person.get(pid)
            if first_year is None:
                continue
            if first_year not in stats:
                stats[first_year] = {"base": 0, "returned": 0}
            stats[first_year]["base"] += 1
            if pid in returned_ids:
                stats[first_year]["returned"] += 1

        return [
            RetentionByFirstSummerYear(
                first_summer_year=fy,
                base_count=s["base"],
                returned_count=s["returned"],
                retention_rate=safe_rate(s["returned"], s["base"]),
            )
            for fy, s in sorted(stats.items())
        ]

    def _build_prior_session_breakdown(
        self,
        person_ids: set[int],
        returned_ids: set[int],
        prior_sessions_by_person: dict[int, list[str]],
    ) -> list[RetentionByPriorSession]:
        """Build prior session breakdown.

        Args:
            person_ids: Set of person IDs in base year.
            returned_ids: Set of person IDs who returned.
            prior_sessions_by_person: Dict mapping person_id to prior session names.

        Returns:
            List of RetentionByPriorSession models.
        """
        stats: dict[str, dict[str, int]] = {}
        for pid in person_ids:
            prior_sessions = prior_sessions_by_person.get(pid, [])
            for session_name in prior_sessions:
                if session_name not in stats:
                    stats[session_name] = {"base": 0, "returned": 0}
                stats[session_name]["base"] += 1
                if pid in returned_ids:
                    stats[session_name]["returned"] += 1

        # Sort by base_count descending
        sorted_items = sorted(stats.items(), key=lambda x: -x[1]["base"])

        return [
            RetentionByPriorSession(
                prior_session=sess,
                base_count=s["base"],
                returned_count=s["returned"],
                retention_rate=safe_rate(s["returned"], s["base"]),
            )
            for sess, s in sorted_items
        ]
