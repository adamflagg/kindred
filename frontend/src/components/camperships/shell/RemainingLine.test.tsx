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

  it('inks an over-allocated pool in red, with a minus and no parentheses', () => {
    renderAt()
    expect(screen.getByText(`${MINUS}$1k`)).toHaveClass('text-red-700')
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
