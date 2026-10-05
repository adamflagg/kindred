import { describe, expect, it } from 'vitest'

import {
  TRACE_CAPPED_BY_ASK,
  TRACE_DISCRETIONARY,
  TRACE_INCOME_CEILING,
  TRACE_ROUND1_LOCKED,
  TRACE_ROUND2_CAPPED,
  TRACE_TOP_UP,
  traceStep,
} from '../kit/fixtures'
import type { AidTraceStep } from '../kit/receiptModel'
import { chipText, receiptChips } from './receiptChips'

const texts = (trace: readonly AidTraceStep[]) => receiptChips(trace).chips.map(chipText)

/** Round 2 posted below what it works out to now, and a live Round 3 the maximum limited. */
const THREE_ROUNDS: readonly AidTraceStep[] = [
  ...TRACE_ROUND2_CAPPED.slice(0, -1),
  traceStep('r2_locked', 'Round 2 as posted', '900.00', { worked_out: '1000.00' }, 'locked'),
  traceStep('r3', 'Round 3 award', '200.00', { requested: '300.00' }, 'max_amount'),
  traceStep('total', 'Total award', '4600.00', { r1: '3500.00', r2: '900.00', r3: '200.00' }),
]

const withR3 = (bound: string) => [
  ...TRACE_ROUND2_CAPPED.slice(0, -1),
  traceStep('r3', 'Round 3 award', '200.00', { requested: '300.00' }, bound),
  traceStep('total', 'Total award', '4700.00', { r1: '3500.00', r2: '1000.00', r3: '200.00' }),
]

describe('receiptChips (household-v4 §2 (B): one line of chips, the Total pinned right)', () => {
  it('words each round from the trace, with the limit that set it, and the total apart', () => {
    const line = receiptChips(TRACE_ROUND2_CAPPED)
    expect(line.chips.map(chipText)).toEqual([
      'Adjusted $80,000 · tier 3',
      'R1 70% → $3,500',
      'R2 limited by the Round 2 cap → $1,000',
    ])
    expect(line.total).toBe('$4,500')
  })

  it('says Round 1 once: the table set it, so no "= $3,500 → $3,500"', () => {
    const r1 = texts(TRACE_ROUND2_CAPPED)[1] ?? ''
    expect(r1.match(/\$3,500/g)).toHaveLength(1)
  })

  it("uses the engine's own limit words: the family's ask, the appeal, the Round 3 limits", () => {
    expect(texts(TRACE_CAPPED_BY_ASK)[1]).toBe("R1 40%, limited by the family's ask → $1,500")
    const appeal = TRACE_ROUND2_CAPPED.map((s) => (s.key === 'r2' ? { ...s, bound: 'appeal' } : s))
    expect(texts(appeal)[2]).toBe("R2 limited by the family's appeal → $1,000")
    expect(texts(withR3('max_amount'))[3]).toBe('R3 limited by the Round 3 maximum → $200')
    expect(texts(withR3('request'))[3]).toBe("R3 limited by the family's Round 3 ask → $200")
    expect(texts(withR3('cap'))[3]).toBe('R3 limited by the Round 3 share of the cost → $200')
    expect(texts(withR3('table'))[3]).toBe('R3 $200')
  })

  it('marks the limit words, so the chip inks them amber as the receipt does', () => {
    const r2 = receiptChips(TRACE_ROUND2_CAPPED).chips[2]
    expect(r2?.parts.filter((p) => p.kind === 'bound').map((p) => p.text)).toEqual([
      'limited by the Round 2 cap',
    ])
  })

  it('draws no chip for a round the trace has not reached', () => {
    const chips = texts(TRACE_CAPPED_BY_ASK)
    expect(chips).toHaveLength(2)
    expect(chips.some((c) => c.startsWith('R2') || c.startsWith('R3'))).toBe(false)
  })

  it("reads an unposted round's live amount, and a posted one's posted figure where they differ", () => {
    const chips = texts(THREE_ROUNDS)
    expect(chips[2]).toBe('R2 limited by the Round 2 cap → $1,000 · posted $900')
    expect(chips[3]).toBe('R3 limited by the Round 3 maximum → $200')
    expect(receiptChips(THREE_ROUNDS).total).toBe('$4,600')
    expect(texts(TRACE_ROUND1_LOCKED)[1]).toBe(
      "R1 40%, limited by the family's ask → $1,500 · posted $1,800"
    )
  })

  it('reads a posted round once where the posted figure is the worked-out one', () => {
    const posted = [
      ...TRACE_ROUND2_CAPPED.slice(0, -1),
      traceStep('r1_locked', 'Round 1 as posted', '3500.00', { worked_out: '3500.00' }, 'locked'),
      TRACE_ROUND2_CAPPED.at(-1) as AidTraceStep,
    ]
    expect(texts(posted)[1]).toBe('R1 70% → $3,500')
  })

  it('reads a posted round the trace carries only as posted', () => {
    const onlyLocked = [
      ...TRACE_CAPPED_BY_ASK.slice(0, -1),
      traceStep('r2_locked', 'Round 2 as posted', '700.00', { worked_out: '700.00' }, 'locked'),
      traceStep('total', 'Total award', '2200.00', { r1: '1500.00', r2: '700.00' }),
    ]
    expect(texts(onlyLocked)[2]).toBe('R2 $700')
  })

  it('says why there is no award above the income ceiling', () => {
    expect(texts(TRACE_INCOME_CEILING)).toEqual([
      'Adjusted $400,000 · tier 9',
      'R1 above the income ceiling → $0',
    ])
    expect(receiptChips(TRACE_INCOME_CEILING).total).toBe('$0')
  })

  it('names an equity shift as the tier it moved to', () => {
    const shifted = TRACE_CAPPED_BY_ASK.map((s) =>
      s.key === 'equity_shift'
        ? { ...s, value: 1 }
        : s.key === 'final_tier'
          ? { ...s, value: 4 }
          : s
    )
    expect(texts(shifted)[0]).toBe('Adjusted $120,000 · tier 5 → 4')
  })

  it('keeps top-up and discretionary money, so the chips add up to the total', () => {
    expect(texts(TRACE_TOP_UP).at(-1)).toBe('Top-up $400')
    expect(texts(TRACE_DISCRETIONARY).at(-1)).toBe('Discretionary $250')
  })

  it('carries the whole sentence for the hover, as the mock does', () => {
    expect(receiptChips(TRACE_ROUND2_CAPPED).title).toBe(
      'Adjusted income $80,000 → tier 3. Round 1: 70% of $5,000 = $3,500. Round 2: appeal $2,500, limited by the Round 2 cap to $1,000. Total $4,500.'
    )
  })
})
