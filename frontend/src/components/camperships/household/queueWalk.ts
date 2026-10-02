/**
 * The queue walk's order (§3.5; D14; Decision 29): a view's rows in the view's own opening order
 * (grouped by reason for a queue, flat for All), one stop per household at its first appearance. A
 * family with two held requests is one stop.
 */
import type { ApiAidGridRow } from '../../../types/api-types'
import { groupRows, parseSort, sortRows } from '../kit/table'
import { attentionFor } from '../requests/attention'
import {
  familyGroup,
  filterRows,
  GRID_COLUMNS,
  NO_FILTERS,
  parseRoundFilter,
  parseTickFilter,
  reasonGroup,
  viewColumns,
  type GridColumnKey,
  type GridFilters,
  type RequestView,
} from '../requests/views'
import { isTodayKey, type TodayKey } from '../today/todayModel'

export interface WalkStop {
  readonly householdCmId: number
  readonly familyName: string
  /** Why it is in the view, as the strip says it: "placeholder income". */
  readonly reason: string
  /** Its first row in the view: Back to the view highlights it (§3.5). */
  readonly firstRequestId: string
}

/**
 * How the grid ordered its rows, as the household link carried it (I1): the URL's `sort` and
 * `group` as written, and Show IDs (which adds the id columns a sort may name).
 */
export interface WalkOrder {
  readonly sort: string | null
  readonly group: string | null
  readonly showIds: boolean
}

export const DEFAULT_ORDER: WalkOrder = { sort: null, group: null, showIds: false }

/**
 * The grid's filters and Show IDs as the household link carried them (M5), so the walk steps through
 * exactly the rows the grid showed, and Back returns to the same filtered view.
 */
export function gridFiltersFrom(params: URLSearchParams): {
  filters: GridFilters
  keep: Record<string, string>
  order: WalkOrder
  /** A Today line the grid was showing (Decision 10); its request ids come from Today's read. */
  todayKey: TodayKey | null
} {
  const program = params.get('program')
  const pool = params.get('pool')
  const round = parseRoundFilter(params.get('round'))
  const tick = parseTickFilter(params.get('tick'))
  const sort = params.get('sort')
  const group = params.get('group')
  const showIds = params.get('ids') === '1'
  const todayParam = params.get('today')
  const todayKey = todayParam !== null && isTodayKey(todayParam) ? todayParam : null
  return {
    filters: { program, pool, round, tick, ids: null },
    keep: {
      ...(program !== null ? { program } : {}),
      ...(pool !== null ? { pool } : {}),
      ...(round !== null ? { round: String(round) } : {}),
      ...(tick !== null ? { tick } : {}),
      ...(showIds ? { ids: '1' } : {}),
      ...(todayKey !== null ? { today: todayKey } : {}),
      ...(sort !== null ? { sort } : {}),
      ...(group !== null ? { group } : {}),
    },
    order: { sort, group, showIds },
    todayKey,
  }
}

export function walkStops(
  rows: readonly ApiAidGridRow[],
  view: RequestView,
  today: string,
  filters: GridFilters = NO_FILTERS,
  order: WalkOrder = DEFAULT_ORDER
): WalkStop[] {
  const inView = filterRows(rows, view.key, filters)
  const reason = reasonGroup(view, today)
  // What AidTable does with the same URL: sort first (a column the view lacks is no sort; tick is
  // taken as present), then group in the order the rows now stand. `group=flat` is no grouping, and
  // an unset one is the view's own (by reason for a queue, flat for All).
  const columnKeys = viewColumns(view, order.showIds, true)
  const sort = parseSort(order.sort, columnKeys)
  const sorted = sort
    ? sortRows(
        inView,
        (row) => GRID_COLUMNS[sort.key as GridColumnKey].value(row, { view: view.key, today }),
        sort.dir
      )
    : inView
  const choice =
    order.group === 'flat'
      ? null
      : order.group === 'reason' || order.group === 'family'
        ? order.group
        : view.groupBy === null
          ? null
          : 'reason'
  const grouping = choice === 'family' ? familyGroup : choice === 'reason' ? reason : null
  const ordered =
    grouping === null ? sorted : groupRows(sorted, grouping).flatMap((group) => group.rows)
  const stops = new Map<number, WalkStop>()
  for (const row of ordered) {
    if (stops.has(row.household_cm_id)) continue
    const pill = attentionFor(row, view.key, today)?.item.pill
    const why = pill ?? (view.groupBy === null ? '' : reason(row).heading)
    stops.set(row.household_cm_id, {
      householdCmId: row.household_cm_id,
      familyName: row.family_name,
      reason: why,
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
