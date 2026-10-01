/**
 * The receipt (§4.7, §6.5; D33, D34, D76; mockups/receipt.html D): the calculator's trace as a
 * sentence on top and a line receipt under it. The server computes every step (D21) and sends the
 * trace unchanged; this module only words it (Decision 5, RULED 2026-10-01), so the editor row
 * and the household page can never disagree. Wording follows the engine
 * (bunking/financial_aid/calculator/engine.py, tiers.py; Ruling 2026-10-01 (plan review)).
 */
import { aidHref } from './asOf'
import { formatShortDate } from './dates'
import { MINUS, formatMoney } from './money'

export type TraceValue = string | number | boolean | null

/** bunking/financial_aid/calculator/result.py `TraceStep`, as the generator types it. */
export interface AidTraceStep {
  readonly key: string
  readonly label: string
  readonly value?: TraceValue | undefined
  readonly inputs?: Readonly<Record<string, TraceValue>> | undefined
  readonly bound?: string | null | undefined
  readonly note?: string | null | undefined
}

export type ReceiptLabel =
  | {
      readonly kind: 'live'
      readonly season: number
      readonly rulesVersion: number
      readonly decidedByName?: string | null | undefined
    }
  | {
      readonly kind: 'locked'
      readonly season: number
      readonly rulesVersion: number
      readonly lockedOn: string
      readonly lockSource: 'tick' | 'ledger'
      readonly tickedByName?: string | null | undefined
      readonly decidedByName?: string | null | undefined
    }
  | { readonly kind: 'reproduced'; readonly season: number; readonly rulesVersion: number }

/** "rules 2027 v3": the words the label links to Season › Rules (D76). */
export function receiptRulesWords(label: ReceiptLabel): string {
  return `rules ${String(label.season)} v${String(label.rulesVersion)}`
}

/** D76: the rules version a receipt names opens that version, read only for `view` holders. */
export function receiptRulesHref(label: ReceiptLabel): string {
  return aidHref(
    '/aid/season/rules',
    { year: label.season, asOf: { kind: 'live' } },
    { version: String(label.rulesVersion) }
  )
}

/** §4.7's label: what version, live or locked, and what locked it. */
export function receiptLabel(label: ReceiptLabel): string {
  const rules = receiptRulesWords(label)
  if (label.kind === 'reproduced')
    return `${rules} · ${String(label.season)}, reproduced from the repaired sheet`
  const decided = label.decidedByName ? ` · decided by ${label.decidedByName}` : ''
  if (label.kind === 'live') return `live · ${rules}${decided}`
  const by =
    label.lockSource === 'ledger'
      ? 'the ledger match'
      : label.tickedByName
        ? `${label.tickedByName}'s Posted tick`
        : 'a Posted tick'
  return `${rules} · locked ${formatShortDate(label.lockedOn)} by ${by} · as it was when posted${decided}`
}

const isBlank = (value: TraceValue | undefined) =>
  value === null || value === undefined || value === ''

function money(value: TraceValue | undefined): string {
  if (isBlank(value)) return '—'
  const n = Number(value)
  return Number.isFinite(n) ? formatMoney(n) : String(value)
}

function pct(value: TraceValue | undefined): string {
  const n = Number(value)
  return isBlank(value) || !Number.isFinite(n) ? '—' : `${String(Number(n.toFixed(1)))}%`
}

function text(value: TraceValue | undefined, fallback = ''): string {
  return value === null || value === undefined || value === '' ? fallback : String(value)
}

function signed(n: number): string {
  return n > 0 ? `+${String(n)}` : n < 0 ? `${MINUS}${String(Math.abs(n))}` : '0'
}

/** A line's value: a tier as a number, a shift signed, a percentage, otherwise money. */
export function stepValue(step: AidTraceStep): string {
  const value = step.value
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  switch (step.key) {
    case 'income_tier':
    case 'final_tier':
      return String(value)
    case 'equity_shift':
      return signed(Number(value))
    case 'r1_pct':
      return pct(value)
  }
  const n = Number(value)
  return Number.isFinite(n) ? formatMoney(n) : String(value)
}

const AWARD_KEYS = new Set(['r1', 'r2', 'r3'])

/** The engine's limits (engine.py), as words. `table` and `full_cost` aren't limits. */
const LIMITS: Readonly<Record<string, string>> = {
  ask: "limited by the family's ask",
  minimum: 'raised to the minimum award',
  grants_cover: 'limited by outside grants covering the cost',
  income_ceiling: 'above the income ceiling',
  no_table: 'no award table',
  appeal: "limited by the family's appeal",
  cap: 'limited by the Round 2 cap',
  original_ask: "limited by the family's original ask",
  not_allowed: 'not open this season',
  total_cap: 'cut to fit the total-aid cap',
  request: "limited by the family's Round 3 ask",
  max_amount: 'limited by the Round 3 maximum',
  not_eligible: 'not eligible for Round 3',
  cost_unknown: 'cost not known',
  ask_missing: 'no ask entered',
  r1_unknown: 'Round 1 not worked out',
}
const NOT_LIMITS = new Set(['table', 'full_cost'])

