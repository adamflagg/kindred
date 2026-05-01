/**
 * Hook to fetch a scoped social network graph for a session.
 *
 * Wraps `socialGraphService.getSessionSocialGraph` with scope params (units,
 * bunks, cross_scope) so the server returns a subgraph and runs a fresh fcose
 * layout on just the in-scope nodes — that's the real fix for "two distant
 * bunks stay distant when zoomed in." React Query caches per (session, year,
 * scenario, filter) tuple and uses `placeholderData: keepPreviousData` so
 * switching between filters renders the prior subgraph until the new one
 * arrives. Re-selecting a previously-fetched scope is instant.
 *
 * When `filter` is empty, this hook fetches the unscoped graph — no need to
 * switch hooks based on filter activity at the call site.
 */
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { socialGraphService } from '../services/socialGraph'
import type { GraphData } from '../types/graph'
import type { FilterState } from '../components/graph/graphFilter'
import { unitToSlug } from '../components/graph/graphFilter'
import { useYear } from './useCurrentYear'
import { useApiWithAuth } from './useApiWithAuth'
import { useScenario } from './useScenario'

/** Stable signature for the React Query key — sorted so equivalent filters
 *  hit the same cache slot regardless of selection order. */
function filterSignature(filter: FilterState): {
  units: string[]
  bunks: string[]
  cross: boolean
} {
  return {
    units: [...filter.units].map(unitToSlug).sort(),
    bunks: [...filter.bunks].map((b) => b.toLowerCase()).sort(),
    cross: filter.edgeMode === 'cross-scope',
  }
}

export function useScopedGraphData(sessionCmId: number, filter: FilterState) {
  const currentYear = useYear()
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()
  const { currentScenario } = useScenario()
  const scenarioId = currentScenario?.id ?? null

  const sig = filterSignature(filter)
  const isFilterActive = sig.units.length > 0 || sig.bunks.length > 0

  return useQuery<GraphData>({
    queryKey: [
      'social-graph-scoped',
      sessionCmId,
      currentYear,
      scenarioId,
      sig.units.join(','),
      sig.bunks.join(','),
      sig.cross,
    ],
    enabled: !isAuthLoading,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      return socialGraphService.getSessionSocialGraph(
        sessionCmId,
        currentYear,
        fetchWithAuth,
        scenarioId,
        isFilterActive
          ? {
              units: sig.units,
              bunks: sig.bunks,
              crossScope: sig.cross,
            }
          : undefined
      )
    },
  })
}
