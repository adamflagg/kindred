import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router'

import { resolveStrip, shownView, type RequestLens } from './strip'
import { parseRoundFilter, type RequestView, type RoundFilter } from './views'

export type GridParamName = 'program' | 'pool' | 'round' | 'counted' | 'live' | 'ids' | 'row'

export interface GridParams {
  /** What the grid shows: the stage under the lens, or the lens alone (T4). */
  readonly view: RequestView
  /** `?lens=appeals`; absent: All. */
  readonly lens: RequestLens
  /** `?view=<stage slug>`; absent: no stage. */
  readonly stage: RequestView | null
  readonly program: string | null
  readonly pool: string | null
  readonly round: RoundFilter | null
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
  /** Several at once, in one replace (the Program dropdown sets one of pool/program and clears the other). */
  readonly setParams: (changes: Partial<Record<GridParamName, string | null>>) => void
}

/**
 * What the grid keeps in its URL (§3.6, D15): the lens and stage (T4), the filters, Show IDs, the highlighted row
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
  const setMany = useCallback((changes: Partial<Record<GridParamName, string | null>>) => {
    setParamsRef.current(
      (previous) => {
        const next = new URLSearchParams(previous)
        // The retired Checklist chips' `?tick=` (#3000): nothing reads it, so an old link's goes.
        next.delete('tick')
        for (const [name, value] of Object.entries(changes)) {
          if (value === null) next.delete(name)
          else next.set(name, value)
        }
        return next
      },
      { replace: true }
    )
  }, [])
  const setParam = useCallback(
    (name: GridParamName, value: string | null) => setMany({ [name]: value }),
    [setMany]
  )
  const viewParam = params.get('view')
  const lensParam = params.get('lens')
  const { lens, stage } = useMemo(() => resolveStrip(viewParam, lensParam), [viewParam, lensParam])
  // Under the Appeals lens a stage is a new object (its columns swapped): held, so the grid's
  // column memo does not rebuild on every highlight move.
  const view = useMemo(() => shownView(lens, stage), [lens, stage])
  return {
    view,
    lens,
    stage,
    program: params.get('program'),
    pool: params.get('pool'),
    round: parseRoundFilter(params.get('round')),
    counted: params.get('counted') === '1',
    live: params.get('live') === '1',
    showIds: params.get('ids') === '1',
    sort: params.get('sort'),
    group: params.get('group'),
    row: params.get('row'),
    today: params.get('today'),
    setParam,
    setParams: setMany,
  }
}
