"""A past season's Campership sheet, loaded as "as reported" recipients (owner ruling 2026-10-16, CS-AGES25): who the
sheet paid, by CampMinder id, and the summer age lines they give. Pure. Fictional only (tests/CLAUDE.md)."""

from __future__ import annotations

from dataclasses import replace
from datetime import date
from decimal import Decimal

import pytest

from bunking.financial_aid.reports.development import ADULT, AGE_UNKNOWN, TEEN, YOUTH, Person
from bunking.financial_aid.reports.recipients import (
    ENTITY_MAX,
    ReportedRecipient,
    problems,
    recipient_entity,
    sheet_ages,
)

EMMA, LIAM, OLIVIA, RILEY = 1000011, 1000021, 1000012, 1000031
EMMA_HOME, LIAM_HOME, RILEY_HOME = 1000001, 1000002, 1000003
JUNE_20 = date(2025, 6, 20)


def _award(person: int = EMMA, household: int = EMMA_HOME, **change: object) -> ReportedRecipient:
    found = ReportedRecipient(
        year=2025,
        person_cm_id=person,
        household_cm_id=household,
        program="summer",
        source="camp",
        funder="",
        amount=Decimal("1500.00"),
        sheet_tab="Aid calculator",
        sheet_row=12,
        match="personal_id",
    )
    return replace(found, **change)  # type: ignore[arg-type]


def _grant(person: int, household: int, funder: str = "Regional Camp Fund") -> ReportedRecipient:
    return _award(person, household, source="outside", funder=funder, sheet_tab="Grants", sheet_row=4)


PEOPLE = {
    EMMA: Person(EMMA, date(2015, 1, 1), ""),  # 10 on June 20 2025
    OLIVIA: Person(OLIVIA, date(2012, 1, 1), ""),  # 13
    LIAM: Person(LIAM, date(2012, 1, 1), ""),  # 13
    RILEY: Person(RILEY, date(2006, 1, 1), ""),  # 19
}


def test_the_sheet_counts_exactly_its_summer_recipients_by_age_an_outside_only_camper_included() -> None:
    """Emma has the camp's award; Liam has only an outside grant (the ruling: "don't forget to include families
    who only got external aid"); Riley, 19, has both, and counts once."""
    stays = [(EMMA, JUNE_20), (LIAM, JUNE_20), (RILEY, JUNE_20)]
    listed = [_award(EMMA), _grant(LIAM, LIAM_HOME), _award(RILEY, RILEY_HOME), _grant(RILEY, RILEY_HOME)]
    assert sheet_ages(listed, stays, PEOPLE) == {YOUTH: 1, TEEN: 1, ADULT: 1}


def test_a_sibling_the_sheet_does_not_list_is_not_counted() -> None:
    """Emma and Olivia share a household and both attended; only Emma is on the sheet. The household is never
    fanned out to her sister (the ruling: "it overcounts summer")."""
    stays = [(EMMA, JUNE_20), (OLIVIA, JUNE_20)]
    assert sheet_ages([_award(EMMA)], stays, PEOPLE) == {YOUTH: 1}


def test_a_recipient_with_no_summer_stay_is_not_counted() -> None:
    """Liam is on the sheet but has no enrolled summer stay that season (the caller passes enrolled summer stays
    only): he isn't a summer camper to count."""
    assert sheet_ages([_award(EMMA), _grant(LIAM, LIAM_HOME)], [(EMMA, JUNE_20)], PEOPLE) == {YOUTH: 1}


def test_only_the_summer_program_counts_toward_the_summer_age_lines() -> None:
    """A Family Camp or B'mitzvah line on the sheet is not summer aid, even for a camper who was at summer too."""
    listed = [_award(EMMA, program="family_camp"), _award(LIAM, LIAM_HOME, program="bmitzvah")]
    assert sheet_ages(listed, [(EMMA, JUNE_20), (LIAM, JUNE_20)], PEOPLE) == {}


def test_age_is_on_the_first_day_of_the_first_summer_session_and_unknown_without_a_birthdate() -> None:
    """D103, as in a dashboard column: Olivia turns 13 on July 1 2025, so she is youth on a June 20 first stay
    even though a later stay starts after her birthday; a camper with no person row is age unknown."""
    olivia = {OLIVIA: Person(OLIVIA, date(2012, 7, 1), "")}
    stays = [(OLIVIA, date(2025, 7, 10)), (OLIVIA, JUNE_20), (EMMA, JUNE_20)]
    assert sheet_ages([_award(OLIVIA), _award(EMMA)], stays, olivia) == {YOUTH: 1, AGE_UNKNOWN: 1}


def test_a_well_formed_recipient_has_no_problems() -> None:
    assert problems(_award()) == []
    assert problems(_grant(LIAM, LIAM_HOME)) == []


@pytest.mark.parametrize(
    ("change", "words"),
    [
        ({"year": 2021}, "2022"),
        ({"year": 2027}, "2026"),
        ({"source": "outside", "funder": ""}, "names its funder"),
        ({"source": "outside", "funder": "   "}, "names its funder"),
        ({"funder": "Regional Camp Fund"}, "no funder"),
        ({"amount": Decimal(0)}, "more than 0"),
        ({"amount": Decimal(-5)}, "more than 0"),
    ],
)
def test_a_recipient_the_sheet_could_not_have_listed_is_refused(change: dict[str, object], words: str) -> None:
    found = problems(replace(_award(), **change))  # type: ignore[arg-type]
    assert found, change
    assert any(words in p for p in found), found


def test_the_natural_key_is_season_person_program_source_and_funder() -> None:
    """One row per camper, program and payer: a second load of the same line corrects its amount or provenance."""
    assert _award().key == (2025, EMMA, "summer", "camp", "")
    assert _award(amount=Decimal(900), sheet_row=40).key == _award().key
    assert _grant(EMMA, EMMA_HOME).key != _grant(EMMA, EMMA_HOME, funder="Valley Youth Fund").key


def test_the_change_log_key_fits_and_keeps_two_funders_apart() -> None:
    long_name = "A" * 200
    one, other = _grant(EMMA, EMMA_HOME, funder=long_name), _grant(EMMA, EMMA_HOME, funder=long_name + "B")
    assert len(recipient_entity(one)) <= ENTITY_MAX
    assert recipient_entity(one) != recipient_entity(other)
    assert recipient_entity(_award()).startswith(f"2025:{EMMA}:summer:camp:")
