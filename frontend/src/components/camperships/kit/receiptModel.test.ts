import { describe, expect, it } from 'vitest'

import {
  TRACE_CAPPED_BY_ASK,
  TRACE_INCOME_CEILING,
  TRACE_ROUND1_LOCKED,
  TRACE_ROUND2_CAPPED,
} from './fixtures'
import { MINUS } from './money'
import {
  bindingPhrase,
  receiptLabel,
  receiptLineCount,
  receiptRulesHref,
  receiptSections,
  receiptSentence,
  sentenceText,
  stepHow,
  stepValue,
  type AidTraceStep,
} from './receiptModel'

const find = (trace: readonly AidTraceStep[], key: string) => {
  const step = trace.find((s) => s.key === key)
  if (!step) throw new Error(key)
  return step
}

describe('receiptSentence (D33; the editor row and the household page say the same thing)', () => {
  it('reads a Round 1 set by the ask', () => {
    expect(sentenceText(receiptSentence(TRACE_CAPPED_BY_ASK))).toBe(
      "Adjusted income $120,000 → tier 5. Round 1: 40% of $5,000 = $2,000, limited by the family's ask to $1,500. Total $1,500."
    )
  })

  it('reads an appeal limited by the Round 2 cap, and a Round 1 the table set', () => {
    expect(sentenceText(receiptSentence(TRACE_ROUND2_CAPPED))).toBe(
      'Adjusted income $80,000 → tier 3. Round 1: 70% of $5,000 = $3,500 → $3,500. Round 2: appeal $2,500, limited by the Round 2 cap to $1,000. Total $4,500.'
    )
  })

  it('says why there is no award above the income ceiling', () => {
    expect(sentenceText(receiptSentence(TRACE_INCOME_CEILING))).toBe(
      'Adjusted income $400,000 → tier 9. Round 1: above the income ceiling → $0. Total $0.'
    )
  })

  it('ends a locked round with what was posted, which the total uses (D43, D52)', () => {
    expect(sentenceText(receiptSentence(TRACE_ROUND1_LOCKED))).toBe(
      "Adjusted income $120,000 → tier 5. Round 1: 40% of $5,000 = $2,000, limited by the family's ask to $1,500; posted $1,800. Total $1,800."
    )
  })

  it('names an equity shift: +1 takes tier 5 to tier 4 (tiers.py: tier - shift)', () => {
    const shifted = TRACE_CAPPED_BY_ASK.map((s) =>
      s.key === 'equity_shift'
        ? { ...s, value: 1 }
        : s.key === 'final_tier'
          ? { ...s, value: 4, inputs: { income_tier: 5, equity_shift: 1 } }
          : s
    )
    expect(sentenceText(receiptSentence(shifted))).toContain('→ tier 5 +1 equity → tier 4.')
    expect(stepHow(find(shifted, 'final_tier'))).toBe(`tier 5 ${MINUS} 1`)
  })

  it('marks the binding limit, so it can be inked amber', () => {
    const bound = receiptSentence(TRACE_CAPPED_BY_ASK).filter((p) => p.kind === 'bound')
    expect(bound.map((p) => p.text)).toEqual(["limited by the family's ask"])
  })
})

