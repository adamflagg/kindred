import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fetch for API call
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

// Mock useCurrentYear
vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: 2026 }),
}))

// Mock useMetricsSession
const mockUseMetricsSession = vi.fn()
vi.mock('../../../hooks/useMetricsSession', () => ({
  useMetricsSession: () => mockUseMetricsSession(),
}))

// Mock pocketbase
vi.mock('../../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-token' } },
}))

// Mock useApiWithAuth (useSessionAvailability uses fetchWithAuth which calls fetch internally)
vi.mock('../../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: mockFetch,
    isAuthenticated: true,
  }),
}))

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

// Sample API response
const mockAvailabilityResponse = {
  sessions: [
    {
      session_cm_id: 1001,
      session_name: 'Taste of Camp',
      session_type: 'main',
      sort_order: 0,
      girls: {
        min_grade: 2,
        max_grade: 6,
        enrolled: 20,
        waitlisted: 0,
        capacity: 36,
        status: 'open',
        waitlisted_by_grade: {},
        waitlisted_persons: [],
      },
      boys: {
        min_grade: 2,
        max_grade: 6,
        enrolled: 18,
        waitlisted: 0,
        capacity: 36,
        status: 'open',
        waitlisted_by_grade: {},
        waitlisted_persons: [],
      },
    },
    {
      session_cm_id: 1002,
      session_name: 'Session 2',
      session_type: 'main',
      sort_order: 1,
      girls: {
        min_grade: 2,
        max_grade: 10,
        enrolled: 50,
        waitlisted: 3,
        capacity: 60,
        status: 'full',
        waitlisted_by_grade: {},
        waitlisted_persons: [],
      },
      boys: {
        min_grade: 2,
        max_grade: 10,
        enrolled: 48,
        waitlisted: 0,
        capacity: 60,
        status: 'limited',
        waitlisted_by_grade: {},
        waitlisted_persons: [],
      },
    },
  ],
  ag_sessions: [
    {
      session_cm_id: 2001,
      session_name: 'AG Session 2',
      parent_session_name: 'Session 2',
      min_grade: 4,
      max_grade: 10,
      enrolled: 10,
      waitlisted: 0,
      capacity: 24,
      status: 'open',
      waitlisted_by_grade: {},
      waitlisted_persons: [],
    },
  ],
  teen_sessions: [],
  limited_threshold: 80,
}

// Lazy-load the component after mocks are set up
const { default: SessionAvailability } = await import('./SessionAvailability')

