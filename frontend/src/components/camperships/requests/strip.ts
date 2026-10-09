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

/**
 * No Finance approval badge: no view of that name exists (Pending approval is the pipeline's). In
 * folding order: the trailing badges fold into the +N chip first.
 */
export const EXCEPTION_BADGES: readonly RequestViewKey[] = [
  'holds',
  'duplicates',
  'session_not_settled',
  'to_reverse',
]

/**
 * The strip's words, each in a native title on the element it explains (design-language §6; owner
 * 1a/1b: no sentence row that comes and goes). The legend line that said all of this at once is gone.
 */
const NARROWS = 'The lens narrows every count on the strip.'
export function lensTitle(lens: RequestLens): string {
  return lens === 'all'
    ? `All: every request. ${NARROWS}`
    : `Appeals: requests with a Round 2 or later ask. ${NARROWS}`
}

export const stageTitle = (label: string): string =>
  `${label}: stages run left to right, per round.`

/**
 * Session unclear: the request's session is 0 because registration settles it on no one session
 * (financial_aid_session_resolver: the family is enrolled in none of the answer's program, or in
 * several the answer's text does not tell apart). It resolves on enrollment, or by staff.
 */
export const BADGE_TITLES: Readonly<Record<string, string>> = {
  holds:
    "On hold: a hold stops the request at any stage until it is released. The row's Needs attention chip says which.",
  duplicates:
    'Duplicates: two requests look like the same camper and session. Open the household to keep one.',
  session_not_settled:
    'Session unclear: no one enrolled session matches the request yet. It settles when the camper enrolls, or use Settle Session… on the household page.',
  to_reverse:
    'To reverse: cancelled, withdrawn or a duplicate, and camp aid is still live in CampMinder. Reverse it there.',
}

export type BadgeTone = 'red' | 'amber' | 'zero'

/** An unsettled session waits on a rule, not a fault: amber, as the mock tones it. */
const AMBER_BADGES: ReadonlySet<RequestViewKey> = new Set(['session_not_settled'])

/**
 * The badges drawn (owner 2026-10-04, RULED D-a's option 3 for every badge): one shows only when
 * something is in it, or while it is the picked stage. A count not known (the grid loading, or a
 * past date, whose queues aren't rebuilt: Decision 11) is not due either, so nothing flashes.
 */
export function shownBadges(
  stage: RequestViewKey | null,
  counts: ReadonlyMap<RequestViewKey, ViewCount> | null
): RequestViewKey[] {
  return EXCEPTION_BADGES.filter((key) => key === stage || (counts?.get(key)?.requests ?? 0) > 0)
}

/** A badge's tone: red, amber for an unsettled session, or zero (muted) when empty. */
export function badgeTone(key: RequestViewKey, count: ViewCount | undefined): BadgeTone {
  if (!count?.requests) return 'zero'
  return AMBER_BADGES.has(key) ? 'amber' : 'red'
}

/** The +N chip's tone: red if any folded badge is red, else amber if any is amber, else zero. */
export function foldTone(
  folded: readonly RequestViewKey[],
  counts: ReadonlyMap<RequestViewKey, ViewCount> | null
): BadgeTone {
  const tones = folded.map((key) => badgeTone(key, counts?.get(key)))
  return tones.includes('red') ? 'red' : tones.includes('amber') ? 'amber' : 'zero'
}

/** Floating-point noise in summed widths, not a real overrun. */
const FIT_EPSILON = 0.01

/**
 * How many badges stay on the strip's line (owner 2026-10-04): all of them when they fit in
 * `available`, else the most leading ones that fit beside the +N chip (`gap` between each). The
 * rest, trailing, fold into the chip. 0 when not even one fits beside it.
 */
export function foldBadges(
  widths: readonly number[],
  chipWidth: number,
  available: number,
  gap: number
): number {
  const fits = (shown: number, chip: boolean) => {
    const items = shown + (chip ? 1 : 0)
    let width = chip ? chipWidth : 0
    for (let i = 0; i < shown; i++) width += widths[i] ?? 0
    return width + gap * Math.max(0, items - 1) <= available + FIT_EPSILON
  }
  if (fits(widths.length, false)) return widths.length
  for (let shown = widths.length - 1; shown > 0; shown--) if (fits(shown, true)) return shown
  return 0
}

const APPEALS = requestView('appeals')
const ALL = requestView('all')

export interface StripState {
  readonly lens: RequestLens
  /** The chevron or badge picked; null: the lens itself. */
  readonly stage: RequestView | null
}

/** Every stage `?view=` can name: the pipeline and the badges. */
const STAGES: ReadonlySet<RequestViewKey> = new Set([...PIPELINE_STAGES, ...EXCEPTION_BADGES])

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
  filters: Parameters<typeof requestsCsvName>[1],
  season: number,
  asOf: string | null
): string {
  const named =
    lens === 'appeals' && view.key !== 'appeals' ? { ...view, slug: `${view.slug}-appeals` } : view
  return requestsCsvName(named, filters, season, asOf)
}
