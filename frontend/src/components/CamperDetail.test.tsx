import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import CamperDetail from './CamperDetail'

let mockSessionYear = 2026
let mockAttendeeYear = 2026

// Mock the camper data hooks to return a minimal fixture.
vi.mock('../hooks/camper', () => ({
  useCamperEnrollment: () => ({
    enrolledCampers: [
      {
        id: 'att1',
        person_cm_id: 1000001,
        session_cm_id: 2,
        attendee_status: 'enrolled',
        year: mockAttendeeYear,
        first_name: 'Emma',
        last_name: 'Johnson',
        expand: { session: { cm_id: 2, name: 'Session 2', year: mockSessionYear } },
      },
    ],
    allAttendees: [],
    isLoading: false,
    error: null,
  }),
  useCamperHistory: () => ({ camperHistory: [] }),
  useSiblings: () => ({ siblings: [], isLoading: false, error: null }),
  useOriginalBunkData: () => ({
    originalBunkData: {
      share_bunk_with: 'fixture',
      person_cm_id: 1000001,
      first_name: 'Emma',
      last_name: 'Johnson',
    },
    isLoading: false,
    error: null,
  }),
  useAllBunkRequests: () => ({ allBunkRequests: [], isLoading: false, error: null }),
  useSatisfactionData: () => ({ satisfactionData: {}, satisfactionLoading: false }),
}))

vi.mock('../hooks/useCamperCohorts', () => ({
  useCamperCohorts: () => ({
    cohorts: {
      school: {
        label: 'Riverside Elementary',
        count: 3,
        attendees: [],
      },
      congregation: null,
      city: null,
      sessionType: 'standard',
      allGenders: false,
    },
    isLoading: false,
  }),
}))

vi.mock('../hooks/useCohortRequestRelations', () => ({
  useCohortRequestRelations: () => ({ relations: {} }),
}))

vi.mock('../hooks/useCohortBunkAssignments', () => ({
  useCohortBunkAssignments: () => ({ bunkByPerson: {} }),
}))

vi.mock('../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({
    currentYear: 2026,
    setCurrentYear: () => {},
    availableYears: [2026],
    isTransitioning: false,
    isYearReady: true,
  }),
  useYear: () => 2026,
}))

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: () => ({
      getList: () =>
        Promise.resolve({
          items: [
            {
              cm_id: 1000001,
              first_name: 'Emma',
              last_name: 'Johnson',
              year: 2026,
            },
          ],
        }),
    }),
  },
}))

let mockAuthValue: { user: unknown; isLoading: boolean; isBypassMode?: boolean } = {
  user: null,
  isLoading: false,
}
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}))

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/camper/1000001']}>
        <Routes>
          <Route path="/camper/:camperId" element={<CamperDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockAuthValue = { user: null, isLoading: false }
  mockSessionYear = 2026
  mockAttendeeYear = 2026
})

describe('CamperDetail permission gates', () => {
  it('hides Parsed Bunk Requests panel for users with only bunking.manage', async () => {
    mockAuthValue = {
      user: { is_admin: false, cached_permissions: ['bunking.manage'] },
      isLoading: false,
    }
    renderDetail()
    // Wait for something from the page to resolve first so any async renders settle.
    await screen.findByText(/Emma/i).catch(() => null)
    expect(screen.queryByText(/Parsed Bunk Requests/i)).toBeNull()
  })

  it('shows Parsed Bunk Requests panel for admins', async () => {
    mockAuthValue = {
      user: { is_admin: true, cached_permissions: [] },
      isLoading: false,
    }
    renderDetail()
    expect(await screen.findByText(/Parsed Bunk Requests/i)).toBeTruthy()
  })

  it('shows Raw Bunking Data for users with bunking.manage', async () => {
    mockAuthValue = {
      user: { is_admin: false, cached_permissions: ['bunking.manage'] },
      isLoading: false,
    }
    renderDetail()
    expect(await screen.findByText(/Raw Bunking Data/i)).toBeTruthy()
  })
})

describe('CamperDetail cohort rows', () => {
  it('shows the cohort section for an enrolled current-year camper', async () => {
    mockAuthValue = {
      user: { is_admin: true, cached_permissions: [] },
      isLoading: false,
    }
    renderDetail()
    expect(await screen.findByTestId('camper-cohorts-section')).toBeTruthy()
  })

  it('hides the cohort section when viewing historical year data', async () => {
    mockAuthValue = {
      user: { is_admin: true, cached_permissions: [] },
      isLoading: false,
    }
    mockSessionYear = 2025
    mockAttendeeYear = 2025
    renderDetail()
    await screen.findByText(/Emma/i).catch(() => null)
    expect(screen.queryByTestId('camper-cohorts-section')).toBeNull()
  })
})
