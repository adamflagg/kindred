"""The season a staff read gets through both caches equals the season built from scratch, field for field: the
proof that caching the Camperships season moves no number on any screen.

Both builds read one fixture season (aid_season_fixture.season_pb) through the real repositories and the real
grants register, over a PocketBase double that evaluates every filter they send and refuses any it can't. The
reference is the uncached build (no season cache, layer 1 cleared); against it go the cached build (layer 1 cold,
layer 2 new), the repeat read the season cache serves, and the rebuild after a staff write, which finds layer 1
warm. Both log their grant placements, as every staff read does.

If a comparison fails, a number on a screen would change: report it, never adjust this test or the fixture to
pass."""

from __future__ import annotations

import dataclasses
from collections.abc import Mapping, Set
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import pytest
from pydantic import BaseModel

import api.dependencies
from api.dependencies import aid_inputs_cache
from api.services.aid_season_cache import AidSeasonCache, on_aid_commit
from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService, Names, Season
from api.services.financial_aid_grants_repository import GrantsRepository
from api.services.financial_aid_grants_service import GrantsService
from bunking.financial_aid.change_log import AidWrite
from tests.unit.api.services.aid_season_fixture import (
    CHEN,
    EMMA,
    FAMILY_CAMP_SESSION,
    GARCIA,
    JOHNSON,
    LIAM,
    OKAFOR,
    PRIOR_SEASON,
    REQ_EMMA,
    REQ_LIAM,
    REQ_NOAH,
    REQ_OLIVIA,
    REQ_PRIOR,
    REQ_SAM,
    SEASON_YEAR,
    T_CHEN_CAMP,
    T_EMMA_GRANT,
    T_GARCIA_CAMP,
    T_OKAFOR_GRANT,
    T_PRIOR,
    SeasonPb,
    committing,
    season_pb,
)
from tests.unit.api.services.decisions_fakes import FakeRules, approved

YEAR = SEASON_YEAR
# Priced "now": one fixed camp-time day, so the season cache's (year, day) key and every as-of figure hold still.
NOW = datetime(2027, 5, 1, 17, 0, tzinfo=UTC)
# Layer 1's reads (aid_sync_inputs): a rebuild over a warm layer 1 makes none of them.
LAYER_ONE: frozenset[str] = frozenset(
    {"persons", "households", "attendees", "person_custom_values", "custom_field_defs"}
)


def _service(pb: SeasonPb, cache: AidSeasonCache | None) -> FinancialAidDecisionsService:
    """The real service over the real repositories, as a staff read builds it (log_placements on). The rules are
    FakeRules: they are not one of the cached reads. The placement log's batch write is applied to the double."""
    store = FinancialAidDecisionsRepository(pb)
    store.commit = committing(pb)  # type: ignore[method-assign, assignment]
    return FinancialAidDecisionsService(
        store,
        FakeRules(approved()),
        GrantsService(GrantsRepository(pb)).register_rows,
        clock=lambda: NOW,
        season_cache=cache,
    )


