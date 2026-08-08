"""Pydantic models for the weekend lodging surface.

Responses first, then the write layer at the bottom. Every write model targets
the DRAFT grain -- lodging_assignments belongs to the ingest and stays
admin-only, so nothing declared here can reach it. `lodging_merges` and its
draft twin no longer exist: 1500000134 collapsed the `unit` / `merge` /
`merge_draft` placement targets into one multi-valued `units` relation and
deleted both collections outright.

PHI boundary: HouseholdMedicalResponse is the ONLY model here that carries
medical narrative text, and it is reachable from exactly one endpoint, which
is gated on Permission.LODGING_PHI. Every other model exposes booleans
derived from PRESENCE of a value, never its content (spec §5).

Vocabularies below mirror the Go ingest's, not a second set invented here. The
share gate and the NEAR/WITH/similar-ages modes are derived by
pocketbase/sync/lodging_requests.go into typed columns; this surface renames
nothing on the way through, so a value means the same thing on both sides of
the wire.
"""

from typing import Literal, Self

from pydantic import BaseModel, Field, model_validator

# The narrative columns on family_camp_medical. Named here so the boundary test
# can assert on them rather than on a hand-maintained list.
#
# This list is kept identical to `phiColumns` in
# pocketbase/sync/lodging_phi_test.go, and a test asserts that. Go's list keeps
# PHI out of exports and logs; this one keeps it out of API payloads. A column
# registered in only one is protected on one side and silently exposed on the
# other.
PHI_FIELD_NAMES: frozenset[str] = frozenset(
    {
        "cpap_info",
        "physician_info",
        "special_needs_info",
        "allergy_info",
        "dietary_info",
        "additional_info",
        "bathroom_explain",
        "accommodation_explain",
    }
)

# The 3-state gate, straight from family_camp_registrations.share_cabin_gate.
# "unknown" is this layer's rendering of the column's empty string: nobody
# answered. It is never coerced into permission to pair.
SharePreference = Literal["no_share", "maybe_mutual", "yes_share", "unknown"]

# NEAR is proximity (satisfied by map distance); WITH is co-housing (satisfied
# by sharing a slot). "similar_ages" is a REFINEMENT of "with", never standalone
# -- the option it comes from begins "Share a cabin WITH", and what makes it
# different is that the partner is unnamed, so staff may pair these households
# with each other.
ProximityKind = Literal["near", "with", "similar_ages"]

# The RESOLVED verdict the board places on, from
# family_camp_registrations.share_eligibility. Not the same question as
# SharePreference above: that is the registration answer alone, while this
# resolves it against the later Family Camp information form, which staff treat
# as authoritative.
#
#   open     -- staff may match with any other open party
#   named    -- only with the partner the household named, if mutual
#   declined -- answered, and the answer was no
#   unknown  -- silent on BOTH forms; places as no-share, but is a different
#               fact from declining and must never be rendered as one
ShareEligibility = Literal["open", "named", "declined", "unknown"]

# Which form produced the eligibility above. "registration" means the
# authoritative form's share question was unanswered and the verdict fell back
# to the registration gate, so it is PROVISIONAL -- the surface should be able
# to say so rather than presenting a fallback as settled.
ShareEligibilitySource = Literal["form", "registration", "none"]

PartyGrain = Literal["household", "person"]
EffectiveBathroom = Literal["unknown", "none", "private", "shared"]


class WeekendSessionSummary(BaseModel):
    """One family or adult weekend."""

    session_id: str  # PocketBase record id, used to key follow-up queries
    session_cm_id: int  # CampMinder id — the stable cross-year identity
    name: str
    session_type: str  # "family" | "adult"
    start_date: str = ""
    end_date: str = ""
    sort_order: int = 0


class WeekendSessionListResponse(BaseModel):
    year: int
    sessions: list[WeekendSessionSummary] = Field(default_factory=list)


