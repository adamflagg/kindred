import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { asOfQuery } from '../../components/camperships/kit/asOf'
import type { ReportAddress } from '../../components/camperships/requests/reportFilter'
import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidReportRequests } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'
import { reportRetry } from './reportRetry'
import { useAidAsOf } from './useAidAsOf'

/**
 * The requests behind one Reports count (slice 4 J; D20): the grid's `?report=` filter. Read on the
 * grid's own as-of, so the ids and the rows are the same day. `view` only (D65). Under the reports
 * prefix, so every write refreshes it with the count it came from; app cache defaults otherwise.
 */
export function useAidReportRequests(address: ReportAddress | null) {
  const year = useYear()
  const asOf = useAidAsOf()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const params = useMemo(
    () => (address === null ? {} : { ...address.query, ...asOfQuery(asOf) }),
    [address, asOf]
  )
  const report = address?.report ?? 'statistics'
  return useQuery({
    queryKey: queryKeys.aidReportRequests(year, report, params),
    queryFn: () => fetchAidReportRequests(fetchWithAuth, year, report, params),
    enabled:
      address !== null && year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
    retry: reportRetry,
  })
}
