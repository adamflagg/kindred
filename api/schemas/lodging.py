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
# This list is kept identical to `narrativeColumns` in
# pocketbase/sync/lodging_medical_narrative_test.go, and a test asserts that. Go's list keeps
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

# The five structured gate answers on family_camp_medical (kindred#2542).
#
# Kept SEPARATE from MEDICAL_NARRATIVE_FIELD_NAMES above: a gate is one of
# "yes" / "no" / "", not a disclosure sentence, and kindred#2409 spent a PR
# making that vocabulary accurate. They carry the same protection under their
# own name -- kept out of every roster payload here, out of every export by
# `gateColumns` in pocketbase/sync/lodging_medical_narrative_test.go, and a
# test asserts the two lists are identical.
MEDICAL_GATE_FIELD_NAMES: frozenset[str] = frozenset(
    {
        "allergy_gate",
        "dietary_gate",
        "special_needs_gate",
        "physician_gate",
        "cpap_gate",
    }
)

# A household's answer to one medical gate question.
#
# THREE STATES. "unknown" is this layer's rendering of the column's empty
# string: the household never reached the question. It is never coerced into
# "no" -- in 2026, 430 of 900 households answered the allergy gate No and 224
# never answered it, and telling staff a family declined a question they were
# never shown is a different claim from the truth. Same shape, and the same
# reason, as SharePreference below.
MedicalGate = Literal["yes", "no", "unknown"]

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
# and because what SOME means differs per criterion: for step-free, some is
# worse than none, since a building advertising two step-free rooms out of ten
# invites the placement that lands in one of the other eight. (That grain is
# graded from `has_ramp`, NOT `is_accessible` -- this named the wrong column
# until kindred#2502; the two are independent and disagree on five rows.)
#
# "unknown" is the EMPTY AGGREGATION -- a slot with no active leaf has nothing
# to say -- exactly as EffectiveBathroom and Shareability spell their own. It
# is NOT "nobody has reconfirmed this cabin": kindred#2526 took `is_confirmed`
# out of the arithmetic, and a recorded value is now read at face value. See
# `amenity_coverage`.
AmenityCoverage = Literal["all", "some", "none", "unknown"]

# The registry's own step-free assessment, mirrored from the `has_ramp` select
# added by migration 1500000131 (kindred#2438). THREE values plus blank, and
# the blank is the load-bearing one: it means NOT ASSESSED, which is neither
# "yes" nor "no". That migration's comment says why it is not a bool -- "a bool
# maps every unassessed cabin to false, which asserts 'no ramp' about cabins
# nobody has looked at" -- and reading it as one reports 0 of 118 units while
# erasing all 14 staff assessments.
RampAssessment = Literal["", "yes", "no", "partial"]

# How much of a slot is step-free, resolved over its LEAF descendants
# (kindred#2438). FIVE grades rather than `AmenityCoverage`'s four, because the
# supply column is three-valued and a qualified ramp is a real answer with
# nowhere to go in a boolean grain:
#
#   all      every answering room is fully step-free
#   some     at least one is, but not all
#   partial  NO room is, but at least one has a qualified ramp
#   none     every answering room answered `no`
#   unknown  nothing answers -- a blank `has_ramp`, or no active room left.
#            NOT unconfirmed: since kindred#2526 a row is read at face value
#            whether or not staff have walked it.
#
# See `ramp_coverage` in `api/services/lodging_rules.py` for why `partial`
# folds into neither of its neighbours.
RampCoverage = Literal["all", "some", "partial", "none", "unknown"]

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
    """The write-in that covers a space, wherever in the tree it was recorded.

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
    still exactly one `lodging_write_ins` row (kindred#2382 moved occupancy off
    `lodging_availability`, which now answers only the staff<->family role);
    this says which units it covers, and `unit_id` is the row it belongs to, so
    a card that inherited the write-in can still clear it at the source rather
    than dead-ending.
    """

    # The unit the row actually names -- NOT necessarily the unit carrying this
    # cover. `unit_id` is what a clear must target; the code and name are what
    # the card says when the write-in came from somewhere else.
    unit_id: str = ""
    unit_code: str = ""
    unit_name: str = ""
    occupant_name: str = ""
    note: str = ""
    # How many people the row is for, or None when nobody recorded a count.
    #
    # `None` is *occupies wholesale* -- never "zero people" -- the column's
    # `min: 1` forbids zero, and the em dash the card has always drawn is
    # exactly this state. `write_in_demand` (api/services/lodging_rules.py) is
    # the one place that reading turns into arithmetic.
    party_size: int | None = None
    # WHICH DIRECTION this cover reached the unit from, resolved by
    # `write_in_covers` at the moment it walks the tree.
    #
    # PUBLISHED rather than left to the client, and that is the point: an
    # ancestor and a descendant take a card's beds differently (an ancestor
    # takes the whole card; a descendant takes its own room's), and
    # `writeInEntries` can only tell own from not-own by comparing codes. A
    # second walk on the client is a second answer to "who is in this space".
    relation: Literal["own", "ancestor", "descendant"] = "own"
    # The EFFECTIVE capacity of the unit the row NAMES -- a whole-house total
    # on a container, `sleeps` on a leaf, None when nobody measured it.
    #
    # 0, not the raw figure, when the row's own unit is RETIRED (kindred#2540
    # fix-round FINDING 5). `_effective_sleeps` filters `is_active` only
    # inside a container's sum over its leaves -- a leaf looked up directly
    # still returns its raw `sleeps` -- so an unclamped retired source would
    # consume beds its own container's capacity never counted. The cover
    # itself still names the room; only the beds it claims are zeroed.
    #
    # PUBLISHED because a descendant cover consumes ITS OWN room's beds, and
    # the one surface that has to know cannot look it up: `MapUnitPopover`
    # never receives the full registry -- its own `units` prop is documented as
    # "only a cluster's members… cannot answer the question alone". Threading
    # the registry in was rejected there deliberately. The server already
    # computes this while resolving availability, so publishing it removes a
    # client-side registry walk rather than adding a field for its own sake.
    #
    # THE SERVER READS THIS FIELD BACK, not a second `capacity_by_code`
    # lookup (`_resolve_family_availability`'s per-load capacity) -- the two
    # used to be independent derivations that were merely equal; the retired-
    # unit clamp above is what would make them diverge if the server kept
    # re-deriving its own answer instead of reading the one it just published.
    unit_sleeps: int | None = None