class LodgingUnitSummary(BaseModel):
    """One row of the lodging registry, as the roster sees it."""

    unit_id: str
    code: str
    name: str
    area_code: str = ""
    area_name: str = ""
    # None means UNKNOWN. PocketBase stores an unset number as 0, so the
    # service maps 0 -> None here; never render "sleeps 0".
    sleeps: int | None = None
    bathroom: EffectiveBathroom = "unknown"
    bathroom_group: str = ""
    near_bathhouse: bool = False
    has_power: bool = False
    has_ac: bool = False
    has_fridge: bool = False
    is_accessible: bool = False
    is_confirmed: bool = False
    is_active: bool = False
    # A building/grouping row. Present in the payload so the map and board
    # can draw the building. Whether it COUNTS is no longer this flag's
    # answer: a container resolved combined (see `is_combined`) is the one
    # space the board draws. Its own `sleeps` is a DELTA over its rooms, not
    # a whole-house total (owner ruling, kindred#2041) -- the drawn total is
    # its own `sleeps` PLUS every leaf beneath it. `drawn_units` is the one
    # predicate for which units get a card, and `_build_counts` reads it --
    # never filter on `is_container` alone.
    is_container: bool = False
    # The parent container's CODE, not its record id — the board keys on code,
    # and code is the cross-year identity thread. "" means no parent.
    parent_code: str = ""
    # The RESOLVED draw level for the requested scenario, through THREE tiers,
    # highest first: this scenario's own `lodging_slot_merges` row, else the
    # WEEKEND-LEVEL row (`scenario == ""`, 1500000140) that the CampMinder
    # mirror shows and every scenario inherits, else the unit's
    # `default_combined`. `resolve_combined` is the one implementation of that
    # order; this field is only ever its output.
    #
    # Absence at a tier means NO ROW there and falls through — never False.
    # False is "draw the children", the pre-feature behaviour, so an unruled
    # unit can never hide its rooms.
    is_combined: bool = False
    # The unit's ROLE: whether it is planning inventory at all. Carried a
    # "default" name until 1500000136, which implied an override -- and the
    # override is a rare per-weekend exception rather than the point.
    inventory_class: str = ""
    # None when no lodging_availability row exists for this unit this weekend,
    # i.e. the unit's ROLE decides. None and False are different answers and
    # must not be flattened into one: False is "closed this weekend".
    #
    # Stated explicitly rather than implied. The rejected encoding was a row
    # meaning "the opposite of this unit's current default", which an ordinary
    # registry edit would silently invert (1500000135).
    family_available_override: bool | None = None
    # Display only. The rule never branches on it. Read from the availability
    # row's `note` column -- see the migration header on why `note` was kept
    # rather than renamed.
    reason: str = ""
    is_family_available: bool = False
    map_x: float | None = None
    map_y: float | None = None


class PartyAdult(BaseModel):
    """An accompanying adult, from family_camp_adults."""

    adult_number: int = 0
    display_name: str = ""
    relationship: str = ""


class PartyChild(BaseModel):
    """An enrolled child, from attendees -> persons."""

    person_cm_id: int = 0
    display_name: str = ""
    age: float | None = None
    grade: int | None = None


class ShareRequestSummary(BaseModel):
    """The household's cabin-sharing request, unresolved.

    Every field here is READ from an ingest-derived column. Do not recompute
    any of it from share_cabin_preference / shared_cabin_modes_raw, which are
    kept only as raw provenance: the Go normaliser carries two fixes this layer
    would lose, most importantly the guard that stops the modes field's own
    "No requests" option from reading as a hard decline.
    """

    preference: SharePreference = "unknown"
    # The verbatim CampMinder answer, so staff can see what was actually said.
    preference_raw: str = ""
    proximity: list[ProximityKind] = Field(default_factory=list)
    # Household-grain free text, already deduplicated across siblings and joined
    # across the three request source fields by the ingest. One string, not a
    # list: the join is lossy to reverse, since a request may itself contain the
    # separator. Slice 1 does not resolve names, so this is shown raw.
    request_text: str = ""
    # True when there is request text but no resolution of the named families to
    # households. Always true in slice 1 when text is present.
    needs_resolution: bool = False

    # What the board actually places on. `preference` above stays the raw
    # registration answer because it is what a staff member sees when asked why
    # a household is flagged; this is the resolved verdict, and where the two
    # forms disagree the later one wins.
    eligibility: ShareEligibility = "unknown"
    eligibility_source: ShareEligibilitySource = "none"
    # The two forms point opposite ways -- a staff-review signal, not a
    # placement rule. Measured at 7.5% of form answerers for 2026.
    answers_conflict: bool = False


