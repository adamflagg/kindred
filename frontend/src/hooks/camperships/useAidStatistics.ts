import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import {
  statisticsQuery,
  type StatisticsChoice,
} from '../../components/camperships/reports/reportParams'
import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidStatistics } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'
import { reportRetry } from './reportRetry'
import { useAidAsOf } from './useAidAsOf'

/**
 * Reports › Statistics' one read (spec §9.2; D21): the tier table, RPT-9, RPT-22 and RPT-23 for one
 * award table × round, on the chosen basis and request set, live or by the page's past day. `view`.
 * Inherits the app's cache defaults: every Camperships write refreshes it through
 * `invalidateAidMoneyQueries` (the reports prefix), and a sync through the 'financial-aid' prefix.
 */
export function useAidStatistics(choice: StatisticsChoice, enabled = true) {
  const year = useYear()
  const asOf = useAidAsOf()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const params = useMemo(() => statisticsQuery(choice, asOf), [choice, asOf])
  return useQuery({
    queryKey: queryKeys.aidReport(year, 'statistics', params),
    queryFn: () => fetchAidStatistics(fetchWithAuth, year, params),
    enabled: enabled && year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
    retry: reportRetry,
  })
}
