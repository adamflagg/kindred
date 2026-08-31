/**
 * Weekend lodging types.
 *
 * Friendly aliases over the generated FastAPI response types. Import these
 * rather than reaching into `api-generated/` directly, matching the
 * convention in `types/api-types.ts`.
 *
 * The union members below are DERIVED from the generated types rather than
 * hand-written. The share vocabulary is Go's, end to end
 * (`no_share | maybe_mutual | yes_share`, empty -> `unknown`), and a
 * hand-written copy is exactly how a surface drifts from the wire contract.
 * `NonNullable<...>` here means a change to the Pydantic Literal becomes a
 * type error at the read sites instead of a silently unreachable branch.
 *
 * GOTCHA: Pydantic fields with a default render as OPTIONAL in TypeScript
 * (`parties_total: int = 0` -> `parties_total?: number`). The server always
 * populates them; read sites still need `?? 0`.
 */

import type {
  AccessibilityFlagSummary,
  ComparePartyReport,
  HouseholdJourneyResponse,
  HouseholdJourneySession,
  HouseholdJourneyYear,
  HouseholdMedicalResponse,
  LodgingUnitSummary,
  LodgingWriteResponse,
  PartyAdult,
  PartyChild,
  RequestTextBlock,
  RequestTextEntry,
  RosterCounts,
  RosterParty,
  ScenarioCompareCounts,
  ScenarioCompareResponse,
  ShareRequestSummary,
  WeekendRosterResponse,
  WeekendSessionListResponse,
  WeekendSessionSummary,
  WeekendSummaryEntry,
  WeekendSummaryResponse,
  WriteInCover,
} from './api-generated'
import type { BedInventory } from './beds'

// ── API response aliases ──────────────────────────────────────────────────────

/** Full per-weekend roster payload from GET /api/lodging/roster. */
export type WeekendRoster = WeekendRosterResponse
/** GET /api/lodging/sessions payload. */
export type WeekendSessionList = WeekendSessionListResponse
/** One family or adult weekend. */
export type WeekendSession = WeekendSessionSummary
/** One placeable party — a household (family camp) or a person (adult weekend). */
export type RosterPartyRow = RosterParty
/** The honest-counts block. */
export type RosterCountSummary = RosterCounts
/**
 * A scenario against the CampMinder mirror, for one family-camp weekend
 * (kindred#2478 §5). REPORT-ONLY — there is no digest to echo and no decision
 * handle, because half the verdicts could not be actioned even if there were
 * (see `api/services/lodging_compare_service.py`).
 */
export type ScenarioCompare = ScenarioCompareResponse
/**
 * The overview: FIVE numbers over four verdicts. `match` is
 * placed-identically ONLY — `both_unassigned` is the other half of the same
 * verdict, split out because agreement on a cabin and agreement that nobody
 * has one yet are two different kinds of agreement (§5.4). Summing them back
 * together undoes the ruling.
 */
export type ScenarioCompareCountSummary = ScenarioCompareCounts
/**
 * One enrolled family's verdict. Carries `grain` + BOTH ids + `display_name`
 * and no key of its own, deliberately: `partyKey()` is the one definition of
 * party identity on this side, and it reads this row exactly as it reads a
 * roster row.
 */
export type CompareParty = ComparePartyReport
/** One row of the lodging registry as the roster sees it. */
export type LodgingUnitRow = LodgingUnitSummary
/**
 * The write-in covering a unit's space, resolved through the tree by the
 * server. Read it through `writeInEntries`/`hasWriteIn`, never inline: the
 * point of naming the fact once is that the board's five consumers cannot
 * drift onto different spellings of it.
 */
export type WriteInCoverRow = WriteInCover
/** A household's cabin-sharing request, unresolved. */
export type ShareRequest = ShareRequestSummary
/**
 * Every answer a household gave in ONE free-text source field (kindred#2330).
 *
 * `source_field` is the CampMinder field name VERBATIM, `COVID-19 Bunking
 * Requests` and `Shared-request` included — it is an identity the ingest,
 * `REQUEST_TEXT_SOURCES` and the staff-notes permission gate all key on, so it
 * is never a caption. Three of the six now DISPLAY under a different name
 * after the owner's 2026-08-17 review; that mapping lives only in
 * `ShareRequestPanel`'s `DISPLAY_LABELS` and never reaches the wire.
 */
