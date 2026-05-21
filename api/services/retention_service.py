"""Retention service - business logic for retention metrics.

This service moves business logic out of the retention endpoint into a
testable service that uses the MetricsRepository for data access.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any, cast

from api.schemas.metrics import (
    RetentionByCity,
    RetentionByFirstSummerYear,
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
    SessionFlowItem,
)
from api.utils.session_aliases import get_alias_group
from api.utils.session_metrics import (
    BUNK_SESSION_TYPES,
    DISPLAY_SESSION_TYPES,
    compute_summer_metrics,
    get_person_from_expand,
    get_session_from_expand,
    resolve_duration_sessions,
)

from .breakdown_calculator import compute_breakdown, safe_rate
from .extractors import (
    RETENTION_AGED_OUT_GRADE,
    exclude_aged_out_persons,
    extract_city,
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
        duration: str | None = None,
    ) -> RetentionMetricsResponse:
        """Calculate retention metrics comparing two years.

        Args:
            base_year: The base year (e.g., 2025).
            compare_year: The comparison year (e.g., 2026).
            session_types: Optional list of session types to filter.
            session_cm_id: Optional specific session ID to filter.
            duration: Optional duration category (e.g., "1-week", "2-week") to filter
                sessions by length.

        Returns:
            RetentionMetricsResponse with all breakdown metrics.
        """
        # Fetch data in parallel
        _results = await asyncio.gather(
            self.repo.fetch_attendees(base_year),
            self.repo.fetch_attendees(compare_year),
            self.repo.fetch_persons(base_year),
            self.repo.fetch_bunk_assignments(base_year),
            self.repo.fetch_sessions(base_year, None),
            self.repo.fetch_sessions(compare_year, session_types),
            self.repo.fetch_sessions(compare_year, None),
        )
        attendees_base = cast(list[Any], _results[0])
        attendees_compare = cast(list[Any], _results[1])
        persons_base = cast(dict[int, Any], _results[2])
        bunk_assignments_base = cast(list[Any], _results[3])
        sessions_base_all = cast(dict[int, Any], _results[4])
        sessions_compare_filtered = cast(dict[int, Any], _results[5])
        sessions_compare_all = cast(dict[int, Any], _results[6])

        # Default to summer session types when no filter specified, so non-summer
        # enrollments (TLI, family, training) don't count toward retention.
        summer_types = list(DISPLAY_SESSION_TYPES)
        effective_types = session_types if session_types is not None else summer_types

        # Resolve duration filter for both years
        duration_session_ids_base = resolve_duration_sessions(sessions_base_all, duration) if duration else None
        duration_session_ids_compare = resolve_duration_sessions(sessions_compare_all, duration) if duration else None

        # Resolve session_cm_id per year via alias system. When a session is
        # renamed across years (e.g. "Session 2b" → "Taste of Camp 2"), the
        # picker's cm_id may only exist in one year. Resolve to the equivalent
        # cm_id in the other year so both sides filter correctly.
        base_session_cm_id, compare_session_cm_id = self._resolve_session_cm_ids(
            session_cm_id, sessions_base_all, sessions_compare_all
        )

        # Get unique person IDs for base year, filtered by session
        person_ids_base, _ = self._filter_base_attendees(
            attendees_base, effective_types, base_session_cm_id, duration_session_ids_base
        )

        # Get person IDs for compare year, filtered by session type and cm_id
        person_ids_compare, _ = self._filter_base_attendees(
            attendees_compare, effective_types, compare_session_cm_id, duration_session_ids_compare
        )

        # "Unfiltered" pools for session chart semantics and session flow.
        # Still filtered to summer types (no session_cm_id filter) so non-summer
        # enrollments don't inflate "returned" counts in heatmap/Sankey/prior-session.
        person_ids_base_unfiltered, _ = self._filter_base_attendees(attendees_base, summer_types, None)
        person_ids_compare_unfiltered, attendee_sessions_compare = self._filter_base_attendees(
            attendees_compare, summer_types, None
        )

        # Exclude aged-out persons (grade >= 10) from retention base pools.
        # These campers have no eligible session to return to, so counting them
        # as "did not return" unfairly penalizes retention metrics.
        pre_filter_count = len(person_ids_base)
        person_ids_base = exclude_aged_out_persons(person_ids_base, persons_base)
        aged_out_count = pre_filter_count - len(person_ids_base)
        person_ids_base_unfiltered = exclude_aged_out_persons(person_ids_base_unfiltered, persons_base)
        # Build set of aged-out person IDs for methods that iterate attendees directly
        aged_out_person_ids = {
            pid
            for pid, person in persons_base.items()
            if getattr(person, "grade", None) is not None
            and int(getattr(person, "grade", 0)) >= RETENTION_AGED_OUT_GRADE
        }

        # Base year attendee sessions (filtered by session_types and base_session_cm_id) for session flow
        _, attendee_sessions_base_filtered = self._filter_base_attendees(
            attendees_base, session_types, base_session_cm_id, duration_session_ids_base
        )

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

        # Session breakdown: compare year sessions, returning = was in any base year session
        by_session = self._build_compare_year_session_breakdown(
            attendee_sessions_compare, person_ids_base_unfiltered, sessions_compare_filtered
        )

        by_years_at_camp = self._build_retention_breakdown(
            person_ids_base, returned_ids, persons_base, extract_years_at_camp, RetentionByYearsAtCamp, "years"
        )

        # Demographic breakdowns from persons' normalized fields
        by_school = self._build_retention_breakdown(
            person_ids_base,
            returned_ids,
            persons_base,
            extract_school,
            RetentionBySchool,
            "school",
            sort_key=lambda x: -x.base_count,
            filter_empty=True,
        )

        by_city = self._build_retention_breakdown(
            person_ids_base,
            returned_ids,
            persons_base,
            extract_city,
            RetentionByCity,
            "city",
            sort_key=lambda x: -x.base_count,
            filter_empty=True,
        )

        by_synagogue = self._build_retention_breakdown(
            person_ids_base,
            returned_ids,
            persons_base,
            extract_synagogue,
            RetentionBySynagogue,
            "synagogue",
            sort_key=lambda x: -x.base_count,
            filter_empty=True,
        )

        # Session-bunk breakdown from bunk_assignments (always unfiltered)
        # Heatmap should show "did camper return to camp at all?" regardless of session filter
        returned_ids_unfiltered = person_ids_base_unfiltered & person_ids_compare_unfiltered
        by_session_bunk = self._build_session_bunk_breakdown(
            person_ids_base_unfiltered, returned_ids_unfiltered, bunk_assignments_base, sessions_base_all
        )

        # Summer enrollment breakdowns (calculated from attendees history)
        enrollment_history = await self.repo.fetch_summer_enrollment_history(person_ids_base, base_year)

        summer_years_by_person, first_year_by_person = compute_summer_metrics(enrollment_history, person_ids_base)

        by_summer_years = self._build_summer_years_breakdown(person_ids_base, returned_ids, summer_years_by_person)

        by_first_summer_year = self._build_first_summer_year_breakdown(
            person_ids_base, returned_ids, first_year_by_person
        )

        # Prior session: base year sessions filtered by dropdown, returned = any compare year
        by_prior_session = self._build_base_year_session_breakdown(
            attendees_base,
            person_ids_compare_unfiltered,
            sessions_base_all,
            session_types,
            base_session_cm_id,
            aged_out_person_ids=aged_out_person_ids,
            session_cm_ids=duration_session_ids_base,
        )

        # Session flow: Sankey diagram data showing session-to-session transitions
        # Uses unfiltered compare-year data so destinations show all session types
        session_flow = self._build_session_flow(
            person_ids_base,
            attendee_sessions_base_filtered,
            attendee_sessions_compare,
            person_ids_compare_unfiltered,
            sessions_base_all,
            sessions_compare_all,
        )

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
            by_session_bunk=by_session_bunk,
            by_summer_years=by_summer_years,
            by_first_summer_year=by_first_summer_year,
            by_prior_session=by_prior_session,
            session_flow=session_flow,
            aged_out_count=aged_out_count,
        )

    def _filter_base_attendees(
        self,
        attendees: list[Any],
        session_types: list[str] | None,
        session_cm_id: int | None,
        session_cm_ids: set[int] | None = None,
    ) -> tuple[set[int], dict[int, list[int]]]:
        """Filter base year attendees and collect session mappings.

        Args:
            attendees: List of attendee records with session expansion.
            session_types: Optional session types to filter.
            session_cm_id: Optional specific session ID to filter.
            session_cm_ids: Optional set of session cm_ids to filter (duration groups).

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
            session = get_session_from_expand(a)
            attendee_session_cm_id = getattr(session, "cm_id", None) if session else None

            # Filter by session type if specified
            if session_types and session:
                session_type = getattr(session, "session_type", None)
                if session_type not in session_types:
                    continue

            # Filter by specific session if specified
            if session_cm_id is not None and attendee_session_cm_id != session_cm_id:
                continue

            # Apply multi-session filter (duration groups)
            if session_cm_ids is not None and attendee_session_cm_id not in session_cm_ids:
                continue

            person_ids.add(person_id)
            if person_id not in attendee_sessions:
                attendee_sessions[person_id] = []
            if attendee_session_cm_id:
                attendee_sessions[person_id].append(attendee_session_cm_id)

        return person_ids, attendee_sessions

    @staticmethod
    def _resolve_session_cm_ids(
        session_cm_id: int | None,
        sessions_base: dict[int, Any],
        sessions_compare: dict[int, Any],
    ) -> tuple[int | None, int | None]:
        """Resolve a session cm_id to per-year equivalents using alias mapping.

        The session picker uses compare-year cm_ids. When a session is renamed
        across years (e.g. "Session 2b" in 2025 → "Taste of Camp 2" in 2026),
        the picker's cm_id only exists in one year. This resolves the alias
        so each year filters by its own cm_id.

        Args:
            session_cm_id: The cm_id from the session picker (compare-year based), or None.
            sessions_base: All base year sessions keyed by cm_id.
            sessions_compare: All compare year sessions keyed by cm_id.

        Returns:
            Tuple of (base_session_cm_id, compare_session_cm_id).
        """
        if session_cm_id is None:
            return None, None

        # Build name→cm_id lookup for each year
        name_to_cmid_base: dict[str, int] = {}
        for cmid, session in sessions_base.items():
            name = getattr(session, "name", None)
            if name:
                name_to_cmid_base[name] = cmid

        name_to_cmid_compare: dict[str, int] = {}
        for cmid, session in sessions_compare.items():
            name = getattr(session, "name", None)
            if name:
                name_to_cmid_compare[name] = cmid

        # Start with the picker value for both sides
        base_cm_id: int | None = session_cm_id
        compare_cm_id: int | None = session_cm_id

        # Look up session name from whichever year has this cm_id
        session_name: str | None = None
        if session_cm_id in sessions_compare:
            session_name = getattr(sessions_compare[session_cm_id], "name", None)
        elif session_cm_id in sessions_base:
            session_name = getattr(sessions_base[session_cm_id], "name", None)

        if session_name is None:
            return base_cm_id, compare_cm_id

        # Get all equivalent names (canonical + aliases)
        alias_names = get_alias_group(session_name)

        # Resolve base year: find cm_id for any alias name present in base year
        if session_cm_id not in sessions_base:
            for name in alias_names:
                if name in name_to_cmid_base:
                    base_cm_id = name_to_cmid_base[name]
                    break

        # Resolve compare year: find cm_id for any alias name present in compare year
        if session_cm_id not in sessions_compare:
            for name in alias_names:
                if name in name_to_cmid_compare:
                    compare_cm_id = name_to_cmid_compare[name]
                    break

        return base_cm_id, compare_cm_id

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

    def _build_compare_year_session_breakdown(
        self,
        attendee_sessions_compare: dict[int, list[int]],
        person_ids_base_unfiltered: set[int],
        sessions_compare: dict[int, Any],
    ) -> list[RetentionBySession]:
        """Build session breakdown for compare year (Chart 1: "Retention by 2026 Session").

        Shows each compare year session's total enrollment and how many are
        returning from ANY base year session (unfiltered).

        Args:
            attendee_sessions_compare: Dict mapping person_id to compare year session cm_ids.
            person_ids_base_unfiltered: All base year person IDs (no type filter).
            sessions_compare: Compare year sessions (filtered by dropdown).

        Returns:
            List of RetentionBySession models.
        """
        # Build AG -> parent mapping from compare year sessions
        ag_parent_map: dict[int, int] = {}
        for sid, session in sessions_compare.items():
            if getattr(session, "session_type", None) == "ag":
                parent_id = getattr(session, "parent_id", None)
                if parent_id:
                    ag_parent_map[int(sid)] = int(parent_id)

        # Compute session stats from compare year attendees
        session_stats: dict[int, dict[str, int]] = {}
        for pid, session_ids in attendee_sessions_compare.items():
            for sid in session_ids:
                # Only count sessions in the filtered compare set
                if sid not in sessions_compare and sid not in ag_parent_map:
                    continue
                # Merge AG into parent
                target_sid = ag_parent_map.get(sid, sid)
                if target_sid not in sessions_compare:
                    continue
                if target_sid not in session_stats:
                    session_stats[target_sid] = {"base": 0, "returned": 0}
                session_stats[target_sid]["base"] += 1
                if pid in person_ids_base_unfiltered:
                    session_stats[target_sid]["returned"] += 1

        # Build response, filtering to display session types
        result = []
        for sid, stats in sorted(session_stats.items()):
            session = sessions_compare.get(sid)
            if not session:
                continue
            session_type = getattr(session, "session_type", None)
            if session_type not in DISPLAY_SESSION_TYPES:
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

    def _build_base_year_session_breakdown(
        self,
        attendees_base: list[Any],
        person_ids_compare: set[int],
        sessions_base_all: dict[int, Any],
        session_types: list[str] | None = None,
        session_cm_id: int | None = None,
        aged_out_person_ids: set[int] | None = None,
        session_cm_ids: set[int] | None = None,
    ) -> list[RetentionByPriorSession]:
        """Build session breakdown for base year (Chart 2: "Retention by 2025 Session").

        Shows each base year session's FULL enrollment and how many returned
        to ANY compare year session (unfiltered). The dropdown controls which
        prior sessions are SHOWN, not what counts as "returned".

        Args:
            attendees_base: Raw base year attendee records (all types, unfiltered).
            person_ids_compare: Compare year person IDs (unfiltered).
            sessions_base_all: All base year sessions (unfiltered).
            session_types: If set, only show prior sessions matching these types.
            session_cm_id: If set, only show the prior session with this cm_id.
            aged_out_person_ids: Person IDs to exclude (aged out of eligible sessions).
            session_cm_ids: If set, only include attendees in these sessions (duration filter).

        Returns:
            List of RetentionByPriorSession models.
        """
        # Build AG -> parent mapping from base year sessions
        ag_parent_map: dict[int, int] = {}
        for ag_sid, ag_session in sessions_base_all.items():
            if getattr(ag_session, "session_type", None) == "ag":
                parent_id = getattr(ag_session, "parent_id", None)
                if parent_id:
                    ag_parent_map[int(ag_sid)] = int(parent_id)

        # Count per-session enrollment from raw attendees
        _aged_out = aged_out_person_ids or set()
        session_stats: dict[int, dict[str, set[int]]] = {}
        for a in attendees_base:
            pid = getattr(a, "person_id", None)
            if pid is None or pid in _aged_out:
                continue

            session = get_session_from_expand(a)
            if not session:
                continue

            raw_sid = getattr(session, "cm_id", None)
            if raw_sid is None:
                continue
            sid = int(raw_sid)

            # Filter by duration group if specified
            if session_cm_ids is not None and sid not in session_cm_ids:
                continue

            # Merge AG into parent
            target_sid = ag_parent_map.get(sid, sid)
            if target_sid not in session_stats:
                session_stats[target_sid] = {"base": set(), "returned": set()}
            session_stats[target_sid]["base"].add(pid)
            if pid in person_ids_compare:
                session_stats[target_sid]["returned"].add(pid)

        # Build response, filtering to display session types and dropdown params
        result = []
        for out_sid, pid_sets in sorted(session_stats.items()):
            session = sessions_base_all.get(out_sid)
            if not session:
                continue
            session_type = getattr(session, "session_type", None)
            if session_type not in DISPLAY_SESSION_TYPES:
                continue
            if session_types and session_type not in session_types:
                continue
            if session_cm_id is not None and out_sid != session_cm_id:
                continue

            base_count = len(pid_sets["base"])
            returned_count = len(pid_sets["returned"])
            session_name = getattr(session, "name", f"Session {out_sid}")

            result.append(
                RetentionByPriorSession(
                    prior_session=session_name,
                    start_date=getattr(session, "start_date", None),
                    base_count=base_count,
                    returned_count=returned_count,
                    retention_rate=safe_rate(returned_count, base_count),
                )
            )

        return result

    def _build_session_flow(
        self,
        person_ids_base: set[int],
        attendee_sessions_base: dict[int, list[int]],
        compare_attendee_sessions: dict[int, list[int]],
        person_ids_compare_unfiltered: set[int],
        sessions_base: dict[int, Any],
        sessions_compare: dict[int, Any],
    ) -> list[SessionFlowItem]:
        """Build session flow data for Sankey diagram.

        Shows how campers flow from base year sessions to compare year sessions.
        AG sessions are merged into their parent on both source and target sides.
        Destinations are unfiltered (show all session types).

        Args:
            person_ids_base: Set of person IDs in base year (filtered).
            attendee_sessions_base: Base year person_id -> session cm_ids (filtered).
            compare_attendee_sessions: Compare year person_id -> session cm_ids (unfiltered).
            person_ids_compare_unfiltered: All compare year person IDs (for detecting returns).
            sessions_base: All base year sessions (for name lookup and AG merging).
            sessions_compare: All compare year sessions (for name lookup and AG merging).

        Returns:
            List of SessionFlowItem sorted by value descending.
        """
        if not person_ids_base:
            return []

        # Build AG -> parent maps for both years
        ag_parent_base: dict[int, int] = {}
        for sid, session in sessions_base.items():
            if getattr(session, "session_type", None) == "ag":
                parent_id = getattr(session, "parent_id", None)
                if parent_id:
                    ag_parent_base[int(sid)] = int(parent_id)

        ag_parent_compare: dict[int, int] = {}
        for sid, session in sessions_compare.items():
            if getattr(session, "session_type", None) == "ag":
                parent_id = getattr(session, "parent_id", None)
                if parent_id:
                    ag_parent_compare[int(sid)] = int(parent_id)

        # Count flows: (base_session_cm_id, compare_session_cm_id) -> count
        # -1 sentinel represents "Did Not Return"
        dnr = -1
        flow_counts: dict[tuple[int, int], int] = {}

        for pid in person_ids_base:
            # Get base year sessions for this person (with AG merged)
            base_sids = attendee_sessions_base.get(pid, [])
            merged_base_sids = {ag_parent_base.get(sid, sid) for sid in base_sids}

            if pid not in person_ids_compare_unfiltered:
                # Person did not return - create "Did Not Return" flows
                for base_sid in merged_base_sids:
                    key = (base_sid, dnr)
                    flow_counts[key] = flow_counts.get(key, 0) + 1
            else:
                # Person returned - create flows to compare year sessions
                compare_sids = compare_attendee_sessions.get(pid, [])
                merged_compare_sids = {ag_parent_compare.get(sid, sid) for sid in compare_sids}

                for base_sid in merged_base_sids:
                    if merged_compare_sids:
                        for compare_sid in merged_compare_sids:
                            key = (base_sid, compare_sid)
                            flow_counts[key] = flow_counts.get(key, 0) + 1
                    else:
                        # Returned but no compare sessions found (edge case)
                        key = (base_sid, dnr)
                        flow_counts[key] = flow_counts.get(key, 0) + 1

        # Convert to SessionFlowItem list with name lookups
        result: list[SessionFlowItem] = []
        for (base_sid, compare_sid), count in flow_counts.items():
            # Look up source name
            base_session = sessions_base.get(base_sid)
            if not base_session:
                continue
            source_type = getattr(base_session, "session_type", None)
            if source_type not in DISPLAY_SESSION_TYPES or source_type == "ag":
                continue
            source_name = getattr(base_session, "name", f"Session {base_sid}")

            # Look up target name
            if compare_sid == dnr:
                target_name = "Did Not Return"
            else:
                compare_session = sessions_compare.get(compare_sid)
                if not compare_session:
                    continue
                target_type = getattr(compare_session, "session_type", None)
                if target_type not in DISPLAY_SESSION_TYPES or target_type == "ag":
                    continue
                target_name = getattr(compare_session, "name", f"Session {compare_sid}")

            result.append(
                SessionFlowItem(
                    source=source_name,
                    target=target_name,
                    value=count,
                    source_cm_id=base_sid,
                    target_cm_id=compare_sid if compare_sid != dnr else None,
                )
            )

        # Sort by value descending
        result.sort(key=lambda x: -x.value)
        return result

    def _build_session_bunk_breakdown(
        self,
        person_ids: set[int],
        returned_ids: set[int],
        bunk_assignments: list[Any],
        sessions: dict[int, Any],
    ) -> list[RetentionBySessionBunk]:
        """Build session+bunk breakdown from bunk_assignments records.

        Each bunk_assignment has expand with person, session, bunk.
        AG sessions are merged into their parent session name.

        Args:
            person_ids: Set of person IDs in base year.
            returned_ids: Set of person IDs who returned.
            bunk_assignments: List of bunk_assignment records with expansion.
            sessions: Dict of sessions keyed by cm_id for AG parent lookup.

        Returns:
            List of all RetentionBySessionBunk models sorted by base count descending.
        """
        session_bunk_stats: dict[tuple[str, str], dict[str, int]] = {}

        for record in bunk_assignments:
            # Extract person cm_id
            person_data = get_person_from_expand(record)
            pid = getattr(person_data, "cm_id", None) if person_data else None
            if pid is None or int(pid) not in person_ids:
                continue
            pid = int(pid)

            # Extract session info
            session_data = get_session_from_expand(record)
            if not session_data:
                continue
            session_name = getattr(session_data, "name", "") or ""
            session_type = getattr(session_data, "session_type", None)

            # Filter to bunk-relevant session types only
            if session_type not in BUNK_SESSION_TYPES:
                continue

            # AG merging: use parent session name
            if session_type == "ag":
                parent_id = getattr(session_data, "parent_id", None)
                if parent_id:
                    parent_session = sessions.get(int(parent_id))
                    if parent_session:
                        session_name = getattr(parent_session, "name", session_name)

            # Extract bunk name
            expand = getattr(record, "expand", {}) or {}
            bunk_data = expand.get("bunk") if isinstance(expand, dict) else getattr(expand, "bunk", None)
            bunk_name = getattr(bunk_data, "name", "") if bunk_data else ""

            if session_name and bunk_name:
                key = (session_name, bunk_name)
                if key not in session_bunk_stats:
                    session_bunk_stats[key] = {"base": 0, "returned": 0}
                session_bunk_stats[key]["base"] += 1
                if pid in returned_ids:
                    session_bunk_stats[key]["returned"] += 1

        # Sort by base_count descending
        sorted_items = sorted(session_bunk_stats.items(), key=lambda x: -x[1]["base"])

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
