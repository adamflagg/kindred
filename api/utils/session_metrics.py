"""Session metrics utilities for summer program calculations.

This module provides shared constants and functions for computing
summer enrollment metrics across registration and retention services.
"""

from datetime import datetime
from typing import Any

# Session types for UI display: session dropdowns, session breakdown charts
# These are sessions that appear in user-facing session selection.
#
# Includes:
# - main: Standard sessions (Session 1, 2, 3, 4)
# - embedded: Standalone partial sessions (2a, 2b, 3a, etc.)
# - ag: All-Gender sessions (displayed merged into parent main session)
# - quest: Quest adventure programs (child-oriented, shown in metrics/camper views)
#
# Excludes:
# - family: Family camp (adult-focused, separate program)
# - training: Staff training sessions
# - tli: Teen Leadership Initiative (different program)
DISPLAY_SESSION_TYPES = ("main", "embedded", "ag", "quest")

# Session types that have cabin/bunk assignments relevant to the heatmap.
# Used for filtering _build_session_bunk_breakdown to prevent family camp,
# quest, training, and TLI sessions from appearing in the bunk heatmap.
#
# Includes:
# - main: Standard sessions (Session 1, 2, 3, 4) with B-*/G-* bunks
# - embedded: Standalone partial sessions (2a, 2b, 3a, etc.)
# - ag: All-Gender sessions with AG-* bunks
#
# Excludes:
# - quest: Adventure program (no traditional cabin bunking)
# - family: Family camp (adult-focused, same bunk names but separate program)
# - training: Staff training sessions
# - tli: Teen Leadership Initiative
BUNK_SESSION_TYPES = ("main", "embedded", "ag")

# Canonical sort order for session length categories.
# Used wherever length categories need consistent ordering.
SESSION_LENGTH_ORDER: dict[str, int] = {
    "1-week": 0,
    "2-week": 1,
    "3-week": 2,
    "4-week+": 3,
    "unknown": 4,
}

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

# Summer teen programs: SCIT (CIT+SIT) and TLI. NOT a default-included cohort —
# surfaced only when explicitly selected, and always summer-window-gated to
# exclude off-season noise (fall Family-Camp CIT, Aug->May Teen Interns, Feb L.A. Trip).
SUMMER_TEEN_TYPES = ("scit", "tli")


def get_summer_window(sessions: dict[int, Any]) -> tuple[str, str] | None:
    """Return (earliest main start_date, latest main end_date) as YYYY-MM-DD, or None.

    Defines the per-year "summer" span from the main camp sessions, used to gate
    which scit/tli sessions count as summer teen programs.
    """
    starts: list[str] = []
    ends: list[str] = []
    for s in sessions.values():
        if getattr(s, "session_type", None) != "main":
            continue
        start = getattr(s, "start_date", None)
        end = getattr(s, "end_date", None)
        if start and end:
            starts.append(str(start)[:10])
            ends.append(str(end)[:10])
    if not starts or not ends:
        return None
    return (min(starts), max(ends))


def is_summer_teen_session(session: Any, window: tuple[str, str] | None) -> bool:
    """True iff session is a teen type (scit/tli) AND its dates overlap the summer window."""
    if getattr(session, "session_type", None) not in SUMMER_TEEN_TYPES:
        return False
    if window is None:
        return False
    start = getattr(session, "start_date", None)
    end = getattr(session, "end_date", None)
    if not start or not end:
        return False
    win_start, win_end = window
    s_start, s_end = str(start)[:10], str(end)[:10]
    # Overlap: session starts on/before window end AND ends on/after window start.
    return s_start <= win_end and s_end >= win_start


def resolve_cohort_session_ids(sessions: dict[int, Any], requested_types: list[str] | None) -> set[int]:
    """Resolve requested session types to valid session cm_ids for a year.

    Non-teen types pass on type membership alone. Teen types (scit/tli) are
    additionally summer-window-gated via is_summer_teen_session so off-season
    rows (fall Family-Camp CIT, year-long Teen Interns, Feb L.A. Trip) are excluded.
    requested_types=None means "all summer cohorts" (non-teen displayable + gated teens).
    """
    window = get_summer_window(sessions)
    result: set[int] = set()
    for cm_id, s in sessions.items():
        stype = getattr(s, "session_type", None)
        if requested_types is not None and stype not in requested_types:
            continue
        if stype in SUMMER_TEEN_TYPES:
            if not is_summer_teen_session(s, window):
                continue
        elif requested_types is None and stype not in DISPLAY_SESSION_TYPES:
            # "all summer" only spans displayable summer types + gated teens
            continue
        result.add(int(cm_id))
    return result


def get_session_from_expand(record: Any) -> Any:
    """Extract session from a record's PocketBase expand dict.

    Handles both dict-style and object-style expand attributes.

    Args:
        record: A PocketBase record with an expand attribute.

    Returns:
        The session object, or None if not found.
    """
    expand = getattr(record, "expand", {}) or {}
    if isinstance(expand, dict):
        return expand.get("session")
    return getattr(expand, "session", None)


def get_person_from_expand(record: Any) -> Any:
    """Extract person from a record's PocketBase expand dict.

    Handles both dict-style and object-style expand attributes.

    Args:
        record: A PocketBase record with an expand attribute.

    Returns:
        The person object, or None if not found.
    """
    expand = getattr(record, "expand", {}) or {}
    if isinstance(expand, dict):
        return expand.get("person")
    return getattr(expand, "person", None)


