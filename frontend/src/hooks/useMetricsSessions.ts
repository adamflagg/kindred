/**
 * Hook to fetch sessions for the metrics session dropdown.
 *
 * Returns main and embedded sessions for a given year, sorted by start_date.
 */

import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'
import { pb } from '../lib/pocketbase'
import { sortSessionsByDate } from '../utils/sessionUtils'
import { useAuth } from '../contexts/AuthContext'

export interface MetricsSession {
  cm_id: number
  name: string
  session_type: 'main' | 'embedded' | 'quest'
  start_date: string
  end_date: string
}

/**
 * Fetch sessions available for the metrics session dropdown.
 *
 * Returns main, embedded, and quest session types (not ag, family, etc.)
 * since those are the summer camp sessions for metrics analysis.
 */
export function useMetricsSessions(year: number) {
  const { isLoading } = useAuth()

  return useQuery({
    queryKey: queryKeys.metricsSessions(year),
    queryFn: async (): Promise<MetricsSession[]> => {
      const sessions = await pb.collection('camp_sessions').getFullList({
        filter: `year = ${year} && (session_type = "main" || session_type = "embedded" || session_type = "quest")`,
        sort: 'start_date',
      })

      const mapped = sessions.map((s) => ({
        cm_id: s.cm_id,
        name: s.name,
        session_type: s.session_type as 'main' | 'embedded' | 'quest',
        start_date: s.start_date,
        end_date: s.end_date,
      }))
      return sortSessionsByDate(mapped)
    },
    enabled: year > 0 && !isLoading,
    placeholderData: keepPreviousData,
    // Sessions rarely change - use sync data options for long cache
    ...syncDataOptions,
  })
}
