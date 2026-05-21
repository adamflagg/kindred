/**
 * Hook to fetch sessions for the metrics session dropdown.
 *
 * Returns main, embedded, quest, scit, and tli sessions for a given year,
 * sorted by start_date. Teen sessions (scit/tli) are window-gated so only
 * those overlapping the summer main-session window reach the picker.
 */

import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'
import { pb } from '../lib/pocketbase'
import { sortSessionsByDate } from '../utils/sessionUtils'
import { useAuth } from '../contexts/AuthContext'
import {
  getSummerWindow,
  isSummerTeenSession,
  TEEN_PROGRAM_TYPES,
} from '../utils/sessionTypePredicates'

export interface MetricsSession {
  cm_id: number
  name: string
  session_type: 'main' | 'embedded' | 'quest' | 'scit' | 'tli'
  start_date: string
  end_date: string
}

/**
 * Fetch sessions available for the metrics session dropdown.
 *
 * Returns main, embedded, quest, scit, and tli session types (not ag, family,
 * etc.) since those are the summer camp sessions for metrics analysis. Teen
 * sessions (scit/tli) are window-gated against the summer main-session window
 * so off-season teen programs never appear in the picker.
 */
export function useMetricsSessions(year: number) {
  const { isLoading } = useAuth()

  return useQuery({
    queryKey: queryKeys.metricsSessions(year),
    queryFn: async (): Promise<MetricsSession[]> => {
      const sessions = await pb.collection('camp_sessions').getFullList({
        filter: `year = ${year} && (session_type = "main" || session_type = "embedded" || session_type = "quest" || session_type = "scit" || session_type = "tli")`,
        sort: 'start_date',
      })

      const mapped = sessions.map((s) => ({
        cm_id: s.cm_id,
        name: s.name,
        session_type: s.session_type as 'main' | 'embedded' | 'quest' | 'scit' | 'tli',
        start_date: s.start_date,
        end_date: s.end_date,
      }))

      // Gate teen sessions to only those overlapping the summer main-session window.
      // Non-teen sessions pass through unchanged.
      const window = getSummerWindow(mapped)
      const gated = mapped.filter(
        (s) =>
          !TEEN_PROGRAM_TYPES.includes(s.session_type as (typeof TEEN_PROGRAM_TYPES)[number]) ||
          isSummerTeenSession(s, window)
      )
      return sortSessionsByDate(gated)
    },
    enabled: year > 0 && !isLoading,
    placeholderData: keepPreviousData,
    // Sessions rarely change - use sync data options for long cache
    ...syncDataOptions,
  })
}
