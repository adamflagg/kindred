import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionForecast, ForecastResponse } from '../../../types/forecast'

// Mock fetch for API call
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

// Mock useCurrentYear
vi.mock('../../../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: 2026, availableYears: [2024, 2025, 2026] }),
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

// Mock useApiWithAuth
vi.mock('../../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: mockFetch,
    isAuthenticated: true,
  }),
}))

// Mock useWeekOptions — returns empty array by default (no Today option) so the
// useEffect inside ForecastPage doesn't change dayOffset during tests
vi.mock('../../../hooks/useWeekOptions', () => ({
  useWeekOptions: () => ({ data: [] }),
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

// ---------- helpers ----------

function session(overrides: Partial<SessionForecast> = {}): SessionForecast {
  return {
    session_cm_id: 1001,
    session_name: 'Session 1',
    session_type: 'main',
    participant_goal: 100,
    session_fee: 5000,
    enrolled: 80,
    waitlisted: 3,
    pct_of_goal: 80.0,
    prior_year_count: 75,
    two_year_prior_count: 70,
    participants_vs_budget: -20,
    participants_vs_prior_year: 5,
    budget_revenue: 500000,
    actual_revenue: 400000,
    revenue_delta: -100000,
    revenue_pct: 80.0,
    enrolled_boys: null,
    enrolled_girls: null,
    ...overrides,
  }
}

function grandTotal(overrides: Partial<SessionForecast> = {}): SessionForecast {
  return session({
    session_cm_id: 0,
    session_name: 'Grand Total',
    session_type: 'total',
    session_fee: null,
    ...overrides,
  })
}

function mockResponse(
  sessions: SessionForecast[],
  grand_total_overrides: Partial<SessionForecast> = {}
): ForecastResponse {
  return {
    year: 2026,
    sessions,
    grand_total: grandTotal(grand_total_overrides),
    week_number: null,
    day_offset: null,
  }
}

function setupMockFetch(response: ForecastResponse) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => response,
  })
}

// Default metrics session state: all sessions view
function defaultMetricsSession() {
  return {
    selectedSessionCmId: null,
    selectedSession: undefined,
    sessions: [],
    isLoading: false,
    setSelectedSessionCmId: vi.fn(),
    clearSession: vi.fn(),
    viewMode: 'all' as const,
    setViewMode: vi.fn(),
    activeSessionTypes: ['main', 'embedded', 'ag', 'quest'],
    sessionTypesParam: 'main,embedded,ag,quest',
    campSessions: [],
    questSessions: [],
    expandedRetention: false,
    setExpandedRetention: vi.fn(),
    compareYear: null,
    setCompareYear: vi.fn(),
    isComparing: false,
  }
}

// Lazy-load the component after mocks are set up
const { default: ForecastPage } = await import('./ForecastPage')

