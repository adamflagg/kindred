"""
Shared dependencies for the Bunking API.

This module provides:
- PocketBase client management (global instance, background task isolation)
- Authentication helpers
- Caching infrastructure (graph cache, ID translation cache)
- Shared state for solver runs
"""

import asyncio
from datetime import UTC, datetime
from typing import Any

from bunking.graph.graph_cache_manager import GraphCacheManager
from bunking.logging_config import get_logger
from pocketbase import PocketBase

from .services.aid_season_cache import AidSeasonCache
from .services.id_cache import IDLookupCache
from .services.lodging_cache import LodgingYearCache
from .services.metrics_cache import MetricsCache
from .services.pb_superuser_client import SuperuserPocketBase
from .settings import get_settings

logger = get_logger(__name__)

# ========================================
# PocketBase Client
# ========================================

# PocketBase client architecture:
# - pb: Global instance used by most endpoints (authenticated as admin on startup)
# - task_pb: Fresh instance created in background tasks for isolation
#
# Thread safety notes (from PocketBase maintainer):
# - The PocketBase API itself is stateless and thread-safe
# - The main concern is the authStore when handling different user contexts
# - Since we only authenticate as admin, a shared client would likely work
# - We use task-specific clients for extra isolation and future-proofing
_settings = get_settings()
pb_url = _settings.pocketbase_url


def _superuser_credentials() -> tuple[str, str]:
    settings = get_settings()
    return settings.pocketbase_admin_email, settings.pocketbase_admin_password


# This client and the per-task ones are SuperuserPocketBase, so a token that
# dies early (its tokenKey changed) is re-authenticated and the request retried
# once, at one choke point -- see api/services/pb_superuser_client.py.
# bunking.pocketbase_batch.send_batch posts through the http client instead of
# send(), and does its own resend-once via reauthenticate_if_stale. Not covered:
# ConfigLoader and the sync ConnectionManager keep their own clients (they
# re-auth on an interval instead).
pb: SuperuserPocketBase = SuperuserPocketBase(pb_url, credentials=_superuser_credentials)

# How often the global client's token is checked. PocketBase answers a dead
# token as a guest's request -- 200 with no items on an auth-ruled list -- which
# the retry above cannot see, so this probe is what bounds that silent window.
# auth-refresh is cheap (no password hash) and renews a live token as it goes.
PB_AUTH_PROBE_INTERVAL_SECONDS: float = 60


class AuthState:
    """Shared state object for auth middleware and PocketBase client."""

    pb_client: PocketBase | None = None


auth_state = AuthState()


async def authenticate_pb() -> None:
    """Authenticate with PocketBase as admin."""
    try:
        await asyncio.to_thread(pb.authenticate)
        logger.info("Successfully authenticated with PocketBase")
    except Exception as e:
        logger.error(f"Failed to authenticate with PocketBase: {e}")
        raise


async def probe_pb_auth() -> None:
    """Renew the global client's token, or sign in again if it has died. Raises on failure."""
    await asyncio.to_thread(pb.refresh_or_reauthenticate)


async def start_pb_token_refresh(interval_seconds: float | None = None) -> asyncio.Task[None]:
    """Start the background task that probes the PocketBase superuser token.

    ``interval_seconds`` defaults to PB_AUTH_PROBE_INTERVAL_SECONDS, read when
    the loop starts so tests can shrink it.
    """
    interval = PB_AUTH_PROBE_INTERVAL_SECONDS if interval_seconds is None else interval_seconds

    async def _refresh_loop() -> None:
        while True:
            await asyncio.sleep(interval)
            try:
                await probe_pb_auth()
            except Exception:
                logger.exception("PocketBase auth probe failed, will retry")

    return asyncio.create_task(_refresh_loop())


async def get_pb_client() -> PocketBase:
    """FastAPI dependency to get authenticated PocketBase client."""
    return pb


def create_task_pb_client() -> SuperuserPocketBase:
    """Create a fresh PocketBase client for background tasks."""
    return SuperuserPocketBase(pb_url, credentials=_superuser_credentials)


