/**
 * The receipt (§4.7, §6.5; D33, D34, D76; mockups/receipt.html D): the calculator's trace as a
 * sentence on top and a line receipt under it. The server computes every step (D21) and sends the
 * trace unchanged; this module only words it (Decision 5, RULED 2026-10-01), so the editor row
 * and the household page can never disagree. Wording follows the engine
 * (bunking/financial_aid/calculator/engine.py, tiers.py; Ruling 2026-10-01 (plan review)).
 */
import { aidHref, type AidView } from './asOf'
import { formatShortDate } from './dates'
import type { ReceiptLabelOut, TraceStep } from '../../../types/api-generated'
import { MINUS, formatMoney, isNegativeMoney } from './money'

export type TraceValue = string | number | boolean | null

/**
 * The calculator's `TraceStep` as the generator types it (result.py). An alias, so a change to the
 * server's shape breaks tsc here instead of drifting.
 */
export type AidTraceStep = TraceStep

/** "rules 2027 v3": the words the label links to Season › Rules (D76). */
export function receiptRulesWords(label: ReceiptLabelOut): string {
  return `rules ${String(label.season)} v${String(label.rules_version)}`
}

/**
 * D76: the rules version a receipt names opens that version, read only for `view` holders. The
 * season is the version's own (a 2026 receipt opens 2026's rules); the as-of is the page's (Decision 9).
 */
export function receiptRulesHref(label: ReceiptLabelOut, view?: AidView): string {
  return aidHref(
    '/aid/season/rules',
    { year: label.season, asOf: view?.asOf ?? { kind: 'live' } },
    { version: String(label.rules_version) }
  )
}

/**
 * §4.7's label: what version, live or locked, and what locked it. The server's facts are
 * nullable (a lock may have no posted date; a lock source is only ever tick or ledger), so each
 * missing fact leaves its words out rather than guessing them.
 */
