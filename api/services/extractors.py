"""Field extractor functions for metrics breakdown calculations.

These functions extract specific fields from person objects for use with
the generic compute_breakdown function. Each extractor handles
None/empty values consistently.

Demographics extractors (school, city, synagogue) use persons' normalized
fields, falling back to raw fields when normalized values are not available.
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


def extract_school(person: Any) -> str:
    """Extract school from person, preferring normalized_school."""
    return getattr(person, "normalized_school", None) or getattr(person, "school", "") or ""


def extract_city(person: Any) -> str:
    """Extract city from person, preferring normalized_city."""
    return getattr(person, "normalized_city", None) or getattr(person, "address_city", "") or ""


def extract_synagogue(person: Any) -> str:
    """Extract synagogue from person using normalized_congregation."""
    return getattr(person, "normalized_congregation", None) or ""


def extract_years_at_camp(person: Any) -> int:
    """Extract years_at_camp from person, returning 0 for None."""
    years = getattr(person, "years_at_camp", None)
    return years if years is not None else 0
