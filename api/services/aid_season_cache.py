"""Layer 2 of the Camperships cache: the priced season, one build shared by everyone who asks.

Keyed (year, camp-time day): the live season is priced "now", so a new day reprices it. Rules are NOT in
the key -- they are one of the build's own reads, and every rules approval commits through
commit_aid_writes, which clears this cache like any other Camperships write.

Holds at most max_size entries; when full it drops the OLDEST-inserted one (not least-recently-used: at four
entries the difference does not matter). An expired entry is dropped when next read.

Cleared by: every Camperships write (on_aid_commit, registered on commit_aid_writes at startup: the write's own year,
or every year for a write to a season-spanning table, SEASON_SPANNING_COLLECTIONS), the completion of every
sync job that writes something a season reads (invalidate_server_caches, scoped by sync_changes_aid_season), and
the layer-1 refresher's backstop clear. Each clear is followed by a background warm of every synced season; a
Camperships write's warm records its grant placements first (on_aid_commit). This cache's own TTL is the fallback,
not the plan.

Generation-guarded per year: a build that started before a clear is handed to the waiters who already
joined it but never STORED, so the writer's own refetch always starts a fresh build.

Only the LIVE season is held here. A past-date read (past_season, any as_of) prices from history every
time, and so does pricing with candidate rules (log_placements=False), which the service refuses to pair
with this cache.

SHARED VALUE. Every request reads the same Season object (and the same name dicts), so nothing may write
into one. Season itself is frozen and its values are frozen dataclasses and tuples, but its Mapping fields and
the Names are plain dicts: read-only by convention, not by type. What holds that convention is
test_the_reads_that_share_a_cached_season_never_change_it, which deep-copies the cached season and names, runs
the shared reads, and compares. A reader that needs a changed season builds a new one (dataclasses.replace, as
with_unticked does).

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

from api.constants.collections import (
    AID_HOUSEHOLD_LINKS,
    AID_POSTINGS,
    AID_SOURCES,
    ATTENDEES,
    CAMP_SESSIONS,
    CUSTOM_FIELD_DEFS,
    FINANCIAL_AID_APPLICATIONS,
    HOUSEHOLDS,
    PERSON_CUSTOM_VALUES,
    PERSONS,
)
from api.constants.sync_job_writes import sync_writes_any
from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from bunking.financial_aid.change_log import AidWrite

logger = get_logger(__name__)

# The aid_* collections with no `year` field: one row serves every season. A write to one is logged under the current
# season only (financial_aid_write_service: "aid_sources span seasons; log the current one"), yet every cached year was
# priced on it -- funding sources and grantors feed the grants register, and Reports reads last season beside this
# one -- so it clears every year. aid_report_definitions feeds no season; it is here because the rule is the schema's,
# not a guess about readers. Pinned to the generated PocketBase types by test_aid_season_cache.py.
SEASON_SPANNING_COLLECTIONS: frozenset[str] = frozenset({"aid_grantors", "aid_report_definitions", "aid_sources"})

# What a sync's completion must clear this cache for: the sync-written collections a season build reads -- layer 1's
# (aid_sync_inputs.AID_SYNC_INPUT_TABLES: the people, households, registrations, sessions, equity answers and the FA
# mirror) and the ledger the `aid_postings` job writes with its sources and household links -- and the sync_runs rows
# that date the ledger (fetch_last_ledger_sync reads the last aid_postings and financial_transactions runs, so a
# finished run of either moves the season's "ledger synced" time even when it wrote nothing else this cache holds).
# Every other aid_* table is written only through commit_aid_writes, whose listener clears it (on_aid_commit).
# Derived, not guessed: test_the_season_sync_scope_is_exactly_what_a_season_build_reads records a real build's reads.
AID_SEASON_SYNC_TABLES: frozenset[str] = frozenset(
    {
        PERSONS,
        HOUSEHOLDS,
        ATTENDEES,
        PERSON_CUSTOM_VALUES,
        CUSTOM_FIELD_DEFS,
        CAMP_SESSIONS,
        FINANCIAL_AID_APPLICATIONS,
        AID_POSTINGS,
        AID_SOURCES,
        AID_HOUSEHOLD_LINKS,
    }
)
AID_SEASON_SYNC_RUN_SERVICES: frozenset[str] = frozenset({"aid_postings", "financial_transactions"})


def sync_changes_aid_season(sync_type: str | None) -> bool:
    """Whether a finished `sync_type` changes what a priced season reads, so must clear this cache. The hourly
    bunk_assignments run -- and from Oct 15 its N-1 pass too -- writes nothing a season reads, and used to throw away
    both live seasons every hour. Fails safe like every server cache's scope (sync_writes_any): no job named, an empty
    name, or a job nobody has classified in SYNC_JOB_WRITES clears."""
    return sync_writes_any(sync_type, AID_SEASON_SYNC_TABLES) or sync_type in AID_SEASON_SYNC_RUN_SERVICES


V = TypeVar("V")
# (year, camp-time day, part). The priced season is one value per day (part ""); a cache that holds several reads of
# one season -- Form intake's explained rows and the responses built from them (financial_aid_form_intake_cache.py) --
# names each read by its part. Every clear is by year (key[0]), so a clear drops every part of the year at once.
_Key = tuple[int, date, str]


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
        return await self._get_or_build((int(year), day, ""), build)

    async def get_or_build_part(self, year: int, day: date, part: str, build: Callable[[], Awaitable[V]]) -> V:
        """As get_or_build, for one named read of the season: each part is its own entry, single-flighted and
        generation-guarded like the season, and cleared with its year."""
        return await self._get_or_build((int(year), day, part), build)

    async def _get_or_build(self, key: _Key, build: Callable[[], Awaitable[V]]) -> V:
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

    PLACEMENT_ACTOR is skipped: that commit is the grant placement log's own record (record_placements), which
    changes nothing a season prices -- clearing on it would throw away the season the warm just built, and
    scheduling a warm on it would record again, forever.

    Every other commit asks the warm to record grant placements too (owner ruling 2026-10-16): for the write's own
    seasons, or, for a season-spanning table (a source's grantor mapping, a grantor's pays-after-camp-aid flag), every
    register season, since such a write moves grants in seasons it is not logged under. A read never records.

    It touches the event loop only through call_soon_threadsafe: the warm is scheduled, never run, from here."""
    # Imported here, not at the top: api.dependencies builds this module's class, and the layer-1 module and the
    # placement module both reach api.dependencies.
    from api.dependencies import aid_season_cache, form_intake_cache  # noqa: PLC0415 - circular
    from api.services.aid_sync_inputs import EVERY_REGISTER_SEASON, schedule_aid_warm  # noqa: PLC0415 - circular
    from api.services.financial_aid_grant_placements import PLACEMENT_ACTOR  # noqa: PLC0415 - circular

    if actor == PLACEMENT_ACTOR or not writes:
        return
    # Form intake's explained season (financial_aid_form_intake_cache.py) reads the same aid tables, so it clears with
    # the priced season, scoped the same way.
    spanning = any(w.collection in SEASON_SPANNING_COLLECTIONS for w in writes)
    years = frozenset(int(w.year) for w in writes)
    for cache in (aid_season_cache, form_intake_cache):
        if spanning:
            cache.invalidate_all()  # logged under one season, read by every season
        else:
            for year in years:
                cache.invalidate_year(year)
    loop = _warm_loop
    if loop is not None and not loop.is_closed():
        loop.call_soon_threadsafe(schedule_aid_warm, EVERY_REGISTER_SEASON if spanning else years)
