import { describe, expect, it } from 'vitest'

import {
  TRACE_CAPPED_BY_ASK,
  TRACE_DISCRETIONARY,
  TRACE_GRANTS_DOLLAR,
  TRACE_GRANTS_REDUCE_COST,
  TRACE_INCENTIVE_AWARD,
  TRACE_INCENTIVE_COST,
  TRACE_INCOME_CEILING,
  TRACE_MINIMUM_RAISED,
  TRACE_MINIMUM_THEN_ASK,
  TRACE_ROUND1_LOCKED,
  TRACE_ROUND2_CAPPED,
  TRACE_TOP_UP,
  TRACE_TOTAL_CAP,
  traceStep,
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
  stepIsNegativeMoney,
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
      '75% of prior year $120,000 + 25% of current year $120,000 (gross)'
    )
    expect(stepHow(find(TRACE_CAPPED_BY_ASK, 'adjusted_income'))).toBe(
      'after adjustments and dependents; floor $0; floor tested after deductions'
    )
    expect(stepHow(find(TRACE_CAPPED_BY_ASK, 'grants'))).toBe(
      'outside grants counted when committed; taken off the award dollar for dollar'
    )
    expect(stepHow(find(TRACE_CAPPED_BY_ASK, 'r1'))).toBe(
      "the family's ask $1,500, under the potential $2,000"
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
    ).toBe('after adjustments and dependents; floor $500')
    expect(
      stepHow({
        key: 'grants',
        label: 'Outside grants',
        value: '0.00',
        inputs: { count_when: 'posted', offset_mode: 'reduce_cost_basis' },
      })
    ).toBe('outside grants counted when posted; taken off the cost before the percentage')
  })
})

