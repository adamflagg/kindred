import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { canOpenCamperships } from '../../config/programAccess'
import { useAuth } from '../../contexts/AuthContext'
import {
  fetchAidDevelopment,
  fetchAidReportColumns,
  saveAidReportColumns,
} from '../../services/camperships/aidApi'
import type { ApiAidReportColumnsIn } from '../../types/api-types'
import { queryKeys } from '../../utils/queryKeys'
import { useApiWithAuth } from '../useApiWithAuth'
import { useYear } from '../useCurrentYear'
import { usePermissions } from '../usePermissions'
import { reportRetry } from './reportRetry'
import { useAidWrite } from './useAidWrites'

const NO_PARAMS: Readonly<Record<string, string>> = {}

/**
 * Reports › Development's one read (spec §9.4; D65, D87–D94): live only (dated columns are its
 * past views). `view` or `summary`: development reads it with no `view` (D65). Refreshed by every
 * money write and Funding sources edit (the reports prefix), and a dated-column save.
 */
export function useAidDevelopment() {
  const year = useYear()
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidReport(year, 'development', NO_PARAMS),
    queryFn: () => fetchAidDevelopment(fetchWithAuth, year),
    enabled: year > 0 && !authLoading && canOpenCamperships({ hasPermission }),
    retry: reportRetry,
  })
}

/** The saved dated columns (one shared list, D68). `view` or `summary`. */
export function useAidReportColumns() {
  const { fetchWithAuth } = useApiWithAuth()
  const { isLoading: authLoading } = useAuth()
  const { hasPermission } = usePermissions()
  return useQuery({
    queryKey: queryKeys.aidReportColumns(),
    queryFn: () => fetchAidReportColumns(fetchWithAuth),
    enabled: !authLoading && canOpenCamperships({ hasPermission }),
    retry: reportRetry,
  })
}

/**
 * The saved list past the cache (staleTime 0), read just before a change is sent, so an add or a
 * remove applies to the list as it stands and never drops a colleague's column (Decision 17).
 */
export function useFreshAidReportColumns() {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  return useCallback(
    () =>
      queryClient.fetchQuery({
        queryKey: queryKeys.aidReportColumns(),
        queryFn: () => fetchAidReportColumns(fetchWithAuth),
        staleTime: 0,
      }),
    [fetchWithAuth, queryClient]
  )
}

/**
 * Save the whole list. It settles through `invalidateAidMoneyQueries`, whose reports prefix refreshes
 * the columns read and Development (the money reads it also marks stale cost nothing unmounted).
 */
export function useAidSaveReportColumns() {
  return useAidWrite((fetchWithAuth, body: ApiAidReportColumnsIn) =>
    saveAidReportColumns(fetchWithAuth, body)
  )
}
