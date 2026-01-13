/**
 * Optimized PocketBase data fetching utilities for relation-based tables
 * These functions minimize expand operations and filter at the database level
 */

import { pb } from '../lib/pocketbase';
import type { 
  AttendeesResponse,
  PersonsResponse,
  BunkAssignmentsResponse,
  BunksResponse,
  CampSessionsResponse,
  BunkPlansResponse,
  BunkAssignmentsDraftResponse
} from '../types/pocketbase-types';
import type { Camper } from '../types/app-types';
import { buildCampersFromData, createLookupMaps } from './transforms';

/**
 * Fetch attendees with person and session expansion
 * Optimized to use single-level expansions only
 */
export async function fetchAttendeesWithPersons(
  sessionIds: string[],
  year: number
): Promise<Array<AttendeesResponse<{ person?: PersonsResponse; session?: CampSessionsResponse }>>> {
  if (sessionIds.length === 0) return [];
  
  const filter = `(${sessionIds.map(id => `session = "${id}"`).join(' || ')}) && status = "enrolled" && year = ${year}`;

  return pb.collection<AttendeesResponse<{ person?: PersonsResponse; session?: CampSessionsResponse }>>('attendees').getFullList({
    filter,
    expand: 'person,session'  // Expand both person and session relationships
  });
}

/**
 * Fetch assignments with single-level bunk expansion
 * Filter by session to avoid loading entire year's data
 */
export async function fetchAssignmentsWithBunks(
  sessionIds: string[],
  year: number
): Promise<Array<BunkAssignmentsResponse<{ bunk?: BunksResponse; person?: PersonsResponse }>>> {
  if (sessionIds.length === 0) return [];
  
  const filter = `(${sessionIds.map(id => `session = "${id}"`).join(' || ')}) && year = ${year}`;
  
  return pb.collection<BunkAssignmentsResponse<{ bunk?: BunksResponse; person?: PersonsResponse }>>('bunk_assignments').getFullList({
    filter,
    expand: 'bunk,person'  // Expand both bunk and person to get CM IDs for lookup
  });
}

/**
 * Fetch draft assignments for scenario mode
 */
export async function fetchDraftAssignmentsWithBunks(
  sessionIds: string[],
  scenarioId: string,
  year: number
): Promise<Array<BunkAssignmentsDraftResponse<{ bunk?: BunksResponse; person?: PersonsResponse }>>> {
  if (sessionIds.length === 0 || !scenarioId) return [];

  const filter = `scenario = "${scenarioId}" && (${sessionIds.map(id => `session = "${id}"`).join(' || ')}) && year = ${year}`;

  return pb.collection<BunkAssignmentsDraftResponse<{ bunk?: BunksResponse; person?: PersonsResponse }>>('bunk_assignments_draft').getFullList({
    filter,
    expand: 'bunk,person'  // Must expand person to build lookup map by CM ID
  });
}


/**
 * Fetch bunks and bunk_plans for filtering in AllCampers view
 * Returns both so the caller can filter by session type
 */
export async function fetchBunksWithPlansForYear(year: number): Promise<{
  bunks: BunksResponse[];
  bunkPlans: BunkPlansResponse[];
}> {
  // Fetch bunk_plans with session relation
  const bunkPlans = await pb.collection<BunkPlansResponse>('bunk_plans').getFullList({
    filter: `year = ${year}`,
    fields: 'id,bunk,session,year'
  });

  // Extract unique bunk IDs
  const bunkIds = [...new Set(bunkPlans.map(bp => bp.bunk).filter(Boolean))];

  if (bunkIds.length === 0) return { bunks: [], bunkPlans };

  // Fetch bunks
  let bunks: BunksResponse[];
  if (bunkIds.length <= 50) {
    bunks = await pb.collection<BunksResponse>('bunks').getFullList({
      filter: bunkIds.map(id => `id = "${id}"`).join(' || '),
      sort: 'name'
    });
  } else {
    const allBunks = await pb.collection<BunksResponse>('bunks').getFullList({ sort: 'name' });
    const bunkIdSet = new Set(bunkIds);
    bunks = allBunks.filter(b => bunkIdSet.has(b.id));
  }

  return { bunks, bunkPlans };
}

/**
 * Fetch campers for a session with scenario support
 * Optimized version that minimizes expand operations
 */
export async function fetchCampersForSession(
  sessionId: string,
  sessionCmId: number,
  year: number,
  scenarioId?: string
): Promise<Camper[]> {
  // Fetch attendees with person expansion
  const attendees = await fetchAttendeesWithPersons([sessionId], year);
  
  if (attendees.length === 0) return [];
  
  // Get assignments based on scenario mode
  let assignments: Array<BunkAssignmentsResponse<{ bunk?: BunksResponse; person?: PersonsResponse }> | BunkAssignmentsDraftResponse<{ bunk?: BunksResponse }>> = [];
  
  if (scenarioId) {
    // Fetch draft assignments for scenario
    assignments = await fetchDraftAssignmentsWithBunks([sessionId], scenarioId, year);
  } else {
    // Fetch production assignments
    assignments = await fetchAssignmentsWithBunks([sessionId], year);
  }
  
  // Extract bunks from assignments
  const bunksFromAssignments = assignments
    .map(a => a.expand?.bunk)
    .filter((b): b is BunksResponse => b !== undefined && b !== null);
  
  // Get session from cache or fetch
  const sessions = await pb.collection<CampSessionsResponse>('camp_sessions').getList(1, 1, {
    filter: `cm_id = ${sessionCmId}`
  });
  const session = sessions.items[0];
  
  if (!session) return [];
  
  // Create lookup maps - cast assignments since draft assignments are compatible for lookup purposes
  const maps = createLookupMaps({
    assignments: assignments as Array<BunkAssignmentsResponse<{ bunk?: BunksResponse; person?: PersonsResponse }>>,
    bunks: bunksFromAssignments
  });
  
  // Build campers using the optimized builder
  return buildCampersFromData(attendees, maps.assignments, maps.bunks);
}