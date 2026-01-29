"""Session metrics utilities for summer program calculations.

This module provides shared constants and functions for computing
summer enrollment metrics across registration and retention services.
"""

from __future__ import annotations

from typing import Any

# Session types for UI display: session dropdowns, session breakdown charts
# These are sessions that appear in user-facing session selection.
#
# Includes:
# - main: Standard sessions (Session 1, 2, 3, 4)
# - embedded: Standalone partial sessions (2a, 2b, 3a, etc.)
# - ag: All-Gender sessions (displayed merged into parent main session)
#
# Excludes:
# - quest: Quest sessions count toward history but don't appear in breakdowns
# - family: Family camp (adult-focused, separate program)
# - training: Staff training sessions
# - tli: Teen Leadership Initiative (different program)
DISPLAY_SESSION_TYPES = ("main", "embedded", "ag")

# Session types that count toward "summers at camp" / "years as camper"
# Used for metrics calculations: "Summers at Camp", "First Summer Year".
# Quest counts toward camper history to match CampMinder's years_at_camp.
#
# Includes:
# - main: Standard sessions (Session 1, 2, 3, 4)
# - embedded: Standalone partial sessions (2a, 2b, 3a, etc.)
# - ag: All-Gender sessions
# - quest: Quest adventure programs (child-oriented, counts toward years at camp)
#
# Excludes:
# - family: Family camp (adult-focused)
# - training: Staff training sessions
# - tli: Teen Leadership Initiative (different program)
SUMMER_PROGRAM_SESSION_TYPES = ("main", "embedded", "ag", "quest")


def compute_summer_metrics(
    enrollment_history: list[Any],
    person_ids: set[int],
) -> tuple[dict[int, int], dict[int, int]]:
    """Compute summer enrollment metrics from history.

    Shared logic used by both registration and retention services.

    Args:
        enrollment_history: List of attendee records with session expansion.
        person_ids: Set of person IDs to compute metrics for.

    Returns:
        Tuple of:
        - summer_years_by_person: person_id -> count of distinct summer years
        - first_year_by_person: person_id -> first summer enrollment year
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

    for pid, records in by_person.items():
        # Summer years: count distinct years from session start_date or record year
        years: set[int] = set()
        for r in records:
            # Try to get year from record first
            record_year = getattr(r, "year", None)
            if record_year:
                years.add(int(record_year))
                continue

            # Fall back to session start_date
            expand = getattr(r, "expand", {}) or {}
            session = expand.get("session") if isinstance(expand, dict) else getattr(expand, "session", None)
            if session:
                start_date = getattr(session, "start_date", None)
                if start_date:
                    try:
                        year_str = str(start_date).split("-")[0]
                        years.add(int(year_str))
                    except (ValueError, IndexError):
                        pass

        summer_years_by_person[pid] = len(years)

        # First summer year: min year
        if years:
            first_year_by_person[pid] = min(years)

    return summer_years_by_person, first_year_by_person
