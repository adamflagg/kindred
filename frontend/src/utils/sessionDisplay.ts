import type { Session } from '../types/app-types'
import type { SessionDateLookup } from './sessionUtils'
import { isAgSession, isQuestSession, isQuestSessionType } from './sessionTypePredicates'

/**
 * Canonical short display name for a session — used by the camper page (full +
 * pop-in modal headers), the journey timeline current row, and any other
 * surface that needs a single source of truth for the chip-style label.
 *
 * Behavior:
 *   - AG sessions are abbreviated via `shortenSessionName` because the raw AG
 *     name ("All-Gender Cabin-Session 2 (7th & 8th grades)") is too long for a
 *     header chip. Result is e.g. "AG 2 (7-8)".
 *   - Every other session type returns its raw `name` unchanged. Real-world
 *     names are already concise ("Session 2", "Session 2a", "Taste of Camp 2",
 *     "Teen Adventure Quests"), and the trailing digit on Taste of Camp is
 *     meaningful — Taste of Camp 1 and Taste of Camp 2 are different sessions.
 *
 * @returns Short name, or null if no session/name to display.
 */
export function getSessionShortName(
  session:
    | {
        session_type?: string
        name?: string
      }
    | undefined
): string | null {
  if (!session) return null

  if (isAgSession(session)) {
    return session.name ? shortenSessionName(session.name) : 'AG'
  }

  if (isQuestSession(session)) return session.name ?? 'Quest'

  return session.name ?? null
}

/**
 * Shorten AG session names for compact display.
 *
 * Examples:
 *   "All-Gender Cabin-Session 2 (7th - 9th grades)"       → "AG 2 (7-9)"
 *   "Session 4 (All-Gender Cabin)-6th & 7th grades"       → "AG 4 (6-7)"
 *   "Session B (All-Gender Cabins)"                       → "AG B"
 *   "Session 2" (non-AG)                                  → "Session 2" (unchanged)
 */
export function shortenSessionName(name: string): string {
  const lower = name.toLowerCase()
  if (!lower.includes('gender') && !/\bag[\s-]/i.test(name)) return name

  // Extract session identifier (number or letter)
  const sessionMatch = name.match(/session\s*(\w+)/i)
  const sessionId = sessionMatch?.[1] ?? ''

  // Extract grade range — "(4th - 6th grades)", "(9th & 10th grades)", etc.
  const grades = name.match(/(\d+)\w*\s*[-–&]\s*(\d+)\w*\s*grades?\b/i)
  const gradeRange = grades ? ` (${grades[1]}-${grades[2]})` : ''

  return sessionId ? `AG ${sessionId}${gradeRange}` : `AG${gradeRange}`
}

/**
 * Get the properly formatted session name for display
 * @param session The session to format
 * @param allSessions Optional array of all sessions for parent lookup
 * @returns The formatted session name
 */
export function getFormattedSessionName(
  session: Session | undefined,
  allSessions?: Session[]
): string {
  if (!session || !session.name) return 'Unknown Session'

  // For AG sessions, look up the parent session and use its name
  if (isAgSession(session) && session.parent_id && allSessions) {
    const parentSession = allSessions.find((s) => s.cm_id === session.parent_id)
    if (parentSession && parentSession.name) {
      return parentSession.name
    }
  }

  // For all other sessions, return the name as-is
  return session.name
}

/**
 * Transform session names for display, converting AG sessions to their parent session names
 * @param session The session to get display name for
 * @param allSessions Optional array of all sessions for parent lookup
 * @returns The transformed display name
 */
export function getSessionDisplayName(
  session: Session | undefined,
  allSessions?: Session[]
): string {
  if (!session) return 'Unknown Session'

  // For AG sessions, look up the parent session and use its display name
  if (isAgSession(session) && session.parent_id && allSessions) {
    const parentSession = allSessions.find((s) => s.cm_id === session.parent_id)
    if (parentSession) {
      // Recursively get the display name of the parent (which will format it properly)
      return getSessionDisplayName(parentSession, allSessions)
    }
  }

  // For quest sessions, return the name as-is (they don't follow "Session N" pattern)
  if (isQuestSession(session)) {
    return session.name || 'Quest'
  }

  // Fallback to original name
  return session.name || 'Unknown Session'
}

/**
 * Get the parent session ID for navigation purposes
 * AG sessions should navigate to their corresponding main session
 * @param session The session to get parent ID for
 * @param allSessions List of all sessions to search through
 * @returns The parent session ID or the original session ID
 */
export function getParentSessionId(session: Session, allSessions: Session[]): string | number {
  // AG sessions map to their parent main session via parent_id
  if (isAgSession(session) && session.parent_id) {
    const parentSession = allSessions.find((s) => s.cm_id === session.parent_id)
    if (parentSession) return parentSession.cm_id
  }

  // Return original CampMinder ID for all other session types
  return session.cm_id
}

/**
 * Transform a session name string (used for historical data)
 * @param sessionName The session name string to transform
 * @param sessionType Optional session type for better accuracy
 * @returns The transformed display name
 */
export function getSessionDisplayNameFromString(sessionName: string, sessionType?: string): string {
  if (!sessionName) return 'Unknown Session'

  // Check if it's an AG session by type or name pattern
  if (
    sessionType === 'ag' ||
    sessionName.toLowerCase().includes('all-gender') ||
    sessionName.toLowerCase().includes('ag session')
  ) {
    // Extract number from various patterns
    const patterns = [
      /ag\s*session\s*(\d+)/i,
      /all-gender.*session\s*(\d+)/i,
      /session\s*(\d+).*all-gender/i,
    ]

    for (const pattern of patterns) {
      const match = sessionName.match(pattern)
      if (match) return `Session ${match[1]}`
    }
  }

  // Return original name if no transformation needed
  return sessionName
}

