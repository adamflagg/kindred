import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ApiAidHouseholdPageLink } from '../../../types/api-types'
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
  it('lists only the corrected and flagged answers, each as sent and as used', () => {
    render(<IncomePanel page={FLAGGED_PAGE} />)
    const children = rowOf('Children')
    expect(within(children).getByText('2')).toBeInTheDocument()
    expect(within(children).getByText('3')).toBeInTheDocument()
    expect(within(children).getByText('corrected')).toBeInTheDocument()
    expect(screen.getByText('Gross income')).toBeInTheDocument()
    expect(screen.queryByText('Housing expenses')).toBeNull()
  })

  it("puts a flagged answer's why under it, in the server's figures, tinted amber", () => {
    render(<IncomePanel page={FLAGGED_PAGE} />)
    const why = screen.getByText("Emma's form says $84,000; Samuel's says $90,000.")
    expect(why.closest('tr')?.className).toMatch(/amber/)
    expect(rowOf('Gross income').className).toMatch(/amber/)
  })

  it('leaves a resolved conflict untinted, its why muted and saying what settled it', () => {
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
    expect(rowOf('Gross income').className).not.toMatch(/amber/)
    const why = screen.getByText(/The correction settles it\.$/)
    expect(why.closest('tr')?.className).not.toMatch(/amber/)
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
