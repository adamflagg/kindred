/**
 * Retention against last year (#3207 PR 11; decision 7, rulings #84–#91).
 *
 * While registration is live, Retention compares with last year as it stood on the same
 * registration day (registered by then and not cancelled by then); after, final with final. The
 * server picks the basis (`same_point_of`, `live_same_point`); this file says which in words,
 * pairs each breakdown row with last year's, and holds the one small-row rule.
 */
import type { DefinitionNote } from '../components/camperships/kit/DefinitionNotes'
import type { RetentionByCity, RetentionMetrics, RetentionRateBarItem } from '../types/metrics'
import { formatDay } from '../pages/metrics/registration/overviewCompareBasis'
import { deltaInk } from './deltaTokens'
import { formatCount } from './numberFormat'
import { PRIORITY_DAY_NOTE, isPriorityDayOffset, readsThroughNextDay } from './priorityDay'
import { resolveSessionAlias } from './sessionAliases'
import { FIRST_HISTORY_SUMMER } from './metricsTransforms'
import { aggregateCityRetentionByRegion, REGION_DISPLAY_NAMES } from './regionUtils'
import { regionToBarData } from './retentionTransforms'

/**
 * Ruling #91 (owner, 2026-10-16): every row shows its change, whatever its size; a row whose base
 * season holds fewer campers than this shows it muted. The one threshold, used everywhere.
 */
export const SMALL_BASE_CAMPERS = 30

export function isSmallBase(baseCount: number): boolean {
  return baseCount < SMALL_BASE_CAMPERS
}

/** A change of rates (0–1) in percentage points, or null with nothing to compare with. */
export function pointsBetween(rate: number, prior: number | null | undefined): number | null {
  return prior == null ? null : (rate - prior) * 100
}

/** Points to one decimal: zero (after rounding) has no sign, and a fall takes the true minus. */
function roundPoints(points: number): number {
  const r = Math.round(points * 10) / 10
  return r === 0 ? 0 : r
}

/** "+1.9 pts", "−6.1 pts", "0.0 pts". */
export function formatSignedPoints(points: number): string {
  return `${formatSignedPointsBare(points)} pts`
}

/** "+1.9", "−6.1", "0.0": the change without its unit, for narrow chart faces. */
export function formatSignedPointsBare(points: number): string {
  const r = roundPoints(points)
  const sign = r > 0 ? '+' : r < 0 ? '−' : ''
  return `${sign}${Math.abs(r).toFixed(1)}`
}

/** The arrow before a change, judged on its one-decimal value. */
export function changeArrow(points: number): '▲ ' | '▼ ' | '' {
  const r = roundPoints(points)
  return r > 0 ? '▲ ' : r < 0 ? '▼ ' : ''
}

/** The ink for a change, judged on its one-decimal value as the arrow is: "0.0" is never green or red. */
export function changeInk(points: number): string {
  return deltaInk(roundPoints(points), 'up-good')
}

/** What the page says about the year it compares with (#86). */
export interface RetentionBasis {
  live: boolean
  label: 'vs same point last year' | "vs last year's final"
  /** The sentence under the title; its numbered marks sit on the date and the registration day. */
  text: string
  /** The basis's own numbered notes, from `firstNote`. */
  notes: DefinitionNote[]
  /** On the priority date itself the change waits a day (ruling 9): it reads "updates tomorrow". */
  pending: boolean
  /** While live, the date in `text` ("Oct 16, 2025"), where the sentence takes note 1's mark. */
  day?: string
}

type PriorFields = Pick<
  RetentionMetrics,
  'prior_basis' | 'day_offset' | 'prior_day_offset' | 'as_of_date'
>

/**
 * `priorResponse` is last year's retention asked with `same_point_of` this year; `current` is
 * this year's headline (`year` is the season campers return into).
 */
