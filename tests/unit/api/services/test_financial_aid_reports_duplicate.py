"""A confirmed duplicate that holds a posted award (owner ruling, queue 4, RULED): Reports counts its money on its own
"Duplicate" line, exactly as a withdrawn request with a posted award (owner (a)) is counted, and moves NO other figure:
Apps, Asked, "# asks", r1_apps, Received and Programs and Development stay as they were. A pending duplicate and a
duplicate with no posted award are unchanged. Fictional only."""

from __future__ import annotations

from dataclasses import replace
from datetime import date
from decimal import Decimal
from typing import Any

import pytest

from api.services.financial_aid_reports_facts import _standing, received_ids
from bunking.financial_aid.reports.facts import RoundFacts
from tests.unit.api.services.decisions_fakes import FakeDecisionsStore, log_seeded, seed_request
from tests.unit.api.services.reports_fakes import EARLY, EMMA, posted, report_season
from tests.unit.api.services.test_financial_aid_development_service import _development
from tests.unit.api.services.test_financial_aid_development_service import _row as dev_row
from tests.unit.api.services.test_financial_aid_development_service import _service as dev_service
from tests.unit.api.services.test_financial_aid_reports_service import _service

pytestmark = pytest.mark.asyncio

YEAR = 2027
NOAH = "reqnoah00000001"


def _season(status: str, *, award: bool = True) -> FakeDecisionsStore:
    """Emma (posted 1,500) and Liam (decided), plus Noah, a request in `status`, holding a posted 1,200 when `award`."""
    store = report_season()
    seed_request(store, NOAH, household=1000003, person=1000031, status=status, income=90000.0, ask=2000.0)
    before = list(store.change_log)
    log_seeded(store, EARLY)  # Noah's request was recorded like the others (its received date); nothing else is added
    store.change_log = [*before, *(r for r in store.change_log[len(before) :] if r.entity_id == NOAH)]
    if award:
        store.events.append(posted("ev0000000000002", NOAH, 1, "1200", 3))
    return store


def _counts(out: Any) -> tuple[Any, ...]:
    """Every figure the ruling must NOT move: Apps, Asked and "# asks", in every tier row and the total."""
    return tuple((r.tier, r.apps, r.asked, r.asks) for r in [*out.rows, out.total])


async def test_a_confirmed_duplicate_with_a_posted_award_reads_as_cancelled_on_its_own_duplicate_line() -> None:
    out = await _service(_season("duplicate")).statistics(YEAR, table="camp", round_=1)
    assert out.total.cancelled == 1
    assert len(out.recipients_cancelled) == 1
    line = out.recipients_cancelled[0]
    assert (line.reason, line.reason_label, line.requests, line.posted) == (
        "duplicate_in_kindred",
        "Duplicate",
        1,
        1200.0,
    )


async def test_the_duplicate_is_counted_exactly_as_its_withdrawn_twin_is_in_the_money() -> None:
    """Same money rules as owner (a): As offered, End of season and the recipients line match the withdrawn twin's."""
    dup = _service(_season("duplicate"))
    twin = _service(_season("withdrawn"))
    d, t = await dup.committee(YEAR), await twin.committee(YEAR)
    assert [p.model_dump() for p in d.phases] == [p.model_dump() for p in t.phases]
    assert any(v for p in d.phases for v in p.offered if v)  # something is offered at all
    ds, ts = await dup.statistics(YEAR, table="camp", round_=1), await twin.statistics(YEAR, table="camp", round_=1)
    assert ds.recipients_cancelled[0].posted == ts.recipients_cancelled[0].posted == 1200.0
    assert (ds.total.amount, ds.total.awarded) == (ts.total.amount, ts.total.awarded)


async def test_the_duplicate_adds_its_award_to_as_offered_and_nothing_to_end_of_season() -> None:
    """As offered reads the lock whatever happened after it; End of season is net of cancellations."""
    base = await _service(_season("duplicate", award=False)).committee(YEAR)
    out = await _service(_season("duplicate")).committee(YEAR)
    before, after = base.phases[-1], out.phases[-1]
    assert sum(v or 0 for v in after.offered) - sum(v or 0 for v in before.offered) == 1200.0
    assert (after.total, after.phases) == (before.total, before.phases)


