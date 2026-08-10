"""Server-side cache for the weekend roster's year-scoped PocketBase reads.

`LodgingRosterService.build_roster` opens a TaskGroup with seven year-scoped
reads on every single-weekend load (kindred#1963, plus kindred#2075's
prior-year cabins) -- identical for every weekend in the year, and re-issued
from scratch on every load because `build_roster` has no cache of its own.
`build_summary` already hoists six of the seven out of ITS per-weekend loop,
but the plain roster does not, which is most of why an empty weekend costs
~3s.

Only FIVE of the seven are cached here. `fetch_units` (`lodging_units`)
and `count_open_unresolved_aliases` (`lodging_ingest_issues`) are written
STRAIGHT TO POCKETBASE FROM THE BROWSER by the admin panels --
`frontend/src/services/lodgingCrud.ts`'s `createLodgingUnit` /
`updateLodgingUnit` / `confirmLodgingUnits` / `deactivateLodgingUnit` and
`mapUnresolvedAlias` / `ignoreIngestIssue` write those two collections
directly and never pass through this API. Caching either one would hide an
admin's own edit -- a cabin just confirmed, a cabin name just resolved -- for
the whole TTL, to buy about 16ms. That trade is not worth making, so
LodgingRepository never calls this cache for those two reads. Four of the five
it DOES cache (`fetch_households`, `fetch_prior_household_cm_ids`,
`fetch_family_camp_adults`, `fetch_family_camp_registrations`) are all
sync-written only: the CampMinder Go ingest is their sole writer, so nothing
in the browser can produce a row a staff member is waiting to see reflected.

The fifth, `fetch_cabin_assignments_by_household_cm_id` (kindred#2075), is
DERIVED rather than read: it is a join over `fetch_family_camp_registrations`
and `fetch_households` for the same year, and it takes an entry here for the
join, not for round trips it would otherwise make. Its inputs are therefore
already covered by the paragraph above, and it inherits their safety argument
-- but note the one thing it does not inherit: an LRU eviction of either
input would let this derived entry outlive the data it was computed from,
until its own TTL or the next `invalidate_all()` (both of which it shares
with them). `max_size` is 64 against a handful of reads times a handful of
years, so that eviction does not happen in practice; if the read set ever
grows, raise `max_size` rather than reasoning about which entry went first.

Shaped like api/services/metrics_cache.py (TTL + LRU + RLock) per that
module's own docstring pattern, but closer in spirit to
api/services/geo_service.py's module-level `_PERSON_ID_CACHE`: a
LodgingRepository is built fresh per request (api/routers/lodging.py's
`_service` / `_writes`), so an instance-level cache would never be reused, and
this must live as a singleton instead -- see api/dependencies.py.

TTL is the fallback, not the plan (kindred#2142): `api/routers/metrics.py`'s
existing `POST /api/metrics/cache/invalidate` now calls `invalidate_all()`
here too, alongside `metrics_cache.invalidate_all()` and geo_service's
`clear_person_id_cache()`. That endpoint already fires on every CampMinder
sync completion (the frontend's `invalidateSyncData`, via
`useSyncCompletionToasts`), and both of this cache's writers -- the
"persons" sync (households) and the "family_camp_derived" sync
(family_camp_adults, family_camp_registrations) -- are polled sync types
that trigger it. So a hit here is stale only for the gap between a sync
finishing and a staff member's browser polling it (typically seconds), or
for the rare sync that runs with nobody watching, in which case the TTL is
what closes the gap.

A cached `fetch_households` snapshot can still miss a household a FRESH
attendee already names, in the narrow window before that invalidation call
lands -- `LodgingRosterService._resolve_households` (kindred#2143) is the
per-request patch for exactly that gap: one small live fetch for the
missing id(s), never a second cache.
"""

import asyncio
import functools
import threading
import time
from collections.abc import Callable, Coroutine
from typing import Any, TypeVar

from bunking.logging_config import get_logger

logger = get_logger(__name__)

T = TypeVar("T")


