/**
 * AnalyticsFreshness — the season bar's chip on Analytics (PR 4, pick 3A): "Enrollments synced 7h
 * ago", read from the viewed season's own enrollment (attendees) run, never the hourly bunk run.
 * " · syncing now" while that run is going (owner, 2026-10-14). "Not synced" for a season the scheduled
 * runs don't cover; nothing for one never synced (the empty state says that instead).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { AnalyticsFreshness as Freshness } from '../../hooks/useAnalyticsFreshness'

const mockFreshness = vi.fn((_year: number): Freshness => ({ kind: 'none' }))
vi.mock('../../hooks/useAnalyticsFreshness', () => ({
  useAnalyticsFreshness: (year: number) => mockFreshness(year),
}))
const mockRefetch = vi.fn((_year: number) => undefined)
vi.mock('../../hooks/useAnalyticsSyncRefetch', () => ({
  useAnalyticsSyncRefetch: (year: number) => mockRefetch(year),
}))
const mockStaleRefetch = vi.fn()
vi.mock('../../hooks/useViewedSeasonSyncStatus', () => ({
  useViewedSeasonSyncStatus: () => ({ kind: 'synced', scoped: {}, refetch: mockStaleRefetch }),
}))
vi.mock('../../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: 2027 }),
}))

import { forgetStaleRefetches } from '../../hooks/useLiveSync'
import { AnalyticsFreshness } from './AnalyticsFreshness'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-27T17:04:00Z'))
  mockStaleRefetch.mockReset()
  forgetStaleRefetches()
  mockFreshness.mockReset().mockReturnValue({ kind: 'none' })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('AnalyticsFreshness', () => {
  it('asks about the viewed season', () => {
    render(<AnalyticsFreshness />)
    expect(mockFreshness).toHaveBeenCalledWith(2027)
  })

  // PR 5: enrollments sync hourly, so the chip that dates them also refetches Analytics when the
  // viewed season's run finishes. It is on every Analytics page, once.
  it("refetches Analytics after the viewed season's sync", () => {
    render(<AnalyticsFreshness />)
    expect(mockRefetch).toHaveBeenCalledWith(2027)
  })

  it('reads "Enrollments synced 7h ago"', () => {
    mockFreshness.mockReturnValue({
      kind: 'synced',
      at: '2026-10-27T10:04:00Z',
      running: false,
      failed: false,
    })
    render(<AnalyticsFreshness />)
    expect(screen.getByText(/^Enrollments synced 7h ago$/)).toBeInTheDocument()
  })

  it('puts the absolute time in the tooltip', () => {
    mockFreshness.mockReturnValue({
      kind: 'synced',
      at: '2026-10-27T10:04:00Z',
      running: false,
      failed: false,
    })
    render(<AnalyticsFreshness />)
    expect(screen.getByTitle(/2026-10-27T10:04:00/)).toBeInTheDocument()
  })

  it('adds " · syncing now" while the enrollment run is going', () => {
    mockFreshness.mockReturnValue({
      kind: 'synced',
      at: '2026-10-27T10:04:00Z',
      running: true,
      failed: false,
    })
    render(<AnalyticsFreshness />)
    expect(screen.getByText(/^Enrollments synced 7h ago · syncing now$/)).toBeInTheDocument()
  })

  it('reads "Enrollments syncing now" while a run is live and no finished time is known', () => {
    mockFreshness.mockReturnValue({ kind: 'syncing' })
    render(<AnalyticsFreshness />)
    expect(screen.getByText(/^Enrollments syncing now$/)).toBeInTheDocument()
  })

  // ub:PR#3219:5 (owner, 2026-10-25): a season outside the two synced seasons says so, muted, rather
  // than showing nothing.
  it('reads "Not synced", muted, for a season outside the synced pair', () => {
    mockFreshness.mockReturnValue({ kind: 'none' })
    render(<AnalyticsFreshness />)
    const chip = screen.getByText(/^Not synced$/)
    expect(chip).not.toHaveClass('text-amber-600')
    expect(chip.closest('.text-muted-foreground')).not.toBeNull()
  })

  it.each([['never'], ['loading']] as const)('renders nothing for %s', (kind) => {
    mockFreshness.mockReturnValue({ kind })
    const { container } = render(<AnalyticsFreshness />)
    expect(container).toBeEmptyDOMElement()
  })

  // PR 5b ruling #111: an hourly sync more than 2 hours behind turns the chip amber (the live point is
  // hidden then too). The wording does not change.
  it('turns amber when the last sync is more than 2 hours old', () => {
    mockFreshness.mockReturnValue({
      kind: 'synced',
      at: '2026-10-27T15:03:00Z',
      running: false,
      failed: false,
    })
    render(<AnalyticsFreshness />)
    const chip = screen.getByText(/^Enrollments synced 2h ago$/)
    expect(chip).toHaveClass('text-amber-600')
  })

  it('stays grey within 2 hours', () => {
    mockFreshness.mockReturnValue({
      kind: 'synced',
      at: '2026-10-27T15:05:00Z',
      running: false,
      failed: false,
    })
    render(<AnalyticsFreshness />)
    const chip = screen.getByText(/^Enrollments synced 1h ago$/)
    expect(chip).not.toHaveClass('text-amber-600')
  })

  it('turns amber while the page sits open past the 2 hours', () => {
    mockFreshness.mockReturnValue({
      kind: 'synced',
      at: '2026-10-27T15:05:00Z',
      running: false,
      failed: false,
    })
    render(<AnalyticsFreshness />)
    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(screen.getByText(/^Enrollments synced 2h ago$/)).toHaveClass('text-amber-600')
  })

  // Row 1 of the scan: the chip's own page can sit open too. A sync more than 65 minutes old refetches
  // the viewed season's status once on the minute tick, so amber means the sync is behind, not the cache.
  it('refetches the status once when the shown sync is more than 65 minutes old', () => {
    mockFreshness.mockReturnValue({
      kind: 'synced',
      at: '2026-10-27T15:50:00Z',
      running: false,
      failed: false,
    })
    render(<AnalyticsFreshness />)
    expect(mockStaleRefetch).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(mockStaleRefetch).toHaveBeenCalledTimes(1)
  })

  it('does not refetch for a recent sync', () => {
    mockFreshness.mockReturnValue({
      kind: 'synced',
      at: '2026-10-27T16:30:00Z',
      running: false,
      failed: false,
    })
    render(<AnalyticsFreshness />)
    expect(mockStaleRefetch).not.toHaveBeenCalled()
  })
})
