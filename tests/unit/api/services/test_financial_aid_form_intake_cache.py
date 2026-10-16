"""Requests › Form intake in the Camperships season cache (follow-up B to PR 3, kindred#3252).

Form intake's four season reads -- the Requests band count (/intake/{year}/summary), the page (/forms), Season's D170
line opened in place (/aid-on-no-request) and Today's form_intake line (needs_a_look) -- share one explained season,
built once and cleared exactly when something it reads changes: every Camperships write through commit_aid_writes'
listener (its own year), every sync job that writes a table it reads, and layer 1's six-hour backstop. Its sync scope
is derived from a real cold build's PocketBase reads, so a new read the scope does not name fails here. Fictional data
only (tests/CLAUDE.md)."""

from __future__ import annotations

import asyncio
import copy
from collections import Counter
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.dependencies import aid_inputs_cache, form_intake_cache
from api.services import aid_sync_inputs as layer1
from api.services.aid_season_cache import AidSeasonCache, on_aid_commit
from api.services.financial_aid_casework_service import FinancialAidCaseworkService
from api.services.financial_aid_form_intake import FormIntakeService
from api.services.financial_aid_form_intake_cache import (
    FORM_INTAKE_SYNC_TABLES,
    CachedFormIntakeService,
    sync_changes_form_intake,
)
from api.services.financial_aid_intake_service import FinancialAidIntakeService
from bunking.financial_aid.change_log import add_commit_listener
from tests.unit.api.services.financial_aid_fakes import YEAR, FakeAidStore, fa_row
from tests.unit.api.services.test_financial_aid_form_intake import EMMA as JOHNSON_EMMA
from tests.unit.api.services.test_financial_aid_form_intake import (
    JOHNSON,
    RILEY,
    SAM,
    SESSION_2,
    TASTE_1,
    _d170_store,
    enrolled,
    intake,
)
from tests.unit.api.services.test_financial_aid_form_intake_writes import rule_made
from tests.unit.api.services.test_financial_aid_request_additions import (
    ACTOR,
    EMMA,
    EMMA_HOUSEHOLD,
    WINTER,
    make_store,
)

T0 = datetime(YEAR, 3, 2, 17, 0, tzinfo=UTC)


def _count_builds(store: FakeAidStore) -> Counter[int]:
    """Counts explain builds per season: each reads the whole season's requests once (casework's writes read one
    application's, or the season's under their own lock, which the counter also sees -- callers compare before and
    after a read, never across a write)."""
    builds: Counter[int] = Counter()
    original = store.fetch_requests

    async def counted(year: int, application_id: str | None = None) -> list[Any]:
        if application_id is None:
            builds[year] += 1
        return await original(year, application_id)

    store.fetch_requests = counted  # type: ignore[method-assign]
    return builds


def _cached(store: Any, cache: AidSeasonCache | None = None, *, clock: Callable[[], datetime] = lambda: T0) -> Any:
    return CachedFormIntakeService(store, cache=form_intake_cache if cache is None else cache, clock=clock)


@pytest.fixture
def listening() -> Iterator[None]:
    """commit_aid_writes' listener, as the API's lifespan registers it."""
    remove = add_commit_listener(on_aid_commit)
    try:
        yield
    finally:
        remove()


# --- the cached reads are the uncached ones -------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_every_cached_read_equals_the_uncached_one() -> None:
    store = await _d170_store()

    async def waiting(year: int) -> int:
        return 2

    plain = FormIntakeService(store, grants_waiting=waiting)
    cached = CachedFormIntakeService(store, cache=AidSeasonCache(), clock=lambda: T0, grants_waiting=waiting)
    assert (await cached.forms(YEAR)).model_dump() == (await plain.forms(YEAR)).model_dump()
    assert (await cached.summary(YEAR)).model_dump() == (await plain.summary(YEAR)).model_dump()
    assert (await cached.aid_on_no_request(YEAR)).model_dump() == (await plain.aid_on_no_request(YEAR)).model_dump()
    assert (await cached.needs_a_look(YEAR)) == (await plain.needs_a_look(YEAR))
    assert (await cached.unlisted(YEAR, str(RILEY))).model_dump() == (
        await plain.unlisted(YEAR, str(RILEY))
    ).model_dump()


@pytest.mark.asyncio
async def test_the_four_season_reads_share_one_build_and_a_repeat_reads_nothing() -> None:
    store = await _d170_store()
    builds = _count_builds(store)
    service = _cached(store, AidSeasonCache())
    summary = await service.summary(YEAR)
    forms = await service.forms(YEAR)
    look = await service.needs_a_look(YEAR)
    aid = await service.aid_on_no_request(YEAR)
    assert builds[YEAR] == 1
    # The band count, the page, Today's line and the D170 line agree: one explained season.
    assert summary.needs_look == forms.counts.needs_look == len(look.rows)
    assert aid.total == forms.campminder_aid_on_no_request
    for _ in range(3):
        assert await service.summary(YEAR) is summary
        assert await service.forms(YEAR) is forms
        assert await service.needs_a_look(YEAR) is look
        assert await service.aid_on_no_request(YEAR) is aid
    assert builds[YEAR] == 1


