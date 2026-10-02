"""Reports › Development › ZIP codes (clean spec §9.4's ZIP screen; D66, D90). Pure: no I/O.

One season, two tables, over the summer group's campers (the Summer Camp & Quest campers development's counts use,
teen programs included). Only attendees of aid-eligible sessions are in the summer group (owner rule, item 28: the
sessions a program open to aid claims), so a camper who attended only a session that is not aid-eligible is in neither
table:

  every camper   enrolled (status 2) in an aid-eligible session: campers and families (CampMinder households) by ZIP;
  with aid       attended and got money from any source (development's recipients, all money): campers, families
                 and dollars by ZIP. A camper's money lands on their household's ZIP; a household-level grant's
                 dollars land on that household's ZIP (and count it as a family).

ZIP = the first five digits of the billing postal code on the household's record for that season (households are
year-scoped records). "Outside the US" and "No ZIP on file" (blank, malformed, or no household record) are their own
rows, listed after every ZIP. Small groups show as they are, including a ZIP with one family; there is never a row
per family (D90).
"""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Final, Literal

from bunking.financial_aid.money import ZERO

ZipKind = Literal["us", "outside_us", "none"]
OUTSIDE_US: Final = "Outside the US"
NO_ZIP: Final = "No ZIP on file"
_US: Final = frozenset({"", "US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"})
_ZIP: Final = re.compile(r"(\d{5})(?:[-\s]?\d{4})?")


@dataclass(frozen=True)
class HouseholdAddress:
    postal_code: str
    country: str


@dataclass(frozen=True)
class ZipRow:
    zip: str  # five digits, OUTSIDE_US or NO_ZIP
    kind: ZipKind
    campers: int
    families: int
    dollars: Decimal | None  # None on the every-camper table


@dataclass(frozen=True)
class ZipTable:
    rows: tuple[ZipRow, ...]
    total: ZipRow  # zip "" : every row summed (families counted once)
    zips: int  # distinct five-digit ZIPs


def zip_of(address: HouseholdAddress | None) -> tuple[str, ZipKind]:
    if address is None or not address.postal_code.strip():
        return NO_ZIP, "none"
    if address.country.strip().upper() not in _US:
        return OUTSIDE_US, "outside_us"
    match = _ZIP.fullmatch(address.postal_code.strip())
    return (match.group(1), "us") if match else (NO_ZIP, "none")


@dataclass
class _Cell:
    campers: set[int] = field(default_factory=set)
    families: set[int] = field(default_factory=set)
    dollars: Decimal = ZERO


def _table(cells: Mapping[tuple[str, ZipKind], _Cell], *, with_dollars: bool) -> ZipTable:
    order = {"us": 0, "outside_us": 1, "none": 2}
    rows = tuple(
        ZipRow(z, kind, len(c.campers), len(c.families), c.dollars if with_dollars else None)
        for (z, kind), c in sorted(cells.items(), key=lambda kv: (order[kv[0][1]], kv[0][0]))
    )
    campers = set().union(*(c.campers for c in cells.values())) if cells else set()
    families = set().union(*(c.families for c in cells.values())) if cells else set()
    dollars = sum((c.dollars for c in cells.values()), ZERO)
    total = ZipRow("", "us", len(campers), len(families), dollars if with_dollars else None)
    return ZipTable(rows, total, sum(1 for (_, kind) in cells if kind == "us"))


def every_camper(enrolled: Iterable[tuple[int, int]], households: Mapping[int, HouseholdAddress]) -> ZipTable:
    """`enrolled`: (camper, their household) for every enrolled camper of the summer group."""
    cells: dict[tuple[str, ZipKind], _Cell] = defaultdict(_Cell)
    for camper, household in enrolled:
        cell = cells[zip_of(households.get(household))]
        cell.campers.add(camper)
        cell.families.add(household)
    return _table(cells, with_dollars=False)


def with_aid(
    money_by_camper: Mapping[int, Decimal],
    household_of: Mapping[int, int],
    household_level: Mapping[int, Decimal],
    households: Mapping[int, HouseholdAddress],
) -> ZipTable:
    """Development's summer-group recipients (`money_by_camper`: all money per camper), each on their household's
    ZIP (`household_of`), and the household-level grant dollars on theirs."""
    cells: dict[tuple[str, ZipKind], _Cell] = defaultdict(_Cell)
    for camper, money in money_by_camper.items():
        household = household_of.get(camper, 0)
        cell = cells[zip_of(households.get(household))]
        cell.campers.add(camper)
        cell.families.add(household)
        cell.dollars += money
    for household, money in household_level.items():
        cell = cells[zip_of(households.get(household))]
        cell.families.add(household)
        cell.dollars += money
    return _table(cells, with_dollars=True)
