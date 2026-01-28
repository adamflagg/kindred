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
    ) -> list[Any]:
        """Fetch camper_history records for a given year.

        Args:
            year: The year to fetch records for.
            session_types: Optional list of session types to filter.

        Returns:
            List of camper_history records. Returns empty list on error.
        """
        try:
            filter_str = f"year = {year}"

            records = await asyncio.to_thread(
                self.pb.collection("camper_history").get_full_list,
                query_params={"filter": filter_str},
            )

            # Filter by session_types if provided
            if session_types:
                filtered = []
                for record in records:
                    record_types = getattr(record, "session_types", "") or ""
                    if record_types:
                        record_type_list = [t.strip() for t in record_types.split(",")]
                        if any(rt in session_types for rt in record_type_list):
                            filtered.append(record)
                return filtered

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
        """Build a dictionary mapping person_id to camper_history record.

        Args:
            records: List of camper_history records.

        Returns:
            Dictionary mapping person_id (int) to record.
        """
        result: dict[int, Any] = {}
        for record in records:
            person_id = getattr(record, "person_id", None)
            if person_id is not None:
                result[int(person_id)] = record
        return result