@pytest.mark.asyncio
async def test_concurrent_first_reads_share_one_build() -> None:
    store = await _d170_store()
    builds = _count_builds(store)
    service = _cached(store, AidSeasonCache())
    await asyncio.gather(service.summary(YEAR), service.forms(YEAR), service.needs_a_look(YEAR), service.summary(YEAR))
    assert builds[YEAR] == 1


@pytest.mark.asyncio
async def test_a_fresh_service_per_request_still_shares_the_process_cache() -> None:
    """The router builds a service per request, as it does every Camperships service."""
    store = await _d170_store()
    builds = _count_builds(store)
    first = await _cached(store).summary(YEAR)
    assert await _cached(store).summary(YEAR) is first
    assert builds[YEAR] == 1


@pytest.mark.asyncio
async def test_find_a_camper_not_listed_is_never_cached() -> None:
    """A search by name or id: every query differs, so it reads the season itself."""
    store = await _d170_store()
    builds = _count_builds(store)
    service = _cached(store, AidSeasonCache())
    await service.unlisted(YEAR, str(RILEY))
    await service.unlisted(YEAR, str(RILEY))
    assert builds[YEAR] == 2


@pytest.mark.asyncio
async def test_the_reads_that_share_a_cached_season_never_change_it() -> None:
    """One cached value is every request's: a read that wrote into it would change another's rows."""
    store = await _d170_store()
    cache = AidSeasonCache()
    service = _cached(store, cache)
    season, rows = await service._rows(YEAR)
    before = copy.deepcopy((season, rows))
    await service.forms(YEAR)
    await service.needs_a_look(YEAR)
    await service.aid_on_no_request(YEAR)
    await service.summary(YEAR)
    await service.unlisted(YEAR, str(RILEY))
    assert (season, rows) == before


# --- the key: one season never serves another, and a new camp-time day rebuilds --------------------------------------


@pytest.mark.asyncio
async def test_one_season_never_serves_the_other_and_clearing_one_keeps_the_other() -> None:
    store = await _d170_store()
    builds = _count_builds(store)
    cache = AidSeasonCache()
    service = _cached(store, cache)
    this, prior = await service.summary(YEAR), await service.summary(YEAR - 1)
    assert (this.year, prior.year) == (YEAR, YEAR - 1)
    assert (builds[YEAR], builds[YEAR - 1]) == (1, 1)
    cache.invalidate_year(YEAR)
    assert await service.summary(YEAR - 1) is prior
    assert await service.summary(YEAR) is not this
    assert (builds[YEAR], builds[YEAR - 1]) == (2, 1)


@pytest.mark.asyncio
async def test_a_new_camp_time_day_rebuilds() -> None:
    store = await _d170_store()
    builds = _count_builds(store)
    now = [T0]
    service = _cached(store, AidSeasonCache(), clock=lambda: now[0])
    await service.summary(YEAR)
    now[0] = T0 + timedelta(days=1)
    await service.summary(YEAR)
    assert builds[YEAR] == 2


def test_the_process_singleton_is_five_minutes_and_holds_every_read_of_both_live_seasons() -> None:
    # Five reads (the rows, the band count, the page, Today's line, the D170 lines) of the two live seasons.
    assert (form_intake_cache.ttl_seconds, form_intake_cache.max_size) == (300, 10)


@pytest.mark.asyncio
async def test_an_entry_expires_after_its_ttl() -> None:
    store = await _d170_store()
    builds = _count_builds(store)
    clock = [0.0]
    cache = AidSeasonCache(ttl_seconds=300, max_size=8, monotonic=lambda: clock[0])
    service = _cached(store, cache)
    await service.summary(YEAR)
    clock[0] = 301.0
    await service.summary(YEAR)
    assert builds[YEAR] == 2


# --- a casework write clears it (commit_aid_writes' listener) --------------------------------------------------------


@pytest.mark.asyncio
async def test_add_a_request_clears_it_and_the_writers_refetch_reads_the_new_request(listening: None) -> None:
    store = await intake(
        fa_row(JOHNSON_EMMA, JOHNSON, summer="Session 2", summer_ask=3000.0),
        attendees=enrolled(JOHNSON_EMMA, JOHNSON, SESSION_2, WINTER),
    )
    before = await _cached(store).summary(YEAR)
    assert before.needs_look == 1  # Emma's winter retreat: an enrolled session no request holds
    await FinancialAidCaseworkService(store).add_request(
        YEAR, JOHNSON, JOHNSON_EMMA, WINTER, 290.0, "Asked at retreat", ACTOR
    )
    assert (await _cached(store).summary(YEAR)).needs_look == 0


