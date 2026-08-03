"""LodgingWriteService.place_party writes a unit set, not three separate targets.

kindred#1931 collapsed `unit` / `merge` / `merge_draft` into one multi-valued
`units` relation (migration 1500000134, which dropped all three columns and
deleted `lodging_merges_draft` outright). These tests pin the write side of
that collapse:

  * `place_party` writes `units: request.unit_ids`, on both create and update.
  * An EMPTY `unit_ids` is the TOMBSTONE -- "staff took this party off the
    board in this scenario" -- and is a legitimate row, not a no-op and not a
    delete. Deleting the row instead would fall through to the CampMinder
    mirror and put the family straight back in the cabin they were just
    dragged out of.
  * `create_merge` / `delete_merge` are gone: `lodging_merges_draft`, the
    table they wrote, no longer exists.
"""

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from api.schemas.lodging import PlacementWriteRequest
from api.services.lodging_write_service import LodgingWriteService


def _repo(**overrides: Any) -> MagicMock:
    """A repository mock with empty defaults; override only what a test needs."""
    repo = MagicMock()
    defaults: dict[str, Any] = {
        "fetch_session": SimpleNamespace(id="sess_1"),
        "find_draft_assignment": None,
        "create_draft_assignment": SimpleNamespace(id="draft_new"),
        "update_draft_assignment": SimpleNamespace(id="draft_existing"),
        "delete_draft_assignment": None,
    }
    defaults.update(overrides)
    for method, value in defaults.items():
        setattr(repo, method, AsyncMock(return_value=value))
    return repo


def _request(unit_ids: list[str] | None = None, **overrides: Any) -> PlacementWriteRequest:
    fields: dict[str, Any] = {
        "year": 2026,
        "session_cm_id": 1000001,
        "scenario": "scn_1",
        "household_cm_id": 2000001,
        "unit_ids": unit_ids if unit_ids is not None else [],
    }
    fields.update(overrides)
    return PlacementWriteRequest(**fields)


@pytest.fixture
def repo() -> MagicMock:
    return _repo()


@pytest.fixture
def write_service(repo: MagicMock) -> LodgingWriteService:
    return LodgingWriteService(repo)


class TestPlacePartyWritesAUnitSet:
    @pytest.mark.asyncio
    async def test_place_party_writes_the_unit_set(self, write_service: LodgingWriteService, repo: MagicMock) -> None:
        await write_service.place_party(_request(unit_ids=["u1", "u2"]))

        data = repo.create_draft_assignment.call_args[0][0]
        assert data["units"] == ["u1", "u2"]

    @pytest.mark.asyncio
    async def test_empty_unit_ids_is_a_tombstone_not_a_delete(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The single most important semantic on this path.

        An empty `unit_ids` still WRITES a row -- it is not turned into a call
        to delete_draft_assignment, and the row it writes carries `units: []`
        rather than being skipped.
        """
        await write_service.place_party(_request(unit_ids=[]))

        data = repo.create_draft_assignment.call_args[0][0]
        assert data["units"] == []
        repo.delete_draft_assignment.assert_not_called()

    @pytest.mark.asyncio
    async def test_the_old_three_target_keys_are_gone(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """`unit` / `merge` / `merge_draft` were dropped by migration
        1500000134 -- writing any of them would 400 against the live schema."""
        await write_service.place_party(_request(unit_ids=["u1"]))

        data = repo.create_draft_assignment.call_args[0][0]
        assert "unit" not in data
        assert "merge" not in data
        assert "merge_draft" not in data

    @pytest.mark.asyncio
    async def test_updating_an_existing_placement_writes_the_unit_set(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        repo.find_draft_assignment = AsyncMock(return_value=SimpleNamespace(id="draft_existing"))

        await write_service.place_party(_request(unit_ids=["u3"]))

        repo.create_draft_assignment.assert_not_called()
        record_id, data = repo.update_draft_assignment.call_args[0]
        assert record_id == "draft_existing"
        assert data["units"] == ["u3"]

    @pytest.mark.asyncio
    async def test_updating_an_existing_placement_to_empty_is_still_the_tombstone(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The tombstone applies on the update path too: dragging an already-
        placed party off the board updates the row to `units: []`, it does not
        delete the row."""
        repo.find_draft_assignment = AsyncMock(return_value=SimpleNamespace(id="draft_existing"))

        await write_service.place_party(_request(unit_ids=[]))

        record_id, data = repo.update_draft_assignment.call_args[0]
        assert record_id == "draft_existing"
        assert data["units"] == []
        repo.delete_draft_assignment.assert_not_called()


class TestMergeWritesAreGone:
    """create_merge / delete_merge wrote lodging_merges_draft, which
    migration 1500000134 deleted outright -- they cannot survive it."""

    def test_create_merge_no_longer_exists(self, write_service: LodgingWriteService) -> None:
        assert not hasattr(write_service, "create_merge")

    def test_delete_merge_no_longer_exists(self, write_service: LodgingWriteService) -> None:
        assert not hasattr(write_service, "delete_merge")
