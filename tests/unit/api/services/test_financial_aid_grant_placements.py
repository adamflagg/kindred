"""The grant placement log (campership 3c-2; owner rulings 2026-09-30 and 2026-10-01). Fictional only."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, date, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from api.services.financial_aid_decisions_repository import FinancialAidDecisionsRepository
from api.services.financial_aid_decisions_service import FinancialAidDecisionsService
from api.services.financial_aid_grant_placements import (
    PLACEMENT_ACTOR,
    PlacementRecord,
    grant_key,
    placement_json,
    placement_record,
    placement_writes,
    placements_as_of,
    register_row,
)
from api.services.financial_aid_grants_register import RegisterRow, RequestShare
from bunking.financial_aid.change_replay import LogRow
from tests.unit.api.services.decisions_fakes import T0, FakeDecisionsStore, FakeRules, approved, grant_row, seed_request
from tests.unit.api.services.financial_aid_fakes import YEAR

EMMA, LIAM = "reqemma00000001", "reqliam00000001"


def _logged(row: RegisterRow, created: datetime, *, event: str = "place") -> PlacementRecord:
    return PlacementRecord(
        id=f"gpl{int(created.timestamp()):012d}",
        grant=grant_key(row),
        household_cm_id=row.household_cm_id,
        event="place" if event == "place" else "remove",
        placement=placement_json(row) if event == "place" else None,
        created=created,
    )


def test_a_logged_placement_reads_back_as_the_register_row_it_recorded() -> None:
    row = replace(grant_row(EMMA, "500"), requests=(RequestShare(EMMA, grant_row(EMMA, "250").amount),) * 2)
    assert register_row(placement_json(row)) == row
    commitment = replace(row, kind="commitment", transaction_cm_id=0, commitment_id="grt000000000001", recorded_at=None)
    assert grant_key(commitment) == "commitment:grt000000000001"
    assert register_row(placement_json(commitment)) == commitment
    # Every field the register carries round-trips, a pays-after-camp-aid grant's flag (D143) included.
    after = replace(grant_row(EMMA, "300", pays_after_camp_aid=True), camper_basis="sole_camper")
    assert register_row(placement_json(after)) == after


def test_the_first_pricing_logs_every_grant_and_an_unchanged_one_writes_nothing() -> None:
    line = grant_row(EMMA, "500")
    (write,) = placement_writes(YEAR, [line], [])
    assert (write.collection, write.action, write.log_action, write.entity_id) == (
        "aid_grant_placements",
        "create",
        "place",
        "ledger:9001",
    )
    assert write.data is not None
    assert (write.data["event"], write.data["placement"], write.data["actor"]) == (
        "place",
        placement_json(line),
        PLACEMENT_ACTOR,
    )
    assert placement_writes(YEAR, [line], [_logged(line, T0)]) == []


def test_a_grant_that_moves_is_placed_again_and_one_that_leaves_the_register_is_removed_once() -> None:
    line = grant_row(EMMA, "500")
    moved = grant_row(LIAM, "500")
    (again,) = placement_writes(YEAR, [moved], [_logged(line, T0)])
    assert again.data is not None
    assert again.data["placement"]["requests"] == [{"request_id": LIAM, "amount": "500"}]
    (gone,) = placement_writes(YEAR, [], [_logged(line, T0)])
    assert gone.data is not None
    assert (gone.log_action, gone.entity_id, gone.data["placement"]) == ("remove", "ledger:9001", None)
    removed = [_logged(line, T0), _logged(line, T0.replace(hour=18), event="remove")]
    assert placement_writes(YEAR, [], removed) == []


def test_a_placement_row_parses_and_an_unknown_event_is_refused() -> None:
    line = grant_row(EMMA, "500")
    record = SimpleNamespace(
        id="gpl000000000001",
        grant="ledger:9001",
        household_cm_id=1000001,
        event="place",
        placement=placement_json(line),
        created="2027-03-09 17:00:00.000Z",
    )
    parsed = placement_record(record)
    assert (parsed.grant, parsed.event, parsed.created) == (
        "ledger:9001",
        "place",
        datetime(2027, 3, 9, 17, 0, tzinfo=UTC),
    )
    assert parsed.placement is not None
    assert register_row(parsed.placement) == line
    with pytest.raises(ValueError, match="unknown event"):
        placement_record(SimpleNamespace(**{**vars(record), "event": "move"}))


@pytest.mark.asyncio
async def test_the_placement_log_is_read_by_season_in_recorded_order() -> None:
    pb = MagicMock()
    pb.collection.return_value.get_full_list.return_value = []
    await FinancialAidDecisionsRepository(pb).fetch_grant_placements(YEAR)
    pb.collection.assert_called_with("aid_grant_placements")
    query = pb.collection.return_value.get_full_list.call_args.kwargs["query_params"]
    assert (query["filter"], query["sort"]) == (f"year = {YEAR}", "created,id")


def _service(store: FakeDecisionsStore, register: list[RegisterRow]) -> FinancialAidDecisionsService:
    async def rows(year: int) -> Sequence[RegisterRow]:
        return register

    return FinancialAidDecisionsService(store, FakeRules(approved()), rows, clock=lambda: T0)


@pytest.mark.asyncio
async def test_live_pricing_logs_where_each_grant_sits_and_logs_again_only_when_it_moves() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    register = [grant_row(EMMA, "500")]
    service = _service(store, register)
    await service.grid(YEAR)
    await service.budget(YEAR)
    (logged,) = store.grant_placements
    assert (logged.grant, logged.event) == ("ledger:9001", "place")
    assert [row["actor"] for row in store.log] == [PLACEMENT_ACTOR]
    register[0] = grant_row(LIAM, "500")
    await service.remaining(YEAR)
    assert [
        (p.grant, p.placement["requests"][0]["request_id"] if p.placement else None) for p in store.grant_placements
    ] == [
        ("ledger:9001", EMMA),
        ("ledger:9001", LIAM),
    ]


@pytest.mark.asyncio
async def test_a_placement_log_write_that_fails_fails_the_read() -> None:
    """Owner ruling 2026-10-01 (Group 4, Q2): strict. The log is pricing history, so a placement priced
    but not logged must not look logged: the read fails (a 500 through the global handler)."""
    store = FakeDecisionsStore()
    seed_request(store, EMMA)

    async def refused(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("the batch failed")

    store.commit = refused  # type: ignore[method-assign]
    with pytest.raises(RuntimeError, match="the batch failed"):
        await _service(store, [grant_row(EMMA, "500")]).remaining(YEAR)


# --- a past date replays the log (Task 3) ------------------------------------------------------------

MAR_1, MAR_9_END, MAR_20 = (
    datetime(2027, 3, 1, 18, 0, tzinfo=UTC),
    datetime(2027, 3, 10, 7, 59, tzinfo=UTC),
    datetime(2027, 3, 20, 18, 0, tzinfo=UTC),
)


def test_a_past_instant_replays_each_grants_newest_logged_placement_by_then() -> None:
    line = grant_row(EMMA, "500")
    moved = grant_row(LIAM, "500")
    log = [_logged(line, MAR_1), replace(_logged(moved, MAR_20), id="gpl000000000002")]
    placed = placements_as_of(log, [moved], [], MAR_9_END)
    assert [row.requests[0].request_id for row in placed.rows] == [EMMA]
    assert (placed.households, placed.people, placed.requests) == (frozenset(), frozenset(), frozenset())
    gone = [_logged(line, MAR_1), replace(_logged(line, MAR_1.replace(hour=19), event="remove"), id="gpl000000000003")]
    assert placements_as_of(gone, [], [], MAR_9_END).rows == ()


def test_a_grant_that_could_exist_by_then_with_no_logged_placement_is_unplaced() -> None:
    line = replace(grant_row(EMMA, "500"), recorded_at=MAR_1)
    later = replace(
        grant_row(LIAM, "300"),
        transaction_cm_id=9002,
        household_cm_id=1000002,
        person_cm_id=1000021,
        recorded_at=MAR_20,
    )
    withdrawn = LogRow(
        "log000000000001",
        "aid_grants",
        "grt000000000001",
        None,
        {"household_cm_id": 1000003, "person_cm_id": 1000031},
        MAR_1,
    )
    placed = placements_as_of([], [line, later], [withdrawn], MAR_9_END)
    assert (placed.households, placed.people, placed.requests) == (
        frozenset({1000001, 1000003}),
        frozenset({1000011, 1000031}),
        frozenset({EMMA}),
    )


def test_on_the_campminder_axis_a_line_is_read_on_its_own_campminder_dates() -> None:
    posted_later = replace(grant_row(EMMA, "500"), recorded_on="2027-03-12")
    assert (
        placements_as_of([_logged(posted_later, MAR_1)], [posted_later], [], MAR_9_END, posted_by=date(2027, 3, 9)).rows
        == ()
    )
    assert len(placements_as_of([_logged(posted_later, MAR_1)], [posted_later], [], MAR_9_END).rows) == 1
    live = grant_row(EMMA, "500")
    reversed_now = replace(live, is_reversed=True, reversal_date="2027-03-05", counts=False, requests=())
    (row,) = placements_as_of([_logged(live, MAR_1)], [reversed_now], [], MAR_9_END, posted_by=date(2027, 3, 9)).rows
    assert (row.counts, row.requests) == (False, ())
    (recorded,) = placements_as_of([_logged(live, MAR_1)], [reversed_now], [], MAR_9_END).rows
    assert recorded == live


# --- two register rows that share one key (aid_postings' grain is transaction, amount, year) ----------


def _twins() -> list[RegisterRow]:
    """Two ledger rows of one CampMinder transaction, so one log key, and a third grant of its own."""
    line = grant_row(EMMA, "500")
    other = replace(grant_row(LIAM, "300"), transaction_cm_id=9002, household_cm_id=1000002, person_cm_id=1000021)
    return [line, replace(line, amount=grant_row(EMMA, "250").amount), other]


def test_a_key_two_register_rows_share_is_never_logged_and_a_second_read_writes_nothing() -> None:
    rows = _twins()
    first = placement_writes(YEAR, rows, [])
    assert [w.entity_id for w in first] == ["ledger:9002"]
    assert placement_writes(YEAR, rows, [_logged(rows[2], MAR_1)]) == []


def test_a_key_two_register_rows_share_is_unplaced_even_where_the_log_placed_it() -> None:
    rows = _twins()
    log = [_logged(rows[0], MAR_1), replace(_logged(rows[2], MAR_1), id="gpl000000000002")]
    placed = placements_as_of(log, rows, [], MAR_9_END)
    assert [grant_key(row) for row in placed.rows] == ["ledger:9002"]
    assert (placed.households, placed.people, placed.requests) == (
        frozenset({1000001}),
        frozenset({1000011}),
        frozenset({EMMA}),
    )


@pytest.mark.asyncio
async def test_live_reads_with_a_shared_key_log_only_the_other_grants_and_then_nothing() -> None:
    store = FakeDecisionsStore()
    seed_request(store, EMMA)
    seed_request(store, LIAM, household=1000002, person=1000021)
    service = _service(store, _twins())
    await service.grid(YEAR)
    assert [p.grant for p in store.grant_placements] == ["ledger:9002"]
    await service.grid(YEAR)
    assert [p.grant for p in store.grant_placements] == ["ledger:9002"]


# --- a commitment that left the register before the log could place it ------------------------------

_OCT_2 = datetime(2027, 10, 2, 12, tzinfo=UTC)
_NOV_15 = datetime(2027, 11, 15, 12, tzinfo=UTC)


def _commitment_created(at: datetime) -> LogRow:
    return LogRow(
        "log000000000002",
        "aid_grants",
        "grt000000000009",
        None,
        {"household_cm_id": 1000001, "person_cm_id": 1000011},
        at,
    )


def _fulfilling_line() -> RegisterRow:
    return replace(grant_row(EMMA, "500"), recorded_at=MAR_1, fulfils_commitment_id="grt000000000009")


def test_a_commitment_fulfilled_by_a_line_the_log_placed_is_not_a_gap() -> None:
    line = _fulfilling_line()
    placed = placements_as_of([_logged(line, _OCT_2)], [line], [_commitment_created(_OCT_2)], _NOV_15)
    assert (placed.households, placed.people) == (frozenset(), frozenset())


def test_a_commitment_whose_fulfilling_line_was_placed_only_after_the_read_is_still_a_gap() -> None:
    line = _fulfilling_line()
    placed = placements_as_of([_logged(line, _NOV_15.replace(day=20))], [line], [_commitment_created(_OCT_2)], _NOV_15)
    assert placed.households == frozenset({1000001})


def test_a_commitment_withdrawn_by_the_read_is_not_a_gap() -> None:
    withdrawn = LogRow(
        "log000000000003",
        "aid_grants",
        "grt000000000009",
        {"status": "open"},
        {"status": "withdrawn", "withdrawn_at": "2027-10-03 00:00:00.000Z"},
        _OCT_2.replace(day=3),
    )
    log = [_commitment_created(_OCT_2), withdrawn]
    assert placements_as_of([], [], log, _NOV_15).households == frozenset()
    assert placements_as_of([], [], log, _OCT_2).households == frozenset({1000001})


def test_a_commitment_that_is_neither_fulfilled_nor_withdrawn_and_unlogged_is_still_a_gap() -> None:
    other = grant_row(LIAM, "300")  # a placed line that fulfils nothing
    placed = placements_as_of([_logged(other, _OCT_2)], [other], [_commitment_created(_OCT_2)], _NOV_15)
    assert placed.households == frozenset({1000001})
