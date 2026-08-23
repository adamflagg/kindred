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

import logging
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]
from pydantic import ValidationError

from api.schemas.lodging import (
    AvailabilityWriteRequest,
    PlacementCopyRequest,
    PlacementDeleteRequest,
    PlacementWriteRequest,
    SlotMergeRequest,
)
from api.services.lodging_write_service import LodgingWriteService, ScenarioNotEmptyError
from bunking.logging_config import ISO8601Formatter


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
        "fetch_draft_assignments": [],
        "find_availability_override": None,
        "create_availability": SimpleNamespace(id="avail_new"),
        "update_availability": SimpleNamespace(id="avail_existing"),
        "delete_availability": None,
        # Write-in OCCUPANCY, split out of `lodging_availability` by
        # kindred#2382. `lodging_availability` keeps only the staff<->family
        # ROLE override; somebody being IN a room is written here.
        "find_write_in": None,
        "create_write_in": SimpleNamespace(id="write_in_new"),
        "update_write_in": SimpleNamespace(id="write_in_existing"),
        "delete_write_in": None,
        "fetch_write_ins": [],
        # The scenario grain of the same occupancy fact (kindred#2382). All
        # five have callers now: `fetch_draft_write_ins` and
        # `create_draft_write_in` are the seed paths' read and write (PR 3),
        # and `find_`, `update_` and `delete_draft_write_in` are what
        # `set_availability` reaches when the request names a scenario (PR 4).
        # An empty default for the read is the shape a weekend with no
        # write-ins really has.
        "fetch_draft_write_ins": [],
        "find_draft_write_in": None,
        "create_draft_write_in": SimpleNamespace(id="draft_write_in_new"),
        "update_draft_write_in": SimpleNamespace(id="draft_write_in_existing"),
        "delete_draft_write_in": None,
        "find_slot_merge": None,
        "create_slot_merge": SimpleNamespace(id="merge_new"),
        "update_slot_merge": SimpleNamespace(id="merge_existing"),
        "fetch_slot_merges": [],
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


def _availability_request(**overrides: Any) -> AvailabilityWriteRequest:
    fields: dict[str, Any] = {
        "year": 2026,
        "session_cm_id": 1000001,
        "unit_id": "u1",
        "family_available": False,
        "reason": "Burst pipe",
    }
    fields.update(overrides)
    return AvailabilityWriteRequest(**fields)


