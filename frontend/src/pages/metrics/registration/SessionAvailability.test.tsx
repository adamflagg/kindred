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

// Mock pocketbase
vi.mock('../../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-token' } },
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

    // Should show grade headers (2nd through 10th)
    expect(screen.getByText('2nd')).toBeInTheDocument()
    expect(screen.getByText('10th')).toBeInTheDocument()
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

    // Should show legend items
    expect(screen.getByText(/open/i)).toBeInTheDocument()
    expect(screen.getByText(/limited/i)).toBeInTheDocument()
    expect(screen.getByText(/waitlist/i)).toBeInTheDocument()
    expect(screen.getByText(/n\/a/i)).toBeInTheDocument()
  })
})
