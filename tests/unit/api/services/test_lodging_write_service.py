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
    PushExecuteRequest,
    SlotMergeRequest,
    WriteInDeleteRequest,
)
from api.services.lodging_roster_service import SessionNotFoundError
from api.services.lodging_write_service import (
    AlreadyUnpushedError,
    LodgingWriteService,
    PushDecisionsIncompleteError,
    PushDigestStaleError,
    PushNotFoundError,
    ScenarioNotEmptyError,
    UnpushDriftError,
)
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
        # The UNIT-grain read the clear verbs use (kindred#2583 step 7).
        # `find_write_in` answers about one occupant; this answers about the
        # whole cabin, which is what `family_available: null` and a release
        # both have to clear.
        "fetch_write_ins_on_unit": [],
        "fetch_draft_write_ins_on_unit": [],
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
        # kindred#2477's push preview. `fetch_units` is the registry
        # `preview_push` groups write-ins by building against; the ledger
        # trio (`*_push_event`) has no caller yet in this file, but a mock
        # missing them raises AttributeError the moment Task 4 adds one.
        "fetch_units": [],
        "create_push_event": SimpleNamespace(id="push_1"),
        "find_push_event": None,
        "update_push_event": None,
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
        # FIXTURE CORRECTED (kindred#2583 step 6). This default used to carry
        # no occupant at all, which described a row the staff write path can
        # no longer produce: under Design B the occupant's name IS the row's
        # address, so an occupancy write without one is unaddressable and the
        # request model refuses it. The clear and release halves still accept
        # a blank -- they name no occupant -- and the tests that exercise
        # those override this back to "".
        "occupant_name": "Olivia Chen",
        "reason": "Burst pipe",
    }
    fields.update(overrides)
    return AvailabilityWriteRequest(**fields)


def _write_in_delete_request(**overrides: Any) -> WriteInDeleteRequest:
    fields: dict[str, Any] = {
        "year": 2026,
        "session_cm_id": 1000001,
        "unit_id": "u1",
        "occupant_name": "Olivia Chen",
    }
    fields.update(overrides)
    return WriteInDeleteRequest(**fields)


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
            year=2026,
            session_cm_id=1000001,
            unit_id="u1",
            family_available=False,
            # An occupancy names its occupant since kindred#2583 step 6 -- the
            # name is the row's address, not a decoration on it.
            occupant_name="Olivia Chen",
            reason="Burst pipe",
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
        repo.fetch_write_ins_on_unit = AsyncMock(return_value=[SimpleNamespace(id="write_in_1")])

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
        repo.fetch_write_ins_on_unit = AsyncMock(return_value=[SimpleNamespace(id="write_in_1")])

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
        repo.fetch_write_ins_on_unit = AsyncMock(return_value=[SimpleNamespace(id="write_in_1")])
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
        repo.fetch_write_ins_on_unit = AsyncMock(return_value=[SimpleNamespace(id="write_in_1")])
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
        repo.fetch_write_ins_on_unit = AsyncMock(return_value=[SimpleNamespace(id="write_in_1")])
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

        repo.find_write_in.assert_awaited_once_with(2026, 1000001, "u1", "Olivia Chen")


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

        repo.find_draft_write_in.assert_awaited_once_with(2026, 1000001, "scn_1", "u1", "Olivia Chen")
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
        repo.fetch_draft_write_ins_on_unit = AsyncMock(return_value=[SimpleNamespace(id="draft_write_in_1")])

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
        repo.fetch_draft_write_ins_on_unit = AsyncMock(return_value=[SimpleNamespace(id="draft_write_in_1")])
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


