/**
 * Export a Family Camp weekend's family-facing roster to Google Sheets.
 * kindred#2433, design §4.6.
 *
 * The export APPENDS a new date-stamped tab to that weekend's workbook and never
 * overwrites one, so pressing this twice is safe and is a thing staff do —
 * they hand-edit every tab and copy their work forward from the previous one.
 *
 * The workbook lands in Drive, not in the app, so surfacing the link IS the
 * completion of the action rather than a nicety.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Loader2, TableProperties } from 'lucide-react'

import { useApiWithAuth } from '../../hooks/useApiWithAuth'
import { queryKeys } from '../../utils/queryKeys'

const ENDPOINT = '/api/custom/lodging/roster-export'

/** What the export endpoint returns (pocketbase/sync/family_camp_roster_export.go). */
export interface RosterExportResult {
  spreadsheet_id: string
  url: string
  title: string
  tab_name: string
  session_cm_id: number
  session_name: string
  year: number
  household_count: number
  camper_count: number
  adult_count: number
  person_count: number
}

export interface RosterExportButtonProps {
  year: number
  /** 0 means no weekend is selected, and there is nothing to export. */
  sessionCmId: number
  /**
   * The weekend's `camp_sessions.session_type`. Only `family` weekends have a
   * roster: adult weekends enrol individuals rather than households and carry
   * no `family_camp_adults` rows, so the endpoint refuses them.
   */
  sessionType: string
}

/**
 * This is a PocketBase custom route, not FastAPI — its errors carry `error`,
 * not `detail`. Same shape as SeasonRollForwardPanel's reader, which covers the
 * only other `/api/custom/lodging` endpoint.
 *
 * The message is worth surfacing rather than flattening to a status: the
 * endpoint's refusals are prose staff can act on ("session has no enrolled
 * campers" tells them the weekend is empty), which a bare 400 does not.
 */
async function toError(response: Response, fallback: string): Promise<Error> {
  let message: unknown
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'error' in body) {
      message = (body as { error?: unknown }).error
    }
  } catch {
    message = undefined
  }
  if (typeof message === 'string' && message.length > 0) return new Error(message)
  return new Error(`${fallback} (HTTP ${String(response.status)})`)
}

export function RosterExportButton({ year, sessionCmId, sessionType }: RosterExportButtonProps) {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  const [isExporting, setIsExporting] = useState(false)
  // Local, unlike the result: an error describes the LAST ATTEMPT, not a
  // durable fact about the weekend. Persisting it would re-report a failure
  // that is not happening now every time staff returned to the tab.
  const [error, setError] = useState<string | null>(null)

  const exportKey = queryKeys.rosterExport(year, sessionCmId)

  // The cache as a store, not a fetch. `enabled: false` means React Query never
  // calls a queryFn — which is the point, because "refetching" here would POST
  // again and append a second tab to a workbook full of hand edits. The slot is
  // written by handleExport below, and read here so the link survives leaving
  // the roster tab and coming back.
  const { data: result } = useQuery<RosterExportResult | null>({
    queryKey: exportKey,
    // Declared and never callable. `enabled: false` already stops React Query
    // running it, but the option is not optional: without it React Query logs
    // "No queryFn was passed as an option" on every render. Throwing is the
    // right body -- if anything ever does reach it (a stray `refetch`, a
    // default queryFn added later), failing loudly beats the alternative,
    // which is a second POST appending another tab to a workbook of hand edits.
    queryFn: () => {
      throw new Error(
        'The roster export cache slot is written by the export itself and must never be fetched'
      )
    },
    enabled: false,
    initialData: null,
    staleTime: Infinity,
  })

  // Rendered only where an export can succeed. The API refuses both of these
  // too — this keeps the UI from offering an affordance whose only outcome is
  // an error message.
  if (sessionType !== 'family' || sessionCmId <= 0) return null

  const handleExport = async () => {
    setIsExporting(true)
    // Both cleared up front: re-exporting is normal, and a stale link sitting
    // beside a fresh failure would read as a success.
    setError(null)
    queryClient.setQueryData<RosterExportResult | null>(exportKey, null)
    try {
      const response = await fetchWithAuth(
        `${ENDPOINT}?year=${String(year)}&session=${String(sessionCmId)}`,
        { method: 'POST' }
      )
      if (!response.ok) throw await toError(response, 'Failed to export the roster')
      queryClient.setQueryData<RosterExportResult>(
        exportKey,
        (await response.json()) as RosterExportResult
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to export the roster')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    // ONE ROW, deliberately. Stacking the result under the button grew the
    // toolbar the moment an export finished and shoved the whole roster table
    // down the page. Everything here stays on the button's line, and the
    // message truncates rather than wrapping, so the table never moves.
    <div className="flex min-w-0 items-center justify-end gap-2">
      {result && (
        <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex flex-shrink-0 items-center gap-1 font-medium hover:underline"
          >
            Open
            <ExternalLink className="h-3 w-3" />
          </a>
          <span className="hidden truncate tabular-nums lg:inline">{result.tab_name}</span>
          <span className="hidden truncate tabular-nums xl:inline">
            {result.household_count} households · {result.person_count} people
          </span>
        </span>
      )}

      {error && (
        // `title` carries the untruncated text: the endpoint's refusals name the
        // weekend and its ids, which is longer than one toolbar line.
        <span
          title={error}
          className="max-w-56 truncate text-xs text-red-700 lg:max-w-md dark:text-red-400"
        >
          {error}
        </span>
      )}

      <button
        type="button"
        onClick={() => {
          void handleExport()
        }}
        disabled={isExporting}
        className="btn-secondary flex flex-shrink-0 items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isExporting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <TableProperties className="h-4 w-4" />
        )}
        {isExporting ? 'Exporting…' : 'Export Roster'}
      </button>
    </div>
  )
}
