/**
 * Regression test for the "list vanishes during delete" bug reported in
 * staff testing (April 2026). See ScenarioContext.test.tsx for full context.
 *
 * The modal must keep rendering the scenario cards while a delete mutation
 * is pending — only the initial query-fetch state should swap the list for
 * a "Loading scenarios..." placeholder.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Toaster } from 'react-hot-toast'

// Mock useSyncStatusAPI — modal uses it for the CampMinder "synced" line.
vi.mock('../hooks/useSyncStatusAPI', () => ({
  useSyncStatusAPI: () => ({ data: undefined }),
}))

// Mock useYear — modal reads currentYear for clear-scenario calls.
vi.mock('../hooks/useCurrentYear', async () => {
  const actual = await vi.importActual<object>('../hooks/useCurrentYear')
  return { ...actual, useYear: () => 2026 }
})

// Render the modal without its child modals doing anything.
vi.mock('./ScenarioEditModal', () => ({ default: () => null }))
vi.mock('./NewScenarioModal', () => ({ default: () => null }))

import ScenarioManagementModal from './ScenarioManagementModal'
import { ScenarioContext } from '../hooks/useScenario'
import type { ScenarioContextType, Scenario } from '../hooks/useScenario'

function makeContext(overrides: Partial<ScenarioContextType>): ScenarioContextType {
  const scenarios: Scenario[] = [
    {
      id: 'scenario-1',
      name: 'Dorm Cabin Plan A',
      session_cm_id: 1000001,
      is_active: true,
      description: '',
      created: '2026-04-01T00:00:00Z',
      updated: '2026-04-01T00:00:00Z',
    },
  ]
  return {
    currentScenario: null,
    isProductionMode: true,
    scenarios,
    loading: false,
    isLoading: false,
    isMutating: false,
    error: null,
    loadScenarios: vi.fn().mockResolvedValue(undefined),
    createScenario: vi.fn(),
    selectScenario: vi.fn(),
    updateScenario: vi.fn().mockResolvedValue(undefined),
    deleteScenario: vi.fn().mockResolvedValue(undefined),
    clearScenario: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as ScenarioContextType
}

function renderModal(ctx: ScenarioContextType) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ScenarioContext.Provider value={ctx}>{children}</ScenarioContext.Provider>
      <Toaster />
    </QueryClientProvider>
  )
  return render(<ScenarioManagementModal sessionId={1000001} onClose={vi.fn()} />, { wrapper })
}

describe('ScenarioManagementModal loading state', () => {
  it('shows "Loading scenarios..." during initial query fetch', () => {
    // Matches what ScenarioContext produces when the query is first loading:
    // loading=true AND isLoading=true (scenarios list not yet fetched).
    renderModal(makeContext({ loading: true, isLoading: true, scenarios: [] }))
    expect(screen.getByText('Loading scenarios...')).toBeInTheDocument()
  })

  it('keeps scenario cards visible while a delete mutation is pending', () => {
    // Simulates real context state mid-delete: the combined loading flag
    // is true (because isMutating is true), but the query has already
    // resolved (isLoading=false). Prior to the fix, the modal consumed the
    // combined `loading` and swapped the list for the placeholder — this
    // test asserts the fix by requiring the cards to remain visible.
    renderModal(makeContext({ loading: true, isLoading: false, isMutating: true }))

    expect(screen.getByText('Dorm Cabin Plan A')).toBeInTheDocument()
    expect(screen.queryByText('Loading scenarios...')).not.toBeInTheDocument()
  })
})
