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
import { CS_BAND, CS_BAND_EDGE, CS_PANEL, CS_SCROLL_BOX } from '../kit/csType'
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

/** The mock's notes (history-10): History defines no money figure, so they are the page's own words. */
const NOTES: readonly DefinitionNote[] = [
  {
    n: 1,
    term: 'Amounts',
    text: 'Amounts: as locked or entered at that moment; the log never recomputes them.',
  },
  {
    n: 2,
    term: 'Household timeline',
    text: "Household timeline: each request's own history stays on its household page; this tab is the season-wide log.",
  },
  {
    n: 3,
    term: 'Scenarios',
    text: 'Scenarios: its edits stay in Scenarios; making a kept option the rules draft shows here as a Rules operation.',
  },
]
const NOTES_WITHOUT_SCENARIOS = NOTES.slice(0, 2)
/** What "Clear filters" resets (history-m3). */
const CLEARED_BY_CLEAR: readonly HistoryFilterKey[] = ['kind', 'actor', 'since', 'until', 'q']
const NO_ACTORS: readonly string[] = []
const NO_PAGES: readonly ApiAidHistoryPage[] = []
/** The box asks for its next page this close (px) to its end (spec §7.2 C). */
const NEAR_END = 160
/** A pager button (the mock's .cf-pg, history-6): 22px, 12px/600, dimmed when disabled; the picked one is primary. */
const PAGE_BTN =
  'border-border bg-card text-foreground inline-flex h-[22px] min-w-[22px] cursor-pointer items-center justify-center rounded-md border px-[7px] text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45'
const PAGE_ON =
  'border-primary bg-primary text-primary-foreground inline-flex h-[22px] min-w-[22px] cursor-pointer items-center justify-center rounded-md border px-[7px] text-xs font-semibold'

/**
 * Season › History (spec §7.2; D49, D76; season-history.html): the season's log in one scrolling box, one
 * line per operation, rules and casework on one timeline, newest first. The box loads page after page
 * as it is scrolled (endless); the footer's page numbers and `?page=` follow where it is, and a page
 * number or a link loads and scrolls to its page. Every filter, the page and the opened lines live in
 * the URL (D15), replaced, never per keystroke. Without `rules` the server leaves the rules operations
 * out and the toolbar has no Rules choice. The log is the whole log whatever the link's as-of (PR 1's line
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
  // so a filter change (from the toolbar, Back or a pasted link) falls back to the URL's own page.
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
  /** Clear filters: kind, who, dates and search in ONE URL write (history-m3); intake is a view choice and stays. */
  const clearFilters = useCallback(
    (keys: readonly HistoryFilterKey[]) =>
      setParamsRef.current(
        (previous) => keys.reduce((url, key) => withFilter(url, key, null), previous),
        { replace: true }
      ),
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
  // A failed page read stops it (no retry loop); a scroll near the end asks again.
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = read
  useEffect(() => {
    if (loaded.length < target && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage()
    }
  }, [loaded.length, target, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])
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
  // A ?page= past the log's end, once every page has loaded, becomes its last page (and is shown).
  const last = first === undefined ? 1 : lastPage(first)
  const complete = first !== undefined && !stale && !hasNextPage && !isFetchingNextPage
  useEffect(() => {
    if (!complete || filters.page <= last) return
    setFilter('page', last > 1 ? String(last) : null)
    if (pendingPage.current !== null) {
      pendingPage.current = null
      scrollToPage(box.current, last)
    }
  }, [complete, filters.page, last, setFilter])

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
    // A short last page cannot bring its break row to the top: at the end of a fully loaded box, it is the page.
    const atEnd = !hasNextPage && el.scrollHeight - el.scrollTop - el.clientHeight < 1
    const page = atEnd ? loaded.length : pageAtScroll(tops, el.scrollTop)
    // While a page number is still loading, ?page= stays on it until the box scrolls there.
    if (pendingPage.current === null && page !== filters.page) {
      setFilter('page', page <= 1 ? null : String(page))
    }
  }
  const goTo = (page: number) => {
    setGoal({ key: filterKey, page })
    setFilter('page', page <= 1 ? null : String(page))
    if (loaded.length >= page) scrollToPage(box.current, page)
    else pendingPage.current = page // the effect above scrolls once it arrives
  }

  return (
    <div className="space-y-2">
      <HistoryFilters
        filters={filters}
        actors={first?.actors ?? NO_ACTORS}
        kindCounts={first?.kind_counts}
        total={allCount(first, filters.kind)}
        counting={stale}
        canSeeRules={canSeeRules}
        onChange={setFilter}
        onClear={clearFilters}
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
            first === undefined ? null : (
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
                    onClearFilters={() => clearFilters(CLEARED_BY_CLEAR)}
                    tail={scrollRowWords(
                      loaded.length,
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
      className={`${CS_PANEL} ${CS_BAND} ${CS_BAND_EDGE} text-foreground sticky bottom-0 z-[35] flex flex-wrap items-center gap-0.5 px-2 py-1.5`}
    >
      <span className="font-bold">{updating ? 'Updating…' : words.count}</span>
      <span className="w-2.5" />
      <button
        type="button"
        className={`${PAGE_BTN} ml-1`}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Newer
      </button>
      {Array.from({ length: last }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          className={`${n === page ? PAGE_ON : PAGE_BTN} ml-1`}
          onClick={() => onPage(n)}
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        className={`${PAGE_BTN} ml-1`}
        disabled={page >= last}
        onClick={() => onPage(page + 1)}
      >
        Older
      </button>
      <span className="text-muted-foreground ml-2.5 font-medium">{`${words.pageOf} ${words.onScreen}`}</span>
    </div>
  )
}
