import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

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

const CHECKS = {
  checks: {
    income_above: { enabled: true, severity: 'hold', threshold: '250000' },
    placeholder_income: { enabled: false, severity: 'warn', threshold: null },
  },
}

type Props = Parameters<typeof CardTables>[0]
function tables(over: Partial<Props> & Pick<Props, 'section' | 'content'>) {
  // MemoryRouter: the named fund's "Funder's terms in Money › Funders ›" is a router Link.
  return render(
    <MemoryRouter>
      <CardTables
        approved={null}
        names={NAMES}
        details={false}
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
  it('heads Criterion · Enabled · Weight, by equity class⁶ (one column per class) · Counts when (read-only)', () => {
    tables({ section: 'equity', content: EQUITY })
    expect(heads(screen.getByTestId('equity-table'))).toEqual([
      'Criterion',
      'Enabled',
      'Weight, by equity class6',
      'Counts whenread-only',
      'Summer',
      'Family',
    ])
  })

  it("orders the weight columns by the rules' pool order, not the key order the weights are stored in", () => {
    const stored = {
      ...EQUITY,
      weights: { family: EQUITY.weights.family, summer: EQUITY.weights.summer },
    }
    tables({
      section: 'equity',
      content: stored,
      groups: [
        { pool: 'pool_a', label: 'Pool A', equity_class: 'summer' },
        { pool: 'pool_b', label: 'Pool B', equity_class: 'family' },
      ],
    })
    expect(heads(screen.getByTestId('equity-table')).slice(-2)).toEqual(['Summer', 'Family'])
  })

  // Design language §8 and the mock's `.cf-rcard table`: a card-white table card, a light rule on every column.
  it('draws the kit grid: a card-white table card, a rule on every column, 14px cells', () => {
    tables({ section: 'equity', content: EQUITY })
    const table = screen.getByTestId('equity-table')
    expect(table.parentElement).toHaveClass('bg-card', 'rounded-xl', 'border')
    expect(table).toHaveClass('text-sm')
    const cell = within(table).getByText('Dependents at or above 3').closest('td') as HTMLElement
    expect(cell.className).toContain('border-l-[color-mix')
    expect(cell).toHaveClass('first:border-l-0')
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

  it('shows the named fund read-only, even in the editor, with "Funder\'s terms in Money › Funders ›" (coordinator 10-08)', () => {
    const control = vi.fn((path: readonly string[]) => <input aria-label={path.join('.')} />)
    tables({
      section: 'awards',
      content: AWARDS,
      control,
      grantsHref: '/aid/money/funders?year=2027',
    })
    const table = screen.getByTestId('named-awards-table')
    const fund = rowOf(table, 'Named full-cost fund')
    expect(
      within(fund).getByRole('link', { name: "Funder's terms in Money › Funders ›" })
    ).toHaveAttribute('href', '/aid/money/funders?year=2027')
    expect(within(fund).queryByRole('textbox')).toBeNull()
    expect(within(rowOf(table, 'Full-cost program')).queryByRole('link')).toBeNull()
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

// final-v2/season-rules.html wraps only the equity and checks tables in fit() (.cf-fit: inline-block, table width auto);
// the tier grid and the named awards span the card.
describe('table width (final mock fit())', () => {
  it('draws the equity table at its content width', () => {
    tables({ section: 'equity', content: EQUITY })
    const equity = screen.getByTestId('equity-table')
    expect(equity).toHaveClass('w-auto')
    expect(equity.parentElement).toHaveClass('inline-block', 'max-w-full')
  })

  it('draws the checks table at its content width', () => {
    tables({ section: 'quality_checks', content: CHECKS })
    const checks = screen.getByTestId('checks-table')
    expect(checks).toHaveClass('w-auto')
    expect(checks.parentElement).toHaveClass('inline-block', 'max-w-full')
  })
})
