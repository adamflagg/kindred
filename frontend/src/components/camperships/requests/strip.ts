/**
 * The views strip (slice 1 grid layout T4; mock grid-layout-options.html v=f, ls=b, po=b, rv=todo,
 * ap=lens). Lenses on the left narrow every count (RULED P2); the pipeline runs in order (b)
 * (RULED P1); the exceptions that block a request at any stage sit on the right (RULED P4). Pure:
 * RequestViewNav draws it and the page reads the URL through `resolveStrip`.
 */
import type { ApiAidGridRow } from '../../../types/api-types'
import {
  filterRows,
  NO_FILTERS,
  requestsCsvName,
  requestView,
  viewCount,
  type GridFilters,
  type RequestView,
  type RequestViewKey,
  type ViewCount,
} from './views'

export type RequestLens = 'all' | 'appeals'

export const PIPELINE_STAGES: readonly RequestViewKey[] = [
  'pending_approval',
  'needs_offer',
  'not_reconciled',
  'waiting_on_family',
]

/** No Finance approval badge: no view of that name exists (Pending approval is the pipeline's). */
export const EXCEPTION_BADGES: readonly RequestViewKey[] = [
  'holds',
  'duplicates',
  'session_not_settled',
  'to_reverse',
]

export const STRIP_LEGEND =
  'Stages run left to right per round · badges block a request at any stage · the lens on the left narrows every count.'
export const APPEALS_LEGEND = 'Showing appeals only.'

const APPEALS = requestView('appeals')
const ALL = requestView('all')

export interface StripState {
  readonly lens: RequestLens
  /** The chevron or badge picked; null: the lens itself. */
  readonly stage: RequestView | null
}

/** Every stage `?view=` can name: the pipeline, the badges, and Cancelled: give a reason (a Today line). */
const STAGES: ReadonlySet<RequestViewKey> = new Set([
  ...PIPELINE_STAGES,
  ...EXCEPTION_BADGES,
  'cancel_reason',
])

/**
 * The strip's URL (D15): `?lens=appeals` (absent: All) and `?view=<stage slug>` (absent: no stage).
 * One scheme, no fallback (owner ruling 2026-10-03: nothing has launched, so no old links exist):
 * `?view=all` and `?view=appeals` are not stages and read as none.
 */
export function resolveStrip(viewParam: string | null, lensParam: string | null): StripState {
  const view = viewParam === null ? null : requestView(viewParam)
  return {
    lens: lensParam === 'appeals' ? 'appeals' : 'all',
    stage: view !== null && STAGES.has(view.key) ? view : null,
  }
}

/** What the grid shows: the lens alone (All, or the Appeals view), or the stage, with the Appeals view's columns under that lens. */
export function shownView(lens: RequestLens, stage: RequestView | null): RequestView {
  if (stage === null) return lens === 'appeals' ? APPEALS : ALL
  return lens === 'appeals' ? { ...stage, columns: APPEALS.columns } : stage
}

/** The rows a lens keeps: every one, or the server's Appeals queue (D21). */
export function lensRows(
  rows: readonly ApiAidGridRow[],
  lens: RequestLens
): readonly ApiAidGridRow[] {
  return lens === 'all' ? rows : filterRows(rows, 'appeals', NO_FILTERS)
}

/** Each lens's own count under the filters; on a past date only All's, since queues aren't rebuilt (Decision 11). */
export function lensCounts(
  rows: readonly ApiAidGridRow[],
  filters: GridFilters,
  live: boolean
): ReadonlyMap<RequestLens, ViewCount> {
  const counts = new Map<RequestLens, ViewCount>([
    ['all', viewCount(filterRows(rows, 'all', filters))],
  ])
  if (live) counts.set('appeals', viewCount(filterRows(rows, 'appeals', filters)))
  return counts
}

/** D70's name, with `-appeals` after a stage picked under the Appeals lens. */
export function stripCsvName(
  lens: RequestLens,
  view: RequestView,
  filters: Pick<GridFilters, 'program' | 'pool' | 'round' | 'tick'>,
  season: number,
  asOf: string | null
): string {
  const named =
    lens === 'appeals' && view.key !== 'appeals' ? { ...view, slug: `${view.slug}-appeals` } : view
  return requestsCsvName(named, filters, season, asOf)
}
