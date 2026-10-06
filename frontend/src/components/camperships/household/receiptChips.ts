/**
 * The household card's receipt line (household-v4.html section 2 (B), the owner's pick): one line of
 * chips, "Adjusted $X · tier N │ R1 40% → $2,400 │ R2 limited by … → $1,200 │ R3 $500", with the
 * Total apart so the card can pin it right. Every figure and limit is the trace's, worded by the
 * kit (stepValue; bindingPhrase decides whether a limit shows, chipLimit words it short), so the chips
 * and the receipt under them cannot disagree. The
 * prose sentence (receiptSentence) stays the hover, and is still the Requests grid's line.
 */
import { formatMoney, MINUS } from '../kit/money'
import {
  bindingPhrase,
  receiptSentence,
  receiptSentenceText,
  stepValue,
  type AidTraceStep,
  type ReceiptSentencePart,
} from '../kit/receiptModel'

export interface ReceiptChip {
  /** "R1", "R2", "R3"; null for the income lead and the extra money. */
  readonly round: string | null
  readonly parts: readonly ReceiptSentencePart[]
}

export interface ReceiptChipLine {
  readonly chips: readonly ReceiptChip[]
  /** The trace's total, or null when it carries none. */
  readonly total: string | null
  /** The whole sentence, for the hover. */
  readonly title: string
}

/** A chip as one string: its round label, a space, then its words. */
export function chipText(chip: ReceiptChip): string {
  const words = chip.parts.map((part) => part.text).join('')
  return chip.round === null ? words : `${chip.round} ${words}`
}

/**
 * The chip line's limit words (owner pass 3, V1, 10-05): short enough that the line fits one row at
 * 1100px, and never naming the round, which the chip's "R1"/"R2"/"R3" already says. Whether a limit
 * shows at all is still the kit's (bindingPhrase); the receipt and the hover keep its full words.
 */
const CHIP_LIMITS: Readonly<Record<string, string>> = {
  ask: 'cap at requested',
  appeal: 'cap at requested',
  request: 'cap at requested',
  original_ask: 'cap at original ask',
  cap: 'capped by tier',
  max_amount: 'capped at maximum',
  total_cap: 'cut to total-aid cap',
  minimum: 'raised to minimum',
  grants_cover: 'grants cover the cost',
  income_ceiling: 'above income ceiling',
  no_table: 'no award table',
  not_allowed: 'not open this season',
  not_eligible: 'not eligible',
  cost_unknown: 'cost unknown',
  ask_missing: 'no ask entered',
  r1_unknown: 'Round 1 not worked out',
}

export function chipLimit(step: AidTraceStep): string | null {
  const full = bindingPhrase(step)
  if (full === null) return null
  // Round 3's `cap` is its share-of-cost limit (engine.py `_round3`), not Round 2's tier cap.
  if (step.key === 'r3' && step.bound === 'cap') return 'capped by share of cost'
  return CHIP_LIMITS[step.bound ?? ''] ?? full
}

const isBlank = (value: unknown) => value === null || value === undefined || value === ''

function chipBuilder() {
  const parts: ReceiptSentencePart[] = []
  return {
    parts,
    plain: (text: string) => parts.push({ text, kind: 'plain' }),
    bound: (text: string) => parts.push({ text, kind: 'bound' }),
    figure: (text: string) =>
      parts.push(
        text.startsWith(`${MINUS}$`)
          ? { text, kind: 'figure', negative: true }
          : { text, kind: 'figure' }
      ),
  }
}

export function receiptChips(trace: readonly AidTraceStep[]): ReceiptChipLine {
  const find = (key: string) => trace.find((step) => step.key === key)
  const chips: ReceiptChip[] = []

  const adjusted = find('adjusted_income')
  const tier = find('income_tier')
  if (adjusted && tier) {
    const c = chipBuilder()
    c.plain('Adjusted ')
    c.figure(stepValue(adjusted))
    c.plain(' · tier ')
    c.figure(stepValue(tier))
    const shift = find('equity_shift')
    const final = find('final_tier')
    if (shift && final && Number(shift.value ?? 0) !== 0) {
      c.plain(' → ')
      c.figure(stepValue(final))
    }
    chips.push({ round: null, parts: c.parts })
  }

  for (const n of [1, 2, 3] as const) {
    const award = find(`r${String(n)}`)
    const locked = find(`r${String(n)}_locked`)
    if (!award && !locked) continue
    const c = chipBuilder()
    if (award) {
      const share = n === 1 ? find('r1_pct') : undefined
      const limit = chipLimit(award)
      if (share && !isBlank(find('cost')?.value)) {
        c.figure(stepValue(share))
        if (limit !== null) c.plain(', ')
        else c.plain(' → ')
      }
      if (limit !== null) {
        c.bound(limit)
        c.plain(' → ')
      }
      c.figure(stepValue(award))
      // A posted round counts what was posted; it is said only where it differs (D43, D52).
      if (locked && stepValue(locked) !== stepValue(award)) {
        c.plain(' · posted ')
        c.figure(stepValue(locked))
      }
    } else if (locked) {
      c.figure(stepValue(locked))
    }
    chips.push({ round: `R${String(n)}`, parts: c.parts })
  }

  // Top-up and discretionary money, as the sentence counts them, so the chips add up to the total.
  const total = find('total')
  for (const [label, key] of [
    ['Top-up', 'top_up'],
    ['Discretionary', 'discretionary'],
  ] as const) {
    const locked = find(`${key}_locked`)
    const step = find(key)
    const fromTotal = total?.inputs?.[key]
    const figure = locked
      ? stepValue(locked)
      : !isBlank(fromTotal)
        ? formatMoney(Number(fromTotal))
        : step
          ? stepValue(step)
          : '$0'
    const limit = step && !locked ? chipLimit(step) : null
    if (figure === '$0' && limit === null) continue
    const c = chipBuilder()
    c.plain(`${label} `)
    if (limit !== null) {
      c.bound(limit)
      c.plain(' → ')
    }
    c.figure(figure)
    chips.push({ round: null, parts: c.parts })
  }

  return {
    chips,
    total: total ? stepValue(total) : null,
    title: receiptSentenceText(receiptSentence(trace)),
  }
}
