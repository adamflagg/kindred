"""Weekend friend groups — a staff-authored set of households (kindred#1913).

Its own module rather than more rows in `api/schemas/lodging.py`, because the
object is independent of the roster: nothing here is derived from a request,
parsed out of free text, or resolved against a name. Staff select households
and say what they mean.

NO `intent` FIELD, ON PURPOSE. kindred#1913's owner ruling: a friend group is
"lock these households together," full stop -- `with` (same cabin) vs. `near`
(distance-satisfied) is a property of whatever later CONSUMES a group, the
solver tool half 2 of the issue builds, not of the group itself. The
registration form's own `ProximityKind` (`near | with | similar_ages`) is a
different vocabulary for a different object and was never mirrored here.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

# WHO authored the group. `staff_manual` is the only value anything writes
# today; `proposed` is the seam kindred#1913 asks for and nothing more -- a
# later solver or "processed requests" pipeline writes its suggestions into
# this same table rather than into a parallel one. Neither exists yet.
FriendGroupSource = Literal["staff_manual", "proposed"]

# The nine-colour palette the UI offers, as hex. Validated by shape, not by
# membership: the palette is a presentation choice and belongs in the
# frontend, so pinning the list here would make adding a colour a schema
# change.
HEX_COLOR = r"^#[0-9a-fA-F]{6}$"


def _dedupe(values: list[int]) -> list[int]:
    """Order-preserving dedupe.

    Applied on BOTH the create and the edit path. `[JOHNSON, JOHNSON]` is one
    household written twice, and two member rows for one household would
    violate 1500000146's per-group unique index -- so the dedupe is a
    structural rule, unlike the floor below.
    """
    seen: set[int] = set()
    unique: list[int] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            unique.append(value)
    return unique


def _distinct_households(values: list[int]) -> list[int]:
    """Dedupe, then the two-household floor. CREATE ONLY.

    Deduping BEFORE the floor is the point: `[JOHNSON, JOHNSON]` is one
    household written twice, not a group of two, and accepting it would create
    a "group" that no placement rule could ever act on.

    THE FLOOR IS A CREATE-TIME RULE AND IS NOT REUSED ON PATCH, which is what
    summer does and what the owner ruled on 2026-08-09. Summer gates its
    Create button on `pendingCampers.length >= 2` and then never checks again:
    `LockGroupPanel`'s `removeMemberMutation` deletes a member unconditionally
    and `getGroupValidationIssues` returns no issue at all for a group under
    two. Re-applying the floor on PATCH turned the member row's X button into
    a 422 as soon as a group was down to two members.
    """
    unique = _dedupe(values)
    if len(unique) < 2:
        raise ValueError("a friend group needs at least two distinct households")
    return unique


class FriendGroupMember(BaseModel):
    """One household in a group.

    A CampMinder id, never a PocketBase id -- the repo-wide rule (CLAUDE.md
    §1) and what every other household-grain lodging row stores.
    """

    household_cm_id: int
    added_by: str = ""


class FriendGroup(BaseModel):
    """One staff-authored group, with its membership resolved."""

    group_id: str
    year: int
    session_cm_id: int
    name: str = ""
    color: str = ""
    source: FriendGroupSource = "staff_manual"
    created_by: str = ""
    members: list[FriendGroupMember] = Field(default_factory=list)


class FriendGroupListResponse(BaseModel):
    year: int
    session_cm_id: int
    groups: list[FriendGroup] = Field(default_factory=list)


class FriendGroupCreateRequest(BaseModel):
    """Create one group for one weekend.

    NO `scenario`. Migration 1500000146 gives this table no scenario dimension,
    following `lodging_availability` rather than summer's `locked_groups`: a
    group records what households asked for, which is true of the weekend in
    every plan for it. See that migration's header for the full argument.
    """

    year: int = Field(..., ge=2000, le=2100)
    session_cm_id: int = Field(..., gt=0)
    name: str = Field("", max_length=200)
    color: str = Field(..., pattern=HEX_COLOR)
    source: FriendGroupSource = "staff_manual"
    household_cm_ids: list[int] = Field(..., min_length=2)

    @field_validator("household_cm_ids")
    @classmethod
    def _check_households(cls, values: list[int]) -> list[int]:
        # `> 0`, not `!= 0`: 0 is the wire value a person-grain roster party
        # carries in `household_cm_id`, so it would match every adult-weekend
        # guest at once rather than none of them.
        if any(value <= 0 for value in values):
            raise ValueError("household_cm_ids must be positive CampMinder ids")
        return _distinct_households(values)


class FriendGroupUpdateRequest(BaseModel):
    """PATCH one group. Every field is optional; omitted means untouched.

    The distinction that matters: `name=None` is "leave the name alone",
    `name=""` is "clear it, and fall back to the auto-name" -- which is what a
    blank input means in summer's action bar too. Collapsing the two would
    make a recolour silently blank the name.

    `None` means "leave alone" REGARDLESS of whether the field was omitted or
    sent explicitly as `null`. The service enforces this with
    `model_dump(exclude_unset=True, exclude_none=True)` -- `exclude_unset`
    alone is not enough, because it keys off `model_fields_set`, not the
    value, so an explicit `null` on the wire would otherwise survive as a
    write.

    `year` and `session_cm_id` are absent on purpose. Moving a group to
    another weekend is not an edit to it; the membership is a set of
    households enrolled in THAT weekend, and re-pointing the row would carry
    households that are not on the destination roster.

    NO TWO-HOUSEHOLD FLOOR ON THIS PATH, and its absence is load-bearing.
    The floor is a create-time rule -- `FriendGroupCreateRequest` keeps it --
    exactly as summer's is (`LockGroupActionBar` gates Create on two pending
    campers; `LockGroupPanel.removeMemberMutation` then deletes members with
    no guard at all, and `getGroupValidationIssues` reports nothing for a
    group under two). Owner ruling, 2026-08-09. With `min_length=2` here the
    member row's X button 422'd the moment a group was down to two, and the
    board's bulk add could half-apply: the PATCH adding households to the
    target succeeded while the PATCH draining their old group was rejected.
    Positivity and the dedupe still apply -- both are structural, unlike the
    floor.
    """

    name: str | None = Field(None, max_length=200)
    color: str | None = Field(None, pattern=HEX_COLOR)
    household_cm_ids: list[int] | None = None

    @field_validator("household_cm_ids")
    @classmethod
    def _check_households(cls, values: list[int] | None) -> list[int] | None:
        if values is None:
            return None
        if any(value <= 0 for value in values):
            raise ValueError("household_cm_ids must be positive CampMinder ids")
        return _dedupe(values)


class FriendGroupDeleteResponse(BaseModel):
    group_id: str
    deleted: bool = False
