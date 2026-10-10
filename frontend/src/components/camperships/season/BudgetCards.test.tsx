import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { AidView } from '../kit/asOf'
import { BudgetHead, SeasonCard } from './BudgetCard'
import { BUDGET, overBudget, poolOverShare } from './budgetFixtures'
import { poolCards } from './budgetCards'
import { PoolCard } from './PoolCard'

const LIVE: AidView = { year: 2027, asOf: { kind: 'live' } }
const N = (key: string) =>
  ({
    rounds_allocated: 1,
    rounds_committed: 2,
    rounds_posted: 3,
    rounds_needs_offer: 4,
    rounds_remaining: 5,
    rounds_below_the_line: 6,
  })[key] ?? null

function head(over: Partial<Parameters<typeof BudgetHead>[0]> = {}) {
  return render(
    <MemoryRouter>
      <BudgetHead
        budget={BUDGET}
        view={LIVE}
        editing={false}
        previewing={false}
        draftPill={null}
        canPlan
        onEditPlan={vi.fn()}
        scope={null}
        onClearScope={vi.fn()}
        {...over}
      />
    </MemoryRouter>
  )
}

function season(over: Partial<Parameters<typeof SeasonCard>[0]> = {}) {
  return render(
    <MemoryRouter>
      <SeasonCard budget={BUDGET} view={LIVE} numberOf={N} preview={null} {...over} />
    </MemoryRouter>
  )
}

describe('the Budget heading (spec §5.2 A; rounds-5, -11, -13, -15)', () => {
  it('reads Budget, 2027 with the rules version and how the rules count in its description', () => {
    head()
    const h = screen.getByTestId('budget-head')
    expect(within(h).getByRole('heading', { name: 'Budget, 2027' })).toBeInTheDocument()
    expect(
      within(h).getByText(
        'rules v3 · counts when offered · each pool keeps its own Remaining · only the total is a cap'
      )
    ).toBeInTheDocument()
    expect(within(h).getByRole('button', { name: 'Edit Plan…' })).toBeInTheDocument()
  })

  it('draws the one-pool state as a removable "TBM only" chip, and ✕ clears it', async () => {
    const onClearScope = vi.fn()
    head({ scope: 'Pool B', onClearScope })
    await userEvent.click(screen.getByRole('button', { name: 'Clear Pool B only' }))
    expect(onClearScope).toHaveBeenCalledOnce()
  })

  it('with no approved rules: the amber pill, the description without a version, and no rules link', () => {
    head({ budget: { ...BUDGET, rules_version: null } })
    expect(screen.getByText('no approved rules: nothing allocated yet')).toBeInTheDocument()
    expect(
      screen.getByText(
        'counts when offered · each pool keeps its own Remaining · only the total is a cap'
      )
    ).toBeInTheDocument()
  })

  it('on a past date says "past date: exact figures only"', () => {
    head({
      view: { year: 2027, asOf: { kind: 'past', date: '2027-03-15', axis: 'campminder' } },
      canPlan: false,
    })
    expect(screen.getByText('past date: exact figures only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Plan…' })).toBeNull()
  })

  it('shows ONE amber preview pill while editing, in place of the rules draft pill', () => {
    head({ editing: true, previewing: true, draftPill: 'rules draft v4: 1 budget change' })
    expect(screen.getAllByText('preview')).toHaveLength(1)
    expect(screen.queryByText(/rules draft v4/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit Plan…' })).toBeNull()
  })

  it('shows no preview pill while editing until a typed figure actually moves', () => {
    head({ editing: true, previewing: false })
    expect(screen.queryByText('preview')).toBeNull()
  })

  it('shows the rules draft pill when not editing', () => {
    head({ draftPill: 'rules draft v4: 1 budget change' })
    expect(screen.getByText('rules draft v4: 1 budget change')).toBeInTheDocument()
  })
})

describe('the Season card (compact, in the green band)', () => {
  it('leads with Season 100%, and Allocated (a link) · Committed · Remaining (bold)', () => {
    season()
    const card = screen.getByTestId('season-card')
    expect(within(card).getByText('Season')).toBeInTheDocument()
    expect(within(card).getByText('100%')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: '$1,000,000' })).toHaveAttribute(
      'href',
      '/aid/season/rules?version=3&section=budget&year=2027'
    )
    expect(within(card).getByTestId('budget-remaining').querySelector('b')).not.toBeNull()
  })

  it('reads the total below $0 as a red minus with a red "over budget" pill', () => {
    season({ budget: overBudget() })
    const card = screen.getByTestId('season-card')
    expect(within(card).getByText('−$8,366')).toHaveClass('text-red-700')
    expect(within(card).getByText('over budget')).toHaveClass('bg-red-100')
  })

  it('with no approved rules: "—" for Allocated and Remaining, a bare bar with its reason', () => {
    season({
      budget: {
        ...BUDGET,
        rules_version: null,
        total: {
          ...BUDGET.total,
          total: { ...BUDGET.total.total, allocated: null, remaining: null },
        },
      },
    })
    const card = screen.getByTestId('season-card')
    expect(within(card).queryByRole('link')).toBeNull()
    expect(within(card).getByTestId('budget-remaining')).toHaveTextContent('—')
    // the bare bar and both figures explain themselves
    expect(
      within(card).getAllByTitle(
        'No approved rules: nothing is allocated until a budget section is approved'
      )
    ).toHaveLength(3)
  })

  it('marks every moved figure while Edit Plan… is open', () => {
    season({ preview: { pools: {}, total: { allocated: 1010000, remaining: 175140 } } })
    expect(screen.getByText('$1,010,000')).toHaveAttribute('data-moved')
  })

  it('marks Allocated, Committed and Remaining with their notes', () => {
    season()
    const card = screen.getByTestId('season-card')
    expect([...card.querySelectorAll('sup')].map((s) => s.textContent)).toEqual(['1', '2', '5'])
  })

  it('opens nothing: no button, no caret', () => {
    season()
    expect(within(screen.getByTestId('season-card')).queryByRole('button')).toBeNull()
  })
})

