/**
 * The queue walk's order (§3.5; D14; Decision 29): a view's rows in the view's own opening order
 * (grouped by reason for a queue, flat for All), one stop per household at its first appearance. A
 * family with two held requests is one stop.
 */
import type { ApiAidGridRow } from '../../../types/api-types'
import { groupRows } from '../kit/table'
import { attentionFor } from '../requests/attention'
import {
  filterRows,
  NO_FILTERS,
  parseRoundFilter,
  parseTickFilter,
  reasonGroup,
  type GridFilters,
  type RequestView,
} from '../requests/views'

export interface WalkStop {
  readonly householdCmId: number
  readonly familyName: string
  /** Why it is in the view, as the strip says it: "placeholder income". */
  readonly reason: string
  /** Its first row in the view: Back to the view highlights it (§3.5). */
  readonly firstRequestId: string
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

/**
 * The grid's filters and Show IDs as the household link carried them (M5), so the walk steps through
 * exactly the rows the grid showed, and Back returns to the same filtered view.
 */
export function gridFiltersFrom(params: URLSearchParams): {
  filters: GridFilters
  keep: Record<string, string>
} {
  const program = params.get('program')
  const pool = params.get('pool')
  const round = parseRoundFilter(params.get('round'))
  const tick = parseTickFilter(params.get('tick'))
  return {
    filters: { program, pool, round, tick, ids: null },
    keep: {
      ...(program !== null ? { program } : {}),
      ...(pool !== null ? { pool } : {}),
      ...(round !== null ? { round: String(round) } : {}),
      ...(tick !== null ? { tick } : {}),
      ...(params.get('ids') === '1' ? { ids: '1' } : {}),
    },
  }
}

export function walkStops(
  rows: readonly ApiAidGridRow[],
  view: RequestView,
  today: string,
  filters: GridFilters = NO_FILTERS
): WalkStop[] {
  const inView = filterRows(rows, view.key, filters)
  const grouping = reasonGroup(view, today)
  const ordered =
    view.groupBy === null ? inView : groupRows(inView, grouping).flatMap((group) => group.rows)
  const stops = new Map<number, WalkStop>()
  for (const row of ordered) {
    if (stops.has(row.household_cm_id)) continue
    const pill = attentionFor(row, view.key, today)?.item.pill
    const reason = pill ?? (view.groupBy === null ? '' : grouping(row).heading)
    stops.set(row.household_cm_id, {
      householdCmId: row.household_cm_id,
      familyName: row.family_name,
      reason: lowerFirst(reason),
      firstRequestId: row.request_id,
    })
  }
  return [...stops.values()]
}

export interface WalkPosition {
  readonly index: number
  readonly total: number
  readonly previous: WalkStop | null
  readonly next: WalkStop | null
}

export function walkPosition(
  stops: readonly WalkStop[],
  householdCmId: number
): WalkPosition | null {
  const at = stops.findIndex((stop) => stop.householdCmId === householdCmId)
  if (at === -1) return null
  return {
    index: at,
    total: stops.length,
    previous: stops[at - 1] ?? null,
    next: stops[at + 1] ?? null,
  }
}
