"""Two light reads one Camperships season build would otherwise make two or three times, made once per build.

Inside one season build the decisions store and the grants register both read the season's aid_requests, and the
ledger's placements, its splits and the register all read aid_attribution_overrides. The register sits behind the
RegisterSource seam, so the duplicates cannot simply be passed along. Instead `_build_season` opens a scope
(`build_scoped_reads`) and these two reads go through `shared_read`: the first caller's read is the one every other
caller in the build awaits.

BUILD-SCOPED, AND ONLY THESE TWO. The scope is a ContextVar holding a fresh memo per build. asyncio.gather and
create_task copy the context, so the build's own child tasks share it, while another build (another year, a rebuild
after a write, a concurrent build of the same year) opens its own, and nothing outside a build sees one. It is not a
general read memo: a build writes nothing (owner ruling 2026-10-16: the grant placement log is recorded by the sync
step and the warm, record_placements), so nothing it reads can go stale under it.

SAME ROWS, SAME COLUMNS. A shared read is one canonical query: the requests read is the whole record with the filter
and sort both readers use, a superset of the register's own projection, so no reader loses a column. Each caller gets
its own list (the rows themselves are shared, and read-only, as layer 1's are)."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Hashable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any


class _BuildReads:
    """One build's shared reads: the in-flight or finished read for each key."""

    def __init__(self) -> None:
        self._reads: dict[Hashable, asyncio.Future[list[Any]]] = {}

    async def get(self, key: Hashable, read: Callable[[], Awaitable[list[Any]]]) -> list[Any]:
        found = self._reads.get(key)
        if found is None:
            # A task, so concurrent first callers await one read rather than racing into two.
            found = asyncio.ensure_future(read())
            self._reads[key] = found
        return list(await asyncio.shield(found))


_BUILD_READS: ContextVar[_BuildReads | None] = ContextVar("aid_build_reads", default=None)


@contextmanager
def build_scoped_reads() -> Iterator[None]:
    """Open one build's scope: a fresh memo, whatever scope the caller was in, closed when the build ends."""
    token = _BUILD_READS.set(_BuildReads())
    try:
        yield
    finally:
        _BUILD_READS.reset(token)


def in_build() -> bool:
    return _BUILD_READS.get() is not None


async def shared_read(key: Hashable, read: Callable[[], Awaitable[list[Any]]]) -> list[Any]:
    """`read()` once per build for `key`, shared by every caller in the build; outside a build, a read of its own."""
    reads = _BUILD_READS.get()
    if reads is None:
        return await read()
    return await reads.get(key, read)