def first_difference(cached: Any, uncached: Any, path: str = "") -> str | None:
    """The first path at which two values differ, with both values, or None when they are equal. Walks dataclasses,
    pydantic models, mappings (by key), sequences (by index) and sets."""
    if cached == uncached and type(cached) is type(uncached):
        return None

    def said(where: str, a: Any, b: Any) -> str:
        return f"{where or '<root>'}: cached={a!r} uncached={b!r}"

    if type(cached) is not type(uncached) and not (isinstance(cached, Mapping) and isinstance(uncached, Mapping)):
        if cached == uncached:  # equal values of different types (a tuple and a list) still read the same
            return None
        return said(path, cached, uncached)
    if dataclasses.is_dataclass(cached) and not isinstance(cached, type):
        for f in dataclasses.fields(cached):
            found = first_difference(getattr(cached, f.name), getattr(uncached, f.name), f"{path}.{f.name}")
            if found is not None:
                return found
    elif isinstance(cached, BaseModel):
        for name in type(cached).model_fields:
            found = first_difference(getattr(cached, name), getattr(uncached, name), f"{path}.{name}")
            if found is not None:
                return found
    elif isinstance(cached, Mapping):
        for key in sorted(set(cached) ^ set(uncached), key=repr):
            return said(f"{path}[{key!r}]", cached.get(key, "<absent>"), uncached.get(key, "<absent>"))
        for key in cached:
            found = first_difference(cached[key], uncached[key], f"{path}[{key!r}]")
            if found is not None:
                return found
    elif isinstance(cached, (list, tuple)):
        for i, (a, b) in enumerate(zip(cached, uncached, strict=False)):
            found = first_difference(a, b, f"{path}[{i}]")
            if found is not None:
                return found
        if len(cached) != len(uncached):
            return said(f"{path} length", len(cached), len(uncached))
    elif isinstance(cached, Set):
        return said(path, sorted(cached - uncached, key=repr), sorted(uncached - cached, key=repr))
    return said(path, cached, uncached)


def assert_same(cached: tuple[Season, Names], uncached: tuple[Season, Names], what: str) -> None:
    for label, a, b in (("Season", cached[0], uncached[0]), ("Names", cached[1], uncached[1])):
        diff = first_difference(a, b, label)
        assert diff is None, f"{what}: {diff}"
        assert a == b, f"{what}: {label} differs, but no field does"


