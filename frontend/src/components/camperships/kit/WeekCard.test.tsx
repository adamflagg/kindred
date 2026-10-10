import { render, screen } from '@testing-library/react'
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
    expect(screen.getByText('$2,080')).toBeInTheDocument()
    expect(screen.getByText('$52k')).toBeInTheDocument()
    expect(screen.getByText('▲ $2,000')).toBeInTheDocument()
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

  it('links the words of an item that has a place to go', () => {
    renderCard(
      [
        {
          kind: 'grant',
          at: '2031-04-17T17:14:00Z',
          words: 'A grant came in',
          href_kind: 'funders',
        },
        { kind: 'funder', at: '2031-04-17T16:14:00Z', words: 'A funder changed' },
      ],
      (f) => (f.href_kind === 'funders' ? '/aid/money/funders' : null)
    )
    expect(screen.getByRole('link', { name: 'A grant came in' })).toHaveAttribute(
      'href',
      '/aid/money/funders'
    )
    expect(screen.queryByRole('link', { name: 'A funder changed' })).toBeNull()
  })
})