@pytest.mark.asyncio
async def test_remove_an_added_request_clears_it(listening: None) -> None:
    store = await intake(
        fa_row(JOHNSON_EMMA, JOHNSON, summer="Session 2", summer_ask=3000.0),
        attendees=enrolled(JOHNSON_EMMA, JOHNSON, SESSION_2, WINTER),
    )
    added = await FinancialAidCaseworkService(store).add_request(
        YEAR, JOHNSON, JOHNSON_EMMA, WINTER, 290.0, "Asked at retreat", ACTOR
    )
    assert (await _cached(store).summary(YEAR)).needs_look == 0
    await FinancialAidCaseworkService(store).retire_addition(YEAR, added.addition.id, "Asked in error", ACTOR)
    assert (await _cached(store).summary(YEAR)).needs_look == 1


@pytest.mark.asyncio
async def test_mark_reviewed_clears_it(listening: None) -> None:
    store = make_store(attendees=enrolled(EMMA, EMMA_HOUSEHOLD, WINTER))
    made = rule_made(store)
    await FinancialAidIntakeService(store).build(YEAR)
    look = await _cached(store).needs_a_look(YEAR)
    assert any("registration_ask_unreviewed" in r.look_reasons for r in look.rows)
    await FinancialAidCaseworkService(store).review_addition(YEAR, made.id, ACTOR)
    after = await _cached(store).needs_a_look(YEAR)
    assert not any("registration_ask_unreviewed" in r.look_reasons for r in after.rows)


@pytest.mark.asyncio
async def test_recording_campminders_round_1_clears_it(listening: None) -> None:
    store = await _d170_store()
    before = await _cached(store).aid_on_no_request(YEAR)
    assert SAM in {line.household_cm_id for line in before.lines}
    await FinancialAidCaseworkService(store).add_request(
        YEAR, SAM, RILEY, TASTE_1, 2500.0, "Assessed by phone", ACTOR, round1_campminder=2300.0
    )
    after = await _cached(store).aid_on_no_request(YEAR)
    assert SAM not in {line.household_cm_id for line in after.lines}
    assert after.total < before.total


@pytest.mark.asyncio
async def test_a_write_clears_only_its_own_season(listening: None) -> None:
    store = await intake(
        fa_row(JOHNSON_EMMA, JOHNSON, summer="Session 2", summer_ask=3000.0),
        attendees=enrolled(JOHNSON_EMMA, JOHNSON, SESSION_2, WINTER),
    )
    prior = await _cached(store).summary(YEAR - 1)
    await FinancialAidCaseworkService(store).add_request(
        YEAR, JOHNSON, JOHNSON_EMMA, WINTER, 290.0, "Asked at retreat", ACTOR
    )
    assert await _cached(store).summary(YEAR - 1) is prior


@pytest.mark.asyncio
async def test_a_write_to_a_season_spanning_table_clears_every_season() -> None:
    from bunking.financial_aid.change_log import AidWrite

    store = await _d170_store()
    this, prior = await _cached(store).summary(YEAR), await _cached(store).summary(YEAR - 1)
    write = AidWrite(
        collection="aid_sources", action="update", year=YEAR, record_id="src000000000001", before={}, data={"name": "x"}
    )
    on_aid_commit([write], ACTOR)
    assert await _cached(store).summary(YEAR) is not this
    assert await _cached(store).summary(YEAR - 1) is not prior


# --- a sync's completion clears it when the sync wrote a table it reads -----------------------------------------------

SCOPE_CLEARING = [
    "attendees",
    "persons",
    "sessions",
    "financial_aid_applications",
    "aid_postings",
    "person_custom_values",
    None,
    "",
    "a_job_nobody_classified",
]
SCOPE_KEEPING = ["bunk_assignments", "bunks", "lodging_assignments", "staff", "process_requests"]


@pytest.mark.asyncio
@pytest.mark.parametrize("sync_type", SCOPE_CLEARING)
async def test_a_sync_that_writes_what_form_intake_reads_clears_it(sync_type: str | None) -> None:
    from api.routers.metrics import invalidate_server_caches

    store = await _d170_store()
    before = await _cached(store).summary(YEAR)
    with patch("api.routers.metrics.schedule_lodging_warm"), patch("api.routers.metrics.schedule_aid_warm"):
        invalidate_server_caches(sync_type)
    assert await _cached(store).summary(YEAR) is not before


