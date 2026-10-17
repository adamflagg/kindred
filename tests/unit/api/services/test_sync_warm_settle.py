"""A finished sync's background warm waits for the sync to settle (kindred#3199).

Every finished sync job asks FastAPI to clear its caches (invalidate_server_caches), and a job that writes persons,
attendees or sessions clears the Camperships season (both layers) and the weekend lodging cache, each followed by a
background warm. A sync RUN finishes several such jobs a few seconds apart -- an hourly run of sessions, attendees,
persons for the primary season and again for N-1 is six clears inside a minute -- and every clear but the last throws
away the warm the previous one started (the caches' generation guards). Measured on the #3199 bench (prod snapshot,
two pinned cores): one clear's warms cost about 17 CPU-s and 124 PocketBase reads; such a run cost about 57 CPU-s and
410 reads, the warm rebuilt over and over for the run's whole length.

So a sync-triggered warm settles first: it starts only once no further sync clear has arrived for the settle
interval, then runs once. The clear itself is never delayed -- a read after a clear still rebuilds from PocketBase,
single-flight, exactly as before -- so this changes when the prefill runs, never what any read returns. A warm asked
for WITHOUT a settle (a Camperships staff write, a Jotform admin change) still starts at once, and cuts short any
settle in progress."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from types import ModuleType
from unittest.mock import patch

import pytest

from api.services import aid_sync_inputs as layer1
from api.services import lodging_cache_warm as lodging
from api.services.warm_settle import SYNC_WARM_SETTLE_SECONDS, SettleDeadline

SETTLE = 0.2
# The settle's own poll: an immediate ask cuts a settle short within one poll.
TOLERANCE = 0.02

# (module, the warm body each schedules, its scheduler)
WARMS = [
    pytest.param(layer1, "_warm_live_seasons", lambda: layer1.schedule_aid_warm, id="camperships"),
    pytest.param(lodging, "_warm_current_season", lambda: lodging.schedule_lodging_warm, id="lodging"),
]


@pytest.fixture(autouse=True)
def _fresh_settle(monkeypatch: pytest.MonkeyPatch) -> None:
    """No settle deadline leaks between tests."""
    monkeypatch.setattr(layer1, "_settle", SettleDeadline(), raising=False)
    monkeypatch.setattr(lodging, "_settle", SettleDeadline(), raising=False)


async def _finish(module: ModuleType) -> None:
    task = module._warm_task
    assert task is not None
    await asyncio.wait_for(asyncio.shield(task), timeout=5)


@pytest.mark.asyncio
@pytest.mark.parametrize(("module", "body", "scheduler"), WARMS)
async def test_a_run_of_sync_clears_warms_once_after_the_last(
    monkeypatch: pytest.MonkeyPatch, module: ModuleType, body: str, scheduler: Callable[[], Callable[..., None]]
) -> None:
    runs: list[float] = []

    async def fake_warm() -> None:
        runs.append(time.monotonic())

    monkeypatch.setattr(module, body, fake_warm)
    schedule = scheduler()
    schedule(settle=SETTLE)
    await asyncio.sleep(SETTLE / 2)
    schedule(settle=SETTLE)
    await asyncio.sleep(SETTLE / 2)
    last = time.monotonic()
    schedule(settle=SETTLE)
    await asyncio.sleep(SETTLE / 2)
    assert runs == []  # still settling: each clear pushed the warm back

    await _finish(module)
    assert len(runs) == 1
    assert runs[0] >= last + SETTLE - TOLERANCE


@pytest.mark.asyncio
@pytest.mark.parametrize(("module", "body", "scheduler"), WARMS)
async def test_an_immediate_ask_cuts_a_settle_short(
    monkeypatch: pytest.MonkeyPatch, module: ModuleType, body: str, scheduler: Callable[[], Callable[..., None]]
) -> None:
    """A staff write's warm (it records grant placements first) must not wait out a sync's settle."""
    runs: list[float] = []

    async def fake_warm() -> None:
        runs.append(time.monotonic())

    monkeypatch.setattr(module, body, fake_warm)
    schedule = scheduler()
    schedule(settle=60)
    await asyncio.sleep(0.01)
    asked = time.monotonic()
    schedule()
    await _finish(module)
    assert len(runs) == 1
    assert runs[0] - asked < 1.0


@pytest.mark.asyncio
@pytest.mark.parametrize(("module", "body", "scheduler"), WARMS)
async def test_a_sync_clear_during_a_warm_is_one_rerun_after_the_settle(
    monkeypatch: pytest.MonkeyPatch, module: ModuleType, body: str, scheduler: Callable[[], Callable[..., None]]
) -> None:
    runs: list[float] = []
    release = asyncio.Event()

    async def fake_warm() -> None:
        runs.append(time.monotonic())
        if len(runs) == 1:
            await release.wait()

    monkeypatch.setattr(module, body, fake_warm)
    schedule = scheduler()
    schedule()  # an immediate warm is reading
    await asyncio.sleep(0)
    assert len(runs) == 1
    schedule(settle=SETTLE)
    schedule(settle=SETTLE)
    asked = time.monotonic()
    release.set()
    await _finish(module)
    assert len(runs) == 2  # the first warm, then ONE rerun for the clears that landed while it ran
    assert runs[1] >= asked + SETTLE - TOLERANCE


@pytest.mark.asyncio
async def test_without_a_settle_the_warm_still_starts_at_once(monkeypatch: pytest.MonkeyPatch) -> None:
    runs = 0

    async def fake_warm() -> None:
        nonlocal runs
        runs += 1

    monkeypatch.setattr(layer1, "_warm_live_seasons", fake_warm)
    monkeypatch.setattr(lodging, "_warm_current_season", fake_warm)
    layer1.schedule_aid_warm()
    lodging.schedule_lodging_warm()
    for _ in range(20):
        await asyncio.sleep(0)
    assert runs == 2


@pytest.mark.parametrize("sync_type", ["attendees", "persons", "sessions"])
def test_a_finished_sync_asks_both_warms_to_settle(sync_type: str) -> None:
    from api.routers.metrics import invalidate_server_caches

    with (
        patch("api.routers.metrics.schedule_lodging_warm") as lodging_warm,
        patch("api.routers.metrics.schedule_aid_warm") as aid_warm,
    ):
        invalidate_server_caches(sync_type)
    lodging_warm.assert_called_once_with(settle=SYNC_WARM_SETTLE_SECONDS)
    aid_warm.assert_called_once_with(settle=SYNC_WARM_SETTLE_SECONDS)


def test_the_settle_outlasts_the_gap_between_one_runs_jobs() -> None:
    """The gap between two clears in one run is a job's own run time plus the orchestrator's 2-s spacing. The longest
    hourly-candidate job, persons, ran 13-22 s in production's daily runs (sync_runs, Oct 1-14 2026), so a settle
    shorter than ~25 s would let the warm start, and be thrown away, between persons and the next job."""
    assert SYNC_WARM_SETTLE_SECONDS >= 25


@pytest.mark.asyncio
@pytest.mark.parametrize(("module", "body", "scheduler"), WARMS)
async def test_a_later_sync_clear_does_not_push_back_an_immediate_ask(
    monkeypatch: pytest.MonkeyPatch, module: ModuleType, body: str, scheduler: Callable[[], Callable[..., None]]
) -> None:
    """A staff write's warm (it records grant placements first) asked for during a settle stays immediate even when
    a sync clear lands right after it: the sync's ask must not move the start back out to its own settle."""
    runs: list[float] = []

    async def fake_warm() -> None:
        runs.append(time.monotonic())

    monkeypatch.setattr(module, body, fake_warm)
    schedule = scheduler()
    schedule(settle=60)
    await asyncio.sleep(0.01)
    asked = time.monotonic()
    schedule()  # staff write
    schedule(settle=60)  # a sync clear right behind it
    await _finish(module)
    assert len(runs) == 1
    assert runs[0] - asked < 1.0


