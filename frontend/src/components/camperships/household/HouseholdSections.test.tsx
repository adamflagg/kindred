import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ApiAidHouseholdPageLink, ApiAidIncome } from '../../../types/api-types'
import { householdPage, householdRequest } from './householdFixtures'
import { GrantsPostingsPanel, HistoryPanel, IncomePanel, LinksPanel } from './HouseholdSections'
import {
  FLAGGED_PAGE,
  GROSS_CONFLICT,
  HISTORY_PAGE,
  PLAIN_PAGE,
  TWO_HOUSEHOLD_PAGE,
  income,
  plainAnswers,
} from './sectionsFixtures'
import { ROW_EMMA } from '../requests/gridFixtures'

const PAGE = householdPage()

const rowOf = (text: string) => screen.getByText(text).closest('tr') as HTMLElement

describe('IncomePanel: the exceptions only (income (e); N8)', () => {
  it("lists only the corrected and flagged answers, each form's figure and the one used", () => {
    render(<IncomePanel page={FLAGGED_PAGE} />)
    const children = rowOf('Children')
    // No flag disputes it: the form's 2 shows once, across the form columns (owner ruling 10-05).
    expect(within(children).getAllByText('2')).toHaveLength(1)
    expect(within(children).getByText('3')).toBeInTheDocument()
    expect(within(children).getByText('corrected')).toBeInTheDocument()
    expect(screen.getByText('Gross income')).toBeInTheDocument()
    expect(screen.queryByText('Housing expenses')).toBeNull()
  })

  it("puts only the why under a flagged answer, tinted amber: each form's figure is in its column", () => {
    render(<IncomePanel page={FLAGGED_PAGE} />)
    const why = screen.getByText('The forms disagree. No income is used until one is picked.')
    expect(why.closest('tr')?.className).toMatch(/amber/)
    expect(rowOf('Gross income').className).toMatch(/amber/)
    expect(why.closest('tr')).not.toHaveTextContent('$84,000')
    const gross = rowOf('Gross income')
    const cells = within(gross).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('$84,000')
    expect(cells[2]).toHaveTextContent('$90,000')
  })

  it('leaves a settled conflict untinted, with no why line: the corrected pill says it', () => {
    const page = householdPage({
      incomes: [
        income({
          answers: plainAnswers().map((a) =>
            a.field === 'total_gross_income' ? { ...a, effective: '87000.00', corrected: true } : a
          ),
          flags: [
            {
              ...GROSS_CONFLICT,
              detail: { ...GROSS_CONFLICT.detail, resolved_by_correction: true },
            },
          ],
        }),
      ],
    })
    render(<IncomePanel page={page} />)
    const gross = rowOf('Gross income')
    expect(gross.className).not.toMatch(/amber/)
    expect(within(gross).getByText('corrected')).toBeInTheDocument()
    expect(screen.queryByText(/settles it/)).toBeNull()
    expect(screen.queryByText(/The forms disagree/)).toBeNull()
  })

  it("strikes each unused form's figure in its own column, the used one bold under Using (household-v4 section 3)", () => {
    const page = householdPage({
      incomes: [
        income({
          answers: plainAnswers().map((a) =>
            a.field === 'total_gross_income' ? { ...a, effective: '84000.00', corrected: true } : a
          ),
          flags: [
            {
              ...GROSS_CONFLICT,
              detail: { ...GROSS_CONFLICT.detail, resolved_by_correction: true },
            },
          ],
        }),
      ],
    })
    render(<IncomePanel page={page} />)
    const cells = within(rowOf('Gross income')).getAllByRole('cell')
    // Answer | Emma's form | Samuel's form | Using | actions
    expect(cells[1]).toHaveTextContent('$84,000')
    expect(cells[1]!.querySelector('del')).toBeNull()
    const struck = within(cells[2]!).getByText('$90,000')
    expect(struck.tagName).toBe('DEL')
    expect(struck.className).toMatch(/red/)
    expect(cells[3]).toHaveTextContent('$84,000')
    expect(cells[3]!.className).toMatch(/font-bold/)
  })

  it("puts the Use X's Form strip above the answers, once per household (round 3, section 3)", () => {
    const strip = (i: ApiAidIncome) => (
      <div data-testid="form-strip">{`strip ${String(i.household_cm_id)}`}</div>
    )
    const { unmount } = render(<IncomePanel page={FLAGGED_PAGE} formStrip={strip} />)
    expect(follows(screen.getByRole('table'), screen.getByTestId('form-strip'))).toBe(true)
    unmount()
    render(<IncomePanel page={TWO_HOUSEHOLD_PAGE} formStrip={strip} />)
    expect(screen.getAllByTestId('form-strip').map((el) => el.textContent)).toEqual([
      'strip 1000001',
      'strip 1000003',
    ])
  })

  it('folds the matching answers into "N more answers match", and opens and closes them', async () => {
    render(<IncomePanel page={FLAGGED_PAGE} />)
    expect(screen.queryByText('Housing expenses')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '12 more answers match ▸' }))
    expect(screen.getByText('Housing expenses')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show Only the Exceptions ▴' }))
    expect(screen.queryByText('Housing expenses')).toBeNull()
  })

  it('says when nothing is corrected or flagged, and that all the answers match', () => {
    render(<IncomePanel page={PLAIN_PAGE} />)
    expect(screen.getByText('No corrections and no flags.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All 14 answers match ▸' })).toBeInTheDocument()
  })

  it('puts the correct render prop on every answer shown', async () => {
    const correct = vi.fn(() => <span>Correct…</span>)
    render(<IncomePanel page={FLAGGED_PAGE} correct={correct} />)
    expect(screen.getAllByText('Correct…')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: '12 more answers match ▸' }))
    expect(screen.getAllByText('Correct…')).toHaveLength(14)
  })

  it('shows any other application flag as an amber pill, in the grid words', () => {
    render(
      <IncomePanel
        page={householdPage({ incomes: [income({ flags: [{ code: 'billing_disagrees' }] })] })}
      />
    )
    expect(screen.getByText('Billing disagrees')).toBeInTheDocument()
  })

  it('never says "no flags" beside a flag: with no exceptions it says only "No corrections."', () => {
    render(
      <IncomePanel
        page={householdPage({ incomes: [income({ flags: [{ code: 'ask_conflict' }] })] })}
      />
    )
    expect(screen.getByText('Ask conflict')).toBeInTheDocument()
    expect(screen.queryByText('No corrections and no flags.')).not.toBeInTheDocument()
    expect(screen.getByText('No corrections.')).toBeInTheDocument()
  })

  it('is the target of an "Enter the Income" link only through the card, so it carries no id', () => {
    const { container } = render(<IncomePanel page={PLAIN_PAGE} />)
    expect(container.querySelector('#income')).toBeNull()
  })

  it('says so when the household has no income form', () => {
    render(<IncomePanel page={householdPage({ incomes: [] })} />)
    expect(screen.getByText('No income form on file.')).toBeInTheDocument()
  })
})

