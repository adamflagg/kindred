/**
 * Tests for CampJourneyTimeline display rules (spec §8).
 * TDD: written before the bunk-segment guard.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CampJourneyTimeline } from './CampJourneyTimeline'
import type { HistoricalRecord } from '../../hooks/camper/types'

describe('CampJourneyTimeline display rules (spec §8)', () => {
  it('hides the bunk segment for a no-bunk prior year but still lists the row', () => {
    const history: HistoricalRecord[] = [
      { year: 2023, sessionName: 'Session 3', sessionType: 'main', bunkName: 'G-8B' },
      { year: 2022, sessionName: 'Session 4', sessionType: 'main' }, // no bunk
    ]
    render(<CampJourneyTimeline history={history} yearsAtCamp={3} currentYear={2026} />)
    expect(screen.getByText('G-8B')).toBeInTheDocument()
    expect(screen.getByText('2022')).toBeInTheDocument() // row still listed
    expect(screen.queryByText('Unassigned')).toBeNull()
    // The "·" bunk separator renders only for the labeled (G-8B) row — not the
    // no-bunk row. (Old code rendered it for every enrolled row → length 2.)
    expect(screen.queryAllByText('·')).toHaveLength(1)
  })

  it('still renders Unassigned for a current-year bunkable row not yet placed', () => {
    const history: HistoricalRecord[] = [
      { year: 2026, sessionName: 'Session Now', sessionType: 'main', bunkName: 'Unassigned' },
    ]
    render(<CampJourneyTimeline history={history} yearsAtCamp={1} currentYear={2026} />)
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })
})