@pytest.mark.asyncio
@pytest.mark.parametrize("sync_type", SCOPE_KEEPING)
async def test_a_sync_that_writes_nothing_form_intake_reads_keeps_it(sync_type: str) -> None:
    from api.routers.metrics import invalidate_server_caches

    store = await _d170_store()
    before = await _cached(store).summary(YEAR)
    with patch("api.routers.metrics.schedule_lodging_warm"), patch("api.routers.metrics.schedule_aid_warm"):
        invalidate_server_caches(sync_type)
    assert await _cached(store).summary(YEAR) is before


@pytest.mark.parametrize("sync_type", SCOPE_CLEARING)
def test_the_scope_predicate_clears_for_every_clearing_job(sync_type: str | None) -> None:
    assert sync_changes_form_intake(sync_type)


@pytest.mark.parametrize("sync_type", SCOPE_KEEPING)
def test_the_scope_predicate_keeps_for_every_unrelated_job(sync_type: str) -> None:
    assert not sync_changes_form_intake(sync_type)


@pytest.mark.asyncio
async def test_the_form_intake_sync_scope_is_exactly_what_its_reads_read() -> None:
    """Derived, not guessed: the router's own Form intake service, cold, over the budget fixture, every PocketBase read
    recorded across the four cached reads. Its sync-written collections (those some job in SYNC_JOB_WRITES writes) are
    the scope. A new read of a sync-written table fails here until the scope names it; a table the scope names that no
    read reads fails too, so the scope never over-clears."""
    from api.constants.sync_job_writes import SYNC_JOB_WRITES
    from api.routers import financial_aid as fa
    from tests.unit.api.services.pb_recording import RecordingPb
    from tests.unit.api.services.test_aid_pb_budget import _build_tables

    pb = RecordingPb(_build_tables())
    with patch.object(fa, "pb", pb):
        service = fa._form_intake()
        await service.summary(YEAR)
        await service.forms(YEAR)
        await service.needs_a_look(YEAR)
        await service.aid_on_no_request(YEAR)
    read = {collection for collection, _ in pb.calls}
    sync_written = frozenset().union(*SYNC_JOB_WRITES.values())
    assert read & sync_written == FORM_INTAKE_SYNC_TABLES
    assert set(layer1.AID_SYNC_INPUT_TABLES) <= FORM_INTAKE_SYNC_TABLES  # a layer-1 clear always clears it


@pytest.mark.asyncio
async def test_the_layer_one_refresher_clears_it_too() -> None:
    """The six-hour backstop drops layer 1, which the explained season was built from."""
    store = await _d170_store()
    before = await _cached(store).summary(YEAR)
    passes = 0

    async def fake_warm(year: int) -> None:
        nonlocal passes
        passes += 1

    async def fake_year() -> int:
        return YEAR

    task = asyncio.create_task(layer1.refresh_aid_inputs_forever(interval=0.01, warm=fake_warm, year=fake_year))
    for _ in range(200):
        await asyncio.sleep(0.005)
        if passes >= 2:
            break
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert passes >= 2
    assert await _cached(store).summary(YEAR) is not before


@pytest.mark.asyncio
async def test_a_layer_one_sync_clear_is_always_a_form_intake_clear() -> None:
    from api.routers.metrics import invalidate_server_caches

    store = await _d170_store()
    before = await _cached(store).summary(YEAR)
    aid_inputs_cache.set("load", YEAR, object())
    with patch("api.routers.metrics.schedule_lodging_warm"), patch("api.routers.metrics.schedule_aid_warm"):
        invalidate_server_caches("custom_field_defs")
    assert aid_inputs_cache.get("load", YEAR) is None
    assert await _cached(store).summary(YEAR) is not before


# --- the router hands every Form intake read the process cache --------------------------------------------------------


def test_the_router_factory_hands_form_intake_the_process_cache() -> None:
    from api.routers import financial_aid as fa

    service = fa._form_intake()
    assert isinstance(service, CachedFormIntakeService)
    assert service._cache is form_intake_cache


@pytest.mark.asyncio
async def test_todays_form_intake_line_reads_through_the_process_cache() -> None:
    from types import SimpleNamespace

    from api.routers import financial_aid as fa

    built = MagicMock()
    built.return_value.read = AsyncMock(return_value=None)
    admin = SimpleNamespace(is_admin=True, permissions=frozenset(), email=ACTOR)
    with patch.object(fa, "TodayService", built):
        await fa.get_today(YEAR, user=cast(Any, admin))
    read = built.call_args.kwargs["form_intake"]
    assert isinstance(read.__self__, CachedFormIntakeService)
    assert read.__self__._cache is form_intake_cache
    assert read.__func__ is CachedFormIntakeService.needs_a_look
