"""Writes for the weekend lodging board.

EVERY write here targets the DRAFT grain, or `lodging_availability`. Nothing in
this module can reach `lodging_assignments`, `lodging_assignment_history` or
`lodging_field_mappings`: those belong to the CampMinder ingest, stay
`is_admin` in PocketBase (1500000132), and are the reason the draft tables
exist at all. Summer draws the identical line and has never crossed it.

There is no UI on top of this yet, deliberately. The schema risk lands in one
reviewable change with no interaction design competing for review attention.

WHAT IS NOT VALIDATED, and why. A merge's member set is not checked for
completeness against the unit tree. That rule -- "a merge is legal iff its
members are the complete child set of some container" -- was built through nine
tasks, fully reviewed, and REMOVED in #1903, because every member set is
hand-authored: a deliberate partial booking and a mis-click produce
byte-identical rows, so no rule can discriminate between the case it is for and
the case it is against. Read docs/architecture/lodging-occupancy.md before
adding anything of that shape.

Occupancy -- how many parties may share one unit -- is the constraint that
genuinely needs modelling (kindred#1907), and it belongs at the point a human
is choosing, which is the board. Not here, and not in the ingest.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from api.schemas.lodging import (
    AvailabilityWriteRequest,
    LodgingWriteResponse,
    MergeWriteRequest,
    PlacementDeleteRequest,
    PlacementWriteRequest,
)
from api.services.lodging_roster_service import SessionNotFoundError
from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from api.services.lodging_repository import LodgingRepository

logger = get_logger(__name__)

# lodging_assignments.source, whose select list this shares. A row written from
# the board is staff_manual by construction -- the other two values name sync
# jobs, and no sync writes the draft.
STAFF_SOURCE = "staff_manual"

# lodging_merges_draft.created_by. The truth table's ingest writes
# "campminder_sync" into the same column, so the two are distinguishable on
# sight when a board renders slots from both.
STAFF_CREATED_BY = "staff_manual"


class LodgingWriteService:
    """Draft placements, draft merges, and per-scenario availability."""

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
        allow exactly one row per (session, year, party, scenario). Creating a
        second would be rejected by the database; this never asks it to.

        All three targets empty is the TOMBSTONE -- "staff took this party off
        the board in this scenario" -- and is a legitimate row, not a no-op.
        Deleting the row instead would fall through to the CampMinder mirror
        and put the family back in the cabin they were just dragged out of.
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
            "unit": request.unit_id,
            "merge": request.merge_id,
            "merge_draft": request.merge_draft_id,
            "source": STAFF_SOURCE,
            "staff_touched": True,
        }

        if existing is not None:
            record = await self.repository.update_draft_assignment(str(existing.id), data)
        else:
            record = await self.repository.create_draft_assignment(data)
        return LodgingWriteResponse(record_id=str(getattr(record, "id", "")))

    async def clear_placement(self, request: PlacementDeleteRequest) -> LodgingWriteResponse:
        """Drop a party's draft row, restoring what the synced rows say.

        Distinct from the tombstone above, and the only way back to the
        CampMinder mirror for one party without discarding the whole scenario.

        Idempotent: no row is a 200 with `deleted: false`, not a 404. The board
        may fire this for a card that was never moved, and a 404 there would be
        an error message about nothing having gone wrong.
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

        await self.repository.delete_draft_assignment(str(existing.id))
        return LodgingWriteResponse(record_id=str(existing.id), deleted=True)

    async def create_merge(self, request: MergeWriteRequest) -> LodgingWriteResponse:
        """Bind units into one bookable slot for this scenario.

        Writes lodging_merges_draft, never lodging_merges. The truth table is
        materialised by the ingest from CampMinder cabin strings and staff hold
        no write on it -- a board merge is a planning act, and planning lives
        in the draft.

        No dedup by member set, unlike the ingest's EnsureMerge. That function
        dedupes because a backfill re-runs over the same cabin strings and
        would otherwise write a fresh row each pass. A human clicking "merge"
        twice means it twice, and the board can delete what it did not want.
        """
        session_pb_id = await self._resolve_session_pb_id(request.year, request.session_cm_id)

        data: dict[str, Any] = {
            "session": session_pb_id,
            "session_cm_id": request.session_cm_id,
            "year": request.year,
            "scenario": request.scenario,
            "member_units": request.member_unit_ids,
            "display_name": request.display_name,
            "created_by": STAFF_CREATED_BY,
        }
        if request.capacity_override is not None:
            data["capacity_override"] = request.capacity_override

        record = await self.repository.create_draft_merge(data)
        return LodgingWriteResponse(record_id=str(getattr(record, "id", "")))

    async def delete_merge(self, merge_draft_id: str) -> LodgingWriteResponse:
        """Remove a board-built slot.

        Draft placements pointing at it are left alone on purpose:
        `merge_draft` is `cascadeDelete: false`, so a placement whose slot is
        deleted keeps its row and reads as unplaced rather than vanishing. The
        roster already treats a placement with no resolvable target that way.
        """
        await self.repository.delete_draft_merge(merge_draft_id)
        return LodgingWriteResponse(record_id=merge_draft_id, deleted=True)

    async def set_availability(self, request: AvailabilityWriteRequest) -> LodgingWriteResponse:
        """Reserve or release one unit for this weekend, inside a scenario.

        `state: null` DELETES the scenario's row rather than writing a state
        meaning "normal". There is no such state -- the select list is
        reserved_staff / reserved_other / released_to_family -- and the absence
        of a row is what "whatever the live plan says" is spelled as. Writing
        an override that happens to agree with the live plan would pin the unit
        against a later change to it.
        """
        session_pb_id = await self._resolve_session_pb_id(request.year, request.session_cm_id)

        existing = await self.repository.find_availability_override(
            request.year, session_pb_id, request.scenario, request.unit_id
        )

        if request.state is None:
            if existing is None:
                return LodgingWriteResponse(deleted=False)
            await self.repository.delete_availability(str(existing.id))
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
            record = await self.repository.create_availability(data)
        return LodgingWriteResponse(record_id=str(getattr(record, "id", "")))
