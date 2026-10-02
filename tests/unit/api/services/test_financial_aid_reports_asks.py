"""The slice 4 Reports asks through the service (clean spec §9.2, §9.7; D20, D21, D80, D130), with real pricing over
the fictional Reports season (reports_fakes.report_season: Emma posted 1,500 at tier 2 on March 9 2027, Liam decided
1,100 at tier 3, not posted). Fictional only."""

from __future__ import annotations

from datetime import timedelta

import pytest

from api.services.financial_aid_cancellations import CancelEvent
from api.services.financial_aid_reports_service import _pool_label
from tests.unit.api.services.decisions_fakes import ACTOR, FakeDecisionsStore
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.reports_fakes import EMMA, report_season
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