describe('bindingPhrase: every limit engine.py reports for a round', () => {
  it.each([
    ['r1', 'ask', "limited by the family's ask"],
    ['r1', 'minimum', 'raised to the minimum award'],
    ['r1', 'grants_cover', 'limited by outside grants covering the cost'],
    ['r1', 'income_ceiling', 'above the income ceiling'],
    ['r1', 'no_table', 'no award table'],
    ['r2', 'appeal', "limited by the family's appeal"],
    ['r2', 'cap', 'limited by the Round 2 cap'],
    ['r2', 'original_ask', "limited by the family's original ask"],
    ['r2', 'not_allowed', 'not open this season'],
    ['r2', 'total_cap', 'cut to fit the total-aid cap'],
    ['r3', 'request', "limited by the family's Round 3 ask"],
    ['r3', 'max_amount', 'limited by the Round 3 maximum'],
    ['r3', 'cap', 'limited by the Round 3 share of the cost'],
    ['r3', 'not_eligible', 'not eligible for Round 3'],
    ['r3', 'total_cap', 'cut to fit the total-aid cap'],
    ['r2', 'cost_unknown', 'cost not known'],
    ['r2', 'ask_missing', 'no ask entered'],
    ['r3', 'r1_unknown', 'Round 1 not worked out'],
  ])('%s bound by %s reads "%s"', (key, bound, phrase) => {
    expect(bindingPhrase({ key, label: key, bound })).toBe(phrase)
  })

  it.each(['table', 'full_cost'])('treats %s as no limit', (bound) => {
    expect(bindingPhrase({ key: 'r1', label: 'Round 1 award', bound })).toBeNull()
  })

  it('reads a limit it does not know in plain words, never dropping it', () => {
    expect(bindingPhrase({ key: 'r1', label: 'Round 1 award', bound: 'something_new' })).toBe(
      'something new'
    )
  })

  it('only names limits on the award lines', () => {
    expect(bindingPhrase(find(TRACE_CAPPED_BY_ASK, 'r1_potential'))).toBeNull()
    expect(bindingPhrase(find(TRACE_ROUND1_LOCKED, 'r1_locked'))).toBeNull()
  })
})

describe('the line receipt (§6.5: Income → Tier → Cost → Round 1 → Round 2 → Total)', () => {
  it('groups the steps in that order', () => {
    expect(receiptSections(TRACE_ROUND2_CAPPED).map((s) => s.name)).toEqual([
      'Income',
      'Tier',
      'Cost',
      'Round 1',
      'Round 2',
      'Total',
    ])
  })

  it('puts a locked round in its round', () => {
    const round1 = receiptSections(TRACE_ROUND1_LOCKED).find((s) => s.name === 'Round 1')
    expect(round1?.steps.map((s) => s.key)).toEqual(['r1_pct', 'r1_potential', 'r1', 'r1_locked'])
  })

  it('never drops a step it does not know: it shows it before the total', () => {
    const trace = [
      ...TRACE_CAPPED_BY_ASK.slice(0, -1),
      { key: 'future_step', label: 'Something new', value: '25.00' },
      ...TRACE_CAPPED_BY_ASK.slice(-1),
    ]
    expect(
      receiptSections(trace)
        .map((s) => s.name)
        .slice(-2)
    ).toEqual(['Other steps', 'Total'])
  })

  it('counts its lines without the total', () => {
    expect(receiptLineCount(TRACE_CAPPED_BY_ASK)).toBe(11)
  })
})