class AccessibilityFlagSummary(BaseModel):
    """Derived booleans ONLY. No narrative — see the module docstring."""

    needs_private_bathroom: bool = False
    needs_power: bool = False
    needs_accommodation: bool = False
    # True when the family said they can only attend WITH the accommodation
    # in place: `FAM CAMP-Opt Out VIP` = "Yes, please register regardless of
    # cabin type" means they will come either way, so the need is a warning;
    # "No, I am only able to attend with this accommodation" makes it a
    # blocker.
    #
    # READ FROM THE COLUMN. Do not recompute this as
    # `needs_accommodation and not opt_out_vip` -- kindred#1874: opt_out_vip
    # is OR'd across household members, so one member's "register regardless"
    # overrides another's "only able to attend with this in place" and the
    # blocker silently becomes a warning. The ingest layer writes the honest
    # value into accommodation_is_mandatory instead.
    accommodation_is_mandatory: bool = False
    # True when any adult in the household is bringing an infant
    # (`Adult-Infant`). Asked because of nursing -- Women's and Men's Weekend
    # share one form, and "I'm attending Men's Weekend" is how a male
    # registrant says the question does not apply. A housing-suitability
    # signal, not an accessibility need: it argues for privacy and quiet, so
    # it informs unit choice rather than gating it.
    has_infant: bool = False
    # There is deliberately NO `has_medical_narrative` here (kindred#1889). It
    # was true for every household in every year measured, because these
    # questions store "No" as text and a non-empty answer set the flag. See
    # LodgingRosterService._build_flags for why it was deleted rather than
    # filtered, and what deleting it removed from the read path.


class RosterParty(BaseModel):
    """One placeable party.

    Family camp enrols only children, so a party is a HOUSEHOLD. Adult
    weekends enrol individuals, so a party is a PERSON. Exactly one of
    household_cm_id / person_cm_id is non-zero, matching the dual grain of
    lodging_assignments.
    """

    grain: PartyGrain
    household_cm_id: int = 0
    person_cm_id: int = 0
    display_name: str = ""
    # The surname to FILE this party under, which display_name cannot supply: a
    # household's display_name is CampMinder's mailing_title ("The Johnson
    # Family"), so sorting on it files half the roster under "The". Read from
    # real last_name columns; never re-derive it from display_name downstream.
    sort_name: str = ""
    adults: list[PartyAdult] = Field(default_factory=list)
    children: list[PartyChild] = Field(default_factory=list)
    party_size: int = 0
    unit_code: str = ""
    unit_name: str = ""
    is_merged_slot: bool = False
    # Every leaf unit the party occupies, in the order `unit_name`'s label was
    # built from -- one entry for an ordinary placement, 2+ for a merged slot,
    # empty for unplaced. `unit_code` and `unit_name` keep their exact
    # existing meaning (unit_code is "" on a merged slot); this is additive,
    # for a caller -- the map view -- that needs to know WHICH units a merged
    # party spans, not just how many.
    unit_codes: list[str] = Field(default_factory=list)
    # The bathroom this party ends up with once every code in unit_codes
    # counts toward ONE merge -- lodging_rules.effective_bathroom resolved
    # against the OCCUPYING placement, not any single unit's own view
    # (kindred#2022). "unknown" when unplaced. SCORING ONLY: this feeds
    # matching, and is not itself surfaced as a claim to staff on any card
    # or panel -- see LodgingRosterService._resolve_party_bathroom.
    effective_bathroom: EffectiveBathroom = "unknown"
    arrival_eta: str = ""
    # The household's cm_id was seen in an earlier year.
    is_returning: bool = False
    share: ShareRequestSummary = Field(default_factory=ShareRequestSummary)
    flags: AccessibilityFlagSummary = Field(default_factory=AccessibilityFlagSummary)