class LodgingYearCache:
    """Thread-safe in-memory cache for the roster's year-scoped reads.

    Keyed by (read name, year) -- there is no third axis. None of the five
    reads varies by session or scenario, which is exactly why hoisting them
    into a cache is safe: the same answer is correct for every weekend and
    every scenario in a year.

    The year is the read's OWN argument, not "the year on screen":
    `fetch_cabin_assignments_by_household_cm_id` is called at `year - 1`, and
    lands under that key like any other.
    """

    def __init__(self, ttl_seconds: int = 900, max_size: int = 64) -> None:
        self._cache: dict[str, Any] = {}
        self._cache_times: dict[str, float] = {}
        self._access_times: dict[str, float] = {}
        self._ttl = ttl_seconds
        self._max_size = max_size
        self._lock = threading.RLock()
        # Per-key single-flight coalescing (kindred#2144): one asyncio.Lock
        # per (read_name, year) so concurrent misses on the same key await
        # the first in-flight fetch instead of each issuing their own. This
        # dict is itself only ever touched synchronously under `self._lock`
        # -- never awaited on while holding it -- the same rule that governs
        # `_cache`/`_cache_times`/`_access_times`. The locks it hands out are
        # a different story: `cached_by_year`'s wrapper awaits one of THOSE
        # across the fetch, but that await happens after `_lock_for` has
        # already released `self._lock`.
        self._inflight_locks: dict[str, asyncio.Lock] = {}

    @staticmethod
    def _make_key(read_name: str, year: int) -> str:
        return f"{read_name}:{year}"

    def get(self, read_name: str, year: int) -> Any | None:
        """Cached value for one read at one year, or None on miss/expiry."""
        key = self._make_key(read_name, year)
        with self._lock:
            if key in self._cache:
                if time.time() - self._cache_times[key] > self._ttl:
                    self._evict(key)
                    return None
                self._access_times[key] = time.time()
                return self._cache[key]
            return None

    def set(self, read_name: str, year: int, value: Any) -> None:
        key = self._make_key(read_name, year)
        with self._lock:
            if len(self._cache) >= self._max_size and key not in self._cache:
                self._evict_lru()
            now = time.time()
            self._cache[key] = value
            self._cache_times[key] = now
            self._access_times[key] = now

    def invalidate_all(self) -> int:
        """Clear every cached entry. Returns the number cleared.

        Called by `api/routers/metrics.py`'s `POST /api/metrics/cache/invalidate`
        (kindred#2142), which the frontend fires on CampMinder sync completion --
        see the module docstring for which syncs write the five cached reads and
        for the residual gap the TTL still covers.

        Also drops the in-flight lock map (kindred#2144). `asyncio.Lock` binds
        to the event loop it is first awaited on, and this cache is a
        process-wide singleton (`api/dependencies.py`) shared across every
        pytest-asyncio test, each of which gets its own loop. Leaving a lock
        from a prior test's loop in the map raises `RuntimeError` the next
        time a test awaits it -- `_reset_lodging_cache`
        (`tests/unit/api/services/test_lodging_repository.py`) already calls
        `invalidate_all()` around every test, which is what keeps that from
        happening.
        """
        with self._lock:
            count = len(self._cache)
            self._cache.clear()
            self._cache_times.clear()
            self._access_times.clear()
            self._inflight_locks.clear()
            if count:
                logger.info(f"Lodging year cache invalidated: cleared {count} entries")
            return count

    def _lock_for(self, read_name: str, year: int) -> asyncio.Lock:
        """The per-(read_name, year) asyncio.Lock, created on first ask.

        Looking the lock up (or creating it) is a plain dict operation, so it
        stays under `self._lock` like every other access to this instance's
        state. The lock this returns is then awaited OUTSIDE that
        `threading.RLock` -- by `cached_by_year`'s wrapper -- never inside it.
        """
        key = self._make_key(read_name, year)
        with self._lock:
            lock = self._inflight_locks.get(key)
            if lock is None:
                lock = asyncio.Lock()
                self._inflight_locks[key] = lock
            return lock

    def _evict(self, key: str) -> None:
        self._cache.pop(key, None)
        self._cache_times.pop(key, None)
        self._access_times.pop(key, None)

    def _evict_lru(self) -> None:
        if not self._access_times:
            return
        lru_key = min(self._access_times.items(), key=lambda x: x[1])[0]
        self._evict(lru_key)


_YearRead = Callable[[Any, int], Coroutine[Any, Any, T]]


def cached_by_year(cache: LodgingYearCache) -> Callable[[_YearRead[T]], _YearRead[T]]:
    """Wrap a `(self, year: int) -> T` repository method with `cache`.

    Keyed on the wrapped function's own `__name__`, not a hand-typed string --
    the four call sites in lodging_repository.py used to each repeat their own
    get-check / fetch / set block with the read name passed as a free string
    literal, which a rename or a copy-paste could silently desync from the
    method it was supposed to key. Tying the key to `__name__` makes that
    class of bug impossible instead of just avoided.

    Single-flight coalesced (kindred#2144): a miss acquires the per-key
    `asyncio.Lock` from `cache._lock_for` and re-checks the cache once inside
    it, so a caller that lost the race to another concurrent miss on the same
    key finds the winner's result already written and never calls `fn` at
    all. The fast-path check above stays lock-free -- only a miss pays for
    the lock.
    """

    def decorator(fn: _YearRead[T]) -> _YearRead[T]:
        @functools.wraps(fn)
        async def wrapper(self: Any, year: int) -> T:
            cached = cache.get(fn.__name__, year)
            if cached is not None:
                return cached  # type: ignore[no-any-return]
            async with cache._lock_for(fn.__name__, year):
                # Re-check: another coroutine may have already populated this
                # key while we were waiting for the lock.
                cached = cache.get(fn.__name__, year)
                if cached is not None:
                    return cached  # type: ignore[no-any-return]
                result = await fn(self, year)
                cache.set(fn.__name__, year, result)
                return result

        return wrapper

    return decorator
