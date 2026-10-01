/**
 * The as-of state of a Camperships page (D15, D20; the 3c reads). `?as_of=YYYY-MM-DD` shows the
 * season by the end of that day, camp time; `?as_of_axis=recorded` switches to what Kindred had
 * recorded by then (default: CampMinder's post day). Today or no date is live, as the server's
 * `_past_day` reads it (Ruling 2026-10-01 (plan review)). A link whose date is malformed or after
 * today is `invalid`: the band says so and every read runs live, so a bad link never passes
 * for the sender's view.
 */
import { parseIsoDay } from './dates'

export type AidAsOfAxis = 'campminder' | 'recorded'

export type AidAsOf =
  | { readonly kind: 'live' }
  | { readonly kind: 'past'; readonly date: string; readonly axis: AidAsOfAxis }
  | { readonly kind: 'invalid'; readonly raw: string }

export function parseAsOf(raw: string | null, axisRaw: string | null, today: string): AidAsOf {
  if (raw === null || raw === '' || raw === today) return { kind: 'live' }
  if (parseIsoDay(raw) === null || raw > today) return { kind: 'invalid', raw }
  return { kind: 'past', date: raw, axis: axisRaw === 'recorded' ? 'recorded' : 'campminder' }
}

/** The read's query parameters: none when live or invalid. */
export function asOfQuery(asOf: AidAsOf): Record<string, string> {
  if (asOf.kind !== 'past') return {}
  return asOf.axis === 'recorded'
    ? { as_of: asOf.date, as_of_axis: 'recorded' }
    : { as_of: asOf.date }
}

/** What a Camperships link must reproduce (D15): the season and the as-of. */
export interface AidView {
  readonly year: number
  readonly asOf: AidAsOf
}

/**
 * A link that reproduces the view (D15): extra parameters (a pool filter), then the season
 * (`?year=`, which CurrentYearContext already reads; D85, Decision 9 RULED 2026-10-01), then the
 * as-of. A season not known yet (0) is left off.
 */
export function aidHref(path: string, view: AidView, extra: Record<string, string> = {}): string {
  const season: Record<string, string> = view.year > 0 ? { year: String(view.year) } : {}
  const query = new URLSearchParams({ ...extra, ...season, ...asOfQuery(view.asOf) }).toString()
  return query ? `${path}?${query}` : path
}
