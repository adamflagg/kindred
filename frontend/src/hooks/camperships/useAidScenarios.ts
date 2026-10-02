import { useQuery } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import {
  fetchAidScenarioSensitivity,
  fetchAidScenarios,
  retryUnlessRefused,
} from '../../services/camperships/aidApi'
import type { ApiAidScenarioDraft, ApiAidScenarioSnapshot } from '../../types/api-types'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/** A refusal in the server's words (no rules yet, 404; nothing to start from, 422) answers at once. */
const retry = retryUnlessRefused([404, 422])

/**
 * Your scenario draft, every kept option and the snapshot they run on (spec §7.4; D38): `rules`
 * only (D76 hides Scenarios from everyone else). App cache defaults; every scenario write refreshes
 * it through `invalidateAidScenarioQueries`, a rules write through `invalidateAidRulesQueries`, and
 * a money write through `invalidateAidMoneyQueries`.
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
    retry,
  })
}

/**
 * What one step of each sizing setting moves Round 1 by (§7.4), for the draft as recorded, on every
 * frozen request (Decision 22: request sets live on the compare). The server prices the draft's
 * document on the frozen snapshot alone, so its key (the draft's trail row and the snapshot) is all
 * its answer depends on: a new release or a re-freeze asks again, and no invalidation touches it.
 * `rules` only, like every scenario route.
 */
export function useAidScenarioSensitivity(
  draft: ApiAidScenarioDraft | null,
  snapshot: ApiAidScenarioSnapshot | null
) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidScenarioSensitivity(year, draft?.trail_id ?? '', snapshot?.id ?? ''),
    queryFn: () =>
      draft === null
        ? Promise.reject(new Error('No draft'))
        : fetchAidScenarioSensitivity(fetchWithAuth, year, { document: draft.document }),
    enabled:
      year > 0 &&
      !authLoading &&
      hasPermission(Permission.FINANCIAL_AID_RULES) &&
      draft !== null &&
      snapshot !== null,
    retry,
  })
}
