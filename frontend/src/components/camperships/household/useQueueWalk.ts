import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { useAidGrid } from '../../../hooks/camperships/useAidGrid'
import { useAidToday } from '../../../hooks/camperships/useAidToday'
import { usePrefetchHousehold } from '../../../hooks/camperships/useAidHouseholdPage'
import { aidHref, type AidView } from '../kit/asOf'
import { campToday } from '../kit/dates'
import { isPageKey } from '../kit/keyboard'
import { lensRows, resolveStrip, shownView } from '../requests/strip'
import type { RequestView } from '../requests/views'
import { todayRequestIds } from '../today/todayModel'
import {
  gridFiltersFrom,
  walkPosition,
  walkStops,
  type WalkPosition,
  type WalkStop,
} from './queueWalk'

export interface Neighbours {
  readonly previous: WalkStop | null
  readonly next: WalkStop | null
}

export interface QueueWalk {
  readonly view: RequestView
  /** Null while the grid read is loading or failed, or when the family is not among the view's stops. */
  readonly position: WalkPosition | null
  /** True only once the grid has loaded and the family is not in the view (I2): the strip says so. */
  readonly absent: boolean
  /**
   * Where the family was, once it has left the view after a decision: its neighbours by household (the
   * index it held when one has gone too), so the walk goes on (PR 7 I2). Null while it is in the view, and with no memory of it.
   */
  readonly remembered: Neighbours | null
  readonly backHref: string
  readonly hrefOf: (stop: WalkStop) => string
}

/**
 * The queue walk (§3.5; D13, D14). Reached from a Requests view (`?from=<view>`), the household page
 * knows its place in that view, steps family to family with `[` and `]`, and loads the next family
 * in the background. Null when the page stands alone (search, Grants, Money). `view` is the season
 * and as-of the links carry: the as-of is the grid's, kept so Back returns to the same view.
 */
export function useQueueWalk(
  householdCmId: number,
  view: AidView,
  /** A page-owned exit (owner F2 4): given, every step goes through it, and it calls `go` to leave. */
  beforeLeave?: ((go: () => void) => void) | undefined
): QueueWalk | null {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  // react-router's navigate changes identity with the location: the key listener reads it by ref.
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])
  const beforeLeaveRef = useRef(beforeLeave)
  useEffect(() => {
    beforeLeaveRef.current = beforeLeave
  }, [beforeLeave])
  // The grid's link says `from=<stage slug>` (or `all`) and the lens (T4's one URL scheme).
  const from = params.get('from')
  const lensParam = params.get('lens')
  const strip = useMemo(
    () => resolveStrip(from === 'all' ? null : from, lensParam),
    [from, lensParam]
  )
  // Held: under the Appeals lens shownView makes a new object, which would re-run every memo below.
  const walkView = useMemo(
    () => (from === null ? null : shownView(strip.lens, strip.stage)),
    [from, strip]
  )
  // The household page is live only (Decision 36), so the walk reads the live grid.
  const grid = useAidGrid({ enabled: walkView !== null, live: true })
  const today = campToday()
  // The grid's filters ride along on the link (M5): same rows, and Back lands on the same view.
  const search = params.toString()
  const {
    filters: urlFilters,
    keep,
    order,
    todayKey,
  } = useMemo(() => gridFiltersFrom(new URLSearchParams(search)), [search])
  // A Today line's rows are filtered like any other filter: the walk steps through exactly them.
  const todayRead = useAidToday({ enabled: walkView !== null && todayKey !== null })
  const todayData = todayRead.data
  // Until Today's read lands the walk's rows are unknown, not empty: no "left the view" flash.
  const allRows = todayKey !== null && todayData === undefined ? undefined : grid.data?.rows
  const rows = useMemo(
    () => (allRows ? lensRows(allRows, strip.lens) : undefined),
    [allRows, strip.lens]
  )
  const filters = useMemo(
    () =>
      todayKey === null ? urlFilters : { ...urlFilters, ids: todayRequestIds(todayData, todayKey) },
    [urlFilters, todayKey, todayData]
  )
  const stops = useMemo(
    () => (rows && walkView ? walkStops(rows, walkView, today, filters, order) : []),
    [rows, walkView, today, filters, order]
  )
  const position = useMemo(() => walkPosition(stops, householdCmId), [stops, householdCmId])
  const slug = walkView === null ? null : (strip.stage?.slug ?? 'all')
  // The family's last index and neighbours (by household) while it was in the stops, for this
  // household and view: a refetch that drops it keeps its neighbours (I2), and they follow their
  // household, not a position another family's leaving would shift. Another household, stage or
  // lens starts afresh. A neighbour can leave while the family keeps its index, so the guard compares all.
  const memoryKey = `${String(householdCmId)}|${slug ?? ''}|${strip.lens}`
  const [last, setLast] = useState<{
    key: string
    index: number
    prevId: number | null
    nextId: number | null
  } | null>(null)
  const prevId = position?.previous?.householdCmId ?? null
  const nextId = position?.next?.householdCmId ?? null
  const remembersThis =
    last?.key === memoryKey &&
    last.index === position?.index &&
    last.prevId === prevId &&
    last.nextId === nextId
  if (position !== null && !remembersThis) {
    setLast({ key: memoryKey, index: position.index, prevId, nextId })
  }
  const remembered = useMemo<Neighbours | null>(() => {
    if (position !== null || rows === undefined || last?.key !== memoryKey) {
      return null
    }
    const byId = (id: number | null) =>
      id === null ? undefined : stops.find((stop) => stop.householdCmId === id)
    return {
      previous: byId(last.prevId) ?? stops[last.index - 1] ?? null,
      next: byId(last.nextId) ?? stops[last.index] ?? null,
    }
  }, [position, rows, stops, memoryKey, last])
  const hrefOf = useMemo(
    () => (stop: WalkStop) =>
      aidHref(
        `/aid/households/${String(stop.householdCmId)}`,
        view,
        slug === null ? {} : { from: slug, ...keep }
      ),
    [view, slug, keep]
  )
  usePrefetchHousehold((position ?? remembered)?.next?.householdCmId ?? null)

  useEffect(() => {
    const here = position ?? remembered
    if (here === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '[' && event.key !== ']') return
      // A bracket typed into an editor or a form is text (the kit's lesson: page keys stand aside
      // for every control there, not only for typing targets).
      if (
        event.target instanceof Element &&
        event.target.closest('[data-aid-editor], form') !== null
      ) {
        return
      }
      if (!isPageKey(event)) return
      const stop = event.key === ']' ? here.next : here.previous
      if (stop === null) return
      event.preventDefault()
      const go = () => void navigateRef.current(hrefOf(stop))
      const guard = beforeLeaveRef.current
      if (guard) guard(go)
      else go()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [position, remembered, hrefOf])

  if (walkView === null) return null
  const here = position === null ? undefined : stops[position.index]
  return {
    view: walkView,
    position,
    // Only a loaded read can say the family left the view: loading and failed claim nothing.
    absent: rows !== undefined && position === null,
    remembered,
    backHref: aidHref('/aid/requests', view, {
      // All has no `view` (T4); the lens is in `keep`.
      ...(strip.stage === null ? {} : { view: strip.stage.slug }),
      ...keep,
      ...(here ? { row: here.firstRequestId } : {}),
    }),
    hrefOf,
  }
}
