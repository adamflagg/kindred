import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock pocketbase client
const mockGetFullList = vi.fn()
const mockUpdate = vi.fn()
const mockCreate = vi.fn()
vi.mock('../../lib/pocketbase', () => ({
  pb: {
    collection: () => ({
      getFullList: mockGetFullList,
      update: mockUpdate,
      create: mockCreate,
    }),
  },
}))

// Mock useCurrentYear
vi.mock('../../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: 2026 }),
}))

// Helper to create a QueryClient for tests
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createTestQueryClient()
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

// Sample session data
const mockSessions = [
  {
    cm_id: 1001,
    name: 'Taste of Camp',
    session_type: 'main',
    sort_order: 1,
    start_date: '2026-06-10',
    year: 2026,
    parent_id: null,
  },
  {
    cm_id: 1002,
    name: 'Session 2',
    session_type: 'main',
    sort_order: 2,
    start_date: '2026-06-15',
    year: 2026,
    parent_id: null,
  },
  {
    cm_id: 1003,
    name: 'Session 2a',
    session_type: 'embedded',
    sort_order: 3,
    start_date: '2026-06-15',
    year: 2026,
    parent_id: null,
  },
  {
    cm_id: 2001,
    name: 'AG Session 2',
    session_type: 'ag',
    sort_order: 4,
    start_date: '2026-06-15',
    year: 2026,
    parent_id: 1002,
  },
]

// Sample existing budget config records
const mockBudgetConfigRecords = [
  {
    id: 'budget1',
    category: 'budget',
    subcategory: '2026',
    config_key: 'session_1001',
    value: { participant_goal: 150, session_fee: 3500.0 },
  },
  {
    id: 'budget2',
    category: 'budget',
    subcategory: '2026',
    config_key: 'session_1002',
    value: { participant_goal: 200, session_fee: 7000.0 },
  },
]

