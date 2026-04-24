/**
 * Integration tests for ScenarioContext — last-active-scenario localStorage restore.
 *
 * Covers scoreboard item #49: the bunking board must restore the last active scenario
 * on mount/refresh rather than defaulting to CampMinder source-of-truth.
 *
 * Scenarios tested:
 *  1. Stored scenario id exists and matches a loaded scenario → auto-select it
 *  2. Stored scenario id no longer exists (deleted) → fall back to production mode,
 *     clear the stale key
 *  3. No stored id → stay in production mode
 *  4. Selecting a scenario writes it to localStorage
 *  5. Switching to production mode (null) clears the key for that session
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ScenarioProvider } from './ScenarioContext'
import { useScenario } from '../hooks/useScenario'

// ---------------------------------------------------------------------------
// Mock scenarioStorage so we control what's "in localStorage" without needing
// a real browser localStorage (the setup.ts stub uses non-functional vi.fn()s).
// ---------------------------------------------------------------------------
const mockGetStoredScenarioId = vi.fn<(sessionCmId: number) => string | null>()
const mockSetStoredScenarioId = vi.fn<(sessionCmId: number, scenarioId: string) => void>()
const mockClearStoredScenarioId = vi.fn<(sessionCmId: number) => void>()

vi.mock('../utils/scenarioStorage', () => ({
  SCENARIO_STORAGE_KEY: 'kindred.scenarioBySession',
  getStoredScenarioId: (id: number) => mockGetStoredScenarioId(id),
  setStoredScenarioId: (id: number, sid: string) => mockSetStoredScenarioId(id, sid),
  clearStoredScenarioId: (id: number) => mockClearStoredScenarioId(id),
}))

// ---------------------------------------------------------------------------
// Mock pocketbase + auth so useSavedScenarios and useAuth don't blow up
// ---------------------------------------------------------------------------
vi.mock('../lib/pocketbase', () => ({
  pb: {
    authStore: { isValid: true, token: 'tok', model: { id: 'u1' } },
    collection: vi.fn(),
  },
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, isAuthenticated: true, user: { id: 'u1' } }),
}))

vi.mock('../hooks/useCurrentYear', () => ({
  useYear: () => 2025,
}))

// We'll control what useSavedScenarios returns from the test
const mockSavedScenarios = vi.fn()
vi.mock('../hooks/useSavedScenarios', () => ({
  useSavedScenarios: () => mockSavedScenarios(),
}))

// Stub out the mutation hooks — they're not exercised in these tests
vi.mock('../hooks/useSavedScenariosMutation', () => ({
  useCreateScenario: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useDeleteScenario: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}))
vi.mock('../hooks/useScenarioOperations', () => ({
  useUpdateScenario: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useClearScenario: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeScenario(id: string, sessionCmId = 1001) {
  return {
    id,
    collectionId: 'saved_scenarios',
    collectionName: 'saved_scenarios',
    name: `Scenario ${id}`,
    session: 'pb-session-1',
    year: 2025,
    is_active: true,
    session_cm_id: sessionCmId,
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    description: '',
    expand: { session: { cm_id: sessionCmId } },
  }
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <ScenarioProvider>{children}</ScenarioProvider>
    </QueryClientProvider>
  )
}

/** Consumer that exposes context state and lets us call selectScenario / loadScenarios */
function ScenarioConsumer({
  onSelectScenario,
}: {
  onSelectScenario?: (fn: (id: string | null) => void) => void
}) {
  const { currentScenario, isProductionMode, loadScenarios, selectScenario } = useScenario()

  // Expose selectScenario to the test via callback ref
  if (onSelectScenario) onSelectScenario(selectScenario)

  return (
    <div>
      <div data-testid="scenario-id">{currentScenario?.id ?? 'none'}</div>
      <div data-testid="production-mode">{isProductionMode ? 'production' : 'scenario'}</div>
      <button onClick={() => void loadScenarios(1001)}>Load session 1001</button>
      <button onClick={() => selectScenario('scenario-alpha')}>Select alpha</button>
      <button onClick={() => selectScenario(null)}>Select production</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ScenarioContext — last-active-scenario restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: nothing stored in localStorage
    mockGetStoredScenarioId.mockReturnValue(null)
  })

  it('restores the stored scenario when it matches a loaded scenario (happy path)', async () => {
    // Simulate: user had scenario-alpha active for session 1001 on last visit
    mockGetStoredScenarioId.mockImplementation((sessionId) =>
      sessionId === 1001 ? 'scenario-alpha' : null
    )

    const scenarioAlpha = makeScenario('scenario-alpha')
    mockSavedScenarios.mockReturnValue({
      data: [scenarioAlpha],
      isLoading: false,
      error: null,
    })

    render(<ScenarioConsumer />, { wrapper: Wrapper })

    // loadScenarios sets currentSessionId → triggers scenario restoration
    await act(async () => {
      screen.getByText('Load session 1001').click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('scenario-id').textContent).toBe('scenario-alpha')
      expect(screen.getByTestId('production-mode').textContent).toBe('scenario')
    })
  })

  it('falls back to production mode when stored scenario id is not in the loaded list (deleted)', async () => {
    // Stale id — scenario was deleted on the server
    mockGetStoredScenarioId.mockImplementation((sessionId) =>
      sessionId === 1001 ? 'scenario-deleted' : null
    )

    mockSavedScenarios.mockReturnValue({
      data: [makeScenario('scenario-alpha')], // 'scenario-deleted' is NOT in this list
      isLoading: false,
      error: null,
    })

    render(<ScenarioConsumer />, { wrapper: Wrapper })

    await act(async () => {
      screen.getByText('Load session 1001').click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('scenario-id').textContent).toBe('none')
      expect(screen.getByTestId('production-mode').textContent).toBe('production')
    })

    // The stale key should have been cleared
    expect(mockClearStoredScenarioId).toHaveBeenCalledWith(1001)
  })

  it('stays in production mode when no scenario is stored for the session', async () => {
    // mockGetStoredScenarioId returns null (set in beforeEach)
    mockSavedScenarios.mockReturnValue({
      data: [makeScenario('scenario-alpha')],
      isLoading: false,
      error: null,
    })

    render(<ScenarioConsumer />, { wrapper: Wrapper })

    await act(async () => {
      screen.getByText('Load session 1001').click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('scenario-id').textContent).toBe('none')
      expect(screen.getByTestId('production-mode').textContent).toBe('production')
    })
  })

  it('writes the selected scenario id to localStorage when a scenario is chosen', async () => {
    mockSavedScenarios.mockReturnValue({
      data: [makeScenario('scenario-alpha')],
      isLoading: false,
      error: null,
    })

    render(<ScenarioConsumer />, { wrapper: Wrapper })

    await act(async () => {
      screen.getByText('Load session 1001').click()
    })

    await act(async () => {
      screen.getByText('Select alpha').click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('scenario-id').textContent).toBe('scenario-alpha')
    })

    expect(mockSetStoredScenarioId).toHaveBeenCalledWith(1001, 'scenario-alpha')
  })

  it('clears the localStorage key for the session when switching back to production mode', async () => {
    // Simulate stored scenario for session 1001
    mockGetStoredScenarioId.mockImplementation((sessionId) =>
      sessionId === 1001 ? 'scenario-alpha' : null
    )

    mockSavedScenarios.mockReturnValue({
      data: [makeScenario('scenario-alpha')],
      isLoading: false,
      error: null,
    })

    render(<ScenarioConsumer />, { wrapper: Wrapper })

    await act(async () => {
      screen.getByText('Load session 1001').click()
    })

    // Wait for restore
    await waitFor(() => {
      expect(screen.getByTestId('scenario-id').textContent).toBe('scenario-alpha')
    })

    // Now switch back to production
    await act(async () => {
      screen.getByText('Select production').click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('production-mode').textContent).toBe('production')
    })

    // clearStoredScenarioId should have been called for session 1001
    expect(mockClearStoredScenarioId).toHaveBeenCalledWith(1001)
  })
})
