import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { useYear } from './useCurrentYear'
import { useScenario } from './useScenario'
import { useApiWithAuth } from './useApiWithAuth'
import type { SatisfactionResponse } from '../types/satisfaction'
import { queryKeys } from '../utils/queryKeys'

/**
 * `/api/satisfaction` for one session: the single source of truth for "is
 * request X satisfied?". Keyed by session, year and the active scenario.
 *
 * BunkRequestProvider and the full camper page both read it through this
 * hook, so they share one cache entry and one set of invalidations
 * (`queryKeys.satisfactionPrefix()`). Pass `enabled: false` where the result
 * would not be shown.
 *
 * `year` defaults to the app's global year. The full camper page passes its
 * `?year=` year: CampMinder reuses session ids across years, so asking for
 * another year's session under the global year returns the current year's
 * result for that id. The active scenario is a draft of the global year, so
 * it applies only there; any other year reads production.
 */
export function useSessionSatisfaction(
  sessionCmId: number,
  { enabled = true, year }: { enabled?: boolean; year?: number } = {}
) {
  const appYear = useYear()
  const currentYear = year ?? appYear
  const { user, isLoading: isAuthLoading } = useAuth()
  const { currentScenario } = useScenario()
  const { fetchWithAuth } = useApiWithAuth()
  const scenarioId = currentYear === appYear ? (currentScenario?.id ?? null) : null

  return useQuery<SatisfactionResponse>({
    queryKey: queryKeys.satisfaction(sessionCmId, currentYear, scenarioId),
    queryFn: async () => {
      const params = new URLSearchParams({
        session: String(sessionCmId),
        year: String(currentYear),
      })
      if (scenarioId) params.set('scenario', scenarioId)
      const response = await fetchWithAuth(`/api/satisfaction?${params}`)
      if (!response.ok) {
        throw new Error(`/api/satisfaction failed: ${response.status}`)
      }
      return (await response.json()) as SatisfactionResponse
    },
    staleTime: 30 * 1000, // matches social-graph staleness
    gcTime: 10 * 60 * 1000,
    enabled: enabled && !!user && !isAuthLoading && sessionCmId > 0,
  })
}