async def authenticate_task_pb(task_pb: SuperuserPocketBase) -> None:
    """Authenticate a task-specific PocketBase client."""
    await asyncio.to_thread(task_pb.authenticate)


# ========================================
# Graph Cache
# ========================================

# Cleared by scenario, solver and position writes, and -- since kindred#2803 --
# by the cache-invalidate endpoint when a finished sync writes a table the
# graph is built from (`SocialGraphBuilder.READ_TABLES`). Request edits and
# drag-drop written straight to PocketBase from the browser still reach it only
# through the TTL, so do not lengthen it until those writers are covered.
graph_cache = GraphCacheManager(ttl_seconds=900, max_cache_size=50)


# ========================================
# Metrics Response Cache
# ========================================

# Caches computed metrics endpoint responses in-memory.
# TTL 2 hours (fallback); primary invalidation is the cache-invalidate endpoint,
# which PocketBase's sync orchestrator calls after every job (kindred#2803).
metrics_cache = MetricsCache(ttl_seconds=7200, max_size=200)


# ========================================
# Lodging Year-Scoped Read Cache
# ========================================

# Caches build_roster/build_summary's year-scoped reads -- every
# `@cached_by_year` method on LodgingRepository, each declaring the tables it
# reads (see api/services/lodging_cache.py for the list, and for why
# fetch_units and count_open_unresolved_aliases are deliberately excluded:
# both are admin-panel-writable straight from the browser).
#
# MUST be a module-level singleton, not per-instance state: api/routers/
# lodging.py's `_service`/`_writes` build a fresh LodgingRepository on every
# request, so a cache living on `self` would never be reused across requests.
#
# Wired to POST /api/metrics/cache/invalidate (kindred#2142) -- see
# lodging_cache.py's module docstring for why the TTL is the fallback rather
# than the plan. Since kindred#2803 that clear is scoped to the syncs that
# write a cached table, and every clear and every backstop expiry is followed by a
# background warm (api/services/lodging_cache_warm.py, started from
# api/main.py's lifespan).
#
# The TTL AND the refresher's interval (lodging_cache_warm.start_lodging_cache_refresher),
# so the two cannot drift apart. It is a BACKSTOP for a MISSED sync-completion
# invalidate, not the freshness plan: the sync orchestrator clears this cache
# when a job that writes a table it reads finishes, and a missed call is logged
# as a PocketBase WARN. What keeps it current: sync completion (scoped by job);
# the Jotform admin writes, which invalidate the reads they change themselves
# (JotformAdminService._roster_changed); and the lodging hook that replays a
# staff-resolved queue row, which sends sync_type=lodging_assignments after it
# places something. Writes the cache cannot see (a PocketBase dashboard edit)
# wait out this expiry.
LODGING_CACHE_BACKSTOP_SECONDS = 6 * 60 * 60
lodging_cache = LodgingYearCache(ttl_seconds=LODGING_CACHE_BACKSTOP_SECONDS, max_size=128)


# ========================================
# Camperships Sync-Input Cache (layer 1)
# ========================================

# The season's sync-written Camperships inputs -- persons, households, attendees
# and the equity custom values -- read whole once per year and joined in Python
# (api/services/aid_sync_inputs.py). Only a sync writes them, so the
# cache-invalidate endpoint clears this when a finished sync writes one of its
# tables; the six-hour TTL is the fallback for a missed call. Two entries: the
# season and the `year - 1` a report reads. The committee report reads every
# season from 2026, so from the 2028 season it reads three and refills the
# oldest once layer 2 expires -- slower, never different (accepted 2026-10-13
# for memory; raise to 3, ~90 MB, if that latency is ever felt). One year
# measured 26-30 MB on the 2026-10-07 prod snapshot, and the prod box has
# 1.9 GiB with the API container capped at 1 GiB, so four years (~120 MB) was
# too much. A module-level singleton for the same reason as lodging_cache:
# every request builds fresh repositories.
#
# The TTL AND the refresher's interval (aid_sync_inputs.start_aid_inputs_refresher),
# so the two cannot drift apart. It is a BACKSTOP for a MISSED sync-completion
# invalidate, not the freshness plan: the sync orchestrator clears this cache
# when a job that writes one of its tables finishes, and a missed call is logged
# as a PocketBase WARN. Sync completion is the only writer that keeps it
# current -- no Camperships write and no browser path touches these tables.
AID_INPUTS_BACKSTOP_SECONDS = 6 * 60 * 60
aid_inputs_cache = LodgingYearCache(ttl_seconds=AID_INPUTS_BACKSTOP_SECONDS, max_size=2)


