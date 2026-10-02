"""The requests behind a Programs count (slice 4 ask 1; clean spec §9.3, RPT-11; D20, D72, D80): a session row, a
pool's subtotal or the total, one round block's apps, asks or awards. Fictional only."""

from __future__ import annotations

from typing import get_args

from bunking.financial_aid.reports.facts import ReportRequest
from bunking.financial_aid.reports.programs import (
    UNMATCHED_SESSION,
    ProgramRow,
    ProgramsCount,
    program_members,
    programs,
)
from tests.unit.bunking.financial_aid.report_fixtures import req, rnd

SESSION_2, TASTE_1, FAMILY_6 = 1000101, 1000104, 1000202
SESSIONS = {SESSION_2: "camp_pool", TASTE_1: "camp_pool", FAMILY_6: "weekend_pool"}
EMMA, LIAM, NOAH, OLIVIA, RILEY, SAMUEL = (
    f"req{name}00000001" for name in ("emma", "liam", "noah", "oliv", "rile", "samu")
)
FIELD = {"apps": "apps", "asks": "asks", "awarded": "awarded_count"}


def season() -> list[ReportRequest]:
    return [
        req(EMMA, rnd(1, ask="4000", posted="1500"), rnd(2, ask="1000", posted="400")),
        req(LIAM, rnd(1, ask="2000", posted="1000"), household=1000002, session=TASTE_1),
        req(NOAH, rnd(1, ask="3000", posted="900"), household=1000003, standing="cancelled"),
        req(OLIVIA, rnd(1, ask="500"), household=1000004, session=UNMATCHED_SESSION),  # camp_pool, no session
        req(
            RILEY,
            rnd(1, ask="1000", posted="0", pool="weekend_pool"),
            household=1000005,
            pool="weekend_pool",
            session=FAMILY_6,
            table="family",
        ),
        req(SAMUEL, rnd(1, ask="700", pool=None), household=1000006, pool=None, table="", session=UNMATCHED_SESSION),
    ]


def _ids(
    part: str, *, pool: str | None = None, session: int = 0, block: int = 1, count: str = "apps"
) -> tuple[str, ...]:
    return program_members(
        season(),
        SESSIONS,
        part=part,  # type: ignore[arg-type]
        pool=pool,
        session=session,
        block=block,
        count=count,  # type: ignore[arg-type]
    )


def test_a_session_rows_block_opens_its_apps_asks_and_awards() -> None:
    """D72 apps (Noah's cancellation included), D80 awards (live, above $0)."""
    assert _ids("session", pool="camp_pool", session=SESSION_2) == (EMMA, NOAH)
    assert _ids("session", pool="camp_pool", session=SESSION_2, count="awarded") == (EMMA,)
    assert _ids("session", pool="camp_pool", session=SESSION_2, block=2) == (EMMA,)
    assert _ids("session", pool="weekend_pool", session=FAMILY_6, count="awarded") == ()  # a $0 posting


def test_each_groups_session_not_matched_row_opens_only_its_own() -> None:
    """Session 0 is a row in camp_pool and in the no-pool group: one never opens the other's."""
    assert _ids("session", pool="camp_pool", session=UNMATCHED_SESSION) == (OLIVIA,)
    assert _ids("session", pool=None, session=UNMATCHED_SESSION) == (SAMUEL,)


def test_a_subtotal_opens_its_pool_and_the_total_opens_every_request() -> None:
    assert _ids("subtotal", pool="camp_pool") == (EMMA, LIAM, NOAH, OLIVIA)
    assert _ids("subtotal", pool=None) == (SAMUEL,)
    assert _ids("total") == (EMMA, LIAM, NOAH, OLIVIA, RILEY, SAMUEL)


def test_every_rows_every_block_count_opens_exactly_that_many_requests() -> None:
    """D20's invariant on Programs."""
    table = programs(season(), SESSIONS)
    rows: list[tuple[str, str | None, int, ProgramRow]] = []
    for group in table.pools:
        rows += [("session", group.pool, row.session_cm_id, row) for row in group.sessions]
        rows.append(("subtotal", group.pool, 0, group.subtotal))
    rows.append(("total", None, 0, table.total))
    for part, pool, session, row in rows:
        for block in (1, 2, 3):
            for count in get_args(ProgramsCount):
                ids = _ids(part, pool=pool, session=session, block=block, count=count)
                expected = getattr(getattr(row, f"round{block}"), FIELD[count])
                assert len(ids) == expected, (part, pool, session, block, count)