// household-v4 section 3 (owner ruling 10-05): one right-aligned column per form, then "Using".
describe('IncomePanel: a column per form, then Using (household-v4 section 3)', () => {
  const heads = () => screen.getAllByRole('columnheader').map((th) => th.textContent)
  const HOUSING_MOST = {
    code: 'household_answer_conflict',
    detail: {
      fields: {
        total_housing_expenses: [
          { value: 30000, person_cm_ids: [1000002] },
          { value: 36000, person_cm_ids: [1000010, 1000099] },
        ],
        num_children: [
          { value: 3, person_cm_ids: [1000002] },
          { value: 2, person_cm_ids: [1000010] },
        ],
      },
      resolved_by_correction: false,
    },
  }
  const threeForms = () =>
    householdPage({
      incomes: [
        income({
          answers: plainAnswers().map((a) =>
            a.field === 'total_housing_expenses'
              ? { ...a, synced: '36000.00', effective: '36000.00' }
              : a.field === 'num_children'
                ? { ...a, synced: '3', effective: '3' }
                : a
          ),
          flags: [HOUSING_MOST],
          form_people: [{ person_cm_id: 1000099, first_name: 'Noah', last_name: 'Johnson' }],
        }),
      ],
    })

  it("heads one right-aligned column per form, then Using, with no 'On the form' or 'Used'", () => {
    render(<IncomePanel page={FLAGGED_PAGE} />)
    expect(heads()).toEqual(['Answer', "Emma's form", "Samuel's form", 'Using', '', ''])
    const [, emma, samuel, using] = screen.getAllByRole('columnheader')
    for (const th of [emma, samuel, using]) expect(th!.className).toMatch(/text-right/)
    expect(screen.queryByText('On the form')).toBeNull()
    expect(screen.queryByText('Used')).toBeNull()
  })

  it('heads a household with one form "Family\'s answer" and Using', () => {
    const page = householdPage({
      incomes: [
        income({
          answers: plainAnswers().map((a) =>
            a.field === 'total_rent'
              ? { ...a, synced: '900.00', effective: '1200', corrected: true }
              : a
          ),
          form_people: [{ person_cm_id: 1000002, first_name: 'Emma', last_name: 'Johnson' }],
        }),
      ],
    })
    render(<IncomePanel page={page} />)
    expect(heads()).toEqual(['Answer', "Family's answer", 'Using', '', ''])
    const cells = within(rowOf('Rent')).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('$900')
    expect(cells[2]).toHaveTextContent('$1,200')
  })

  it('draws three forms as three columns, a form with no figure as a dash', () => {
    render(<IncomePanel page={threeForms()} />)
    expect(heads()).toEqual([
      'Answer',
      "Emma's form",
      "Samuel's form",
      "Noah's form",
      'Using',
      '',
      '',
    ])
    const cells = within(rowOf('Children')).getAllByRole('cell')
    expect(cells.map((c) => c.textContent)).toEqual(expect.arrayContaining(['3', '2', '—']))
  })

  // Owner ruling 10-05 (the final design): per-form figures are only for the disagreeing answers.
  // Repeating the household's answer under every form would show a figure a form may not have
  // given, so an undisputed answer shows once, in a single cell across the form columns.
  it('shows an answer the forms do not dispute once, across the form columns, never per form', async () => {
    render(<IncomePanel page={threeForms()} />)
    await userEvent.click(screen.getByRole('button', { name: /more answers match/ }))
    const cells = within(rowOf('Gross income')).getAllByRole('cell')
    // Answer | one cell across the three forms | Using | note | actions
    expect(cells).toHaveLength(5)
    expect(cells[1]).toHaveAttribute('colspan', '3')
    expect(cells[1]).toHaveTextContent('$84,000')
    expect(cells[2]).toHaveTextContent('$84,000')
    expect(cells.filter((c) => c.textContent === '$84,000')).toHaveLength(2)
    // The disputed rows still draw one cell per form.
    expect(within(rowOf('Children')).getAllByRole('cell')).toHaveLength(7)
  })

  it('shows the figure most forms give under Using, saying so', () => {
    render(<IncomePanel page={threeForms()} />)
    const cells = within(rowOf('Housing expenses')).getAllByRole('cell')
    expect(cells[4]).toHaveTextContent(/^\$36,000$/)
    expect(cells[5]).toHaveTextContent('· 2 of 3 forms')
  })

  it('names the form a tie went to under Using', () => {
    render(<IncomePanel page={threeForms()} />)
    const cells = within(rowOf('Children')).getAllByRole('cell')
    expect(cells[5]).toHaveTextContent("· tie: Emma's form")
  })

  it('shows no income under Using while the income forms disagree: a dash, on hold', () => {
    const page = householdPage({
      requests: [
        householdRequest({
          ...ROW_EMMA,
          holds: [{ code: 'household_income_conflict', severity: 'hold', message: 'm' }],
          stage: { round: 2, code: 'held', label: 'R2 · On hold' },
        }),
      ],
      incomes: [
        income({
          answers: plainAnswers().map((a) =>
            a.field === 'total_gross_income' ? { ...a, synced: '', effective: '' } : a
          ),
          flags: [GROSS_CONFLICT],
        }),
      ],
    })
    render(<IncomePanel page={page} />)
    const cells = within(rowOf('Gross income')).getAllByRole('cell')
    expect(cells[3]).toHaveTextContent(/^—$/)
    expect(cells[4]).toHaveTextContent('· on hold')
    expect(
      screen.getByText(
        'The forms disagree. No income is used until one is picked, so Round 2 waits on hold.'
      )
    ).toBeInTheDocument()
  })

  it('sits the amber line tight under its own answer: the next row, no gap row', () => {
    render(<IncomePanel page={FLAGGED_PAGE} />)
    const gross = rowOf('Gross income')
    const why = screen.getByText(/^The forms disagree/).closest('tr')
    expect(gross.nextElementSibling).toBe(why)
    for (const cell of within(gross).getAllByRole('cell'))
      expect(cell.className).toMatch(/border-b-0/)
    expect(why!.querySelector('td')!.className).toMatch(/pt-0/)
    expect(why!.querySelector('td')).toHaveAttribute('colspan', '6')
  })

  it('draws no "Forms disagree" chip', () => {
    render(<IncomePanel page={threeForms()} />)
    expect(screen.queryByText(/^Forms disagree$/i)).toBeNull()
  })

  // #3025 (owner, 2026-10-05): each half's heading names its household by label beside the chip.
  it("heads each household's half with its chip and its label, the tie-break muted", () => {
    const [a, b] = TWO_HOUSEHOLD_PAGE.households
    const page = {
      ...TWO_HOUSEHOLD_PAGE,
      households: [
        { ...a!, label: 'Samuel Johnson', label_tiebreak: '' },
        { ...b!, label: 'Samuel Johnson', label_tiebreak: '#1000003' },
      ],
    }
    render(<IncomePanel page={page} />)
    const [johnson, garcia] = screen.getAllByTestId('income-household')
    expect(within(johnson!).getByText('1 · The Johnson Family')).toBeInTheDocument()
    expect(within(johnson!).getByText('Samuel Johnson')).toBeInTheDocument()
    expect(within(garcia!).getByText('2 · The Garcia Family')).toBeInTheDocument()
    expect(within(garcia!).getByText('Samuel Johnson')).toBeInTheDocument()
    expect(within(garcia!).getByText('#1000003')).toHaveClass('text-muted-foreground')
  })

  it('gives each household of two its own columns', () => {
    const page = {
      ...TWO_HOUSEHOLD_PAGE,
      incomes: [
        TWO_HOUSEHOLD_PAGE.incomes[0]!,
        { ...TWO_HOUSEHOLD_PAGE.incomes[1]!, flags: [HOUSING_MOST] },
      ],
    }
    render(<IncomePanel page={page} />)
    const [johnson, garcia] = screen.getAllByTestId('income-household')
    expect(within(johnson!).queryByRole('table')).toBeNull()
    const garciaHeads = within(garcia!)
      .getAllByRole('columnheader')
      .map((th) => th.textContent)
    expect(garciaHeads).toEqual([
      'Answer',
      "Emma's form",
      "Samuel's form",
      "person 1000099's form",
      'Using',
      '',
      '',
    ])
  })
})

