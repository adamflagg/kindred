"""Casework writes wait for a running intake build of their season (campership sub-project 5).

A build reads the season, plans, then commits. A staff write that lands between its read
and its commit is overwritten by it, so the staff writers that touch what a build plans take
the same per-season lock the build holds, and re-read the request inside it.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Coroutine, Sequence
from dataclasses import replace
from decimal import Decimal
from typing import Any

import pytest

from api.services.financial_aid_casework_service import CaseworkValidationError, FinancialAidCaseworkService
from api.services.financial_aid_intake_service import FinancialAidIntakeService, season_lock
from api.services.financial_aid_intake_types import INTAKE_ACTOR, BillingLine
from api.services.financial_aid_payer_shares import ShareSpec
from bunking.financial_aid.change_log import AidOperationResult, AidWrite
from tests.unit.api.services.financial_aid_fakes import YEAR, FakeAidStore, fa_row, seeded_store

ACTOR = "registrar@example.com"
TIMEOUT = 5  # seconds: a deadlock fails the test instead of hanging the run


async def _built() -> tuple[FakeAidStore, FinancialAidIntakeService, FinancialAidCaseworkService]:
    store = seeded_store()
    store.fa_rows.append(fa_row(1000015, 1000001, summer="Session 2 (All-Gender Cabin)", summer_ask=700.0))
    intake = FinancialAidIntakeService(store)
    await intake.build(YEAR)
    store.operations.clear()
    return store, intake, FinancialAidCaseworkService(store)


def _gate_intake_commits(store: FakeAidStore, monkeypatch: pytest.MonkeyPatch) -> tuple[asyncio.Event, asyncio.Event]:
    """Pause every intake commit: `at_commit` is set once a build has read and planned, and
    it writes only after `release`. A staff write can then be started inside that window."""
    at_commit, release = asyncio.Event(), asyncio.Event()
    commit = store.commit

    async def gated(writes: Sequence[AidWrite], **kwargs: Any) -> AidOperationResult:
        if kwargs["actor"] == INTAKE_ACTOR:
            at_commit.set()
            await release.wait()
        return await commit(writes, **kwargs)

    monkeypatch.setattr(store, "commit", gated)
    return at_commit, release


async def _settle() -> None:
    for _ in range(20):
        await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_a_staff_headcount_set_while_a_build_commits_is_not_overwritten(monkeypatch: pytest.MonkeyPatch) -> None:
    store, intake, casework = await _built()
    family = store.request_for(household=1000001, program="family_camp")
    assert (family.headcount_non_infant, family.headcount_infant, family.headcount_source) == (3, 0, "billed")
    # The next build re-bills the family with an infant, so it plans headcount_infant 0 -> 1.
    store.billing.append(
        BillingLine(1000001, 1000014, 0, 17006, "Family Camp 6", "Family Camp 6 - Infant", 1, 300.0, False)
    )
    at_commit, release = _gate_intake_commits(store, monkeypatch)

    build = asyncio.create_task(intake.build(YEAR))
    await asyncio.wait_for(at_commit.wait(), TIMEOUT)  # the build has read the old headcount
    staff = asyncio.create_task(casework.set_headcount(family.id, 5, 0, "declared", "Family told us.", ACTOR))
    await _settle()
    release.set()
    await asyncio.wait_for(asyncio.gather(build, staff), TIMEOUT)

    final = store.requests[family.id]
    assert (final.headcount_non_infant, final.headcount_infant, final.headcount_source) == (5, 0, "declared")


def _writer(
    store: FakeAidStore, casework: FinancialAidCaseworkService, name: str
) -> Callable[[], Coroutine[Any, Any, object]]:
    summer = store.request_for(person=1000011, program="summer")
    unmatched = store.request_for(person=1000015, program="summer")
    family = store.request_for(household=1000001, program="family_camp")
    if name == "resolve_session":
        return lambda: casework.resolve_session(unmatched.id, 1000103, "All-gender option.", ACTOR)
    if name == "mark_duplicate":
        store.requests[unmatched.id] = replace(unmatched, person_cm_id=1000011, session_cm_id=0)
        return lambda: casework.mark_duplicate(unmatched.id, summer.id, "Same camper.", ACTOR)
    if name == "set_headcount":
        return lambda: casework.set_headcount(family.id, 4, 1, "declared", "Family told us.", ACTOR)
    if name == "set_payer_shares":
        shares = [ShareSpec(1000001, Decimal(60)), ShareSpec(1000009, Decimal(40))]
        return lambda: casework.set_payer_shares(summer.id, shares, "Two parents.", ACTOR)
    assert name == "set_household_share"
    return lambda: casework.set_household_share(
        summer.id, 1000009, share_pct=Decimal(40), reason="Other parent.", actor=ACTOR
    )


@pytest.mark.parametrize(
    "name", ["resolve_session", "mark_duplicate", "set_headcount", "set_payer_shares", "set_household_share"]
)
@pytest.mark.asyncio
async def test_each_casework_writer_waits_for_its_seasons_build(name: str) -> None:
    store, _, casework = await _built()
    call = _writer(store, casework, name)
    async with season_lock(YEAR):  # a build of the season is running
        task = asyncio.create_task(call())
        await _settle()
        assert not task.done()
        assert store.operations == []
    await asyncio.wait_for(task, TIMEOUT)
    assert len(store.operations) == 1


@pytest.mark.asyncio
async def test_corrections_and_capacity_do_not_wait_for_a_build() -> None:
    # Owner decision: neither touches what a build plans (corrections are their own rows,
    # capacity is not intake's), so they are not serialised behind it.
    store, _, casework = await _built()
    async with season_lock(YEAR):
        await asyncio.wait_for(
            casework.add_correction(YEAR, 1000001, "total_gross_income", "90000", "Tax return.", ACTOR), TIMEOUT
        )
        await asyncio.wait_for(casework.set_capacity(YEAR, 1000101, 40, "Cabin count.", ACTOR), TIMEOUT)
    assert len(store.operations) == 2


@pytest.mark.asyncio
async def test_a_write_waiting_on_a_build_revalidates_what_the_build_left() -> None:
    store, _, casework = await _built()
    family = store.request_for(household=1000001, program="family_camp")
    async with season_lock(YEAR):
        task = asyncio.create_task(casework.set_headcount(family.id, 4, 1, "declared", "Family told us.", ACTOR))
        await _settle()
        store.requests[family.id] = replace(family, status="withdrawn")  # the build withdrew it meanwhile
    with pytest.raises(CaseworkValidationError, match="withdrawn"):
        await asyncio.wait_for(task, TIMEOUT)
    assert store.operations == []
