/**
 * Utilities for session URL handling
 */

import type { Session } from '../types/app-types'
import { isMainOrEmbedded, isQuestSession } from './sessionTypePredicates'

// Map session names to friendly URL segments
const SESSION_NAME_TO_URL: Record<string, string> = {
  'Taste of Camp 1': 'taste-1',
  'Taste of Camp 2': 'taste-2',
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
    return sessions.find((s) => s.name === knownName) ?? null
  }

  // Then try numeric ID
  if (isNumericSessionId(urlSegment)) {
    const cmId = parseInt(urlSegment, 10)
    return sessions.find((s) => s.cm_id === cmId) ?? null
  }

  // Finally, try to match the URL-friendly version of session names
  return sessions.find((s) => sessionNameToUrl(s.name) === urlSegment) ?? null
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
  if (match?.[1]) {
    return [parseInt(match[1], 10), match[2]?.toLowerCase() ?? '']
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
  return sessions.toSorted((a, b) => {
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
  return sessions.filter(isMainOrEmbedded)
}

/**
 * Sort session data (from API) in logical order by session_name field.
 * Works with API response types that have session_name field.
 */
export function sortSessionDataByName<T extends { session_name: string }>(data: T[]): T[] {
  return data.toSorted((a, b) => {
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
  return data.toSorted((a, b) => compareByDateThenName(a.session_name, b.session_name, dateLookup))
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
  return data.toSorted((a, b) =>
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
  const camp = sessions.filter((s) => !isQuestSession(s))
  const quest = sessions.filter(isQuestSession)

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
  return data.toSorted((a, b) =>
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

// ============================================================================
// Duration grouping utilities
// ============================================================================

/**
 * Calculate session length category from start and end dates.
 * Mirrors backend's get_session_length_category() in api/utils/session_metrics.py.
 *
 * Categories: '1-week' (1-7 days), '2-week' (8-14), '3-week' (15-21), '4-week+' (22+)
 */
export function getSessionLengthCategory(startDate: string, endDate: string): string {
  if (!startDate || !endDate) return 'unknown'

  const start = new Date(startDate.split('T')[0] ?? '')
  const end = new Date(endDate.split('T')[0] ?? '')

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 'unknown'

  const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1

  if (days <= 7) return '1-week'
  if (days <= 14) return '2-week'
  if (days <= 21) return '3-week'
  return '4-week+'
}

/**
 * Session with end_date, used for duration grouping.
 * Extends the shape needed by getSessionLengthCategory.
 */
interface SessionWithDates {
  cm_id: number
  name: string
  session_type: string
  start_date: string
  end_date: string
}

/** Duration categories in display order */
export const DURATION_CATEGORIES = ['1-week', '2-week', '3-week', '4-week+'] as const
export type DurationCategory = (typeof DURATION_CATEGORIES)[number]

/**
 * Group camp sessions (non-quest) by duration category.
 * Returns a Map with only categories that have sessions, in display order.
 */
export function groupSessionsByDuration<T extends SessionWithDates>(
  sessions: T[]
): Map<DurationCategory, T[]> {
  const groups = new Map<DurationCategory, T[]>()

  // Filter to camp sessions only (exclude quest)
  const campSessions = sessions.filter((s) => !isQuestSession(s))

  for (const session of campSessions) {
    const category = getSessionLengthCategory(session.start_date, session.end_date)
    if (category === 'unknown') continue
    const cat = category as DurationCategory
    let arr = groups.get(cat)
    if (!arr) {
      arr = []
      groups.set(cat, arr)
    }
    arr.push(session)
  }

  // Sort sessions within each group by start_date
  for (const [, groupSessions] of groups) {
    groupSessions.sort((a, b) => a.start_date.localeCompare(b.start_date))
  }

  // Return in canonical order (remove empty categories)
  const ordered = new Map<DurationCategory, T[]>()
  for (const cat of DURATION_CATEGORIES) {
    const sessions = groups.get(cat)
    if (sessions) ordered.set(cat, sessions)
  }
  return ordered
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
