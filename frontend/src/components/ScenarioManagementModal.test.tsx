/**
 * Regression test for the "list vanishes during delete" bug reported in
 * staff testing (April 2026). See ScenarioContext.test.tsx for full context.
 *
 * The modal must keep rendering the scenario cards while a delete mutation
 * is pending — only the initial query-fetch (isLoading) should swap the list
 * for a "Loading scenarios..." placeholder, not isMutating.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

// Captures the props ScenarioManagementModal forwards to NewScenarioModal
// (kindred#2021: emptyLabel is threaded through so a weekend caller can name
// what it starts empty, matching WeekendScenarioPicker's own direct render).
const newScenarioModalProps = vi.fn()
vi.mock('./NewScenarioModal', () => ({
  default: (props: Record<string, unknown>) => {
    newScenarioModalProps(props)
    return null
  },
}))

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
    isLoading: false,
    isMutating: false,
    error: null,
    loadScenarios: vi.fn().mockResolvedValue(undefined),
    createScenario: vi.fn(),
    selectScenario: vi.fn(),
    updateScenario: vi.fn().mockResolvedValue(undefined),
    deleteScenario: vi.fn().mockResolvedValue(undefined),
    clearScenario: vi.fn().mockResolvedValue('Cleared 0 assignments from scenario for year 2026'),
    ...overrides,
  }
}

function renderModal(ctx: ScenarioContextType, emptyLabel?: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ScenarioContext value={ctx}>{children}</ScenarioContext>
      <Toaster />
    </QueryClientProvider>
  )
  return render(
    <ScenarioManagementModal
      sessionId={1000001}
      onClose={vi.fn()}
      {...(emptyLabel !== undefined && { emptyLabel })}
    />,
    { wrapper }
  )
}

beforeEach(() => {
  newScenarioModalProps.mockReset()
})

describe('ScenarioManagementModal loading state', () => {
  it('shows "Loading scenarios..." during initial query fetch', () => {
    // Matches what ScenarioContext produces when the query is first loading:
    // isLoading=true and scenarios list not yet fetched.
    renderModal(makeContext({ isLoading: true, scenarios: [] }))
    expect(screen.getByText('Loading scenarios...')).toBeInTheDocument()
  })

  it('keeps scenario cards visible while a delete mutation is pending', () => {
    // Simulates real context state mid-delete: the query has already resolved
    // (isLoading=false) but a mutation is pending (isMutating=true). The modal
    // uses isLoading (not isMutating) to show the placeholder, so cards remain
    // visible while the delete processes.
    renderModal(makeContext({ isLoading: false, isMutating: true }))

    expect(screen.getByText('Dorm Cabin Plan A')).toBeInTheDocument()
    expect(screen.queryByText('Loading scenarios...')).not.toBeInTheDocument()
  })
})

describe('the create-modal invocation (kindred#2021 parity)', () => {
  it('forwards no emptyLabel by default, so NewScenarioModal falls back to its own ("empty bunks")', async () => {
    renderModal(makeContext({}))
    await userEvent.click(screen.getByRole('button', { name: /Create New Scenario/i }))

    expect(newScenarioModalProps).toHaveBeenCalled()
    const props = newScenarioModalProps.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(props['emptyLabel']).toBeUndefined()
  })

  it('forwards a caller-supplied emptyLabel — WeekendScenarioPicker uses this for weekend wording', async () => {
    renderModal(makeContext({}), 'Start with an empty plan')
    await userEvent.click(screen.getByRole('button', { name: /Create New Scenario/i }))

    expect(newScenarioModalProps).toHaveBeenCalled()
    const props = newScenarioModalProps.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(props['emptyLabel']).toBe('Start with an empty plan')
  })
})

describe('clearing a scenario names its own session', () => {
  it('passes sessionId as the third clearScenario argument, for weekend cache invalidation', async () => {
    // POST /api/scenarios/{id}/clear resolves the program from the
    // scenario's own `session` relation server-side, but the frontend cache
    // key (queryKeys.weekendRoster) still needs the session cm id — this is
    // where it comes from (ScenarioManagementModal already knows it; every
    // scenario listed here belongs to this same session).
    const clearScenario = vi
      .fn()
      .mockResolvedValue('Cleared 0 assignments from scenario for year 2026')
    renderModal(makeContext({ clearScenario }))

    await userEvent.click(screen.getByRole('button', { name: /clear assignments/i }))
    await userEvent.click(screen.getByRole('button', { name: /^clear$/i }))

    expect(clearScenario).toHaveBeenCalledWith('scenario-1', 2026, 1000001)
  })

  it('toasts the server’s own message, not a fixed string that reads the same at 0 or 400 rows', async () => {
    const clearScenario = vi
      .fn()
      .mockResolvedValue('Cleared 47 assignments from scenario for year 2026')
    renderModal(makeContext({ clearScenario }))

    await userEvent.click(screen.getByRole('button', { name: /clear assignments/i }))
    await userEvent.click(screen.getByRole('button', { name: /^clear$/i }))

    await waitFor(() =>
      expect(
        screen.getByText('Cleared 47 assignments from scenario for year 2026')
      ).toBeInTheDocument()
    )
  })
})
