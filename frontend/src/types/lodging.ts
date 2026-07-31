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
  HouseholdMedicalResponse,
  LodgingUnitSummary,
  PartyAdult,
  PartyChild,
  RosterCounts,
  RosterParty,
  ShareRequestSummary,
  WeekendRosterResponse,
  WeekendSessionListResponse,
  WeekendSessionSummary,
  WeekendSummaryEntry,
  WeekendSummaryResponse,
} from './api-generated'

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
/** One row of the lodging registry as the roster sees it. */
export type LodgingUnitRow = LodgingUnitSummary
/** A household's cabin-sharing request, unresolved. */
export type ShareRequest = ShareRequestSummary
/** Derived accessibility booleans. Never narrative text. */
export type AccessibilityFlags = AccessibilityFlagSummary
/** Every weekend in a year with its counts — the lander's single read. */
export type WeekendSummary = WeekendSummaryResponse
/** One weekend on the lander: identity plus the same counts the roster reports. */
export type WeekendSummaryRow = WeekendSummaryEntry
/** PHI. Only ever fetched from the permission-gated endpoint. */
export type HouseholdMedical = HouseholdMedicalResponse
/** A registered adult on a household party. */
export type PartyAdultRow = PartyAdult
/** An enrolled child on a household party. */
export type PartyChildRow = PartyChild

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
 * Whether a unit defaults to the family pool or is held for staff.
 *
 * `''` is storable but not meaningful — it matches neither branch of the
 * availability rules, which is why `LodgingUnitInput` excludes it.
 */
export type AllocationDefaultValue = 'family_pool' | 'staff_default'

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
  bathroom: BathroomStoredValue
  bathroom_group: string
  near_bathhouse: boolean
  has_power: boolean
  has_ac: boolean
  has_fridge: boolean
  is_accessible: boolean
  allocation_default: AllocationDefaultValue | ''
  /**
   * Whether staff have actually verified this row's amenities.
   *
   * Load-bearing: the roster only judges a household's housing need against a
   * CONFIRMED cabin. On an unconfirmed row `has_power: false` means "nobody has
   * said", not "there is no power", so confirming a cabin is what switches the
   * met/unmet fit check on for it.
   */
  is_confirmed: boolean
  is_active: boolean
  /** A building/grouping row. Never bookable, never counted. */
  is_container: boolean
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

/** The seven things the ingest can fail to do with a row. */
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
  occurrences: number
  /** Set when the row was resolved by mapping it to a real alias. */
  resolved_alias: string
  first_seen: string
  last_seen: string
  is_resolved: boolean
  resolution_note: string
}

// ── Write payloads ────────────────────────────────────────────────────────────

export type LodgingAreaInput = Pick<
  LodgingAreaRecord,
  'name' | 'code' | 'map_x' | 'map_y' | 'sort_order'
>

/**
 * Unit create/update payload.
 *
 * `is_active` and `allocation_default` are REQUIRED here on purpose.
 * PocketBase has no per-field default for bool or select, and `required: true`
 * on a bool means "must be true", so neither can be marked required in the
 * schema. A create that omits them yields `is_active = false,
 * allocation_default = ''` — a unit invisible to every list query that also
 * matches neither branch of the availability rules. Making them non-optional
 * here means the compiler catches the omission instead of the database
 * swallowing it.
 */
export interface LodgingUnitInput {
  area: string
  name: string
  code: string
  is_active: boolean
  allocation_default: AllocationDefaultValue
  parent_unit?: string
  map_x?: number
  map_y?: number
  sleeps?: number
  bathroom?: BathroomStoredValue
  bathroom_group?: string
  near_bathhouse?: boolean
  has_power?: boolean
  has_ac?: boolean
  has_fridge?: boolean
  is_accessible?: boolean
  is_confirmed?: boolean
  is_container?: boolean
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
