"""Shared fixtures for API unit tests."""

import os
from unittest.mock import MagicMock

# Set auth bypass BEFORE any test module imports trigger settings loading.
# pytest loads conftest.py before test modules in the same directory,
# so this runs before any `from api.main import create_app` at module level.
os.environ["AUTH_MODE"] = "bypass"
os.environ["SKIP_PB_AUTH"] = "true"


def create_mock_session(
    cm_id: int,
    name: str,
    year: int = 2026,
    session_type: str = "main",
    start_date: str = "2026-06-15",
    end_date: str = "2026-07-05",
    parent_id: int | None = None,
    pb_id: str | None = None,
    sort_order: int = 0,
) -> MagicMock:
    """Create a mock PocketBase session record for API tests."""
    session = MagicMock()
    session.id = pb_id or f"pb_{cm_id}"
    session.cm_id = cm_id
    session.name = name
    session.year = year
    session.session_type = session_type
    session.start_date = start_date
    session.end_date = end_date
    session.parent_id = parent_id
    session.sort_order = sort_order
    return session


def create_mock_person(
    cm_id: int,
    first_name: str,
    last_name: str,
    gender: str = "M",
    grade: int = 6,
    years_at_camp: int = 2,
    year: int = 2026,
    school: str = "Riverside Elementary",
    address_city: str = "Springfield",
    address_state: str = "IL",
    preferred_name: str | None = None,
    age: int = 12,
    last_year_attended: int | None = None,
    normalized_school: str | None = None,
    normalized_city: str | None = None,
    normalized_congregation: str | None = None,
) -> MagicMock:
    """Create a mock PocketBase person record for API tests."""
    person = MagicMock()
    person.cm_id = cm_id
    person.first_name = first_name
    person.last_name = last_name
    person.gender = gender
    person.grade = grade
    person.years_at_camp = years_at_camp
    person.year = year
    person.school = school
    person.address_city = address_city
    person.address_state = address_state
    person.preferred_name = preferred_name
    person.age = age
    person.last_year_attended = last_year_attended
    person.normalized_school = normalized_school
    person.normalized_city = normalized_city
    person.normalized_congregation = normalized_congregation
    return person


def create_mock_attendee(
    person_id: int,
    session_cm_id: int,
    year: int = 2026,
    status: str = "enrolled",
    status_id: int = 2,
    is_active: bool = True,
    gender: str | None = None,
    enrollment_date: str | None = None,
    effective_date: str | None = None,
    session: MagicMock | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
    preferred_name: str | None = None,
    grade: int | None = None,
    years_at_camp: int | None = None,
) -> MagicMock:
    """Create a mock PocketBase attendee record for API tests.

    Args:
        session_cm_id: The session's CampMinder ID (always set on the attendee).
        session: Optional pre-built session mock for the expand dict.
            If not provided, a minimal session mock with cm_id is created.
    """
    attendee = MagicMock()
    attendee.person_id = person_id
    attendee.session_cm_id = session_cm_id
    attendee.year = year
    attendee.status = status
    attendee.status_id = status_id
    attendee.is_active = is_active
    attendee.enrollment_date = enrollment_date
    attendee.effective_date = effective_date

    # Build expand dict
    if session is None:
        session = MagicMock()
        session.cm_id = session_cm_id
    expand = {"session": session}

    if gender is not None:
        person = MagicMock()
        person.cm_id = person_id
        person.gender = gender
        person.first_name = first_name or f"Person{person_id}"
        person.last_name = last_name or "Test"
        person.preferred_name = preferred_name
        person.grade = grade
        person.years_at_camp = years_at_camp or 0
        expand["person"] = person

    attendee.expand = expand
    return attendee


def create_mock_status_history(
    person_id: int,
    session: MagicMock,
    person: MagicMock | None,
    old_status: str,
    new_status: str,
    detected_at: str = "2026-01-15 10:00:00.000Z",
    year: int = 2026,
) -> MagicMock:
    """Create a mock attendee_status_history record."""
    record = MagicMock()
    record.person_id = person_id
    record.old_status = old_status
    record.new_status = new_status
    record.detected_at = detected_at
    record.year = year
    record.expand = {"session": session}
    if person:
        record.expand["person"] = person
    return record