@pytest.mark.asyncio
@pytest.mark.parametrize(("module", "body", "scheduler"), WARMS)
async def test_a_sync_clear_behind_an_immediate_ask_during_a_warm_does_not_delay_the_rerun(
    monkeypatch: pytest.MonkeyPatch, module: ModuleType, body: str, scheduler: Callable[[], Callable[..., None]]
) -> None:
    runs: list[float] = []
    release = asyncio.Event()

    async def fake_warm() -> None:
        runs.append(time.monotonic())
        if len(runs) == 1:
            await release.wait()

    monkeypatch.setattr(module, body, fake_warm)
    schedule = scheduler()
    schedule()
    await asyncio.sleep(0)
    schedule()  # staff write mid-warm
    schedule(settle=60)  # sync clear behind it
    asked = time.monotonic()
    release.set()
    await _finish(module)
    assert len(runs) == 2
    assert runs[1] - asked < 1.0


@pytest.mark.parametrize("sync_type", [None, ""])
def test_a_clear_no_sync_asked_for_warms_at_once(sync_type: str | None) -> None:
    from api.routers.metrics import invalidate_server_caches

    with (
        patch("api.routers.metrics.schedule_lodging_warm") as lodging_warm,
        patch("api.routers.metrics.schedule_aid_warm") as aid_warm,
    ):
        invalidate_server_caches(sync_type)
    lodging_warm.assert_called_once_with(settle=0.0)
    aid_warm.assert_called_once_with(settle=0.0)
