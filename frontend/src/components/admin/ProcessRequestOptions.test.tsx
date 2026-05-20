import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ProcessRequestOptions from './ProcessRequestOptions'
import { SOURCE_FIELD_OPTIONS } from '../../utils/sourceFieldLabels'

// Mock PocketBase lib - data must be inline since vi.mock is hoisted
// Generic cm_id values for testing — dropdown uses cm_id as value
vi.mock('../../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn().mockReturnValue({
      getFullList: vi.fn().mockResolvedValue([
        {
          id: 'pb1',
          cm_id: 1000001,
          name: 'Taste of Camp 1',
          session_type: 'main',
          year: 2025,
          start_date: '2025-06-01',
        },
        {
          id: 'pb1b',
          cm_id: 1000002,
          name: 'Taste of Camp 2',
          session_type: 'embedded',
          year: 2025,
          start_date: '2025-06-05',
        },
        {
          id: 'pb2',
          cm_id: 1000003,
          name: 'Session 2',
          session_type: 'main',
          year: 2025,
          start_date: '2025-06-15',
        },
        {
          id: 'pb3',
          cm_id: 1000004,
          name: 'Session 2a',
          session_type: 'embedded',
          year: 2025,
          start_date: '2025-06-15',
        },
        {
          id: 'pb4',
          cm_id: 1000005,
          name: 'Session 2b',
          session_type: 'embedded',
          year: 2025,
          start_date: '2025-06-22',
        },
        {
          id: 'pb5',
          cm_id: 1000006,
          name: 'Session 3',
          session_type: 'main',
          year: 2025,
          start_date: '2025-07-01',
        },
        {
          id: 'pb6',
          cm_id: 1000007,
          name: 'Session 3a',
          session_type: 'embedded',
          year: 2025,
          start_date: '2025-07-08',
        },
        {
          id: 'pb7',
          cm_id: 1000008,
          name: 'Session 4',
          session_type: 'main',
          year: 2025,
          start_date: '2025-07-15',
        },
      ]),
    }),
  },
}))

// Mock useYear hook
vi.mock('../../hooks/useCurrentYear', () => ({
  useYear: () => 2025,
}))