// household-v5 option D, "bands" (owner pick 10-05; C rejected as too many rules): one fixed column
// grid, each disagreeing answer and its why on one rounded amber band, the note in its own slot.
describe('IncomePanel: option D, bands (household-v5)', () => {
  const correct = () => <button type="button">Correct…</button>
  const bandGaps = () => document.querySelectorAll('tr[data-band-gap]')
  // Gross income and housing both open, side by side in field order; the children corrected.
  const twoBands = () =>
    householdPage({
      incomes: [
        income({
          answers: plainAnswers().map((a) =>
            a.field === 'num_children' ? { ...a, effective: '3', corrected: true } : a
          ),
          flags: [
            GROSS_CONFLICT,
            {
              code: 'household_answer_conflict',
              detail: {
                fields: {
                  total_housing_expenses: [
                    { value: 30000, person_cm_ids: [1000002] },
                    { value: 36000, person_cm_ids: [1000010] },
                  ],
                },
                resolved_by_correction: false,
              },
            },
          ],
        }),
      ],
    })

  it("sizes one household's columns as the mock's fixed grid: Answer 190, each form 112, Using 104, note 124, actions the rest", () => {
    render(<IncomePanel page={FLAGGED_PAGE} />)
    const table = screen.getByRole('table')
    expect(table.className).toMatch(/table-fixed/)
    expect(table.className).toMatch(/w-full/)
    const widths = [...table.querySelectorAll('col')].map((col) => col.className)
    expect(widths).toEqual(['w-[190px]', 'w-[112px]', 'w-[112px]', 'w-[104px]', 'w-[124px]', ''])
  })

  it("sizes the one-form table the same way, one 112 column for the family's answer", () => {
    const page = householdPage({
      incomes: [
        income({
          answers: plainAnswers().map((a) =>
            a.field === 'total_rent'
              ? { ...a, synced: '900.00', effective: '1200', corrected: true }
              : a
          ),
        }),
      ],
    })
    render(<IncomePanel page={page} />)
    const widths = [...screen.getByRole('table').querySelectorAll('col')].map((c) => c.className)
    expect(widths).toEqual(['w-[190px]', 'w-[112px]', 'w-[104px]', 'w-[124px]', ''])
  })

  it('keeps every row one line: the note sits in its own muted slot right of the figure, never under it', () => {
    render(<IncomePanel page={twoBands()} />)
    const cells = within(rowOf('Housing expenses')).getAllByRole('cell')
    // Answer | Emma's form | Samuel's form | Using | note | actions
    expect(cells).toHaveLength(6)
    expect(cells[3]).toHaveTextContent(/^\$30,000$/)
    expect(cells[4]).toHaveTextContent("· tie: Emma's form")
    expect(cells[4]!.className).toMatch(/text-muted-foreground/)
    for (const cell of cells) expect(cell.className).toMatch(/whitespace-nowrap/)
    for (const cell of cells) expect(cell.className).not.toMatch(/align-top/)
  })

  it('puts each disagreeing answer and its why on one rounded amber band, with no rule and no edge inside it', () => {
    render(<IncomePanel page={twoBands()} />)
    const gross = rowOf('Gross income')
    const why = gross.nextElementSibling as HTMLElement
    expect(why).toHaveTextContent(/^The forms disagree/)
    for (const row of [gross, why]) expect(row.className).toMatch(/amber/)
    const cells = within(gross).getAllByRole('cell')
    expect(cells[0]!.className).toMatch(/rounded-tl-lg/)
    expect(cells.at(-1)!.className).toMatch(/rounded-tr-lg/)
    expect(why.querySelector('td')!.className).toMatch(/rounded-b-lg/)
    for (const cell of [...cells, why.querySelector('td')!]) {
      expect(cell.className).toMatch(/border-b-0/)
      expect(cell.className).not.toMatch(/inset_3px/)
    }
  })

  it('leaves a small gap before, between and after the bands: one gap between two bands, none inside one', () => {
    render(<IncomePanel page={twoBands()} />)
    const rows = [...document.querySelectorAll('tbody tr')]
    const kinds = rows.map((tr) =>
      tr.hasAttribute('data-band-gap') ? 'gap' : tr.textContent.slice(0, 8)
    )
    // In today's row order: gross (band), housing (band), children (plain).
    expect(kinds).toEqual([
      'gap',
      'Gross in',
      'The form',
      'gap',
      'Housing ',
      'The form',
      'gap',
      'Children',
    ])
    expect(bandGaps()).toHaveLength(3)
    for (const gap of bandGaps()) {
      const td = gap.querySelector('td')!
      expect(td).toHaveAttribute('colspan', '6')
      expect(td.className).toMatch(/h-1/)
      expect(td.className).toMatch(/p-0/)
      expect(td.className).not.toMatch(/border-b(?!-0)/)
    }
  })

  it('drops the rule above a band: the row before the gap has no bottom rule, the last plain row keeps one', () => {
    const page = householdPage({
      incomes: [
        income({
          answers: plainAnswers().map((a) =>
            a.field === 'total_edu_expenses'
              ? { ...a, synced: '1000.00', effective: '1500', corrected: true }
              : a.field === 'num_children'
                ? { ...a, effective: '3', corrected: true }
                : a
          ),
          flags: [
            {
              code: 'household_answer_conflict',
              detail: {
                fields: {
                  total_housing_expenses: [
                    { value: 30000, person_cm_ids: [1000002] },
                    { value: 36000, person_cm_ids: [1000010] },
                  ],
                },
                resolved_by_correction: false,
              },
            },
          ],
        }),
      ],
    })
    render(<IncomePanel page={page} />)
    for (const cell of within(rowOf('Education expenses')).getAllByRole('cell'))
      expect(cell.className).toMatch(/border-b-0/)
    for (const cell of within(rowOf('Children')).getAllByRole('cell'))
      expect(cell.className).not.toMatch(/border-b-0/)
  })

  it('puts the link first in the action cell, in a fixed slot, its pills after it', () => {
    render(<IncomePanel page={FLAGGED_PAGE} correct={correct} />)
    const actions = within(rowOf('Children')).getAllByRole('cell').at(-1)!
    const link = within(actions).getByRole('button', { name: 'Correct…' })
    const pill = within(actions).getByText('corrected')
    expect(follows(pill, link)).toBe(true)
    expect(link.parentElement!.className).toMatch(/min-w-\[136px\]/)
  })

  it('right-aligns an undisputed figure to the last form column, a faint dotted leader before it', async () => {
    render(<IncomePanel page={FLAGGED_PAGE} />)
    await userEvent.click(screen.getByRole('button', { name: /more answers match/ }))
    const span = within(rowOf('Housing expenses')).getAllByRole('cell')[1]!
    expect(span).toHaveAttribute('colspan', '2')
    expect(span.className).toMatch(/text-right/)
    expect(span.className).not.toMatch(/text-center/)
    const leader = span.querySelector('[data-leader]')
    expect(leader).not.toBeNull()
    expect(leader!.className).toMatch(/border-dotted/)
    expect(follows(within(span).getByText('$30,000'), leader!)).toBe(true)
  })

  it("gives a household's half the same bands and note slot, its columns left to fit the half", () => {
    const page = {
      ...TWO_HOUSEHOLD_PAGE,
      incomes: [
        TWO_HOUSEHOLD_PAGE.incomes[0]!,
        { ...TWO_HOUSEHOLD_PAGE.incomes[1]!, flags: [GROSS_CONFLICT] },
      ],
    }
    render(<IncomePanel page={page} />)
    const [, garcia] = screen.getAllByTestId('income-household')
    const table = within(garcia!).getByRole('table')
    expect(table.className).not.toMatch(/table-fixed/)
    expect(within(garcia!).getByText('· on hold')).toBeInTheDocument()
    expect(garcia!.querySelectorAll('tr[data-band-gap]')).toHaveLength(2)
  })
})

