/**
 * Q8 (owner, 2026-09-22 late): rows that are already here render immediately
 * — the spinner is only for the true "nothing yet" case. Shared by
 * `CampJourneyTimeline` and the board modal's Camp Journey section.
 */
import { describe, it, expect } from 'vitest'
import { journeyDisplayState } from './journeyRowModel'

describe('journeyDisplayState', () => {
  it('shows rows whenever there is at least one, even while still loading', () => {
    expect(journeyDisplayState(1, true, null)).toBe('rows')
  })

  it('shows rows over an error too, so the error line renders below them', () => {
    expect(journeyDisplayState(2, false, new Error('boom'))).toBe('rows')
  })

  it('shows the spinner only when there are no rows yet', () => {
    expect(journeyDisplayState(0, true, null)).toBe('loading')
  })

  it('shows the error line when there are no rows and nothing is loading', () => {
    expect(journeyDisplayState(0, false, new Error('boom'))).toBe('error')
  })

  it('shows the empty state when there is nothing to show at all', () => {
    expect(journeyDisplayState(0, false, null)).toBe('empty')
  })
})
