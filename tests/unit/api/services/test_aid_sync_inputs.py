"""Layer 1 of the Camperships cache (api/services/aid_sync_inputs.py): the season's sync-written inputs, read whole
once per year and joined in Python.

These pin the read pattern (one paged read per table, never a filter through a relation), the cache's lifetime
(within the TTL nothing is re-read, concurrent callers share one fill, years never mix), what clears it (a sync that
writes one of its tables), and the classification it rests on (no staff write targets one of its tables). What the
repository methods built on it RETURN is pinned separately, unchanged, in test_aid_sync_inputs_parity.py."""

from __future__ import annotations

import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import api.constants.collections as collections
from api.dependencies import aid_inputs_cache
from api.services import aid_sync_inputs as layer1
from api.services import financial_aid_rules_service as rules_service
from api.services.aid_sync_inputs import AID_SYNC_INPUT_TABLES, AidSyncInputs, aid_sync_inputs, schedule_aid_warm
from api.services.financial_aid_intake_repository import ADULT_POC_FIELD_CM_ID, CAMPER_POC_FIELD_CM_ID
from tests.unit.api.services.aid_parity_fixture import (
    H1,
    H2,
    H4,
    H5,
    H6,
    P1,
    P2,
    P3,
    P4,
    P6_CM,
    PARITY_YEAR,
    PERSON_ID,
    PERSON_PRIOR_ID,
    PRIOR_YEAR,
    parity_pb,
)
from tests.unit.api.services.pb_recording import RecordingPb
from tests.unit.api.services.test_aid_pb_budget import _RELATION_PATH

ROOT = Path(__file__).resolve().parents[4]
YEAR = 2026
FILLED = ("persons", "households", "attendees", "person_custom_values", "custom_field_defs")


def _recording_pb() -> RecordingPb:
    household = SimpleNamespace(id="hh0000000000001", cm_id=4000101, year=YEAR)
    person = SimpleNamespace(id="pp0000000000001", cm_id=1000001, year=YEAR, household_id=4000101, expand={})
    return RecordingPb(
        {
            "households": [household],
            "persons": [person],
            "attendees": [SimpleNamespace(id="at0000000000001", person_id=1000001, year=YEAR, status_id=2, expand={})],
            "custom_field_defs": [
                SimpleNamespace(id="fd0000000000001", cm_id=CAMPER_POC_FIELD_CM_ID),
                SimpleNamespace(id="fd0000000000002", cm_id=ADULT_POC_FIELD_CM_ID),
            ],
            "person_custom_values": [
                SimpleNamespace(id="pv0000000000001", year=YEAR, value="Yes", expand={"person": person})
            ],
        }
    )


# --- the read pattern -----------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_one_fill_reads_each_input_table_once() -> None:
    pb = _recording_pb()
    inputs = await aid_sync_inputs(pb, YEAR)
    assert isinstance(inputs, AidSyncInputs)
    assert inputs.year == YEAR
    assert {c: pb.count(c) for c in FILLED} == dict.fromkeys(FILLED, 1)
    assert len(pb.calls) == len(FILLED)  # sessions come in through the attendees' expand, never a read of their own


@pytest.mark.asyncio
async def test_no_filter_the_fill_sends_reaches_through_a_relation() -> None:
    pb = _recording_pb()
    await aid_sync_inputs(pb, YEAR)
    assert pb.calls
    assert [f for _, f in pb.calls if _RELATION_PATH.search(f)] == []


@pytest.mark.asyncio
async def test_a_second_call_within_the_ttl_reads_nothing() -> None:
    pb = _recording_pb()
    first = await aid_sync_inputs(pb, YEAR)
    pb.reset()
    second = await aid_sync_inputs(pb, YEAR)
    assert pb.calls == []
    assert second is first


@pytest.mark.asyncio
async def test_concurrent_callers_share_one_fill() -> None:
    pb = _recording_pb()
    results = await asyncio.gather(*(aid_sync_inputs(pb, YEAR) for _ in range(3)))
    assert pb.count("persons") == 1
    assert results[0] is results[1] is results[2]


