"""Keep the weekend year cache warm, and clear it only when its data changed.

kindred#2803. A cold weekend page costs ~2 s and a warm one ~0.1 s, and the
page used to be cold most of the time (measured 2026-09-23 on a copy of the
production snapshot):

* every completed sync cleared the whole cache -- including the HOURLY
  `bunk_assignments` sync, which writes nothing the cache holds;
* nothing re-filled it until a staff member's click paid for the re-read;
* the cache expires after 15 minutes, while the browser keeps its copy for 30.

Three changes, each here:

1. `sync_invalidates_lodging_cache` -- a completion clears the cache only when
   that sync writes a table some cached read depends on. The two halves of
   that question are both declared rather than guessed: each read's tables on
   its `@cached_by_year(tables=...)`, each sync's tables in
   `api/constants/sync_job_writes.py`. An unknown sync, or no sync named at
   all, still clears -- the fail-safe is the old behaviour.
2. `warm_lodging_year` -- after every clear, re-read everything a weekend page
   would, in the background, so the next click finds it cached.
3. `refresh_lodging_cache_forever` -- on startup, and then every TTL: clear and
   warm. TTL expiry is a clear like any other, so it is followed by a warm too.
   The staleness bound is unchanged (a sync nobody's browser saw finish is
   still picked up within one TTL); what changes is that the re-read no longer
   happens on somebody's click.

A warm racing a sync cannot re-cache pre-sync data: `LodgingYearCache.set`
drops a value whose fetch began before the latest clear.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from api.constants.sync_job_writes import SYNC_JOB_WRITES
from api.dependencies import lodging_cache
from api.dependencies import pb as default_pb
from api.services.lodging_cache import CACHED_TABLES_ATTR
from api.services.lodging_repository import LodgingRepository
from api.services.person_housing_rules import LIVE_HOUSING_FROM_YEAR
from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from pocketbase import PocketBase

logger = get_logger(__name__)

# Strong references to in-flight background warms: the event loop holds only
# a weak one, and a task that is garbage-collected mid-read simply vanishes.
_background: set[asyncio.Task[None]] = set()


def cached_read_tables() -> dict[str, tuple[str, ...]]:
    """Every `@cached_by_year` read on `LodgingRepository`, with the tables it
    declared."""
    return {
        name: getattr(member, CACHED_TABLES_ATTR)
        for name, member in vars(LodgingRepository).items()
        if hasattr(member, CACHED_TABLES_ATTR)
    }


def _cached_tables() -> frozenset[str]:
    return frozenset(table for tables in cached_read_tables().values() for table in tables)


def sync_invalidates_lodging_cache(sync_type: str | None) -> bool:
    """Whether a completed `sync_type` must clear the weekend year cache.

    True when the sync writes any table a cached read depends on. Also True
    when no sync is named (the endpoint's non-sync callers keep today's
    behaviour) and when the sync is not in `SYNC_JOB_WRITES` at all -- a job
    nobody has classified may write anything.
    """
    if sync_type is None:
        return True
    writes = SYNC_JOB_WRITES.get(sync_type)
    if writes is None:
        return True
    return not writes.isdisjoint(_cached_tables())


async def current_season_year(pb: PocketBase) -> int:
    """The season the board defaults to, so the one worth having warm.

    `_configured_year` on PocketBase's sync-status payload is exactly what the
    frontend's `CurrentYearContext` defaults to. The API container is not
    given `CAMPMINDER_SEASON_ID` in production, so that env var is only the
    fallback, and the calendar year the last resort.
    """
    try:
        status = await asyncio.to_thread(pb.send, "/api/custom/sync/status", {"method": "GET"})
        year = int((status or {}).get("_configured_year") or 0)
        if year:
            return year
    except Exception as exc:  # a fallback, logged, never fatal
        logger.debug(f"Lodging cache warm: sync status unavailable, falling back ({exc})")
    season = os.environ.get("CAMPMINDER_SEASON_ID", "")
    return int(season) if season.isdigit() else datetime.now(tz=UTC).year


def _year_reads(repo: LodgingRepository, year: int) -> list[Awaitable[Any]]:
    """Every cached read the landing and a weekend board of `year` issue.

    MIRRORS `LodgingRosterService.build_roster` (both grains) and
    `build_summary`. Not derived from them -- the test
    `TestTheWarmCoversEveryCachedReadAPageIssues` is what holds the two
    together, by running both pages after a warm and requiring zero misses.
    """
    last_year = year - 1
    reads: list[Awaitable[Any]] = [
        repo.fetch_households(year),
        repo.fetch_prior_household_cm_ids(year),
        repo.fetch_family_camp_adults(year),
        repo.fetch_family_camp_registrations(year),
        repo.fetch_request_text_values(year),
        repo.fetch_cabin_assignments_by_household_cm_id(last_year),
        # The adult board's cohort reads.
        repo.fetch_prior_adult_person_cm_ids(year),
        repo.fetch_adult_need_values(year),
        repo.fetch_adult_cabin_values(last_year),
        repo.fetch_adult_weekend_attendees(last_year),
    ]
    if last_year >= LIVE_HOUSING_FROM_YEAR:
        reads += [repo.fetch_family_enrolled_attendees(last_year), repo.fetch_live_assignments(last_year)]
    else:
        reads.append(repo.fetch_family_enrolled_household_cm_ids(last_year))
    return reads


async def warm_lodging_year(year: int, *, pb: PocketBase | None = None) -> None:
    """Fill the year cache for `year`'s landing and weekend boards.

    Never raises: it runs with nobody waiting on it, and a PocketBase that is
    down or slow must cost a log line, not an unhandled task exception. A read
    that fails simply stays uncached and is re-read on the next click, exactly
    as it would have been without a warm.
    """
    if pb is None:
        pb = default_pb
    try:
        repo = LodgingRepository(pb)
        results = await asyncio.gather(*_year_reads(repo, year), return_exceptions=True)
    except Exception as exc:  # see docstring
        logger.warning(f"Lodging cache warm for {year} failed: {exc}")
        return
    failed = [r for r in results if isinstance(r, BaseException)]
    if failed:
        logger.warning(f"Lodging cache warm for {year}: {len(failed)} of {len(results)} reads failed: {failed[0]}")


async def _warm_current_season() -> None:
    await warm_lodging_year(await current_season_year(default_pb))


def schedule_lodging_warm() -> None:
    """Start a background warm of the current season, and return at once."""
    task = asyncio.get_running_loop().create_task(_warm_current_season())
    _background.add(task)
    task.add_done_callback(_background.discard)


async def refresh_lodging_cache_forever(
    *,
    interval: float,
    warm: Callable[[int], Awaitable[None]] = warm_lodging_year,
    year: Callable[[], Awaitable[int]] | None = None,
) -> None:
    """Warm now, then every `interval` seconds clear and warm again.

    Clearing BEFORE the re-warm, rather than letting entries expire on their
    own, is what keeps the staleness bound where the TTL put it: a re-warm
    over live entries would just hit them. A request that arrives mid-warm
    waits on the warm's in-flight read (the cache is single-flight per key)
    rather than issuing its own.
    """
    if year is None:

        async def year() -> int:
            return await current_season_year(default_pb)

    while True:
        try:
            await warm(await year())
        except Exception as exc:  # the loop must outlive one bad pass
            logger.warning(f"Lodging cache refresh failed: {exc}")
        await asyncio.sleep(interval)
        lodging_cache.invalidate_all()


def start_lodging_cache_refresher() -> asyncio.Task[None]:
    """The startup hook: warm at once in the background, then every TTL."""
    return asyncio.get_running_loop().create_task(refresh_lodging_cache_forever(interval=lodging_cache.ttl_seconds))
