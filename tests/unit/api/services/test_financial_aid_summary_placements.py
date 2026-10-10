"""/summary's levels read Kindred's placements (campership slice 3 back-end PR-B, ask 7; clean spec §8.1; D151;
owner ruling Group 3a Q3; #2926's known limit "a split is invisible to readers of Go's attribution"). Fictional only."""

from __future__ import annotations

from decimal import Decimal

import pytest

from api.services.financial_aid_ledger_service import FinancialAidLedgerService
from api.services.financial_aid_reconciliation import SplitPart, split_placed
from tests.unit.api.services.decisions_fakes import FakeDecisionsStore, seed_line, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import _service
from tests.unit.api.services.test_financial_aid_ledger_service import _grant, _posting, _repo

EMMA = "reqemma00000001"  # Emma Johnson (1000011), household 1000001
SAMUEL = "reqsamu00000001"  # Samuel Johnson (1000012), household 1000001


def _johnsons(*parts: tuple[int, str]) -> FakeDecisionsStore:
    """Emma's and Samuel's requests, and one 2,500 line posted to their household that a registrar split."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, SAMUEL, person=1000012)
    seed_line(store, 9001, "2500", person=0)
    store.splits[9001] = tuple(SplitPart(person, 0, "", Decimal(amount)) for person, amount in parts)
    return store


async def _placed(store: FakeDecisionsStore) -> dict[int, Decimal]:
    season = await _service(store).season(YEAR)
    return split_placed(season.ledger, season.splits, season.camp_lines)


# --- which dollars of a split line Kindred placed (pure, over the priced season) ----------------------------


@pytest.mark.asyncio
async def test_a_split_line_placed_in_full_is_placed_in_full() -> None:
    assert await _placed(_johnsons((1000011, "1500"), (1000012, "1000"))) == {9001: Decimal(2500)}


@pytest.mark.asyncio
async def test_a_part_no_request_takes_is_not_counted_as_placed() -> None:
    """1000099 has no request: that part waits at family level, in To place."""
    assert await _placed(_johnsons((1000011, "1500"), (1000099, "1000"))) == {9001: Decimal(1500)}


@pytest.mark.asyncio
async def test_a_split_that_does_not_add_up_places_nothing() -> None:
    """build_ledger leaves the whole line unplaced (CampMinder never changes a posted amount: a bad record)."""
    assert await _placed(_johnsons((1000011, "1500"), (1000012, "900"))) == {}


# --- /summary's by_level ------------------------------------------------------------------------------------


def _four_lines() -> list[object]:
    return [
        _posting(9001, 1000001, -2500.0, attribution_level="program_family"),  # split in full by a registrar
        _posting(9002, 1000001, -1500.0, attribution_level="program_family"),  # split; one part placed
        _posting(9003, 1000002, -400.0, attribution_level="program_family"),  # nobody split it
        _grant(9004, 1000003, -300.0, attribution_level="none"),  # outside money: never a camp placement
    ]


@pytest.mark.asyncio
async def test_a_split_lines_placed_dollars_read_placed_by_staff() -> None:
    """D151: a split line is not household level. Its placed dollars count at "override", the level Go gives a
    whole-line staff placement; the part no request took keeps Go's level. Totals don't move."""
    service = FinancialAidLedgerService(_repo(fetch_postings=_four_lines()))
    got = await service.summary(2027, split_placed={9001: Decimal(2500), 9002: Decimal(1000), 9004: Decimal(300)})
    assert got.by_level == {"override": 3500.0, "program_family": 900.0, "none": 300.0}
    assert (got.by_level_basis, got.total_aid) == ("placements", 4700.0)


@pytest.mark.asyncio
async def test_without_placements_the_levels_are_gos() -> None:
    got = await FinancialAidLedgerService(_repo(fetch_postings=_four_lines())).summary(2027)
    assert got.by_level == {"program_family": 4400.0, "none": 300.0}
    assert got.by_level_basis == "attribution"


@pytest.mark.asyncio
async def test_a_split_lines_placed_dollars_count_as_placed_in_the_camp_aid_shares() -> None:
    """D151 in the F10 shares too: a split line's placed dollars are "placed". The unplaced part keeps Go's level,
    program_family, which is placed on a program: owner ruling (final audit), Family Camp household-request money counts
    as placed on a request, so the household-level share is only the program table's "Household level" row
    (ambiguous). The outside grant (9004) is never in the shares."""
    service = FinancialAidLedgerService(_repo(fetch_postings=_four_lines()))
    got = await service.summary(2027, split_placed={9001: Decimal(2500), 9002: Decimal(1000), 9004: Decimal(300)})
    assert [(lvl.group, lvl.amount, lvl.share) for lvl in got.camp_aid_levels] == [
        ("placed", 4400.0, 1.0),
        ("household", 0.0, 0.0),
        ("not_placed", 0.0, 0.0),
    ]
    assert (got.camp_aid, got.outside_grants) == (4400.0, 300.0)
