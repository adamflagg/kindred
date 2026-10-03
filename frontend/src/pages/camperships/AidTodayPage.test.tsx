import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApiAidToday, ApiAidTodayLine } from '../../types/api-types'
import AidTodayPage from './AidTodayPage'

let today: { data: ApiAidToday | undefined; isLoading: boolean; error: Error | null }
vi.mock('../../hooks/camperships/useAidToday', () => ({ useAidToday: () => today }))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

function line(over: Partial<ApiAidTodayLine> & Pick<ApiAidTodayLine, 'key'>): ApiAidTodayLine {
  return {
    families: 0,
    items: 0,
    item_kind: 'requests',
    reasons: [],
    amount: null,
    oldest_days: null,
    over_14_days: null,
    largest_gap: null,
    request_ids: [],
    ...over,
  }
}

const TODAY: ApiAidToday = {
  year: 2027,
  casework: [
    line({
      key: 'holds',
      families: 5,
      items: 7,
      reasons: [{ code: 'household_income_conflict', families: 1, items: 1 }],
    }),
    line({ key: 'to_reverse' }),
  ],
  finance: [
    line({ key: 'pending_approval', families: 2, items: 2, amount: 1050 }),
    line({
      key: 'equity_field_never_true',
      items: 1,
      item_kind: 'fields',
      families: null,
      reasons: [{ code: 'single_parent', families: null, items: 1 }],
    }),
  ],
}

function renderToday() {
  return render(
    <MemoryRouter>
      <AidTodayPage />
    </MemoryRouter>
  )
}

beforeEach(() => {
  today = { data: TODAY, isLoading: false, error: null }
})

describe('AidTodayPage (§6.4; D24)', () => {
  it('shows one dense line per queue, with its count, its reasons and Open ›', () => {
    renderToday()
    const holds = screen.getByText('Holds').closest('[data-today-line]') as HTMLElement
    expect(within(holds).getByText('5 fam · 7 req')).toBeInTheDocument()
    expect(within(holds).getByText('Income conflict 1')).toBeInTheDocument()
    expect(within(holds).getByRole('link', { name: 'Open ›' })).toHaveAttribute(
      'href',
      '/aid/requests?view=holds&year=2027'
    )
  })

  it('keeps a line at zero, quiet, with nothing to open', () => {
    renderToday()
    const reverse = screen.getByText('To reverse').closest('[data-today-line]') as HTMLElement
    expect(within(reverse).getByText('0 fam · 0 req')).toBeInTheDocument()
    expect(within(reverse).queryByRole('link')).toBeNull()
  })

  it('shows the Finance section to finance, with what waits on it', () => {
    renderToday()
    expect(screen.getByRole('heading', { name: 'Finance' })).toBeInTheDocument()
    expect(screen.getByText('$1,050 awaiting finance')).toBeInTheDocument()
  })

  it('shows the equity-field line by name, in the server\u2019s words, with no Open ›', () => {
    renderToday()
    const equity = screen
      .getByText('Equity question never answered yes')
      .closest('[data-today-line]') as HTMLElement
    expect(within(equity).getByText('1 field')).toBeInTheDocument()
    // Q5: the criterion's label, else the code in words; no per-field count.
    expect(within(equity).getByText('Single parent')).toBeInTheDocument()
    expect(within(equity).queryByRole('link')).toBeNull()
  })

  it('says when a role has no queues here, and carries no as-of (D20)', () => {
    today = { data: { year: 2027, casework: null, finance: null }, isLoading: false, error: null }
    renderToday()
    expect(screen.getByText(/no queues here/)).toBeInTheDocument()
    expect(screen.queryByText(/as of/)).toBeNull()
  })

  it('keeps what loaded when a refetch fails (Decision 33)', () => {
    today = { data: TODAY, isLoading: false, error: new Error('boom') }
    renderToday()
    expect(screen.getByText('Holds')).toBeInTheDocument()
  })

  it('shows the error when nothing ever loaded', () => {
    today = { data: undefined, isLoading: false, error: new Error('boom') }
    renderToday()
    expect(screen.queryByText('Holds')).toBeNull()
    expect(screen.getByText(/Failed to load Today data: boom/)).toBeInTheDocument()
  })
})
