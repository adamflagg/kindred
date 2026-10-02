import { useQuery } from '@tanstack/react-query'

import { useAuth } from '../../contexts/AuthContext'
import { pb } from '../../lib/pocketbase'
import { queryKeys } from '../../utils/queryKeys'

/**
 * The season's session names, from PocketBase `camp_sessions`, read the way `useAdminSessions` reads
 * it (any signed-in user may list it). Session names don't change mid-season, so it inherits the
 * app's cache defaults rather than that hook's `userDataOptions` (Family Camp Models Summer's caching
 * rule: no reason to opt down). Decision 28; Ruling 2026-10-01 (plan review) M6.
 */
export function useAidSessionNames(year: number): ReadonlyMap<number, string> | undefined {
  const { isLoading } = useAuth()
  return useQuery({
    queryKey: queryKeys.campSessionNames(year),
    queryFn: async () => {
      const sessions = await pb
        .collection('camp_sessions')
        .getFullList<{ cm_id: number; name: string }>({
          filter: `year = ${String(year)}`,
          fields: 'cm_id,name',
          sort: 'start_date',
        })
      return new Map(sessions.map((s) => [s.cm_id, s.name] as const))
    },
    enabled: year > 0 && !isLoading,
  }).data
}
