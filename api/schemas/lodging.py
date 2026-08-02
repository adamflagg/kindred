"""Pydantic models for the weekend lodging surface.

Responses first, then the write layer at the bottom. Every write model targets
the DRAFT grain -- lodging_assignments and lodging_merges belong to the ingest
and stay admin-only, so nothing declared here can reach them.

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
    # can draw the building, but excluded from every capacity count.
    is_container: bool = False
    allocation_default: str = ""
    # None when there is no lodging_availability override for this session.
    reservation_state: str | None = None
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
    age: int | None = None
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
    # True when ANY family_camp_medical narrative column is non-empty.
    # Presence only — the text itself is never in this payload.
    has_medical_narrative: bool = False


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
    adults: list[PartyAdult] = Field(default_factory=list)
    children: list[PartyChild] = Field(default_factory=list)
    party_size: int = 0
    unit_code: str = ""
    unit_name: str = ""
    is_merged_slot: bool = False
    arrival_eta: str = ""
    # The household's cm_id was seen in an earlier year.
    is_returning: bool = False
    share: ShareRequestSummary = Field(default_factory=ShareRequestSummary)
    flags: AccessibilityFlagSummary = Field(default_factory=AccessibilityFlagSummary)


class RosterCounts(BaseModel):
    """Honest counts. Every capacity figure excludes container rows."""

    parties_total: int = 0
    parties_assigned: int = 0
    parties_unassigned: int = 0
    # Active, non-container units.
    units_total: int = 0
    units_family_available: int = 0
    # Bookable units held back from families this session (staff-default with
    # no release, or an explicit reserved_* override).
    units_reserved: int = 0
    # Sum of `sleeps` over family-available bookable units with a KNOWN
    # sleeps value. Units with unknown capacity are excluded and reported
    # separately, so the number never overstates what is placeable.
    beds_family_available: int = 0
    units_capacity_unknown: int = 0
    units_unconfirmed: int = 0
    # Units created without an explicit allocation_default. They match
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
    year-scoped work -- the unit registry, households, registrations, medical
    and the prior-household set are identical for every weekend in the year.
    Calling it once per weekend to fill a lander repeats that work N times: a
    weekend with zero parties still costs ~3s, which is the whole tell. This
    endpoint does the year-scoped fetches once and only the session-scoped
    three (availability, assignments, attendees) per weekend.
    """

    year: int
    weekends: list[WeekendSummaryEntry] = Field(default_factory=list)


# --------------------------------------------------------------- write layer
#
# Everything below writes the DRAFT grain. lodging_assignments and
# lodging_merges are the ingest's and stay admin-only; nothing here can reach
# them. See migration 1500000132.

# lodging_availability.state, pinned to the migration's select list. That list
# is the constraint PocketBase validates against -- a value not in it fails at
# save time in production and nowhere else -- so it is restated here to fail at
# the edge instead, with a 422 naming the field.
ReservationState = Literal["reserved_staff", "reserved_other", "released_to_family"]

# lodging_merges_draft.member_units is minSelect 2, maxSelect 20 (mirroring
# lodging_merges). Refusing at the edge names the member count, rather than
# surfacing a PocketBase validation error from inside the write.
MERGE_MIN_MEMBERS = 2
MERGE_MAX_MEMBERS = 20


class ScenarioWriteRequest(BaseModel):
    """Common shape of every lodging write: one weekend, one scenario.

    `scenario` is REQUIRED and non-empty on all of them. With no scenario the
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
    """Place a party, or record that staff took it off the board.

    All three targets empty is the TOMBSTONE and is deliberately valid: it
    means "unplaced in this scenario", which is not the same as having no draft
    row. Deleting the row instead would fall through to the CampMinder mirror
    and put the family straight back where staff just dragged them from.
    """

    unit_id: str = ""
    # A slot the INGEST built from a historical cabin string.
    merge_id: str = ""
    # A slot the BOARD built inside this scenario.
    merge_draft_id: str = ""


class PlacementDeleteRequest(PartyGrainRequest):
    """Drop a party's draft row, restoring whatever the synced rows say."""


class MergeWriteRequest(ScenarioWriteRequest):
    """Bind a set of units into one bookable slot, for one weekend.

    THE MEMBER SET IS NOT VALIDATED FOR COMPLETENESS, deliberately. The rule
    "a merge is legal iff its members are the complete child set of some
    container" was built through nine tasks and removed in #1903: every member
    set is hand-authored, so a deliberate partial booking and a mis-click
    produce byte-identical rows and no rule can tell them apart. Read
    docs/architecture/lodging-occupancy.md before adding anything like it --
    the idea is genuinely appealing and wrong for reasons that are not obvious.
    """

    member_unit_ids: list[str] = Field(..., min_length=MERGE_MIN_MEMBERS, max_length=MERGE_MAX_MEMBERS)
    display_name: str = ""
    capacity_override: int | None = None


class AvailabilityWriteRequest(ScenarioWriteRequest):
    """Reserve or release one unit for one weekend, inside a scenario.

    `state: null` CLEARS the scenario's override, which returns the unit to
    whatever the live plan says. That is not the same as writing an override
    that happens to agree with the live plan, and the difference shows the
    moment the live plan changes.
    """

    unit_id: str = Field(..., min_length=1)
    state: ReservationState | None = None


class LodgingWriteResponse(BaseModel):
    """What a write did, in the terms the board needs to reconcile its state."""

    record_id: str = ""
    # True when the write removed a row rather than creating or updating one --
    # a cleared availability override, or a placement dropped back to the
    # CampMinder mirror.
    deleted: bool = False
