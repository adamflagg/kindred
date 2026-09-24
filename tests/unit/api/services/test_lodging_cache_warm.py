"""kindred#2803: the weekend cache is cleared only by syncs that write what it
holds, and is warmed in the background instead of on a staff member's click.

Measured on the 2026-09-23 production snapshot: a cold weekend page is ~2.3 s
and a warm one ~0.1 s, and the page was usually cold. Every completed sync
cleared the whole cache -- including the HOURLY `bunk_assignments` sync, which
writes nothing the cache holds -- and nothing re-filled it until somebody
clicked.

The risk the issue names is an incomplete writer-to-table map: a sync that
writes a cached table but is classified as not writing it leaves the board
stale until the TTL. So the map is built from two declared halves, each pinned
here against the code it describes:

* every `@cached_by_year` read DECLARES the PocketBase tables it reads
  (`tables=`), and the declaration is pinned read by read;
* every sync job in the Go registry (`pocketbase/sync/orchestrator.go`'s
  `syncJobMeta`) is classified in `SYNC_JOB_WRITES`, and a job the registry
  gains without a classification fails here, and clears the cache in the
  meantime rather than skipping it.
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from pocketbase.models.record import Record

from api.constants.sync_job_writes import SYNC_JOB_WRITES
from api.dependencies import lodging_cache
from api.services.lodging_cache import LodgingYearCache, cached_by_year
from api.services.lodging_cache_warm import (
    cached_read_tables,
    current_season_year,
    refresh_lodging_cache_forever,
    sync_invalidates_lodging_cache,
    warm_lodging_year,
)
from api.services.lodging_repository import LodgingRepository
from api.services.lodging_roster_service import LodgingRosterService

REPO_ROOT = Path(__file__).resolve().parents[4]
ORCHESTRATOR_GO = REPO_ROOT / "pocketbase" / "sync" / "orchestrator.go"


@pytest.fixture(autouse=True)
def _reset_lodging_cache() -> Any:
    lodging_cache.invalidate_all()
    yield
    lodging_cache.invalidate_all()


# --------------------------------------------------------------- the map


# What each cached read reads, by PocketBase table -- including the tables a
# FILTER or an EXPAND reaches through a relation, because a sync rewriting
# `camp_sessions.session_type` or `persons.household_id` changes the answer as
# surely as one rewriting `attendees`.
EXPECTED_CACHED_READ_TABLES = {
    "fetch_households": {"households"},
    "fetch_prior_household_cm_ids": {"attendees", "camp_sessions", "persons"},
    "fetch_family_enrolled_household_cm_ids": {"attendees", "camp_sessions", "persons"},
    "fetch_family_enrolled_attendees": {"attendees", "camp_sessions", "persons"},
    "fetch_live_assignments": {"lodging_assignments"},
    "fetch_prior_adult_person_cm_ids": {"attendees", "camp_sessions"},
    "fetch_adult_weekend_attendees": {"attendees", "camp_sessions"},
    "fetch_adult_cabin_values": {"person_custom_values", "persons", "custom_field_defs"},
    "fetch_adult_need_values": {"person_custom_values", "persons", "custom_field_defs"},
    "fetch_family_camp_adults": {"family_camp_adults"},
    "fetch_family_camp_registrations": {"family_camp_registrations"},
    "fetch_request_text_values": {"person_custom_values", "persons", "custom_field_defs", "original_bunk_requests"},
    "fetch_cabin_assignments_by_household_cm_id": {"family_camp_registrations", "households"},
}

# The syncs that write at least one of those tables. Pinned as a literal so a
# change to either half of the map shows up here as a reviewed diff rather
# than as a silent change of behaviour.
EXPECTED_INVALIDATING_SYNCS = {
    "sessions",  # camp_sessions
    "attendees",  # attendees
    "persons",  # persons + households
    "custom_field_defs",  # custom_field_defs
    "person_custom_values",  # person_custom_values
    "person_custom_values_family_camp",  # person_custom_values (bounded daily pass)
    "family_camp_derived",  # family_camp_adults, family_camp_registrations
    "lodging_assignments",  # lodging_assignments
    "normalize_geographic",  # persons (normalized_* columns)
    "reconcile_request_lifecycle",  # original_bunk_requests
    "bunk_requests",  # original_bunk_requests
    "process_requests",  # original_bunk_requests (`processed`, via the Python processor)
}


def _go_registry_job_ids() -> list[str]:
    """Job ids out of `syncJobMeta`, validated the way
    `frontend/src/test/backendSyncJobIds.ts` validates them: every `{ID:`
    token must yield exactly one id, so a row this regex cannot read fails
    loudly instead of being skipped."""
    source = ORCHESTRATOR_GO.read_text()
    start = source.index("var syncJobMeta = []JobMeta{")
    end = source.index("\n}", start)
    table = source[start:end]
    ids = re.findall(r'^\t\{ID: "([a-z0-9_]+)",', table, flags=re.MULTILINE)
    assert len(ids) == table.count("{ID:"), "a syncJobMeta row this parser could not read"
    assert ids, "parsed no job ids at all"
    return ids


class TestCachedReadsDeclareTheirTables:
    def test_every_cached_read_declares_exactly_the_tables_it_reads(self) -> None:
        assert {name: set(tables) for name, tables in cached_read_tables().items()} == EXPECTED_CACHED_READ_TABLES

    def test_a_cached_read_cannot_be_declared_without_tables(self) -> None:
        """An empty declaration would make every sync look like a non-writer."""
        with pytest.raises(ValueError, match="tables"):
            cached_by_year(LodgingYearCache(), tables=())


class TestSyncJobWritesCoverTheGoRegistry:
    def test_every_go_sync_job_is_classified(self) -> None:
        assert sorted(SYNC_JOB_WRITES) == sorted(_go_registry_job_ids())

    def test_the_invalidating_syncs_are_exactly_the_writers_of_a_cached_table(self) -> None:
        invalidating = {job for job in SYNC_JOB_WRITES if sync_invalidates_lodging_cache(job)}
        assert invalidating == EXPECTED_INVALIDATING_SYNCS


class TestWhichSyncsClearTheCache:
    def test_the_hourly_bunk_assignments_sync_does_not_clear_it(self) -> None:
        """The measured cause: `0 * * * *` cleared a cache none of whose reads
        touch `bunk_assignments`."""
        assert not sync_invalidates_lodging_cache("bunk_assignments")

    @pytest.mark.parametrize("sync_type", ["attendees", "persons", "family_camp_derived", "person_custom_values"])
    def test_a_writer_of_a_cached_table_clears_it(self, sync_type: str) -> None:
        assert sync_invalidates_lodging_cache(sync_type)

    def test_no_sync_type_clears_it(self) -> None:
        """The endpoint's other callers (the PocketBase config hook, the
        registration-dates panel) name no sync -- they keep today's behaviour."""
        assert sync_invalidates_lodging_cache(None)

    def test_an_unclassified_sync_type_clears_it(self) -> None:
        """Fail safe: a job nobody classified yet may write anything."""
        assert sync_invalidates_lodging_cache("a_job_added_next_month")


