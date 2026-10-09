"""The requests behind a Statistics, RPT-22 or RPT-23 count (slice 4 asks 1 and 8; clean spec §9.1 D20, §9.2,
§9.7; D72, D80, D129–D131, D157): exactly the requests the count counts, from the same predicate. Fictional only."""

from __future__ import annotations

from typing import get_args

import pytest

from bunking.financial_aid.reports.facts import ReportRequest
from bunking.financial_aid.reports.statistics import (
    RoundChip,
    StatisticsCount,
    StatisticsRow,
    cancelled_members,
    outcome_members,
    outcomes,
    statistics,
    tier_appeals,
    tier_appeals_members,
    tier_members,
)
from tests.unit.bunking.financial_aid.fixtures import fictional_rules
from tests.unit.bunking.financial_aid.report_fixtures import req, rnd

RULES = fictional_rules()
EMMA, LIAM, NOAH, OLIVIA, RILEY, SAMUEL = (
    f"req{name}00000001" for name in ("emma", "liam", "noah", "oliv", "rile", "samu")
)
ROUNDS: tuple[RoundChip, ...] = (1, 2, None)
FIELD: dict[str, str] = {
    "apps": "apps",
    "cancelled": "cancelled",
    "asks": "asks",
    "awarded": "awarded_count",
    "decided": "decided_count",
}


def season() -> list[ReportRequest]:
    return [
        req(EMMA, rnd(1, ask="4000", posted="1500")),  # tier 2: posted, not accepted, no appeal: waiting
        req(LIAM, rnd(1, ask="2000", decided="1000"), household=1000002),  # tier 2: decided, not offered
        req(NOAH, rnd(1, ask="3000", posted="900"), household=1000003, standing="cancelled", reason="medical"),
        # tier 2: a $0 posting, not accepted, then a Round 2 ask: appealed, never waiting
        req(OLIVIA, rnd(1, ask="2500", posted="0"), rnd(2, ask="500"), household=1000004),
        req(
            RILEY,
            rnd(1, ask="3000", posted="1200", accepted=True, tier=3, pool="weekend_pool"),
            rnd(2, ask="600", tier=3, pool="weekend_pool"),
            household=1000005,
            pool="weekend_pool",
        ),  # tier 3, home pool weekend_pool: accepted and appealed
        req(SAMUEL, rnd(1, ask="1000", tier=None, pool=None), household=1000006, pool=None),  # no tier, no pool
    ]


def _members(row_tier: int | None, *, total: bool = False, count: StatisticsCount, **kw: object) -> tuple[str, ...]:
    args = {"table": "camp", "round_": 1, "basis": "posted", **kw}
    return tier_members(season(), tier=row_tier, total=total, count=count, **args)  # type: ignore[arg-type]


def test_a_tier_rows_apps_include_its_cancelled_requests() -> None:
    """D72, D131: apps are every received request in the row."""
    assert _members(2, count="apps") == (EMMA, LIAM, NOAH, OLIVIA)
    assert _members(2, count="cancelled") == (NOAH,)
    assert _members(2, count="asks") == (EMMA, LIAM, NOAH, OLIVIA)


def test_awards_opens_live_posted_money_above_zero_only() -> None:
    """D80, D157, D129: a $0 posting is no award; a cancelled request's posting is not awarded."""
    assert _members(2, count="awarded") == (EMMA,)
    assert _members(None, total=True, count="awarded") == (EMMA, RILEY)


def test_decided_opens_only_on_the_decided_basis() -> None:
    """D130: decided money is its own count, never an award."""
    assert _members(2, count="decided") == ()
    assert _members(2, count="decided", basis="posted_and_decided") == (LIAM,)


def test_the_no_tier_row_opens_only_the_untiered_never_the_total() -> None:
    """The no-tier row and the totals both send tier null: `total` tells them apart."""
    assert _members(None, count="apps") == (SAMUEL,)
    assert _members(None, total=True, count="apps") == (EMMA, LIAM, NOAH, OLIVIA, RILEY, SAMUEL)