def get_bunk_from_expand(record: Any) -> Any:
    """Extract bunk from a record's PocketBase expand dict.

    Symmetric to get_person_from_expand — handles both dict-style and
    object-style expand attributes.

    Args:
        record: A PocketBase record with an expand attribute.

    Returns:
        The bunk object, or None if not found.
    """
    expand = getattr(record, "expand", {}) or {}
    if isinstance(expand, dict):
        return expand.get("bunk")
    return getattr(expand, "bunk", None)


def build_ag_parent_map(sessions: dict[int, Any]) -> dict[int, int]:
    """Build mapping from AG session cm_ids to their parent main session cm_ids.

    Args:
        sessions: Dictionary mapping session cm_id to session record.

    Returns:
        Dictionary mapping AG session cm_id to parent session cm_id.
    """
    ag_parent_map: dict[int, int] = {}
    for sid, session in sessions.items():
        if getattr(session, "session_type", None) == "ag":
            parent_id = getattr(session, "parent_id", None)
            if parent_id:
                ag_parent_map[int(sid)] = int(parent_id)
    return ag_parent_map


def find_ag_sessions_for_parent(sessions: dict[int, Any], session_cm_id: int | None) -> set[int]:
    """Find AG sessions that belong to a parent session.

    Args:
        sessions: Dictionary of sessions by cm_id.
        session_cm_id: The parent session cm_id to find AG children for.

    Returns:
        Set of AG session cm_ids that have the given parent.
    """
    if session_cm_id is None:
        return set()

    ag_session_ids: set[int] = set()
    for sid, session in sessions.items():
        if getattr(session, "session_type", None) == "ag":
            parent_id = getattr(session, "parent_id", None)
            if parent_id == session_cm_id:
                ag_session_ids.add(sid)
    return ag_session_ids


def filter_attendees_by_session(
    attendees: list[Any],
    session_types: list[str] | None,
    session_cm_id: int | None = None,
    ag_session_ids: set[int] | None = None,
    session_cm_ids: set[int] | None = None,
) -> list[Any]:
    """Filter attendees by session type and/or session cm_id.

    Args:
        attendees: List of attendee records with session expand.
        session_types: Session types to include (None = all).
        session_cm_id: Specific session to filter to (None = all).
        ag_session_ids: AG sessions that belong to the parent session.
        session_cm_ids: Optional set of session cm_ids to restrict to (e.g., from
            duration filtering via resolve_duration_sessions). AG children of
            matching sessions are also allowed through.

    Returns:
        Filtered list of attendees.
    """
    if ag_session_ids is None:
        ag_session_ids = set()

    filtered = []
    for a in attendees:
        session = get_session_from_expand(a)
        if not session:
            continue

        session_type = getattr(session, "session_type", None)
        attendee_session_cm_id = getattr(session, "cm_id", None)

        # Apply session type filter
        if session_types and session_type not in session_types:
            continue

        # Apply session_cm_id filter if specified
        if session_cm_id is not None:
            if attendee_session_cm_id != session_cm_id and attendee_session_cm_id not in ag_session_ids:
                continue

        # Apply multi-session filter (duration groups) — allow AG children through
        if session_cm_ids is not None:
            if attendee_session_cm_id not in session_cm_ids and attendee_session_cm_id not in ag_session_ids:
                continue

        filtered.append(a)
    return filtered


def get_session_length_category(start_date: str, end_date: str) -> str:
    """Calculate session length category from actual dates.

    Categories:
    - 1-week: 1-7 days
    - 2-week: 8-14 days
    - 3-week: 15-21 days
    - 4-week+: 22+ days
    - unknown: missing or invalid dates
    """
    from api.services.reconstruction import (  # noqa: PLC0415 - circular: reconstruction imports session_metrics at top-level
        parse_date_only,
    )

    if not start_date or not end_date:
        return "unknown"

    try:
        start_str = parse_date_only(start_date)
        end_str = parse_date_only(end_date)

        start = datetime.strptime(start_str, "%Y-%m-%d")
        end = datetime.strptime(end_str, "%Y-%m-%d")
        days = (end - start).days + 1

        if days <= 7:
            return "1-week"
        elif days <= 14:
            return "2-week"
        elif days <= 21:
            return "3-week"
        else:
            return "4-week+"
    except ValueError, AttributeError:
        return "unknown"


def resolve_duration_sessions(sessions: dict[int, Any], duration: str | None) -> set[int]:
    """Resolve a duration category to a set of matching session cm_ids.

    Args:
        sessions: Dictionary mapping session cm_id to session record.
        duration: Duration category string (e.g., '1-week', '2-week', '3-week').
            Returns empty set if None.

    Returns:
        Set of session cm_ids that match the duration category.
    """
    if not duration:
        return set()

    matching: set[int] = set()
    for sid, session in sessions.items():
        start = getattr(session, "start_date", None)
        end = getattr(session, "end_date", None)
        if start and end:
            category = get_session_length_category(str(start), str(end))
            if category == duration:
                matching.add(int(sid))
    return matching


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
        session = get_session_from_expand(record)
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
            session = get_session_from_expand(r)
            if session:
                start_date = getattr(session, "start_date", None)
                if start_date:
                    try:
                        year_str = str(start_date).split("-")[0]
                        years.add(int(year_str))
                    except ValueError, IndexError:
                        pass

        summer_years_by_person[pid] = len(years)

        # First summer year: min year
        if years:
            first_year_by_person[pid] = min(years)

    return summer_years_by_person, first_year_by_person
