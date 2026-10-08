import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { canOpenCamperships } from '../../config/programAccess'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidZip } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'
import { reportRetry } from './reportRetry'

/**
 * ZIP codes' one read (spec §9.4; D90; owner ruling C): one group's two tables, live only. `group`
 * null asks for the server's default (the summer group). `view` or `summary` (D65). Refreshed by every
 * money write and Funding sources edit (the reports prefix).
 */
export function useAidZip(group: string | null) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const params = useMemo((): Record<string, string> => (group === null ? {} : { group }), [group])
  return useQuery({
    queryKey: queryKeys.aidReport(year, 'zip', params),
    queryFn: () => fetchAidZip(fetchWithAuth, year, params),
    enabled: year > 0 && !authLoading && canOpenCamperships({ hasPermission }),
    retry: reportRetry,
  })
}
