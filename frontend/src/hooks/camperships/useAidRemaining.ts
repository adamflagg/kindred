import { useQuery } from '@tanstack/react-query'

import { asOfQuery } from '../../components/camperships/kit/asOf'
import { canOpenCamperships } from '../../config/programAccess'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidRemaining } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'
import { useAidAsOf } from './useAidAsOf'

/**
 * The Remaining line's read (D48, spec §7.3): one small server read, for everyone who can open
 * Camperships, summary-only users included (D75). Inherits the app's cache defaults (spec §10).
 * It refreshes through `invalidateAidMoneyQueries` on writes and the 'financial-aid' prefix on
 * sync completion.
 */
export function useAidRemaining() {
  const year = useYear()
  const asOf = useAidAsOf()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const past = asOf.kind === 'past' ? asOf : null
  return useQuery({
    queryKey: queryKeys.aidRemaining(year, past?.date ?? null, past?.axis ?? null),
    queryFn: () => fetchAidRemaining(fetchWithAuth, year, asOfQuery(asOf)),
    // Ruling 2026-10-01 (plan review): no read before the season is known (it is 0 until then).
    enabled: year > 0 && !authLoading && canOpenCamperships({ hasPermission }),
  })
}