const follows = (later: Element, earlier: Element) =>
  (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

describe('IncomePanel, one household: no "What priced it" (round 3, section 4 (E))', () => {
  it('draws no "What priced it" card', () => {
    render(<IncomePanel page={PLAIN_PAGE} />)
    expect(screen.queryByTestId('priced')).toBeNull()
    expect(screen.queryByText('What priced it')).toBeNull()
    expect(screen.queryByText('Adjusted income (as priced)')).toBeNull()
  })

  it("opens with last year's confirmed income as one quiet line, against this year's adjusted", () => {
    render(<IncomePanel page={FLAGGED_PAGE} />)
    const line = screen.getByTestId('last-year')
    expect(line).toHaveTextContent(
      "Last year: $81,000 confirmed · this year's adjusted is 48% higher"
    )
    expect(follows(screen.getByRole('table'), line)).toBe(true)
  })

  it('says only last year when there is no adjusted income to compare', () => {
    render(
      <IncomePanel
        page={householdPage({
          requests: [householdRequest(ROW_EMMA, { receipts: [] })],
          incomes: [income()],
        })}
      />
    )
    expect(screen.getByTestId('last-year')).toHaveTextContent(/^Last year: \$81,000 confirmed$/)
  })

  it('has no last-year line without last year', () => {
    render(
      <IncomePanel
        page={householdPage({
          incomes: [
            income({
              answers: plainAnswers().map((a) =>
                a.field === 'income_confirmed' ? { ...a, synced: '', effective: '' } : a
              ),
            }),
          ],
        })}
      />
    )
    expect(screen.queryByTestId('last-year')).toBeNull()
  })

  it("puts the family's notes under the answers, each under its own name, at rest", () => {
    render(
      <IncomePanel
        page={householdPage({
          incomes: [
            income({
              notes: {
                special_circumstances: 'One parent changed jobs in January.',
                other_support_expectations: 'None this year.',
              },
            }),
          ],
        })}
      />
    )
    const heading = screen.getByText('Special financial circumstances')
    expect(heading.nextElementSibling).toHaveTextContent('One parent changed jobs in January.')
    expect(follows(heading, screen.getByRole('button', { name: 'All 14 answers match ▸' }))).toBe(
      true
    )
    expect(screen.getByText('Other support expected').nextElementSibling).toHaveTextContent(
      'None this year.'
    )
  })
})

describe('IncomePanel, two households: side by side (O9)', () => {
  it('gives each household its chip, its own last-year line and its own exceptions', () => {
    render(<IncomePanel page={TWO_HOUSEHOLD_PAGE} />)
    const halves = screen.getAllByTestId('income-household')
    expect(halves).toHaveLength(2)
    expect(within(halves[0]!).getByText('1 · The Johnson Family')).toBeInTheDocument()
    expect(within(halves[0]!).getByTestId('last-year')).toHaveTextContent(
      "Last year: $81,000 confirmed · this year's adjusted is 48% higher"
    )
    expect(halves[0]).not.toHaveTextContent('Adjusted $120,000')
    expect(within(halves[1]!).getByText('2 · The Garcia Family')).toBeInTheDocument()
    expect(within(halves[1]!).getByTestId('last-year')).toBeInTheDocument()
    expect(within(halves[1]!).getByText('No corrections and no flags.')).toBeInTheDocument()
    expect(screen.queryByTestId('priced')).toBeNull()
  })

  it("shows each household's notes under its own answers, at rest", () => {
    render(<IncomePanel page={TWO_HOUSEHOLD_PAGE} />)
    const [johnson, garcia] = screen.getAllByTestId('income-household')
    expect(within(garcia!).getByText('Shared custody, week on, week off.')).toBeInTheDocument()
    expect(within(johnson!).getByText('One parent changed jobs in January.')).toBeInTheDocument()
  })
})

describe('GrantsPostingsPanel (§6.3 item 6; D30, D31, D56, D74, D127)', () => {
  it('lists the Expected chip first, then the grants and the postings under their eyebrows', () => {
    render(<GrantsPostingsPanel page={PAGE} programNames={{}} />)
    expect(screen.getByText('Expected: synagogue grant · Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('Grants')).toBeInTheDocument()
    expect(screen.getByText('Postings')).toBeInTheDocument()
    expect(
      within(screen.getByRole('table', { name: 'Grants' })).getByText('Grantor A')
    ).toBeInTheDocument()
    const postings = within(screen.getByRole('table', { name: 'Postings' }))
    expect(postings.getByText('reversed Mar 20')).toBeInTheDocument()
    expect(postings.getByText('$1,800').tagName).toBe('S')
    expect(postings.getByText('$1,590')).toBeInTheDocument()
  })

  it('names the program as the rules do, and words the source in sentence case (D31)', () => {
    render(<GrantsPostingsPanel page={PAGE} programNames={{ summer: 'Summer Camp' }} />)
    const postings = within(screen.getByRole('table', { name: 'Postings' }))
    expect(postings.getAllByText('Summer Camp')).toHaveLength(2)
    expect(postings.getAllByText('Camp aid')).toHaveLength(2)
  })

  it('title-cases a program the rules do not name', () => {
    render(<GrantsPostingsPanel page={PAGE} programNames={{}} />)
    expect(
      within(screen.getByRole('table', { name: 'Postings' })).getAllByText('Summer')
    ).toHaveLength(2)
  })

  it('marks a grant that is cancelled, and one the band does not count', () => {
    const grant = PAGE.grants[0]!
    render(
      <GrantsPostingsPanel
        programNames={{}}
        page={householdPage({
          grants: [
            { ...grant, transaction_cm_id: 1000311, in_band: false },
            { ...grant, transaction_cm_id: 1000312, cancelled: true, in_band: false },
          ],
        })}
      />
    )
    expect(screen.getByText('not counted')).toBeInTheDocument()
    expect(screen.getByText('cancelled')).toBeInTheDocument()
  })

  // The mark follows the server's per-grant in_band flag alone; the page does not re-derive the band's rule.
  it('puts no mark on a grant the server says is in the band', () => {
    render(<GrantsPostingsPanel page={PAGE} programNames={{}} />)
    const grants = screen.getByRole('table', { name: 'Grants' })
    expect(within(grants).queryByText('not counted')).toBeNull()
    expect(within(grants).queryByText('cancelled')).toBeNull()
  })

  it('trusts in_band true even where the old derived rule (outside funder only) would have marked it', () => {
    const grant = PAGE.grants[0]!
    render(
      <GrantsPostingsPanel
        programNames={{}}
        page={householdPage({ grants: [{ ...grant, funder_type: 'other', in_band: true }] })}
      />
    )
    expect(screen.queryByText('not counted')).toBeNull()
  })

  it.each([
    ['household', 1000002, 'the household'],
    ['none', 0, 'needs a camper'],
  ] as const)('names an unplaced grant line (basis %s, person %s) "%s"', (basis, person, words) => {
    const grant = PAGE.grants[0]!
    render(
      <GrantsPostingsPanel
        programNames={{}}
        page={householdPage({
          grants: [{ ...grant, camper_basis: basis, person_cm_id: person, camper_name: '' }],
        })}
      />
    )
    expect(
      within(screen.getByRole('table', { name: 'Grants' })).getByText(words)
    ).toBeInTheDocument()
  })

  it('says when there are no grants and no postings', () => {
    render(
      <GrantsPostingsPanel page={householdPage({ grants: [], postings: [] })} programNames={{}} />
    )
    expect(screen.getByText('No outside grants.')).toBeInTheDocument()
    expect(screen.getByText('No CampMinder aid postings this season.')).toBeInTheDocument()
  })
})

describe('LinksPanel (§6.3 †; Decision 27; owner 10-04: links read as families)', () => {
  const link: ApiAidHouseholdPageLink = TWO_HOUSEHOLD_PAGE.links[0]!

  it("reads a link as today's words while the page carries no family details", () => {
    render(<LinksPanel page={TWO_HOUSEHOLD_PAGE} />)
    expect(
      screen.getByText('household 1000004 · staff · excluded · Grandparent address, not a payer')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('falls back to the words when the family name is blank, even if adults and city came', () => {
    render(
      <LinksPanel
        page={{
          ...TWO_HOUSEHOLD_PAGE,
          links: [{ ...link, family_name: '', adults: ['Ava Lee'], city: 'Riverside, CA' }],
        }}
      />
    )
    expect(screen.getByRole('listitem').textContent).toBe(
      'household 1000004 · staff · excluded · Grandparent address, not a payer'
    )
  })

  it('reads a link as a family once the page carries its name, adults and city (#3004)', () => {
    render(
      <LinksPanel
        page={{
          ...TWO_HOUSEHOLD_PAGE,
          links: [
            {
              ...link,
              family_name: 'The Lee Family',
              adults: ['Ava Lee', 'Noah Lee'],
              city: 'Riverside, CA',
            },
          ],
        }}
      />
    )
    const line = screen.getByRole('listitem')
    expect(line).toHaveTextContent(
      'The Lee Family · Ava Lee, Noah Lee · Riverside, CA · household 1000004 · staff · excluded · Grandparent address, not a payer'
    )
  })
})

describe('LinksPanel: #3025 labels (owner, 2026-10-05)', () => {
  const link: ApiAidHouseholdPageLink = TWO_HOUSEHOLD_PAGE.links[0]!

  it('reads a link by its label in bold, the tie-break muted, then its city and the link', () => {
    render(
      <LinksPanel
        page={{
          ...TWO_HOUSEHOLD_PAGE,
          links: [
            {
              ...link,
              family_name: 'The Lee Family',
              adults: ['Ava Lee', 'Noah Lee'],
              city: 'Riverside, CA',
              label: 'Ava & Noah Lee',
              label_tiebreak: '#1000004',
            },
          ],
        }}
      />
    )
    expect(screen.getByText('Ava & Noah Lee')).toHaveClass('font-bold')
    expect(screen.getByText('#1000004')).toHaveClass('text-muted-foreground')
    expect(screen.getByRole('listitem')).toHaveTextContent(
      'Ava & Noah Lee #1000004 · Riverside, CA · household 1000004 · staff · excluded · Grandparent address, not a payer'
    )
  })

  it('says the city once when it is the tie-break', () => {
    render(
      <LinksPanel
        page={{
          ...TWO_HOUSEHOLD_PAGE,
          links: [
            {
              ...link,
              family_name: 'The Lee Family',
              city: 'Riverside, CA',
              label: 'Ava & Noah Lee',
              label_tiebreak: 'Riverside, CA',
            },
          ],
        }}
      />
    )
    expect(screen.getByRole('listitem')).toHaveTextContent(
      'Ava & Noah Lee Riverside, CA · household 1000004 · staff · excluded · Grandparent address, not a payer'
    )
  })
})

describe('HistoryPanel (§6.3 item 7; O4; N10)', () => {
  it("words the family's own log, oldest first, with no record ids or emails on screen", () => {
    const { container } = render(<HistoryPanel page={HISTORY_PAGE} />)
    expect(screen.getByText('oldest first')).toBeInTheDocument()
    const lines = screen.getAllByTestId('history-line')
    expect(lines).toHaveLength(6)
    expect(lines[0]).toHaveTextContent("Intake added the family's form · Feb 2")
    expect(lines[2]).toHaveTextContent(
      'Test corrected expected gross income, $90,000 → $84,200 · Feb 9“Pay stub shows the new salary”'
    )
    expect(lines[4]).toHaveTextContent(
      "Matched in CampMinder · Emma's Round 1 posted at $1,420 · Mar 10"
    )
    expect(container.textContent).not.toMatch(/@|reqsamuel|op000|aid_/)
  })

  it('says so when nothing is recorded', () => {
    render(<HistoryPanel page={householdPage({ history: [] })} />)
    expect(screen.getByText('Nothing recorded yet.')).toBeInTheDocument()
  })

  it('does not repeat a key for two entries of one operation and record', () => {
    const entry = PAGE.history[0]!
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <HistoryPanel
        page={householdPage({ history: [entry, { ...entry, entity: 'aid_other' }, { ...entry }] })}
      />
    )
    expect(spy.mock.calls.filter((c) => String(c[0]).includes('same key'))).toHaveLength(0)
    spy.mockRestore()
  })
})
