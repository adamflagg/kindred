import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { FetchWithAuth } from '../../services/lodgingApi'
import { invalidateAidMoneyQueries, type AidRefresh } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'

/**
 * One Camperships write (spec §10; #2924's invalidation table). It refreshes on settle, not only
 * on success: a refusal can mean the data moved under the person (a 409), and they should see it.
 * `refresh` names what the write moves beyond the base reads (`AidRefresh`; slice 3's writers).
 */
export function useAidWrite<Vars, Out>(
  write: (fetchWithAuth: FetchWithAuth, vars: Vars) => Promise<Out>,
  refresh: AidRefresh = {}
) {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: Vars) => write(fetchWithAuth, vars),
    // Returned: mutateAsync resolves after the reads refresh, so a reopened editor (M8's remount)
    // starts from the saved figure, never the old one (build ruling 1).
    onSettled: () => invalidateAidMoneyQueries(queryClient, refresh),
  })
}