class PushRowPayload(BaseModel):
    """One classified write-in row, as `preview_push` reports it (kindred#2477).

    A wire rendering of `lodging_rules.PushRow`, field-for-field -- the row's
    MEANING lives on that frozen dataclass and this is not a second opinion of
    it, only the shape that crosses the API boundary.
    """

    unit_id: str
    unit_code: str
    unit_name: str
    occupant_name: str
    note: str = ""
    # `None` is *occupies wholesale, never zero* -- the same #2540 reading
    # `WriteInCover.party_size` carries above. A live row with no count
    # against a draft row that recorded one is a genuine difference, and
    # `PushRow.tuple_key()` treats it as such rather than coercing it to 0.
    party_size: int | None = None
    sleeps: int | None = None


class PushBuildingReport(BaseModel):
    """One building's live-vs-draft write-ins, and the RULED verdict for it.

    `cls` is `classify_push`'s own word (`api/services/lodging_rules.py`),
    computed server-side and PUBLISHED rather than re-derived: inside a
    scenario the client never reads `lodging_write_ins` at all -- the roster
    replaces those rows with the draft twin -- so it has nothing to diff
    against and no TS mirror of the classifier exists on purpose.
    """

    key: str
    label: str
    cls: Literal["add", "match", "conflict", "remove"]
    live: list[PushRowPayload] = Field(default_factory=list)
    draft: list[PushRowPayload] = Field(default_factory=list)


class PushPreviewResponse(BaseModel):
    """The report half of kindred#2477's write-in push queue.

    `digest` fingerprints `buildings` (`push_digest`), and it is not a fact
    about the request -- it is a fact about what this preview SAW. The client
    echoes it back unchanged when it actually pushes; a mismatch means the
    live board or the scenario moved between the preview and the push, and
    the push refuses with a fresh report rather than applying decisions made
    against one that is no longer true.
    """

    year: int
    session_cm_id: int
    scenario: str
    digest: str
    buildings: list[PushBuildingReport] = Field(default_factory=list)


class PushExecuteRequest(BaseModel):
    """Apply a scenario's write-ins onto the live board (kindred#2477).

    `digest` is `PushPreviewResponse.digest`, ECHOED BACK unchanged --
    `execute_push` refuses with a fresh report the moment it disagrees, which
    means the board or the scenario moved between the review and this call.

    `decisions` names a verdict ONLY for the buildings that need one: a
    `conflict` chooses `"live"` (keep the live occupant) or `"scenario"`
    (replace with the draft's rows); a `remove` chooses `"keep"` (leave it on
    the board) or `"remove"`. The two verdict pairs are NOT interchangeable --
    `execute_push` only ever checks a `conflict` decision against `"scenario"`
    and a `remove` decision against `"remove"`, treating anything else
    (including a value from the other class's pair) as the no-op side. An
    `add` or a `match` building needs no entry -- there is nothing to decide.
    The RULED block rule (owner, 2026-08-22) is that a missing decision on a
    building that needs one refuses the whole push rather than defaulting to
    the no-op side; see `PushDecisionsIncompleteError`.
    """

    year: int
    session_cm_id: int = Field(gt=0)
    scenario: str = Field(min_length=1)
    digest: str
    decisions: dict[str, Literal["live", "scenario", "keep", "remove"]] = Field(default_factory=dict)


class PushExecuteResponse(BaseModel):
    """What the push actually did.

    `push_id` is the `lodging_write_in_pushes` row's id -- the ledger entry
    Unpush will replay -- and is `""` on a no-op, when nothing needed to move
    and no ledger row was written at all.
    """

    push_id: str = ""
    added: int = 0
    removed: int = 0
    replaced: int = 0
    kept: int = 0
    matched: int = 0
    no_op: bool = False


class UnpushResponse(BaseModel):
    """What `unpush` actually did (kindred#2477 Task 5).

    `restored` is how many removed rows came back; `deleted` is how many
    added rows were taken back off the live board -- the mirror image of
    `PushExecuteResponse.added` / `.removed`, one field per direction the
    ledger's `changes` replay moves a row.
    """

    push_id: str = ""
    restored: int = 0
    deleted: int = 0