export type RequestTextBlockRow = RequestTextBlock
/** One distinct answer inside a block, with the child or children who wrote it. */
export type RequestTextEntryRow = RequestTextEntry
/** Derived accessibility booleans. Never narrative text. */
export type AccessibilityFlags = AccessibilityFlagSummary
/** Every weekend in a year with its counts — the lander's single read. */
export type WeekendSummary = WeekendSummaryResponse
/** One weekend on the lander: identity plus the same counts the roster reports. */
export type WeekendSummaryRow = WeekendSummaryEntry
/** The medical narrative. Only ever fetched from the endpoint gated on `bunking.manage`. */
export type HouseholdMedical = HouseholdMedicalResponse
/** A household's year-over-year family-camp record, newest year first. */
export type HouseholdJourney = HouseholdJourneyResponse
/** One year of it — housing, enrollment, the weekends, and that year's own party. */
export type HouseholdJourneyRow = HouseholdJourneyYear
/**
 * One family weekend a household attended in a year (kindred#2393).
 *
 * THE WEEKEND, NOT THE HOUSING. A year holds exactly one cabin string, so this
 * says which weekends the household was at and nothing about where it slept in
 * each — repeating the cabin against every entry is the fan-out that
 * manufactured 12 of 17 false multi-family occupancies in the phase-C
 * shareability analysis.
 */
export type HouseholdJourneySessionRow = HouseholdJourneySession
/** A registered adult on a household party. */
export type PartyAdultRow = PartyAdult
/** An enrolled child on a household party. */
export type PartyChildRow = PartyChild
/**
 * What a lodging write did.
 *
 * `deleted` is not decoration: clearing an availability override is spelled as
 * the ABSENCE of a row, so a cleared override and a written one are the same
 * 200 and differ only here.
 */
export type LodgingWriteResult = LodgingWriteResponse

// ── Derived unions ────────────────────────────────────────────────────────────

/**
 * The share-preference chip's states.
 *
 * `unknown` means NOT ANSWERED. It must never render as consent, and it is
 * not a fourth degree of willingness — it is the absence of an answer.
 */
export type SharePreferenceValue = NonNullable<ShareRequestSummary['preference']>

/**
 * Proximity modes.
 *
 * `similar_ages` ACCOMPANIES `with`; it never replaces it. It is the
 * "share with a family with similarly-aged kids" option, where what differs
 * from a plain WITH is only that the partner is unnamed — which is what
 * makes those households the staff-matchable pool. Rendering one *or* the
 * other drops them out of any "wants to share" view.
 */
export type ProximityKindValue = NonNullable<ShareRequestSummary['proximity']>[number]

/**
 * The RESOLVED verdict the board places on — not the same question as
 * `SharePreferenceValue`, which is the registration answer alone.
 *
 * Share intent lives in two CampMinder fields asked at different times, and
 * staff treat the later Family Camp information form as authoritative. The Go
 * ingest resolves them; this is the result.
 *
 * `unknown` means silent on BOTH forms. It places as no-share, but it is a
 * different fact from `declined` and must never be rendered as one — saying
 * "this family said no" about a family that answered nothing is a statement
 * staff cannot defend to that family.
 */
export type ShareEligibilityValue = NonNullable<ShareRequestSummary['eligibility']>

/**
 * Which form produced the eligibility.
 *
 * `registration` means the authoritative form's share question was unanswered
 * and the verdict fell back to the registration gate, so it is PROVISIONAL.
 * Roughly half of returned forms skip that question, so this is the common
 * case, not an edge one.
 */
export type ShareEligibilitySourceValue = NonNullable<ShareRequestSummary['eligibility_source']>

/**
 * The STAFF-OWNED weekend status (kindred#2092).
 *
 * The one vocabulary on this surface that mirrors no Go ingest, because there
 * is no ingest: CampMinder's Sessions API carries no status concept at all, so
 * a cancelled weekend cannot be derived from synced data and nothing in the
 * sync layer writes or clears it.
 *
 * The field is OPTIONAL on the wire (Pydantic default `"active"`), and absence
 * of a status ROW is what "active" means — the migration seeds nothing. So
 * undefined, `"active"` and no row are all the same answer, and only
 * `"cancelled"` is a claim.
 */
export type WeekendSessionStatusValue = NonNullable<WeekendSessionSummary['status']>

