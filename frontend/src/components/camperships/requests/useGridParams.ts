import { useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'

import {
  parseRoundFilter,
  parseTickFilter,
  requestView,
  type RequestView,
  type RoundFilter,
  type TickFilter,
} from './views'

export type GridParamName =
  'program' | 'pool' | 'round' | 'tick' | 'counted' | 'live' | 'ids' | 'row' | 'today'

export interface GridParams {
  readonly view: RequestView
  readonly program: string | null
  readonly pool: string | null
  readonly round: RoundFilter | null
  readonly tick: TickFilter | null
  readonly counted: boolean
  readonly live: boolean
  readonly showIds: boolean
  /** The table's `?sort=` and `?group=` as written (AidTable owns them); the household link carries them (I1). */
  readonly sort: string | null
  readonly group: string | null
  /** The highlighted request as the URL has it: the page seeds its state from it, once (Decision 2). */
  readonly row: string | null
  /** A Today line whose requests the grid shows (Decision 10). */
  readonly today: string | null
  readonly setParam: (name: GridParamName, value: string | null) => void
}

/**
 * What the grid keeps in its URL (§3.6, D15): the view, the filters, Show IDs, the highlighted row
 * and Today's line. Each write replaces the entry, so Back leaves the page rather than undoing a
 * filter. A view change is a link (RequestViewNav), so Back returns to the view before.
 */
export function useGridParams(): GridParams {
  const [params, setParams] = useSearchParams()
  // react-router's setter changes identity with every URL change; a writer that did would rebuild
  // the grid's columns on every highlight move. Hold the latest in a ref instead.
  const setParamsRef = useRef(setParams)
  useEffect(() => {
    setParamsRef.current = setParams
  }, [setParams])
  const setParam = useCallback((name: GridParamName, value: string | null) => {
    setParamsRef.current(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (value === null) next.delete(name)
        else next.set(name, value)
        return next
      },
      { replace: true }
    )
  }, [])
  return {
    view: requestView(params.get('view')),
    program: params.get('program'),
    pool: params.get('pool'),
    round: parseRoundFilter(params.get('round')),
    tick: parseTickFilter(params.get('tick')),
    counted: params.get('counted') === '1',
    live: params.get('live') === '1',
    showIds: params.get('ids') === '1',
    sort: params.get('sort'),
    group: params.get('group'),
    row: params.get('row'),
    today: params.get('today'),
    setParam,
  }
}
