import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { Permission } from '../../../constants/permissions'
import { useAidAsOf } from '../../../hooks/camperships/useAidAsOf'
import { useAidHistoryPages } from '../../../hooks/camperships/useAidHistoryPages'
import { useYear } from '../../../hooks/useCurrentYear'
import { usePermissions } from '../../../hooks/usePermissions'
import type { ApiAidHistoryPage } from '../../../types/api-types'
import { QueryGuard } from '../../QueryGuard'
import type { AidView } from '../kit/asOf'
import { CS_BTN_SM, CS_PANEL, CS_SCROLL_BOX } from '../kit/csType'
import { DefinitionNotes, type DefinitionNote } from '../kit/DefinitionNotes'
import { useFitToViewport } from '../kit/useFitToViewport'
import { HistoryFilters } from './HistoryFilters'
import {
  allCount,
  flattenPages,
  footerWords,
  historyQuery,
  lastPage,
  pageAtScroll,
  pageStarts,
  parseHistoryFilters,
  parseOpen,
  scrollRowWords,
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
const NO_PAGES: readonly ApiAidHistoryPage[] = []
/** The box asks for its next page this close (px) to its end (spec §7.2 C). */
const NEAR_END = 160
/** The picked page number: CS_BTN_SM with its background and ink swapped (one class per property). */
const PAGE_ON = CS_BTN_SM.replace('bg-card', 'bg-primary').replace(
  'text-forest-700 dark:text-forest-300',
  'text-primary-foreground'
)

/**
 * Season › History (spec §7.2; D49, D76; history-v2.html): the season's log in one scrolling box, one
 * line per operation, rules and casework on one timeline, newest first. The box loads page after page
 * as it is scrolled (endless); the footer's page numbers and `?page=` follow where it is, and a page
 * number or a link loads and scrolls to its page. Every filter, the page and the opened lines live in
 * the URL (D15), replaced, never per keystroke. Without `rules` the server leaves the rules operations
 * out and the Rules chip is absent. The log is the whole log whatever the link's as-of (PR 1's line
 * above the tab says so); its links keep the as-of. A failed refetch keeps the rows (owner Group 5).
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
  // The read is keyed by the filters alone; the page is where the box is (spec §7.2 C).
  // A string, not an object: `filters` carries `page`, so it changes identity on every ?page= write,
  // and anything keyed on its object would fire (and send the box to the top) on a mere page change.
  const filterKey = useMemo(() => JSON.stringify(historyQuery({ ...filters, page: 1 })), [filters])
  const query = useMemo(
    () => JSON.parse(filterKey) as Readonly<Record<string, string>>,
    [filterKey]
  )
  const openRaw = params.get('open')
  const open = useMemo(() => parseOpen(openRaw), [openRaw])
  const read = useAidHistoryPages(query)
  // Links keep the page's as-of (D15; PR 3's I6 fix); the read stays live (the router takes none).
  const asOf = useAidAsOf()
  const view = useMemo((): AidView => ({ year, asOf }), [year, asOf])
  const box = useRef<HTMLDivElement | null>(null)
  const fit = useFitToViewport(box)
  const loaded = read.data?.pages ?? NO_PAGES
  const first = loaded[0]
  const ops = useMemo(() => flattenPages(loaded), [loaded])
  const starts = useMemo(() => pageStarts(loaded), [loaded])
  // How far to load: a page number clicked, or a ?page= link. Kept with the filters it was asked under,
  // so a filter change (from the strip, Back or a pasted link) falls back to the URL's own page.
  const [goal, setGoal] = useState({ key: filterKey, page: filters.page })
  const target = goal.key === filterKey ? goal.page : filters.page
  // The page the box still has to scroll to once it has loaded (a ?page= link, or a page number not loaded yet).
  const pendingPage = useRef<number | null>(filters.page > 1 ? filters.page : null)
  const shownKey = useRef(filterKey)
  const stale = read.isPlaceholderData

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

  // A page number (or a ?page= link) loads every page up to it.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = read
  useEffect(() => {
    if (loaded.length < target && hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [loaded.length, target, hasNextPage, isFetchingNextPage, fetchNextPage])
  // Only a filter change returns the box to its top. filterKey is a string, so ?page= writes leave it alone;
  // the ref skips the first render, so a ?page= link's pending scroll survives the mount.
  useEffect(() => {
    if (shownKey.current === filterKey) return
    shownKey.current = filterKey
    pendingPage.current = null
    if (box.current) box.current.scrollTop = 0
  }, [filterKey])
  // Once the page asked for has loaded, its page-break row exists: show it.
  useEffect(() => {
    const page = pendingPage.current
    if (page === null || loaded.length < page) return
    pendingPage.current = null
    scrollToPage(box.current, page)
  }, [loaded.length])

  const onScroll = () => {
    const el = box.current
    if (el === null || first === undefined) return
    if (
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_END &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      void fetchNextPage()
    }
    const tops = [
      0,
      ...starts.map(
        (s) =>
          el.querySelector<HTMLElement>(`[data-page-start="${String(s.page)}"]`)?.offsetTop ??
          Infinity
      ),
    ]
    const page = pageAtScroll(tops, el.scrollTop)
    if (page !== filters.page) setFilter('page', page <= 1 ? null : String(page))
  }
  const goTo = (page: number) => {
    setGoal({ key: filterKey, page })
    setFilter('page', page <= 1 ? null : String(page))
    if (loaded.length >= page) scrollToPage(box.current, page)
    else pendingPage.current = page // the effect above scrolls once it arrives
  }

  const last = first === undefined ? 1 : lastPage(first)
  return (
    <div className="space-y-3">
      <HistoryFilters
        filters={filters}
        actors={first?.actors ?? NO_ACTORS}
        kindCounts={first?.kind_counts}
        total={allCount(first, filters.kind)}
        counting={stale}
        canSeeRules={canSeeRules}
        onChange={setFilter}
      />
      <div
        ref={box}
        data-testid="history-box"
        className={`${CS_SCROLL_BOX} relative`}
        style={{ maxHeight: fit.maxHeight }}
        onScroll={onScroll}
      >
        <QueryGuard
          isLoading={read.isLoading}
          error={read.data ? null : read.error}
          data={read.data}
          label="History"
        >
          {() =>
            first === undefined || first.total === 0 ? (
              <p className={`${CS_PANEL} text-muted-foreground px-3 py-[18px]`}>
                No operations match.
              </p>
            ) : (
              <>
                <div
                  data-testid="history-rows"
                  data-stale={stale ? '' : undefined}
                  className={stale ? 'opacity-60' : undefined}
                >
                  <HistoryTable
                    operations={ops}
                    starts={starts}
                    perPage={first.per_page}
                    total={first.total}
                    open={open}
                    onToggle={toggle}
                    view={view}
                    lineWidth={fit.width}
                    tail={scrollRowWords(
                      ops.length,
                      first.total,
                      first.per_page,
                      isFetchingNextPage
                    )}
                  />
                </div>
                <HistoryFooter
                  words={footerWords(first.total, ops.length, filters.page, last)}
                  page={filters.page}
                  last={last}
                  updating={stale}
                  onPage={goTo}
                />
              </>
            )
          }
        </QueryGuard>
      </div>
      <DefinitionNotes notes={canSeeRules ? NOTES : NOTES_WITHOUT_SCENARIOS} />
    </div>
  )
}

/** Shows a page's first row at the box's top; page 1 is the top itself. */
function scrollToPage(el: HTMLDivElement | null, page: number) {
  if (el === null) return
  if (page <= 1) {
    el.scrollTop = 0
    return
  }
  // jsdom lays nothing out and has no scrollIntoView, so the method is typed as possibly absent.
  const row: { scrollIntoView?: (options: ScrollIntoViewOptions) => void } | null =
    el.querySelector<HTMLElement>(`[data-page-start="${String(page)}"]`)
  row?.scrollIntoView?.({ block: 'start' })
}

/** The box's footer (spec §7.2 C): sticky at its bottom; the count, Newer, page numbers, Older, the page line. */
function HistoryFooter({
  words,
  page,
  last,
  updating,
  onPage,
}: {
  words: ReturnType<typeof footerWords>
  page: number
  last: number
  updating: boolean
  onPage: (page: number) => void
}) {
  return (
    <div
      data-testid="history-footer"
      className={`${CS_PANEL} bg-muted text-muted-foreground border-border sticky bottom-0 z-[35] flex flex-wrap items-center gap-2 border-t px-2 py-1.5 font-medium`}
    >
      <span className="text-foreground">{updating ? 'Updating…' : words.count}</span>
      <button
        type="button"
        className={CS_BTN_SM}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Newer
      </button>
      {Array.from({ length: last }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          className={n === page ? PAGE_ON : CS_BTN_SM}
          onClick={() => onPage(n)}
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        className={CS_BTN_SM}
        disabled={page >= last}
        onClick={() => onPage(page + 1)}
      >
        Older
      </button>
      <span>{words.pageOf}</span>
      <span>{words.onScreen}</span>
    </div>
  )
}
