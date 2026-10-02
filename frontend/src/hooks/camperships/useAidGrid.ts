import { useQuery } from '@tanstack/react-query'

import { asOfQuery } from '../../components/camperships/kit/asOf'
import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidGrid } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'
import { useAidAsOf } from './useAidAsOf'

/**
 * The Requests grid's read (§6.1; D21): the season's every request, loaded whole and filtered in
 * memory (§10). `view` only. It inherits the app's cache defaults; every write and a sync completion
 * invalidate it (invalidateAidMoneyQueries, the 'financial-aid' prefix).
 * - `enabled: false`: the household page reads it only when it walks a queue (§3.5).
 * - `live`: it ignores the page's as-of, since the household page is live only (slice 1 Decision 36).
 */
export function useAidGrid({
  enabled = true,
  live = false,
}: { readonly enabled?: boolean; readonly live?: boolean } = {}) {
  const year = useYear()
  const pageAsOf = useAidAsOf()
  const asOf = live ? ({ kind: 'live' } as const) : pageAsOf
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const past = asOf.kind === 'past' ? asOf : null
  return useQuery({
    queryKey: queryKeys.aidGrid(year, past?.date ?? null, past?.axis ?? null),
    queryFn: () => fetchAidGrid(fetchWithAuth, year, asOfQuery(asOf)),
    enabled: enabled && year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
  })
}
