"""Data access layer for metrics.

This module isolates all PocketBase interactions for the metrics endpoints,
enabling dependency injection and testability.
"""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pocketbase import PocketBase

logger = logging.getLogger(__name__)


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
    ) -> list[Any]:
        """Fetch attendees for a given year with optional status filter.

        Args:
            year: The year to fetch attendees for.
            status_filter: Optional status filter. Can be:
                - None: fetches active enrolled (is_active=1 AND status_id=2)
                - str: single status (e.g., 'waitlisted', 'applied', 'cancelled')
                - list[str]: multiple statuses (e.g., ['enrolled', 'waitlisted'])

        Returns:
            List of attendee records with session expansion.
        """
        if status_filter is None:
            # Default: active enrolled
            filter_str = f"year = {year} && is_active = 1 && status_id = 2"
        elif isinstance(status_filter, list):
            # Multiple statuses - build OR filter
            status_conditions = " || ".join(f'status = "{s}"' for s in status_filter)
            filter_str = f"year = {year} && ({status_conditions})"
        elif status_filter == "enrolled":
            # Enrolled uses the strict is_active + status_id filter
            filter_str = f"year = {year} && is_active = 1 && status_id = 2"
        else:
            # Single non-enrolled status
            filter_str = f'year = {year} && status = "{status_filter}"'

        return await asyncio.to_thread(
            self.pb.collection("attendees").get_full_list,
            query_params={"filter": filter_str, "expand": "session"},
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
            self.pb.collection("persons").get_full_list,
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
            self.pb.collection("camp_sessions").get_full_list,
            query_params={"filter": filter_str},
        )
        # Ensure int keys for consistent lookup
        return {int(getattr(s, "cm_id", 0)): s for s in sessions}

    async def fetch_camper_history(
        self,
        year: int,
        session_types: list[str] | None = None,
        session_name: str | None = None,
    ) -> list[Any]:
        """Fetch camper_history records for a given year.

        V2: Uses direct PocketBase filtering on session_type (select field).
        Each record has a single session_type, no comma-separated parsing needed.

        Args:
            year: The year to fetch records for.
            session_types: Optional list of session types to filter.
            session_name: Optional session name to filter by. Used for
                cross-year filtering where the same session name appears
                across multiple years with different cm_ids.

        Returns:
            List of camper_history records. Returns empty list on error.
        """
        try:
            filter_str = f"year = {year}"

            # V2: Direct filter on session_type select field (no string parsing)
            if session_types:
                type_filter = " || ".join(f'session_type = "{t}"' for t in session_types)
                filter_str = f"({filter_str}) && ({type_filter})"

            # Filter by session name for cross-year filtering
            if session_name:
                # Escape quotes in session name for PocketBase filter
                escaped_name = session_name.replace('"', '\\"')
                filter_str = f'({filter_str}) && session_name = "{escaped_name}"'

            records = await asyncio.to_thread(
                self.pb.collection("camper_history").get_full_list,
                query_params={"filter": filter_str},
            )

            return records
        except Exception as e:
            logger.warning(f"Could not fetch camper_history for year {year}: {e}")
            return []

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

        for i in range(0, len(sorted_ids), self.BATCH_SIZE):
            batch_ids = sorted_ids[i : i + self.BATCH_SIZE]
            person_filter = " || ".join(f"person_id = {pid}" for pid in batch_ids)
            filter_str = f"({person_filter}) && status_id = 2 && year <= {max_year}"

            batch_results = await asyncio.to_thread(
                self.pb.collection("attendees").get_full_list,
                query_params={"filter": filter_str, "expand": "session"},
            )
            all_results.extend(batch_results)

        return all_results

    def build_history_by_person(self, records: list[Any]) -> dict[int, Any]:
        """Build a dictionary mapping person_id to ONE camper_history record.

        V2 Note: With per-session records, one person may have multiple records.
        This method returns just one record per person (the first found), which is
        sufficient for person-level demographics (school, city, gender, etc.) that
        are the same across all sessions for a person.

        For session-specific data (session_name, bunk_name), iterate over the full
        records list instead of using this method.

        Args:
            records: List of camper_history records.

        Returns:
            Dictionary mapping person_id (int) to one record (first found).
        """
        result: dict[int, Any] = {}
        for record in records:
            person_id = getattr(record, "person_id", None)
            if person_id is not None:
                pid = int(person_id)
                # Keep first record found (demographics are same across sessions)
                if pid not in result:
                    result[pid] = record
        return result

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
            self.pb.collection("bunk_plans").get_full_list,
            query_params={"filter": filter_str, "expand": "bunk"},
        )

    async def fetch_capacity_config(self) -> int:
        """Fetch default cabin capacity from config table.

        Looks for category="constraint", subcategory="cabin_capacity", key="default".

        Returns:
            Default capacity value (12 if config not found).
        """
        try:
            config = await asyncio.to_thread(
                self.pb.collection("config").get_first_list_item,
                'category = "constraint" && subcategory = "cabin_capacity" && config_key = "default"',
            )
            return int(config.value) if config and config.value else 12
        except Exception:
            # Config not found or error - return default
            return 12

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
            filter_str = f"year = {year} && is_active = 1 && status_id = 2"
        elif isinstance(status_filter, list):
            status_conditions = " || ".join(f'status = "{s}"' for s in status_filter)
            filter_str = f"year = {year} && ({status_conditions})"
        else:
            filter_str = f'year = {year} && status = "{status_filter}"'

        # Note: session_types filtering is handled at the service layer
        # by joining with sessions data, since attendees don't have session_type directly

        return await asyncio.to_thread(
            self.pb.collection("attendees").get_full_list,
            query_params={"filter": filter_str, "expand": "person,session"},
        )

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
                self.pb.collection("field_definitions").get_first_list_item,
                'name = "Synagogue"',
            )
        except Exception as e:
            logger.debug(f"Synagogue field definition not found: {e}")
            return {}

        try:
            # Fetch household_custom_values for this field with household expansion
            filter_str = f'field = "{field_def.id}" && year = {year}'
            custom_values = await asyncio.to_thread(
                self.pb.collection("household_custom_values").get_full_list,
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

    async def fetch_congregation_by_person(self, year: int) -> dict[int, str]:
        """Fetch congregation values from person_custom_values.

        Uses "HH-Name of Congregation" field which has much richer data
        than the household-level "Synagogue" field.

        Args:
            year: The year to filter custom values for.

        Returns:
            Dictionary mapping person cm_id (int) to congregation name (str).
            Returns empty dict if the field is not found or has no data.
        """
        try:
            # Find the "HH-Name of Congregation" field definition
            field_def = await asyncio.to_thread(
                self.pb.collection("custom_field_defs").get_first_list_item,
                'name = "HH-Name of Congregation"',
            )
        except Exception as e:
            logger.debug(f"HH-Name of Congregation field not found: {e}")
            return {}

        try:
            filter_str = f'field_definition = "{field_def.id}" && year = {year} && value != ""'
            custom_values = await asyncio.to_thread(
                self.pb.collection("person_custom_values").get_full_list,
                query_params={"filter": filter_str, "expand": "person"},
            )

            result: dict[int, str] = {}
            for cv in custom_values:
                value = getattr(cv, "value", "")
                if not value:
                    continue
                expand = getattr(cv, "expand", {})
                person = expand.get("person") if expand else None
                if person:
                    person_cm_id = getattr(person, "cm_id", None)
                    if person_cm_id is not None:
                        result[int(person_cm_id)] = value

            return result
        except Exception as e:
            logger.warning(f"Error fetching congregation custom values: {e}")
            return {}
