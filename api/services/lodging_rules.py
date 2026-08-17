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
from typing import Literal, NamedTuple

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


def is_family_available(inventory_class: str, override: bool | None) -> bool:
    """Whether this unit can take a family this weekend, in exactly one place.

    | base          | override | family-available |
    |---------------|----------|------------------|
    | family_pool   | None     | yes              |
    | family_pool   | False    | no  (burst pipe) |
    | staff_default | None     | no               |
    | staff_default | True     | yes (released)   |

    TWO layers, not three. `lodging_availability` lost its scenario dimension
    in 1500000135 because availability is a fact about the WEEKEND rather than
    about the plan -- a burst pipe closes a cabin in every scenario for that
    weekend, so there was never anything for a scenario to disagree about.

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
    as the general bunking-request question and carries 205 of the 382
    households rostered into a 2026 family session. Owner ruling 2026-08-17:
    "call them the original fieldnames for now until staff can weigh in after
    it's live". A display-names issue gets filed once they have. Do not
    "improve" these strings.
    """

    label: str
    authorship: RequestTextAuthorship


# ORDERED, and the order is the panel's block order. Family-authored fields
# first so a household's own ask leads, staff-authored notes last; within a
# lane, by 2026 coverage, so the field staff read most often is at the top.
#
# Counts are rostered households on `pocketbase/pb_data/data-prod.db`,
# denominator 382 (`status_id = 2`, 2026's eight family sessions):
# COVID-19 Bunking Requests 205, Share Bunk With 104, Shared-request 100,
# BunkingNotes Notes 28, Internal Bunk Notes 8.
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
REQUEST_TEXT_SOURCES: tuple[RequestTextSource, ...] = (
    RequestTextSource("COVID-19 Bunking Requests", "family"),
    RequestTextSource("Share Bunk With", "family"),
    RequestTextSource("Shared-request", "family"),
    RequestTextSource("FAM CAMP-Share Comments", "family"),
    RequestTextSource("BunkingNotes Notes", "staff"),
    RequestTextSource("Internal Bunk Notes", "staff"),
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
