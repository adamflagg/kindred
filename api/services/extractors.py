"""Field extractor functions for metrics breakdown calculations.

These functions extract specific fields from person objects for use with
the generic compute_breakdown function. Each extractor handles
None/empty values consistently.

Demographics extractors (school, city, synagogue) use persons' normalized
fields, falling back to raw fields when normalized values are not available.
"""

from collections.abc import Iterable, Mapping
from typing import Any

from bunking.gender_identity import NOT_GIVEN, gender_label, has_identity_answer

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
    """The binary Gender field (M / F / Other), 'Unknown' for None/empty.

    Only for what decision 38 keeps on the binary field: cabins, capacity and the Velocity boys/girls curves that
    pace against them. Every Analytics gender split reads extract_gender_identity (#2898).
    """
    gender = getattr(person, "gender", None)
    return gender or "Unknown"


# Owner ruling 58 (b), superseding decision 38b's "no fallback" for Analytics: a camper with no Gender Identity answer
# counts by the binary Gender field (F as Girl/woman, M as Boy/man), and every split that does so says how many campers
# it counted that way (count_binary_fallbacks). The one switch: False puts every blank answer back to "not given".
# Camperships keeps its own no-fallback rule and never reads this.
IDENTITY_FALLS_BACK_TO_BINARY = True


def _text(person: Any, field: str) -> str:
    value = getattr(person, field, None)
    return value if isinstance(value, str) else ""


def extract_gender_identity(person: Any) -> str:
    """The gender identity label Analytics counts a camper under (#2898; decision 38): CampMinder's Gender Identity,
    "self-described" for a write-in, the binary field for a blank answer (IDENTITY_FALLS_BACK_TO_BINARY), "not given"
    when there is nothing to read. The labels are the ones Camperships' development report counts."""
    return gender_label(
        _text(person, "gender_identity_name"),
        _text(person, "gender_identity_write_in"),
        binary_fallback=_text(person, "gender") if IDENTITY_FALLS_BACK_TO_BINARY else None,
    )


def counted_by_binary_field(person: Any) -> bool:
    """Whether extract_gender_identity counted this camper by the binary field (ruling 58)."""
    return (
        IDENTITY_FALLS_BACK_TO_BINARY
        and not has_identity_answer(_text(person, "gender_identity_name"), _text(person, "gender_identity_write_in"))
        and extract_gender_identity(person) != NOT_GIVEN
    )


def count_binary_fallbacks(person_ids: Iterable[int], persons: Mapping[int, Any]) -> int:
    """How many of these campers a gender split counted by the binary field: the number its note states."""
    return sum(1 for pid in person_ids if (person := persons.get(pid)) is not None and counted_by_binary_field(person))


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


# Registration's "campers by age" bars, youngest first, then campers with no birthdate
# (epic #3207, owner ruling D-UNCOVERED). The keys travel as drill-down values.
AGE_BAND_KEYS = ("5-7", "8-10", "11-13", "14-16", "17+", "none")
NO_BIRTHDATE_BAND = "none"
# Upper age of each band but the last; anything older is "17+".
_AGE_BAND_CEILINGS = ((7, "5-7"), (10, "8-10"), (13, "11-13"), (16, "14-16"))


def extract_age_band(person: Any, season_year: int) -> str:
    """The camper's age band in `season_year`: the season year minus the birth year.

    Never `persons.age`, a stored snapshot that drifts from the season (wrong for
    279 of 1,291 campers in 2026). So a camper born in late 2016 is 10 all of 2026.
    No readable birth year reads "none". An age under 5 folds into "5-7": none was
    enrolled in 2025 or 2026, so the youngest bar is "7 and under" in practice.
    """
    birthdate = str(getattr(person, "birthdate", None) or "").strip()
    year_text = birthdate[:4]
    if len(year_text) != 4 or not year_text.isdigit():
        return NO_BIRTHDATE_BAND
    age = season_year - int(year_text)
    for ceiling, band in _AGE_BAND_CEILINGS:
        if age <= ceiling:
            return band
    return "17+"


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
    0 years, and the owner ruled they are not returning (decision 35, 2026-10-14).
    The drill-down `returning_status` filter follows the same split by row status.
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
