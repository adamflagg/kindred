"""Pure decision rules for the weekend lodging surface.

No I/O, no PocketBase, no FastAPI — every function is total over plain values
so the rules can be unit-tested without a database, and so the same rule is
never re-implemented differently in the repository, the service, and React.

Scope note — what is deliberately NOT here. The share gate, the NEAR/WITH
modes and the free-text request are derived by the Go ingest into typed
columns on `family_camp_registrations` (`share_cabin_gate`, `wants_near`,
`wants_with`, `wants_similar_ages`, `request_text`), and this surface READS
those columns rather than re-parsing the raw answers. Re-deriving them in
Python would fork two documented fixes that only exist on the Go side:

- ``NormalizeShareGate`` requires the sentence to contain "shar" before it
  reads a leading "no" as a decline, because the modes field's own
  "No requests" option (209 rows across 2025-2026) otherwise parses as a hard
  no and silently strips the household's eligibility for staff pairing.
- ``ParseSharedCabinModes`` tests NEAR and WITH independently rather than as
  ordered arms, so an option naming both sets both.

The rules that remain are the ones with no ingest equivalent: they are
properties of the physical units and of per-session availability, which the
ingest never touches.
"""

from __future__ import annotations

from collections.abc import Sequence

# Values of lodging_units.bathroom. An unset PocketBase select stores as "",
# which means "nobody has told us yet", not "no bathroom".
BATHROOM_VALUES = ("none", "private", "shared")


def unit_capacity(sleeps: int | None) -> int | None:
    """Return the bed count, or None when capacity is unknown.

    PocketBase declares number columns `NUMERIC DEFAULT 0 NOT NULL`, so a
    `sleeps` value staff never filled in stores as 0 and never as NULL. Nine
    seeded units are in that state, five of them bookable -- the other four
    are container rows, which no capacity count includes anyway. 0 therefore
    means UNKNOWN: never render it as "sleeps 0" and never sum it into a
    capacity total.
    """
    if sleeps is None or sleeps <= 0:
        return None
    return int(sleeps)


# Values of lodging_units.shareability (1500000145, kindred#2026). An unset
# select stores as "", which is a real third state: nobody has classified this
# unit. It is neither permission to double-book nor a ruling that one family
# only may go here.
SHAREABILITY_VALUES = ("shareable", "single_party")


def unit_shareability(stored: str) -> str:
    """Render the stored classification, or `unknown` when there is none.

    NOT a derivation, and deliberately so. The rule that decides `shareable`
    vs `single_party` lives in exactly two places -- 1500000145's backfill and
    `classifyShareability` in pocketbase/lodging/registry.go -- and the
    registry they write is canonical. Re-deriving it here from `sleeps` would
    be a third copy free to disagree with the column it is rendering, and it
    would answer confidently on rows nobody has classified: an unmeasured
    cabin is exactly where a guess is both easiest and most damaging.

    So this maps and nothing more. Anything unrecognised -- an empty column, or
    a value added to the select by a schema newer than this build -- degrades
    to `unknown`, the non-permissive state, rather than being passed through
    into a Literal no consumer has a branch for.
    """
    return stored if stored in SHAREABILITY_VALUES else "unknown"


def is_family_available(inventory_class: str, override: bool | None, is_occupied: bool) -> bool:
    """Whether this unit can take a family this weekend, in exactly one place.

    | base          | override | occupied | family-available     |
    |---------------|----------|----------|----------------------|
    | family_pool   | None     | no       | yes                  |
    | family_pool   | None     | yes      | no  (written into)   |
    | family_pool   | False    | no       | no  (closed by role) |
    | staff_default | None     | no       | no                   |
    | staff_default | True     | no       | yes (released)       |
    | staff_default | True     | yes      | no  (written into)   |

    TWO FACTS, TWO QUESTIONS, and `is_occupied` is what kindred#2382 made
    honest. `override` is the staff<->family ROLE -- is this unit family
    inventory this weekend at all -- and `is_occupied` is whether somebody is
    already in it. One boolean used to answer both, spelling an occupancy as
    `override = False`, which is why `family_available_override` and this
    function looked like the same fact. They are not, and the row that ends the
    conflation is `is_occupied` reaching here from `lodging_write_ins` rather
    than from the role column.

    OCCUPANCY IS ABSOLUTE. It closes the unit whatever the role says, including
    over a `True` release -- a cabin somebody is sleeping in cannot take a
    family, and no ordering of the two is worth a bed collision.

    REQUIRED, never defaulted. A caller that has not thought about occupancy
    must not be able to spell "no occupancy" by omission: this is the derivation
    every count on the stats bar and the board's own open-tint go through, so
    the failure mode of a forgotten argument is a written-into cabin reported
    as open.

    THE ROLE STILL HAS TWO LAYERS, NOT THREE. `lodging_availability` lost its
    scenario dimension in 1500000135 because the ROLE is a fact about the
    WEEKEND rather than about the plan -- "we're moving staff to X for weekend Y" -- and that
    reasoning survived the split intact. Occupancy did not: it IS scenario
    scoped, which is why it arrives here already resolved to one scope rather
    than being looked up.

    The row STATES the outcome rather than implying it. An earlier design had
    the row mean "the opposite of this unit's current default", which an
    ordinary registry edit -- flipping a unit from family_pool to
    staff_default -- would silently invert, turning a cabin closed for a burst
    pipe into the one cabin RELEASED to families.

    `None` and `False` are DIFFERENT answers: None means "no row, so ask the
    role", False means "closed this weekend". Never collapse the two with a
    falsy test.

    A unit created through the admin UI without an explicit
    `inventory_class` stores "" and matches neither base row. We treat "" as
    family_pool so the unit is at least visible, and the roster reports it
    separately via RosterCounts.units_missing_allocation rather than hiding
    the gap.
    """
    if is_occupied:
        return False
    if override is not None:
        return override
    return inventory_class != "staff_default"