export function receiptLabel(label: ReceiptLabelOut): string {
  const rules = receiptRulesWords(label)
  if (label.kind === 'reproduced')
    return `${rules} · ${String(label.season)}, reproduced from the repaired sheet`
  const decided = label.decided_by_name ? ` · decided by ${label.decided_by_name}` : ''
  if (label.kind === 'live') return `live · ${rules}${decided}`
  const on = label.locked_on ? ` ${formatShortDate(label.locked_on)}` : ''
  const by =
    label.lock_source === 'ledger'
      ? ' · matched in CampMinder'
      : label.lock_source === 'tick'
        ? ` by ${label.ticked_by_name ? `${label.ticked_by_name}'s` : 'a'} Posted tick`
        : ''
  return `${rules} · locked${on}${by} · as it was when posted${decided}`
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

/** Lines whose amount a limit can decide or zero. */
const AWARD_KEYS = new Set(['r1', 'r2', 'r3', 'top_up', 'discretionary'])

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

const NON_MONEY_KEYS = new Set(['income_tier', 'final_tier', 'equity_shift', 'r1_pct'])

/** A money line whose value is below zero, so the receipt inks it red (D74). */
export function stepIsNegativeMoney(step: AidTraceStep): boolean {
  if (NON_MONEY_KEYS.has(step.key) || isBlank(step.value) || typeof step.value === 'boolean')
    return false
  return isNegativeMoney(Number(step.value))
}

const lowerFirst = (t: string) =>
  t.length > 1 && /[a-z]/.test(t[1] ?? '') ? t.charAt(0).toLowerCase() + t.slice(1) : t

/** The engine's own note, its bare Decimals written as money ("an incentive of 100.00" -> "$100"). */
function noteText(note: string): string {
  return lowerFirst(
    note.replace(
      /\b(of|by) (\d+(?:\.\d+)?)\b/g,
      (_, w: string, n: string) => `${w} ${formatMoney(Number(n))}`
    )
  )
}

const INCENTIVE_NOTE = /^Reduced by an incentive of (\d+(?:\.\d+)?)/

/**
 * What an incentive took off a Round 1 award, 0 when none. The engine floors the award at 0, so the
 * note's figure can exceed what was taken: read it from the structure (the amount before the
 * incentive is the ask when the ask bound it, else the potential, rounded half-up to the dollar as
 * `_round1` does) and fall back to the note only when the step carries no inputs.
 */
function incentiveOf(step: AidTraceStep): number {
  const i = step.inputs ?? {}
  const before = step.bound === 'ask' ? i['ask'] : i['potential']
  if (!isBlank(before) && Number.isFinite(Number(before)) && !isBlank(step.value)) {
    const taken = Math.floor(Number(before) + 0.5) - Number(step.value)
    return taken > 0 ? taken : 0
  }
  const match = INCENTIVE_NOTE.exec(step.note ?? '')
  return match ? Number(match[1]) : 0
}

const CEILING_HOW = 'adjusted income is above the income ceiling, so there is no award'

/** How a line was worked out, shown when the line is clicked (D33). The engine's note is kept. */
export function stepHow(step: AidTraceStep, trace: readonly AidTraceStep[]): string {
  const { base, skipNote } = howBase(step, trace)
  const note = skipNote || isBlank(step.note) ? '' : noteText(String(step.note))
  return [base, note].filter(Boolean).join('; ')
}

function howBase(
  step: AidTraceStep,
  trace: readonly AidTraceStep[]
): { base: string; skipNote?: boolean } {
  const i = step.inputs ?? {}
  const bound = step.bound ?? ''
  if (step.key.endsWith('_locked')) {
    const worked = `worked out ${money(i['worked_out'])} now; locked at what was posted`
    return {
      base: /^r[123]_locked$/.test(step.key) ? `${worked}, and later rounds build on it` : worked,
      skipNote: true,
    }
  }
  if (AWARD_KEYS.has(step.key) && bound === 'income_ceiling') {
    if (step.key === 'top_up') {
      return { base: 'the named top-up is withheld above the income ceiling', skipNote: true }
    }
    if (step.key === 'discretionary') {
      return {
        base: `${money(i['withheld'])} typed; withheld above the income ceiling`,
        skipNote: true,
      }
    }
    return { base: CEILING_HOW, skipNote: true }
  }
  if (step.key === 'r2' || step.key === 'r3') {
    if (bound === 'total_cap') {
      return {
        base: `cut from ${money(i['before_total_cap'])} to fit the total-aid cap`,
        skipNote: true,
      }
    }
  }
  switch (step.key) {
    case 'weighted_income': {
      if (i['override_mode'] === 'staff_entered')
        return { base: 'entered by staff', skipNote: true }
      const terms = [
        [i['weight_prior'], 'prior year', i['prior_year']],
        [i['weight_current'], 'current year', i['current_year']],
      ] as const
      const words = terms
        .filter(([weight]) => Number(weight) !== 0)
        .map(([weight, name, figure]) => `${pct(Number(weight) * 100)} of ${name} ${money(figure)}`)
        .join(' + ')
      return { base: `${words} (${text(i['basis'])})` }
    }
    case 'income_adjustments': {
      // Medical and education excess come off income; the dependent reduction is on the next line.
      const items: ReadonlyArray<[string, TraceValue | undefined, boolean]> = [
        ['medical excess', i['medical_excess'], true],
        ['education excess', i['education_excess'], true],
        ['savings excess', i['savings_excess'], false],
        ['extra terms', i['extra_terms'], false],
      ]
      const parts = items
        .filter(([, v]) => !isBlank(v) && Number(v) !== 0)
        .map(([name, v, subtract]) => `${name} ${subtract ? MINUS : ''}${money(v)}`)
      return { base: parts.length > 0 ? parts.join(' · ') : 'none apply' }
    }
    case 'adjusted_income': {
      if (bound === 'floor') return { base: `held at the ${money(i['floor'] ?? 0)} floor` }
      const reduction = Number(i['base']) - Number(i['after_dependents'])
      const deps =
        !isBlank(i['after_dependents']) && reduction > 0 ? ` (less ${formatMoney(reduction)})` : ''
      return { base: `after adjustments and dependents${deps}; floor ${money(i['floor'] ?? 0)}` }
    }
    case 'income_tier':
      return { base: `the tier band ${money(i['adjusted_income'])} falls in` }
    case 'equity_shift': {
      if (isBlank(i['equity_class'])) {
        return { base: isBlank(step.note) ? 'this program has no equity class' : '' }
      }
      const cap =
        bound === 'max_shift'
          ? ` · capped at ${signed(Number(step.value))}, the most a shift can be`
          : ''
      return {
        base: `${text(i['equity_class'])} class · criteria met: ${text(i['criteria_met'], 'none')} · weight ${text(i['weight_sum'], '0')}${cap}`,
      }
    }
    case 'final_tier': {
      // tiers.py `final_tier`: the shift is subtracted, so +1 moves a family one tier down the table.
      const shift = Number(i['equity_shift'] ?? 0)
      const sum = `tier ${text(i['income_tier'])} ${shift >= 0 ? MINUS : '+'} ${String(Math.abs(shift))}`
      return {
        base:
          bound === 'tier_floor'
            ? `${sum}, held at tier ${text(step.value)}, the lowest tier`
            : sum,
      }
    }
    case 'cost': {
      const incentive =
        Number(i['incentive_reduction'] ?? 0) !== 0
          ? ` less incentive ${money(i['incentive_reduction'])}`
          : ''
      switch (i['source']) {
        case 'override':
          return { base: 'a staff override (cost or headcount), with its reason on record' }
        case 'per_person':
          return { base: `family-camp headcount price${incentive}` }
        case 'unknown':
          return { base: 'cost not known' }
        default:
          return { base: `${text(i['source'])} price${incentive}` }
      }
    }
    case 'grants':
      if (isBlank(i['offset_mode'])) {
        return {
          base: isBlank(step.note) ? 'outside grants do not offset this program this season' : '',
        }
      }
      return {
        base:
          `outside grants counted when ${text(i['count_when'])}; ` +
          (i['offset_mode'] === 'dollar'
            ? 'taken off the award dollar for dollar'
            : 'taken off the cost before the percentage') +
          (Number(i['late_left_out'] ?? 0) !== 0
            ? `; ${text(i['late_left_out'])} late grant left out`
            : ''),
      }
    case 'r1_pct':
      if (i['source'] === 'full_cost') return { base: 'full cost (decision type)' }
      if (i['source'] === 'no_table') return { base: 'no Round 1 table' }
      return { base: `${text(i['table'])} award table, tier ${text(i['tier'])}` }
    case 'r1_potential': {
      const grants = Number(i['grants'] ?? 0)
      if (isBlank(i['cost'])) {
        return { base: `cost not set; the minimum award ${money(i['minimum'])} applies` }
      }
      // The grants step carries the offset mode; this step does not (engine.py `_round1`).
      const reduceCost =
        grants !== 0 &&
        trace.find((t) => t.key === 'grants')?.inputs?.['offset_mode'] === 'reduce_cost_basis'
      const basis = reduceCost
        ? `(${money(i['cost'])} less grants ${money(grants)})`
        : money(i['cost'])
      const body =
        `${pct(i['pct'])} × ${basis}` +
        (grants !== 0 && !reduceCost ? ` less grants ${money(grants)}` : '')
      if (bound === 'grants_cover') {
        return { base: `${body}; outside grants cover the cost, so no minimum applies` }
      }
      if (bound === 'minimum') {
        const value = Number(step.value)
        const minimum = Number(i['minimum'])
        const lessGrants = Math.abs(value - (minimum - grants)) < 0.005 && grants !== 0
        const full = Math.abs(value - minimum) < 0.005
        const uncapped = Number(i['minimum_uncapped'])
        // `minimum_capped_at_share`: the configured minimum is more than the family still owes.
        const capped = full && Number.isFinite(uncapped) && uncapped - minimum >= 0.005
        return {
          base:
            body +
            (capped
              ? `, raised to ${money(minimum)} (the ${money(uncapped)} minimum, capped at what the family owes)`
              : full
                ? `, raised to the ${money(minimum)} minimum`
                : lessGrants
                  ? `, raised to the ${money(minimum)} minimum less grants ${money(grants)}`
                  : ', raised to the minimum'),
        }
      }
      return { base: body }
    }
    case 'r1': {
      const taken = incentiveOf(step)
      const base =
        bound === 'ask'
          ? `the family's ask ${money(i['ask'])}, under the potential ${money(i['potential'])}`
          : `the potential ${money(i['potential'])}`
      return taken > 0
        ? { base: `${base}; reduced by an incentive of ${formatMoney(taken)}`, skipNote: true }
        : { base }
    }
    case 'r2_cap': {
      const cap =
        bound === 'original_ask'
          ? `the original ask ${money(Number(step.value) + Number(i['r1']))} less Round 1 ${money(i['r1'])}`
          : `${pct(i['total_pct'])} of ${money(i['cost'])} in all, less Round 1 ${money(i['r1'])}${i['grants_subtracted'] === true ? ' and grants' : ''}`
      return { base: cap }
    }
    case 'r2':
      switch (bound) {
        case 'not_allowed':
          return {
            base: 'this decision type does not allow an appeal, so Round 2 is $0',
            skipNote: true,
          }
        case 'no_table':
          return { base: 'no Round 2 table, so Round 2 is $0', skipNote: true }
        case 'appeal':
          return { base: `the appeal ${money(i['appeal'])}, under the cap ${money(i['cap'])}` }
        default:
          return Number(i['cap']) < 0
            ? { base: `the cap ${money(i['cap'])} is below zero, so Round 2 is held at $0` }
            : { base: `the cap ${money(i['cap'])}, under the appeal ${money(i['appeal'])}` }
      }
    case 'r3':
      switch (bound) {
        case 'not_allowed':
          return {
            base: 'this decision type does not allow an appeal, so Round 3 is $0',
            skipNote: true,
          }
        case 'not_eligible':
          return {
            base: 'not eligible for Round 3: it needs a Round 2 decision or a statement of need',
            skipNote: true,
          }
        case 'max_amount':
          return {
            base: `the Round 3 maximum ${money(step.value)}, under the ${money(i['requested'])} requested`,
          }
        case 'cap':
          return {
            base: `the Round 3 share of the cost, ${money(step.value)}, under the ${money(i['requested'])} requested`,
          }
        default:
          return { base: `the amount requested, ${money(i['requested'])}` }
      }
    case 'total_cap':
      return {
        base: `${pct(i['pct_of_cost'])} of the cost${i['include_grants'] === true ? ', less grants' : ''}, Round 1 included`,
      }
    case 'top_up':
      return {
        base:
          i['kind'] === 'top_up'
            ? 'a fixed top-up from the decision type'
            : "the decision type's top-up to the full cost",
      }
    case 'discretionary':
      return { base: 'a staff-entered amount' }
    case 'total':
      return {
        base:
          ['r1', 'r2', 'r3']
            .filter((k) => !isBlank(i[k]))
            .map((k) => `Round ${k.slice(1)} ${money(i[k])}`)
            .join(' + ') +
          (Number(i['top_up'] ?? 0) !== 0 ? ` + top-up ${money(i['top_up'])}` : '') +
          (Number(i['discretionary'] ?? 0) !== 0
            ? ` + discretionary ${money(i['discretionary'])}`
            : ''),
      }
    default:
      return {
        base: Object.entries(i)
          .map(([k, v]) => `${k.replaceAll('_', ' ')}: ${text(v, '—')}`)
          .join(' · '),
      }
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

export interface ReceiptSentencePart {
  readonly text: string
  readonly kind: 'plain' | 'figure' | 'bound'
  /** A money figure below zero, which the component inks red (D74). */
  readonly negative?: boolean
}

/**
 * The sentence (§6.5): "Adjusted income $X → tier N. Round 1: P% of $C = $Q, limited by … to $A.
 * Total $T." A locked round ends "; posted $L" (D43, D52), and the total is the locked one.
 * Every figure the total adds appears, so the sentence always adds up: top-up and discretionary
 * money included. Each wording follows the engine's own arithmetic (engine.py `_round1`).
 */
export function receiptSentence(trace: readonly AidTraceStep[]): ReceiptSentencePart[] {
  const parts: ReceiptSentencePart[] = []
  const plain = (t: string) => parts.push({ text: t, kind: 'plain' })
  const figure = (t: string) =>
    parts.push(
      t.startsWith(`${MINUS}$`)
        ? { text: t, kind: 'figure', negative: true }
        : { text: t, kind: 'figure' }
    )
  const find = (key: string) => trace.find((step) => step.key === key)
  const limitThenFigure = (step: AidTraceStep) => {
    const limit = bindingPhrase(step)
    // An incentive comes off after the limit has decided the amount (engine.py `_round1`).
    const incentive = incentiveOf(step)
    const shown = incentive > 0 ? formatMoney(Number(step.value) + incentive) : stepValue(step)
    if (limit === null) {
      figure(shown)
    } else {
      parts.push({ text: limit, kind: 'bound' })
      plain(limit.startsWith('limited by') ? ' to ' : ' → ')
      figure(shown)
    }
    if (incentive > 0) {
      plain(`, less an incentive of ${formatMoney(incentive)} → `)
      figure(stepValue(step))
    }
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
      const grants = find('grants')
      const offset = Number(grants?.value ?? 0) > 0 ? grants : undefined
      const reduceCost = offset?.inputs?.['offset_mode'] === 'reduce_cost_basis'
      // When the minimum lifted the potential, "= $potential" would be false: the percentage's
      // own figure is not the potential (engine.py `_round1`), so the limit is named instead.
      const lifted = potential.bound === 'minimum' || potential.bound === 'grants_cover'
      if (isBlank(cost.value)) {
        // No price to take a percentage of: the engine used the minimum award (engine.py `_round1`).
        plain('cost not set, ')
        parts.push({ text: 'minimum award', kind: 'bound' })
        if (r1.bound === potential.bound) {
          plain(' → ')
          limitThenFigure({ ...r1, bound: null })
          endRound(1)
        } else {
          plain(' ')
          figure(stepValue(potential))
          roundTail(r1, 1)
        }
      } else {
        figure(stepValue(share))
        plain(' of ')
        if (offset && reduceCost) {
          plain('(')
          figure(stepValue(cost))
          plain(' less ')
          figure(stepValue(offset))
          plain(' in grants)')
        } else {
          figure(stepValue(cost))
          if (offset) {
            plain(', less ')
            figure(stepValue(offset))
            plain(' in grants')
          }
        }
        if (lifted) {
          if (r1.bound === potential.bound) {
            roundTail(r1, 1)
          } else {
            plain(', ')
            parts.push({ text: LIMITS[potential.bound ?? ''] ?? '', kind: 'bound' })
            plain(' ')
            figure(stepValue(potential))
            roundTail(r1, 1)
          }
        } else {
          plain(offset && !reduceCost ? ', = ' : ' = ')
          figure(stepValue(potential))
          roundTail(r1, 1)
        }
      }
    } else {
      limitThenFigure(r1)
      endRound(1)
    }
  }

  const later = (n: 2 | 3, lead: string, figureKey: string) => {
    const award = find(`r${String(n)}`)
    if (award) {
      plain(` Round ${String(n)}: ${lead} `)
      figure(money(award.inputs?.[figureKey]))
      roundTail(award, n)
      return
    }
    const locked = find(`r${String(n)}_locked`)
    if (locked) {
      plain(` Round ${String(n)}: posted `)
      figure(stepValue(locked))
      plain('.')
    }
  }
  later(2, 'appeal', 'appeal')
  later(3, 'requested', 'requested')

  const total = find('total')
  const extra = (label: string, key: 'top_up' | 'discretionary') => {
    const locked = find(`${key}_locked`)
    const step = find(key)
    const figureText = locked
      ? stepValue(locked)
      : total && !isBlank(total.inputs?.[key])
        ? money(total.inputs?.[key])
        : step
          ? stepValue(step)
          : '$0'
    if (step && bindingPhrase(step) !== null && !locked) {
      plain(` ${label}: `)
      parts.push({ text: bindingPhrase(step) ?? '', kind: 'bound' })
      plain(' → ')
      figure(figureText)
      plain('.')
    } else if (figureText !== '$0') {
      plain(` ${label} `)
      figure(figureText)
      plain('.')
    }
  }
  extra('Top-up', 'top_up')
  extra('Discretionary', 'discretionary')
  if (total) {
    plain(' Total ')
    figure(stepValue(total))
    plain('.')
  }
  return parts
}

export function receiptSentenceText(parts: readonly ReceiptSentencePart[]): string {
  return parts
    .map((part) => part.text)
    .join('')
    .trim()
}
