/**
 * Session data fetching hooks
 * Extracted from SessionView.tsx for better separation of concerns
 */

import { useQuery } from '@tanstack/react-query';
import type { Session, Camper, BunkRequest, Bunk } from '../../types/app-types';
import { pb } from '../../lib/pocketbase';
import { fetchCampersForSession } from '../../utils/pocketbaseDataFetchers';

// ============================================================================
// Types
// ============================================================================

export interface UseSessionBunksOptions {
  selectedSession: string | undefined;
  sessionCmId: number | undefined;
  agSessions: Array<{ id: string; cm_id: number }>;
  currentYear: number;
}

export interface UseSessionCampersOptions {
  selectedSession: string | undefined;
  agSessions: Array<{ id: string; cm_id: number }>;
  currentYear: number;
  scenarioId: string | undefined;
}

export interface UseBunkRequestsCountOptions {
  selectedSession: string | undefined;
  sessionCmId: number | undefined;
  currentYear: number;
  subSessions: Array<{ cm_id: number }>;
  agSessions: Array<{ cm_id: number }>;
}

// ============================================================================
// Pure Helper Functions (testable without React)
// ============================================================================

/**
 * Extract unique bunk IDs from bunk plans, filtering out nulls
 */
export function extractBunkIds(
  bunkPlans: Array<{ bunk: string | null }>
): string[] {
  return [...new Set(bunkPlans.map((bp) => bp.bunk).filter(Boolean))] as string[];
}

/**
 * Filter bunks by AG prefix
 */
export function filterAgBunks<T extends { name: string }>(
  bunks: T[],
  includeAg: boolean
): T[] {
  return bunks.filter((b) =>
    includeAg ? b.name.startsWith('AG-') : !b.name.startsWith('AG-')
  );
}

/**
 * Deduplicate bunks by name, keeping the first occurrence
 */
export function deduplicateBunksByName<T extends { name: string }>(
  bunks: T[]
): T[] {
  const bunkMap = new Map<string, T>();
  bunks.forEach((bunk) => {
    if (!bunkMap.has(bunk.name)) {
      bunkMap.set(bunk.name, bunk);
    }
  });
  return Array.from(bunkMap.values());
}

/**
 * Merge campers, avoiding duplicates by ID
 */
export function mergeCampers<T extends { id: string }>(
  mainCampers: T[],
  additionalCampers: T[]
): T[] {
  const existingIds = new Set(mainCampers.map((c) => c.id));
  const newCampers = additionalCampers.filter((c) => !existingIds.has(c.id));
  return [...mainCampers, ...newCampers];
}

/**
 * Build filter string for bunk requests query
 */
export function buildBunkRequestsFilter(
  sessionCmId: number,
  year: number,
  includeAll: boolean
): string {
  let filter = `session_id = ${sessionCmId} && year = ${year}`;
  if (!includeAll) {
    filter += ` && status = "pending"`;
  }
  return filter;
}

// ============================================================================
// Helper: Fetch bunks for a session
// ============================================================================

async function fetchBunksForSession(
  sessionCmId: number,
  currentYear: number
): Promise<Bunk[]> {
  // Get session by CampMinder ID
  const sessionResp = await pb
    .collection<Session>('camp_sessions')
    .getList(1, 1, {
      filter: `cm_id = ${sessionCmId} && year = ${currentYear}`,
    });

  if (sessionResp.items.length === 0) {
    throw new Error(`Session with CampMinder ID ${sessionCmId} not found`);
  }

  const session = sessionResp.items[0];
  if (!session?.cm_id) {
    return [];
  }

  // Get bunk plans for this session
  const filter = `session = "${session.id}" && year = ${currentYear}`;
  const bunkPlans = await pb.collection('bunk_plans').getFullList({ filter });

  if (bunkPlans.length === 0) return [];

  // Extract unique bunk IDs
  const bunkIds = extractBunkIds(bunkPlans);
  if (bunkIds.length === 0) return [];

  // Fetch bunks - use batched query for small sets, full scan for large
  if (bunkIds.length <= 50) {
    return pb.collection<Bunk>('bunks').getFullList({
      filter: bunkIds.map((id) => `id = "${id}"`).join(' || '),
      sort: 'name',
    });
  } else {
    const allBunks = await pb
      .collection<Bunk>('bunks')
      .getFullList({ sort: 'name' });
    const bunkIdSet = new Set(bunkIds);
    return allBunks.filter((b) => bunkIdSet.has(b.id));
  }
}

// ============================================================================
// useSessionBunks
// ============================================================================