def test_the_cache_is_the_configured_singleton() -> None:
    """A thirty-minute TTL, and room for four seasons (a report reads `year - 1` beside the current one)."""
    assert aid_inputs_cache.ttl_seconds == 1800
    assert aid_inputs_cache._max_size == 4


# --- the joins --------------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_years_are_separate_fills_and_never_mix() -> None:
    pb = parity_pb()
    current = await aid_sync_inputs(pb, PARITY_YEAR)
    prior = await aid_sync_inputs(pb, PRIOR_YEAR)
    assert sum(1 for c, _ in pb.calls if c == "persons") == 2
    # P6 (2025 only) shares P1's cm_id: each season holds its own record under that id.
    assert current.person_by_cm_id[P1].id == PERSON_ID[P1]
    assert prior.person_by_cm_id[P6_CM].id == PERSON_PRIOR_ID
    current_ids = {p.id for p in current.person_by_cm_id.values()}
    current_ids |= {p.id for people in current.members_by_household.values() for p in people}
    assert PERSON_PRIOR_ID not in current_ids
    assert {int(h.year) for h in current.household_by_cm_id.values()} == {PARITY_YEAR}
    assert {int(a.year) for rows in current.attendees_by_person_cm_id.values() for a in rows} == {PARITY_YEAR}


@pytest.mark.asyncio
async def test_membership_maps_hold_the_own_household_rule_and_the_four_way_rule() -> None:
    inputs = await aid_sync_inputs(parity_pb(), PARITY_YEAR)
    own = {h: [int(p.cm_id) for p in people] for h, people in inputs.persons_by_household_id.items()}
    assert own == {H1: [P1], H2: [P2], 4000103: [P3], H5: [P4]}
    four_way = {h: [int(p.cm_id) for p in people] for h, people in inputs.members_by_household.items()}
    # In PocketBase-id order: P2's id sorts before P1's.
    assert four_way == {H1: [P2, P1], H2: [P2], 4000103: [P3], H4: [P3], H5: [P4], H6: [P4]}


@pytest.mark.asyncio
async def test_attendees_hold_every_status_with_person_and_session_expanded() -> None:
    inputs = await aid_sync_inputs(parity_pb(), PARITY_YEAR)
    rows = inputs.attendees_by_person_cm_id[P2]
    assert sorted(int(a.status_id) for a in rows) == [32, 256]
    assert all(set(a.expand) == {"person", "session"} for a in rows)
    assert sorted(int(a.status_id) for a in inputs.attendees_by_person_cm_id[P1]) == [2, 4]


@pytest.mark.asyncio
async def test_equity_values_are_only_the_allowlisted_fields() -> None:
    inputs = await aid_sync_inputs(parity_pb(), PARITY_YEAR)
    held = {p: sorted(str(v.value) for v in values) for p, values in inputs.equity_values_by_person_cm_id.items()}
    assert held == {P1: ["No", "Yes"], P2: ["yes"], P4: ["maybe"]}  # P3's only value is on an unrelated field


# --- what clears it ---------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_sync_writing_persons_clears_it_and_schedules_a_warm() -> None:
    from api.routers.metrics import invalidate_server_caches

    await aid_sync_inputs(_recording_pb(), YEAR)
    with (
        patch("api.routers.metrics.schedule_lodging_warm"),
        patch("api.routers.metrics.schedule_aid_warm") as warm,
    ):
        invalidate_server_caches("persons")
    assert aid_inputs_cache.get("load", YEAR) is None
    warm.assert_called_once()


@pytest.mark.asyncio
async def test_the_hourly_bunk_assignments_sync_leaves_it_alone() -> None:
    from api.routers.metrics import invalidate_server_caches

    filled = await aid_sync_inputs(_recording_pb(), YEAR)
    with (
        patch("api.routers.metrics.schedule_lodging_warm"),
        patch("api.routers.metrics.schedule_aid_warm") as warm,
    ):
        invalidate_server_caches("bunk_assignments")
    assert aid_inputs_cache.get("load", YEAR) is filled
    warm.assert_not_called()