class ComparePartyReport(BaseModel):
    """One enrolled family's scenario-vs-CampMinder verdict (kindred#2478 §5).

    A wire rendering of `lodging_rules.ComparePartyVerdict`. `cls` is
    `classify_push`'s own four-word vocabulary (§5.3) -- the SAME words the
    write-in half of this modal already uses, one grain over -- and
    `both_unassigned` splits one of its members for the overview counts rather
    than widening it to five.

    THERE IS NO JOIN KEY ON THE WIRE, deliberately. The client derives it with
    `partyKey()` (frontend/src/components/weekend/partyKey.ts), which is the
    one definition of party identity on that side; publishing a second one
    from here is how four surfaces drifted into two variants last time.
    `household_cm_id`/`person_cm_id` are BOTH always present and the unused
    one is 0, exactly as `RosterParty` publishes them, so `partyKey` reads
    this row the same way it reads a roster row.

    `*_unit_label` is the roster's ALREADY-BUILT label for each side -- a
    merged slot's name included -- so the modal never rebuilds a name from
    codes and shows staff something the board does not. `*_unit_codes` is the
    placement itself, and is what the predicate compared.
    """

    grain: PartyGrain
    household_cm_id: int = 0
    person_cm_id: int = 0
    display_name: str = ""
    cls: Literal["add", "match", "conflict", "remove"]
    # TRUE only where `cls` is "match": both sides agree this party has no
    # cabin yet. Counted apart from a placed match (§5.4) because 54 matches
    # that are 37 placed-identically plus 17 both-unassigned are two different
    # kinds of agreement, and one green number over the pair hides a barely
    # worked scenario.
    both_unassigned: bool = False
    scenario_unit_label: str = ""
    scenario_unit_codes: list[str] = Field(default_factory=list)
    mirror_unit_label: str = ""
    mirror_unit_codes: list[str] = Field(default_factory=list)


class ScenarioCompareCounts(BaseModel):
    """The overview (kindred#2478 §5.4). FIVE numbers over four verdicts.

    `match` is PLACED-IDENTICALLY ONLY. `both_unassigned` is the other half of
    the same verdict, and the split is the ruling -- summing the two back
    together in a caller undoes it.
    """

    match: int = 0
    both_unassigned: int = 0
    conflict: int = 0
    add: int = 0
    remove: int = 0


