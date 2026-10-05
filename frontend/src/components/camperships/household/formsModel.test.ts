import { describe, expect, it } from 'vitest'

import type { ApiAidUseFormOut } from '../../../types/api-types'
import { householdPage } from './householdFixtures'
import {
  correctLabel,
  correctionPicks,
  disagreeWords,
  formChoices,
  formOutcomeWords,
  formOwner,
  settleWords,
  formHint,
} from './formsModel'
import { GROSS_CONFLICT, answer, income, plainAnswers } from './sectionsFixtures'

/** Emma's form (1000002) and Samuel's (1000010) disagree on three income answers, and on the children. */
const INCOME_FLAG = {
  code: 'income_conflict',
  detail: {
    fields: {
      total_gross_income: [
        { value: 84000, person_cm_ids: [1000002] },
        { value: 88000, person_cm_ids: [1000010] },
      ],
      expected_gross_income: [
        { value: 86500, person_cm_ids: [1000002] },
        { value: 90000, person_cm_ids: [1000010] },
      ],
      total_housing_expenses: [
        { value: 30000, person_cm_ids: [1000002] },
        { value: 36000, person_cm_ids: [1000010] },
      ],
    },
    resolved_by_correction: false,
  },
}
const CHILDREN_FLAG = {
  code: 'household_answer_conflict',
  detail: {
    fields: {
      num_children: [
        { value: 3, person_cm_ids: [1000002] },
        { value: 2, person_cm_ids: [1000010] },
      ],
    },
    resolved_by_correction: false,
  },
}

const PAGE = householdPage()
const corrected = (field: string, effective: string) =>
  plainAnswers().map((a) => (a.field === field ? { ...a, effective, corrected: true } : a))
const resolved = <F extends { detail: object }>(flag: F): F => ({
  ...flag,
  detail: { ...flag.detail, resolved_by_correction: true },
})

describe('formChoices: one Use X’s Form per form the open conflicts name', () => {
  it('names each form once, in the order the flags first name them, by the camper’s first name', () => {
    expect(formChoices(PAGE, income({ flags: [INCOME_FLAG, CHILDREN_FLAG] }))).toEqual([
      { personCmId: 1000002, name: 'Emma' },
      { personCmId: 1000010, name: 'Samuel' },
    ])
  })

  it('offers none with no conflict flag, or once every conflict is resolved', () => {
    expect(formChoices(PAGE, income())).toEqual([])
    expect(formChoices(PAGE, income({ flags: [{ code: 'billing_disagrees' }] }))).toEqual([])
    expect(
      formChoices(PAGE, income({ flags: [resolved(INCOME_FLAG), resolved(CHILDREN_FLAG)] }))
    ).toEqual([])
  })

  it('still offers the forms while one flag of two is open', () => {
    expect(
      formChoices(PAGE, income({ flags: [resolved(INCOME_FLAG), CHILDREN_FLAG] }))
    ).toHaveLength(2)
  })

  it('names a form whose person is not a camper on the page by the person id', () => {
    const flag = {
      code: 'household_answer_conflict',
      detail: {
        fields: {
          num_children: [
            { value: 1, person_cm_ids: [1000002] },
            { value: 2, person_cm_ids: [1000099] },
          ],
        },
        resolved_by_correction: false,
      },
    }
    expect(formChoices(PAGE, income({ flags: [flag] }))).toEqual([
      { personCmId: 1000002, name: 'Emma' },
      { personCmId: 1000099, name: 'person 1000099' },
    ])
  })
})

// Owner ruling 10-05: Use X's Form touches only the answers that disagree (#3021's contract), and
// its words say so beside the buttons.
describe("formHint: what Use X's Form touches", () => {
  it('counts the answers that disagree', () => {
    expect(formHint(income({ flags: [INCOME_FLAG, CHILDREN_FLAG] }))).toBe(
      'for the 4 answers that disagree'
    )
  })

  it('says one in the singular, leaves out a corrected answer, and is null with none open', () => {
    const two = income({ answers: corrected('num_children', '3'), flags: [GROSS_CONFLICT] })
    expect(formHint(two)).toBe('for the 1 answer that disagrees')
    expect(formHint(income())).toBeNull()
  })
})