# ------------------------------------------------------- generation guard


class TestAFetchThatStraddlesAClearIsNotCached:
    @pytest.mark.asyncio
    async def test_a_result_read_before_the_clear_is_not_written_back_after_it(self) -> None:
        """The race a background warm makes likely: the warm starts reading,
        a sync lands and clears the cache, then the warm's PRE-sync answer
        arrives. Written back, it would sit there until the TTL."""
        cache = LodgingYearCache()
        release = asyncio.Event()
        calls: list[int] = []

        class Repo:
            @cached_by_year(cache, tables=("households",))
            async def fetch_thing(self, year: int) -> dict[str, int]:
                calls.append(year)
                await release.wait()
                return {"answer": len(calls)}

        in_flight = asyncio.create_task(Repo().fetch_thing(2026))
        await asyncio.sleep(0)
        cache.invalidate_all()
        release.set()

        # The caller still gets its answer...
        assert await in_flight == {"answer": 1}
        # ...but the cache does not keep it.
        assert cache.get("fetch_thing", 2026) is None

    @pytest.mark.asyncio
    async def test_a_fetch_with_no_clear_in_between_is_cached_as_before(self) -> None:
        cache = LodgingYearCache()

        class Repo:
            @cached_by_year(cache, tables=("households",))
            async def fetch_thing(self, year: int) -> dict[str, int]:
                return {"answer": year}

        await Repo().fetch_thing(2026)

        assert cache.get("fetch_thing", 2026) == {"answer": 2026}


# ------------------------------------------------------------------ warm


def _session_row(cm_id: int, session_type: str, year: int) -> dict[str, Any]:
    return {
        "id": f"s_{cm_id}",
        "cm_id": cm_id,
        "year": year,
        "session_type": session_type,
        "name": f"Weekend {cm_id}",
        "start_date": f"{year}-06-05 00:00:00.000Z",
        "end_date": f"{year}-06-07 00:00:00.000Z",
        "sort_order": 1,
    }


