"""Data access layer for metrics.

This module isolates all PocketBase interactions for the metrics endpoints,
enabling dependency injection and testability.
"""

from __future__ import annotations

import asyncio
from itertools import batched
from typing import TYPE_CHECKING, Any

from api.constants.collections import (
    ATTENDEE_STATUS_HISTORY,
    ATTENDEES,
    BUNK_ASSIGNMENTS,
    BUNK_PLANS,
    CAMP_SESSIONS,
    CONFIG,
    ENROLLMENT_SNAPSHOTS,
    FIELD_DEFINITIONS,
    HOUSEHOLD_CUSTOM_VALUES,
    PERSONS,
)
from api.constants.filters import ACTIVE_ENROLLED_FILTER
from api.services.reconstruction import parse_date_only
from bunking.logging_config import get_logger
from bunking.solver.constants import DEFAULT_BUNK_CAPACITY

if TYPE_CHECKING:
    from pocketbase import PocketBase

logger = get_logger(__name__)


class MetricsRepository:
    """Data access layer for metrics - enables mocking in tests.

    All methods that interact with PocketBase are isolated here,
    allowing the service layer to be tested with mocked data.
    """

    # Batch size for person ID queries to avoid overly long filter strings
    BATCH_SIZE = 100

    def __init__(self, pb: PocketBase) -> None:
        """Initialize with PocketBase client.

        Args:
            pb: PocketBase client instance.
        """
        self.pb = pb

    async def fetch_attendees(
        self,
        year: int,
        status_filter: str | list[str] | None = None,
        expand_person: bool = False,
    ) -> list[Any]:
        """Fetch attendees for a given year with optional status filter.

        Args:
            year: The year to fetch attendees for.
            status_filter: Optional status filter. Can be:
                - None: fetches active enrolled (status_id=2)
                - str: single status (e.g., 'waitlisted', 'applied', 'cancelled')
                - list[str]: multiple statuses (e.g., ['enrolled', 'waitlisted'])

        Returns:
            List of attendee records with session expansion.
        """
        if status_filter is None:
            # Default: active enrolled
            filter_str = f"year = {year} && {ACTIVE_ENROLLED_FILTER}"
        elif isinstance(status_filter, list):
            # Multiple statuses - build OR filter
            status_conditions = " || ".join(f'status = "{s}"' for s in status_filter)
            filter_str = f"year = {year} && ({status_conditions})"
        elif status_filter == "enrolled":
            # Enrolled uses the strict status_id filter
            filter_str = f"year = {year} && {ACTIVE_ENROLLED_FILTER}"
        else:
            # Single non-enrolled status
            filter_str = f'year = {year} && status = "{status_filter}"'

        expand = "person,session" if expand_person else "session"
        return await asyncio.to_thread(
            self.pb.collection(ATTENDEES).get_full_list,
            query_params={"filter": filter_str, "expand": expand},
        )

    async def fetch_persons(self, year: int) -> dict[int, Any]:
        """Fetch all persons for a given year and return as dict by cm_id.

        Returns a dict keyed by cm_id (CampMinder ID) with int keys for consistent
        lookup against attendees.person_id values.

        Args:
            year: The year to fetch persons for.

        Returns:
            Dictionary mapping cm_id (int) to person record.
        """
        persons = await asyncio.to_thread(
            self.pb.collection(PERSONS).get_full_list,
            query_params={"filter": f"year = {year}"},
        )
        # Ensure int keys for consistent lookup (PocketBase may return float)
        return {int(getattr(p, "cm_id", 0)): p for p in persons}

    async def fetch_sessions(
        self,
        year: int,
        session_types: list[str] | None = None,
    ) -> dict[int, Any]:
        """Fetch sessions for a given year and return as dict by cm_id.

        Args:
            year: The year to fetch sessions for.
            session_types: Optional list of session types to filter.

        Returns:
            Dictionary mapping cm_id (int) to session record.
        """
        filter_str = f"year = {year}"
        if session_types:
            type_filter = " || ".join(f'session_type = "{t}"' for t in session_types)
            filter_str = f"({filter_str}) && ({type_filter})"

        sessions = await asyncio.to_thread(
            self.pb.collection(CAMP_SESSIONS).get_full_list,
            query_params={"filter": filter_str},
        )
        # Ensure int keys for consistent lookup
        return {int(getattr(s, "cm_id", 0)): s for s in sessions}

    async def fetch_bunk_assignments(self, year: int) -> list[Any]:
        """Fetch bunk_assignments with person, session, and bunk expansion.

        Used for session-bunk retention breakdown. Each record represents
        one camper's bunk assignment for a session.

        Args:
            year: The year to fetch assignments for.

        Returns:
            List of bunk_assignment records with person, session, bunk expansion.
        """
        return await asyncio.to_thread(
            self.pb.collection(BUNK_ASSIGNMENTS).get_full_list,
            query_params={"filter": f"year = {year}", "expand": "person,session,bunk"},
        )

    async def fetch_summer_enrollment_history(
        self,
        person_ids: set[int],
        max_year: int,
    ) -> list[Any]:
        """Fetch ALL summer enrollments for given persons in batched queries.

        This enables calculating years of summer enrollment, first summer year,
        and prior year sessions.

        Args:
            person_ids: Set of person_ids to fetch history for.
            max_year: Maximum year to include (typically the base year).

        Returns:
            List of attendee records with session expansion.
        """
        if not person_ids:
            return []

        sorted_ids = sorted(person_ids)
        all_results: list[Any] = []

        for batch_ids in batched(sorted_ids, self.BATCH_SIZE, strict=False):
            person_filter = " || ".join(f"person_id = {pid}" for pid in batch_ids)
            filter_str = f"({person_filter}) && status_id = 2 && year <= {max_year}"

            batch_results = await asyncio.to_thread(
                self.pb.collection(ATTENDEES).get_full_list,
                query_params={"filter": filter_str, "expand": "session"},
            )
            all_results.extend(batch_results)

        return all_results

    async def fetch_bunk_plans(
        self,
        year: int,
        session_pb_ids: list[str] | None = None,
    ) -> list[Any]:
        """Fetch bunk_plans with bunk expansion for capacity calculation.

        Args:
            year: The year to fetch bunk_plans for.
            session_pb_ids: Optional list of session PocketBase IDs to filter.

        Returns:
            List of bunk_plan records with bunk expansion.
        """
        filter_str = f"year = {year}"
        if session_pb_ids:
            session_filter = " || ".join(f'session = "{sid}"' for sid in session_pb_ids)
            filter_str = f"({filter_str}) && ({session_filter})"

        return await asyncio.to_thread(
            self.pb.collection(BUNK_PLANS).get_full_list,
            query_params={"filter": filter_str, "expand": "bunk"},
        )

    async def fetch_capacity_config(self) -> int:
        """Return the default bunk capacity.

        Phase 2 cabin-capacity cleanup: previously queried
        ``category="constraint" && subcategory="cabin_capacity" && config_key="default"``
        which was never seeded (the seed row used ``config_key="standard"``),
        so this always silently fell back to 12. Now returns the
        ``DEFAULT_BUNK_CAPACITY`` constant directly.
        """
        return DEFAULT_BUNK_CAPACITY

    async def fetch_attendees_with_persons(
        self,
        year: int,
        session_types: list[str] | None = None,
        status_filter: str | list[str] | None = None,
    ) -> list[Any]:
        """Fetch attendees with person expansion for geographic demographics.

        This enables getting school/city directly from person records without
        requiring the camper_history sync.

        Args:
            year: The year to fetch attendees for.
            session_types: Optional list of session types to filter.
            status_filter: Optional status filter (defaults to enrolled).

        Returns:
            List of attendee records with person expansion.
        """
        # Build status filter
        if status_filter is None or status_filter == "enrolled":
            filter_str = f"year = {year} && {ACTIVE_ENROLLED_FILTER}"
        elif isinstance(status_filter, list):
            status_conditions = " || ".join(f'status = "{s}"' for s in status_filter)
            filter_str = f"year = {year} && ({status_conditions})"
        else:
            filter_str = f'year = {year} && status = "{status_filter}"'

        # Note: session_types filtering is handled at the service layer
        # by joining with sessions data, since attendees don't have session_type directly

        return await asyncio.to_thread(
            self.pb.collection(ATTENDEES).get_full_list,
            query_params={"filter": filter_str, "expand": "person,session"},
        )

    async def fetch_status_history(
        self,
        year: int,
        old_status: str | None = None,
        new_statuses: list[str] | None = None,
    ) -> list[Any]:
        """Fetch attendee status history records for transition analysis.

        Args:
            year: The year to fetch history for.
            old_status: The previous status to filter on. None = all old statuses.
            new_statuses: List of new statuses to include (e.g., ['enrolled']).

        Returns:
            List of attendee_status_history records with session/person expansion.
        """
        try:
            filters = [f"year = {year}"]
            if old_status is not None:
                filters.append(f'old_status = "{old_status}"')
            if new_statuses:
                new_status_filter = " || ".join(f'new_status = "{s}"' for s in new_statuses)
                filters.append(f"({new_status_filter})")
            filter_str = " && ".join(filters)

            return await asyncio.to_thread(
                self.pb.collection(ATTENDEE_STATUS_HISTORY).get_full_list,
                query_params={"filter": filter_str, "expand": "session,person"},
            )
        except Exception as e:
            logger.warning(f"Could not fetch status history: {e}")
            return []

    async def fetch_synagogue_by_household(self, year: int) -> dict[int, str]:
        """Fetch synagogue values mapped by household CampMinder ID.

        Looks up the "Synagogue" custom field from household_custom_values
        and returns a mapping from household cm_id to synagogue name.

        Args:
            year: The year to filter custom values for.

        Returns:
            Dictionary mapping household cm_id (int) to synagogue name (str).
            Returns empty dict if Synagogue field not found.
        """
        try:
            # Find the Synagogue field definition
            field_def = await asyncio.to_thread(
                self.pb.collection(FIELD_DEFINITIONS).get_first_list_item,
                'name = "Synagogue"',
            )
        except Exception as e:
            logger.debug(f"Synagogue field definition not found: {e}")
            return {}

        try:
            # Fetch household_custom_values for this field with household expansion
            filter_str = f'field = "{field_def.id}" && year = {year}'
            custom_values = await asyncio.to_thread(
                self.pb.collection(HOUSEHOLD_CUSTOM_VALUES).get_full_list,
                query_params={"filter": filter_str, "expand": "household"},
            )

            # Build mapping from household cm_id to synagogue value
            result: dict[int, str] = {}
            for cv in custom_values:
                value = getattr(cv, "value", "")
                if not value:
                    continue  # Skip empty values
                expand = getattr(cv, "expand", {})
                household = expand.get("household") if expand else None
                if household:
                    hh_cm_id = getattr(household, "cm_id", None)
                    if hh_cm_id is not None:
                        result[int(hh_cm_id)] = value

            return result
        except Exception as e:
            logger.warning(f"Error fetching synagogue custom values: {e}")
            return {}

    async def fetch_enrollment_snapshots(self, year: int, session_cm_id: int | None = None) -> list[Any]:
        """Fetch enrollment snapshots for a year, optionally filtered by session."""
        filter_str = f"year = {year}"
        if session_cm_id is not None:
            filter_str += f" && session_cm_id = {session_cm_id}"
        return await asyncio.to_thread(
            self.pb.collection(ENROLLMENT_SNAPSHOTS).get_full_list,
            query_params={"filter": filter_str, "sort": "snapshot_datetime"},
        )

    async def fetch_attendees_with_dates(
        self, year: int, session_cm_id: int | None = None, expand_person: bool = False
    ) -> list[Any]:
        """Fetch attendees that have enrollment_date set, for velocity reconstruction.

        Note: session_cm_id param is accepted for interface consistency but filtering
        happens in the service layer via expanded session relation (attendees table
        has no session_cm_id column).

        When expand_person=True, also expands the person relation to get gender.
        """
        filter_str = f"year = {year} && (enrollment_date != '' || effective_date != '')"
        expand = "session,person" if expand_person else "session"
        return await asyncio.to_thread(
            self.pb.collection(ATTENDEES).get_full_list,
            query_params={"filter": filter_str, "expand": expand},
        )

    async def fetch_status_transitions(
        self, year: int, to_statuses: list[str], expand_person: bool = False
    ) -> list[Any]:
        """Fetch status history entries where status changed TO specific statuses.

        When expand_person=True, also expands the person relation to get gender.
        """
        status_filter = " || ".join(f'new_status = "{s}"' for s in to_statuses)
        filter_str = f"year = {year} && ({status_filter})"
        expand = "session,person" if expand_person else "session"
        return await asyncio.to_thread(
            self.pb.collection(ATTENDEE_STATUS_HISTORY).get_full_list,
            query_params={"filter": filter_str, "expand": expand},
        )

    async def fetch_available_snapshot_dates(self, year: int) -> list[str]:
        """Return distinct snapshot dates for a year, sorted descending (newest first)."""
        snapshots = await asyncio.to_thread(
            self.pb.collection(ENROLLMENT_SNAPSHOTS).get_full_list,
            query_params={"filter": f"year = {year}", "sort": "-snapshot_datetime", "fields": "snapshot_datetime"},
        )
        seen: set[str] = set()
        dates: list[str] = []
        for s in snapshots:
            date_str = parse_date_only(getattr(s, "snapshot_datetime", ""))
            if date_str and date_str not in seen:
                seen.add(date_str)
                dates.append(date_str)
        return dates

    async def fetch_budget_config(self, year: int) -> dict[int | str, dict[str, Any]]:
        """Fetch budget config for all sessions and session-types.

        Keys:
          - int  : CampMinder session cm_id  (from config_key 'session_<cm_id>')
          - str  : 'type:<name>'             (from config_key 'type_<name>', e.g. teens)

        Each value is a dict with at least participant_goal and session_fee.
        """
        try:
            records = await asyncio.to_thread(
                self.pb.collection(CONFIG).get_full_list,
                query_params={
                    "filter": f'category = "budget" && subcategory = "{year}"',
                },
            )
            result: dict[int | str, dict[str, Any]] = {}
            for r in records:
                key = getattr(r, "config_key", "")
                value = getattr(r, "value", {})
                if not isinstance(value, dict):
                    continue
                if key.startswith("session_"):
                    try:
                        result[int(key.replace("session_", ""))] = value
                    except ValueError, TypeError:
                        pass
                elif key.startswith("type_"):
                    type_name = key.replace("type_", "", 1)
                    if type_name:
                        result[f"type:{type_name}"] = value
            return result
        except Exception as e:
            logger.warning(f"Could not fetch budget config for year {year}: {e}")
            return {}

    async def fetch_registration_dates(self, year: int) -> dict[str, str]:
        """Fetch registration phase dates from config table."""
        try:
            records = await asyncio.to_thread(
                self.pb.collection(CONFIG).get_full_list,
                query_params={
                    "filter": f'category = "registration" && subcategory = "{year}"',
                },
            )
            return {getattr(r, "config_key", ""): getattr(r, "value", "") for r in records}
        except Exception:
            return {}

    async def has_pre_anchor_enrollments(self, year: int, anchor_date: str) -> bool:
        """Check if any attendees have enrollment dates before the anchor.

        Mirrors get_enrollment_date priority: effective_date first, then
        enrollment_date only when effective_date is empty.  This prevents
        false positives from cancelled attendees whose enrollment_date is
        the cancel PostDate rather than the original registration date.
        """
        base = f"year = {year}"
        # 1. effective_date present and before anchor
        eff_filter = f'{base} && effective_date != "" && effective_date < "{anchor_date}"'
        try:
            records = await asyncio.to_thread(
                self.pb.collection(ATTENDEES).get_list,
                1,
                1,
                query_params={"filter": eff_filter},
            )
            if records.total_items > 0:
                return True
        except Exception:
            logger.warning("has_pre_anchor_enrollments: effective_date check failed", exc_info=True)
        # 2. effective_date empty, fall back to enrollment_date
        enr_filter = f'{base} && effective_date = "" && enrollment_date != "" && enrollment_date < "{anchor_date}"'
        try:
            records = await asyncio.to_thread(
                self.pb.collection(ATTENDEES).get_list,
                1,
                1,
                query_params={"filter": enr_filter},
            )
            if records.total_items > 0:
                return True
        except Exception:
            logger.warning("has_pre_anchor_enrollments: enrollment_date check failed", exc_info=True)
        return False
