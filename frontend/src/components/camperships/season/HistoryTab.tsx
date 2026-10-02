import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router'

import { Permission } from '../../../constants/permissions'
import { useAidAsOf } from '../../../hooks/camperships/useAidAsOf'
import { useAidHistory } from '../../../hooks/camperships/useAidHistory'
import { useYear } from '../../../hooks/useCurrentYear'
import { usePermissions } from '../../../hooks/usePermissions'
import type { ApiAidHistoryPage } from '../../../types/api-types'
import { BUTTON_SECONDARY } from '../../admin/lodging/lodgingStyles'
import { QueryGuard } from '../../QueryGuard'
import type { AidView } from '../kit/asOf'
import { DefinitionNotes, type DefinitionNote } from '../kit/DefinitionNotes'
import { HistoryFilters } from './HistoryFilters'
import {
  historyQuery,
  lastPage,
  pageWords,
  parseHistoryFilters,
  parseOpen,
  toggleOpen,
  withFilter,
  type HistoryFilterKey,
} from './historyModel'
import { HistoryTable } from './HistoryTable'

/** history.html B's notes. History defines no money figure, so they are the page's own words. */
const NOTES: readonly DefinitionNote[] = [
  {
    n: 1,
    text: 'Amounts in the log are the amounts locked or entered at that moment; they are not recomputed.',
  },
  {
    n: 2,
    text: "Each request's own timeline stays on its household page; this tab is the season-wide view.",
  },
  {
    n: 3,
    text: 'The scenario trail stays in Scenarios; making a kept option the rules draft appears here as a rules operation.',
  },
]
const NOTES_WITHOUT_SCENARIOS = NOTES.slice(0, 2)
const NO_ACTORS: readonly string[] = []

function HistoryBody({
  page,
  open,
  onToggle,
  onPage,
  view,
}: {
  page: ApiAidHistoryPage
  open: readonly string[]
  onToggle: (operationId: string) => void
  onPage: (page: number) => void
  view: AidView
}) {
  const last = lastPage(page)
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs">{pageWords(page)}</p>
      {page.operations.length > 0 && (
        <HistoryTable operations={page.operations} open={open} onToggle={onToggle} view={view} />
      )}
      {(page.total > page.per_page || page.page > 1) && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={BUTTON_SECONDARY}
            disabled={page.page <= 1}
            onClick={() => onPage(Math.min(page.page - 1, last))}
          >
            Newer
          </button>
          <span className="text-muted-foreground text-xs">{`Page ${String(page.page)} of ${String(last)}`}</span>
          <button
            type="button"
            className={BUTTON_SECONDARY}
            disabled={page.page >= last}
            onClick={() => onPage(page.page + 1)}
          >
            Older
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Season › History (spec §7.6; D49, D76; history.html B): the season's log, one line per operation,
 * rules and casework on one timeline, newest first, server-paged (D21). Every filter, the page and
 * the opened lines live in the URL (D15), replaced, never per keystroke. Without `rules` the server
 * leaves the rules operations out and the Rules chip is absent. The log is the whole log whatever the
 * link's as-of (PR 1's line above the tab says so); its links keep the as-of. A failed refetch keeps
 * the rows (owner Group 5).
 */
export function HistoryTab() {
  const year = useYear()
  const { hasPermission } = usePermissions()
  const canSeeRules = hasPermission(Permission.FINANCIAL_AID_RULES)
  const [params, setParams] = useSearchParams()
  const search = params.toString()
  const filters = useMemo(
    () => parseHistoryFilters(new URLSearchParams(search), canSeeRules),
    [search, canSeeRules]
  )
  const query = useMemo(() => historyQuery(filters), [filters])
  const openRaw = params.get('open')
  const open = useMemo(() => parseOpen(openRaw), [openRaw])
  const history = useAidHistory(query)
  // Links keep the page's as-of (D15; PR 3's I6 fix); the read stays live (the router takes none).
  const asOf = useAidAsOf()
  const view = useMemo((): AidView => ({ year, asOf }), [year, asOf])

  // setParams changes identity on every URL change; a ref keeps the callbacks stable.
  const setParamsRef = useRef(setParams)
  useEffect(() => {
    setParamsRef.current = setParams
  }, [setParams])
  const setFilter = useCallback(
    (key: HistoryFilterKey, value: string | null) =>
      setParamsRef.current((previous) => withFilter(previous, key, value), { replace: true }),
    []
  )
  const setPage = useCallback(
    (page: number) => setFilter('page', page <= 1 ? null : String(page)),
    [setFilter]
  )
  const toggle = useCallback(
    (operationId: string) =>
      setParamsRef.current(
        (previous) => {
          const next = new URLSearchParams(previous)
          const value = toggleOpen(parseOpen(previous.get('open')), operationId)
          if (value === null) next.delete('open')
          else next.set('open', value)
          return next
        },
        { replace: true }
      ),
    []
  )

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">Who changed what, and when. Append-only.</p>
      <HistoryFilters
        filters={filters}
        actors={history.data?.actors ?? NO_ACTORS}
        canSeeRules={canSeeRules}
        onChange={setFilter}
      />
      <QueryGuard
        isLoading={history.isLoading}
        error={history.data ? null : history.error}
        data={history.data}
        label="History"
      >
        {(data) => (
          <HistoryBody page={data} open={open} onToggle={toggle} onPage={setPage} view={view} />
        )}
      </QueryGuard>
      <DefinitionNotes notes={canSeeRules ? NOTES : NOTES_WITHOUT_SCENARIOS} />
    </div>
  )
}