export function describeRetentionBasis(
  priorResponse: PriorFields | undefined,
  current: { year: number; base: number; returned: number },
  firstNote = 1
): RetentionBasis | null {
  // 'unavailable' is not a comparison at all: the page says why instead (retentionUnavailableText).
  if (!priorResponse?.prior_basis || priorResponse.prior_basis === 'unavailable') return null
  const C = current.year
  const B = C - 1

  if (priorResponse.prior_basis === 'final' || !priorResponse.as_of_date) {
    return {
      live: false,
      label: "vs last year's final",
      text: `Compared with ${B}'s final numbers.`,
      notes: [
        {
          n: firstNote,
          text: `Each change is ${C}'s retention against ${B - 1} → ${B}'s: of the campers enrolled one year, the share enrolled the next. Both years are read as they stand.`,
        },
      ],
      pending: false,
    }
  }

  const day = formatDay(priorResponse.as_of_date)
  const notes: DefinitionNote[] = [
    {
      n: firstNote,
      text: `${C} is today's count: of the ${formatCount(current.base)} campers enrolled in ${B}, ${formatCount(current.returned)} are already enrolled for ${C}, and registration is open, so the rate is still rising. ${B} is rebuilt from registration dates: campers from ${B - 1} who were registered by ${day} and not cancelled by then.`,
    },
  ]
  if (readsThroughNextDay(priorResponse.day_offset, priorResponse.prior_day_offset)) {
    notes.push({ n: firstNote + 1, text: PRIORITY_DAY_NOTE })
  }
  return {
    live: true,
    label: 'vs same point last year',
    text: `Compared with ${B} as it stood on ${day}, the same registration day as today.`,
    notes,
    pending: isPriorityDayOffset(priorResponse.day_offset),
    day,
  }
}

/** The one line shown instead of a comparison when last year's registration dates could not be read. */
export function retentionUnavailableText(
  priorResponse: Pick<RetentionMetrics, 'prior_basis'> | undefined,
  currentYear: number
): string | null {
  if (priorResponse?.prior_basis !== 'unavailable') return null
  return `No comparison: ${currentYear - 1}'s registration dates couldn't be read.`
}

/** What every chart and table that compares with last year needs to say so. */
export interface RetentionCompareView {
  live: boolean
  /** The basis note's number: the change headers and the headline chip carry its mark. */
  noteN: number
  label: RetentionBasis['label']
  pending: boolean
  /** This year's series ("2026 so far") and last year's ("2025 at this registration day"). */
  nowLegend: string
  priorLegend: string
  priorYear: number
}

export function retentionCompareView(basis: RetentionBasis, year: number): RetentionCompareView {
  const priorYear = year - 1
  return {
    live: basis.live,
    noteN: basis.notes[0]?.n ?? 1,
    label: basis.label,
    pending: basis.pending,
    nowLegend: basis.live ? `${year} so far` : `${year} final`,
    priorLegend: basis.live ? `${priorYear} at this registration day` : `${priorYear} final`,
    priorYear,
  }
}

type PairKey = (bar: RetentionRateBarItem) => string

/**
 * Each bar with last year's rate for the same row; a row last year did not have gets null. Last
 * year's rows that share a key (one season can hold "Springfield" and "Springfield, CA") pool their
 * campers, so a 1-camper row never stands in for the 60-camper one.
 */
export function withPriorRates(
  bars: RetentionRateBarItem[],
  priorBars: RetentionRateBarItem[] | undefined,
  keyCurrent: PairKey = (b) => b.name,
  keyPrior: PairKey = keyCurrent
): Array<RetentionRateBarItem & { priorRate: number | null }> {
  const pooled = new Map<string, { rate: number; base: number; returned: number }>()
  for (const b of priorBars ?? []) {
    const key = keyPrior(b)
    const seen = pooled.get(key)
    if (!seen) {
      pooled.set(key, { rate: b.retentionRate, base: b.baseCount, returned: b.returnedCount })
      continue
    }
    const base = seen.base + b.baseCount
    const returned = seen.returned + b.returnedCount
    pooled.set(key, { rate: base > 0 ? returned / base : seen.rate, base, returned })
  }
  return bars.map((b) => ({ ...b, priorRate: pooled.get(keyCurrent(b))?.rate ?? null }))
}

