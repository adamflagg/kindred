import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import CamperDetail from './CamperDetail'
import type { SatisfactionResponse } from '../types/satisfaction'

let mockSessionYear = 2026
let mockAttendeeYear = 2026
let mockSessionType = 'main'
// kindred#2329: which year `CamperDetail` actually asked the enrollment
// hook for. A journey-year link (`?year=2019`) must win over the app's
// global year (mocked at 2026 below) — this is how the tests below tell
// "resolved the query param" apart from "resolved the global default"
// without needing the hook itself to do any real filtering.
let lastEnrollmentYearArg: number | null = null

// Mock the camper data hooks to return a minimal fixture.
vi.mock('../hooks/camper', () => ({
  useCamperEnrollment: (_personCmId: number | null, currentYear: number) => {
    lastEnrollmentYearArg = currentYear
    return {
      enrolledCampers: [
        {
          id: 'att1',
          person_cm_id: 1000001,
          session_cm_id: 2,
          attendee_status: 'enrolled',
          year: mockAttendeeYear,
          first_name: 'Emma',
          last_name: 'Johnson',
          expand: {
            session: {
              cm_id: 2,
              name: 'Session 2',
              year: mockSessionYear,
              session_type: mockSessionType,
            },
          },
        },
      ],
      allAttendees: [],
      isLoading: false,
      error: null,
    }
  },
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
}))

vi.mock('../hooks/useCamperCohorts', () => ({
  useCamperCohorts: () => ({
    cohorts: {
      school: {
        label: 'Riverside Elementary',
        count: 3,
        attendees: [],
      },
      congregation: {
        label: 'Temple Beth Shalom',
        count: 2,
        attendees: [],
      },
      city: {
        label: 'Berkeley',
        count: 5,
        attendees: [],
      },
      sessionType: 'standard',
      allGenders: false,
    },
    isLoading: false,
  }),
}))

vi.mock('../hooks/useCohortRequestRelations', () => ({
  useCohortRequestRelations: () => ({ relations: new Map() }),
}))

vi.mock('../hooks/useCohortBunkAssignments', () => ({
  useCohortBunkAssignments: () => ({ bunkByPerson: new Map() }),
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
              normalized_school: 'Riverside Elementary',
              normalized_city: 'Berkeley',
              normalized_congregation: 'Temple Beth Shalom',
              congregation: 'Temple Beth Shalom',
            },
          ],
        }),
      getFullList: () => Promise.resolve([]),
    }),
  },
}))

vi.mock('../hooks/useScenario', () => ({
  useScenario: () => ({ currentScenario: null }),
}))

// Default response — campers map empty so getSatisfiedRequestInfo returns
// the EMPTY fallback. Reset in beforeEach so suite-level mutations don't leak.
const _defaultMockFetchWithAuth = () =>
  Promise.resolve(
    new Response(JSON.stringify({ campers: {}, session_cm_id: 0, year: 2026, scenario_id: null }))
  )

let mockFetchWithAuth: (url: string) => Promise<Response> = _defaultMockFetchWithAuth

vi.mock('../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: (url: string) => mockFetchWithAuth(url) }),
}))

let mockAuthValue: { user: unknown; isLoading: boolean; isBypassMode?: boolean } = {
  user: null,
  isLoading: false,
}
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}))

// kindred#2329: `path` defaults to the plain route every other describe
// block in this file exercises, so those callers are unaffected; the
// year-query-param tests pass an explicit `?year=` path.
function renderDetail(path = '/camper/1000001') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
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
  mockSessionType = 'main'
  lastEnrollmentYearArg = null
  // Finding #19: tests below mutate `mockFetchWithAuth`; reset to default so
  // a later test doesn't inherit a prior suite's stub state.
  mockFetchWithAuth = _defaultMockFetchWithAuth
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

describe('CamperDetail cohort badges', () => {
  beforeEach(() => {
    mockAuthValue = {
      user: { is_admin: true, cached_permissions: [] },
      isLoading: false,
    }
  })

  it('renders a cohort badge for school in the IdentityPanel', async () => {
    renderDetail()
    expect(await screen.findByTestId('cohort-badge-school')).toBeTruthy()
  })

  it('renders a cohort badge for city in the IdentityPanel', async () => {
    renderDetail()
    expect(await screen.findByTestId('cohort-badge-city')).toBeTruthy()
  })

  it('renders a cohort badge for congregation in the IdentityPanel', async () => {
    renderDetail()
    expect(await screen.findByTestId('cohort-badge-congregation')).toBeTruthy()
  })

  it('does not render the standalone cohort section on the full page', async () => {
    renderDetail()
    await screen.findByText(/Emma/i).catch(() => null)
    expect(screen.queryByTestId('camper-cohorts-section')).toBeNull()
  })

  it('opens the cohort drill-down modal centered (no side-panel reservation) when clicked from the full page', async () => {
    renderDetail()
    const badge = await screen.findByTestId('cohort-badge-school')
    fireEvent.click(badge)
    const dialog = await screen.findByRole('dialog')
    // The dialog wrapper should NOT have right-edge inset reserved for a
    // slide-out panel when the modal is opened from the full-page view.
    const inset = (dialog as HTMLElement).style.right
    expect(inset === '' || inset === '0px').toBe(true)
  })

  it('hides cohort badges when viewing historical year data', async () => {
    mockSessionYear = 2025
    mockAttendeeYear = 2025
    renderDetail()
    await screen.findByText(/Emma/i).catch(() => null)
    expect(screen.queryByTestId('cohort-badge-school')).toBeNull()
    expect(screen.queryByTestId('cohort-badge-city')).toBeNull()
    expect(screen.queryByTestId('cohort-badge-congregation')).toBeNull()
  })
})

