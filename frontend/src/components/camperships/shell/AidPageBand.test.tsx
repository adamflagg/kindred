import { render, screen } from '@testing-library/react'
import { Inbox } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AidPageBand } from './AidPageBand'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('AidPageBand (D30: the compact band, no hero)', () => {
  it("uses Kindred's compact forest band and a display-font title", () => {
    render(<AidPageBand icon={Inbox} title="Requests" subtitle="Season 2027" />)
    const title = screen.getByRole('heading', { level: 1 })
    expect(title).toHaveTextContent('Requests')
    expect(title.closest('.rounded-xl')).toHaveClass('from-forest-700', 'to-forest-800')
  })

  it('shows no as-of on a page of counts (Today), which passes none', () => {
    render(<AidPageBand icon={Inbox} title="Today" subtitle="Season 2027" />)
    expect(screen.queryByText(/as of/i)).toBeNull()
  })

  it('says plainly when a money page is live (budget-demand.html)', () => {
    render(
      <AidPageBand icon={Inbox} title="Requests" subtitle="Season 2027" asOf={{ kind: 'live' }} />
    )
    expect(screen.getByText('Season 2027 · as of Oct 1 (live)')).toBeInTheDocument()
  })

  it('turns the date into an amber pill when the page shows a past day (D20)', () => {
    render(
      <AidPageBand
        icon={Inbox}
        title="Requests"
        asOf={{ kind: 'past', date: '2026-04-01', axis: 'campminder' }}
      />
    )
    expect(screen.getByText('As of Apr 1, 2026')).toHaveClass('bg-amber-100')
  })

  it("carries the page's own words about the date in the pill's title (§6: no sentence row)", () => {
    render(
      <AidPageBand
        icon={Inbox}
        title="Money"
        asOf={{ kind: 'past', date: '2026-04-01', axis: 'campminder' }}
        asOfTitle="Money › Ledger shows Apr 1, 2026. To place, Grants and Funders show today."
      />
    )
    expect(screen.getByText('As of Apr 1, 2026')).toHaveAttribute(
      'title',
      'Money › Ledger shows Apr 1, 2026. To place, Grants and Funders show today.'
    )
  })

  it('gives the pill no title when the page has nothing to add', () => {
    render(
      <AidPageBand
        icon={Inbox}
        title="Requests"
        asOf={{ kind: 'past', date: '2026-04-01', axis: 'campminder' }}
      />
    )
    expect(screen.getByText('As of Apr 1, 2026')).not.toHaveAttribute('title')
  })

  it('names the recorded axis in the pill', () => {
    render(
      <AidPageBand
        icon={Inbox}
        title="Requests"
        asOf={{ kind: 'past', date: '2026-04-01', axis: 'recorded' }}
      />
    )
    expect(screen.getByText('As of Apr 1, 2026 · as recorded')).toBeInTheDocument()
  })

  it('says so when a link carries a date that is not a past day (Review Focus 1)', () => {
    render(
      <AidPageBand icon={Inbox} title="Requests" asOf={{ kind: 'invalid', raw: '2026-13-01' }} />
    )
    expect(screen.getByText('Not a past date: 2026-13-01 · showing live')).toHaveClass(
      'bg-amber-100'
    )
  })

  it('puts stats on the right when a page gives them', () => {
    render(<AidPageBand icon={Inbox} title="Household" stats={<div>$1,800 decided</div>} />)
    expect(screen.getByText('$1,800 decided')).toBeInTheDocument()
  })
})
