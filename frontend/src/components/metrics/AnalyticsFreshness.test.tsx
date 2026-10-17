/**
 * AnalyticsFreshness — the season bar's chip on Analytics (PR 4, pick 3A): "Enrollments synced 7h
 * ago", read from the viewed season's own enrollment (attendees) run, never the hourly bunk run.
 * " · syncing now" while that run is going (owner, 2026-10-14). Nothing for a season the scheduled
 * runs don't cover, or one never synced (the empty state says that instead).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AnalyticsFreshness as Freshness } from '../../hooks/useAnalyticsFreshness'

const mockFreshness = vi.fn((_year: number): Freshness => ({ kind: 'none' }))
vi.mock('../../hooks/useAnalyticsFreshness', () => ({
  useAnalyticsFreshness: (year: number) => mockFreshness(year),
}))
const mockRefetch = vi.fn((_year: number) => undefined)
vi.mock('../../hooks/useAnalyticsSyncRefetch', () => ({
  useAnalyticsSyncRefetch: (year: number) => mockRefetch(year),
}))
vi.mock('../../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: 2027 }),
}))

import { AnalyticsFreshness } from './AnalyticsFreshness'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-27T17:04:00Z'))
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
    mockFreshness.mockReturnValue({ kind: 'synced', at: '2026-10-27T10:04:00Z', running: false })
    render(<AnalyticsFreshness />)
    expect(screen.getByText(/^Enrollments synced 7h ago$/)).toBeInTheDocument()
  })

  it('puts the absolute time in the tooltip', () => {
    mockFreshness.mockReturnValue({ kind: 'synced', at: '2026-10-27T10:04:00Z', running: false })
    render(<AnalyticsFreshness />)
    expect(screen.getByTitle(/2026-10-27T10:04:00/)).toBeInTheDocument()
  })

  it('adds " · syncing now" while the enrollment run is going', () => {
    mockFreshness.mockReturnValue({ kind: 'synced', at: '2026-10-27T10:04:00Z', running: true })
    render(<AnalyticsFreshness />)
    expect(screen.getByText(/^Enrollments synced 7h ago · syncing now$/)).toBeInTheDocument()
  })

  it('reads "Enrollments syncing now" while a run is live and no finished time is known', () => {
    mockFreshness.mockReturnValue({ kind: 'syncing' })
    render(<AnalyticsFreshness />)
    expect(screen.getByText(/^Enrollments syncing now$/)).toBeInTheDocument()
  })

  it.each([['none'], ['never'], ['loading']] as const)('renders nothing for %s', (kind) => {
    mockFreshness.mockReturnValue({ kind })
    const { container } = render(<AnalyticsFreshness />)
    expect(container).toBeEmptyDOMElement()
  })
})
