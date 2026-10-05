import { describe, expect, it } from 'vitest'

import { householdPage, householdRequest, receiptOut } from './householdFixtures'
import {
  conflictParts,
  conflictWords,
  conflictsOf,
  exceptionsOf,
  grantsTabMeta,
  incomeTabMeta,
  moreWords,
  openFlagCount,
  otherFlags,
  lastYearWords,
  pricedFacts,
} from './incomeModel'
import {
  FLAGGED_PAGE,
  GROSS_CONFLICT,
  PLAIN_PAGE,
  TWO_HOUSEHOLD_PAGE,
  answer,
  income,
  plainAnswers,
} from './sectionsFixtures'
import { ROW_EMMA, ROW_SAMUEL } from '../requests/gridFixtures'

const flaggedIncome = FLAGGED_PAGE.incomes[0]!

describe('conflictsOf (the server variant shape, financial_aid_household.py)', () => {
  it('reads each conflicting field of income_conflict and household_answer_conflict', () => {
    const conflicts = conflictsOf(
      income({
        flags: [
          GROSS_CONFLICT,
          {
            code: 'household_answer_conflict',
            detail: {
              fields: {
                num_children: [
                  { value: 2, person_cm_ids: [1000002] },
                  { value: 3, person_cm_ids: [1000010] },
                ],
              },
              resolved_by_correction: true,
            },
          },
        ],
      })
    )
    expect(conflicts.map((c) => [c.code, c.field, c.resolved])).toEqual([
      ['income_conflict', 'total_gross_income', false],
      ['household_answer_conflict', 'num_children', true],
    ])
    expect(conflicts[0]!.variants).toEqual([
      { value: 84000, personCmIds: [1000002] },
      { value: 90000, personCmIds: [1000010] },
    ])
  })

  it('ignores a malformed detail rather than throwing', () => {
    expect(
      conflictsOf(income({ flags: [{ code: 'income_conflict', detail: { fields: 'x' } }] }))
    ).toEqual([])
    expect(conflictsOf(income({ flags: [{ code: 'income_conflict' }] }))).toEqual([])
  })

  it('leaves any other application flag to otherFlags', () => {
    const inc = income({ flags: [GROSS_CONFLICT, { code: 'billing_disagrees' }] })
    expect(otherFlags(inc).map((f) => f.code)).toEqual(['billing_disagrees'])
  })
})

describe('exceptionsOf: the answers worth a look', () => {
  it('is the corrected, the changed-since and the flagged answers, in form order', () => {
    const inc = income({
      answers: plainAnswers().map((a) =>
        a.field === 'num_children'
          ? { ...a, effective: '3', corrected: true }
          : a.field === 'total_rent'
            ? { ...a, changed_since_correction: true }
            : a
      ),
      flags: [GROSS_CONFLICT],
    })
    expect(exceptionsOf(inc).map((a) => a.field)).toEqual([
      'total_gross_income',
      'total_rent',
      'num_children',
    ])
  })

  it('is empty when nothing is corrected or flagged', () => {
    expect(exceptionsOf(income())).toEqual([])
  })
})

describe('moreWords: the toggle under the exceptions', () => {
  it('counts the answers that match, or says all match, or offers to fold back', () => {
    expect(moreWords(14, 2, false)).toBe('12 more answers match ▸')
    expect(moreWords(14, 0, false)).toBe('All 14 answers match ▸')
    expect(moreWords(14, 13, false)).toBe('1 more answer matches ▸')
    expect(moreWords(14, 2, true)).toBe('Show Only the Exceptions ▴')
  })
})

