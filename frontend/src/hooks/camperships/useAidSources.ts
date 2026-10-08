import { useQuery } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidSources } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/**
 * The sources registry (spec §8.1; D58, D88, D100, D105): every CampMinder description with its
 * classification, grantor, and this season's lines and $ (`?year=`). `view` or `grantors` (owner
 * ruling 2026-10-01: development, which has no `view`, reads what it edits). Inherits the app's
 * cache defaults: a classification, grantor or group write refreshes it (`invalidateAidMoneyQueries`'s
 * `registry`), a reclassification or a placement moves nothing it shows until the next ledger sync,
 * and the sync refreshes the whole 'financial-aid' prefix.
 */
export function useAidSources({ enabled = true }: { readonly enabled?: boolean } = {}) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const allowed =
    hasPermission(Permission.FINANCIAL_AID_VIEW) || hasPermission(Permission.FINANCIAL_AID_GRANTORS)
  return useQuery({
    queryKey: queryKeys.aidSources(year),
    queryFn: () => fetchAidSources(fetchWithAuth, year),
    enabled: enabled && year > 0 && !authLoading && allowed,
  })
}
