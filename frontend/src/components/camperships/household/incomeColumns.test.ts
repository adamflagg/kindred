import { describe, expect, it } from 'vitest'

import { gridRow, ROW_EMMA } from '../requests/gridFixtures'
import { householdPage, householdRequest } from './householdFixtures'
import { answerState, formColumns, formFigure, usingNote, whyWords } from './incomeColumns'
import { conflictsOf } from './incomeModel'
import { GROSS_CONFLICT, answer, income, plainAnswers } from './sectionsFixtures'

/**
 * household-v4 section 3 (owner ruling 10-05): one column per form, then "Using", which says where an
 * unsettled answer's figure comes from exactly as choose_household_answers chose it.
 */

const PAGE = householdPage()

const resolved = <F extends { detail: object }>(flag: F): F => ({
  ...flag,
  detail: { ...flag.detail, resolved_by_correction: true },
})

/** Three forms on housing: Emma's (1000002) $30,000; Samuel's (1000010) and 1000099's $36,000. */
const HOUSING_MOST = {
  code: 'household_answer_conflict',
  detail: {
    fields: {
      total_housing_expenses: [
        { value: 30000, person_cm_ids: [1000002] },
        { value: 36000, person_cm_ids: [1000010, 1000099] },
      ],
    },
    resolved_by_correction: false,
  },
}
/** Two forms on the children, one each: the server takes the lower person id's figure, Emma's 3. */
const CHILDREN_TIE = {
  code: 'household_answer_conflict',
  detail: {
    fields: {
      num_children: [
        { value: 2, person_cm_ids: [1000010] },
        { value: 3, person_cm_ids: [1000002] },
      ],
    },
    resolved_by_correction: false,
  },
}

const withAnswer = (field: string, over: Parameters<typeof answer>[2], synced = '') =>
  plainAnswers().map((a) => (a.field === field ? answer(field, synced || a.synced, over) : a))

const setup = (inc: ReturnType<typeof income>, field: string) => {
  const conflict = conflictsOf(inc).find((c) => c.field === field)
  const ans = inc.answers.find((a) => a.field === field)!
  return { conflict, ans }
}

describe('formColumns: one column per form, by person id', () => {
  it("heads each form by its owner, from form_people and the conflicts' variants", () => {
    const inc = income({
      flags: [GROSS_CONFLICT],
      form_people: [{ person_cm_id: 1000010, first_name: 'Samuel', last_name: 'Johnson' }],
    })
    expect(formColumns(PAGE, inc)).toEqual([
      { personCmId: 1000002, head: "Emma's form" },
      { personCmId: 1000010, head: "Samuel's form" },
    ])
  })

  it('counts a form named only in form_people, and keeps the forms once a conflict is settled', () => {
    const inc = income({
      flags: [resolved(GROSS_CONFLICT)],
      form_people: [{ person_cm_id: 1000099, first_name: 'Noah', last_name: 'Johnson' }],
    })
    expect(formColumns(householdPage({ incomes: [inc] }), inc).map((c) => c.head)).toEqual([
      "Emma's form",
      "Samuel's form",
      "Noah's form",
    ])
  })

  it('has at most one column with a single form, and names an unknown person by id', () => {
    expect(formColumns(PAGE, income())).toEqual([])
    const one = income({
      form_people: [{ person_cm_id: 1000002, first_name: 'Emma', last_name: 'Johnson' }],
    })
    expect(formColumns(PAGE, one)).toHaveLength(1)
    expect(formColumns(PAGE, income({ flags: [HOUSING_MOST] })).map((c) => c.head)).toEqual([
      "Emma's form",
      "Samuel's form",
      "person 1000099's form",
    ])
  })
})

