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

/** What the sync status says about the viewed season's enrollment (attendees) run. */
export interface LiveSync {
  /** When its last finished run ended; null when none is known. */
  at: string | null
  /** That run failed, so it vouches for nothing. */
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
}

/** PocketBase writes "2026-12-14 10:40:12.000Z"; Date.parse wants the T. */
function parseTime(iso: string): number {
  return Date.parse(iso.includes('T') ? iso : iso.replace(' ', 'T'))
}

/** #111: the last sync is more than 2 hours old. False when none is known (no chip to colour). */
export function syncBehind(at: string | null, now: number): boolean {
  return at != null && now - parseTime(at) > LIVE_SYNC_MAX_AGE_MS
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
  }
}

/** #106: "as of 2:05 pm sync". */
export function syncTimeLabel(at: string): string {
  const time = new Date(parseTime(at))
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .toLowerCase()
  return `as of ${time} sync`
}

/** #108: "+626 since 3 a.m.", or null at zero (the callout disappears). */
export function sinceStoredLabel(added: number): string | null {
  return added === 0 ? null : `${formatSignedCount(added)} since 3 a.m.`
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
  const since = sinceStoredLabel(point.added)
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
