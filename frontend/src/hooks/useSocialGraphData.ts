/**
 * Hook to fetch social network graph data for a session
 * Extracted from SocialNetworkGraph.tsx
 */
import { useQuery } from '@tanstack/react-query'
import { socialGraphService } from '../services/socialGraph'
import { graphCacheService } from '../services/GraphCacheService'
import type { GraphData } from '../types/graph'
import { queryKeys } from '../utils/queryKeys'
import { useYear } from './useCurrentYear'
import { useApiWithAuth } from './useApiWithAuth'
import { useScenario } from './useScenario'

/**
 * Fetch social network graph data for a session.
 *
 * When a scenario is active (from ScenarioContext), the request includes the
 * scenario ID so the backend sources bunk assignments from that scenario's
 * draft data instead of CampMinder production assignments.
 */
export function useSocialGraphData(sessionCmId: number) {
  const currentYear = useYear()
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()
  const { currentScenario } = useScenario()
  const scenarioId = currentScenario?.id ?? null

  return useQuery<GraphData>({
    queryKey: queryKeys.socialGraph(sessionCmId, currentYear, scenarioId),
    enabled: !isAuthLoading,
    queryFn: async () => {
      // Bypass the long-lived in-memory graph cache for scenario views — the
      // cache is keyed only by session+year, so a scenario graph would be
      // served to a later production-mode view (or vice versa).
      if (scenarioId) {
        return socialGraphService.getSessionSocialGraph(
          sessionCmId,
          currentYear,
          fetchWithAuth,
          scenarioId
        )
      }
      return graphCacheService.getSessionGraph(
        sessionCmId,
        async () => {
          return socialGraphService.getSessionSocialGraph(sessionCmId, currentYear, fetchWithAuth)
        },
        currentYear
      )
    },
  })
}