/**
 * What is known about where a household slept in one journey year.
 *
 * THREE STATES, NOT TWO. `unknown` is a gap in the RECORD — 2017-2021 carry
 * 1,433 family registrations and not one cabin assignment, so nothing can be
 * said about any household in those years. `not_placed` is a gap in this
 * family's placement, in a year that demonstrably recorded cabins for other
 * households. Rendering them alike is the defect the vocabulary exists to
 * prevent: one is a to-do and the other is not.
 */
export type HousingStateValue = NonNullable<HouseholdJourneyYear['housing']>

/** `unknown` means the amenity was never recorded, NOT "no bathroom". */
export type BathroomValue = NonNullable<LodgingUnitSummary['bathroom']>

/** Family camp enrols children (household grain); adult weekends enrol people. */
export type PartyGrain = RosterParty['grain']

// ── PocketBase record types (admin CRUD) ──────────────────────────────────────
//
// These describe rows as PocketBase STORES them, which is not the same shape
// the read API returns. The admin surface writes through the JS SDK directly
// (all lodging collections gate create/update/delete on
// `@request.auth.is_admin = true`), so a payload has to satisfy the raw column
// definitions, not the Pydantic response models.
//
// PocketBase never stores null in a non-relation column: an unset number is 0,
// an unset bool is false, an unset text or select is ''. That is why `sleeps: 0`
// means UNKNOWN here while the API renders the same cell as `null`.

interface PocketBaseRecordBase {
  id: string
  created?: string
  updated?: string
  collectionId?: string
  collectionName?: string
}

/**
 * The bathroom values PocketBase will ACCEPT, which differ from the ones the
 * API emits.
 *
 * The read API maps the empty column to the string `'unknown'` (see
 * `BathroomValue` above, derived from the generated types). That token exists
 * only on the wire — it is not in the select's option list, so writing it back
 * fails validation. An unrecorded bathroom is stored as `''`.
 */
export type BathroomStoredValue = 'none' | 'private' | 'shared' | ''

/**
 * Whether a unit is family pool or permanent staff housing.
 *
 * A ROLE, not a default. Called `AllocationDefaultValue` until 1500000136:
 * "default" implied an override, and the override is a rare per-weekend
 * exception rather than the point — the value says whether a unit is planning
 * inventory at all.
 *
 * `''` is storable but not meaningful — it matches neither branch of the
 * availability rules, which is why `LodgingUnitInput` excludes it.
 */
export type InventoryClassValue = 'family_pool' | 'staff_default'

/**
 * The STORED shareability vocabulary — may more than one party sleep here at
 * once (1500000145, kindred#2026).
 *
 * `''` is a real third state and the reason this is a select rather than a
 * bool: nobody has classified the unit. It is neither permission to
 * double-book nor a ruling that one family only may go here, and the admin
 * form must be able to leave it unanswered.
 *
 * NOT the same vocabulary the READ api uses: `LodgingUnitRow.shareability`
 * renders `''` as the token `unknown`, exactly as `bathroom` does, and writing
 * that token back would fail the select's validation.
 */
export type ShareabilityStoredValue = 'shareable' | 'single_party' | ''

/** A named zone of the site. */
export interface LodgingAreaRecord extends PocketBaseRecordBase {
  name: string
  code: string
  map_x: number
  map_y: number
  sort_order: number
}

