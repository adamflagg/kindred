"""Reports › Development › ZIP codes (clean spec §9.4; D66, D90): two tables by the household's billing ZIP; small
groups as they are, never a family's row. Fictional households and ZIPs only."""

from __future__ import annotations

from decimal import Decimal

import pytest

from bunking.financial_aid.reports.zips import NO_ZIP, OUTSIDE_US, HouseholdAddress, every_camper, with_aid, zip_of

HOMES = {
    1000001: HouseholdAddress("94000-1234", "US"),
    1000002: HouseholdAddress("94000", ""),
    1000003: HouseholdAddress("A1A 1A1", "Canada"),
    1000004: HouseholdAddress("", "US"),
    1000005: HouseholdAddress("9400", "US"),
    1000006: HouseholdAddress("93000", "United States"),
}


@pytest.mark.parametrize(
    ("household", "expected"),
    [
        (1000001, ("94000", "us")),
        (1000002, ("94000", "us")),
        (1000003, (OUTSIDE_US, "outside_us")),
        (1000004, (NO_ZIP, "none")),
        (1000005, (NO_ZIP, "none")),  # malformed
        (1000099, (NO_ZIP, "none")),  # no household record for the season
    ],
)
def test_the_zip_is_the_first_five_digits_of_the_billing_postal_code(household: int, expected: tuple[str, str]) -> None:
    assert zip_of(HOMES.get(household)) == expected


def test_every_camper_counts_campers_and_families_by_zip_with_the_odd_rows_last() -> None:
    table = every_camper(
        [
            (1000011, 1000001),
            (1000012, 1000001),
            (1000021, 1000002),
            (1000031, 1000003),
            (1000041, 1000004),
            (1000061, 1000006),
        ],
        HOMES,
    )
    assert [(r.zip, r.campers, r.families) for r in table.rows] == [
        ("93000", 1, 1),
        ("94000", 3, 2),
        (OUTSIDE_US, 1, 1),
        (NO_ZIP, 1, 1),
    ]
    assert (table.total.campers, table.total.families, table.zips) == (6, 5, 2)
    assert all(r.dollars is None for r in table.rows)


def test_with_aid_puts_each_campers_money_and_household_level_dollars_on_the_households_zip() -> None:
    """A household-level grant counts its household as a family and its dollars, but never a camper."""
    table = with_aid(
        {1000011: Decimal(1500), 1000021: Decimal(800)},
        {1000011: 1000001, 1000021: 1000002},
        {1000006: Decimal(300)},
        HOMES,
    )
    assert [(r.zip, r.campers, r.families, r.dollars) for r in table.rows] == [
        ("93000", 0, 1, Decimal(300)),
        ("94000", 2, 2, Decimal(2300)),
    ]
    assert (table.total.campers, table.total.families, table.total.dollars) == (2, 3, Decimal(2600))
