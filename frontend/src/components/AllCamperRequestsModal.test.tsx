import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AllCamperRequestsModal } from './AllCamperRequestsModal'

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: () => ({
      getFullList: () => Promise.resolve([]),
    }),
  },
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, isLoading: false }),
}))

function renderModal(overrides: Partial<React.ComponentProps<typeof AllCamperRequestsModal>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AllCamperRequestsModal
        isOpen={true}
        onClose={vi.fn()}
        requesterCmId={1000001}
        requesterName="Emma Johnson"
        year={2026}
        currentRequestId={null}
        {...overrides}
      />
    </QueryClientProvider>
  )
}

describe('AllCamperRequestsModal shell', () => {
  it('renders the camper name in the title', async () => {
    renderModal()
    expect(await screen.findByText(/Emma Johnson/)).toBeTruthy()
  })

  it('shows the empty-state when the camper has no requests', async () => {
    renderModal()
    expect(await screen.findByText(/No other requests from this camper/i)).toBeTruthy()
  })

  it('fires onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    const close = await screen.findByLabelText(/close/i)
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not render when isOpen is false', () => {
    const { container } = renderModal({ isOpen: false })
    expect(container.textContent).not.toContain('Emma Johnson')
  })
})
