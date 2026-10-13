"""Reports › Development's past-seasons attendance read (DevelopmentRepository.earlier_attendance) as one whole read
PER PAST SEASON, run concurrently, cached per report year and filtered in Python, so the report and its ZIP export
share it.

These pin the read (one read per season of the window, concurrently under pb_read's cap, never a filter through a
relation -- kindred#3196: one paged read of the whole window chained 19 pages in series), the cache's lifetime (within
the TTL nothing is re-read whatever campers are asked for, concurrent callers share one fill, report years never mix),
what clears it (a sync that writes attendees, persons or camp_sessions), and the before -> after count on a
Development open plus its ZIP export. What the read RETURNS is pinned separately, unchanged, in
test_development_history_parity.py."""

from __future__ import annotations

import asyncio
import re
import threading
import time
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import pytest

from api.dependencies import aid_inputs_cache, development_history_cache
from api.services.financial_aid_development_repository import (
    _FIELDS,
    DEVELOPMENT_HISTORY_TABLES,
    AttendanceRecord,
    DevelopmentRepository,
)
from api.services.financial_aid_development_service import FinancialAidDevelopmentService
from api.services.financial_aid_grants_register import RegisterRow
from api.services.lodging_cache import LodgingYearCache
from api.services.pb_read import PB_READ_CONCURRENCY
from tests.unit.api.services.decisions_fakes import FakeRules, approved
from tests.unit.api.services.development_history_fixture import FilteringPb, Row
from tests.unit.api.services.financial_aid_fakes import intake_rules
from tests.unit.api.services.reports_fakes import FakeReportsStore, report_season
from tests.unit.api.services.test_aid_pb_budget import _RELATION_PATH
from tests.unit.api.services.test_development_history_parity import (
    ASKED_HOUSEHOLDS,
    ASKED_PEOPLE,
    EMMA,
    LIAM_HOME,
    REPORT_YEAR,
    history_pb,
)

SEASONS = range(2017, REPORT_YEAR)  # the window: 2017 to the season before the report's
_SEASON_FILTER = re.compile(r"^year = \d+ && status_id = 2$")


def _season_query(season: int) -> dict[str, Any]:
    return {"filter": f"year = {season} && status_id = 2", "expand": "person,session", "fields": _FIELDS, "sort": "id"}


def _history_reads(pb: FilteringPb) -> list[str]:
    """The past-season reads, in season order whatever order they ran in."""
    return sorted(
        str(r.query.get("filter", ""))
        for r in pb.reads
        if r.collection == "attendees" and _SEASON_FILTER.match(str(r.query.get("filter", "")))
    )


# --- the read ---------------------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_history_is_one_whole_read_per_season_of_the_window() -> None:
    pb = history_pb()
    await DevelopmentRepository(pb).earlier_attendance(REPORT_YEAR, ASKED_PEOPLE, ASKED_HOUSEHOLDS)
    assert sorted(((r.collection, r.query) for r in pb.reads), key=lambda read: str(read[1]["filter"])) == [
        ("attendees", _season_query(season)) for season in SEASONS
    ]


@pytest.mark.asyncio
async def test_the_seasons_are_read_concurrently_under_the_shared_cap() -> None:
    """kindred#3196: one paged read of the whole window made the SDK fetch 19 pages one after another, each re-counting
    the window -- 7.3 s in series on production. The seasons must overlap, and never past pb_read's cap."""
    overlap = threading.Condition()
    in_flight = 0
    peak = 0
    serial = False
    pb = history_pb()
    real = pb.collection

    def timed(name: str) -> Any:
        inner = real(name)
        read = inner.get_full_list

        def overlapping_read(batch: int = 500, query_params: dict[str, Any] | None = None) -> list[Any]:
            nonlocal in_flight, peak, serial
            with overlap:
                in_flight += 1
                peak = max(peak, in_flight)
                overlap.notify_all()
                # Hold until a sibling is in flight, so a loaded box cannot serialise the reads by scheduling alone;
                # serial reads never get one: the first times out, the rest stop waiting, and the lower bound fails.
                serial = serial or not overlap.wait_for(lambda: peak >= 2 or serial, timeout=5)
            try:
                time.sleep(0.05)  # and keep each read open, so an uncapped fill would overlap past the cap
                return read(batch=batch, query_params=query_params)
            finally:
                with overlap:
                    in_flight -= 1

        inner.get_full_list = overlapping_read  # type: ignore[method-assign]
        return inner

    pb.collection = timed  # type: ignore[method-assign]
    await DevelopmentRepository(pb).earlier_attendance(REPORT_YEAR, ASKED_PEOPLE, ASKED_HOUSEHOLDS)
    assert pb.count("attendees") == len(SEASONS)
    assert 2 <= peak <= PB_READ_CONCURRENCY


