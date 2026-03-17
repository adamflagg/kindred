/**
 * TDD Tests for NewTraceModal component.
 *
 * Tests that the modal:
 * - Renders three input tabs (Search by Name, Paste CM ID, Browse)
 * - Renders stop-after dropdown and run controls
 * - Does not render when isOpen is false
 * - Calls onClose when cancel is clicked
 * - Disables run trace button when no requests are selected
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { NewTraceModal } from './NewTraceModal'

// Mock the hooks
vi.mock('../../hooks/useSearchPersons', () => ({
  useSearchPersons: () => ({ data: undefined, isLoading: false }),
}))
vi.mock('../../hooks/useOriginalRequestsByCamper', () => ({
  useOriginalRequestsByCamper: () => ({ data: undefined, isLoading: false }),
}))
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({
    fetchWithAuth: vi.fn(),
    isAuthenticated: true,
    isAuthLoading: false,
  }),
}))

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

function renderModal(props = {}) {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onRunTrace: vi.fn(),
    isRunning: false,
    year: 2025,
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <NewTraceModal {...defaultProps} {...props} />
    </QueryClientProvider>
  )
}

describe('NewTraceModal', () => {
  it('renders three input tabs', () => {
    renderModal()
    expect(screen.getByText(/search by name/i)).toBeInTheDocument()
    expect(screen.getByText(/paste cm id/i)).toBeInTheDocument()
    expect(screen.getByText(/browse/i)).toBeInTheDocument()
  })

  it('renders stop after dropdown', () => {
    renderModal()
    expect(screen.getByLabelText(/stop after/i)).toBeInTheDocument()
  })

  it('renders run trace button', () => {
    renderModal()
    expect(screen.getByRole('button', { name: /run trace/i })).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    renderModal({ isOpen: false })
    expect(screen.queryByText(/search by name/i)).not.toBeInTheDocument()
  })

  it('calls onClose when cancel clicked', async () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('run trace button is disabled when no requests selected', () => {
    renderModal()
    expect(screen.getByRole('button', { name: /run trace/i })).toBeDisabled()
  })

  it('renders session dropdown in run controls', () => {
    renderModal()
    expect(screen.getByLabelText(/session/i)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /all sessions/i })).toBeInTheDocument()
  })

  it('renders browse tab with filter dropdowns when selected', async () => {
    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByText(/browse/i))
    expect(screen.getByLabelText(/source field filter/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/processed status filter/i)).toBeInTheDocument()
  })
})
