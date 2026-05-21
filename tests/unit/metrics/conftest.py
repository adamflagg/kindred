"""Test fixtures for metrics SQL repository tests.

Provides an in-memory SQLite database with PocketBase-compatible schema
and seeded fictional test data per CLAUDE.md conventions.
"""

import json
import sqlite3

import pytest


def _create_schema(conn: sqlite3.Connection) -> None:
    """Create PocketBase-compatible table schema."""
    conn.executescript("""
        CREATE TABLE persons (
            id TEXT PRIMARY KEY,
            cm_id INTEGER NOT NULL,
            first_name TEXT,
            last_name TEXT,
            gender TEXT,
            grade INTEGER,
            school TEXT,
            normalized_school TEXT,
            address_city TEXT,
            address_state TEXT,
            normalized_city TEXT,
            normalized_congregation TEXT,
            years_at_camp INTEGER,
            household_id INTEGER,
            year INTEGER NOT NULL
        );

        CREATE TABLE camp_sessions (
            id TEXT PRIMARY KEY,
            cm_id INTEGER NOT NULL,
            name TEXT,
            session_type TEXT,
            parent_id INTEGER,
            start_date TEXT,
            end_date TEXT,
            year INTEGER NOT NULL
        );

        CREATE TABLE attendees (
            id TEXT PRIMARY KEY,
            person_id INTEGER NOT NULL,
            year INTEGER NOT NULL,
            status TEXT,
            status_id INTEGER,
            enrollment_date TEXT,
            effective_date TEXT,
            session TEXT,
            person TEXT
        );

        CREATE TABLE bunk_assignments (
            id TEXT PRIMARY KEY,
            year INTEGER NOT NULL,
            person TEXT,
            session TEXT,
            bunk TEXT
        );

        CREATE TABLE bunks (
            id TEXT PRIMARY KEY,
            name TEXT,
            gender TEXT
        );

        CREATE TABLE bunk_plans (
            id TEXT PRIMARY KEY,
            year INTEGER NOT NULL,
            session TEXT,
            bunk TEXT
        );

        CREATE TABLE config (
            id TEXT PRIMARY KEY,
            category TEXT,
            subcategory TEXT,
            config_key TEXT,
            value TEXT
        );

        CREATE TABLE attendee_status_history (
            id TEXT PRIMARY KEY,
            person_id INTEGER,
            year INTEGER NOT NULL,
            old_status TEXT,
            new_status TEXT,
            detected_at TEXT,
            session TEXT,
            person TEXT
        );

        CREATE TABLE enrollment_snapshots (
            id TEXT PRIMARY KEY,
            year INTEGER NOT NULL,
            session_cm_id INTEGER,
            snapshot_datetime TEXT,
            enrolled_count INTEGER DEFAULT 0,
            waitlisted_count INTEGER DEFAULT 0,
            cancelled_count INTEGER DEFAULT 0,
            enrolled_male_count INTEGER DEFAULT 0,
            enrolled_female_count INTEGER DEFAULT 0,
            waitlisted_male_count INTEGER DEFAULT 0,
            waitlisted_female_count INTEGER DEFAULT 0,
            cancelled_male_count INTEGER DEFAULT 0,
            cancelled_female_count INTEGER DEFAULT 0
        );

        CREATE TABLE custom_field_defs (
            id TEXT PRIMARY KEY,
            name TEXT
        );

        CREATE TABLE household_custom_values (
            id TEXT PRIMARY KEY,
            field_definition TEXT,
            household TEXT,
            year INTEGER NOT NULL,
            value TEXT
        );

        CREATE TABLE households (
            id TEXT PRIMARY KEY,
            cm_id INTEGER NOT NULL
        );
    """)