describe('lines the engine emits without inputs', () => {
  it('reads a program with no equity class and grants that do not offset', () => {
    expect(
      stepHow({
        key: 'grants',
        label: 'Outside grants',
        value: '0.00',
        note: "Grants do not offset 'x' this season",
      })
    ).toBe("grants do not offset 'x' this season")
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

describe('fix round 1: the sentence agrees with the engine', () => {
  it('I1: a raised minimum is not "= $potential"', () => {
    expect(sentenceText(receiptSentence(TRACE_MINIMUM_RAISED))).toBe(
      'Adjusted income $30,000 → tier 1. Round 1: 1% of $5,000, raised to the minimum award → $100. Total $100.'
    )
    expect(sentenceText(receiptSentence(TRACE_MINIMUM_THEN_ASK))).toBe(
      "Adjusted income $30,000 → tier 1. Round 1: 1% of $5,000, raised to the minimum award $100, limited by the family's ask to $80. Total $80."
    )
  })

  it('I2: the two grant offsets read differently (D137)', () => {
    expect(sentenceText(receiptSentence(TRACE_GRANTS_DOLLAR))).toContain(
      'Round 1: 40% of $5,000, less $500 in grants, = $1,500 → $1,500.'
    )
    expect(sentenceText(receiptSentence(TRACE_GRANTS_REDUCE_COST))).toContain(
      'Round 1: 40% of ($5,000 less $500 in grants) = $1,800 → $1,800.'
    )
  })

  it('I3: top-up and discretionary money are in the sentence, so it adds up', () => {
    expect(sentenceText(receiptSentence(TRACE_TOP_UP))).toContain(
      'to $1,500. Top-up $400. Total $1,900.'
    )
    expect(sentenceText(receiptSentence(TRACE_DISCRETIONARY))).toContain(
      'to $1,500. Discretionary $250. Total $1,750.'
    )
  })

  it('I3: a posted top-up reads its locked figure', () => {
    const trace = [
      ...TRACE_TOP_UP.slice(0, -1),
      traceStep('top_up_locked', 'Top-up as posted', '300.00', { worked_out: '400.00' }, 'locked'),
      traceStep('total', 'Total award', '1800.00', {
        r1: '1500.00',
        r2: null,
        r3: null,
        top_up: '300.00',
        discretionary: '0.00',
      }),
    ]
    expect(sentenceText(receiptSentence(trace))).toContain('Top-up $300. Total $1,800.')
  })

  it('I4a: a top-up withheld above the income ceiling says so', () => {
    const trace = [
      ...TRACE_INCOME_CEILING.slice(0, -1),
      traceStep(
        'top_up',
        'Top-up: Named top-up',
        '0.00',
        { kind: 'top_up' },
        'income_ceiling',
        'Adjusted income is above the income ceiling'
      ),
      ...TRACE_INCOME_CEILING.slice(-1),
    ]
    expect(sentenceText(receiptSentence(trace))).toContain(
      'Round 1: above the income ceiling → $0. Top-up: above the income ceiling → $0. Total $0.'
    )
  })

  it('an incentive taken off the award is in the sentence', () => {
    expect(sentenceText(receiptSentence(TRACE_INCENTIVE_AWARD))).toContain(
      "Round 1: 40% of $5,000 = $2,000, limited by the family's ask to $1,500, less an incentive of $100 → $1,400. Total $1,400."
    )
  })

  it('the total-aid cap reads as a cut', () => {
    expect(sentenceText(receiptSentence(TRACE_TOTAL_CAP))).toContain(
      'Round 2: appeal $2,500, cut to fit the total-aid cap → $700. Total $4,200.'
    )
  })

  it('M9: a posted Round 2 and Round 3 end with what was posted', () => {
    const trace = [
      ...TRACE_ROUND2_CAPPED.slice(0, -1),
      traceStep('r2_locked', 'Round 2 as posted', '900.00', { worked_out: '1000.00' }, 'locked'),
      traceStep('r3', 'Round 3 award', '200.00', { requested: '300.00' }, 'max_amount'),
      traceStep('r3_locked', 'Round 3 as posted', '150.00', { worked_out: '200.00' }, 'locked'),
      traceStep('total', 'Total award', '4550.00', {
        r1: '3500.00',
        r2: '900.00',
        r3: '150.00',
        top_up: '0.00',
        discretionary: '0.00',
      }),
    ]
    expect(sentenceText(receiptSentence(trace))).toContain(
      'limited by the Round 2 cap to $1,000; posted $900. Round 3: requested $300, limited by the Round 3 maximum to $200; posted $150. Total $4,550.'
    )
  })

  it('marks negative money figures, and only money', () => {
    const trace = [
      traceStep('adjusted_income', 'Adjusted', '-1200.00', {}),
      traceStep('income_tier', 'Income tier', 1, {}),
    ]
    expect(
      receiptSentence(trace)
        .filter((p) => p.negative)
        .map((p) => p.text)
    ).toEqual([`${MINUS}$1,200`])
    expect(stepIsNegativeMoney(traceStep('income_adjustments', 'Adj', '-300.00'))).toBe(true)
    expect(stepIsNegativeMoney(traceStep('equity_shift', 'Shift', -1))).toBe(false)
    expect(stepIsNegativeMoney(traceStep('r1', 'R1', '300.00'))).toBe(false)
  })
})

describe('fix round 1: limits on every line that can carry one (I4a, M9)', () => {
  it.each([
    ['r2', 'income_ceiling'],
    ['r3', 'income_ceiling'],
    ['top_up', 'income_ceiling'],
    ['discretionary', 'income_ceiling'],
  ])('%s bound by %s reads "above the income ceiling"', (key, bound) => {
    expect(bindingPhrase({ key, label: key, bound })).toBe('above the income ceiling')
  })

  it('does not call a lock a limit', () => {
    expect(bindingPhrase({ key: 'top_up_locked', label: 'x', bound: 'locked' })).toBeNull()
  })
})

describe('fix round 1: the how-lines agree with the figures beside them', () => {
  it('I5: a Round 1 line says what decided it', () => {
    expect(stepHow(find(TRACE_MINIMUM_RAISED, 'r1'))).toBe('the potential $100')
    expect(stepHow(find(TRACE_GRANTS_DOLLAR, 'r1'))).toBe('the potential $1,500')
    expect(stepHow(find(TRACE_INCOME_CEILING, 'r1'))).toBe(
      'adjusted income is above the income ceiling, so there is no award'
    )
  })

  it('I5: an incentive shows in the cost and award lines', () => {
    expect(stepHow(find(TRACE_INCENTIVE_AWARD, 'r1'))).toBe(
      "the family's ask $1,500, under the potential $2,000; reduced by an incentive of $100"
    )
    expect(stepHow(find(TRACE_INCENTIVE_COST, 'cost'))).toBe('catalog price less incentive $100')
  })

  it('I5: Round 2 and Round 3 lines read their bound', () => {
    expect(stepHow(find(TRACE_ROUND2_CAPPED, 'r2'))).toBe('the cap $1,000, under the appeal $2,500')
    expect(stepHow(find(TRACE_TOTAL_CAP, 'r2'))).toBe('cut from $1,000 to fit the total-aid cap')
    expect(
      stepHow(traceStep('r2', 'R2', '1800.00', { appeal: '1800.00', cap: '2000.00' }, 'appeal'))
    ).toBe('the appeal $1,800, under the cap $2,000')
    expect(stepHow(traceStep('r2', 'R2', '0.00', { appeal: '500.00' }, 'not_allowed'))).toBe(
      'this decision type does not allow an appeal, so Round 2 is $0'
    )
    expect(
      stepHow(traceStep('r2', 'R2', '0.00', { appeal: '500.00' }, 'no_table', 'No Round 2 table'))
    ).toBe('no Round 2 table, so Round 2 is $0')
    expect(stepHow(traceStep('r2', 'R2', '0.00', { appeal: '500.00' }, 'income_ceiling'))).toBe(
      'adjusted income is above the income ceiling, so there is no award'
    )
    expect(stepHow(traceStep('r3', 'R3', '300.00', { requested: '300.00' }, 'request'))).toBe(
      'the amount requested, $300'
    )
    expect(stepHow(traceStep('r3', 'R3', '200.00', { requested: '300.00' }, 'max_amount'))).toBe(
      'the Round 3 maximum $200, under the $300 requested'
    )
    expect(stepHow(traceStep('r3', 'R3', '150.00', { requested: '300.00' }, 'cap'))).toBe(
      'the Round 3 share of the cost, $150, under the $300 requested'
    )
    expect(stepHow(traceStep('r3', 'R3', '0.00', { requested: '300.00' }, 'not_eligible'))).toBe(
      'not eligible for Round 3: it needs a Round 2 decision or a statement of need'
    )
  })

  it('I5: a note the engine attaches is never dropped', () => {
    expect(stepHow(traceStep('mystery', 'M', 1, {}, null, 'Staff-entered income'))).toBe(
      'staff-entered income'
    )
    expect(
      stepHow(traceStep('cost', 'Cost', '0.00', { source: 'unknown' }, null, 'Cost unknown'))
    ).toBe('cost not known; cost unknown')
  })

  it('I4a: top-up and discretionary lines read in words', () => {
    expect(
      stepHow(
        traceStep(
          'top_up',
          'Top-up',
          '0.00',
          { kind: 'top_up' },
          'income_ceiling',
          'Adjusted income is above the income ceiling'
        )
      )
    ).toBe('the named top-up is withheld above the income ceiling')
    expect(
      stepHow(traceStep('discretionary', 'Disc', '0.00', { withheld: '500.00' }, 'income_ceiling'))
    ).toBe('$500 typed; withheld above the income ceiling')
    expect(stepHow(find(TRACE_TOP_UP, 'top_up'))).toBe('a fixed top-up from the decision type')
  })

  it('I4c: the floor is held or merely stated, never "never below"', () => {
    expect(stepHow(traceStep('adjusted_income', 'A', '500.00', { floor: '500.00' }, 'floor'))).toBe(
      'held at the $500 floor'
    )
    expect(
      stepHow(
        traceStep('adjusted_income', 'A', '1000.00', {
          base: '1200.00',
          after_dependents: '1000.00',
          floor: '500.00',
        })
      )
    ).toBe('after adjustments and dependents (less $200); floor $500')
  })

  it('M1: a locked top-up or discretionary line reads like a locked round', () => {
    expect(
      stepHow(traceStep('top_up_locked', 'T', '300.00', { worked_out: '400.00' }, 'locked'))
    ).toBe('worked out $400 now; locked at what was posted')
  })

  it('M2: staff-entered income', () => {
    expect(
      stepHow(
        traceStep(
          'weighted_income',
          'W',
          '90000.00',
          { override_mode: 'staff_entered' },
          null,
          'Staff-entered income'
        )
      )
    ).toBe('entered by staff')
  })

  it('M3: the Round 1 percentage names where it came from', () => {
    expect(
      stepHow(traceStep('r1_pct', 'p', '100.00', { table: null, tier: 5, source: 'full_cost' }))
    ).toBe('full cost (decision type)')
    expect(
      stepHow(traceStep('r1_pct', 'p', '0.00', { table: null, tier: 5, source: 'no_table' }))
    ).toBe('no Round 1 table')
  })

  it('M4: a Round 2 cap set by the original ask', () => {
    expect(
      stepHow(
        traceStep(
          'r2_cap',
          'c',
          '500.00',
          { total_pct: '90.00', cost: '5000.00', r1: '1500.00' },
          'original_ask'
        )
      )
    ).toBe('the original ask $2,000 less Round 1 $1,500')
  })

  it('M5: per-person cost', () => {
    expect(
      stepHow(
        traceStep('cost', 'C', '5000.00', { source: 'per_person', incentive_reduction: '0.00' })
      )
    ).toBe('family-camp headcount price')
  })

  it('M6: subtracted adjustments carry a minus, and dependents are left to the adjusted-income line', () => {
    expect(
      stepHow(
        traceStep('income_adjustments', 'I', '-400.00', {
          medical_excess: '300.00',
          education_excess: '0.00',
          savings_excess: '100.00',
          extra_terms: '0.00',
          dependent_reduction: '200.00',
        })
      )
    ).toBe(`medical excess ${MINUS}$300 · savings excess $100`)
  })

  it('M4b: a held tier and a capped shift read in words', () => {
    expect(
      stepHow(traceStep('final_tier', 'F', 1, { income_tier: 2, equity_shift: 3 }, 'tier_floor'))
    ).toBe(`tier 2 ${MINUS} 3, held at tier 1, the lowest tier`)
    expect(
      stepHow(
        traceStep(
          'equity_shift',
          'E',
          2,
          { equity_class: 'summer', criteria_met: 'a', weight_sum: '3', aggregation: 'sum' },
          'max_shift'
        )
      )
    ).toBe('summer class · criteria met: a · weight 3 · capped at +2, the most a shift can be')
    expect(bindingPhrase(traceStep('final_tier', 'F', 1, {}, 'tier_floor'))).toBeNull()
  })
})