// Test wrapper with QueryClient
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('ProcessRequestOptions', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    isProcessing: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when closed', () => {
    render(<ProcessRequestOptions {...defaultProps} isOpen={false} />, {
      wrapper: createWrapper(),
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders dialog when open', () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/process requests/i)).toBeInTheDocument()
  })

  it('shows all sessions including both Taste of Camp 1 and 2 (no collision)', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    expect(screen.getByRole('option', { name: /all sessions/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /taste of camp 1/i })).toBeInTheDocument()
    })
    // Both ToC sessions visible — this was the bug (ToC 1 was hidden by name collision)
    expect(screen.getByRole('option', { name: /taste of camp 2/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^session 2$/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /session 2a/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /session 2b/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^session 3$/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /session 3a/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /session 4/i })).toBeInTheDocument()
  })

  it('uses cm_id as dropdown value, not friendly name', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /^session 2$/i })).toBeInTheDocument()
    })

    // Select Session 2 — value should be cm_id "1000003", not friendly name "2"
    const sessionSelect = screen.getByLabelText(/session/i)
    await userEvent.selectOptions(sessionSelect, '1000003')

    fireEvent.click(screen.getByRole('button', { name: /^process$/i }))

    expect(defaultProps.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        session: '1000003',
      })
    )
  })

  it('has source field checkboxes', () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    expect(screen.getByText(/source fields/i)).toBeInTheDocument()

    for (const field of SOURCE_FIELD_OPTIONS) {
      expect(screen.getByLabelText(field.label)).toBeInTheDocument()
    }
  })

  it('source field checkboxes are unchecked by default (meaning all fields)', () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    for (const field of SOURCE_FIELD_OPTIONS) {
      expect(screen.getByLabelText(field.label)).not.toBeChecked()
    }
  })

  it('has optional limit input', () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    const limitInput = screen.getByLabelText(/limit/i)
    expect(limitInput).toBeInTheDocument()
    expect(limitInput).toHaveAttribute('type', 'number')
    expect(limitInput).toHaveAttribute('placeholder', 'No limit')
  })

  it('has force reprocess checkbox with warning', () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    const forceCheckbox = screen.getByLabelText(/force reprocess/i)
    expect(forceCheckbox).toBeInTheDocument()
    expect(forceCheckbox).toHaveAttribute('type', 'checkbox')

    expect(screen.queryByText(/will clear processed flags/i)).not.toBeInTheDocument()
  })

  it('shows force warning when checkbox is checked', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    const forceCheckbox = screen.getByLabelText(/force reprocess/i)
    await userEvent.click(forceCheckbox)

    expect(screen.getByText(/will clear processed flags/i)).toBeInTheDocument()
  })

  it('calls onClose when cancel button clicked', () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
    expect(defaultProps.onSubmit).not.toHaveBeenCalled()
  })

  it('calls onSubmit with default options when process button clicked', () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    fireEvent.click(screen.getByRole('button', { name: /^process$/i }))

    expect(defaultProps.onSubmit).toHaveBeenCalledWith({
      session: 'all',
      sessionLabel: 'All Sessions',
      limit: undefined,
      forceReprocess: false,
      sourceFields: [],
      debug: false,
      trace: false,
      collectTraces: false,
    })
  })

  it('calls onSubmit with selected session cm_id', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /^session 2$/i })).toBeInTheDocument()
    })

    const sessionSelect = screen.getByLabelText(/session/i)
    await userEvent.selectOptions(sessionSelect, '1000003')

    fireEvent.click(screen.getByRole('button', { name: /^process$/i }))

    expect(defaultProps.onSubmit).toHaveBeenCalledWith({
      session: '1000003',
      sessionLabel: 'Session 2',
      limit: undefined,
      forceReprocess: false,
      sourceFields: [],
      debug: false,
      trace: false,
      collectTraces: false,
    })
  })

  it('calls onSubmit with selected embedded session cm_id', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /session 2a/i })).toBeInTheDocument()
    })

    const sessionSelect = screen.getByLabelText(/session/i)
    await userEvent.selectOptions(sessionSelect, '1000004')

    fireEvent.click(screen.getByRole('button', { name: /^process$/i }))

    expect(defaultProps.onSubmit).toHaveBeenCalledWith({
      session: '1000004',
      sessionLabel: 'Session 2a',
      limit: undefined,
      forceReprocess: false,
      sourceFields: [],
      debug: false,
      trace: false,
      collectTraces: false,
    })
  })

  it('calls onSubmit with selected source fields', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    await userEvent.click(screen.getByLabelText('Bunk With'))
    await userEvent.click(screen.getByLabelText('Not Bunk With'))

    fireEvent.click(screen.getByRole('button', { name: /^process$/i }))

    expect(defaultProps.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFields: expect.arrayContaining(['bunk_request_form', 'staff_not_bunk_with']),
      })
    )
    const firstCall = defaultProps.onSubmit.mock.calls[0]
    if (!firstCall) throw new Error('Expected onSubmit to be called')
    expect(firstCall[0].sourceFields).toHaveLength(2)
  })

  it('calls onSubmit with limit when provided', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    const limitInput = screen.getByLabelText(/limit/i)
    await userEvent.clear(limitInput)
    await userEvent.type(limitInput, '25')

    fireEvent.click(screen.getByRole('button', { name: /^process$/i }))

    expect(defaultProps.onSubmit).toHaveBeenCalledWith({
      session: 'all',
      sessionLabel: 'All Sessions',
      limit: 25,
      forceReprocess: false,
      sourceFields: [],
      debug: false,
      trace: false,
      collectTraces: false,
    })
  })

  it('calls onSubmit with forceReprocess when checked', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    const forceCheckbox = screen.getByLabelText(/force reprocess/i)
    await userEvent.click(forceCheckbox)

    fireEvent.click(screen.getByRole('button', { name: /^process$/i }))

    expect(defaultProps.onSubmit).toHaveBeenCalledWith({
      session: 'all',
      sessionLabel: 'All Sessions',
      limit: undefined,
      forceReprocess: true,
      sourceFields: [],
      debug: false,
      trace: false,
      collectTraces: false,
    })
  })

  it('calls onSubmit with all options combined', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /session 3a/i })).toBeInTheDocument()
    })

    const sessionSelect = screen.getByLabelText(/session/i)
    await userEvent.selectOptions(sessionSelect, '1000007')

    await userEvent.click(screen.getByLabelText('Internal Notes'))
    await userEvent.click(screen.getByLabelText('Bunking Notes'))

    const limitInput = screen.getByLabelText(/limit/i)
    await userEvent.clear(limitInput)
    await userEvent.type(limitInput, '15')

    const forceCheckbox = screen.getByLabelText(/force reprocess/i)
    await userEvent.click(forceCheckbox)

    fireEvent.click(screen.getByRole('button', { name: /^process$/i }))

    expect(defaultProps.onSubmit).toHaveBeenCalledWith({
      session: '1000007',
      sessionLabel: 'Session 3a',
      limit: 15,
      forceReprocess: true,
      sourceFields: expect.arrayContaining(['internal_notes', 'bunking_notes']),
      debug: false,
      trace: false,
      collectTraces: false,
    })
  })

  it('disables buttons when isProcessing is true', () => {
    render(<ProcessRequestOptions {...defaultProps} isProcessing={true} />, {
      wrapper: createWrapper(),
    })

    expect(screen.getByRole('button', { name: /processing/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled()
  })

  it('shows processing state on button', () => {
    render(<ProcessRequestOptions {...defaultProps} isProcessing={true} />, {
      wrapper: createWrapper(),
    })

    expect(screen.getByRole('button', { name: /processing/i })).toBeInTheDocument()
  })

  it('validates limit is positive number', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    const limitInput = screen.getByLabelText(/limit/i)
    await userEvent.clear(limitInput)
    await userEvent.type(limitInput, '-5')

    fireEvent.click(screen.getByRole('button', { name: /^process$/i }))

    expect(defaultProps.onSubmit).toHaveBeenCalledWith({
      session: 'all',
      sessionLabel: 'All Sessions',
      limit: undefined,
      forceReprocess: false,
      sourceFields: [],
      debug: false,
      trace: false,
      collectTraces: false,
    })
  })

  it('disables source field checkboxes when processing', () => {
    render(<ProcessRequestOptions {...defaultProps} isProcessing={true} />, {
      wrapper: createWrapper(),
    })

    for (const field of SOURCE_FIELD_OPTIONS) {
      expect(screen.getByLabelText(field.label)).toBeDisabled()
    }
  })

  it('can toggle source fields on and off', async () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    const checkbox = screen.getByLabelText('Bunk With')

    await userEvent.click(checkbox)
    expect(checkbox).toBeChecked()

    await userEvent.click(checkbox)
    expect(checkbox).not.toBeChecked()
  })

  it('has accessible structure', () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    expect(screen.getByRole('heading', { name: /process requests/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/session/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/limit/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/force reprocess/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^process$/i })).toBeInTheDocument()
  })

  it('displays helpful description text', () => {
    render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    expect(screen.getByText(/process original bunk requests/i)).toBeInTheDocument()
  })

  it('resets form when closed and reopened', async () => {
    const { rerender } = render(<ProcessRequestOptions {...defaultProps} />, {
      wrapper: createWrapper(),
    })

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /session 3a/i })).toBeInTheDocument()
    })

    const sessionSelect = screen.getByLabelText(/session/i)
    await userEvent.selectOptions(sessionSelect, '1000007')
    const limitInput = screen.getByLabelText(/limit/i)
    await userEvent.clear(limitInput)
    await userEvent.type(limitInput, '50')
    await userEvent.click(screen.getByLabelText('Bunk With'))

    rerender(<ProcessRequestOptions {...defaultProps} isOpen={false} />)
    rerender(<ProcessRequestOptions {...defaultProps} isOpen={true} />)

    expect(screen.getByLabelText(/session/i)).toHaveValue('all')
    expect(screen.getByLabelText(/limit/i)).toHaveValue(null)
    expect(screen.getByLabelText('Bunk With')).not.toBeChecked()
  })
})