/** The limit that decided a round's award (amber, §6.5); null when the table or full cost set it. */
export function bindingPhrase(step: AidTraceStep): string | null {
  const bound = step.bound
  if (!AWARD_KEYS.has(step.key) || bound === null || bound === undefined || NOT_LIMITS.has(bound))
    return null
  // Round 3's `cap` is its own share-of-cost limit, not Round 2's cap (engine.py `_round3`).
  if (step.key === 'r3' && bound === 'cap') return 'limited by the Round 3 share of the cost'
  return LIMITS[bound] ?? bound.replaceAll('_', ' ')
}

/** How a line was worked out, shown when the line is clicked (D33). */
export function stepHow(step: AidTraceStep): string {
  const i = step.inputs ?? {}
  if (/^r[123]_locked$/.test(step.key)) {
    return `worked out ${money(i['worked_out'])} now; locked at what was posted, and later rounds build on it`
  }
  switch (step.key) {
    case 'weighted_income':
      return (
        `${pct(Number(i['weight_prior']) * 100)} of prior year ${money(i['prior_year'])} + ` +
        `${pct(Number(i['weight_current']) * 100)} of current year ${money(i['current_year'])} (${text(i['basis'])})` +
        (isBlank(i['override_mode']) ? '' : `; staff override: ${text(i['override_mode'])}`)
      )
    case 'income_adjustments': {
      const parts = Object.entries(i)
        .filter(([, v]) => !isBlank(v) && Number(v) !== 0)
        .map(([k, v]) => `${k.replaceAll('_', ' ')} ${money(v)}`)
      return parts.length > 0 ? parts.join(' · ') : 'none apply'
    }
    case 'adjusted_income':
      return `after adjustments and dependents; never below ${money(i['floor'] ?? 0)}`
    case 'income_tier':
      return `the tier band ${money(i['adjusted_income'])} falls in`
    case 'equity_shift':
      if (isBlank(i['equity_class'])) return 'this program has no equity class'
      return `${text(i['equity_class'])} class · criteria met: ${text(i['criteria_met'], 'none')} · weight ${text(i['weight_sum'], '0')}`
    case 'final_tier': {
      // tiers.py `final_tier`: the shift is subtracted, so +1 moves a family one tier down the table.
      const shift = Number(i['equity_shift'] ?? 0)
      return `tier ${text(i['income_tier'])} ${shift >= 0 ? MINUS : '+'} ${String(Math.abs(shift))}`
    }
    case 'cost':
      return i['source'] === 'override'
        ? 'a staff override (cost or headcount), with its reason on record'
        : `${text(i['source'])} price` +
            (Number(i['incentive_reduction'] ?? 0) !== 0
              ? ` less incentive ${money(i['incentive_reduction'])}`
              : '')
    case 'grants':
      if (isBlank(i['offset_mode'])) return 'outside grants do not offset this program this season'
      return (
        `outside grants counted when ${text(i['count_when'])}; ` +
        (i['offset_mode'] === 'dollar'
          ? 'taken off the award dollar for dollar'
          : 'taken off the cost before the percentage') +
        (Number(i['late_left_out'] ?? 0) !== 0
          ? `; ${text(i['late_left_out'])} late grant left out`
          : '')
      )
    case 'r1_pct':
      return `${text(i['table'])} award table, tier ${text(i['tier'])}`
    case 'r1_potential':
      return (
        `${pct(i['pct'])} × ${money(i['cost'])}` +
        (Number(i['grants'] ?? 0) !== 0 ? ` less grants ${money(i['grants'])}` : '') +
        `, never below the ${money(i['minimum'])} minimum`
      )
    case 'r1':
      return `the lower of the ask ${money(i['ask'])} and the potential ${money(i['potential'])}`
    case 'r2_cap':
      return `${pct(i['total_pct'])} of ${money(i['cost'])} in all, less Round 1 ${money(i['r1'])}${i['grants_subtracted'] === true ? ' and grants' : ''}`
    case 'r2':
      return `the lower of the appeal ${money(i['appeal'])} and the cap ${money(i['cap'])}`
    case 'r3':
      return `the amount requested, ${money(i['requested'])}`
    case 'total_cap':
      return `${pct(i['pct_of_cost'])} of the cost${i['include_grants'] === true ? ', less grants' : ''}, Round 1 included`
    case 'total':
      return (
        ['r1', 'r2', 'r3']
          .filter((k) => !isBlank(i[k]))
          .map((k) => `Round ${k.slice(1)} ${money(i[k])}`)
          .join(' + ') +
        (Number(i['top_up'] ?? 0) !== 0 ? ` + top-up ${money(i['top_up'])}` : '') +
        (Number(i['discretionary'] ?? 0) !== 0
          ? ` + discretionary ${money(i['discretionary'])}`
          : '')
      )
    default:
      return Object.entries(i)
        .map(([k, v]) => `${k.replaceAll('_', ' ')}: ${text(v, '—')}`)
        .join(' · ')
  }
}

