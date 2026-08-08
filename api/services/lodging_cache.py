"""Server-side cache for the weekend roster's year-scoped PocketBase reads.

`LodgingRosterService.build_roster` opens a TaskGroup with six year-scoped
reads on every single-weekend load (kindred#1963) -- identical for every
weekend in the year, and re-issued from scratch on every load because
`build_roster` has no cache of its own. `build_summary` already hoists this
work out of ITS per-weekend loop, but the plain roster does not, which is
most of why an empty weekend costs ~3s.

Only FOUR of the six are cached here, not six. `fetch_units` (`lodging_units`)
and `count_open_unresolved_aliases` (`lodging_ingest_issues`) are written
STRAIGHT TO POCKETBASE FROM THE BROWSER by the admin panels --
`frontend/src/services/lodgingCrud.ts`'s `createLodgingUnit` /
`updateLodgingUnit` / `confirmLodgingUnits` / `deactivateLodgingUnit` and
`mapUnresolvedAlias` / `ignoreIngestIssue` write those two collections
directly and never pass through this API. Caching either one would hide an
admin's own edit -- a cabin just confirmed, a cabin name just resolved -- for
the whole TTL, to buy about 16ms. That trade is not worth making, so
LodgingRepository never calls this cache for those two reads. The four it DOES
cache (`fetch_households`, `fetch_prior_household_cm_ids`,
`fetch_family_camp_adults`, `fetch_family_camp_registrations`) are all
sync-written only: the CampMinder Go ingest is their sole writer, so nothing
in the browser can produce a row a staff member is waiting to see reflected.

Shaped like api/services/metrics_cache.py (TTL + LRU + RLock) per that
module's own docstring pattern, but closer in spirit to
api/services/geo_service.py's module-level `_PERSON_ID_CACHE`: a
LodgingRepository is built fresh per request (api/routers/lodging.py's
`_service` / `_writes`), so an instance-level cache would never be reused, and
this must live as a singleton instead -- see api/dependencies.py.

TTL-only for now. There is no `/api/lodging/cache/invalidate` endpoint wired
to CampMinder sync completion yet, because that wiring lives in
api/routers/lodging.py (and possibly the frontend's sync-completion hook),
both outside kindred#1963's scope. `invalidate_all` is exposed so adding that
call is a one-line follow-up, not a re-architecture -- exactly how
`api/routers/metrics.py`'s `/cache/invalidate` already calls both
`metrics_cache.invalidate_all()` and geo_service's `clear_person_id_cache()`.
"""

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

    Keyed by (read name, year) -- there is no third axis. These four reads
    never vary by session or scenario, which is exactly why hoisting them
    into a cache is safe: the same answer is correct for every weekend and
    every scenario in a year.
    """

    def __init__(self, ttl_seconds: int = 900, max_size: int = 64) -> None:
        self._cache: dict[str, Any] = {}
        self._cache_times: dict[str, float] = {}
        self._access_times: dict[str, float] = {}
        self._ttl = ttl_seconds
        self._max_size = max_size
        self._lock = threading.RLock()

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

        Not wired to anything yet (see module docstring) -- exposed so the
        follow-up that wires it to sync completion needs no change here.
        """
        with self._lock:
            count = len(self._cache)
            self._cache.clear()
            self._cache_times.clear()
            self._access_times.clear()
            if count:
                logger.info(f"Lodging year cache invalidated: cleared {count} entries")
            return count

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
    """

    def decorator(fn: _YearRead[T]) -> _YearRead[T]:
        @functools.wraps(fn)
        async def wrapper(self: Any, year: int) -> T:
            cached = cache.get(fn.__name__, year)
            if cached is not None:
                return cached  # type: ignore[no-any-return]
            result = await fn(self, year)
            cache.set(fn.__name__, year, result)
            return result

        return wrapper

    return decorator
