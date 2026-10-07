import { describe, expect, it } from 'vitest'

import { SANDBOX_DOC } from './sandboxFixtures'
import {
  CEILING,
  DEPENDENTS,
  MINIMUM,
  PRIOR_WEIGHT,
  TIER_COUNT,
  TIER_START,
  TIER_WIDTH,
  applyEdits,
  bindingOf,
  cellEditable,
  cardProblems,
  cellKey,
  changeCount,
  classLabel,
  currentYearWords,
  enabledKey,
  fixFirstWords,
  keyLocked,
  lockNote,
  readFigure,
  shownValue,
  tierLine,
  wasWords,
  weightKey,
} from './sandboxModel'

const edits = (entries: Record<string, string>) => new Map(Object.entries(entries))
const doc = (entries: Record<string, string>) => applyEdits(SANDBOX_DOC, edits(entries)).document
const tables = (d: typeof SANDBOX_DOC) =>
  d.award_tables as Record<
    string,
    { tiers?: Record<string, unknown>; overrides?: Record<string, unknown> }
  >
const caps = (d: typeof SANDBOX_DOC) =>
  (d.round2.tables ?? {}) as Record<string, { tiers?: Record<string, unknown> }>

describe('the bands (§S5 F1)', () => {
  it('loads uneven bands as start and width from the first band and the number of bands', () => {
    expect(tierLine(SANDBOX_DOC)).toEqual({ start: 0, width: 40000, count: 3 })
  })

  it('makes the bands even again when any of the three is typed', () => {
    expect(doc({ [TIER_WIDTH]: '35000' }).tiers.bands).toEqual([
      { lower: '0', upper: '35000' },
      { lower: '35001', upper: '70000' },
      { lower: '70001', upper: null },
    ])
  })

  it('count down trims every table’s tiers and overrides; count up copies each own table’s last tier (Review Focus 2)', () => {
    const fewer = doc({ [TIER_COUNT]: '2' })
    expect(Object.keys(tables(fewer)['general']?.tiers ?? {})).toEqual(['1', '2'])
    expect(tables(fewer)['teen']?.overrides).toEqual({})
    expect(Object.keys(caps(fewer)['general']?.tiers ?? {})).toEqual(['1', '2'])
    const more = doc({ [TIER_COUNT]: '5' })
    expect(tables(more)['general']?.tiers?.['5']).toEqual({ r1_pct: '20' })
    expect(caps(more)['general']?.tiers?.['4']).toEqual({ total_pct: '50' })
    expect(tables(more)['teen']?.overrides).toEqual({ '3': { r1_pct: '25' } })
    expect(more.tiers.bands).toHaveLength(5)
  })
})

describe('bad figures (§S5 F; disagreement 6)', () => {
  it('names each reason in the Rules editor’s words', () => {
    expect(readFigure('', 'money')).toEqual({ problem: 'needs a figure' })
    expect(readFigure('', 'money?')).toEqual({ value: null })
    expect(readFigure('abc', 'money')).toEqual({ problem: 'not a figure' })
    expect(readFigure('-5', 'money')).toEqual({ problem: 'not below 0' })
    expect(readFigure('120', 'pct')).toEqual({ problem: '0 to 100' })
    expect(readFigure('0', 'width')).toEqual({ problem: 'above 0' })
    expect(readFigure('21', 'count')).toEqual({ problem: 'a whole number from 2 to 20' })
    expect(readFigure('2.5', 'count')).toEqual({ problem: 'a whole number from 2 to 20' })
    expect(readFigure('35,000', 'money')).toEqual({ value: 35000 })
  })

  it('neither applies a bad figure nor drops the good ones beside it', () => {
    const applied = applyEdits(
      SANDBOX_DOC,
      edits({ [MINIMUM]: '', [cellKey('r1', 'general', 1)]: '85' })
    )
    expect(applied.problems).toEqual(new Map([[MINIMUM, 'needs a figure']]))
    expect(applied.document.awards.minimum).toBe(SANDBOX_DOC.awards.minimum)
    expect(tables(applied.document)['general']?.tiers?.['1']).toEqual({ r1_pct: '85' })
    expect(fixFirstWords(applied.problems, SANDBOX_DOC)).toBe(
      'Fix first: Minimum award (needs a figure)'
    )
  })

  it('reads a blank income ceiling as none', () => {
    expect(doc({ [CEILING]: '' }).tiers.income_ceiling).toBeNull()
    expect(doc({ [CEILING]: '300000' }).tiers.income_ceiling).toBe('300000')
  })
})

