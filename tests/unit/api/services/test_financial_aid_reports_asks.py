"""The slice 4 Reports asks through the service (clean spec §9.2, §9.7; D20, D21, D80, D130), with real pricing over
the fictional Reports season (reports_fakes.report_season: Emma posted 1,500 at tier 2 on March 9 2027, Liam decided
1,100 at tier 3, not posted). Fictional only."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from api.services.financial_aid_cancellations import CancelEvent
from api.services.financial_aid_reports_service import ReportsRefusedError, _pool_label
from tests.unit.api.services.decisions_fakes import ACTOR, FakeDecisionsStore
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.reports_fakes import EMMA, LIAM, report_season
from tests.unit.api.services.test_financial_aid_reports_service import NOW, RULES, _service

pytestmark = pytest.mark.asyncio


def _cancel_emma(store: FakeDecisionsStore) -> FakeDecisionsStore:
    store.cancel_events.append(
        CancelEvent(
            "can000000000009",
            EMMA,
            "cancel",
            NOW - timedelta(days=1),
            reason="aid_not_enough",
            in_kindred=True,
            actor=ACTOR,
        )
    )
    return store


# --- asks 2, 3 and 4's label ------------------------------------------------------------------------------------


async def test_the_decided_basis_sends_posted_alone_beside_its_amount_and_labels_both_percents() -> None:
    """Asks 2 and 4: `awarded` is Posted alone; each % column's heading names the decided numerator (owner B4a (b))."""
    service = _service(report_season())
    posted = await service.statistics(YEAR, table="camp", round_=1)
    both = await service.statistics(YEAR, table="camp", round_=1, basis="posted_and_decided")
    assert (posted.total.awarded, posted.total.amount) == (1500.0, 1500.0)
    assert (both.total.awarded, both.total.decided, both.total.amount) == (1500.0, 1100.0, 2600.0)
    assert (posted.pct_of_ask_label, posted.pct_of_ask_with_grants_label) == ("% of ask", "% of ask incl. grants")
    assert (both.pct_of_ask_label, both.pct_of_ask_with_grants_label) == (
        "% of ask (posted + decided)",
        "% of ask incl. grants (posted + decided)",
    )


async def test_rpt_22_rows_carry_their_pools_label_from_the_seasons_rules() -> None:
    """Ask 3: the label RPT-23 and Programs already send for the same pool."""
    out = await _service(_cancel_emma(report_season())).statistics(YEAR, table="camp", round_=1)
    [row] = out.recipients_cancelled
    assert (row.pool, row.pool_label) == ("camp_pool", "Camp")


def test_a_pool_label_reads_no_pool_for_null_and_the_key_for_a_pool_the_rules_dont_name() -> None:
    """Ask 3's two edges: never a blank label."""
    assert _pool_label(RULES, None) == "No pool"
    assert _pool_label(RULES, "retired_pool") == "retired_pool"


# --- asks 1 and 8: the requests behind a count -------------------------------------------------------------------


async def test_a_statistics_count_opens_exactly_its_requests() -> None:
    """Emma: tier 2, posted. Liam: tier 3, decided only (D130)."""
    service = _service(report_season())
    tier2 = await service.statistics_request_ids(YEAR, part="tier", table="camp", tier=2, count="apps")
    assert (tier2.request_ids, tier2.as_of, tier2.request_set) == ([EMMA], None, None)
    total = await service.statistics_request_ids(YEAR, part="total", table="camp", count="awarded")
    assert total.request_ids == [EMMA]
    posted = await service.statistics_request_ids(YEAR, part="tier", table="camp", tier=3, count="decided")
    decided = await service.statistics_request_ids(
        YEAR, part="tier", table="camp", tier=3, count="decided", basis="posted_and_decided"
    )
    assert (posted.request_ids, decided.request_ids) == ([], [LIAM])


async def test_rpt_22_and_rpt_23_rows_open_their_requests() -> None:
    """Ask 8: RPT-23's waiting (Emma: posted, not accepted, no Round 2 ask)."""
    waiting = await _service(report_season()).statistics_request_ids(
        YEAR, part="outcome", outcome_row="headline", outcome="waiting"
    )
    assert waiting.request_ids == [EMMA]
    cancelled = await _service(_cancel_emma(report_season())).statistics_request_ids(
        YEAR, part="cancelled", table="camp", reason="aid_not_enough", pool="camp_pool", posted_round=1
    )
    assert cancelled.request_ids == [EMMA]


async def test_the_ids_follow_the_reads_date_and_its_request_set() -> None:
    """D20 on a past day and under a reporting control: the ids are that read's count, never today's."""
    service = _service(report_season())
    before = await service.statistics_request_ids(YEAR, part="total", count="awarded", as_of=date(2027, 3, 8))
    assert (before.request_ids, before.as_of, before.figures_on) == ([], date(2027, 3, 8), date(2027, 3, 8))
    assert (await service.statistics(YEAR, as_of=date(2027, 3, 8))).total.awarded_count == 0
    late = _service(report_season(liam_late=True))
    cut = await late.statistics_request_ids(YEAR, part="total", count="apps", through=date(2027, 2, 1))
    assert cut.request_ids == [EMMA]
    assert cut.request_set is not None


async def test_a_programs_count_opens_exactly_its_requests() -> None:
    """Both families are in Session 2 (camp pool); only Emma is awarded."""
    service = _service(report_season())
    apps = await service.programs_request_ids(
        YEAR, part="session", pool="camp_pool", session=1000101, block=1, count="apps"
    )
    awards = await service.programs_request_ids(YEAR, part="subtotal", pool="camp_pool", block=1, count="awarded")
    every = await service.programs_request_ids(YEAR, part="total", block=1, count="apps")
    assert (apps.request_ids, awards.request_ids, every.request_ids) == ([EMMA, LIAM], [EMMA], [EMMA, LIAM])


@pytest.mark.parametrize(
    "selector",
    [
        {"part": "tier", "tier": 2},  # no count
        {"part": "total"},  # no count
        {"part": "cancelled", "reason": "medical"},  # no posted_round
        {"part": "outcome", "outcome_row": "pool", "outcome": "waiting"},  # a pool row with no pool
        {"part": "outcome", "outcome_row": "headline"},  # no outcome
        {"part": "tier", "tier": 2, "count": "apps", "table": "nowhere"},  # not an award table
    ],
)
async def test_a_statistics_selector_missing_what_its_part_needs_is_refused(selector: dict[str, object]) -> None:
    with pytest.raises(ReportsRefusedError):
        await _service(report_season()).statistics_request_ids(YEAR, **selector)  # type: ignore[arg-type]


async def test_a_programs_session_row_needs_its_session() -> None:
    with pytest.raises(ReportsRefusedError, match="session"):
        await _service(report_season()).programs_request_ids(
            YEAR, part="session", pool="camp_pool", block=1, count="apps"
        )