def _seed_data(conn: sqlite3.Connection) -> None:
    """Seed test data using fictional names per CLAUDE.md."""
    # -- Persons (year 2025) --
    conn.executemany(
        "INSERT INTO persons VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
            (
                "per_emma",
                1001,
                "Emma",
                "Johnson",
                "F",
                5,
                "Riverside Elementary",
                "Riverside Elementary",
                "San Francisco",
                "CA",
                "San Francisco",
                "Temple Beth El",
                3,
                2001,
                2025,
            ),
            (
                "per_liam",
                1002,
                "Liam",
                "Garcia",
                "M",
                6,
                "Oak Valley Middle",
                "Oak Valley Middle",
                "Oakland",
                "CA",
                "Oakland",
                "Congregation Shalom",
                2,
                2002,
                2025,
            ),
            (
                "per_olivia",
                1003,
                "Olivia",
                "Chen",
                "F",
                7,
                "Hillcrest High",
                "Hillcrest High",
                "San Francisco",
                "CA",
                "San Francisco",
                "",
                1,
                2003,
                2025,
            ),
        ],
    )

    # -- Persons (year 2024) for enrollment history --
    conn.executemany(
        "INSERT INTO persons VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [
            (
                "per_emma_24",
                1001,
                "Emma",
                "Johnson",
                "F",
                4,
                "Riverside Elementary",
                "Riverside Elementary",
                "San Francisco",
                "CA",
                "San Francisco",
                "Temple Beth El",
                2,
                2001,
                2024,
            ),
            (
                "per_liam_24",
                1002,
                "Liam",
                "Garcia",
                "M",
                5,
                "Oak Valley Middle",
                "Oak Valley Middle",
                "Oakland",
                "CA",
                "Oakland",
                "Congregation Shalom",
                1,
                2002,
                2024,
            ),
        ],
    )

    # -- Sessions (year 2025) --
    conn.executemany(
        "INSERT INTO camp_sessions VALUES (?,?,?,?,?,?,?,?)",
        [
            ("ses_s1", 1000001, "Session 1", "main", None, "2025-06-15", "2025-07-12", 2025),
            ("ses_s2", 1000002, "Session 2", "main", None, "2025-07-13", "2025-08-09", 2025),
            ("ses_ag1", 1000003, "AG Session 1", "ag", 1000001, "2025-06-15", "2025-07-12", 2025),
            ("ses_q", 1000004, "Quest Adventure", "quest", None, "2025-07-01", "2025-07-07", 2025),
        ],
    )

    # -- Sessions (year 2024) --
    conn.executemany(
        "INSERT INTO camp_sessions VALUES (?,?,?,?,?,?,?,?)",
        [
            ("ses_s1_24", 1000001, "Session 1", "main", None, "2024-06-15", "2024-07-12", 2024),
            ("ses_s2_24", 1000002, "Session 2", "main", None, "2024-07-13", "2024-08-09", 2024),
        ],
    )

    # -- Attendees (year 2025) --
    conn.executemany(
        "INSERT INTO attendees VALUES (?,?,?,?,?,?,?,?,?)",
        [
            # Emma enrolled in Session 1
            ("att_1", 1001, 2025, "enrolled", 2, "2025-01-15", "2025-01-15", "ses_s1", "per_emma"),
            # Liam enrolled in Session 1
            ("att_2", 1002, 2025, "enrolled", 2, "2025-01-20", "2025-01-20", "ses_s1", "per_liam"),
            # Olivia enrolled in Session 2
            ("att_3", 1003, 2025, "enrolled", 2, "2025-02-01", "2025-02-01", "ses_s2", "per_olivia"),
            # Emma waitlisted in Session 2
            ("att_4", 1001, 2025, "waitlisted", 3, "2025-02-15", "2025-02-15", "ses_s2", "per_emma"),
            # Liam cancelled from Session 2
            ("att_5", 1002, 2025, "cancelled", 5, "2025-03-01", "2024-11-20", "ses_s2", "per_liam"),
        ],
    )

    # -- Attendees (year 2024) for enrollment history --
    conn.executemany(
        "INSERT INTO attendees VALUES (?,?,?,?,?,?,?,?,?)",
        [
            ("att_h1", 1001, 2024, "enrolled", 2, "2024-01-10", "2024-01-10", "ses_s1_24", "per_emma_24"),
            ("att_h2", 1002, 2024, "enrolled", 2, "2024-01-12", "2024-01-12", "ses_s2_24", "per_liam_24"),
        ],
    )

    # -- Bunks --
    conn.executemany(
        "INSERT INTO bunks VALUES (?,?,?)",
        [
            ("bnk_b1", "B-1", "M"),
            ("bnk_g1", "G-1", "F"),
            ("bnk_ag1", "AG-1", "Mixed"),
        ],
    )

    # -- Bunk Assignments (year 2025) --
    conn.executemany(
        "INSERT INTO bunk_assignments VALUES (?,?,?,?,?)",
        [
            ("ba_1", 2025, "per_emma", "ses_s1", "bnk_g1"),
            ("ba_2", 2025, "per_liam", "ses_s1", "bnk_b1"),
        ],
    )

    # -- Bunk Plans (year 2025) --
    conn.executemany(
        "INSERT INTO bunk_plans VALUES (?,?,?,?)",
        [
            ("bp_1", 2025, "ses_s1", "bnk_b1"),
            ("bp_2", 2025, "ses_s1", "bnk_g1"),
            ("bp_3", 2025, "ses_ag1", "bnk_ag1"),
        ],
    )

    # -- Config --
    conn.executemany(
        "INSERT INTO config VALUES (?,?,?,?,?)",
        [
            ("cfg_cap", "constraint", "cabin_capacity", "default", json.dumps(12)),
            (
                "cfg_bud1",
                "budget",
                "2025",
                "session_1000001",
                json.dumps({"participant_goal": 150, "session_fee": 5000}),
            ),
            (
                "cfg_bud2",
                "budget",
                "2025",
                "session_1000002",
                json.dumps({"participant_goal": 120, "session_fee": 4500}),
            ),
            ("cfg_reg1", "registration", "2025", "priority_reg_date", json.dumps("2025-01-01")),
            ("cfg_reg2", "registration", "2025", "early_reg_date", json.dumps("2025-01-15")),
            ("cfg_reg3", "registration", "2025", "open_reg_date", json.dumps("2025-02-01")),
        ],
    )

    # -- Status History --
    conn.executemany(
        "INSERT INTO attendee_status_history VALUES (?,?,?,?,?,?,?,?)",
        [
            ("ash_1", 1001, 2025, "waitlisted", "enrolled", "2025-02-20", "ses_s2", "per_emma"),
            ("ash_2", 1002, 2025, "enrolled", "cancelled", "2025-03-01", "ses_s1", "per_liam"),
        ],
    )

    # -- Enrollment Snapshots --
    conn.executemany(
        """INSERT INTO enrollment_snapshots VALUES
           (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        [
            ("snap_1", 2025, 1000001, "2025-01-15", 50, 5, 2, 25, 25, 3, 2, 1, 1),
            ("snap_2", 2025, 1000001, "2025-02-15", 100, 10, 5, 52, 48, 6, 4, 3, 2),
            ("snap_3", 2025, 1000002, "2025-01-15", 30, 3, 1, 15, 15, 2, 1, 0, 1),
        ],
    )

    # -- Households --
    conn.executemany(
        "INSERT INTO households VALUES (?,?)",
        [
            ("hh_2001", 2001),
            ("hh_2002", 2002),
            ("hh_2003", 2003),
        ],
    )

    # -- Field Definitions --
    conn.execute(
        "INSERT INTO custom_field_defs VALUES (?,?)",
        ("fd_syn", "Synagogue"),
    )

    # -- Household Custom Values --
    conn.executemany(
        "INSERT INTO household_custom_values VALUES (?,?,?,?,?)",
        [
            ("hcv_1", "fd_syn", "hh_2001", 2025, "Temple Beth El"),
            ("hcv_2", "fd_syn", "hh_2002", 2025, "Congregation Shalom"),
        ],
    )

    conn.commit()


@pytest.fixture
def sql_db() -> sqlite3.Connection:
    """Create an in-memory SQLite DB with PocketBase schema and test data."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    _create_schema(conn)
    _seed_data(conn)
    return conn