describe('conflictWords: the "why" under a flagged answer', () => {
  it("names the campers' forms when every variant maps to a camper on the page", () => {
    const [conflict] = conflictsOf(flaggedIncome)
    expect(conflictWords(FLAGGED_PAGE, flaggedIncome, conflict!)).toBe(
      "Emma's form says $84,000; Samuel's says $90,000."
    )
  })

  it('falls back to "the campers\' forms" when a person is not on the page', () => {
    const inc = income({
      flags: [
        {
          code: 'income_conflict',
          detail: {
            fields: {
              total_gross_income: [
                { value: 84000, person_cm_ids: [1000002] },
                { value: 90000, person_cm_ids: [1999999] },
              ],
            },
          },
        },
      ],
    })
    expect(conflictWords(PLAIN_PAGE, inc, conflictsOf(inc)[0]!)).toBe(
      "The campers' forms disagree: $84,000 on one, $90,000 on another."
    )
  })

  it('lists three or more figures', () => {
    const inc = income({
      flags: [
        {
          code: 'income_conflict',
          detail: {
            fields: {
              total_gross_income: [
                { value: 1, person_cm_ids: [1999997] },
                { value: 2, person_cm_ids: [1999998] },
                { value: 3, person_cm_ids: [1999999] },
              ],
            },
          },
        },
      ],
    })
    expect(conflictWords(PLAIN_PAGE, inc, conflictsOf(inc)[0]!)).toBe(
      "The campers' forms disagree: $1, $2 and $3."
    )
  })

  it('joins two campers who share a figure, and keeps a count a count', () => {
    const page = householdPage({
      requests: [
        householdRequest(ROW_EMMA),
        householdRequest(ROW_SAMUEL),
        householdRequest({
          ...ROW_SAMUEL,
          request_id: 'reqnoah00000009',
          person_cm_id: 1000011,
          camper_name: 'Noah Johnson',
        }),
      ],
    })
    const inc = income({
      flags: [
        {
          code: 'household_answer_conflict',
          detail: {
            fields: {
              num_children: [
                { value: 2, person_cm_ids: [1000002, 1000011] },
                { value: 3, person_cm_ids: [1000010] },
              ],
            },
          },
        },
      ],
    })
    expect(conflictWords(page, inc, conflictsOf(inc)[0]!)).toBe(
      "Emma's and Noah's forms say 2; Samuel's says 3."
    )
  })

  it('says a resolved conflict is settled, by the correction or by the income override', () => {
    const resolved = {
      ...GROSS_CONFLICT,
      detail: { ...GROSS_CONFLICT.detail, resolved_by_correction: true },
    }
    const corrected = income({
      answers: plainAnswers().map((a) =>
        a.field === 'total_gross_income' ? { ...a, effective: '87000.00', corrected: true } : a
      ),
      flags: [resolved],
    })
    expect(conflictWords(FLAGGED_PAGE, corrected, conflictsOf(corrected)[0]!)).toBe(
      "Emma's form says $84,000; Samuel's says $90,000. The correction settles it."
    )
    const overridden = income({
      answers: plainAnswers().map((a) =>
        a.field === 'income_override' ? { ...a, effective: 'prior_year_only', corrected: true } : a
      ),
      flags: [resolved],
    })
    expect(conflictWords(FLAGGED_PAGE, overridden, conflictsOf(overridden)[0]!)).toBe(
      "Emma's form says $84,000; Samuel's says $90,000. The income override settles it."
    )
  })
})

describe("conflictParts: the why line's pieces, the other forms' figures struck once settled (round 3, section 3)", () => {
  const settledOn = (effective: string) =>
    income({
      answers: plainAnswers().map((a) =>
        a.field === 'total_gross_income' ? { ...a, effective, corrected: true } : a
      ),
      flags: [
        { ...GROSS_CONFLICT, detail: { ...GROSS_CONFLICT.detail, resolved_by_correction: true } },
      ],
    })

  it('strikes the figure of each form the correction did not use, and reads as conflictWords', () => {
    const settled = settledOn('84000.00')
    const parts = conflictParts(FLAGGED_PAGE, settled, conflictsOf(settled)[0]!)
    expect(parts.filter((p) => p.struck === true).map((p) => p.text)).toEqual(['$90,000'])
    expect(parts.map((p) => p.text).join('')).toBe(
      conflictWords(FLAGGED_PAGE, settled, conflictsOf(settled)[0]!)
    )
  })

  it('strikes both on a figure neither form gave, and none while the conflict is open', () => {
    const settled = settledOn('87000.00')
    expect(
      conflictParts(FLAGGED_PAGE, settled, conflictsOf(settled)[0]!).filter(
        (p) => p.struck === true
      )
    ).toHaveLength(2)
    expect(
      conflictParts(FLAGGED_PAGE, flaggedIncome, conflictsOf(flaggedIncome)[0]!).some(
        (p) => p.struck === true
      )
    ).toBe(false)
  })
})

describe('openFlagCount: what opens Income by itself', () => {
  it('counts each open conflicting answer and each other flag, per household', () => {
    expect(openFlagCount(PLAIN_PAGE)).toBe(0)
    expect(openFlagCount(FLAGGED_PAGE)).toBe(1)
    const page = householdPage({
      incomes: [
        income({ flags: [GROSS_CONFLICT, { code: 'billing_disagrees' }] }),
        income({ household_cm_id: 1000003, flags: [GROSS_CONFLICT] }),
      ],
    })
    expect(openFlagCount(page)).toBe(3)
  })

  it('does not count a conflict the correction resolved (resolved_by_correction)', () => {
    const page = householdPage({
      incomes: [
        income({
          flags: [
            {
              ...GROSS_CONFLICT,
              detail: { ...GROSS_CONFLICT.detail, resolved_by_correction: true },
            },
          ],
        }),
      ],
    })
    expect(openFlagCount(page)).toBe(0)
  })
})

