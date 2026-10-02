import { useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { useAidGrid } from '../../../hooks/camperships/useAidGrid'
import { usePrefetchHousehold } from '../../../hooks/camperships/useAidHouseholdPage'
import { aidHref, type AidView } from '../kit/asOf'
import { campToday } from '../kit/dates'
import { isPageKey } from '../kit/keyboard'
import { requestView, type RequestView } from '../requests/views'
import {
  gridFiltersFrom,
  walkPosition,
  walkStops,
  type WalkPosition,
  type WalkStop,
} from './queueWalk'

export interface QueueWalk {
  readonly view: RequestView
  readonly position: WalkPosition
  readonly backHref: string
  readonly hrefOf: (stop: WalkStop) => string
}

/**
 * The queue walk (§3.5; D13, D14). Reached from a Requests view (`?from=<view>`), the household page
 * knows its place in that view, steps family to family with `[` and `]`, and loads the next family
 * in the background. Null when the page stands alone (search, Grants, Money). `view` is the season
 * and as-of the links carry: the as-of is the grid's, kept so Back returns to the same view.
 */
export function useQueueWalk(householdCmId: number, view: AidView): QueueWalk | null {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  // react-router's navigate changes identity with the location: the key listener reads it by ref.
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])
  const from = params.get('from')
  const walkView = from === null ? null : requestView(from)
  // The household page is live only (Decision 36), so the walk reads the live grid.
  const grid = useAidGrid({ enabled: walkView !== null, live: true })
  const today = campToday()
  const rows = grid.data?.rows
  // The grid's filters ride along on the link (M5): same rows, and Back lands on the same view.
  const search = params.toString()
  const { filters, keep } = useMemo(() => gridFiltersFrom(new URLSearchParams(search)), [search])
  const stops = useMemo(
    () => (rows && walkView ? walkStops(rows, walkView, today, filters) : []),
    [rows, walkView, today, filters]
  )
  const position = useMemo(() => walkPosition(stops, householdCmId), [stops, householdCmId])
  const slug = walkView?.slug ?? null
  const hrefOf = useMemo(
    () => (stop: WalkStop) =>
      aidHref(
        `/aid/households/${String(stop.householdCmId)}`,
        view,
        slug === null ? {} : { from: slug, ...keep }
      ),
    [view, slug, keep]
  )
  usePrefetchHousehold(position?.next?.householdCmId ?? null)

  useEffect(() => {
    if (position === null) return
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
      const stop = event.key === ']' ? position.next : position.previous
      if (stop === null) return
      event.preventDefault()
      void navigateRef.current(hrefOf(stop))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [position, hrefOf])

  if (walkView === null || position === null) return null
  const here = stops[position.index]
  return {
    view: walkView,
    position,
    backHref: aidHref('/aid/requests', view, {
      view: walkView.slug,
      ...keep,
      ...(here ? { row: here.firstRequestId } : {}),
    }),
    hrefOf,
  }
}
