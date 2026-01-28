"""Field extractor functions for metrics breakdown calculations.

These functions extract specific fields from person or camper_history objects
for use with the generic compute_breakdown function. Each extractor handles
None/empty values consistently.
"""

from __future__ import annotations

from typing import Any


def extract_gender(person: Any) -> str:
    """Extract gender from person, returning 'Unknown' for None/empty."""
    gender = getattr(person, "gender", None)
    return gender if gender else "Unknown"


def extract_grade(person: Any) -> int | None:
    """Extract grade from person, returning None for missing."""
    return getattr(person, "grade", None)


def extract_school(record: Any) -> str:
    """Extract school from camper_history record, returning empty string for None."""
    school = getattr(record, "school", None)
    return school if school else ""


def extract_city(record: Any) -> str:
    """Extract city from camper_history record, returning empty string for None."""
    city = getattr(record, "city", None)
    return city if city else ""


def extract_synagogue(record: Any) -> str:
    """Extract synagogue from camper_history record, returning empty string for None."""
    synagogue = getattr(record, "synagogue", None)
    return synagogue if synagogue else ""


def extract_years_at_camp(person: Any) -> int:
    """Extract years_at_camp from person, returning 0 for None."""
    years = getattr(person, "years_at_camp", None)
    return years if years is not None else 0


def extract_first_year_attended(record: Any) -> int | None:
    """Extract first_year_attended from camper_history record."""
    return getattr(record, "first_year_attended", None)
