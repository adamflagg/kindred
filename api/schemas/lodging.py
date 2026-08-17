"""Pydantic models for the weekend lodging surface.

Responses first, then the write layer at the bottom. Every write model targets
the DRAFT grain -- lodging_assignments belongs to the ingest and stays
admin-only, so nothing declared here can reach it. `lodging_merges` and its
draft twin no longer exist: 1500000134 collapsed the `unit` / `merge` /
`merge_draft` placement targets into one multi-valued `units` relation and
deleted both collections outright.

Medical narrative: HouseholdMedicalResponse is the ONLY model here that
carries narrative medical text, and it is reachable from exactly one endpoint,
which is gated on `bunking.manage` -- the same permission every OTHER gated
endpoint on its router uses (kindred#2312 retargeted it from the now-removed
Permission.LODGING_PHI, and kindred#2398 stopped calling that a PHI boundary
-- there is one permission here, not two). Not every endpoint on that router
is gated: `/sessions`, `/summary`, `/roster` and the household journey are
open to any authenticated user, which is the point -- a thing here is either
behind `bunking.manage` or it is not. Every other model exposes booleans
derived from PRESENCE of a value, never its content (spec §5).

Vocabularies below mirror the Go ingest's, not a second set invented here. The
share gate and the NEAR/WITH/similar-ages modes are derived by
pocketbase/sync/lodging_requests.go into typed columns; this surface renames
nothing on the way through, so a value means the same thing on both sides of
the wire.
"""

from typing import Literal, Self

from pydantic import BaseModel, Field, model_validator

# The ONE import from the service layer, and it is a vocabulary rather than
# behaviour: `lodging_rules` is the pure-rules module (no I/O, no PocketBase,
# no FastAPI) and it owns the free-text source registry, so the family/staff
# split is declared once and cannot drift from the registry that assigns it.
from api.services.lodging_rules import RequestTextAuthorship

