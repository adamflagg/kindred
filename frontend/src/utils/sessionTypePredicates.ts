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

/** Quest session types only — narrow set used by metrics view-mode toggles */
export const QUEST_SESSION_TYPES = ['quest'] as const

/** Teen program session types */
export const TEEN_PROGRAM_TYPES = ['scit', 'tli'] as const

/** Curated set shown in a camper's journey timeline: summer + teen + family. */
export const CAMPER_JOURNEY_TYPES = [
  'main',
  'embedded',
  'ag',
  'quest',
  'scit',
  'tli',
  'family',
] as const

/** Curated set driving a camper detail page's current-year fetch: summer + teen, no family. */
export const CAMPER_DETAIL_TYPES = ['main', 'embedded', 'ag', 'quest', 'scit', 'tli'] as const

/** View mode for metrics: camp sessions, quest sessions, all combined, or teens */
export type MetricsViewMode = 'sessions' | 'quests' | 'all' | 'teens'

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
  'scit',
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

/** True for teen programs: scit, tli */
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

/** True if the session_type string is a teen program (scit | tli) */
export function isTeenProgramType(sessionType: string | null | undefined): boolean {
  return TEEN_PROGRAM_TYPES.includes(sessionType as (typeof TEEN_PROGRAM_TYPES)[number])
}

// ============================================================================
// PocketBase filter builders
// ============================================================================

/**
 * Build a PocketBase OR-clause restricting `session.session_type` to valid
 * summer types (main/embedded/ag/quest). Use when querying collections
 * expanded through a session relation (attendees, bunk_assignments,
 * bunk_requests). Callers should wrap the result in `(...)` when combining
 * with `&&` clauses.
 */
export function buildSummerSessionTypeFilter(): string {
  return SUMMER_CAMP_TYPES.map((t) => `session.session_type = "${t}"`).join(' || ')
}

/**
 * Build a PocketBase OR-clause restricting `session.session_type` to the camper
 * journey set (summer + teen + family). Caller wraps the result in `(...)`.
 */
export function buildCamperJourneySessionTypeFilter(): string {
  return CAMPER_JOURNEY_TYPES.map((t) => `session.session_type = "${t}"`).join(' || ')
}

/**
 * Build a PocketBase OR-clause restricting `session.session_type` to the camper
 * detail-page current-year set (summer + teen, no family). Caller wraps in `(...)`.
 */
export function buildCamperDetailSessionTypeFilter(): string {
  return CAMPER_DETAIL_TYPES.map((t) => `session.session_type = "${t}"`).join(' || ')
}

// ============================================================================
// Summer-teen window helpers (mirror api/utils/session_metrics.py)
// ============================================================================

/** Min main start / max main end (YYYY-MM-DD), or null. Mirrors get_summer_window(). */
export function getSummerWindow(
  sessions: Array<{ session_type?: string | null; start_date: string; end_date: string }>
): [string, string] | null {
  const starts: string[] = []
  const ends: string[] = []
  for (const s of sessions) {
    if (s.session_type !== 'main') continue
    if (s.start_date && s.end_date) {
      starts.push(s.start_date.slice(0, 10))
      ends.push(s.end_date.slice(0, 10))
    }
  }
  if (!starts.length || !ends.length) return null
  return [starts.reduce((a, b) => (a < b ? a : b)), ends.reduce((a, b) => (a > b ? a : b))]
}

/** True iff a scit/tli session overlaps the summer window. Mirrors is_summer_teen_session(). */
export function isSummerTeenSession(
  session: { session_type?: string | null; start_date?: string; end_date?: string },
  window: [string, string] | null
): boolean {
  if (!TEEN_PROGRAM_TYPES.includes(session.session_type as (typeof TEEN_PROGRAM_TYPES)[number]))
    return false
  if (!window || !session.start_date || !session.end_date) return false
  const [winStart, winEnd] = window
  return session.start_date.slice(0, 10) <= winEnd && session.end_date.slice(0, 10) >= winStart
}

// ============================================================================
// Re-export Session type for convenience (consumers can import from one place)
// ============================================================================
export type { Session }