describe('answerState: open, settled, or plain', () => {
  it('is open while its conflict is unresolved and the answer uncorrected', () => {
    const { conflict, ans } = setup(income({ flags: [GROSS_CONFLICT] }), 'total_gross_income')
    expect(answerState(ans, conflict)).toBe('open')
  })

  it('is settled once corrected, or once its flag is resolved', () => {
    const corrected = income({
      answers: withAnswer('total_gross_income', { effective: '84000.00', corrected: true }),
      flags: [GROSS_CONFLICT],
    })
    const a = setup(corrected, 'total_gross_income')
    expect(answerState(a.ans, a.conflict)).toBe('settled')
    const b = setup(income({ flags: [resolved(GROSS_CONFLICT)] }), 'total_gross_income')
    expect(answerState(b.ans, b.conflict)).toBe('settled')
  })

  it('is plain with no conflict', () => {
    const { conflict, ans } = setup(income(), 'total_gross_income')
    expect(answerState(ans, conflict)).toBe('plain')
  })
})

describe("formFigure: each form's own figure", () => {
  it("reads each form's figure from the conflict, a dash for a form that gave none", () => {
    const { conflict, ans } = setup(income({ flags: [HOUSING_MOST] }), 'total_housing_expenses')
    expect(formFigure(ans, conflict, 1000002)).toEqual({ text: '$30,000', struck: false })
    expect(formFigure(ans, conflict, 1000099)).toEqual({ text: '$36,000', struck: false })
    expect(formFigure(ans, conflict, 1000123)).toEqual({ text: '—', struck: false })
  })

  it('strikes the figures the settling correction did not use, never the used one', () => {
    const inc = income({
      answers: withAnswer('total_gross_income', { effective: '90000', corrected: true }),
      flags: [resolved(GROSS_CONFLICT)],
    })
    const { conflict, ans } = setup(inc, 'total_gross_income')
    expect(formFigure(ans, conflict, 1000002)).toEqual({ text: '$84,000', struck: true })
    expect(formFigure(ans, conflict, 1000010)).toEqual({ text: '$90,000', struck: false })
  })

  it('reads the household answer as sent where the forms do not disagree', () => {
    const { conflict, ans } = setup(income(), 'num_children')
    expect(formFigure(ans, conflict, 1000002)).toEqual({ text: '2', struck: false })
  })
})

describe("usingNote: where an unsettled answer's figure comes from (choose_household_answers)", () => {
  it('says "on hold" for an income answer: no income is used', () => {
    const inc = income({
      answers: withAnswer('total_gross_income', { synced: '', effective: '' }),
      flags: [GROSS_CONFLICT],
    })
    const { conflict, ans } = setup(inc, 'total_gross_income')
    expect(usingNote(PAGE, ans, conflict)).toBe('on hold')
  })

  it('counts the forms giving the figure used, out of the forms giving one', () => {
    const inc = income({
      answers: withAnswer('total_housing_expenses', {}, '36000.00'),
      flags: [HOUSING_MOST],
    })
    const { conflict, ans } = setup(inc, 'total_housing_expenses')
    expect(usingNote(PAGE, ans, conflict)).toBe('2 of 3 forms')
  })

  it("names the form a tie went to: the lowest person id among the figure's forms", () => {
    const inc = income({ answers: withAnswer('num_children', {}, '3'), flags: [CHILDREN_TIE] })
    const { conflict, ans } = setup(inc, 'num_children')
    expect(usingNote(PAGE, ans, conflict)).toBe("tie: Emma's form")
    const twoTwo = {
      code: 'household_answer_conflict',
      detail: {
        fields: {
          num_children: [
            { value: 2, person_cm_ids: [1000003, 1000010] },
            { value: 3, person_cm_ids: [1000002, 1000099] },
          ],
        },
        resolved_by_correction: false,
      },
    }
    const even = income({ answers: withAnswer('num_children', {}, '3'), flags: [twoTwo] })
    const b = setup(even, 'num_children')
    expect(usingNote(PAGE, b.ans, b.conflict)).toBe("tie: Emma's form")
  })

  it('says nothing it cannot read off the payload, nor on a settled or plain answer', () => {
    const odd = income({ answers: withAnswer('num_children', {}, '5'), flags: [CHILDREN_TIE] })
    const a = setup(odd, 'num_children')
    expect(usingNote(PAGE, a.ans, a.conflict)).toBeNull()
    const settled = income({ flags: [resolved(CHILDREN_TIE)] })
    const b = setup(settled, 'num_children')
    expect(usingNote(PAGE, b.ans, b.conflict)).toBeNull()
    const c = setup(income(), 'num_children')
    expect(usingNote(PAGE, c.ans, c.conflict)).toBeNull()
  })
})

