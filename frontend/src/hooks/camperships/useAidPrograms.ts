import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { programsQuery } from '../../components/camperships/reports/reportParams'
import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidPrograms, type AidRequestSet } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'
import { reportRetry } from './reportRetry'
import { useAidAsOf } from './useAidAsOf'

/**
 * Statistics' By session read (spec §9.3; RPT-11; D21): one row per session, grouped by pool, with
 * the server's pooled subtotals and total, on the request set, live or by the page's past day. Needs
 * `view`. `enabled` false skips the read (Statistics reads it only on Session rows). Inherits the app's
 * cache defaults; refreshed by every money write (the reports prefix).
 */
export function useAidPrograms(requestSet: AidRequestSet, enabled = true) {
  const year = useYear()
  const asOf = useAidAsOf()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const params = useMemo(() => programsQuery(requestSet, asOf), [requestSet, asOf])
  return useQuery({
    queryKey: queryKeys.aidReport(year, 'programs', params),
    queryFn: () => fetchAidPrograms(fetchWithAuth, year, params),
    enabled: enabled && year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
    retry: reportRetry,
  })
}
