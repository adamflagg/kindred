import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { AidView } from '../kit/asOf'
import { BudgetCard } from './BudgetCard'
import { BUDGET, overBudget, poolOverShare } from './budgetFixtures'
import { poolCards } from './budgetCards'
import { PoolCard } from './PoolCard'

const LIVE: AidView = { year: 2027, asOf: { kind: 'live' } }
const N = (key: string) =>
  ({
    allocated: 1,
    budget_posted: 2,
    accepted: 3,
    needs_offer: 4,
    pending_approval: 5,
    remaining: 6,
    below_the_line: 7,
    share: 11,
    committed: 12,
    past_date: 13,
  })[key] ?? null

function budgetCard(over: Partial<Parameters<typeof BudgetCard>[0]> = {}) {
  return render(
    <MemoryRouter>
      <BudgetCard
        budget={BUDGET}
        view={LIVE}
        open={new Set()}
        onToggle={vi.fn()}
        numberOf={N}
        preview={null}
        editing={false}
        draftPill={null}
        canPlan
        onEditPlan={vi.fn()}
        {...over}
      />
    </MemoryRouter>
  )
}

describe('the Budget card (spec §5.2 A)', () => {
  it('leads with Budget, 2027, the rules version, and Allocated (a link) · Committed · Remaining (bold)', () => {
    budgetCard()
    const card = screen.getByTestId('budget-card')
    expect(within(card).getByRole('button', { name: /Budget, 2027/ })).toBeInTheDocument()
    expect(within(card).getByText('rules v3')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: '$1,000,000' })).toHaveAttribute(
      'href',
      '/aid/season/rules?version=3&section=budget&year=2027'
    )
    expect(within(card).getByText('$848,710').closest('b')).toBeNull() // Committed: 834,140 + 13,920 + 650
    expect(within(card).getByTestId('budget-remaining').querySelector('b')).not.toBeNull()
  })

  it('reads the total below $0 as a red minus with a red "over budget" pill', () => {
    budgetCard({ budget: overBudget() })
    const remaining = screen.getByTestId('budget-remaining')
    expect(within(remaining).getByText('−$8,366')).toHaveClass('text-red-700')
    expect(within(remaining).getByText('over budget')).toHaveClass('bg-red-100')
  })

  it('with no approved rules: no fold, no bar, no Edit Plan…, "—" for Allocated and Remaining, the amber pill', () => {
    budgetCard({
      budget: {
        ...BUDGET,
        rules_version: null,
        total: {
          ...BUDGET.total,
          total: { ...BUDGET.total.total, allocated: null, remaining: null },
        },
      },
      canPlan: false,
    })
    expect(screen.queryByRole('button', { name: /Budget, 2027/ })).toBeNull()
    expect(screen.getByText('no approved rules: nothing allocated yet')).toBeInTheDocument()
    expect(screen.queryByTestId('budget-bar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit Plan…' })).toBeNull()
  })

  it('on a past date says "past date: exact figures only" with its note number', () => {
    budgetCard({
      view: { year: 2027, asOf: { kind: 'past', date: '2027-03-15', axis: 'campminder' } },
      canPlan: false,
    })
    expect(screen.getByText(/past date: exact figures only/)).toHaveTextContent('13')
  })

  it('marks the preview and every moved figure while Edit Plan… is open', () => {
    budgetCard({
      editing: true,
      preview: { pools: {}, total: { allocated: 1010000, remaining: 175140 } },
    })
    expect(screen.getByText('preview')).toBeInTheDocument()
    expect(screen.getByText('$1,010,000')).toHaveAttribute('data-moved')
  })

  it('opens the season-wide rounds table from its title', async () => {
    const onToggle = vi.fn()
    budgetCard({ onToggle })
    await userEvent.click(screen.getByRole('button', { name: /Budget, 2027/ }))
    expect(onToggle).toHaveBeenCalledWith('budget')
  })
})

describe('a pool card (spec §5.2 C; §8.3)', () => {
  it('reads a pool past its share in amber with "over its share" and, for finance live, an Edit Plan… nudge', async () => {
    const budget = poolOverShare()
    const [, b] = poolCards(budget, null)
    const onEditPlan = vi.fn()
    render(
      <MemoryRouter>
        <PoolCard
          card={b!}
          budget={budget}
          view={LIVE}
          open={new Set()}
          onToggle={vi.fn()}
          numberOf={N}
          preview={null}
          editing={false}
          canPlan
          onEditPlan={onEditPlan}
          scopedPills={null}
        />
      </MemoryRouter>
    )
    const remaining = screen.getByTestId('pool-remaining')
    expect(within(remaining).getByText('−$1,200')).toHaveClass('text-amber-700')
    expect(within(remaining).getByText('over its share')).toHaveClass('bg-amber-100')
    await userEvent.click(within(remaining).getByRole('button', { name: 'Edit Plan…' }))
    expect(onEditPlan).toHaveBeenCalled()
  })

  it('draws its bar from the typed plan while Edit Plan… is open (spec §5.2 B)', () => {
    const budget = poolOverShare() // pool_b: Allocated $100,000, Committed $101,200
    const [, b] = poolCards(budget, null)
    const props = {
      card: b!,
      budget,
      view: LIVE,
      open: new Set<string>(),
      onToggle: vi.fn(),
      numberOf: N,
      canPlan: true,
      onEditPlan: vi.fn(),
      scopedPills: null,
    }
    const { unmount } = render(
      <MemoryRouter>
        <PoolCard {...props} preview={null} editing={false} />
      </MemoryRouter>
    )
    expect(
      within(screen.getByTestId('pool-bar-pool_b')).getByTestId('pool-bar-over')
    ).toBeInTheDocument()
    unmount()
    // The typed plan gives Pool B $110,000: $8,800 left, so the bar has no overage marker.
    const preview = {
      pools: { pool_b: { allocated: 110000, remaining: 8800 } },
      total: { allocated: 1000000, remaining: 0 },
    }
    render(
      <MemoryRouter>
        <PoolCard {...props} preview={preview} editing />
      </MemoryRouter>
    )
    expect(within(screen.getByTestId('pool-bar-pool_b')).queryByTestId('pool-bar-over')).toBeNull()
    expect(within(screen.getByTestId('pool-remaining')).getByText('$8,800')).toBeInTheDocument()
  })

  it('legends each round committed, or says nothing committed yet', () => {
    const [a] = poolCards(BUDGET, null)
    render(
      <MemoryRouter>
        <PoolCard
          card={{ ...a!, parts: [] }}
          budget={BUDGET}
          view={LIVE}
          open={new Set()}
          onToggle={vi.fn()}
          numberOf={N}
          preview={null}
          editing={false}
          canPlan={false}
          onEditPlan={vi.fn()}
          scopedPills={null}
        />
      </MemoryRouter>
    )
    expect(screen.getByText('nothing committed yet')).toBeInTheDocument()
  })

  it('folds open to its rounds table: Round · Committed · What is committed, no per-round Remaining', () => {
    const [a] = poolCards(BUDGET, null)
    render(
      <MemoryRouter>
        <PoolCard
          card={a!}
          budget={BUDGET}
          view={LIVE}
          open={new Set(['pool_a'])}
          onToggle={vi.fn()}
          numberOf={N}
          preview={null}
          editing={false}
          canPlan={false}
          onEditPlan={vi.fn()}
          scopedPills={null}
        />
      </MemoryRouter>
    )
    const table = screen.getByTestId('rounds-table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent)
    ).toEqual(['Round', 'Committed12', 'What is committed'])
    expect(within(table).queryByText(/Remaining/)).toBeNull()
  })
})
