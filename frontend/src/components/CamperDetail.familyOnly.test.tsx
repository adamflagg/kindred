/**
 * Integration test for issue #2149: camper detail page unreachable for a
 * person whose only current-year attendee row is a family-camp session.
 *
 * Unlike CamperDetail.test.tsx (which stubs useCamperEnrollment entirely),
 * this file exercises the REAL useCamperEnrollment hook — and therefore the
 * real CAMPER_DETAIL_TYPES / buildCamperDetailSessionTypeFilter — so the bug
 * (an empty attendee-type filter early-returning allCampers: []) actually
 * reproduces here. Every other data hook is stubbed to keep the test focused.
 *
 * TDD: written BEFORE the CAMPER_DETAIL_TYPES fix, confirmed RED first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import CamperDetail from './CamperDetail'

const PERSON_CM_ID = 8000002
const YEAR = 2026

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
    useCamperHistory: () => ({ camperHistory: [] }),
    useSiblings: () => ({ siblings: [], isLoading: false, error: null }),
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

describe('CamperDetail — family-camp-only camper (#2149)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAssignmentsGetFullList.mockResolvedValue([])
    mockPersonsGetList.mockResolvedValue({
      items: [
        {
          id: 'person_pb_2',
          cm_id: PERSON_CM_ID,
          first_name: 'Noah',
          last_name: 'Smith',
          year: YEAR,
          household_id: 555,
        },
      ],
    })

    const familyAttendee = {
      id: 'att_family',
      person_id: PERSON_CM_ID,
      person: 'person_pb_2',
      session: 'sess_family',
      status: 'enrolled',
      status_id: 2,
      year: YEAR,
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      expand: {
        person: {
          id: 'person_pb_2',
          cm_id: PERSON_CM_ID,
          first_name: 'Noah',
          last_name: 'Smith',
          year: YEAR,
        },
        session: {
          id: 'sess_family',
          cm_id: 9100001,
          name: 'Family Camp Weekend',
          session_type: 'family',
          year: YEAR,
        },
      },
    }

    // Real PocketBase applies the `filter` string server-side. Replicate that
    // here instead of unconditionally returning the fixture row — otherwise
    // this test can't reproduce the bug, where CAMPER_DETAIL_TYPES omits
    // "family" and the server-side filter excludes this attendee entirely.
    mockAttendeesGetFullList.mockImplementation((opts: { filter?: string } = {}) => {
      const filter = opts.filter ?? ''
      const matches = filter.includes(
        `session.session_type = "${familyAttendee.expand.session.session_type}"`
      )
      return Promise.resolve(matches ? [familyAttendee] : [])
    })
  })

  it('renders the family enrollment instead of falling back to "no active enrollments"', async () => {
    // Tree note (partAGaps): with a `persons` row present, the actual current
    // failure mode is CamperDetail.tsx's "Show person info even if no
    // current enrollments" branch (person truthy, camper null) rendering
    // "This person has no active enrollments" — not the bare "Unable to load
    // camper details" state the issue body describes. Either way, the family
    // enrollment itself never renders; that's the bug this test pins.
    renderDetail()

    expect(await screen.findByText(/Noah/i)).toBeTruthy()
    expect(screen.queryByText(/Unable to load camper details/i)).toBeNull()
    expect(screen.queryByText(/no active enrollments/i)).toBeNull()
    expect((await screen.findAllByText(/Family Camp Weekend/i)).length).toBeGreaterThan(0)
  })
})
