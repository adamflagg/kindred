import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'

import { Permission } from '../../constants/permissions'
import { useAuth } from '../../contexts/AuthContext'
import { fetchAidHistory } from '../../services/camperships/aidApi'
import type { ApiAidHistoryPage } from '../../types/api-types'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'

/**
 * Season › History's log as pages for the box's endless scroll (spec §7.2 C). `query` is the filters
 * (`historyQuery` at page 1); each page is `?page=n&per_page=50`. App cache defaults; every aid write refreshes it
 * through the history prefix. While a filter change re-reads, the old pages stay on screen (dimmed, "Updating…").
 */
export function useAidHistoryPages(query: Readonly<Record<string, string>>) {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useInfiniteQuery({
    queryKey: queryKeys.aidHistoryPages(year, query),
    queryFn: ({ pageParam }) =>
      fetchAidHistory(fetchWithAuth, year, { ...query, page: String(pageParam) }),
    initialPageParam: 1,
    getNextPageParam: (last: ApiAidHistoryPage) =>
      last.page * last.per_page < last.total ? last.page + 1 : undefined,
    enabled: year > 0 && !authLoading && hasPermission(Permission.FINANCIAL_AID_VIEW),
    placeholderData: (previous: InfiniteData<ApiAidHistoryPage, number> | undefined) =>
      previous?.pages[0]?.year === year ? previous : undefined,
  })
}
