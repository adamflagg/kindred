import { useQuery } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidApprovedRules, fetchAidRulesDraft } from '../../services/camperships/aidApi'
import { aidRetry } from '../../services/camperships/aidRetry'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/**
 * The approved rules, read only (spec §7.5; D76): for everyone with `view`. `version` is a
 * receipt's link (`?version=`); null reads each section as it prices the season. App cache defaults:
 * a rules approval refreshes it through `invalidateAidRulesQueries`.
 */
export function useAidApprovedRules(version: number | null, { enabled = true } = {}) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidRulesApproved(year, version),
    queryFn: () => fetchAidApprovedRules(fetchWithAuth, year, version),
    enabled: enabled && year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
    retry: aidRetry,
  })
}

/** The rules draft with its changes against the approved rules (spec §7.5; D39): `rules` only. */
export function useAidRulesDraft({ enabled = true } = {}) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidRulesDraft(year),
    queryFn: () => fetchAidRulesDraft(fetchWithAuth, year),
    enabled: enabled && year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_RULES),
    retry: aidRetry,
  })
}
