"""Weekend friend groups: read, author, edit, dissolve (kindred#1913 half 1).

A friend group is a STAFF-AUTHORED set of households with a stated intent. It
is not derived from anything: no free-text parsing, no name resolution, no
solver. The staff member is the resolver.

WHAT THE "SEAM" IS, AND WHAT IT IS NOT. The issue asks for somewhere a later
solver or "processed requests" pipeline can plug in, while explicitly not
building one. That is `source` and nothing else -- a proposer creates rows in
the same table with `source="proposed"`, and every reader here already handles
it. There is deliberately no proposal queue, no accept/reject state and no
confidence column: each of those is a decision about a pipeline that does not
exist, and inventing them now would fix the shape of one before anybody has
had to live with it.

Its own service and its own repository, rather than more methods on
`LodgingRosterService` / `LodgingWriteService`. Those two are about placements
and the registry behind them; a group is an input to placement and shares no
logic with either. What it DOES share is weekend resolution, so it borrows
`LodgingRepository.fetch_session` rather than growing a second copy of the
session lookup and its type filter.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import TYPE_CHECKING, Any

from pocketbase.client import ClientResponseError  # type: ignore[attr-defined]

from api.constants.collections import LODGING_FRIEND_GROUP_MEMBERS, LODGING_FRIEND_GROUPS
from api.schemas.lodging_friend_groups import (
    FriendGroup,
    FriendGroupCreateRequest,
    FriendGroupDeleteResponse,
    FriendGroupListResponse,
    FriendGroupMember,
    FriendGroupUpdateRequest,
)
from api.services.lodging_roster_service import SessionNotFoundError
from api.utils.pb_error import pb_error_to_http
from bunking.logging_config import get_logger

if TYPE_CHECKING:
    from api.services.lodging_repository import LodgingRepository
    from pocketbase import PocketBase

logger = get_logger(__name__)

# Same ceiling and same reason as LodgingRepository.PAGE_SIZE: `batch` is a
# parameter of `get_full_list` itself and NOT a member of `query_params`, so a
# batch size put in the dict is accepted silently and leaves the SDK default of
# 100 in place. 1000 is PocketBase's declared MaxPerPage, not a guess.
PAGE_SIZE = 1000

# Reads with no meaningful display order pin the record id, which is stable and
# indexed. `get_full_list` walks LIMIT/OFFSET without an ORDER BY unless given
# one, and SQLite may then return a different row order per request -- silently
# dropping a member from a group.
STABLE_SORT = "id"


class FriendGroupNotFoundError(LookupError):
    """A group id that resolves to nothing. The router answers 404."""


def _s(record: Any, field: str) -> str:
    value = getattr(record, field, "")
    return str(value) if value is not None else ""


def _i(record: Any, field: str) -> int:
    value = getattr(record, field, 0)
    try:
        return int(value)
    except TypeError, ValueError:
        return 0


class LodgingFriendGroupRepository:
    """PocketBase access for the two friend-group collections.

    Mirrors `LodgingRepository`'s shape so the service is testable against a
    mock: every paged read goes through `_page`, which is the only place
    `get_full_list` is named.
    """

    def __init__(self, pb: PocketBase) -> None:
        self.pb = pb

    async def _page(self, collection: str, query_params: dict[str, Any]) -> list[Any]:
        return await asyncio.to_thread(
            self.pb.collection(collection).get_full_list,
            batch=PAGE_SIZE,
            query_params=query_params,
        )

    async def fetch_groups(self, year: int, session_pb_id: str) -> list[Any]:
        """Every group on one weekend, oldest first.

        Creation order, not name order: the colour palette rotates by group
        count, so the list reads as the sequence staff built it in.
        """
        return await self._page(
            LODGING_FRIEND_GROUPS,
            query_params={"filter": f'year = {year} && session = "{session_pb_id}"', "sort": "created,id"},
        )

    async def fetch_members(self, group_ids: list[str]) -> list[Any]:
        """Members of the named groups, in one read rather than one per group."""
        if not group_ids:
            return []
        clause = " || ".join(f'group = "{group_id}"' for group_id in group_ids)
        return await self._page(
            LODGING_FRIEND_GROUP_MEMBERS,
            query_params={"filter": clause, "sort": STABLE_SORT},
        )

    async def find_group(self, group_id: str) -> Any | None:
        try:
            return await asyncio.to_thread(self.pb.collection(LODGING_FRIEND_GROUPS).get_one, group_id)
        except ClientResponseError as exc:
            if exc.status == 404:
                return None
            raise

    async def create_group(self, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_FRIEND_GROUPS).create, data)

    async def update_group(self, record_id: str, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_FRIEND_GROUPS).update, record_id, data)

    async def delete_group(self, record_id: str) -> None:
        await asyncio.to_thread(self.pb.collection(LODGING_FRIEND_GROUPS).delete, record_id)

    async def create_member(self, data: dict[str, Any]) -> Any:
        return await asyncio.to_thread(self.pb.collection(LODGING_FRIEND_GROUP_MEMBERS).create, data)

    async def delete_member(self, record_id: str) -> None:
        await asyncio.to_thread(self.pb.collection(LODGING_FRIEND_GROUP_MEMBERS).delete, record_id)


class LodgingFriendGroupService:
    def __init__(self, sessions: LodgingRepository, groups: LodgingFriendGroupRepository) -> None:
        self.sessions = sessions
        self.groups = groups

    async def _resolve_session_pb_id(self, year: int, session_cm_id: int) -> str:
        """CampMinder id -> PocketBase record id, or raise.

        The same resolution every lodging write uses, borrowed rather than
        copied: `fetch_session` is type-filtered to the weekend session types,
        so a summer cm_id 404s here instead of silently authoring a group
        against a session this surface does not own.
        """
        session = await self.sessions.fetch_session(year, session_cm_id)
        if session is None:
            raise SessionNotFoundError(f"No weekend session {session_cm_id} in {year}")
        return str(getattr(session, "id", ""))

    async def _compose(self, year: int, session_cm_id: int, rows: list[Any]) -> list[FriendGroup]:
        """Attach members to group rows in ONE members read, not one per group."""
        group_ids = [_s(row, "id") for row in rows]
        members = await self.groups.fetch_members(group_ids)

        by_group: dict[str, list[FriendGroupMember]] = defaultdict(list)
        for member in members:
            by_group[_s(member, "group")].append(
                FriendGroupMember(
                    household_cm_id=_i(member, "household_cm_id"),
                    added_by=_s(member, "added_by"),
                )
            )

        return [
            FriendGroup(
                group_id=_s(row, "id"),
                year=_i(row, "year") or year,
                session_cm_id=_i(row, "session_cm_id") or session_cm_id,
                name=_s(row, "name"),
                color=_s(row, "color"),
                # The stored values are constrained by the migration's select
                # list, so these cannot widen the Literal at runtime; Pydantic
                # still validates them, so a row hand-edited in the PocketBase
                # admin UI to something else fails loudly here rather than
                # reaching the UI as an unrenderable intent.
                intent=_s(row, "intent") or "with",
                source=_s(row, "source") or "staff_manual",
                created_by=_s(row, "created_by"),
                members=by_group.get(_s(row, "id"), []),
            )
            for row in rows
        ]

    async def list_groups(self, year: int, session_cm_id: int) -> FriendGroupListResponse:
        session_pb_id = await self._resolve_session_pb_id(year, session_cm_id)
        rows = await self.groups.fetch_groups(year, session_pb_id)
        return FriendGroupListResponse(
            year=year,
            session_cm_id=session_cm_id,
            groups=await self._compose(year, session_cm_id, rows),
        )

    async def create_group(self, request: FriendGroupCreateRequest, actor: str) -> FriendGroup:
        """Author one group and its membership.

        NOT a transaction, because PocketBase's REST API gives this layer no
        way to make it one. A failure part-way through the member loop leaves a
        REAL group holding fewer households than were asked for.

        That partial row is kept rather than unwound, and the two halves of
        that choice both matter:

        * It must be VISIBLE. `useFriendGroupMutations` therefore invalidates
          the group query on the ERROR path as well as the success path --
          without that the partial group exists, staff cannot see it, and a
          retry makes a second one.
        * It must be REPAIRABLE with what the UI actually offers, which is
          Rename, Recolour and Dissolve -- NOT member editing, which
          kindred#1913 half 1 deliberately does not build. So the repair is
          "dissolve it and author it again", and the group being visible is
          what makes that possible at all.

        Deleting the group here to unwind would trade a visible, dissolvable
        partial result for a silent total loss of the staff member's
        selection, which the caller cannot reconstruct.
        """
        session_pb_id = await self._resolve_session_pb_id(request.year, request.session_cm_id)

        data: dict[str, Any] = {
            "session": session_pb_id,
            # kindred#1879: the relation is for joins, this is the durable key.
            "session_cm_id": request.session_cm_id,
            "year": request.year,
            "name": request.name,
            "color": request.color,
            "intent": request.intent,
            "source": request.source,
            "created_by": actor,
        }

        try:
            record = await self.groups.create_group(data)
        except ClientResponseError as exc:
            raise pb_error_to_http(exc) from exc

        group_id = str(getattr(record, "id", ""))
        members: list[FriendGroupMember] = []
        for household_cm_id in request.household_cm_ids:
            try:
                await self.groups.create_member(
                    {"group": group_id, "household_cm_id": household_cm_id, "added_by": actor}
                )
            except ClientResponseError as exc:
                raise pb_error_to_http(exc) from exc
            members.append(FriendGroupMember(household_cm_id=household_cm_id, added_by=actor))

        return FriendGroup(
            group_id=group_id,
            year=request.year,
            session_cm_id=request.session_cm_id,
            name=request.name,
            color=request.color,
            intent=request.intent,
            source=request.source,
            created_by=actor,
            members=members,
        )

    async def update_group(self, group_id: str, request: FriendGroupUpdateRequest, actor: str) -> FriendGroup:
        """Rename, recolour, switch intent, or replace the membership.

        `exclude_unset` is what makes this a PATCH rather than a PUT: a
        recolour must not blank the name, and a rename to "" is a real edit
        (blank means "fall back to the auto-name") that must not be confused
        with an omitted field.

        `exclude_none` is stacked alongside it, and closes a gap
        `exclude_unset` alone leaves open: it keys off `model_fields_set`, not
        the value, so an EXPLICIT `{"name": null}` on the wire is "set" and
        would survive into `changes` and write null over a live name. Every
        optional field here already means "leave it alone" at `None` --
        clearing the name is spelled `""`, not `null` -- so a field that is
        `None` is never a value worth writing, whether it arrived as the
        default or as an explicit null.

        Membership is replaced by DIFF, not by delete-all-then-recreate. A
        household that stays in the group keeps its row, its `added_by` and its
        creation time -- and the unique index cannot reject a re-add that races
        its own delete.
        """
        row = await self.groups.find_group(group_id)
        if row is None:
            raise FriendGroupNotFoundError(group_id)

        changes = request.model_dump(exclude_unset=True, exclude_none=True)
        household_cm_ids = changes.pop("household_cm_ids", None)

        if changes:
            try:
                row = await self.groups.update_group(group_id, changes)
            except ClientResponseError as exc:
                raise pb_error_to_http(exc) from exc

        if household_cm_ids is not None:
            await self._replace_members(group_id, list(household_cm_ids), actor)

        year = _i(row, "year")
        session_cm_id = _i(row, "session_cm_id")
        composed = await self._compose(year, session_cm_id, [row])
        return composed[0]

    async def _replace_members(self, group_id: str, wanted: list[int], actor: str) -> None:
        existing = await self.groups.fetch_members([group_id])
        by_household = {_i(member, "household_cm_id"): _s(member, "id") for member in existing}

        for household_cm_id, record_id in by_household.items():
            if household_cm_id not in wanted:
                try:
                    await self.groups.delete_member(record_id)
                except ClientResponseError as exc:
                    # A member already gone is the state this call wanted, not
                    # a failure -- two staff dropping the same household, or a
                    # double-click. Same 404-only swallow the placement delete
                    # uses; anything else keeps its status.
                    if exc.status != 404:
                        raise pb_error_to_http(exc) from exc

        for household_cm_id in wanted:
            if household_cm_id not in by_household:
                try:
                    await self.groups.create_member(
                        {"group": group_id, "household_cm_id": household_cm_id, "added_by": actor}
                    )
                except ClientResponseError as exc:
                    raise pb_error_to_http(exc) from exc

    async def delete_group(self, group_id: str) -> FriendGroupDeleteResponse:
        """Dissolve a group.

        ONE delete. `lodging_friend_group_members.group` cascades (1500000144),
        so PocketBase sweeps the membership server-side -- the same reason
        summer's draft relation was flipped to cascade, to delete an N+1
        client-side pre-delete loop rather than write one here.
        """
        row = await self.groups.find_group(group_id)
        if row is None:
            raise FriendGroupNotFoundError(group_id)

        try:
            await self.groups.delete_group(group_id)
        except ClientResponseError as exc:
            if exc.status == 404:
                return FriendGroupDeleteResponse(group_id=group_id, deleted=False)
            raise pb_error_to_http(exc) from exc

        return FriendGroupDeleteResponse(group_id=group_id, deleted=True)
