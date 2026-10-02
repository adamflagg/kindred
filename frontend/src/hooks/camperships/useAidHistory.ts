import { useQuery } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import {
  fetchAidHistory,
  fetchAidHistoryOperation,
  hasStatus,
} from '../../services/camperships/aidApi'
import type { ApiAidHistoryPage } from '../../types/api-types'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/** A 404 (no such operation this season, or a rules one without `rules`) is an answer, not a fault. */
function retryUnlessMissing(failureCount: number, error: Error): boolean {
  return !hasStatus(error, 404) && !hasStatus(error, 401) && failureCount < 3
}

/**
 * Season › History's page of the log (spec §7.6; D49; D21: the server groups, filters and pages).
 * `query` is historyModel's `historyQuery`. App cache defaults; every aid write refreshes it
 * (`invalidateAidMoneyQueries`, `invalidateAidRulesQueries`), a sync through the 'financial-aid'
 * prefix. The page on screen stays while the next page or filter loads, within one season.
 */
export function useAidHistory(query: Readonly<Record<string, string>>) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidHistory(year, query),
    queryFn: () => fetchAidHistory(fetchWithAuth, year, query),
    enabled: year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
    placeholderData: (previous: ApiAidHistoryPage | undefined) =>
      previous?.year === year ? previous : undefined,
  })
}

/** One operation's rows, read when its line opens (D49: a bulk operation expands to its rows). */
export function useAidHistoryOperation(operationId: string) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidHistoryOperation(year, operationId),
    queryFn: () => fetchAidHistoryOperation(fetchWithAuth, year, operationId),
    enabled: year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
    retry: retryUnlessMissing,
  })
}
