"""One season build reads aid_attribution_overrides and aid_requests ONCE (api/services/aid_build_reads.py).

The decisions store and the grants register both read the season's requests, and the ledger's placements, its splits
and the register all read the attribution overrides: inside one build those duplicates share a single read. The share
is build-scoped: never across builds (two years at once, or a rebuild after a write), and never outside a build. The
shared requests read is the whole record, a superset of the register's projection, so no consumer loses a column, and
the season it prices is the one an unshared build prices."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

import pytest

from api.dependencies import aid_season_cache
from api.services.aid_build_reads import build_scoped_reads, shared_read
from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository
from api.services.financial_aid_grants_repository import GrantsRepository
from api.services.financial_aid_grants_service import GrantsService
from tests.unit.api.services.financial_aid_fakes import YEAR
from tests.unit.api.services.pb_recording import RecordingPb, _RecordingCollection
from tests.unit.api.services.test_aid_pb_budget import _build_tables, _service, invalidate_after_write

OVERRIDES = "aid_attribution_overrides"
REQUESTS = "aid_requests"


@dataclass
class _ParamsPb(RecordingPb):
    """RecordingPb that also keeps every read's whole query (fields, sort), not just its filter."""

    params: list[tuple[str, dict[str, Any]]] = field(default_factory=list)

    def collection(self, name: str) -> _RecordingCollection:
        return _ParamsCollection(self, name)


class _ParamsCollection(_RecordingCollection):
    def _record(self, query_params: dict[str, Any] | None) -> list[Any]:
        assert isinstance(self.pb, _ParamsPb)
        self.pb.params.append((self.name, dict(query_params or {})))
        return super()._record(query_params)


def _pb() -> _ParamsPb:
    return _ParamsPb(_build_tables())


@pytest.mark.asyncio
async def test_one_build_reads_the_overrides_and_the_requests_once() -> None:
    pb = _pb()
    await _service(pb).season(YEAR)
    assert pb.count(OVERRIDES) == 1
    assert pb.count(REQUESTS) == 1


@pytest.mark.asyncio
async def test_two_concurrent_builds_of_different_years_never_share() -> None:
    pb = _pb()
    service = _service(pb)
    await asyncio.gather(service.season(YEAR), service.season(YEAR - 1))
    assert pb.count(OVERRIDES) == 2
    assert pb.count(REQUESTS) == 2


@pytest.mark.asyncio
async def test_two_concurrent_builds_of_one_year_never_share() -> None:
    pb = _pb()
    service = _service(pb)  # no season cache: two builds, each its own
    await asyncio.gather(service.season(YEAR), service.season(YEAR))
    assert pb.count(OVERRIDES) == 2
    assert pb.count(REQUESTS) == 2


@pytest.mark.asyncio
async def test_a_rebuild_after_a_write_reads_them_again() -> None:
    pb = _pb()
    await _service(pb, cached=True).season(YEAR)
    pb.reset()
    invalidate_after_write(YEAR)
    await _service(pb, cached=True).season(YEAR)
    assert pb.count(OVERRIDES) == 1
    assert pb.count(REQUESTS) == 1
    aid_season_cache.invalidate_all()


@pytest.mark.asyncio
async def test_outside_a_build_every_read_is_its_own() -> None:
    pb = _pb()
    register = GrantsService(GrantsRepository(pb)).register_rows
    await asyncio.gather(register(YEAR), register(YEAR))
    store = FinancialAidDecisionsRepository(pb)
    await asyncio.gather(store.fetch_line_placements(YEAR), store.fetch_line_splits(YEAR))
    await asyncio.gather(store.fetch_requests(YEAR), store.fetch_requests(YEAR))
    assert pb.count(OVERRIDES) == 4
    assert pb.count(REQUESTS) == 4


@pytest.mark.asyncio
async def test_the_shared_requests_read_is_the_whole_record_and_the_registers_own_keeps_its_projection() -> None:
    """A projection shared with a reader that needs every column would blank the rest: the shared read is unprojected,
    with the filter and sort both readers used."""
    pb = _pb()
    await _service(pb).season(YEAR)
    (built,) = [p for c, p in pb.params if c == REQUESTS]
    assert "fields" not in built
    assert (built["filter"], built["sort"]) == (f"year = {YEAR}", "id")
    pb.params.clear()
    await GrantsService(GrantsRepository(pb)).register_rows(YEAR)
    (own,) = [p for c, p in pb.params if c == REQUESTS]
    assert own["fields"] == "id,household_cm_id,person_cm_id,session_cm_id,status"


@pytest.mark.asyncio
async def test_a_shared_build_prices_the_season_an_unshared_build_prices() -> None:
    pb = _pb()
    service = _service(pb)
    shared = await service._build_season(YEAR, names=True)
    unshared = await service._priced_season(YEAR, names=True)
    assert shared == unshared


@pytest.mark.asyncio
async def test_concurrent_first_callers_share_one_read_and_each_gets_its_own_list() -> None:
    reads = 0
    release = asyncio.Event()

    async def read() -> list[Any]:
        nonlocal reads
        reads += 1
        await release.wait()
        return [1, 2]

    with build_scoped_reads():
        first = asyncio.ensure_future(shared_read((REQUESTS, YEAR), read))
        second = asyncio.ensure_future(shared_read((REQUESTS, YEAR), read))
        other_year = asyncio.ensure_future(shared_read((REQUESTS, YEAR - 1), read))
        await asyncio.sleep(0)
        release.set()
        await asyncio.gather(first, second, other_year)
    a: list[Any] = first.result()
    b: list[Any] = second.result()
    assert reads == 2  # one per key
    assert a == b == [1, 2]
    assert a is not b
    await shared_read((REQUESTS, YEAR), read)  # the scope is gone: a read of its own
    assert reads == 3


@pytest.mark.asyncio
async def test_a_failed_shared_read_reaches_every_caller() -> None:
    async def read() -> list[Any]:
        raise RuntimeError("PocketBase is down")

    with build_scoped_reads():
        results = await asyncio.gather(
            shared_read((OVERRIDES, YEAR), read), shared_read((OVERRIDES, YEAR), read), return_exceptions=True
        )
    assert all(isinstance(r, RuntimeError) for r in results)
