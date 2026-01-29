import type { Session } from '../types/app-types';
import type { SessionDateLookup } from './sessionUtils';

/**
 * Get the properly formatted session name for display
 * @param session The session to format
 * @param allSessions Optional array of all sessions for parent lookup
 * @returns The formatted session name
 */
export function getFormattedSessionName(session: Session | undefined, allSessions?: Session[]): string {
  if (!session || !session.name) return 'Unknown Session';
  
  // For AG sessions, look up the parent session and use its name
  if (session.session_type === 'ag' && session.parent_id && allSessions) {
    const parentSession = allSessions.find(s => s.cm_id === session.parent_id);
    if (parentSession && parentSession.name) {
      return parentSession.name;
    }
  }
  
  // For all other sessions, return the name as-is
  return session.name;
}

/**
 * Transform session names for display, converting AG sessions to their parent session names
 * @param session The session to get display name for
 * @param allSessions Optional array of all sessions for parent lookup
 * @returns The transformed display name
 */
export function getSessionDisplayName(session: Session | undefined, allSessions?: Session[]): string {
  if (!session) return 'Unknown Session';
  
  // For AG sessions, look up the parent session and use its display name
  if (session.session_type === 'ag' && session.parent_id && allSessions) {
    const parentSession = allSessions.find(s => s.cm_id === session.parent_id);
    if (parentSession) {
      // Recursively get the display name of the parent (which will format it properly)
      return getSessionDisplayName(parentSession, allSessions);
    }
  }
  
  // For embedded sessions, show the code (2a, 2b, 3a, 3b)
  if (session.session_type === 'embedded' && session.code) {
    return `Session ${session.code}`;
  }
  
  // For main sessions, extract the number
  if (session.session_type === 'main' && session.persistent_id) {
    // main1 -> Session 1, main2 -> Session 2, etc.
    const match = session.persistent_id.match(/main(\d+)/);
    if (match) return `Session ${match[1]}`;
  }
  
  // For taste, just show "Taste of Camp"
  if (session.session_type === 'taste') {
    return 'Taste of Camp';
  }
  
  // Fallback to original name
  return session.name || 'Unknown Session';
}

/**
 * Get the parent session ID for navigation purposes
 * AG sessions should navigate to their corresponding main session
 * @param session The session to get parent ID for
 * @param allSessions List of all sessions to search through
 * @returns The parent session ID or the original session ID
 */
export function getParentSessionId(session: Session, allSessions: Session[]): string | number {
  // Only transform AG sessions
  if (session.session_type === 'ag' && session.persistent_id) {
    // Extract the session number from AG persistent_id
    const match = session.persistent_id.match(/ag_?(?:main)?(\d+)/);
    if (match) {
      const sessionNumber = match[1];
      // Find the corresponding main session
      const parentSession = allSessions.find(s => 
        s.session_type === 'main' && 
        (s.persistent_id === sessionNumber || s.persistent_id === `main${sessionNumber}`)
      );
      if (parentSession) return parentSession.cm_id;
    }
  }
  
  // Return original CampMinder ID for all other session types
  return session.cm_id;
}

/**
 * Transform a session name string (used for historical data)
 * @param sessionName The session name string to transform
 * @param sessionType Optional session type for better accuracy
 * @returns The transformed display name
 */