class ScenarioCompareResponse(BaseModel):
    """A scenario against the CampMinder mirror, for one family-camp weekend
    (kindred#2478 §5).

    REPORT-ONLY, and the payload says so by what it does not carry: no digest
    to echo, no decision handle, nothing a client could post back. Owner
    ruling §5.6 -- two of the four verdicts cannot be actioned at all, because
    acting on `remove` means writing TOWARD the mirror and
    `api/services/lodging_write_service.py` forbids that outright; acting is
    gated on the promote/publish decision, which is its own issue.

    `write_ins` is `preview_push`'s own output, unaltered (§5.4). The write-in
    half of this screen and the Push Write-Ins review screen run the same
    classifier over the same rows, so they can never disagree.
    """

    year: int
    session_cm_id: int
    scenario: str
    session_name: str = ""
    counts: ScenarioCompareCounts = Field(default_factory=ScenarioCompareCounts)
    parties: list[ComparePartyReport] = Field(default_factory=list)
    write_ins: list[PushBuildingReport] = Field(default_factory=list)


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
    # The AC twin of `power_coverage`, resolved over the same leaf walk and
    # defaulting to "unknown" for the same reason: a payload built without
    # the resolution pass must not claim an absent amenity. Seven of the 15
    # production containers record `has_ac = 0` with AC-bearing rooms, so
    # merging a house hid a mark both its rooms carry.
    #
    # DISPLAY ONLY. Air conditioning has no demand glyph -- ruled on 0 of 184
    # housing narratives mentioning it, against 54 for a bathroom -- so this
    # exists to keep the amenity strip honest, not to grade a need.
    ac_coverage: AmenityCoverage = "unknown"
    has_fridge: bool = False
    # NARROWS `has_fridge` -- it can never contradict its parent, so a consumer
    # reading only `has_fridge` stays correct (the registry's own contract,
    # pocketbase/lodging/registry.go). Published because A SHARED FRIDGE IS A
    # FRIDGE (owner ruling, kindred#2224): it satisfies a fridge need outright
    # and reads `fits`, never `partial`. Whether the sharedness is SURFACED on
    # a card is a display question and belongs to kindred#2072; this is only
    # the fact.
    has_shared_fridge: bool = False
    # The fridge twin of `power_coverage`, resolved over the same leaf walk and
    # defaulting to "unknown" for the same reason: a payload built without the
    # resolution pass must not claim an unmet need. Twelve of 118 production
    # units carry `has_fridge`, four of those also carry `has_shared_fridge`,
    # and none carries shared without the parent.
    fridge_coverage: AmenityCoverage = "unknown"
    # The registry's own step-free fact about THIS ROW, published beside its
    # resolution exactly as `has_power` and `has_fridge` are (kindred#2438).
    #
    # ⚠️ NOT the field a drop is judged against -- `ramp_coverage` below is,
    # and reading this instead reintroduces the container trap AND the
    # truthiness trap at once: `has_ramp` is a STRING, so `'no'` is truthy, and
    # a consumer filtering on it renders "step-free" on the four cabins staff
    # assessed as explicitly having no ramp. Blank means NOT ASSESSED (104 of
    # 118 production rows) and is never coerced to "no".
    has_ramp: RampAssessment = ""
    # The step-free twin of `power_coverage` and `fridge_coverage`, resolved
    # over the same leaf walk and defaulting to "unknown" for the same reason:
    # a payload built without the resolution pass must not claim an unmet need.
    # Fourteen of 118 production units carry an assessment (5 yes / 5 partial /
    # 4 no), so almost every unit resolves "unknown" today -- which is the
    # honest answer, not a gap.
    ramp_coverage: RampCoverage = "unknown"
    # ⚠️ INDEPENDENT of `has_ramp` above, measured: `has_ramp = 'yes'` splits 2
    # `is_accessible` true / 3 false, and the 4 explicit `no`s plus 5
    # `partial`s are invisible to this flag, which reads them identically to
    # the 104 rows nobody has looked at. No fold in either direction is
    # information-preserving (kindred#2438), and #2327's ruling -- accessible
    # draws only when TRUE -- is unchanged by the ramp dimension.
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
    # THE staff<->family ROLE, AND NOTHING ELSE, since kindred#2382 finished
    # splitting the boolean's two questions apart. This is `lodging_availability`
    # for this unit this weekend: True is "a staff cabin opened to families",
    # False is "closed by role", and None means there is no row, so the unit's
    # standing `inventory_class` decides. None and False are different answers
    # and must not be flattened into one.
    #
    # IT DOES NOT ANSWER "IS SOMEBODY IN IT". That is `write_ins` below, read
    # from `lodging_write_ins` / `_draft`. Until PR 4 of kindred#2382 an
    # occupancy also reported itself here as False, because
    # `is_family_available` and the board's forest open-tint were both derived
    # from this one field; both read the occupancy source directly now, so a
    # False here means a role decision and never an occupant. A reader that
    # wants "can a family go in this space" wants `is_family_available`, which
    # folds both facts in; a reader that wants "is somebody in it" wants
    # `write_ins`.
    #
    # Stated explicitly rather than implied. The rejected encoding was a row
    # meaning "the opposite of this unit's current default", which an ordinary
    # registry edit would silently invert (1500000135).
    family_available_override: bool | None = None
    # WHO is in the room. A hold IS a write-in (owner ruling, kindred#2078):
    # staff do not reserve an empty cabin, they record an occupant the system
    # does not know about -- most often non-rostered weekend staff. Read
    # straight off the write-in row's `occupant_name` column (kindred#2382;
    # the availability row's is what a RELEASE carries, which is always
    # blank), a column that unlike `note`/`reason` below carries the SAME name
    # on both sides, so there is no second translation to keep in step.
    #
    # Display only, like `reason`. The rule never branches on it: what closes
    # a cabin is `is_family_available`, which folds the ROLE and the OCCUPANCY
    # together.
    #
    # AN OCCUPANT WITH NO ROLE OVERRIDE IS THE ORDINARY STATE since PR 4 of
    # kindred#2382, and used to be an impossible one. A write-in says nothing
    # about the staff<->family question, so `set_availability` writes the
    # occupancy row alone and `family_available_override` stays None -- which
    # is exactly what stopped this field having to spell an occupancy as
    # `False`.
    occupant_name: str = ""
    # Display only. The rule never branches on it. Read from the `note` column
    # of whichever row supplied the decision -- the write-in row for an
    # occupancy, the availability row for a release -- see 1500000118's header
    # on why `note` was kept rather than renamed.
    #
    # OPTIONAL since kindred#2078, and empty on every historical row by
    # construction: 1500000148 moved each existing note into `occupant_name`
    # and cleared the column behind it, because the same string rendered as
    # both the occupant's name and the card's italic reason line printed
    # twice on one card. Nothing should "repair" that emptiness by copying
    # `occupant_name` back -- the note is PROSPECTIVE, for write-ins recorded
    # from 1500000148 onward.
    reason: str = ""
    # The unit's OWN write-in row's count, read the way `occupant_name` and
    # `reason` are and for the same reason: `write_in_covers` reads it back off
    # the summary rather than re-fetching the row.
    party_size: int | None = None
    # CAN A FAMILY GO IN THIS SPACE -- the DERIVED answer, and the one every
    # count on the stats bar goes through. Folds two facts together: the ROLE
    # from `family_available_override`, and how many beds are LEFT once every
    # write-in in `write_ins` below is paid for.
    #
    # ⚠️ OCCUPANCY IS NOT ABSOLUTE, AND THIS COMMENT USED TO SAY IT WAS.
    # kindred#2432 made a written-into cabin take a family like any other and
    # took the drop refusal out of `dragPlacement.ts`; kindred#2503 stopped
    # this field disagreeing with that board. A fifteen-bed cabin with two
    # people written in is a space with thirteen beds. What closes a unit is
    # having none left -- the same answer for a full cabin and for a write-in
    # that takes a space wholesale, a different one for a shared space.
    #
    # Its rule is `is_family_available` in api/services/lodging_rules.py, and
    # that is the only place the two are combined.
    is_family_available: bool = False
    # EVERY write-in that covers this space, resolved through the unit tree --
    # this unit's own row, else the nearest ancestor's, else the nearest
    # written-into descendant on each branch beneath it. Empty means no
    # write-in covers it.
    #
    # A LIST since kindred#2381, and that arity is the whole point rather than
    # future-proofing. A merged container draws in place of its rooms, so the
    # four write-ins one 2026 container carries in a single weekend collapsed to
    # whichever room sorted first and the other three were invisible -- while
    # each clear silently re-populated the card with the next occupant, so
    # destroying all four read as four failed clicks. A write-in must survive a
    # merge and a split the way an assignment does, and an assignment does it
    # by the drawn card carrying however many leaves it covers.
    #
    # The fields above stay STRICTLY this unit's own row: they are what the
    # write path reads back. Folding an inherited fact into any of them would
    # make a room look like it carried a row it does not have. Ask THIS field
    # "is somebody in this space", and those fields "what does this unit's own
    # row say".
    #
    # Only a write-in travels. A release (`family_available_override is True`)
    # names no occupant and closes nothing, so inheriting it would silently
    # open every room beneath a released building.
    #
    # ⚠️ `is_family_available` READS THIS FIELD, and it did not until
    # kindred#2503 -- it folded in the unit's OWN occupancy row alone, so a
    # combined container whose write-ins live on its rooms drew the badge and
    # listed all four occupants while the bar above it counted the whole house
    # open with every bed free. `_resolve_family_availability` recomputes the
    # flag from these RESOLVED covers, after the cover walk, on both
    # orchestrators.
    write_ins: list[WriteInCover] = Field(default_factory=list)
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
    # Whether this child is under 24 months at the reference date -- the
    # weekend's start on the roster, the historical year's start on a journey
    # row. kindred#2480's rule: filter and mark key on ONE server-computed
    # answer so they can never disagree.
    #
    # ⚠️ NOT derived from `age`. That column is CampMinder's yy.mm snapshot and
    # thresholding on it is forbidden -- see `_has_child_under_two`. Measured
    # over 717 rostered 2026 children: `age <= 2` marks 47, birthdate marks 43,
    # so age produces four false positives and misses none.
    #
    # OPPOSITE POLARITY from `_consumes_a_bed` on every unknown, matching
    # `_has_child_under_two`: this draws an ICON asserting knowledge, so a
    # missing birthdate or an unreadable reference date contributes False.
    is_under_two: bool = False
    grade: int | None = None
    # WHICH FAMILY WEEKENDS THIS CHILD ATTENDED that year, earliest first
    # (kindred#2393). Populated by the household journey ONLY, and empty on
    # every other surface: the roster is already one weekend, so a per-child
    # weekend list there would restate the page's own title once per camper.
    #
    # The journey spans years and its rows are household-YEAR grain, which is
    # where a family that booked two of a season's weekends collapses into one
    # merged member list. Measured on the production snapshot, 64 of 5,438
    # journey household-years are multi-weekend and 7 of those 64 carry a
    # child who did not attend every weekend -- so the merged list overstates
    # at least one weekend's party. This is what lets the client undo that.
    #
    # Empty is "not knowable", NOT "attended nothing": an attendee row whose
    # `session` relation did not expand yields no weekend at all, and the
    # client keeps such a child visible rather than hiding them from every
    # weekend.
    session_cm_ids: list[int] = Field(default_factory=list)


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
    wants_with_named: bool = Field(
        default=False,
        description=(
            "The WITH-a-named-family checkbox specifically, read verbatim from "
            "family_camp_registrations.wants_with_named (owner ruling 2026-08-22: "
            "the ticks are stored un-ORed). `proximity`'s 'with' remains the "
            "co-housing SUPERSET — derived here as named OR similar_ages, so its "
            "public semantics are unchanged. The board's HeartHandshake icon keys "
            "on this flag alone."
        ),
    )
    # Household-grain free text, already deduplicated across siblings and joined
    # across the three request source fields by the ingest. One string, not a
    # list: the join is lossy to reverse, since a request may itself contain the
    # separator. Slice 1 does not resolve names, so this is shown raw.
    request_text: str = ""
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
    # Ordered by `REQUEST_TEXT_SOURCES` -- a staff-specified order (kindred#2476,
    # owner ruling 2026-08-21), NOT derived from authorship or volume. `Share
    # Bunk With` is family-authored and sorts last, after both staff notes. A
    # source field with no text produces NO block: kindred#2255's ruling for
    # this same modal leaves no "nothing applicable" clutter behind.
    request_blocks: list[RequestTextBlock] = Field(default_factory=list)

    # What the board actually places on. `preference` above stays the raw
    # registration answer because it is what a staff member sees when asked why
    # a household is flagged; this is the resolved verdict, and where the two
    # forms disagree the later one wins.
    eligibility: ShareEligibility = "unknown"
    eligibility_source: ShareEligibilitySource = "none"


