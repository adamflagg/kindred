"""Pure decision rules for the weekend lodging surface.

No I/O, no PocketBase, no FastAPI — every function is total over plain values
so the rules can be unit-tested without a database, and so the same rule is
never re-implemented differently in the repository, the service, and React.

Scope note — what is deliberately NOT here. The share gate, the NEAR/WITH
modes and the free-text request are derived by the Go ingest into typed
columns on `family_camp_registrations` (`share_cabin_gate`, `wants_near`,
`wants_with_named`, `wants_similar_ages`, `request_text`), and this surface
READS those columns rather than re-parsing the raw answers. Re-deriving them in
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

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal, NamedTuple

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


def is_family_available(inventory_class: str, override: bool | None, free: int | None) -> bool:
    """Whether this unit can take a family this weekend, in exactly one place.

    | base          | override | free | family-available     |
    |---------------|----------|------|----------------------|
    | family_pool   | None     | None | yes                  |
    | family_pool   | None     | 13   | yes (shared)         |
    | family_pool   | None     | 0    | no  (fully taken)    |
    | family_pool   | False    | None | no  (closed by role) |
    | staff_default | None     | None | no                   |
    | staff_default | True     | None | yes (released)       |
    | staff_default | True     | 0    | no  (fully taken)    |

    TWO FACTS, TWO QUESTIONS. `override` is the staff<->family ROLE -- is this
    unit family inventory this weekend at all -- and `free` is how many beds
    are left once the write-ins covering it are paid for
    (`free_family_spots`). One boolean used to answer both, spelling an
    occupancy as `override = False`; kindred#2382 split them.

    ⚠️ OCCUPANCY IS NOT ABSOLUTE, AND THIS PARAGRAPH USED TO SAY IT WAS.
    kindred#2432 made a written-into cabin take a family like any other --
    "mix and match: a family and a write-in may share a space in either order,
    on a leaf or on a container" -- and the drop refusal
    `if (hasWriteIn(unit)) return null` came out of `dragPlacement.ts` with it.
    The old rule survived here for three releases and made the stats bar
    disagree with the board above it: a fifteen-bed cabin with one person
    written in was reported as zero spaces and zero beds while the board
    accepted families into it. What closes a unit now is having no beds left,
    which is the same answer for a full cabin and a wholesale write-in, and a
    different one for a shared space.

    `free is None` means NO OCCUPANCY, not "unmeasured" -- the same reading
    `override: None` carries two lines above. `free_family_spots` returns 0, not
    None, for a covered cabin nobody has measured.

    REQUIRED, never defaulted. A caller that has not thought about occupancy
    must not be able to spell "no occupancy" by omission: this is the
    derivation every count on the stats bar and the board's own open-tint go
    through, so the failure mode of a forgotten argument is a written-into
    cabin reported as open.

    THE ROLE STILL HAS TWO LAYERS, NOT THREE. `lodging_availability` lost its
    scenario dimension in 1500000135 because the ROLE is a fact about the
    WEEKEND rather than about the plan, and that reasoning survived the split
    intact. Occupancy did not: it IS scenario scoped, which is why `free`
    arrives here already resolved to one scope rather than being looked up.

    `None` and `False` are DIFFERENT answers on `override`: None means "no row,
    so ask the role", False means "closed this weekend". Never collapse the two
    with a falsy test.

    A unit created through the admin UI without an explicit `inventory_class`
    stores "" and matches neither base row. We treat "" as family_pool so the
    unit is at least visible, and the roster reports it separately via
    RosterCounts.units_missing_allocation rather than hiding the gap.
    """
    if free is not None and free <= 0:
        return False
    if override is not None:
        return override
    return inventory_class != "staff_default"


class WriteInLoad(NamedTuple):
    """One write-in's claim on one card.

    `capacity` is the capacity of the unit the ROW names, which is not the
    card's own on a descendant cover: a written-into room inside a combined
    house contributes the ROOM's beds. `None` there means nobody measured it.
    """

    relation: Literal["own", "ancestor", "descendant"]
    party_size: int | None
    capacity: int | None


class WriteInDemand(NamedTuple):
    """What the write-ins on one card take, and whether that is a fact.

    `consumed` drives every spot statement. `sized` drives the card's NUMERATOR
    alone, and excludes both the wholesale fallback and an ancestor's size --
    see `write_in_demand`.

    `sized` is deliberately UNCAPPED, unlike `consumed`. A hand-typed count
    above the card's own spots is what drives kindred#2503's over-capacity red,
    so the numerator has to carry the true recorded figure -- clipping it to
    capacity would hide the very overage the card exists to show.

    ⚠️ `known` AND `usable` ARE TWO DIFFERENT QUESTIONS, and reading the first
    for the second is the defect kindred#2543 was filed for (owner ruling
    2026-08-29).

    * `known` -- did somebody record a size for EVERY party on this card.
      ⚠️ IT GATES NOTHING IN PRODUCTION ANY MORE. This bullet used to say it
      was the ASSIGN MODAL's gate, so a card holding a party nobody counted
      read "occupancy not counted (write-in)" rather than a number -- and that
      stopped being true inside this issue's own review, when the owner
      extended the ruling to the modal: *"sure modal can follow the floor, roll
      that fix in as well."* Its header and its candidate rows now read
      `usable` like the board does. `known` is KEPT because it is still the
      only answer to "did a human count these people", a different question
      from "may this number be printed".
    * `usable` -- may `consumed` be PUBLISHED. It is the gate on EVERY surface
      that prints a remainder -- the board card's drag marks, the Assign
      modal's header, its candidate rows -- and the stats bar's own arithmetic
      (`free_family_spots`) agrees with it by construction.

    `known=False` means three different things, and only ONE of them makes
    `consumed` meaningless:

    | # | situation                                   | `consumed`            |
    |---|---------------------------------------------|-----------------------|
    | 1 | nobody measured the card                    | `0`, and meaningless  |
    | 2 | unsized cover on an unmeasured LEAF         | the whole card        |
    | 3 | unsized cover on a measured leaf            | a real FLOOR          |

    Only (1) is unusable -- there was no capacity to subtract from. (2) and (3)
    are both publishable, because a party cannot exceed the leaf it is sleeping
    in: an unsized cover is already charged that leaf's whole capacity, so the
    remainder can only UNDERSTATE what is free, never overstate it. The owner
    accepts that undercount explicitly -- *"if that slightly undercounts 'real'
    availability, staff will know that when looking over the shared cabins."*

    ⇒ `usable` IS `capacity is not None` TODAY, in every branch, and it is a
    field rather than a re-derivation at each call site for the reason the two
    sums are: it is decided where `consumed` is decided. A future branch that
    makes `consumed` meaningless again says so here, once, and every consumer
    follows -- where a caller's own `capacity is not None` would keep publishing
    a number the rule had stopped standing behind.
    """

    consumed: int
    sized: int
    known: bool
    usable: bool


def write_in_demand(capacity: int | None, loads: Sequence[WriteInLoad]) -> WriteInDemand:
    """How many spots the write-ins covering one card take.

    ONE DEFINITION, MIRRORED ONCE, in `writeInDemand`
    (`frontend/src/components/weekend/writeIn.ts`). The card's numerator, the
    Assign modal's header, the map peek and the stats bar all descend from
    this; two derivations would be two answers to "is there room here".

    Each cover contributes its recorded size, or -- with none -- the whole
    capacity of the unit it names, because a row with no count still asserts
    somebody is in that space. That is the em dash's meaning written down as
    arithmetic rather than a new rule.

    `sized` IS COMPUTED FIRST, over every non-ancestor cover carrying a
    recorded `party_size`, before either capacity guard below runs. It is a
    count of people somebody actually wrote down, and no guard is allowed to
    discard it: a cabin nobody has measured, holding a two-person write-in,
    prints `2/-`, not `-/-`. Fix-round finding: the previous version zeroed
    `sized` whenever `capacity` was `None`, even though `sized` never depended
    on capacity to begin with.

    AN ANCESTOR TAKES THE WHOLE CARD, decided by a PRE-PASS over `loads`
    rather than inside the per-cover loop, so the answer cannot depend on
    where in the list the ancestor sits. Fix-round finding: the previous
    version returned whatever the loop had accumulated from covers seen
    EARLIER in the list, so the same set of loads in a different order gave a
    different `sized`. The house was let whole and a room inside it is not
    separately lettable. The alternative -- each room subtracting the
    ancestor's size -- spends one party once per room, and would report a
    seven-spot house holding four people as having five spots free.

    AN ANCESTOR CONTRIBUTES NOTHING TO `sized`, even carrying a count. That
    count is a fact about the house; printing it on both halves of a split
    a split house puts one two-person party on the screen twice.

    AN ANCESTOR ON A MEASURED CARD IS KNOWN, and the conditionality that used
    to be spelled `known=capacity is not None` in that branch lives in the
    `capacity is None` GUARD ABOVE IT rather than in the branch itself. An
    ancestor cover only tells you the whole card is taken, not how big the card
    is -- so a capacity nobody measured stays unknown -- but the guard has
    already returned `known=False` by then, and the expression could never be
    anything but True where it stood. The docstring implied a mechanism the
    code did not have; the guard is the mechanism.
    """
    if not loads:
        # `usable` is NOT vacuously true the way `known` is. With no covers
        # there is no unsized party to spoil `known`, but this branch runs
        # BEFORE the capacity guard below, so an unmeasured card reaches it --
        # and `free_family_spots` answers `None` there (the ROLE decides),
        # never "0 taken, publish the lot".
        return WriteInDemand(consumed=0, sized=0, known=True, usable=capacity is not None)

    # A fact about people, not about the card -- see the function docstring.
    # Computed before either guard below so neither one can discard it.
    sized = sum(load.party_size for load in loads if load.relation != "ancestor" and load.party_size is not None)

    if capacity is None:
        # Nothing to subtract from. `consumed` is meaningless here -- this is
        # the ONE meaning of `known=False` that also withholds `usable`, and
        # the reason the two are separate fields. `free_family_spots` closes
        # the unit instead of reporting a number. `sized` survives regardless.
        return WriteInDemand(consumed=0, sized=sized, known=False, usable=False)

    if any(load.relation == "ancestor" for load in loads):
        # Whole-card, and order-independent by construction: a pre-pass, not
        # a value the loop happens to have accumulated so far. `known=True`
        # unconditionally, because the guard above has already returned for
        # every unmeasured card -- see the function docstring, which used to
        # describe the conditionality as living in this expression.
        return WriteInDemand(consumed=capacity, sized=sized, known=True, usable=True)

    consumed = 0
    known = True
    for load in loads:
        if load.party_size is not None:
            consumed += load.party_size
            continue
        known = False
        if load.capacity is None:
            # An unbounded wholesale claim: somebody is in a space nobody
            # measured, so nothing on this card is offerable. `usable` is
            # TRUE and the two are not in tension: "the whole card is taken"
            # is a bound, not a guess, and 0 free is a number both surfaces
            # can state.
            return WriteInDemand(consumed=capacity, sized=sized, known=False, usable=True)
        consumed += load.capacity
    return WriteInDemand(consumed=min(consumed, capacity), sized=sized, known=known, usable=True)


def free_family_spots(capacity: int | None, loads: Sequence[WriteInLoad]) -> int | None:
    """Spots left on this card once its write-ins are paid for.

    THREE RETURNS, and the middle one is load-bearing:

    * `None`  -- no occupancy at all; the ROLE decides, unchanged. This mirrors
                 `override: None` in `is_family_available` and does NOT mean
                 "unmeasured".
    * `0`     -- covered, and the remainder is not computable. An unmeasured
                 cabin somebody is written into must CLOSE; falling through to
                 the role there reports a cabin with a person in it as an open
                 space.
    * `n`     -- the remainder.

    ⚠️ `known` IS DELIBERATELY NOT READ HERE, and this is the note that stops
    it being "fixed" (owner ruling 2026-08-23, REAFFIRMED 2026-08-29; the
    reasoning lives on `WriteInDemand` above, which is not where a reader
    arrives). A PARTLY-SIZED card -- some covers recorded, one not -- gives
    this function a `consumed` it will happily turn into a remainder, and a
    container of 10 with one unsized written-into room of 3 and one sized cover
    of 2 publishes FIVE free spots.

    THE BOARD USED TO DECLINE TO CLAIM THOSE FIVE (kindred#2543), because its
    drag marks gated on `writeInDemand`'s `known`. It no longer does: the card
    gates on `usable` and prints the same number this function publishes. The
    divergence this note used to defend is gone, and the direction it was
    settled in is the one that matters here -- THE CARD MOVED TOWARD THIS
    FUNCTION, not the reverse. Making this withhold too was rejected twice: it
    would harmonise the two surfaces on the less informative answer, and
    understating free spots is its own lie.

    Why publishing the remainder is safe rather than over-advertising: an
    unsized cover is charged the WHOLE capacity of the unit it names, and a
    party cannot exceed the leaf it sleeps in, so the remainder is a FLOOR. It
    can only understate availability. `consumed` answers "how many spots are
    left", and the server has to answer it -- open/closed is the only thing the
    wire carries, and there is no third state.

    Placed families are NOT subtracted here. `spots_family_available` is paired
    with `spotsNeeded` on the stats bar, and a placed family is counted in that
    numerator; subtracting its spots too would count it on both sides. A
    write-in is on nobody's roster and appears in neither, which is exactly why
    its spots have to leave the denominator.
    """
    if not loads:
        return None
    if capacity is None:
        return 0
    return max(0, capacity - write_in_demand(capacity, loads).consumed)


def effective_bathroom(
    bathroom: str,
    bathroom_group: str,
    group_member_codes: frozenset[str],
    merged_codes: frozenset[str],
) -> str:
    """Spec §3.2.1 — private vs shared depends on the merge state.

    Two rooms sharing one bathroom are each `shared`, because two families
    normally split them. Merge both and the same bathroom becomes `private`,
    so merging can itself be the accommodation for a medical bathroom
    request.

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
# EMPTY AGGREGATION: nothing answered, so there is nothing to say. It stopped
# being "nobody has looked at this cabin" under kindred#2526, which took
# `is_confirmed` out of the arithmetic entirely.
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
    (for step-free, SOME is worse than NONE: a building advertising two
    step-free rooms out of ten invites the placement that lands in one of the
    other eight), and that nuance belongs to the renderer, not here.

    ⚠️ THE STEP-FREE GRAIN IS GRADED FROM `is_accessible`, NOT `has_ramp`,
    AND THAT REVERSES kindred#2502 ON PURPOSE. Owner ruling, 2026-08-30: *"we
    just need to know what is in fact accessible."* The product concept is
    accessibility, not the presence of a ramp, so the grade reads the column
    that answers it -- and `is_accessible` is a bool, which is why step-free
    comes through this function now and `ramp_coverage`, its five-grade twin,
    was deleted rather than kept beside it (kindred#2327).

    THE INVARIANT THAT MAKES THAT SAFE: `is_accessible` is a STRICT SUBSET of
    `has_ramp = 'yes'` on the 2026 registry, so the swap can only ever NARROW a
    ramp assessment and can never promise a wheelchair user access a ramp
    assessment denies. `has_ramp` stays STORED as provenance for the 14 staff
    assessments; no verdict reads it.

    ⚠️ THE MEASUREMENT ITSELF LIVES IN ONE PLACE, AND IT IS NOT HERE:
    `docs/reference/lodging-registry.md` § "Step-free grades from
    `is_accessible`" carries the counting query, the distribution and the three
    divergent rows. It used to be pasted into eight tracked files. Re-measure
    there, not here.

    This function does not walk anything. Resolving which rooms answer for a
    slot is the caller's job -- `_BathroomIndex.leaf_codes_under` in
    `lodging_roster_service` is the ONE walk over that tree, and a second one
    would be free to drift from it.

    Args:
        values: one entry per unit that answers for the slot -- a leaf's own
            flag, or every leaf descendant's for a container. `None` means
            the unit gave NO ANSWER at all. A bool cannot be unanswered, so
            no caller passes one today at all -- `ramp_coverage`, the
            five-grade twin whose select genuinely could be blank, was
            deleted by kindred#2327. The `| None` stays because the arm is
            this function's CONTRACT about missing evidence (see Returns),
            not an artefact of the one caller that used to reach it.

            ⚠️ AN UNCONFIRMED ROW IS NOT `None` and has not been since
            kindred#2526. `_resolve_amenity_coverage` used to map one here,
            so a cabin nobody had reconfirmed graded `unknown` however much
            the registry recorded about it. Confirmation is a staff work-down
            checklist now and never enters this arithmetic.

    Returns:
        "all" | "some" | "none" | "unknown". `unknown` on an EMPTY sequence
        -- a container with no active leaf has genuinely nothing to say,
        exactly as `_effective_sleeps` returns `None` in the same degenerate
        case -- or when any contributing unit gave no answer. Never "none" on
        missing evidence: this feeds a mark that STATES something about a
        slot, and "nothing here meets the need" is not a claim an unrecorded
        row supports.
    """
    if not values or any(value is None for value in values):
        return "unknown"
    if all(values):
        return "all"
    if any(values):
        return "some"
    return "none"


def container_bathroom(leaves: frozenset[tuple[str, str]]) -> tuple[str, str]:
    """A container's bathroom, inherited from its leaf descendants.

    Containers (buildings, apartments) store `bathroom = "none"` on the
    registry row itself -- the field describes a ROOM, and a building is
    not one. That is correct for the units inventory, which has no
    occupant to resolve the ambiguity for. It is wrong for a party that has
    booked the WHOLE container: two bedrooms over one shared bath, normally
    let whole, is exactly the case `effective_bathroom`'s exclusivity
    branch exists for -- except the container's own "none" short-circuits
    that branch before it ever runs.

    This resolves what "bathroom" and "bathroom_group" to FEED
    `effective_bathroom` on the container's behalf, rather than widening
    that function's signature to know about children. `effective_bathroom`
    stays the same four-argument pure test the class above already pins;
    the inheritance a container needs is a fact about its children, computed
    here and handed in as an ordinary "shared" input.

    ⚠️ THIS TAKES (bathroom, group) PAIRS. It took bare group ids until
    kindred#2502, and identity alone is not enough to answer the question:
    a group says which rooms share ONE bathroom, never that the bathroom is
    inside any of them. One registry group names a BATHHOUSE its two rooms
    walk to -- both record `bathroom = "none"` -- and on identity alone this
    returned ("shared", group), which `effective_bathroom` then upgraded to
    "private" for a whole-let. That is a satisfied verdict on an in-cabin
    bathroom request that is asked for medical reasons, about two rooms with
    no bathroom in them. A group is inheritable only when some leaf behind
    it actually records one.

    Args:
        leaves: the `(bathroom, bathroom_group)` pair of every LEAF unit
            directly or indirectly under the container. `bathroom` is the
            registry's own value ("", "none", "private", "shared") and
            `bathroom_group` is "" for a leaf with no group.

    Returns:
        ("shared", group) when every leaf agrees on the same non-empty
        group AND at least one of them records a bathroom -- the children
        physically share one bathroom, so booking the whole container
        definitionally covers that group. ("none", "") otherwise: nothing
        to inherit, so the container reports exactly what its own registry
        row already says.

        ⚠️ Leaves spanning two groups return ("none", "") even when every
        one of them has a bathroom. That is a FALSE NEGATIVE and it is
        deliberate: widening it redefines what "this building has a
        bathroom" means, which is an owner ruling rather than a bug fix.
        `test_leaves_split_across_groups_inherit_nothing` pins it.
    """
    groups = {group for _, group in leaves}
    if len(groups) != 1:
        return "none", ""
    (group,) = groups
    if not group:
        return "none", ""
    if not any(bathroom in ("private", "shared") for bathroom, _ in leaves):
        return "none", ""
    return "shared", group


# ── Free-text bunk-request provenance (kindred#2330) ─────────────────────────
#
# The one place on this surface that reads RAW answers rather than a derived
# column, and the scope note at the top of this module still holds: nothing
# below normalises a gate, parses a NEAR/WITH mode or resolves a verdict. It
# only says which source field an answer came from.
#
# It has to be raw, because the derived column cannot be un-joined.
# `CollapseToHouseholdGrain` (pocketbase/sync/lodging_requests.go) dedupes
# across fields and then `strings.Join(a.textParts, "; ")`, and 10 of 422
# non-blank 2026 request values contain `'; '` themselves -- so no split of
# `request_text` is possible on either side of the wire.

RequestTextAuthorship = Literal["family", "staff"]


class RequestTextSource(NamedTuple):
    """One free-text bunk-request field, as it is shown to staff.

    `label` is the CampMinder field name VERBATIM, including the misnamed
    `COVID-19 Bunking Requests` -- the field that has plainly been repurposed
    as the general bunking-request question and carries 238 of the 479
    households rostered into a 2026 family-camp registration (kindred#2476,
    re-measured 2026-08-21). Owner ruling 2026-08-17: "call them the original
    fieldnames for now until staff can weigh in after it's live". A
    display-names issue gets filed once they have. Do not "improve" these
    strings.
    """

    label: str
    authorship: RequestTextAuthorship


# ORDERED, and the order is the panel's block order.
#
# kindred#2476, owner ruling 2026-08-21: this order is what STAFF ASKED FOR.
# It is NOT derived from authorship or volume, and it must NOT be re-derived
# from the data by a later reader. On 2026 family-camp households
# `Share Bunk With` is the SECOND MOST POPULATED of the six blocks (234 of
# 479) -- ahead of `Shared-request` (114) and `FAM CAMP-Share Comments` (0)
# -- yet staff placed it last. The order used to be "family-authored fields
# first, staff notes last, each lane sorted by 2026 coverage"; that rule no
# longer holds (`Share Bunk With` is family-authored and sorts after both
# staff notes) and must not be reinstated by "correcting" the order back to
# match volume or authorship.
#
# Counts are rostered households on `pocketbase/pb_data/data-prod.db`,
# denominator 479 (2026 family-camp registrations):
# COVID-19 Bunking Requests 238, Share Bunk With 234, Shared-request 114,
# BunkingNotes Notes 111, Internal Bunk Notes 10.
#
# `FAM CAMP-Share Comments` is 0 for 2026 and is carried anyway. It is one of
# the three fields the Go ingest already joins into `request_text` (live
# 2024-2025), so leaving it out would make the split lose text the joined
# column shows today for those years.
#
# TWO fields are deliberately ABSENT and both absences are load-bearing:
#
#   `Do Not Share Bunk With` (`staff_not_bunk_with`, 3 rostered households)
#   travels this same code path and the 2026-08-17 ruling did not name it.
#   Silence is not a yes. Adding it is one row here plus one entry in
#   BUNKING_CSV_REQUEST_TEXT_FIELDS below.
#
#   `RetParent-Socializewithbest` (`socialize_with`, 107 rostered households)
#   is NOT free text: it has exactly two distinct values in 2026, both 40
#   characters, and `frontend/src/utils/requestBucket.ts` already classes it
#   an immaterial source field.
# Owner ruling 2026-08-23, after the form-label correction on this same PR:
# the REGISTRATION-form box renders first. `Shared-request` (274133) is the
# registration-time comments box — its writes land in the radio's sitting,
# 93/94 people, a median 181d before the Information form — and `COVID-19
# Bunking Requests` (206286) is the Information form's names box. The prior
# order only LOOKED reg-first because the friendly labels were attributed
# backwards.
REQUEST_TEXT_SOURCES: tuple[RequestTextSource, ...] = (
    RequestTextSource("Shared-request", "family"),
    RequestTextSource("COVID-19 Bunking Requests", "family"),
    RequestTextSource("FAM CAMP-Share Comments", "family"),
    RequestTextSource("BunkingNotes Notes", "staff"),
    RequestTextSource("Internal Bunk Notes", "staff"),
    RequestTextSource("Share Bunk With", "family"),
)

# The family-camp lane: CampMinder custom-field ids, matching the three
# `Target: targetRequestText` rows in pocketbase/sync/lodging_fields.go. The
# label is pinned here rather than read from `custom_field_defs.name` for the
# same reason the Go constants pin it: matching is on cm_id, and a CampMinder
# rename must not silently unlabel a block or drop it out of the order above.
FAMILY_CAMP_REQUEST_TEXT_CM_IDS: dict[int, str] = {
    206286: "COVID-19 Bunking Requests",
    240598: "FAM CAMP-Share Comments",
    274133: "Shared-request",
}

# The bunking-CSV lane: `original_bunk_requests.field` slugs mapped back to the
# CampMinder report column they were read from -- the inverse of `csvFieldMap`
# in pocketbase/sync/bunk_requests.go. 32 rostered 2026 households carry
# request text ONLY here, which is why the weekend surface showed them nothing
# before kindred#2330.
BUNKING_CSV_REQUEST_TEXT_FIELDS: dict[str, str] = {
    "bunk_request_form": "Share Bunk With",
    "bunking_notes": "BunkingNotes Notes",
    "internal_notes": "Internal Bunk Notes",
}

_REQUEST_TEXT_ORDER: dict[str, int] = {source.label: position for position, source in enumerate(REQUEST_TEXT_SOURCES)}
_REQUEST_TEXT_AUTHORSHIP: dict[str, RequestTextAuthorship] = {
    source.label: source.authorship for source in REQUEST_TEXT_SOURCES
}


def request_text_source_order(label: str) -> int:
    """Where a source field's block sits on the panel.

    Total over every string, because this is a render path: one unrecognised
    label sorts to the end rather than raising and taking the whole household
    down with it. Same position `safeSourceFromField` takes on the TS side.
    """
    return _REQUEST_TEXT_ORDER.get(label, len(REQUEST_TEXT_SOURCES))


def request_text_authorship(label: str) -> RequestTextAuthorship:
    """Who wrote a source field's answers -- the family, or staff.

    An unregistered label reads `staff`, NOT `family`. `family` is the amber
    treatment reserved for a household's own words, and attributing an
    unknown field to the family is the mistake that cannot be walked back
    once a staff member has read it as a parent's ask.
    """
    return _REQUEST_TEXT_AUTHORSHIP.get(label, "staff")


# ------------------------------------------------------------ housing names
#
# kindred#2332. ONE housing-name display convention, for every surface that
# shows where a household slept.
#
# Owner ruling 2026-08-18: *"the last year housing should use the same
# language via the alias year over year concept so it appears in current
# language."* Whatever staff call a unit in the admin GUI is what appears
# everywhere -- the board card, the family history modal, and
# `RosterParty.last_year_cabin` on the family card.
#
# THE ALIAS YEAR WINDOW SAYS WHICH RAW STRING WAS IN USE WHEN. It is an input
# to FINDING the unit and never to NAMING it: once the unit is identified, its
# present-day `lodging_units.name` is what renders. A 2022 row displaying a
# name nobody has used since 2023 is a lookup task, not information -- and
# renames are routine here, fourteen of the 118 units having been renamed one
# at a time in the admin GUI inside two minutes on 2026-08-15.
#
# Deliberately a MIRROR of `AliasResolver` (`pocketbase/sync/lodging_alias_resolver.go`)
# rather than a second opinion: same lookup key (outer whitespace and case
# only, inner spacing significant), same all-or-nothing member translation
# through `code`, same refusal on two rows whose windows both contain the
# year. What is NOT shared is the target year -- the Go resolver places rows in
# their own season, this one always names them in the registry's latest one.


class RegistryUnit(NamedTuple):
    """One `lodging_units` row, flattened to the columns naming needs.

    `parent_id` is the raw `parent_unit` RELATION VALUE, which is a PocketBase
    record id and not a code -- joining it against `code` returns nothing, with
    no error (18 of the 118 units are grandchildren, so the silence is not even
    total).
    """

    unit_id: str
    code: str
    name: str
    year: int
    parent_id: str


class UnitAlias(NamedTuple):
    """One `lodging_unit_aliases` row, flattened.

    `valid_from_year` / `valid_to_year` are PocketBase number columns, declared
    `NUMERIC DEFAULT 0 NOT NULL`. An unset bound stores as 0, never NULL --
    181 of the 187 seeded rows are unbounded on both sides -- so 0 means "no
    bound" and must never be compared as a real year.
    """

    alias_string: str
    member_unit_ids: tuple[str, ...]
    valid_from_year: int
    valid_to_year: int

    def covers(self, year: int) -> bool:
        if self.valid_from_year > 0 and year < self.valid_from_year:
            return False
        return not (self.valid_to_year > 0 and year > self.valid_to_year)


def housing_lookup_key(raw: str) -> str:
    """Normalise OUTER whitespace and case only -- `aliasLookupKey`'s rule.

    Inner spacing stays significant: the seed stores strings verbatim and one
    of them genuinely carries a double space before its separator. Collapsing
    inner runs would merge it with a single-space variant that means the same
    room today but need not tomorrow.
    """
    return raw.strip().casefold()


# What two or more member names are joined with when they share no parent. No
# production row reaches this branch -- all seven in-use multi-member aliases
# resolve to siblings under one container -- and the separator changes no
# measured figure. It exists so the rule stays total.
_MEMBER_JOIN = " + "


class HousingNameResolver:
    """Raw staff-written cabin string -> the name that unit carries TODAY.

    Built from the whole `lodging_units` table and the whole alias table, and
    read once per string. Both are small (118 units, 187 aliases) and there are
    only 88 distinct raw values across 2022-2026 to resolve.
    """

    __slots__ = ("_alias_by_key", "_code_by_unit_id", "_current_by_code", "_direct_by_key", "registry_year")

    def __init__(
        self,
        *,
        registry_year: int,
        current_by_code: dict[str, RegistryUnit],
        code_by_unit_id: dict[str, str],
        direct_by_key: dict[str, str | None],
        alias_by_key: dict[str, list[UnitAlias]],
    ) -> None:
        self.registry_year = registry_year
        self._current_by_code = current_by_code
        self._code_by_unit_id = code_by_unit_id
        self._direct_by_key = direct_by_key
        self._alias_by_key = alias_by_key

    @classmethod
    def build(cls, units: Sequence[RegistryUnit], aliases: Sequence[UnitAlias]) -> HousingNameResolver:
        """Index the registry once.

        THE REGISTRY YEAR IS THE LATEST SEASON THE TABLE HOLDS, not the year
        being rostered and not the year the row came from. `lodging_units` is
        year-scoped and holds 2026 only today (118 of 118), so resolving a 2023
        string against 2023's units would find nothing at all -- that is the
        trap that makes this look impossible (kindred#2392). Naming a unit is a
        question about the present, so the present season answers it.
        """
        registry_year = max((unit.year for unit in units), default=0)
        # Codes are the cross-year identity thread, so this index spans EVERY
        # season: an alias stores whichever season's record ids existed when it
        # was written and is never re-pointed.
        code_by_unit_id = {unit.unit_id: unit.code for unit in units}
        current_by_code = {unit.code: unit for unit in units if unit.year == registry_year}

        # A string that already names a unit today needs no alias, and the
        # answer cannot be wrong. `None` marks a key two different units both
        # answer to -- never pick one of them, the same call `Resolve` makes
        # on two overlapping alias rows. It is a DEFERRAL rather than a
        # refusal: `display_name` treats a `None` exactly as it treats a key
        # that is absent, so an alias row covering the year still gets its
        # say, and only when that fails too does the raw string render. An
        # alias is a deliberate staff mapping and a name collision is an
        # accident, so the mapping is the better answer of the two.
        direct_by_key: dict[str, str | None] = {}
        for unit in current_by_code.values():
            for candidate in (unit.name, unit.code):
                key = housing_lookup_key(candidate)
                if not key:
                    continue
                if key in direct_by_key and direct_by_key[key] != unit.code:
                    direct_by_key[key] = None
                else:
                    direct_by_key[key] = unit.code

        alias_by_key: dict[str, list[UnitAlias]] = {}
        for alias in aliases:
            key = housing_lookup_key(alias.alias_string)
            if key:
                alias_by_key.setdefault(key, []).append(alias)

        return cls(
            registry_year=registry_year,
            current_by_code=current_by_code,
            code_by_unit_id=code_by_unit_id,
            direct_by_key=direct_by_key,
            alias_by_key=alias_by_key,
        )

    def resolve_codes(self, raw: str, year: int) -> tuple[str, ...]:
        """The registry-year unit CODES `raw` names, or () when nothing resolves.

        THE RESOLUTION HALF OF `display_name`, published rather than kept
        private, because the cabin-weekend conflict rule (§12.8) has to expand
        the very units the queue's own label was built from. A second
        resolution there would be a second answer to "which cabin is this
        string" -- the drift class this module's docstring is about.

        `year` is the year the RAW STRING came from, and its only job is
        picking which alias row was in use then, exactly as it is below.

        ALL OR NOTHING on an alias's members, on both doors, exactly as
        `Resolve` does it. A stored id whose unit row is gone, and a code with
        no row in the registry year, are the same failure: a member that
        cannot be carried into the present. Keeping the ones that survive
        would silently shrink a family's rooms -- and, here, would silently
        shrink the set of leaves a conflict could be found on.

        NO COLLAPSE. `display_name` renders the PARENT when 2+ members share
        one, because a joined label is too long for the card; the codes it
        collapsed are what the rule needs, so this returns the members
        themselves. Expanding a container to its leaves is a separate step and
        belongs to the caller that holds the unit tree.
        """
        key = housing_lookup_key(raw)
        if not key:
            return ()

        direct = self._direct_by_key.get(key, "")
        if direct:
            return (direct,)

        matches = [alias for alias in self._alias_by_key.get(key, ()) if alias.covers(year)]
        if len(matches) != 1:
            # 0 is a work-queue item, not an error -- three of the 88 distinct
            # strings name a unit FAMILY rather than a unit and need staff
            # knowledge (kindred#2392). 2+ is the overlapping-window pair the
            # unique index on (alias_string, valid_from_year) permits; picking
            # one arbitrarily would name a cabin nobody chose.
            return ()

        codes: list[str] = []
        for unit_id in matches[0].member_unit_ids:
            code = self._code_by_unit_id.get(unit_id, "")
            unit = self._current_by_code.get(code) if code else None
            if unit is None:
                return ()
            codes.append(unit.code)
        return tuple(codes)

    def display_name(self, raw: str, year: int) -> str:
        """The unit's CURRENT name, or `raw` unchanged when nothing resolves.

        `year` is the year the RAW STRING came from, and its only job is
        picking which alias row was in use then.

        THE COLLAPSE RULE, stated so it stops being re-derived: when a string
        resolves to 2+ units that share one non-empty `parent_unit`, the parent
        unit's name renders and never the joined member names. When it resolves
        to one unit, that unit's name renders. When nothing resolves, the raw
        string renders unchanged.

        The collapse is what does the work, not the resolution: joining member
        names is up to 35 characters, one MORE than the worst raw string, on a
        `whitespace-nowrap` span. Every one of the seven in-use multi-member
        aliases resolves to exactly two siblings under one container.

        THE RESOLUTION ITSELF IS `resolve_codes` ABOVE, and this reads it
        rather than repeating it. The two used to be one function; they were
        split when the conflict rule needed the codes, and splitting rather
        than copying is what keeps one answer to "which cabin is this string".
        """
        codes = self.resolve_codes(raw, year)
        if not codes:
            return raw

        members = [self._current_by_code[code] for code in codes]
        if len(members) == 1:
            return members[0].name

        parent_ids = {unit.parent_id for unit in members}
        if len(parent_ids) == 1:
            parent_id = next(iter(parent_ids))
            parent_code = self._code_by_unit_id.get(parent_id, "") if parent_id else ""
            parent = self._current_by_code.get(parent_code) if parent_code else None
            if parent is not None:
                return parent.name
        return _MEMBER_JOIN.join(unit.name for unit in members)


# ------------------------------------------- cabin-weekend attribution conflicts
#
# The round-2 triage-attack master plan §12.8, owner-designed and owner-ruled
# 2026-08-31. It closes no issue and none is filed.
#
# WHAT IT IS FOR. When a household attends 2+ weekends, CampMinder holds ONE
# `Family Camp Cabin` value for the year and cannot say which weekend it
# describes. The Go ingest files that as an `ambiguous_session` work-queue row
# with a SUGGESTION from `AttributeSession`
# (`pocketbase/sync/lodging_session_attribution.go`), which picks the earliest
# candidate weekend starting on or after the value's `last_updated`.
#
# ⛔ THAT PREMISE DOES NOT HOLD AT HOUSEHOLD GRAIN. Measured on the 2026
# snapshot: the 136 cabin values carry only SEVEN distinct `last_updated` days,
# 83% of them on two. `last_updated` records when staff did a bulk pass over a
# whole weekend, not when one household's cabin was set -- it has no
# per-household resolution at all. So this rule outranks it, on the one signal
# that IS per-household: whether the cabin is already occupied that weekend.
#
# ⚖️ DEMOTE ON CONFLICT ONLY, and the asymmetry is what forces it (§12.8.4).
# "Taken" is a POSITIVE LOCAL FACT -- one cabin, one other party, one weekend
# -- true regardless of how complete that weekend's planning is. "Free" is an
# ABSENCE, and an absence is evidence only in proportion to planning
# completeness, which nothing measures: the last bulk pass wrote 53 values in
# one day, so "partly planned" is a real recurring state and a cabin the pass
# had not yet reached reads free. `free` and `no_data` therefore carry NO
# RANKING POWER; they are published for display and nothing else.
#
# ⛔ AVAILABILITY IS NOT RE-DERIVED HERE. `LeafOccupancy.is_family_available`
# arrives already computed by `is_family_available` / `free_family_spots`
# above, which carry owner rulings dated 2026-08-23 and 2026-08-29 and a note
# explicitly guarding them against being "fixed". A second implementation of
# availability is the drift class this repository has been burned by three
# times (the three tables grading, `resolveDragFit` vs `candidateFit`, and
# "the second copy that drifts" in `family_camp_derived.go`), and it is the
# first of §12.8.6's two disqualifying reasons for not doing any of this in Go.
#
# Pure over `(leaves, occupancy, candidates)` for the reason
# `_resolve_write_in_covers` states about its own pure counterpart: the rule is
# what the tests reason about, and the service is one line that calls it.

AttributionVerdict = Literal["conflict", "free", "no_data"]


class PlacedHousehold(NamedTuple):
    """A household `lodging_assignments` puts in a leaf, and what to call it.

    BOTH HALVES, because the rule needs each for a different job: `cm_id` is
    the identity it compares against the household being attributed (its own
    placement is not a conflict), and `label` is what the evidence line prints.
    Carrying only the id would push naming onto the caller AFTER the rule has
    already decided which placements to publish, which is how a payload comes
    to name a household the rule dropped.
    """

    cm_id: int
    label: str


class LeafOccupancy(NamedTuple):
    """What ONE LEAF unit holds in ONE candidate weekend.

    A LEAF, never a container: the value is resolved through
    `lodging_unit_aliases` and any container it names is expanded to its rooms
    before it reaches here, so one shape answers all three value shapes (a
    leaf, a multi-unit alias, a whole building). Owner ruling 3 is what makes
    that expansion the right grain -- *"if someone is assigned a container and
    another family has a contained leaf, i think that's likely a
    demote/conflict yes."*

    `is_family_available` IS `is_family_available(...)`'S OWN ANSWER for this
    leaf this weekend, folding the staff<->family role and every write-in
    covering the space through `free_family_spots`. It is passed in rather
    than re-derived -- see the section note above.

    `placed_households` is every household `lodging_assignments` puts in this
    leaf that weekend, INCLUDING the one being attributed; the rule drops its
    own household rather than the caller having to.

    `write_in_labels` is one label per write-in cover on the leaf, own or
    inherited from an ancestor. It is the DISPLAY half; whether those write-ins
    exhaust the space is already inside `is_family_available`.

    `container_name` is the building the value NAMED when this leaf came out of
    a container expansion, "" when the value named the leaf itself -- so the
    evidence line can say "a room inside Clouds Rest" rather than naming a room
    staff never wrote down.
    """

    unit_code: str
    unit_name: str
    shareability: str
    is_family_available: bool
    placed_households: tuple[PlacedHousehold, ...]
    write_in_labels: tuple[str, ...]
    container_name: str = ""


class CandidateOccupancy(NamedTuple):
    """One candidate weekend, with what the resolved leaves hold in it.

    `weekend_has_placements` is the `no_data` axis and it is WEEKEND-WIDE, not
    leaf-wide. ⚠️ `no_data` means NO PLACEMENTS, not no occupancy: six of the
    2026 snapshot's eight live queue rows have a candidate weekend with zero
    placements (FC4/FC6/FC7 are Sep-Oct weekends nobody has planned yet), and
    one of those weekends carries three write-ins. Write-ins make a weekend
    look non-empty; they do not make it PLANNED, and the distinction is what
    stops "free" being read as a finding on a weekend nobody has touched.
    """

    session_cm_id: int
    leaves: tuple[LeafOccupancy, ...]
    weekend_has_placements: bool


class ConflictOccupant(NamedTuple):
    """WHO is in the cabin, for the evidence line.

    Display only. Nothing ranks off this -- the verdict does -- but a bare
    "conflict" is not evidence staff can check, and the whole point of the
    feature is that the queue can say *"FC2, because FC1 is taken"*.
    """

    kind: Literal["placement", "write_in"]
    label: str
    leaf_code: str
    leaf_name: str
    container_name: str = ""


class CandidateConflict(NamedTuple):
    """One candidate weekend's verdict, and the evidence behind it."""

    session_cm_id: int
    verdict: AttributionVerdict
    occupants: tuple[ConflictOccupant, ...]


def leaf_occupants(leaf: LeafOccupancy, household_cm_id: int) -> tuple[ConflictOccupant, ...]:
    """Who is in this leaf OTHER THAN the household being attributed.

    A household already placed in the cabin it was written into is the
    opposite of evidence against that weekend, so its own placement is neither
    a conflict nor an occupant. It is not published as evidence either: this
    rule only ever demotes, so a fact that could only promote has nothing to
    say here (§12.8.4), and printing "occupied by you" beside a free verdict
    would read as a warning.
    """
    occupants = [
        ConflictOccupant(
            kind="placement",
            label=placed.label,
            leaf_code=leaf.unit_code,
            leaf_name=leaf.unit_name,
            container_name=leaf.container_name,
        )
        for placed in leaf.placed_households
        if placed.cm_id != household_cm_id
    ]
    occupants.extend(
        ConflictOccupant(
            kind="write_in",
            label=label,
            leaf_code=leaf.unit_code,
            leaf_name=leaf.unit_name,
            container_name=leaf.container_name,
        )
        for label in leaf.write_in_labels
    )
    return tuple(occupants)


def leaf_conflicts(leaf: LeafOccupancy, household_cm_id: int) -> bool:
    """Whether this leaf is UNAVAILABLE to this household that weekend.

    THREE DISJUNCTS, exactly as §12.8.5 states them, and they split across two
    questions because availability already answers one of them:

    1. `is_family_available` is False -- the space has no room left. This is
       the shareable-at-capacity arm AND the unsized-write-in arm: an unsized
       write-in is charged the WHOLE capacity of the unit it names
       (kindred#2540), so `free_family_spots` reaches 0 and the leaf closes.
       ⛔ Read, never re-derived (see the section note).
    2. A PLACEMENT held by a different household. `free_family_spots`
       deliberately does not subtract placed families -- its docstring says so,
       because the stats bar counts them in the other numerator -- so
       availability alone cannot see this and the rule has to.
    3. ANY write-in on a leaf that is not shareable. A `single_party` leaf
       holds ONE party: beds left over do not make room for a second one, which
       is the entire meaning of the shareability column.

    Arms 2 and 3 are gated on shareability and arm 1 is not, which is the
    asymmetry the column exists to express: a shareable leaf takes a second
    party until its beds run out, and running out is arm 1's business.

    "unknown" shareability -- the answer `unit_shareability` gives for a column
    staff never set -- is treated as NOT shareable. A cabin nobody classified
    holds one party until somebody says otherwise; the alternative silently
    promotes a weekend on an unanswered question.
    """
    if not leaf.is_family_available:
        return True
    if leaf.shareability == "shareable":
        return False
    if any(placed.cm_id != household_cm_id for placed in leaf.placed_households):
        return True
    return bool(leaf.write_in_labels)


def candidate_conflict(candidate: CandidateOccupancy, household_cm_id: int) -> CandidateConflict:
    """One candidate weekend's verdict.

    ANY leaf being unavailable is the whole value being unavailable: a family
    cannot take half of the pair it was written into, and cannot take a
    building one of whose rooms is somebody else's.

    A CONFLICT OUTRANKS THE `no_data` LABEL. A weekend with no placements at
    all can still hold a write-in in the very cabin under discussion, and that
    write-in is a positive local fact about that cabin -- exactly the kind of
    fact §12.8.4 says does rank.
    """
    occupants: list[ConflictOccupant] = []
    conflict = False
    for leaf in candidate.leaves:
        occupants.extend(leaf_occupants(leaf, household_cm_id))
        conflict = leaf_conflicts(leaf, household_cm_id) or conflict

    if conflict:
        verdict: AttributionVerdict = "conflict"
    elif not candidate.weekend_has_placements:
        verdict = "no_data"
    else:
        verdict = "free"
    return CandidateConflict(session_cm_id=candidate.session_cm_id, verdict=verdict, occupants=tuple(occupants))


def attribution_conflicts(
    candidates: Sequence[CandidateOccupancy], household_cm_id: int
) -> tuple[CandidateConflict, ...]:
    """Every candidate weekend's verdict, in the order handed in."""
    return tuple(candidate_conflict(candidate, household_cm_id) for candidate in candidates)


def conflict_aware_suggestion(
    ordered_session_cm_ids: Sequence[int],
    verdicts: Sequence[CandidateConflict],
    timestamp_suggestion: int | None,
) -> int | None:
    """`AttributeSession`'s answer over the SURVIVORS, derived from its answer
    over the whole set.

        survivors = [c for c in candidates if not conflict(c)]
        best      = AttributeSession_rule(survivors if survivors else candidates)

    ⛔ IT IS A DERIVATION, NOT A SECOND IMPLEMENTATION, and that distinction is
    the point. `AttributeSession` stays untouched in Go (§12.8.6) and its
    published answer -- the queue row's `suggested_session` -- is this
    function's INPUT. Re-running its `last_updated` comparison in Python would
    be exactly the cross-language copy §12.8.6 refuses for availability.

    `ordered_session_cm_ids` must be sorted by weekend START DATE ASCENDING,
    which is the order `AttributeSession` requires of its own candidates and
    which `BuildHouseholdSessionIndex` guarantees.

    THE DERIVATION, case by case. `AttributeSession` answers a 2+ candidate set
    with "the earliest candidate whose start is not before `lastUpdated`", and
    falls back to the LAST candidate when none qualifies.

    * The stored pick qualified. Then every candidate AFTER it also starts at
      or after `lastUpdated`, and every candidate before it starts before. Over
      a subset the same comparison therefore picks the first survivor at or
      after the stored pick -- and, when there is none, the same fallback arm
      answers the last survivor.
    * The stored pick was the FALLBACK (the last candidate, nothing qualified).
      Then nothing in any subset qualifies either, so the answer is the last
      survivor. The formula above gives that too: no survivor sits at or after
      the last candidate once the last candidate is itself conflicted.

    ⇒ ONE expression covers both: the first survivor at or after the stored
    pick, else the last survivor.

    TWO ARMS DO NOT NEED THE TIMESTAMP AT ALL, and they are why this can still
    answer when `suggested_session` is empty (a zero `last_updated` makes
    `AttributeSession` return no best guess):

    * NOTHING SURVIVES -- `conflict_in_every_candidate`. The stored answer
      stands unchanged: the adopted default (§12.8.3) raises an alarm about the
      VALUE rather than moving the guess to a weekend the rule just called
      wrong. **This demotes nothing.**
    * EXACTLY ONE SURVIVES. `AttributeSession` answers a one-candidate set with
      certainty and never consults `lastUpdated`, so neither does this.
    """
    verdict_by_id = {row.session_cm_id: row.verdict for row in verdicts}
    survivors = [cm_id for cm_id in ordered_session_cm_ids if verdict_by_id.get(cm_id) != "conflict"]

    if not survivors:
        return timestamp_suggestion
    if timestamp_suggestion in survivors:
        return timestamp_suggestion
    if len(survivors) == 1:
        return survivors[0]
    if timestamp_suggestion is None:
        # `AttributeSession` had no answer over ANY set. Inventing one here
        # would be a SECOND heuristic wearing the first one's name.
        return None

    order = list(ordered_session_cm_ids)
    if timestamp_suggestion not in order:
        # The stored suggestion names a weekend this row does not offer --
        # a stale row, which `computeStaleQueueIds` already hides. Nothing to
        # derive from, so nothing is claimed.
        return None
    demoted_at = order.index(timestamp_suggestion)
    for cm_id in order[demoted_at:]:
        if cm_id in survivors:
            return cm_id
    return survivors[-1]


def conflict_in_every_candidate(verdicts: Sequence[CandidateConflict]) -> bool:
    """The alarm condition -- every candidate weekend conflicts.

    It points at the CABIN VALUE, not at a weekend: if the string is taken
    everywhere the household could be, either the value is wrong or somebody
    else's placement is. Demoting on it would move the guess to a weekend the
    rule has just called wrong, so it demotes nothing.

    False for an EMPTY candidate list -- there is no "every" to be true of, and
    an empty list is a row with nothing to attribute rather than a row in
    trouble.
    """
    return bool(verdicts) and all(row.verdict == "conflict" for row in verdicts)


# ------------------------------------------------------------ push classifier
#
# kindred#2477. The RULED diff between a scenario's draft write-ins and the
# live board's, grouped by physical building, feeding the push queue Task 3
# turns into an endpoint. Pure rules only: what changed and how to group it,
# never how to fetch it or apply it.
#
# `_s`/`_b` mirror the accessors of the same name in `lodging_roster_service`
# rather than importing them -- that service module already imports FROM this
# one (`from api.services.lodging_rules import ...`), so importing back would
# be circular. Same tiny contract either way: total over a record missing the
# attribute entirely, which is what a `SimpleNamespace` test stub or a
# not-yet-migrated PB row both look like.


def _s(record: Any, field: str, default: str = "") -> str:
    value = getattr(record, field, default)
    return default if value is None else str(value)


def _b(record: Any, field: str) -> bool:
    return bool(getattr(record, field, False))


def _tuple_key_sort_key(t: tuple[str, str, str, int | None]) -> tuple[str, str, str, bool, int]:
    """A TOTAL order for `PushRow.tuple_key()`, where the last element is
    `int | None`.

    Plain `sorted()` on the 4-tuple works right up until two rows on the same
    side of one building share `(unit_id, occupant, note)` and differ only in
    `party_size`, one of them `None` -- Python's tuple comparison only reaches
    the fourth element once the first three already tie, and then refuses
    `int < NoneType`. `sorted([('u1','N','',None), ('u1','N','',5)])` is the
    two-line repro that found this. `None` sorts before every recorded count
    here (`False < True`); that placement is arbitrary but STABLE, which is
    all either caller needs -- the multiset-equality check in `classify_push`
    and the canonicalisation in `push_digest` both only ask "is this ordering
    the same every time", never "which one is smaller"."""
    unit_id, occupant, note, party_size = t
    return (unit_id, occupant, note, party_size is not None, party_size or 0)


@dataclass(frozen=True)
class PushRow:
    unit_id: str
    unit_code: str
    unit_name: str
    occupant_name: str
    note: str
    party_size: int | None
    sleeps: int | None

    def tuple_key(self) -> tuple[str, str, str, int | None]:
        # The RULED matching tuple (kindred#2477): placement, occupant, note,
        # people. strip() is the ONLY normalisation -- no casefold, no fuzz --
        # and None people is a VALUE (occupies wholesale, #2540), so a live
        # None against a recorded count IS a difference.
        return (self.unit_id, self.occupant_name.strip(), self.note.strip(), self.party_size)


@dataclass(frozen=True)
class PushBuilding:
    key: str
    label: str
    cls: str
    live: tuple[PushRow, ...]
    draft: tuple[PushRow, ...]


def push_building_key(unit: Any, units_by_code: dict[str, Any], parent_code: str = "") -> str:
    """The RULED grain (kindred#2477): a container is its own building; a leaf
    belongs to its immediate parent when the registry knows it; an orphan is
    itself. Deliberately NOT the TS `buildingKey` (unitLevel.ts) -- that one
    feeds #2008's whole-building-held marker and lacks the container clause on
    purpose for its own consumer. Root-walking was measured wrong: 36 groups
    by immediate parent vs 35 by top ancestor on the draft set."""
    if _b(unit, "is_container"):
        return _s(unit, "code")
    if parent_code and parent_code in units_by_code:
        return parent_code
    return _s(unit, "code")


def classify_push(live: Sequence[PushRow], draft: Sequence[PushRow], units: Sequence[Any]) -> list[PushBuilding]:
    units_by_id = {_s(u, "id"): u for u in units}
    units_by_code = {_s(u, "code"): u for u in units}

    def key_for(row: PushRow) -> str:
        unit = units_by_id.get(row.unit_id)
        if unit is None:
            return row.unit_code or row.unit_id
        parent = units_by_id.get(_s(unit, "parent_unit"))
        return push_building_key(unit, units_by_code, _s(parent, "code") if parent else "")

    def label_for(key: str) -> str:
        unit = units_by_code.get(key)
        return _s(unit, "name") if unit is not None else key

    grouped: dict[str, tuple[list[PushRow], list[PushRow]]] = {}
    for row in live:
        grouped.setdefault(key_for(row), ([], []))[0].append(row)
    for row in draft:
        grouped.setdefault(key_for(row), ([], []))[1].append(row)

    out: list[PushBuilding] = []
    for key in sorted(grouped):
        lrows, drows = grouped[key]
        if drows and not lrows:
            cls = "add"
        elif lrows and not drows:
            cls = "remove"
        elif sorted((r.tuple_key() for r in lrows), key=_tuple_key_sort_key) == sorted(
            (r.tuple_key() for r in drows), key=_tuple_key_sort_key
        ):
            cls = "match"
        else:
            cls = "conflict"
        out.append(PushBuilding(key=key, label=label_for(key), cls=cls, live=tuple(lrows), draft=tuple(drows)))
    return out


def push_digest(buildings: Sequence[PushBuilding]) -> str:
    """A stable fingerprint of the classified diff. The client only ECHOES it;
    a mismatch at push time means the board or scenario moved mid-review and
    the push refuses with a fresh report rather than applying stale decisions."""
    canonical = [
        (
            b.key,
            b.cls,
            sorted((r.tuple_key() for r in b.live), key=_tuple_key_sort_key),
            sorted((r.tuple_key() for r in b.draft), key=_tuple_key_sort_key),
        )
        for b in sorted(buildings, key=lambda b: b.key)
    ]
    return hashlib.sha256(json.dumps(canonical, default=str).encode()).hexdigest()


# --------------------------------------------- scenario-vs-CampMinder compare
#
# kindred#2478 §5. The RULED diff between where a scenario puts each enrolled
# family and where the CampMinder mirror (`lodging_assignments`) does. Pure
# rules only, exactly as `classify_push` above is: what agrees and what does
# not, never how to fetch it -- and NEVER how to act on it. §5.6 rules this
# report-only, because acting on `remove` would mean writing TOWARD the
# mirror, which `api/services/lodging_write_service.py` forbids outright.
#
# THE VOCABULARY IS `classify_push`'s, deliberately (§5.3): "add", "match",
# "conflict", "remove", meaning the same four things one grain over. A second
# set of words for the same four verdicts is the thing this reuse exists to
# prevent -- the write-in half of the same modal is `classify_push`'s own
# output, and two vocabularies side by side in one screen would teach staff
# that the two halves are different kinds of answer when they are not.


@dataclass(frozen=True)
class ComparePartyPlacement:
    """Where ONE side of the compare puts one enrolled party.

    `unit_codes` is the placement; `unit_label` is only what it is CALLED --
    the roster's already-built label, carried through so the modal never has
    to rebuild a merged slot's name from codes and get a different answer than
    the board shows.
    """

    grain: str
    household_cm_id: int
    person_cm_id: int
    display_name: str
    unit_codes: tuple[str, ...]
    unit_label: str


@dataclass(frozen=True)
class ComparePartyVerdict:
    """One enrolled party's verdict, with both sides' placements beside it.

    `both_unassigned` is TRUE only where `cls` is "match" -- it does not widen
    the four-word vocabulary, it splits one of its members for the overview
    counts (§5.4). 54 matches that are 37 placed-identically plus 17 both-
    unassigned are two different kinds of agreement, and one green number over
    the pair hides a barely-worked scenario.
    """

    key: str
    grain: str
    household_cm_id: int
    person_cm_id: int
    display_name: str
    cls: Literal["add", "match", "conflict", "remove"]
    both_unassigned: bool
    scenario_unit_codes: tuple[str, ...]
    scenario_unit_label: str
    mirror_unit_codes: tuple[str, ...]
    mirror_unit_label: str


def compare_party_key(grain: str, household_cm_id: int, person_cm_id: int, display_name: str) -> str:
    """The join key, spelled exactly as `partyKey` spells it in TypeScript
    (`frontend/src/components/weekend/partyKey.ts`).

    `or`, never a null-check: BOTH ids are always present and the unused one
    is `0` (Pydantic `int = 0`), so a "which id is set" test written as a
    None-check keys every household party to the same value. That is the same
    trap `partyKey`'s `||`-not-`??` note describes, arriving here through a
    different language's version of the same mistake.

    THE FALLBACK TO `display_name` IS NOT DEFENSIVE PADDING. The roster
    service emits `household_cm_id = 0` for a household whose record failed to
    resolve, so on a family weekend two such parties collide on the id alone --
    and a compare that collapses them hands one family the other's cabin. The
    name separates the half of that case which CAN be separated: a household
    record that exists but carries no `cm_id` still supplies its own
    `mailing_title`, so it keeps a name of its own.

    BE PRECISE ABOUT THE RESIDUE, because the previous wording read as though
    the name always separated them and it does not. Where the household record
    is MISSING ENTIRELY, `_household_display_name(None, 0)` names every such
    party "Household 0" -- so two of those share this key, `compare_placements`
    keeps one and the other is simply absent from the report. It cannot hand
    anyone the wrong cabin: `placement_by_household` is keyed on the same 0, so
    both sides read both parties as unplaced, and the whole loss is one row and
    one tick of `both_unassigned`. `partyKey` carries the identical residue by
    design, and fixing it means giving `RosterParty` a real identity across
    every weekend surface -- a decision, not a follow-up.
    """
    return f"{grain}-{household_cm_id or person_cm_id or display_name}"


def _placement_verdict(
    mirror: ComparePartyPlacement | None, scenario: ComparePartyPlacement | None
) -> tuple[Literal["add", "match", "conflict", "remove"], bool]:
    """The RULED predicate (§5.2), on the EXACT unit set.

    SET equality, not sequence equality: `units` is a relation whose stored
    order records how a row was written, not where a family sleeps. But no
    building-level tolerance either -- two rooms against one of the same two
    is a `conflict`, owner ruling, and multi-room differences ARE a diff.
    """
    mirror_codes = frozenset(mirror.unit_codes) if mirror else frozenset()
    scenario_codes = frozenset(scenario.unit_codes) if scenario else frozenset()
    if not mirror_codes and not scenario_codes:
        return "match", True
    if not mirror_codes:
        return "add", False
    if not scenario_codes:
        return "remove", False
    return ("match", False) if mirror_codes == scenario_codes else ("conflict", False)


def compare_placements(
    mirror: Sequence[ComparePartyPlacement], scenario: Sequence[ComparePartyPlacement]
) -> list[ComparePartyVerdict]:
    """One verdict per enrolled party (kindred#2478 §5).

    ORDER IS THE SCENARIO SIDE'S, then any party only the mirror knows. The
    scenario side comes from the roster, which is already filed on `sort_name`
    -- so the modal lists families the way the board does rather than in a
    second order invented here. Both sides normally carry the SAME party set,
    since a roster's parties are its enrolment and a scenario changes only
    where they sleep; the mirror-only tail is what keeps the function total
    if that ever stops being true.
    """
    mirror_by_key = {compare_party_key(p.grain, p.household_cm_id, p.person_cm_id, p.display_name): p for p in mirror}
    scenario_by_key = {
        compare_party_key(p.grain, p.household_cm_id, p.person_cm_id, p.display_name): p for p in scenario
    }

    ordered_keys = list(scenario_by_key)
    ordered_keys += [key for key in mirror_by_key if key not in scenario_by_key]

    out: list[ComparePartyVerdict] = []
    for key in ordered_keys:
        mirror_side = mirror_by_key.get(key)
        scenario_side = scenario_by_key.get(key)
        # Either side names the party identically; whichever exists will do.
        identity = scenario_side or mirror_side
        if identity is None:  # pragma: no cover -- keys come from these two dicts
            continue
        cls, both_unassigned = _placement_verdict(mirror_side, scenario_side)
        out.append(
            ComparePartyVerdict(
                key=key,
                grain=identity.grain,
                household_cm_id=identity.household_cm_id,
                person_cm_id=identity.person_cm_id,
                display_name=identity.display_name,
                cls=cls,
                both_unassigned=both_unassigned,
                scenario_unit_codes=scenario_side.unit_codes if scenario_side else (),
                scenario_unit_label=scenario_side.unit_label if scenario_side else "",
                mirror_unit_codes=mirror_side.unit_codes if mirror_side else (),
                mirror_unit_label=mirror_side.unit_label if mirror_side else "",
            )
        )
    return out