describe('the other settings (§S5 F2, F3; §S11.5)', () => {
  it('writes the prior-year weight as a fraction and the current-year weight as 1 − it', () => {
    const typed = doc({ [PRIOR_WEIGHT]: '60' })
    expect([typed.income.weights.prior_year, typed.income.weights.current_year]).toEqual([
      '0.6',
      '0.4',
    ])
    expect(currentYearWords(typed)).toBe('40%')
    expect(shownValue(PRIOR_WEIGHT, SANDBOX_DOC)).toBe('50')
  })

  it('checks or unchecks a criterion and sets a weight and the Dependents choice', () => {
    const typed = doc({
      [enabledKey(0)]: 'false',
      [weightKey('general', 'unemployment')]: '0.75',
      [DEPENDENTS]: 'tier_shift',
    })
    expect(typed.equity.criteria?.[0]?.enabled).toBe(false)
    expect(
      (typed.equity.weights as Record<string, Record<string, unknown>>)['general']?.['unemployment']
    ).toBe('0.75')
    expect(typed.income.dependents_mode).toBe('tier_shift')
  })
})

describe('"was …" (§S5 F common rules)', () => {
  it('says the starting point’s value for each changed setting, "—" for a copied tier, and nothing unchanged', () => {
    const typed = doc({
      [cellKey('r1', 'general', 2)]: '65',
      [TIER_COUNT]: '4',
      [TIER_WIDTH]: '35000',
    })
    expect(wasWords(cellKey('r1', 'general', 2), typed, SANDBOX_DOC)).toBe('was 60%')
    expect(wasWords(cellKey('r1', 'general', 4), typed, SANDBOX_DOC)).toBe('was —')
    expect(wasWords(TIER_COUNT, typed, SANDBOX_DOC)).toBe('was 3')
    expect(wasWords(TIER_WIDTH, typed, SANDBOX_DOC)).toBe('was $40,000')
    expect(wasWords(TIER_START, typed, SANDBOX_DOC)).toBeNull()
    expect(wasWords(cellKey('r1', 'general', 1), typed, SANDBOX_DOC)).toBeNull()
  })

  it('words money in whole dollars, rounding a fractional figure (coordinator ruling 2026-10-07)', () => {
    const fractional = {
      ...SANDBOX_DOC,
      tiers: { ...SANDBOX_DOC.tiers, income_ceiling: '300000.50' },
      awards: { ...SANDBOX_DOC.awards, minimum: '41495.66' },
    } as typeof SANDBOX_DOC
    expect(wasWords(CEILING, doc({ [CEILING]: '' }), fractional)).toBe('was $300,001')
    expect(wasWords(MINIMUM, doc({ [MINIMUM]: '125' }), fractional)).toBe('was $41,496')
    const wide = {
      ...SANDBOX_DOC,
      tiers: {
        ...SANDBOX_DOC.tiers,
        bands: [
          { lower: '0', upper: '40000.88' },
          { lower: '40001', upper: null },
        ],
      },
    }
    expect(wasWords(TIER_WIDTH, doc({ [TIER_WIDTH]: '35000' }), wide)).toBe('was $40,001')
  })

  it('words a checkbox, a choice and a ceiling from none', () => {
    const typed = doc({ [enabledKey(1)]: 'true', [DEPENDENTS]: 'none', [CEILING]: '300000' })
    expect(wasWords(enabledKey(1), typed, SANDBOX_DOC)).toBe('was unchecked')
    expect(wasWords(DEPENDENTS, typed, SANDBOX_DOC)).toBe('was Lower the income')
    expect(wasWords(CEILING, typed, SANDBOX_DOC)).toBe('was none')
  })

  it('counts the settings that differ from the starting point', () => {
    expect(changeCount(SANDBOX_DOC, SANDBOX_DOC)).toBe(0)
    expect(
      changeCount(doc({ [MINIMUM]: '125', [cellKey('r1', 'general', 2)]: '65' }), SANDBOX_DOC)
    ).toBe(2)
    expect(changeCount(doc({ [MINIMUM]: '100.00' }), SANDBOX_DOC)).toBe(0) // the same figure, written differently
  })
})