describe('CamperDetail satisfaction summary', () => {
  beforeEach(() => {
    mockAuthValue = {
      user: { is_admin: false, cached_permissions: ['bunking.manage'] },
      isLoading: false,
    }
  })

  it('renders X/Y met summary on standalone /camper/:id route when provider supplies satisfaction data', async () => {
    // BunkRequestProvider fetches /api/satisfaction — mock it to return 1 material_parent
    // request with satisfied=1, total=2 for person 1000001 (session_cm_id=2 from fixture).
    const satisfactionPayload: SatisfactionResponse = {
      campers: {
        1000001: {
          person_cm_id: 1000001,
          per_request: [],
          counted_totals: {
            material_parent: { satisfied: 1, total: 2 },
            staff: { satisfied: 0, total: 0 },
          },
          immaterial: { satisfied: 0, total: 0 },
          flags: {
            parent_min_one_violation: true,
            staff_unsatisfied_alert: false,
            has_any_counted_request: true,
          },
        },
      },
      session_cm_id: 2,
      year: 2026,
      scenario_id: null,
    }
    mockFetchWithAuth = () =>
      Promise.resolve(
        new Response(JSON.stringify(satisfactionPayload), {
          headers: { 'Content-Type': 'application/json' },
        })
      )

    renderDetail()
    // "1/2 met" should appear once the provider resolves and BunkingStatusPanel renders
    expect(await screen.findByText(/1\/2 met/i)).toBeTruthy()
  })
})

describe('CamperDetail teen programs', () => {
  beforeEach(() => {
    mockAuthValue = { user: { is_admin: true, cached_permissions: [] }, isLoading: false }
  })

  it('hides bunking panels and cohort context for a teen-program (scit) camper', async () => {
    mockSessionType = 'scit'
    renderDetail()
    // Journey still renders (identity + journey + siblings are kept).
    expect(await screen.findByText(/Camp Journey/i)).toBeTruthy()
    // Bunking panels are gone for teens.
    expect(screen.queryByText(/Parsed Bunk Requests/i)).toBeNull()
    expect(screen.queryByText(/Raw Bunking Data/i)).toBeNull()
    // cohortContext is suppressed → no cohort badges.
    expect(screen.queryByTestId('cohort-badge-school')).toBeNull()
  })

  it('keeps bunking panels for a normal summer (main) camper', async () => {
    mockSessionType = 'main'
    renderDetail()
    expect(await screen.findByText(/Parsed Bunk Requests/i)).toBeTruthy()
  })
})

describe('CamperDetail ?year= query param (kindred#2329)', () => {
  beforeEach(() => {
    mockAuthValue = { user: { is_admin: true, cached_permissions: [] }, isLoading: false }
  })

  it('prefers the ?year= query param over the app-global year when fetching enrollment', async () => {
    renderDetail('/camper/1000001?year=2019')
    await screen.findByText(/Emma/i).catch(() => null)

    // The global year is mocked at 2026 (see `useYear` mock above) — 2019
    // proves the query param won, not the fallback.
    expect(lastEnrollmentYearArg).toBe(2019)
  })

  it('falls back to the app-global year when no ?year= param is present', async () => {
    renderDetail('/camper/1000001')
    await screen.findByText(/Emma/i).catch(() => null)

    expect(lastEnrollmentYearArg).toBe(2026)
  })

  it('ignores a malformed ?year= and falls back to the global year rather than fetching NaN', async () => {
    renderDetail('/camper/1000001?year=not-a-year')
    await screen.findByText(/Emma/i).catch(() => null)

    expect(lastEnrollmentYearArg).toBe(2026)
  })

  it('shows the historical-data banner when the requested year differs from the global year', async () => {
    // Simulates what a real, year-filtered fetch would return for a 2019
    // link: an attendee row whose own session year is 2019, against the
    // app's global year of 2026.
    mockSessionYear = 2019
    mockAttendeeYear = 2019
    renderDetail('/camper/1000001?year=2019')

    expect(await screen.findByText(/viewing historical data from 2019/i)).toBeInTheDocument()
  })

  it('does not show the historical-data banner on the plain (no query param) route', async () => {
    renderDetail('/camper/1000001')
    await screen.findByText(/Emma/i).catch(() => null)

    expect(screen.queryByText(/viewing historical data/i)).toBeNull()
  })
})
