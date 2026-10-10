import { render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { results } from './scenarioFixtures'
import { SpendTable } from './SpendTable'

const DRAFT = results(735000, { allocated: 1000000 })
const FROM = results(735552, { allocated: 1000000 })
const PROJECTION = {
  share: 0.62,
  through: '2027-02-03',
  basis_year: 2026,
  aligned_on: 'application_deadline' as const,
  requests: 465,
  round1: 799600,
  round1_and_2: 850400,
  remaining: 120000,
  pools: [{ pool: 'pool_a', remaining: 305600 }],
}
const base: ComponentProps<typeof SpendTable> = {
  draft: DRAFT,
  from: FROM,
  stale: false,
  error: null,
  fromName: 'Rules v4',
  locked: false,
  postedStands: false,
  pricedOn: '420 applications held',
  held: true,
}
const show = (over: Partial<ComponentProps<typeof SpendTable>> = {}) =>
  render(
    <MemoryRouter>
      <SpendTable {...base} {...over} />
    </MemoryRouter>
  )
const table = () => screen.getByRole('table', { name: 'Spend' })
const row = (name: string) => within(table()).getByText(name).closest('tr') as HTMLElement

describe('the Spend table (final mock; scenarios-3)', () => {
  it('heads the table "Spend, from <name>" with Remaining of the budget and what was priced', () => {
    show()
    const heading = screen.getByRole('heading', { name: /^Spend, from Rules v4/ })
    expect(heading.querySelector('sup')).toHaveTextContent('1')
    expect(
      screen.getByText('Remaining $243,550 of $1,000,000 · 420 applications held')
    ).toBeInTheDocument()
  })

  it('has the nine columns, with the note marks on Remaining, vs and Projected', () => {
    show()
    const heads = within(table()).getAllByRole('columnheader')
    expect(heads.map((th) => th.childNodes[0]?.textContent)).toEqual([
      'Pool',
      'Round 1',
      'Round 2',
      'Round 3',
      'Spend',
      'Remaining',
      'vs Rules v4',
      'Projected',
      'Used',
    ])
    expect(heads.map((th) => th.querySelector('sup')?.textContent ?? '')).toEqual([
      '',
      '',
      '',
      '',
      '',
      '2',
      '6',
      '3',
      '',
    ])
  })

  it('puts the Round 2 and Round 3 help in their header titles, not under a fold', () => {
    show()
    expect(screen.getByRole('columnheader', { name: /^Round 2/ })).toHaveAttribute(
      'title',
      'No appeals before Round 1: $0 until they exist'
    )
    expect(screen.getByRole('columnheader', { name: /^Round 3/ })).toHaveAttribute(
      'title',
      'Typed by staff, so no formula prices it: what is posted or keyed stands'
    )
    expect(screen.queryByText('Round 2: no appeals before Round 1.')).toBeNull()
  })

  it('says Round 2 keyed so far once Round 1 is locked', () => {
    show({ locked: true })
    expect(screen.getByRole('columnheader', { name: /^Round 2, keyed so far/ })).toHaveAttribute(
      'title',
      'Appeals keyed so far'
    )
  })

  it('draws a row per pool and the total in the band, numbers in whole dollars', () => {
    show()
    const a = within(row('Pool A')).getAllByRole('cell')
    expect(a.slice(1, 5).map((c) => c.textContent)).toEqual([
      '$685,000',
      '$20,500',
      '$950',
      '$706,450',
    ])
    expect(a[1]).toHaveClass('text-right')
    const total = within(row('Total')).getAllByRole('cell')
    expect(total.slice(1, 5).map((c) => c.textContent)).toEqual([
      '$735,000',
      '$20,500',
      '$950',
      '$756,450',
    ])
    expect(row('Total')).toHaveClass('font-bold')
  })

  it('reads a pool over its share amber and the total over budget red, with no pill', () => {
    const over = {
      ...DRAFT,
      remaining: -50,
      pools: [{ ...DRAFT.pools[0]!, remaining: -1017 }, DRAFT.pools[1]!],
    }
    show({ draft: over })
    expect(within(row('Pool A')).getByText('−$1,017')).toHaveClass('text-amber-700')
    expect(within(row('Total')).getByText('−$50')).toHaveClass('text-red-700')
    expect(screen.queryByText('over budget')).toBeNull()
    expect(screen.queryByText('over its share')).toBeNull()
  })

  it('shows each Remaining change as a signed mark, green for more, and a dash for none', () => {
    show()
    expect(within(row('Pool A')).getByText('+$552')).toHaveAttribute('data-tone', 'more')
    expect(within(row('Total')).getByText('+$552')).toHaveAttribute('data-tone', 'more')
    const b = within(row('Pool B')).getAllByRole('cell')
    expect(b[6]).toHaveTextContent('—')
  })

  it('shows Projected as a muted ≈$k with its title, a dash with none', () => {
    show({ draft: { ...DRAFT, projection: PROJECTION } })
    const cell = within(row('Pool A')).getAllByRole('cell')[7]!
    expect(cell).toHaveTextContent('≈$306k')
    expect(cell).toHaveClass('text-muted-foreground')
    expect(cell).toHaveAttribute('title', expect.stringContaining('about 62% are in by this week'))
    expect(within(row('Total')).getAllByRole('cell')[7]).toHaveTextContent('≈$120k')
    expect(within(row('Pool B')).getAllByRole('cell')[7]).toHaveTextContent('—')
  })

  it('says why there is no projection yet in the Projected cells’ title', () => {
    show({
      draft: { ...DRAFT, too_early: { share: 0.03, through: '2027-01-05', basis_year: 2026 } },
    })
    expect(within(row('Total')).getAllByRole('cell')[7]).toHaveAttribute(
      'title',
      expect.stringMatching(/^Too early to project/)
    )
  })

  it('draws Used as the pool bar, with the dotted start tick only where the pool moved', () => {
    show()
    expect(within(row('Pool A')).getByTestId('spend-ghost')).toBeInTheDocument()
    expect(within(row('Pool B')).queryByTestId('spend-ghost')).toBeNull()
    expect(within(row('Pool A')).getByTitle(/of the pool's allocation/)).toBeInTheDocument()
    expect(within(row('Total')).queryByTestId('spend-ghost')).toBeNull()
  })

  it('puts the server’s words under the table on a refused read, keeping the figures', () => {
    show({ error: "2027's approved rules set no application deadline: choose a date" })
    expect(screen.getByText(/set no application deadline/)).toBeInTheDocument()
    expect(within(row('Total')).getByText('$735,000')).toBeInTheDocument()
  })

  it('dims while pricing', () => {
    show({ stale: true })
    expect(screen.getByTestId('spend-table')).toHaveAttribute('data-stale')
  })
})

describe('the empty Spend (scenarios-12)', () => {
  it('keeps the heading row over a dashed box that says to update', () => {
    show({ draft: null, from: null, held: false })
    expect(screen.getByRole('heading', { name: /^Spend/ })).toBeInTheDocument()
    expect(screen.getByText('nothing priced yet')).toBeInTheDocument()
    const box = screen.getByText(/No applications are held yet\./).closest('div')
    expect(box).toHaveClass('border-dashed')
    expect(within(box as HTMLElement).getByText('Update Applications').tagName).toBe('B')
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('says to update before any applications are held, even when a draft was priced', () => {
    show({ held: false })
    expect(screen.getByText(/No applications are held yet\./)).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Spend' })).toBeNull()
  })
})

describe('By tier and Below the line folds (scenarios-3)', () => {
  it('sits two fold headings side by side, each with its summary on the line', () => {
    show()
    expect(screen.getByRole('button', { name: /By tier/ })).toBeInTheDocument()
    expect(screen.getByText('Round 1 by tier · 420 applications held')).toBeInTheDocument()
    const below = screen.getByRole('button', { name: /Below the line/ })
    expect(below.querySelector('sup')).toHaveTextContent('4')
    expect(screen.getByText('12 at minimum · 9 held · unmet ask $50,920')).toBeInTheDocument()
  })

  it('opens By tier as a ruled table with a dash where nothing changed', async () => {
    show()
    expect(screen.queryByRole('table', { name: 'By tier' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /By tier/ }))
    const tiers = screen.getByRole('table', { name: 'By tier' })
    const tier1 = within(tiers).getByText('Tier 1').closest('tr') as HTMLElement
    expect(within(tier1).getByText('−$552')).toHaveAttribute('data-tone', 'more')
    const tier2 = within(tiers).getByText('Tier 2').closest('tr') as HTMLElement
    expect(tier2.lastElementChild).toHaveTextContent(/^—$/)
    expect(within(tiers).queryByRole('columnheader', { name: 'Round 2' })).toBeNull()
  })

  it('opens Below the line against the starting point, and both folds can be open', async () => {
    show()
    await userEvent.click(screen.getByRole('button', { name: /Below the line/ }))
    await userEvent.click(screen.getByRole('button', { name: /By tier/ }))
    const below = screen.getByRole('table', { name: 'Below the line' })
    expect(within(below).getByText('At the minimum')).toBeInTheDocument()
    const held = within(below).getByText('Held: no amount yet').closest('tr') as HTMLElement
    expect(held.lastElementChild).toHaveTextContent(/^—$/)
    expect(screen.getByRole('table', { name: 'By tier' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Below the line/ }))
    expect(screen.queryByRole('table', { name: 'Below the line' })).toBeNull()
  })

  it('adds Round 2 to By tier and the appeals to Below the line once Round 1 is locked', async () => {
    show({ locked: true, draft: { ...DRAFT, appeals: 2, appeals_asked: 1300 } })
    expect(screen.getByText(/2 appeals keyed/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /By tier/ }))
    expect(
      within(screen.getByRole('table', { name: 'By tier' })).getByRole('columnheader', {
        name: 'Round 2',
      })
    ).toBeInTheDocument()
  })
})
