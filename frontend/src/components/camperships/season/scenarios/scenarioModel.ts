/**
 * Season › Scenarios' words and the draft's settings (spec §7.4; D35–D38, D117, D137;
 * scenarios-v2.html). Pure. A scenario draft is a whole rules document (D39); the server prices it
 * and records it. Here: what a slider has moved but not yet released, the kept options' two levels,
 * and the results' words. Each figure is the server's (`ResultsOut`), labelled by its definition in
 * bunking/financial_aid/scenarios/results.py.
 */
import type {
  ApiAidLeverEffect,
  ApiAidRulesDocument,
  ApiAidScenarioOption,
  ApiAidScenarioResults,
} from '../../../../types/api-types'
import { formatMoney } from '../../kit/money'

/**
 * What the sliders have moved and not yet released: the two relative moves the server applies
 * (`EvaluateIn.tier_shift`, `band_width_delta`), and the two absolute settings typed or ticked.
 */
export interface Pending {
  readonly tierShift: number
  readonly bandDelta: number
  /** The minimum award as typed (the schema's decimal string), or null: unchanged. */
  readonly minimum: string | null
  /** Grants offset dollar-for-dollar (`grants.offset_mode` "dollar"), or null: unchanged. */
  readonly dollar: boolean | null
}

export const NO_PENDING: Pending = { tierShift: 0, bandDelta: 0, minimum: null, dollar: null }

export function hasPending(pending: Pending): boolean {
  return (
    pending.tierShift !== 0 ||
    pending.bandDelta !== 0 ||
    pending.minimum !== null ||
    pending.dollar !== null
  )
}

/** The draft's dollar-for-dollar switch (sizing.dollar_for_dollar: on is offset mode "dollar"). */
export function isDollarForDollar(document: ApiAidRulesDocument): boolean {
  return (document.grants.offset_mode ?? 'dollar') === 'dollar'
}

/**
 * The draft with the two absolute settings applied, the document `evaluate` prices with the two
 * relative moves on top: the minimum award (sizing.with_minimum) and the offset mode
 * (sizing.with_dollar_for_dollar). Every other setting stays as it is.
 */
export function sizingDocument(
  document: ApiAidRulesDocument,
  pending: Pending
): ApiAidRulesDocument {
  const awards =
    pending.minimum === null ? document.awards : { ...document.awards, minimum: pending.minimum }
  const grants =
    pending.dollar === null
      ? document.grants
      : {
          ...document.grants,
          offset_mode: pending.dollar ? ('dollar' as const) : ('reduce_cost_basis' as const),
        }
  return { ...document, awards, grants }
}

// ── The sliders (D37: every number typed or dragged) ──────────────────────────

/** The sliders' ranges and steps are the screen's (scenarios-v2.html), never policy figures. */
export const SHIFT_RANGE = { min: -15, max: 10, step: 0.5 } as const
export const BAND_RANGE = { min: -10000, max: 10000, step: 500 } as const
export const MINIMUM_RANGE = { min: 0, max: 500, step: 1 } as const

/** "−5 pts", "+2.5 pts", "0 pts". */
export function shiftWords(points: number): string {
  if (points === 0) return '0 pts'
  return `${points < 0 ? '−' : '+'}${String(Math.abs(points))} pts`
}

/** "$5,000 wider", "$500 narrower", "as they are". */
export function bandWords(delta: number): string {
  if (delta === 0) return 'as they are'
  return `${formatMoney(Math.abs(delta))} ${delta > 0 ? 'wider' : 'narrower'}`
}

/** A typed number that fits a slider's range and step, or null. */
export function readStep(
  raw: string,
  range: { min: number; max: number; step: number }
): number | null {
  const text = raw.trim().replace('−', '-').replace(/^\+/, '')
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null
  const value = Number(text)
  if (value < range.min || value > range.max) return null
  return Math.abs(value / range.step - Math.round(value / range.step)) < 1e-9 ? value : null
}

/**
 * "Each +1 pt moves Round 1 by −$12,400" (spec §7.4: beside each setting, what one step moves Round
 * 1 by), from the server's sensitivity read of the draft as recorded. The switch's one step is
 * flipping it (D137).
 */
export function stepWords(effect: ApiAidLeverEffect | undefined): string | null {
  if (effect === undefined) return null
  const moves = `moves Round 1 by ${formatMoney(effect.round1_change)}`
  if (effect.step === null) {
    if (effect.on === null) return null
    return `${effect.on === true ? 'Turning it off' : 'Turning it on'} ${moves}`
  }
  if (effect.lever === 'tier_shift') return `Each +${String(effect.step)} pt ${moves}`
  if (effect.lever === 'band_width') return `Each ${formatMoney(effect.step)} wider ${moves}`
  return `Each +${formatMoney(effect.step)} ${moves}`
}

// ── Kept options: two levels (D38) ────────────────────────────────────────────

export interface KeptGroup {
  readonly start: ApiAidScenarioOption
  readonly variants: readonly ApiAidScenarioOption[]
}

/** Starting points (A, B…) with their variants (A1, B2…) under them, never deeper (D38). */
export function keptGroups(options: readonly ApiAidScenarioOption[]): KeptGroup[] {
  return options
    .filter((option) => option.starting_point === null)
    .map((start) => ({
      start,
      variants: options.filter((option) => option.starting_point === start.code),
    }))
}

/** The starting point a draft from `code` keeps its variants under. */
export function startingPointOf(options: readonly ApiAidScenarioOption[], code: string): string {
  return options.find((option) => option.code === code)?.starting_point ?? code
}

// ── Results (results.py) ───────────────────────────────────────────────────────

export interface ResultLine {
  readonly key: string
  readonly label: string
  readonly value: string
  readonly negative: boolean
}

const requestCount = (n: number): string => `${String(n)} ${n === 1 ? 'request' : 'requests'}`

const money = (key: string, label: string, value: number | null | undefined): ResultLine => ({
  key,
  label,
  value: formatMoney(value),
  negative: value !== null && value !== undefined && value < 0,
})

/**
 * The strip (scenarios-v2.html), each figure under its results.py meaning: Round n is posted + needs
 * an offer + pending approval; Round 2 is the appeals keyed so far (no estimate, Decision 10 of SP9b);
 * Remaining is every round's; the unmet ask sits below the line and is never subtracted.
 */
export function resultLines(results: ApiAidScenarioResults): ResultLine[] {
  return [
    money('round1', 'Round 1', results.round1),
    money('round2', 'Round 2, appeals keyed so far', results.round2),
    money('round3', 'Round 3', results.round3),
    money('round1_remaining', 'Round 1 remaining', results.round1_remaining),
    money('remaining', 'Remaining, every round', results.remaining),
    {
      key: 'at_minimum',
      label: 'At the minimum',
      value: requestCount(results.at_minimum),
      negative: false,
    },
    { key: 'held', label: 'Held', value: requestCount(results.held), negative: false },
    money('round1_unmet', 'Round 1 unmet ask (below the line)', results.round1_unmet),
  ]
}
