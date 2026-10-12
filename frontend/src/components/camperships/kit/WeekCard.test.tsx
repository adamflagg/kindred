import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiAidWeekFeed } from '../../../types/api-types'
import { AidWeekCard } from './WeekCard'

const FIGURES = [
  { key: 'posted', label: 'Offers posted', value: 14, previous: 9, unit: 'count' },
  { key: 'avg', label: 'Avg award', value: 2080, previous: 2140, unit: 'dollars' },
  { key: 'big', label: 'Posted dollars', value: 52000, previous: 50000, unit: 'dollars' },
  { key: 'same', label: 'Refused', value: 3, previous: 3, unit: 'count' },
] as const

function renderCard(feed: readonly ApiAidWeekFeed[], hrefOf: (f: ApiAidWeekFeed) => string | null) {
  return render(
    <MemoryRouter>
      <AidWeekCard weekOf="2031-04-14" figures={FIGURES} feed={feed} hrefOf={hrefOf} />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  // Thursday 2031-04-17 noon, camp time.
  vi.setSystemTime(new Date('2031-04-17T19:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('AidWeekCard', () => {
  it('draws the figures with their change against last week, up in forest and down in amber', () => {
    renderCard([], () => null)
    expect(screen.getByText('Mon Apr 14 – today')).toBeInTheDocument()
    expect(screen.getByText('▲ 5').className).toMatch(/forest/)
    expect(screen.getByText('▼ $60').className).toMatch(/amber/)
    // formatMoneyFigure: exact under $10,000, formatMoneyCompact from there up (controller ruling).
    expect(screen.getByText('$2,080')).toBeInTheDocument()
    expect(screen.getByText('$52k')).toBeInTheDocument()
    expect(screen.getByText('▲ $2,000')).toBeInTheDocument()
  })

  it("gives a figure the server's native title, where it sends one", () => {
    render(
      <MemoryRouter>
        <AidWeekCard
          weekOf="2031-04-14"
          figures={[
            {
              key: 'awards',
              label: 'Awards',
              value: 4,
              previous: 2,
              unit: 'count',
              title: 'Camp offers posted plus outside grants recorded',
            },
          ]}
          feed={[]}
          hrefOf={() => null}
        />
      </MemoryRouter>
    )
    expect(screen.getByText('Awards').closest('[title]')).toHaveAttribute(
      'title',
      'Camp offers posted plus outside grants recorded'
    )
  })

  it('shows no change when a figure did not move', () => {
    renderCard([], () => null)
    expect(screen.getByText('Refused').parentElement?.textContent).not.toMatch(/[▲▼]/)
  })

  it('lists the feed with a glyph per kind, the clock for today and the weekday before', () => {
    renderCard(
      [
        { kind: 'posted', at: '2031-04-17T17:14:00Z', words: 'Offer posted for the Rivera family' },
        { kind: 'overdue', at: '2031-04-15T17:14:00Z', words: 'An approval is overdue' },
      ],
      () => null
    )
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('✓')
    expect(rows[0]).toHaveTextContent('10:14')
    expect(rows[1]).toHaveTextContent('!')
    expect(rows[1]).toHaveTextContent('Tue')
    expect(screen.getByText('An approval is overdue')).toHaveAttribute(
      'title',
      'An approval is overdue'
    )
  })

  it('links only the name an item marks, in bold, and leaves the rest of its words plain (audit R23)', () => {
    renderCard(
      [
        {
          kind: 'posted',
          at: '2031-04-17T17:14:00Z',
          words: 'Liam & Olivia Becker · R1 posted · $1,850',
          name: 'Liam & Olivia Becker',
          household_cm_id: 1000002,
          href_kind: 'household',
        },
        { kind: 'grant', at: '2031-04-17T16:14:00Z', words: 'Regional Fund grant · $800 posted' },
      ],
      (f) => (f.href_kind === 'household' ? '/aid/households/1000002' : null)
    )
    const link = screen.getByRole('link', { name: 'Liam & Olivia Becker' })
    expect(link).toHaveAttribute('href', '/aid/households/1000002')
    expect(link.className).toMatch(/font-semibold/)
    expect(link.className).toMatch(/text-foreground/)
    const [first, second] = screen.getAllByRole('listitem')
    expect(first).toHaveTextContent('Liam & Olivia Becker · R1 posted · $1,850')
    expect(within(second!).queryByRole('link')).toBeNull()
  })

  it('puts the change beside the figure, not under it (audit R20)', () => {
    renderCard([], () => null)
    const change = screen.getByText('▲ 5')
    expect(change.parentElement).toHaveTextContent(/^14▲ 5$/)
  })

  it('shows no change against a week with nothing in it (audit F20)', () => {
    render(
      <MemoryRouter>
        <AidWeekCard
          weekOf="2031-04-14"
          figures={[
            { key: 'posted', label: 'Offers posted', value: 54, previous: 0, unit: 'count' },
          ]}
          feed={[]}
          hrefOf={() => null}
        />
      </MemoryRouter>
    )
    expect(screen.getByText('Offers posted').parentElement?.textContent).not.toMatch(/[▲▼]/)
  })

  it("shows a figure's note beside it in place of a change (audit F19: You approved's requests)", () => {
    render(
      <MemoryRouter>
        <AidWeekCard
          weekOf="2031-04-14"
          figures={[
            {
              key: 'approved',
              label: 'You approved',
              value: 9200,
              previous: 4000,
              unit: 'dollars',
              note: '4 req',
            },
          ]}
          feed={[]}
          hrefOf={() => null}
        />
      </MemoryRouter>
    )
    expect(screen.getByText('4 req')).toBeInTheDocument()
    expect(screen.getByText('You approved').parentElement?.textContent).not.toMatch(/[▲▼]/)
  })

  it('draws a rules-section edit with the pencil (spec §8.1)', () => {
    renderCard(
      [{ kind: 'section', at: '2031-04-17T17:14:00Z', words: 'Dates section approved' }],
      () => null
    )
    expect(screen.getByRole('listitem')).toHaveTextContent('✎')
  })

  it('shows at most the latest six feed items', () => {
    const feed = Array.from({ length: 9 }, (_, n) => ({
      kind: 'posted' as const,
      at: '2031-04-17T17:14:00Z',
      words: `Item ${String(n)}`,
    }))
    renderCard(feed, () => null)
    expect(screen.getAllByRole('listitem')).toHaveLength(6)
    expect(screen.queryByText('Item 6')).toBeNull()
  })
})
