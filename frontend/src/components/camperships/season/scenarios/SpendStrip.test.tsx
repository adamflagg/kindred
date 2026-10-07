import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { results } from './scenarioFixtures'
import { SpendStrip } from './SpendStrip'

const DRAFT = results(735000, { allocated: 1000000 })
const FROM = results(735552, { allocated: 1000000 })
const base = {
  draft: DRAFT,
  from: FROM,
  stale: false,
  error: null,
  fromName: 'Rules v4',
  locked: false,
  postedStands: false,
  pricedOn: '420 the applications held',
  held: true,
}

describe('SpendStrip (§S5 E)', () => {
  it('leads with Remaining, its change and what it is from, then one cell per pool', () => {
    render(<SpendStrip {...base} />)
    const strip = screen.getByTestId('spend-strip')
    expect(within(strip).getByText('Rules v4')).toBeInTheDocument()
    expect(within(strip).getByText('$243,550')).toBeInTheDocument()
    expect(within(strip).getByText('of $1,000,000 · 420 applications')).toBeInTheDocument()
    expect(within(strip).getAllByText('+$552')[0]).toHaveAttribute('data-tone', 'more')
    expect(screen.getByTestId('strip-pool-pool_a')).toBeInTheDocument()
    expect(screen.getByTestId('strip-pool-pool_b')).toBeInTheDocument()
  })

  it('marks a pool over its share in amber and the total over budget in red', () => {
    const over = {
      ...DRAFT,
      remaining: -50,
      pools: [{ ...DRAFT.pools[0]!, remaining: -1017 }, DRAFT.pools[1]!],
    }
    render(<SpendStrip {...base} draft={over} />)
    expect(
      within(screen.getByTestId('strip-pool-pool_a')).getByText('over its share')
    ).toBeInTheDocument()
    expect(screen.getByText('over budget')).toBeInTheDocument()
  })

  it('draws the ghost mark where the starting point sat', () => {
    render(<SpendStrip {...base} />)
    expect(
      within(screen.getByTestId('strip-pool-pool_a')).getByTestId('strip-ghost')
    ).toBeInTheDocument()
    expect(within(screen.getByTestId('strip-pool-pool_b')).queryByTestId('strip-ghost')).toBeNull()
  })

  it('shows the projection muted, dims it after the lock, and leaves it out with none', () => {
    const projection = {
      share: 0.39,
      through: '2027-02-03',
      basis_year: 2026,
      aligned_on: 'application_deadline' as const,
      requests: 465,
      round1: 799600,
      round1_and_2: 850400,
      remaining: 120000,
      pools: [],
    }
    const { rerender } = render(<SpendStrip {...base} draft={{ ...DRAFT, projection }} />)
    expect(screen.getByTestId('strip-projection')).toHaveTextContent(
      'Projected: by this point last year 39% had arrived'
    )
    expect(screen.getByTestId('strip-projection')).not.toHaveAttribute('data-dimmed')
    rerender(<SpendStrip {...base} draft={{ ...DRAFT, projection }} locked />)
    expect(screen.getByTestId('strip-projection')).toHaveAttribute('data-dimmed')
    rerender(<SpendStrip {...base} />)
    expect(screen.queryByTestId('strip-projection')).toBeNull()
  })

  it('puts the server’s words where the projection was on a refused read, keeping the figures', () => {
    render(
      <SpendStrip
        {...base}
        error="2027's approved rules set no application deadline (milestones): choose a received-through date"
      />
    )
    expect(screen.getByText(/set no application deadline/)).toBeInTheDocument()
    expect(screen.getByText('$243,550')).toBeInTheDocument()
  })

  it('dims while pricing and says to update with nothing held', () => {
    const { rerender } = render(<SpendStrip {...base} stale />)
    expect(screen.getByTestId('spend-strip-card')).toHaveAttribute('data-stale')
    rerender(<SpendStrip {...base} draft={null} from={null} held={false} />)
    expect(
      screen.getByText('Update Applications to price the applications held.')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('strip-pool-pool_a')).toBeNull()
  })

  it('opens one popover at a time: Below the line, then By tier; Escape closes', async () => {
    render(<SpendStrip {...base} />)
    await userEvent.click(screen.getByRole('button', { name: /unmet ask/ }))
    const below = screen.getByTestId('below-popover')
    expect(within(below).getByText('At the minimum')).toBeInTheDocument()
    expect(within(below).getByText('Round 2: no appeals before Round 1.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'By tier ▸' }))
    expect(screen.queryByTestId('below-popover')).toBeNull()
    expect(
      within(screen.getByTestId('tier-popover')).getByText('By tier · 420 the applications held')
    ).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('tier-popover')).toBeNull()
  })

  it('shows whole dollars for a figure with cents (coordinator ruling 2026-10-07)', () => {
    const cents = {
      ...DRAFT,
      remaining: 243550.4,
      pools: [{ ...DRAFT.pools[0]!, remaining: 41495.66 }, DRAFT.pools[1]!],
    }
    render(<SpendStrip {...base} draft={cents} />)
    expect(screen.getByText('$243,550')).toBeInTheDocument()
    expect(within(screen.getByTestId('strip-pool-pool_a')).getByText('$41,496')).toBeInTheDocument()
  })

  it('says to update before any applications are held, even when a draft was priced (regression guard for the held guard)', () => {
    render(<SpendStrip {...base} held={false} />)
    expect(
      screen.getByText('Update Applications to price the applications held.')
    ).toBeInTheDocument()
    expect(screen.queryByTestId('strip-pool-pool_a')).toBeNull()
  })
})
