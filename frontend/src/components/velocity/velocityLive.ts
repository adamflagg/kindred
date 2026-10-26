/**
 * PR 5b (#3207): Velocity's and Pace's live point, the enrolled count after the line's 3 a.m. stored point.
 *
 * The backend sends the count (`VelocityResponse.live`); whether to draw it is decided here, from the same
 * sync status the "Enrollments synced …" chip reads, so the point and the chip never disagree. Owner
 * rulings on the PR 5b mock (2026-10-16):
 * - #105/#108: a dashed segment from the stored point (solid) to the live point (hollow), and a
 *   "+N since 3 a.m." callout that disappears at zero;
 * - #106: labelled by the sync time ("as of 2:05 pm sync"), never "now";
 * - #110: the current live season only, on its last point;
 * - #111: hidden when the last good sync is more than 2 hours old (the chip turns amber) and while the
 *   nightly runs, when only the stored count shows.
 */
import { formatCount, formatSignedCount } from '../../utils/numberFormat'
import type { VelocityResponse } from '../../types/velocity'

/** #111: past this, the hourly sync has missed two runs and the live point is hidden. */
export const LIVE_SYNC_MAX_AGE_MS = 2 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
/** A stored count older than this means the nightly was missed ('3 a.m.' would date it wrongly). */
const STORED_STALE_MS = 26 * 60 * 60 * 1000

/** What the sync status says about the viewed season's enrollment (attendees) run. */
export interface LiveSync {
  /** When its last SUCCESSFUL run ended (#111: the last good sync); null when none is known. */
  at: string | null
  /** A run after that success failed, so the count may hold its partial writes and vouches for nothing. */
  failed: boolean
  /** The nightly run is going (from 3:00 to its end): the stored count only. */
  nightly: boolean
}

export interface LivePoint {
  /** The live count, drawn and read by the cards. */
  enrolled: number
  /** The stored (3 a.m.) point it continues from. */
  stored: number
  /** enrolled − stored: the "+N since 3 a.m." callout. */
  added: number
  /** The stored point's day offset. */
  storedDay: number
  /** Where the live point sits: after the stored point by the time between the two counts. */
  x: number
  /** The sync it is as of. */
  at: string
  /**
   * The stored point's date ('2026-12-14'), set only when the stored count is more than ~26 h old, i.e. a
   * nightly was missed: the callout then names that date instead of "3 a.m." (row 3 of the #3283 scan).
   */
  storedDate: string | null
}

/** PocketBase writes "2026-12-14 10:40:12.000Z"; Date.parse wants the T. */
function parseTime(iso: string): number {
  return Date.parse(iso.includes('T') ? iso : iso.replace(' ', 'T'))
}

/** #111: the last sync is more than 2 hours old. False when none is known (no chip to colour). */
export function syncBehind(at: string | null, now: number): boolean {
  return at != null && now - parseTime(at) > LIVE_SYNC_MAX_AGE_MS
}

/**
 * The stored point's date ('2026-12-14') when the stored count is more than ~26 h old, i.e. a nightly was
 * missed; null otherwise, and null with no live count to date it by. From the data alone, so the captions
 * that show while the live point is hidden can name it too (ub:PR#3283:5, OD-48).
 */
export function staleStoredDate(
  data: Pick<VelocityResponse, 'live' | 'combined'>,
  now: number
): string | null {
  const live = data.live
  if (!live || now - parseTime(live.stored_at) <= STORED_STALE_MS) return null
  // A point with no date ('') falls back to the stored count's own day.
  const date = data.combined.daily.at(-1)?.date
  return date !== undefined && date !== '' ? date : live.stored_at.slice(0, 10)
}

export function livePoint(
  data: Pick<VelocityResponse, 'live' | 'combined' | 'today_day_offset'>,
  sync: LiveSync,
  now: number
): LivePoint | null {
  const live = data.live
  const last = data.combined.daily.at(-1)
  if (!live || data.today_day_offset == null || !last) return null
  if (sync.at == null || sync.failed || sync.nightly || syncBehind(sync.at, now)) return null
  const since = parseTime(sync.at) - parseTime(live.stored_at)
  // No sync has finished since the stored count was taken (after the nightly, before the next hourly).
  if (!(since > 0)) return null
  return {
    enrolled: live.enrolled,
    stored: last.enrolled,
    added: live.enrolled - last.enrolled,
    storedDay: last.day_offset,
    x: last.day_offset + Math.min(since / DAY_MS, 1),
    at: sync.at,
    storedDate: staleStoredDate(data, now),
  }
}

/** #106: "as of 2:05 pm sync". */
export function syncTimeLabel(at: string): string {
  const time = new Date(parseTime(at))
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .toLowerCase()
  return `as of ${time} sync`
}

/** 'Dec 14' from '2026-12-14' (a calendar date, so no timezone shift). */
function shortDate(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** When the stored count was taken: "3 a.m.", or "Dec 14, 3 a.m." after a missed nightly (staleStoredDate). */
export function storedCountWhen(storedDate: string | null | undefined): string {
  return storedDate ? `${shortDate(storedDate)}, 3 a.m.` : '3 a.m.'
}

/**
 * #108: "+626 since 3 a.m.", or null at zero (the callout disappears). With the stored point's date
 * (a missed nightly), "+626 since Dec 14, 3 a.m.".
 */
export function sinceStoredLabel(added: number, storedDate?: string | null): string | null {
  if (added === 0) return null
  return `${formatSignedCount(added)} since ${storedCountWhen(storedDate)}`
}

export interface LiveLabelLine {
  text: string
  /** strong: the foreground ink; good/bad: the change inks (DELTA_INK); ink: muted. */
  tone: 'strong' | 'good' | 'bad' | 'ink'
  weight: 400 | 600 | 700
}

/**
 * The words beside the live point, top down: "as of 2:05 pm sync · 1,038", then "+626 since 3 a.m."
 * (never at zero), then last year's figure on the same registration day when there is one (#109: the
 * stored point, never a same-hour figure).
 */
export function liveLabelLines(
  point: LivePoint,
  prior?: { year: number; value: number | null }
): LiveLabelLine[] {
  const lines: LiveLabelLine[] = [
    {
      text: `${syncTimeLabel(point.at)} · ${formatCount(point.enrolled)}`,
      tone: 'strong',
      weight: 700,
    },
  ]
  const since = sinceStoredLabel(point.added, point.storedDate)
  if (since) lines.push({ text: since, tone: point.added > 0 ? 'good' : 'bad', weight: 600 })
  if (prior?.value != null) {
    lines.push({
      text: `${String(prior.year)}: ${formatCount(prior.value)}`,
      tone: 'ink',
      weight: 400,
    })
  }
  return lines
}
