import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { BUDGET, SOURCES, STAGES } from './todayFixtures'
import { DevelopmentHero, FinanceHero, RegistrarHero } from './TodayHeroes'

const VIEW = { year: 2027, asOf: { kind: 'live' } } as const
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('the Today heroes', () => {
  it('registrar hero: title, offer share, the stages on the bar and no +n pill (rulings 14, 17)', () => {
    wrap(<RegistrarHero stages={STAGES} view={VIEW} />)
    expect(screen.getByRole('heading', { name: 'The season so far' })).toBeInTheDocument()
    expect(screen.getByTestId('hero-figure')).toHaveTextContent('of live requests have an offer90%')
    const keys = screen.getAllByTestId('hero-key').map((k) => k.textContent)
    expect(keys).toEqual([
      'Needs an offer 31',
      'Pending approval 6',
      'Waiting on the family 9',
      'On hold 6',
      'Accepted 318',
    ])
    expect(screen.queryByTitle('Posted this week')).toBeNull()
    expect(screen.getByText(/370 requests from 389 families/)).toBeInTheDocument()
  })

  it("registrar hero: the flags are amber chips with the strip's counts, each opening its list, zeros hidden", () => {
    wrap(<RegistrarHero stages={STAGES} view={VIEW} />)
    const chips = screen.getAllByTestId('hero-flag')
    expect(chips.map((c) => c.textContent)).toEqual([
      'Not reconciled 8',
      'Session unclear 2',
      'To reverse 1',
    ])
    expect(chips[0]).toHaveAttribute('href', '/aid/requests?view=not-reconciled&year=2027')
    expect(chips[0]?.querySelector('span')?.className).toMatch(/amber/)
    expect(screen.queryByText(/Duplicates/)).toBeNull()
  })

  it('registrar hero: each part opens its Requests view', () => {
    wrap(<RegistrarHero stages={STAGES} view={VIEW} />)
    const hrefs = screen.getAllByTestId('hero-seg').map((s) => s.getAttribute('href'))
    expect(hrefs).toContain('/aid/requests?view=waiting&year=2027')
    expect(hrefs).toContain('/aid/requests?view=needs-offer&year=2027')
    expect(hrefs).toContain('/aid/requests?view=pending-approval&year=2027')
    expect(hrefs).not.toContain('/aid/requests?view=not-reconciled&year=2027')
    expect(hrefs).toContain('/aid/requests?view=holds&year=2027')
    expect(hrefs.at(-1)).toBe('/aid/requests?year=2027')
  })

  it('registrar hero: no offer share with nothing live', () => {
    wrap(<RegistrarHero stages={{ ...STAGES, live: 0, offered: 0 }} view={VIEW} />)
    expect(screen.getByTestId('hero-figure')).toHaveTextContent('of live requests have an offer—')
  })

  it('finance hero: remaining headline, the pool over, pool rows with Remaining chips', () => {
    wrap(<FinanceHero budget={BUDGET} view={VIEW} />)
    expect(screen.getByTestId('hero-figure')).toHaveTextContent(
      'remaining after everything waiting is offered · TBM is $1,300 over$127k'
    )
    expect(screen.getByText('$1k over')).toBeInTheDocument()
    expect(screen.getByText('$87k remaining')).toBeInTheDocument()
  })

  it('finance hero: the over chip carries the exact dollars, and the pool rows open Rounds & budget', () => {
    wrap(<FinanceHero budget={BUDGET} view={VIEW} />)
    expect(screen.getByText('$1k over')).toHaveAttribute('title', '$1,300 over')
    const rows = screen.getAllByTestId('pool-row')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByRole('link')).toHaveAttribute(
      'href',
      '/aid/season/rounds-budget?year=2027'
    )
  })

  it('finance hero: a negative total flips to amber "over"', () => {
    const total = { ...BUDGET.total, total: { ...BUDGET.total.total, remaining: -5400 } }
    wrap(<FinanceHero budget={{ ...BUDGET, total }} view={VIEW} />)
    expect(screen.getByTestId('hero-figure')).toHaveTextContent('over$5k')
  })

  it('finance hero: a pool with no allocation says so and draws no bar', () => {
    const [first, ...others] = BUDGET.pools
    const open = { ...first!, total: { ...first!.total, allocated: null, remaining: null } }
    wrap(<FinanceHero budget={{ ...BUDGET, pools: [open, ...others] }} view={VIEW} />)
    expect(screen.getByText('No allocation')).toBeInTheDocument()
  })

  it('development hero: two bars and a caption, no family words', () => {
    const { container } = wrap(<DevelopmentHero sources={SOURCES} awards={521} view={VIEW} />)
    expect(screen.getByText(/Outside \$\d[\d,]*, by funder/)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/household|Johnson|Garcia/)
  })

  it('development hero: the awards figure, the outside share and the funder bar that folds the tail', () => {
    wrap(<DevelopmentHero sources={SOURCES} awards={521} view={VIEW} />)
    // outside 185,000 of 946,200 given = 20%
    expect(screen.getByTestId('hero-figure')).toHaveTextContent(
      'awards · 20% of the money from outside funders521'
    )
    expect(screen.getByText(/\$946,200 given so far in 2027/)).toBeInTheDocument()
    expect(screen.getByText('Outside $185,000, by funder')).toBeInTheDocument()
    const doors = screen.getAllByTestId('hero-seg').map((s) => s.getAttribute('href'))
    expect(doors.length).toBeGreaterThan(0)
    expect(doors.every((h) => h === '/aid/reports/development?year=2027')).toBe(true)
  })
})

describe('the one reveal (spec §3)', () => {
  // The reveal is once per page load, held in the module: each case loads a fresh copy.
  async function fresh() {
    vi.resetModules()
    return import('./TodayHeroes')
  }

  it('plays on the finance hero on first load, and not on a second mount', async () => {
    const { FinanceHero } = await fresh()
    const first = wrap(<FinanceHero budget={BUDGET} view={VIEW} />)
    expect(first.container.querySelector('[data-reveal="true"]')).not.toBeNull()
    first.unmount()
    const again = wrap(<FinanceHero budget={BUDGET} view={VIEW} />)
    expect(again.container.querySelector('[data-reveal="true"]')).toBeNull()
  })

  it('plays on the development hero on first load', async () => {
    const { DevelopmentHero } = await fresh()
    const { container } = wrap(<DevelopmentHero sources={SOURCES} awards={521} view={VIEW} />)
    expect(container.querySelector('[data-reveal="true"]')).not.toBeNull()
  })

  it('plays on the registrar hero on first load', async () => {
    const { RegistrarHero } = await fresh()
    const { container } = wrap(<RegistrarHero stages={STAGES} view={VIEW} />)
    expect(container.querySelector('[data-reveal="true"]')).not.toBeNull()
  })
})