/**
 * Get a concise session label for charts and metrics displays
 * @param sessionName The full session name from the API
 * @param sessionType Optional session type for better accuracy
 * @param _sessionDateLookup Deprecated - kept for backward compatibility but no longer used
 * @returns Abbreviated session name suitable for charts, preserving grade ranges
 *          (e.g. "All-Gender 2 (6-8)", "Session 2", "Session 2a", "Taste of Camp 2")
 */
export function getSessionChartLabel(
  sessionName: string,
  sessionType?: string,
  _sessionDateLookup?: SessionDateLookup
): string {
  if (!sessionName) return 'Unknown'

  // Extract grade range if present (e.g., "(Grades 6-8)" or "(6-8)")
  const gradeMatch = sessionName.match(/\((?:Grades?\s*)?(\d+)[-–](\d+)\)/i)
  const gradeRange = gradeMatch ? ` (${gradeMatch[1]}-${gradeMatch[2]})` : ''

  // Handle Quest sessions - return session name as-is (e.g., "Teen Adventure Quests")
  if (isQuestSessionType(sessionType) || sessionName.toLowerCase().includes('quest')) {
    if (sessionName.length > 25) {
      return sessionName.slice(0, 22) + '...'
    }
    return sessionName
  }

  // Handle Taste of Camp - return session name as-is (e.g., "Taste of Camp 2")
  if (sessionName.toLowerCase().includes('taste')) {
    return sessionName
  }

  // Handle AG sessions - abbreviate "All-Gender Cabin-Session 2 (Grades 6-8)" to "All-Gender 2 (6-8)"
  if (
    sessionType === 'ag' ||
    sessionName.toLowerCase().includes('all-gender') ||
    sessionName.toLowerCase().includes('ag session')
  ) {
    const patterns = [
      /ag\s*session\s*(\d+)/i,
      /all-gender.*session\s*(\d+)/i,
      /session\s*(\d+).*all-gender/i,
      /all-gender.*?(\d+)/i,
    ]

    for (const pattern of patterns) {
      const match = sessionName.match(pattern)
      if (match?.[1]) {
        return `All-Gender ${match[1]}${gradeRange}`
      }
    }
    // If no number found, just return "All-Gender" with grade range if present
    return `All-Gender${gradeRange}`
  }

  // Handle embedded sessions - show "Session 2a", "Session 3a", etc.
  if (sessionType === 'embedded') {
    const embeddedMatch = sessionName.match(/session\s*(\d+[a-z])/i)
    if (embeddedMatch?.[1]) {
      return `Session ${embeddedMatch[1]}${gradeRange}`
    }
  }

  // Handle main sessions - show "Session 2", "Session 3", etc.
  const sessionMatch = sessionName.match(/session\s*(\d+[a-z]?)/i)
  if (sessionMatch?.[1]) {
    return `Session ${sessionMatch[1]}${gradeRange}`
  }

  // Fallback - return original name (truncated if too long)
  if (sessionName.length > 25) {
    return sessionName.slice(0, 22) + '...'
  }
  return sessionName
}

/**
 * Get a short abbreviated version of session name for compact display
 * @param sessionName The full session name
 * @param sessionType Optional session type for better accuracy
 * @returns Abbreviated session name (e.g. "Taste", "2", "2a", "3")
 */
export function getSessionShorthand(sessionName: string, sessionType?: string): string {
  if (!sessionName) return ''

  // Handle Quest sessions
  if (isQuestSessionType(sessionType) || sessionName.toLowerCase().includes('quest')) {
    return 'Quest'
  }

  // Handle Taste of Camp
  if (sessionName.toLowerCase().includes('taste')) {
    // When the camp runs two cohorts ("Taste of Camp 1" / "Taste of Camp 2"),
    // preserve the trailing index so labels are distinguishable.
    // Single-digit guard avoids interpreting year suffixes as cohort numbers.
    const cohortMatch = sessionName.match(/\s(\d)\s*$/)
    if (cohortMatch) {
      return `Taste ${cohortMatch[1]}`
    }
    return 'Taste'
  }

  // Handle numbered sessions (Session 2, Session 2a, etc.)
  const sessionMatch = sessionName.match(/Session\s*(\d+[a-z]?)/i)
  if (sessionMatch) {
    const matchedGroup = sessionMatch[1]
    if (matchedGroup) {
      return matchedGroup // Returns "2", "2a", "3", etc.
    }
  }

  // Handle AG sessions - show as the parent session number
  if (sessionType === 'ag' || sessionName.toLowerCase().includes('all-gender')) {
    const patterns = [
      /ag\s*session\s*(\d+)/i,
      /all-gender.*session\s*(\d+)/i,
      /session\s*(\d+).*all-gender/i,
    ]

    for (const pattern of patterns) {
      const match = sessionName.match(pattern)
      if (match) {
        const matchedGroup = match[1]
        if (matchedGroup) {
          return matchedGroup
        }
      }
    }
  }

  // Fallback - try to extract any number
  const numberMatch = sessionName.match(/(\d+[a-z]?)/)
  if (numberMatch) {
    const matchedGroup = numberMatch[1]
    if (matchedGroup) {
      return matchedGroup
    }
  }

  // Last resort - return first word
  const firstWord = sessionName.split(' ')[0]
  return firstWord ?? sessionName
}
