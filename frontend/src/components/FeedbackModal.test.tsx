import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { FeedbackModal } from './FeedbackModal'

// Mock pocketbase
vi.mock('../lib/pocketbase', () => ({
  pb: {
    authStore: {
      record: { id: 'user-1', name: 'Jane Smith', email: 'jane@example.com' },
    },
    send: vi.fn(),
  },
}))

// Mock useAuth
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', name: 'Jane Smith', email: 'jane@example.com' },
    isAuthenticated: true,
    isLoading: false,
  }),
}))

function renderModal(props: { isOpen: boolean; onClose: () => void }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <FeedbackModal {...props} />
    </QueryClientProvider>
  )
}

describe('FeedbackModal', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when closed', () => {
    const { container } = renderModal({ isOpen: false, onClose: mockOnClose })
    expect(container.innerHTML).toBe('')
  })

  it('renders form fields when open', () => {
    renderModal({ isOpen: true, onClose: mockOnClose })

    expect(screen.getByText('Report a Problem')).toBeInTheDocument()
    expect(screen.getByText('Bug')).toBeInTheDocument()
    expect(screen.getByText('Text Change')).toBeInTheDocument()
    expect(screen.getByText('Feature Request')).toBeInTheDocument()
    expect(screen.getByText('Question')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/what happened/i)).toBeInTheDocument()
  })

  it('requires category selection before submit', () => {
    renderModal({ isOpen: true, onClose: mockOnClose })

    const submitButton = screen.getByRole('button', { name: /submit/i })
    expect(submitButton).toBeDisabled()
  })

  it('requires description before submit', () => {
    renderModal({ isOpen: true, onClose: mockOnClose })

    // Select a category
    fireEvent.click(screen.getByText('Bug'))

    // Submit should still be disabled (no description)
    const submitButton = screen.getByRole('button', { name: /submit/i })
    expect(submitButton).toBeDisabled()
  })

  it('enables submit when category and description are provided', () => {
    renderModal({ isOpen: true, onClose: mockOnClose })

    // Select category
    fireEvent.click(screen.getByText('Bug'))

    // Enter description
    const textarea = screen.getByPlaceholderText(/what happened/i)
    fireEvent.change(textarea, { target: { value: 'The save button is broken' } })

    const submitButton = screen.getByRole('button', { name: /submit/i })
    expect(submitButton).not.toBeDisabled()
  })

  it('shows file input for screenshot', () => {
    renderModal({ isOpen: true, onClose: mockOnClose })

    const fileInput = screen.getByLabelText(/screenshot/i)
    expect(fileInput).toBeInTheDocument()
    expect(fileInput).toHaveAttribute('accept', 'image/*')
  })

  it('rejects screenshot over 5MB', async () => {
    renderModal({ isOpen: true, onClose: mockOnClose })

    const fileInput = screen.getByLabelText(/screenshot/i)
    const largeFile = new File(['x'.repeat(6 * 1024 * 1024)], 'big.png', {
      type: 'image/png',
    })

    fireEvent.change(fileInput, { target: { files: [largeFile] } })

    await waitFor(() => {
      expect(screen.getByText(/5MB/i)).toBeInTheDocument()
    })
  })

  it('resets form state when modal is closed and reopened', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <FeedbackModal isOpen={true} onClose={mockOnClose} />
      </QueryClientProvider>
    )

    // Fill in form data
    fireEvent.click(screen.getByText('Bug'))
    const textarea = screen.getByPlaceholderText(/what happened/i)
    fireEvent.change(textarea, { target: { value: 'Some feedback text' } })

    // Close modal
    rerender(
      <QueryClientProvider client={queryClient}>
        <FeedbackModal isOpen={false} onClose={mockOnClose} />
      </QueryClientProvider>
    )

    // Reopen modal
    rerender(
      <QueryClientProvider client={queryClient}>
        <FeedbackModal isOpen={true} onClose={mockOnClose} />
      </QueryClientProvider>
    )

    // Form should be reset
    const newTextarea = screen.getByPlaceholderText(/what happened/i)
    expect(newTextarea).toHaveValue('')

    // Category should not be pre-selected (submit should be disabled)
    const submitButton = screen.getByRole('button', { name: /submit/i })
    expect(submitButton).toBeDisabled()
  })

  it('preserves text on submission error', async () => {
    const { pb } = await import('../lib/pocketbase')
    vi.mocked(pb.send).mockRejectedValueOnce(new Error('Network error'))

    renderModal({ isOpen: true, onClose: mockOnClose })

    fireEvent.click(screen.getByText('Bug'))
    const textarea = screen.getByPlaceholderText(/what happened/i)
    fireEvent.change(textarea, { target: { value: 'Something broke' } })
    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    await waitFor(() => {
      // Modal should stay open (onClose not called)
      expect(mockOnClose).not.toHaveBeenCalled()
      // Text should be preserved
      expect(textarea).toHaveValue('Something broke')
    })
  })
})
