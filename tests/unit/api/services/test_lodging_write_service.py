"""LodgingWriteService: a placement is a unit set, and a scenario is a plan.

Two changes converge in this file.

kindred#1931 collapsed `unit` / `merge` / `merge_draft` into one multi-valued
`units` relation (migration 1500000134, which dropped all three columns and
deleted `lodging_merges_draft` outright), so `place_party` writes
`units: request.unit_ids` on both create and update, and `create_merge` /
`delete_merge` are gone with the table they wrote.

kindred#1974 then made a scenario REPLACE the CampMinder mirror rather than
overlay it, which retires the tombstone. An empty `unit_ids` used to be a
legitimate row meaning "staff took this party off the board"; with no
fall-through there is nothing for it to suppress, so the schema refuses it and
`unplace_party` -- the DELETE -- is how a party comes off the board. The other
half of that change is `copy_from_mirror`: a scenario now starts empty, so
seeding one from the synced placements is an explicit operation.
"""

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

from api.schemas.lodging import PlacementCopyRequest, PlacementDeleteRequest, PlacementWriteRequest
from api.services.lodging_write_service import LodgingWriteService, ScenarioNotEmptyError


def _repo(**overrides: Any) -> MagicMock:
    """A repository mock with empty defaults; override only what a test needs."""
    repo = MagicMock()
    defaults: dict[str, Any] = {
        "fetch_session": SimpleNamespace(id="sess_1"),
        "find_draft_assignment": None,
        "create_draft_assignment": SimpleNamespace(id="draft_new"),
        "update_draft_assignment": SimpleNamespace(id="draft_existing"),
        "delete_draft_assignment": None,
        "count_draft_assignments": 0,
        "fetch_assignments": [],
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
        "unit_ids": unit_ids if unit_ids is not None else ["u1"],
    }
    fields.update(overrides)
    return PlacementWriteRequest(**fields)