@pytest.fixture
def builds(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """Counts season builds: one entry per _build_season call, whichever service instance makes it."""
    calls: list[int] = []
    real = FinancialAidDecisionsService._build_season

    async def counted(self: FinancialAidDecisionsService, year: int, *, names: bool) -> tuple[Season, Names]:
        calls.append(int(year))
        return await real(self, year, names=names)

    monkeypatch.setattr(FinancialAidDecisionsService, "_build_season", counted)
    return calls


async def _reference() -> tuple[tuple[Season, Names], SeasonPb]:
    """(a) The uncached build: no season cache, over a cold layer 1."""
    aid_inputs_cache.invalidate_all()
    pb = season_pb()
    built = await _service(pb, None).named_season(YEAR)
    assert pb.refused == [], pb.refused
    return built, pb


# --- the fixture fails loudly ---------------------------------------------------------------------------------------


def test_the_fixture_refuses_a_filter_shape_it_does_not_know() -> None:
    pb = season_pb()
    with pytest.raises(NotImplementedError):
        pb.collection("aid_requests").get_full_list(query_params={"filter": "household_cm_id = 6000101"})
    with pytest.raises(NotImplementedError):
        pb.collection("aid_postings").get_full_list(query_params={"filter": "year = 2027", "sort": "amount"})
    with pytest.raises(NotImplementedError):
        pb.collection("aid_decisions").get_full_list(query_params={"filter": "year = 2027", "fields": "id,nope"})
    with pytest.raises(NotImplementedError):
        pb.collection("aid_rules").get_full_list()
    with pytest.raises(NotImplementedError):  # FilteringPb's own refusal, still in force for the sync tables
        pb.collection("persons").get_full_list(query_params={"filter": "year > 2026"})
    assert len(pb.refused) == 5


def test_the_fixture_serves_the_season_shapes_it_adds() -> None:
    pb = season_pb()
    camp = pb.collection("aid_postings").get_full_list(
        query_params={
            "filter": f"year = {YEAR} && funder_type = 'camp'",
            "sort": "transaction_cm_id,id",
            "fields": "transaction_cm_id,amount",
        }
    )
    assert [r.transaction_cm_id for r in camp] == [8000001, T_CHEN_CAMP, T_GARCIA_CAMP]
    assert not hasattr(camp[0], "funder_type")  # projected to the fields asked for
    runs = pb.collection("sync_runs").get_list(
        1,
        100,
        query_params={
            "filter": f'service = "aid_postings" && status = "success" && year >= {YEAR - 1} && year <= {YEAR + 1}',
            "sort": "-started,-id",
            "fields": "started,trigger,year",
        },
    )
    assert [r.started for r in runs.items] == ["2027-04-20 03:00:00.000Z"]
    answers = pb.collection("financial_aid_applications").get_full_list(
        query_params={
            "filter": f"year = {YEAR} && (one_happy_camper ~ 'yes' || synagogue_grant ~ 'yes')",
            "expand": "household",
            "fields": "person_id,one_happy_camper,expand.household.cm_id",
        }
    )
    assert [(r.person_id, r.expand["household"].cm_id) for r in answers] == [(EMMA, JOHNSON)]


# --- the diff helper reads -------------------------------------------------------------------------------------------


def test_the_diff_names_the_first_differing_field() -> None:
    @dataclasses.dataclass(frozen=True)
    class Inner:
        amount: Decimal

    @dataclasses.dataclass(frozen=True)
    class Outer:
        rows: Mapping[str, tuple[Inner, ...]]

    a = Outer({"r1": (Inner(Decimal(1)), Inner(Decimal(2)))})
    b = Outer({"r1": (Inner(Decimal(1)), Inner(Decimal(3)))})
    assert first_difference(a, b, "x") == "x.rows['r1'][1].amount: cached=Decimal('2') uncached=Decimal('3')"
    assert first_difference(a, a) is None


# --- the season is not empty ------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_reference_season_holds_every_route_a_number_takes() -> None:
    """Non-vacuity: parity on an empty season would prove nothing."""
    (season, (families, campers)), pb = await _reference()
    priced_ok = {rid for rid, p in season.priced.items() if p.result is not None and p.result.status == "ok"}
    assert {REQ_EMMA, REQ_LIAM, REQ_SAM} <= priced_ok
    assert all(season.priced[r].result.r1 is not None for r in priced_ok)  # type: ignore[union-attr]
    # A posted round, accepted (Emma), and one posted then un-posted (Noah).
    emma = season.priced[REQ_EMMA].view(1)
    assert emma is not None
    assert (emma.status, emma.accepted) == ("posted", True)
    assert season.rounds[REQ_EMMA][1].locked_amount == Decimal(1500)
    assert (REQ_NOAH, 1) in season.undone
    # A hold: Liam's manual hold, priced as one.
    assert season.holds[REQ_LIAM].manual is not None
    assert "manual_hold" in {h.code for h in season.priced[REQ_LIAM].holds}
    # Cancellations: CampMinder's (Olivia, with Kindred's reason) and Kindred's own (Noah).
    assert (season.cancellations[REQ_OLIVIA].by, season.cancellations[REQ_OLIVIA].reason) == ("campminder", "medical")
    assert season.cancellations[REQ_NOAH].by == "kindred"
    assert {REQ_OLIVIA, REQ_NOAH} <= set(season.live_tiers) & set(season.cost_only)
    # The clawback: Olivia's posted Round 1, its camp-aid line reversed by CampMinder.
    assert season.reversed_on[REQ_OLIVIA] == date(2027, 4, 15)
    olivia = season.priced[REQ_OLIVIA].view(1)
    assert olivia is not None
    assert olivia.clawed_back
    assert [line.is_reversed for line in season.ledger.lines(REQ_OLIVIA)] == [True]
    # The camp-aid ledger: a line an attribution override placed (Garcia's household line, on Liam).
    assert season.placements[T_GARCIA_CAMP].person_cm_id == LIAM
    assert [line.transaction_cm_id for line in season.ledger.lines(REQ_LIAM)] == [T_GARCIA_CAMP]
    assert season.ledger.synced_at is not None
    # Outside grants (grantor, source, placement): Emma's line on her request, Okafor's grant-only line, Noah's
    # commitment; the register's placements logged.
    register = {(r.kind, r.transaction_cm_id, r.household_cm_id): r for r in season.register}
    assert [s.request_id for s in register[("ledger", T_EMMA_GRANT, JOHNSON)].requests] == [REQ_EMMA]
    # A person in two households: Samuel (own household Johnson, childhood household Okafor) is Okafor's second
    # camper, so Okafor's grant line, from a family that never applied, has no sole camper to tie to.
    assert register[("ledger", T_OKAFOR_GRANT, OKAFOR)].camper_basis == "none"
    assert any(r.kind == "commitment" and r.requests[0].request_id == REQ_NOAH for r in season.register)
    assert len(pb.written) == len(season.register)
    # Payer shares across two households: Liam's, half paid by his childhood household (Johnson).
    assert {s.household_cm_id for s in season.shares[REQ_LIAM]} == {GARCIA, JOHNSON}
    # The Family Camp household-level request, priced with its cost override.
    sam = season.requests[REQ_SAM]
    assert (sam.person_cm_id, sam.program_key, sam.session_cm_id) == (0, "family_camp", FAMILY_CAMP_SESSION)
    assert season.cost_overrides[REQ_SAM].new_value == "discount:1000.00"
    # Corrections (Johnson's income) reach pricing: the corrected figure, not the application's.
    assert season.inputs[REQ_EMMA].application.prior_year_gross == Decimal(58000)  # 60,000 applied
    # Names, and year scoping: no prior-season row anywhere.
    assert (families[CHEN], campers[LIAM]) == ("Chen Household", "Lee Garcia")
    assert families[JOHNSON] == "Mr. and Mrs. Johnson"  # not the 2026 household's title
    assert REQ_PRIOR not in season.requests
    assert T_PRIOR not in {line.transaction_cm_id for line in season.camp_lines}
    assert all(r.year == YEAR for r in season.requests.values())
    assert PRIOR_SEASON not in {e.year for e in pb.tables["aid_grant_placements"][1:]}


# --- parity ---------------------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_cached_season_equals_the_season_built_from_scratch(
    builds: list[int], monkeypatch: pytest.MonkeyPatch
) -> None:
    uncached, reference_pb = await _reference()
    assert builds == [YEAR]
    # The uncached unnamed read prices the same season (names=False builds without the names).
    assert await _service(reference_pb, None).season(YEAR) == uncached[0]

    # (b) Through both layers: a new season cache, over a cold layer 1.
    aid_inputs_cache.invalidate_all()
    cache = AidSeasonCache()
    pb = season_pb()
    builds.clear()
    cached = await _service(pb, cache).named_season(YEAR)
    assert builds == [YEAR]
    assert pb.refused == [], pb.refused
    assert_same(cached, uncached, "cold cached build")

    # The repeat read is the cache's: no build, no read, the very season named_season returned.
    pb.calls.clear()
    repeat = await _service(pb, cache).season(YEAR)
    assert builds == [YEAR]
    assert pb.calls == []
    assert repeat is cached[0]
    assert_same((repeat, cached[1]), uncached, "cache-served season()")

    # A staff write clears the year (the real commit listener, on the process cache this test stands in for), and
    # the rebuild finds layer 1 warm: it reads none of layer 1's tables.
    monkeypatch.setattr(api.dependencies, "aid_season_cache", cache)
    on_aid_commit(
        [
            AidWrite(
                collection="aid_requests",
                action="update",
                year=YEAR,
                record_id=REQ_EMMA,
                before={"ask": 4000.0},
                data={"ask": 4000.0},
            )
        ],
        "registrar@example.com",
    )
    assert aid_inputs_cache.get("load", YEAR) is not None
    pb.calls.clear()
    rebuilt = await _service(pb, cache).named_season(YEAR)
    assert builds == [YEAR, YEAR]
    assert not [c for c, _ in pb.calls if c in LAYER_ONE], pb.calls
    assert pb.refused == [], pb.refused
    assert_same(rebuilt, uncached, "rebuild over a warm layer 1")
    assert (await _service(pb, cache).season(YEAR)) is rebuilt[0]