describe('disagreeWords: the strip above the disagreeing answers', () => {
  it('counts the answers still disagreeing and names the forms', () => {
    expect(disagreeWords(PAGE, income({ flags: [INCOME_FLAG, CHILDREN_FLAG] }))).toEqual({
      count: '4 answers disagree',
      rest: " between Emma's form and Samuel's form.",
    })
  })

  it('leaves out an answer already corrected, and says one in the singular', () => {
    const one = income({
      answers: corrected('total_gross_income', '84000'),
      flags: [GROSS_CONFLICT],
    })
    expect(disagreeWords(PAGE, one)).toBeNull()
    const two = income({ answers: corrected('num_children', '3'), flags: [GROSS_CONFLICT] })
    expect(disagreeWords(PAGE, two)?.count).toBe('1 answer disagrees')
  })

  it('names three forms as a list', () => {
    const flag = {
      code: 'income_conflict',
      detail: {
        fields: {
          total_gross_income: [
            { value: 1, person_cm_ids: [1000002] },
            { value: 2, person_cm_ids: [1000010] },
            { value: 3, person_cm_ids: [1000099] },
          ],
        },
        resolved_by_correction: false,
      },
    }
    expect(disagreeWords(PAGE, income({ flags: [flag] }))?.rest).toBe(
      " between Emma's, Samuel's and person 1000099's forms."
    )
  })

  it('says nothing with no open conflict', () => {
    expect(disagreeWords(PAGE, income())).toBeNull()
    expect(disagreeWords(PAGE, income({ flags: [resolved(INCOME_FLAG)] }))).toBeNull()
  })
})

describe('settleWords: what saving one correction settles', () => {
  const housing = (over: Parameters<typeof answer>[2] = {}) =>
    answer('total_housing_expenses', '30000.00', over)

  it('counts the answers of its own flag still open, and says when the hold clears', () => {
    expect(settleWords(income({ flags: [INCOME_FLAG, CHILDREN_FLAG] }), housing())).toBe(
      'This settles 1 of the 3. The hold clears when all three agree.'
    )
  })

  it('says the last one clears the hold', () => {
    const answers = corrected('total_gross_income', '84000').map((a) =>
      a.field === 'expected_gross_income' ? { ...a, effective: '86500', corrected: true } : a
    )
    expect(settleWords(income({ answers, flags: [INCOME_FLAG] }), housing())).toBe(
      'This settles the last one. The hold clears.'
    )
  })

  it('names no hold for an answer conflict, which holds nothing', () => {
    const children = answer('num_children', '2')
    expect(settleWords(income({ flags: [CHILDREN_FLAG] }), children)).toBe(
      'This settles the last answer the forms disagree on.'
    )
  })

  it('says nothing for an answer in no open conflict, or already corrected', () => {
    expect(settleWords(income(), housing())).toBeNull()
    expect(settleWords(income({ flags: [resolved(INCOME_FLAG)] }), housing())).toBeNull()
    expect(
      settleWords(income({ flags: [INCOME_FLAG] }), housing({ corrected: true, effective: '1' }))
    ).toBeNull()
  })
})

describe('correctionPicks: the Correct… row’s Use picks', () => {
  it('offers each form’s figure where the forms disagree, named by camper', () => {
    const picks = correctionPicks(
      PAGE,
      income({ flags: [INCOME_FLAG] }),
      answer('total_housing_expenses', '30000.00')
    )
    expect(picks).toEqual([
      { label: "Emma's $30,000", value: '30000', revert: false },
      { label: "Samuel's $36,000", value: '36000', revert: false },
    ])
  })

  it('keeps the picks once the conflict is resolved, to change the figure used', () => {
    const picks = correctionPicks(
      PAGE,
      income({ flags: [resolved(CHILDREN_FLAG)] }),
      answer('num_children', '2', { effective: '3', corrected: true })
    )
    expect(picks.map((p) => p.label)).toEqual(["Emma's 3", "Samuel's 2"])
  })

  it('offers the way back to the form’s figure on a corrected answer with one form', () => {
    expect(
      correctionPicks(
        PAGE,
        income(),
        answer('total_rent', '900.00', { effective: '1200', corrected: true })
      )
    ).toEqual([{ label: "The form's $900", value: '900.00', revert: true }])
  })

  it('offers nothing on an answer as sent with one form', () => {
    expect(correctionPicks(PAGE, income(), answer('total_rent', '900.00'))).toEqual([])
  })
})