class TestAWriteInIsAddressedByItsUnitAndItsOccupant:
    """kindred#2583 step 6, Design B (RULED 2026-08-29).

    Owner: *"lets go with the identity of unit and occupant."* The request
    model keeps its shape -- no record id round-trips to the client -- and
    `(unit_id, occupant_name)` is the key. That single decision settles the
    create-vs-update question this class covers: a write naming an occupant
    the unit already carries is an EDIT of that row; a write naming anybody
    else is a NEW row beside it.

    Before this, `set_availability` resolved the target row BY UNIT and
    `_upsert_row` updated it, so writing a second family into an occupied
    cabin silently overwrote the first -- live in production on all 118
    units, with no warning anywhere on the path.

    DARK UNTIL STEP 8. `idx_lodging_write_in_unique` still forces at most one
    live row per (unit, session_cm_id, year), so the second create these
    tests describe is refused by the schema in production today. What they
    pin is that the API asks the right question the moment the index moves.
    """

    @staticmethod
    def _occupied_by(name: str, record_id: str) -> AsyncMock:
        """A finder that answers about ONE occupant, as the narrowed index does."""
        rows = {name: SimpleNamespace(id=record_id)}
        return AsyncMock(side_effect=lambda year, session_cm_id, unit, occupant: rows.get(occupant))

    @pytest.mark.asyncio
    async def test_the_live_lookup_carries_the_occupant_name(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        await write_service.set_availability(_availability_request(occupant_name="Olivia Chen"))

        repo.find_write_in.assert_awaited_once_with(2026, 1000001, "u1", "Olivia Chen")

    @pytest.mark.asyncio
    async def test_the_draft_lookup_carries_the_occupant_name(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        await write_service.set_availability(_availability_request(scenario="scn_1", occupant_name="Olivia Chen"))

        repo.find_draft_write_in.assert_awaited_once_with(2026, 1000001, "scn_1", "u1", "Olivia Chen")

    @pytest.mark.asyncio
    async def test_a_second_occupant_on_an_occupied_unit_is_created_not_an_edit_of_the_first(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """THE BUG THIS FEATURE EXISTS TO FIX, at the write path.

        A cabin sleeping 15 and classified `shareable` already holds Olivia
        Chen. A staff member writes in Emma Johnson. The occupant-keyed finder
        does not see Chen's row, so the write CREATES beside it rather than
        overwriting it.
        """
        repo.find_write_in = self._occupied_by("Olivia Chen", "wi_chen")

        await write_service.set_availability(_availability_request(occupant_name="Emma Johnson"))

        repo.create_write_in.assert_called_once()
        repo.update_write_in.assert_not_called()
        assert repo.create_write_in.call_args[0][0]["occupant_name"] == "Emma Johnson"

    @pytest.mark.asyncio
    async def test_rewriting_the_same_occupant_still_updates_rather_than_duplicating(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """The surviving half of the old index's intent.

        Two rows describing the SAME occupant differently -- a party of 3 and
        a party of 5, both called Chen -- are a contradiction, not a share.
        The narrowed index still forbids them, and this is the write path
        agreeing with it: editing Chen's count edits Chen's row.
        """
        repo.find_write_in = self._occupied_by("Olivia Chen", "wi_chen")

        await write_service.set_availability(_availability_request(occupant_name="Olivia Chen", party_size=5))

        repo.update_write_in.assert_called_once()
        assert repo.update_write_in.call_args[0][0] == "wi_chen"
        assert repo.update_write_in.call_args[0][1]["party_size"] == 5
        repo.create_write_in.assert_not_called()

    @pytest.mark.asyncio
    async def test_the_lost_race_recovery_re_reads_with_the_same_occupant(
        self, write_service: LodgingWriteService, repo: MagicMock
    ) -> None:
        """`_upsert_row`'s recovery survives Design B unchanged.

        Two staff writing the SAME occupant into the same unit for the same
        weekend both find no row, both create, and the narrowed index rejects
        the loser -- so the loser re-reads and updates the winner's row, which
        by construction is still the row this call wanted: same weekend, same
        unit, same occupant. The re-read has to carry the occupant term too,
        or it adopts a neighbour instead of the winner.
        """
        repo.find_write_in = AsyncMock(side_effect=[None, SimpleNamespace(id="wi_winner")])
        repo.create_write_in = AsyncMock(
            side_effect=ClientResponseError(
                "unique constraint", status=400, data={}, url="", is_abort=False, original_error=None
            )
        )

        await write_service.set_availability(_availability_request(occupant_name="Olivia Chen"))

        assert repo.find_write_in.await_args_list[-1].args == (2026, 1000001, "u1", "Olivia Chen")
        repo.update_write_in.assert_called_once()
        assert repo.update_write_in.call_args[0][0] == "wi_winner"


class TestABlankOccupantIsRefusedOnTheStaffWritePath:
    """kindred#2583 step 6's sub-task, handed down with the Design B ruling.

    `occupant_name` is `Field("", max_length=500)` -- permissive so an ingest
    or a fixture with no author can write, and so the two halves that name
    nobody (a release, a clear) need not invent one. Under the narrowed index
    that permissiveness becomes a collision: two blank-named rows on one unit
    share a key, and neither is addressable by the delete or the edit.

    RULED HERE: refuse a blank on the OCCUPANCY half alone. That is the staff
    write path -- `PUT /api/lodging/availability` is its only caller -- while
    every ingest-shaped writer (`_seed_write_ins`'s two copy paths,
    `execute_push`'s creates, `unpush`'s recreates) goes straight to the
    repository and never builds one of these requests. So the requirement
    lands exactly where a human is typing and nowhere else.
    """

    def test_an_occupancy_write_with_no_occupant_is_refused(self) -> None:
        with pytest.raises(ValidationError, match="occupant_name"):
            _availability_request(occupant_name="")

    def test_whitespace_is_not_a_name(self) -> None:
        """`"   "` addresses nothing. Trimmed, it is the blank above."""
        with pytest.raises(ValidationError, match="occupant_name"):
            _availability_request(occupant_name="   ")

    def test_a_release_still_names_nobody(self) -> None:
        """`family_available: true` is the staff<->family ROLE for the
        weekend, stored in `lodging_availability`, which has no occupant to
        name. Requiring one here would refuse every release."""
        request = _availability_request(family_available=True, occupant_name="")
        assert request.occupant_name == ""

    def test_a_clear_still_names_nobody(self) -> None:
        """`family_available: null` DELETES, so it sends neither field."""
        request = _availability_request(family_available=None, occupant_name="")
        assert request.occupant_name == ""

    @pytest.mark.asyncio
    async def test_a_blank_named_row_still_copies_into_a_scenario(self) -> None:
        """The requirement is on the REQUEST model, not on the column, and
        this is the half that has to be EXERCISED rather than asserted about.

        `_seed_write_ins` copies whatever the source row carries and never
        builds an `AvailabilityWriteRequest`, so a legacy row with no author
        still seeds a scenario. Written as a call rather than as an assertion
        about the service's attributes: a shape check would pass with the
        validator deleted, and would therefore pin nothing.
        """
        repo = _repo()
        service = LodgingWriteService(repo)

        copied = await service._seed_write_ins(
            rows=[SimpleNamespace(unit="u1", occupant_name="", note="", party_size=None)],
            session_pb_id="sess_1",
            session_cm_id=1000001,
            year=2026,
            scenario="scn_1",
        )

        assert copied == 1
        assert repo.create_draft_write_in.call_args[0][0]["occupant_name"] == ""

    @pytest.mark.asyncio
    async def test_a_blank_named_row_still_pushes(self) -> None:
        """`execute_push` writes from the ledger it just classified, not
        through the request model, so the same legacy row still reaches the
        live board."""
        repo = _repo(
            fetch_units=[_u("uc", "cedar-9")],
            fetch_draft_write_ins=[_wi("uc", "", ppl=None, id="wd_blank")],
            create_push_event=SimpleNamespace(id="push_1"),
        )
        svc = LodgingWriteService(repo)
        preview = await svc.preview_push(2026, 1309001, "scn_1")

        out = await svc.execute_push(
            PushExecuteRequest(year=2026, session_cm_id=1309001, scenario="scn_1", digest=preview.digest, decisions={}),
            pushed_by="user_1",
        )

        assert out.added == 1
        assert repo.create_write_in.call_args[0][0]["occupant_name"] == ""


class TestClearingAUnitClearsEveryOccupantOnIt:
    """kindred#2583 step 7. `family_available: null` stays the
    CLEAR-THIS-UNIT-ENTIRELY verb.

    With one row that is exactly what it means today, so the boundary does
    not move. With N it must delete them ALL: deleting an arbitrary one would
    leave the cabin half-cleared, and coupling the role row's fate to
    whichever occupancy row the finder happened to return is worse still.

    The same argument covers a RELEASE. `family_available: true` advertises
    the unit to families; leaving one of two occupants standing under it
    would publish a cabin as open with somebody in it.

    ⚠️ OQ-8 is an owner-confirmable decision. This is the spec's recommended
    shape -- verify against staff expectation -- and it stays cheap to revise
    because the whole feature is dark until step 8.
    """

    @pytest.mark.asyncio
    async def test_a_clear_deletes_every_occupancy_row_on_the_unit(self) -> None:
        repo = _repo(
            fetch_write_ins_on_unit=[SimpleNamespace(id="wi_chen"), SimpleNamespace(id="wi_johnson")],
            find_availability_override=SimpleNamespace(id="avail_1"),
        )
        service = LodgingWriteService(repo)

        response = await service.set_availability(_availability_request(family_available=None))

        deleted = [call.args[0] for call in repo.delete_write_in.call_args_list]
        assert sorted(deleted) == ["wi_chen", "wi_johnson"]
        repo.delete_availability.assert_called_once_with("avail_1")
        assert response.deleted is True

    @pytest.mark.asyncio
    async def test_a_clear_inside_a_scenario_clears_that_scenarios_rows_only(self) -> None:
        repo = _repo(
            fetch_draft_write_ins_on_unit=[SimpleNamespace(id="wd_chen"), SimpleNamespace(id="wd_johnson")],
        )
        service = LodgingWriteService(repo)

        await service.set_availability(_availability_request(family_available=None, scenario="scn_1"))

        deleted = [call.args[0] for call in repo.delete_draft_write_in.call_args_list]
        assert sorted(deleted) == ["wd_chen", "wd_johnson"]
        repo.delete_write_in.assert_not_called()
        repo.fetch_draft_write_ins_on_unit.assert_awaited_once_with(2026, 1000001, "scn_1", "u1")

    @pytest.mark.asyncio
    async def test_a_release_drops_every_occupant_it_opens_the_unit_over(self) -> None:
        repo = _repo(fetch_write_ins_on_unit=[SimpleNamespace(id="wi_chen"), SimpleNamespace(id="wi_johnson")])
        service = LodgingWriteService(repo)

        await service.set_availability(_availability_request(family_available=True, occupant_name=""))

        deleted = [call.args[0] for call in repo.delete_write_in.call_args_list]
        assert sorted(deleted) == ["wi_chen", "wi_johnson"]
        repo.create_availability.assert_called_once()

    @pytest.mark.asyncio
    async def test_a_release_reads_the_occupants_after_the_role_row_lands(self) -> None:
        """The read-to-drop window is where a cabin ends up advertised to
        families with somebody in it -- "the worst of the three outcomes
        available here", by this branch's own comment.

        A write-in created between the read and the drop survives the
        release, so the read belongs AFTER the role write rather than before
        it: everything the release is responsible for opening is then in
        front of it, and the window is the drop alone rather than the whole
        role round trip plus the drop.
        """
        order: list[str] = []

        async def _role(data: dict[str, Any]) -> SimpleNamespace:
            order.append("role")
            return SimpleNamespace(id="av_1")

        async def _read(*_args: Any) -> list[Any]:
            order.append("read")
            return []

        repo = _repo()
        repo.create_availability = AsyncMock(side_effect=_role)
        repo.fetch_write_ins_on_unit = AsyncMock(side_effect=_read)
        service = LodgingWriteService(repo)

        await service.set_availability(_availability_request(family_available=True, occupant_name=""))

        assert order == ["role", "read"]

    @pytest.mark.asyncio
    async def test_the_clear_never_asks_the_occupant_keyed_finder(self) -> None:
        """The tell that this is a UNIT-grain verb.

        `find_write_in` answers "is THIS occupant here?"; a clear does not
        name one. Routing a clear through it is how one of two occupants
        survives a cleared cabin.
        """
        repo = _repo(fetch_write_ins_on_unit=[SimpleNamespace(id="wi_chen")])
        service = LodgingWriteService(repo)

        await service.set_availability(_availability_request(family_available=None))

        repo.find_write_in.assert_not_called()

    @pytest.mark.asyncio
    async def test_clearing_a_unit_that_holds_nothing_is_still_not_an_error(self) -> None:
        repo = _repo()
        service = LodgingWriteService(repo)

        response = await service.set_availability(_availability_request(family_available=None))

        assert response.deleted is False
        assert response.record_id == ""
        repo.delete_write_in.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_delete_race_partway_through_a_clear_is_not_an_error(self) -> None:
        """Two staff clearing the same cabin. ONLY 404 is swallowed, per
        `_clear_row`, and one row vanishing must not abandon the rest."""
        repo = _repo(fetch_write_ins_on_unit=[SimpleNamespace(id="wi_chen"), SimpleNamespace(id="wi_johnson")])
        repo.delete_write_in = AsyncMock(
            side_effect=[
                ClientResponseError("gone", status=404, data={}, url="", is_abort=False, original_error=None),
                None,
            ]
        )
        service = LodgingWriteService(repo)

        response = await service.set_availability(_availability_request(family_available=None))

        assert [call.args[0] for call in repo.delete_write_in.call_args_list] == ["wi_chen", "wi_johnson"]
        assert response.deleted is True

    @pytest.mark.asyncio
    async def test_a_refused_delete_during_a_clear_keeps_its_status(self) -> None:
        repo = _repo(fetch_write_ins_on_unit=[SimpleNamespace(id="wi_chen")])
        repo.delete_write_in = AsyncMock(
            side_effect=ClientResponseError(
                "forbidden", status=403, data={}, url="", is_abort=False, original_error=None
            )
        )
        service = LodgingWriteService(repo)

        with pytest.raises(HTTPException) as exc:
            await service.set_availability(_availability_request(family_available=None))
        assert exc.value.status_code == 403


class TestRemovingOneOccupantLeavesTheRestAlone:
    """kindred#2583 step 7's other half: the ROW-ADDRESSED delete.

    `family_available: null` clears the unit. "Take Chen out of the shared
    cabin and leave Johnson where she is" needs a verb that names the row, and
    under Design B that name is `(unit_id, occupant_name)`.

    Shaped on `DELETE /api/lodging/placements` (kindred#1974): a
    body-carrying DELETE on the collection, addressed by identity rather than
    by a resource id the client does not hold.

    ⚠️ OQ-8. The spec marks this "verify against staff expectation before
    building"; this is the recommended shape and it is cheap to revise while
    the feature is dark.
    """

    @pytest.mark.asyncio
    async def test_the_addressed_row_is_deleted(self) -> None:
        repo = _repo(find_write_in=SimpleNamespace(id="wi_chen"))
        service = LodgingWriteService(repo)

        response = await service.remove_write_in(_write_in_delete_request(occupant_name="Olivia Chen"))

        repo.find_write_in.assert_awaited_once_with(2026, 1000001, "u1", "Olivia Chen")
        repo.delete_write_in.assert_called_once_with("wi_chen")
        assert response.record_id == "wi_chen"
        assert response.deleted is True

    @pytest.mark.asyncio
    async def test_the_role_row_is_left_standing(self) -> None:
        """Removing an occupant is not releasing the cabin.

        A staff<->family role override is a fact about the WEEKEND; taking
        one paper family out of a shared cabin says nothing about it. Only
        `family_available: null` clears both.
        """
        repo = _repo(find_write_in=SimpleNamespace(id="wi_chen"), find_availability_override=SimpleNamespace(id="av_1"))
        service = LodgingWriteService(repo)

        await service.remove_write_in(_write_in_delete_request())

        repo.delete_availability.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_co_occupant_is_left_standing(self) -> None:
        """The occupant-keyed finder is the whole mechanism: it resolves one
        record id, and only that record is deleted."""
        repo = _repo(find_write_in=SimpleNamespace(id="wi_chen"))
        service = LodgingWriteService(repo)

        await service.remove_write_in(_write_in_delete_request(occupant_name="Olivia Chen"))

        assert [call.args[0] for call in repo.delete_write_in.call_args_list] == ["wi_chen"]
        repo.fetch_write_ins_on_unit.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_scenario_removes_from_the_draft_table(self) -> None:
        repo = _repo(find_draft_write_in=SimpleNamespace(id="wd_chen"))
        service = LodgingWriteService(repo)

        await service.remove_write_in(_write_in_delete_request(scenario="scn_1"))

        repo.find_draft_write_in.assert_awaited_once_with(2026, 1000001, "scn_1", "u1", "Olivia Chen")
        repo.delete_draft_write_in.assert_called_once_with("wd_chen")
        repo.delete_write_in.assert_not_called()

    @pytest.mark.asyncio
    async def test_removing_an_occupant_who_is_not_there_is_not_an_error(self) -> None:
        """Idempotent, the same way `unplace_party` is: the absence of the row
        IS the state the caller asked for."""
        repo = _repo()
        service = LodgingWriteService(repo)

        response = await service.remove_write_in(_write_in_delete_request())

        assert (response.record_id, response.deleted) == ("", False)
        repo.delete_write_in.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_delete_race_is_swallowed_the_same_way_a_clear_is(self) -> None:
        repo = _repo(find_write_in=SimpleNamespace(id="wi_chen"))
        repo.delete_write_in = AsyncMock(
            side_effect=ClientResponseError("gone", status=404, data={}, url="", is_abort=False, original_error=None)
        )
        service = LodgingWriteService(repo)

        response = await service.remove_write_in(_write_in_delete_request())

        assert response.deleted is False
        assert response.record_id == "wi_chen"

    @pytest.mark.asyncio
    async def test_a_refused_delete_keeps_its_status(self) -> None:
        repo = _repo(find_write_in=SimpleNamespace(id="wi_chen"))
        repo.delete_write_in = AsyncMock(
            side_effect=ClientResponseError(
                "forbidden", status=403, data={}, url="", is_abort=False, original_error=None
            )
        )
        service = LodgingWriteService(repo)

        with pytest.raises(HTTPException) as exc:
            await service.remove_write_in(_write_in_delete_request())
        assert exc.value.status_code == 403

    def test_the_request_refuses_a_blank_occupant(self) -> None:
        """A blank name addresses nothing, so this verb cannot be spelled
        without one. `family_available: null` is the verb that names no
        occupant."""
        with pytest.raises(ValidationError):
            _write_in_delete_request(occupant_name="")

    def test_the_request_refuses_a_whitespace_occupant(self) -> None:
        with pytest.raises(ValidationError):
            _write_in_delete_request(occupant_name="  ")

    @pytest.mark.asyncio
    async def test_an_unknown_weekend_is_a_404_not_a_quiet_no_op(self) -> None:
        """The same guard `unplace_party` makes, for the same reason.

        Nothing on this path needs the session's PocketBase id -- every
        lookup keys on `session_cm_id` (kindred#2042). But an unknown or
        non-weekend cm_id must be refused rather than reported as "there was
        nothing to remove", which is the answer every other outcome here
        gives and would be indistinguishable from success.
        """
        repo = _repo(fetch_session=None)
        service = LodgingWriteService(repo)

        with pytest.raises(SessionNotFoundError):
            await service.remove_write_in(_write_in_delete_request())
        repo.delete_write_in.assert_not_called()

    def test_a_blank_scenario_is_the_live_board(self) -> None:
        """Same steering as every other write on this surface: blank is a
        scope in its own right, not a missing value."""
        assert _write_in_delete_request().scenario == ""


def _indexed_write_in_repo(
    rows: list[SimpleNamespace], *, narrowed: bool = False, draft: bool = False
) -> tuple[MagicMock, list[SimpleNamespace]]:
    """A `_repo()` whose write-in table actually ENFORCES the unique index.

    The `MagicMock` repo the rest of this file uses enforces nothing, which
    is the blind spot kindred#2477's Task 10 found with a live PocketBase and
    which `_StatefulWriteInRepo` below already closes for `unpush`. The staff
    write path needs the same instrument for the same reason: whether
    `set_availability` resolves a row it must UPDATE is only answerable
    against a store that refuses the create it would otherwise fall back on.

    `narrowed=False` is TODAY'S index, `(session_cm_id, year, unit)` --
    `1500000161:208`, still in the tree because kindred#2583 step 8 is the
    on-switch and has not landed. `narrowed=True` is what step 8 makes it,
    `(session_cm_id, year, unit, occupant_name)`, and it is here so the
    pre-step-8 behaviour below can be shown to RETIRE rather than merely be
    unused.
    """
    store = list(rows)
    key = "u1"

    def collides(data: dict[str, Any]) -> bool:
        for row in store:
            if row.unit != data["unit"]:
                continue
            if narrowed and row.occupant_name != data["occupant_name"]:
                continue
            return True
        return False

    async def _find(*args: Any) -> SimpleNamespace | None:
        unit, occupant = args[-2], args[-1]
        return next((r for r in store if r.unit == unit and r.occupant_name == occupant), None)

    async def _fetch_on_unit(*args: Any) -> list[SimpleNamespace]:
        return [r for r in store if r.unit == args[-1]]

    async def _create(data: dict[str, Any]) -> SimpleNamespace:
        if collides(data):
            raise ClientResponseError(
                "validation_not_unique", status=400, data={}, url="", is_abort=False, original_error=None
            )
        row = SimpleNamespace(
            id=f"wi_new_{len(store)}",
            unit=data["unit"],
            occupant_name=data["occupant_name"],
            note=data["note"],
            party_size=data.get("party_size"),
        )
        store.append(row)
        return row

    async def _update(record_id: str, data: dict[str, Any]) -> SimpleNamespace:
        row = next(r for r in store if r.id == record_id)
        row.occupant_name = data["occupant_name"]
        row.note = data["note"]
        row.party_size = data.get("party_size")
        return row

    repo = _repo()
    if draft:
        repo.find_draft_write_in = AsyncMock(side_effect=_find)
        repo.fetch_draft_write_ins_on_unit = AsyncMock(side_effect=_fetch_on_unit)
        repo.create_draft_write_in = AsyncMock(side_effect=_create)
        repo.update_draft_write_in = AsyncMock(side_effect=_update)
    else:
        repo.find_write_in = AsyncMock(side_effect=_find)
        repo.fetch_write_ins_on_unit = AsyncMock(side_effect=_fetch_on_unit)
        repo.create_write_in = AsyncMock(side_effect=_create)
        repo.update_write_in = AsyncMock(side_effect=_update)
    assert key == "u1"
    return repo, store


class TestTheOccupantKeyDoesNotBreakTheUnitGrainIndexItStillRunsUnder:
    """kindred#2583 step 6 is only DARK if the still-unnarrowed index agrees.

    Step 6 re-keys the occupancy lookup onto `(unit, occupant_name)` while
    `idx_lodging_write_in_unique` is still `(session_cm_id, year, unit)`
    (`1500000161:208`) -- step 8 is the on-switch and lands last. Between the
    two, a write whose occupant name does NOT match the unit's one row misses
    the lookup, CREATES, and the unit-grain index refuses the create. There
    is no second row for the occupant-keyed re-read to adopt, so
    `_upsert_row` re-raises and a write that worked yesterday answers 400.

    TWO STAFF ACTIONS REACH THAT, and neither is exotic:

    1. RENAMING an occupant -- `WriteInCard`'s pencil seeds its Occupant
       field from the row and lets a staff member edit it, and correcting a
       typed name is the ordinary use of an edit form.
    2. The ACKNOWLEDGED REPLACE -- `AssignFamilyModal` writing a different
       family into an occupied cabin. kindred#2594 step 0 ruled that a
       WARNING naming who would be replaced, explicitly *"a warning, not a
       refusal"*, following kindred#2432. A bare 400 makes it a refusal, and
       an opaque one.

    So these pin the boundary the PR claims not to move. `MagicMock` alone
    cannot: it accepts every create, so the collision never happens and the
    tests go green on a path production answers 400 on.
    """

    @pytest.mark.asyncio
    async def test_renaming_the_occupant_of_the_only_row_still_edits_that_row(self) -> None:
        repo, store = _indexed_write_in_repo(
            [SimpleNamespace(id="wi_chen", unit="u1", occupant_name="Olivia Chen", note="", party_size=3)]
        )
        service = LodgingWriteService(repo)

        await service.set_availability(_availability_request(occupant_name="Olivia Chen-Whitfield", party_size=3))

        assert [(r.id, r.occupant_name) for r in store] == [("wi_chen", "Olivia Chen-Whitfield")]

    @pytest.mark.asyncio
    async def test_the_acknowledged_replace_still_lands_rather_than_answering_400(self) -> None:
        """kindred#2594 step 0's warning stays a warning."""
        repo, store = _indexed_write_in_repo(
            [SimpleNamespace(id="wi_chen", unit="u1", occupant_name="Olivia Chen", note="", party_size=3)]
        )
        service = LodgingWriteService(repo)

        await service.set_availability(_availability_request(occupant_name="Emma Johnson", party_size=2))

        assert [(r.id, r.occupant_name, r.party_size) for r in store] == [("wi_chen", "Emma Johnson", 2)]

    @pytest.mark.asyncio
    async def test_renaming_inside_a_scenario_still_edits_the_draft_row(self) -> None:
        """`idx_lodging_write_in_draft_unique` is the same shape plus
        `scenario` (`1500000161:251`), so the draft half breaks identically
        and has to be fixed by the same bound group."""
        repo, store = _indexed_write_in_repo(
            [SimpleNamespace(id="wd_chen", unit="u1", occupant_name="Olivia Chen", note="", party_size=3)], draft=True
        )
        service = LodgingWriteService(repo)

        await service.set_availability(
            _availability_request(scenario="scn_1", occupant_name="Olivia Chen-Whitfield", party_size=3)
        )

        assert [(r.id, r.occupant_name) for r in store] == [("wd_chen", "Olivia Chen-Whitfield")]

    @pytest.mark.asyncio
    async def test_a_refusal_during_the_recovery_is_still_a_refusal(self) -> None:
        """The bridge must not turn a 401/403 into an adopted neighbour.

        `REFUSAL_STATUSES` short-circuit before any re-read, and widening the
        recovery must not reach past them.
        """
        repo, _ = _indexed_write_in_repo(
            [SimpleNamespace(id="wi_chen", unit="u1", occupant_name="Olivia Chen", note="", party_size=3)]
        )
        repo.create_write_in = AsyncMock(
            side_effect=ClientResponseError(
                "forbidden", status=403, data={}, url="", is_abort=False, original_error=None
            )
        )
        service = LodgingWriteService(repo)

        with pytest.raises(HTTPException) as exc:
            await service.set_availability(_availability_request(occupant_name="Emma Johnson"))
        assert exc.value.status_code == 403
        repo.update_write_in.assert_not_called()

    @pytest.mark.asyncio
    async def test_under_the_narrowed_index_a_new_occupant_creates_beside_the_first(self) -> None:
        """AND THE BRIDGE RETIRES ITSELF, which is what makes it safe to add.

        Once step 8 keys the index on `(unit, occupant_name)`, the only
        create it can refuse is one bearing a name the occupant-keyed lookup
        would already have found -- so the unit-grain fallback is
        unreachable, not merely unused. Here the create succeeds outright and
        the neighbour is untouched: two write-ins in one shareable cabin,
        which is the feature.
        """
        repo, store = _indexed_write_in_repo(
            [SimpleNamespace(id="wi_chen", unit="u1", occupant_name="Olivia Chen", note="", party_size=3)],
            narrowed=True,
        )
        service = LodgingWriteService(repo)

        await service.set_availability(_availability_request(occupant_name="Emma Johnson", party_size=2))

        assert sorted((r.occupant_name, r.party_size) for r in store) == [
            ("Emma Johnson", 2),
            ("Olivia Chen", 3),
        ]
        repo.update_write_in.assert_not_called()

    @pytest.mark.asyncio
    async def test_under_the_narrowed_index_the_same_occupant_still_recovers_a_lost_race(self) -> None:
        """The genuine race the recovery was written for, unchanged."""
        repo, store = _indexed_write_in_repo(
            [SimpleNamespace(id="wi_chen", unit="u1", occupant_name="Olivia Chen", note="", party_size=3)],
            narrowed=True,
        )
        # The find misses (the winner's row lands between the find and the
        # create), the create then collides, and the re-read adopts it.
        first = repo.find_write_in.side_effect
        calls = {"n": 0}

        async def _miss_once(*args: Any) -> SimpleNamespace | None:
            calls["n"] += 1
            if calls["n"] == 1:
                return None
            return await first(*args)

        repo.find_write_in = AsyncMock(side_effect=_miss_once)
        service = LodgingWriteService(repo)

        await service.set_availability(_availability_request(occupant_name="Olivia Chen", party_size=5))

        assert [(r.id, r.party_size) for r in store] == [("wi_chen", 5)]


def _wi(unit: str, occ: str, note: str = "", ppl: int | None = None, id: str = "wi_x") -> SimpleNamespace:
    return SimpleNamespace(
        id=id, unit=unit, occupant_name=occ, note=note, party_size=ppl, session_cm_id=1309001, year=2026
    )


def _u(
    id: str,
    code: str,
    name: str | None = None,
    container: bool = False,
    parent: str = "",
    sleeps: int = 4,
    active: bool = True,
) -> SimpleNamespace:
    return SimpleNamespace(
        id=id,
        code=code,
        name=name or code,
        is_container=container,
        parent_unit=parent,
        sleeps=sleeps,
        is_active=active,
    )


class TestPreviewPush:
    """kindred#2477. `preview_push` classifies the live board against a
    scenario's draft write-ins and reports the diff, building by building.
    """

    @pytest.mark.asyncio
    async def test_classifies_and_carries_digest(self) -> None:
        repo = _repo(
            fetch_units=[_u("uh", "big-house", container=True), _u("u1", "room-1", parent="uh")],
            fetch_write_ins=[_wi("u1", "R. Okafor", id="wi_1")],
            fetch_draft_write_ins=[_wi("uh", "Woodson family", ppl=6, id="wd_1")],
        )
        svc = LodgingWriteService(repo)
        out = await svc.preview_push(2026, 1309001, "scn_1")
        assert [b.cls for b in out.buildings] == ["conflict"]
        assert out.buildings[0].key == "big-house"
        assert out.digest
        assert len(out.digest) == 64
        # kindred#2477 final review, Important #4: the container's OWN
        # `sleeps` (4, kindred#2041's delta) plus its one active leaf room's
        # `sleeps` (4) -- the roster's effective whole-house capacity, the
        # same figure `write_in_covers` publishes, not the raw column alone.
        # `test_a_combined_containers_sleeps_is_the_effective_capacity_...`
        # below pins this with deliberately non-coincidental numbers.
        assert out.buildings[0].draft[0].sleeps == 8

    @pytest.mark.asyncio
    async def test_a_combined_containers_sleeps_is_the_effective_capacity_not_the_raw_delta(self) -> None:
        """kindred#2477 final review, Important #4. A combined container's
        OWN `sleeps` column is a DELTA over its rooms (kindred#2041's
        ruling) and reads 0 on every production container --
        `write_in_covers` publishes the WHOLE-HOUSE total instead (the
        effective-capacity walk `_capacity_by_code`/`_effective_sleeps` in
        `lodging_roster_service` do), and this preview must publish the same
        figure a push review is comparing bed counts against, not the raw
        column.

        Numbers are deliberately NON-coincidental: the container's own delta
        is 0, and the two rooms carry 3 and 5 -- distinct from each other and
        from the buggy answer (0), so a regression back to reading the raw
        column reads 0 rather than accidentally matching the right answer.
        """
        repo = _repo(
            fetch_units=[
                _u("uh", "big-house", container=True, sleeps=0),
                _u("u1", "room-1", parent="uh", sleeps=3),
                _u("u2", "room-2", parent="uh", sleeps=5),
            ],
            fetch_write_ins=[_wi("u1", "R. Okafor", id="wi_1")],
            fetch_draft_write_ins=[_wi("uh", "Woodson family", ppl=6, id="wd_1")],
        )
        svc = LodgingWriteService(repo)
        out = await svc.preview_push(2026, 1309001, "scn_1")
        assert out.buildings[0].draft[0].sleeps == 8  # 0 (delta) + 3 + 5, not the raw 0

    @pytest.mark.asyncio
    async def test_scenario_is_required(self) -> None:
        svc = LodgingWriteService(_repo())
        with pytest.raises(ValueError):
            await svc.preview_push(2026, 1309001, "")

    @pytest.mark.asyncio
    async def test_unset_party_size_reads_as_wholesale_not_zero(self) -> None:
        """CodeRabbit fix-round finding (2026-08-23, PR #2555 comment 1).
        PocketBase declares `party_size` `NUMERIC DEFAULT 0 NOT NULL`, so an
        unset write-in reads back as literal `0`, never SQL NULL --
        `_i_or_none`'s docstring in lodging_roster_service.py documents this
        exact trap, and `write_in_covers` already routes through it. `_push_rows`
        must normalize identically: a raw `getattr` would treat PocketBase's 0
        as a recorded party of nobody, producing a false "0 of N beds" line
        instead of "wholesale -- all N beds" and a false conflict against a
        scenario row that genuinely recorded a count.
        """
        repo = _repo(
            fetch_units=[_u("uc", "cedar-9")],
            fetch_write_ins=[_wi("uc", "G. Whitfield", ppl=0, id="wi_1")],
            fetch_draft_write_ins=[],
        )
        svc = LodgingWriteService(repo)
        out = await svc.preview_push(2026, 1309001, "scn_1")
        assert out.buildings[0].cls == "remove"
        assert out.buildings[0].live[0].party_size is None


class TestExecutePush:
    """kindred#2477 Task 4. `execute_push` writes the ledger BEFORE applying,
    refuses a stale digest with a fresh report, and refuses to apply until
    every conflict/remove has a decision -- no default-keep-live path.
    """

    def _repo_one_conflict(self) -> MagicMock:
        return _repo(
            fetch_units=[_u("uc", "cedar-9")],
            fetch_write_ins=[_wi("uc", "G. Whitfield", id="wi_1")],
            fetch_draft_write_ins=[_wi("uc", "H. Osei", ppl=2, id="wd_1")],
            create_push_event=SimpleNamespace(id="push_1"),
        )

    @pytest.mark.asyncio
    async def test_stale_digest_refuses_with_fresh_report(self) -> None:
        svc = LodgingWriteService(self._repo_one_conflict())
        req = PushExecuteRequest(
            year=2026,
            session_cm_id=1309001,
            scenario="scn_1",
            digest="0" * 64,
            decisions={"cedar-9": "scenario"},
        )
        with pytest.raises(PushDigestStaleError) as exc:
            await svc.execute_push(req, pushed_by="user_1")
        assert exc.value.report.buildings[0].cls == "conflict"

    @pytest.mark.asyncio
    async def test_incomplete_decisions_refuse(self) -> None:
        svc = LodgingWriteService(self._repo_one_conflict())
        preview = await svc.preview_push(2026, 1309001, "scn_1")
        req = PushExecuteRequest(
            year=2026, session_cm_id=1309001, scenario="scn_1", digest=preview.digest, decisions={}
        )
        with pytest.raises(PushDecisionsIncompleteError):
            await svc.execute_push(req, pushed_by="user_1")

    @pytest.mark.asyncio
    async def test_take_scenario_writes_ledger_then_applies_with_party_size(self) -> None:
        repo = self._repo_one_conflict()
        svc = LodgingWriteService(repo)
        preview = await svc.preview_push(2026, 1309001, "scn_1")
        req = PushExecuteRequest(
            year=2026,
            session_cm_id=1309001,
            scenario="scn_1",
            digest=preview.digest,
            decisions={"cedar-9": "scenario"},
        )
        out = await svc.execute_push(req, pushed_by="user_1")
        assert (out.added, out.removed, out.replaced) == (1, 1, 1)
        # ledger written BEFORE apply, with both directions
        ledger = repo.create_push_event.call_args.args[0]
        actions = sorted(c["action"] for c in ledger["changes"])
        assert actions == ["add", "remove"]
        # party_size EXPLICIT on the created live row -- the #2540 fifth-producer
        # hazard. Mutation check in Step 4.
        created = repo.create_write_in.call_args.args[0]
        assert "party_size" in created
        assert created["party_size"] == 2
        repo.delete_write_in.assert_called_once_with("wi_1")

    @pytest.mark.asyncio
    async def test_ledger_write_precedes_the_apply_calls(self) -> None:
        """Fix-round finding (2026-08-23): the ledger comment claims
        "ledger FIRST, then apply", but the earlier version of this test only
        checked ledger CONTENTS and that delete/create were called at all --
        `_repo()`'s independent AsyncMocks never captured cross-method call
        ORDER, so a reordered implementation could still pass it. Attaching
        the three calls that matter to one parent mock makes the order
        observable.
        """
        repo = self._repo_one_conflict()
        order = MagicMock()
        order.attach_mock(repo.create_push_event, "create_push_event")
        order.attach_mock(repo.delete_write_in, "delete_write_in")
        order.attach_mock(repo.create_write_in, "create_write_in")
        svc = LodgingWriteService(repo)
        preview = await svc.preview_push(2026, 1309001, "scn_1")
        req = PushExecuteRequest(
            year=2026,
            session_cm_id=1309001,
            scenario="scn_1",
            digest=preview.digest,
            decisions={"cedar-9": "scenario"},
        )
        await svc.execute_push(req, pushed_by="user_1")
        names = [call[0] for call in order.mock_calls]
        ledger_index = names.index("create_push_event")
        apply_indices = [i for i, name in enumerate(names) if name in ("delete_write_in", "create_write_in")]
        assert apply_indices, "expected at least one delete_write_in/create_write_in call"
        assert ledger_index < min(apply_indices)

    @pytest.mark.asyncio
    async def test_vanished_session_refuses_before_the_ledger_write(self) -> None:
        """CodeRabbit fix-round finding (2026-08-23, PR #2555 comment 2).
        `SessionsSync` orphan-deletes `camp_sessions` rows while lodging rows
        keep `session_cm_id` (docs/architecture/sync-layer.md), so a push can
        be classified against a weekend whose session record is already gone.
        Resolving the session AFTER `create_push_event` would leave a ledger
        row describing changes that then 404 and never apply -- and because
        the drift guard requires every `add` in the ledger to still be
        present on the live board, that orphan row could never be unpushed.
        The session lookup must run BEFORE the ledger write, refusing with
        nothing written.
        """
        repo = self._repo_one_conflict()
        repo.fetch_session = AsyncMock(side_effect=SessionNotFoundError("No weekend session 1309001 in 2026"))
        svc = LodgingWriteService(repo)
        preview = await svc.preview_push(2026, 1309001, "scn_1")
        req = PushExecuteRequest(
            year=2026,
            session_cm_id=1309001,
            scenario="scn_1",
            digest=preview.digest,
            decisions={"cedar-9": "scenario"},
        )
        with pytest.raises(SessionNotFoundError):
            await svc.execute_push(req, pushed_by="user_1")
        repo.create_push_event.assert_not_called()
        repo.delete_write_in.assert_not_called()
        repo.create_write_in.assert_not_called()

    @pytest.mark.asyncio
    async def test_vanished_live_row_refuses_the_push_instead_of_lying(self) -> None:
        """Fix-round finding (2026-08-23): `preview_push` (inside `execute_push`)
        and `_live_rows_with_ids` are TWO INDEPENDENT reads of `fetch_write_ins`,
        so a row `fresh` already classified as removable can be gone by the
        time `_live_rows_with_ids` looks for its record id -- another caller
        deleted it in the gap between the two fetches. `fetch_write_ins` is
        given a `side_effect` list so the SECOND call (inside `execute_push`'s
        own `preview_push`) still agrees with the digest computed by the
        FIRST (both see the live row), but the THIRD call
        (`_live_rows_with_ids`) sees it gone -- reproducing the race without
        touching a real PocketBase.

        A silent skip here would let `removed` and the ledger both claim a
        delete that never happened; the ruling is to refuse the whole push
        instead, exactly as a stale digest does, and write no ledger row.
        """
        live_present = [_wi("uc", "G. Whitfield", id="wi_1")]
        repo = _repo(
            fetch_units=[_u("uc", "cedar-9")],
            fetch_draft_write_ins=[_wi("uc", "H. Osei", ppl=2, id="wd_1")],
            create_push_event=SimpleNamespace(id="push_1"),
        )
        # 1st call: this test's own preview_push (for `preview.digest`).
        # 2nd call: execute_push's internal re-preview -- same live state, so
        #           the digest check passes and execution proceeds.
        # 3rd call: _live_rows_with_ids -- the row is gone.
        # 4th call: execute_push's OWN re-preview once the miss is found, to
        #           build the fresh report PushDigestStaleError carries.
        repo.fetch_write_ins = AsyncMock(side_effect=[live_present, live_present, [], []])
        svc = LodgingWriteService(repo)
        preview = await svc.preview_push(2026, 1309001, "scn_1")
        req = PushExecuteRequest(
            year=2026,
            session_cm_id=1309001,
            scenario="scn_1",
            digest=preview.digest,
            decisions={"cedar-9": "scenario"},
        )
        with pytest.raises(PushDigestStaleError):
            await svc.execute_push(req, pushed_by="user_1")
        repo.create_push_event.assert_not_called()
        repo.delete_write_in.assert_not_called()
        repo.create_write_in.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_foreign_occupant_on_an_adds_target_unit_refuses_the_push(self) -> None:
        """kindred#2555 scan fix-round (M). `execute_push` pre-resolves every
        `remove` to a live record id before writing the ledger, but had NO
        symmetric check for `adds`: a live row appearing on an add's target
        unit between the entry re-classify and the apply collides AFTER the
        ledger row already exists -- the ledger then lies about what actually
        landed. `fetch_write_ins` is given a side_effect list so the test's
        own preview (for `preview.digest`) and execute_push's internal
        re-classify both see the unit free (an "add" building), and only the
        NEW add-side pre-check's own live fetch sees the foreign row that
        appeared in between -- reproducing the race without touching a real
        PocketBase.
        """
        foreign = [_wi("uc", "Foreign Party", ppl=1, id="wi_foreign")]
        repo = _repo(
            fetch_units=[_u("uc", "cedar-9")],
            fetch_draft_write_ins=[_wi("uc", "H. Osei", ppl=2, id="wd_1")],
            create_push_event=SimpleNamespace(id="push_1"),
        )
        # 1st call: this test's own preview_push (for `preview.digest`) -- no
        #           live row, so "uc" classifies "add".
        # 2nd call: execute_push's internal re-preview -- same empty live
        #           state, so the digest check passes and execution proceeds.
        # 3rd call: the NEW add-side pre-check's own live fetch -- a foreign
        #           row has appeared on "uc" since the classify.
        # 4th call: execute_push's own re-preview once the collision is
        #           found, to build the fresh report PushDigestStaleError
        #           carries.
        repo.fetch_write_ins = AsyncMock(side_effect=[[], [], foreign, foreign])
        svc = LodgingWriteService(repo)
        preview = await svc.preview_push(2026, 1309001, "scn_1")
        req = PushExecuteRequest(
            year=2026, session_cm_id=1309001, scenario="scn_1", digest=preview.digest, decisions={}
        )
        with pytest.raises(PushDigestStaleError):
            await svc.execute_push(req, pushed_by="user_1")
        repo.create_push_event.assert_not_called()
        repo.delete_write_in.assert_not_called()
        repo.create_write_in.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_pb_error_during_apply_converts_through_pb_error_to_http(self) -> None:
        """kindred#2555 scan fix-round (M). The six raw PB write calls in the
        push paths (`create_push_event`, the delete/create apply loops,
        unpush's two phases, `update_push_event`) let a `ClientResponseError`
        escape straight to the global 500 handler, against this file's own
        `pb_error_to_http` convention (see `_upsert_row`'s docstring). The
        add/remove pre-checks close most collisions before the ledger row
        exists; this is the belt for whatever residual PocketBase error still
        reaches a write.
        """
        repo = self._repo_one_conflict()
        repo.create_write_in = AsyncMock(
            side_effect=ClientResponseError(
                "validation_not_unique", status=400, data={}, url="", is_abort=False, original_error=None
            )
        )
        svc = LodgingWriteService(repo)
        preview = await svc.preview_push(2026, 1309001, "scn_1")
        req = PushExecuteRequest(
            year=2026,
            session_cm_id=1309001,
            scenario="scn_1",
            digest=preview.digest,
            decisions={"cedar-9": "scenario"},
        )
        with pytest.raises(HTTPException) as exc:
            await svc.execute_push(req, pushed_by="user_1")
        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_keep_live_and_all_match_is_a_no_op(self) -> None:
        repo = _repo(
            fetch_units=[_u("uc", "cedar-9")],
            fetch_write_ins=[_wi("uc", "K. Sato", id="wi_1")],
            fetch_draft_write_ins=[_wi("uc", "K. Sato", id="wd_1")],
        )
        svc = LodgingWriteService(repo)
        preview = await svc.preview_push(2026, 1309001, "scn_1")
        out = await svc.execute_push(
            PushExecuteRequest(year=2026, session_cm_id=1309001, scenario="scn_1", digest=preview.digest, decisions={}),
            pushed_by="user_1",
        )
        assert out.no_op is True
        assert out.push_id == ""
        repo.create_push_event.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_stale_session_refuses_even_when_the_push_would_be_a_no_op(self) -> None:
        """kindred#2555 scan fix-round (S). The `no_op=True` return used to
        exit before `_resolve_session_pb_id` ran at all, so a push against an
        orphaned/stale `session_cm_id` with nothing to add or remove returned
        a 200 no-op instead of 404 -- against commit 05f29b89's own stated
        intent that every execute path resolves the session first. Session
        resolution now runs ahead of the no-op return.
        """
        repo = _repo(
            fetch_units=[_u("uc", "cedar-9")],
            fetch_write_ins=[_wi("uc", "K. Sato", id="wi_1")],
            fetch_draft_write_ins=[_wi("uc", "K. Sato", id="wd_1")],
        )
        repo.fetch_session = AsyncMock(side_effect=SessionNotFoundError("No weekend session 1309001 in 2026"))
        svc = LodgingWriteService(repo)
        preview = await svc.preview_push(2026, 1309001, "scn_1")
        req = PushExecuteRequest(
            year=2026, session_cm_id=1309001, scenario="scn_1", digest=preview.digest, decisions={}
        )
        with pytest.raises(SessionNotFoundError):
            await svc.execute_push(req, pushed_by="user_1")
        repo.create_push_event.assert_not_called()


def _ledger(changes: list[dict[str, Any]], unpushed: str = "") -> SimpleNamespace:
    return SimpleNamespace(
        id="push_1", year=2026, session_cm_id=1309001, scenario_id="scn_1", changes=changes, unpushed_at=unpushed
    )


CH_ADD = {
    "action": "add",
    "unit": "uc",
    "unit_code": "cedar-9",
    "occupant_name": "H. Osei",
    "note": "",
    "party_size": 2,
}
CH_REM = {
    "action": "remove",
    "unit": "uc2",
    "unit_code": "fern-1",
    "occupant_name": "E. Sandoval",
    "note": "",
    "party_size": None,
}


class TestUnpush:
    """kindred#2477 Task 5. `unpush` replays a ledger row's `changes` in
    reverse -- delete what the push added, recreate what it removed -- but
    ONLY when the live board still matches the push's after-state exactly.
    Any drift on any touched unit refuses the WHOLE push (RULED
    refuse-wholesale, owner 2026-08-22): nothing reverted, the mismatched
    buildings named in the error.
    """

    @pytest.mark.asyncio
    async def test_round_trip_restores(self) -> None:
        repo = _repo(
            find_push_event=_ledger([CH_ADD, CH_REM]),
            fetch_units=[_u("uc", "cedar-9"), _u("uc2", "fern-1")],
            # current live state == the push's after-state:
            fetch_write_ins=[_wi("uc", "H. Osei", ppl=2, id="wi_new")],
        )
        svc = LodgingWriteService(repo)
        out = await svc.unpush("push_1", 2026, 1309001)
        assert (out.deleted, out.restored) == (1, 1)
        repo.delete_write_in.assert_called_once_with("wi_new")
        recreated = repo.create_write_in.call_args.args[0]
        assert recreated["occupant_name"] == "E. Sandoval"
        assert "party_size" in recreated
        assert recreated["party_size"] is None
        repo.update_push_event.assert_called_once()  # unpushed_at stamped

    @pytest.mark.asyncio
    async def test_manual_edit_since_push_refuses_wholesale(self) -> None:
        repo = _repo(
            find_push_event=_ledger([CH_ADD]),
            fetch_units=[_u("uc", "cedar-9")],
            # someone renamed the occupant since the push:
            fetch_write_ins=[_wi("uc", "H. Osei-Brown", ppl=2, id="wi_new")],
        )
        svc = LodgingWriteService(repo)
        with pytest.raises(UnpushDriftError) as exc:
            await svc.unpush("push_1", 2026, 1309001)
        assert "cedar-9" in exc.value.buildings
        repo.delete_write_in.assert_not_called()
        repo.create_write_in.assert_not_called()

    @pytest.mark.asyncio
    async def test_a_row_that_would_collide_with_the_recreate_refuses_wholesale(self) -> None:
        """kindred#2555 scan fix-round (M), NARROWED by OQ-3 (2026-08-29).

        The original guard only checked whether the ORIGINAL removed tuple
        was back. If staff wrote a different-tuple row into that unit after
        the push, the guard saw no drift, phase 1 deleted the push's adds,
        and phase 2's `create_write_in` collided on
        `idx_lodging_write_in_unique`: a bare mid-revert 500 with
        `unpushed_at` never stamped.

        What COLLIDES is now the narrowed index's key. A live row sharing
        `(unit, occupant_name)` with the row phase 2 recreates -- here the
        removed occupant written back by hand with a different count -- still
        refuses the whole push, because the recreate would still be rejected.
        """
        repo = _repo(
            find_push_event=_ledger([CH_REM]),
            fetch_units=[_u("uc2", "fern-1")],
            # the removed occupant, written back onto fern-1 by hand with a
            # different party size -- a different TUPLE, the same index KEY:
            fetch_write_ins=[_wi("uc2", "E. Sandoval", ppl=3, id="wi_back")],
        )
        svc = LodgingWriteService(repo)
        with pytest.raises(UnpushDriftError) as exc:
            await svc.unpush("push_1", 2026, 1309001)
        assert "fern-1" in exc.value.buildings
        repo.delete_write_in.assert_not_called()
        repo.create_write_in.assert_not_called()
        repo.update_push_event.assert_not_called()

    @pytest.mark.asyncio
    async def test_double_unpush_refuses(self) -> None:
        repo = _repo(find_push_event=_ledger([CH_ADD], unpushed="2026-08-22T20:00:00Z"))
        with pytest.raises(AlreadyUnpushedError):
            await LodgingWriteService(repo).unpush("push_1", 2026, 1309001)

    @pytest.mark.asyncio
    async def test_missing_push_refuses(self) -> None:
        repo = _repo(find_push_event=None)
        with pytest.raises(PushNotFoundError):
            await LodgingWriteService(repo).unpush("push_missing", 2026, 1309001)

    @pytest.mark.asyncio
    async def test_unpush_for_a_different_weekend_than_the_ledger_row_refuses(self) -> None:
        """kindred#2477 final review, Important #5. `_ledger` names its OWN
        weekend (year=2026, session_cm_id=1309001) -- unpush must refuse when
        the caller addresses a DIFFERENT weekend, the same honest 404
        `test_missing_push_refuses` already covers for an id that resolves to
        nothing at all. Without this check, `find_push_event(push_id)` alone
        decides scope: a push id from one weekend addressed with another
        weekend's year/session_cm_id would replay THAT weekend's changes onto
        a board they were never taken from.
        """
        repo = _repo(
            find_push_event=_ledger([CH_ADD]),  # year=2026, session_cm_id=1309001
            fetch_units=[_u("uc", "cedar-9")],
            fetch_write_ins=[_wi("uc", "H. Osei", ppl=2, id="wi_new")],
        )
        svc = LodgingWriteService(repo)
        with pytest.raises(PushNotFoundError):
            await svc.unpush("push_1", 2026, 9999999)  # a different weekend's session_cm_id
        repo.delete_write_in.assert_not_called()
        repo.create_write_in.assert_not_called()
        repo.update_push_event.assert_not_called()


class TestPushAndUnpushCarryNRowsPerUnit:
    """The push ledger's half of "two write-ins in one shareable cabin".

    DARK ON ARRIVAL, like the read path beside it: both unique indexes still
    stand, so none of the shapes below can exist in production yet and none
    of these paths behaves differently for the one-row data that can. What
    they fix is a set of dicts that would eat a second row the moment the
    index moves.

    FOUR SITES, not the three a name-grep for `idx_lodging_write_in_unique`
    returns. `execute_push` keys `live_by_unit` on unit id and `live_ids` on
    the four-field `PushRow.tuple_key()`; `unpush` keys `by_unit` on unit id
    and `by_tuple` on the same four-field tuple. Every one of them is a
    `dict` built from a list, so a duplicate key collapses SILENTLY -- one
    row disappears from the ledger's view of the board, and the two-phase
    apply then either 404s mid-revert on a record id it has already deleted
    or recreates a row on top of an occupant nobody checked for.

    ★ OQ-3 IS ANSWERED (2026-08-29): DRIFT KEYS ON THE TUPLE, NOT THE UNIT --
    for `unpush`'s recreate guard. "Any occupant on a recreate-target unit
    that this push will not itself clear is drift" was written when a recreate
    into an occupied unit was schema-impossible; under the narrowed index a
    recreate beside a DIFFERENT occupant succeeds, so the unit-grain reading
    refused a case that would have worked. The refuse-wholesale ruling
    (owner, 2026-08-22) is untouched: it says what to do WHEN there is drift,
    not what counts as drift.

    ⚠️ ITS EFFECT IS HELD BACK TO STEP 8 by a unit-grain bridge beside the
    narrowed key: the index in the tree is still `(session_cm_id, year,
    unit)`, so the co-occupant the ruled shape waves through still collides
    with phase 2's recreate today. The narrowed key is what remains once the
    bridge goes; see `TestTheDriftGuardStaysConservativeUntilTheIndexNarrows`.

    `execute_push`'s add-side check is DELIBERATELY NOT narrowed with it, and
    that asymmetry is stated rather than accidental -- see its own comment.
    It asks a different question (should a row that appeared mid-flight stop
    a push at all), and it is conservative rather than permissive, so unlike
    the unpush half it needs no bridge.

    Fictional occupant names throughout.
    """

    @pytest.mark.asyncio
    async def test_two_identical_live_rows_resolve_to_two_record_ids_on_a_push(self) -> None:
        """`live_ids` maps the four-field tuple to ONE record id.

        Two live rows on one unit sharing an identical
        `(unit, occupant, note, party_size)` -- two unsized `TBD` placeholders
        is the realistic case -- collapse to a single entry, so a push
        removing both resolves BOTH to the same id. `remove_ids` then holds
        that id twice, the first `delete_write_in` succeeds and the second
        404s MID-APPLY, after the ledger row claiming both is already
        written.
        """
        live_pair = [_wi("uc", "TBD", id="wi_a"), _wi("uc", "TBD", id="wi_b")]
        repo = _repo(
            fetch_units=[_u("uc", "cedar-9")],
            fetch_write_ins=live_pair,
            fetch_draft_write_ins=[_wi("uc", "H. Osei", ppl=2, id="wd_1")],
            create_push_event=SimpleNamespace(id="push_1"),
        )
        svc = LodgingWriteService(repo)
        preview = await svc.preview_push(2026, 1309001, "scn_1")
        req = PushExecuteRequest(
            year=2026,
            session_cm_id=1309001,
            scenario="scn_1",
            digest=preview.digest,
            decisions={"cedar-9": "scenario"},
        )

        out = await svc.execute_push(req, pushed_by="user_1")

        assert out.removed == 2
        deleted = [call.args[0] for call in repo.delete_write_in.call_args_list]
        assert sorted(deleted) == ["wi_a", "wi_b"]

    @pytest.mark.asyncio
    async def test_an_unaccounted_co_occupant_on_an_adds_target_still_refuses(self) -> None:
        """`live_by_unit` maps a unit to ONE record id, and the add-side
        pre-check asks whether THAT id is one this push will delete.

        With two live rows on the target unit the dict keeps whichever the
        fetch returned last, so ordering alone decides whether the check
        sees the row this push clears or the foreign one beside it. The
        fixture puts the CLEARED row last, which is the arrangement that
        passes the check today and then collides on the create.

        Every occupant has to be accounted for, not the one the dict happened
        to keep. That is the conservative reading and it deliberately does
        not narrow the refuse-wholesale ruling -- see the class docstring's
        OQ-3 note.
        """
        classified = [_wi("uc", "G. Whitfield", id="wi_1")]
        # `wi_1` LAST: `live_by_unit` keeps the last writer, so the collapsed
        # dict holds the very row this push removes and the check passes.
        at_apply = [_wi("uc", "Foreign Party", ppl=1, id="wi_foreign"), _wi("uc", "G. Whitfield", id="wi_1")]
        repo = _repo(
            fetch_units=[_u("uc", "cedar-9")],
            fetch_draft_write_ins=[_wi("uc", "H. Osei", ppl=2, id="wd_1")],
            create_push_event=SimpleNamespace(id="push_1"),
        )
        # 1st: this test's own preview (for the digest). 2nd: execute_push's
        # internal re-preview -- same state, so the digest agrees. 3rd:
        # `_live_rows_with_ids`, by which point a co-occupant has appeared.
        # 4th: the fresh report the refusal carries.
        repo.fetch_write_ins = AsyncMock(side_effect=[classified, classified, at_apply, at_apply])
        svc = LodgingWriteService(repo)
        preview = await svc.preview_push(2026, 1309001, "scn_1")
        req = PushExecuteRequest(
            year=2026,
            session_cm_id=1309001,
            scenario="scn_1",
            digest=preview.digest,
            decisions={"cedar-9": "scenario"},
        )

        with pytest.raises(PushDigestStaleError):
            await svc.execute_push(req, pushed_by="user_1")
        repo.create_push_event.assert_not_called()
        repo.delete_write_in.assert_not_called()
        repo.create_write_in.assert_not_called()

    @pytest.mark.asyncio
    async def test_an_unpush_deletes_both_of_two_identical_added_rows(self) -> None:
        """`by_tuple` maps the four-field tuple to ONE record id, and its own
        comment says it is *"safe here only because"* the unique index makes
        two live rows sharing a tuple schema-impossible.

        A push that added two identical rows therefore reverts by deleting
        one record twice: the second `delete_write_in` 404s and the other row
        is orphaned live with `unpushed_at` never stamped.
        """
        repo = _repo(
            find_push_event=_ledger([CH_ADD, CH_ADD]),
            fetch_units=[_u("uc", "cedar-9")],
            fetch_write_ins=[_wi("uc", "H. Osei", ppl=2, id="wi_a"), _wi("uc", "H. Osei", ppl=2, id="wi_b")],
        )
        svc = LodgingWriteService(repo)

        out = await svc.unpush("push_1", 2026, 1309001)

        assert out.deleted == 2
        deleted = [call.args[0] for call in repo.delete_write_in.call_args_list]
        assert sorted(deleted) == ["wi_a", "wi_b"]

    @pytest.mark.asyncio
    async def test_a_colliding_row_beside_an_accounted_one_still_drifts_an_unpush(self) -> None:
        """Ordering must not decide whether the guard fires.

        The recreate-target unit holds two rows: one this push added (so
        phase 1 will clear it) and one that shares the RECREATED row's
        `(unit, occupant_name)` key. A dict keyed on the unit alone keeps
        whichever the fetch returned last -- the fixture puts the ACCOUNTED
        row last, the arrangement that used to pass the check and then
        collide on the create.

        Every row on the key has to be accounted for, not the one the dict
        happened to keep.
        """
        add_on_the_remove_target = {
            "action": "add",
            "unit": "uc2",
            "unit_code": "fern-1",
            "occupant_name": "H. Osei",
            "note": "",
            "party_size": 2,
        }
        repo = _repo(
            find_push_event=_ledger([add_on_the_remove_target, CH_REM]),
            fetch_units=[_u("uc2", "fern-1")],
            fetch_write_ins=[
                _wi("uc2", "E. Sandoval", ppl=3, id="wi_collides"),
                _wi("uc2", "H. Osei", ppl=2, id="wi_added"),
            ],
        )
        svc = LodgingWriteService(repo)

        with pytest.raises(UnpushDriftError) as exc:
            await svc.unpush("push_1", 2026, 1309001)
        assert "fern-1" in exc.value.buildings
        repo.delete_write_in.assert_not_called()
        repo.create_write_in.assert_not_called()
        repo.update_push_event.assert_not_called()

    @pytest.mark.asyncio
    async def test_an_unrelated_co_occupant_still_refuses_until_step_8_narrows_the_index(self) -> None:
        """★ OQ-3, ANSWERED 2026-08-29 -- AND ITS EFFECT BELONGS TO STEP 8.

        The ruled shape is that drift keys on the tuple rather than the unit,
        because under the narrowed
        `(session_cm_id, year, unit, occupant_name)` index a recreate beside
        a DIFFERENT occupant no longer collides, and refusing over it refuses
        a revert that would in fact have succeeded.

        ⚠️ THAT INDEX DOES NOT EXIST YET. The tree still carries
        `(session_cm_id, year, unit)` (`1500000161:208`); step 8 is the
        on-switch and lands last. Under the index that IS deployed the
        neighbour below collides with phase 2's recreate, so letting the
        revert proceed deletes the push's adds and then throws mid-apply with
        `unpushed_at` never stamped -- the kindred#2555 failure this guard
        exists to close, reached through the guard itself. Reproduced against
        a store that models the real index in
        `TestTheDriftGuardStaysConservativeUntilTheIndexNarrows`.

        So the narrowed key is in place and pinned by the two tests above,
        with a unit-grain bridge beside it that keeps the ANSWER conservative
        until the schema catches up. ⇒ THIS TEST IS THE STEP 8 PR'S TO FLIP,
        in the same change that deletes the bridge: `restored == 1`, the
        neighbour untouched.

        THE 2026-08-22 REFUSE-WHOLESALE RULING IS UNTOUCHED EITHER WAY. It
        governs what happens WHEN there is drift -- nothing reverted, the
        buildings named -- not what counts as drift.
        """
        repo = _repo(
            find_push_event=_ledger([CH_REM]),
            fetch_units=[_u("uc2", "fern-1")],
            fetch_write_ins=[_wi("uc2", "Olivia Chen", ppl=3, id="wi_neighbour")],
        )
        svc = LodgingWriteService(repo)

        with pytest.raises(UnpushDriftError) as exc:
            await svc.unpush("push_1", 2026, 1309001)

        assert exc.value.buildings == ["fern-1"]
        repo.create_write_in.assert_not_called()
        repo.delete_write_in.assert_not_called()
        repo.update_push_event.assert_not_called()


class _StatefulWriteInRepo:
    """A minimal STATEFUL fake standing in for PocketBase's own
    `idx_lodging_write_in_unique` on `lodging_write_ins` (unit,
    session_cm_id, year) -- kindred#2477 fix round, found by Task 10's
    live-PocketBase acceptance pass.

    The `MagicMock`-based `_repo()` helper this file otherwise uses
    enforces no such index, so it cannot reproduce a real
    `ClientResponseError` collision. This fake keeps an actual dict of
    "live" rows and refuses a `create_write_in` that would put two rows on
    the same (unit, session_cm_id, year) -- exactly what PocketBase itself
    refuses -- so a stored-order replay that recreates before it deletes
    hits the same 400 in this test that it hit against the real database.
    """

    def __init__(self, push_event: SimpleNamespace, units: list[Any], write_ins: dict[str, SimpleNamespace]) -> None:
        self._push_event = push_event
        self._units = units
        self._store: dict[str, SimpleNamespace] = dict(write_ins)
        self._next_id = 0
        self.delete_write_in_calls: list[str] = []
        self.create_write_in_calls: list[dict[str, Any]] = []

    async def find_push_event(self, record_id: str) -> SimpleNamespace | None:
        return self._push_event if record_id == self._push_event.id else None

    async def update_push_event(self, record_id: str, data: dict[str, Any]) -> SimpleNamespace:
        self._push_event.unpushed_at = data.get("unpushed_at", self._push_event.unpushed_at)
        return self._push_event

    async def fetch_session(self, year: int, session_cm_id: int) -> SimpleNamespace:
        return SimpleNamespace(id="sess_1")

    async def fetch_units(self, year: int) -> list[Any]:
        return self._units

    async def fetch_write_ins(self, year: int, session_cm_id: int) -> list[SimpleNamespace]:
        return list(self._store.values())

    async def delete_write_in(self, record_id: str) -> None:
        self.delete_write_in_calls.append(record_id)
        for key, row in list(self._store.items()):
            if row.id == record_id:
                del self._store[key]
                return
        raise ClientResponseError("missing", status=404, data={}, url="", is_abort=False, original_error=None)

    async def create_write_in(self, data: dict[str, Any]) -> SimpleNamespace:
        self.create_write_in_calls.append(data)
        # The real index: (unit, session_cm_id, year). A row still occupying
        # this unit refuses the create exactly as PocketBase's own index
        # does -- the collision this test exists to reproduce.
        for row in self._store.values():
            if (row.unit, row.session_cm_id, row.year) == (data["unit"], data["session_cm_id"], data["year"]):
                raise ClientResponseError(
                    "validation_not_unique", status=400, data={}, url="", is_abort=False, original_error=None
                )
        self._next_id += 1
        record_id = f"wi_recreated_{self._next_id}"
        row = SimpleNamespace(
            id=record_id,
            unit=data["unit"],
            occupant_name=data["occupant_name"],
            note=data["note"],
            party_size=data["party_size"],
            session_cm_id=data["session_cm_id"],
            year=data["year"],
        )
        self._store[record_id] = row
        return row


class TestUnpushDeletesTheAddsBeforeItRecreatesTheRemoves:
    """kindred#2477 fix round (2026-08-23 controller ruling, from Task 10's
    live-PocketBase acceptance pass). `execute_push` stores `changes` as
    `[removes..., adds...]`; replaying that list in STORED order recreates
    every removed row before deleting any added one. For a conflict resolved
    "take scenario" -- the ordinary case, not an edge case -- the remove and
    the add name the SAME unit, so the recreate collides with the
    not-yet-deleted pushed row on `idx_lodging_write_in_unique` (unit,
    session_cm_id, year). Fixed by splitting the apply loop into two passes:
    every delete first, then every create.
    """

    def _build_repo(self) -> _StatefulWriteInRepo:
        # The push this replays: a conflict on unit "uc" resolved "take
        # scenario" -- G. Whitfield (live) removed, H. Osei (scenario) added,
        # both on the same unit. `execute_push` stores removes before adds.
        push_event = _ledger(
            [
                {
                    "action": "remove",
                    "unit": "uc",
                    "unit_code": "cedar-9",
                    "occupant_name": "G. Whitfield",
                    "note": "",
                    "party_size": None,
                },
                {
                    "action": "add",
                    "unit": "uc",
                    "unit_code": "cedar-9",
                    "occupant_name": "H. Osei",
                    "note": "",
                    "party_size": 2,
                },
            ]
        )
        # The pushed state: H. Osei is the row currently live on "uc" -- the
        # row the push created and this unpush must delete before anything
        # else can occupy "uc" again.
        pushed_row = SimpleNamespace(
            id="wi_pushed",
            unit="uc",
            occupant_name="H. Osei",
            note="",
            party_size=2,
            session_cm_id=1309001,
            year=2026,
        )
        return _StatefulWriteInRepo(
            push_event=push_event, units=[_u("uc", "cedar-9")], write_ins={"wi_pushed": pushed_row}
        )

    @pytest.mark.asyncio
    async def test_a_replace_on_a_shared_unit_round_trips(self) -> None:
        repo = self._build_repo()
        svc = LodgingWriteService(repo)  # type: ignore[arg-type]

        out = await svc.unpush("push_1", 2026, 1309001)

        assert (out.deleted, out.restored) == (1, 1)
        assert repo.delete_write_in_calls == ["wi_pushed"]
        assert len(repo.create_write_in_calls) == 1
        assert repo.create_write_in_calls[0]["occupant_name"] == "G. Whitfield"
        # The unit ends up occupied by the RESTORED row, not both / neither.
        assert len(repo._store) == 1
        restored_row = next(iter(repo._store.values()))
        assert restored_row.occupant_name == "G. Whitfield"
        assert restored_row.unit == "uc"


class TestTheDriftGuardStaysConservativeUntilTheIndexNarrows:
    """OQ-3's narrowing is a STEP 8 change, and shipping its effect early
    re-opens the kindred#2555 failure it was written to close.

    The ruled shape is right: once `idx_lodging_write_in_unique` is
    `(session_cm_id, year, unit, occupant_name)`, a recreate BESIDE a
    different occupant no longer collides, so refusing over that co-occupant
    refuses a revert that would in fact have succeeded.

    But the index in the tree is still `(session_cm_id, year, unit)`
    (`1500000161:208`) and step 8 is deliberately not in this PR. Under THAT
    index the co-occupant does collide, so a guard that keys on the recreated
    row's own `(unit, occupant_name)` waves the revert through, phase 1's
    deletes land, and phase 2's `create_write_in` throws mid-apply with
    `unpushed_at` never stamped -- a half-reverted push whose retry can only
    throw again. The old unit-grain reading refused cleanly and named the
    building, which is what staff can act on.

    So the narrowed key stays (it is the ruled shape, and the tests above pin
    it), with a pre-step-8 bridge beside it that keeps the guard unit-grain
    until the schema catches up. ⚠️ THE BRIDGE IS THE STEP 8 PR'S TO DELETE,
    together with `by_unit`; the narrowed key beside it is what remains.

    `MagicMock` cannot see any of this -- it accepts every create -- so these
    run against `_StatefulWriteInRepo`, which models the real index and is
    the instrument kindred#2477 Task 10's live-PocketBase pass produced.
    """

    @staticmethod
    def _repo_with_a_neighbour_on_the_recreate_target() -> _StatefulWriteInRepo:
        """The push added H. Osei to cedar-9 and removed E. Sandoval from
        fern-1. Since then somebody wrote an unrelated paper family into
        fern-1 -- legal today, because the push had left it empty."""
        push_event = _ledger([CH_ADD, CH_REM])
        return _StatefulWriteInRepo(
            push_event=push_event,
            units=[_u("uc", "cedar-9"), _u("uc2", "fern-1")],
            write_ins={
                "wi_pushed": SimpleNamespace(
                    id="wi_pushed",
                    unit="uc",
                    occupant_name="H. Osei",
                    note="",
                    party_size=2,
                    session_cm_id=1309001,
                    year=2026,
                ),
                "wi_neighbour": SimpleNamespace(
                    id="wi_neighbour",
                    unit="uc2",
                    occupant_name="Olivia Chen",
                    note="",
                    party_size=3,
                    session_cm_id=1309001,
                    year=2026,
                ),
            },
        )

    @pytest.mark.asyncio
    async def test_a_co_occupant_the_current_index_would_collide_with_still_refuses(self) -> None:
        repo = self._repo_with_a_neighbour_on_the_recreate_target()
        svc = LodgingWriteService(repo)  # type: ignore[arg-type]

        with pytest.raises(UnpushDriftError) as exc:
            await svc.unpush("push_1", 2026, 1309001)

        assert exc.value.buildings == ["fern-1"]

    @pytest.mark.asyncio
    async def test_nothing_is_written_when_it_refuses(self) -> None:
        """The whole point of a PRE-check. A refusal after phase 1 has run is
        a half-reverted push, and `unpushed_at` is never stamped, so a retry
        finds the adds already gone and can only throw again."""
        repo = self._repo_with_a_neighbour_on_the_recreate_target()
        svc = LodgingWriteService(repo)  # type: ignore[arg-type]

        with pytest.raises(UnpushDriftError):
            await svc.unpush("push_1", 2026, 1309001)

        assert repo.delete_write_in_calls == []
        assert repo.create_write_in_calls == []
        assert sorted(repo._store) == ["wi_neighbour", "wi_pushed"]
        assert repo._push_event.unpushed_at == ""
