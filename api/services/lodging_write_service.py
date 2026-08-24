"""Writes for the weekend lodging board.

EVERY write here targets the DRAFT grain, `lodging_availability`,
`lodging_write_ins`, or `lodging_write_in_pushes` -- the occupancy table
kindred#2382 split out of availability, whose LIVE rows the board writes
directly, because the live board is a scope in its own right rather than the
absence of one, and the push ledger kindred#2477 added on top of it, whose
rows record what a push applied so `unpush` can replay them in reverse. No
write in this module can reach `lodging_assignments`, `lodging_assignment_history` or
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

import json
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

from api.schemas.lodging import (
    AvailabilityWriteRequest,
    LodgingCopyResponse,
    LodgingUnitSummary,
    LodgingWriteResponse,
    PlacementCopyRequest,
    PlacementDeleteRequest,
    PlacementWriteRequest,
    PushBuildingReport,
    PushExecuteRequest,
    PushExecuteResponse,
    PushPreviewResponse,
    PushRowPayload,
    SlotMergeRequest,
    UnpushResponse,
)
from api.services.lodging_roster_service import (
    SessionNotFoundError,
    _BathroomIndex,
    _capacity_by_code,
    _i_or_none,
    placement_grain,
    resolved_units,
)
from api.services.lodging_rules import PushBuilding, PushRow, classify_push, push_digest, unit_capacity
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


class PushDigestStaleError(RuntimeError):
    """The board or scenario moved between preview and push (kindred#2477).

    Carries the fresh report so the router can hand it straight back as the
    409 body -- the client re-renders the review against what is actually
    true now, instead of a bare "try again" with nothing to show.
    """

    def __init__(self, report: PushPreviewResponse) -> None:
        super().__init__("the write-in diff changed since this review was opened")
        self.report = report


class PushDecisionsIncompleteError(RuntimeError):
    """The RULED block rule (kindred#2477, owner 2026-08-22): every conflict
    and remove building needs a decision before a push may apply anything;
    there is no default-keep-live path. Enforced here, not only by the
    disabled button the frontend puts up for the same rule.
    """


class PushNotFoundError(RuntimeError):
    """`unpush` was asked for a `lodging_write_in_pushes` row that does not
    exist (kindred#2477 Task 5). `find_push_event` returns `None` on a 404
    rather than raising, so this is the service's own translation of that --
    the router answers it as a 404, the same shape a bad id gets everywhere
    else on this surface.
    """


class AlreadyUnpushedError(RuntimeError):
    """The ledger row `unpush` was asked to replay already carries an
    `unpushed_at` stamp (kindred#2477 Task 5). A push is reverted at most
    once: replaying it a second time would delete rows the first unpush
    already recreated and recreate rows the first unpush already deleted,
    silently doubling a party's write-in or destroying one nobody asked to
    remove. The stamp is the only guard against that, so it is checked
    before anything else about the row is trusted.
    """


class UnpushDriftError(RuntimeError):
    """RULED refuse-wholesale (owner 2026-08-22): `unpush` checks EVERY unit
    the push touched against the push's own after-state before it reverts
    anything, and a single mismatch -- an added row hand-edited or deleted
    since, a removed row hand-recreated since -- refuses the WHOLE push
    rather than reverting the units that still match.

    A partial revert leaves a state nobody reviewed: the buildings that
    still matched silently go back to how they were before the push, the
    ones that drifted silently keep whatever a staff member did to them
    since, and nothing on the board marks which is which. That is worse than
    refusing outright, because it reads as "unpush worked" while quietly
    deciding, per building, whether the click actually applied. Clobbering a
    hand edit outright is exactly the blind delete this feature exists to
    prevent -- the ledger names precise rows so a revert can be precise, and
    a revert that overwrites drift throws that away.

    The same check also refuses unpushing an OLDER push once a NEWER one has
    moved the same units -- not as a special case, but for free: the newer
    push's own apply already changed what the older push's after-state
    described, so the older push's added rows are gone or altered and its
    removed rows are back, and the drift check catches both without knowing
    anything about push ordering.

    `.buildings` carries the offending building codes, sorted and
    deduplicated, so the router can serialise them straight into the 409
    body (Task 6) -- the same shape `PushBuildingReport.key` uses elsewhere
    on this surface.
    """

    def __init__(self, buildings: list[str]) -> None:
        super().__init__(f"the live board has changed since this push: {', '.join(buildings)}")
        self.buildings = buildings


def _json_list(record: Any, field: str) -> list[dict[str, Any]]:
    """One PB JSON field, normalised to the list it always logically is.

    A `json` field comes back as a native `list` through the Python SDK's own
    HTTP client, but the mock repositories this file's tests build hand a
    `SimpleNamespace` straight over, and a live PocketBase JS-side hook or a
    differently-configured client can still hand back the column's raw
    serialised string instead. `lodging_write_in_pushes.changes` is exactly
    that column -- `create_push_event` writes it as the `changes` list
    `execute_push` built -- so `unpush` reads through this rather than
    assuming either shape.
    """
    value = getattr(record, field, None)
    if isinstance(value, str):
        return list(json.loads(value)) if value else []
    return list(value or [])


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

        WHAT THIS IS STILL FOR, after kindred#2042 moved every lookup onto
        `session_cm_id`. Two things, and neither is identity:

        1. It is the 404. An unknown or non-weekend cm_id has to be refused
           before anything is written, and this is the one read that can tell.
        2. `session` is `required: true` on all four lodging tables and is
           what an expand-based read joins through, so every write still has
           to carry a real record id.

        What it is NOT any more is the key a row is FOUND by -- that is
        `session_cm_id`, which survives a camp_sessions record being recreated
        rather than updated. See migration 1500000147.
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
        allow exactly one row per (session_cm_id, year, party, scenario).

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
            request.session_cm_id,
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
                        request.session_cm_id,
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
        # The RESULT is discarded, the call is not. Nothing on the delete path
        # needs the PocketBase record id any more (kindred#2042 moved the lookup
        # onto session_cm_id), but an unknown or non-weekend cm_id still has to
        # be refused as a 404 before this reports "nothing to delete" -- which
        # is what this read, and only this read, can tell.
        await self._resolve_session_pb_id(request.year, request.session_cm_id)

        existing = await self.repository.find_draft_assignment(
            request.year,
            request.session_cm_id,
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

        THE STAFF<->FAMILY ROLE OVERRIDE IS NOT COPIED, and since 1500000135
        there is nothing it could mean to copy it: `lodging_availability` has
        no scenario column, so every scenario reads the same rows and a copy
        would be a row duplicating itself. The owner ruled that half is not
        scenario-scoped -- "that's more of a known 'were moving staff to X for
        weekend Y'" -- so there is nothing there for a scenario to disagree
        about.

        WRITE-INS ARE COPIED, and that is the opposite call on the other half
        of the boolean 1500000161 split apart (owner ruling, kindred#2382,
        2026-08-16). Once a scenario's write-ins REPLACE the live ones rather
        than falling through, a scenario seeded without them starts with every
        written-into cabin looking OPEN -- and kindred#2247's placement gate
        reads exactly that, so it would let a family be dropped into a room the
        live board records as occupied. That failure mode is one this split
        CREATES rather than inherits, and this copy is what closes it. See
        `_seed_write_ins`.

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

        held = await self.repository.count_draft_assignments(request.year, request.session_cm_id, request.scenario)
        if held:
            raise ScenarioNotEmptyError(
                f"Scenario {request.scenario} already holds {held} placement(s) for weekend "
                f"{request.session_cm_id} in {request.year}"
            )

        rows = await self.repository.fetch_assignments(request.year, request.session_cm_id)

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
                raise await self._seed_failure(exc, request, copied) from exc
            copied += 1

        # The LIVE board's write-ins, because the live board is what this seed
        # copies FROM. `copy_scenario_to_scenario` reads the source scenario's
        # own draft rows instead, the same split the placement read above makes
        # between `fetch_assignments` and `fetch_draft_assignments`.
        write_ins = await self._seed_write_ins(
            rows=await self.repository.fetch_write_ins(request.year, request.session_cm_id),
            session_pb_id=session_pb_id,
            session_cm_id=request.session_cm_id,
            year=request.year,
            scenario=request.scenario,
        )

        # Inlined into the message, not `extra={}` -- see the identical note
        # on `copy_scenario_to_scenario`'s own logger.info call below.
        logger.info(
            f"Seeded lodging scenario from the CampMinder mirror: year={request.year} "
            f"session_cm_id={request.session_cm_id} scenario={request.scenario} "
            f"copied={copied} skipped={skipped} write_ins={write_ins}"
        )
        return LodgingCopyResponse(copied=copied, skipped=skipped)

    async def _seed_failure(self, exc: ClientResponseError, request: PlacementCopyRequest, copied: int) -> Exception:
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
            held = await self.repository.count_draft_assignments(request.year, request.session_cm_id, request.scenario)
        except ClientResponseError as recheck_exc:
            return pb_error_to_http(recheck_exc)
        if held > copied:
            return ScenarioNotEmptyError(
                f"Scenario {request.scenario} was seeded by another caller while this copy was running "
                f"({held} placement(s) for weekend {request.session_cm_id} in {request.year}, "
                f"{copied} written by this copy)"
            )
        return pb_error_to_http(exc)

    async def copy_scenario_to_scenario(
        self, year: int, session_cm_id: int, from_scenario: str, to_scenario: str
    ) -> LodgingCopyResponse:
        """Copy one weekend's placements from an existing scenario into a fresh one.

        The weekend analogue of summer's `copy_from_scenario` inside
        `POST /api/scenarios` (kindred#2021). `copy_from_mirror` seeds a
        scenario from the CampMinder mirror; this seeds one from ANOTHER
        scenario's own `lodging_assignments_draft` rows -- the source is
        already-worked staff decisions, not synced data, so unlike a mirror
        seed this carries `staff_touched` and `source` over unchanged rather
        than resetting them. Promoting or demoting what a human already
        decided is not this operation's call to make.

        SEED-ONLY, exactly as `copy_from_mirror` is: the destination must be
        empty, checked and enforced the same way, for the same reason -- a
        second copy would overwrite what staff placed since. Weekend-scoped,
        not scenario-scoped: `count_draft_assignments` and
        `fetch_draft_assignments` both take the weekend's CampMinder id, so a scenario
        spanning weekends only has ITS placements for this one weekend
        checked and copied, matching `copy_from_mirror`'s own scoping.

        A source row is SKIPPED when every unit it names has been deleted --
        the same case `copy_from_mirror` skips a mirror row for. Unlike a
        mirror row, a draft row cannot lack a grain: `PartyGrainRequest`
        validates exactly one at write time, so there is nothing here for
        `placement_grain` to catch that this method needs to guard against.

        The count and the creates RACE the same way `copy_from_mirror`'s do,
        and the recovery is the identical `_seed_failure` -- built against
        `PlacementCopyRequest`, which this constructs purely to reuse that
        race/refusal logic rather than duplicate it.

        Also copies `lodging_slot_merges` rows -- a house merged into one
        card, or split back into rooms -- for the same reason
        `_copy_locked_groups` exists on summer's side of this feature
        (kindred#1046): dropping them would silently re-split or re-merge a
        house the source scenario had decided differently, so "copy from
        Option A" would not actually copy what Option A shows.
        """
        session_pb_id = await self._resolve_session_pb_id(year, session_cm_id)

        held = await self.repository.count_draft_assignments(year, session_cm_id, to_scenario)
        if held:
            raise ScenarioNotEmptyError(
                f"Scenario {to_scenario} already holds {held} placement(s) for weekend {session_cm_id} in {year}"
            )

        rows = await self.repository.fetch_draft_assignments(year, session_cm_id, from_scenario)

        copied = 0
        skipped = 0
        dest_request = PlacementCopyRequest(year=year, session_cm_id=session_cm_id, scenario=to_scenario)
        for row in rows:
            unit_ids = [str(getattr(unit, "id", "")) for unit in resolved_units(row)]
            if not unit_ids:
                skipped += 1
                continue

            data: dict[str, Any] = {
                "session": session_pb_id,
                "session_cm_id": session_cm_id,
                "year": year,
                "scenario": to_scenario,
                "household_cm_id": int(getattr(row, "household_cm_id", 0) or 0),
                "person_cm_id": int(getattr(row, "person_cm_id", 0) or 0),
                "units": unit_ids,
                # Carried over, not reset -- see the docstring. Unlike a
                # mirror seed, this source is already a staff decision.
                "source": str(getattr(row, "source", "") or ""),
                "staff_touched": bool(getattr(row, "staff_touched", False)),
            }
            try:
                await self.repository.create_draft_assignment(data)
            except ClientResponseError as exc:
                raise await self._seed_failure(exc, dest_request, copied) from exc
            copied += 1

        # Slot merges: `fetch_slot_merges` UNIONS the named scenario's own
        # rows with the weekend-level tier (`scenario == ""`); only the rows
        # that are actually `from_scenario`'s own are this copy's to make.
        # The weekend-level tier already applies to `to_scenario`
        # automatically -- copying it as a scenario-scoped row would PIN the
        # destination against a later change to that tier instead of
        # inheriting it, the same argument `fetch_availability`'s docstring
        # makes for why availability carries no scenario dimension at all.
        merges = await self.repository.fetch_slot_merges(year, session_cm_id, from_scenario)
        for merge in merges:
            if str(getattr(merge, "scenario", "")) != from_scenario:
                continue
            await self.repository.create_slot_merge(
                {
                    "unit": getattr(merge, "unit", None),
                    "session": session_pb_id,
                    "session_cm_id": session_cm_id,
                    "year": year,
                    "scenario": to_scenario,
                    "combined": bool(getattr(merge, "combined", False)),
                }
            )

        # Write-ins: the SOURCE SCENARIO's own, not the live board's. Unlike
        # `fetch_slot_merges` above there is no weekend-level tier to filter
        # out -- `fetch_draft_write_ins` returns exactly one scenario's rows --
        # and unlike the role override there IS something for two scenarios to
        # disagree about, which is the whole of kindred#2382. Dropping this
        # would make "copy from Option A" produce a board showing fewer
        # occupied rooms than Option A does, and kindred#2247's placement gate
        # would then offer those rooms.
        write_ins = await self._seed_write_ins(
            rows=await self.repository.fetch_draft_write_ins(year, session_cm_id, from_scenario),
            session_pb_id=session_pb_id,
            session_cm_id=session_cm_id,
            year=year,
            scenario=to_scenario,
        )

        # Inlined into the message, not `extra={}` -- `extra` is silently
        # dropped at format time (bunking/logging_config.py's
        # ISO8601Formatter.format only ever renders record.getMessage()),
        # the same trap `_log_recovered_race` documents and works around a
        # few hundred lines above.
        logger.info(
            f"Copied a lodging scenario into a fresh one: year={year} session_cm_id={session_cm_id} "
            f"from_scenario={from_scenario} to_scenario={to_scenario} copied={copied} skipped={skipped} "
            f"write_ins={write_ins}"
        )
        return LodgingCopyResponse(copied=copied, skipped=skipped)

    async def _seed_write_ins(
        self, *, rows: list[Any], session_pb_id: str, session_cm_id: int, year: int, scenario: str
    ) -> int:
        """Copy one weekend's write-ins into a scenario, and say how many.

        ONE HELPER, TWO SEED PATHS, and the only thing that differs between
        them is which read produced `rows`: `copy_from_mirror` hands over the
        LIVE board's (`fetch_write_ins`), `copy_scenario_to_scenario` the
        SOURCE scenario's own (`fetch_draft_write_ins`). Everything after that
        is identical, and two copies of it is two chances for one seed path to
        start writing a different row shape than the other.

        WHY A SEED COPIES THESE AT ALL is the owner's ruling of 2026-08-16, and
        it is a safety argument rather than a convenience one. A scenario's
        write-ins REPLACE the live ones on read (kindred#2382, matching
        kindred#1974's no-fall-through rule for placements), so a scenario
        seeded without them shows every written-into cabin as OPEN --
        kindred#2247's placement gate reads exactly that field, so it would
        offer a room the live board records as occupied. The split creates that
        failure mode; this copy is what closes it.

        NO EMPTINESS CHECK AND NO RACE RECOVERY OF ITS OWN, following the
        `lodging_slot_merges` copy in `copy_scenario_to_scenario` rather than
        the placement loop above it. Both seed paths have already refused a
        destination that holds placements, and adding a second,
        differently-shaped guard here would give one seed two answers to "this
        scenario is already populated".

        THE CREATE IS STILL CONVERTED, because "no recovery" is not "no
        handler", and the difference is reachable rather than theoretical. That
        up-front guard counts PLACEMENTS, so a weekend whose mirror holds
        nothing copyable -- early season, before CampMinder has assigned any
        lodging -- passes it on every attempt while the write-ins the first
        seed wrote are already in the scenario, and the second seed collides on
        `idx_lodging_write_in_draft_unique`. Nothing on this router catches
        `ClientResponseError`, so one escaping here unconverted would reach
        api/main.py's catch-all as a 500: a state the server understands
        perfectly well, reported as one it does not. `pb_error_to_http` is what
        every other write on this service raises through, and it keeps a
        refusal a refusal (401/403 -> 403) rather than folding it into the
        collision.

        NOT counted into `LodgingCopyResponse.copied`, again as merges are not:
        that number is the one a staff member reads as "the board is
        populated", and it means placements. The count comes back for the log
        line, where it is the difference between a silent no-op and a visible
        one.

        `family_available` is deliberately absent from the payload. On the
        occupancy tables the ROW is the fact; a column restating it would be
        the conflation kindred#2382 split apart growing back -- the same
        sentence `set_availability` carries over its own shared payload.
        """
        for row in rows:
            try:
                await self.repository.create_draft_write_in(
                    {
                        "unit": getattr(row, "unit", None),
                        "session": session_pb_id,
                        "session_cm_id": session_cm_id,
                        "year": year,
                        "scenario": scenario,
                        "occupant_name": str(getattr(row, "occupant_name", "") or ""),
                        # The column keeps its own name here, not the API's
                        # `reason`: this is a table-to-table copy and never
                        # passes through the schema. `set_availability` and
                        # `_build_units` remain the only two places the two
                        # names meet.
                        "note": str(getattr(row, "note", "") or ""),
                        # kindred#2540. A dropped `party_size` is not a
                        # smaller row -- it is a DIFFERENT one: `null` means
                        # the write-in takes its room WHOLESALE, so an
                        # unsized copy of a sized write-in silently widens "2
                        # of 5 beds" into "the whole cabin" and a scenario
                        # reports a room closed the live board shows as
                        # partly open.
                        #
                        # ⚠️ THE `None` DEFAULT NEVER ACTUALLY FIRES on a real
                        # row, and it is worth being honest about that rather
                        # than reading it as the reason this is correct. PB
                        # declares `party_size` `NUMERIC DEFAULT 0 NOT NULL`
                        # and `fetch_write_ins`/`fetch_draft_write_ins` apply
                        # no field filter, so `row.party_size` is ALWAYS
                        # present and reads `0`, never absent, for an unsized
                        # write-in -- `getattr`'s default is dead code here,
                        # not the mechanism. What actually makes this correct
                        # is the round trip: PocketBase's own `NumberField`
                        # validator short-circuits on a `0` value BEFORE it
                        # ever checks `Min` (`core/field_number.go`,
                        # `if val == 0 { ...; return nil }`), so `min: 1`
                        # never fires here -- a DIFFERENT, stricter gate from
                        # `AvailabilityWriteRequest`'s own `ge=1` in
                        # `api/schemas/lodging.py`, which rejects a literal 0
                        # before it ever reaches PocketBase and is what
                        # `_i_or_none`'s docstring means by "unwritable
                        # through the API" -- that is the FastAPI path
                        # (`set_availability`), not this one. `_i_or_none`
                        # (`lodging_roster_service.py`) then maps `0` back to
                        # `None` on read, same as it always did.
                        #
                        # NOT rewritten to call `_i_or_none` here, deliberately
                        # -- that helper answers "is this column genuinely
                        # set", the READ-side question; this line's job is a
                        # verbatim table-to-table COPY of whatever the source
                        # row already carries, and `0` copied to `0` already
                        # round-trips to the right answer without asking it.
                        "party_size": getattr(row, "party_size", None),
                    }
                )
            except ClientResponseError as exc:
                raise pb_error_to_http(exc) from exc
        return len(rows)

    async def _clear_row(self, existing: Any | None, delete: Callable[[str], Awaitable[None]]) -> tuple[str, bool]:
        """Drop one row if it is there, and say what happened.

        The find above sees the row, but it can vanish before the delete
        reaches PocketBase -- two staff clearing the same unit, or a
        double-click. ONLY 404 is swallowed, exactly as `unplace_party`'s
        delete swallows it; any other failure keeps its status through
        `pb_error_to_http`, because "the delete was refused" must not read as
        "there was nothing to delete".

        Shared by both halves of `set_availability` since kindred#2382 split
        the table in two. Two copies of a swallow-only-404 rule is two chances
        to widen one of them.
        """
        if existing is None:
            return "", False
        record_id = str(existing.id)
        try:
            await delete(record_id)
        except ClientResponseError as exc:
            if exc.status == 404:
                return record_id, False
            raise pb_error_to_http(exc) from exc
        return record_id, True

    async def _upsert_row(
        self,
        *,
        what: str,
        existing: Any | None,
        data: dict[str, Any],
        find: Callable[[], Awaitable[Any | None]],
        create: Callable[[dict[str, Any]], Awaitable[Any]],
        update: Callable[[str, dict[str, Any]], Awaitable[Any]],
        **context: Any,
    ) -> Any:
        """Create or update one row, recovering a lost unique-index race.

        The find and the create are two round trips, so they RACE: two staff
        writing the same unit for the same weekend both find no row, both
        create, and the unique index rejects the loser. Unguarded that is a
        400 out of `pb_error_to_http` for a write the board is entitled to
        make, so the loser re-reads and updates the winner's row -- which by
        construction is the row this call wanted, same weekend and same unit.

        `REFUSAL_STATUSES` are re-raised rather than retried: a 401/403 is an
        answer, not a race, and re-reading would turn "you may not" into a
        second failure with a worse message.

        The recovery's own two calls are guarded the same way `place_party`'s
        are, and for the same reason: a failure inside the except block is the
        very 500 the block exists to prevent.

        ONE implementation for both halves of the split (kindred#2382). The
        occupancy row and the role row live in different tables with the same
        race, and duplicating twenty lines of recovery is how the two come to
        answer a lost race differently.
        """
        if existing is not None:
            try:
                return await update(str(existing.id), data)
            except ClientResponseError as exc:
                raise pb_error_to_http(exc) from exc
        try:
            return await create(data)
        except ClientResponseError as exc:
            if exc.status in REFUSAL_STATUSES:
                raise pb_error_to_http(exc) from exc
            try:
                raced = await find()
                if raced is None:
                    raise pb_error_to_http(exc) from exc
                record = await update(str(raced.id), data)
                self._log_recovered_race(what, exc, **context)
                return record
            except ClientResponseError as retry_exc:
                raise pb_error_to_http(retry_exc) from retry_exc

    async def set_availability(self, request: AvailabilityWriteRequest) -> LodgingWriteResponse:
        """Write somebody into one unit for this weekend, or release one to families.

        ONE ENDPOINT, TWO TABLES since kindred#2382, and which one it writes
        depends on which question the body is answering:

        | `family_available` | fact      | table                          |
        |--------------------|-----------|--------------------------------|
        | `false`            | OCCUPANCY | `lodging_write_ins`            |
        | `true`             | ROLE      | `lodging_availability`         |
        | `null`             | clear     | both -- delete whichever exist |

        The column used to answer both through one boolean. `true` on a staff
        cabin is a staff<->family ROLE override for the weekend, which the
        owner ruled is NOT scenario-scoped -- "that's more of a known 'were
        moving staff to X for weekend Y'" -- and 1500000135's "availability is
        a fact about the WEEKEND, not about the plan" is exactly right for it,
        which is why that half stays put and keeps its no-scenario shape.
        `false` was an OCCUPANCY, and that IS scenario-scoped: not every
        write-in is non-rostered staff, some are paper registrations for
        families arriving with no children, and a modelling choice belongs to
        the scenario that made it.

        `scenario` STEERS THE OCCUPANCY HALF AND NOTHING ELSE (PR 4 of
        kindred#2382). Blank writes `lodging_write_ins`, the LIVE board -- a
        scope in its own right rather than the absence of one (owner,
        2026-08-15: staff must be able to record a write-in on the real board,
        not only inside a modelling sandbox). A scenario id writes that
        scenario's own `lodging_write_ins_draft` row instead.

        WHY THE REQUEST GREW ONE AT ALL. PR 3 made a scenario's write-ins
        REPLACE the live ones on read, and this method still wrote the live
        table for everybody -- so a staff member working inside a scenario
        recorded a write-in, that scenario's own read replaced it away, and the
        board they had just made it on did not show it. Before PR 3 the read
        fell through and the same write was visible; the fix is here rather
        than in the read, because a fall-through is exactly what kindred#1974
        removed for placements.

        THE ROLE HALF IGNORES IT, deliberately, rather than refusing a release
        made from inside a scenario. staff<->family role is not scenario-scoped
        (owner: "that's more of a known 'were moving staff to X for weekend
        Y'"), so a release written while looking at a plan is still a fact
        about the weekend, and `lodging_availability` has no scenario column to
        put one in.

        ONE FACT AT A TIME, and this is the promise the split has to keep
        deliberately. A single row could only ever hold one of the two, so
        writing an occupancy over a release replaced it; with two tables
        nothing removes the loser unless this does. Hence the drop after each
        write.

        THE DROP IS SCOPED TO THE CALLER'S OWN GRAIN. The role row is shared by
        every scope; an occupancy row is not. So a release made inside a
        scenario drops that scenario's write-in and leaves the live one alone,
        and a live release leaves every scenario's alone -- reaching across
        would clear a fact nobody on this board can see, on the strength of a
        click made somewhere else.

        WHICH MAKES "ONE FACT AT A TIME" A PER-SCOPE PROMISE, not a global one,
        and that is the cost of the asymmetry rather than an oversight. Write
        somebody into a cabin on the live board, then release it from inside a
        scenario, and both rows exist: the live occupancy the scenario's drop
        could not see, and the weekend-level role row it just wrote.
        `is_family_available` still folds both in and the live board still
        reads the write-in, and a clear on either grain removes the role row
        along with its own occupancy. Narrowing the role drop instead would
        leave a release standing under a write-in on the SAME board, which is
        worse.

        WHAT THE LIVE BOARD THEN SHOWS DEPENDS ON THE COUNT, and this paragraph
        claimed unconditionally that the cabin "reads closed" until
        kindred#2503. Occupancy is no longer absolute: a write-in that leaves
        beds free leaves the cabin OPEN to a family, by design (kindred#2432
        made a written-into cabin take a family like any other). An unsized
        write-in takes the space wholesale and still closes it. So the
        surviving row is always VISIBLE on the live board -- it badges, it
        names its occupant, and its beds leave the count -- which is the
        property this asymmetry actually needs; "closed" was only ever the
        wholesale case.

        ORDER: the new fact is written BEFORE the old one is dropped. There is
        no transaction across two PocketBase tables, and a failure between the
        steps has to leave the board saying something true. Write-then-drop
        leaves BOTH rows present for that window; drop-then-write would leave a
        window with NEITHER fact, opening a cabin nobody meant to open. Both
        rows present is the recoverable state, and that is what fixes the
        order.

        THE MECHANISM MOVED IN kindred#2503, AND THIS PARAGRAPH NAMED THE OLD
        ONE. It used to read "`_build_units` resolves occupancy over role -- so
        a half-applied write-in still reads 'somebody is in it', the safe
        half." Two things about that are now wrong. `_build_units` no longer
        resolves occupancy at all: it writes the ROLE-only answer and
        `_resolve_family_availability` overwrites it from the resolved covers,
        on both orchestrators. And "the safe half" was conditional even then --
        a half-applied write-in carrying a COUNT smaller than the cabin leaves
        beds free and the cabin stays open to a family, which is the deliberate
        kindred#2432 behaviour rather than a regression.

        The ordering argument survives all of that intact, because it never
        depended on which answer the derivation returns. What it needs is that
        the window contains the write-in ROW rather than nothing, so the fact
        is still on the board and still recoverable by a retry. Do not
        re-derive this order from a claim about what the cabin renders as.

        `family_available: null` DELETES rather than writing a value meaning
        "normal". There is no such value: the absence of a row is how "whatever
        this unit's role says" is spelled, and writing a value that happens to
        agree with the role would pin the unit against a later change to it.
        With two tables it deletes BOTH, or a clear would silently do nothing
        to whichever fact it missed.

        `reason` is written to the `note` COLUMN. This and `_build_units` are
        still the only two places that translate -- the fact moved tables and
        did not gain a third translation site.

        `occupant_name` is written UNTRANSLATED, because a hold IS a write-in
        (owner ruling, kindred#2078) and the column was added for it under the
        name the API already wanted. It is required through the control and
        optional here; see the schema for why the requirement lives there.
        """
        session_pb_id = await self._resolve_session_pb_id(request.year, request.session_cm_id)

        # WHICH OCCUPANCY TABLE this call is about, resolved ONCE and threaded
        # through every branch below. Bound as a group rather than branched on
        # at each of the five use sites, because the failure mode of getting it
        # wrong at one of them is silent: a find on the draft grain paired with
        # a create on the live one writes the right row in the wrong scope, and
        # the board it was made on still does not show it.
        in_scenario = request.scenario != ""
        find_occupancy: Callable[[], Awaitable[Any | None]] = (
            (
                lambda: self.repository.find_draft_write_in(
                    request.year, request.session_cm_id, request.scenario, request.unit_id
                )
            )
            if in_scenario
            else (lambda: self.repository.find_write_in(request.year, request.session_cm_id, request.unit_id))
        )
        create_occupancy = self.repository.create_draft_write_in if in_scenario else self.repository.create_write_in
        update_occupancy = self.repository.update_draft_write_in if in_scenario else self.repository.update_write_in
        delete_occupancy = self.repository.delete_draft_write_in if in_scenario else self.repository.delete_write_in

        # BOTH lookups on every call, because every branch has to know about
        # the fact it is NOT writing: an occupancy has a release to drop, a
        # release has an occupancy to drop, and a clear has both.
        existing_role = await self.repository.find_availability_override(
            request.year, request.session_cm_id, request.unit_id
        )
        existing_write_in = await find_occupancy()

        if request.family_available is None:
            write_in_id, write_in_deleted = await self._clear_row(existing_write_in, delete_occupancy)
            role_id, role_deleted = await self._clear_row(existing_role, self.repository.delete_availability)
            # The occupancy id is reported in preference to the role id when
            # both were there. It is the one the board was almost certainly
            # looking at -- every row this split moved was an occupancy -- and
            # a response can only name one.
            return LodgingWriteResponse(
                record_id=write_in_id or role_id,
                deleted=write_in_deleted or role_deleted,
            )

        # The fields both tables share. `family_available` is deliberately NOT
        # among them: on the occupancy table the ROW is the fact, and a column
        # restating it would be the conflation growing back.
        data: dict[str, Any] = {
            "session": session_pb_id,
            "session_cm_id": request.session_cm_id,
            "year": request.year,
            "unit": request.unit_id,
            # WHO is in the room (kindred#2078). No translation: the API field
            # and the column share one name, so this is the whole of it.
            "occupant_name": request.occupant_name,
            # The API's `reason` meets the column's `note` HERE, and in
            # `_build_units` on the way back out. Nowhere else.
            "note": request.reason,
        }

        # `is True`, never truthiness. `None` is already handled above, so a
        # bare test would in fact be correct here -- and this file's own rule
        # is that the three values of this field are never read for
        # truthiness, because the one place that starts is the place a later
        # edit folds a write-in into a clear.
        if request.family_available is True:
            record = await self._upsert_row(
                what="availability",
                existing=existing_role,
                data={**data, "family_available": True},
                find=lambda: self.repository.find_availability_override(
                    request.year, request.session_cm_id, request.unit_id
                ),
                create=self.repository.create_availability,
                update=self.repository.update_availability,
                year=request.year,
                session_cm_id=request.session_cm_id,
                unit_id=request.unit_id,
            )
            await self._clear_row(existing_write_in, delete_occupancy)
        else:
            record = await self._upsert_row(
                what="write-in",
                existing=existing_write_in,
                data={
                    **data,
                    "party_size": request.party_size,
                    # `scenario` rides on the OCCUPANCY payload only. The draft
                    # collection's relation is required; the live one has no
                    # such column, and the role payload above must never carry
                    # one.
                    **({"scenario": request.scenario} if in_scenario else {}),
                },
                find=find_occupancy,
                create=create_occupancy,
                update=update_occupancy,
                year=request.year,
                session_cm_id=request.session_cm_id,
                unit_id=request.unit_id,
                scenario=request.scenario,
            )
            await self._clear_row(existing_role, self.repository.delete_availability)

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
        idx_lodging_slot_merge_unique is UNIQUE on (unit, session_cm_id, year,
        scenario) since 1500000147 -- '' is an ordinary value in that index, same as any
        scenario id -- so two staff merging the same house at the same tier
        both find no row, both create, and the index rejects the loser.
        Guarded identically -- the loser re-reads and updates the winner's
        row, which by construction is the row this call wanted.
        """
        session_pb_id = await self._resolve_session_pb_id(request.year, request.session_cm_id)

        existing = await self.repository.find_slot_merge(
            request.year, request.session_cm_id, request.unit_id, request.scenario
        )

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
                        request.year, request.session_cm_id, request.unit_id, request.scenario
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

    def _capacity_by_unit_id(self, units: list[Any]) -> dict[str, int | None]:
        """Each unit's TRUE (effective) capacity, keyed by id -- the same
        figure `write_in_covers` publishes as `unit_sleeps` (kindred#2477
        final review, Important #4).

        A leaf's raw `sleeps` column IS its capacity, but a combined
        container's own `sleeps` is a DELTA over its rooms (kindred#2041's
        ruling) and reads 0 on every production container -- reading it
        directly, as `_push_rows` used to, published that delta as a
        write-in's bed count instead of the whole-house total. Reuses
        `lodging_roster_service`'s `_capacity_by_code`/`_effective_sleeps`
        walk rather than re-deriving it: that walk is already the one place
        this computation lives, and importing it here creates no cycle --
        this module already imports `SessionNotFoundError`/`placement_grain`/
        `resolved_units` from `lodging_roster_service`, which does not import
        back from this module.

        Builds a MINIMAL `LodgingUnitSummary` per raw unit -- just the fields
        `_effective_sleeps`'s walk actually reads (code, parent_code, sleeps,
        is_container, is_active) -- rather than routing through
        `_build_units`, which additionally needs availability/write-in/merge
        rows this method has no reason to fetch.
        """
        code_by_id = {str(getattr(u, "id", "") or ""): str(getattr(u, "code", "") or "") for u in units}
        summaries = [
            LodgingUnitSummary(
                unit_id=str(getattr(u, "id", "") or ""),
                code=str(getattr(u, "code", "") or ""),
                name=str(getattr(u, "name", "") or ""),
                sleeps=unit_capacity(int(getattr(u, "sleeps", 0) or 0)),
                is_container=bool(getattr(u, "is_container", False)),
                is_active=bool(getattr(u, "is_active", False)),
                parent_code=code_by_id.get(str(getattr(u, "parent_unit", "") or ""), ""),
            )
            for u in units
            if str(getattr(u, "code", "") or "")
        ]
        unit_index = _BathroomIndex.build(summaries)
        capacity_by_code = _capacity_by_code(summaries, unit_index)
        return {str(getattr(u, "id", "") or ""): capacity_by_code.get(str(getattr(u, "code", "") or "")) for u in units}

    def _push_rows(
        self, rows: list[Any], units_by_id: dict[str, Any], capacity_by_unit_id: dict[str, int | None]
    ) -> list[PushRow]:
        """One occupancy read (live or draft) turned into `PushRow`s.

        `unit_code` / `unit_name` fall back to the raw `unit` relation id when
        the row names a unit `fetch_units` did not return -- a unit deleted
        or year-mismatched since the row was written -- so a building this
        row cannot be grouped under still renders as SOMETHING rather than
        vanishing from the report. `classify_push`'s own `key_for` makes the
        identical fallback for grouping.

        `sleeps` reads `capacity_by_unit_id` (the EFFECTIVE capacity --
        `_capacity_by_unit_id`'s docstring), never `unit.sleeps` directly --
        that raw column is a combined container's DELTA, not its capacity.

        `party_size` reads through `_i_or_none` (kindred#2555 fix-round),
        the SAME normalizer `write_in_covers` uses in lodging_roster_service.py:
        PocketBase declares the column `NUMERIC DEFAULT 0 NOT NULL`, so an
        unset write-in reads back as literal `0`, never SQL NULL. A raw
        `getattr` would read that 0 as a recorded party of nobody -- a false
        "0 of N beds" line and a false conflict against a scenario row that
        genuinely recorded a count -- instead of `PushRow.party_size`'s own
        documented meaning of `None`: occupies the room WHOLESALE.
        """
        out: list[PushRow] = []
        for row in rows:
            unit_id = str(getattr(row, "unit", "") or "")
            unit = units_by_id.get(unit_id)
            out.append(
                PushRow(
                    unit_id=unit_id,
                    unit_code=str(getattr(unit, "code", "") or "") if unit is not None else unit_id,
                    unit_name=str(getattr(unit, "name", "") or "") if unit is not None else unit_id,
                    occupant_name=str(getattr(row, "occupant_name", "") or ""),
                    note=str(getattr(row, "note", "") or ""),
                    party_size=_i_or_none(row, "party_size"),
                    sleeps=capacity_by_unit_id.get(unit_id),
                )
            )
        return out

    async def preview_push(self, year: int, session_cm_id: int, scenario: str) -> PushPreviewResponse:
        """The report half of the kindred#2477 push. Classification is SERVER-SIDE
        ONLY -- inside a scenario the client never reads lodging_write_ins (the
        roster replaces them with the draft twin), so it cannot diff. The client
        renders this payload and echoes `digest`; there is deliberately no TS
        mirror of the classifier.
        """
        if not scenario:
            raise ValueError("push preview requires a scenario -- the live board cannot push onto itself")
        units = await self.repository.fetch_units(year)
        units_by_id = {str(getattr(u, "id", "") or ""): u for u in units}
        capacity_by_unit_id = self._capacity_by_unit_id(units)
        live = self._push_rows(
            await self.repository.fetch_write_ins(year, session_cm_id), units_by_id, capacity_by_unit_id
        )
        draft = self._push_rows(
            await self.repository.fetch_draft_write_ins(year, session_cm_id, scenario),
            units_by_id,
            capacity_by_unit_id,
        )
        buildings = classify_push(live, draft, units)
        return PushPreviewResponse(
            year=year,
            session_cm_id=session_cm_id,
            scenario=scenario,
            digest=push_digest(buildings),
            buildings=[_building_report(b) for b in buildings],
        )

    async def _live_rows_with_ids(self, year: int, session_cm_id: int) -> list[tuple[Any, PushRow]]:
        """The live board's write-ins, paired with the raw record each `PushRow`
        came from (kindred#2477).

        `_push_rows` throws the record id away turning a raw row into a
        `PushRow` -- fine for a report, useless for a write, which needs to
        name the exact row to delete. This zips the two back together rather
        than widening `PushRow` itself, because `PushRow.tuple_key()` is the
        matching key `classify_push` and `push_digest` both hash, and a fifth
        field on it would move into every one of those tuples too.

        TAKES `year`/`session_cm_id` DIRECTLY, not a `PushExecuteRequest` --
        the brief's draft threaded the whole request through, but the live
        board has no scenario dimension at all, so accepting one here would
        invite a caller to believe it matters. `execute_push` below is not the
        only caller: Task 5's Unpush replays a ledger row against the SAME
        live rows, under no scenario at all (a sentinel like `"unpush"` would
        be make-believe), so the signature this method actually needs is the
        weekend alone.

        PURE FETCH-AND-ADAPT, and deliberately does not call `preview_push` --
        it has no digest to check and no decisions to apply, so a caller
        wanting the guarded, classified diff calls that instead.
        """
        units = await self.repository.fetch_units(year)
        units_by_id = {str(getattr(u, "id", "") or ""): u for u in units}
        capacity_by_unit_id = self._capacity_by_unit_id(units)
        raw = await self.repository.fetch_write_ins(year, session_cm_id)
        return list(zip(raw, self._push_rows(raw, units_by_id, capacity_by_unit_id), strict=True))

    async def execute_push(self, request: PushExecuteRequest, pushed_by: str) -> PushExecuteResponse:
        """Apply a scenario's write-ins onto the live board (kindred#2477).

        RE-CLASSIFIES FIRST, and compares its own fresh digest against the
        caller's -- never trusts a client-supplied classification, because the
        board or the scenario can move in the time a staff member spends
        looking at the review. A mismatch refuses with `PushDigestStaleError`,
        carrying the fresh report so the router can hand it straight back as
        the 409 body.

        BLOCKED UNTIL DECIDED: every `conflict` and `remove` building must
        have an entry in `request.decisions`, or the whole push refuses via
        `PushDecisionsIncompleteError`. There is no default-keep-live path --
        see that error's docstring for why.

        RESOLVE, THEN LEDGER, THEN APPLY -- in that order, and the order is
        pinned by `TestExecutePush.test_ledger_write_precedes_the_apply_calls`
        (fix-round, 2026-08-23). RESOLVE covers THREE independent checks, all
        BEFORE `create_push_event` runs at all -- the session is turned into a
        PocketBase id (`_resolve_session_pb_id`), every remove is turned into
        a live record id, and every add's target unit is confirmed free or
        about to be vacated by this push's own removes. None can move after
        the ledger write -- see each's own comment at its call site for the
        failure it prevents.

        SESSION FIRST, AND AHEAD OF THE NO-OP RETURN TOO (kindred#2555 scan
        fix-round, 2026-08-23; the no-op return used to come first, letting a
        push against an orphaned `session_cm_id` with nothing to add or
        remove answer 200 instead of 404). `SessionsSync` orphan-deletes
        `camp_sessions` rows while `session_cm_id` survives on the lodging
        tables (docs/architecture/sync-layer.md), so a weekend that classified
        cleanly above can still have no session record by the time this
        method reaches it. `SessionNotFoundError` here has to 404 with
        NOTHING written -- resolving after `create_push_event` would leave a
        ledger row naming an add/remove that then never applies, and because
        `unpush`'s drift guard requires every `add` to still be present live,
        that orphan row could never be reverted or cleared.

        THEN THE LIVE-ROW CHECKS, both reading `_live_rows_with_ids` ONCE.
        That call re-fetches the live board independently of the `fresh`
        snapshot taken at the top of this method, so the two reads can
        disagree about the very rows `fresh` already classified. A miss on
        the REMOVE side -- a row deleted by someone else in the gap between
        the two fetches -- must not silently skip: `removed` and the ledger
        would then both claim a delete that never happened, and Task 5's
        Unpush would replay a delete against a row already gone. A miss on
        the ADD side -- a row created by someone else on an add's target unit
        in that same gap -- must not silently proceed either: the create
        would collide with it AFTER the ledger row already exists, so the
        ledger would lie about what actually landed. Either miss refuses the
        WHOLE push via `PushDigestStaleError`, carrying a FRESHLY RE-RUN
        preview -- not `fresh` above, which is already stale by definition
        the moment a miss is found -- and writes NO ledger row. Only once
        every remove has resolved, every add's target is clear, AND the
        session has resolved does `create_push_event` run, and only after
        that do the deletes/creates it just described actually happen: a
        crash mid-apply then leaves a ledger row naming exactly what was
        intended, never a row promising a write this method could not
        actually make (spec §4.2). `changes` carries the payload BOTH
        directions -- what makes Task 6's Unpush a replay: delete what the
        push added, recreate what it removed.

        `live_ids` KEYS ON THE SAME FOUR-FIELD TUPLE `PushRow.tuple_key()`
        RETURNS -- the RULED matching tuple `classify_push` already groups on
        -- so the live record a "scenario"/"remove" decision deletes is found
        the same way the classifier decided it conflicted or should go, not a
        second, independently-written lookup free to disagree with the first.
        Built by calling `.tuple_key()` on the genuine `PushRow`s
        `_live_rows_with_ids` returns; looked up by hand-building the
        identical tuple from `PushRowPayload` (the wire shape `removes` holds,
        off `fresh.buildings[*].live`) -- that model is a separate Pydantic
        class with no `tuple_key()` method of its own, so the shape is
        reproduced rather than a second definition of it invented. `live_by_unit`
        (kindred#2555 scan fix-round, M) is the same fetch keyed on unit_id
        alone instead -- safe because `idx_lodging_write_in_unique` (unit,
        session_cm_id, year) already forces at most one live row per unit --
        which is what lets the add-side check ask "is this unit's CURRENT
        occupant, if any, one of the rows this push's own removes will
        delete?" without a second read.

        `party_size` IS EXPLICIT ALWAYS ON THE CREATE PAYLOAD, `None` included.
        This method is the "fifth producer" kindred#2540's data-loss guard
        warns about -- `set_availability`, `_seed_write_ins` (both copy paths)
        and `update_write_in`'s implicit pass-through are the other four, and
        every one of them was audited to carry the field explicitly rather
        than let a dict-literal omission silently drop it. Mutation-checked:
        Step 4 of the task brief deletes this line and confirms the covering
        test goes red.

        THE WRITE PHASES (`create_push_event`, the delete/create apply loops)
        are wrapped in `pb_error_to_http` (kindred#2555 scan fix-round, M) --
        this file's own convention for a raw PocketBase write (`_upsert_row`'s
        docstring) -- as the belt for whatever residual `ClientResponseError`
        still reaches a write once the pre-checks above have closed the
        collisions they can see.
        """
        fresh = await self.preview_push(request.year, request.session_cm_id, request.scenario)
        if fresh.digest != request.digest:
            raise PushDigestStaleError(fresh)

        needing = [b for b in fresh.buildings if b.cls in ("conflict", "remove")]
        missing = sorted(b.key for b in needing if b.key not in request.decisions)
        if missing:
            raise PushDecisionsIncompleteError(f"undecided: {', '.join(missing)}")

        adds: list[PushRowPayload] = []
        removes: list[PushRowPayload] = []
        replaced = kept = matched = 0
        for b in fresh.buildings:
            if b.cls == "add":
                adds.extend(b.draft)
            elif b.cls == "match":
                matched += 1
            elif b.cls == "conflict":
                if request.decisions[b.key] == "scenario":
                    removes.extend(b.live)
                    adds.extend(b.draft)
                    replaced += 1
                else:
                    kept += 1
            elif b.cls == "remove":
                if request.decisions[b.key] == "remove":
                    removes.extend(b.live)
                else:
                    kept += 1

        # Resolved BEFORE the no-op return and BEFORE the ledger write
        # (kindred#2555 scan fix-round, 2026-08-23): every execute path
        # resolves the session first (05f29b89's own intent), and a push
        # against an orphaned/stale `session_cm_id` -- `SessionsSync`
        # orphan-deletes `camp_sessions` rows while `session_cm_id` survives
        # on the lodging tables (docs/architecture/sync-layer.md) -- must 404
        # even when there is nothing to add or remove, not read back as a 200
        # no-op. Resolving after `create_push_event` would leave a ledger row
        # naming an add/remove that then never applies, and because
        # `unpush`'s drift guard requires every `add` to still be present
        # live, that orphan row could never be reverted or cleared.
        session_pb_id = await self._resolve_session_pb_id(request.year, request.session_cm_id)

        if not adds and not removes:
            return PushExecuteResponse(
                push_id="", added=0, removed=0, replaced=replaced, kept=kept, matched=matched, no_op=True
            )

        # Resolve every remove to a live record id, and verify every add's
        # target unit is free (or about to be vacated by this push's own
        # removes) -- BOTH before anything is written. See the method
        # docstring for why a miss here refuses rather than skips.
        #
        # `live_rows_with_ids` is fetched once and read two ways: `live_ids`
        # (the RULED four-field tuple) resolves removes exactly as before;
        # `live_by_unit` (kindred#2555 scan fix-round, M) is the add-side
        # symmetric check -- a live row appearing on an add's target unit
        # between the entry re-classify and the apply would otherwise collide
        # AFTER the ledger row already exists, making the ledger lie about
        # what actually landed. At most one live row per unit
        # (`idx_lodging_write_in_unique`), so keying on unit_id alone is safe.
        live_rows_with_ids = await self._live_rows_with_ids(request.year, request.session_cm_id)
        live_ids = {r.tuple_key(): str(getattr(row, "id", "") or "") for row, r in live_rows_with_ids}
        live_by_unit = {r.unit_id: str(getattr(row, "id", "") or "") for row, r in live_rows_with_ids}

        remove_ids: list[str] = []
        for r in removes:
            rid = live_ids.get((r.unit_id, r.occupant_name.strip(), r.note.strip(), r.party_size))
            if rid is None:
                stale = await self.preview_push(request.year, request.session_cm_id, request.scenario)
                raise PushDigestStaleError(stale)
            remove_ids.append(rid)

        removing = set(remove_ids)
        for r in adds:
            occupant_id = live_by_unit.get(r.unit_id)
            if occupant_id is not None and occupant_id not in removing:
                stale = await self.preview_push(request.year, request.session_cm_id, request.scenario)
                raise PushDigestStaleError(stale)

        changes = [
            {
                "action": "remove",
                "unit": r.unit_id,
                "unit_code": r.unit_code,
                "occupant_name": r.occupant_name,
                "note": r.note,
                "party_size": r.party_size,
            }
            for r in removes
        ] + [
            {
                "action": "add",
                "unit": r.unit_id,
                "unit_code": r.unit_code,
                "occupant_name": r.occupant_name,
                "note": r.note,
                "party_size": r.party_size,
            }
            for r in adds
        ]
        # Ledger FIRST, then apply: a crash mid-apply leaves a row naming
        # exactly what was intended (spec §4.2). Every remove above has
        # already resolved to a real record id, so nothing this ledger row
        # claims can turn out to be undeliverable once the apply loop below
        # actually runs.
        #
        # `scenario_name` carries the SAME value as `scenario_id` -- there is
        # no cheap scenario-record-name accessor on `LodgingRepository` today,
        # so a display name would cost an extra round trip this ledger write
        # does not otherwise need. Accepted as v1 (the id is at least legible
        # to whoever reads the raw table); a follow-up can resolve the display
        # name once a reader actually needs it rendered.
        try:
            event = await self.repository.create_push_event(
                {
                    "year": request.year,
                    "session_cm_id": request.session_cm_id,
                    "scenario_id": request.scenario,
                    "scenario_name": request.scenario,
                    "pushed_by": pushed_by,
                    "changes": changes,
                    "unpushed_at": "",
                }
            )
        except ClientResponseError as exc:
            raise pb_error_to_http(exc) from exc
        try:
            for rid in remove_ids:
                await self.repository.delete_write_in(rid)
        except ClientResponseError as exc:
            raise pb_error_to_http(exc) from exc
        try:
            for r in adds:
                await self.repository.create_write_in(
                    {
                        "year": request.year,
                        "session_cm_id": request.session_cm_id,
                        "session": session_pb_id,
                        "unit": r.unit_id,
                        "occupant_name": r.occupant_name,
                        "note": r.note,
                        "party_size": r.party_size,
                    }
                )
        except ClientResponseError as exc:
            raise pb_error_to_http(exc) from exc
        return PushExecuteResponse(
            push_id=str(getattr(event, "id", "") or ""),
            added=len(adds),
            removed=len(removes),
            replaced=replaced,
            kept=kept,
            matched=matched,
        )

    async def unpush(self, push_id: str, year: int, session_cm_id: int) -> UnpushResponse:
        """Revert one push as a unit (kindred#2477 Task 5).

        REPLAYS `changes` IN REVERSE: `execute_push` recorded every row it
        added and every row it removed, so reverting is "delete what was
        added, recreate what was removed" -- no re-classification, no
        re-diffing against the scenario, because the ledger row already IS
        the diff that was applied.

        VALIDATES BEFORE TOUCHING ANYTHING (RULED refuse-wholesale, owner
        2026-08-22): every touched unit's LIVE state must still match the
        push's after-state -- an added row still present tuple-identical, a
        removed row still absent -- before a single write happens. ANY
        mismatch raises `UnpushDriftError` naming the offending building
        codes and reverts nothing. See that error's docstring for why a
        partial revert is worse than refusing outright, and why this also
        covers unpushing an older push after a newer one moved the same
        units.

        `by_tuple` KEYS ON `PushRow.tuple_key()`, the same four-field RULED
        matching tuple `execute_push` and `classify_push` both use --
        current live rows resolved to their record ids the same way
        `execute_push`'s own `live_ids` is built, not a second, independently
        written lookup free to disagree with the first.

        ON PASS: adds are deleted by the id resolved from THIS live fetch
        (not a stale id off the ledger row -- a live row keeps its identity
        across an unrelated edit that leaves its tuple unchanged, but a
        record id copied from the push event could not survive that);
        removes are recreated with `party_size` EXPLICIT ALWAYS, `None`
        included -- the identical #2540 hazard `execute_push`'s own create
        call documents, and the same reason a dict-literal omission would
        silently drop a wholesale-occupancy write-in into an unsized one.

        TWO PHASES, DELETES BEFORE CREATES -- NOT `changes` ITERATION ORDER
        (fix, kindred#2477, found by Task 10's live-PocketBase acceptance
        pass against real unique indexes). `execute_push` stores `changes`
        as `[removes..., adds...]`; a single pass over that list in stored
        order therefore recreates every removed row BEFORE it deletes any
        added row. For a conflict decided "take scenario" -- the ordinary
        case for a resolved conflict, not an edge case -- the push's remove
        and add name the SAME unit, so the stray still-live pushed row is
        sitting on `idx_lodging_write_in_unique` (unit, session_cm_id, year)
        at the exact moment the recreate tries to claim it: a
        `ClientResponseError` the mocked repository in this file's own tests
        cannot produce, because a `MagicMock` enforces no unique index. Two
        explicit passes -- every `add` deleted first, only then every
        `remove` recreated -- guarantee the unit is vacated before anything
        tries to occupy it again, independent of whatever order `changes`
        happens to store its two kinds in.

        `unpushed_at` is stamped only once BOTH phases have actually run, so
        a crash before this line leaves the ledger row still claiming "not
        yet unpushed" rather than a row that says it was reverted when it was
        not.

        NOT "recoverable by retrying", despite how that reads -- a retry
        after a crash mid-phase-2 hits the SAME drift guard above and 409s.
        Phase 2 recreates a `remove` change's row; if the crash lands after
        some of those recreates land but before `unpushed_at` is stamped, a
        retry's own drift check sees exactly what a hand-edit would have left
        -- a row the push's after-state says should be ABSENT, now PRESENT --
        and refuses wholesale, the same as `test_manual_edit_since_push_refuses_wholesale`
        covers for an actual manual edit. The guard cannot tell "unpush
        partially ran" from "someone recreated this by hand", and does not
        try to: staff resolve a drifted push by hand, not by retrying it.
        """
        event = await self.repository.find_push_event(push_id)
        if event is None:
            raise PushNotFoundError(push_id)
        # The ledger row names its OWN weekend. `find_push_event(push_id)`
        # resolves by id alone, so without this check any push id addressed
        # with a DIFFERENT weekend's year/session_cm_id would replay that
        # push's changes onto a board they were never taken from -- an
        # honest 404 ("no such push for THIS weekend"), not a 500 or a
        # cross-weekend write.
        if getattr(event, "year", None) != year or getattr(event, "session_cm_id", None) != session_cm_id:
            raise PushNotFoundError(push_id)
        if getattr(event, "unpushed_at", ""):
            raise AlreadyUnpushedError(push_id)
        changes: list[dict[str, Any]] = _json_list(event, "changes")

        live = await self._live_rows_with_ids(year, session_cm_id)
        # A dict keyed on `tuple_key()` collapses a duplicate key silently --
        # safe here only because `idx_lodging_write_in_unique` (unit,
        # session_cm_id, year) makes two live rows sharing a tuple on the
        # SAME side schema-impossible: the unit_id alone already forces at
        # most one live row per unit, so `by_tuple` can never lose one.
        by_tuple = {r.tuple_key(): str(getattr(row, "id", "") or "") for row, r in live}
        # unit_id -> that unit's live tuple, for the `remove` check below.
        # Keying on unit_id alone is safe for the identical reason `by_tuple`
        # is: the unique index already forces at most one live row per unit.
        by_unit = {r.tuple_key()[0]: r.tuple_key() for _row, r in live}

        def change_tuple(c: dict[str, Any]) -> tuple[str, str, str, int | None]:
            return (c["unit"], c["occupant_name"].strip(), c["note"].strip(), c["party_size"])

        # The tuples THIS push's own `add` changes name -- phase 1 below
        # deletes every one of them, so a `remove` change whose target unit
        # currently holds exactly one of these is not drift: it is the
        # pushed row, still waiting for phase 1 to vacate it.
        own_add_tuples = {change_tuple(c) for c in changes if c["action"] == "add"}

        drifted: list[str] = []
        for c in changes:
            if c["action"] == "add":
                if change_tuple(c) not in by_tuple:
                    drifted.append(c["unit_code"])  # the row the push added was edited/removed
            elif c["action"] == "remove":
                # kindred#2555 scan fix-round (M): drift is not "the ORIGINAL
                # removed tuple is back" alone -- ANY occupant on this unit
                # that phase 1 will not itself clear is a row phase 2's
                # recreate would collide with on idx_lodging_write_in_unique
                # (unit, session_cm_id, year). The recreate-target unit must
                # hold nothing, or only a row this push's own adds account
                # for.
                occupant = by_unit.get(c["unit"])
                if occupant is not None and occupant not in own_add_tuples:
                    drifted.append(c["unit_code"])
        if drifted:
            raise UnpushDriftError(sorted(set(drifted)))

        session_pb_id = await self._resolve_session_pb_id(year, session_cm_id)
        deleted = restored = 0
        # PHASE 1: every delete, before any create -- see the method
        # docstring. Vacates every unit the push occupied before phase 2
        # tries to recreate a row on any of them.
        try:
            for c in changes:
                if c["action"] == "add":
                    await self.repository.delete_write_in(by_tuple[change_tuple(c)])
                    deleted += 1
        except ClientResponseError as exc:
            raise pb_error_to_http(exc) from exc
        # PHASE 2: every create, only now that phase 1 has freed whichever
        # units a "take scenario" conflict shares between its remove and its
        # add.
        try:
            for c in changes:
                if c["action"] != "add":
                    await self.repository.create_write_in(
                        {
                            "year": year,
                            "session_cm_id": session_cm_id,
                            "session": session_pb_id,
                            "unit": c["unit"],
                            "occupant_name": c["occupant_name"],
                            "note": c["note"],
                            "party_size": c["party_size"],
                        }
                    )
                    restored += 1
        except ClientResponseError as exc:
            raise pb_error_to_http(exc) from exc
        try:
            await self.repository.update_push_event(
                str(getattr(event, "id", "") or ""), {"unpushed_at": datetime.now(UTC).isoformat()}
            )
        except ClientResponseError as exc:
            raise pb_error_to_http(exc) from exc
        return UnpushResponse(push_id=push_id, restored=restored, deleted=deleted)


def _row_payload(row: PushRow) -> PushRowPayload:
    return PushRowPayload(
        unit_id=row.unit_id,
        unit_code=row.unit_code,
        unit_name=row.unit_name,
        occupant_name=row.occupant_name,
        note=row.note,
        party_size=row.party_size,
        sleeps=row.sleeps,
    )


def _building_report(building: PushBuilding) -> PushBuildingReport:
    return PushBuildingReport(
        key=building.key,
        label=building.label,
        cls=building.cls,
        live=[_row_payload(r) for r in building.live],
        draft=[_row_payload(r) for r in building.draft],
    )
