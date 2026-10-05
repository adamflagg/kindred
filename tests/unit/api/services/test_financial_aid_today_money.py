"""Today's Money lines (campership slice 3 back-end PR-B, ask 3; clean spec §6.4, §8.1; D58, D100; SP11): the
casework To place line, and (Task 3) the finance sources line's needs-a-group reason. Fictional only.
Figures: Session 2 gives a tier-2 family Round 1 = 1,500; Emma (1000011) is in household 1000001."""

from __future__ import annotations

from dataclasses import replace
from decimal import Decimal

import pytest

from api.schemas.financial_aid_grants import UnmappedDescriptionOut
from api.services.financial_aid_to_place import LeftLine
from api.services.financial_aid_to_place_service import OpenToPlace, open_to_place
from api.services.financial_aid_today import TodayService, build_today
from tests.unit.api.services.decisions_fakes import T0, FakeDecisionsStore, FakeRules, approved, seed_line
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.test_financial_aid_decisions_service import _service as _decisions
from tests.unit.api.services.test_financial_aid_today import _Drafts, _Grants, _grants, _inputs, _Ledger, _line
from tests.unit.api.services.to_place_fakes import (
    GRANT_KEY,
    MAR8,
    FakeToPlaceStore,
    one_line,
    seed_override_row,
    to_place_service,
)


def _today(store: FakeToPlaceStore) -> TodayService:
    """Today over `store`, which is also To place's three reads, as the route wires it."""
    return TodayService(
        store=store,
        pricing=FakeRules(approved()),
        rules=_Drafts(None),
        grants=_Grants(_grants(year=YEAR)),
        ledger=_Ledger(),
        to_place=store,
        clock=lambda: T0,
    )


def _four_lines() -> FakeToPlaceStore:
    """Two open lines in two households, one line left at family level and one awaiting tonight's reclassification."""
    store = one_line()  # 9001: 1,500 posted to Emma's household; several requests could take it
    seed_line(store, 9002, "700", household=1000009, person=0, posted=MAR8)  # no request behind it
    seed_line(store, 9003, "200", person=0, posted=MAR8)
    store.left[9003] = LeftLine("dis000000009003", 9003, "The family pays it down")  # left at family level (D58)
    seed_line(store, 9004, "300", person=0, posted=MAR8)
    seed_override_row(store, 9004, source_key=GRANT_KEY)  # reclassified (D104); tonight's sync applies it
    return store


# --- the To place line (casework) ----------------------------------------------------------------------


@pytest.mark.asyncio
async def test_todays_to_place_line_is_money_to_places_own_open_count_and_total() -> None:
    """§6.4 and #2926's known limit: Today's To place figure is the read's open_count and open_total. The left
    and the reclassified lines are apart there, so they are not counted here."""
    store = _four_lines()
    money_tab = await to_place_service(store).read(YEAR)
    assert (money_tab.open_count, money_tab.open_total) == (2, 2200.0)
    out = await _today(store).read(YEAR, casework=True, finance=False)
    line = _line(out.casework, "to_place")
    assert (line.families, line.items, line.item_kind, line.amount, line.skipped) == (2, 2, "lines", 2200.0, "")
    assert (line.items, line.amount) == (money_tab.open_count, money_tab.open_total)


@pytest.mark.asyncio
async def test_before_to_place_began_there_is_nothing_to_count_and_the_line_says_why() -> None:
    """SP11 Decision 12 (owner: nothing before 2027): a 2026 line must not read "0 lines" as if the work were done."""
    store = one_line()
    season = await _decisions(store).season(YEAR)
    found = await open_to_place(replace(season, year=2026), store)
    reason = "2026 predates To place, which starts in 2027"
    assert found == OpenToPlace(lines=0, households=0, total=Decimal(0), skipped=reason)
    line = _line(build_today(_inputs([], to_place=found), casework=True, finance=False).casework, "to_place")
    assert (line.items, line.amount, line.item_kind, line.skipped) == (0, 0.0, "lines", reason)


# --- the needs-a-group reason (finance) -----------------------------------------------------------------


def test_finance_sees_an_outside_source_that_needs_a_group() -> None:
    """§8.1: "An outside source with no group is a 'needs a group' line here and on Today"."""
    grants = _grants(
        unmapped=[
            UnmappedDescriptionOut(
                source_id="src000000000001",
                description_key="regional grant",
                description="Regional Grant",
                lines=3,
                amount=900.0,
            )
        ]
    )
    out = build_today(
        _inputs([], grants=grants, needs_group=["regional grant", "valley grant"]), casework=False, finance=True
    )
    sources = _line(out.finance, "sources")
    assert [(r.code, r.families, r.items) for r in sources.reasons] == [
        ("needs_group", None, 2),
        ("no_grantor", None, 1),
    ]
    assert sources.items == 2  # the regional grant names no grantor AND needs a group: one description, counted once


@pytest.mark.asyncio
async def test_finance_reads_the_descriptions_that_need_a_group_and_casework_does_not() -> None:
    ledger = _Ledger(needs_group=["valley grant"])
    service = TodayService(
        store=FakeDecisionsStore(),
        pricing=FakeRules(approved()),
        rules=_Drafts(None),
        grants=_Grants(_grants(year=YEAR)),
        ledger=ledger,
        clock=lambda: T0,
    )
    await service.read(YEAR, casework=True, finance=False)
    assert ledger.group_calls == 0
    out = await service.read(YEAR, casework=False, finance=True)
    assert [(r.code, r.items) for r in _line(out.finance, "sources").reasons] == [("needs_group", 1)]
    assert ledger.group_calls == 1
