/**
 * Centralized session_type business logic.
 *
 * All session_type semantics belong here. Never write inline `session_type ===
 * 'ag'` checks in components or other utils — import a named predicate instead.
 *
 * Typed sets are exported as `as const` arrays so callers can use them for
 * PocketBase filter construction (via `createInclusionFilter`) or React key
 * mapping without re-spelling the literals.
 *
 * Exhaustiveness: `SESSION_TYPE_LITERALS` lists every known `session_type`
 * value from the PocketBase schema. The TypeScript compiler will error if
 * `assertNeverSessionType` is called with a value not covered by a predicate
 * branch, catching schema additions at compile time.
 */

import type { Session } from '../types/app-types'

// ============================================================================
// Typed sets
// ============================================================================

/** At-camp session types: shown on Day1/Forecast/Metrics "At Camp" views */
export const AT_CAMP_TYPES = ['main', 'embedded', 'ag'] as const

/** Session types shown in the /campers picker dropdown (AG is grouped with parent, never standalone) */
export const DROPDOWN_TYPES = ['main', 'embedded', 'quest'] as const

/** All summer-camp session types — cabin assignment workflow applies */
export const SUMMER_CAMP_TYPES = ['main', 'embedded', 'ag', 'quest'] as const

/** Teen program session types */
export const TEEN_PROGRAM_TYPES = ['tli', 'teen'] as const

/**
 * Every known session_type literal from the PocketBase CampSessionsSessionTypeOptions enum.
 * Used for exhaustiveness checks — if a new type is added to the schema, update this list
 * AND add a predicate (or an explicit `else` branch) so the type system catches gaps.
 *
 * Note: 'taste' is NOT a session_type value — it's a name-match pattern used in
 * session display logic. Do not add it here.
 */
export const SESSION_TYPE_LITERALS = [
  'main',
  'embedded',
  'ag',
  'family',
  'quest',
  'training',
  'bmitzvah',
  'tli',
  'adult',
  'school',
  'hebrew',
  'teen',
  'other',
] as const

export type SessionTypeLiteral = (typeof SESSION_TYPE_LITERALS)[number]

/**
 * Exhaustiveness helper — call this in the default branch of a switch/if-else
 * chain over session_type. TypeScript will error at compile time if any
 * `SessionTypeLiteral` value is not handled before this call.
 */
export function assertNeverSessionType(x: never): never {
  throw new Error(`Unhandled session_type: ${String(x)}`)
}

// ============================================================================
// Session-object predicates (accept a Session or session-shaped object)
// ============================================================================

/** Minimal shape: anything with a `session_type` field. */
export interface SessionLike {
  session_type?: string | null
}

/** Session shape with a `parent_id` — needed for AG parent/child relationships. */
export interface SessionChildLike extends SessionLike {
  parent_id?: number | null
}

/** Session shape with a `cm_id` — used as the parent in AG parent/child checks. */
export interface SessionParentLike {
  cm_id: number
}

/** True for main, embedded, ag — the "at camp" sessions on Day1/Forecast/Metrics */
export function isAtCampSession(session: SessionLike): boolean {
  return AT_CAMP_TYPES.includes(session.session_type as (typeof AT_CAMP_TYPES)[number])
}

/** True for quest sessions only */
export function isQuestSession(session: SessionLike): boolean {
  return session.session_type === 'quest'
}

/**
 * True for sessions that appear in the /campers picker dropdown:
 * main, embedded, quest. AG is excluded (grouped with parent main).
 */
export function isInDropdown(session: SessionLike): boolean {
  return DROPDOWN_TYPES.includes(session.session_type as (typeof DROPDOWN_TYPES)[number])
}

/** True for summer-camp sessions: main, embedded, ag, quest */
export function isSummerCampSession(session: SessionLike): boolean {
  return SUMMER_CAMP_TYPES.includes(session.session_type as (typeof SUMMER_CAMP_TYPES)[number])
}

/** True for teen programs: tli, teen */
export function isTeenProgram(session: SessionLike): boolean {
  return TEEN_PROGRAM_TYPES.includes(session.session_type as (typeof TEEN_PROGRAM_TYPES)[number])
}

/** True for embedded sessions only */
export function isEmbeddedSession(session: SessionLike): boolean {
  return session.session_type === 'embedded'
}

/** True for main sessions only */
export function isMainSession(session: SessionLike): boolean {
  return session.session_type === 'main'
}

/** True for ag sessions only */
export function isAgSession(session: SessionLike): boolean {
  return session.session_type === 'ag'
}

/** True for main or embedded sessions — the "core camp" pair used in some filter contexts */
export function isMainOrEmbedded(session: SessionLike): boolean {
  return session.session_type === 'main' || session.session_type === 'embedded'
}

/**
 * True when `child` is an AG session that belongs to `parent`.
 * Matches on `child.parent_id === parent.cm_id` AND `child.session_type === 'ag'`.
 */
export function isAgChildOf(child: SessionChildLike, parent: SessionParentLike): boolean {
  return child.session_type === 'ag' && child.parent_id === parent.cm_id
}

// ============================================================================
// Raw string predicates (operate on a session_type string directly)
// Useful when the full Session object is not available, e.g. in sort callbacks
// that only have the session_type value.
// ============================================================================

/** True if the session_type string is an at-camp type (main | embedded | ag) */
export function isAtCampSessionType(sessionType: string | null | undefined): boolean {
  return AT_CAMP_TYPES.includes(sessionType as (typeof AT_CAMP_TYPES)[number])
}

/** True if the session_type string is "quest" */
export function isQuestSessionType(sessionType: string | null | undefined): boolean {
  return sessionType === 'quest'
}

/** True if the session_type string is in the dropdown (main | embedded | quest) */
export function isInDropdownType(sessionType: string | null | undefined): boolean {
  return DROPDOWN_TYPES.includes(sessionType as (typeof DROPDOWN_TYPES)[number])
}

/** True if the session_type string is a summer-camp type (main | embedded | ag | quest) */
export function isSummerCampSessionType(sessionType: string | null | undefined): boolean {
  return SUMMER_CAMP_TYPES.includes(sessionType as (typeof SUMMER_CAMP_TYPES)[number])
}

/** True if the session_type string is a teen program (tli | teen) */
export function isTeenProgramType(sessionType: string | null | undefined): boolean {
  return TEEN_PROGRAM_TYPES.includes(sessionType as (typeof TEEN_PROGRAM_TYPES)[number])
}

// ============================================================================
// Re-export Session type for convenience (consumers can import from one place)
// ============================================================================
export type { Session }
