/**
 * Utilities for debug parser session handling
 * - Filtering sessions for dropdown (main + embedded only, no AG)
 * - Building CM-ID mapping for AG sessions
 */

// Session types that should appear in the dropdown for debug parser
// (AG is excluded because it's grouped with parent main session)
const DEBUG_DROPDOWN_SESSION_TYPES = ['main', 'embedded'] as const;

/**
 * Session with type information for debug parser
 */
export interface DebugSession {
  id: string;
  cm_id: number;
  name: string;
  session_type?: string;
  parent_id?: number | null;
}

/**
 * Get sessions for the dropdown in debug parser
 * - Includes: main, embedded sessions
 * - Excludes: AG (grouped with parent)
 */
export function getDebugDropdownSessions(sessions: DebugSession[]): DebugSession[] {
  return sessions.filter(
    (s) =>
      s.session_type &&
      DEBUG_DROPDOWN_SESSION_TYPES.includes(
        s.session_type as (typeof DEBUG_DROPDOWN_SESSION_TYPES)[number]
      )
  );
}

/**
 * Build a map from main session cm_id to array of AG session cm_ids
 * Used to get effective cm_ids for API calls when a main session is selected
 *
 * Returns a Map where:
 * - Key: main session cm_id
 * - Value: array of AG session cm_ids that belong to this main session
 */
export function buildAgSessionCmIdMap(sessions: DebugSession[]): Map<number, number[]> {
  const map = new Map<number, number[]>();

  sessions.forEach((session) => {
    if (session.session_type === 'ag' && session.parent_id) {
      const existing = map.get(session.parent_id) || [];
      existing.push(session.cm_id);
      map.set(session.parent_id, existing);
    }
  });

  return map;
}

/**
 * Get effective cm_ids for API call
 * If a main session is selected, includes the main session cm_id plus any AG children
 * If an embedded session is selected, returns just that cm_id
 *
 * @param selectedCmId The selected session's cm_id (null for "All Sessions")
 * @param agSessionMap Map from main session cm_id to AG session cm_ids
 * @returns Array of cm_ids to pass to API, or undefined for "All Sessions"
 */
export function getEffectiveCmIds(
  selectedCmId: number | null,
  agSessionMap: Map<number, number[]>
): number[] | undefined {
  if (selectedCmId === null) {
    return undefined;
  }

  const agCmIds = agSessionMap.get(selectedCmId) || [];
  return [selectedCmId, ...agCmIds];
}

/**
 * Filter items by requester name (case-insensitive)
 */
export function filterByRequesterName<T extends { requester_name: string | null }>(
  items: T[],
  searchQuery: string
): T[] {
  const trimmed = searchQuery.trim();
  if (!trimmed) {
    return items;
  }

  const term = trimmed.toLowerCase();
  return items.filter((item) => item.requester_name?.toLowerCase().includes(term));
}