class RosterCounts(BaseModel):
    """Honest counts, at the level the board DRAWS -- see `drawn_units`. A
    split container's own row is excluded and its rooms count instead; a
    combined container's row counts ONCE, for a `sleeps` that now folds in
    every leaf beneath it (kindred#2041) -- never a container and its own
    rooms both.
    """

    parties_total: int = 0
    parties_assigned: int = 0
    parties_unassigned: int = 0
    # Units the board draws that are PLANNING INVENTORY -- permanent staff
    # housing is excluded and reported by units_staff_housing. A combined
    # container's own drawn row is included here; its rooms, which never
    # draw their own card, are not counted a second time.
    units_total: int = 0
    units_family_available: int = 0
    # Planning inventory held back from families this session -- a burst pipe,
    # a caretaker in residence. Does NOT include permanent staff housing,
    # which was never bookable and so cannot be "held back"; that is
    # units_staff_housing.
    units_reserved: int = 0
    # Permanent full-time staff housing: 21 of the registry's 102 leaf units,
    # occupied by staff who are not enrolled per session and never appear on a
    # roster. Outside the planning inventory entirely, so NOT a subset of
    # units_total -- that distinction is what units_reserved used to get
    # wrong, reporting 21 cabins as "held back" that were never inventory.
    #
    # Counted rather than dropped silently: units_total shrinking by 21 with
    # nothing on the surface explaining it reads as data loss to a staff
    # member who knows how many cabins the property has.
    units_staff_housing: int = 0
    # Sum of `sleeps` over family-available bookable units with a KNOWN
    # sleeps value. Units with unknown capacity are excluded and reported
    # separately, so the number never overstates what is placeable.
    beds_family_available: int = 0
    units_capacity_unknown: int = 0
    units_unconfirmed: int = 0
    # Units created without an explicit inventory_class. They match
    # neither row of the availability table; surfaced rather than hidden.
    units_missing_allocation: int = 0
    # Cabin strings the ingest could not map to a unit, still awaiting triage.
    unresolved_aliases: int = 0


class WeekendRosterResponse(BaseModel):
    year: int
    session_cm_id: int
    session_name: str = ""
    session_type: str = ""
    parties: list[RosterParty] = Field(default_factory=list)
    units: list[LodgingUnitSummary] = Field(default_factory=list)
    counts: RosterCounts = Field(default_factory=RosterCounts)


class HouseholdMedicalResponse(BaseModel):
    """PHI. Served by ONE permission-gated endpoint. Never nested elsewhere."""

    household_cm_id: int
    year: int
    cpap_info: str = ""
    physician_info: str = ""
    special_needs_info: str = ""
    allergy_info: str = ""
    dietary_info: str = ""
    additional_info: str = ""
    bathroom_explain: str = ""
    accommodation_explain: str = ""


class WeekendSummaryEntry(BaseModel):
    """One weekend on the lander: who it is, and how its placement stands.

    Carries the SAME `RosterCounts` the roster endpoint returns, produced by
    the same code path, so the lander and the roster can never disagree about
    a weekend.
    """

    session: WeekendSessionSummary
    counts: RosterCounts


class WeekendSummaryResponse(BaseModel):
    """Every weekend in a year, with counts, in ONE request.

    Exists because `/roster` is a composed read whose cost is dominated by
    year-scoped work -- the unit registry, households, the prior-household
    set, family-camp adults, registrations and the unresolved-alias count are
    identical for every weekend in the year.
    Calling it once per weekend to fill a lander repeats that work N times: a
    weekend with zero parties still costs ~3s, which is the whole tell. This
    endpoint does the year-scoped fetches once and only the session-scoped
    three (availability, assignments, attendees) per weekend.
    """

    year: int
    weekends: list[WeekendSummaryEntry] = Field(default_factory=list)


