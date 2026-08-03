"""Writes for the weekend lodging board.

EVERY write here targets the DRAFT grain, or `lodging_availability`. No write
in this module can reach `lodging_assignments`, `lodging_assignment_history` or
`lodging_field_mappings`: those belong to the CampMinder ingest, stay
`is_admin` in PocketBase (1500000132), and are the reason the draft tables
exist at all. Summer draws the identical line and has never crossed it.

`copy_from_mirror` READS `lodging_assignments` and is the one place that does.
That is the direction the line permits -- mirror into draft, never back -- and
it is the seed step kindred#1974 created by making a scenario replace the
mirror rather than overlay it. There is still no promote/publish path, and
adding one is a decision, not a follow-up.

There is no UI on top of this yet, deliberately. The schema risk lands in one
reviewable change with no interaction design competing for review attention.

WHAT IS NOT VALIDATED, and why. A placement's `unit_ids` is not checked for
completeness against the unit tree. That rule -- "a placement's unit set is
legal iff its members are the complete child set of some container" -- was
built through nine tasks, fully reviewed, and REMOVED in #1903, because every
set is hand-authored: a deliberate partial booking and a mis-click produce
byte-identical rows, so no rule can discriminate between the case it is for
and the case it is against. It was written when the set lived on a separate
`lodging_merges` row; #1931 folded that row into `unit_ids`, which changed
where the set is stored and nothing about the argument. If anything it matters
more now -- `unit_ids` is the ONLY way to build a multi-room placement, so a
rule here rejects the whole feature rather than one table. Read
docs/architecture/lodging-occupancy.md before adding anything of that shape.
The ingest carries the same warning at `sync.placementFor`.

Occupancy -- how many parties may share one unit -- is the constraint that
genuinely needs modelling (kindred#1907), and it belongs at the point a human
is choosing, which is the board. Not here, and not in the ingest.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

from api.schemas.lodging import (
    AvailabilityWriteRequest,
    LodgingCopyResponse,
    LodgingWriteResponse,
    PlacementCopyRequest,
    PlacementDeleteRequest,
    PlacementWriteRequest,
)
from api.services.lodging_roster_service import SessionNotFoundError, placement_grain, resolved_units
from api.utils.pb_error import pb_error_to_http
from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from api.services.lodging_repository import LodgingRepository

logger = get_logger(__name__)

# lodging_assignments.source, whose select list this shares. A row written from
# the board is staff_manual by construction -- the other two values name sync
# jobs, and no sync writes the draft. A COPIED row is the exception and keeps
# the mirror row's own value: the placement came from CampMinder even though a
# staff member asked for the copy.
STAFF_SOURCE = "staff_manual"


class ScenarioNotEmptyError(RuntimeError):
    """A copy was asked for into a scenario that already holds placements."""


class LodgingWriteService:
    """Draft placements and per-scenario availability."""

    def __init__(self, repository: LodgingRepository) -> None:
        self.repository = repository

    async def _resolve_session_pb_id(self, year: int, session_cm_id: int) -> str:
        """CampMinder id -> PocketBase record id, or 404.

        The caller names the weekend by its CampMinder id, which is the stable
        cross-year identity; camp_sessions is unique on (cm_id, year), so the
        PocketBase id is year-scoped and cannot be sent by a client that wants
        to mean the same weekend next season. Both are stored on the row --
        the relation for joins, session_cm_id as the durable key (#1879).
        """
        session = await self.repository.fetch_session(year, session_cm_id)
        if session is None:
            raise SessionNotFoundError(f"No weekend session {session_cm_id} in {year}")
        return str(getattr(session, "id", ""))

    async def place_party(self, request: PlacementWriteRequest) -> LodgingWriteResponse:
        """Upsert one party's placement inside a scenario.

        Upsert rather than insert because the draft's partial unique indexes
        allow exactly one row per (session, year, party, scenario).

        The find and the create are two round trips, so they RACE. Two staff
        dragging the same family at the same moment both read no row, both
        create, and the index rejects the loser. Left alone that is a 500 for a
        placement the board is entitled to make, so the loser re-reads and
        updates instead. The winner's row is by construction the row this call
        wanted: same session, same year, same party, same scenario.

        Only a create that turns out to have raced is retried. If the re-read
        still finds nothing, the create failed for some other reason and the
        error keeps its upstream status rather than becoming a 200 reporting a
        placement that does not exist.

        The recovery races too: the re-read can fail on its own, and the
        winner's row can vanish again before the update lands. Both calls live
        inside the except block, so their failures go through pb_error_to_http
        as well -- an unwrapped one is a bare ClientResponseError into the
        catch-all handler, which is the same 500 this guard exists to prevent.

        `unit_ids` cannot be empty -- the schema refuses it. Every row this
        writes places the party somewhere; taking a party off the board is
        `unplace_party` below.
        """
        session_pb_id = await self._resolve_session_pb_id(request.year, request.session_cm_id)

        existing = await self.repository.find_draft_assignment(
            request.year,
            session_pb_id,
            request.scenario,
            request.household_cm_id,
            request.person_cm_id,
        )

        data: dict[str, Any] = {
            "session": session_pb_id,
            "session_cm_id": request.session_cm_id,
            "year": request.year,
            "scenario": request.scenario,
            "household_cm_id": request.household_cm_id,
            "person_cm_id": request.person_cm_id,
            "units": request.unit_ids,
            "source": STAFF_SOURCE,
            "staff_touched": True,
        }

        if existing is not None:
            record = await self.repository.update_draft_assignment(str(existing.id), data)
        else:
            try:
                record = await self.repository.create_draft_assignment(data)
            except ClientResponseError as exc:
                try:
                    raced = await self.repository.find_draft_assignment(
                        request.year,
                        session_pb_id,
                        request.scenario,
                        request.household_cm_id,
                        request.person_cm_id,
                    )
                    if raced is None:
                        raise pb_error_to_http(exc) from exc
                    record = await self.repository.update_draft_assignment(str(raced.id), data)
                except ClientResponseError as retry_exc:
                    raise pb_error_to_http(retry_exc) from retry_exc
        return LodgingWriteResponse(record_id=str(getattr(record, "id", "")))

    async def unplace_party(self, request: PlacementDeleteRequest) -> LodgingWriteResponse:
        """Take a party off the board in this scenario, by dropping its row.

        The whole of "unplaced" since kindred#1974: with no fall-through to
        the mirror, the absence of a draft row IS the unplaced state, exactly
        as it is for a missing `bunk_assignments_draft` row on the summer
        board. This used to sit beside a tombstone POST that meant something
        different; there is now one operation, and it is this one.

        Idempotent: no row is a 200 with `deleted: false`, not a 404. The board
        may fire this for a card that was never moved, and a 404 there would be
        an error message about nothing having gone wrong.

        That covers the row never having existed. It does not, by itself,
        cover the row existing at the find above and vanishing before the
        delete lands -- two staff clearing the same placement, or a
        double-click, race the same way `set_availability`'s delete below
        does. Exactly as there, ONLY 404 is swallowed: any other PocketBase
        failure keeps its status through pb_error_to_http, because "the delete
        was refused" must not read as "there was nothing to delete".
        """
        session_pb_id = await self._resolve_session_pb_id(request.year, request.session_cm_id)

        existing = await self.repository.find_draft_assignment(
            request.year,
            session_pb_id,
            request.scenario,
            request.household_cm_id,
            request.person_cm_id,
        )
        if existing is None:
            return LodgingWriteResponse(deleted=False)

        try:
            await self.repository.delete_draft_assignment(str(existing.id))
        except ClientResponseError as exc:
            if exc.status == 404:
                return LodgingWriteResponse(record_id=str(existing.id), deleted=False)
            raise pb_error_to_http(exc) from exc
        return LodgingWriteResponse(record_id=str(existing.id), deleted=True)

    async def copy_from_mirror(self, request: PlacementCopyRequest) -> LodgingCopyResponse:
        """Seed one weekend's scenario from the CampMinder mirror.

        The other half of kindred#1974. A scenario no longer renders the
        synced placements through its own gaps, so it starts empty and this is
        what makes it usable -- the same seed step summer performs inside
        `POST /api/scenarios` with `should_copy_from_production`. That endpoint
        copies `bunk_assignments` and returns zero rows for a weekend session,
        so it cannot be reused: the frontend calls it to CREATE the scenario
        and this to FILL it.

        SEED-ONLY, and it refuses rather than merging. A second copy over a
        worked scenario would overwrite the placements staff made, and -- the
        worse half -- re-place every party they deliberately unplaced, because
        unplacing is now the absence of a row and a gap-filling copy cannot
        tell that from a party nobody has reached yet. Re-baselining a worked
        plan against upstream drift is a different feature and is not this
        one. The check is scoped to the weekend as well as the scenario: a
        scenario spans weekends, and placements in one must not refuse a seed
        of another.

        Availability is NOT copied. It stayed an overlay, so the scenario
        already sees the live reservations as its base; writing copies of them
        would pin the scenario against a later change to the live plan --
        the same argument that makes `state: null` a delete.

        A mirror row is SKIPPED, not failed on, when it names no party grain
        (it would key on nothing, dedupe against nothing, and be exactly the
        row `guardDraftAssignmentGrain` refuses) or when every unit it names
        has been deleted (it places nobody, and a relation id with no record
        behind it can fail the create outright). Both are counted so the
        caller can say so; silently copying 60 of 62 rows would show up only
        as a board with two families missing.

        The count and the creates are separate round trips, so they RACE, the
        same way `place_party`'s find-then-create does. Two staff seeding the
        same weekend -- or one double-click -- both read an empty scenario and
        both start writing, and the draft's partial unique indexes reject the
        loser. Unguarded that is a 400 out of `pb_error_to_http`: a different
        answer to the question the up-front check answers with a 409. So a
        failed create re-counts, and rows appearing where there were none is
        the race, reported as the refusal it already has a word for. If the
        scenario is still empty the create failed for another reason and keeps
        its upstream status. The re-count is inside the except block and
        wrapped for the same reason `place_party`'s recovery is: an unwrapped
        failure there is the bare 500 the guard exists to prevent.

        The creates are SEQUENTIAL and there is no transaction -- PocketBase's
        REST layer offers none across records. A create that fails part-way
        leaves the rows already written in place, and the retry then 409s on
        its own partial output. That is recoverable and deliberately visible:
        delete the scenario, which cascades its drafts away (1500000132), and
        seed a fresh one. The alternative -- unwinding what was written -- is a
        second failure path over the same unreliable connection.
        """
        session_pb_id = await self._resolve_session_pb_id(request.year, request.session_cm_id)

        held = await self.repository.count_draft_assignments(request.year, session_pb_id, request.scenario)
        if held:
            raise ScenarioNotEmptyError(
                f"Scenario {request.scenario} already holds {held} placement(s) for weekend "
                f"{request.session_cm_id} in {request.year}"
            )

        rows = await self.repository.fetch_assignments(request.year, session_pb_id)

        copied = 0
        skipped = 0
        seeded: set[tuple[str, int]] = set()
        for row in rows:
            grain = placement_grain(row)
            unit_ids = [str(getattr(unit, "id", "")) for unit in resolved_units(row)]
            # `seeded` guards a duplicate the draft's partial unique indexes
            # would reject on the second create, turning a whole seed into an
            # error over one malformed pair of mirror rows.
            if grain is None or not unit_ids or grain in seeded:
                skipped += 1
                continue
            seeded.add(grain)

            data: dict[str, Any] = {
                "session": session_pb_id,
                "session_cm_id": request.session_cm_id,
                "year": request.year,
                "scenario": request.scenario,
                "household_cm_id": grain[1] if grain[0] == "household" else 0,
                "person_cm_id": grain[1] if grain[0] == "person" else 0,
                "units": unit_ids,
                # The mirror row's own provenance, not STAFF_SOURCE: the
                # placement came from CampMinder even though a staff member
                # asked for the copy.
                "source": str(getattr(row, "source", "") or ""),
                # A seed is not a staff decision. staff_touched answers "has a
                # human moved this party?" and is one-way, so marking all 62
                # rows touched would answer it wrong for the whole weekend at
                # once. place_party sets it when someone actually drags.
                "staff_touched": False,
            }
            try:
                await self.repository.create_draft_assignment(data)
            except ClientResponseError as exc:
                raise await self._seed_failure(exc, request, session_pb_id) from exc
            copied += 1

        logger.info(
            "Seeded lodging scenario from the CampMinder mirror",
            extra={
                "year": request.year,
                "session_cm_id": request.session_cm_id,
                "scenario": request.scenario,
                "copied": copied,
                "skipped": skipped,
            },
        )
        return LodgingCopyResponse(copied=copied, skipped=skipped)

    async def _seed_failure(
        self, exc: ClientResponseError, request: PlacementCopyRequest, session_pb_id: str
    ) -> Exception:
        """Decide what a failed seed create means: a lost race, or a failure.

        Rows where the up-front count found none means another caller seeded
        this scenario between the two round trips, which is the state that
        check refuses -- so it gets the same answer, not the index's 400.

        The re-count can itself fail, and its failure is wrapped rather than
        raised bare: this runs inside an except block, so a ClientResponseError
        escaping here reaches the catch-all handler in api/main.py as the 500
        this whole guard exists to prevent.
        """
        try:
            held = await self.repository.count_draft_assignments(request.year, session_pb_id, request.scenario)
        except ClientResponseError as recheck_exc:
            return pb_error_to_http(recheck_exc)
        if held:
            return ScenarioNotEmptyError(
                f"Scenario {request.scenario} was seeded by another caller while this copy was running "
                f"({held} placement(s) for weekend {request.session_cm_id} in {request.year})"
            )
        return pb_error_to_http(exc)

    async def set_availability(self, request: AvailabilityWriteRequest) -> LodgingWriteResponse:
        """Reserve or release one unit for this weekend, inside a scenario.

        `state: null` DELETES the scenario's row rather than writing a state
        meaning "normal". There is no such state -- the select list is
        reserved_staff / reserved_other / released_to_family -- and the absence
        of a row is what "whatever the live plan says" is spelled as. Writing
        an override that happens to agree with the live plan would pin the unit
        against a later change to it.

        Both the delete and the create below race the same way the placement
        writes do, and are guarded the same two ways.

        The delete: the find above sees the row, but it can vanish before the
        delete reaches PocketBase -- two staff releasing the same unit, or a
        double-click. ONLY 404 is swallowed, exactly as clear_placement's
        delete is; any other failure keeps its status through pb_error_to_http.

        The create: `idx_lodging_avail_unique` is UNIQUE on (session, year,
        scenario, unit), so two staff reserving the same unit in the same
        scenario both find no override, both create, and the index rejects
        the loser. That is exactly the race place_party guards on the draft's
        own partial unique index, guarded the identical way -- the loser
        re-reads and updates the winner's row, which is by construction the
        row this call wanted: same session, same year, same scenario, same
        unit. The recovery's own two calls are guarded the same way
        place_party's are, for the same reason: a failure inside the except
        block is the very 500 the block exists to prevent.
        """
        session_pb_id = await self._resolve_session_pb_id(request.year, request.session_cm_id)

        existing = await self.repository.find_availability_override(
            request.year, session_pb_id, request.scenario, request.unit_id
        )

        if request.state is None:
            if existing is None:
                return LodgingWriteResponse(deleted=False)
            try:
                await self.repository.delete_availability(str(existing.id))
            except ClientResponseError as exc:
                if exc.status == 404:
                    return LodgingWriteResponse(record_id=str(existing.id), deleted=False)
                raise pb_error_to_http(exc) from exc
            return LodgingWriteResponse(record_id=str(existing.id), deleted=True)

        data: dict[str, Any] = {
            "session": session_pb_id,
            "session_cm_id": request.session_cm_id,
            "year": request.year,
            "scenario": request.scenario,
            "unit": request.unit_id,
            "state": request.state,
        }

        if existing is not None:
            record = await self.repository.update_availability(str(existing.id), data)
        else:
            try:
                record = await self.repository.create_availability(data)
            except ClientResponseError as exc:
                try:
                    raced = await self.repository.find_availability_override(
                        request.year, session_pb_id, request.scenario, request.unit_id
                    )
                    if raced is None:
                        raise pb_error_to_http(exc) from exc
                    record = await self.repository.update_availability(str(raced.id), data)
                except ClientResponseError as retry_exc:
                    raise pb_error_to_http(retry_exc) from retry_exc
        return LodgingWriteResponse(record_id=str(getattr(record, "id", "")))