/** A city label split into its folded name and its two-letter state ('' when it has none). */
function splitCity(name: string): { city: string; state: string } {
  const folded = name.trim().replace(/\s+/g, ' ')
  const m = /^(.*?)\s*,\s*([A-Za-z]{2})$/.exec(folded)
  return m
    ? { city: (m[1] ?? '').toLowerCase(), state: (m[2] ?? '').toUpperCase() }
    : { city: folded.toLowerCase(), state: '' }
}

/**
 * Each city bar with last year's rate for the same city. Cities pair on city plus state wherever
 * both years carry a state, so "Lafayette, CA" and "Lafayette, CO" never share a rate (#3286).
 * The state is dropped only when one side lacks it: CampMinder holds "Springfield" one year and
 * "Springfield, CA" the next. A stateless city borrows a stated one only when last year held a
 * single state of that name; with two it pairs with nothing rather than guess. Last year's rows that
 * qualify pool their campers, so a 1-camper row never stands in for the 60-camper one; a stateless
 * row pools into a stated city only when last year held at most one state of that name.
 */
export function withPriorCityRates<T extends RetentionRateBarItem>(
  bars: T[],
  priorBars: RetentionRateBarItem[] | undefined
): Array<T & { priorRate: number | null }> {
  const byCity = new Map<string, Map<string, RetentionRateBarItem[]>>()
  for (const b of priorBars ?? []) {
    const { city, state } = splitCity(b.name)
    const states = byCity.get(city) ?? new Map<string, RetentionRateBarItem[]>()
    states.set(state, [...(states.get(state) ?? []), b])
    byCity.set(city, states)
  }
  return bars.map((b) => {
    const { city, state } = splitCity(b.name)
    const states = byCity.get(city)
    if (!states) return { ...b, priorRate: null }
    const stated = [...states.keys()].filter((k) => k !== '')
    const onlyState = stated.length === 1 ? stated[0] : undefined
    const borrowed = state !== '' ? state : onlyState
    // A stateless row joins a stated city only when last year held at most one state of that name.
    const stateless = state === '' || stated.length <= 1 ? (states.get('') ?? []) : []
    const rows = [...stateless, ...(borrowed ? (states.get(borrowed) ?? []) : [])]
    const [first] = rows
    if (!first) return { ...b, priorRate: null }
    const base = rows.reduce((n, r) => n + r.baseCount, 0)
    const returned = rows.reduce((n, r) => n + r.returnedCount, 0)
    return {
      ...b,
      priorRate: rows.length === 1 || base === 0 ? first.retentionRate : returned / base,
    }
  })
}

/** Sessions pair by name through their alias group (a renamed session is the same row). */
export const sessionPairKey = resolveSessionAlias

const firstSummerYear = (b: RetentionRateBarItem) => Number(b.id ?? b.name)
const FOLD = 'fold'

/**
 * First Summer Year pairs by summers in, not by the literal year (a judgement call the owner ruled,
 * "pr11 a"): this year's first-timers (id F) against last year's (F − 1). The "2017 or earlier"
 * bucket pairs with itself, so 2018 has no exact match. To pair by the literal year instead, make
 * `prior` the same as `current`.
 */
export const firstSummerPairKeys: { current: PairKey; prior: PairKey } = {
  current: (b) => {
    const y = firstSummerYear(b)
    return y <= FIRST_HISTORY_SUMMER ? FOLD : String(y)
  },
  prior: (b) => {
    const y = firstSummerYear(b)
    return y <= FIRST_HISTORY_SUMMER ? FOLD : String(y + 1)
  },
}

/** Last year's regions, from its whole city list (as the page builds this year's). */
export function regionPriorBars(
  priorByCity: RetentionByCity[] | undefined
): RetentionRateBarItem[] {
  return regionToBarData(aggregateCityRetentionByRegion(priorByCity ?? [])).map((b) => ({
    ...b,
    name: REGION_DISPLAY_NAMES[b.name] ?? b.name,
  }))
}

/** The tooltip's words for a row's change: "+6.1 pts vs 2025 at this registration day". */
export function describeRowChange(
  rate: number,
  priorRate: number | null | undefined,
  compare: RetentionCompareView
): string {
  const points = pointsBetween(rate, priorRate)
  if (points === null) return `${compare.priorYear} had no such row`
  return `${formatSignedPoints(points)} vs ${compare.priorLegend}`
}