# --------------------------------------------------------------- write layer
#
# Everything below writes the DRAFT grain. lodging_assignments is the
# ingest's and stays admin-only; nothing here can reach it. See migration
# 1500000132. `lodging_merges` and its draft twin were deleted outright by
# 1500000134 -- see the module docstring above.


class ScenarioWriteRequest(BaseModel):
    """Common shape of every lodging write that names a PLAN: one weekend, one scenario.

    Not every lodging write. `AvailabilityWriteRequest` deliberately does not
    extend this, because availability is a fact about the weekend rather than
    about the plan -- a burst pipe closes a cabin in every scenario for that
    weekend -- and inheriting from here is exactly what left that endpoint
    uncallable and its table empty (1500000135).

    `scenario` is REQUIRED and non-empty on the writes that do extend it. With no scenario the
    board is the CampMinder mirror and is read-only for everyone -- summer
    encodes the identical rule in `ScenarioContext`'s `isProductionMode`, which
    disables every drop target. An endpoint accepting a scenario-less write
    would be the one path around that, and it would write rows that shadow the
    mirror for every user at once.
    """

    year: int = Field(..., ge=2000, le=2100)
    session_cm_id: int = Field(..., gt=0)
    scenario: str = Field(..., min_length=1, description="saved_scenarios record id")


class PartyGrainRequest(ScenarioWriteRequest):
    """A write naming exactly one party, in exactly one grain.

    Family camp places HOUSEHOLDS; adult weekends place PERSONS. The draft's
    two partial unique indexes key on one column each, gated on `> 0`, so a row
    naming neither grain keys on nothing and dedupes against nothing, and a row
    naming both would occupy a slot in both indexes.
    """

    household_cm_id: int = 0
    person_cm_id: int = 0

    @model_validator(mode="after")
    def _exactly_one_grain(self) -> Self:
        named = (self.household_cm_id > 0) + (self.person_cm_id > 0)
        if named != 1:
            raise ValueError("name exactly one of household_cm_id or person_cm_id")
        return self


class PlacementWriteRequest(PartyGrainRequest):
    """Place a party in a scenario, into one or more units.

    `unit_ids` is REQUIRED and non-empty. An empty list used to be the
    TOMBSTONE -- "unplaced in this scenario", a state distinct from having no
    draft row, which fell through to the CampMinder mirror. kindred#1974
    removed the fall-through, so there is nothing left for a targetless row to
    suppress: it would render exactly as no row does. Two spellings of one
    state is what that change deletes, so this refuses the second one and
    `DELETE /placements` is how a party comes off the board.
    """

    # 1500000134 collapsed `unit` (an atomic room), `merge` (a slot the ingest
    # built from a historical cabin string) and `merge_draft` (one the board
    # built inside this scenario) into this single multi-valued relation. A
    # party placed across several rooms is just a longer list, whether the
    # ingest or the board put it there.
    #
    # max_length=20 matches the field's own maxSelect
    # (1500000134_lodging_units_relation.js), carried over from the deleted
    # merge tables' member cap. min_length=1 is the retired tombstone: a
    # placement names at least one unit, or it is not a placement.
    unit_ids: list[str] = Field(..., min_length=1, max_length=20)

    @model_validator(mode="after")
    def _units_are_distinct(self) -> Self:
        """Lifted from the deleted MergeWriteRequest._members_are_distinct.

        `["u1", "u1"]` is a two-member placement to Pydantic and a one-member
        placement to a PocketBase relation field, which may collapse the
        duplicate on save. The caller gets a 200 for a row that does not say
        what they sent -- and post-collapse, `unit_ids` is the ONLY way to
        build a multi-room slot, so a collapsed duplicate does not just shrink
        the set, it changes the placement's kind: two ids become one, and
        `lodging_roster_service.py`'s `_placement_of` then reports a plain
        slot for what the caller asked to be a merged one.
        """
        if len(set(self.unit_ids)) != len(self.unit_ids):
            raise ValueError("unit_ids must not name the same unit twice")
        return self


