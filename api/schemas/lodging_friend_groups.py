"""Weekend friend groups — a staff-authored set of households (kindred#1913).

Its own module rather than more rows in `api/schemas/lodging.py`, because the
object is independent of the roster: nothing here is derived from a request,
parsed out of free text, or resolved against a name. Staff select households
and say what they mean.

The vocabulary this shares with the roster is deliberately narrow and is
restated here rather than imported, because the two are not the same list.
`ProximityKind` is `near | with | similar_ages` — what the REGISTRATION FORM
can say. A friend group's `intent` is the placement-relevant subset,
`with | near`: `similar_ages` accompanies `with` rather than replacing it, and
a group whose members are named by a staff member cannot mean "somebody with
kids about this age".
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

# What placing this group would have to satisfy. NOT interchangeable: `near`
# is satisfied by distance between units, `with` by putting both parties in
# one room. Required everywhere, with no default -- a group that cannot say
# which one it means is the wrong object.
FriendGroupIntent = Literal["with", "near"]

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


def _distinct_households(values: list[int]) -> list[int]:
    """Order-preserving dedupe, then the two-household floor.

    Deduping BEFORE the floor is the point: `[JOHNSON, JOHNSON]` is one
    household written twice, not a group of two, and accepting it would create
    a "group" that no placement rule could ever act on.
    """
    seen: set[int] = set()
    unique: list[int] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            unique.append(value)
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
    intent: FriendGroupIntent = "with"
    source: FriendGroupSource = "staff_manual"
    created_by: str = ""
    members: list[FriendGroupMember] = Field(default_factory=list)


class FriendGroupListResponse(BaseModel):
    year: int
    session_cm_id: int
    groups: list[FriendGroup] = Field(default_factory=list)


class FriendGroupCreateRequest(BaseModel):
    """Create one group for one weekend.

    NO `scenario`. Migration 1500000144 gives this table no scenario dimension,
    following `lodging_availability` rather than summer's `locked_groups`: a
    group records what households asked for, which is true of the weekend in
    every plan for it. See that migration's header for the full argument.
    """

    year: int = Field(..., ge=2000, le=2100)
    session_cm_id: int = Field(..., gt=0)
    name: str = Field("", max_length=200)
    color: str = Field(..., pattern=HEX_COLOR)
    intent: FriendGroupIntent
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
    """

    name: str | None = Field(None, max_length=200)
    color: str | None = Field(None, pattern=HEX_COLOR)
    intent: FriendGroupIntent | None = None
    household_cm_ids: list[int] | None = Field(None, min_length=2)

    @field_validator("household_cm_ids")
    @classmethod
    def _check_households(cls, values: list[int] | None) -> list[int] | None:
        if values is None:
            return None
        if any(value <= 0 for value in values):
            raise ValueError("household_cm_ids must be positive CampMinder ids")
        return _distinct_households(values)


class FriendGroupDeleteResponse(BaseModel):
    group_id: str
    deleted: bool = False
