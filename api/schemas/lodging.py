"""Pydantic response models for the weekend lodging surface.

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

from typing import Literal

from pydantic import BaseModel, Field

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
