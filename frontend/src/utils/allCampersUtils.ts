/**
 * Utilities for the AllCampers view
 * - Filtering bunks to only summer camp bunks
 * - Handling session dropdown with embedded sessions as independent
 * - Session relationships for AG grouping
 */

import type {
  BunksResponse,
  BunkPlansResponse
} from '../types/pocketbase-types';
import type { Session } from '../types/app-types';
import { sortSessionsByDate } from './sessionUtils';

// Export type alias for sessions with type information
export type SessionWithType = Session;

// Session types that are valid for summer camp bunking
const SUMMER_CAMP_SESSION_TYPES = ['main', 'ag', 'embedded'] as const;

// Session types that should appear in the dropdown
// (AG is excluded because it's grouped with parent main session)
const DROPDOWN_SESSION_TYPES = ['main', 'embedded'] as const;

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
  const summerCampSessionIds = new Set(
    sessions
      .filter(s => SUMMER_CAMP_SESSION_TYPES.includes(s.session_type as typeof SUMMER_CAMP_SESSION_TYPES[number]))
      .map(s => s.id)
  );

  // Create a set of bunk IDs that are linked to summer camp sessions
  const summerCampBunkIds = new Set(
    bunkPlans
      .filter(bp => summerCampSessionIds.has(bp.session))
      .map(bp => bp.bunk)
  );

  // Filter bunks to only include those linked to summer camp sessions
  const filteredBunks = bunks.filter(b => summerCampBunkIds.has(b.id));

  // Sort bunks by name (alphabetically, which puts AG-, B-, G- in correct order)
  return filteredBunks.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get sessions for the dropdown in AllCampers view
 * - Includes: main, embedded sessions (including Taste of Camp which is a main session)
 * - Excludes: AG (grouped with parent), family, quest, training, etc.
 * - Embedded sessions are independent entries (not grouped with main)
 */
export function getDropdownSessions(
  sessions: Session[]
): Session[] {
  // Filter to only dropdown-eligible session types
  const filteredSessions = sessions.filter(s =>
    DROPDOWN_SESSION_TYPES.includes(s.session_type as typeof DROPDOWN_SESSION_TYPES[number])
  );

  // Sort using shared utility (date primary, then session number+suffix)
  return sortSessionsByDate(filteredSessions);
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
  const relationships = new Map<string, string[]>();

  // Create a lookup for sessions by cm_id for finding parents
  const sessionByCmId = new Map<number, SessionWithType>();
  sessions.forEach(s => sessionByCmId.set(s.cm_id, s));

  // Process each session
  sessions.forEach(session => {
    if (session.session_type === 'ag') {
      // AG sessions don't get their own entry - they're grouped with parent
      // But we need to add them to their parent's list
      if (session.parent_id) {
        const parentSession = sessionByCmId.get(session.parent_id);
        if (parentSession) {
          const existing = relationships.get(parentSession.id) || [parentSession.id];
          if (!existing.includes(session.id)) {
            existing.push(session.id);
          }
          relationships.set(parentSession.id, existing);
        }
      }
    } else if (session.session_type === 'main') {
      // Main sessions include only themselves initially
      // AG children will be added above
      if (!relationships.has(session.id)) {
        relationships.set(session.id, [session.id]);
      }
    } else if (session.session_type === 'embedded') {
      // Embedded sessions are independent - only include themselves
      relationships.set(session.id, [session.id]);
    }
  });

  return relationships;
}
