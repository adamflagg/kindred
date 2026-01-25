"""Camper history computation module.

Computes denormalized camper history with pre-joined data and retention metrics.
One row per camper-year for nonprofit reporting.

Data flow:
1. Query enrolled attendees for the target year
2. Get person demographics (name, school, city, grade)
3. Get bunk assignments for the year
4. Compute retention metrics (is_returning, years_at_camp, prior_year_*, retention_next_year)
5. Write to camper_history collection in PocketBase
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from pocketbase import PocketBase

logger = logging.getLogger(__name__)


@dataclass
class CamperHistoryRecord:
    """Represents a single camper history record (one row per camper-year)."""

    person_id: int  # CampMinder ID
    first_name: str
    last_name: str
    year: int

    # Aggregated session/bunk data (comma-separated for multi-session)
    sessions: str | None
    bunks: str | None

    # Demographics
    school: str | None
    city: str | None
    grade: int | None

    # Retention metrics
    is_returning: bool  # Was enrolled in year - 1
    years_at_camp: int  # Count of distinct enrollment years
    prior_year_sessions: str | None  # Sessions from year - 1
    prior_year_bunks: str | None  # Bunks from year - 1
    retention_next_year: bool | None  # Enrolled in year + 1 (None if no data yet)


class DataContextProtocol(Protocol):
    """Protocol for data access context - allows mocking in tests."""

    def get_attendees_for_year(self, year: int) -> list[dict[str, Any]]: ...
    def get_persons_by_ids(self, person_ids: list[int]) -> list[dict[str, Any]]: ...
    def get_bunk_assignments_for_year(self, year: int) -> list[dict[str, Any]]: ...
    def get_attendees_for_years(self, years: list[int], person_ids: list[int]) -> list[dict[str, Any]]: ...
    def get_attendees_for_next_year(self, year: int, person_ids: list[int]) -> list[dict[str, Any]]: ...
    def has_data_for_year(self, year: int) -> bool: ...


class PocketBaseDataContext:
    """Data context implementation using PocketBase directly."""

    def __init__(self, pb_client: PocketBase, year: int):
        self.pb = pb_client
        self.year = year

    def get_attendees_for_year(self, year: int) -> list[dict[str, Any]]:
        """Get all enrolled attendees for a specific year."""
        try:
            # Filter for enrolled campers only (is_active = true AND status = enrolled)
            filter_str = f"year = {year} && status = 'enrolled' && is_active = true"
            result = self.pb.collection("attendees").get_full_list(
                query_params={"filter": filter_str, "expand": "session,person"}
            )

            attendees = []
            for item in result:
                expand = getattr(item, "expand", {}) or {}
                session = expand.get("session")

                attendees.append(
                    {
                        "person_id": getattr(item, "person_id", None),
                        "year": getattr(item, "year", None),
                        "session": {
                            "cm_id": getattr(session, "cm_id", None) if session else None,
                            "name": getattr(session, "name", None) if session else None,
                        },
                        "status": getattr(item, "status", None),
                        "person_pb_id": getattr(item, "person", None),
                    }
                )
            return attendees
        except Exception as e:
            logger.error(f"Error fetching attendees for year {year}: {e}")
            return []

    def get_persons_by_ids(self, person_ids: list[int]) -> list[dict[str, Any]]:
        """Get person records by CampMinder IDs."""
        if not person_ids:
            return []

        try:
            # Build OR filter for person IDs
            or_conditions = [f"cm_id = {pid}" for pid in person_ids]
            filter_str = " || ".join(or_conditions)

            result = self.pb.collection("persons").get_full_list(query_params={"filter": f"({filter_str})"})

            return [
                {
                    "cm_id": getattr(item, "cm_id", None),
                    "first_name": getattr(item, "first_name", None),
                    "last_name": getattr(item, "last_name", None),
                    "school": getattr(item, "school", None),
                    "city": getattr(item, "city", None),
                    "grade": getattr(item, "grade", None),
                }
                for item in result
            ]
        except Exception as e:
            logger.error(f"Error fetching persons: {e}")
            return []

    def get_bunk_assignments_for_year(self, year: int) -> list[dict[str, Any]]:
        """Get bunk assignments for a specific year."""
        try:
            filter_str = f"year = {year} && is_deleted = false"
            result = self.pb.collection("bunk_assignments").get_full_list(
                query_params={"filter": filter_str, "expand": "session,bunk,person"}
            )

            assignments = []
            for item in result:
                expand = getattr(item, "expand", {}) or {}
                session = expand.get("session")
                bunk = expand.get("bunk")
                person = expand.get("person")

                person_id = getattr(person, "cm_id", None) if person else None

                assignments.append(
                    {
                        "person_id": person_id,
                        "year": getattr(item, "year", None),
                        "session": {"cm_id": getattr(session, "cm_id", None) if session else None},
                        "bunk": {"name": getattr(bunk, "name", None) if bunk else None},
                    }
                )
            return assignments
        except Exception as e:
            logger.error(f"Error fetching bunk assignments for year {year}: {e}")
            return []

    def get_attendees_for_years(self, years: list[int], person_ids: list[int]) -> list[dict[str, Any]]:
        """Get attendees for specific years and persons (for historical lookup)."""
        if not years or not person_ids:
            return []

        try:
            year_conditions = " || ".join([f"year = {y}" for y in years])
            person_conditions = " || ".join([f"person_id = {pid}" for pid in person_ids])
            filter_str = f"({year_conditions}) && ({person_conditions}) && status = 'enrolled'"

            result = self.pb.collection("attendees").get_full_list(
                query_params={"filter": filter_str, "expand": "session"}
            )

            return [
                {
                    "person_id": getattr(item, "person_id", None),
                    "year": getattr(item, "year", None),
                    "session": {
                        "cm_id": getattr((getattr(item, "expand", {}) or {}).get("session"), "cm_id", None),
                        "name": getattr((getattr(item, "expand", {}) or {}).get("session"), "name", None),
                    },
                    "status": getattr(item, "status", None),
                }
                for item in result
            ]
        except Exception as e:
            logger.error(f"Error fetching historical attendees: {e}")
            return []

    def get_attendees_for_next_year(self, year: int, person_ids: list[int]) -> list[dict[str, Any]]:
        """Get attendees for the next year (for retention calculation)."""
        return self.get_attendees_for_years([year + 1], person_ids)

    def has_data_for_year(self, year: int) -> bool:
        """Check if any attendee data exists for a year."""
        try:
            result = self.pb.collection("attendees").get_list(
                page=1, per_page=1, query_params={"filter": f"year = {year}"}
            )
            return len(result.items) > 0
        except Exception:
            return False


class CamperHistoryComputer:
    """Computes camper history records for a specific year."""

    _ctx: DataContextProtocol

    def __init__(self, year: int, data_context: DataContextProtocol | PocketBase):
        """Initialize computer with year and data context.

        Args:
            year: The year to compute history for.
            data_context: Either a DataContextProtocol implementation or a PocketBase client.
        """
        self.year = year

        # Handle both DataContextProtocol and raw PocketBase client
        if hasattr(data_context, "get_attendees_for_year"):
            self._ctx = data_context  # type: ignore[assignment]
        else:
            # Assume it's a PocketBase client
            self._ctx = PocketBaseDataContext(data_context, year)

    def compute_all(self) -> list[CamperHistoryRecord]:
        """Compute history records for all enrolled campers in the year.

        Returns:
            List of CamperHistoryRecord objects.
        """
        logger.info(f"Computing camper history for year {self.year}")

        # Step 1: Get enrolled attendees for the year
        attendees = self._ctx.get_attendees_for_year(self.year)
        logger.info(f"Found {len(attendees)} enrolled attendees")

        # Filter to only enrolled status
        enrolled_attendees = [a for a in attendees if a.get("status") == "enrolled"]

        if not enrolled_attendees:
            logger.warning("No enrolled attendees found")
            return []

        # Step 2: Group attendees by person (handle multi-session campers)
        persons_data: dict[int, dict[str, Any]] = {}
        for attendee in enrolled_attendees:
            person_id = attendee.get("person_id")
            if person_id is None:
                continue

            if person_id not in persons_data:
                persons_data[person_id] = {
                    "sessions": [],
                    "session_names": [],
                }

            session = attendee.get("session", {})
            session_name = session.get("name")
            if session_name and session_name not in persons_data[person_id]["session_names"]:
                persons_data[person_id]["session_names"].append(session_name)
                persons_data[person_id]["sessions"].append(session.get("cm_id"))

        person_ids = list(persons_data.keys())
        logger.info(f"Found {len(person_ids)} unique campers")

        # Step 3: Get person demographics
        persons = self._ctx.get_persons_by_ids(person_ids)
        persons_by_id = {p["cm_id"]: p for p in persons}

        # Step 4: Get bunk assignments for the year
        bunk_assignments = self._ctx.get_bunk_assignments_for_year(self.year)
        bunks_by_person: dict[int, list[str]] = {}
        for assignment in bunk_assignments:
            person_id = assignment.get("person_id")
            bunk_name = assignment.get("bunk", {}).get("name")
            if person_id and bunk_name:
                if person_id not in bunks_by_person:
                    bunks_by_person[person_id] = []
                if bunk_name not in bunks_by_person[person_id]:
                    bunks_by_person[person_id].append(bunk_name)

        # Step 5: Get historical data for retention metrics
        # Query all years up to current (for years_at_camp calculation)
        historical_years = list(range(2010, self.year))  # All years before current
        historical_attendees = self._ctx.get_attendees_for_years(historical_years, person_ids)

        # Group historical data by person
        historical_by_person: dict[int, dict[int, list[str]]] = {}  # person_id -> year -> sessions
        for attendee in historical_attendees:
            person_id = attendee.get("person_id")
            year = attendee.get("year")
            session_name = attendee.get("session", {}).get("name")
            if person_id and year:
                if person_id not in historical_by_person:
                    historical_by_person[person_id] = {}
                if year not in historical_by_person[person_id]:
                    historical_by_person[person_id][year] = []
                if session_name and session_name not in historical_by_person[person_id][year]:
                    historical_by_person[person_id][year].append(session_name)

        # Get prior year bunk assignments
        prior_year = self.year - 1
        prior_bunk_assignments = self._ctx.get_bunk_assignments_for_year(prior_year)
        prior_bunks_by_person: dict[int, list[str]] = {}
        for assignment in prior_bunk_assignments:
            person_id = assignment.get("person_id")
            bunk_name = assignment.get("bunk", {}).get("name")
            if person_id and bunk_name:
                if person_id not in prior_bunks_by_person:
                    prior_bunks_by_person[person_id] = []
                if bunk_name not in prior_bunks_by_person[person_id]:
                    prior_bunks_by_person[person_id].append(bunk_name)

        # Step 6: Check for next year retention (if data exists)
        has_next_year_data = self._ctx.has_data_for_year(self.year + 1)
        next_year_attendees = []
        next_year_person_ids: set[int] = set()
        if has_next_year_data:
            next_year_attendees = self._ctx.get_attendees_for_next_year(self.year, person_ids)
            next_year_person_ids = {int(pid) for a in next_year_attendees if (pid := a.get("person_id")) is not None}

        # Step 7: Build records
        records: list[CamperHistoryRecord] = []
        for person_id, data in persons_data.items():
            person = persons_by_id.get(person_id, {})

            # Calculate retention metrics
            historical_years_enrolled = set(historical_by_person.get(person_id, {}).keys())
            is_returning = prior_year in historical_years_enrolled
            years_at_camp = len(historical_years_enrolled) + 1  # +1 for current year

            # Prior year data
            prior_year_sessions = None
            prior_year_bunks = None
            if is_returning:
                prior_sessions = historical_by_person.get(person_id, {}).get(prior_year, [])
                if prior_sessions:
                    prior_year_sessions = ", ".join(sorted(prior_sessions))
                prior_bunks = prior_bunks_by_person.get(person_id, [])
                if prior_bunks:
                    prior_year_bunks = ", ".join(sorted(prior_bunks))

            # Next year retention
            retention_next_year: bool | None = None
            if has_next_year_data:
                retention_next_year = person_id in next_year_person_ids

            # Build record
            record = CamperHistoryRecord(
                person_id=person_id,
                first_name=person.get("first_name", ""),
                last_name=person.get("last_name", ""),
                year=self.year,
                sessions=", ".join(sorted(data["session_names"])) if data["session_names"] else None,
                bunks=", ".join(sorted(bunks_by_person.get(person_id, []))) if bunks_by_person.get(person_id) else None,
                school=person.get("school"),
                city=person.get("city"),
                grade=person.get("grade"),
                is_returning=is_returning,
                years_at_camp=years_at_camp,
                prior_year_sessions=prior_year_sessions,
                prior_year_bunks=prior_year_bunks,
                retention_next_year=retention_next_year,
            )
            records.append(record)

        logger.info(f"Computed {len(records)} camper history records")
        return records


class CamperHistoryWriter:
    """Writes camper history records to PocketBase."""

    def __init__(self, pb_client: PocketBase):
        self.pb = pb_client

    def write_records(
        self, records: list[CamperHistoryRecord], year: int, clear_existing: bool = True, dry_run: bool = False
    ) -> dict[str, Any]:
        """Write records to PocketBase camper_history collection.

        Args:
            records: List of CamperHistoryRecord to write.
            year: The year being processed (used for clearing existing).
            clear_existing: If True, delete existing records for the year first.
            dry_run: If True, don't actually write to database.

        Returns:
            Dict with stats: created, deleted, errors, dry_run.
        """
        stats = {"created": 0, "deleted": 0, "errors": 0, "dry_run": dry_run}

        if dry_run:
            logger.info(f"Dry run mode - would write {len(records)} records for year {year}")
            stats["created"] = len(records)
            return stats

        # Clear existing records for the year if requested
        if clear_existing:
            deleted = self._clear_existing(year)
            stats["deleted"] = deleted
            logger.info(f"Deleted {deleted} existing records for year {year}")

        # Write new records
        collection = self.pb.collection("camper_history")
        for record in records:
            try:
                collection.create(
                    {
                        "person_id": record.person_id,
                        "first_name": record.first_name,
                        "last_name": record.last_name,
                        "year": record.year,
                        "sessions": record.sessions,
                        "bunks": record.bunks,
                        "school": record.school,
                        "city": record.city,
                        "grade": record.grade,
                        "is_returning": record.is_returning,
                        "years_at_camp": record.years_at_camp,
                        "prior_year_sessions": record.prior_year_sessions,
                        "prior_year_bunks": record.prior_year_bunks,
                        "retention_next_year": record.retention_next_year,
                    }
                )
                stats["created"] += 1
            except Exception as e:
                logger.error(f"Error creating record for person {record.person_id}: {e}")
                stats["errors"] += 1

        logger.info(f"Created {stats['created']} records, {stats['errors']} errors")
        return stats

    def _clear_existing(self, year: int) -> int:
        """Delete existing records for a year.

        Returns:
            Number of records deleted.
        """
        deleted = 0
        try:
            collection = self.pb.collection("camper_history")
            # Get all records for the year
            existing = collection.get_full_list(query_params={"filter": f"year = {year}"})

            for record in existing:
                try:
                    collection.delete(record.id)
                    deleted += 1
                except Exception as e:
                    logger.error(f"Error deleting record {record.id}: {e}")

        except Exception as e:
            logger.error(f"Error fetching existing records: {e}")

        return deleted
