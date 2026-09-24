import type { Session } from '../types/app-types'
import type { SessionDateLookup } from './sessionUtils'
import { isAgSession, isQuestSession } from './sessionTypePredicates'
import { sessionName } from './sessionName'

/**
 * Session RECORD adapters. The name itself is rendered by `sessionName`
 * (kindred#2763), at the form named in each adapter; what these add is only
 * what needs the record — a missing name's fallback, and the AG ->
 * parent-session lookup.
 */

/**
 * The camper header chip — `sessionName(…, 'short')` of a session record.
 *
 * AG reads "AG 2 (7-8)", an adult weekend drops its qualifier ("Women's
 * Weekend"), and everything else prints whole: real summer names are already
 * concise, and Taste of Camp's trailing digit is meaningful.
 *
 * A record is taken at its word: with no `session_type` it passes `''`, so
 * the short form does NOT infer AG from the name the way it does for the
 * untyped metrics rows.
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
  const { name } = session
  if (name) return sessionName(name, session.session_type ?? '', 'short')
  // Missing-name fallbacks, per program, exactly as they have always read.
  if (isAgSession(session)) return 'AG'
  if (isQuestSession(session)) return name ?? 'Quest'
  if (session.session_type === 'adult') return null
  return name ?? null
}

/** @deprecated kindred#2763 — `sessionName(name, undefined, 'short')`. */
export function shortenSessionName(name: string): string {
  return sessionName(name, undefined, 'short')
}

/** @deprecated kindred#2763 — `sessionName(name, undefined, 'matrix')`. */
export function formatAgSessionLabel(name: string): string {
  return sessionName(name, undefined, 'matrix')
}

/**
 * A session's full name, with an AG session named by its parent main session
 * — `sessionName(…, 'full')` of the parent.
 * @param session The session to format
 * @param allSessions Optional array of all sessions for parent lookup
 * @returns The formatted session name
 */
export function getFormattedSessionName(
  session: Session | undefined,
  allSessions?: Session[]
): string {
  if (!session?.name) return 'Unknown Session'

  // For AG sessions, look up the parent session and use its name
  if (isAgSession(session) && session.parent_id && allSessions) {
    const parentSession = allSessions.find((s) => s.cm_id === session.parent_id)
    if (parentSession?.name) {
      return sessionName(parentSession.name, parentSession.session_type, 'full')
    }
  }

  return sessionName(session.name, session.session_type, 'full')
}

/**
 * Like `getFormattedSessionName`, differing only in its empty-name fallbacks
 * (an unnamed Quest reads "Quest"; an AG whose parent is unnamed reads
 * "Unknown Session"). Both are pinned; reconciling them is #2790's.
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
    return session.name ? sessionName(session.name, session.session_type, 'full') : 'Quest'
  }

  return session.name ? sessionName(session.name, session.session_type, 'full') : 'Unknown Session'
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

/** @deprecated kindred#2763 — `sessionName(name, type, 'title')`. */
export function getSessionDisplayNameFromString(
  sessionName_: string,
  sessionType?: string
): string {
  return sessionName(sessionName_, sessionType, 'title')
}

/** @deprecated kindred#2763 — `sessionName(name, type, 'chart')`. */
export function getSessionChartLabel(
  name: string,
  sessionType?: string,
  _sessionDateLookup?: SessionDateLookup
): string {
  return sessionName(name, sessionType, 'chart')
}

/** @deprecated kindred#2763 — `sessionName(name, type, 'tiny')`. */
export function getSessionShorthand(name: string, sessionType?: string): string {
  return sessionName(name, sessionType, 'tiny')
}
