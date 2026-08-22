/**
 * IdentityPanel cohort drill-down: exit-fade behavior (kindred#2529).
 *
 * The panel is otherwise covered through CamperDetail integration; this file
 * exists for the one behavior that needs the panel's own state machine — the
 * drill-down modal must stay mounted through Modal's 150ms leave transition
 * after close, which means `openKind` is a retained snapshot and a separate
 * flag drives `open`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'
import type { ReactNode } from 'react'
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

let client: QueryClient
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.clearAllMocks()
})

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <CurrentYearContext.Provider value={YEAR_CONTEXT}>{children}</CurrentYearContext.Provider>
      </BrowserRouter>
    </QueryClientProvider>
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
