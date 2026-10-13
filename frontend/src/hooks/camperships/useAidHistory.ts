import { useQuery } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidHistoryOperation } from '../../services/camperships/aidApi'
import { aidRetry } from '../../services/camperships/aidRetry'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

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
    retry: aidRetry,
  })
}
