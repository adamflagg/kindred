"""Money > Ledger's family read and the lines behind its totals (campership slice 3, ask 1; §5.5, §8.1; D26, D54,
D74, D97, D151), over the decisions service's real pricing and placement. Fictional only."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import get_args

import pytest

from api.schemas.financial_aid_money_ledger import LedgerFamilyOut, LedgerLevelOut, LedgerTotalOut, MoneyLedgerOut
from api.services.financial_aid_money_ledger import LedgerFilters, LedgerLevel, LedgerTotal
from api.services.financial_aid_reconciliation import SplitPart
from tests.unit.api.services.decisions_fakes import log_seeded, seed_line, seed_override, seed_request, share_row
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.to_place_fakes import (
    FakeLabels,
    FakeToPlaceStore,
    money_ledger_service,
    seed_grant_line,
)

EMMA = "reqemma00000001"  # Emma Johnson (1000011), household 1000001
SAMUEL = "reqsamu00000001"  # Samuel Johnson (1000012), the same household
LIAM = "reqliam00000001"  # Liam Garcia (1000021), household 1000002
SEEDED = datetime(2027, 2, 1, 18, 0, tzinfo=UTC)
JUL1 = datetime(2027, 7, 1, 18, 0, tzinfo=UTC)
REVERSED = datetime(2027, 3, 9, 12, 0, tzinfo=UTC)  # before the read's "today" (T0, Mar 9 17:00 UTC)


def _families() -> FakeToPlaceStore:
    """The Johnsons (Emma and Samuel; Emma's request paid 60/40 with a second home, 1000004), the Garcias, and a
    household with no request (1000009)."""
    store = FakeToPlaceStore()
    seed_request(store, EMMA)
    seed_request(store, SAMUEL, person=1000012)
    seed_request(store, LIAM, household=1000002, person=1000021)
    store.shares = [
        *(s for s in store.shares if s.request_id != EMMA),
        share_row(EMMA, 1000001, "60"),
        share_row(EMMA, 1000004, "40"),
    ]
    seed_line(store, 9001, "1500")  # posted to Emma: her one request takes it
    seed_line(store, 9002, "3000", person=0)  # the household's: Emma's or Samuel's, a person must say
    seed_line(store, 9003, "300", reversed_at=REVERSED)  # reversed (D54)
    seed_line(store, 9010, "1200", household=1000002, person=1000021)  # Liam's
    seed_line(store, 9004, "700", household=1000009, person=0)  # no request behind it
    seed_grant_line(store, 9101, "250", household=1000004)  # the second home's outside grant
    return store


def _rows(out: MoneyLedgerOut) -> list[tuple[object, ...]]:
    return [
        (
            r.household_cm_id,
            r.family_households,
            r.campers,
            r.in_campminder_net,
            r.outside_grants,
            r.lines,
            r.reversed_lines,
            r.level,
        )
        for r in out.rows
    ]


def test_the_levels_and_totals_the_screen_offers_are_the_ledgers() -> None:
    assert get_args(LedgerLevelOut) == get_args(LedgerLevel)
    assert get_args(LedgerTotalOut) == get_args(LedgerTotal)


@pytest.mark.asyncio
async def test_one_row_per_family_with_the_two_columns_and_the_level() -> None:
    out = await money_ledger_service(_families()).ledger(YEAR)
    assert (out.year, out.as_of, out.as_of_axis) == (YEAR, None, None)
    assert _rows(out) == [
        (1000001, [1000001, 1000004], ["Camper 1000011"], 4500.0, 250.0, 4, 1, "household"),
        (1000002, [1000002], ["Camper 1000021"], 1200.0, 0.0, 1, 0, None),
        (1000009, [1000009], [], 700.0, 0.0, 1, 0, "no_request"),
    ]
    assert out.rows[0].display_name == "Family 1000001"
    assert (out.in_campminder_net, out.outside_grants) == (6400.0, 250.0)  # the rows' sums


@pytest.mark.asyncio
async def test_a_season_before_the_first_ticked_one_shows_no_level_anywhere(monkeypatch: pytest.MonkeyPatch) -> None:
    """Owner question 7 (default): a season before FIRST_TICKED_SEASON has no level pills, on a row or a line. The
    money is unchanged. (LEAD FIX: the fakes filter by year and seed only YEAR, so a literal 2026 read would be
    empty; move the first ticked season past YEAR instead.)"""
    monkeypatch.setattr("api.services.financial_aid_money_ledger_service.FIRST_TICKED_SEASON", YEAR + 1)
    service = money_ledger_service(_families())
    out = await service.ledger(YEAR)
    assert [r.level for r in out.rows] == [None, None, None]
    assert (out.in_campminder_net, out.outside_grants) == (6400.0, 250.0)
    lines = await service.lines(YEAR, "in_campminder_net")
    assert [ln.level for ln in lines.lines] == [None] * 5


@pytest.mark.asyncio
async def test_each_line_carries_its_programs_label_from_the_seasons_rules() -> None:
    """`program` is a key (a program family); `program_label` is the rules' own word for it (fictional_rules)."""
    lines = await money_ledger_service(_families()).lines(YEAR, "in_campminder_net")
    pairs = {(ln.program, ln.program_label) for ln in lines.lines}
    assert pairs  # the season has lines
    assert all(label for program, label in pairs if program)  # every program the rules name reads as words
    assert ("summer", "Summer") in pairs


@pytest.mark.asyncio
async def test_a_split_in_full_takes_the_household_level_off_the_row() -> None:
    """D151 (owner, Group 3a Q3): the Ledger reads placements, so a split line is not "household level"."""
    store = _families()
    store.splits[9002] = (
        SplitPart(1000011, 1000101, "summer", Decimal(1800)),
        SplitPart(1000012, 1000101, "summer", Decimal(1200)),
    )
    row = (await money_ledger_service(store).ledger(YEAR)).rows[0]
    assert (row.household_cm_id, row.level, row.in_campminder_net) == (1000001, None, 4500.0)
    assert row.campers == ["Camper 1000011", "Camper 1000012"]


@pytest.mark.asyncio
async def test_the_filters_narrow_each_familys_lines_before_they_are_summed() -> None:
    service = money_ledger_service(_families())
    household = await service.ledger(YEAR, filters=LedgerFilters(level="household"))
    assert [(r.household_cm_id, r.in_campminder_net, r.outside_grants, r.lines) for r in household.rows] == [
        (1000001, 3000.0, 0.0, 1)
    ]
    grants = await service.ledger(YEAR, filters=LedgerFilters(source="other_outside"))
    assert [(r.household_cm_id, r.outside_grants) for r in grants.rows] == [(1000001, 250.0)]
    assert (grants.in_campminder_net, grants.outside_grants) == (0.0, 250.0)


@pytest.mark.asyncio
async def test_a_past_day_reads_the_lines_and_the_placements_as_they_were() -> None:
    store = _families()
    log_seeded(store, SEEDED)  # the requests and payer shares replay
    seed_override(store, 9002, 1000012, datetime(2027, 4, 1, 18, 0, tzinfo=UTC))  # placed on Samuel's on Apr 1
    seed_line(store, 9005, "400", posted=datetime(2027, 5, 1, 18, 0, tzinfo=UTC))  # posted after the day
    service = money_ledger_service(store, clock=JUL1)
    past = await service.ledger(YEAR, as_of=date(2027, 3, 20))
    live = await service.ledger(YEAR)
    assert (past.as_of, past.as_of_axis) == (date(2027, 3, 20), "campminder")
    assert [(r.household_cm_id, r.in_campminder_net, r.lines, r.level) for r in past.rows][:2] == [
        (1000001, 4500.0, 4, "household"),
        (1000002, 1200.0, 1, None),  # Liam's line was on his request that day too
    ]
    assert [(r.household_cm_id, r.in_campminder_net, r.lines, r.level) for r in live.rows][:2] == [
        (1000001, 4900.0, 5, None),
        (1000002, 1200.0, 1, None),
    ]


@pytest.mark.asyncio
async def test_the_recorded_axis_counts_only_what_kindred_had_recorded() -> None:
    store = _families()
    log_seeded(store, SEEDED)
    seed_line(store, 9006, "250", recorded=datetime(2027, 3, 25, 18, 0, tzinfo=UTC))  # posted Mar 8, seen Mar 25
    service = money_ledger_service(store, clock=JUL1)
    campminder = await service.ledger(YEAR, as_of=date(2027, 3, 20))
    recorded = await service.ledger(YEAR, as_of=date(2027, 3, 20), axis="recorded")
    assert campminder.rows[0].in_campminder_net - recorded.rows[0].in_campminder_net == 250.0
    assert recorded.as_of_axis == "recorded"


@pytest.mark.asyncio
async def test_a_day_today_or_later_is_the_live_read() -> None:
    out = await money_ledger_service(_families()).ledger(YEAR, as_of=date(2027, 3, 9))
    assert (out.as_of, out.as_of_axis, out.in_campminder_net) == (None, None, 6400.0)


@pytest.mark.asyncio
async def test_the_lines_behind_each_total_add_up_to_it_and_keep_a_reversed_line() -> None:
    service = money_ledger_service(_families())
    camp = await service.lines(YEAR, "in_campminder_net")
    assert (camp.total, camp.amount) == ("in_campminder_net", 6400.0)
    assert [
        (ln.transaction_cm_id, ln.family_household_cm_id, ln.amount, ln.is_reversed, ln.level) for ln in camp.lines
    ] == [
        (9001, 1000001, 1500.0, False, None),
        (9002, 1000001, 3000.0, False, "household"),
        (9003, 1000001, 300.0, True, None),
        (9010, 1000002, 1200.0, False, None),
        (9004, 1000009, 700.0, False, "no_request"),
    ]
    first, _, gone = camp.lines[:3]
    assert (first.family_name, first.camper, first.description, first.posted_on) == (
        "Family 1000001",
        "Camper 1000011",
        "Camp FA",
        date(2027, 3, 8),
    )
    assert gone.reversed_on == date(2027, 3, 9)
    outside = await service.lines(YEAR, "outside_grants")
    assert (outside.amount, [(ln.transaction_cm_id, ln.household_cm_id, ln.description) for ln in outside.lines]) == (
        250.0,
        [(9101, 1000004, "Summer Program Grant")],
    )


# --- naming the family (ruling D, owner 10-06) ----------------------------------------------------
# A family row names its family by the household card's label, from the household page's own helper, with a tie-break
# only where two rows of the same response read the same.

BECKERS = "Liam & Olivia Becker"


@pytest.mark.asyncio
async def test_each_family_row_names_its_family_by_the_household_pages_label() -> None:
    labels = FakeLabels({1000001: BECKERS, 1000002: BECKERS})
    out = await money_ledger_service(_families(), labels=labels).ledger(YEAR)
    assert [(r.household_cm_id, r.label, r.label_tiebreak) for r in out.rows] == [
        (1000001, BECKERS, "#1000001"),
        (1000002, BECKERS, "#1000002"),
        (1000009, "Adults 1000009", ""),
    ]
    assert out.rows[0].display_name == "Family 1000001"  # the old name stays as it was
    # One call, the rows' households: the family's second home (1000004) is in Emma's row, not a row of its own.
    assert labels.calls == [frozenset({1000001, 1000002, 1000009})]


@pytest.mark.asyncio
async def test_a_filtered_ledger_breaks_ties_only_among_the_rows_it_shows() -> None:
    labels = FakeLabels({1000001: BECKERS, 1000002: BECKERS})
    out = await money_ledger_service(_families(), labels=labels).ledger(
        YEAR, filters=LedgerFilters(None, None, "household")
    )
    assert [(r.household_cm_id, r.label, r.label_tiebreak) for r in out.rows] == [(1000001, BECKERS, "")]
    assert labels.calls == [frozenset({1000001})]


def test_a_family_rows_label_defaults_to_empty() -> None:
    assert LedgerFamilyOut.model_fields["label"].default == ""
    assert LedgerFamilyOut.model_fields["label_tiebreak"].default == ""