describe('ForecastPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMetricsSession.mockReturnValue(defaultMetricsSession())
  })

  // ---------- section headings ----------

  it('shows section headings when both camp and quest sessions present', async () => {
    const campSession = session({
      session_cm_id: 1001,
      session_name: 'Session 1',
      session_type: 'main',
    })
    const questSession = session({
      session_cm_id: 2001,
      session_name: 'Teen Quests',
      session_type: 'quest',
    })
    setupMockFetch(mockResponse([campSession, questSession]))

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText('At Camp')).toBeInTheDocument()
      expect(screen.getByText('Quests')).toBeInTheDocument()
    })
  })

  it('hides section headings when only camp sessions present', async () => {
    const campSession = session({
      session_cm_id: 1001,
      session_name: 'Session 1',
      session_type: 'main',
    })
    setupMockFetch(mockResponse([campSession]))

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument()
    })

    expect(screen.queryByText('At Camp')).not.toBeInTheDocument()
    expect(screen.queryByText('Quests')).not.toBeInTheDocument()
  })

  it('hides section headings when only quest sessions present', async () => {
    const questSession = session({
      session_cm_id: 2001,
      session_name: 'Teen Quests',
      session_type: 'quest',
    })
    setupMockFetch(mockResponse([questSession]))

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText('Teen Quests')).toBeInTheDocument()
    })

    expect(screen.queryByText('At Camp')).not.toBeInTheDocument()
    // "Quests" as a heading should not appear when it's the only section
    // (check there's no heading element — the session name itself will exist in the row)
    const questHeadings = screen.queryAllByText('Quests')
    // With one section, no section heading should exist
    expect(questHeadings).toHaveLength(0)
  })

  // ---------- empty sections ----------

  it('does not render a table for an empty section', async () => {
    const campSession = session({
      session_cm_id: 1001,
      session_name: 'Session 1',
      session_type: 'main',
    })
    setupMockFetch(mockResponse([campSession]))

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument()
    })

    // Only one table should be rendered (camp)
    const tables = screen.getAllByRole('table')
    expect(tables).toHaveLength(1)
  })

  // ---------- section totals ----------

  it('shows section total when section has 2+ rows', async () => {
    const s1 = session({
      session_cm_id: 1001,
      session_name: 'Session 1',
      session_type: 'main',
      enrolled: 50,
    })
    const s2 = session({
      session_cm_id: 1002,
      session_name: 'Session 2',
      session_type: 'main',
      enrolled: 80,
    })
    setupMockFetch(mockResponse([s1, s2]))

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument()
      expect(screen.getByText('Session 2')).toBeInTheDocument()
    })

    // The section total label should appear
    expect(screen.getByText('At Camp')).toBeInTheDocument()
  })

  it('hides section total when section has only 1 row', async () => {
    const s1 = session({ session_cm_id: 1001, session_name: 'Session 1', session_type: 'main' })
    setupMockFetch(mockResponse([s1]))

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument()
    })

    // With a single section and single row, no total row should appear
    // tfoot should not be present
    const tables = screen.getAllByRole('table')
    for (const table of tables) {
      const tfoot = table.querySelector('tfoot')
      expect(tfoot).toBeNull()
    }
  })

  // ---------- single session selected ----------

  it('hides totals when single session selected returns 1 row', async () => {
    // Single session, no AG child → 1 row → no section total needed
    mockUseMetricsSession.mockReturnValue({
      ...defaultMetricsSession(),
      selectedSessionCmId: 1001,
    })

    const s1 = session({ session_cm_id: 1001, session_name: 'Session 1', session_type: 'main' })
    setupMockFetch(mockResponse([s1]))

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument()
    })

    // 1 row → no tfoot in any table
    const tables = screen.getAllByRole('table')
    for (const table of tables) {
      const tfoot = table.querySelector('tfoot')
      expect(tfoot).toBeNull()
    }
  })

  it('shows section total when single session selected with AG child', async () => {
    // User selected Session 2; backend returns main + AG child → 2 rows → show total
    mockUseMetricsSession.mockReturnValue({
      ...defaultMetricsSession(),
      selectedSessionCmId: 1002,
    })

    const mainSession = session({
      session_cm_id: 1002,
      session_name: 'Session 2',
      session_type: 'main',
      enrolled: 80,
    })
    const agSession = session({
      session_cm_id: 2002,
      session_name: 'AG Session 2',
      session_type: 'ag',
      enrolled: 15,
    })
    setupMockFetch(mockResponse([mainSession, agSession], { enrolled: 95 }))

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText('Session 2')).toBeInTheDocument()
      // shortenSessionName("AG Session 2") → "AG 2"
      expect(screen.getByText('AG 2')).toBeInTheDocument()
    })

    // 2 rows (main + AG) → section total should be present in tfoot
    const tfoot = document.querySelector('tfoot')
    expect(tfoot).not.toBeNull()
  })

  // ---------- grand total ----------

  it('shows grand total when 2+ sections visible', async () => {
    const campSession = session({
      session_cm_id: 1001,
      session_name: 'Session 1',
      session_type: 'main',
      enrolled: 80,
    })
    const questSession = session({
      session_cm_id: 2001,
      session_name: 'Teen Quests',
      session_type: 'quest',
      enrolled: 20,
    })
    setupMockFetch(mockResponse([campSession, questSession], { enrolled: 100 }))

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument()
      expect(screen.getByText('Teen Quests')).toBeInTheDocument()
    })

    // Grand Total label from the backend grand_total should appear
    expect(screen.getByText('Grand Total')).toBeInTheDocument()
  })

  it('hides grand total when only 1 section visible', async () => {
    const s1 = session({
      session_cm_id: 1001,
      session_name: 'Session 1',
      session_type: 'main',
      enrolled: 50,
    })
    const s2 = session({
      session_cm_id: 1002,
      session_name: 'Session 2',
      session_type: 'main',
      enrolled: 80,
    })
    setupMockFetch(mockResponse([s1, s2], { enrolled: 130 }))

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument()
      expect(screen.getByText('Session 2')).toBeInTheDocument()
    })

    expect(screen.queryByText('Grand Total')).not.toBeInTheDocument()
  })

  it('hides grand total when single session is selected even with 2 sections', async () => {
    mockUseMetricsSession.mockReturnValue({
      ...defaultMetricsSession(),
      selectedSessionCmId: 1001,
    })

    const campSession = session({
      session_cm_id: 1001,
      session_name: 'Session 1',
      session_type: 'main',
    })
    const questSession = session({
      session_cm_id: 2001,
      session_name: 'Teen Quests',
      session_type: 'quest',
    })
    setupMockFetch(mockResponse([campSession, questSession]))

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument()
    })

    expect(screen.queryByText('Grand Total')).not.toBeInTheDocument()
  })

  // ---------- fee column removed ----------

  it('does not render a Fee column header', async () => {
    const s1 = session({ session_cm_id: 1001, session_name: 'Session 1', session_type: 'main' })
    setupMockFetch(mockResponse([s1]))

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument()
    })

    expect(screen.queryByText('Fee')).not.toBeInTheDocument()
  })

  it('does not render session_fee values in rows', async () => {
    const s1 = session({
      session_cm_id: 1001,
      session_name: 'Session 1',
      session_type: 'main',
      session_fee: 5000,
    })
    setupMockFetch(mockResponse([s1]))

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument()
    })

    // $5,000 should not appear as a standalone cell (fee column removed)
    expect(screen.queryByText('$5,000')).not.toBeInTheDocument()
  })

  // ---------- gender (B / G) column ----------

  it('renders B / G column header', async () => {
    const s1 = session({ session_cm_id: 1001, session_name: 'Session 1', session_type: 'main' })
    setupMockFetch(mockResponse([s1]))

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText('B / G')).toBeInTheDocument()
    })
  })

  it('renders gender counts with colors when data is present', async () => {
    const s1 = session({
      session_cm_id: 1001,
      session_name: 'Session 1',
      session_type: 'main',
      enrolled_boys: 45,
      enrolled_girls: 35,
    })
    setupMockFetch(mockResponse([s1]))

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText('45')).toBeInTheDocument()
      expect(screen.getByText('35')).toBeInTheDocument()
    })

    // Boys in blue, girls in pink
    const boysEl = screen.getByText('45')
    const girlsEl = screen.getByText('35')
    expect(boysEl.className).toContain('text-blue')
    expect(girlsEl.className).toContain('text-pink')
  })

  it('renders dash when gender data is null', async () => {
    const s1 = session({
      session_cm_id: 1001,
      session_name: 'Session 1',
      session_type: 'main',
      enrolled_boys: null,
      enrolled_girls: null,
    })
    setupMockFetch(mockResponse([s1]))

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText('Session 1')).toBeInTheDocument()
    })

    expect(screen.getByText('--')).toBeInTheDocument()
  })

  // ---------- summary cards ----------

  it('renders header with enrolled/goal summary', async () => {
    const s1 = session({ session_cm_id: 1001, session_name: 'Session 1', session_type: 'main' })
    setupMockFetch(
      mockResponse([s1], {
        enrolled: 80,
        participant_goal: 100,
        pct_of_goal: 80.0,
      })
    )

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getByText('Enrollment Forecast')).toBeInTheDocument()
      expect(screen.getByText(/80\/100/)).toBeInTheDocument()
      expect(screen.getByText(/80\.0% of goal/)).toBeInTheDocument()
    })
  })
})

