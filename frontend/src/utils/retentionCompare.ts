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
  if (!priorResponse?.prior_basis) return null
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

/** Each bar with last year's rate for the same row; a row last year did not have gets null. */
export function withPriorRates(
  bars: RetentionRateBarItem[],
  priorBars: RetentionRateBarItem[] | undefined,
  keyCurrent: PairKey = (b) => b.name,
  keyPrior: PairKey = keyCurrent
): (RetentionRateBarItem & { priorRate: number | null })[] {
  const prior = new Map((priorBars ?? []).map((b) => [keyPrior(b), b.retentionRate]))
  return bars.map((b) => ({ ...b, priorRate: prior.get(keyCurrent(b)) ?? null }))
}

/** Sessions pair by name through their alias group (a renamed session is the same row). */
export const sessionPairKey = resolveSessionAlias

const firstSummerYear = (b: RetentionRateBarItem) => Number(b.id ?? b.name)
const FOLD = 'fold'

/**
 * First Summer Year pairs by summers in, not by the literal year (a judgement call, pending with
 * the owner): this year's first-timers (id F) against last year's (F − 1). The "2017 or earlier"
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
