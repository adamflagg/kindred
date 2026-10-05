import { describe, expect, it } from 'vitest'

import { householdPage, householdRequest, receiptOut } from './householdFixtures'
import {
  conflictWords,
  conflictsOf,
  exceptionsOf,
  grantsTabMeta,
  incomeTabMeta,
  moreWords,
  openFlagCount,
  otherFlags,
  pctWords,
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

describe('pricedFacts: "What priced it", from the payload only', () => {
  it("reads the pricing figures from the household's receipt trace, and last year's from its answer", () => {
    const facts = pricedFacts(PLAIN_PAGE, PLAIN_PAGE.incomes[0]!)
    expect(facts.adjusted).toBe(120000)
    expect(facts.tier).toBe(5)
    expect(facts.finalTier).toBe(5)
    expect(facts.rules).toBe('rules 2027 v1')
    expect(facts.confirmed).toBe(81000)
  })

  it('prefers a live receipt over a locked one', () => {
    const page = householdPage({
      requests: [
        householdRequest(ROW_EMMA, {
          receipts: [
            receiptOut(3, { kind: 'locked', rules_version: 3 }),
            receiptOut(2, { kind: 'live', rules_version: 4 }),
          ],
        }),
      ],
    })
    expect(pricedFacts(page, income()).rules).toBe('rules 2027 v4')
  })

  it('has nothing to say for a household with no priced request, and no confirmed income', () => {
    const page = householdPage({ requests: [] })
    const facts = pricedFacts(page, income({ answers: [answer('income_confirmed', '')] }))
    expect(facts).toEqual({
      adjusted: null,
      tier: null,
      finalTier: null,
      rules: null,
      confirmed: null,
    })
  })

  it("reads each household's own receipt on a two-household page", () => {
    const garcia = TWO_HOUSEHOLD_PAGE.incomes[1]!
    expect(pricedFacts(TWO_HOUSEHOLD_PAGE, garcia).adjusted).toBe(120000)
    expect(
      pricedFacts(householdPage({ requests: [householdRequest(ROW_EMMA)] }), garcia).adjusted
    ).toBeNull()
  })
})

describe('pctWords: this year against last', () => {
  it('signs the difference, and has none to give without both figures', () => {
    expect(pctWords(84200, 81000)).toBe('+4%')
    expect(pctWords(84200, 136000)).toBe('−38%')
    expect(pctWords(81000, 81000)).toBe('0%')
    expect(pctWords(null, 81000)).toBeNull()
    expect(pctWords(84200, 0)).toBeNull()
  })
})
