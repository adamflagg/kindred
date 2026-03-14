"""Shared fixtures for API unit tests."""

import os
from unittest.mock import MagicMock

# Set auth bypass BEFORE any test module imports trigger settings loading.
# pytest loads conftest.py before test modules in the same directory,
# so this runs before any `from api.main import create_app` at module level.
os.environ["AUTH_MODE"] = "bypass"
os.environ["SKIP_PB_AUTH"] = "true"


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