describe('ForecastPage — Teen Programs section', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMetricsSession.mockReturnValue({
      ...defaultMetricsSession(),
      sessionTypesParam: 'main,embedded,ag,quest,scit,tli',
    })
  })

  it('renders SCIT and TLI rows under a Teen Programs heading without key collisions', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    setupMockFetch(
      mockResponse(
        [
          session({
            session_cm_id: 1001,
            session_name: 'Session 2',
            session_type: 'main',
            enrolled: 120,
          }),
          session({
            session_cm_id: 0,
            session_name: 'SCIT',
            session_type: 'scit',
            enrolled: 30,
            participant_goal: 50,
          }),
          session({
            session_cm_id: 0,
            session_name: 'TLI',
            session_type: 'tli',
            enrolled: 40,
            participant_goal: 40,
          }),
        ],
        // Grand total reflects displayed teens: main 120 + SCIT 30 + TLI 40 = 190.
        { enrolled: 190 }
      )
    )

    renderWithProviders(<ForecastPage />)

    await waitFor(() => {
      expect(screen.getAllByText('Teen Programs').length).toBeGreaterThanOrEqual(1)
    })
    expect(screen.getByRole('heading', { name: 'Teen Programs' })).toBeInTheDocument()
    expect(screen.getByText('SCIT')).toBeInTheDocument()
    expect(screen.getByText('TLI')).toBeInTheDocument()

    // Teens are a displayed cohort, so the grand total must include them (190),
    // not just the camp sessions (120).
    const grandTotalRow = screen.getByText('Grand Total').closest('tr')
    expect(grandTotalRow).not.toBeNull()
    expect(grandTotalRow).toHaveTextContent('190')

    const dupKeyWarning = errorSpy.mock.calls.some((c) => String(c[0]).includes('same key'))
    expect(dupKeyWarning).toBe(false)
    errorSpy.mockRestore()
  })
})
