/**
 * kindred#2205's actual reproduction, not a hypothetical: `ScenarioManagementModal`
 * always renders an outer `ui/Modal` (`:137`), and opens a SECOND `ui/Modal`
 * on top of it in three separate places — the delete/clear confirmation
 * (`:271`), `ScenarioEditModal` (`:317`), `NewScenarioModal` (`:325`). Both
 * modals in every pair register their own bubble-phase `document` Escape
 * listener, so before `ui/modalStack`'s overlay token stack, one keypress
 * closed the inner AND the outer modal together, in all three places.
 *
 * `ScenarioManagementModal.test.tsx` mocks `ScenarioEditModal` and
 * `NewScenarioModal` to `null` for its own (unrelated) assertions — that mock
 * would hide exactly the composition this file exists to pin, so this is a
 * separate file that renders the real children instead.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('../hooks/useSyncStatusAPI', () => ({
  useSyncStatusAPI: () => ({ data: undefined }),
}))

vi.mock('../hooks/useCurrentYear', async () => {
  const actual = await vi.importActual<object>('../hooks/useCurrentYear')
  return { ...actual, useYear: () => 2026 }
})

import ScenarioManagementModal from './ScenarioManagementModal'
import { ScenarioContext } from '../hooks/useScenario'
import type { ScenarioContextType, Scenario } from '../hooks/useScenario'

function makeContext(overrides: Partial<ScenarioContextType> = {}): ScenarioContextType {
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

function renderModal(onClose: () => void) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ScenarioContext value={makeContext()}>{children}</ScenarioContext>
    </QueryClientProvider>
  )
  return render(<ScenarioManagementModal sessionId={1000001} onClose={onClose} />, { wrapper })
}

describe('ScenarioManagementModal — the confirm dialog (:271) on top of the outer modal (:137)', () => {
  it('one Escape closes only the confirm dialog', async () => {
    const onClose = vi.fn()
    renderModal(onClose)
    await userEvent.click(screen.getByRole('button', { name: /clear assignments/i }))
    expect(screen.getByText('Clear Assignments?')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    // Awaited since spec 1c — the confirm's DOM outlives close by Modal's
    // exit fade. Its overlay TOKEN releases synchronously on the flip (D12),
    // which is what the second test below leans on.
    await waitFor(() => expect(screen.queryByText('Clear Assignments?')).not.toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a second Escape then closes the outer modal', async () => {
    const onClose = vi.fn()
    renderModal(onClose)
    await userEvent.click(screen.getByRole('button', { name: /clear assignments/i }))

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('Clear Assignments?')).not.toBeInTheDocument())

    // The second Escape routes to the OUTER modal even if it lands while the
    // confirm is still fading: the confirm's token released on the isOpen
    // flip (D12), so the outer is already the top overlay for its handler.
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ScenarioManagementModal — ScenarioEditModal (:317) on top of the outer modal (:137)', () => {
  it('one Escape closes only the edit modal', async () => {
    const onClose = vi.fn()
    renderModal(onClose)
    await userEvent.click(screen.getByRole('button', { name: /edit scenario/i }))
    expect(screen.getByText('Edit Scenario')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByText('Edit Scenario')).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a second Escape then closes the outer modal', async () => {
    const onClose = vi.fn()
    renderModal(onClose)
    await userEvent.click(screen.getByRole('button', { name: /edit scenario/i }))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByText('Edit Scenario')).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ScenarioManagementModal — NewScenarioModal (:325) on top of the outer modal (:137)', () => {
  it('one Escape closes only the create modal', async () => {
    // "Create New Scenario" names both the trigger button (still on the
    // outer modal, behind this one) and the new modal's own title — the
    // heading role disambiguates.
    const onClose = vi.fn()
    renderModal(onClose)
    await userEvent.click(screen.getByRole('button', { name: /create new scenario/i }))
    expect(screen.getByRole('heading', { name: 'Create New Scenario' })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('heading', { name: 'Create New Scenario' })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a second Escape then closes the outer modal', async () => {
    const onClose = vi.fn()
    renderModal(onClose)
    await userEvent.click(screen.getByRole('button', { name: /create new scenario/i }))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('heading', { name: 'Create New Scenario' })).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