describe("incomeTabMeta: the Income tab's words", () => {
  it('is the flag count when anything is flagged', () => {
    expect(incomeTabMeta(FLAGGED_PAGE)).toEqual({ flags: 1, words: null })
  })

  it('says how many answers are corrected, and that the forms agree when there are two to compare', () => {
    expect(incomeTabMeta(PLAIN_PAGE)).toEqual({ flags: 0, words: 'no corrections · forms agree ✓' })
    const corrected = householdPage({
      incomes: [
        income({
          answers: plainAnswers().map((a) =>
            a.field === 'num_children' ? { ...a, effective: '3', corrected: true } : a
          ),
        }),
      ],
    })
    expect(incomeTabMeta(corrected)).toEqual({ flags: 0, words: '1 corrected · forms agree ✓' })
  })

  it('says when the household has no income form at all', () => {
    expect(incomeTabMeta(householdPage({ incomes: [] }))).toEqual({
      flags: 0,
      words: 'no form on file',
    })
  })

  it('drops "forms agree" when there is only one form to read', () => {
    const one = householdPage({ requests: [householdRequest(ROW_EMMA)], incomes: [income()] })
    expect(incomeTabMeta(one)).toEqual({ flags: 0, words: 'no corrections' })
  })

  it('drops "forms agree" once a conflict is only settled, not agreed', () => {
    const page = householdPage({
      incomes: [
        income({
          flags: [
            {
              ...GROSS_CONFLICT,
              detail: { ...GROSS_CONFLICT.detail, resolved_by_correction: true },
            },
          ],
        }),
      ],
    })
    expect(incomeTabMeta(page).words).toBe('no corrections')
  })
})

describe('grantsTabMeta', () => {
  it('counts grants and postings, and the expected chips apart', () => {
    expect(grantsTabMeta(PLAIN_PAGE)).toEqual({ words: '1 grant · 2 postings', expected: 1 })
    expect(grantsTabMeta(householdPage({ grants: [], postings: [], expected: [] }))).toEqual({
      words: '0 grants · 0 postings',
      expected: 0,
    })
  })
})

describe("pricedFacts: last year's line, from the payload only", () => {
  it("reads this year's adjusted income from the household's receipt trace, and last year's from its answer", () => {
    const facts = pricedFacts(PLAIN_PAGE, PLAIN_PAGE.incomes[0]!)
    expect(facts).toEqual({ adjusted: 120000, confirmed: 81000 })
  })

  it('prefers a live receipt over a locked one', () => {
    const at = (round: number, kind: 'live' | 'locked', adjusted: string) => ({
      ...receiptOut(round, { kind }),
      trace: receiptOut(round).trace.map((s) =>
        s.key === 'adjusted_income' ? { ...s, value: adjusted } : s
      ),
    })
    const page = householdPage({
      requests: [
        householdRequest(ROW_EMMA, {
          receipts: [at(3, 'locked', '70000.00'), at(2, 'live', '90000.00')],
        }),
      ],
    })
    expect(pricedFacts(page, income()).adjusted).toBe(90000)
  })

  it('has nothing to say for a household with no priced request, and no confirmed income', () => {
    const page = householdPage({ requests: [] })
    const facts = pricedFacts(page, income({ answers: [answer('income_confirmed', '')] }))
    expect(facts).toEqual({ adjusted: null, confirmed: null })
  })

  it("reads each household's own receipt on a two-household page", () => {
    const garcia = TWO_HOUSEHOLD_PAGE.incomes[1]!
    expect(pricedFacts(TWO_HOUSEHOLD_PAGE, garcia).adjusted).toBe(120000)
    expect(
      pricedFacts(householdPage({ requests: [householdRequest(ROW_EMMA)] }), garcia).adjusted
    ).toBeNull()
  })
})

describe("lastYearWords: last year's confirmed income against this year's adjusted (round 3 (E))", () => {
  it('says how much lower or higher, a whole percentage of last year', () => {
    expect(lastYearWords(82900, 96500)).toEqual({
      confirmed: '$96,500',
      compare: "this year's adjusted is 14% lower",
    })
    expect(lastYearWords(61200, 58000)?.compare).toBe("this year's adjusted is 6% higher")
  })

  it('rounds half away from zero either way, so the same gap reads the same up or down', () => {
    // 14.5% of $100,000 is $14,500.
    expect(lastYearWords(114500, 100000)?.compare).toBe("this year's adjusted is 15% higher")
    expect(lastYearWords(85500, 100000)?.compare).toBe("this year's adjusted is 15% lower")
  })

  it('says the same only when the figures are equal, never for a gap that rounds to 0%', () => {
    expect(lastYearWords(81000, 81000)?.compare).toBe("this year's adjusted is the same")
    expect(lastYearWords(81200, 81000)?.compare).toBe("this year's adjusted is under 1% higher")
    expect(lastYearWords(80800, 81000)?.compare).toBe("this year's adjusted is under 1% lower")
  })

  it('has only the first half without an adjusted income, or with nothing confirmed to compare to', () => {
    expect(lastYearWords(null, 96500)).toEqual({ confirmed: '$96,500', compare: null })
    expect(lastYearWords(84200, 0)).toEqual({ confirmed: '$0', compare: null })
  })

  it('has no line without last year', () => {
    expect(lastYearWords(84200, null)).toBeNull()
  })
})