class AccessibilityFlagSummary(BaseModel):
    """Derived booleans ONLY. No narrative — see the module docstring."""

    needs_private_bathroom: bool = False
    needs_power: bool = False
    needs_accommodation: bool = False
    # kindred#2224. `needs_accommodation` above is a GATE question, not a need:
    # CampMinder asks a plain Yes/No and the substance lands in a free-text
    # field. This is the first need resolved out of that narrative -- six of the
    # 42 accommodation-gated 2026 households ask for cold storage, against 12 of
    # 118 units carrying a fridge, and nothing connected them.
    #
    # DERIVED IN THE SYNC LAYER, exactly as the flags around it are. The
    # narrative names diagnoses, medications and feeding disorders, so only the
    # boolean crosses into this payload; the sentence stays in
    # family_camp_medical behind Permission.BUNKING_MANAGE.
    #
    # ADVISORY. Keyword resolution over family prose is wrong sometimes, so the
    # board hatches a unit for this and never dims one -- see `needsFit.ts`,
    # where the mark it feeds changes `background-image` and nothing else.
    needs_fridge: bool = False
    # kindred#2438. The second need resolved out of the housing narrative, and
    # the one the registry has always been able to answer: `lodging_units`
    # has carried `has_ramp` since migration 1500000131 and nothing read it.
    #
    # ⚠️ ROUTED THE SAME WAY as `needs_fridge` above: the accommodation
    # narrative ALONE. It read the bathroom narrative too until the 2026-08-23
    # owner ruling reversed that, because a household whose only narrative was
    # a bathroom explanation raised this flag AND `needs_private_bathroom`,
    # drawing two glyphs whose tooltips quoted the same paragraph. Re-measured
    # before reversing: of the 14 households the pre-ruling both-field read
    # found on the 2026 snapshot, 9 trip on the accommodation narrative and keep
    # the flag; the other 5 are ALL already `needs_private_bathroom`, so the
    # signal loss is zero.
    #
    # ⚠️ NOT GATED on `needs_accommodation` -- a CODE decision, not a measured
    # one, and not the same split as the sentence above. On the live route every
    # household raising either flag happens to be gated (6 of 6 fridge, 9 of 9
    # mobility), so nothing turns on the ungated path today; it stays open
    # because a family can narrate a need without answering the gate. This read
    # "only 11 of the 14 mobility households are" until kindred#2572: a
    # both-field count whose 3 ungated households all narrate through the
    # bathroom question and no longer raise the flag at all.
    #
    # DERIVED IN THE SYNC LAYER and ADVISORY, on the same terms as the flag
    # above: only the boolean crosses into this payload, and the mark it feeds
    # hatches a unit card rather than refusing a drop.
    needs_step_free: bool = False
    # True when the family said they can only attend WITH the accommodation
    # in place: `FAM CAMP-Opt Out VIP` = "Yes, please register regardless of
    # cabin type" means they will come either way, so the need is a warning;
    # "No, I am only able to attend with this accommodation" makes it a
    # blocker.
    #
    # READ FROM THE COLUMN. This is the ONE stored VIP signal (owner ruling
    # 2026-08-22): the answer's No pole. "Yes, please register regardless of
    # cabin type" and an unanswered question both read false -- the retired
    # `opt_out_vip` column stored the Yes pole and taught kindred#1874's
    # lesson: an OR over the flexible pole inverts a sibling's blocker into a
    # warning, the fail-UNSAFE direction. The ingest layer ORs the No pole
    # only, which is blocker-wins by construction.
    #
    # Staff ruling: this signal is the family panel's, not the board card's
    # -- `FamilyCard.tsx`'s chip row struck `Needs Accommodation`, and
    # `AccessibilityFlagList` on `FamilyDetailsPanel` renders the mandatory
    # row.
    accommodation_is_mandatory: bool = False
    # True when any adult in the household is bringing an infant
    # (`Adult-Infant`). Asked because of nursing -- Women's and Men's Weekend
    # share one form, and "I'm attending Men's Weekend" is how a male
    # registrant says the question does not apply. A housing-suitability
    # signal, not an accessibility need: it argues for privacy and quiet, so
    # it informs unit choice rather than gating it.
    has_infant: bool = False
    # A child under TWO YEARS at session start (staff ruling, 2026-08-21).
    #
    # ⚠️ COMPUTED AT ROSTER BUILD TIME, and that is a DELIBERATE DIVERGENCE
    # from the read-from-the-column contract every registration-derived flag
    # above honours. `has_infant` above cannot serve the board it was added
    # for: the CampMinder Adult-Infant question is only answered on adult
    # sessions, so it is 0 across all 3,923 production
    # `family_camp_registrations` rows -- dead by construction on exactly the
    # family weekends where a baby changes what a unit has to provide. The
    # children's real birthdates ARE in the roster build's hands
    # (`_build_household_parties`), so this flag is derived there against the
    # session's start date. `has_infant` stays as-is: raw form answer, its own
    # provenance.
    #
    # 24 months, NOT the 18-month bed rule (`INFANT_BED_EXEMPT_MONTHS`) --
    # "is there a baby or toddler in this party" is a different question from
    # "does this child need a bed". FALSE-WHEN-UNKNOWN: a missing or
    # unparseable birthdate, or an unreadable session start, contributes
    # false, the OPPOSITE polarity from the bed rule's keep-the-bed fallback,
    # because the icon asserts knowledge. Person-grain (adult-session)
    # parties ride this default. See `_has_child_under_two` in
    # `lodging_roster_service.py` for the rule itself.
    has_child_under_two: bool = False
    # The second computed flag, feeding the baby mark's capacity note (staff
    # ruling 2026-08-21, superseding kindred#2212's inline icon): ANY child
    # here is bed-exempt -- under the 18-month `_consumes_a_bed` rule at
    # session start. Derived from the SAME call that discounts `party_size`,
    # so this and the bed count can never disagree; it therefore inherits the
    # bed rule's conservatism (sentinel age, missing birthdate, unreadable
    # session start all KEEP the bed, and a kept bed is never claimed exempt).
    # Always a subset of `has_child_under_two`.
    has_bed_exempt_child: bool = False
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
    # directly; only the derived verdict. ⚠️ `rosterAttention.ts`'s
    # `is_confirmed` gate USED to stand between this field and the UI and no
    # longer does (kindred#2526) -- every placed cabin is graded. Any OTHER
    # surface reading this value directly is still the thing to stay wary of
    # -- see LodgingRosterService._resolve_party_bathroom.
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
    # RESOLVED TO THE REGISTRY NAME (kindred#2332), not the raw string staff
    # typed last season. Owner ruling 2026-08-18: *"the last year housing
    # should use the same language via the alias year over year concept so it
    # appears in current language."* This field used to carry the prior year's
    # `cabin_assignment` free text straight through, so the family card
    # contradicted the board card beside it -- 37 of 88 distinct raw strings
    # resolve to a different registry name, covering 716 of 1,861 rows (38.5%).
    #
    # `HousingNameResolver.display_name` does the work, at the PRIOR year's
    # alias window: the window says which raw string was in use when, and is an
    # input to FINDING the unit, never to naming it. A string that resolves to
    # nothing renders unchanged, which is what the three strings naming a unit
    # FAMILY rather than a unit do (kindred#2392).
    #
    # THE RAW STRING IS NOT DUPLICATED HERE. It is provenance, and it lives on
    # `HouseholdJourneyYear.cabin_name_raw` -- the same household-year fact, on
    # the surface whose job is the record, one click away through this card.
    #
    # Still never match it against a `unit_code`: it is a NAME, and a name is
    # not an identity. The board's own placement travels in `unit_code` /
    # `unit_codes`.
    #
    # ⚠️ NOT PER-WEEKEND, and no consumer may render it as such (kindred#2336).
    # `cabin_assignment` has grain (household, year) because its source is one
    # CampMinder household custom field per household-year -- so a household
    # attending two weekends of a season shows the SAME cabin for both, and its
    # later weekend overwrites nothing because there was never a second value.
    # Staff confirmed 2026-08-15 that this is acceptable and asked for no
    # snapshot or lookback. 41 of 1,703 cabin-holding household-years are
    # multi-weekend; treating the fan-out as per-weekend placement manufactured
    # 12 of 17 false multi-household occupancies in one analysis.
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
    # Permanent full-time staff housing: 21 of the registry's 102 leaf units,
    # occupied by staff who are not enrolled per session and never appear on a
    # roster. Outside the planning inventory entirely, so NOT a subset of
    # units_total -- a held-back FAMILY cabin (a burst pipe, a caretaker in
    # residence) is still counted there and against units_family_available,
    # because it was never staff housing and remains inventory. The two are
    # different facts with different remedies, which is why staff housing
    # gets its own count rather than folding into "not available".
    #
    # Counted rather than dropped silently: units_total shrinking by 21 with
    # nothing on the surface explaining it reads as data loss to a staff
    # member who knows how many cabins the property has.
    units_staff_housing: int = 0
    # Sum of FREE beds (kindred#2503 Task 5) over family-available bookable
    # units with a known capacity -- not whole cabins. A written-into cabin
    # with beds left contributes only its remainder; an uncovered cabin
    # contributes its whole `sleeps`, which is still the common case. Units
    # with unknown capacity are excluded and reported separately, so the
    # number never overstates what is placeable.
    #
    # Placed families are still NOT subtracted: this bar's numerator
    # (`spotsNeeded`) already counts them, so subtracting here too would count
    # a placed family on both sides. A write-in is on nobody's roster and
    # appears in neither, so its beds must leave the denominator instead.
    spots_family_available: int = 0
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
    """Narrative medical text and the gate answers beside it. Served by ONE
    endpoint gated on `bunking.manage`. Never nested elsewhere."""

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

    # The gate answers, split out of the narrative columns by kindred#2542. The
    # panel renders these as a pill beside the row label; the narrative above
    # holds the family's own words alone.
    allergy_gate: MedicalGate = "unknown"
    dietary_gate: MedicalGate = "unknown"
    special_needs_gate: MedicalGate = "unknown"
    physician_gate: MedicalGate = "unknown"
    cpap_gate: MedicalGate = "unknown"


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


