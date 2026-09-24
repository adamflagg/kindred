/**
 * IdentityPanel cohort drill-down: exit-fade behavior (kindred#2529).
 *
 * The panel is otherwise covered through CamperDetail integration; this file
 * exists for the one behavior that needs the panel's own state machine — the
 * drill-down modal must stay mounted through Modal's 150ms leave transition
 * after close, which means `openKind` is a retained snapshot and a separate
 * flag drives `open`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createWrapper } from '../../test/testUtils'
import { CurrentYearContext, type CurrentYearContextType } from '../../hooks/useCurrentYear'
import { IdentityPanel } from './IdentityPanel'
import type { Camper } from '../../types/app-types'
import { cohortsFixture, matchedAttendee } from '../../test/cohortFixtures'

const mockUseCamperCohorts = vi.fn()
vi.mock('../../hooks/useCamperCohorts', () => ({
  useCamperCohorts: (...args: unknown[]) => mockUseCamperCohorts(...args),
}))
vi.mock('../../hooks/useCohortRequestRelations', () => ({
  useCohortRequestRelations: () => ({ relations: new Map(), isLoading: false }),
}))
vi.mock('../../hooks/useCohortBunkAssignments', () => ({
  useCohortBunkAssignments: () => ({ bunkByPerson: new Map(), isLoading: false }),
}))

const YEAR_CONTEXT: CurrentYearContextType = {
  currentYear: 2026,
  setCurrentYear: vi.fn(),
  availableYears: [2026],
  isTransitioning: false,
  isYearReady: true,
}

// Compose over testUtils' shared wrapper (QueryClient + Router) rather than
// hand-rolling both — the year context is the only layer this file adds.
// `createWrapper()` is called once per TEST, not inside the wrapper body,
// so a re-render does not rebuild the QueryClient underneath assertions.
let Base: ReturnType<typeof createWrapper>
beforeEach(() => {
  Base = createWrapper()
  vi.clearAllMocks()
})

function wrapper({ children }: { children: ReactNode }) {
  return (
    <Base>
      <CurrentYearContext.Provider value={YEAR_CONTEXT}>{children}</CurrentYearContext.Provider>
    </Base>
  )
}

const camper = {
  id: 'c1',
  cm_id: 1000001,
  first_name: 'Emma',
  last_name: 'Johnson',
  birthdate: '2014-03-05',
  gender: 'F',
  grade: 6,
  school: 'Riverside Elementary',
} as unknown as Camper

const cohortContext = {
  personCmId: 1000001,
  sessionCmId: 201,
  year: 2026,
  selfDisplayName: 'Emma',
}

describe('IdentityPanel cohort drill-down exit fade (kindred#2529)', () => {
  it('keeps the drilldown painted through the exit fade after close', async () => {
    mockUseCamperCohorts.mockReturnValue({
      cohorts: cohortsFixture({
        school: {
          label: 'Riverside Elementary',
          count: 1,
          attendees: [matchedAttendee(1000002, 'Liam')],
        },
      }),
      isLoading: false,
    })

    render(
      <IdentityPanel
        camper={camper}
        location={null}
        congregation={null}
        pronouns="she/her"
        defaultExpanded
        cohortContext={cohortContext}
      />,
      { wrapper }
    )

    fireEvent.click(await screen.findByTestId('cohort-badge-school'))
    expect(await screen.findByText(/Same school: Riverside Elementary/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /close modal/i }))
    // Still painted on the frame the close fires — the retained cohort
    // snapshot is what keeps the content renderable through the leave.
    expect(screen.getByText(/Same school: Riverside Elementary/)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByText(/Same school: Riverside Elementary/)).not.toBeInTheDocument()
    })
  })
})

describe('IdentityPanel adult branch', () => {
  beforeEach(() => {
    mockUseCamperCohorts.mockReturnValue({ cohorts: null, isLoading: false })
  })

  it('hides the School row when asked', () => {
    render(
      <IdentityPanel
        camper={camper}
        location={null}
        congregation={null}
        pronouns=""
        defaultExpanded
        hideSchool
      />,
      { wrapper }
    )
    expect(screen.queryByText('School')).toBeNull()
    expect(screen.getByText('Location')).toBeInTheDocument()
  })

  it('shows the School row by default', () => {
    render(
      <IdentityPanel
        camper={camper}
        location={null}
        congregation={null}
        pronouns=""
        defaultExpanded
      />,
      {
        wrapper,
      }
    )
    expect(screen.getByText('School')).toBeInTheDocument()
  })
})

// kindred#2779: the School row's grade reads `grade_name`.
describe('IdentityPanel grade name', () => {
  beforeEach(() => {
    mockUseCamperCohorts.mockReturnValue({ cohorts: null, isLoading: false })
  })

  function renderWith(extra: Partial<Camper>) {
    render(
      <IdentityPanel
        camper={{ ...camper, ...extra }}
        location={null}
        congregation={null}
        pronouns=""
        defaultExpanded
      />,
      { wrapper }
    )
  }

  it('shows an ordinal grade as "Nth Grade"', () => {
    renderWith({ grade: 6, grade_name: '6th' })
    expect(screen.getByText('6th Grade')).toBeInTheDocument()
  })

  it('shows a kindergartner as Kindergarten, not "0th Grade"', () => {
    renderWith({ grade: 0, grade_name: 'K' })
    expect(screen.getByText('Kindergarten')).toBeInTheDocument()
    expect(screen.queryByText(/0th/)).toBeNull()
  })

  it('shows a preschooler as Pre-K', () => {
    renderWith({ grade: -1, grade_name: 'Pre-K' })
    expect(screen.getByText('Pre-K')).toBeInTheDocument()
  })

  it('shows a camper past 12th grade as Graduated', () => {
    renderWith({ grade: 13, grade_name: '12th+' })
    expect(screen.getByText('Graduated')).toBeInTheDocument()
  })

  it('shows no grade line when there is no grade name', () => {
    renderWith({ grade: 0, grade_name: '' })
    expect(screen.queryByText(/Grade|0th/)).toBeNull()
  })
})

// Owner ruling 2026-09-24: the record's age for a past year is the age at the
// earliest enrolled session start that year — the page computes that start
// and the year it is showing, and the panel must use both rather than the
// app's global year.
describe('IdentityPanel birthday and age', () => {
  beforeEach(() => {
    mockUseCamperCohorts.mockReturnValue({ cohorts: cohortsFixture({}), isLoading: false })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 24, 12, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const olivia = {
    ...camper,
    first_name: 'Olivia',
    last_name: 'Chen',
    age: 12.11, // the 2025 row's early-2026 snapshot
    birthdate: '2013-03-15',
  } as unknown as Camper

  it('reads a past year at the session start the page passes', () => {
    render(
      <IdentityPanel
        camper={olivia}
        location={null}
        congregation={null}
        pronouns="she/her"
        defaultExpanded
        viewingYear={2025}
        ageSessionStart="2025-07-06 07:00:00.000Z"
      />,
      { wrapper }
    )
    // The global year context says 2026; the page is showing 2025.
    expect(screen.getByText('12 years, 3 months')).toBeInTheDocument()
  })

  it('shows the stored birthdate as that calendar day in any time zone', () => {
    // `new Date('2013-03-15')` is UTC midnight — west of UTC it printed Mar 14.
    render(
      <IdentityPanel
        camper={olivia}
        location={null}
        congregation={null}
        pronouns="she/her"
        defaultExpanded
      />,
      { wrapper }
    )
    expect(screen.getByText('Mar 15, 2013')).toBeInTheDocument()
  })
})
