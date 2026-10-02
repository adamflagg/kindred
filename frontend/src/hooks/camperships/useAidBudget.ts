import { useQuery } from '@tanstack/react-query'

import { asOfQuery } from '../../components/camperships/kit/asOf'
import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidBudget } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'
import { useAidAsOf } from './useAidAsOf'

/**
 * Rounds & budget's one read (spec §7.2; D21: the server does every sum). `view` holders only
 * (D48), live or as of the page's past day. Inherits the app's cache defaults (spec §10): every
 * money write refreshes it through `invalidateAidMoneyQueries`, a rules approval (its writer
 * lands in a later slice 2 PR) through this same helper once it exists, and a sync completion through the 'financial-aid' prefix.
 */
export function useAidBudget({ enabled = true }: { readonly enabled?: boolean } = {}) {
  const year = useYear()
  const asOf = useAidAsOf()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const past = asOf.kind === 'past' ? asOf : null
  return useQuery({
    queryKey: queryKeys.aidBudget(year, past?.date ?? null, past?.axis ?? null),
    queryFn: () => fetchAidBudget(fetchWithAuth, year, asOfQuery(asOf)),
    enabled: enabled && year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
  })
}
