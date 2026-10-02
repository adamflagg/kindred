import { useQuery } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import {
  fetchAidScenarioSensitivity,
  fetchAidScenarios,
  hasStatus,
} from '../../services/camperships/aidApi'
import type {
  ApiAidScenarioDraft,
  ApiAidScenarioSnapshot,
  ApiAidScenarioViewIn,
} from '../../types/api-types'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/** A refusal in the server's words (no rules yet, 404; nothing to start from, 422) answers at once. */
function retryUnlessRefused(failureCount: number, error: Error): boolean {
  return (
    !hasStatus(error, 404) && !hasStatus(error, 422) && !hasStatus(error, 401) && failureCount < 3
  )
}

/**
 * Your scenario draft, every kept option and the snapshot they run on (spec §7.4; D38): `rules`
 * only (D76 hides Scenarios from everyone else). App cache defaults; every scenario write refreshes
 * it through `invalidateAidScenarioQueries`, and a rules write through `invalidateAidRulesQueries`.
 */
export function useAidScenarios() {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidScenarios(year),
    queryFn: () => fetchAidScenarios(fetchWithAuth, year),
    enabled: year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_RULES),
    retry: retryUnlessRefused,
  })
}

/**
 * What one step of each sizing setting moves Round 1 by (§7.4), for the draft as recorded, on the
 * whole season or on a request set (D138). Its key is everything its answer depends on (the draft's
 * trail row, the snapshot, the request set), so a new release or a re-freeze asks again and no
 * invalidation touches it. `rules` only, like every scenario route.
 */
export function useAidScenarioSensitivity(
  draft: ApiAidScenarioDraft | null,
  snapshot: ApiAidScenarioSnapshot | null,
  requestSet: Pick<ApiAidScenarioViewIn, 'through_round1_deadline' | 'received_through'> = {}
) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const requestSetKey =
    requestSet.through_round1_deadline === true
      ? 'round1_deadline'
      : (requestSet.received_through ?? 'all')
  return useQuery({
    queryKey: queryKeys.aidScenarioSensitivity(
      year,
      draft?.trail_id ?? '',
      snapshot?.id ?? '',
      requestSetKey
    ),
    queryFn: () =>
      draft === null
        ? Promise.reject(new Error('No draft'))
        : fetchAidScenarioSensitivity(fetchWithAuth, year, {
            document: draft.document,
            ...(requestSet.through_round1_deadline === true
              ? { through_round1_deadline: true }
              : {}),
            ...(requestSet.received_through
              ? { received_through: requestSet.received_through }
              : {}),
          }),
    enabled:
      year > 0 &&
      !authLoading &&
      hasPermission(Permission.FINANCIAL_AID_RULES) &&
      draft !== null &&
      snapshot !== null,
    retry: retryUnlessRefused,
  })
}