# The narrative columns on family_camp_medical. Named here so the boundary test
# can assert on them rather than on a hand-maintained list.
#
# This list is kept identical to `phiColumns` in
# pocketbase/sync/lodging_phi_test.go, and a test asserts that. Go's list keeps
# the narrative out of exports and logs; this one keeps it out of API payloads.
# A column registered in only one is screened on one side and served on the
# other.
MEDICAL_NARRATIVE_FIELD_NAMES: frozenset[str] = frozenset(
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

# The UNIT half of "may two families sleep here", from
# lodging_units.shareability (1500000145, kindred#2026). Distinct from
# SharePreference / ShareEligibility above, which are the HOUSEHOLD half:
# whether a family is willing to share. Both must be true before two parties
# may be put in one space, and the unit's half had no column until #2026.
#
# "unknown" is this layer's rendering of the column's empty string, exactly as
# EffectiveBathroom renders its own. A select rather than a bool because three
# states are real and collapsing them loses the one that matters: unrecorded is
# neither permission to double-book nor a ruling that one family only may go
# here. It is never coerced into either.
Shareability = Literal["unknown", "shareable", "single_party"]

# How much of a slot carries one amenity, resolved over its LEAF descendants
# (kindred#1912). Three grains rather than a bool because both boolean
# policies fall out of it for free -- `OR == != "none"`, `AND == == "all"` --
# and because what SOME means differs per criterion: for `is_accessible`, some
# is worse than none, since a building advertising two step-free rooms out of
# ten invites the placement that lands in one of the other eight.
#
# "unknown" is the absence of evidence, exactly as EffectiveBathroom and
# Shareability spell their own. `has_power = False` on an unconfirmed row
# means "nobody has said", not "there is no power". See `amenity_coverage`.
AmenityCoverage = Literal["all", "some", "none", "unknown"]

# The STAFF-OWNED weekend status, from lodging_session_status (1500000142).
# Unlike every other vocabulary in this module it mirrors no Go ingest, because
# there is no ingest: CampMinder's Sessions API has no status concept at all,
# so a cancelled weekend cannot be derived from synced data (kindred#2092).
#
# Two values by decision (owner, 2026-08-07), so widening later -- "closed for
# registration", say -- is a value addition rather than a bool-to-select
# migration. "active" is the DEFAULT rather than a stored fact: the migration
# seeds nothing and absence of a row means active.
WeekendSessionStatus = Literal["active", "cancelled"]


class WeekendSessionSummary(BaseModel):
    """One family or adult weekend."""

    session_id: str  # PocketBase record id, used to key follow-up queries
    session_cm_id: int  # CampMinder id — the stable cross-year identity
    name: str
    session_type: str  # "family" | "adult"
    start_date: str = ""
    end_date: str = ""
    sort_order: int = 0
    # Staff-owned; nothing in the sync layer writes or clears it. A cancelled
    # weekend is BADGED, NOT HIDDEN — it still holds lodging rows the sync
    # deliberately cannot clean up (1500000124), and deep links to it must keep
    # resolving, so neither /sessions nor /summary filters on this.
    status: WeekendSessionStatus = "active"


class WeekendSessionListResponse(BaseModel):
    year: int
    sessions: list[WeekendSessionSummary] = Field(default_factory=list)


class WriteInCover(BaseModel):
    """The write-in that closes a space, wherever in the tree it was recorded.

    A write-in names ONE unit, but it is a fact about a physical space, and a
    building's space contains its rooms'. The board draws whichever level the
    tree currently resolves to (`drawn_units`), and merging or splitting moves
    that level under staff's feet -- so a write-in recorded on a merged
    building went silent the moment somebody split it back to rooms, and one
    recorded on a room said nothing on the building's card after a merge. Both
    left the same hole: a family could be dropped into a space somebody is
    already sleeping in.

    Resolved on READ, never cascaded on write. A row per leaf would duplicate
    one fact across rows that then drift -- clear one room and the others still
    close the space -- and would strand orphans behind a re-merge. There is
    still exactly one `lodging_availability` row; this says which units it
    covers, and `unit_id` is the row it belongs to, so a card that inherited
    the write-in can still clear it at the source rather than dead-ending.
    """

    # The unit the row actually names -- NOT necessarily the unit carrying this
    # cover. `unit_id` is what a clear must target; the code and name are what
    # the card says when the write-in came from somewhere else.
    unit_id: str = ""
    unit_code: str = ""
    unit_name: str = ""
    occupant_name: str = ""
    note: str = ""


class LodgingUnitSummary(BaseModel):
    """One row of the lodging registry, as the roster sees it."""

    unit_id: str
    code: str
    name: str
    area_code: str = ""
    area_name: str = ""
    # The Manage screen's area rank (kindred#2076), read straight off
    # `lodging_areas.sort_order` -- the board keys its area order off this,
    # not off the area name. 0 for a unit with no expanded area, same
    # treatment `area_code`/`area_name` already give that case.
    area_sort_order: int = 0
    # None means UNKNOWN. PocketBase stores an unset number as 0, so the
    # service maps 0 -> None here; never render "sleeps 0".
    sleeps: int | None = None
    bathroom: EffectiveBathroom = "unknown"
    bathroom_group: str = ""
    near_bathhouse: bool = False
    has_power: bool = False
    # The SAME question `has_power` answers, asked of the rooms a slot
    # actually contains rather than of the row (kindred#1912). Additive, never
    # a replacement: `has_power` is still the registry's own fact, and the
    # amenity strip on the card renders that. This is what a drop is judged
    # against, because a container's flags describe the container -- twelve of
    # the fourteen 2026 family-pool containers record `has_power = 0` while
    # every leaf beneath them has power.
    #
    # Defaults to "unknown" rather than "none" for the same reason
    # `amenity_coverage` never returns "none" on missing evidence: a payload
    # built without the resolution pass must not claim an unmet need.
    power_coverage: AmenityCoverage = "unknown"
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
    # Whether more than one party may sleep here at once. READ from the
    # registry, never re-derived on this side: the rule lives in exactly two
    # places (1500000145's backfill and `classifyShareability` in
    # pocketbase/lodging/registry.go), and a third copy here is how a surface
    # comes to disagree with the column it is rendering.
    #
    # Compared AT THE LEVEL THE ASSIGNMENT WAS MADE (owner ruling, 2026-08-07),
    # never always resolved down to leaves: two households on one container is
    # a legitimate share, because they occupy different rooms beneath it and
    # CampMinder has no sub-room concept for every building. Measured over
    # 2022-2025, resolving down instead would raise 36 false alarms.
    shareability: Shareability = "unknown"
    # None when no lodging_availability row exists for this unit this weekend,
    # i.e. the unit's ROLE decides. None and False are different answers and
    # must not be flattened into one: False is "closed this weekend".
    #
    # Stated explicitly rather than implied. The rejected encoding was a row
    # meaning "the opposite of this unit's current default", which an ordinary
    # registry edit would silently invert (1500000135).
    family_available_override: bool | None = None
    # WHO is in the room. A hold IS a write-in (owner ruling, kindred#2078):
    # staff do not reserve an empty cabin, they record an occupant the system
    # does not know about -- most often non-rostered weekend staff. Read
    # straight off the availability row's `occupant_name` column, which unlike
    # `note`/`reason` below carries the SAME name on both sides, so there is
    # no second translation to keep in step.
    #
    # Display only, like `reason`. The rule never branches on it: what closes
    # a cabin is `family_available_override`, and an occupant with no override
    # is not a state any writer can produce.
    occupant_name: str = ""
    # Display only. The rule never branches on it. Read from the availability
    # row's `note` column -- see the migration header on why `note` was kept
    # rather than renamed.
    #
    # OPTIONAL since kindred#2078, and empty on every historical row by
    # construction: 1500000148 moved each existing note into `occupant_name`
    # and cleared the column behind it, because the same string rendered as
    # both the occupant's name and the card's italic reason line printed
    # twice on one card. Nothing should "repair" that emptiness by copying
    # `occupant_name` back -- the note is PROSPECTIVE, for write-ins recorded
    # from 1500000148 onward.
    reason: str = ""
    is_family_available: bool = False
    # The write-in that closes this space, resolved through the unit tree --
    # this unit's own row, else the nearest ancestor's, else the nearest
    # descendant's. None means no write-in covers it.
    #
    # The three fields above stay STRICTLY this unit's own row: they are what
    # the write path reads back, and `family_available_override` alone is what
    # `is_family_available` is derived from. Folding an inherited fact into any
    # of them would make a room look like it carried a row it does not have. Ask this field "is somebody in this
    # space", and those fields "what does this unit's own row say".
    #
    # Only a write-in travels. A release (`family_available_override is True`)
    # names no occupant and closes nothing, so inheriting it would silently
    # open every room beneath a released building.
    write_in: WriteInCover | None = None
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
    # The STRUCTURED surname, sent alongside `display_name` rather than left
    # for the client to recover from it (kindred#2180). The board names a
    # household from its children's deduplicated surnames, and
    # `_person_display_name` builds `display_name` as
    # `preferred_or_first + " " + last_name` -- so splitting the trailing
    # token back off that string is the WRONG surname for every child whose
    # own last_name contains a space: 32 of 2026's 680 distinct rostered
    # children (4.7%), measured 2026-08-09. Blank only when persons.last_name
    # is blank, which no rostered 2026 child is.
    last_name: str = ""
    age: float | None = None
    grade: int | None = None


class RequestTextEntry(BaseModel):
    """One distinct free-text answer inside a source-field block.

    `contributors` is WHO wrote it, so the panel can sub-label by child. It is
    a list rather than a single name because one parent's answer is routinely
    written onto every enrolled child's record: 48 of the 131 (household,
    source field) sibling groups in the 2026 production snapshot hold exactly
    duplicate text. Those collapse to one entry naming both children --
    rendering it twice is noise, and dropping a contributor misstates who
    asked. The other 83 groups genuinely disagree and stay as separate
    entries; `Share Bunk With` diverges almost universally, because siblings
    name their own friends.

    Empty when the answering person could not be resolved. The panel then
    renders the text with no sub-label at all, never a blank one.
    """

    text: str = ""
    contributors: list[str] = Field(default_factory=list)


class RequestTextBlock(BaseModel):
    """Every answer a household gave in ONE source field (kindred#2330).

    `source_field` is the CampMinder field name VERBATIM -- see
    `api/services/lodging_rules.REQUEST_TEXT_SOURCES` for why, including why
    `COVID-19 Bunking Requests` keeps a name nobody would choose today.

    `authorship` splits a family's own ask from a staff note. It is a fact
    about the FIELD, not a guess from the text: all 34 `BunkingNotes` values
    in the snapshot end in an inline staff signature and timestamp, and none
    of the parent-authored fields' values do. The panel renders `staff` on a
    grey rail so an internal note never reads as something the family said.
    """

    source_field: str = ""
    authorship: RequestTextAuthorship = "family"
    entries: list[RequestTextEntry] = Field(default_factory=list)


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
    # households. Always true in slice 1 when text is present -- and "text" is
    # `request_text` OR `request_blocks` (kindred#2330), because 32 rostered
    # 2026 households carry their ask only in the bunking-CSV lane and so have
    # a blank `request_text` with a real request beside it.
    needs_resolution: bool = False
    # The SAME free text, split by source field and by answering child
    # (kindred#2330). Not a reformatting of `request_text` above -- it cannot
    # be, since the join is irreversible -- but a second read of the raw
    # values the join was built from, plus the bunking-CSV lane that never
    # reached this surface at all.
    #
    # `request_text` is deliberately NOT removed. It is the fallback the panel
    # renders if these blocks ever come back empty against a non-empty join:
    # losing a family's ask is worse than losing its provenance.
    #
    # The two STAFF-authored blocks (`BunkingNotes Notes`, `Internal Bunk
    # Notes`) are present only for a caller holding `bunking.manage` -- they
    # are `original_bunk_requests` rows, and that table is gated. The
    # family-authored blocks and `request_text` are not gated. See
    # `_may_read_staff_notes` in api/routers/lodging.py.
    #
    # Ordered by `REQUEST_TEXT_SOURCES` -- family-authored blocks first, staff
    # notes last. A source field with no text produces NO block: kindred#2255's
    # ruling for this same modal leaves no "nothing applicable" clutter behind.
    request_blocks: list[RequestTextBlock] = Field(default_factory=list)

    # What the board actually places on. `preference` above stays the raw
    # registration answer because it is what a staff member sees when asked why
    # a household is flagged; this is the resolved verdict, and where the two
    # forms disagree the later one wins.
    eligibility: ShareEligibility = "unknown"
    eligibility_source: ShareEligibilitySource = "none"
    # The two forms point opposite ways -- a staff-review signal, not a
    # placement rule. Measured at 7.5% of form answerers for 2026, pre-
    # kindred#2269; that PR's union conflict test is a strict superset of the
    # one this was measured against, so the true rate can only be equal or
    # higher now.
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
    # BEDS, not `len(adults) + len(children)` (kindred#1925, kindred#2046).
    # Both lists above are published in full; this number counts only the
    # adult slots holding a real name and the children who need a bed of
    # their own -- a child under 18 months at session start does not. So it
    # is legitimately LOWER than the rows beside it, and a consumer that
    # recomputes it from those rows undoes both fixes. The rules and the
    # placeholder tokens live in `api/constants/lodging.py`.
    #
    # 0 means NOT STATED, never "nobody": every frontend reader falls back to
    # counting named people on 0, so do not start emitting it as a real
    # answer. (`lodging_assignments.party_size`, written by the Go sync, is a
    # SEPARATE stored column on a different table with the older
    # every-body-counts meaning. It is written and never read.)
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
    # (kindred#2022). "unknown" when unplaced.
    #
    # Sanctioned staff-facing use, added by kindred#1982: the roster's fit
    # check (`rosterAttention.ts`'s `needs_private_bathroom` predicate) reads
    # this to decide the party's Private-bathroom verdict (settled / unmet /
    # unverified) shown on the roster row, family card, map popover, and
    # detail panel -- #2022's own body named this the intended consumer
    # ("#1982 consumes it"). The RAW enum value is still never rendered
    # directly; only the derived verdict, and only for a CONFIRMED unit --
    # `rosterAttention.ts`'s `is_confirmed` gate still stands between this
    # field and the UI. Any OTHER surface reading this value directly, past
    # that gate, is the thing to stay wary of -- see
    # LodgingRosterService._resolve_party_bathroom.
    effective_bathroom: EffectiveBathroom = "unknown"
    arrival_eta: str = ""
    # The household's cm_id was seen in an earlier year.
    is_returning: bool = False
    # Where this household slept in the DIRECTLY PRIOR year, verbatim as staff
    # wrote it -- kindred#2075, ruled Option A ("only the directly prior year
    # just like summer"). "" means we do not know, which is the common case
    # (202 of 2026's 459 registered households) and covers three different
    # facts the card must not distinguish between: a genuine first-timer, a
    # family who skipped last year, and a family whose last visit predates
    # 2022 -- `family_camp_registrations.cabin_assignment` is blank on all
    # 1,433 rows from 2017-2021. So "" is NOT "nobody assigned them", and no
    # consumer should render a placeholder or a dash for it.
    #
    # FREE TEXT out of `cabin_assignment`, deliberately NOT resolved against
    # `lodging_units` -- see `fetch_cabin_assignments_by_household_cm_id` for
    # why (the registry holds only the current year, and 3 of the 88 distinct
    # strings across 2022-2025 resolve to no alias at all). It may therefore
    # name something no card on the board is called. Never match it against a
    # `unit_code`.
    #
    # Only ever populated on the ROSTER, and only for household-grain parties:
    # `build_summary` keeps nothing but counts, and an adult-weekend guest is
    # person-grain with no household to key on.
    last_year_cabin: str = ""
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
    """Narrative medical text. Served by ONE endpoint gated on
    `bunking.manage`. Never nested elsewhere."""

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


# What is known about where a household slept in one year (kindred#2073).
#
# THREE STATES, NOT TWO, and flattening any pair of them is the defect this
# vocabulary exists to prevent. Measured on the production snapshot
# 2026-08-09:
#
# * "placed"     -- a staff-written `cabin_assignment` on that year's row.
# * "not_placed" -- the year records cabins for OTHER households and none for
#                   this one. A real absence: either a live season still
#                   being worked (2026 is ~16% placed) or a family who was
#                   never given one.
# * "unknown"    -- the year records no cabin for ANYBODY, so nothing can be
#                   said. All of 2017-2021: 1,433 family registrations and
#                   zero cabin assignments.
#
# Derived from the data rather than from a hard-coded housing window, so the
# boundary moves when the data does. The CLIENT words the middle state, which
# is the one place the current season matters: "not yet placed" for the season
# being worked, "no cabin on file" for a past one.
HousingState = Literal["placed", "not_placed", "unknown"]

# Whether the year has an enrolled child on file.
#
# "none_on_file" is NOT "a childless family", and the difference is the whole
# reason it is a named state. 2020 has 1,264 family attendee rows and not one
# with status_id = 2 -- the season was cancelled. 2021 has no family attendee
# rows at all despite 247 registrations, while `family_camp_adults` carries
# 647 rows across 351 households. Both years are real attendance the enrollment
# tables cannot describe, and neither is an error.
EnrollmentState = Literal["enrolled", "none_on_file"]


class HouseholdJourneyYear(BaseModel):
    """One year of a household's family-camp record.

    Members are the party AS IT WAS THAT YEAR and are never carried forward
    from an adjacent one -- children age out and adults change, so a household
    is not a fixed set of people (kindred#2073).
    """

    year: int = 0
    housing: HousingState = "unknown"
    # The staff-written free text out of `family_camp_registrations`, NOT
    # resolved to a `lodging_units` row: `lodging_units` holds only the
    # current year, so a 2023 string can name a cabin that no longer exists
    # under that name. See `fetch_cabin_assignments_by_household_cm_id`.
    cabin_name: str = ""
    enrollment: EnrollmentState = "none_on_file"
    # Every `family_camp_adults` row for the year, blanks and placeholders
    # included -- the same contract `RosterParty.adults` publishes, so the
    # client applies one predicate (`isAttendingAdultName`) on both surfaces.
    adults: list[PartyAdult] = Field(default_factory=list)
    children: list[PartyChild] = Field(default_factory=list)


class HouseholdJourneyResponse(BaseModel):
    """A household's year-over-year family-camp record, newest year first.

    The window is DISCOVERED, not chosen: a year appears when the household
    has a trace in it -- an enrolled child, an adult on file, or a
    registration -- so the list is empty for a first-time family rather than
    padded with blank years.

    Carries NO family name. The label is the children's deduplicated
    surnames, and that derivation lives in exactly one place
    (`frontend/src/components/weekend/householdIdentity.ts`, kindred#2180),
    which takes the cross-year UNION of the surnames below. A name computed
    here would be a second implementation of it.
    """

    household_cm_id: int = 0
    years: list[HouseholdJourneyYear] = Field(default_factory=list)


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
    # WHO is being written in (kindred#2078). REQUIRED through the control and
    # permissive here, exactly the split `reason` already makes below and for
    # the same reason: a row written by an ingest or a fixture has no author to
    # ask, and a clear (`family_available: null`) sends neither field because
    # it DELETES the row.
    #
    # Same name as the column, deliberately. `reason`/`note` carry two names
    # only because 1500000135 reused a column that already existed; there is no
    # such inheritance here, so this write path gains no second translation.
    occupant_name: str = Field("", max_length=500)
    # Stored in the `note` COLUMN. 1500000135 kept `note` rather than adding
    # `reason` and dropping it -- identical semantics, one less schema change
    # on an empty table. The API name is the design doc's; the column name is
    # the one that already existed. `set_availability` (write) and
    # `_build_units` (read) are the only two places they meet, and a third
    # would mean renaming the column instead.
    #
    # OPTIONAL at the control since kindred#2078 -- the occupant is the
    # required half now, and the note is the "say why, so next week's staff
    # can act on it" affordance riding beside it.
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
