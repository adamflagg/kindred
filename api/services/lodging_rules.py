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


def ramp_coverage(values: Sequence[str | None]) -> str:
    """How much of a slot is step-free — kindred#2438.

    The twin of `amenity_coverage` above, and a SEPARATE function for one
    reason: `has_ramp` is a three-value select (`yes` / `no` / `partial`, blank
    = NOT ASSESSED) rather than a bool, so a room can answer "qualified" and
    the boolean grain has nowhere to put that. Migration 1500000131 made it a
    select deliberately -- "a bool maps every unassessed cabin to false, which
    asserts 'no ramp' about cabins nobody has looked at" -- and a boolean read
    of it reports 0 of 118 units, erasing all 14 staff assessments (5 `yes`,
    5 `partial`, 4 `no`, 104 blank on the production snapshot).

    It does not walk anything, exactly as `amenity_coverage` does not: the
    caller resolves which rooms answer, and `_BathroomIndex.leaf_codes_under`
    is the ONE walk over that tree.

    Args:
        values: one entry per unit that answers for the slot -- `"yes"`,
            `"partial"` or `"no"`. `None` means NO ANSWER, and it covers both
            an unconfirmed row and an assessed-nobody blank; the caller maps
            an unrecognised string to `None` too, because an unreadable answer
            is not a claim in either direction.

    Returns:
        "all" | "some" | "partial" | "none" | "unknown".

        FIVE grades, one more than the boolean amenities carry, and each is a
        different claim:

            all      every answering room is fully step-free
            some     at least one is, but not all -- the reading that invites
                     the placement landing in one of the others
            partial  NO room is, but at least one has a qualified ramp
            none     every answering room answered `no`
            unknown  nothing answers

        `partial` does not fold into `none`, because that would re-erase 5 of
        the 14 assessments in the exact direction the select exists to prevent,
        and 3 of those 5 carry the qualifier text in `notes`. It does not fold
        into `some` either: "no room is step-free but one has a ramp with a
        lip" is a weaker claim than "some rooms are step-free", and collapsing
        them would make the grade order lie.

        `unknown` whenever ANY contributing unit is unanswered -- the same
        all-or-nothing evidence bar `amenity_coverage` states, and it matters
        far more here: 104 of 118 units are blank, so a looser bar would grade
        buildings step-free on the strength of the rooms somebody got to.
    """
    if not values or any(value is None for value in values):
        return "unknown"
    if all(value == "yes" for value in values):
        return "all"
    if any(value == "yes" for value in values):
        return "some"
    if any(value == "partial" for value in values):
        return "partial"
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
        """
        key = housing_lookup_key(raw)
        if not key:
            return raw

        direct = self._direct_by_key.get(key, "")
        if direct:
            return self._current_by_code[direct].name

        matches = [alias for alias in self._alias_by_key.get(key, ()) if alias.covers(year)]
        if len(matches) != 1:
            # 0 is a work-queue item, not an error -- three of the 88 distinct
            # strings name a unit FAMILY rather than a unit and need staff
            # knowledge (kindred#2392). 2+ is the overlapping-window pair the
            # unique index on (alias_string, valid_from_year) permits; picking
            # one arbitrarily would name a cabin nobody chose.
            return raw

        members: list[RegistryUnit] = []
        for unit_id in matches[0].member_unit_ids:
            # ALL OR NOTHING, on both doors, exactly as `Resolve` does it. A
            # stored id whose unit row is gone, and a code with no row in the
            # registry year, are the same failure: a member that cannot be
            # carried into the present. Keeping the ones that survive would
            # silently shrink a family's rooms.
            code = self._code_by_unit_id.get(unit_id, "")
            unit = self._current_by_code.get(code) if code else None
            if unit is None:
                return raw
            members.append(unit)

        if not members:
            return raw
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
