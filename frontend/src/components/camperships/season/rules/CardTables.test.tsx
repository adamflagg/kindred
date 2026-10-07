import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { ApiAidValidationIssue } from '../../../../types/api-types'
import { CardTables } from './CardTables'
import type { RulesNames } from './rulesModel'

const NAMES: RulesNames = {
  section: 'equity',
  pools: { pool_a: 'Pool A', pool_b: 'Pool B' },
  programs: { summer: 'Summer', weekend: 'Weekend' },
  decisionTypes: {},
  criteria: {},
  sessions: new Map([
    [1000101, 'Session 1'],
    [1000102, 'Session 2'],
    [1000201, 'Weekend A'],
  ]),
}

const EQUITY = {
  criteria: [
    {
      key: 'first_gen',
      label: 'First generation',
      source: 'camper',
      field: 'first_gen',
      also_fields: ['first_gen_other'],
      match: 'equals_any',
      values: ['yes'],
      min_value: null,
      enabled: true,
    },
    {
      key: 'pronouns',
      label: 'Pronouns',
      source: 'camper',
      field: 'pronouns',
      also_fields: [],
      match: 'contains_any',
      values: ['they', 'non-binary'],
      min_value: null,
      enabled: false,
    },
    {
      key: 'dependents',
      label: 'Dependents at or above 3',
      source: 'household',
      field: 'dependents',
      also_fields: [],
      match: 'at_least',
      values: [],
      min_value: '3',
      enabled: true,
    },
  ],
  weights: {
    summer: { first_gen: '0.5', pronouns: '0.5', dependents: '1' },
    family: { first_gen: '0', pronouns: '0', dependents: '0' },
  },
  aggregation: 'ceil',
  max_shift: null,
}

const AWARDS = {
  minimum: '150',
  decision_types: {
    appeal_top_up: {
      label: 'Appeal top-up',
      kind: 'top_up',
      round: 2,
      amount: '300',
      extra_amount: '0',
      allows_appeal: true,
      counts_toward_budget: true,
    },
    full_cost_program: {
      label: 'Full-cost program',
      kind: 'full_cost',
      round: 1,
      amount: null,
      extra_amount: '75',
      allows_appeal: true,
      counts_toward_budget: true,
    },
    named_full_cost_fund: {
      label: 'Named full-cost fund',
      kind: 'full_cost_after_aid',
      round: 1,
      amount: null,
      extra_amount: '0',
      allows_appeal: false,
      counts_toward_budget: false,
    },
  },
}

const PROGRAMS = {
  // Its class is `camp`, not `summer`, so the row's name and its class word ("Camp") differ: getByText finds one cell.
  summer: {
    label: 'Summer',
    session_cm_ids: [1000101, 1000102],
    session_types: [],
    equity_class: 'camp',
    budget_pool: 'pool_a',
    cost_source: 'catalog',
    open_to_aid: true,
  },
  weekend: {
    label: 'Weekend',
    session_cm_ids: [1000201],
    session_types: [],
    equity_class: null,
    budget_pool: null,
    cost_source: 'per_person',
    open_to_aid: true,
  },
}
const PROGRAM_ISSUES: ApiAidValidationIssue[] = [
  {
    section: 'programs',
    code: 'unclassified_program',
    severity: 'warning',
    path: 'programs.weekend.budget_pool',
    message: 'Open to aid but in no budget pool',
  },
  {
    section: 'programs',
    code: 'no_equity_class',
    severity: 'warning',
    path: 'programs.weekend.equity_class',
    message: 'Open to aid but no equity class, so no award table: its requests hold',
  },
]

const CHECKS = {
  checks: {
    income_above: { enabled: true, severity: 'hold', threshold: '250000' },
    placeholder_income: { enabled: false, severity: 'warn', threshold: null },
  },
}

const COST = {
  tuition: { '1000101': '2000', '1000102': '4000' },
  family_rates: [{ session_cm_id: 1000201, standard: '600', infant: '300' }],
  infant_age_cutoff_months: 24,
  override_reasons: ['headcount'],
}

