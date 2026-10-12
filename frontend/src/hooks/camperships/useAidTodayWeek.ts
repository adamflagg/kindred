import { useQuery } from '@tanstack/react-query'

import { canOpenCamperships } from '../../config/programAccess'
import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidTodayWeek } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/**
 * Today's This week column (spec 2026-10-10 §8): the same permissions as useAidToday, its own read so a failure blanks
 * only the right column. Its key sits under aidTodayPrefix, so every aid write that clears Today clears this too.
 */
export function useAidTodayWeek() {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidTodayWeek(year),
    queryFn: () => fetchAidTodayWeek(fetchWithAuth, year),
    enabled:
      year > 0 &&
      !authLoading &&
      (canOpenCamperships({ hasPermission }) || hasPermission(Permission.FINANCIAL_AID_GRANTORS)),
  })
}
