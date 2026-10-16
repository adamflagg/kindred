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
    OutsideCredit,
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
    stays = [(EMMA, EMMA_HOME, JUNE_20), (LIAM, LIAM_HOME, JUNE_20), (RILEY, RILEY_HOME, JUNE_20)]
    listed = [_award(EMMA), _grant(LIAM, LIAM_HOME), _award(RILEY, RILEY_HOME), _grant(RILEY, RILEY_HOME)]
    assert sheet_ages(listed, stays, PEOPLE) == {YOUTH: 1, TEEN: 1, ADULT: 1}


def test_a_sibling_the_sheet_does_not_list_is_not_counted() -> None:
    """Emma and Olivia share a household and both attended; only Emma is on the sheet. The household is never
    fanned out to her sister (the ruling: "it overcounts summer")."""
    stays = [(EMMA, EMMA_HOME, JUNE_20), (OLIVIA, EMMA_HOME, JUNE_20)]
    assert sheet_ages([_award(EMMA)], stays, PEOPLE) == {YOUTH: 1}


def test_a_recipient_with_no_summer_stay_is_not_counted() -> None:
    """Liam is on the sheet but has no enrolled summer stay that season (the caller passes enrolled summer stays
    only): he isn't a summer camper to count."""
    assert sheet_ages([_award(EMMA), _grant(LIAM, LIAM_HOME)], [(EMMA, EMMA_HOME, JUNE_20)], PEOPLE) == {YOUTH: 1}


def test_only_the_summer_program_counts_toward_the_summer_age_lines() -> None:
    """A Family Camp or B'mitzvah line on the sheet is not summer aid, even for a camper who was at summer too."""
    listed = [_award(EMMA, program="family_camp"), _award(LIAM, LIAM_HOME, program="bmitzvah")]
    assert sheet_ages(listed, [(EMMA, EMMA_HOME, JUNE_20), (LIAM, LIAM_HOME, JUNE_20)], PEOPLE) == {}


def test_age_is_on_the_first_day_of_the_first_summer_session_and_unknown_without_a_birthdate() -> None:
    """D103, as in a dashboard column: Olivia turns 13 on July 1 2025, so she is youth on a June 20 first stay
    even though a later stay starts after her birthday; a camper with no person row is age unknown."""
    olivia = {OLIVIA: Person(OLIVIA, date(2012, 7, 1), "")}
    stays = [(OLIVIA, EMMA_HOME, date(2025, 7, 10)), (OLIVIA, EMMA_HOME, JUNE_20), (EMMA, EMMA_HOME, JUNE_20)]
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


# --- #55 (owner 2026-10-16, "a"): a family whose only aid was an outside grant, with no row on the sheet ---------

SAMUEL = 1000013  # Liam's brother, in Liam's household
SAM_HOME = 1000004


def _credit(
    household: int, *, person: int = 0, attributed: int = 0, level: str = "none", summer: bool = True
) -> OutsideCredit:
    return OutsideCredit(
        household_cm_id=household,
        person_cm_id=person,
        attributed_person_cm_id=attributed,
        attribution_level=level,
        summer_source=summer,
    )


def test_an_outside_only_single_camper_household_counts_its_camper() -> None:
    """Liam's household is on no sheet row; a live outside grant on the household, from a summer source, and Liam is
    its one enrolled summer camper: he is certainly the camper, so he counts."""
    stays = [(EMMA, EMMA_HOME, JUNE_20), (LIAM, LIAM_HOME, JUNE_20)]
    out = sheet_ages([_award(EMMA)], stays, PEOPLE, [_credit(LIAM_HOME)])
    assert out == {YOUTH: 1, TEEN: 1}


def test_an_outside_only_two_camper_household_is_not_fanned_out_to_its_siblings() -> None:
    """Liam and Samuel both attended; a household-level outside grant can't say whose it is: neither counts."""
    stays = [(EMMA, EMMA_HOME, JUNE_20), (LIAM, LIAM_HOME, JUNE_20), (SAMUEL, LIAM_HOME, JUNE_20)]
    assert sheet_ages([_award(EMMA)], stays, PEOPLE, [_credit(LIAM_HOME)]) == {YOUTH: 1}


@pytest.mark.parametrize("level", ["ambiguous", "program_family", "none"])
def test_a_line_the_sync_could_not_place_on_a_person_is_not_counted(level: str) -> None:
    """An ambiguous or program-level attribution names nobody for certain, even with a person on it as a guess."""
    stays = [(LIAM, LIAM_HOME, JUNE_20), (SAMUEL, LIAM_HOME, JUNE_20)]
    assert sheet_ages([], stays, PEOPLE, [_credit(LIAM_HOME, attributed=LIAM, level=level)]) == {}


@pytest.mark.parametrize("level", ["person", "session", "override", "decision"])
def test_a_line_attributed_to_a_person_counts_that_camper_alone(level: str) -> None:
    stays = [(LIAM, LIAM_HOME, JUNE_20), (SAMUEL, LIAM_HOME, date(2025, 7, 10))]
    assert sheet_ages([], stays, PEOPLE, [_credit(LIAM_HOME, attributed=LIAM, level=level)]) == {TEEN: 1}


def test_a_line_campminder_posted_to_a_person_counts_that_camper() -> None:
    stays = [(LIAM, LIAM_HOME, JUNE_20), (SAMUEL, LIAM_HOME, JUNE_20)]
    assert sheet_ages([], stays, PEOPLE, [_credit(LIAM_HOME, person=LIAM, level="ambiguous")]) == {TEEN: 1}


def test_a_single_camper_household_line_counts_only_when_its_source_is_summer_aid() -> None:
    """A household-level Family Camp grant says nothing about the household's one summer camper."""
    stays = [(LIAM, LIAM_HOME, JUNE_20)]
    assert sheet_ages([], stays, PEOPLE, [_credit(LIAM_HOME, summer=False)]) == {}


def test_a_family_camp_credit_campminder_posted_to_a_summer_camper_counts_nobody() -> None:
    """#55 (coordinator 2026-10-16): a Family Camp, B*Mitzvah or weekend grant doesn't make a child a summer aid
    recipient, even posted to that child, who also had a summer stay."""
    stays = [(LIAM, LIAM_HOME, JUNE_20)]
    assert sheet_ages([], stays, PEOPLE, [_credit(LIAM_HOME, person=LIAM, summer=False)]) == {}


@pytest.mark.parametrize("level", ["person", "session", "override", "decision"])
def test_a_non_summer_credit_the_sync_placed_on_a_summer_camper_counts_nobody(level: str) -> None:
    stays = [(LIAM, LIAM_HOME, JUNE_20)]
    assert sheet_ages([], stays, PEOPLE, [_credit(LIAM_HOME, attributed=LIAM, level=level, summer=False)]) == {}


def test_a_household_on_the_sheet_is_never_counted_again_from_its_outside_lines() -> None:
    """Emma's household is on the sheet (Emma's award); its outside grant on the household doesn't add Olivia."""
    stays = [(EMMA, EMMA_HOME, JUNE_20), (OLIVIA, EMMA_HOME, JUNE_20)]
    assert sheet_ages([_award(EMMA)], stays, PEOPLE, [_credit(EMMA_HOME, attributed=OLIVIA, level="person")]) == {
        YOUTH: 1
    }


def test_an_outside_only_camper_with_no_summer_stay_is_not_counted() -> None:
    assert sheet_ages([], [(EMMA, EMMA_HOME, JUNE_20)], PEOPLE, [_credit(SAM_HOME, person=SAMUEL)]) == {}
