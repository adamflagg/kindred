/**
 * Integration test for the adult camper journey: camper detail page for a
 * person whose only current-year attendee row is an adult-program session
 * (Women's/Men's Weekend etc.) — the adult-camper-journey counterpart of
 * CamperDetail.familyOnly.test.tsx (#2149).
 *
 * Unlike CamperDetail.test.tsx (which stubs useCamperEnrollment entirely),
 * this file exercises the REAL useCamperEnrollment hook — and therefore the
 * real CAMPER_DETAIL_TYPES / buildCamperDetailSessionTypeFilter — so the bug
 * (an empty attendee-type filter early-returning allCampers: []) actually
 * reproduces here. Every other data hook is stubbed to keep the test focused.
 *
 * TDD: written BEFORE the adult-branch implementation, confirmed RED first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import { EMPTY_JOURNEY_COUNTS } from '../utils/journeyCountLabel'
import CamperDetail from './CamperDetail'

const PERSON_CM_ID = 8000003
const YEAR = 2026

/** Whether the stubbed useCamperHistory reports the journey as still loading. */
const historyLoading = { value: false }
/** Every argument list useSiblings was called with. */
const siblingsCalls: unknown[][] = []

const mockAttendeesGetFullList = vi.fn()
const mockAssignmentsGetFullList = vi.fn()
const mockPersonsGetList = vi.fn()

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn((name: string) => {
      if (name === 'attendees') return { getFullList: mockAttendeesGetFullList }
      if (name === 'bunk_assignments') return { getFullList: mockAssignmentsGetFullList }
      if (name === 'persons') return { getList: mockPersonsGetList }
      // Every other collection used by stubbed-out hooks: benign empty responses.
      return {
        getFullList: vi.fn().mockResolvedValue([]),
        getList: vi.fn().mockResolvedValue({ items: [] }),
      }
    }),
  },
}))

// useCamperEnrollment is intentionally NOT overridden — that's the hook under test.
vi.mock('../hooks/camper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/camper')>()
  return {
    ...actual,
    useCamperHistory: () => ({
      camperHistory: [],
      counts: EMPTY_JOURNEY_COUNTS,
      isLoading: historyLoading.value,
    }),
    useSiblings: (...args: unknown[]) => {
      siblingsCalls.push(args)
      return { siblings: [], isLoading: false, error: null }
    },
    useOriginalBunkData: () => ({ originalBunkData: null, isLoading: false, error: null }),
    useAllBunkRequests: () => ({ allBunkRequests: [], isLoading: false, error: null }),
  }
})

vi.mock('../hooks/useCamperCohorts', () => ({
  useCamperCohorts: () => ({ cohorts: null, isLoading: false }),
}))
vi.mock('../hooks/useCohortRequestRelations', () => ({
  useCohortRequestRelations: () => ({ relations: new Map() }),
}))
vi.mock('../hooks/useCohortBunkAssignments', () => ({
  useCohortBunkAssignments: () => ({ bunkByPerson: new Map() }),
}))
vi.mock('../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({
    currentYear: YEAR,
    setCurrentYear: () => {},
    availableYears: [YEAR],
    isTransitioning: false,
    isYearReady: true,
  }),
  useYear: () => YEAR,
}))
vi.mock('../hooks/useScenario', () => ({
  useScenario: () => ({ currentScenario: null }),
}))
vi.mock('../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ campers: {}, session_cm_id: 0, year: YEAR, scenario_id: null })
        )
      ),
  }),
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_admin: true, cached_permissions: [] }, isLoading: false }),
}))

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/camper/${PERSON_CM_ID}`]}>
        <Routes>
          <Route path="/camper/:camperId" element={<CamperDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('CamperDetail — adult-program-only person (adult camper journey)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    historyLoading.value = false
    siblingsCalls.length = 0
    mockAssignmentsGetFullList.mockResolvedValue([])
    mockPersonsGetList.mockResolvedValue({
      items: [
        {
          id: 'person_pb_3',
          cm_id: PERSON_CM_ID,
          first_name: 'Olivia',
          last_name: 'Garcia',
          year: YEAR,
          household_id: 555,
        },
      ],
    })

    const adultAttendee = {
      id: 'att_adult',
      person_id: PERSON_CM_ID,
      person: 'person_pb_3',
      session: 'sess_ww',
      status: 'enrolled',
      status_id: 2,
      year: YEAR,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      expand: {
        person: {
          id: 'person_pb_3',
          cm_id: PERSON_CM_ID,
          first_name: 'Olivia',
          last_name: 'Garcia',
          year: YEAR,
        },
        session: {
          id: 'sess_ww',
          cm_id: 9200001,
          name: "Women's Weekend",
          session_type: 'adult',
          year: YEAR,
        },
      },
    }

    // Real PocketBase applies the `filter` string server-side. Replicate that
    // here instead of unconditionally returning the fixture row — otherwise
    // this test can't reproduce the bug, where CAMPER_DETAIL_TYPES omits
    // "adult" and the server-side filter excludes this attendee entirely.
    mockAttendeesGetFullList.mockImplementation((opts: { filter?: string } = {}) => {
      const filter = opts.filter ?? ''
      const matches = filter.includes(
        `session.session_type = "${adultAttendee.expand.session.session_type}"`
      )
      return Promise.resolve(matches ? [adultAttendee] : [])
    })
  })

  it('loads instead of falling back to "no active enrollments"', async () => {
    renderDetail()
    expect(await screen.findByText(/Olivia/i)).toBeTruthy()
    expect(screen.queryByText(/no active enrollments/i)).toBeNull()
  })

  it('skips the camper-only parts: no School row, no grade, no Bunking Status', async () => {
    renderDetail()
    await screen.findByText(/Olivia/i)
    expect(screen.queryByText('School')).toBeNull()
    expect(screen.queryByText(/Grade/)).toBeNull()
    expect(screen.queryByText(/Bunking Status/i)).toBeNull()
  })

  it('titles the siblings panel "Household"', async () => {
    renderDetail()
    await screen.findByText(/Olivia/i)
    expect(screen.getByText('Household')).toBeInTheDocument()
  })

  it("asks useSiblings for the adult viewer's set (Household includes adults)", async () => {
    renderDetail()
    await screen.findByText('Household')
    expect(siblingsCalls.length).toBeGreaterThan(0)
    expect(siblingsCalls.at(-1)?.[3]).toBe('adult')
  })

  it('passes the journey loading state to the timeline — no "First year at camp!" while it loads', async () => {
    historyLoading.value = true
    renderDetail()
    await screen.findByText('Household')
    expect(screen.queryByText(/first year at camp/i)).toBeNull()
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('shows the empty journey once it has loaded', async () => {
    renderDetail()
    await screen.findByText('Household')
    expect(screen.getByText(/first year at camp/i)).toBeInTheDocument()
  })
})
