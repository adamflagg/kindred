/**
 * Hook to fetch social network graph data for a session
 * Extracted from SocialNetworkGraph.tsx
 */
import { useQuery } from '@tanstack/react-query';
import { socialGraphService } from '../services/socialGraph';
import { graphCacheService } from '../services/GraphCacheService';
import type { GraphData } from '../types/graph';
import { useYear } from './useCurrentYear';
import { useApiWithAuth } from './useApiWithAuth';

/**
 * Fetch social network graph data for a session
 * Uses the graph cache service for performance
 */
export function useSocialGraphData(sessionCmId: number) {
  const currentYear = useYear();
  const { fetchWithAuth } = useApiWithAuth();

  return useQuery<GraphData>({
    queryKey: ['social-graph', sessionCmId, currentYear],
    queryFn: async () => {
      return graphCacheService.getSessionGraph(sessionCmId, async () => {
        return socialGraphService.getSessionSocialGraph(sessionCmId, currentYear, fetchWithAuth);
      });
    },
  });
}
