/**
 * Tests for CampJourneyTimeline display rules (spec §8).
 * TDD: written before the bunk-segment guard.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { CampJourneyTimeline } from './CampJourneyTimeline'
import type { HistoricalRecord } from '../../hooks/camper/types'

describe('CampJourneyTimeline display rules (spec §8)', () => {
  it('hides the bunk segment for a no-bunk prior year but still lists the row', () => {
    const history: HistoricalRecord[] = [
      { year: 2023, sessionName: 'Session 3', sessionType: 'main', bunkName: 'G-8B' },
      { year: 2022, sessionName: 'Session 4', sessionType: 'main' }, // no bunk
    ]
    render(
      <CampJourneyTimeline
        history={history}
        counts={{ summers: 3, familyWeekends: 0, adultWeekends: 0 }}
        currentYear={2026}
      />
    )
    expect(screen.getByText('G-8B')).toBeInTheDocument()
    expect(screen.getByText('2022')).toBeInTheDocument() // row still listed
    expect(screen.queryByText('Unassigned')).toBeNull()
    // Ruled change (owner, 2026-09-22, G2): the journey is ONE grid and the
    // "·" separator is gone — the cabin column itself is the segment. Only the
    // labeled (G-8B) row's cabin cell holds anything; the no-bunk row's cell
    // is present (it keeps the grid aligned) but empty.
    const cabinCells = screen.getAllByTestId('journey-cabin-cell')
    expect(cabinCells).toHaveLength(2)
    expect(cabinCells[0]?.textContent).toBe('G-8B')
    expect(cabinCells[1]?.textContent).toBe('')
    expect(screen.queryAllByText('·')).toHaveLength(0)
  })

  it('still renders Unassigned for a current-year bunkable row not yet placed', () => {
    const history: HistoricalRecord[] = [
      { year: 2026, sessionName: 'Session Now', sessionType: 'main', bunkName: 'Unassigned' },
    ]
    render(
      <CampJourneyTimeline
        history={history}
        counts={{ summers: 1, familyWeekends: 0, adultWeekends: 0 }}
        currentYear={2026}
      />
    )
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
  })
})

// #2113: widening CAMPER_JOURNEY_TYPES to include family camp means the
// empty state and header strings can no longer read as summer-only, and
// family rows get a visual de-emphasis tag to address the "noisy for
// multi-session staff kids" concern the original exclusion was guarding.
describe('CampJourneyTimeline program-agnostic strings (#2113)', () => {
  it('shows a program-agnostic empty state, not "First summer at camp!"', () => {
    render(
      <CampJourneyTimeline
        history={[]}
        counts={{ summers: 0, familyWeekends: 0, adultWeekends: 0 }}
        currentYear={2026}
      />
    )
    expect(screen.queryByText(/first summer at camp/i)).toBeNull()
    expect(screen.getByText(/first year at camp/i)).toBeInTheDocument()
  })

  it('renders the header count as summers, not program-agnostic years (#2123)', () => {
    // years_at_camp counts SUMMER attendance only (#2123 ruling), so the
    // label must say so, or a family-camp row below a 0 reads as a
    // contradiction. "at camp" is dropped from the shared count line.
    render(
      <CampJourneyTimeline
        history={[]}
        counts={{ summers: 3, familyWeekends: 0, adultWeekends: 0 }}
        currentYear={2026}
      />
    )
    expect(screen.getByText('3 summers')).toBeInTheDocument()
  })

  it('singularizes the header count for one summer (#2123)', () => {
    render(
      <CampJourneyTimeline
        history={[]}
        counts={{ summers: 1, familyWeekends: 0, adultWeekends: 0 }}
        currentYear={2026}
      />
    )
    expect(screen.getByText('1 summer')).toBeInTheDocument()
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
    render(
      <CampJourneyTimeline
        history={history}
        counts={{ summers: 1, familyWeekends: 0, adultWeekends: 0 }}
        currentYear={2026}
      />
    )

    expect(screen.queryByText('Family')).not.toBeInTheDocument()
    expect(screen.getByText('Family Camp 2')).toBeInTheDocument()
  })

  it('prints the weekend’s subtitle with the mid-form name', () => {
    // The half that tells two numbered weekends apart, and the half CampMinder
    // buries in a 54-character name. (Owner, 2026-09-22, G2: it now sits UNDER
    // the name rather than beside it — pinned in the G2 block below.)
    const history: HistoricalRecord[] = [
      {
        year: 2026,
        sessionName: 'Family Camp 8: JFAM Weekend w/ SFJCC (w/ kids 10 and under)',
        sessionType: 'family',
      },
    ]
    render(
      <CampJourneyTimeline
        history={history}
        counts={{ summers: 1, familyWeekends: 0, adultWeekends: 0 }}
        currentYear={2026}
      />
    )

    expect(screen.getByText('Family Camp 8')).toBeInTheDocument()
    expect(screen.getByText('JFAM')).toBeInTheDocument()
    // And NOT the raw 54-character name that made this timeline unreadable.
    expect(screen.queryByText(/w\/ kids 10 and under/)).not.toBeInTheDocument()
  })

  it('does not tag a summer row with the family de-emphasis label', () => {
    const history: HistoricalRecord[] = [
      { year: 2019, sessionName: 'Session 2', sessionType: 'main' },
    ]
    render(
      <CampJourneyTimeline
        history={history}
        counts={{ summers: 1, familyWeekends: 0, adultWeekends: 0 }}
        currentYear={2026}
      />
    )
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
    render(
      <CampJourneyTimeline
        history={history}
        counts={{ summers: 0, familyWeekends: 0, adultWeekends: 0 }}
        currentYear={2026}
      />
    )
    expect(screen.getByText('Cedar Lodge')).toBeInTheDocument()
  })

  it('shows no housing segment for a family row with nothing to show (day group dropped, not replaced)', () => {
    const history: HistoricalRecord[] = [
      { year: 2024, sessionName: 'Family Camp 2: Keshet Weekend', sessionType: 'family' },
    ]
    render(
      <CampJourneyTimeline
        history={history}
        counts={{ summers: 0, familyWeekends: 0, adultWeekends: 0 }}
        currentYear={2026}
      />
    )
    // An absent `bunkName` renders nothing, same as any other unlabeled row.
    // Ruled change (owner, 2026-09-22, G2): with no "·" separator any more,
    // "nothing" means an EMPTY cabin cell — the cell stays so the grid lines up.
    expect(screen.getByTestId('journey-cabin-cell').textContent).toBe('')
    expect(screen.queryAllByText('·')).toHaveLength(0)
  })
})

describe('CampJourneyTimeline count line', () => {
  it('shows the shared label', () => {
    render(
      <CampJourneyTimeline
        history={[]}
        counts={{ summers: 3, familyWeekends: 0, adultWeekends: 2 }}
        currentYear={2026}
      />
    )
    expect(screen.getByText('3 summers · 2 adult weekends')).toBeInTheDocument()
  })

  it('renders no count line when every count is zero', () => {
    const { container } = render(
      <CampJourneyTimeline
        history={[]}
        counts={{ summers: 0, familyWeekends: 0, adultWeekends: 0 }}
        currentYear={2026}
      />
    )
    expect(screen.queryByText(/summer|weekend/)).toBeNull()
    // No empty count <p> under the title either (it is the only text-forest-200 <p>).
    expect(container.querySelector('p.text-forest-200')).toBeNull()
  })
})

// While the journey loads, an empty history means "not here yet", not "first
// year" — reading the empty state then made every returning adult weekend
// guest look like a first-timer on the weekend sidebar.
describe('CampJourneyTimeline while the journey loads', () => {
  it('shows the loading spinner, not "First year at camp!"', () => {
    render(
      <CampJourneyTimeline
        history={[]}
        counts={{ summers: 0, familyWeekends: 0, adultWeekends: 0 }}
        currentYear={2026}
        isLoading
      />
    )
    expect(screen.queryByText(/first year at camp/i)).toBeNull()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders no rows while loading', () => {
    render(
      <CampJourneyTimeline
        history={[{ year: 2024, sessionName: 'Session 3', sessionType: 'main', bunkName: 'G-8B' }]}
        counts={{ summers: 1, familyWeekends: 0, adultWeekends: 0 }}
        currentYear={2026}
        isLoading
      />
    )
    expect(screen.queryByText('G-8B')).toBeNull()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('shows the empty state once loading is done', () => {
    render(
      <CampJourneyTimeline
        history={[]}
        counts={{ summers: 0, familyWeekends: 0, adultWeekends: 0 }}
        currentYear={2026}
        isLoading={false}
      />
    )
    expect(screen.getByText(/first year at camp/i)).toBeInTheDocument()
    expect(screen.queryByText('Loading...')).toBeNull()
  })
})

// kindred#2332 pattern, owner ruling 2026-09-22 (evening): the cabin label is
// TODAY's registry name; the string staff actually typed that season shows
// only in a hover tooltip, and only where the two disagree — the same
// affordance `HouseholdJourneyCard` offers on the weekend board.
describe('CampJourneyTimeline cabin provenance (kindred#2332 pattern)', () => {
  it('offers the as-typed string in a tooltip when it disagrees with the label', () => {
    const history: HistoricalRecord[] = [
      {
        year: 2022,
        sessionName: "Women's Weekend",
        sessionType: 'adult',
        bunkName: 'Meadow House 1',
        bunkNameRecorded: 'Old Meadow 1',
      },
    ]
    render(
      <CampJourneyTimeline
        history={history}
        counts={{ summers: 0, familyWeekends: 0, adultWeekends: 1 }}
        currentYear={2026}
      />
    )

    const trigger = screen.getByTestId('camp-journey-cabin-provenance')
    expect(trigger.textContent).toBe('Meadow House 1')

    fireEvent.pointerEnter(trigger)

    expect(screen.getByRole('tooltip').textContent).toContain('Old Meadow 1')
  })

  it('renders no tooltip trigger when nothing was recorded differently', () => {
    const history: HistoricalRecord[] = [
      { year: 2024, sessionName: "Women's Weekend", sessionType: 'adult', bunkName: 'River F' },
    ]
    render(
      <CampJourneyTimeline
        history={history}
        counts={{ summers: 0, familyWeekends: 0, adultWeekends: 1 }}
        currentYear={2026}
      />
    )

    expect(screen.queryByTestId('camp-journey-cabin-provenance')).toBeNull()
    expect(screen.getByText('River F')).toBeInTheDocument()
  })

  it('offers the same tooltip on a family row whose cabin was renamed', () => {
    const history: HistoricalRecord[] = [
      {
        year: 2022,
        sessionName: 'Family Camp 2: Keshet Weekend',
        sessionType: 'family',
        bunkName: 'Meadow House 1',
        bunkNameRecorded: 'Old Meadow 1',
      },
    ]
    render(
      <CampJourneyTimeline
        history={history}
        counts={{ summers: 0, familyWeekends: 1, adultWeekends: 0 }}
        currentYear={2026}
      />
    )

    const trigger = screen.getByTestId('camp-journey-cabin-provenance')
    fireEvent.pointerEnter(trigger)

    expect(screen.getByRole('tooltip').textContent).toContain('Old Meadow 1')
  })

  it('lets the cabin segment shrink so a long label ellipsizes instead of overflowing', () => {
    const history: HistoricalRecord[] = [
      { year: 2024, sessionName: 'Session 3', sessionType: 'main', bunkName: 'G-8B' },
    ]
    render(
      <CampJourneyTimeline
        history={history}
        counts={{ summers: 1, familyWeekends: 0, adultWeekends: 0 }}
        currentYear={2026}
      />
    )

    const cabinSpan = screen.getByText('G-8B')
    expect(cabinSpan.className).toContain('min-w-0')
    // `text-overflow` (Tailwind's `truncate`) does nothing on a
    // `display:flex` container (I1) — the element that holds the TEXT must
    // carry `truncate` itself and must not itself be a flex container.
    expect(cabinSpan.className).toContain('truncate')
    expect(cabinSpan.className.split(' ')).not.toContain('flex')
  })

  it('lets the session segment shrink too, the same way as the cabin segment', () => {
    const history: HistoricalRecord[] = [
      { year: 2024, sessionName: 'Session 3', sessionType: 'main', bunkName: 'G-8B' },
    ]
    render(
      <CampJourneyTimeline
        history={history}
        counts={{ summers: 1, familyWeekends: 0, adultWeekends: 0 }}
        currentYear={2026}
      />
    )

    const sessionSpan = screen.getByText('Session 3')
    expect(sessionSpan.className).toContain('min-w-0')
  })
})

// Owner ruling 2026-09-22, option G2 (docs mockup "journey alignment"): the
// whole journey is ONE CSS grid — dot | year | session | cabin | badge — so
// every cabin starts on the same vertical line, whatever the session name
// beside it. jsdom cannot measure layout, so these pin the STRUCTURE that
// produces the alignment. `data-col` / `data-testid` are query handles (test
// infrastructure, not accessibility).
describe('CampJourneyTimeline one-grid layout (owner ruling 2026-09-22, G2)', () => {
  const history: HistoricalRecord[] = [
    { year: 2025, sessionName: 'Session 2', sessionType: 'main', bunkName: 'B-4' },
    {
      year: 2024,
      sessionName: 'Family Camp 8: JFAM Weekend w/ SFJCC (w/ kids 10 and under)',
      sessionType: 'family',
      bunkName: 'Cedar Lodge',
    },
    { year: 2024, sessionName: 'Session 3a', sessionType: 'main', bunkName: 'B-Bet' },
    { year: 2023, sessionName: 'Session 4', sessionType: 'main' },
  ]

  function renderTimeline() {
    render(
      <CampJourneyTimeline
        history={history}
        counts={{ summers: 3, familyWeekends: 1, adultWeekends: 0 }}
        currentYear={2026}
      />
    )
    return screen.getByTestId('journey-rows')
  }

  it('renders every row inside ONE grid container', () => {
    const grid = renderTimeline()
    expect(grid.className.split(' ')).toContain('grid')
    // The ruled track template: the session column is as wide as its widest
    // entry, the cabin column takes the rest and truncates.
    expect(grid.className).toContain('minmax(0,max-content)')
    expect(grid.className).toContain('minmax(0,1fr)')
  })

  it('has no per-row wrapper — every direct child is a cell of the one grid', () => {
    const grid = renderTimeline()
    const cells = Array.from(grid.children)
    // Five cells per row: dot | year | session | cabin | badge.
    expect(cells).toHaveLength(history.length * 5)
    expect(cells.map((c) => c.getAttribute('data-col'))).toEqual(
      history.flatMap(() => ['dot', 'year', 'session', 'cabin', 'badge'])
    )
  })

  it("puts row N's cabin and row N+1's cabin in the same grid", () => {
    const grid = renderTimeline()
    const cabins = screen.getAllByTestId('journey-cabin-cell')
    expect(cabins).toHaveLength(history.length)
    for (const cabin of cabins) expect(cabin.parentElement).toBe(grid)
    expect(within(cabins[0] as HTMLElement).getByText('B-4')).toBeInTheDocument()
    expect(within(cabins[2] as HTMLElement).getByText('B-Bet')).toBeInTheDocument()
  })

  it("stacks a family weekend's subtitle under its name, inside the session cell", () => {
    const grid = renderTimeline()
    const subtitle = screen.getByText('JFAM')
    const name = screen.getByText('Family Camp 8')
    const sessionCell = subtitle.closest('[data-col]')
    expect(sessionCell?.getAttribute('data-col')).toBe('session')
    expect(name.closest('[data-col]')).toBe(sessionCell)
    // After the name, not before it.
    expect(name.compareDocumentPosition(subtitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // A child of the session cell, never a sibling of the cabin cell.
    expect(subtitle.parentElement).not.toBe(grid)
    // Stacked: the cell is a column, so the subtitle sits UNDER the name.
    expect(sessionCell?.className).toContain('flex-col')
  })

  it('holds "Now" and a status letter in the badge column', () => {
    render(
      <CampJourneyTimeline
        history={[
          { year: 2026, sessionName: 'Session 2', sessionType: 'main', bunkName: 'B-4' },
          {
            year: 2025,
            sessionName: 'Session 3',
            sessionType: 'main',
            attendeeStatus: 'waitlisted',
          },
        ]}
        counts={{ summers: 1, familyWeekends: 0, adultWeekends: 0 }}
        currentYear={2026}
      />
    )
    expect(screen.getByText('Now').closest('[data-col]')?.getAttribute('data-col')).toBe('badge')
    expect(screen.getByText('W').closest('[data-col]')?.getAttribute('data-col')).toBe('badge')
  })
})
