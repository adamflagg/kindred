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
