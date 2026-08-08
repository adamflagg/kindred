"""Weekend friend groups: a staff-authored set of HOUSEHOLDS, with an intent.

kindred#1913 half 1. The object is deliberately NOT derived from anything --
no free-text parsing, no name resolution, no solver. Staff select households
and say what they mean, and `source` is the seam a later proposer would write
through without a schema change.

Two invariants this file exists to pin:

* `intent` is REQUIRED and is `with` or `near`. The issue is explicit that
  those are different requests -- `near` is satisfied by distance between
  units, `with` by putting both parties in one room -- so a group that cannot
  say which one it means is the wrong object. There is no default; a caller
  that does not choose gets a 422.
* A group is at HOUSEHOLD grain and needs at least two of them. One household
  is not a friend group, it is a household.

Fictional CampMinder ids throughout (tests/CLAUDE.md): nothing here is a real
household.
"""

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

from api.schemas.lodging_friend_groups import (
    FriendGroupCreateRequest,
    FriendGroupUpdateRequest,
)
from api.services.lodging_friend_group_service import (
    FriendGroupNotFoundError,
    LodgingFriendGroupService,
)
from api.services.lodging_roster_service import SessionNotFoundError

YEAR = 2026
SESSION_CM_ID = 1000001
# Fictional household CampMinder ids -- the Johnson, Garcia and Chen households
# of tests/CLAUDE.md's set, never a real family.
JOHNSON = 2000001
GARCIA = 2000002
CHEN = 2000003


def _sessions_repo(session: Any = SimpleNamespace(id="sess_1")) -> MagicMock:
    repo = MagicMock()
    repo.fetch_session = AsyncMock(return_value=session)
    return repo


def _groups_repo(**overrides: Any) -> MagicMock:
    repo = MagicMock()
    defaults: dict[str, Any] = {
        "fetch_groups": [],
        "fetch_members": [],
        "find_group": None,
        "create_group": SimpleNamespace(id="grp_new"),
        "update_group": SimpleNamespace(id="grp_1"),
        "delete_group": None,
        "create_member": SimpleNamespace(id="mem_new"),
        "delete_member": None,
    }
    defaults.update(overrides)
    for method, value in defaults.items():
        setattr(repo, method, AsyncMock(return_value=value))
    return repo


def _service(sessions: MagicMock | None = None, groups: MagicMock | None = None) -> LodgingFriendGroupService:
    return LodgingFriendGroupService(sessions or _sessions_repo(), groups or _groups_repo())


def _create_request(**overrides: Any) -> FriendGroupCreateRequest:
    fields: dict[str, Any] = {
        "year": YEAR,
        "session_cm_id": SESSION_CM_ID,
        "name": "Johnson, Garcia",
        "color": "#22c55e",
        "intent": "with",
        "household_cm_ids": [JOHNSON, GARCIA],
    }
    fields.update(overrides)
    return FriendGroupCreateRequest(**fields)