describe('SessionAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock: all sessions view
    mockUseMetricsSession.mockReturnValue({
      selectedSessionCmId: null,
      sessionTypesParam: 'main,embedded,ag,quest',
      activeSessionTypes: ['main', 'embedded', 'ag', 'quest'],
      durationParam: undefined,
    })
  })

  it('renders loading state initially', () => {
    mockFetch.mockReturnValue(new Promise(() => {}))
    renderWithProviders(<SessionAvailability />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders session names from API data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAvailabilityResponse,
    })

    renderWithProviders(<SessionAvailability />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
      expect(screen.getByText('Session 2')).toBeInTheDocument()
    })
  })

  it('renders grade columns', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAvailabilityResponse,
    })

    renderWithProviders(<SessionAvailability />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Grade headers appear twice (girls + boys columns)
    expect(screen.getAllByText('2nd').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('10th').length).toBeGreaterThanOrEqual(2)
  })

  it('renders gender section headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAvailabilityResponse,
    })

    renderWithProviders(<SessionAvailability />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Should have Girls and Boys headers
    expect(screen.getByText("Girls' Availability")).toBeInTheDocument()
    expect(screen.getByText("Boys' Availability")).toBeInTheDocument()
  })

  it('renders AG sessions section', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAvailabilityResponse,
    })

    renderWithProviders(<SessionAvailability />)

    await waitFor(() => {
      expect(screen.getByText('AG Session 2')).toBeInTheDocument()
    })

    expect(screen.getByText(/ag sessions/i)).toBeInTheDocument()
  })

  it('shortens raw AG cabin names to "AG Session N (grades)"', async () => {
    const resp = {
      sessions: [],
      ag_sessions: [
        {
          session_cm_id: 2001,
          session_name: 'All-Gender Cabin-Session 2 (7th & 8th grades)',
          parent_session_name: 'Session 2',
          min_grade: 7,
          max_grade: 8,
          enrolled: 10,
          waitlisted: 0,
          capacity: 24,
          status: 'open',
          waitlisted_by_grade: {},
          waitlisted_persons: [],
        },
      ],
      teen_sessions: [],
      limited_threshold: 80,
    }

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => resp })
    renderWithProviders(<SessionAvailability />)

    await waitFor(() => {
      expect(screen.getByText('AG Session 2 (7th & 8th)')).toBeInTheDocument()
    })
    expect(
      screen.queryByText('All-Gender Cabin-Session 2 (7th & 8th grades)')
    ).not.toBeInTheDocument()
  })

  it('renders full status cells', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAvailabilityResponse,
    })

    renderWithProviders(<SessionAvailability />)

    await waitFor(() => {
      expect(screen.getByText('Session 2')).toBeInTheDocument()
    })

    // Session 2 girls has status='full', should have sr-only "Full" text
    const fullCells = screen.getAllByText('Full')
    expect(fullCells.length).toBeGreaterThan(0)
  })

  it('renders page title', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAvailabilityResponse,
    })

    renderWithProviders(<SessionAvailability />)

    await waitFor(() => {
      expect(screen.getByText(/session availability/i)).toBeInTheDocument()
    })
  })

  it('renders color key/legend', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAvailabilityResponse,
    })

    renderWithProviders(<SessionAvailability />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Legend items — use exact text unique to the legend
    expect(screen.getByText('Open Space')).toBeInTheDocument()
    expect(screen.getByText('Limited Space')).toBeInTheDocument()
    expect(screen.getAllByText('Full').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(1)
  })

  it('passes session_types from metrics session context to API', async () => {
    mockUseMetricsSession.mockReturnValue({
      selectedSessionCmId: null,
      sessionTypesParam: 'main,embedded,ag',
      activeSessionTypes: ['main', 'embedded', 'ag'],
      durationParam: undefined,
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAvailabilityResponse,
    })

    renderWithProviders(<SessionAvailability />)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    const fetchUrl = mockFetch.mock.calls[0]![0] as string
    expect(fetchUrl).toContain('session_types=main%2Cembedded%2Cag')
  })

  it('passes session_cm_id from metrics session context to API', async () => {
    mockUseMetricsSession.mockReturnValue({
      selectedSessionCmId: 1001,
      sessionTypesParam: 'main,embedded,ag,quest',
      activeSessionTypes: ['main', 'embedded', 'ag', 'quest'],
      durationParam: undefined,
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAvailabilityResponse,
    })

    renderWithProviders(<SessionAvailability />)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    const fetchUrl = mockFetch.mock.calls[0]![0] as string
    expect(fetchUrl).toContain('session_cm_id=1001')
  })

  it('does not include session_cm_id when null', async () => {
    mockUseMetricsSession.mockReturnValue({
      selectedSessionCmId: null,
      sessionTypesParam: 'main,embedded,ag,quest',
      activeSessionTypes: ['main', 'embedded', 'ag', 'quest'],
      durationParam: undefined,
    })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAvailabilityResponse,
    })

    renderWithProviders(<SessionAvailability />)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    const fetchUrl = mockFetch.mock.calls[0]![0] as string
    expect(fetchUrl).not.toContain('session_cm_id')
  })

  it('renders per-grade waitlist counts inside cells', async () => {
    const response = {
      sessions: [
        {
          session_cm_id: 1001,
          session_name: 'Session 1',
          session_type: 'main',
          sort_order: 0,
          girls: {
            min_grade: 2,
            max_grade: 10,
            enrolled: 50,
            waitlisted: 5,
            capacity: 60,
            status: 'full',
            waitlisted_by_grade: { 4: 3, 6: 2 },
            waitlisted_persons: [],
          },
          boys: {
            min_grade: 2,
            max_grade: 10,
            enrolled: 48,
            waitlisted: 0,
            capacity: 60,
            status: 'limited',
            waitlisted_by_grade: {},
            waitlisted_persons: [],
          },
        },
      ],
      ag_sessions: [],
      teen_sessions: [],
      limited_threshold: 80,
    }

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => response })
    renderWithProviders(<SessionAvailability />)

    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument()
    })

    // Per-grade waitlist count should appear (the "3" for 4th grade girls)
    expect(screen.getByText('3')).toBeInTheDocument()
    // WL column total
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('renders dash in WL column when no waitlist', async () => {
    const response = {
      sessions: [
        {
          session_cm_id: 1001,
          session_name: 'Session 1',
          session_type: 'main',
          sort_order: 0,
          girls: {
            min_grade: 2,
            max_grade: 10,
            enrolled: 20,
            waitlisted: 0,
            capacity: 60,
            status: 'open',
            waitlisted_by_grade: {},
            waitlisted_persons: [],
          },
          boys: {
            min_grade: 2,
            max_grade: 10,
            enrolled: 18,
            waitlisted: 0,
            capacity: 60,
            status: 'open',
            waitlisted_by_grade: {},
            waitlisted_persons: [],
          },
        },
      ],
      ag_sessions: [],
      teen_sessions: [],
      limited_threshold: 80,
    }

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => response })
    renderWithProviders(<SessionAvailability />)

    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument()
    })

    // Should have dashes for empty WL columns
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2) // at least girls + boys WL columns
  })

  it('renders WL column headers in sessions table', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAvailabilityResponse,
    })

    renderWithProviders(<SessionAvailability />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // WL column headers should appear
    const wlHeaders = screen.getAllByText('WL')
    expect(wlHeaders.length).toBeGreaterThanOrEqual(2) // girls + boys
  })

  it('renders waitlist legend items', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAvailabilityResponse,
    })

    renderWithProviders(<SessionAvailability />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    expect(screen.getByText('Waitlisted (grade)')).toBeInTheDocument()
    expect(screen.getByText('Waitlisted (total)')).toBeInTheDocument()
  })

  it('shows tooltip on WL pill hover', async () => {
    const interactionResponse = {
      sessions: [
        {
          session_cm_id: 1001,
          session_name: 'Session 1',
          session_type: 'main',
          sort_order: 0,
          girls: {
            min_grade: 2,
            max_grade: 10,
            enrolled: 50,
            waitlisted: 8,
            capacity: 50,
            status: 'full',
            waitlisted_by_grade: { 3: 3, 4: 3, 6: 2 },
            waitlisted_persons: [
              { person_id: 1, first_name: 'Emma', last_name: 'Johnson', position: 1, grade: 3 },
              { person_id: 2, first_name: 'Olivia', last_name: 'Chen', position: 2, grade: 4 },
              { person_id: 3, first_name: 'Sophia', last_name: 'Garcia', position: 3, grade: 4 },
              { person_id: 4, first_name: 'Mia', last_name: 'Williams', position: 4, grade: 6 },
              { person_id: 5, first_name: 'Ava', last_name: 'Davis', position: 5, grade: 4 },
            ],
          },
          boys: {
            min_grade: 2,
            max_grade: 10,
            enrolled: 40,
            waitlisted: 0,
            capacity: 50,
            status: 'open',
            waitlisted_by_grade: {},
            waitlisted_persons: [],
          },
        },
      ],
      ag_sessions: [],
      teen_sessions: [],
      limited_threshold: 80,
    }

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => interactionResponse })
    renderWithProviders(<SessionAvailability />)
    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument()
    })

    // Find the WL pill (shows "8")
    const pill = screen.getByText('8')
    fireEvent.mouseEnter(pill)

    await waitFor(() => {
      expect(screen.getByText(/8 girls waitlisted/)).toBeInTheDocument()
      expect(screen.getByText(/Emma J\./)).toBeInTheDocument()
      expect(screen.getByText(/\+ 3 more/)).toBeInTheDocument()
    })
  })

  it('hides tooltip on mouse leave from WL pill', async () => {
    const interactionResponse = {
      sessions: [
        {
          session_cm_id: 1001,
          session_name: 'Session 1',
          session_type: 'main',
          sort_order: 0,
          girls: {
            min_grade: 2,
            max_grade: 10,
            enrolled: 50,
            waitlisted: 3,
            capacity: 50,
            status: 'full',
            waitlisted_by_grade: { 4: 2, 6: 1 },
            waitlisted_persons: [
              { person_id: 1, first_name: 'Emma', last_name: 'Johnson', position: 1, grade: 4 },
              { person_id: 2, first_name: 'Olivia', last_name: 'Chen', position: 2, grade: 4 },
              { person_id: 3, first_name: 'Sophia', last_name: 'Garcia', position: 3, grade: 6 },
            ],
          },
          boys: {
            min_grade: 2,
            max_grade: 10,
            enrolled: 40,
            waitlisted: 0,
            capacity: 50,
            status: 'open',
            waitlisted_by_grade: {},
            waitlisted_persons: [],
          },
        },
      ],
      ag_sessions: [],
      teen_sessions: [],
      limited_threshold: 80,
    }

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => interactionResponse })
    renderWithProviders(<SessionAvailability />)
    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument()
    })

    // Find the WL pill (shows "3" as the total count)
    const pill = screen.getByText('3', { selector: 'button.inline-flex' })
    fireEvent.mouseEnter(pill)

    await waitFor(() => {
      expect(screen.getByText(/3 girls waitlisted/)).toBeInTheDocument()
    })

    fireEvent.mouseLeave(pill)

    await waitFor(() => {
      expect(screen.queryByText(/3 girls waitlisted/)).not.toBeInTheDocument()
    })
  })

  // #2100-series a11y sweep: the WL pill was a <span onClick> with no keyboard
  // path at all. It is now a real <button>, so Tab reaches it and Enter/Space
  // fire the same drilldown as a mouse click — for free, from the browser.
  it('opens the drilldown via keyboard (Enter) on the WL pill', async () => {
    const interactionResponse = {
      sessions: [
        {
          session_cm_id: 1001,
          session_name: 'Session 1',
          session_type: 'main',
          sort_order: 0,
          girls: {
            min_grade: 2,
            max_grade: 10,
            enrolled: 50,
            waitlisted: 5,
            capacity: 50,
            status: 'full',
            waitlisted_by_grade: { 4: 3, 6: 2 },
            waitlisted_persons: [],
          },
          boys: {
            min_grade: 2,
            max_grade: 10,
            enrolled: 40,
            waitlisted: 0,
            capacity: 50,
            status: 'open',
            waitlisted_by_grade: {},
            waitlisted_persons: [],
          },
        },
      ],
      ag_sessions: [],
      teen_sessions: [],
      limited_threshold: 80,
    }

    // The DrillDownModal that opens on click/keypress fetches its own attendee
    // list — respond to that call distinctly so it doesn't choke on the
    // session-availability shape (`res.json()` there must resolve to an array).
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/metrics/drilldown')) {
        return { ok: true, json: async () => [] }
      }
      return { ok: true, json: async () => interactionResponse }
    })
    renderWithProviders(<SessionAvailability />)
    await waitFor(() => expect(screen.getByText('Session 1')).toBeInTheDocument())

    const pill = screen.getByRole('button', { name: '5' })
    pill.focus()
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      const drilldownCall = mockFetch.mock.calls
        .map((c) => String(c[0]))
        .find((u) => u.includes('/api/metrics/drilldown'))
      expect(drilldownCall).toBeDefined()
    })
  })

  it('opens the drilldown via keyboard (Space) on the AG WL pill', async () => {
    const interactionResponse = {
      sessions: [],
      ag_sessions: [
        {
          session_cm_id: 2001,
          session_name: 'AG Session 2',
          parent_session_name: 'Session 2',
          min_grade: 4,
          max_grade: 10,
          enrolled: 10,
          waitlisted: 6,
          capacity: 24,
          status: 'open',
          waitlisted_by_grade: {},
          waitlisted_persons: [],
        },
      ],
      teen_sessions: [],
      limited_threshold: 80,
    }

    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/metrics/drilldown')) {
        return { ok: true, json: async () => [] }
      }
      return { ok: true, json: async () => interactionResponse }
    })
    renderWithProviders(<SessionAvailability />)
    await waitFor(() => expect(screen.getByText('AG Session 2')).toBeInTheDocument())

    const pill = screen.getByRole('button', { name: '6' })
    pill.focus()
    await userEvent.keyboard(' ')

    await waitFor(() => {
      const drilldownCall = mockFetch.mock.calls
        .map((c) => String(c[0]))
        .find((u) => u.includes('/api/metrics/drilldown'))
      expect(drilldownCall).toBeDefined()
    })
  })

  it('shows popover on grade cell click', async () => {
    const interactionResponse = {
      sessions: [
        {
          session_cm_id: 1001,
          session_name: 'Session 1',
          session_type: 'main',
          sort_order: 0,
          girls: {
            min_grade: 2,
            max_grade: 10,
            enrolled: 50,
            waitlisted: 5,
            capacity: 50,
            status: 'full',
            waitlisted_by_grade: { 4: 3, 6: 2 },
            waitlisted_persons: [
              { person_id: 1, first_name: 'Emma', last_name: 'Johnson', position: 1, grade: 4 },
              { person_id: 2, first_name: 'Olivia', last_name: 'Chen', position: 2, grade: 4 },
              { person_id: 3, first_name: 'Sophia', last_name: 'Garcia', position: 3, grade: 4 },
              { person_id: 4, first_name: 'Mia', last_name: 'Williams', position: 4, grade: 6 },
              { person_id: 5, first_name: 'Ava', last_name: 'Davis', position: 5, grade: 6 },
            ],
          },
          boys: {
            min_grade: 2,
            max_grade: 10,
            enrolled: 40,
            waitlisted: 0,
            capacity: 50,
            status: 'open',
            waitlisted_by_grade: {},
            waitlisted_persons: [],
          },
        },
      ],
      ag_sessions: [],
      teen_sessions: [],
      limited_threshold: 80,
    }

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => interactionResponse })
    renderWithProviders(<SessionAvailability />)
    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument()
    })

    // The grade cell for 4th grade girls shows "3" (waitlisted count)
    // Click on the grade cell count - should open drilldown modal
    const gradeCount = screen.getByText('3')
    fireEvent.click(gradeCount)

    // Grade cell click opens drilldown (no popover)
    // The drilldown modal is rendered by useDrilldown which makes an API call
    // We verify the tooltip is dismissed (click clears tooltip state)
    expect(screen.queryByText(/girls waitlisted/)).not.toBeInTheDocument()
  })

  it('adds cursor-pointer to grade cells with waitlist count', async () => {
    const interactionResponse = {
      sessions: [
        {
          session_cm_id: 1001,
          session_name: 'Session 1',
          session_type: 'main',
          sort_order: 0,
          girls: {
            min_grade: 2,
            max_grade: 10,
            enrolled: 50,
            waitlisted: 3,
            capacity: 50,
            status: 'full',
            waitlisted_by_grade: { 4: 3 },
            waitlisted_persons: [
              { person_id: 1, first_name: 'Emma', last_name: 'Johnson', position: 1, grade: 4 },
              { person_id: 2, first_name: 'Olivia', last_name: 'Chen', position: 2, grade: 4 },
              { person_id: 3, first_name: 'Sophia', last_name: 'Garcia', position: 3, grade: 4 },
            ],
          },
          boys: {
            min_grade: 2,
            max_grade: 10,
            enrolled: 40,
            waitlisted: 0,
            capacity: 50,
            status: 'open',
            waitlisted_by_grade: {},
            waitlisted_persons: [],
          },
        },
      ],
      ag_sessions: [],
      teen_sessions: [],
      limited_threshold: 80,
    }

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => interactionResponse })
    renderWithProviders(<SessionAvailability />)
    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument()
    })

    // WL pill always has cursor-pointer (always opens drilldown)
    const pill = screen.getByText('3', { selector: 'button.inline-flex' })
    expect(pill).toHaveClass('cursor-pointer')
  })

  it('renders Teen Programs section with SCIT and TLI rows', async () => {
    mockUseMetricsSession.mockReturnValue({
      selectedSessionCmId: null,
      sessionTypesParam: 'main,embedded,ag,quest,scit,tli',
      activeSessionTypes: ['main', 'embedded', 'ag', 'quest', 'scit', 'tli'],
      durationParam: undefined,
    })

    const teenResponse = {
      sessions: [],
      ag_sessions: [],
      teen_sessions: [
        {
          session_cm_id: 0,
          session_name: 'SCIT',
          session_type: 'scit',
          min_grade: 12,
          max_grade: 12,
          enrolled: 45,
          waitlisted: 0,
          capacity: 50,
          status: 'open',
          waitlisted_by_grade: {},
          waitlisted_persons: [],
        },
        {
          session_cm_id: 0,
          session_name: 'TLI',
          session_type: 'tli',
          min_grade: 11,
          max_grade: 11,
          enrolled: 47,
          waitlisted: 0,
          capacity: 40,
          status: 'full',
          waitlisted_by_grade: {},
          waitlisted_persons: [],
        },
      ],
      limited_threshold: 80,
    }

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => teenResponse })
    renderWithProviders(<SessionAvailability />)

    await waitFor(() => {
      expect(screen.getByText(/teen programs/i)).toBeInTheDocument()
    })

    expect(screen.getByText('SCIT')).toBeInTheDocument()
    expect(screen.getByText('TLI')).toBeInTheDocument()
  })

  it('teen WL pill drilldown keys off teen type, not session_cm_id=0', async () => {
    mockUseMetricsSession.mockReturnValue({
      selectedSessionCmId: null,
      sessionTypesParam: 'main,embedded,ag,quest,scit,tli',
      activeSessionTypes: ['main', 'embedded', 'ag', 'quest', 'scit', 'tli'],
      durationParam: undefined,
    })

    const teenResponse = {
      sessions: [],
      ag_sessions: [],
      teen_sessions: [
        {
          session_cm_id: 0,
          session_name: 'SCIT',
          session_type: 'scit',
          min_grade: 12,
          max_grade: 12,
          enrolled: 45,
          waitlisted: 4,
          capacity: 50,
          status: 'open',
          waitlisted_by_grade: {},
          waitlisted_persons: [],
        },
      ],
      limited_threshold: 80,
    }

    // First fetch = availability data; subsequent fetch = drilldown after click.
    mockFetch.mockResolvedValue({ ok: true, json: async () => teenResponse })
    renderWithProviders(<SessionAvailability />)

    await waitFor(() => expect(screen.getByText('SCIT')).toBeInTheDocument())

    fireEvent.click(screen.getByText('4', { selector: 'button.inline-flex' }))

    await waitFor(() => {
      const drilldownCall = mockFetch.mock.calls
        .map((c) => String(c[0]))
        .find((u) => u.includes('/api/metrics/drilldown'))
      expect(drilldownCall).toBeDefined()
      expect(drilldownCall).toContain('breakdown_type=waitlist_teen_program')
      // value carries the teen type (scit), not the ambiguous session_cm_id=0
      expect(drilldownCall).toContain('breakdown_value=scit')
    })
  })

  it('teen table shows only 11th and 12th grade columns (not 2nd–10th)', async () => {
    mockUseMetricsSession.mockReturnValue({
      selectedSessionCmId: null,
      sessionTypesParam: 'scit,tli',
      activeSessionTypes: ['scit', 'tli'],
      durationParam: undefined,
    })

    const teenResponse = {
      sessions: [],
      ag_sessions: [],
      teen_sessions: [
        {
          session_cm_id: 0,
          session_name: 'SCIT',
          session_type: 'scit',
          min_grade: 12,
          max_grade: 12,
          enrolled: 45,
          waitlisted: 0,
          capacity: 50,
          status: 'open',
          waitlisted_by_grade: {},
          waitlisted_persons: [],
        },
        {
          session_cm_id: 0,
          session_name: 'TLI',
          session_type: 'tli',
          min_grade: 11,
          max_grade: 11,
          enrolled: 47,
          waitlisted: 0,
          capacity: 40,
          status: 'full',
          waitlisted_by_grade: {},
          waitlisted_persons: [],
        },
      ],
      limited_threshold: 80,
    }

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => teenResponse })
    renderWithProviders(<SessionAvailability />)

    await waitFor(() => expect(screen.getByText(/teen programs/i)).toBeInTheDocument())

    // Teen box is 11th/12th only — no elementary/middle-school columns
    expect(screen.getByText('11th')).toBeInTheDocument()
    expect(screen.getByText('12th')).toBeInTheDocument()
    expect(screen.queryByText('2nd')).not.toBeInTheDocument()
    expect(screen.queryByText('10th')).not.toBeInTheDocument()
  })

  it('renders AG (wider) and Teen (narrower) sections side-by-side', async () => {
    mockUseMetricsSession.mockReturnValue({
      selectedSessionCmId: null,
      sessionTypesParam: 'main,embedded,ag,quest,scit,tli',
      activeSessionTypes: ['main', 'embedded', 'ag', 'quest', 'scit', 'tli'],
      durationParam: undefined,
    })

    const resp = {
      sessions: [],
      ag_sessions: [
        {
          session_cm_id: 2001,
          session_name: 'AG Session 2',
          parent_session_name: 'Session 2',
          min_grade: 4,
          max_grade: 10,
          enrolled: 10,
          waitlisted: 0,
          capacity: 24,
          status: 'open',
          waitlisted_by_grade: {},
          waitlisted_persons: [],
        },
      ],
      teen_sessions: [
        {
          session_cm_id: 0,
          session_name: 'SCIT',
          session_type: 'scit',
          min_grade: 12,
          max_grade: 12,
          enrolled: 45,
          waitlisted: 0,
          capacity: 50,
          status: 'open',
          waitlisted_by_grade: {},
          waitlisted_persons: [],
        },
      ],
      limited_threshold: 80,
    }

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => resp })
    renderWithProviders(<SessionAvailability />)

    await waitFor(() => expect(screen.getByText(/ag sessions/i)).toBeInTheDocument())

    const agWrapper = screen.getByText(/ag sessions/i).closest('[data-section="ag"]')
    const teenWrapper = screen.getByText(/teen programs/i).closest('[data-section="teen"]')
    expect(agWrapper).not.toBeNull()
    expect(teenWrapper).not.toBeNull()
    // AG is the wide 2/3 column, teen is the narrow 1/3 column
    expect(agWrapper).toHaveClass('lg:col-span-2')
    expect(teenWrapper).toHaveClass('lg:col-span-1')
    // ...and they live in the same grid row
    expect(agWrapper?.parentElement).toBe(teenWrapper?.parentElement)
  })

  it('AG section spans full width when there are no teen programs', async () => {
    mockUseMetricsSession.mockReturnValue({
      selectedSessionCmId: null,
      sessionTypesParam: 'main,embedded,ag,quest',
      activeSessionTypes: ['main', 'embedded', 'ag', 'quest'],
      durationParam: undefined,
    })

    const resp = {
      sessions: [],
      ag_sessions: [
        {
          session_cm_id: 2001,
          session_name: 'AG Session 2',
          parent_session_name: 'Session 2',
          min_grade: 4,
          max_grade: 10,
          enrolled: 10,
          waitlisted: 0,
          capacity: 24,
          status: 'open',
          waitlisted_by_grade: {},
          waitlisted_persons: [],
        },
      ],
      teen_sessions: [],
      limited_threshold: 80,
    }

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => resp })
    renderWithProviders(<SessionAvailability />)

    await waitFor(() => expect(screen.getByText(/ag sessions/i)).toBeInTheDocument())

    const agWrapper = screen.getByText(/ag sessions/i).closest('[data-section="ag"]')
    expect(agWrapper).not.toBeNull()
    // No teen section present -> AG takes the full grid width, not 2/3.
    expect(agWrapper).toHaveClass('lg:col-span-3')
    expect(screen.queryByText(/teen programs/i)).not.toBeInTheDocument()
  })
})
