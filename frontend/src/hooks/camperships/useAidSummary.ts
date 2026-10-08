import { useQuery } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidSummary } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'
import { useAidAsOf } from './useAidAsOf'

/**
 * The Ledger tab's posted totals by program and source family (inventory F10; Decision P-11):
 * `GET /summary`, live or by the page's past day (the route has one axis, CampMinder's post day).
 * `view`. Under the ledger prefix: every Camperships write refreshes it (a placement moves its
 * levels; a classification shows after the next ledger sync, which rewrites the postings it reads,
 * R3-21), and a ledger sync through the 'financial-aid' prefix.
 */
export function useAidSummary({ enabled = true }: { readonly enabled?: boolean } = {}) {
  const year = useYear()
  const asOf = useAidAsOf()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const date = asOf.kind === 'past' ? asOf.date : null
  return useQuery({
    queryKey: queryKeys.aidSummary(year, date),
    queryFn: () => fetchAidSummary(fetchWithAuth, year, date),
    enabled: enabled && year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
  })
}