describe('SessionBudgetConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Lazy import to ensure mocks are in place
  async function getComponent() {
    const mod = await import('./SessionBudgetConfig')
    return mod.SessionBudgetConfig
  }

  it('renders loading state initially', async () => {
    mockGetFullList.mockReturnValue(new Promise(() => {}))

    const SessionBudgetConfig = await getComponent()
    renderWithProviders(<SessionBudgetConfig />)

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders session names in table after loading', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions) // sessions
      .mockResolvedValueOnce([]) // budget config records

    const SessionBudgetConfig = await getComponent()
    renderWithProviders(<SessionBudgetConfig />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
      expect(screen.getByText('Session 2')).toBeInTheDocument()
      expect(screen.getByText('Session 2a')).toBeInTheDocument()
    })
  })

  it('inputs start empty by default when no config exists', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions) // sessions
      .mockResolvedValueOnce([]) // empty budget config

    const SessionBudgetConfig = await getComponent()
    renderWithProviders(<SessionBudgetConfig />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // All number inputs should be empty
    const inputs = screen.getAllByRole('spinbutton')
    for (const input of inputs) {
      expect((input as HTMLInputElement).value).toBe('')
    }
  })

  it('populates inputs from existing config records', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions) // sessions
      .mockResolvedValueOnce(mockBudgetConfigRecords) // budget config

    const SessionBudgetConfig = await getComponent()
    renderWithProviders(<SessionBudgetConfig />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    const inputs = screen.getAllByRole('spinbutton')
    // Should have populated values from config
    const hasValue150 = inputs.some((input) => (input as HTMLInputElement).value === '150')
    const hasValue3500 = inputs.some((input) => (input as HTMLInputElement).value === '3500')
    const hasValue200 = inputs.some((input) => (input as HTMLInputElement).value === '200')
    const hasValue7000 = inputs.some((input) => (input as HTMLInputElement).value === '7000')
    expect(hasValue150).toBe(true)
    expect(hasValue3500).toBe(true)
    expect(hasValue200).toBe(true)
    expect(hasValue7000).toBe(true)
  })

  it('shows save button only when values change', async () => {
    const user = userEvent.setup()
    mockGetFullList
      .mockResolvedValueOnce(mockSessions) // sessions
      .mockResolvedValueOnce(mockBudgetConfigRecords) // budget config

    const SessionBudgetConfig = await getComponent()
    renderWithProviders(<SessionBudgetConfig />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Save button should not be visible initially
    expect(screen.queryByText(/save/i)).not.toBeInTheDocument()

    // Change a value
    const inputs = screen.getAllByRole('spinbutton')
    await user.clear(inputs[0]!)
    await user.type(inputs[0]!, '175')

    // Save button should appear
    expect(screen.getByText(/save/i)).toBeInTheDocument()
  })

  it('saves correct payload on submit with upsert pattern', async () => {
    const user = userEvent.setup()
    mockGetFullList
      .mockResolvedValueOnce(mockSessions) // sessions
      .mockResolvedValueOnce(mockBudgetConfigRecords) // budget config

    mockUpdate.mockResolvedValue({})
    mockCreate.mockResolvedValue({})

    const SessionBudgetConfig = await getComponent()
    renderWithProviders(<SessionBudgetConfig />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Change participant goal for first session
    const inputs = screen.getAllByRole('spinbutton')
    await user.clear(inputs[0]!)
    await user.type(inputs[0]!, '175')

    // Click save
    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    // Should use update for existing records (budget1 has an id)
    await waitFor(() => {
      const totalCalls = mockUpdate.mock.calls.length + mockCreate.mock.calls.length
      expect(totalCalls).toBeGreaterThan(0)
    })

    // Verify update was called for the record that had an existing id
    expect(mockUpdate).toHaveBeenCalled()
    const updateCall = mockUpdate.mock.calls[0]!
    expect(updateCall[0]).toBe('budget1') // existing record id
    const payload = updateCall[1] as Record<string, unknown>
    expect(payload.category).toBe('budget')
    expect(payload.subcategory).toBe('2026')
    expect(payload.config_key).toBe('session_1001')
    const value = payload.value as { participant_goal: number; session_fee: number }
    expect(value.participant_goal).toBe(175)
    expect(value.session_fee).toBe(3500)
  })

  it('creates new config for sessions without existing records', async () => {
    const user = userEvent.setup()
    mockGetFullList
      .mockResolvedValueOnce(mockSessions) // sessions
      .mockResolvedValueOnce([]) // no existing config

    mockCreate.mockResolvedValue({})

    const SessionBudgetConfig = await getComponent()
    renderWithProviders(<SessionBudgetConfig />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Type a goal for first session
    const inputs = screen.getAllByRole('spinbutton')
    await user.type(inputs[0]!, '100')

    // Click save
    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    // Should use create (not update) since no existing record
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalled()
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('does not show AG sessions as separate rows', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions) // sessions
      .mockResolvedValueOnce([]) // budget config

    const SessionBudgetConfig = await getComponent()
    renderWithProviders(<SessionBudgetConfig />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // AG sessions should not appear in the budget config table
    expect(screen.queryByText('AG Session 2')).not.toBeInTheDocument()
  })

  it('renders header and description', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions) // sessions
      .mockResolvedValueOnce([]) // budget config

    const SessionBudgetConfig = await getComponent()
    renderWithProviders(<SessionBudgetConfig />)

    await waitFor(() => {
      expect(screen.getByText(/session budget/i)).toBeInTheDocument()
      expect(screen.getByText(/participant goal/i)).toBeInTheDocument()
    })
  })

  it('renders table headers for session name, participant goal, and session fee', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions) // sessions
      .mockResolvedValueOnce([]) // budget config

    const SessionBudgetConfig = await getComponent()
    renderWithProviders(<SessionBudgetConfig />)

    await waitFor(() => {
      expect(screen.getByText('Session')).toBeInTheDocument()
      expect(screen.getByText('Participant Goal')).toBeInTheDocument()
      expect(screen.getByText('Session Fee')).toBeInTheDocument()
    })
  })
})