@pytest.mark.asyncio
async def test_a_report_year_with_no_earlier_season_reads_nothing() -> None:
    pb = history_pb()
    assert await DevelopmentRepository(pb).earlier_attendance(2017, ASKED_PEOPLE, ASKED_HOUSEHOLDS) == []
    assert pb.count("attendees") == 0


@pytest.mark.asyncio
async def test_no_filter_the_history_read_sends_reaches_through_a_relation() -> None:
    pb = history_pb()
    await DevelopmentRepository(pb).earlier_attendance(REPORT_YEAR, ASKED_PEOPLE, ASKED_HOUSEHOLDS)
    assert pb.reads
    assert [r.query["filter"] for r in pb.reads if _RELATION_PATH.search(str(r.query.get("filter", "")))] == []


@pytest.mark.asyncio
async def test_a_second_read_of_the_same_report_year_reads_no_attendees() -> None:
    """Development, then the ZIP export: different campers and households, the same report year."""
    pb = history_pb()
    repo = DevelopmentRepository(pb)
    await repo.earlier_attendance(REPORT_YEAR, ASKED_PEOPLE, ASKED_HOUSEHOLDS)
    pb.reset()
    await DevelopmentRepository(pb).earlier_attendance(REPORT_YEAR, [EMMA], [LIAM_HOME])
    await repo.earlier_attendance(REPORT_YEAR, ASKED_PEOPLE, [])
    assert pb.count("attendees") == 0


@pytest.mark.asyncio
async def test_the_cache_holds_parsed_records_never_sdk_rows() -> None:
    pb = history_pb()
    await DevelopmentRepository(pb).earlier_attendance(REPORT_YEAR, [EMMA], [])
    held = development_history_cache.get("past_enrolled", REPORT_YEAR)
    assert isinstance(held, tuple)
    assert held
    assert all(type(r) is AttendanceRecord for r in held)
    assert all(2017 <= r.year < REPORT_YEAR and r.status_id == 2 for r in held)


@pytest.mark.asyncio
async def test_concurrent_callers_share_one_fill() -> None:
    pb = history_pb()
    repo = DevelopmentRepository(pb)
    await asyncio.gather(
        repo.earlier_attendance(REPORT_YEAR, ASKED_PEOPLE, []),
        repo.earlier_attendance(REPORT_YEAR, [], ASKED_HOUSEHOLDS),
        repo.earlier_attendance(REPORT_YEAR, [EMMA], [LIAM_HOME]),
    )
    assert pb.count("attendees") == len(SEASONS)  # one fill: each season read once


@pytest.mark.asyncio
async def test_a_cancelled_first_caller_does_not_cancel_the_shared_fill() -> None:
    """A browser disconnect cancels its request; the fill another request waits on must go on."""
    release = threading.Event()
    started = threading.Event()
    pb = history_pb()
    real = pb.collection

    def gated(name: str) -> Any:
        inner = real(name)
        read = inner.get_full_list

        def wait_then_read(batch: int = 500, query_params: dict[str, Any] | None = None) -> list[Any]:
            started.set()
            release.wait(timeout=10)
            return read(batch=batch, query_params=query_params)

        inner.get_full_list = wait_then_read  # type: ignore[method-assign]
        return inner

    pb.collection = gated  # type: ignore[method-assign]
    first = asyncio.create_task(DevelopmentRepository(pb).earlier_attendance(REPORT_YEAR, [EMMA], []))
    # Cancel only once the fill is really running in its worker thread, or a slow loop could cancel the first
    # task before it reaches the shield and the test would stop proving it.
    for _ in range(500):
        if started.is_set():
            break
        await asyncio.sleep(0.01)
    else:
        pytest.fail("the first caller's fill never started")
    second = asyncio.create_task(DevelopmentRepository(pb).earlier_attendance(REPORT_YEAR, [], [LIAM_HOME]))
    await asyncio.sleep(0.05)
    first.cancel()
    await asyncio.sleep(0.05)
    release.set()
    found = await asyncio.wait_for(second, timeout=10)
    assert [r.household_cm_id for r in found] == [LIAM_HOME]
    assert pb.count("attendees") == len(SEASONS)