def _group_row(**overrides: Any) -> SimpleNamespace:
    fields: dict[str, Any] = {
        "id": "grp_1",
        "year": YEAR,
        "session_cm_id": SESSION_CM_ID,
        "name": "Johnson, Garcia",
        "color": "#22c55e",
        "intent": "with",
        "source": "staff_manual",
        "created_by": "staff@example.com",
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _member_row(group: str, household_cm_id: int) -> SimpleNamespace:
    return SimpleNamespace(id=f"mem_{household_cm_id}", group=group, household_cm_id=household_cm_id, added_by="")


# --------------------------------------------------------------------- schema


class TestCreateRequestSchema:
    def test_intent_is_required(self) -> None:
        # No default. `near` and `with` are different requests; a group that
        # does not say which is not a group we can honour.
        with pytest.raises(ValidationError):
            FriendGroupCreateRequest(
                year=YEAR,
                session_cm_id=SESSION_CM_ID,
                color="#22c55e",
                household_cm_ids=[JOHNSON, GARCIA],
            )

    def test_intent_rejects_a_third_value(self) -> None:
        # `similar_ages` is a ProximityKind but not a placement intent: it
        # ACCOMPANIES `with`, it is not an alternative to it.
        with pytest.raises(ValidationError):
            _create_request(intent="similar_ages")

    def test_both_intents_build(self) -> None:
        assert _create_request(intent="near").intent == "near"
        assert _create_request(intent="with").intent == "with"

    def test_a_group_needs_two_households(self) -> None:
        with pytest.raises(ValidationError):
            _create_request(household_cm_ids=[JOHNSON])

    def test_household_ids_must_be_positive(self) -> None:
        # 0 is the wire value for "not this grain" on a RosterParty, so it
        # must never be stored as a member.
        with pytest.raises(ValidationError):
            _create_request(household_cm_ids=[JOHNSON, 0])

    def test_duplicate_households_collapse_but_still_need_two_distinct(self) -> None:
        with pytest.raises(ValidationError):
            _create_request(household_cm_ids=[JOHNSON, JOHNSON])

    def test_colour_must_be_a_hex_triplet(self) -> None:
        with pytest.raises(ValidationError):
            _create_request(color="green")

    def test_source_defaults_to_staff_manual(self) -> None:
        # The seam: a later proposer sends `proposed` into the same table.
        assert _create_request().source == "staff_manual"
        assert _create_request(source="proposed").source == "proposed"

    def test_session_cm_id_must_be_positive(self) -> None:
        with pytest.raises(ValidationError):
            _create_request(session_cm_id=0)


class TestUpdateRequestSchema:
    def test_every_field_is_optional(self) -> None:
        request = FriendGroupUpdateRequest()
        assert request.name is None
        assert request.color is None
        assert request.intent is None
        assert request.household_cm_ids is None

    def test_a_membership_edit_still_needs_two_households(self) -> None:
        with pytest.raises(ValidationError):
            FriendGroupUpdateRequest(household_cm_ids=[JOHNSON])

    def test_renaming_to_blank_is_allowed(self) -> None:
        # Blank means "fall back to the auto-name", exactly as summer's blank
        # input does. It is not the same as omitting the field.
        assert FriendGroupUpdateRequest(name="").name == ""


# ---------------------------------------------------------------------- reads


class TestListGroups:
    @pytest.mark.asyncio
    async def test_an_unknown_weekend_is_a_404(self) -> None:
        service = _service(sessions=_sessions_repo(session=None))
        with pytest.raises(SessionNotFoundError):
            await service.list_groups(YEAR, SESSION_CM_ID)

    @pytest.mark.asyncio
    async def test_groups_carry_their_members(self) -> None:
        groups = _groups_repo(
            fetch_groups=[_group_row()],
            fetch_members=[_member_row("grp_1", JOHNSON), _member_row("grp_1", GARCIA)],
        )
        response = await _service(groups=groups).list_groups(YEAR, SESSION_CM_ID)

        assert len(response.groups) == 1
        assert [m.household_cm_id for m in response.groups[0].members] == [JOHNSON, GARCIA]
        assert response.groups[0].intent == "with"

    @pytest.mark.asyncio
    async def test_a_member_of_another_group_does_not_leak_in(self) -> None:
        groups = _groups_repo(
            fetch_groups=[_group_row(), _group_row(id="grp_2", name="Chen")],
            fetch_members=[_member_row("grp_1", JOHNSON), _member_row("grp_2", CHEN)],
        )
        response = await _service(groups=groups).list_groups(YEAR, SESSION_CM_ID)

        by_id = {group.group_id: group for group in response.groups}
        assert [m.household_cm_id for m in by_id["grp_1"].members] == [JOHNSON]
        assert [m.household_cm_id for m in by_id["grp_2"].members] == [CHEN]


# --------------------------------------------------------------------- writes


class TestCreateGroup:
    @pytest.mark.asyncio
    async def test_an_unknown_weekend_is_a_404(self) -> None:
        service = _service(sessions=_sessions_repo(session=None))
        with pytest.raises(SessionNotFoundError):
            await service.create_group(_create_request(), "staff@example.com")

    @pytest.mark.asyncio
    async def test_the_row_carries_the_durable_key_beside_the_relation(self) -> None:
        # kindred#1879: the relation is for joins, session_cm_id is the key
        # that survives a year. Every neighbouring lodging table stores both.
        groups = _groups_repo()
        await _service(groups=groups).create_group(_create_request(), "staff@example.com")

        data = groups.create_group.await_args.args[0]
        assert data["session"] == "sess_1"
        assert data["session_cm_id"] == SESSION_CM_ID
        assert data["year"] == YEAR

    @pytest.mark.asyncio
    async def test_the_author_is_recorded(self) -> None:
        groups = _groups_repo()
        await _service(groups=groups).create_group(_create_request(), "staff@example.com")

        data = groups.create_group.await_args.args[0]
        assert data["created_by"] == "staff@example.com"
        assert data["source"] == "staff_manual"

    @pytest.mark.asyncio
    async def test_one_member_row_per_household(self) -> None:
        groups = _groups_repo()
        await _service(groups=groups).create_group(_create_request(), "staff@example.com")

        stored = [call.args[0]["household_cm_id"] for call in groups.create_member.await_args_list]
        assert stored == [JOHNSON, GARCIA]
        assert {call.args[0]["group"] for call in groups.create_member.await_args_list} == {"grp_new"}

    @pytest.mark.asyncio
    async def test_the_response_echoes_the_members(self) -> None:
        group = await _service().create_group(_create_request(), "staff@example.com")
        assert [m.household_cm_id for m in group.members] == [JOHNSON, GARCIA]
        assert group.group_id == "grp_new"


class TestUpdateGroup:
    @pytest.mark.asyncio
    async def test_an_unknown_group_is_a_404(self) -> None:
        service = _service(groups=_groups_repo(find_group=None))
        with pytest.raises(FriendGroupNotFoundError):
            await service.update_group("grp_missing", FriendGroupUpdateRequest(name="x"), "staff@example.com")

    @pytest.mark.asyncio
    async def test_an_omitted_field_is_not_written(self) -> None:
        # PATCH semantics: recolouring must not blank the name.
        groups = _groups_repo(find_group=_group_row(), fetch_members=[_member_row("grp_1", JOHNSON)])
        await _service(groups=groups).update_group("grp_1", FriendGroupUpdateRequest(color="#3b82f6"), "s@example.com")

        data = groups.update_group.await_args.args[1]
        assert data == {"color": "#3b82f6"}

    @pytest.mark.asyncio
    async def test_the_intent_can_be_switched(self) -> None:
        groups = _groups_repo(find_group=_group_row(), fetch_members=[_member_row("grp_1", JOHNSON)])
        await _service(groups=groups).update_group("grp_1", FriendGroupUpdateRequest(intent="near"), "s@example.com")

        assert groups.update_group.await_args.args[1] == {"intent": "near"}

    @pytest.mark.asyncio
    async def test_membership_is_replaced_not_appended(self) -> None:
        groups = _groups_repo(
            find_group=_group_row(),
            fetch_members=[_member_row("grp_1", JOHNSON), _member_row("grp_1", GARCIA)],
        )
        await _service(groups=groups).update_group(
            "grp_1", FriendGroupUpdateRequest(household_cm_ids=[JOHNSON, CHEN]), "s@example.com"
        )

        # Garcia leaves, Chen joins, Johnson is left alone rather than churned.
        assert groups.delete_member.await_args_list[0].args[0] == f"mem_{GARCIA}"
        assert len(groups.delete_member.await_args_list) == 1
        added = [call.args[0]["household_cm_id"] for call in groups.create_member.await_args_list]
        assert added == [CHEN]

    @pytest.mark.asyncio
    async def test_a_membership_edit_does_not_touch_the_group_row(self) -> None:
        groups = _groups_repo(
            find_group=_group_row(),
            fetch_members=[_member_row("grp_1", JOHNSON), _member_row("grp_1", GARCIA)],
        )
        await _service(groups=groups).update_group(
            "grp_1", FriendGroupUpdateRequest(household_cm_ids=[JOHNSON, CHEN]), "s@example.com"
        )
        groups.update_group.assert_not_awaited()


class TestDeleteGroup:
    @pytest.mark.asyncio
    async def test_an_unknown_group_is_a_404(self) -> None:
        service = _service(groups=_groups_repo(find_group=None))
        with pytest.raises(FriendGroupNotFoundError):
            await service.delete_group("grp_missing")

    @pytest.mark.asyncio
    async def test_dissolving_drops_the_group_row(self) -> None:
        # Members go with it: the member relation cascades in PocketBase, so
        # this layer deletes exactly one row and does not fan out.
        groups = _groups_repo(find_group=_group_row())
        response = await _service(groups=groups).delete_group("grp_1")

        groups.delete_group.assert_awaited_once_with("grp_1")
        assert response.deleted is True
        assert response.group_id == "grp_1"
