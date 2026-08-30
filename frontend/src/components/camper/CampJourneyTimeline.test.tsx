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

// #2113: widening CAMPER_JOURNEY_TYPES to include family camp means the
// empty state and header strings can no longer read as summer-only, and
// family rows get a visual de-emphasis tag to address the "noisy for
// multi-session staff kids" concern the original exclusion was guarding.
describe('CampJourneyTimeline program-agnostic strings (#2113)', () => {
  it('shows a program-agnostic empty state, not "First summer at camp!"', () => {
    render(<CampJourneyTimeline history={[]} yearsAtCamp={0} currentYear={2026} />)
    expect(screen.queryByText(/first summer at camp/i)).toBeNull()
    expect(screen.getByText(/first year at camp/i)).toBeInTheDocument()
  })

  it('renders the header count as summers, not program-agnostic years (#2123)', () => {
    // years_at_camp counts SUMMER attendance only (#2123 ruling), so the
    // label must say so, or a family-camp row below a 0 reads as a
    // contradiction.
    render(<CampJourneyTimeline history={[]} yearsAtCamp={3} currentYear={2026} />)
    expect(screen.getByText('3 summers at camp')).toBeInTheDocument()
  })

  it('singularizes the header count for one summer (#2123)', () => {
    render(<CampJourneyTimeline history={[]} yearsAtCamp={1} currentYear={2026} />)
    expect(screen.getByText('1 summer at camp')).toBeInTheDocument()
  })

  it('does NOT tag a family-camp row — the session name already says it', () => {
    // #2113 added a "Family" chip when family rows first entered this
    // timeline, so a reader could visually skip a run of them. The mid-form
    // session name now begins "Family Camp", which says the same thing where
    // the reader is already looking. Owner, 2026-08-18: "we also dont need the
    // 'family' tag in the journey, staff knows."
    const history: HistoricalRecord[] = [
      { year: 2026, sessionName: 'Family Camp 2: Keshet LGBTQ Weekend', sessionType: 'family' },
    ]
    render(<CampJourneyTimeline history={history} yearsAtCamp={1} currentYear={2026} />)

    expect(screen.queryByText('Family')).not.toBeInTheDocument()
    expect(screen.getByText('Family Camp 2')).toBeInTheDocument()
  })

  it('prints the weekend’s subtitle beside the mid-form name', () => {
    // The half that tells two numbered weekends apart, and the half CampMinder
    // buries in a 54-character name.
    const history: HistoricalRecord[] = [
      {
        year: 2026,
        sessionName: 'Family Camp 8: JFAM Weekend w/ SFJCC (w/ kids 10 and under)',
        sessionType: 'family',
      },
    ]
    render(<CampJourneyTimeline history={history} yearsAtCamp={1} currentYear={2026} />)

    expect(screen.getByText('Family Camp 8')).toBeInTheDocument()
    expect(screen.getByText('JFAM')).toBeInTheDocument()
    // And NOT the raw 54-character name that made this timeline unreadable.
    expect(screen.queryByText(/w\/ kids 10 and under/)).not.toBeInTheDocument()
  })

  it('does not tag a summer row with the family de-emphasis label', () => {
    const history: HistoricalRecord[] = [
      { year: 2019, sessionName: 'Session 2', sessionType: 'main' },
    ]
    render(<CampJourneyTimeline history={history} yearsAtCamp={1} currentYear={2026} />)
    expect(screen.queryByText('Family')).toBeNull()
  })
})

// kindred#2466: the housing slot on a family-camp row shows the household's
// resolved cabin, never the CampMinder day group. `fetchCamperJourney` is
// what drops the day group and resolves the cabin — this component just
// renders whatever `bunkName` it's handed, generically, exactly as it does
// for a summer bunk. These two tests pin that the rendering itself needs no
// family-specific branch.
describe('CampJourneyTimeline family-camp housing (kindred#2466)', () => {
  it("renders a family row's resolved cabin name in the same housing slot as a summer bunk", () => {
    const history: HistoricalRecord[] = [
      {
        year: 2024,
        sessionName: 'Family Camp 2: Keshet Weekend',
        sessionType: 'family',
        bunkName: 'Cedar Lodge',
      },
    ]
    render(<CampJourneyTimeline history={history} yearsAtCamp={0} currentYear={2026} />)
    expect(screen.getByText('Cedar Lodge')).toBeInTheDocument()
  })

  it('shows no housing segment for a family row with nothing to show (day group dropped, not replaced)', () => {
    const history: HistoricalRecord[] = [
      { year: 2024, sessionName: 'Family Camp 2: Keshet Weekend', sessionType: 'family' },
    ]
    render(<CampJourneyTimeline history={history} yearsAtCamp={0} currentYear={2026} />)
    // No "·" separator and no day-group-shaped text — an absent `bunkName`
    // renders nothing, same as any other unlabeled row.
    expect(screen.queryAllByText('·')).toHaveLength(0)
  })
})