type Props = Parameters<typeof CardTables>[0]
function tables(over: Partial<Props> & Pick<Props, 'section' | 'content'>) {
  // MemoryRouter: the named fund's "Managed in Grants ›" is a router Link.
  return render(
    <MemoryRouter>
      <CardTables
        approved={null}
        names={NAMES}
        details={false}
        issues={[]}
        dependentsMode="income_reduction"
        {...over}
      />
    </MemoryRouter>
  )
}
const heads = (table: HTMLElement) =>
  within(table)
    .getAllByRole('columnheader')
    .map((h) => h.textContent)
const rowOf = (table: HTMLElement, label: string) =>
  within(table).getByText(label).closest('tr') as HTMLElement

describe('the equity table (spec §6.2 E.3)', () => {
  it('heads Criterion · Enabled · Weight, by equity class⁷ (one column per class) · Counts when (read-only)', () => {
    tables({ section: 'equity', content: EQUITY })
    expect(heads(screen.getByTestId('equity-table'))).toEqual([
      'Criterion',
      'Enabled',
      'Weight, by equity class7',
      'Counts whenread-only',
      'Summer',
      'Family',
    ])
  })

  it('greys a criterion that is not enabled and keeps its weights', () => {
    tables({ section: 'equity', content: EQUITY })
    const off = rowOf(screen.getByTestId('equity-table'), 'Pronouns')
    expect(off).toHaveClass('opacity-50')
    expect(within(off).getByText('—')).toBeInTheDocument() // Enabled: not checked
    expect(within(off).getAllByText('0.5')).toHaveLength(1)
    expect(rowOf(screen.getByTestId('equity-table'), 'First generation')).not.toHaveClass(
      'opacity-50'
    )
  })

  it('reads Counts when as words and chips, or "at least n"', () => {
    tables({ section: 'equity', content: EQUITY })
    const table = screen.getByTestId('equity-table')
    const pronouns = rowOf(table, 'Pronouns')
    expect(within(pronouns).getByText('they')).toHaveClass('bg-muted')
    expect(within(pronouns).getByText('non-binary')).toBeInTheDocument()
    expect(rowOf(table, 'Dependents at or above 3')).toHaveTextContent('at least 3')
  })

  it('notes the Dependents row is not used unless Dependents moves the tier', () => {
    tables({ section: 'equity', content: EQUITY })
    expect(screen.getByText('not used: dependents lower the income')).toBeInTheDocument()
  })

  it('drops the note when Dependents moves the tier', () => {
    tables({ section: 'equity', content: EQUITY, dependentsMode: 'tier_shift' })
    expect(screen.queryByText('not used: dependents lower the income')).toBeNull()
  })

  it('says "was checked" beside a box the draft unchecked', () => {
    const approved = { ...EQUITY, criteria: EQUITY.criteria.map((c) => ({ ...c, enabled: true })) }
    tables({ section: 'equity', content: EQUITY, approved })
    expect(
      within(rowOf(screen.getByTestId('equity-table'), 'Pronouns')).getByText('was checked')
    ).toBeInTheDocument()
  })

  it('puts a box in Enabled and every weight in the editor, never in Counts when', () => {
    const control = vi.fn((path: readonly string[]) => <input aria-label={path.join('.')} />)
    tables({ section: 'equity', content: EQUITY, control })
    expect(screen.getByLabelText('criteria.1.enabled')).toBeInTheDocument()
    expect(screen.getByLabelText('weights.family.dependents')).toBeInTheDocument()
    expect(control.mock.calls.map(([path]) => path[0])).toEqual(
      expect.not.arrayContaining(['match', 'values'])
    )
    expect(control).toHaveBeenCalledTimes(3 + 3 * 2) // three Enabled boxes, three criteria × two classes
  })
})