@pytest.mark.asyncio
async def test_report_years_are_separate_fills_and_never_mix() -> None:
    pb = history_pb()
    repo = DevelopmentRepository(pb)
    earlier = await repo.earlier_attendance(2021, ASKED_PEOPLE, ASKED_HOUSEHOLDS)
    later = await repo.earlier_attendance(REPORT_YEAR, ASKED_PEOPLE, ASKED_HOUSEHOLDS)
    assert pb.count("attendees") == len(range(2017, 2021)) + len(SEASONS)
    assert max(r.year for r in earlier) < 2021 < max(r.year for r in later)
    pb.reset()
    await repo.earlier_attendance(2021, [EMMA], [])
    await repo.earlier_attendance(REPORT_YEAR, [EMMA], [])
    assert pb.count("attendees") == 0


@pytest.mark.asyncio
async def test_the_cache_is_keyed_on_the_report_year_as_an_int() -> None:
    pb = history_pb()
    repo = DevelopmentRepository(pb)
    await repo.earlier_attendance(float(REPORT_YEAR), [EMMA], [])  # type: ignore[arg-type]
    pb.reset()
    await repo.earlier_attendance(REPORT_YEAR, [EMMA], [])
    assert pb.reads == []


def test_the_cache_is_its_own_two_year_singleton_on_layer_ones_ttl() -> None:
    """Its own singleton, not a read inside aid_inputs_cache (whose two slots are layer 1's two years), holding the
    season and the year before, on layer 1's TTL by reference."""
    assert isinstance(development_history_cache, LodgingYearCache)
    assert development_history_cache is not aid_inputs_cache
    assert development_history_cache._max_size == 2
    assert development_history_cache.ttl_seconds == aid_inputs_cache.ttl_seconds
    assert DEVELOPMENT_HISTORY_TABLES == ("attendees", "persons", "camp_sessions")


# --- what clears it -----------------------------------------------------------------------------------------------


@pytest.mark.parametrize("sync_type", ["attendees", "persons", "sessions", None])
@pytest.mark.asyncio
async def test_a_sync_writing_one_of_its_tables_clears_it(sync_type: str | None) -> None:
    from api.routers.metrics import invalidate_server_caches

    await DevelopmentRepository(history_pb()).earlier_attendance(REPORT_YEAR, [EMMA], [])
    assert development_history_cache.get("past_enrolled", REPORT_YEAR) is not None
    with patch("api.routers.metrics.schedule_lodging_warm"), patch("api.routers.metrics.schedule_aid_warm"):
        invalidate_server_caches(sync_type)
    assert development_history_cache.get("past_enrolled", REPORT_YEAR) is None


@pytest.mark.parametrize("sync_type", ["bunk_assignments", "aid_postings", "person_custom_values"])
@pytest.mark.asyncio
async def test_a_sync_writing_none_of_its_tables_leaves_it_alone(sync_type: str) -> None:
    from api.routers.metrics import invalidate_server_caches

    await DevelopmentRepository(history_pb()).earlier_attendance(REPORT_YEAR, [EMMA], [])
    filled = development_history_cache.get("past_enrolled", REPORT_YEAR)
    assert filled is not None
    with patch("api.routers.metrics.schedule_lodging_warm"), patch("api.routers.metrics.schedule_aid_warm"):
        invalidate_server_caches(sync_type)
    assert development_history_cache.get("past_enrolled", REPORT_YEAR) is filled


# --- before -> after: one Development open and its ZIP export -------------------------------------------------------

CAMPERS = 200  # summer campers this season, in HOUSEHOLDS households
HOUSEHOLDS = 150
FAMILY_HOUSEHOLDS = 150  # households at a family weekend this season
NOW = datetime(2027, 4, 1, 17, 0, tzinfo=UTC)


def _rid(prefix: str, n: int) -> str:
    return f"{prefix}{n:0{15 - len(prefix)}d}"


