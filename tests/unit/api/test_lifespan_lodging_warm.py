"""kindred#2803: the API warms the weekend cache on startup, in the background.

A warm on startup is what makes the first weekend load after a deploy or a
restart as fast as any other; a warm that BLOCKED startup would instead hold
the container's health check hostage to PocketBase's slowest read.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.mark.asyncio
async def test_startup_starts_the_refresher_and_shutdown_stops_it() -> None:
    from api import main

    started: list[asyncio.Task[None]] = []

    def fake_start() -> asyncio.Task[None]:
        task = asyncio.create_task(asyncio.sleep(3600))
        started.append(task)
        return task

    settings = SimpleNamespace(skip_pb_auth=False, pocketbase_url="http://pb.invalid")
    with (
        patch.object(main, "get_settings", return_value=settings),
        patch.object(main, "authenticate_pb", AsyncMock()),
        patch.object(main, "start_pb_token_refresh", AsyncMock(return_value=None)),
        patch.object(main, "ConfigLoader", MagicMock()),
        patch.object(main, "close_connection", MagicMock()),
        patch.object(main, "start_lodging_cache_refresher", side_effect=fake_start),
    ):
        async with main.lifespan(MagicMock()):
            assert len(started) == 1
            assert not started[0].done(), "the warm must run in the background, not block startup"
        await asyncio.sleep(0)

    assert started[0].cancelled()


@pytest.mark.asyncio
async def test_no_refresher_without_pocketbase_auth() -> None:
    """SKIP_PB_AUTH is the test/offline mode: there is no authenticated client
    to warm with."""
    from api import main

    settings = SimpleNamespace(skip_pb_auth=True, pocketbase_url="http://pb.invalid")
    with (
        patch.object(main, "get_settings", return_value=settings),
        patch.object(main, "close_connection", MagicMock()),
        patch.object(main, "start_lodging_cache_refresher") as start,
    ):
        async with main.lifespan(MagicMock()):
            pass

    start.assert_not_called()