describe('each line', () => {
  it('formats tiers, shifts, percentages and money', () => {
    expect(stepValue(find(TRACE_CAPPED_BY_ASK, 'final_tier'))).toBe('5')
    expect(stepValue(find(TRACE_CAPPED_BY_ASK, 'r1_pct'))).toBe('40%')
    expect(stepValue(find(TRACE_CAPPED_BY_ASK, 'r1'))).toBe('$1,500')
    expect(stepValue({ key: 'equity_shift', label: 'Equity shift', value: 1 })).toBe('+1')
    expect(stepValue({ key: 'mystery', label: 'Mystery', value: 'n/a' })).toBe('n/a')
  })

  it('says how a line was worked out', () => {
    expect(stepHow(find(TRACE_CAPPED_BY_ASK, 'weighted_income'))).toBe(
      '75% of prior year $118,000 + 25% of current year $126,000 (gross)'
    )
    expect(stepHow(find(TRACE_CAPPED_BY_ASK, 'adjusted_income'))).toBe(
      'after adjustments and dependents; never below $0'
    )
    expect(stepHow(find(TRACE_CAPPED_BY_ASK, 'grants'))).toBe(
      'outside grants counted when committed; taken off the award dollar for dollar'
    )
    expect(stepHow(find(TRACE_CAPPED_BY_ASK, 'r1'))).toBe(
      'the lower of the ask $1,500 and the potential $2,000'
    )
    expect(stepHow(find(TRACE_ROUND1_LOCKED, 'r1_locked'))).toBe(
      'worked out $1,500 now; locked at what was posted, and later rounds build on it'
    )
    expect(stepHow(find(TRACE_ROUND2_CAPPED, 'total'))).toBe('Round 1 $3,500 + Round 2 $1,000')
    expect(
      stepHow({ key: 'mystery', label: 'Mystery', value: 1, inputs: { some_input: 'x' } })
    ).toBe('some input: x')
  })

  it("reads the floor from the trace, and the grants method from the season's offset_mode (D137)", () => {
    expect(
      stepHow({
        key: 'adjusted_income',
        label: 'Adjusted',
        value: '500.00',
        inputs: { floor: '500.00' },
      })
    ).toBe('after adjustments and dependents; never below $500')
    expect(
      stepHow({
        key: 'grants',
        label: 'Outside grants',
        value: '0.00',
        inputs: { count_when: 'posted', offset_mode: 'percent' },
      })
    ).toBe('outside grants counted when posted; taken off the cost before the percentage')
  })
})

describe('lines the engine emits without inputs', () => {
  it('reads a program with no equity class and grants that do not offset', () => {
    expect(stepHow({ key: 'equity_shift', label: 'Equity shift', value: 0 })).toBe(
      'this program has no equity class'
    )
    expect(stepHow({ key: 'grants', label: 'Outside grants', value: '0.00' })).toBe(
      'outside grants do not offset this program this season'
    )
  })
})

describe('receiptLabel (§4.7; D43, D52, D67) and its rules link (D76)', () => {
  it('says a live receipt moves', () => {
    expect(receiptLabel({ kind: 'live', season: 2027, rulesVersion: 3 })).toBe(
      'live · rules 2027 v3'
    )
  })

  it('names what locked a posted round, and when', () => {
    expect(
      receiptLabel({
        kind: 'locked',
        season: 2027,
        rulesVersion: 3,
        lockedOn: '2027-03-09',
        lockSource: 'tick',
        tickedByName: 'Test User',
      })
    ).toBe("rules 2027 v3 · locked Mar 9 by Test User's Posted tick · as it was when posted")
    expect(
      receiptLabel({
        kind: 'locked',
        season: 2027,
        rulesVersion: 3,
        lockedOn: '2027-03-09',
        lockSource: 'tick',
      })
    ).toBe('rules 2027 v3 · locked Mar 9 by a Posted tick · as it was when posted')
    expect(
      receiptLabel({
        kind: 'locked',
        season: 2027,
        rulesVersion: 3,
        lockedOn: '2027-03-10',
        lockSource: 'ledger',
      })
    ).toBe('rules 2027 v3 · locked Mar 10 by the ledger match · as it was when posted')
  })

  it("names 2026's reproduced decisions", () => {
    expect(receiptLabel({ kind: 'reproduced', season: 2026, rulesVersion: 1 })).toBe(
      'rules 2026 v1 · 2026, reproduced from the repaired sheet'
    )
  })

  it('names who decided staff-decided money (Round 3)', () => {
    expect(
      receiptLabel({ kind: 'live', season: 2027, rulesVersion: 3, decidedByName: 'Test User' })
    ).toBe('live · rules 2027 v3 · decided by Test User')
  })

  it('links the rules version to Season › Rules, for that version and season', () => {
    expect(receiptRulesHref({ kind: 'live', season: 2027, rulesVersion: 3 })).toBe(
      '/aid/season/rules?version=3&year=2027'
    )
  })
})