class PlacementDeleteRequest(PartyGrainRequest):
    """UNPLACE a party: drop its draft row.

    Under replace semantics the absence of a row IS the unplaced state, so
    this is the whole of "staff took this party off the board" -- the same
    thing deleting a `bunk_assignments_draft` row means on the summer board.
    """


class PlacementCopyRequest(ScenarioWriteRequest):
    """Seed one weekend's scenario from the CampMinder mirror.

    A scenario replaces the mirror rather than overlaying it (kindred#1974),
    so a new one is empty and this is what makes it usable. Weekend-scoped
    rather than year-scoped because a scenario is worked one weekend at a
    time and copying twelve weekends to plan one is work nobody asked for.

    Summer's equivalent rides inside `POST /api/scenarios`
    (`should_copy_from_production`). It copies `bunk_assignments` and returns
    zero rows for a weekend session, so it cannot be reused here; the frontend
    calls that endpoint to create the scenario and this one to seed it.
    """


class AvailabilityWriteRequest(BaseModel):
    """Reserve or release one unit for one weekend.

    Deliberately NOT a `ScenarioWriteRequest`, and that is the change that
    makes this endpoint callable at all: `scenario` there is required with
    `min_length=1`, so the request asked for a dimension the data does not
    have. Availability carries no scenario since 1500000135 -- a burst pipe
    closes a cabin in every plan for that weekend.

    `family_available: null` CLEARS the override by deleting the row, which is
    how "whatever this unit's role says" is spelled. Writing a value that
    happens to agree with the role would pin the unit against a later change
    to that role.
    """

    year: int = Field(..., ge=2000, le=2100)
    session_cm_id: int = Field(..., gt=0)
    unit_id: str = Field(..., min_length=1)
    family_available: bool | None = None
    # Stored in the `note` COLUMN. 1500000135 kept `note` rather than adding
    # `reason` and dropping it -- identical semantics, one less schema change
    # on an empty table. The API name is the design doc's; the column name is
    # the one that already existed. `set_availability` (write) and
    # `_build_units` (read) are the only two places they meet, and a third
    # would mean renaming the column instead.
    reason: str = Field("", max_length=500)


class SlotMergeRequest(BaseModel):
    """Set one container's draw level, at a scenario or at the weekend.

    `scenario` is OPTIONAL (1500000140), the opposite of the call
    1500000139 made: a blank value used to be refused here specifically
    because the CampMinder mirror was never supposed to be overridable and
    the collection's `scenario` relation was required, so a blank one could
    not be stored anyway. Both premises are gone. A merge is a fact about the
    WEEKEND, not only about a plan -- unlike a placement, no sync ever writes
    a draw level, so there is no CampMinder record of truth a writable mirror
    would corrupt, the same argument 1500000135 already made for
    lodging_availability. A blank `scenario` is now the WEEKEND-LEVEL row:
    seen on the mirror, and inherited by every scenario that has not
    overridden it locally. Resolution order, highest first: this scenario's
    own row, the weekend-level row, then the registry default -- see
    resolve_combined in lodging_roster_service.py.
    """

    year: int = Field(ge=2010, le=2100)
    session_cm_id: int = Field(gt=0)
    scenario: str = Field(default="", description="saved_scenarios record id; blank is the weekend-level row")
    unit_id: str = Field(min_length=1)
    combined: bool


class LodgingWriteResponse(BaseModel):
    """What a write did, in the terms the board needs to reconcile its state."""

    record_id: str = ""
    # True when the write removed a row rather than creating or updating one --
    # a cleared availability override, or an unplaced party.
    deleted: bool = False


class LodgingCopyResponse(BaseModel):
    """What the seed actually wrote.

    Two numbers rather than one because they answer different questions. A
    staff member reading "seeded 47 placements" wants to know the board is
    populated; `skipped` is how they find out that two more mirror rows named
    a party or a unit that no longer resolves, instead of that discrepancy
    only being visible as a board with fewer families on it than CampMinder
    shows.
    """

    copied: int = 0
    skipped: int = 0