/** One row of lodging_units. */
export interface LodgingUnitRecord extends PocketBaseRecordBase {
  area: string
  name: string
  code: string
  parent_unit: string
  map_x: number
  map_y: number
  /** 0 means UNKNOWN — PocketBase stores an unset number as 0, never null. */
  sleeps: number
  /**
   * Bed inventory. Detail behind `sleeps`, never a replacement for it —
   * `sleeps` is what the roster and the capacity counts read. May be absent
   * or null on a row written before migration 1500000128, so always read it
   * through `normaliseBeds`.
   */
  beds: BedInventory | null
  bathroom: BathroomStoredValue
  bathroom_group: string
  near_bathhouse: boolean
  has_power: boolean
  has_ac: boolean
  has_fridge: boolean
  is_accessible: boolean
  // The ORIGINAL 2026 inventory migration's fields (1500000131) — the first
  // amenity columns the registry ever carried, six migrations before the
  // Master Housing sheet fields below. Populated by the registry import from
  // day one, but with no editing surface anywhere in the app until
  // `unitAmenities.ts`'s `AMENITY_FLAGS` grew to cover them.
  is_weatherized: boolean
  has_plumbing: boolean
  has_space_heater: boolean
  has_lights: boolean
  has_heat: boolean
  has_pack_play_space: boolean
  has_kitchen: boolean
  has_living_room: boolean
  // From the 2026 Master Housing sheet. Each refines a field above rather than
  // restating it: has_tub under `bathroom`, has_shared_fridge under
  // has_fridge. has_crib is distinct from has_pack_play_space — a camp crib is
  // not floor space for a family's own. has_kitchenette (narrowing
  // has_kitchen) was dropped in kindred#2390: 0 production rows disagreed
  // with their parent.
  has_tub: boolean
  has_crib: boolean
  has_changing_table: boolean
  has_shared_fridge: boolean
  inventory_class: InventoryClassValue | ''
  /**
   * Whether more than one party may sleep here at once.
   *
   * Distinct from a HOUSEHOLD's willingness to share (`share_eligibility` on
   * the party rows): both have to be true before two parties may be put in one
   * space, and this is the half that had no column until kindred#2026.
   */
  shareability: ShareabilityStoredValue
  /**
   * Whether staff have walked this cabin THIS season (kindred#2500).
   *
   * ⚠️ IT GATES NO VERDICT (kindred#2526). It used to: the roster judged a
   * household's need only against a confirmed cabin, and an unconfirmed
   * `has_power: false` read as "nobody has said". It no longer does — every
   * placed cabin is graded at FACE VALUE, so `has_power: false` means there is
   * no power, confirmed or not.
   *
   * What it drives now is the staff WORK-DOWN LIST — which cabins still need
   * walking this season. That is the `Reconfirm space` mark, the admin
   * `Unconfirmed` badge and sort, and `units_unconfirmed`. Nothing else reads
   * it.
   */
  is_confirmed: boolean
  is_active: boolean
  /**
   * A building/grouping row: never bookable in its own right. It is NOT
   * "never counted" — a container drawn combined (`default_combined` below,
   * resolved through the override tiers) is the one card the board draws for
   * its branch and the one space the counts see, at its own measured
   * `sleeps`. `drawnUnits` in `components/weekend/unitLevel.ts` is the single
   * answer to which units that is; never filter on `is_container` alone.
   */
  is_container: boolean
  /**
   * Draw this container as ONE card and stop descending. Meaningful on
   * containers only. False — PocketBase's value for an unset bool — means
   * "draw the children", which is the pre-feature behaviour.
   */
  default_combined: boolean
  notes: string
  expand?: { area?: LodgingAreaRecord; parent_unit?: LodgingUnitRecord }
}

/** A historical free-text cabin string mapped onto units, with a year window. */
export interface LodgingAliasRecord extends PocketBaseRecordBase {
  alias_string: string
  /** 1 member = an atomic room; 2+ members = a merge. Required, maxSelect 20. */
  member_units: string[]
  valid_from_year: number
  valid_to_year: number
  source_field: string
  notes: string
  expand?: { member_units?: LodgingUnitRecord[] }
}

/** The eight things the ingest can fail to do with a row. */
export type IngestIssueKind =
  | 'unresolved_alias'
  | 'ambiguous_alias'
  | 'ambiguous_session'
  | 'no_session'
  | 'field_zero_values'
  | 'unknown_party'
  | 'write_failed'

/**
 * One row of the ingest work queue.
 *
 * This is `lodging_ingest_issues`, the ONE work-queue collection — there is no
 * `lodging_unresolved_aliases`. The ingest is its sole producer; the admin
 * surface only reads and resolves, and resolving is `is_resolved` plus either
 * `resolved_alias` (mapped) or `resolution_note` alone (ignored). There is no
 * `status` select.
 */
