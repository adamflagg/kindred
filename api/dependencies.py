"""
Shared dependencies for the Bunking API.

This module provides:
- PocketBase client management (global instance, background task isolation)
- Authentication helpers
- Caching infrastructure (graph cache, ID translation cache)
- Shared state for solver runs
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from bunking.graph.graph_cache_manager import GraphCacheManager
from pocketbase import PocketBase

from .services.id_cache import IDLookupCache
from .settings import get_settings

logger = logging.getLogger(__name__)

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
pb = PocketBase(pb_url)


class AuthState:
    """Shared state object for auth middleware and PocketBase client."""

    pb_client: PocketBase | None = None


auth_state = AuthState()


async def authenticate_pb() -> None:
    """Authenticate with PocketBase as admin."""
    settings = get_settings()
    try:
        await asyncio.to_thread(
            pb.collection("_superusers").auth_with_password,
            settings.pocketbase_admin_email,
            settings.pocketbase_admin_password,
        )
        logger.info("Successfully authenticated with PocketBase")
    except Exception as e:
        logger.error(f"Failed to authenticate with PocketBase: {e}")
        raise


async def get_pb_client() -> PocketBase:
    """FastAPI dependency to get authenticated PocketBase client."""
    return pb


def create_task_pb_client() -> PocketBase:
    """Create a fresh PocketBase client for background tasks."""
    return PocketBase(pb_url)


async def authenticate_task_pb(task_pb: PocketBase) -> None:
    """Authenticate a task-specific PocketBase client."""
    settings = get_settings()
    await asyncio.to_thread(
        task_pb.collection("_superusers").auth_with_password,
        settings.pocketbase_admin_email,
        settings.pocketbase_admin_password,
    )


# ========================================
# Graph Cache
# ========================================

graph_cache = GraphCacheManager(ttl_seconds=900, max_cache_size=50)


# ========================================
# Solver Runs Storage
# ========================================

# In-memory storage for solver runs (in production, use Redis or a database)
solver_runs: dict[str, dict[str, Any]] = {}


# ========================================
# ID Translation Cache
# ========================================

# IDLookupCache is imported at the top from .services.id_cache
# and re-exported here for backward compatibility

__all__ = [
    "pb",
    "pb_url",
    "auth_state",
    "authenticate_pb",
    "get_pb_client",
    "create_task_pb_client",
    "authenticate_task_pb",
    "graph_cache",
    "solver_runs",
    "IDLookupCache",
]