# ========================================
# Camperships Season Cache (layer 2)
# ========================================

# The priced live season, one build shared by every staff read until something
# changes it (api/services/aid_season_cache.py): every Camperships write clears
# its year through commit_aid_writes' listener, and every sync job's completion
# clears it all. Five minutes is the fallback for a missed clear. Four entries:
# the season and the prior year reports read, each on today's camp-time day.
aid_season_cache = AidSeasonCache(ttl_seconds=300, max_size=4)


# ========================================
# Camperships Development History Cache
# ========================================

# Reports › Development's past seasons: every enrolled registration from 2017
# to the season before the report's, read whole once per report year and
# filtered in Python (api/services/financial_aid_development_repository.py), so
# Development and its ZIP export share one read. Its tables -- attendees,
# persons, camp_sessions -- are sync-written only, so the cache-invalidate
# endpoint clears it when a finished sync writes one of them. Its own singleton
# rather than a read inside aid_inputs_cache: that cache's two slots belong to
# layer 1's two years, and a third entry would evict one. Two entries: the two
# report years Development prices (the season and the one before). Layer 1's
# TTL by reference, so the two fallbacks never drift apart.
development_history_cache = LodgingYearCache(ttl_seconds=aid_inputs_cache.ttl_seconds, max_size=2)


# ========================================
# Solver Runs Storage
# ========================================

# In-memory storage for solver runs (in production, use Redis or a database)
solver_runs: dict[str, dict[str, Any]] = {}

# Completed/failed runs stay readable in-memory for the frontend's status
# polling, but the dict must not grow unboundedly (prod swap incident
# 2026-06-12): each retained run holds full results + diagnostics. 50
# comfortably exceeds any realistic sweep size.
MAX_TERMINAL_SOLVER_RUNS = 50

_TERMINAL_STATUSES = frozenset({"completed", "failed"})
_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def prune_solver_runs() -> int:
    """Evict the oldest terminal runs above the cap; returns the eviction count.

    pending/running entries are never touched — the single-flight guards and
    the frontend's status polling depend on them being present.
    """
    terminal = [
        (run_id, run.get("completed_at") or _EPOCH)
        for run_id, run in solver_runs.items()
        if run.get("status") in _TERMINAL_STATUSES
    ]
    excess = len(terminal) - MAX_TERMINAL_SOLVER_RUNS
    if excess <= 0:
        return 0
    terminal.sort(key=lambda item: item[1])
    for run_id, _ in terminal[:excess]:
        solver_runs.pop(run_id, None)
    logger.info(f"Pruned {excess} terminal solver runs from memory (cap {MAX_TERMINAL_SOLVER_RUNS})")
    return excess


# ========================================
# ID Translation Cache
# ========================================

__all__ = [
    "MAX_TERMINAL_SOLVER_RUNS",
    "PB_AUTH_PROBE_INTERVAL_SECONDS",
    "IDLookupCache",
    "aid_inputs_cache",
    "aid_season_cache",
    "auth_state",
    "authenticate_pb",
    "authenticate_task_pb",
    "create_task_pb_client",
    "development_history_cache",
    "get_pb_client",
    "graph_cache",
    "lodging_cache",
    "metrics_cache",
    "pb",
    "pb_url",
    "probe_pb_auth",
    "prune_solver_runs",
    "solver_runs",
    "start_pb_token_refresh",
]
