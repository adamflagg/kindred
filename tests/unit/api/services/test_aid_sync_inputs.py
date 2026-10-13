"""Layer 1 of the Camperships cache (api/services/aid_sync_inputs.py): the season's sync-written inputs, read whole
once per year and joined in Python.

These pin the read pattern (one paged read per table, never a filter through a relation), the cache's lifetime
(within the TTL nothing is re-read, concurrent callers share one fill, years never mix), what clears it (a sync that
writes one of its tables), and the classification it rests on (no staff write targets one of its tables). What the
repository methods built on it RETURN is pinned separately, unchanged, in test_aid_sync_inputs_parity.py."""

from __future__ import annotations

import ast
import asyncio
import threading
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import api.constants.collections as collections
from api.dependencies import aid_inputs_cache
from api.services import aid_sync_inputs as layer1
from api.services import financial_aid_rules_service as rules_service
from api.services.aid_sync_inputs import AID_SYNC_INPUT_TABLES, AidSyncInputs, aid_sync_inputs, schedule_aid_warm
from api.services.financial_aid_intake_repository import ADULT_POC_FIELD_CM_ID, CAMPER_POC_FIELD_CM_ID
from tests.unit.api.services.aid_parity_fixture import (
    FA_ID,
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
FILLED = (
    "persons",
    "households",
    "attendees",
    "person_custom_values",
    "custom_field_defs",
    "financial_aid_applications",
)


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


@pytest.mark.asyncio
async def test_a_cancelled_first_caller_does_not_cancel_the_shared_fill() -> None:
    """A browser disconnect cancels its request; the fill other callers (and the season build) wait on must go on."""
    release = threading.Event()

    class _Gated(RecordingPb):
        def collection(self, name: str) -> Any:
            inner = super().collection(name)
            read = inner.get_full_list

            def gated(batch: int = 500, query_params: dict[str, Any] | None = None) -> list[Any]:
                release.wait(timeout=10)
                return read(batch=batch, query_params=query_params)

            inner.get_full_list = gated  # type: ignore[method-assign]
            return inner

    gated_pb = _Gated(tables=_recording_pb().tables)
    first = asyncio.create_task(aid_sync_inputs(gated_pb, YEAR))
    await asyncio.sleep(0.05)
    second = asyncio.create_task(aid_sync_inputs(gated_pb, YEAR))
    await asyncio.sleep(0.05)
    first.cancel()
    await asyncio.sleep(0.05)
    release.set()
    inputs = await asyncio.wait_for(second, timeout=10)
    assert isinstance(inputs, AidSyncInputs)
    assert {c: gated_pb.count(c) for c in FILLED} == dict.fromkeys(FILLED, 1)


def test_the_cache_is_the_configured_singleton() -> None:
    """A thirty-minute TTL, and room for two seasons: the current one and the `year - 1` a report reads. One year
    measured 26-30 MB on the 2026-10-07 prod snapshot, on a 1.9 GiB box whose API container is capped at 1 GiB."""
    assert aid_inputs_cache.ttl_seconds == 1800
    assert aid_inputs_cache._max_size == 2


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
async def test_an_empty_equity_allowlist_is_refused_before_anything_is_read(monkeypatch: pytest.MonkeyPatch) -> None:
    """With no allowlisted field, the person_custom_values filter would match every field: every camper's every custom
    answer, read and cached. Refused before the first read instead."""
    from api.services import financial_aid_intake_repository as intake

    monkeypatch.setattr(intake, "EQUITY_FIELD_CM_IDS", ())
    pb = _recording_pb()
    with pytest.raises(ValueError, match="empty person custom-value allowlist"):
        await aid_sync_inputs(pb, YEAR)
    assert pb.count("person_custom_values") == 0
    assert pb.calls == []


@pytest.mark.asyncio
async def test_equity_values_are_only_the_allowlisted_fields() -> None:
    inputs = await aid_sync_inputs(parity_pb(), PARITY_YEAR)
    held = {p: sorted(str(v.value) for v in values) for p, values in inputs.equity_values_by_person_cm_id.items()}
    assert held == {P1: ["No", "Yes"], P2: ["yes"], P4: ["maybe"]}  # P3's only value is on an unrelated field


@pytest.mark.asyncio
async def test_the_fa_mirror_is_held_whole_for_the_season_in_id_order() -> None:
    """Every row of the season, applicant or not, asking or not: the four readers filter in Python."""
    inputs = await aid_sync_inputs(parity_pb(), PARITY_YEAR)
    assert [r.id for r in inputs.fa_applications] == [
        FA_ID[k] for k in ("f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8")
    ]
    assert isinstance(inputs.fa_applications, tuple)


@pytest.mark.asyncio
async def test_the_fa_mirror_rows_leave_the_contact_details_on_the_server() -> None:
    """The mirror also holds addresses, phone numbers and emails no reader needs; the fill never asks for them, and
    holds of the household only its cm_id."""
    inputs = await aid_sync_inputs(parity_pb(), PARITY_YEAR)
    for row in inputs.fa_applications:
        assert not {"contact_email", "contact_phone", "contact_address"} & set(vars(row)), row.id
        for related in row.expand.values():
            assert set(vars(related)) == {"cm_id"}


def test_the_fa_projection_is_exactly_what_its_four_readers_read() -> None:
    """A superset of each reader's columns (a column left out reads blank, silently) and nothing wider."""
    from api.services.financial_aid_grants_repository import GRANT_ANSWER_FIELDS
    from api.services.financial_aid_intake_repository import FA_CONTACT_FIELDS, FA_READ_FIELDS
    from api.services.financial_aid_repository import FA_REQUEST_FIELDS

    readers = {
        "fetch_fa_rows": {*FA_READ_FIELDS.split(","), "is_applicant"},  # is_applicant: its filter, now in Python
        "read_fa_contacts": set(FA_CONTACT_FIELDS.split(",")),
        "fetch_fa_requests": set(FA_REQUEST_FIELDS.split(",")),
        "fetch_grant_answers": set(GRANT_ANSWER_FIELDS.split(",")),
    }
    columns = set(layer1.fa_application_fields().split(","))
    for reader, needed in readers.items():
        assert needed <= columns, (reader, sorted(needed - columns))
    assert columns == set().union(*readers.values())
    assert not [c for c in columns if c.startswith("contact_") and c not in ("contact_first_name", "contact_last_name")]
    assert not [c for c in columns if c.startswith("expand.") and c != "expand.household.cm_id"]


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
async def test_the_fa_mirror_sync_clears_it() -> None:
    from api.routers.metrics import invalidate_server_caches

    await aid_sync_inputs(_recording_pb(), YEAR)
    with (
        patch("api.routers.metrics.schedule_lodging_warm"),
        patch("api.routers.metrics.schedule_aid_warm"),
    ):
        invalidate_server_caches("financial_aid_applications")
    assert aid_inputs_cache.get("load", YEAR) is None


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
    # Every sync clears the priced season (layer 2), so a warm follows to rebuild it; layer 1 stays filled, so that
    # warm re-reads none of its tables.
    warm.assert_called_once()


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
async def test_the_refresher_warms_at_once_then_clears_and_rewarms_every_ttl() -> None:
    """A TTL expiry is a clear like any other, so the configured season rebuilds in the background after it too."""
    warmed: list[int] = []
    cleared_before_rewarm: list[bool] = []

    async def fake_warm(year: int) -> None:
        cleared_before_rewarm.append(aid_inputs_cache.get("load", year) is None)
        warmed.append(year)
        aid_inputs_cache.set("load", year, object())

    async def fake_year() -> int:
        return YEAR

    task = asyncio.create_task(layer1.refresh_aid_inputs_forever(interval=0.01, warm=fake_warm, year=fake_year))
    for _ in range(200):
        await asyncio.sleep(0.005)
        if len(warmed) >= 3:
            break
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert warmed[:3] == [YEAR, YEAR, YEAR]
    assert all(cleared_before_rewarm[:3])  # each re-warm starts from a cleared cache


@pytest.mark.asyncio
async def test_the_refresher_outlives_a_failed_pass() -> None:
    passes = 0

    async def failing_year() -> int:
        nonlocal passes
        passes += 1
        raise RuntimeError("no season")

    task = asyncio.create_task(layer1.refresh_aid_inputs_forever(interval=0.01, year=failing_year))
    for _ in range(200):
        await asyncio.sleep(0.005)
        if passes >= 2:
            break
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert passes >= 2


@pytest.mark.asyncio
async def test_a_pending_warm_is_cancelled_on_request(monkeypatch: pytest.MonkeyPatch) -> None:
    async def never_done() -> None:
        await asyncio.Event().wait()

    monkeypatch.setattr(layer1, "_warm_current_season", never_done)
    schedule_aid_warm()
    task = layer1._warm_task
    assert task is not None
    await asyncio.sleep(0)
    layer1.cancel_aid_warm()
    with pytest.raises(asyncio.CancelledError):
        await task
    layer1.cancel_aid_warm()  # nothing pending: a no-op


@pytest.mark.asyncio
async def test_startup_starts_the_refresher_and_shutdown_stops_it_and_any_warm() -> None:
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
        patch.object(main, "start_lodging_cache_refresher", MagicMock(return_value=None)),
        patch.object(main, "start_aid_inputs_refresher", side_effect=fake_start),
        patch.object(main, "cancel_aid_warm") as cancel_warm,
    ):
        async with main.lifespan(MagicMock()):
            assert len(started) == 1
            assert not started[0].done(), "the warm must run in the background, not block startup"
        await asyncio.sleep(0)
    assert started[0].cancelled()
    cancel_warm.assert_called_once()