def _season_pb() -> FilteringPb:
    """The 2027 season (200 summer campers in 150 households, 150 family-weekend households), each camper and family
    with registrations in earlier seasons, plus the tables the report's other reads page."""
    session_rows = {
        (year, cm_id): Row(
            _rid(f"s{cm_id % 1000}", year),
            {"cm_id": cm_id, "year": year, "session_type": kind, "start_date": f"{year}-06-20 00:00:00.000Z"},
        )
        for year in range(2015, 2028)
        for cm_id, kind in ((1000101, "main"), (1000202, "family"))
    }
    persons: list[Row] = []
    households: list[Row] = []
    attendees: list[Row] = []

    def person(cm_id: int, year: int, household: int) -> Row:
        row = Row(
            _rid(f"p{year % 100}", cm_id % 10_000_000),
            {"cm_id": cm_id, "year": year, "household_id": household},
            dict.fromkeys(("household", "primary_childhood_household", "alternate_childhood_household")),
        )
        persons.append(row)
        return row

    def went(cm_id: int, year: int, household: int, session: int) -> None:
        attendees.append(
            Row(
                _rid("a", len(attendees)),
                {
                    "person_id": cm_id,
                    "year": year,
                    "status_id": 2,
                    "enrollment_date": "",
                    "effective_date": f"{year - 1}-11-20 08:00:00.000Z",
                },
                {"person": person(cm_id, year, household), "session": session_rows[(year, session)]},
            )
        )

    # Emma (returning: summer 2019) and Liam (first-time) are the season's aid recipients (report_season), so the
    # first-time lines count someone; the other 198 campers fill 148 more households.
    campers = [(1000011, 1000001), (1000021, 1000002)] + [
        (3_000_000 + n, 2_000_000 + n % (HOUSEHOLDS - 2)) for n in range(CAMPERS - 2)
    ]
    went(1000011, 2019, 1000001, 1000101)
    for n, (camper, household) in enumerate(campers):
        went(camper, 2027, household, 1000101)
        if n > 1 and n % 3:
            went(camper, 2015 + n % 12, household, 1000101)  # some inside the window, some before it
    for n in range(FAMILY_HOUSEHOLDS):
        household = 2_100_000 + n
        went(3_100_000 + n, 2027, household, 1000202)
        if n % 2:
            went(3_100_000 + n, 2018 + n % 9, household, 1000202)
    for n, household in enumerate(sorted({h for _, h in campers})):
        households.append(
            Row(_rid("hh", n), {"cm_id": household, "year": 2027, "billing_postal_code": f"9{n % 7:04d}"})
        )
    return FilteringPb({"attendees": attendees, "persons": persons, "households": households})


def _service(pb: FilteringPb) -> FinancialAidDevelopmentService:
    async def rows(year: int) -> Sequence[RegisterRow]:
        return []

    return FinancialAidDevelopmentService(
        report_season(),
        FakeRules(approved(intake_rules())),
        rows,
        DevelopmentRepository(pb),
        FakeReportsStore(),
        clock=lambda: NOW,
    )


@pytest.mark.asyncio
async def test_a_development_open_and_its_zip_export_read_the_history_once() -> None:
    """Before: each _native column chunked 200 campers (4 filters) and 150 family households (3 filters, through
    person.household_id): 7 history reads for Development, 7 more for the ZIP export. After: one per past season,
    shared."""
    pb = _season_pb()
    service = _service(pb)
    asked: list[tuple[int, int]] = []
    real = DevelopmentRepository.earlier_attendance

    async def spy(self: DevelopmentRepository, year: int, people: Any, households: Any) -> list[AttendanceRecord]:
        asked.append((len(set(people)), len(set(households))))
        return await real(self, year, people, households)

    with patch.object(DevelopmentRepository, "earlier_attendance", spy):
        await service.development(REPORT_YEAR)
        await service.zip_codes(REPORT_YEAR)
    # Both go through earlier_attendance for the same report year, with the season's campers and family households.
    assert asked == [(CAMPERS, FAMILY_HOUSEHOLDS), (CAMPERS, FAMILY_HOUSEHOLDS)]
    assert _history_reads(pb) == [f"year = {season} && status_id = 2" for season in SEASONS]
