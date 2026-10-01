import { useQuery } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidJumpIndex } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/**
 * The jump box's index (§3.5, §10): every household with aid activity, loaded once and searched
 * in memory, with no server call per keystroke. `view` only (D65). App cache defaults; a sync
 * refreshes it through the 'financial-aid' prefix.
 */
export function useAidJumpIndex() {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidJumpIndex(year),
    queryFn: () => fetchAidJumpIndex(fetchWithAuth, year),
    // No read before the season is known (it is 0 until then).
    enabled: year > 0 && !isLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
  })
}