async def test_a_posted_duplicate_moves_no_apps_asked_or_ask_count_anywhere() -> None:
    base_service = _service(_season("duplicate", award=False))
    service = _service(_season("duplicate"))
    base_stats = await base_service.statistics(YEAR, table="camp", round_=1)
    stats = await service.statistics(YEAR, table="camp", round_=1)
    assert _counts(stats) == _counts(base_stats)
    assert stats.total.apps == 2
    programs, base_programs = await service.programs(YEAR), await base_service.programs(YEAR)
    assert programs.model_dump() == base_programs.model_dump()
    committee, base_committee = await service.committee(YEAR), await base_service.committee(YEAR)
    assert [a.model_dump() for a in committee.applications] == [a.model_dump() for a in base_committee.applications]
    assert [a.model_dump() for a in committee.appeals] == [a.model_dump() for a in base_committee.appeals]
    assert [b.model_dump() for b in committee.budget] == [b.model_dump() for b in base_committee.budget]
    assert [r.model_dump() for r in committee.round1_pct] == [r.model_dump() for r in base_committee.round1_pct]
    tiers, base_tiers = stats.tier_appeals, base_stats.tier_appeals
    assert [r.model_dump() for r in tiers] == [r.model_dump() for r in base_tiers]


async def test_a_posted_duplicate_moves_no_development_figure() -> None:
    base = await dev_service(_development(), store=_season("duplicate", award=False)).development(YEAR)
    out = await dev_service(_development(), store=_season("duplicate")).development(YEAR)
    assert [r.model_dump() for r in out.rows] == [r.model_dump() for r in base.rows]
    assert dev_row(out, "total_awards", "camp_pool").values == dev_row(base, "total_awards", "camp_pool").values


async def test_received_does_not_include_the_duplicate_and_the_request_set_still_excludes_it() -> None:
    store = _season("duplicate")
    assert NOAH not in received_ids(store.requests)
    assert EMMA in received_ids(store.requests)
    out = await _service(store).statistics(YEAR, table="camp", round_=1, through=date(2027, 3, 1))
    assert out.total.apps == 2
    assert out.recipients_cancelled == []  # a received-through cut keeps only received requests


async def test_a_confirmed_duplicate_with_no_posted_award_stays_closed_and_absent() -> None:
    store = _season("duplicate", award=False)
    out = await _service(store).statistics(YEAR, table="camp", round_=1)
    assert (out.total.apps, out.total.cancelled, out.recipients_cancelled) == (2, 0, [])


async def test_a_pending_duplicate_with_a_posted_award_is_unchanged() -> None:
    out = await _service(_season("duplicate_pending")).statistics(YEAR, table="camp", round_=1)
    assert (out.total.cancelled, out.recipients_cancelled) == (0, [])
    assert out.total.apps == 3  # a pending duplicate is received and stays in the apps


async def test_standing_reads_the_lock_not_the_net_posted_for_a_duplicate() -> None:
    dup = replace(_season("duplicate").requests[NOAH], status="duplicate")
    locked = RoundFacts(1, Decimal(2000), Decimal(1200), True, None, False, None, 3, "camp_pool")
    assert _standing(dup, False, (locked,)) == "cancelled"  # clawed back since: still counted, like withdrawn
    assert _standing(dup, False, (replace(locked, locked=None),)) == "closed"
    assert _standing(replace(dup, status="duplicate_pending"), False, (locked,)) == "closed"


def test_development_tallies_no_cancellation_for_a_posted_duplicate() -> None:
    """Development's cancelled-by-reason lines are its own figures: a duplicate is Finance's Duplicate line alone."""
    from bunking.financial_aid.reports.development import development_column
    from tests.unit.bunking.financial_aid.report_fixtures import req, rnd
    from tests.unit.bunking.financial_aid.test_report_development import _camp, _inputs

    duplicate = req(
        "reqnoah00000001", rnd(1, ask="2000", posted="1200"), standing="cancelled", reason="duplicate_in_kindred"
    )
    duplicate = replace(duplicate, counts_as_received=False)
    column = development_column(_inputs(requests=(duplicate,)))
    assert _camp(column).cancelled_by_reason == {}
