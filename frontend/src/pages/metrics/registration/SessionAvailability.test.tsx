import { render, screen, waitFor } from '@testing-library/react'
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
      },
      boys: {
        min_grade: 2,
        max_grade: 6,
        enrolled: 18,
        waitlisted: 0,
        capacity: 36,
        status: 'open',
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
        status: 'waitlist',
      },
      boys: {
        min_grade: 2,
        max_grade: 10,
        enrolled: 48,
        waitlisted: 0,
        capacity: 60,
        status: 'limited',
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
    },
  ],
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

  it('shows WL text for waitlisted sessions', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockAvailabilityResponse,
    })

    renderWithProviders(<SessionAvailability />)

    await waitFor(() => {
      expect(screen.getByText('Session 2')).toBeInTheDocument()
    })

    // Session 2 girls has status=waitlist, should show WL cells
    const wlCells = screen.getAllByText('WL')
    expect(wlCells.length).toBeGreaterThan(0)
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
    // "WL" appears in legend and cells, "N/A" appears in legend and sr-only cells
    expect(screen.getAllByText('WL').length).toBeGreaterThanOrEqual(2) // legend + cells
    expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(1)
  })

  it('passes session_types from metrics session context to API', async () => {
    mockUseMetricsSession.mockReturnValue({
      selectedSessionCmId: null,
      sessionTypesParam: 'main,embedded,ag',
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
})
