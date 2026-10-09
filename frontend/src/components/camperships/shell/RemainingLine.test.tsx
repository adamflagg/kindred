import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MINUS } from '../kit/money'
import { RemainingLine } from './RemainingLine'

// Interfaces, not `type`s (Ruling 2026-10-01 (plan review): the lint budget).
interface RemainingPool {
  pool: string
  label: string
  remaining: number | null
}
interface RemainingData {
  year: number
  pools: RemainingPool[]
  total: number | null
}
interface RemainingState {
  data?: RemainingData
  isPending: boolean
  error: Error | null
}
let state: RemainingState
vi.mock('../../../hooks/camperships/useAidRemaining', () => ({ useAidRemaining: () => state }))
vi.mock('../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
let granted: string[] = ['financial_aid.view']
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))

const LIVE = {
  year: 2027,
  pools: [
    { pool: 'pool_a', label: 'Pool A', remaining: 153400 },
    { pool: 'pool_b', label: 'Pool B', remaining: 18000 },
    { pool: 'pool_c', label: 'Pool C', remaining: -1200 },
  ],
  total: 170200,
}

function renderAt(path = '/aid/requests') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RemainingLine />
    </MemoryRouter>
  )
}

beforeEach(() => {
  granted = ['financial_aid.view']
  state = { data: LIVE, isPending: false, error: null }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('RemainingLine (D48, D75; spec §7.3)', () => {
  it('shows one figure per pool, each opening Rounds & budget for this season, filtered to it', () => {
    renderAt()
    expect(screen.getByRole('link', { name: 'Pool A $153k' })).toHaveAttribute(
      'href',
      '/aid/season/rounds-budget?pool=pool_a&year=2027'
    )
    expect(screen.getByRole('link', { name: 'Pool B $18k' })).toBeInTheDocument()
  })

  // Owner 2026-10-08: the bar is short on room, so a known pool reads by its short name, like
  // sessionName's `tiny` form. Any other key reads its label whole; the hover always has the full name.
  it('reads a known pool by its short name and keeps the full label on hover', () => {
    state = {
      data: {
        year: 2027,
        pools: [
          { pool: 'camp_quest', label: 'Camp & Quest', remaining: 298000 },
          { pool: 'tbm', label: 'TBM', remaining: 19000 },
          { pool: 'weekend', label: 'Weekend programs', remaining: 41000 },
          { pool: 'pool_d', label: 'Pool D', remaining: 5000 },
        ],
        total: 363000,
      },
      isPending: false,
      error: null,
    }
    renderAt()
    expect(screen.getByRole('link', { name: 'C&Q $298k' })).toHaveAttribute('title', 'Camp & Quest')
    expect(screen.getByRole('link', { name: 'TBM $19k' })).toHaveAttribute('title', 'TBM')
    expect(screen.getByRole('link', { name: 'Weekend $41k' })).toHaveAttribute(
      'title',
      'Weekend programs'
    )
    expect(screen.getByRole('link', { name: 'Pool D $5k' })).toHaveAttribute('title', 'Pool D')
  })

  it('keeps the full label on hover for a summary-only user too', () => {
    granted = ['financial_aid.summary']
    state = {
      data: {
        year: 2027,
        pools: [{ pool: 'camp_quest', label: 'Camp & Quest', remaining: 298000 }],
        total: 298000,
      },
      isPending: false,
      error: null,
    }
    renderAt()
    expect(screen.getByTitle('Camp & Quest')).toHaveTextContent('C&Q $298k')
  })

  it('inks an over-allocated pool in amber, with a minus and no parentheses', () => {
    renderAt()
    expect(screen.getByText(`${MINUS}$1k`)).toHaveClass('text-amber-700')
  })

  it('reads a pool past its share in amber, not red (owner 10-06, open item 1)', () => {
    state = {
      data: {
        year: 2027,
        pools: [{ pool: 'pool_a', label: 'Pool A', remaining: -1017 }],
        total: 179734,
      },
      isPending: false,
      error: null,
    }
    renderAt()
    const figure = screen.getByText(`${MINUS}$1k`)
    expect(figure).toHaveClass('text-amber-700')
    expect(figure).not.toHaveClass('text-red-700')
  })

  it('opens nothing for a summary-only user (D65, D75)', () => {
    granted = ['financial_aid.summary']
    renderAt()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('$153k')).toBeInTheDocument()
  })

  it("carries the page's season and past day into each link (D15, Decision 9)", () => {
    renderAt('/aid/requests?as_of=2026-04-01')
    expect(screen.getByRole('link', { name: /Pool A/ })).toHaveAttribute(
      'href',
      '/aid/season/rounds-budget?pool=pool_a&year=2027&as_of=2026-04-01'
    )
  })

  it('shows "—", never "$0", for a pool a past-day read leaves empty (3c-2 held)', () => {
    state = {
      data: {
        year: 2027,
        pools: [{ pool: 'pool_a', label: 'Pool A', remaining: null }],
        total: null,
      },
      isPending: false,
      error: null,
    }
    renderAt('/aid/requests?as_of=2026-04-01')
    expect(screen.getByRole('link', { name: 'Pool A —' })).toBeInTheDocument()
  })

  // jsdom has no layout: this pins the classes. The real proof is the 1280px measurement.
  it('ends in an ellipsis rather than push the page sideways when the bar is crowded', () => {
    state = { data: { year: 2027, pools: [], total: null }, isPending: false, error: null }
    renderAt()
    expect(screen.getByTestId('remaining-line')).toHaveClass('min-w-0', 'truncate')
  })

  it('says "Remaining —" for a season with no approved rules yet (Review Focus 2)', () => {
    state = { data: { year: 2027, pools: [], total: null }, isPending: false, error: null }
    renderAt()
    expect(screen.getByTestId('remaining-line')).toHaveTextContent(/^Remaining\s*—$/)
  })

  it('holds its place while loading, and says so when it cannot load', () => {
    state = { isPending: true, error: null }
    const { unmount } = renderAt()
    expect(screen.getByTestId('remaining-line')).toHaveTextContent(/^Remaining\s*…$/)
    unmount()

    state = { isPending: false, error: new Error('boom') }
    renderAt()
    expect(screen.getByTestId('remaining-line')).toHaveTextContent(/^Remaining\s*unavailable$/)
  })
})