class HouseholdJourneySession(BaseModel):
    """One family weekend a household attended in a given year (kindred#2393).

    THE WEEKEND, NOT THE HOUSING. A journey row is a year and a year holds
    exactly ONE cabin string -- `family_camp_registrations` has no second
    field for a second weekend -- so this list says which weekends the
    household was at and says nothing about where it slept in each. Repeating
    the year's cabin against every entry is the fan-out that manufactured 12
    of 17 false multi-family occupancies in the phase-C shareability analysis.

    `start_date` is the raw PocketBase string, exactly as
    `WeekendSessionSummary` publishes it -- the client already reads that
    shape, and the server's only use for it here is the ordering it has
    already applied.
    """

    session_cm_id: int = 0
    name: str = ""
    start_date: str = ""


class HouseholdJourneyYear(BaseModel):
    """One year of a household's family-camp record.

    Members are the party AS IT WAS THAT YEAR and are never carried forward
    from an adjacent one -- children age out and adults change, so a household
    is not a fixed set of people (kindred#2073).
    """

    year: int = 0
    housing: HousingState = "unknown"
    # The unit's name TODAY (kindred#2332), whichever year the row is.
    #
    # Owner ruling 2026-08-18: a prior year's housing renders in the current
    # language, because staff recognise the cabin they use now -- a 2022 row
    # displaying a name nobody has used since 2023 is a lookup task, not
    # information. Renames are routine: fourteen of the 118 units were renamed
    # one at a time in the admin GUI on 2026-08-15, inside two minutes.
    #
    # `HousingNameResolver.display_name` resolves it at THIS ROW'S OWN YEAR --
    # the alias window says which raw string was in use when, which is what
    # finds the unit; the unit's present-day `lodging_units.name` is what names
    # it. Falls back to the raw string unchanged when nothing resolves.
    cabin_name: str = ""
    # What staff actually typed that season, verbatim -- provenance, not a
    # name. Equal to `cabin_name` whenever nothing resolved, and "" whenever
    # `cabin_name` is. The client shows it only where the two DISAGREE, which
    # is 716 of 1,861 rows on the production snapshot: rendering it beside an
    # identical name would be noise on the other 1,145.
    cabin_name_raw: str = ""
    # WHICH FAMILY WEEKENDS the household attended that year, earliest first
    # (kindred#2393). Derived from the attendee rows this row's members
    # already come from, so it costs no extra round trip -- the journey's
    # attendee read has expanded `session` since kindred#2420.
    #
    # Empty for a year with no enrolled child (2020's cancelled season, 2021's
    # adults-only rows) and for the pre-kindred#2420 payload shape where the
    # relation did not expand. Empty is "no weekend is knowable", never "the
    # household attended none".
    sessions: list[HouseholdJourneySession] = Field(default_factory=list)
    # Which weekend `cabin_name` belongs to -- and `None` whenever that cannot
    # be said, which is the whole point of the field.
    #
    # ⚠️ DELIBERATELY THE SAME REFUSAL the Go ingest makes. `AttributeSession`
    # (`pocketbase/sync/lodging_session_attribution.go:327`) pins the year's
    # single cabin string to a weekend only when the household attended
    # exactly one and otherwise declines, because CampMinder's one per-year
    # value cannot say which weekend it describes. A read surface that guessed
    # where the ingest refuses would put the two into disagreement about the
    # same fact.
    #
    # `None` therefore covers three different situations and the client words
    # none of them: several weekends (41 of the 1,861 cabin-bearing
    # household-years on the production snapshot), no weekend on file (158),
    # and no cabin to attribute in the first place.
    housing_session_cm_id: int | None = None
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
    extend this, and the reason is the WORD `REQUIRED` rather than the word
    `scenario`: inheriting from here is what left that endpoint uncallable and
    its table empty (1500000135), because `min_length=1` demanded a dimension
    nothing could supply. Since PR 4 of kindred#2382 that request DOES carry a
    scenario -- optional, blank meaning the live board -- steering the
    occupancy half alone. The staff<->family role it also writes is still a
    fact about the weekend rather than about the plan, which is why
    `lodging_availability` has no scenario column to inherit one into.

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
    """Write somebody into one unit for one weekend, or release one to families.

    Deliberately NOT a `ScenarioWriteRequest`, and that is the change that
    makes this endpoint callable at all: `scenario` there is required with
    `min_length=1`, so the request asked for a dimension nothing could supply.
    `scenario` below is OPTIONAL instead -- the shape `SlotMergeRequest`
    already uses, and for a related reason: blank is a real scope, not a
    missing value.

    ONE REQUEST, TWO GRAINS, split down the middle of `family_available` since
    kindred#2382. `true` is the staff<->family ROLE for the weekend and is
    stored in `lodging_availability`, which carries no scenario at all
    (1500000135, and the owner's ruling that a role change is "a known 'were
    moving staff to X for weekend Y'"). `false` is an OCCUPANCY and IS
    scenario-scoped, because not every write-in is non-rostered staff: some are
    paper registrations for families arriving with no children, which is a
    modelling choice belonging to the plan that made it.

    So `scenario` steers the OCCUPANCY half and nothing else. `set_availability`
    ignores it for a release, deliberately, rather than refusing one from inside
    a scenario -- a release is still a weekend fact whoever is looking at it.

    `family_available: null` CLEARS the override by deleting the row, which is
    how "whatever this unit's role says" is spelled. Writing a value that
    happens to agree with the role would pin the unit against a later change
    to that role.
    """

    year: int = Field(..., ge=2000, le=2100)
    session_cm_id: int = Field(..., gt=0)
    # WHICH OCCUPANCY GRAIN this write lands on (kindred#2382, PR 4). Blank is
    # the LIVE board -- a scope in its own right rather than the absence of one
    # (owner, 2026-08-15: staff evaluate the real board, so a write-in has to
    # be recordable there and not only inside a modelling sandbox) -- and a
    # scenario id is that scenario's own draft write-in.
    #
    # OPTIONAL and blank-defaulted, mirroring `SlotMergeRequest`. Required
    # would re-break the endpoint the way `ScenarioWriteRequest` did, and would
    # leave the live board with no write path.
    #
    # THE ROLE HALF IGNORES IT. `lodging_availability` has no scenario column
    # and is not getting one; see the class docstring.
    scenario: str = Field(default="", description="saved_scenarios record id; blank is the live board")
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
    # HOW MANY PEOPLE the write-in is for (kindred#2503). OPTIONAL, here and at
    # the control alike -- unlike `occupant_name` above, which is permissive
    # here only because an ingest has no author to ask.
    #
    # Owner ruling 2026-08-21: most write-ins are non-rostered staff and staff
    # will type nothing, so `None` is the COMMON answer and means the cabin is
    # taken wholesale -- the em dash the card has always drawn, and the right
    # outcome for a staff cabin nobody is counting beds against. The rarer
    # paper registrations are what a number is for. Do not tighten this to
    # required, and do not treat the None branch downstream as legacy.
    #
    # `ge=1` mirrors the column's `min: 1`. Zero is not "a write-in for
    # nobody"; absence of a count is spelled `None`.
    #
    # THE OCCUPANCY HALF ONLY. A release (`family_available: true`) is the
    # staff<->family role for the weekend, stored in `lodging_availability`,
    # and names no occupant -- `set_availability` must not put a count on it.
    party_size: int | None = Field(None, ge=1)


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
