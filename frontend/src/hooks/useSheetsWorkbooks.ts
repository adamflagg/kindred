/**
 * Hook to fetch Google Sheets workbooks metadata
 * Used by the SheetsPage to display workbook links and status
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { queryKeys } from '../utils/queryKeys'
import toast from 'react-hot-toast'

/**
 * Workbook record from sheets_workbooks collection
 */
export interface SheetsWorkbook {
  id: string
  spreadsheet_id: string
  workbook_type: 'globals' | 'year' | 'fc_roster'
  year: number
  /** Set only on fc_roster workbooks: the weekend they belong to. */
  session_cm_id?: number
  title: string
  url: string
  tab_count: number
  total_records: number
  status: 'ok' | 'error' | 'syncing'
  error_message: string
  created: string
  last_sync: string
}

/**
 * Family Camp roster workbooks share the sheets_workbooks collection but are a
 * different surface from the data export this tab is about: one per weekend, in
 * a Drive folder with a deliberately narrower audience, reached through the
 * roster toolbar rather than here (kindred#2433).
 *
 * Excluding them is not cosmetic. SheetsTab labels every non-globals row with
 * `String(workbook.year)`, so 2026's eight enrolled weekends would render as
 * eight rows all reading "2026", sitting beside the real 2026 data workbook and
 * each opening something else.
 */
export const SHEETS_WORKBOOK_LIST_FILTER = 'workbook_type != "fc_roster"'

/**
 * Fetch the data-export workbooks, ordered by year descending.
 *
 * Exported separately from the hook so the filter is testable without rendering.
 */
export async function fetchSheetsWorkbooks(): Promise<SheetsWorkbook[]> {
  try {
    return await pb.collection('sheets_workbooks').getFullList<SheetsWorkbook>({
      filter: SHEETS_WORKBOOK_LIST_FILTER,
      sort: '-year,workbook_type',
    })
  } catch (error) {
    console.error('Failed to load sheets workbooks:', error)
    return []
  }
}

/**
 * Hook to fetch the data-export workbooks for the admin Sheets tab.
 */
export function useSheetsWorkbooks() {
  return useQuery({
    queryKey: queryKeys.sheetsWorkbooks(),
    queryFn: fetchSheetsWorkbooks,
    // Refetch every 30 seconds to catch status updates
    refetchInterval: 30000,
  })
}

/**
 * Hook for triggering multi-workbook export
 */
export function useMultiWorkbookExport() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params?: { years?: number[]; includeGlobals?: boolean }) => {
      let url = '/api/custom/sync/multi-workbook-export'
      const queryParams = new URLSearchParams()

      if (params?.years && params.years.length > 0) {
        queryParams.set('years', params.years.join(','))
      }
      if (params?.includeGlobals !== undefined) {
        queryParams.set('includeGlobals', params.includeGlobals ? 'true' : 'false')
      }

      if (queryParams.toString()) {
        url += '?' + queryParams.toString()
      }

      const response = await pb.send(url, {
        method: 'POST',
      })
      return response
    },
    onSuccess: (data) => {
      if (data?.status === 'started') {
        toast('Multi-workbook export started', {
          icon: '\u2713',
          duration: 5000,
          className: 'toast-lodge toast-lodge-success',
          style: {
            borderLeft: '4px solid hsl(160, 100%, 21%)',
          },
        })
      }
      // Invalidate workbooks to show status change
      void queryClient.invalidateQueries({ queryKey: queryKeys.sheetsWorkbooks() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.syncStatus() })
    },
    onError: (error) => {
      let errorMessage = error instanceof Error ? error.message : 'Unknown error'
      if (errorMessage.includes('already in progress')) {
        errorMessage = 'Multi-workbook export is already running.'
      }
      toast.error(errorMessage)
    },
  })
}

/**
 * Hook for refreshing the master index
 */
export function useRefreshMasterIndex() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const response = await pb.send('/api/custom/sync/multi-workbook-export?includeGlobals=true', {
        method: 'POST',
      })
      return response
    },
    onSuccess: () => {
      toast('Master index refresh started', {
        icon: '\u2713',
        duration: 3000,
        className: 'toast-lodge toast-lodge-success',
        style: {
          borderLeft: '4px solid hsl(160, 100%, 21%)',
        },
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.sheetsWorkbooks() })
    },
    onError: (error) => {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      toast.error(errorMessage)
    },
  })
}