def _fake_pb(year: int) -> MagicMock:
    """Every collection empty except `camp_sessions`, which holds one family
    and one adult weekend -- enough for build_roster and build_summary to run
    every branch that issues a cached read."""
    sessions = [_session_row(1000001, "family", year), _session_row(1000002, "adult", year)]
    pb = MagicMock()
    collections: dict[str, MagicMock] = {}

    def collection(name: str) -> MagicMock:
        if name not in collections:
            coll = MagicMock()
            if name == "camp_sessions":

                def sessions_for(batch: int = 100, query_params: dict[str, Any] | None = None) -> list[Record]:
                    flt = (query_params or {}).get("filter", "")
                    match = re.search(r"cm_id = (\d+)", flt)
                    rows = [s for s in sessions if not match or s["cm_id"] == int(match.group(1))]
                    return [Record(dict(r)) for r in rows]

                coll.get_full_list.side_effect = sessions_for
            else:
                coll.get_full_list.return_value = []
            listing = MagicMock()
            listing.items = []
            listing.total_items = 0
            coll.get_list.return_value = listing
            collections[name] = coll
        return collections[name]

    pb.collection.side_effect = collection
    return pb


async def _misses_during(action: Any) -> int:
    with patch.object(lodging_cache, "set", wraps=lodging_cache.set) as spy:
        await action()
    return spy.call_count


class TestTheWarmCoversEveryCachedReadAPageIssues:
    """Pinned against the pages themselves rather than against a list: after a
    warm, the landing and BOTH grains of weekend board must not miss the
    cache once. A read added to `build_roster` without a matching warm fails
    here."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "year",
        [
            pytest.param(2026, id="2026-board"),
            # From the 2027 board, last season is a live-housing season and the
            # family card reads two different cached reads (kindred#2775).
            pytest.param(2027, id="2027-board-live-housing-last-year"),
        ],
    )
    async def test_no_page_misses_the_cache_after_a_warm(self, year: int) -> None:
        pb = _fake_pb(year)
        service = LodgingRosterService(LodgingRepository(pb))

        # Sanity: without a warm, the board does miss -- so zero below means
        # something.
        assert await _misses_during(lambda: service.build_roster(year, 1000001)) > 0
        lodging_cache.invalidate_all()

        await warm_lodging_year(year, pb=pb)

        assert await _misses_during(lambda: service.build_summary(year)) == 0
        assert await _misses_during(lambda: service.build_roster(year, 1000001)) == 0
        assert await _misses_during(lambda: service.build_roster(year, 1000002)) == 0

    @pytest.mark.asyncio
    async def test_a_failed_warm_is_logged_not_raised(self) -> None:
        """A warm runs with nobody waiting on it; a PocketBase outage must not
        become an unhandled task exception."""
        pb = MagicMock()
        pb.collection.side_effect = RuntimeError("pocketbase is down")

        await warm_lodging_year(2026, pb=pb)  # does not raise


class TestCurrentSeasonYear:
    @pytest.mark.asyncio
    async def test_is_the_year_the_frontend_defaults_to(self) -> None:
        """`_configured_year` on the sync-status payload is what
        CurrentYearContext defaults the board to, so it is the year worth
        having warm."""
        pb = MagicMock()
        pb.send.return_value = {"_configured_year": 2027}

        assert await current_season_year(pb) == 2027
        assert pb.send.call_args[0][0] == "/api/custom/sync/status"

    @pytest.mark.asyncio
    async def test_falls_back_to_the_season_env_then_the_calendar(self, monkeypatch: pytest.MonkeyPatch) -> None:
        pb = MagicMock()
        pb.send.side_effect = RuntimeError("unreachable")
        monkeypatch.setenv("CAMPMINDER_SEASON_ID", "2025")

        assert await current_season_year(pb) == 2025


class TestTheRefresher:
    @pytest.mark.asyncio
    async def test_warms_at_once_then_clears_and_rewarms_every_interval(self) -> None:
        """TTL expiry is a clear like any other, so it is followed by a warm
        too: the staleness bound stays the TTL, and the page stays warm."""
        warmed: list[int] = []
        cleared_before_rewarm: list[bool] = []

        async def fake_warm(year: int) -> None:
            cleared_before_rewarm.append(lodging_cache.get("fetch_households", year) is None)
            warmed.append(year)
            lodging_cache.set("fetch_households", year, {"hh": object()})

        async def fake_year() -> int:
            return 2026

        task = asyncio.create_task(refresh_lodging_cache_forever(interval=0.01, warm=fake_warm, year=fake_year))
        for _ in range(200):
            await asyncio.sleep(0.005)
            if len(warmed) >= 3:
                break
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        assert warmed[:3] == [2026, 2026, 2026]
        # Each re-warm starts from a cleared cache, never from its own last answer.
        assert all(cleared_before_rewarm[:3])