describe('formOutcomeWords: what a Use X’s Form did', () => {
  const out = (over: Partial<ApiAidUseFormOut> = {}): ApiAidUseFormOut => ({
    household_cm_id: 1000001,
    person_cm_id: 1000002,
    operation_id: 'op0000000000009',
    applied: [],
    skipped_blank: [],
    unchanged: [],
    still_disagreeing: [],
    ...over,
  })
  const applied = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `cor00000000000${String(i)}`,
      request_id: '',
      field: 'total_gross_income',
      new_value: '84000',
      original_value: '88000',
      reason: '',
      actor: 'test@example.com',
      created: '',
    }))

  it('says how many answers it used the form for', () => {
    expect(formOutcomeWords('Emma', out({ applied: applied(4) }), ['Samuel'])).toEqual([
      "Used Emma's form for 4 answers.",
    ])
    expect(formOutcomeWords('Emma', out({ applied: applied(1) }), ['Samuel'])).toEqual([
      "Used Emma's form for 1 answer.",
    ])
  })

  it('says there was nothing to change when it wrote nothing', () => {
    expect(
      formOutcomeWords('Emma', out({ operation_id: '', unchanged: ['total_gross_income'] }), [
        'Samuel',
      ])
    ).toEqual(["Nothing to change: every answer already matches Emma's form."])
  })

  it('names the answers the form left blank, and the other form to use', () => {
    expect(
      formOutcomeWords(
        'Emma',
        out({ applied: applied(2), skipped_blank: ['total_medical_expenses'] }),
        ['Samuel']
      )
    ).toEqual([
      "Used Emma's form for 2 answers.",
      "Emma's form left Medical expenses blank: correct it by hand or use Samuel's.",
    ])
  })

  it('says "another form" with several others, and "them" for several blanks', () => {
    expect(
      formOutcomeWords(
        'Emma',
        out({
          operation_id: '',
          unchanged: ['num_children'],
          skipped_blank: ['total_medical_expenses', 'total_rent'],
        }),
        ['Samuel', 'Liam']
      )
    ).toEqual([
      "Nothing to change: every answer already matches Emma's form.",
      "Emma's form left Medical expenses and Rent blank: correct them by hand or use another form.",
    ])
  })
})

// Item 9 (#3022): each income carries form_people, its forms' owners named from persons. They name a
// form first, then the page's campers, then the person id (someone with no persons row is left out).
describe('formOwner: form_people first, then the campers, then the id (item 9)', () => {
  const NOAH = { person_cm_id: 1000099, first_name: 'Noah', last_name: 'Johnson' }
  const withPeople = (people: Array<typeof NOAH>) =>
    householdPage({ incomes: [income({ form_people: people })] })

  it('names a form owner who is not a camper on the page from form_people', () => {
    expect(formOwner(withPeople([NOAH]), 1000099)).toBe('Noah')
    expect(formOwner(PAGE, 1000099)).toBe('person 1000099')
  })

  it("prefers form_people's first name over the camper's", () => {
    const page = withPeople([{ person_cm_id: 1000002, first_name: 'Em', last_name: 'Johnson' }])
    expect(formOwner(page, 1000002)).toBe('Em')
  })

  it("reads any household's form_people, and falls back past a blank first name", () => {
    const page = householdPage({
      incomes: [
        income(),
        income({
          household_cm_id: 1000003,
          form_people: [NOAH, { person_cm_id: 1000002, first_name: ' ', last_name: '' }],
        }),
      ],
    })
    expect(formOwner(page, 1000099)).toBe('Noah')
    expect(formOwner(page, 1000002)).toBe('Emma')
  })

  it("names the Use X's Form choices from form_people", () => {
    const flag = {
      code: 'household_answer_conflict',
      detail: {
        fields: {
          num_children: [
            { value: 1, person_cm_ids: [1000002] },
            { value: 2, person_cm_ids: [1000099] },
          ],
        },
        resolved_by_correction: false,
      },
    }
    const page = withPeople([NOAH])
    expect(formChoices(page, income({ flags: [flag], form_people: [NOAH] }))).toEqual([
      { personCmId: 1000002, name: 'Emma' },
      { personCmId: 1000099, name: 'Noah' },
    ])
  })
})

// household-v4 section 3 (owner ruling 10-05): only an unsettled disagreeing answer changes its button.
describe('correctLabel: Choose Which Form… on an unsettled disagreeing answer, else Correct…', () => {
  const housing = (over: Parameters<typeof answer>[2] = {}) =>
    answer('total_housing_expenses', '30000.00', over)

  it('reads Choose Which Form… while the forms disagree and nothing settled it', () => {
    expect(correctLabel(income({ flags: [INCOME_FLAG] }), housing())).toBe('Choose Which Form…')
  })

  it('keeps Correct… on a corrected answer, a resolved flag, and a matching answer', () => {
    expect(
      correctLabel(income({ flags: [INCOME_FLAG] }), housing({ corrected: true, effective: '1' }))
    ).toBe('Correct…')
    expect(correctLabel(income({ flags: [resolved(INCOME_FLAG)] }), housing())).toBe('Correct…')
    expect(correctLabel(income(), housing())).toBe('Correct…')
  })
})
