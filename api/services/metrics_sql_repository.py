"""Direct SQLite repository for metrics — bypasses PocketBase HTTP API.

Drop-in replacement for MetricsRepository. All 16 methods return objects
with the same attribute interface (SimpleNamespace + expand dicts) that
service-layer code expects.
"""

import json
import sqlite3
from types import SimpleNamespace
from typing import Any

from bunking.logging_config import get_logger
from bunking.solver.constants import DEFAULT_BUNK_CAPACITY

from .metrics_sql_connection import get_connection

logger = get_logger(__name__)


class MetricsSQLRepository:
    """Data access layer using direct SQLite queries against PocketBase's DB.

    All methods match MetricsRepository's signatures and return types.
    Objects use SimpleNamespace with expand dicts for PocketBase-compatible
    attribute access (getattr + expand.get patterns).
    """

    BATCH_SIZE = 500  # SQLite param limit ~999; 500 leaves headroom

    def __init__(self, conn: sqlite3.Connection | None = None) -> None:
        if conn is not None:
            self._conn = conn
        else:
            self._conn = get_connection()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _query(self, sql: str, params: tuple[Any, ...] | list[Any] = ()) -> list[sqlite3.Row]:
        """Execute a read query and return all rows."""
        return self._conn.execute(sql, params).fetchall()

    @staticmethod
    def _session_ns(row: sqlite3.Row, prefix: str = "_session_") -> SimpleNamespace:
        """Build a session SimpleNamespace from prefixed columns."""
        keys = row.keys()
        data: dict[str, Any] = {}
        field_map = {
            f"{prefix}cm_id": "cm_id",
            f"{prefix}name": "name",
            f"{prefix}type": "session_type",
            f"{prefix}parent_id": "parent_id",
            f"{prefix}start_date": "start_date",
            f"{prefix}end_date": "end_date",
            f"{prefix}id": "id",
        }
        for col, attr in field_map.items():
            if col in keys:
                data[attr] = row[col]
        return SimpleNamespace(**data)

    @staticmethod
    def _person_ns(row: sqlite3.Row, prefix: str = "_person_") -> SimpleNamespace:
        """Build a person SimpleNamespace from prefixed columns."""
        keys = row.keys()
        data: dict[str, Any] = {}
        field_map = {
            f"{prefix}cm_id": "cm_id",
            f"{prefix}first_name": "first_name",
            f"{prefix}last_name": "last_name",
            f"{prefix}gender": "gender",
            f"{prefix}grade": "grade",
            f"{prefix}school": "school",
            f"{prefix}city": "address_city",
            f"{prefix}state": "address_state",
            f"{prefix}household_id": "household_id",
            f"{prefix}normalized_school": "normalized_school",
            f"{prefix}normalized_city": "normalized_city",
            f"{prefix}normalized_congregation": "normalized_congregation",
            f"{prefix}years_at_camp": "years_at_camp",
        }
        for col, attr in field_map.items():
            if col in keys:
                data[attr] = row[col]
        return SimpleNamespace(**data)

    # ------------------------------------------------------------------
    # 1. fetch_attendees
    # ------------------------------------------------------------------

    async def fetch_attendees(
        self,
        year: int,
        status_filter: str | list[str] | None = None,
        expand_person: bool = False,
    ) -> list[Any]:
        """Fetch attendees with session expansion."""
        columns = """a.person_id, a.year, a.status, a.status_id,
                       a.enrollment_date, a.effective_date,
                       cs.cm_id AS _session_cm_id, cs.name AS _session_name,
                       cs.session_type AS _session_type, cs.parent_id AS _session_parent_id,
                       cs.start_date AS _session_start_date, cs.end_date AS _session_end_date"""
        joins = "JOIN camp_sessions cs ON a.session = cs.id"
        if expand_person:
            columns += ", p.gender AS _person_gender, p.cm_id AS _person_cm_id"
            joins += "\n                LEFT JOIN persons p ON a.person = p.id"
        base = f"""
                SELECT {columns}
                FROM attendees a
                {joins}
                WHERE a.year = ?
            """
        params: list[Any] = [year]

        if status_filter is None or status_filter == "enrolled":
            base += " AND a.status_id = 2"
        elif isinstance(status_filter, list):
            placeholders = ",".join("?" for _ in status_filter)
            base += f" AND a.status IN ({placeholders})"
            params.extend(status_filter)
        else:
            base += " AND a.status = ?"
            params.append(status_filter)

        rows = self._query(base, params)
        return [
            SimpleNamespace(
                person_id=r["person_id"],
                year=r["year"],
                status=r["status"],
                status_id=r["status_id"],
                enrollment_date=r["enrollment_date"],
                effective_date=r["effective_date"],
                expand={
                    "session": self._session_ns(r),
                    **({"person": self._person_ns(r)} if expand_person else {}),
                },
            )
            for r in rows
        ]

    # ------------------------------------------------------------------
    # 2. fetch_persons
    # ------------------------------------------------------------------

    async def fetch_persons(self, year: int) -> dict[int, Any]:
        """Fetch persons as dict keyed by cm_id (int)."""
        rows = self._query(
            """SELECT cm_id, first_name, last_name, gender, grade, school,
                      normalized_school, address_city, normalized_city,
                      normalized_congregation, years_at_camp, household_id
               FROM persons WHERE year = ?""",
            (year,),
        )
        return {
            int(r["cm_id"]): SimpleNamespace(
                cm_id=int(r["cm_id"]),
                first_name=r["first_name"],
                last_name=r["last_name"],
                gender=r["gender"],
                grade=r["grade"],
                school=r["school"],
                normalized_school=r["normalized_school"],
                address_city=r["address_city"],
                normalized_city=r["normalized_city"],
                normalized_congregation=r["normalized_congregation"],
                years_at_camp=r["years_at_camp"],
                household_id=r["household_id"],
            )
            for r in rows
        }

    # ------------------------------------------------------------------
    # 3. fetch_sessions
    # ------------------------------------------------------------------

    async def fetch_sessions(
        self,
        year: int,
        session_types: list[str] | None = None,
    ) -> dict[int, Any]:
        """Fetch sessions as dict keyed by cm_id (int). Includes PB 'id'."""
        sql = """SELECT id, cm_id, name, session_type, parent_id,
                        start_date, end_date
                 FROM camp_sessions WHERE year = ?"""
        params: list[Any] = [year]

        if session_types:
            placeholders = ",".join("?" for _ in session_types)
            sql += f" AND session_type IN ({placeholders})"
            params.extend(session_types)

        rows = self._query(sql, params)
        return {
            int(r["cm_id"]): SimpleNamespace(
                id=r["id"],
                cm_id=int(r["cm_id"]),
                name=r["name"],
                session_type=r["session_type"],
                parent_id=r["parent_id"],
                start_date=r["start_date"],
                end_date=r["end_date"],
            )
            for r in rows
        }

    # ------------------------------------------------------------------
    # 4. fetch_bunk_assignments
    # ------------------------------------------------------------------

    async def fetch_bunk_assignments(self, year: int) -> list[Any]:
        """Fetch bunk assignments with person, session, bunk expansion."""
        rows = self._query(
            """SELECT ba.year,
                      p.cm_id  AS _person_cm_id,
                      p.first_name AS _person_first_name,
                      p.last_name  AS _person_last_name,
                      cs.cm_id AS _session_cm_id,
                      cs.name  AS _session_name,
                      cs.session_type AS _session_type,
                      cs.parent_id    AS _session_parent_id,
                      b.name   AS _bunk_name,
                      b.gender AS _bunk_gender
               FROM bunk_assignments ba
               JOIN persons p ON ba.person = p.id
               JOIN camp_sessions cs ON ba.session = cs.id
               JOIN bunks b ON ba.bunk = b.id
               WHERE ba.year = ?""",
            (year,),
        )
        return [
            SimpleNamespace(
                year=r["year"],
                expand={
                    "person": SimpleNamespace(
                        cm_id=r["_person_cm_id"],
                        first_name=r["_person_first_name"],
                        last_name=r["_person_last_name"],
                    ),
                    "session": SimpleNamespace(
                        cm_id=r["_session_cm_id"],
                        name=r["_session_name"],
                        session_type=r["_session_type"],
                        parent_id=r["_session_parent_id"],
                    ),
                    "bunk": SimpleNamespace(
                        name=r["_bunk_name"],
                        gender=r["_bunk_gender"],
                    ),
                },
            )
            for r in rows
        ]

    # ------------------------------------------------------------------
    # 5. fetch_summer_enrollment_history
    # ------------------------------------------------------------------

    async def fetch_summer_enrollment_history(
        self,
        person_ids: set[int],
        max_year: int,
    ) -> list[Any]:
        """Fetch all enrolled history for given persons, batched at 500."""
        if not person_ids:
            return []

        sorted_ids = sorted(person_ids)
        all_results: list[Any] = []

        for i in range(0, len(sorted_ids), self.BATCH_SIZE):
            batch = sorted_ids[i : i + self.BATCH_SIZE]
            placeholders = ",".join("?" for _ in batch)
            rows = self._query(
                f"""SELECT a.person_id, a.year,
                           cs.cm_id       AS _session_cm_id,
                           cs.session_type AS _session_type,
                           cs.start_date   AS _session_start_date,
                           cs.name         AS _session_name,
                           cs.parent_id    AS _session_parent_id,
                           cs.end_date     AS _session_end_date
                    FROM attendees a
                    JOIN camp_sessions cs ON a.session = cs.id
                    WHERE a.person_id IN ({placeholders})
                      AND a.status_id = 2
                      AND a.year <= ?""",
                [*batch, max_year],
            )
            all_results.extend(
                SimpleNamespace(
                    person_id=r["person_id"],
                    year=r["year"],
                    expand={"session": self._session_ns(r)},
                )
                for r in rows
            )

        return all_results

    # ------------------------------------------------------------------
    # 6. fetch_bunk_plans
    # ------------------------------------------------------------------

    async def fetch_bunk_plans(
        self,
        year: int,
        session_pb_ids: list[str] | None = None,
    ) -> list[Any]:
        """Fetch bunk plans with bunk expansion."""
        sql = """SELECT bp.session, bp.year,
                        b.name AS _bunk_name, b.gender AS _bunk_gender
                 FROM bunk_plans bp
                 JOIN bunks b ON bp.bunk = b.id
                 WHERE bp.year = ?"""
        params: list[Any] = [year]

        if session_pb_ids:
            placeholders = ",".join("?" for _ in session_pb_ids)
            sql += f" AND bp.session IN ({placeholders})"
            params.extend(session_pb_ids)

        rows = self._query(sql, params)
        return [
            SimpleNamespace(
                session=r["session"],
                year=r["year"],
                expand={
                    "bunk": SimpleNamespace(
                        name=r["_bunk_name"],
                        gender=r["_bunk_gender"],
                    ),
                },
            )
            for r in rows
        ]

    # ------------------------------------------------------------------
    # 7. fetch_capacity_config
    # ------------------------------------------------------------------

    async def fetch_capacity_config(self) -> int:
        """Return the default bunk capacity.

        Phase 2 cabin-capacity cleanup: previously queried a
        ``config_key="default"`` row that was never seeded, so this always
        silently fell back to 12. Now returns ``DEFAULT_BUNK_CAPACITY``
        directly.
        """
        return DEFAULT_BUNK_CAPACITY

    # ------------------------------------------------------------------
    # 8. fetch_status_transitions
    # ------------------------------------------------------------------

    async def fetch_status_transitions(
        self, year: int, to_statuses: list[str], expand_person: bool = False
    ) -> list[Any]:
        """Fetch status transitions filtered by new_status."""
        if expand_person:
            sql = """SELECT ash.person_id, ash.old_status, ash.new_status,
                            ash.detected_at, ash.year,
                            cs.cm_id AS _session_cm_id, cs.name AS _session_name,
                            cs.session_type AS _session_type,
                            cs.parent_id AS _session_parent_id,
                            cs.start_date AS _session_start_date,
                            cs.end_date AS _session_end_date,
                            p.cm_id AS _person_cm_id,
                            p.first_name AS _person_first_name,
                            p.last_name AS _person_last_name,
                            p.gender AS _person_gender,
                            p.grade AS _person_grade
                     FROM attendee_status_history ash
                     JOIN camp_sessions cs ON ash.session = cs.id
                     JOIN persons p ON ash.person = p.id
                     WHERE ash.year = ?"""
        else:
            sql = """SELECT ash.person_id, ash.old_status, ash.new_status,
                            ash.detected_at, ash.year,
                            cs.cm_id AS _session_cm_id, cs.name AS _session_name,
                            cs.session_type AS _session_type,
                            cs.parent_id AS _session_parent_id,
                            cs.start_date AS _session_start_date,
                            cs.end_date AS _session_end_date
                     FROM attendee_status_history ash
                     JOIN camp_sessions cs ON ash.session = cs.id
                     WHERE ash.year = ?"""

        placeholders = ",".join("?" for _ in to_statuses)
        sql += f" AND ash.new_status IN ({placeholders})"
        params: list[Any] = [year, *to_statuses]

        rows = self._query(sql, params)
        results = []
        for r in rows:
            expand: dict[str, Any] = {"session": self._session_ns(r)}
            if expand_person:
                expand["person"] = self._person_ns(r)
            results.append(
                SimpleNamespace(
                    person_id=r["person_id"],
                    old_status=r["old_status"],
                    new_status=r["new_status"],
                    detected_at=r["detected_at"],
                    year=r["year"],
                    expand=expand,
                )
            )
        return results

    # ------------------------------------------------------------------
    # 9. fetch_attendees_with_persons
    # ------------------------------------------------------------------

    async def fetch_attendees_with_persons(
        self,
        year: int,
        session_types: list[str] | None = None,
        status_filter: str | list[str] | None = None,
    ) -> list[Any]:
        """Fetch attendees with both person and session expansion."""
        sql = """SELECT a.person_id, a.year, a.status, a.status_id,
                        a.enrollment_date,
                        cs.cm_id AS _session_cm_id, cs.name AS _session_name,
                        cs.session_type AS _session_type,
                        cs.parent_id AS _session_parent_id,
                        cs.start_date AS _session_start_date,
                        cs.end_date AS _session_end_date,
                        p.cm_id AS _person_cm_id,
                        p.first_name AS _person_first_name,
                        p.last_name AS _person_last_name,
                        p.gender AS _person_gender,
                        p.grade AS _person_grade,
                        p.school AS _person_school,
                        p.normalized_school AS _person_normalized_school,
                        p.normalized_city AS _person_normalized_city,
                        p.normalized_congregation AS _person_normalized_congregation,
                        p.address_city AS _person_city,
                        p.address_state AS _person_state,
                        p.household_id AS _person_household_id,
                        p.years_at_camp AS _person_years_at_camp
                 FROM attendees a
                 JOIN camp_sessions cs ON a.session = cs.id
                 JOIN persons p ON a.person = p.id
                 WHERE a.year = ?"""
        params: list[Any] = [year]

        if status_filter is None or status_filter == "enrolled":
            sql += " AND a.status_id = 2"
        elif isinstance(status_filter, list):
            placeholders = ",".join("?" for _ in status_filter)
            sql += f" AND a.status IN ({placeholders})"
            params.extend(status_filter)
        else:
            sql += " AND a.status = ?"
            params.append(status_filter)

        rows = self._query(sql, params)
        return [
            SimpleNamespace(
                person_id=r["person_id"],
                year=r["year"],
                status=r["status"],
                status_id=r["status_id"],
                enrollment_date=r["enrollment_date"],
                expand={
                    "session": self._session_ns(r),
                    "person": self._person_ns(r),
                },
            )
            for r in rows
        ]

    # ------------------------------------------------------------------
    # 10. fetch_status_history
    # ------------------------------------------------------------------

    async def fetch_status_history(
        self,
        year: int,
        old_status: str | None = None,
        new_statuses: list[str] | None = None,
    ) -> list[Any]:
        """Fetch status history with session/person expansion."""
        sql = """SELECT ash.person_id, ash.old_status, ash.new_status,
                        ash.detected_at, ash.year,
                        cs.cm_id AS _session_cm_id, cs.name AS _session_name,
                        cs.session_type AS _session_type,
                        cs.parent_id AS _session_parent_id,
                        cs.start_date AS _session_start_date,
                        cs.end_date AS _session_end_date,
                        p.cm_id AS _person_cm_id,
                        p.first_name AS _person_first_name,
                        p.last_name AS _person_last_name,
                        p.gender AS _person_gender,
                        p.grade AS _person_grade
                 FROM attendee_status_history ash
                 JOIN camp_sessions cs ON ash.session = cs.id
                 JOIN persons p ON ash.person = p.id
                 WHERE ash.year = ?"""
        params: list[Any] = [year]

        if old_status is not None:
            sql += " AND ash.old_status = ?"
            params.append(old_status)

        if new_statuses:
            placeholders = ",".join("?" for _ in new_statuses)
            sql += f" AND ash.new_status IN ({placeholders})"
            params.extend(new_statuses)

        rows = self._query(sql, params)
        return [
            SimpleNamespace(
                person_id=r["person_id"],
                old_status=r["old_status"],
                new_status=r["new_status"],
                detected_at=r["detected_at"],
                year=r["year"],
                expand={
                    "session": self._session_ns(r),
                    "person": self._person_ns(r),
                },
            )
            for r in rows
        ]

    # ------------------------------------------------------------------
    # 11. fetch_synagogue_by_household
    # ------------------------------------------------------------------

    async def fetch_synagogue_by_household(self, year: int) -> dict[int, str]:
        """Fetch synagogue mapping: household cm_id → synagogue name."""
        rows = self._query(
            """SELECT h.cm_id AS household_cm_id, hcv.value
               FROM household_custom_values hcv
               JOIN custom_field_defs fd ON hcv.field_definition = fd.id
               JOIN households h ON hcv.household = h.id
               WHERE fd.name = 'Synagogue' AND hcv.year = ?
                 AND hcv.value IS NOT NULL AND hcv.value != ''""",
            (year,),
        )
        return {int(r["household_cm_id"]): r["value"] for r in rows}

    # ------------------------------------------------------------------
    # 12. fetch_enrollment_snapshots
    # ------------------------------------------------------------------

    async def fetch_enrollment_snapshots(self, year: int, session_cm_id: int | None = None) -> list[Any]:
        """Fetch enrollment snapshots, sorted by datetime."""
        sql = """SELECT snapshot_datetime, year, session_cm_id,
                        enrolled_count, waitlisted_count, cancelled_count,
                        enrolled_male_count, enrolled_female_count,
                        waitlisted_male_count, waitlisted_female_count,
                        cancelled_male_count, cancelled_female_count
                 FROM enrollment_snapshots
                 WHERE year = ?"""
        params: list[Any] = [year]

        if session_cm_id is not None:
            sql += " AND session_cm_id = ?"
            params.append(session_cm_id)

        sql += " ORDER BY snapshot_datetime"

        rows = self._query(sql, params)
        return [
            SimpleNamespace(
                snapshot_datetime=r["snapshot_datetime"],
                year=r["year"],
                session_cm_id=r["session_cm_id"],
                enrolled_count=r["enrolled_count"],
                waitlisted_count=r["waitlisted_count"],
                cancelled_count=r["cancelled_count"],
                enrolled_male_count=r["enrolled_male_count"],
                enrolled_female_count=r["enrolled_female_count"],
                waitlisted_male_count=r["waitlisted_male_count"],
                waitlisted_female_count=r["waitlisted_female_count"],
                cancelled_male_count=r["cancelled_male_count"],
                cancelled_female_count=r["cancelled_female_count"],
            )
            for r in rows
        ]

    # ------------------------------------------------------------------
    # 13. fetch_attendees_with_dates
    # ------------------------------------------------------------------

    async def fetch_attendees_with_dates(
        self,
        year: int,
        session_cm_id: int | None = None,
        expand_person: bool = False,
    ) -> list[Any]:
        """Fetch attendees with enrollment dates for velocity reconstruction."""
        person_cols = ""
        person_join = ""
        if expand_person:
            person_cols = """,
                            p.cm_id AS _person_cm_id,
                            p.first_name AS _person_first_name,
                            p.last_name AS _person_last_name,
                            p.gender AS _person_gender,
                            p.grade AS _person_grade"""
            person_join = "\n                     JOIN persons p ON a.person = p.id"

        sql = f"""SELECT a.person_id, a.year, a.status, a.status_id,
                            a.enrollment_date, a.effective_date,
                            cs.cm_id AS _session_cm_id, cs.name AS _session_name,
                            cs.session_type AS _session_type,
                            cs.parent_id AS _session_parent_id,
                            cs.start_date AS _session_start_date,
                            cs.end_date AS _session_end_date{person_cols}
                     FROM attendees a
                     JOIN camp_sessions cs ON a.session = cs.id{person_join}
                     WHERE a.year = ?
                       AND (a.enrollment_date IS NOT NULL AND a.enrollment_date != ''
                            OR a.effective_date IS NOT NULL AND a.effective_date != '')"""

        params: list[Any] = [year]

        rows = self._query(sql, params)
        results = []
        for r in rows:
            expand: dict[str, Any] = {"session": self._session_ns(r)}
            if expand_person:
                expand["person"] = self._person_ns(r)
            results.append(
                SimpleNamespace(
                    person_id=r["person_id"],
                    year=r["year"],
                    status=r["status"],
                    status_id=r["status_id"],
                    enrollment_date=r["enrollment_date"],
                    effective_date=r["effective_date"],
                    expand=expand,
                )
            )
        return results

    # ------------------------------------------------------------------
    # 14. fetch_budget_config
    # ------------------------------------------------------------------

    async def fetch_budget_config(self, year: int) -> dict[int, dict[str, Any]]:
        """Fetch budget config: session cm_id → config dict."""
        rows = self._query(
            """SELECT config_key, value FROM config
               WHERE category = 'budget' AND subcategory = ?""",
            (str(year),),
        )
        result: dict[int, dict[str, Any]] = {}
        for r in rows:
            key = r["config_key"] or ""
            if key.startswith("session_"):
                try:
                    cm_id = int(key.replace("session_", ""))
                    value = r["value"]
                    if isinstance(value, str):
                        parsed = json.loads(value)
                        if isinstance(parsed, dict):
                            result[cm_id] = parsed
                except ValueError, TypeError, json.JSONDecodeError:
                    pass
        return result

    # ------------------------------------------------------------------
    # 15. fetch_available_snapshot_dates
    # ------------------------------------------------------------------

    async def fetch_available_snapshot_dates(self, year: int) -> list[str]:
        """Return distinct snapshot dates for a year, sorted descending (newest first)."""
        rows = self._query(
            "SELECT DISTINCT substr(snapshot_datetime, 1, 10) AS snapshot_date"
            " FROM enrollment_snapshots WHERE year = ? ORDER BY snapshot_date DESC",
            (year,),
        )
        return [r["snapshot_date"] for r in rows]

    # ------------------------------------------------------------------
    # 16. fetch_registration_dates
    # ------------------------------------------------------------------

    async def fetch_registration_dates(self, year: int) -> dict[str, str]:
        """Fetch registration phase dates from config table."""
        rows = self._query(
            """SELECT config_key, value FROM config
               WHERE category = 'registration' AND subcategory = ?""",
            (str(year),),
        )
        return {r["config_key"]: json.loads(r["value"]) if r["value"] else "" for r in rows}

    async def has_pre_anchor_enrollments(self, year: int, anchor_date: str) -> bool:
        """Check if any attendees have enrollment dates before the anchor."""
        rows = self._query(
            """SELECT 1 FROM attendees
               WHERE year = ?
                 AND ((effective_date != '' AND effective_date < ?)
                      OR (effective_date = '' AND enrollment_date != '' AND enrollment_date < ?))
               LIMIT 1""",
            (year, anchor_date, anchor_date),
        )
        return len(rows) > 0