export interface LodgingIngestIssueRecord extends PocketBaseRecordBase {
  kind: IngestIssueKind
  /** The free-text cabin string the ingest could not resolve. */
  raw_value: string
  source_field: string
  year: number
  household_cm_id: number
  person_cm_id: number
  suggested_session: string
  candidate_session_cm_ids: number[]
  /**
   * The weekend a human picked for a party CampMinder cannot place itself.
   *
   * CampMinder holds ONE cabin value per household per year and cannot say
   * which weekend it describes, so a household booked on two weekends has no
   * key for `lodging_assignments` and the sync writes no row at all — on the
   * board that reads as unassigned, because "unassigned" is row-ABSENT rather
   * than a blank column.
   *
   * A CampMinder session id, not a PocketBase relation like `suggested_session`
   * beside it: this one is compared against `candidate_session_cm_ids` above
   * and against `lodging_assignments.session_cm_id`, both of which are
   * CampMinder ids. `0` means unconfirmed.
   *
   * Confirming is the ordinary resolve affordance — PATCH this alongside
   * `is_resolved: true`, the same shape `ignoreIngestIssue` uses. The
   * `replayOnResolve` hook fires on the false → true transition and the
   * placement is written by the sync's own transform path; nothing is ever
   * written back to CampMinder (ruling kindred#1968).
   *
   * SET IT ONLY TO ONE OF `candidate_session_cm_ids`. The backend resolves it
   * against the party's candidate weekends and refuses a miss, leaving the row
   * unplaced and re-opening it — so a picker offering anything else can only
   * produce a tick that silently undoes itself.
   */
  confirmed_session_cm_id: number
  occurrences: number
  /** Set when the row was resolved by mapping it to a real alias. */
  resolved_alias: string
  first_seen: string
  last_seen: string
  is_resolved: boolean
  resolution_note: string
}

// ── Write payloads ────────────────────────────────────────────────────────────

/**
 * `year` is bolted on rather than added to `LodgingAreaRecord` and picked:
 * areas became year-scoped in 1500000141, but nothing in this surface reads
 * an area's year back off a fetched record yet, so widening the read type
 * would force `year` onto every area fixture in the tree for no consumer.
 * The write side genuinely needs it — a create with no `year` fails the
 * schema's `min: 2010` the moment a second season exists.
 */
export type LodgingAreaInput = Pick<
  LodgingAreaRecord,
  'name' | 'code' | 'map_x' | 'map_y' | 'sort_order'
> & { year: number }

/**
 * Unit create/update payload.
 *
 * `is_active` and `inventory_class` are REQUIRED here on purpose.
 * PocketBase has no per-field default for bool or select, and `required: true`
 * on a bool means "must be true", so neither can be marked required in the
 * schema. A create that omits them yields `is_active = false,
 * inventory_class = ''` — a unit invisible to every list query that also
 * matches neither branch of the availability rules. Making them non-optional
 * here means the compiler catches the omission instead of the database
 * swallowing it.
 *
 * `year` joins them for the same reason, since 1500000141: a create that
 * omits it fails the schema's `min: 2010` (PocketBase writes an omitted
 * number as 0), and unlike `is_active` / `inventory_class` that failure is
 * loud rather than silent -- but it is still a create nobody can complete
 * until they work out why. `LodgingUnitForm` always supplies it from the
 * panel's current season, whether creating or editing.
 */
export interface LodgingUnitInput {
  area: string
  name: string
  code: string
  is_active: boolean
  inventory_class: InventoryClassValue
  year: number
  /**
   * REQUIRED, and always sent, for the same reason as `is_active` and
   * `inventory_class` above — but note the reason is different in one respect:
   * `''` is a genuinely meaningful value here (unclassified), not a broken
   * one. What makes omission wrong is the EDIT path. Leaving the key out would
   * leave the previous classification in place, so a staffer clearing the
   * field back to "Not classified" would get a silent no-op they believe
   * worked. `LodgingUnitForm` holds it in its own state and always supplies
   * it; making it non-optional here is what keeps a second write path from
   * quietly dropping it.
   */
  shareability: ShareabilityStoredValue
  parent_unit?: string
  map_x?: number
  map_y?: number
  sleeps?: number
  beds?: BedInventory
  bathroom?: BathroomStoredValue
  bathroom_group?: string
  near_bathhouse?: boolean
  has_power?: boolean
  has_ac?: boolean
  has_fridge?: boolean
  is_accessible?: boolean
  is_weatherized?: boolean
  has_plumbing?: boolean
  has_space_heater?: boolean
  has_lights?: boolean
  has_heat?: boolean
  has_pack_play_space?: boolean
  has_kitchen?: boolean
  has_living_room?: boolean
  has_tub?: boolean
  has_crib?: boolean
  has_changing_table?: boolean
  has_shared_fridge?: boolean
  is_confirmed?: boolean
  is_container?: boolean
  default_combined?: boolean
  notes?: string
}

export interface LodgingAliasInput {
  alias_string: string
  member_units: string[]
  valid_from_year?: number
  valid_to_year?: number
  source_field?: string
  notes?: string
}