def effective_bathroom(
    bathroom: str,
    bathroom_group: str,
    group_member_codes: frozenset[str],
    merged_codes: frozenset[str],
) -> str:
    """Spec §3.2.1 — private vs shared depends on the merge state.

    Tioga 1 and Tioga 2 are each `shared`, because two families normally
    split them. Merge both and the same bathroom becomes `private`, so
    merging can itself be the accommodation for a medical bathroom request.

    Args:
        bathroom: the unit's own value ("", "none", "private", "shared").
        bathroom_group: the unit's group id, "" when it has none.
        group_member_codes: every unit code carrying that bathroom_group.
        merged_codes: the unit codes bound into the slot being evaluated
            (a one-element set for an unmerged unit).

    Returns:
        "unknown" | "none" | "private" | "shared".
    """
    if bathroom not in BATHROOM_VALUES:
        return "unknown"
    if bathroom != "shared":
        return bathroom
    if not bathroom_group:
        return "shared"
    if group_member_codes and group_member_codes <= merged_codes:
        return "private"
    return "shared"


# Values of an amenity's resolved coverage over the rooms a slot actually
# contains (kindred#1912). `unknown` is not a fourth grain -- it is the
# absence of evidence, exactly as it is for `bathroom` and `shareability`.
AMENITY_COVERAGE_VALUES = ("all", "some", "none", "unknown")


def amenity_coverage(values: Sequence[bool | None]) -> str:
    """How much of a slot carries an amenity — kindred#1912.

    A container's stored amenity flags describe the CONTAINER, not its rooms.
    That is the same shape as the settled "a container's `sleeps` is a delta
    over its rooms" ruling, on a different column, and it is the trap this
    function exists for: twelve of the fourteen 2026 family-pool containers
    record `has_power = 0` while every leaf beneath them has power, so a
    caller reading the container's own row marks twelve entirely-powered
    buildings unpowered.

    THREE grains, not a boolean, because both boolean policies fall out of it
    for free -- `OR == result != "none"`, `AND == result == "all"` -- so a
    per-criterion OR/AND policy map would be a strict subset of this that
    costs more to build. What the three grains MEAN differs per criterion
    (for `is_accessible`, SOME is worse than NONE: a building advertising two
    step-free rooms out of ten invites the placement that lands in one of the
    other eight), and that nuance belongs to the renderer, not here.

    This function does not walk anything. Resolving which rooms answer for a
    slot is the caller's job -- `_BathroomIndex.leaf_codes_under` in
    `lodging_roster_service` is the ONE walk over that tree, and a second one
    would be free to drift from it.

    Args:
        values: one entry per unit that answers for the slot -- a leaf's own
            flag, or every leaf descendant's for a container. `None` means
            the unit is unconfirmed, i.e. nobody has recorded the amenity;
            `has_power = False` on an unconfirmed row means "nobody has
            said", never "there is no power".

    Returns:
        "all" | "some" | "none" | "unknown". `unknown` whenever there is
        nothing to judge or ANY contributing unit is unmeasured -- the same
        all-or-nothing evidence bar `resolvePartyUnit` already applies to a
        multi-room merge, rather than a looser standard for having more
        rooms. Never "none" on missing evidence: this feeds a mark that
        STATES something about a slot, and "nothing here meets the need" is
        not a claim an unrecorded row supports.
    """
    if not values or any(value is None for value in values):
        return "unknown"
    if all(values):
        return "all"
    if any(values):
        return "some"
    return "none"


def container_bathroom(leaf_bathroom_groups: frozenset[str]) -> tuple[str, str]:
    """A container's bathroom, inherited from its leaf descendants.

    Containers (buildings, apartments) store `bathroom = "none"` on the
    registry row itself -- the field describes a ROOM, and a building is
    not one. That is correct for the units inventory, which has no
    occupant to resolve the ambiguity for. It is wrong for a party that has
    booked the WHOLE container: the health-center apartments are two
    bedrooms over one shared bath, normally let whole, which is exactly the
    case `effective_bathroom`'s exclusivity branch exists for -- except the
    container's own "none" short-circuits that branch (line 108-109) before
    it ever runs.

    This resolves what "bathroom" and "bathroom_group" to FEED
    `effective_bathroom` on the container's behalf, rather than widening
    that function's signature to know about children. `effective_bathroom`
    stays the same four-argument pure test the class above already pins;
    the inheritance a container needs is a fact about its children, computed
    here and handed in as an ordinary "shared" input.

    Args:
        leaf_bathroom_groups: the `bathroom_group` of every LEAF unit
            directly or indirectly under the container ("" for a leaf with
            no group).

    Returns:
        ("shared", group) when every leaf agrees on the same non-empty
        group -- the children physically share one bathroom, so booking the
        whole container definitionally covers that group. ("none", "")
        when the leaves disagree, carry no group, or there are none at all:
        nothing to inherit, so the container reports exactly what its own
        registry row already says.
    """
    if len(leaf_bathroom_groups) == 1:
        (group,) = leaf_bathroom_groups
        if group:
            return "shared", group
    return "none", ""