describe('the named awards table (spec §6.2 E.4)', () => {
  it('heads its columns with the read-only ones captioned, under "Named awards⁵" and its description', () => {
    tables({ section: 'awards', content: AWARDS })
    const table = screen.getByTestId('named-awards-table')
    expect(heads(table)).toEqual([
      'Award',
      'Kindread-only',
      'Roundread-only',
      'Amount',
      'Extra amount',
      'Allows an appealread-only',
      'Counts toward the budgetread-only',
    ])
    expect(screen.getByText('Named awards').parentElement).toHaveTextContent(
      'Named awards5Kinds of decision with their own line in the budget, in any round.'
    )
  })

  it('shows Amount on a fixed top-up and Extra amount on full cost only, "—" elsewhere', () => {
    tables({ section: 'awards', content: AWARDS })
    const table = screen.getByTestId('named-awards-table')
    expect(rowOf(table, 'Appeal top-up')).toHaveTextContent('Appeal top-upFixed top-up2$300—✓✓')
    expect(rowOf(table, 'Full-cost program')).toHaveTextContent('Full-cost programFull cost1—$75✓✓')
  })

  it("derives the named fund's row note from its kind, in generic words", () => {
    tables({ section: 'awards', content: AWARDS })
    const fund = rowOf(screen.getByTestId('named-awards-table'), 'Named full-cost fund')
    expect(
      within(fund).getByText(
        'Pays the rest after the camp award and outside grants, outside the budget; no extra amount.'
      )
    ).toBeInTheDocument()
    expect(fund).toHaveTextContent('Full cost after camp aid1——')
  })

  it('offers a box for Amount on a top-up and Extra amount on full cost, nowhere else', () => {
    const control = vi.fn((path: readonly string[]) => <input aria-label={path.join('.')} />)
    tables({ section: 'awards', content: AWARDS, control })
    expect(control.mock.calls.map(([path]) => path.join('.'))).toEqual([
      'decision_types.appeal_top_up.amount',
      'decision_types.full_cost_program.extra_amount',
    ])
  })

  it('shows the named fund read-only, even in the editor, with "Managed in Grants ›" to Grants › Grantors (owner 10-06)', () => {
    const control = vi.fn((path: readonly string[]) => <input aria-label={path.join('.')} />)
    tables({
      section: 'awards',
      content: AWARDS,
      control,
      grantsHref: '/aid/grants/grantors?year=2027',
    })
    const table = screen.getByTestId('named-awards-table')
    const fund = rowOf(table, 'Named full-cost fund')
    expect(within(fund).getByRole('link', { name: 'Managed in Grants ›' })).toHaveAttribute(
      'href',
      '/aid/grants/grantors?year=2027'
    )
    expect(within(fund).queryByRole('textbox')).toBeNull()
    expect(within(rowOf(table, 'Full-cost program')).queryByRole('link')).toBeNull()
  })
})