export function getSessionDisplayNameFromString(sessionName: string, sessionType?: string): string {
  if (!sessionName) return 'Unknown Session';
  
  // Check if it's an AG session by type or name pattern
  if (sessionType === 'ag' || sessionName.toLowerCase().includes('all-gender') || sessionName.toLowerCase().includes('ag session')) {
    // Extract number from various patterns
    const patterns = [
      /ag\s*session\s*(\d+)/i,
      /all-gender.*session\s*(\d+)/i,
      /session\s*(\d+).*all-gender/i,
    ];
    
    for (const pattern of patterns) {
      const match = sessionName.match(pattern);
      if (match) return `Session ${match[1]}`;
    }
  }
  
  // Return original name if no transformation needed
  return sessionName;
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
  if (!sessionName) return 'Unknown';

  // Extract grade range if present (e.g., "(Grades 6-8)" or "(6-8)")
  const gradeMatch = sessionName.match(/\((?:Grades?\s*)?(\d+)[-–](\d+)\)/i);
  const gradeRange = gradeMatch ? ` (${gradeMatch[1]}-${gradeMatch[2]})` : '';

  // Handle Taste of Camp - return session name as-is (e.g., "Taste of Camp 2")
  if (sessionType === 'taste' || sessionName.toLowerCase().includes('taste')) {
    return sessionName;
  }

  // Handle AG sessions - abbreviate "All-Gender Cabin-Session 2 (Grades 6-8)" to "All-Gender 2 (6-8)"
  if (sessionType === 'ag' || sessionName.toLowerCase().includes('all-gender') || sessionName.toLowerCase().includes('ag session')) {
    const patterns = [
      /ag\s*session\s*(\d+)/i,
      /all-gender.*session\s*(\d+)/i,
      /session\s*(\d+).*all-gender/i,
      /all-gender.*?(\d+)/i,
    ];

    for (const pattern of patterns) {
      const match = sessionName.match(pattern);
      if (match && match[1]) {
        return `All-Gender ${match[1]}${gradeRange}`;
      }
    }
    // If no number found, just return "All-Gender" with grade range if present
    return `All-Gender${gradeRange}`;
  }

  // Handle embedded sessions - show "Session 2a", "Session 3a", etc.
  if (sessionType === 'embedded') {
    const embeddedMatch = sessionName.match(/session\s*(\d+[a-z])/i);
    if (embeddedMatch && embeddedMatch[1]) {
      return `Session ${embeddedMatch[1]}${gradeRange}`;
    }
  }

  // Handle main sessions - show "Session 2", "Session 3", etc.
  const sessionMatch = sessionName.match(/session\s*(\d+[a-z]?)/i);
  if (sessionMatch && sessionMatch[1]) {
    return `Session ${sessionMatch[1]}${gradeRange}`;
  }

  // Fallback - return original name (truncated if too long)
  if (sessionName.length > 25) {
    return sessionName.slice(0, 22) + '...';
  }
  return sessionName;
}

/**
 * Get a short abbreviated version of session name for compact display
 * @param sessionName The full session name
 * @param sessionType Optional session type for better accuracy
 * @returns Abbreviated session name (e.g. "Taste", "2", "2a", "3")
 */
export function getSessionShorthand(sessionName: string, sessionType?: string): string {
  if (!sessionName) return '';
  
  // Handle Taste of Camp
  if (sessionType === 'taste' || sessionName.toLowerCase().includes('taste')) {
    return 'Taste';
  }
  
  // Handle numbered sessions (Session 2, Session 2a, etc.)
  const sessionMatch = sessionName.match(/Session\s*(\d+[a-z]?)/i);
  if (sessionMatch) {
    const matchedGroup = sessionMatch[1];
    if (matchedGroup) {
      return matchedGroup; // Returns "2", "2a", "3", etc.
    }
  }
  
  // Handle AG sessions - show as the parent session number
  if (sessionType === 'ag' || sessionName.toLowerCase().includes('all-gender')) {
    const patterns = [
      /ag\s*session\s*(\d+)/i,
      /all-gender.*session\s*(\d+)/i,
      /session\s*(\d+).*all-gender/i,
    ];
    
    for (const pattern of patterns) {
      const match = sessionName.match(pattern);
      if (match) {
        const matchedGroup = match[1];
        if (matchedGroup) {
          return matchedGroup;
        }
      }
    }
  }
  
  // Fallback - try to extract any number
  const numberMatch = sessionName.match(/(\d+[a-z]?)/);
  if (numberMatch) {
    const matchedGroup = numberMatch[1];
    if (matchedGroup) {
      return matchedGroup;
    }
  }
  
  // Last resort - return first word
  const firstWord = sessionName.split(' ')[0];
  return firstWord || sessionName;
}