describe('a pool card (compact; spec §5.2 C; §8.3)', () => {
  const props = (card: ReturnType<typeof poolCards>[number], budget = BUDGET) => ({
    card,
    budget,
    view: LIVE,
    numberOf: N,
    preview: null,
  })

  it('reads a pool past its share in amber with "over its share"', () => {
    const budget = poolOverShare()
    const [, b] = poolCards(budget, null)
    render(
      <MemoryRouter>
        <PoolCard {...props(b!, budget)} />
      </MemoryRouter>
    )
    const remaining = screen.getByTestId('pool-remaining')
    expect(within(remaining).getByText('−$1,200')).toHaveClass('text-amber-700')
    expect(within(screen.getByTestId('pool-card-pool_b')).getByText('over its share')).toHaveClass(
      'bg-amber-100'
    )
  })

  it('names the pool and its share, with no "of the budget" and no fold', () => {
    const [a] = poolCards(BUDGET, null)
    render(
      <MemoryRouter>
        <PoolCard {...props(a!)} />
      </MemoryRouter>
    )
    const card = screen.getByTestId('pool-card-pool_a')
    expect(within(card).getByText('Pool A')).toBeInTheDocument()
    expect(within(card).getByText('90%')).toBeInTheDocument()
    expect(within(card).queryByRole('button')).toBeNull()
  })

  it('draws its meter from the typed plan while Edit Plan… is open (spec §5.2 B)', () => {
    const budget = poolOverShare() // pool_b: Allocated $100,000, Committed $101,200
    const [, b] = poolCards(budget, null)
    const { unmount } = render(
      <MemoryRouter>
        <PoolCard {...props(b!, budget)} />
      </MemoryRouter>
    )
    const stripes = () =>
      [...screen.getByTestId('pool-card-pool_b').querySelectorAll('i')].filter((i) =>
        i.className.includes('repeating-linear-gradient')
      )
    expect(stripes()).toHaveLength(1)
    unmount()
    // The typed plan gives Pool B $110,000: $8,800 left, so the meter has no overage stripes.
    const preview = {
      pools: { pool_b: { allocated: 110000, remaining: 8800 } },
      total: { allocated: 1000000, remaining: 0 },
    }
    render(
      <MemoryRouter>
        <PoolCard {...props(b!, budget)} preview={preview} />
      </MemoryRouter>
    )
    expect(stripes()).toHaveLength(0)
    expect(within(screen.getByTestId('pool-remaining')).getByText('$8,800')).toBeInTheDocument()
  })

  it('has a bare meter with its reason when nothing is allocated yet', () => {
    const [a] = poolCards(BUDGET, null)
    render(
      <MemoryRouter>
        <PoolCard {...props({ ...a!, allocated: null, remaining: null })} />
      </MemoryRouter>
    )
    expect(
      within(screen.getByTestId('pool-card-pool_a')).getByTitle(
        'Pool A: no allocation yet, so nothing to measure against'
      )
    ).toBeInTheDocument()
  })
})