@pytest.mark.parametrize("basis", ["posted", "posted_and_decided"])
@pytest.mark.parametrize("round_", [1, 2, None])
def test_every_rows_every_count_opens_exactly_that_many_requests(basis: str, round_: int | None) -> None:
    """The invariant behind D20: a link never opens more, or fewer, rows than its count."""
    table = statistics(season(), RULES, table="camp", round_=round_, basis=basis)  # type: ignore[arg-type]
    rows: list[tuple[StatisticsRow, bool]] = [(row, False) for row in table.rows] + [(table.total, True)]
    for row, total in rows:
        for count in get_args(StatisticsCount):
            ids = tier_members(
                season(),
                table="camp",
                round_=round_,  # type: ignore[arg-type]
                basis=basis,  # type: ignore[arg-type]
                tier=row.tier,
                total=total,
                count=count,
            )
            assert len(ids) == getattr(row, FIELD[count]), (row.tier, total, count)


def test_an_rpt_22_row_opens_its_reason_lock_pool_and_round() -> None:
    assert cancelled_members(season(), table="camp", round_=1, reason="medical", pool="camp_pool", posted_round=1) == (
        NOAH,
    )
    assert cancelled_members(season(), table="camp", round_=2, reason="medical", pool="camp_pool", posted_round=1) == ()
    for round_ in ROUNDS:
        for row in statistics(season(), RULES, table="camp", round_=round_).recipients_cancelled:
            ids = cancelled_members(
                season(), table="camp", round_=round_, reason=row.reason, pool=row.pool, posted_round=row.round
            )
            assert len(ids) == row.requests, row


def test_waiting_is_posted_not_accepted_and_no_round_2_ask() -> None:
    """RPT-23 (ask 8): Olivia's Round 1 is posted ($0) and not accepted, but she appealed: appealed, not waiting."""
    assert outcome_members(season(), kind="headline", pool=None, outcome="waiting") == (EMMA,)
    assert outcome_members(season(), kind="headline", pool=None, outcome="appealed") == (OLIVIA, RILEY)
    assert outcome_members(season(), kind="headline", pool=None, outcome="accepted") == (RILEY,)


def test_an_rpt_23_row_opens_its_own_pool_and_no_pool_is_apart_from_the_headline() -> None:
    """Live requests only (Noah is cancelled); `kind` separates no pool from every request (#2972's ask 9)."""
    assert outcome_members(season(), kind="pool", pool="camp_pool", outcome="waiting") == (EMMA,)
    assert outcome_members(season(), kind="pool", pool="weekend_pool", outcome="accepted") == (RILEY,)
    assert outcome_members(season(), kind="no_pool", pool=None, outcome="waiting") == ()
    for row in outcomes(season()):
        for outcome, field in (("accepted", "accepted"), ("appealed", "appealed"), ("waiting", "waiting")):
            ids = outcome_members(season(), kind=row.kind, pool=row.pool, outcome=outcome)  # type: ignore[arg-type]
            assert len(ids) == getattr(row, field), (row.kind, row.pool, outcome)


def test_a_tier_appeals_count_opens_exactly_its_requests() -> None:
    """RPT-9: Round 1 apps (the tier a request was priced at in Round 1) and appeals (a Round 2 ask, in its Round 2
    tier). A duplicate is no application; the totals row is the union of the rows."""
    assert tier_appeals_members(season(), table="camp", tier=2, total=False, count="appeals") == (OLIVIA,)
    assert tier_appeals_members(season(), table="camp", tier=3, total=False, count="appeals") == (RILEY,)
    assert tier_appeals_members(season(), table="camp", tier=None, total=False, count="round1_apps") == (SAMUEL,)
    rows = tier_appeals(season(), RULES, table="camp")
    for count, field in (("round1_apps", "round1_apps"), ("appeals", "appeals")):
        union: set[str] = set()
        for index, row in enumerate(rows):
            total = index == len(rows) - 1
            ids = tier_appeals_members(season(), table="camp", tier=row.tier, total=total, count=count)  # type: ignore[arg-type]
            assert len(ids) == getattr(row, field), (row.tier, total, count)
            assert list(ids) == sorted(ids)
            if not total:
                union |= set(ids)
            else:
                assert union == set(ids), count