describe('whyWords: the amber line keeps only the why', () => {
  const held = (round: number, household = 1000001) =>
    householdRequest(
      gridRow({
        ...ROW_EMMA,
        request_id: `reqheld0000000${String(round)}`,
        household_cm_id: household,
        holds: [{ code: 'household_income_conflict', severity: 'hold', message: 'm' }],
        stage: { round, code: 'held', label: `R${String(round)} · On hold` },
      })
    )
  const grossOpen = income({ flags: [GROSS_CONFLICT] })
  const gross = setup(grossOpen, 'total_gross_income')

  it('names the round the income conflict holds', () => {
    const page = householdPage({ requests: [held(2)] })
    expect(whyWords(page, grossOpen, gross.ans, gross.conflict)).toBe(
      'The forms disagree. No income is used until one is picked, so Round 2 waits on hold.'
    )
    const two = householdPage({ requests: [held(1), held(2), held(3, 1000003)] })
    expect(whyWords(two, grossOpen, gross.ans, gross.conflict)).toBe(
      'The forms disagree. No income is used until one is picked, so Rounds 1 and 2 wait on hold.'
    )
  })

  it('drops the hold clause when no request of the household is held for it', () => {
    expect(whyWords(PAGE, grossOpen, gross.ans, gross.conflict)).toBe(
      'The forms disagree. No income is used until one is picked.'
    )
  })

  it('says what is used meanwhile on any other answer, with no hold', () => {
    const most = income({
      answers: withAnswer('total_housing_expenses', {}, '36000.00'),
      flags: [HOUSING_MOST],
    })
    const a = setup(most, 'total_housing_expenses')
    expect(whyWords(PAGE, most, a.ans, a.conflict)).toBe(
      'The forms disagree. Until one is picked, the figure most forms give is used.'
    )
    const tie = income({ answers: withAnswer('num_children', {}, '3'), flags: [CHILDREN_TIE] })
    const b = setup(tie, 'num_children')
    expect(whyWords(PAGE, tie, b.ans, b.conflict)).toBe(
      'The forms disagree. Until one is picked, a tie uses the form with the lower CampMinder id.'
    )
    const odd = income({ answers: withAnswer('num_children', {}, '5'), flags: [CHILDREN_TIE] })
    const c = setup(odd, 'num_children')
    expect(whyWords(PAGE, odd, c.ans, c.conflict)).toBe('The forms disagree.')
  })

  it('goes once a correction settles it; an income override still says so', () => {
    const corrected = income({
      answers: withAnswer('total_gross_income', { effective: '84000', corrected: true }),
      flags: [resolved(GROSS_CONFLICT)],
    })
    const a = setup(corrected, 'total_gross_income')
    expect(whyWords(PAGE, corrected, a.ans, a.conflict)).toBeNull()
    const overridden = income({
      answers: withAnswer('income_override', {}, '95000'),
      flags: [resolved(GROSS_CONFLICT)],
    })
    const b = setup(overridden, 'total_gross_income')
    expect(whyWords(PAGE, overridden, b.ans, b.conflict)).toBe('The income override settles it.')
    const c = setup(income(), 'total_gross_income')
    expect(whyWords(PAGE, income(), c.ans, c.conflict)).toBeNull()
  })
})
