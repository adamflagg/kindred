"""Fixtures shared by the API service tests."""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from api.dependencies import aid_inputs_cache


@pytest.fixture(autouse=True)
def _reset_aid_inputs_cache() -> Iterator[None]:
    """Layer 1 of the Camperships cache (aid_sync_inputs) is a process-wide singleton keyed by year alone, so a fill
    from one test's PocketBase double would answer the next test's reads. Clearing also drops its per-key asyncio
    locks, which bind to the event loop of the test that first awaited them (see LodgingYearCache.invalidate_all)."""
    aid_inputs_cache.invalidate_all()
    yield
    aid_inputs_cache.invalidate_all()
