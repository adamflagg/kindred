import { useQuery } from '@tanstack/react-query'

import { useAuth } from '../../contexts/AuthContext'
import { pb } from '../../lib/pocketbase'
import { queryKeys } from '../../utils/queryKeys'
import { orderSessions } from '../../utils/sessionOrder'

/**
 * The season's session names, from PocketBase `camp_sessions`, read the way `useAdminSessions` reads
 * it (any signed-in user may list it). Session names don't change mid-season, so it inherits the
 * app's cache defaults rather than that hook's `userDataOptions` (Family Camp Models Summer's caching
 * rule: no reason to opt down). A completed sync refreshes it (`camp-sessions` is in
 * SYNC_DEPENDENT_PREFIXES), since a sync is what adds or renames a session. Decision 28; Ruling 2026-10-01 (plan review) M6.
 */
export function useAidSessionNames(year: number): ReadonlyMap<number, string> | undefined {
  const { isLoading } = useAuth()
  return useQuery({
    queryKey: queryKeys.campSessionNames(year),
    queryFn: async () => {
      const sessions = await pb.collection('camp_sessions').getFullList<{
        cm_id: number
        name: string
        session_type: string
        start_date: string
        end_date: string | null
        parent_id: number | null
      }>({
        filter: `year = ${String(year)}`,
        fields: 'cm_id,name,session_type,start_date,end_date,parent_id',
        sort: 'start_date,cm_id',
      })
      // The map iterates in the Camperships session order (owner Q8), so every picker built from it lists that way.
      const ordered = orderSessions(sessions, (s) => ({
        cm_id: s.cm_id,
        name: s.name,
        session_type: s.session_type,
        start_date: s.start_date,
        end_date: s.end_date ?? '',
        parent_cm_id: s.parent_id ?? 0,
      }))
      return new Map(ordered.map((s) => [s.cm_id, s.name] as const))
    },
    enabled: year > 0 && !isLoading,
  }).data
}
