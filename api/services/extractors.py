"""Field extractor functions for metrics breakdown calculations.

These functions extract specific fields from person objects for use with
the generic compute_breakdown function. Each extractor handles
None/empty values consistently.

Demographics extractors (school, city, synagogue) use persons' normalized
fields, falling back to raw fields when normalized values are not available.
"""

from typing import Any

# Grade boundaries for retention aged-out logic (spec §8).
# RETENTION_AGED_OUT_GRADE is the main-camp ceiling (the 10th-grade -> teen bridge);
# RETENTION_GRADUATING_GRADE is the grade at/above which a camper has graduated and
# has no eligible program the following year.
RETENTION_AGED_OUT_GRADE = 10
RETENTION_GRADUATING_GRADE = 12


def is_aged_out(grade: int | None, include_teen_pipeline: bool = False) -> bool:
    """Per-person aged-out test for retention base pools.

    - None grade is never aged out (unknown — keep).
    - grade >= 12: graduating, no program next year -> aged out.
    - grade == 10: the main->teen bridge. Aged out unless include_teen_pipeline
      credits the continuation into a teen program.
    - grades <= 9 (return to main) and 11 (return to a teen program) are tracked.
    """
    if grade is None:
        return False
    g = int(grade)
    if g >= RETENTION_GRADUATING_GRADE:
        return True
    if g == RETENTION_AGED_OUT_GRADE:
        return not include_teen_pipeline
    return False


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


def summers_at_camp_by_person(person_ids: set[int], persons: dict[int, Any]) -> dict[int, int]:
    """Each camper's "Summers at Camp": CampMinder's Years At Camp in the season of `persons`.

    Epic #3207 decision 36: tenure bands read `persons.years_at_camp`, not
    attendance history, which starts in 2017 and so undercounts every camper who
    came before it. `persons` is year-scoped, so the caller picks the season by
    which year's persons it passes: the viewed season on Registration and Trends,
    the base season on Retention. A missing value reads 0, as on the Years at
    Camp chart; a camper with no persons row that season is left out, as every
    other person-field breakdown leaves them out.
    """
    return {pid: extract_years_at_camp(person) for pid in person_ids if (person := persons.get(pid))}


def is_new_camper(years_at_camp: int | None) -> bool:
    """New = CampMinder records the camper in their first year at camp.

    The one rule for ENROLLED campers, as the Registration card and the staff
    guide define it: only years_at_camp == 1 is new.
    """
    return years_at_camp == 1


def is_returning_camper(years_at_camp: int | None) -> bool:
    """Returning = every enrolled camper who is not new, including 0 or no years recorded.

    Meant for enrolled rows. The drill-down R badge keeps `years_at_camp > 1` for
    waitlisted, cancelled and other non-enrolled rows: about half of them carry
    0 years, and whether those count as returning is an open owner decision.
    One exception predates this helper: the drill-down `returning_status` filter
    applies it to every status, waitlisted rows included.
    """
    return not is_new_camper(years_at_camp)


def exclude_aged_out_persons(
    person_ids: set[int],
    persons: dict[int, Any],
    include_teen_pipeline: bool = False,
) -> set[int]:
    """Remove aged-out persons (see is_aged_out) from the set.

    Persons not found in the persons dict or with None grade are kept.
    include_teen_pipeline=False preserves legacy grade-10 exclusion.
    """
    result: set[int] = set()
    for pid in person_ids:
        if pid not in persons:
            result.add(pid)
            continue
        grade = getattr(persons[pid], "grade", None)
        if not is_aged_out(grade, include_teen_pipeline):
            result.add(pid)
    return result


def filter_aged_out_attendees(
    attendees: list[Any],
    persons: dict[int, Any],
    include_teen_pipeline: bool = False,
) -> list[Any]:
    """Remove attendees whose person is aged out (see is_aged_out).

    Attendees without a person_id or not found in persons dict are kept.
    include_teen_pipeline=False preserves legacy grade-10 exclusion.
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
        if not is_aged_out(grade, include_teen_pipeline):
            result.append(a)
    return result
