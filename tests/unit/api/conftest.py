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
