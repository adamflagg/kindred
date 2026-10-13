"""Layer 2 of the Camperships cache: the priced season, one build shared by everyone who asks.

Keyed (year, camp-time day): the live season is priced "now", so a new day reprices it. Rules are NOT in
the key -- they are one of the build's own reads, and every rules approval commits through
commit_aid_writes, which clears this cache like any other Camperships write.

Cleared by: every Camperships write (on_aid_commit, registered on commit_aid_writes at startup), every
sync job's completion (invalidate_server_caches, unscoped: see its docstring), and the layer-1 refresher's
TTL clear. Each clear is followed by a background warm of the configured season. This cache's own TTL is
the fallback, not the plan.

Generation-guarded per year: a build that started before a clear is handed to the waiters who already
joined it but never STORED, so the writer's own refetch always starts a fresh build.

Only the LIVE season is held here. A past-date read (past_season, any as_of) prices from history every
time, and so does pricing with candidate rules (log_placements=False), which the service refuses to pair
with this cache.

SHARED VALUE. Every request reads the same Season object (and the same name dicts), so nothing may write
into one: Season is frozen, its values are frozen dataclasses and tuples, and a reader that needs a changed
season builds a new one (dataclasses.replace, as with_unticked does).

Single uvicorn process assumed (docker/Dockerfile.api). With workers, a write in one process would not
clear another's cache -- revisit before adding --workers."""

from __future__ import annotations

import asyncio
import threading
import time
from collections import defaultdict
from collections.abc import Awaitable, Callable, Sequence
from datetime import date
from typing import TYPE_CHECKING, Any, TypeVar

from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from bunking.financial_aid.change_log import AidWrite

logger = get_logger(__name__)

V = TypeVar("V")
_Key = tuple[int, date]


class AidSeasonCache:
    """Thread-safe: the event loop reads and fills it, and commit_aid_writes' worker thread clears it. Everything
    both touch (entries, in-flight builds, generations) is read and written under one lock."""

    def __init__(
        self, ttl_seconds: int = 300, max_size: int = 4, *, monotonic: Callable[[], float] = time.monotonic
    ) -> None:
        self.ttl_seconds = ttl_seconds
        self.max_size = max_size
        self._now = monotonic
        self._lock = threading.RLock()
        self._entries: dict[_Key, tuple[float, Any]] = {}
        self._inflight: dict[_Key, asyncio.Task[Any]] = {}
        # A build stores only if nothing cleared its year since it started: (invalidate_all's epoch, the year's).
        self._epoch = 0
        self._generation: defaultdict[int, int] = defaultdict(int)

    def _stamp(self, year: int) -> tuple[int, int]:
        return self._epoch, self._generation[year]

    async def get_or_build(self, year: int, day: date, build: Callable[[], Awaitable[V]]) -> V:
        """The cached value for (year, day), or the one build in flight for it, or a new build. Concurrent callers
        share one build; a build that raises reaches every waiter and caches nothing."""
        key = (int(year), day)
        loop = asyncio.get_running_loop()
        with self._lock:
            hit = self._entries.get(key)
            if hit is not None:
                if self._now() - hit[0] <= self.ttl_seconds:
                    return hit[1]  # type: ignore[no-any-return]
                del self._entries[key]
            task = self._inflight.get(key)
            # A task from another event loop (a finished pytest loop) can never complete here.
            if task is None or task.get_loop() is not loop:
                task = loop.create_task(self._run(key, self._stamp(key[0]), build))
                self._inflight[key] = task
        # shield: one caller's disconnect must not cancel the build everyone else is waiting on.
        return await asyncio.shield(task)

    async def _run(self, key: _Key, stamp: tuple[int, int], build: Callable[[], Awaitable[Any]]) -> Any:
        try:
            value = await build()
        finally:
            with self._lock:
                if self._inflight.get(key) is asyncio.current_task():
                    del self._inflight[key]
        with self._lock:
            if self._stamp(key[0]) == stamp:
                if key not in self._entries and len(self._entries) >= self.max_size:
                    del self._entries[min(self._entries, key=lambda k: self._entries[k][0])]
                self._entries[key] = (self._now(), value)
        return value

    def invalidate_year(self, year: int) -> None:
        """Drop `year`'s entries and stop any build in flight for it from being stored. Thread-safe: called from
        commit_aid_writes' worker thread."""
        year = int(year)
        with self._lock:
            self._generation[year] += 1
            for key in [k for k in self._entries if k[0] == year]:
                del self._entries[key]
            for key in [k for k in self._inflight if k[0] == year]:
                del self._inflight[key]

    def invalidate_all(self) -> None:
        with self._lock:
            self._epoch += 1
            self._entries.clear()
            self._inflight.clear()


# The event loop the warm runs on, bound by the API's lifespan. None: no warm (tests, or before startup).
_warm_loop: asyncio.AbstractEventLoop | None = None


def bind_warm_loop(loop: asyncio.AbstractEventLoop | None) -> None:
    """The lifespan binds its loop at startup, and None at shutdown."""
    global _warm_loop
    _warm_loop = loop


def on_aid_commit(writes: Sequence[AidWrite], actor: str) -> None:
    """commit_aid_writes' listener. Runs in the committing worker thread, BEFORE the write's HTTP response
    returns, so the browser's own refetch after a save can never read the pre-save season.

    PLACEMENT_ACTOR is skipped: that commit is the season build's own placement log (_log_placements) --
    clearing on it would throw away the very build that wrote it. The log needs a write only when the
    grants register changed, and every register change is a staff commit or a sync, each of which clears
    this cache.

    It touches the event loop only through call_soon_threadsafe: the warm is scheduled, never run, from here."""
    # Imported here, not at the top: api.dependencies builds this module's class, and the layer-1 module and the
    # placement module both reach api.dependencies.
    from api.dependencies import aid_season_cache  # noqa: PLC0415 - circular
    from api.services.aid_sync_inputs import schedule_aid_warm  # noqa: PLC0415 - circular
    from api.services.financial_aid_grant_placements import PLACEMENT_ACTOR  # noqa: PLC0415 - circular

    if actor == PLACEMENT_ACTOR or not writes:
        return
    for year in {int(w.year) for w in writes}:
        aid_season_cache.invalidate_year(year)
    loop = _warm_loop
    if loop is not None and not loop.is_closed():
        loop.call_soon_threadsafe(schedule_aid_warm)