const SECTIONS: ReadonlyArray<{ name: string; keys: readonly string[] }> = [
  { name: 'Income', keys: ['weighted_income', 'income_adjustments', 'adjusted_income'] },
  { name: 'Tier', keys: ['income_tier', 'equity_shift', 'final_tier'] },
  { name: 'Cost', keys: ['cost', 'grants'] },
  { name: 'Round 1', keys: ['r1_pct', 'r1_potential', 'r1', 'r1_locked'] },
  { name: 'Round 2', keys: ['r2_cap', 'r2', 'r2_locked'] },
  { name: 'Round 3', keys: ['r3', 'r3_locked'] },
  {
    name: 'Total',
    keys: [
      'total_cap',
      'top_up',
      'top_up_locked',
      'discretionary',
      'discretionary_locked',
      'total',
    ],
  },
]

export interface ReceiptSection {
  readonly name: string
  readonly steps: readonly AidTraceStep[]
}

/** The line receipt's groups (§6.5). A step it doesn't know goes in "Other steps", before the total, never dropped. */
export function receiptSections(trace: readonly AidTraceStep[]): ReceiptSection[] {
  const known = new Set(SECTIONS.flatMap((s) => s.keys))
  const sections: ReceiptSection[] = SECTIONS.map(({ name, keys }) => ({
    name,
    steps: trace.filter((step) => keys.includes(step.key)),
  })).filter((section) => section.steps.length > 0)
  const other = trace.filter((step) => !known.has(step.key))
  if (other.length === 0) return sections
  const totalAt = sections.findIndex((s) => s.name === 'Total')
  const at = totalAt === -1 ? sections.length : totalAt
  return [...sections.slice(0, at), { name: 'Other steps', steps: other }, ...sections.slice(at)]
}

export function receiptLineCount(trace: readonly AidTraceStep[]): number {
  return trace.filter((step) => step.key !== 'total').length
}

export interface SentencePart {
  readonly text: string
  readonly kind: 'plain' | 'figure' | 'bound'
}

/**
 * The sentence (§6.5): "Adjusted income $X → tier N. Round 1: P% of $C = $Q, limited by … to $A.
 * Total $T." A locked round ends "; posted $L" (D43, D52), and the total is the locked one.
 */
export function receiptSentence(trace: readonly AidTraceStep[]): SentencePart[] {
  const parts: SentencePart[] = []
  const plain = (t: string) => parts.push({ text: t, kind: 'plain' })
  const figure = (t: string) => parts.push({ text: t, kind: 'figure' })
  const find = (key: string) => trace.find((step) => step.key === key)
  const limitThenFigure = (step: AidTraceStep) => {
    const limit = bindingPhrase(step)
    if (limit === null) {
      figure(stepValue(step))
      return
    }
    parts.push({ text: limit, kind: 'bound' })
    plain(limit.startsWith('limited by') ? ' to ' : ' → ')
    figure(stepValue(step))
  }
  const endRound = (n: 1 | 2 | 3) => {
    const locked = find(`r${String(n)}_locked`)
    if (locked) {
      plain('; posted ')
      figure(stepValue(locked))
    }
    plain('.')
  }
  const roundTail = (step: AidTraceStep, n: 1 | 2 | 3) => {
    if (bindingPhrase(step) === null) plain(' → ')
    else plain(', ')
    limitThenFigure(step)
    endRound(n)
  }

  const adjusted = find('adjusted_income')
  const tier = find('income_tier')
  if (adjusted && tier) {
    plain('Adjusted income ')
    figure(stepValue(adjusted))
    plain(' → tier ')
    figure(stepValue(tier))
    const shift = find('equity_shift')
    const final = find('final_tier')
    if (shift && final && Number(shift.value ?? 0) !== 0) {
      plain(` ${stepValue(shift)} equity → tier `)
      figure(stepValue(final))
    }
    plain('. ')
  }

  const r1 = find('r1')
  if (r1) {
    plain('Round 1: ')
    const share = find('r1_pct')
    const cost = find('cost')
    const potential = find('r1_potential')
    if (share && cost && potential) {
      figure(stepValue(share))
      plain(' of ')
      figure(stepValue(cost))
      const grants = find('grants')
      if (grants && Number(grants.value ?? 0) > 0) {
        plain(' less ')
        figure(stepValue(grants))
        plain(' in grants')
      }
      plain(` = ${stepValue(potential)}`)
      roundTail(r1, 1)
    } else {
      limitThenFigure(r1)
      endRound(1)
    }
  }

  const r2 = find('r2')
  if (r2) {
    plain(' Round 2: appeal ')
    figure(money(r2.inputs?.['appeal']))
    roundTail(r2, 2)
  }
  const r3 = find('r3')
  if (r3) {
    plain(' Round 3: requested ')
    figure(money(r3.inputs?.['requested']))
    roundTail(r3, 3)
  }
  const total = find('total')
  if (total) {
    plain(' Total ')
    figure(stepValue(total))
    plain('.')
  }
  return parts
}

export function sentenceText(parts: readonly SentencePart[]): string {
  return parts
    .map((part) => part.text)
    .join('')
    .trim()
}
