/**
 * Utilities for session URL handling
 */

import type { Session } from '../types/app-types'

// Map session names to friendly URL segments
const SESSION_NAME_TO_URL: Record<string, string> = {
  'Taste of Camp': 'taste',
  'Session 1': '1',
  'Session 2': '2',
  'Session 2a': '2a',
  'Session 2b': '2b',
  'Session 3': '3',
  'Session 3a': '3a',
  'Session 4': '4',
}

// Reverse mapping
const URL_TO_SESSION_NAME: Record<string, string> = Object.entries(SESSION_NAME_TO_URL).reduce(
  (acc, [name, url]) => ({ ...acc, [url]: name }),
  {}
)

export function sessionNameToUrl(sessionName: string): string {
  // First check if it's a known session name
  if (SESSION_NAME_TO_URL[sessionName]) {
    return SESSION_NAME_TO_URL[sessionName]
  }

  // For AG sessions or other special sessions, create a URL-friendly version
  // Remove special characters and replace spaces with hyphens
  return sessionName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

export function urlToSessionName(urlSegment: string): string | null {
  // First check if it's a known URL segment
  if (URL_TO_SESSION_NAME[urlSegment]) {
    return URL_TO_SESSION_NAME[urlSegment]
  }

  // For other sessions, we'll need to look them up by matching the URL-friendly version
  // This will be handled by the component that has access to all sessions
  return null
}

export function isKnownSessionUrl(urlSegment: string): boolean {
  return urlSegment in URL_TO_SESSION_NAME
}

export function isNumericSessionId(urlSegment: string): boolean {
  return /^\d+$/.test(urlSegment)
}

export function findSessionByUrlSegment(sessions: Session[], urlSegment: string): Session | null {
  // First try to find by known URL mapping
  const knownName = urlToSessionName(urlSegment)
  if (knownName) {
    return sessions.find((s) => s.name === knownName) || null
  }

  // Then try numeric ID
  if (isNumericSessionId(urlSegment)) {
    const cmId = parseInt(urlSegment, 10)
    return sessions.find((s) => s.cm_id === cmId) || null
  }

  // Finally, try to match the URL-friendly version of session names
  return sessions.find((s) => sessionNameToUrl(s.name) === urlSegment) || null
}

// Valid tab paths for routing
export const VALID_TABS = ['bunks', 'campers', 'requests', 'review', 'friends', 'logs'] as const
export type ValidTab = (typeof VALID_TABS)[number]

export function isValidTab(tab: string): tab is ValidTab {
  return VALID_TABS.includes(tab as ValidTab)
}

/**
 * Parse session name into number and optional suffix for sorting
 */
export function parseSessionName(name: string): [number, string] {
  const match = name.match(/session\s+(\d+)([a-z])?/i)
  if (match && match[1]) {
    return [parseInt(match[1], 10), match[2]?.toLowerCase() || '']
  }
  return [0, name.toLowerCase()]
}

/**
 * Sort sessions by start_date.
 * For sessions with the same date, falls back to name-based sorting.
 */
export function sortSessionsByDate<T extends { name: string; start_date: string }>(
  sessions: T[]
): T[] {
  return [...sessions].sort((a, b) => {
    // Primary: sort by start_date
    const dateCompare = a.start_date.localeCompare(b.start_date)
    if (dateCompare !== 0) return dateCompare

    // Tiebreaker: sort by name (number then suffix)
    const [numA, suffixA] = parseSessionName(a.name)
    const [numB, suffixB] = parseSessionName(b.name)
    if (numA !== numB) return numA - numB
    return suffixA.localeCompare(suffixB)
  })
}

/**
 * Filter sessions to main and embedded types only
 */
export function filterSelectableSessions<T extends { session_type?: string | null }>(
  sessions: T[]
): T[] {
  return sessions.filter((s) => s.session_type === 'main' || s.session_type === 'embedded')
}

/**
 * Sort session data (from API) in logical order by session_name field.
 * Works with API response types that have session_name field.
 */
export function sortSessionDataByName<T extends { session_name: string }>(data: T[]): T[] {
  return [...data].sort((a, b) => {
    const [numA, suffixA] = parseSessionName(a.session_name)
    const [numB, suffixB] = parseSessionName(b.session_name)
    if (numA !== numB) return numA - numB
    return suffixA.localeCompare(suffixB)
  })
}

/**
 * Lookup map from session name to start date string (ISO format).
 * Used for date-aware sorting in metrics charts.
 */
export interface SessionDateLookup {
  [sessionName: string]: string
}

/**
 * Build a lookup map from session name to start_date.
 * Used to enable date-based sorting for session data in metrics.
 */
export function buildSessionDateLookup(
  sessions: Array<{ name: string; start_date: string }>
): SessionDateLookup {
  const lookup: SessionDateLookup = {}
  for (const session of sessions) {
    lookup[session.name] = session.start_date
  }
  return lookup
}

/**
 * Compare two session names using date lookup with name-based fallback.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 */
export function compareByDateThenName(
  nameA: string,
  nameB: string,
  dateLookup: SessionDateLookup
): number {
  const dateA = dateLookup[nameA]
  const dateB = dateLookup[nameB]

  // If both have dates, compare by date first
  if (dateA && dateB) {
    const dateCompare = dateA.localeCompare(dateB)
    if (dateCompare !== 0) return dateCompare
  }

  // Fall back to name-based sorting (as tiebreaker or when dates unavailable)
  const [numA, suffixA] = parseSessionName(nameA)
  const [numB, suffixB] = parseSessionName(nameB)
  if (numA !== numB) return numA - numB
  return suffixA.localeCompare(suffixB)
}

/**
 * Sort session data by date (primary) with name-based sorting as tiebreaker.
 * Uses the date lookup to determine chronological order.
 * Works with API response types that have session_name field.
 */
export function sortSessionDataByDate<T extends { session_name: string }>(
  data: T[],
  dateLookup: SessionDateLookup
): T[] {
  return [...data].sort((a, b) => compareByDateThenName(a.session_name, b.session_name, dateLookup))
}

/**
 * Sort prior session data by date (primary) with name-based sorting as tiebreaker.
 * Uses the date lookup to determine chronological order.
 * Works with retention API response that has prior_session field.
 */
export function sortPriorSessionDataByDate<T extends { prior_session: string }>(
  data: T[],
  dateLookup: SessionDateLookup
): T[] {
  return [...data].sort((a, b) =>
    compareByDateThenName(a.prior_session, b.prior_session, dateLookup)
  )
}

// ============================================================================
// Camp-then-Quest sorting utilities (for metrics view mode)
// ============================================================================

/**
 * Lookup map from session name to session_type.
 * Used for camp-then-quest sort ordering.
 */
export interface SessionTypeLookup {
  [sessionName: string]: string
}

/**
 * Build a lookup map from session name to session_type.
 */
export function buildSessionTypeLookup(
  sessions: Array<{ name: string; session_type: string }>
): SessionTypeLookup {
  const lookup: SessionTypeLookup = {}
  for (const session of sessions) {
    lookup[session.name] = session.session_type
  }
  return lookup
}

/**
 * Sort sessions: camp sessions first (chronologically), then quest sessions (chronologically).
 * Camp = any session_type that is NOT 'quest' (main, embedded, ag).
 */
export function sortSessionsCampThenQuest<
  T extends { name: string; session_type: string; start_date: string },
>(sessions: T[]): T[] {
  const camp = sessions.filter((s) => s.session_type !== 'quest')
  const quest = sessions.filter((s) => s.session_type === 'quest')

  const sortedCamp = sortSessionsByDate(camp)
  const sortedQuest = sortSessionsByDate(quest)

  return [...sortedCamp, ...sortedQuest]
}

/**
 * Sort session data by camp-then-quest ordering.
 * Camp sessions (main/embedded/ag) come first chronologically,
 * then quest sessions chronologically.
 * Works with API response types that have session_name field.
 */
export function sortSessionDataByCampThenQuest<T extends { session_name: string }>(
  data: T[],
  dateLookup: SessionDateLookup,
  typeLookup: SessionTypeLookup
): T[] {
  return [...data].sort((a, b) =>
    compareByDateCampThenQuest(a.session_name, b.session_name, dateLookup, typeLookup)
  )
}

/**
 * Split items into camp (non-quest) and quest groups, preserving order within each.
 * By default reads `session_type` from each item; pass a custom accessor for other shapes.
 */
export function splitCampAndQuest<T>(
  items: T[],
  getType: (item: T) => string = (item) => (item as Record<string, string>)['session_type'] ?? ''
): { camp: T[]; quest: T[] } {
  const camp: T[] = []
  const quest: T[] = []
  for (const item of items) {
    if (getType(item) === 'quest') {
      quest.push(item)
    } else {
      camp.push(item)
    }
  }
  return { camp, quest }
}

/**
 * Compare two session names: camp sessions sort before quest sessions.
 * Within each group, sort by date (primary) then name (secondary).
 */
export function compareByDateCampThenQuest(
  nameA: string,
  nameB: string,
  dateLookup: SessionDateLookup,
  typeLookup: SessionTypeLookup
): number {
  const isQuestA = typeLookup[nameA] === 'quest'
  const isQuestB = typeLookup[nameB] === 'quest'

  // Camp before quest
  if (!isQuestA && isQuestB) return -1
  if (isQuestA && !isQuestB) return 1

  // Within same group, sort by date then name
  return compareByDateThenName(nameA, nameB, dateLookup)
}
