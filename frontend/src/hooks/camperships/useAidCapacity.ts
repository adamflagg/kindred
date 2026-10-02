import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import {
  fetchAidSessionCapacities,
  retryUnlessRefused,
  setAidSessionCapacity,
} from '../../services/camperships/aidApi'
import type { ApiAidCapacityIn } from '../../types/api-types'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/**
 * The session capacities stored for the season (spec §6.3; view-level, like every Season read: the
 * registrar's too, D76). Live only: no as_of. Self-contained by Decision 23: nothing outside the capacity form reads it.
 * App cache defaults; the save below refreshes it.
 */
export function useAidSessionCapacities(year: number) {
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidCapacity(year),
    queryFn: () => fetchAidSessionCapacities(fetchWithAuth, year),
    enabled: year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
    retry: retryUnlessRefused([]),
  })
}

export interface CapacityVars {
  readonly sessionCmId: number
  readonly body: ApiAidCapacityIn
}

/**
 * Set a session's capacity for Round 3's context (spec §6.3; `rules`). It moves no money figure, so
 * it is not `invalidateAidMoneyQueries`. It refreshes the capacity read, History (the save logs a
 * "rules" row) and the household pages (Round 3's context carries capacity and its note), on settle:
 * a refusal can mean the figure moved. Returned, so `mutate`'s onSuccess runs after the form's read
 * has refetched and a reopened session shows the saved figure.
 */
export function useAidSetCapacity() {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: CapacityVars) =>
      setAidSessionCapacity(fetchWithAuth, year, vars.sessionCmId, vars.body),
    onSettled: () =>
      Promise.all(
        [
          queryKeys.aidCapacity(year),
          queryKeys.aidHistoryPrefix(),
          queryKeys.aidHouseholdPagePrefix(),
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey }))
      ).then(() => undefined),
  })
}