export function useSessionBunks({
  selectedSession,
  sessionCmId,
  agSessions,
  currentYear,
}: UseSessionBunksOptions) {
  return useQuery({
    queryKey: [
      'bunks',
      selectedSession,
      sessionCmId,
      agSessions.map((s) => s.id).sort(),
    ],
    queryFn: async (): Promise<Bunk[]> => {
      if (!selectedSession) return [];

      const actualSessionCmId = parseInt(selectedSession, 10);
      if (isNaN(actualSessionCmId)) {
        console.error(`Invalid session CampMinder ID: ${selectedSession}`);
        return [];
      }

      // For sub-sessions and AG sessions (not the main session), just return their bunks
      if (selectedSession !== sessionCmId?.toString()) {
        return fetchBunksForSession(actualSessionCmId, currentYear);
      }

      // For main sessions, we need to handle AG bunks specially
      const allBunks = await fetchBunksForSession(actualSessionCmId, currentYear);
      const mainSessionBunks = filterAgBunks(allBunks, false);
      const mainSessionAgBunks = filterAgBunks(allBunks, true);

      // Fetch AG bunks from AG sessions if they exist
      if (agSessions.length > 0) {
        const agBunkPromises = agSessions.map((agSession) =>
          fetchBunksForSession(agSession.cm_id, currentYear).catch(() => [])
        );
        const agBunksArrays = await Promise.all(agBunkPromises);
        const agBunks = agBunksArrays.flat();

        // Filter to only AG bunks and deduplicate
        const actualAgBunks = filterAgBunks(agBunks, true);
        const uniqueAgBunks = deduplicateBunksByName(actualAgBunks);

        return [...mainSessionBunks, ...uniqueAgBunks];
      }

      // If no AG sessions but we have AG bunks in main session, include them
      if (mainSessionAgBunks.length > 0) {
        return [...mainSessionBunks, ...mainSessionAgBunks];
      }

      return mainSessionBunks;
    },
    enabled: !!selectedSession,
  });
}

// ============================================================================
// useSessionCampers
// ============================================================================

export function useSessionCampers({
  selectedSession,
  agSessions,
  currentYear,
  scenarioId,
}: UseSessionCampersOptions) {
  return useQuery({
    queryKey: [
      'campers',
      selectedSession,
      agSessions.map((s) => s.id).sort(),
      scenarioId,
    ],
    queryFn: async (): Promise<Camper[]> => {
      if (!selectedSession) return [];

      const getCampersForSession = async (
        sessionCmId: string | number
      ): Promise<Camper[]> => {
        try {
          const sessionResp = await pb
            .collection<Session>('camp_sessions')
            .getList(1, 1, {
              filter: `cm_id = ${sessionCmId} && year = ${currentYear}`,
            });

          if (sessionResp.items.length === 0) {
            throw new Error(
              `Session with CampMinder ID ${sessionCmId} not found`
            );
          }

          const targetSession = sessionResp.items[0];
          if (!targetSession?.cm_id) {
            return [];
          }

          return fetchCampersForSession(
            targetSession.id,
            Number(sessionCmId),
            currentYear,
            scenarioId
          );
        } catch (error) {
          console.error('Error fetching campers:', error);
          return [];
        }
      };

      // Get main session campers
      let allCampers = await getCampersForSession(selectedSession);

      // Get AG session campers and merge
      if (agSessions.length > 0) {
        const agCamperPromises = agSessions.map((agSession) =>
          getCampersForSession(agSession.cm_id.toString())
        );
        const agCampersArrays = await Promise.all(agCamperPromises);
        const agCampers = agCampersArrays.flat();

        allCampers = mergeCampers(allCampers, agCampers);
      }

      // Ensure type conformance
      return allCampers.map((camper) => ({ ...camper }) as Camper);
    },
    enabled: !!selectedSession,
  });
}

// ============================================================================
// useBunkRequestsCount
// ============================================================================

export function useBunkRequestsCount({
  selectedSession,
  sessionCmId,
  currentYear,
  subSessions,
  agSessions,
}: UseBunkRequestsCountOptions) {
  return useQuery({
    queryKey: [
      'bunk-requests-count',
      selectedSession,
      currentYear,
      subSessions.map((s) => s.cm_id).sort(),
      agSessions.map((s) => s.cm_id).sort(),
    ],
    queryFn: async (): Promise<number> => {
      if (!selectedSession) return 0;

      const getRequestsCount = async (
        sessionCmId: number
      ): Promise<number> => {
        try {
          const filter = buildBunkRequestsFilter(sessionCmId, currentYear, false);
          const requests = await pb
            .collection<BunkRequest>('bunk_requests')
            .getFullList({
              filter,
              sort: '-priority,requester_id',
            });
          return requests.length;
        } catch (error) {
          console.error('Error fetching bunk requests:', error);
          return 0;
        }
      };

      // For non-main sessions, just return their count
      if (selectedSession !== sessionCmId?.toString()) {
        return getRequestsCount(parseInt(selectedSession, 10));
      }

      // For main sessions, aggregate from main + sub + AG sessions
      let totalCount = 0;

      // Main session
      totalCount += await getRequestsCount(parseInt(selectedSession, 10));

      // Sub-sessions
      if (subSessions.length > 0) {
        const subCountPromises = subSessions.map((s) =>
          getRequestsCount(s.cm_id)
        );
        const subCounts = await Promise.all(subCountPromises);
        totalCount += subCounts.reduce((a, b) => a + b, 0);
      }

      // AG sessions
      if (agSessions.length > 0) {
        const agCountPromises = agSessions.map((s) =>
          getRequestsCount(s.cm_id)
        );
        const agCounts = await Promise.all(agCountPromises);
        totalCount += agCounts.reduce((a, b) => a + b, 0);
      }

      return totalCount;
    },
    enabled: !!selectedSession,
  });
}