# --- the warm -----------------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_burst_of_warms_runs_one_at_a_time_and_one_rerun(monkeypatch: pytest.MonkeyPatch) -> None:
    running = peak = runs = 0
    release = asyncio.Event()

    async def fake_warm() -> None:
        nonlocal running, peak, runs
        running += 1
        runs += 1
        peak = max(peak, running)
        await release.wait()
        running -= 1

    monkeypatch.setattr(layer1, "_warm_current_season", fake_warm)
    schedule_aid_warm()
    await asyncio.sleep(0)
    for _ in range(5):
        schedule_aid_warm()
    release.set()
    for _ in range(50):
        await asyncio.sleep(0)
    assert peak == 1
    assert runs == 2


@pytest.mark.asyncio
async def test_the_warm_fills_the_configured_season_and_never_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    pb = _recording_pb()
    monkeypatch.setattr(layer1, "default_pb", pb)
    monkeypatch.setattr(rules_service, "configured_season_year", AsyncMock(return_value=YEAR))
    await layer1._warm_current_season()
    assert aid_inputs_cache.get("load", YEAR) is not None

    monkeypatch.setattr(rules_service, "configured_season_year", AsyncMock(side_effect=RuntimeError("no season")))
    await layer1._warm_current_season()  # logged, not raised


@pytest.mark.asyncio
async def test_startup_warms_layer_one_in_the_background() -> None:
    from api import main

    settings = SimpleNamespace(skip_pb_auth=False, pocketbase_url="http://pb.invalid")
    with (
        patch.object(main, "get_settings", return_value=settings),
        patch.object(main, "authenticate_pb", AsyncMock()),
        patch.object(main, "start_pb_token_refresh", AsyncMock(return_value=None)),
        patch.object(main, "ConfigLoader", MagicMock()),
        patch.object(main, "close_connection", MagicMock()),
        patch.object(main, "start_lodging_cache_refresher", MagicMock(return_value=None)),
        patch.object(main, "schedule_aid_warm") as warm,
    ):
        async with main.lifespan(MagicMock()):
            warm.assert_called_once()


# --- the classification it rests on ------------------------------------------------------------------------------


def _aid_write_targets() -> set[str]:
    """Every collection an AidWrite names as a Name or a constant, in the Camperships services."""
    services = ROOT / "api" / "services"
    files = set(services.glob("financial_aid_*.py")) | set(services.glob("financial_aid_grants*.py"))
    targets: set[str] = set()
    for path in sorted(files):
        for node in ast.walk(ast.parse(path.read_text())):
            if not isinstance(node, ast.Call):
                continue
            name = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
            if name != "AidWrite":
                continue
            for keyword in node.keywords:
                if keyword.arg != "collection":
                    continue
                if isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, str):
                    targets.add(keyword.value.value)
                elif isinstance(keyword.value, ast.Name) and hasattr(collections, keyword.value.id):
                    targets.add(str(getattr(collections, keyword.value.id)))
    return targets


def test_no_layer_one_table_is_a_staff_write_target() -> None:
    """Layer 1 is cleared by syncs only, which is safe only while no Camperships write lands in one of its tables."""
    targets = _aid_write_targets()
    assert len(targets) > 10, "the scan found too few AidWrite targets to mean anything"
    assert targets.isdisjoint(AID_SYNC_INPUT_TABLES), sorted(targets & set(AID_SYNC_INPUT_TABLES))
    # commit_aid_writes refuses any collection not named aid_*, which covers a target passed through a variable.
    assert not [t for t in AID_SYNC_INPUT_TABLES if t.startswith("aid_")]


def test_the_layer_one_tables_are_the_sync_written_inputs() -> None:
    assert AID_SYNC_INPUT_TABLES == (
        "persons",
        "households",
        "attendees",
        "person_custom_values",
        "custom_field_defs",
        "camp_sessions",
    )
