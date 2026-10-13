"""One process-wide limit on concurrent PocketBase reads (kindred#3175 rolls it out app-wide).

The prod VPS has 2 vCPUs; a Camperships smoke test (2026-10-12) reached 8 concurrent PocketBase requests,
swapped, and timed out an API read. Four keeps both cores busy without thrashing -- hardcoded on purpose.

An asyncio.Semaphore, never a lock inside SuperuserPocketBase.send: a waiter here holds no thread from the
default to_thread pool, which everything else in the process shares. WRITES do not come through here
(commit_aid_writes, send_batch), so a staff save never queues behind a season rebuild.

One semaphore per event loop: pytest-asyncio gives each test its own loop, and a semaphore that has
parked a waiter is bound to the loop it parked on (the same trap lodging_cache.invalidate_all documents).
Production has one loop."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Final

PB_READ_CONCURRENCY: Final = 4

_gate: asyncio.Semaphore | None = None
_gate_loop: asyncio.AbstractEventLoop | None = None


def _semaphore() -> asyncio.Semaphore:
    global _gate, _gate_loop
    loop = asyncio.get_running_loop()
    if _gate is None or _gate_loop is not loop:
        _gate, _gate_loop = asyncio.Semaphore(PB_READ_CONCURRENCY), loop
    return _gate


async def pb_read[**P, T](fn: Callable[P, T], /, *args: P.args, **kwargs: P.kwargs) -> T:
    """`asyncio.to_thread(fn, ...)`, at most PB_READ_CONCURRENCY at a time across the process.

    A cancelled awaiter frees its slot while its thread runs to completion, so the number of
    threads actually running can briefly exceed PB_READ_CONCURRENCY."""
    async with _semaphore():
        return await asyncio.to_thread(fn, *args, **kwargs)
