import { useQuery } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidScenarios, retryUnlessRefused } from '../../services/camperships/aidApi'
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
