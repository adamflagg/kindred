/**
 * Hook to fetch bunk names for a session
 * Extracted from SocialNetworkGraph.tsx
 */
import { useQuery } from '@tanstack/react-query';
import { pb } from '../lib/pocketbase';
import { useYear } from './useCurrentYear';
import type { Bunk, Session } from '../types/app-types';
import type { BunkPlansResponse } from '../types/pocketbase-types';

/**
 * Fetch bunk names for a given session
 * Returns a map of bunk_cm_id to bunk name
 */
export function useBunkNames(sessionCmId: number, enabled: boolean = true) {
  const currentYear = useYear();

  return useQuery({
    queryKey: ['bunk-names', sessionCmId, currentYear],
    queryFn: async (): Promise<Record<number, string>> => {
      try {
        // Get the session by CampMinder ID and year
        const sessionResp = await pb.collection<Session>('camp_sessions').getList(1, 1, {
          filter: `cm_id = ${sessionCmId} && year = ${currentYear}`,
        });

        if (sessionResp.items.length === 0) {
          throw new Error(`Session with CampMinder ID ${sessionCmId} not found for year ${currentYear}`);
        }

        const session = sessionResp.items[0];
        if (!session || !session.cm_id) {
          return {};
        }

        // Use the session PocketBase ID directly from camp_sessions
        const sessionPbId = session.id;

        const filter = `session = "${sessionPbId}" && year = ${currentYear}`;
        const bunkPlans = await pb.collection<BunkPlansResponse>('bunk_plans').getFullList({ filter });

        if (bunkPlans.length === 0) return {};

        // Get unique bunk relation IDs
        const bunkIds = [...new Set(bunkPlans.map((bp) => bp.bunk))];

        if (bunkIds.length === 0) return {};

        // Fetch bunks by CampMinder IDs with smart batching
        let bunks: Bunk[] = [];

        if (bunkIds.length <= 20) {
          bunks = await pb.collection<Bunk>('bunks').getFullList({
            filter: bunkIds.map((id) => `id = "${id}"`).join(' || '),
            sort: 'name',
          });
        } else {
          // Load all bunks and filter in memory
          const allBunks = await pb.collection<Bunk>('bunks').getFullList({
            sort: 'name',
          });
          const bunkIdSet = new Set(bunkIds);
          bunks = allBunks.filter((b) => bunkIdSet.has(b.id));
        }

        // Create a map of bunk_cm_id to name
        const bunkMap: Record<number, string> = {};
        bunks.forEach((bunk) => {
          if (bunk.cm_id && bunk.name) {
            bunkMap[bunk.cm_id] = bunk.name;
          }
        });
        return bunkMap;
      } catch (error) {
        console.error('Failed to load bunk names:', error);
        return {};
      }
    },
    enabled,
  });
}