describe('the programs table (spec §6.2 E.8)', () => {
  it('heads Program · Sessions · Equity class⁷ and award table · Budget pool · Cost from (read-only) · Open to aid, no Round 1 table', () => {
    tables({ section: 'programs', content: PROGRAMS })
    expect(heads(screen.getByTestId('programs-table'))).toEqual([
      'Program',
      'Sessions',
      'Equity class7and award table',
      'Budget pool',
      'Cost fromread-only',
      'Open to aid',
    ])
    expect(screen.queryByText(/Round 1 table/)).toBeNull()
  })

  it('reads sessions as chips by name, and the class and pool by their words', () => {
    tables({ section: 'programs', content: PROGRAMS })
    const summer = rowOf(screen.getByTestId('programs-table'), 'Summer')
    expect(within(summer).getByText('Session 1')).toHaveClass('bg-muted')
    expect(within(summer).getByText('Session 2')).toBeInTheDocument()
    expect(summer).toHaveTextContent('Camp')
    expect(summer).toHaveTextContent('Pool A')
    expect(summer).toHaveTextContent('Session price')
  })

  it('carries "no pool" and "no equity class" pills on a program with those issues, and None in its cells', () => {
    tables({ section: 'programs', content: PROGRAMS, issues: PROGRAM_ISSUES })
    const weekend = rowOf(screen.getByTestId('programs-table'), 'Weekend')
    expect(within(weekend).getByText('no pool')).toHaveClass('bg-amber-100')
    expect(within(weekend).getByText('no equity class')).toHaveClass('bg-amber-100')
    expect(within(weekend).getAllByText('None')).toHaveLength(2)
  })
  it('leaves out a program that claims no sessions when read, and keeps it in the editor (lead ruling)', () => {
    const content = {
      ...PROGRAMS,
      idle: { ...PROGRAMS.weekend, label: 'Idle program', session_cm_ids: [] },
    }
    const { unmount } = tables({ section: 'programs', content })
    expect(within(screen.getByTestId('programs-table')).queryByText('Idle program')).toBeNull()
    expect(within(screen.getByTestId('programs-table')).getByText('Summer')).toBeInTheDocument()
    unmount()
    const control = vi.fn((path: readonly string[]) => <input aria-label={path.join('.')} />)
    tables({ section: 'programs', content, control })
    expect(
      within(screen.getByTestId('programs-table')).getByText('Idle program')
    ).toBeInTheDocument()
  })

  it('wraps the Sessions cell, its pills in a flex-wrap row, and the program name, so the table fits at 1100', () => {
    tables({ section: 'programs', content: PROGRAMS })
    const summer = rowOf(screen.getByTestId('programs-table'), 'Summer')
    const [name, sessions] = within(summer).getAllByRole('cell')
    expect(sessions).toHaveClass('whitespace-normal')
    expect(sessions).not.toHaveClass('whitespace-nowrap')
    expect(within(summer).getByText('Session 1').parentElement).toHaveClass(
      'inline-flex',
      'flex-wrap'
    )
    expect(name).toHaveClass('whitespace-normal')
    expect(name).not.toHaveClass('whitespace-nowrap')
  })

  it('wraps the program name in the editor too', () => {
    const control = vi.fn((path: readonly string[]) => <input aria-label={path.join('.')} />)
    tables({ section: 'programs', content: PROGRAMS, control })
    const [name, sessions] = within(
      rowOf(screen.getByTestId('programs-table'), 'Summer')
    ).getAllByRole('cell')
    expect(name).toHaveClass('whitespace-normal')
    expect(sessions).toHaveClass('whitespace-normal')
  })
})

describe('the checks table (spec §6.2 E.7)', () => {
  it('reads Check · On · Hold or warn · Above in the grid words', () => {
    tables({ section: 'quality_checks', content: CHECKS })
    const table = screen.getByTestId('checks-table')
    expect(heads(table)).toEqual(['Check', 'On', 'Hold or warn', 'Above'])
    expect(rowOf(table, 'High income')).toHaveTextContent('High income✓Hold$250,000')
    expect(rowOf(table, 'Placeholder income')).toHaveTextContent('Placeholder income—Warning—')
  })
})

describe('the cost tables (spec §6.2 E.9)', () => {
  it('shows tuition by session beside the Family Camp rates, with no child column', () => {
    tables({ section: 'cost', content: COST })
    const tuition = screen.getByTestId('tuition-table')
    expect(heads(tuition)).toEqual(['Session', 'Tuition'])
    expect(rowOf(tuition, 'Session 1')).toHaveTextContent('Session 1$2,000')
    const rates = screen.getByTestId('family-rates-table')
    expect(heads(rates)).toEqual(['Session', 'Standard', 'Infant'])
    expect(rowOf(rates, 'Weekend A')).toHaveTextContent('Weekend A$600$300')
    expect(screen.getByText('Everyone but infants pays the standard rate.')).toBeInTheDocument()
    expect(screen.queryByText(/Child/)).toBeNull()
  })
})
