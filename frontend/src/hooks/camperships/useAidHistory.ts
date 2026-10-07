import { useQuery } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidHistoryOperation, hasStatus } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/** A 404 (no such operation this season, or a rules one without `rules`) is an answer, not a fault. */
function retryUnlessMissing(failureCount: number, error: Error): boolean {
  return !hasStatus(error, 404) && !hasStatus(error, 401) && failureCount < 3
}

/** One operation's rows, read when its line opens (D49: a bulk operation expands to its rows); `enabled` holds the read until a caller needs it. */
export function useAidHistoryOperation(
  operationId: string,
  { enabled = true }: { enabled?: boolean } = {}
) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidHistoryOperation(year, operationId),
    queryFn: () => fetchAidHistoryOperation(fetchWithAuth, year, operationId),
    enabled: enabled && year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
    retry: retryUnlessMissing,
  })
}
