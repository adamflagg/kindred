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
    SlotMergeRequest,
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

# Statuses that mean PocketBase REFUSED the write, so the lost-race recovery
# below must not run (kindred#1936). The recovery re-reads and updates the row
# it finds, which is sound only when the create failed because somebody else
# won a race for the very row this call wanted. A refusal is not that: the row
# the re-read turns up is one this caller was just told it may not touch, and
# updating it answers a denied write with a 200.
#
# ONLY the auth flavours. Whether a partial-unique violation comes back as 400
# or 409 is not settled, so narrowing to a guessed status would break the guard
# that works today -- 400 keeps its recovery, and a test pins that.
REFUSAL_STATUSES = frozenset({401, 403})


class ScenarioNotEmptyError(RuntimeError):
    """A copy was asked for into a scenario that already holds placements."""


class LodgingWriteService:
    """Draft placements, and availability for a weekend.

    The asymmetry in that sentence is the point. Placements are scenario-scoped
    because a plan is what a scenario IS; availability is not, because a burst
    pipe is true of the weekend in every plan for it (1500000135).
    """

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

    def _log_recovered_race(self, what: str, exc: ClientResponseError, **context: Any) -> None:
        """WARN that a create failure was treated as a lost race (kindred#2043).

        The guard this backs is deliberately wide -- ANY non-refusal status
        reaches it, not only the unique-constraint one an actual race
        produces -- so this is the only trace left of a create that may have
        failed for an unrelated reason (a 500, a malformed relation id, a
        transient fault) once the recovery reports success.

        Context is inlined into the message rather than passed as `extra`:
        `bunking.logging_config.ISO8601Formatter.format` only ever renders
        `record.getMessage()`, so an `extra={}` payload is silently dropped
        and never reaches log output -- the same trap `api/routers/scenarios.py`
        documents and works around at its own `logger.error` call. `str(exc)`
        is deliberately NOT included: PocketBase's error bodies are not
        guaranteed single-line, and a multi-line value here would break the
        `key=value` shape the rest of this codebase's logs use.

        Call this only once the recovery's own update has SUCCEEDED. Logging
        it any earlier -- e.g. right after the raced row is found -- would
        claim a recovery that the update call could still go on to fail,
        which reaches the caller as an error despite the log saying
        "Recovered".
        """
        fields = " ".join(f"{key}={value}" for key, value in context.items())
        logger.warning(f"Recovered a {what} create as a lost race: status={exc.status} {fields}")

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
            # The COMMON path, and the one to reason about first. A scenario
            # is normally seeded from the mirror before anyone drags, so from
            # then on every drag finds a row and lands here; the create below
            # only fires for a party with no placement in this scenario at
            # all. There is no race to recover from -- the row is already
            # ours -- but a refusal still has to answer as a refusal rather
            # than escape bare to the catch-all handler as a 500.
            try:
                record = await self.repository.update_draft_assignment(str(existing.id), data)
            except ClientResponseError as exc:
                raise pb_error_to_http(exc) from exc
        else:
            try:
                record = await self.repository.create_draft_assignment(data)
            except ClientResponseError as exc:
                if exc.status in REFUSAL_STATUSES:
                    raise pb_error_to_http(exc) from exc
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
                    self._log_recovered_race(
                        "draft-assignment",
                        exc,
                        year=request.year,
                        session_cm_id=request.session_cm_id,
                        scenario=request.scenario,
                        household_cm_id=request.household_cm_id,
                        person_cm_id=request.person_cm_id,
                    )
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

        Availability is NOT copied, and since 1500000135 there is nothing it
        could mean to copy it: the table has no scenario column, so every
        scenario reads the same rows and a copy would be a row duplicating
        itself. The earlier reason -- that availability overlaid the live rows,
        so copying them would pin the scenario against a later change -- has
        become the stronger one that a scenario cannot disagree about
        availability at all.

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
        failed create re-counts, and rows beyond the ones this call wrote are
        the race, reported as the refusal it already has a word for. Anything
        else keeps its upstream status. See `_seed_failure` for why the test
        is `held > copied` rather than `held > 0` -- by the second row this
        call is looking at its own writes.

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
                raise await self._seed_failure(exc, request, session_pb_id, copied) from exc
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
        self, exc: ClientResponseError, request: PlacementCopyRequest, session_pb_id: str, copied: int
    ) -> Exception:
        """Decide what a failed seed create means: a lost race, or a failure.

        Rows BEYOND the ones this call wrote mean another caller seeded the
        scenario between the up-front count and now, which is the state that
        check refuses -- so it gets the same answer, not the index's 400.

        The test is `held > copied`, not `held > 0`, and the difference is the
        whole method. The seed writes sequentially, so from the second row on
        it has put rows in the scenario ITSELF; a bare "are there rows?" would
        answer yes to its own output and report every later failure as a race,
        swallowing the upstream status of a genuinely broken create. Past the
        first row is most of a 62-row weekend.

        `held > copied` still catches a real race detected part-way, which
        interleaving makes possible: two callers walking the same mirror list
        can each win a different party before either collides, so the loser is
        not obliged to fail on its first create.

        The re-count can itself fail, and its failure is wrapped rather than
        raised bare: this runs inside an except block, so a ClientResponseError
        escaping here reaches the catch-all handler in api/main.py as the 500
        this whole guard exists to prevent.

        A REFUSAL never reaches the count. `held > copied` reads row counts and
        nothing else, so a 401/403 part-way through a seed -- the service
        token expiring mid-loop is the realistic way in -- would be reported
        as a race that nobody ran. That is the third instance of the shape
        kindred#1936 removed from the two create paths, and it is refused here
        for the same reason: a refusal is not a race, whatever the row count
        says afterwards.
        """
        if exc.status in REFUSAL_STATUSES:
            return pb_error_to_http(exc)
        try:
            held = await self.repository.count_draft_assignments(request.year, session_pb_id, request.scenario)
        except ClientResponseError as recheck_exc:
            return pb_error_to_http(recheck_exc)
        if held > copied:
            return ScenarioNotEmptyError(
                f"Scenario {request.scenario} was seeded by another caller while this copy was running "
                f"({held} placement(s) for weekend {request.session_cm_id} in {request.year}, "
                f"{copied} written by this copy)"
            )
        return pb_error_to_http(exc)

    async def set_availability(self, request: AvailabilityWriteRequest) -> LodgingWriteResponse:
        """Reserve or release one unit for this weekend.

        NO SCENARIO. 1500000135 deleted this table's scenario dimension --
        availability is a fact about the weekend, not about the plan, since a
        burst pipe closes a cabin in every scenario for that weekend.

        `family_available: null` DELETES the row rather than writing a value
        meaning "normal". There is no such value: the absence of a row is what
        "whatever this unit's role says" is spelled as, and writing a value
        that happens to agree with the role would pin the unit against a later
        change to it.

        `reason` is written to the `note` COLUMN. This and `_build_units` are
        the only two places that translate between the two names -- see
        AvailabilityWriteRequest.

        Both the delete and the create below race the same way the placement
        writes do, and are guarded the same two ways.

        The delete: the find above sees the row, but it can vanish before the
        delete reaches PocketBase -- two staff releasing the same unit, or a
        double-click. ONLY 404 is swallowed, exactly as unplace_party's
        delete is; any other failure keeps its status through pb_error_to_http.

        The create: `idx_lodging_avail_unique` is UNIQUE on (session, year,
        unit), so two staff reserving the same unit for the same weekend both
        find no override, both create, and the index rejects the loser. That is
        exactly the race place_party guards on the draft's own partial unique
        index, guarded the identical way -- the loser re-reads and updates the
        winner's row, which is by construction the row this call wanted: same
        session, same year, same unit. The recovery's own two calls are guarded
        the same way place_party's are, for the same reason: a failure inside
        the except block is the very 500 the block exists to prevent.
        """
        session_pb_id = await self._resolve_session_pb_id(request.year, request.session_cm_id)

        existing = await self.repository.find_availability_override(request.year, session_pb_id, request.unit_id)

        if request.family_available is None:
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
            "unit": request.unit_id,
            "family_available": request.family_available,
            # The API's `reason` meets the column's `note` HERE, and in
            # `_build_units` on the way back out. Nowhere else.
            "note": request.reason,
        }

        if existing is not None:
            # Same shape as `place_party`'s update branch above, and refused
            # the same way -- see the note there.
            try:
                record = await self.repository.update_availability(str(existing.id), data)
            except ClientResponseError as exc:
                raise pb_error_to_http(exc) from exc
        else:
            try:
                record = await self.repository.create_availability(data)
            except ClientResponseError as exc:
                if exc.status in REFUSAL_STATUSES:
                    raise pb_error_to_http(exc) from exc
                try:
                    raced = await self.repository.find_availability_override(
                        request.year, session_pb_id, request.unit_id
                    )
                    if raced is None:
                        raise pb_error_to_http(exc) from exc
                    record = await self.repository.update_availability(str(raced.id), data)
                    self._log_recovered_race(
                        "availability",
                        exc,
                        year=request.year,
                        session_cm_id=request.session_cm_id,
                        unit_id=request.unit_id,
                    )
                except ClientResponseError as retry_exc:
                    raise pb_error_to_http(retry_exc) from retry_exc
        return LodgingWriteResponse(record_id=str(getattr(record, "id", "")))

    async def set_slot_merge(self, request: SlotMergeRequest) -> LodgingWriteResponse:
        """Set one container's draw level, at a scenario or at the weekend.

        `request.scenario` MAY BE BLANK now (1500000140), and this method does
        nothing special when it is: a blank scenario writes the WEEKEND-LEVEL
        row (`scenario == ""`), which is a legal, distinct row from any
        scenario's own -- not a refused write and not a stand-in for "the
        mirror". That is the reversal from set_availability, which this
        docstring used to contrast against: availability lost its scenario
        dimension outright in 1500000135, one layer with no tiers, because a
        burst pipe closes a cabin in every plan. A merge keeps its scenario
        dimension AND gains a coarser weekend-level tier underneath it -- see
        SlotMergeRequest and resolve_combined for the two-tier resolution this
        row participates in.

        NO DELETE BRANCH, unlike set_availability. There, `None` means "clear
        the override" and is spelled as the absence of a row. Here the board
        only ever writes an explicit true or false -- the absent row means
        "inherit the next tier down", and nothing in the UI asks to return to
        it. Adding a clear later means adding the branch, not repurposing this
        one.

        The create races exactly as set_availability's does:
        idx_lodging_slot_merge_unique is UNIQUE on (unit, session, year,
        scenario) -- '' is an ordinary value in that index, same as any
        scenario id -- so two staff merging the same house at the same tier
        both find no row, both create, and the index rejects the loser.
        Guarded identically -- the loser re-reads and updates the winner's
        row, which by construction is the row this call wanted.
        """
        session_pb_id = await self._resolve_session_pb_id(request.year, request.session_cm_id)

        existing = await self.repository.find_slot_merge(request.year, session_pb_id, request.unit_id, request.scenario)

        data: dict[str, Any] = {
            "unit": request.unit_id,
            "session": session_pb_id,
            # Required column (kindred#1879's durable-key pattern, matching
            # set_availability's own "session_cm_id": request.session_cm_id
            # write): the relation is for joins, this is the year-stable key.
            "session_cm_id": request.session_cm_id,
            "year": request.year,
            "scenario": request.scenario,
            "combined": request.combined,
        }

        if existing is not None:
            try:
                record = await self.repository.update_slot_merge(str(existing.id), data)
            except ClientResponseError as exc:
                raise pb_error_to_http(exc) from exc
        else:
            try:
                record = await self.repository.create_slot_merge(data)
            except ClientResponseError as exc:
                if exc.status in REFUSAL_STATUSES:
                    raise pb_error_to_http(exc) from exc
                try:
                    raced = await self.repository.find_slot_merge(
                        request.year, session_pb_id, request.unit_id, request.scenario
                    )
                    if raced is None:
                        raise pb_error_to_http(exc) from exc
                    record = await self.repository.update_slot_merge(str(raced.id), data)
                    self._log_recovered_race(
                        "slot-merge",
                        exc,
                        year=request.year,
                        session_cm_id=request.session_cm_id,
                        unit_id=request.unit_id,
                        scenario=request.scenario,
                    )
                except ClientResponseError as retry_exc:
                    raise pb_error_to_http(retry_exc) from retry_exc
        return LodgingWriteResponse(record_id=str(getattr(record, "id", "")))