def _mirror_row(**overrides: Any) -> SimpleNamespace:
    """One synced `lodging_assignments` row, as fetch_assignments returns it."""
    fields: dict[str, Any] = {
        "id": "assign_1",
        "household_cm_id": 2000001,
        "person_cm_id": 0,
        "units": ["u1"],
        "source": "campminder_sync",
        "expand": {"units": [SimpleNamespace(id="u1", code="ridge-a", name="Ridge A")]},
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


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


class TestUnplacingIsADelete:
    """kindred#1974 retired the tombstone.

    A placement row now says one thing: this party is in these units. "Not
    placed" is the ABSENCE of a row, exactly as it is in summer's
    `bunk_assignments_draft`, so there is no second way to spell it and no
    third state for the board to get wrong.
    """

    def test_an_empty_unit_ids_is_refused_at_the_edge(self) -> None:
        """422, not a row.

        With no fall-through, a row naming no unit is indistinguishable in
        effect from no row at all -- it renders unplaced either way -- and two
        spellings of one state is precisely what this change deletes. Refusing
        at the schema keeps the write layer total: a row exists iff the party
        is placed.
        """
        with pytest.raises(ValidationError):
            _request(unit_ids=[])

    def test_unit_ids_is_required_not_defaulted_to_empty(self) -> None:
        """Omitting the field is the same client bug as sending `[]`.

        mypy rejects the call below too, which is why it carries an ignore --
        but the callers that matter send JSON to `POST /placements`, where
        there is no type checker between the client and the model. The
        default it used to carry (`default_factory=list`) would silently turn
        a forgotten field into the old tombstone.
        """
        with pytest.raises(ValidationError):
            PlacementWriteRequest(  # type: ignore[call-arg]
                year=2026, session_cm_id=1000001, scenario="scn_1", household_cm_id=2000001
            )

    @pytest.mark.asyncio
    async def test_unplace_party_deletes_the_draft_row(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        repo.find_draft_assignment = AsyncMock(return_value=SimpleNamespace(id="draft_existing"))

        result = await write_service.unplace_party(
            PlacementDeleteRequest(year=2026, session_cm_id=1000001, scenario="scn_1", household_cm_id=2000001)
        )

        repo.delete_draft_assignment.assert_awaited_once_with("draft_existing")
        assert result.deleted is True

    @pytest.mark.asyncio
    async def test_unplacing_a_party_that_was_never_placed_is_not_an_error(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """Idempotent: the board may fire this for a card it never moved."""
        result = await write_service.unplace_party(
            PlacementDeleteRequest(year=2026, session_cm_id=1000001, scenario="scn_1", household_cm_id=2000001)
        )

        repo.delete_draft_assignment.assert_not_called()
        assert result.deleted is False


class TestCopyFromMirror:
    """Seeding a scenario from the CampMinder mirror.

    Replace semantics make a new scenario EMPTY, so this is the operation that
    makes one usable. Summer's copy (`api/routers/scenarios.py`) cannot be
    reused: it copies `bunk_assignments` and returns zero rows for a weekend
    session.
    """

    @pytest.mark.asyncio
    async def test_each_mirror_placement_becomes_a_draft_row(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        repo.fetch_assignments = AsyncMock(
            return_value=[
                _mirror_row(),
                _mirror_row(
                    id="assign_2",
                    household_cm_id=2000002,
                    units=["u2", "u3"],
                    expand={
                        "units": [
                            SimpleNamespace(id="u2", code="gt-tioga-1", name="Tioga 1"),
                            SimpleNamespace(id="u3", code="gt-tioga-2", name="Tioga 2"),
                        ]
                    },
                ),
            ]
        )

        result = await write_service.copy_from_mirror(
            PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1")
        )

        assert result.copied == 2
        assert result.skipped == 0
        written = [call[0][0] for call in repo.create_draft_assignment.call_args_list]
        assert [row["units"] for row in written] == [["u1"], ["u2", "u3"]]
        assert {row["scenario"] for row in written} == {"scn_1"}
        assert {row["session"] for row in written} == {"sess_1"}
        # The durable key, as every other draft write carries it (#1879).
        assert {row["session_cm_id"] for row in written} == {1000001}
        assert {row["year"] for row in written} == {2026}

    @pytest.mark.asyncio
    async def test_a_copied_row_is_not_marked_staff_touched(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """`staff_touched` answers "has a human moved this party?", and a seed
        has not. Marking all 62 copied rows touched would answer it wrong for
        the whole weekend at once, and the flag is one-way. `source` carries
        the mirror row's own provenance for the same reason: the placement
        came from CampMinder even though staff asked for the copy."""
        repo.fetch_assignments = AsyncMock(return_value=[_mirror_row()])

        await write_service.copy_from_mirror(PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1"))

        data = repo.create_draft_assignment.call_args[0][0]
        assert data["staff_touched"] is False
        assert data["source"] == "campminder_sync"

    @pytest.mark.asyncio
    async def test_the_person_grain_is_preserved(self, write_service: LodgingWriteService, repo: MagicMock) -> None:
        """Adult weekends place people. A copy that flattened both grain
        columns onto one row would trip `guardDraftAssignmentGrain`."""
        repo.fetch_assignments = AsyncMock(return_value=[_mirror_row(household_cm_id=0, person_cm_id=1000001)])

        await write_service.copy_from_mirror(PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1"))

        data = repo.create_draft_assignment.call_args[0][0]
        assert data["person_cm_id"] == 1000001
        assert data["household_cm_id"] == 0

    @pytest.mark.asyncio
    async def test_a_row_naming_no_party_is_skipped(self, write_service: LodgingWriteService, repo: MagicMock) -> None:
        """A row keying on neither grain dedupes against nothing and both
        partial unique indexes skip it, so copying one would accumulate an
        invisible row that does nothing -- which is what
        `guardDraftAssignmentGrain` exists to refuse."""
        repo.fetch_assignments = AsyncMock(return_value=[_mirror_row(household_cm_id=0, person_cm_id=0)])

        result = await write_service.copy_from_mirror(
            PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1")
        )

        assert result.copied == 0
        assert result.skipped == 1
        repo.create_draft_assignment.assert_not_called()

    @pytest.mark.asyncio
    async def test_an_orphaned_mirror_row_is_skipped(self, write_service: LodgingWriteService, repo: MagicMock) -> None:
        """Every unit it named has been deleted, which the DB allows. It
        places nobody, so copying it would write a row that places nobody --
        and a relation id with no record behind it can fail the create."""
        repo.fetch_assignments = AsyncMock(return_value=[_mirror_row(units=["u_deleted"], expand={})])

        result = await write_service.copy_from_mirror(
            PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1")
        )

        assert result.copied == 0
        assert result.skipped == 1
        repo.create_draft_assignment.assert_not_called()

    @pytest.mark.asyncio
    async def test_an_unresolvable_id_is_dropped_but_the_rest_still_copies(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The same rule `_placement_of` applies when reading: a dangling id
        is dropped, and the surviving units still place the party."""
        repo.fetch_assignments = AsyncMock(
            return_value=[
                _mirror_row(
                    units=["u1", "u_deleted"],
                    expand={"units": [SimpleNamespace(id="u1", code="ridge-a", name="Ridge A")]},
                )
            ]
        )

        result = await write_service.copy_from_mirror(
            PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1")
        )

        assert result.copied == 1
        assert repo.create_draft_assignment.call_args[0][0]["units"] == ["u1"]

    @pytest.mark.asyncio
    async def test_copying_into_a_scenario_that_already_has_placements_is_refused(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """Seed-only, and it says so rather than merging.

        A second copy over a worked scenario would overwrite the placements
        staff made, and -- worse under replace semantics -- re-place every
        party they deliberately unplaced, because unplacing is now the absence
        of a row and a gap-filling copy cannot tell that from a party nobody
        has reached yet. Re-baselining a worked plan against CampMinder drift
        is a different feature; it is not this one.
        """
        repo.count_draft_assignments = AsyncMock(return_value=3)

        with pytest.raises(ScenarioNotEmptyError):
            await write_service.copy_from_mirror(
                PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1")
            )

        repo.create_draft_assignment.assert_not_called()
        repo.fetch_assignments.assert_not_called()

    @pytest.mark.asyncio
    async def test_the_emptiness_check_is_scoped_to_this_weekend_and_scenario(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """A scenario spans weekends. Placements in another weekend, or in
        another scenario, must not refuse this one."""
        repo.fetch_assignments = AsyncMock(return_value=[_mirror_row()])

        await write_service.copy_from_mirror(PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1"))

        repo.count_draft_assignments.assert_awaited_once_with(2026, "sess_1", "scn_1")

    @pytest.mark.asyncio
    async def test_availability_is_not_copied(self, write_service: LodgingWriteService, repo: MagicMock) -> None:
        """Availability stayed an OVERLAY (kindred#1974 changed placements
        only), so a scenario already sees the live reservations as its base.
        Copying them would pin the scenario against a later change to the live
        plan -- the same argument that makes `state: null` a delete."""
        repo.fetch_assignments = AsyncMock(return_value=[_mirror_row()])

        await write_service.copy_from_mirror(PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1"))

        repo.create_availability.assert_not_called()


class TestMergeWritesAreGone:
    """create_merge / delete_merge wrote lodging_merges_draft, which
    migration 1500000134 deleted outright -- they cannot survive it."""

    def test_create_merge_no_longer_exists(self, write_service: LodgingWriteService) -> None:
        assert not hasattr(write_service, "create_merge")

    def test_delete_merge_no_longer_exists(self, write_service: LodgingWriteService) -> None:
        assert not hasattr(write_service, "delete_merge")