describe('the lock (§S5 F; §S11.3; §S15 item 5)', () => {
  const ROUND1 = ['income', 'tiers', 'equity', 'award_tables', 'awards']

  it('greys each card once a posted round read it, and says so once per card', () => {
    expect(lockNote('tiers', [], null)).toBeNull()
    expect(lockNote('tiers', ROUND1, 1)).toBe(
      'Locked: Round 1 is posted · the Round 1 + 2 cap stays open'
    )
    expect(lockNote('equity', ROUND1, 1)).toBe('Locked: Round 1 is posted')
    expect(lockNote('income', ROUND1, 1)).toBe('Locked: Round 1 is posted')
    expect(lockNote('tiers', [...ROUND1, 'round2'], 2)).toBe('Locked: Round 2 is posted')
  })

  it('locks each box by its section; the cap only once Round 2 posts', () => {
    expect(keyLocked(cellKey('r1', 'general', 1), ROUND1)).toBe(true)
    expect(keyLocked(cellKey('cap', 'general', 1), ROUND1)).toBe(false)
    expect(keyLocked(cellKey('cap', 'general', 1), [...ROUND1, 'round2'])).toBe(true)
    expect(keyLocked(PRIOR_WEIGHT, ['income'])).toBe(true)
    expect(keyLocked(MINIMUM, ['tiers'])).toBe(false)
  })

  it('makes only a table’s own cells boxes', () => {
    expect([
      cellEditable(SANDBOX_DOC, 'r1', 'general'),
      cellEditable(SANDBOX_DOC, 'r1', 'teen'),
    ]).toEqual([true, false])
  })
})

describe('the cards’ binding (§S5 F)', () => {
  const bind = (entries: Record<string, string>) =>
    bindingOf({
      recorded: SANDBOX_DOC,
      source: SANDBOX_DOC,
      edits: edits(entries),
      locked: [],
      byRound: null,
      canEdit: true,
      type: () => undefined,
      release: () => undefined,
    })

  it('shows the typing while typed, else the document’s value; marks bad figures and changes', () => {
    const binding = bind({ [TIER_WIDTH]: '35,000', [MINIMUM]: 'abc' })
    expect([binding.value(TIER_WIDTH), binding.value(TIER_COUNT), binding.value(MINIMUM)]).toEqual([
      '35,000',
      '3',
      'abc',
    ])
    expect([binding.bad(MINIMUM), binding.bad(TIER_WIDTH)]).toEqual([true, false])
    expect(binding.was(TIER_WIDTH)).toBe('was $40,000')
  })

  it('words a fractional starting point in whole dollars (coordinator ruling 2026-10-07)', () => {
    const source = { ...SANDBOX_DOC, awards: { ...SANDBOX_DOC.awards, minimum: '125.50' } }
    const binding = bindingOf({
      recorded: SANDBOX_DOC,
      source,
      edits: edits({}),
      locked: [],
      byRound: null,
      canEdit: true,
      type: () => undefined,
      release: () => undefined,
    })
    expect(binding.was(MINIMUM)).toBe('was $126')
  })

  it('keeps each card’s bad figures to itself', () => {
    const problems = new Map([
      [MINIMUM, 'needs a figure' as const],
      [PRIOR_WEIGHT, '0 to 100' as const],
    ])
    expect([...cardProblems(problems, 'tiers').keys()]).toEqual([MINIMUM])
    expect([...cardProblems(problems, 'income').keys()]).toEqual([PRIOR_WEIGHT])
    expect(cardProblems(problems, 'equity').size).toBe(0)
  })
})

describe('a class or table key borrows its program label', () => {
  const named = {
    ...SANDBOX_DOC,
    programs: { ...SANDBOX_DOC.programs, teen: { label: 'Teen Program' } },
  } as typeof SANDBOX_DOC

  it('reads a table or class as the program with that key, else in words', () => {
    expect(classLabel('teen', named)).toBe('Teen Program')
    expect(classLabel('general', named)).toBe('General')
  })

  it("names a table's cell in Fix first by that label", () => {
    const applied = applyEdits(named, edits({ [cellKey('r1', 'teen', 3)]: '' }))
    expect(fixFirstWords(applied.problems, named)).toBe(
      'Fix first: Round 1 % › Teen Program › Tier 3 (needs a figure)'
    )
  })
})
