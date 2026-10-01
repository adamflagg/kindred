"""The grant placement log (campership 3c-2; owner rulings 2026-09-30 and 2026-10-01). Fictional only."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, datetime
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
    register_row,
)
from api.services.financial_aid_grants_register import RegisterRow, RequestShare
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