# --- shared state ---------------------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_shared_lookups_are_read_only() -> None:
    inputs = await aid_sync_inputs(parity_pb(), PARITY_YEAR)
    for lookup in (
        inputs.person_by_cm_id,
        inputs.household_by_cm_id,
        inputs.persons_by_household_id,
        inputs.members_by_household,
        inputs.attendees_by_person_cm_id,
        inputs.equity_values_by_person_cm_id,
    ):
        with pytest.raises(TypeError):
            lookup[0] = ()  # type: ignore[index]
    assert all(isinstance(v, tuple) for v in inputs.members_by_household.values())


@pytest.mark.asyncio
async def test_the_cache_is_keyed_on_the_year_as_an_int() -> None:
    pb = _recording_pb()
    await aid_sync_inputs(pb, 2026.0)  # type: ignore[arg-type]  # a year that arrives as a float is the same season
    pb.reset()
    await aid_sync_inputs(pb, YEAR)
    assert pb.calls == []


@pytest.mark.asyncio
async def test_every_expand_the_fill_asks_for_is_projected_to_named_columns() -> None:
    """No whole related record sits in layer 1: each expanded relation names the columns its readers use."""
    pb = parity_pb()
    await aid_sync_inputs(pb, PARITY_YEAR)
    for collection, params in pb.calls:
        fields = str(params.get("fields", "")).split(",")
        for relation in (r for r in str(params.get("expand", "")).split(",") if r):
            assert any(f.startswith(f"expand.{relation}.") for f in fields), (collection, relation, fields)


def test_the_fixture_reads_a_star_as_every_column_with_expands_projected() -> None:
    pb = parity_pb()
    rows = pb.collection("persons").get_full_list(
        query_params={"filter": f"year = {PARITY_YEAR}", "expand": "household", "fields": "*,expand.household.cm_id"}
    )
    p1 = next(r for r in rows if r.cm_id == P1)
    assert (p1.first_name, p1.birthdate) == ("Emma", "2012-04-09")
    assert vars(p1.expand["household"]) == {"cm_id": H1}


# --- the classification it rests on ------------------------------------------------------------------------------


def _aid_write_targets() -> set[str]:
    """Every collection an AidWrite names as a Name or a constant, in the Camperships services."""
    services = ROOT / "api" / "services"
    targets: set[str] = set()
    for path in sorted(services.glob("financial_aid_*.py")):
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
        "financial_aid_applications",
    )
