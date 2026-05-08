/**
 * Utilities for the AllCampers view
 * - Filtering bunks to only summer camp bunks
 * - Handling session dropdown with embedded sessions as independent
 * - Session relationships for AG grouping
 */

import type { BunksResponse, BunkPlansResponse } from '../types/pocketbase-types'
import type { Session } from '../types/app-types'
import { sortSessionsByDate } from './sessionUtils'
import {
  isSummerCampSession,
  isInDropdown,
  isMainOrEmbedded,
  isQuestSession,
  isAgSession,
  isMainSession,
  isEmbeddedSession,
  isAtCampSession,
} from './sessionTypePredicates'

// Export type alias for sessions with type information
export type SessionWithType = Session

/**
 * Filter bunks to only include those linked to summer camp sessions (main, ag, embedded)
 * Excludes family camp bunks like Acorns, Azaleas, etc.
 */
export function filterSummerCampBunks(
  bunks: BunksResponse[],
  bunkPlans: BunkPlansResponse[],
  sessions: Session[]
): BunksResponse[] {
  // Create a set of session IDs that are summer camp sessions
  const summerCampSessionIds = new Set(sessions.filter(isSummerCampSession).map((s) => s.id))

  // Create a set of bunk IDs that are linked to summer camp sessions
  const summerCampBunkIds = new Set(
    bunkPlans.filter((bp) => summerCampSessionIds.has(bp.session)).map((bp) => bp.bunk)
  )

  // Filter bunks to only include those linked to summer camp sessions
  const filteredBunks = bunks.filter((b) => summerCampBunkIds.has(b.id))

  // Sort bunks by name (alphabetically, which puts AG-, B-, G- in correct order)
  return filteredBunks.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Get sessions for the dropdown in AllCampers view
 * - Includes: main, embedded, quest sessions
 * - Excludes: AG (grouped with parent), family, training, etc.
 * - Embedded and quest sessions are independent entries (not grouped with main)
 */
export function getDropdownSessions(sessions: Session[]): Session[] {
  // Filter to only dropdown-eligible session types
  const filteredSessions = sessions.filter(isInDropdown)

  // Sort using shared utility (date primary, then session number+suffix)
  return sortSessionsByDate(filteredSessions)
}

/**
 * Get session relationships for filtering campers
 * - AG sessions are grouped with their parent main session (via parent_id)
 * - Embedded sessions are independent (NOT grouped with main)
 * - Main sessions include only themselves and any AG children
 *
 * Returns a Map where:
 * - Key: session ID
 * - Value: array of session IDs that should be included when filtering by this session
 */
export function getSessionRelationshipsForCamperView(
  sessions: SessionWithType[]
): Map<string, string[]> {
  const relationships = new Map<string, string[]>()

  // Create a lookup for sessions by cm_id for finding parents
  const sessionByCmId = new Map<number, SessionWithType>()
  sessions.forEach((s) => sessionByCmId.set(s.cm_id, s))

  // Process each session
  sessions.forEach((session) => {
    if (isAgSession(session)) {
      // AG sessions don't get their own entry - they're grouped with parent
      // But we need to add them to their parent's list
      if (session.parent_id) {
        const parentSession = sessionByCmId.get(session.parent_id)
        if (parentSession) {
          const existing = relationships.get(parentSession.id) ?? [parentSession.id]
          if (!existing.includes(session.id)) {
            existing.push(session.id)
          }
          relationships.set(parentSession.id, existing)
        }
      }
    } else if (isMainSession(session)) {
      // Main sessions include only themselves initially
      // AG children will be added above
      if (!relationships.has(session.id)) {
        relationships.set(session.id, [session.id])
      }
    } else if (isEmbeddedSession(session)) {
      // Embedded sessions are independent - only include themselves
      relationships.set(session.id, [session.id])
    } else if (isQuestSession(session)) {
      // Quest sessions are independent - only include themselves
      relationships.set(session.id, [session.id])
    }
  })

  return relationships
}

// Filter values for the /campers page session scope picker.
//
// 'all'      → every dropdown session
// 'at-camp'  → main + embedded (matches dropdown contents; AG sessions are
//              grouped with their parent main session via
//              getSessionRelationshipsForCamperView, so AG campers are
//              included in the camper-filter even though AG never appears in
//              dropdownSessions itself)
// 'quests'   → quest only
//
// resolveScopedSessions returns the dropdown-level scope list for the headline
// noun. Camper-level filtering in AllCampersView walks sessionRelationships
// for AT_CAMP / QUESTS so AG inclusion comes from a single source of truth.
export const FILTER_ALL = 'all'
export const FILTER_AT_CAMP = 'at-camp'
export const FILTER_QUESTS = 'quests'

/**
 * Split an already-filtered dropdown session list into camp sessions
 * (main + embedded) and quest sessions, each sorted by date.
 *
 * Caller is responsible for passing the output of `getDropdownSessions`
 * (i.e. AG and teen sessions are already excluded).
 */
export function splitDropdownSessionsByType(sessions: Session[]): {
  campSessions: Session[]
  questSessions: Session[]
} {
  const campSessions = sortSessionsByDate(sessions.filter(isMainOrEmbedded))
  const questSessions = sortSessionsByDate(sessions.filter(isQuestSession))
  return { campSessions, questSessions }
}

/**
 * Resolve a picker filter value to a concrete list of sessions.
 *
 * - `'all'`      → `dropdownSessions` as-is.
 * - `'at-camp'`  → only main + embedded sessions (input order preserved).
 * - `'quests'`   → only quest sessions (input order preserved).
 * - any other string → treated as a session `id`; returns `[match]` or `[]`.
 */
export function resolveScopedSessions(filterValue: string, dropdownSessions: Session[]): Session[] {
  if (filterValue === FILTER_ALL) {
    return dropdownSessions
  }
  if (filterValue === FILTER_AT_CAMP) {
    return dropdownSessions.filter(isMainOrEmbedded)
  }
  if (filterValue === FILTER_QUESTS) {
    return dropdownSessions.filter(isQuestSession)
  }
  // Specific session ID
  const match = dropdownSessions.find((s) => s.id === filterValue)
  return match ? [match] : []
}

/**
 * Return the collective noun for the /campers page header based on which
 * session types are represented in `sessions`.
 *
 * Rules (spec #5):
 *   - At-camp only (main / embedded / ag)  → "camper" / "campers"
 *   - Quest only                            → "quester" / "questers"
 *   - Mixed at-camp + quest                 → "camper and quester" / "campers and questers"
 *
 * `count` controls singular vs plural.
 * Only collective count nouns are affected; individual-referring copy
 * ("this camper's…") is NOT changed by this function.
 */
export function getCampersHeadlineNoun(sessions: Session[], count: number): string {
  const plural = count !== 1

  const hasAtCamp = sessions.some(isAtCampSession)
  const hasQuest = sessions.some(isQuestSession)

  if (hasAtCamp && hasQuest) {
    return plural ? 'campers and questers' : 'camper and quester'
  }
  if (hasQuest) {
    return plural ? 'questers' : 'quester'
  }
  // Default: at-camp only (or empty list — fall back to "campers")
  return plural ? 'campers' : 'camper'
}
