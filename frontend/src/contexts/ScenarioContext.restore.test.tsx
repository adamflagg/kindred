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
      <button onClick={() => void loadScenarios(1002)}>Load session 1002</button>
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

  // ---------------------------------------------------------------------------
  // Finding 1 (critical) + Finding 4 (high): race condition — persist effect
  // clears localStorage before restore effect can read it.
  //
  // Sequence that triggers the bug on the original code:
  //   1. Initial mount with currentSessionId=undefined → useSavedScenarios returns []
  //      → Effect 2 (restore) fires, sets restoreCompletedRef.current=true
  //   2. loadScenarios(1001) → currentSessionId=1001
  //   3. useSavedScenarios(1001) first returns [] (loading phase)
  //      → Effect 1 (persist) fires: currentScenario=null, restoreCompletedRef.current=true
  //        → clearStoredScenarioId(1001) is called — key is WIPED before restore reads it
  //   4. Scenarios arrive → restore fires but key is already gone → stays production mode
  //
  // The fix tracks which session completed restore (restoreCompletedForSessionRef stores
  // the sessionId, not a boolean). Persist only clears when
  // restoreCompletedForSessionRef.current === sessionId, so a prior session's restore
  // completion cannot unlock the new session's clear.
  // ---------------------------------------------------------------------------
  it('does not clear localStorage before restore runs (async useSavedScenarios path)', async () => {
    // User had scenario-alpha active for session 1001 on last visit
    mockGetStoredScenarioId.mockImplementation((sessionId) =>
      sessionId === 1001 ? 'scenario-alpha' : null
    )

    const scenarioAlpha = makeScenario('scenario-alpha')

    // Phase 1: initial mount (currentSessionId=undefined) — return empty list
    // Phase 2: immediately after loadScenarios(1001) — still loading, return empty list
    // This simulates the window where React Query hasn't fetched for session 1001 yet.
    // In this window the bug fires: persist effect sees restoreCompleted=true + null scenario
    // → clears the key for session 1001 before restore can read it.
    let scenariosPhase: 'loading' | 'loaded' = 'loading'
    mockSavedScenarios.mockImplementation(() => {
      if (scenariosPhase === 'loading') {
        return { data: [], isLoading: true, error: null }
      }
      return { data: [scenarioAlpha], isLoading: false, error: null }
    })

    render(<ScenarioConsumer />, { wrapper: Wrapper })

    // Initial mount: currentSessionId=undefined, useSavedScenarios returns [].
    // Effect 2 runs → sets restoreCompletedRef.current=true (buggy) or
    // restoreCompletedForSessionRef.current=undefined (fixed).
    await act(async () => {
      // let initial effects settle
    })

    // loadScenarios(1001): currentSessionId becomes 1001.
    // Both effects fire. Persist effect runs first.
    // BUG: sees restoreCompleted=true + null scenario → clears key for 1001.
    // FIX: restoreCompletedForSessionRef.current=undefined ≠ 1001 → skips clear.
    await act(async () => {
      screen.getByText('Load session 1001').click()
    })

    // Key assertion: the bug calls clearStoredScenarioId(1001) immediately here
    // because the restore phase (from the initial mount) was marked complete.
    // After the fix it must NOT be called for session 1001 at this point.
    expect(mockClearStoredScenarioId).not.toHaveBeenCalledWith(1001)

    // Now simulate scenarios arriving (React Query resolves) by switching to a
    // session with data available immediately. This verifies the restore path works
    // once the race condition no longer clears the key prematurely.
    scenariosPhase = 'loaded'
    mockSavedScenarios.mockReturnValue({
      data: [scenarioAlpha],
      isLoading: false,
      error: null,
    })

    // Load another session ID and back to force a state-change re-render that
    // picks up the new mockSavedScenarios return value.
    await act(async () => {
      screen.getByText('Load session 1002').click()
    })
    await act(async () => {
      screen.getByText('Load session 1001').click()
    })

    await waitFor(
      () => {
        expect(screen.getByTestId('scenario-id').textContent).toBe('scenario-alpha')
      },
      { timeout: 2000 }
    )

    // Clear was never called for session 1001 throughout the whole flow
    expect(mockClearStoredScenarioId).not.toHaveBeenCalledWith(1001)
  })

  // ---------------------------------------------------------------------------
  // Finding 2 (high): persist effect writes scenarioA's id under sessionB's key.
  //
  // Sequence that triggers the bug:
  //   1. Session 1001 is active with scenario-alpha selected
  //   2. loadScenarios(1002) fires → currentSessionId=1002
  //   3. Effect 1 (persist) fires: currentSessionId=1002 but currentScenario=scenario-alpha
  //      → setStoredScenarioId(1002, 'scenario-alpha') — cross-session write!
  //
  // The fix gates persist on scenario.sessionId === currentSessionId, preventing
  // cross-session writes when currentScenario hasn't cleared yet.
  // ---------------------------------------------------------------------------
  it('does not write scenario from session A under session B key when switching sessions', async () => {
    // Session 1001 is active and scenario-alpha (belonging to 1001) is selected
    mockGetStoredScenarioId.mockImplementation((sessionId) =>
      sessionId === 1001 ? 'scenario-alpha' : null
    )

    const scenarioAlpha = makeScenario('scenario-alpha', 1001)
    const scenarioBeta = makeScenario('scenario-beta', 1002)

    // We use a ref-based approach: first loadScenarios(1001) triggers restore,
    // then loadScenarios(1002) switches sessions.
    // Track calls by which session is being queried.
    mockSavedScenarios.mockImplementation(() => {
      // Return based on what was last set as currentSessionId.
      // Since we can't easily inspect that here, we rely on call order:
      // the test drives scenario data via external state.
      return { data: [scenarioAlpha], isLoading: false, error: null }
    })

    const TestConsumer = () => {
      const { currentScenario, isProductionMode, loadScenarios } = useScenario()
      return (
        <div>
          <div data-testid="scenario-id">{currentScenario?.id ?? 'none'}</div>
          <div data-testid="production-mode">{isProductionMode ? 'production' : 'scenario'}</div>
          <button onClick={() => void loadScenarios(1001)}>Load session 1001</button>
          <button onClick={() => void loadScenarios(1002)}>Load session 1002</button>
        </div>
      )
    }

    function TestWrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={createQueryClient()}>
          <ScenarioProvider>{children}</ScenarioProvider>
        </QueryClientProvider>
      )
    }

    render(<TestConsumer />, { wrapper: TestWrapper })

    // Step 1: load session 1001 and wait for scenario-alpha to be restored
    await act(async () => {
      screen.getByText('Load session 1001').click()
    })

    await waitFor(() => {
      expect(screen.getByTestId('scenario-id').textContent).toBe('scenario-alpha')
    })

    // Clear call records from the restore phase so we can inspect only what happens
    // during the session switch.
    mockSetStoredScenarioId.mockClear()

    // Step 2: switch to session 1002
    // Now useSavedScenarios returns session 1002 scenarios
    mockSavedScenarios.mockReturnValue({
      data: [scenarioBeta],
      isLoading: false,
      error: null,
    })

    await act(async () => {
      screen.getByText('Load session 1002').click()
    })

    // The bug: setStoredScenarioId(1002, 'scenario-alpha') would be called here
    // because currentScenario is still scenario-alpha when the persist effect fires.
    // After the fix: no cross-session write for scenario-alpha under session 1002.
    const crossSessionWrites = mockSetStoredScenarioId.mock.calls.filter(
      ([sessionId, scenarioId]) => sessionId === 1002 && scenarioId === 'scenario-alpha'
    )
    expect(crossSessionWrites).toHaveLength(0)
  })
})
