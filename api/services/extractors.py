"""Field extractor functions for metrics breakdown calculations.

These functions extract specific fields from person objects for use with
the generic compute_breakdown function. Each extractor handles
None/empty values consistently.

Demographics extractors (school, city, synagogue) use persons' normalized
fields, falling back to raw fields when normalized values are not available.
"""

from typing import Any

# Grade at or above which campers are excluded from retention analysis.
# All summer sessions (camp and quest) have a maximum grade of 10th.
# 10th graders have no eligible summer session to return to the following year,
# so counting them as "did not return" would unfairly penalize retention metrics.
RETENTION_AGED_OUT_GRADE = 10


def extract_gender(person: Any) -> str:
    """Extract gender from person, returning 'Unknown' for None/empty."""
    gender = getattr(person, "gender", None)
    return gender or "Unknown"


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


def exclude_aged_out_persons(person_ids: set[int], persons: dict[int, Any]) -> set[int]:
    """Remove persons whose grade >= RETENTION_AGED_OUT_GRADE from the set.

    Persons not found in the persons dict or with None grade are kept.
    """
    result: set[int] = set()
    for pid in person_ids:
        if pid not in persons:
            result.add(pid)
            continue
        grade = getattr(persons[pid], "grade", None)
        if grade is None or int(grade) < RETENTION_AGED_OUT_GRADE:
            result.add(pid)
    return result


def filter_aged_out_attendees(attendees: list[Any], persons: dict[int, Any]) -> list[Any]:
    """Remove attendees whose person's grade >= RETENTION_AGED_OUT_GRADE.

    Attendees without a person_id or not found in persons dict are kept.
    """
    result = []
    for a in attendees:
        pid = getattr(a, "person_id", None)
        if pid is None:
            result.append(a)
            continue
        person = persons.get(pid)
        if person is None:
            result.append(a)
            continue
        grade = getattr(person, "grade", None)
        if grade is None or int(grade) < RETENTION_AGED_OUT_GRADE:
            result.append(a)
    return result
