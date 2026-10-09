import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { committeeQuery } from '../../components/camperships/reports/reportParams'
import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidCommitteeReport, type AidRequestSet } from '../../services/camperships/aidApi'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'
import { reportRetry } from './reportRetry'

/**
 * The committee's year-over-year tables (spec §9.7; S4-2): one read, seasons 2022 to this one, P rows
 * from the dashboard's decisions and r rows from finance's typed history. Live only (the route has no
 * as-of). A received-through date moves this season's RPT-2 cutoff. `view`. Refreshed by every money
 * write (the reports prefix) and a sync; a typed-history load has no screen (Decision 22).
 */
export function useAidCommitteeReport(requestSet: AidRequestSet, enabled = true) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  const params = useMemo(() => committeeQuery(requestSet), [requestSet])
  return useQuery({
    queryKey: queryKeys.aidReport(year, 'committee', params),
    queryFn: () => fetchAidCommitteeReport(fetchWithAuth, year, params),
    enabled: enabled && year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
    retry: reportRetry,
  })
}