def _slot_merge_request(**overrides: Any) -> SlotMergeRequest:
    fields: dict[str, Any] = {
        "year": 2026,
        "session_cm_id": 1000001,
        "scenario": "scn_1",
        "unit_id": "u1",
        "combined": True,
    }
    fields.update(overrides)
    return SlotMergeRequest(**fields)


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
    async def test_losing_the_seeding_race_is_refused_the_same_way(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """Two staff seeding the same weekend at the same moment.

        The count and the creates are separate round trips, so both callers
        can read an empty scenario and both start writing. The draft's partial
        unique indexes reject the loser's create, and left alone
        `pb_error_to_http` turns that into a 400 -- a different answer to the
        same question the up-front check answers with a 409. Same shape, and
        the same treatment, as `place_party`'s lost-create race.
        """
        repo.count_draft_assignments = AsyncMock(side_effect=[0, 5])
        repo.fetch_assignments = AsyncMock(return_value=[_mirror_row()])
        repo.create_draft_assignment = AsyncMock(
            side_effect=ClientResponseError(
                "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
            )
        )

        with pytest.raises(ScenarioNotEmptyError):
            await write_service.copy_from_mirror(
                PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1")
            )

    @pytest.mark.asyncio
    async def test_a_create_failure_that_is_not_a_race_keeps_its_status(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The recheck is for a lost race, not a blanket swallow.

        If the scenario is still empty, the create failed for some other
        reason and the caller must hear about it with the upstream status
        rather than a 409 claiming somebody else got there first.
        """
        repo.count_draft_assignments = AsyncMock(side_effect=[0, 0])
        repo.fetch_assignments = AsyncMock(return_value=[_mirror_row()])
        repo.create_draft_assignment = AsyncMock(
            side_effect=ClientResponseError("boom", status=400, data={}, url="", is_abort=False, original_error=None)
        )

        with pytest.raises(HTTPException) as exc_info:
            await write_service.copy_from_mirror(
                PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1")
            )

        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_a_failure_partway_through_is_not_mistaken_for_a_race(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The rows this call already wrote are not evidence of another caller.

        The seed writes sequentially, so by row three it has put two rows in
        the scenario itself. A bare "are there rows?" recheck then answers YES
        to its own output and reports every later failure as a 409 race --
        discarding the upstream status of a genuinely broken create, which is
        the exact swallow `test_a_create_failure_that_is_not_a_race_keeps_its
        _status` forbids for the first row. Most of a 62-row weekend's failure
        surface is past the first row.

        `held` must therefore exceed what this call wrote, not merely be
        non-zero.
        """
        repo.count_draft_assignments = AsyncMock(side_effect=[0, 2])
        repo.fetch_assignments = AsyncMock(
            return_value=[
                _mirror_row(),
                _mirror_row(id="assign_2", household_cm_id=2000002),
                _mirror_row(id="assign_3", household_cm_id=2000003),
            ]
        )
        # Two rows land, the third fails for a reason that is not a race --
        # a transient PocketBase error, or a unit deleted since the mirror was
        # read.
        repo.create_draft_assignment = AsyncMock(
            side_effect=[
                SimpleNamespace(id="draft_1"),
                SimpleNamespace(id="draft_2"),
                ClientResponseError("boom", status=400, data={}, url="", is_abort=False, original_error=None),
            ]
        )

        with pytest.raises(HTTPException) as exc_info:
            await write_service.copy_from_mirror(
                PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1")
            )

        assert exc_info.value.status_code == 400, "this call's own two rows were read as another caller's seed"

    @pytest.mark.asyncio
    async def test_a_race_detected_partway_through_is_still_a_refusal(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The other half: rows BEYOND this call's own are a real race.

        Interleaved seeds do not have to collide on the first row -- two
        callers walking the same mirror list can each win a different party
        before either collides. So the test is `held > copied`, not
        `held == 0`, and it still catches the race it was added for.
        """
        repo.count_draft_assignments = AsyncMock(side_effect=[0, 4])
        repo.fetch_assignments = AsyncMock(
            return_value=[_mirror_row(), _mirror_row(id="assign_2", household_cm_id=2000002)]
        )
        repo.create_draft_assignment = AsyncMock(
            side_effect=[
                SimpleNamespace(id="draft_1"),
                ClientResponseError(
                    "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
                ),
            ]
        )

        with pytest.raises(ScenarioNotEmptyError):
            await write_service.copy_from_mirror(
                PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1")
            )

    @pytest.mark.asyncio
    async def test_a_failed_recheck_after_a_lost_seeding_race_keeps_its_status(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The recovery races too, exactly as `place_party`'s does.

        The re-count that decides whether the create raced can fail on its
        own. It lives inside the except block, so unwrapped it is a bare
        ClientResponseError into the catch-all handler in api/main.py -- a
        500, which is the outcome this guard exists to remove.
        """
        repo.count_draft_assignments = AsyncMock(
            side_effect=[
                0,
                ClientResponseError("forbidden", status=403, data={}, url="", is_abort=False, original_error=None),
            ]
        )
        repo.fetch_assignments = AsyncMock(return_value=[_mirror_row()])
        repo.create_draft_assignment = AsyncMock(
            side_effect=ClientResponseError(
                "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
            )
        )

        with pytest.raises(HTTPException) as exc_info:
            await write_service.copy_from_mirror(
                PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1")
            )

        # Pinned, not `>= 400`: a 500 is the precise outcome this rules out.
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_the_emptiness_check_is_scoped_to_this_weekend_and_scenario(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """A scenario spans weekends. Placements in another weekend, or in
        another scenario, must not refuse this one."""
        repo.fetch_assignments = AsyncMock(return_value=[_mirror_row()])

        await write_service.copy_from_mirror(PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1"))

        repo.count_draft_assignments.assert_awaited_once_with(2026, 1000001, "scn_1")

    @pytest.mark.asyncio
    async def test_the_staff_to_family_role_override_is_not_copied(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """`lodging_availability` holds only the ROLE half now, and it is NOT
        scenario-scoped (owner ruling, kindred#2382: "that's more of a known
        'were moving staff to X for weekend Y'"). It has carried no scenario
        column since 1500000135, so every scenario already reads the same rows
        and a copy would be a row duplicating itself.

        The OCCUPANCY half of that old boolean goes the other way and IS
        copied -- see TestCopyFromMirrorAlsoCopiesWriteIns. This test is what
        keeps the two halves from being conflated back together by a seed."""
        repo.fetch_assignments = AsyncMock(return_value=[_mirror_row()])
        repo.fetch_write_ins = AsyncMock(return_value=[_write_in_row()])

        await write_service.copy_from_mirror(PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1"))

        repo.create_availability.assert_not_called()
        repo.update_availability.assert_not_called()


def _draft_row(**overrides: Any) -> SimpleNamespace:
    """One `lodging_assignments_draft` row, as fetch_draft_assignments returns it."""
    fields: dict[str, Any] = {
        "id": "draft_1",
        "household_cm_id": 2000001,
        "person_cm_id": 0,
        "units": ["u1"],
        "source": "staff_manual",
        "staff_touched": True,
        "expand": {"units": [SimpleNamespace(id="u1", code="ridge-a", name="Ridge A")]},
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


class TestCopyScenarioToScenario:
    """Copying one weekend's placements from an existing scenario into a fresh one.

    kindred#2021's "copy from another scenario" for weekend. `copy_from_mirror`
    seeds from the CampMinder mirror; this seeds from a scenario's own
    `lodging_assignments_draft` rows -- the weekend analogue of summer's
    `copy_from_scenario` inside `POST /api/scenarios`. Same emptiness guard,
    same race handling: the destination is checked for existing placements
    the same way `copy_from_mirror`'s is, and the failure paths reuse
    `_seed_failure` rather than duplicate its race/refusal logic.
    """

    @pytest.mark.asyncio
    async def test_each_source_placement_becomes_a_draft_row_in_the_destination(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        repo.fetch_draft_assignments = AsyncMock(
            return_value=[
                _draft_row(),
                _draft_row(
                    id="draft_2",
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

        result = await write_service.copy_scenario_to_scenario(
            year=2026, session_cm_id=1000001, from_scenario="scn_source", to_scenario="scn_dest"
        )

        assert result.copied == 2
        assert result.skipped == 0
        repo.fetch_draft_assignments.assert_awaited_once_with(2026, 1000001, "scn_source")
        written = [call[0][0] for call in repo.create_draft_assignment.call_args_list]
        assert [row["units"] for row in written] == [["u1"], ["u2", "u3"]]
        assert {row["scenario"] for row in written} == {"scn_dest"}
        assert {row["session"] for row in written} == {"sess_1"}
        assert {row["session_cm_id"] for row in written} == {1000001}
        assert {row["year"] for row in written} == {2026}

    @pytest.mark.asyncio
    async def test_the_person_grain_is_preserved(self, write_service: LodgingWriteService, repo: MagicMock) -> None:
        repo.fetch_draft_assignments = AsyncMock(return_value=[_draft_row(household_cm_id=0, person_cm_id=1000001)])

        await write_service.copy_scenario_to_scenario(
            year=2026, session_cm_id=1000001, from_scenario="scn_source", to_scenario="scn_dest"
        )

        data = repo.create_draft_assignment.call_args[0][0]
        assert data["person_cm_id"] == 1000001
        assert data["household_cm_id"] == 0

    @pytest.mark.asyncio
    async def test_staff_touched_and_source_are_carried_over_not_reset(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """Unlike `copy_from_mirror` (a seed has not been touched by staff),
        this copies an ALREADY-WORKED plan: a party staff dragged in the
        source scenario is still staff-touched in the copy, and a row that
        was never touched stays that way -- the copy must not silently
        promote or demote what a human actually decided."""
        repo.fetch_draft_assignments = AsyncMock(return_value=[_draft_row(staff_touched=True, source="staff_manual")])

        await write_service.copy_scenario_to_scenario(
            year=2026, session_cm_id=1000001, from_scenario="scn_source", to_scenario="scn_dest"
        )

        data = repo.create_draft_assignment.call_args[0][0]
        assert data["staff_touched"] is True
        assert data["source"] == "staff_manual"

    @pytest.mark.asyncio
    async def test_a_row_whose_units_are_all_deleted_is_skipped(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        repo.fetch_draft_assignments = AsyncMock(return_value=[_draft_row(units=["u_deleted"], expand={})])

        result = await write_service.copy_scenario_to_scenario(
            year=2026, session_cm_id=1000001, from_scenario="scn_source", to_scenario="scn_dest"
        )

        assert result.copied == 0
        assert result.skipped == 1
        repo.create_draft_assignment.assert_not_called()

    @pytest.mark.asyncio
    async def test_copying_into_a_scenario_that_already_has_placements_is_refused(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        repo.count_draft_assignments = AsyncMock(return_value=3)

        with pytest.raises(ScenarioNotEmptyError):
            await write_service.copy_scenario_to_scenario(
                year=2026, session_cm_id=1000001, from_scenario="scn_source", to_scenario="scn_dest"
            )

        repo.create_draft_assignment.assert_not_called()
        repo.fetch_draft_assignments.assert_not_called()

    @pytest.mark.asyncio
    async def test_the_emptiness_check_is_scoped_to_the_destination_scenario(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The precheck must ask about `to_scenario`, not `from_scenario` --
        the source is expected to hold placements; that is what is being
        copied."""
        repo.fetch_draft_assignments = AsyncMock(return_value=[_draft_row()])

        await write_service.copy_scenario_to_scenario(
            year=2026, session_cm_id=1000001, from_scenario="scn_source", to_scenario="scn_dest"
        )

        repo.count_draft_assignments.assert_awaited_once_with(2026, 1000001, "scn_dest")

    @pytest.mark.asyncio
    async def test_losing_the_copy_race_is_refused_the_same_way_as_a_mirror_seed(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        repo.count_draft_assignments = AsyncMock(side_effect=[0, 5])
        repo.fetch_draft_assignments = AsyncMock(return_value=[_draft_row()])
        repo.create_draft_assignment = AsyncMock(
            side_effect=ClientResponseError(
                "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
            )
        )

        with pytest.raises(ScenarioNotEmptyError):
            await write_service.copy_scenario_to_scenario(
                year=2026, session_cm_id=1000001, from_scenario="scn_source", to_scenario="scn_dest"
            )


class TestCopyScenarioToScenarioAlsoCopiesSlotMerges:
    """A house merged into one card, or split back into rooms, is a
    scenario-scoped decision (`lodging_slot_merges`), exactly the kind of
    thing `_copy_locked_groups` exists to carry over on summer's side
    (kindred#1046). Dropping it here would mean "copy from Option A" does
    not actually copy what Option A's board shows.
    """

    @pytest.mark.asyncio
    async def test_the_source_scenario_s_own_merge_rows_are_copied(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        repo.fetch_slot_merges = AsyncMock(
            return_value=[SimpleNamespace(unit="unit_1", scenario="scn_source", combined=True)]
        )

        await write_service.copy_scenario_to_scenario(
            year=2026, session_cm_id=1000001, from_scenario="scn_source", to_scenario="scn_dest"
        )

        repo.fetch_slot_merges.assert_awaited_once_with(2026, 1000001, "scn_source")
        repo.create_slot_merge.assert_awaited_once()
        data = repo.create_slot_merge.call_args[0][0]
        assert data["unit"] == "unit_1"
        assert data["scenario"] == "scn_dest"
        assert data["combined"] is True
        assert data["session"] == "sess_1"
        assert data["session_cm_id"] == 1000001
        assert data["year"] == 2026

    @pytest.mark.asyncio
    async def test_the_weekend_level_tier_is_not_copied_as_a_scenario_row(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """`fetch_slot_merges(..., "scn_source")` returns the weekend-level
        rows (`scenario == ""`) UNIONED with scn_source's own -- only the
        latter are this copy's to make. Copying the weekend-level tier as a
        scenario row would pin the destination against a later change to it
        instead of letting it inherit, same argument as availability having
        no scenario dimension at all."""
        repo.fetch_slot_merges = AsyncMock(
            return_value=[
                SimpleNamespace(unit="unit_1", scenario="scn_source", combined=True),
                SimpleNamespace(unit="unit_2", scenario="", combined=False),
            ]
        )

        await write_service.copy_scenario_to_scenario(
            year=2026, session_cm_id=1000001, from_scenario="scn_source", to_scenario="scn_dest"
        )

        repo.create_slot_merge.assert_awaited_once()
        assert repo.create_slot_merge.call_args[0][0]["unit"] == "unit_1"

    @pytest.mark.asyncio
    async def test_no_merges_means_no_create_calls(self, write_service: LodgingWriteService, repo: MagicMock) -> None:
        await write_service.copy_scenario_to_scenario(
            year=2026, session_cm_id=1000001, from_scenario="scn_source", to_scenario="scn_dest"
        )

        repo.create_slot_merge.assert_not_called()


def _write_in_row(**overrides: Any) -> SimpleNamespace:
    """One occupancy row, as `fetch_write_ins` / `fetch_draft_write_ins` return it.

    Fictional occupant throughout -- a production write-in names a real family
    or a real staff member (CLAUDE.md section 4).
    """
    fields: dict[str, Any] = {
        "id": "write_in_1",
        "unit": "u1",
        "occupant_name": "Olivia Chen",
        "note": "Paper registration",
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


class TestCopyFromMirrorAlsoCopiesWriteIns:
    """A fresh scenario inherits the LIVE board's write-ins. Owner ruling, 2026-08-16.

    THE REASON IS SAFETY, not convenience. Once a scenario's write-ins REPLACE
    the live ones rather than falling through (kindred#2382 PR 3), a scenario
    seeded without them starts with every written-into cabin looking OPEN --
    and kindred#2247's placement gate reads exactly that, so it would let a
    family be dropped into a room the live board records as occupied. The split
    creates that failure mode; the copy is what closes it.

    Shaped after the `lodging_slot_merges` copy in `copy_scenario_to_scenario`:
    read the source tier, create the destination's own rows, no emptiness check
    of its own and no separate count in the response.
    """

    @pytest.mark.asyncio
    async def test_each_live_write_in_becomes_a_draft_row_in_the_scenario(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        repo.fetch_write_ins = AsyncMock(return_value=[_write_in_row()])

        await write_service.copy_from_mirror(PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1"))

        repo.fetch_write_ins.assert_awaited_once_with(2026, 1000001)
        repo.create_draft_write_in.assert_awaited_once()
        data = repo.create_draft_write_in.call_args[0][0]
        assert data["unit"] == "u1"
        assert data["scenario"] == "scn_1"
        assert data["occupant_name"] == "Olivia Chen"
        assert data["note"] == "Paper registration"
        assert data["session"] == "sess_1"
        assert data["session_cm_id"] == 1000001
        assert data["year"] == 2026

    @pytest.mark.asyncio
    async def test_a_sized_write_ins_party_size_travels_into_the_scenario(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """kindred#2540. A dropped `party_size` is not a smaller row -- it is a
        DIFFERENT one: a null party size means the write-in takes its room
        WHOLESALE, so a seed that silently clears a recorded count of 2
        widens it into "the whole cabin" and a scenario reports a room closed
        that the live board shows as partly open.
        """
        repo.fetch_write_ins = AsyncMock(return_value=[_write_in_row(party_size=2)])

        await write_service.copy_from_mirror(PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1"))

        data = repo.create_draft_write_in.call_args[0][0]
        assert data["party_size"] == 2

    @pytest.mark.asyncio
    async def test_every_live_write_in_is_copied_not_only_the_first(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        repo.fetch_write_ins = AsyncMock(
            return_value=[
                _write_in_row(),
                _write_in_row(id="write_in_2", unit="u2", occupant_name="Ava Martinez", note=""),
            ]
        )

        await write_service.copy_from_mirror(PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1"))

        assert [c[0][0]["unit"] for c in repo.create_draft_write_in.call_args_list] == ["u1", "u2"]

    @pytest.mark.asyncio
    async def test_no_live_write_ins_means_no_create_calls(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        await write_service.copy_from_mirror(PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1"))

        repo.create_draft_write_in.assert_not_called()

    @pytest.mark.asyncio
    async def test_the_live_write_in_table_is_not_written(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """A seed writes the SCENARIO, never the board it copied from.

        `create_write_in` is the live table's create. Reaching it here would
        mean a scenario seed had edited the live board -- the direction
        `copy_from_mirror`'s own docstring says the line permits only one way
        round.
        """
        repo.fetch_write_ins = AsyncMock(return_value=[_write_in_row()])

        await write_service.copy_from_mirror(PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1"))

        repo.create_write_in.assert_not_called()
        repo.update_write_in.assert_not_called()
        repo.delete_write_in.assert_not_called()

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", [400, 403])
    async def test_a_failed_seed_create_keeps_its_upstream_status(
        self, write_service: LodgingWriteService, repo: MagicMock, status: int
    ) -> None:
        """A collision on the draft's unique index is a 400, never a 500.

        REACHABLE, not hypothetical. The up-front guard counts PLACEMENTS
        only, so a weekend whose mirror carries nothing copyable -- early
        season, before CampMinder has assigned any lodging -- passes that
        check on every attempt while the write-ins it seeded are already
        sitting in the scenario. A second `POST /api/lodging/placements/copy`
        then collides on `idx_lodging_write_in_draft_unique`.

        Nothing on this router catches `ClientResponseError`, so one that
        escapes `_seed_write_ins` unconverted reaches api/main.py's catch-all
        handler and the caller is told "Internal server error" for a state the
        server understands perfectly well -- the same shape
        `test_copying_into_an_unknown_weekend_is_404_not_500` refuses for the
        weekend lookup. 403 is parametrised beside it because a refusal must
        not be reported as a collision either; `pb_error_to_http` maps both
        auth flavours to 403 for the reason
        `TestARefusedWriteIsNeverReportedAsSuccess` spells out.
        """
        repo.fetch_write_ins = AsyncMock(return_value=[_write_in_row()])
        repo.create_draft_write_in = AsyncMock(
            side_effect=ClientResponseError(
                "duplicate", status=status, data={}, url="", is_abort=False, original_error=None
            )
        )

        with pytest.raises(HTTPException) as excinfo:
            await write_service.copy_from_mirror(
                PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1")
            )

        assert excinfo.value.status_code == status


class TestCopyScenarioToScenarioAlsoCopiesWriteIns:
    """The source SCENARIO's own write-ins, for the reason the mirror seed copies the live ones.

    `copy_from_mirror` seeds from the live board, so it reads
    `fetch_write_ins`; this seeds from another scenario, so it reads that
    scenario's own draft rows -- exactly the split the placement copy already
    makes between `fetch_assignments` and `fetch_draft_assignments`.
    "Copy from Option A" that dropped Option A's write-ins would not copy what
    Option A's board shows.
    """

    @pytest.mark.asyncio
    async def test_the_source_scenarios_write_ins_are_copied_into_the_destination(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        repo.fetch_draft_write_ins = AsyncMock(return_value=[_write_in_row()])

        await write_service.copy_scenario_to_scenario(
            year=2026, session_cm_id=1000001, from_scenario="scn_source", to_scenario="scn_dest"
        )

        repo.fetch_draft_write_ins.assert_awaited_once_with(2026, 1000001, "scn_source")
        repo.create_draft_write_in.assert_awaited_once()
        data = repo.create_draft_write_in.call_args[0][0]
        assert data["unit"] == "u1"
        assert data["scenario"] == "scn_dest"
        assert data["occupant_name"] == "Olivia Chen"
        assert data["note"] == "Paper registration"
        assert data["session"] == "sess_1"
        assert data["session_cm_id"] == 1000001
        assert data["year"] == 2026

    @pytest.mark.asyncio
    async def test_a_sized_write_ins_party_size_travels_between_scenarios(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """kindred#2540, asserted on this seed path too -- one helper serves
        both seeds, so this is the assertion that catches a later change
        fixing only the mirror path it was looking at.
        """
        repo.fetch_draft_write_ins = AsyncMock(return_value=[_write_in_row(party_size=2)])

        await write_service.copy_scenario_to_scenario(
            year=2026, session_cm_id=1000001, from_scenario="scn_source", to_scenario="scn_dest"
        )

        data = repo.create_draft_write_in.call_args[0][0]
        assert data["party_size"] == 2

    @pytest.mark.asyncio
    async def test_the_live_board_is_not_the_source_here(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """Reading `fetch_write_ins` would seed the destination from the LIVE
        board rather than from the scenario the caller named -- a copy that
        silently ignores the source, and the one mistake sharing a helper
        between the two seed paths would make."""
        repo.fetch_write_ins = AsyncMock(return_value=[_write_in_row(unit="u9", occupant_name="Ava Martinez")])
        repo.fetch_draft_write_ins = AsyncMock(return_value=[_write_in_row()])

        await write_service.copy_scenario_to_scenario(
            year=2026, session_cm_id=1000001, from_scenario="scn_source", to_scenario="scn_dest"
        )

        assert repo.fetch_write_ins.await_count == 0
        assert [c[0][0]["unit"] for c in repo.create_draft_write_in.call_args_list] == ["u1"]

    @pytest.mark.asyncio
    async def test_no_source_write_ins_means_no_create_calls(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        await write_service.copy_scenario_to_scenario(
            year=2026, session_cm_id=1000001, from_scenario="scn_source", to_scenario="scn_dest"
        )

        repo.create_draft_write_in.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_failed_seed_create_keeps_its_upstream_status(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The mirror seed's guard, asserted on this path too.

        One helper serves both seeds, so this is the assertion that catches a
        later change converting only the path it was looking at.
        """
        repo.fetch_draft_write_ins = AsyncMock(return_value=[_write_in_row()])
        repo.create_draft_write_in = AsyncMock(
            side_effect=ClientResponseError(
                "duplicate", status=400, data={}, url="", is_abort=False, original_error=None
            )
        )

        with pytest.raises(HTTPException) as excinfo:
            await write_service.copy_scenario_to_scenario(
                year=2026, session_cm_id=1000001, from_scenario="scn_source", to_scenario="scn_dest"
            )

        assert excinfo.value.status_code == 400


class TestARefusedWriteIsNeverReportedAsSuccess:
    """kindred#1936: the race recovery must not absorb a refusal.

    Both `place_party` and `set_availability` guard the same race -- two
    callers read no row, both create, the partial unique index rejects the
    loser -- by re-reading and updating the winner's row. That recovery is
    correct for a unique-index violation and only for one, because the
    winner's row is by construction the row the loser wanted.

    A 401 or 403 is a different animal. PocketBase refused the write, and the
    re-read then finds the row that was already there -- so the loser updates
    a row it was just told it may not touch and the caller gets a 200 for a
    write that was denied. One staff member double-clicking a drag is enough
    to reach the recovery path (kindred#1881), so this is not hypothetical.

    Only the auth flavours are re-raised. Whether PocketBase answers a partial
    unique violation with 400 or 409 is not settled here, and narrowing to a
    guessed status would break the guard that works today -- so 400 keeps its
    recovery, pinned below.

    Both refusals surface as **403**, not as the upstream status. That is
    `pb_error_to_http`'s deliberate mapping and its docstring argues it at
    length: a PocketBase 401 reaching this layer is the API's own service
    token, never the end user's session -- theirs was validated by
    `bunking.auth_middleware.get_current_user` before any router code ran --
    so answering 401 would send the frontend into a login redirect that cannot
    fix an expired superuser token. Do not "correct" this to 401.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", [401, 403])
    async def test_a_refused_placement_keeps_its_status(
        self, write_service: LodgingWriteService, repo: MagicMock, status: int
    ) -> None:
        repo.create_draft_assignment = AsyncMock(
            side_effect=ClientResponseError(
                "refused", status=status, data={}, url="", is_abort=False, original_error=None
            )
        )
        # The re-read finds a row, which today is enough to turn the refusal
        # into an update and a 200.
        repo.find_draft_assignment = AsyncMock(side_effect=[None, SimpleNamespace(id="draft_other")])

        with pytest.raises(HTTPException) as exc_info:
            await write_service.place_party(_request(unit_ids=["u1"]))

        assert exc_info.value.status_code == 403
        repo.update_draft_assignment.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_lost_placement_race_is_still_recovered(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The guard that works today survives the narrowing."""
        repo.create_draft_assignment = AsyncMock(
            side_effect=ClientResponseError(
                "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
            )
        )
        repo.find_draft_assignment = AsyncMock(side_effect=[None, SimpleNamespace(id="draft_winner")])

        response = await write_service.place_party(_request(unit_ids=["u1"]))

        record_id, data = repo.update_draft_assignment.call_args[0]
        assert record_id == "draft_winner"
        assert data["units"] == ["u1"]
        assert response.record_id == "draft_existing"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", [401, 403])
    async def test_a_refused_availability_override_keeps_its_status(
        self, write_service: LodgingWriteService, repo: MagicMock, status: int
    ) -> None:
        repo.create_availability = AsyncMock(
            side_effect=ClientResponseError(
                "refused", status=status, data={}, url="", is_abort=False, original_error=None
            )
        )
        repo.find_availability_override = AsyncMock(side_effect=[None, SimpleNamespace(id="avail_other")])

        # A RELEASE, because that is the half still stored in
        # `lodging_availability` after kindred#2382 split occupancy out of it.
        # The write-in half is guarded identically over its own table in
        # `TestAWriteInIsStoredAsAnOccupancyNotAnAvailability`.
        with pytest.raises(HTTPException) as exc_info:
            await write_service.set_availability(_availability_request(family_available=True))

        assert exc_info.value.status_code == 403
        repo.update_availability.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_lost_availability_race_is_still_recovered(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        repo.create_availability = AsyncMock(
            side_effect=ClientResponseError(
                "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
            )
        )
        repo.find_availability_override = AsyncMock(side_effect=[None, SimpleNamespace(id="avail_winner")])

        response = await write_service.set_availability(_availability_request(family_available=True))

        record_id, data = repo.update_availability.call_args[0]
        assert record_id == "avail_winner"
        assert data["family_available"] is True
        assert response.record_id == "avail_existing"


class TestARecoveredRaceLogsTheErrorItSwallowed:
    """kindred#2043: the recovery masks the original error with no trace of it.

    `place_party`, `set_availability`, and `set_slot_merge` each guard the
    same race, and each guard is the same width: ANY non-refusal status --
    not only the unique-constraint one the race actually produces -- falls
    through to "assume we lost a race", re-reads, and updates the row that is
    there. That guard is deliberately this wide (see
    `TestARefusedWriteIsNeverReportedAsSuccess` above): whether PocketBase
    answers a partial-unique violation with 400 or 409 is not settled, so
    narrowing to a guessed status would break the recovery that works today.

    The write these three make is idempotent, so a spurious recovery still
    leaves the row exactly where the caller asked -- which is why this is not
    urgent. But a create failing for a reason that is NOT contention -- a
    malformed relation id, a PocketBase-side constraint this code does not
    know about, a transient backend fault -- reaches the same recovery, and
    today nothing records that `exc` at all: the caller sees a 200, and the
    only place the original failure ever existed is a stack frame that has
    already unwound.

    This does not narrow REFUSAL_STATUSES and does not touch `_seed_failure`
    -- that method already refuses first and tests `held > copied`, which is
    the correct version of this guard, not an instance of the bug. It only
    makes the swallow in the three still-wide guards visible in the logs.

    Assertions run the record through the REAL `ISO8601Formatter`, not just
    `logger.warning.called`. `bunking.logging_config.ISO8601Formatter.format`
    only ever emits `record.getMessage()` -- an `extra={}` payload is silently
    dropped and never reaches log output, which patching `logger` and checking
    `.called` cannot catch (the earlier version of this test class did not).
    Context therefore has to be IN the message, and these tests are what would
    have failed had it stayed in `extra`.
    """

    @staticmethod
    def _formatted(records: list[logging.LogRecord]) -> str:
        formatter = ISO8601Formatter(source="api")
        return "\n".join(formatter.format(r) for r in records)

    @pytest.mark.asyncio
    async def test_a_recovered_placement_race_logs_the_swallowed_error(
        self, write_service: LodgingWriteService, repo: MagicMock, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Status 500 -- not the unique-constraint 400 the race actually
        produces -- to prove the guard's own width is what gets logged."""
        repo.create_draft_assignment = AsyncMock(
            side_effect=ClientResponseError("boom", status=500, data={}, url="", is_abort=False, original_error=None)
        )
        repo.find_draft_assignment = AsyncMock(side_effect=[None, SimpleNamespace(id="draft_winner")])

        with caplog.at_level(logging.WARNING, logger="api.services.lodging_write_service"):
            await write_service.place_party(_request(unit_ids=["u1"]))

        output = self._formatted(caplog.records)
        assert "status=500" in output
        assert "household_cm_id=2000001" in output
        assert "scenario=scn_1" in output

    @pytest.mark.asyncio
    async def test_a_recovered_availability_race_logs_the_swallowed_error(
        self, write_service: LodgingWriteService, repo: MagicMock, caplog: pytest.LogCaptureFixture
    ) -> None:
        repo.create_availability = AsyncMock(
            side_effect=ClientResponseError("boom", status=500, data={}, url="", is_abort=False, original_error=None)
        )
        repo.find_availability_override = AsyncMock(side_effect=[None, SimpleNamespace(id="avail_winner")])

        with caplog.at_level(logging.WARNING, logger="api.services.lodging_write_service"):
            await write_service.set_availability(_availability_request(family_available=True))

        output = self._formatted(caplog.records)
        assert "status=500" in output
        assert "unit_id=u1" in output

    @pytest.mark.asyncio
    async def test_a_recovered_merge_race_logs_the_swallowed_error(
        self, write_service: LodgingWriteService, repo: MagicMock, caplog: pytest.LogCaptureFixture
    ) -> None:
        repo.create_slot_merge = AsyncMock(
            side_effect=ClientResponseError("boom", status=500, data={}, url="", is_abort=False, original_error=None)
        )
        repo.find_slot_merge = AsyncMock(side_effect=[None, SimpleNamespace(id="merge_winner")])

        with caplog.at_level(logging.WARNING, logger="api.services.lodging_write_service"):
            await write_service.set_slot_merge(_slot_merge_request())

        output = self._formatted(caplog.records)
        assert "status=500" in output
        assert "unit_id=u1" in output
        assert "scenario=scn_1" in output

    @pytest.mark.asyncio
    async def test_a_lost_race_that_is_not_recovered_is_not_logged_here(
        self, write_service: LodgingWriteService, repo: MagicMock, caplog: pytest.LogCaptureFixture
    ) -> None:
        """`raced is None` re-raises `exc` through `pb_error_to_http` --
        that failure reaches the caller as a real error response, so it is
        not the silent case this class guards. Nothing new needs to log it."""
        repo.create_draft_assignment = AsyncMock(
            side_effect=ClientResponseError("boom", status=500, data={}, url="", is_abort=False, original_error=None)
        )
        repo.find_draft_assignment = AsyncMock(side_effect=[None, None])

        with caplog.at_level(logging.WARNING, logger="api.services.lodging_write_service"):
            with pytest.raises(HTTPException):
                await write_service.place_party(_request(unit_ids=["u1"]))

        assert caplog.records == []

    @pytest.mark.asyncio
    async def test_a_recovery_whose_own_update_fails_is_not_logged_as_recovered(
        self, write_service: LodgingWriteService, repo: MagicMock, caplog: pytest.LogCaptureFixture
    ) -> None:
        """The log fires only once `update_draft_assignment` has SUCCEEDED.

        If the winner's row vanishes again before this call's own update
        lands, the second failure is real -- reported to the caller as an
        error -- and must not be logged as a successful "Recovered", which
        would be a lie about what happened.
        """
        repo.create_draft_assignment = AsyncMock(
            side_effect=ClientResponseError("boom", status=500, data={}, url="", is_abort=False, original_error=None)
        )
        repo.find_draft_assignment = AsyncMock(side_effect=[None, SimpleNamespace(id="draft_winner")])
        repo.update_draft_assignment = AsyncMock(
            side_effect=ClientResponseError("gone", status=404, data={}, url="", is_abort=False, original_error=None)
        )

        with caplog.at_level(logging.WARNING, logger="api.services.lodging_write_service"):
            with pytest.raises(HTTPException):
                await write_service.place_party(_request(unit_ids=["u1"]))

        assert caplog.records == []


class TestTheAvailabilityWriteShape:
    """`PUT /api/lodging/availability` was UNCALLABLE, and this is why.

    `AvailabilityWriteRequest` extended `ScenarioWriteRequest`, where `scenario`
    is `min_length=1`, so the endpoint demanded a dimension nothing could
    supply and the table stayed empty. It has one again since kindred#2382's PR
    4 -- but OPTIONAL, mirroring `SlotMergeRequest`: blank is the live board,
    which is a scope in its own right and not a missing value. Required is the
    shape that broke it.
    """

    def test_a_write_needs_no_scenario(self) -> None:
        request = AvailabilityWriteRequest(
            year=2026, session_cm_id=1000001, unit_id="u1", family_available=False, reason="Burst pipe"
        )

        assert request.family_available is False
        assert request.reason == "Burst pipe"
        # DECLARED, and blank by default. A model that merely ignored an
        # unknown `scenario` key would pass every routing test in this file by
        # writing the live table -- the exact gap PR 4 exists to close -- so
        # the field's existence is pinned here rather than inferred.
        assert "scenario" in AvailabilityWriteRequest.model_fields
        assert request.scenario == ""

    def test_a_scenario_is_accepted_and_never_required(self) -> None:
        """Blank is the LIVE board; a value is that scenario's own draft."""
        assert AvailabilityWriteRequest(year=2026, session_cm_id=1000001, unit_id="u1", scenario="scn_1").scenario == (
            "scn_1"
        )

    def test_null_clears_the_override_rather_than_writing_a_normal_value(self) -> None:
        """`None` DELETES the row.

        There is no value meaning "normal": absence of a row is how "whatever
        this unit's role says" is spelled. Writing a value that happens to
        agree with the role would pin the unit against a later change to it.
        """
        request = AvailabilityWriteRequest(year=2026, session_cm_id=1000001, unit_id="u1")

        assert request.family_available is None

    def test_a_reason_is_optional_but_bounded(self) -> None:
        assert AvailabilityWriteRequest(year=2026, session_cm_id=1000001, unit_id="u1").reason == ""
        with pytest.raises(ValidationError):
            AvailabilityWriteRequest(year=2026, session_cm_id=1000001, unit_id="u1", reason="x" * 501)

    @pytest.mark.asyncio
    async def test_the_reason_is_stored_in_the_note_column(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The API says `reason`; the COLUMN is `note`.

        1500000135 kept the existing `note` column rather than adding `reason`
        and dropping it -- identical semantics, one less schema change on an
        empty table. The translation lives in exactly two places, here on write
        and in `_build_units` on read. A third would mean renaming the column
        instead.
        """
        await write_service.set_availability(_availability_request())

        # The OCCUPANCY table since kindred#2382 -- `family_available = false`
        # was never a value, it was a write-in wearing the role column's
        # clothes. The translation moved with the fact and did not gain a
        # third site.
        data = repo.create_write_in.call_args[0][0]
        assert data["note"] == "Burst pipe"
        assert "scenario" not in data
        assert "state" not in data

    def test_an_occupant_name_is_optional_at_the_schema_but_bounded(self) -> None:
        """Required through the CONTROL, permissive at the schema.

        Exactly the split `reason` already makes, and for the same reason: a
        row written by an ingest or a fixture has no author to ask. The
        write-in form is where the requirement lives, because that is the only
        path with an author -- and a clear (`family_available: null`) sends
        neither field.
        """
        assert AvailabilityWriteRequest(year=2026, session_cm_id=1000001, unit_id="u1").occupant_name == ""
        with pytest.raises(ValidationError):
            AvailabilityWriteRequest(year=2026, session_cm_id=1000001, unit_id="u1", occupant_name="x" * 501)

    @pytest.mark.asyncio
    async def test_the_occupant_name_is_stored_under_its_own_name(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """kindred#2078. `occupant_name` is NOT translated, and that is deliberate.

        `reason`/`note` carry two names because 1500000135 reused a column that
        already existed. There is no such inheritance here, so the API name and
        the column name are the same one and this write path has no second
        translation to keep in step.
        """
        await write_service.set_availability(_availability_request(occupant_name="Emma Johnson"))

        data = repo.create_write_in.call_args[0][0]
        assert data["occupant_name"] == "Emma Johnson"
        assert data["note"] == "Burst pipe"

    @pytest.mark.asyncio
    async def test_a_release_writes_true_rather_than_a_state_name(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """A staff cabin opened to families for one weekend.

        The old encoding needed `released_to_family` to be read against the
        unit's role to mean anything; the boolean states the outcome directly.
        """
        await write_service.set_availability(_availability_request(family_available=True, reason="Director away"))

        data = repo.create_availability.call_args[0][0]
        assert data["family_available"] is True

    @pytest.mark.asyncio
    async def test_a_write_in_persists_its_party_size(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """kindred#2503. The count rides the OCCUPANCY payload."""
        await write_service.set_availability(_availability_request(party_size=2))

        data = repo.create_write_in.call_args[0][0]
        assert data["party_size"] == 2

    @pytest.mark.asyncio
    async def test_a_cleared_count_reaches_the_payload_as_none(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """`None` is the COMMON case (owner ruling): the write-in occupies the
        room wholesale. It must reach the payload as an explicit key, not be
        silently omitted -- `update_write_in` forwards this dict straight to
        PocketBase with no `exclude_none` beneath it, so omission and an
        explicit `None` differ on an UPDATE: omission would leave a
        previously-set count standing instead of clearing it.
        """
        await write_service.set_availability(_availability_request(party_size=None))

        data = repo.create_write_in.call_args[0][0]
        assert "party_size" in data
        assert data["party_size"] is None

    @pytest.mark.asyncio
    async def test_a_cleared_count_reaches_an_existing_rows_update_payload_as_none(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """kindred#2540. The docstring above argues about clearing a count on
        an EXISTING row -- the case where an erasure would actually happen,
        since `update_write_in` forwards the dict straight to PocketBase with
        no `exclude_none` beneath it -- but its own assertion only ever
        exercised CREATE, because no existing record was mocked. This is the
        UPDATE half: with `find_write_in` returning a row, clearing the count
        must still reach `update_write_in`'s payload as an explicit `None`,
        not an omitted key that would leave a previously-set count standing.
        """
        repo.find_write_in = AsyncMock(return_value=SimpleNamespace(id="write_in_1"))

        await write_service.set_availability(_availability_request(party_size=None))

        repo.create_write_in.assert_not_called()
        record_id, data = repo.update_write_in.call_args[0]
        assert record_id == "write_in_1"
        assert "party_size" in data
        assert data["party_size"] is None

    @pytest.mark.asyncio
    async def test_a_release_never_carries_a_count(self, write_service: LodgingWriteService, repo: MagicMock) -> None:
        """`family_available: true` is the staff<->family ROLE for the weekend
        and lives in `lodging_availability`, which names no occupant. A count
        on it would be a headcount for nobody.
        """
        await write_service.set_availability(_availability_request(family_available=True, party_size=2))

        assert "party_size" not in repo.create_availability.call_args[0][0]

    @pytest.mark.asyncio
    async def test_a_clear_sends_nothing(self, write_service: LodgingWriteService, repo: MagicMock) -> None:
        """`family_available: null` DELETES the row; the delete path takes no
        payload and is untouched by the count.
        """
        repo.find_write_in = AsyncMock(return_value=SimpleNamespace(id="write_in_1"))

        await write_service.set_availability(_availability_request(family_available=None, party_size=None))

        repo.delete_write_in.assert_awaited_once_with("write_in_1")

    def test_zero_is_rejected_at_the_boundary(self) -> None:
        """`min: 1` on the column and `ge=1` here. A write-in for nobody is not
        a write-in; clearing the count is null.
        """
        with pytest.raises(ValidationError):
            AvailabilityWriteRequest(
                year=2026, session_cm_id=1000001, unit_id="u1", family_available=False, party_size=0
            )


class TestARefusedUpdateAnswersTheSameWayARefusedCreateDoes:
    """The create path is the RARE one, and it was the one guarded first.

    `place_party` resolves `existing` before it branches, and a scenario is
    normally seeded from the mirror by `copy_from_mirror` before anyone drags
    anything -- so from that point on every drag finds a row and takes the
    update branch. The create branch only fires for a party that has no
    placement in the scenario at all. Drag placement (kindred#1990) made this
    the common path, not a corner.

    Neither update was inside a `try`, so a refusal escaped as a bare
    `ClientResponseError` into the catch-all handler in `api/main.py` and
    answered **500**. That is the same lie kindred#1936 set out to remove --
    a write the user was told they may not make, reported as something other
    than a refusal -- and 403 is the answer for the same reason it is on the
    create side: `pb_error_to_http` maps a PocketBase 401 here to 403 because
    it is the API's own service token, never the caller's session.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", [401, 403])
    async def test_a_refused_placement_update_keeps_its_status(
        self, write_service: LodgingWriteService, repo: MagicMock, status: int
    ) -> None:
        repo.find_draft_assignment = AsyncMock(return_value=SimpleNamespace(id="draft_existing"))
        repo.update_draft_assignment = AsyncMock(
            side_effect=ClientResponseError(
                "refused", status=status, data={}, url="", is_abort=False, original_error=None
            )
        )

        with pytest.raises(HTTPException) as exc_info:
            await write_service.place_party(_request(unit_ids=["u1"]))

        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", [401, 403])
    async def test_a_refused_availability_update_keeps_its_status(
        self, write_service: LodgingWriteService, repo: MagicMock, status: int
    ) -> None:
        repo.find_availability_override = AsyncMock(return_value=SimpleNamespace(id="avail_existing"))
        repo.update_availability = AsyncMock(
            side_effect=ClientResponseError(
                "refused", status=status, data={}, url="", is_abort=False, original_error=None
            )
        )

        # A RELEASE -- the half `lodging_availability` still stores. Its
        # write-in twin is guarded over `lodging_write_ins` in
        # `TestAWriteInIsStoredAsAnOccupancyNotAnAvailability`.
        with pytest.raises(HTTPException) as exc_info:
            await write_service.set_availability(_availability_request(family_available=True))

        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_a_failed_placement_update_still_reaches_pb_error_to_http(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """Not only the refusals. Every status this branch can raise now goes
        through the same mapping the create branch uses, so none of them
        arrives at the catch-all as a 500."""
        repo.find_draft_assignment = AsyncMock(return_value=SimpleNamespace(id="draft_existing"))
        repo.update_draft_assignment = AsyncMock(
            side_effect=ClientResponseError("gone", status=404, data={}, url="", is_abort=False, original_error=None)
        )

        with pytest.raises(HTTPException) as exc_info:
            await write_service.place_party(_request(unit_ids=["u1"]))

        assert exc_info.value.status_code == 404


class TestARefusedSeedIsNotReportedAsARace:
    """`_seed_failure` decides race-vs-failure on row COUNT alone.

    The third instance of kindred#1936's shape, and the one the fix missed.
    `copy_from_mirror` writes sequentially, so from the second row on it has
    put rows in the scenario itself; `held > copied` is what stops it reading
    its own output as a race. But nothing in that test looks at the STATUS.
    A 401 or 403 part-way through a seed -- the API's service token expiring
    mid-loop is the realistic way in -- lands with rows already held, so the
    refusal is reported to the caller as `ScenarioNotEmptyError`: "another
    caller seeded this scenario while this copy was running." Nobody did.

    The status check belongs before the count, for the same reason it does in
    the two create paths: a refusal is not a race, whatever the row count
    says afterwards.
    """

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", [401, 403])
    async def test_a_refused_seed_create_keeps_its_status(
        self, write_service: LodgingWriteService, repo: MagicMock, status: int
    ) -> None:
        repo.fetch_assignments = AsyncMock(return_value=[_mirror_row()])
        repo.create_draft_assignment = AsyncMock(
            side_effect=ClientResponseError(
                "refused", status=status, data={}, url="", is_abort=False, original_error=None
            )
        )
        # Empty up front, then rows beyond this copy's own output on the
        # re-count -- which today is the whole test, and turns the refusal
        # into "someone else seeded it".
        repo.count_draft_assignments = AsyncMock(side_effect=[0, 7])

        with pytest.raises(HTTPException) as exc_info:
            await write_service.copy_from_mirror(
                PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1")
            )

        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_a_genuinely_raced_seed_is_still_reported_as_one(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The guard that works today survives the narrowing."""
        repo.fetch_assignments = AsyncMock(return_value=[_mirror_row()])
        repo.create_draft_assignment = AsyncMock(
            side_effect=ClientResponseError(
                "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
            )
        )
        repo.count_draft_assignments = AsyncMock(side_effect=[0, 7])

        with pytest.raises(ScenarioNotEmptyError):
            await write_service.copy_from_mirror(
                PlacementCopyRequest(year=2026, session_cm_id=1000001, scenario="scn_1")
            )


class TestEveryLookupIsKeyedOnTheCampMinderSessionId:
    """kindred#2042: the lookups name the weekend by `session_cm_id`.

    The write paths still resolve the PocketBase record id -- `_resolve_session_pb_id`
    is what turns an unknown weekend into a 404, and the `session` relation is
    still written on every row for expand-based reads -- but the id that keys
    the lookup against the table's unique index is now the CampMinder one.
    Passing the PB id here would look up a row through a key the index no
    longer carries.

    `fetch_session` still takes the CampMinder id and always did; what changed
    is everything downstream of it.
    """

    SESSION_CM_ID = 1000001

    @pytest.mark.asyncio
    async def test_place_party_looks_up_the_draft_by_campminder_session_id(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        await write_service.place_party(_request())

        repo.find_draft_assignment.assert_awaited_once_with(2026, self.SESSION_CM_ID, "scn_1", 2000001, 0)

    @pytest.mark.asyncio
    async def test_unplace_party_looks_up_the_draft_by_campminder_session_id(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        await write_service.unplace_party(
            PlacementDeleteRequest(
                year=2026, session_cm_id=self.SESSION_CM_ID, scenario="scn_1", household_cm_id=2000001
            )
        )

        repo.find_draft_assignment.assert_awaited_once_with(2026, self.SESSION_CM_ID, "scn_1", 2000001, 0)

    @pytest.mark.asyncio
    async def test_set_availability_looks_up_the_override_by_campminder_session_id(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        await write_service.set_availability(_availability_request())

        repo.find_availability_override.assert_awaited_once_with(2026, self.SESSION_CM_ID, "u1")

    @pytest.mark.asyncio
    async def test_set_slot_merge_looks_up_the_row_by_campminder_session_id(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        await write_service.set_slot_merge(_slot_merge_request())

        repo.find_slot_merge.assert_awaited_once_with(2026, self.SESSION_CM_ID, "u1", "scn_1")

    @pytest.mark.asyncio
    async def test_copy_from_mirror_counts_and_reads_by_campminder_session_id(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        await write_service.copy_from_mirror(
            PlacementCopyRequest(year=2026, session_cm_id=self.SESSION_CM_ID, scenario="scn_1")
        )

        repo.count_draft_assignments.assert_awaited_once_with(2026, self.SESSION_CM_ID, "scn_1")
        repo.fetch_assignments.assert_awaited_once_with(2026, self.SESSION_CM_ID)

    @pytest.mark.asyncio
    async def test_copy_scenario_to_scenario_reads_by_campminder_session_id(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        await write_service.copy_scenario_to_scenario(2026, self.SESSION_CM_ID, "scn_source", "scn_dest")

        repo.count_draft_assignments.assert_awaited_once_with(2026, self.SESSION_CM_ID, "scn_dest")
        repo.fetch_draft_assignments.assert_awaited_once_with(2026, self.SESSION_CM_ID, "scn_source")
        repo.fetch_slot_merges.assert_awaited_once_with(2026, self.SESSION_CM_ID, "scn_source")

    @pytest.mark.asyncio
    async def test_every_written_row_still_carries_both_keys(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The relation is not dropped -- it stops being an identity.

        `session` is still `required: true` on all four tables and is still
        what an expand-based read joins through, so a write that stopped
        setting it would be refused by the schema.
        """
        await write_service.place_party(_request())
        placement = repo.create_draft_assignment.call_args[0][0]
        assert placement["session"] == "sess_1"
        assert placement["session_cm_id"] == self.SESSION_CM_ID

        await write_service.set_availability(_availability_request())
        write_in = repo.create_write_in.call_args[0][0]
        assert write_in["session"] == "sess_1"
        assert write_in["session_cm_id"] == self.SESSION_CM_ID

        # BOTH halves of kindred#2382's split, because they are different
        # tables now and a write that set the keys on only one of them would
        # pass with either line alone.
        await write_service.set_availability(_availability_request(family_available=True))
        availability = repo.create_availability.call_args[0][0]
        assert availability["session"] == "sess_1"
        assert availability["session_cm_id"] == self.SESSION_CM_ID

        await write_service.set_slot_merge(_slot_merge_request())
        merge = repo.create_slot_merge.call_args[0][0]
        assert merge["session"] == "sess_1"
        assert merge["session_cm_id"] == self.SESSION_CM_ID


class TestMergeWritesAreGone:
    """create_merge / delete_merge wrote lodging_merges_draft, which
    migration 1500000134 deleted outright -- they cannot survive it."""

    def test_create_merge_no_longer_exists(self, write_service: LodgingWriteService) -> None:
        assert not hasattr(write_service, "create_merge")

    def test_delete_merge_no_longer_exists(self, write_service: LodgingWriteService) -> None:
        assert not hasattr(write_service, "delete_merge")


class TestSetSlotMerge:
    """`set_slot_merge` -- one container's draw level, at a scenario or the weekend.

    Unlike `set_availability`, there is no delete branch: the board only ever
    writes an explicit `true` or `false`, and the absent row means "inherit
    the next tier down". Wiring tests below assert on the actual dict handed
    to the repository, not just that a call happened -- a stale key here
    degrades a write into a partial one silently, the same failure mode
    `test_the_reason_is_stored_in_the_note_column` guards for availability.

    `_slot_merge_request()` defaults to a named scenario;
    `test_a_blank_scenario_creates_a_weekend_level_row` below is the one test
    in this class that overrides it to "" (1500000140) -- everything else
    here is unaffected by that change and stays as it was.
    """

    @pytest.mark.asyncio
    async def test_a_new_merge_creates_a_scenario_scoped_row(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        response = await write_service.set_slot_merge(_slot_merge_request(combined=True))

        repo.create_slot_merge.assert_awaited_once()
        data = repo.create_slot_merge.call_args[0][0]
        assert data["unit"] == "u1"
        assert data["session"] == "sess_1"
        assert data["session_cm_id"] == 1000001
        assert data["year"] == 2026
        assert data["scenario"] == "scn_1"
        assert data["combined"] is True
        repo.update_slot_merge.assert_not_called()
        assert response.record_id == "merge_new"

    @pytest.mark.asyncio
    async def test_an_existing_merge_is_updated_not_duplicated(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        repo.find_slot_merge = AsyncMock(return_value=SimpleNamespace(id="merge_existing"))

        response = await write_service.set_slot_merge(_slot_merge_request(combined=False))

        repo.update_slot_merge.assert_awaited_once()
        record_id, data = repo.update_slot_merge.call_args[0]
        assert record_id == "merge_existing"
        assert data["combined"] is False
        assert data["session_cm_id"] == 1000001
        repo.create_slot_merge.assert_not_called()
        assert response.record_id == "merge_existing"

    @pytest.mark.asyncio
    async def test_a_blank_scenario_creates_a_weekend_level_row(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """1500000140: a blank scenario is a legal, distinct write -- not refused.

        The weekend-level row is stored with `scenario == ""`, an ordinary
        value in idx_lodging_slot_merge_unique like any scenario id, not a
        sentinel this method special-cases or short-circuits around.
        """
        response = await write_service.set_slot_merge(_slot_merge_request(scenario="", combined=True))

        repo.create_slot_merge.assert_awaited_once()
        data = repo.create_slot_merge.call_args[0][0]
        assert data["scenario"] == ""
        assert data["combined"] is True
        repo.update_slot_merge.assert_not_called()
        assert response.record_id == "merge_new"

    @pytest.mark.asyncio
    async def test_find_slot_merge_is_scoped_to_year_session_unit_and_scenario(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The lookup must key on all four columns of the unique index.

        Without the scenario in the lookup, two drafts planning the same
        weekend would read and overwrite each other's draw-level choice.
        """
        await write_service.set_slot_merge(_slot_merge_request())

        repo.find_slot_merge.assert_awaited_once_with(2026, 1000001, "u1", "scn_1")

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", [401, 403])
    async def test_a_refused_merge_create_keeps_its_status(
        self, write_service: LodgingWriteService, repo: MagicMock, status: int
    ) -> None:
        repo.create_slot_merge = AsyncMock(
            side_effect=ClientResponseError(
                "refused", status=status, data={}, url="", is_abort=False, original_error=None
            )
        )
        repo.find_slot_merge = AsyncMock(side_effect=[None, SimpleNamespace(id="merge_other")])

        with pytest.raises(HTTPException) as exc_info:
            await write_service.set_slot_merge(_slot_merge_request())

        assert exc_info.value.status_code == 403
        repo.update_slot_merge.assert_not_called()

    @pytest.mark.asyncio
    async def test_the_unique_index_race_is_recovered_by_updating_the_winner(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """Two staff merge the same house in the same scenario.

        Both find no row and both create; `idx_lodging_slot_merge_unique`
        rejects the loser. The loser re-reads and updates the winner's row,
        which by construction is the row this call wanted.
        """
        repo.create_slot_merge = AsyncMock(
            side_effect=ClientResponseError(
                "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
            )
        )
        repo.find_slot_merge = AsyncMock(side_effect=[None, SimpleNamespace(id="merge_winner")])

        response = await write_service.set_slot_merge(_slot_merge_request(combined=True))

        record_id, data = repo.update_slot_merge.call_args[0]
        assert record_id == "merge_winner"
        assert data["combined"] is True
        assert response.record_id == "merge_existing"

    @pytest.mark.asyncio
    async def test_a_failed_recheck_after_a_lost_merge_race_keeps_its_status(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        repo.create_slot_merge = AsyncMock(
            side_effect=ClientResponseError(
                "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
            )
        )
        repo.find_slot_merge = AsyncMock(side_effect=[None, None])

        with pytest.raises(HTTPException) as exc_info:
            await write_service.set_slot_merge(_slot_merge_request())

        assert exc_info.value.status_code == 400
        repo.update_slot_merge.assert_not_called()


class TestAWriteInIsStoredAsAnOccupancyNotAnAvailability:
    """kindred#2382, PR 2 of 4 -- the WRITE half of the split.

    `lodging_availability.family_available` answered two unrelated questions
    through one boolean. `true` on a staff cabin is a staff<->family ROLE
    override for the weekend -- "we're moving staff to X for weekend Y" -- and
    the owner ruled it is NOT scenario-scoped, so it stays where it is.
    `false` was an OCCUPANCY, somebody is in the room, and that IS
    scenario-scoped, because not every write-in is non-rostered staff: some are
    paper registrations for families arriving with no children, which is a
    modelling choice belonging to the scenario that made it.

    So `PUT /api/lodging/availability` now writes to one of TWO tables
    depending on which question the body is answering. The endpoint, its
    request model and everything a staff member sees are unchanged -- the split
    is behind them, and behavioural parity is the acceptance criterion for this
    PR.

    ONE FACT AT A TIME, exactly as before. A single row per (unit, weekend)
    could only ever hold one of the two, and writing the other replaced it; two
    tables have to keep that promise deliberately, so every write drops the
    other fact.

    Fictional data throughout.
    """

    @pytest.mark.asyncio
    async def test_a_write_in_creates_a_row_in_the_write_in_table(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        await write_service.set_availability(_availability_request(occupant_name="Emma Johnson", reason="Back Monday"))

        repo.create_availability.assert_not_called()
        data = repo.create_write_in.call_args[0][0]
        assert data["unit"] == "u1"
        assert data["session"] == "sess_1"
        # The durable weekend key travels beside the relation (kindred#1879),
        # exactly as it does on every other lodging write.
        assert data["session_cm_id"] == 1000001
        assert data["year"] == 2026
        assert data["occupant_name"] == "Emma Johnson"
        # The API says `reason`; the COLUMN is `note`. The translation moved
        # tables with the fact and did not gain a third site.
        assert data["note"] == "Back Monday"
        # The boolean is what the split REMOVED. A write-in table row IS the
        # occupancy; a column restating it would be the conflation coming back.
        assert "family_available" not in data
        # NO SCENARIO IN THE PAYLOAD, because the request named none. The live
        # table has no such column: the live board is a scope in its own right
        # rather than the absence of one. A request that DOES name a scenario
        # goes to the draft twin instead -- see
        # TestAWriteInInsideAScenarioIsWrittenToTheDraftTable.
        assert "scenario" not in data

    @pytest.mark.asyncio
    async def test_an_existing_write_in_is_updated_not_duplicated(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """One row per (unit, weekend), as `idx_lodging_write_in_unique` says."""
        repo.find_write_in = AsyncMock(return_value=SimpleNamespace(id="write_in_1"))

        response = await write_service.set_availability(_availability_request(occupant_name="Emma Johnson"))

        repo.create_write_in.assert_not_called()
        record_id, data = repo.update_write_in.call_args[0]
        assert record_id == "write_in_1"
        assert data["occupant_name"] == "Emma Johnson"
        assert response.record_id == "write_in_existing"

    @pytest.mark.asyncio
    async def test_a_write_in_drops_any_release_on_the_same_unit(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """One fact at a time, unchanged from the single-row world.

        The release row and the write-in row now live in different tables, so
        nothing removes the loser for us. Left in place, a released staff cabin
        somebody was then written into would carry both facts at once.
        """
        repo.find_availability_override = AsyncMock(return_value=SimpleNamespace(id="avail_1"))

        await write_service.set_availability(_availability_request(occupant_name="Emma Johnson"))

        repo.create_write_in.assert_called_once()
        repo.delete_availability.assert_awaited_once_with("avail_1")

    @pytest.mark.asyncio
    async def test_the_new_fact_is_written_before_the_old_one_is_dropped(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """ORDER, because there is no transaction across two PocketBase tables.

        A failure between the two steps must leave the board saying something
        true. Writing first and dropping second leaves BOTH facts present, and
        the read path resolves occupancy over role -- so a half-applied
        write-in still reads as "somebody is in it", which is the safe half.
        Dropping first would leave a window with neither fact, opening a cabin
        nobody meant to open.
        """
        calls: list[str] = []

        def record_create(_data: dict[str, Any]) -> SimpleNamespace:
            calls.append("create_write_in")
            return SimpleNamespace(id="write_in_new")

        def record_delete(_record_id: str) -> None:
            calls.append("delete_availability")

        repo.find_availability_override = AsyncMock(return_value=SimpleNamespace(id="avail_1"))
        repo.create_write_in = AsyncMock(side_effect=record_create)
        repo.delete_availability = AsyncMock(side_effect=record_delete)

        await write_service.set_availability(_availability_request())

        assert calls == ["create_write_in", "delete_availability"]

    @pytest.mark.asyncio
    async def test_a_release_still_writes_the_availability_row(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The ROLE half does not move. 1500000135's reasoning is right for it.

        "Availability is a fact about the WEEKEND, not about the plan" was
        correct all along for the staff<->family role; what changed is what
        else the column had been asked to carry.
        """
        await write_service.set_availability(_availability_request(family_available=True, reason="Director away"))

        repo.create_write_in.assert_not_called()
        data = repo.create_availability.call_args[0][0]
        assert data["family_available"] is True
        assert data["note"] == "Director away"

    @pytest.mark.asyncio
    async def test_a_release_drops_any_write_in_on_the_same_unit(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The mirror of the write-in case, and the half a sweep would miss."""
        repo.find_write_in = AsyncMock(return_value=SimpleNamespace(id="write_in_1"))

        await write_service.set_availability(_availability_request(family_available=True, reason="Director away"))

        repo.create_availability.assert_called_once()
        repo.delete_write_in.assert_awaited_once_with("write_in_1")

    @pytest.mark.asyncio
    async def test_clearing_removes_both_facts(self, write_service: LodgingWriteService, repo: MagicMock) -> None:
        """`family_available: null` restores the unit's standing role.

        It always meant "delete the row", and there is no value meaning
        "normal". With two tables it means delete BOTH rows: leaving either one
        would have a clear silently do nothing on whichever fact it missed.
        """
        repo.find_write_in = AsyncMock(return_value=SimpleNamespace(id="write_in_1"))
        repo.find_availability_override = AsyncMock(return_value=SimpleNamespace(id="avail_1"))

        response = await write_service.set_availability(_availability_request(family_available=None))

        repo.delete_write_in.assert_awaited_once_with("write_in_1")
        repo.delete_availability.assert_awaited_once_with("avail_1")
        assert response.deleted is True

    @pytest.mark.asyncio
    async def test_clearing_a_unit_that_holds_neither_fact_is_not_an_error(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        response = await write_service.set_availability(_availability_request(family_available=None))

        repo.delete_write_in.assert_not_called()
        repo.delete_availability.assert_not_called()
        assert response.deleted is False
        assert response.record_id == ""

    @pytest.mark.asyncio
    async def test_a_write_in_delete_race_is_not_an_error(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The row can vanish between the find and the delete.

        Two staff clearing the same cabin, or one double-click. ONLY 404 is
        swallowed, exactly as it is on every other delete in this module: "the
        delete was refused" must not read as "there was nothing to delete".
        """
        repo.find_write_in = AsyncMock(return_value=SimpleNamespace(id="write_in_1"))
        repo.delete_write_in = AsyncMock(
            side_effect=ClientResponseError("gone", status=404, data={}, url="", is_abort=False, original_error=None)
        )

        response = await write_service.set_availability(_availability_request(family_available=None))

        assert response.record_id == "write_in_1"
        assert response.deleted is False

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", [401, 403])
    async def test_a_refused_write_in_delete_keeps_its_status(
        self, write_service: LodgingWriteService, repo: MagicMock, status: int
    ) -> None:
        repo.find_write_in = AsyncMock(return_value=SimpleNamespace(id="write_in_1"))
        repo.delete_write_in = AsyncMock(
            side_effect=ClientResponseError(
                "refused", status=status, data={}, url="", is_abort=False, original_error=None
            )
        )

        with pytest.raises(HTTPException) as exc_info:
            await write_service.set_availability(_availability_request(family_available=None))

        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_a_lost_write_in_race_is_still_recovered(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """`idx_lodging_write_in_unique` rejects the loser, exactly as the
        availability index used to -- so the loser re-reads and updates the
        winner's row, which by construction is the row this call wanted."""
        repo.create_write_in = AsyncMock(
            side_effect=ClientResponseError(
                "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
            )
        )
        repo.find_write_in = AsyncMock(side_effect=[None, SimpleNamespace(id="write_in_winner")])

        response = await write_service.set_availability(_availability_request(occupant_name="Emma Johnson"))

        record_id, data = repo.update_write_in.call_args[0]
        assert record_id == "write_in_winner"
        assert data["occupant_name"] == "Emma Johnson"
        assert response.record_id == "write_in_existing"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", [401, 403])
    async def test_a_refused_write_in_create_keeps_its_status(
        self, write_service: LodgingWriteService, repo: MagicMock, status: int
    ) -> None:
        repo.create_write_in = AsyncMock(
            side_effect=ClientResponseError(
                "refused", status=status, data={}, url="", is_abort=False, original_error=None
            )
        )
        repo.find_write_in = AsyncMock(side_effect=[None, SimpleNamespace(id="write_in_other")])

        with pytest.raises(HTTPException) as exc_info:
            await write_service.set_availability(_availability_request())

        assert exc_info.value.status_code == 403
        repo.update_write_in.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_refused_write_in_update_keeps_its_status(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        repo.find_write_in = AsyncMock(return_value=SimpleNamespace(id="write_in_1"))
        repo.update_write_in = AsyncMock(
            side_effect=ClientResponseError("refused", status=403, data={}, url="", is_abort=False, original_error=None)
        )

        with pytest.raises(HTTPException) as exc_info:
            await write_service.set_availability(_availability_request())

        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_the_write_in_lookup_is_keyed_by_campminder_session_id(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """kindred#2042's durable key, on the new table too.

        A camp_sessions row recreated rather than updated gets a new PocketBase
        id; rows keyed on the old one become unreachable. Every lodging lookup
        goes through the CampMinder id for that reason, and the split must not
        quietly introduce one that does not.
        """
        await write_service.set_availability(_availability_request())

        repo.find_write_in.assert_awaited_once_with(2026, 1000001, "u1")


class TestAWriteInInsideAScenarioIsWrittenToTheDraftTable:
    """kindred#2382, PR 4 of 4 -- the WRITE half of the scenario dimension.

    PR 3 made a scenario's write-ins REPLACE the live ones on read. PR 2's
    write path had no scenario at all and always wrote the LIVE occupancy
    table, so between the two a staff member working inside a scenario could
    record a write-in and then not see it on the board they had just made it
    on: the write landed live, and that scenario's own read replaced it away.
    This is the class that closes it.

    THE SPLIT IS THE POINT, and it runs down the middle of one request.
    `scenario` routes the OCCUPANCY half and nothing else. The staff<->family
    ROLE stays on `lodging_availability` whatever the request says, because the
    owner ruled it is not scenario-scoped -- "that's more of a known 'were
    moving staff to X for weekend Y'" -- so a release written from inside a
    scenario is still a fact about the weekend.

    A BLANK `scenario` IS THE LIVE BOARD, not a refusal and not a missing
    value: staff evaluate the real board and must be able to write onto it
    (owner, 2026-08-15). Spelled exactly as `SlotMergeRequest` spells its own
    optional scenario.

    Fictional data throughout.
    """

    @pytest.mark.asyncio
    async def test_a_write_in_naming_a_scenario_creates_a_draft_row(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        await write_service.set_availability(
            _availability_request(scenario="scn_1", occupant_name="Emma Johnson", reason="Back Monday")
        )

        repo.create_write_in.assert_not_called()
        data = repo.create_draft_write_in.call_args[0][0]
        assert data["scenario"] == "scn_1"
        assert data["unit"] == "u1"
        assert data["session"] == "sess_1"
        assert data["session_cm_id"] == 1000001
        assert data["year"] == 2026
        assert data["occupant_name"] == "Emma Johnson"
        assert data["note"] == "Back Monday"
        # The row IS the occupancy on both grains; a column restating it would
        # be the conflation kindred#2382 split apart growing back.
        assert "family_available" not in data

    @pytest.mark.asyncio
    async def test_a_blank_scenario_still_writes_the_live_table(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The live board is a scope in its own right, not the absence of one."""
        await write_service.set_availability(_availability_request(occupant_name="Emma Johnson"))

        repo.create_draft_write_in.assert_not_called()
        data = repo.create_write_in.call_args[0][0]
        assert "scenario" not in data

    @pytest.mark.asyncio
    async def test_a_draft_write_in_carries_both_its_count_and_its_scenario(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """kindred#2503. `party_size` and `scenario` are two independent keys
        merged into the same dict by two independent conditionals -- this
        pins that neither one crowds out the other on the draft grain.
        """
        await write_service.set_availability(_availability_request(scenario="scn_1", party_size=3))

        data = repo.create_draft_write_in.call_args[0][0]
        assert data["party_size"] == 3
        assert data["scenario"] == "scn_1"

    @pytest.mark.asyncio
    async def test_the_draft_lookup_is_keyed_on_the_scenario(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """`idx_lodging_write_in_draft_unique` is (unit, session, year, scenario).

        Looking the row up without the scenario would find another plan's
        write-in and update it, which is the whole failure the draft grain
        exists to prevent.
        """
        await write_service.set_availability(_availability_request(scenario="scn_1"))

        repo.find_draft_write_in.assert_awaited_once_with(2026, 1000001, "scn_1", "u1")
        repo.find_write_in.assert_not_called()

    @pytest.mark.asyncio
    async def test_an_existing_draft_write_in_is_updated_not_duplicated(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        repo.find_draft_write_in = AsyncMock(return_value=SimpleNamespace(id="draft_write_in_1"))

        response = await write_service.set_availability(
            _availability_request(scenario="scn_1", occupant_name="Emma Johnson")
        )

        repo.create_draft_write_in.assert_not_called()
        record_id, data = repo.update_draft_write_in.call_args[0]
        assert record_id == "draft_write_in_1"
        assert data["occupant_name"] == "Emma Johnson"
        assert data["scenario"] == "scn_1"
        assert response.record_id == "draft_write_in_existing"

    @pytest.mark.asyncio
    async def test_the_role_half_stays_on_lodging_availability_inside_a_scenario(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """A release written from inside a scenario is still a WEEKEND fact.

        Owner ruling: staff<->family role is not scenario-scoped. Routing it to
        a draft twin because the caller happened to be looking at a plan is the
        exact mistake the split was designed to avoid.
        """
        await write_service.set_availability(
            _availability_request(scenario="scn_1", family_available=True, reason="Director away")
        )

        repo.create_draft_write_in.assert_not_called()
        data = repo.create_availability.call_args[0][0]
        assert data["family_available"] is True
        assert "scenario" not in data

    @pytest.mark.asyncio
    async def test_a_release_inside_a_scenario_drops_that_scenarios_write_in(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """One fact at a time, resolved IN THE SCOPE the caller is looking at.

        The role row is shared by every scope; the occupancy row is not. So the
        occupancy this drops is the one the caller can see -- reaching into the
        live table from inside a scenario would clear a fact nobody on this
        board is looking at.
        """
        repo.find_draft_write_in = AsyncMock(return_value=SimpleNamespace(id="draft_write_in_1"))

        await write_service.set_availability(
            _availability_request(scenario="scn_1", family_available=True, reason="Director away")
        )

        repo.create_availability.assert_called_once()
        repo.delete_draft_write_in.assert_awaited_once_with("draft_write_in_1")
        repo.delete_write_in.assert_not_called()

    @pytest.mark.asyncio
    async def test_clearing_inside_a_scenario_deletes_the_draft_row_and_the_role_row(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        repo.find_draft_write_in = AsyncMock(return_value=SimpleNamespace(id="draft_write_in_1"))
        repo.find_availability_override = AsyncMock(return_value=SimpleNamespace(id="avail_1"))

        response = await write_service.set_availability(_availability_request(scenario="scn_1", family_available=None))

        repo.delete_draft_write_in.assert_awaited_once_with("draft_write_in_1")
        repo.delete_availability.assert_awaited_once_with("avail_1")
        repo.delete_write_in.assert_not_called()
        assert response.deleted is True

    @pytest.mark.asyncio
    async def test_a_lost_draft_write_in_race_is_recovered_against_the_draft_table(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The recovery re-reads the DRAFT row, not the live one.

        `_upsert_row`'s recovery re-runs the same find it was given; handing it
        the live finder would update a row on the live board after a collision
        in a scenario.
        """
        repo.create_draft_write_in = AsyncMock(
            side_effect=ClientResponseError("dup", status=400, data={}, url="", is_abort=False, original_error=None)
        )
        repo.find_draft_write_in = AsyncMock(side_effect=[None, SimpleNamespace(id="draft_write_in_1")])

        response = await write_service.set_availability(_availability_request(scenario="scn_1"))

        record_id, data = repo.update_draft_write_in.call_args[0]
        assert record_id == "draft_write_in_1"
        assert data["scenario"] == "scn_1"
        assert response.record_id == "draft_write_in_existing"
        repo.update_write_in.assert_not_called()
