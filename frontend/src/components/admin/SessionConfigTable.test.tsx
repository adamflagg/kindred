import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionConfigTable } from './SessionConfigTable'

// Mock pocketbase client
const { mockGetFullList, mockUpdate, mockCreate, mockCollection } = vi.hoisted(() => ({
  mockGetFullList: vi.fn(),
  mockUpdate: vi.fn(),
  mockCreate: vi.fn(),
  mockCollection: vi.fn(),
}))
vi.mock('../../lib/pocketbase', () => ({
  pb: { collection: mockCollection },
}))

// Mock useCurrentYear
vi.mock('../../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: 2026 }),
}))

// Mock useAuth (needed by useAdminSessions auth guard)
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1' }, isLoading: false }),
}))

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
    start_date: '2026-06-10',
    year: 2026,
    parent_id: null,
  },
  {
    cm_id: 1002,
    name: 'Session 2',
    session_type: 'main',
    start_date: '2026-06-15',
    year: 2026,
    parent_id: null,
  },
  {
    cm_id: 1003,
    name: 'Session 2a',
    session_type: 'embedded',
    start_date: '2026-06-15',
    year: 2026,
    parent_id: null,
  },
  {
    cm_id: 2001,
    name: 'AG Session 2',
    session_type: 'ag',
    start_date: '2026-06-15',
    year: 2026,
    parent_id: 1002,
  },
  {
    cm_id: 3001,
    name: 'Quest Adventure',
    session_type: 'quest',
    start_date: '2026-07-01',
    year: 2026,
    parent_id: null,
  },
]

// Sample existing grade eligibility config records
const mockGradeConfigRecords = [
  {
    id: 'cfg1',
    category: 'session_availability',
    subcategory: '2026',
    config_key: '1001',
    value: {
      min_grade: 2,
      max_grade: 6,
      capacity_override: null,
    },
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

describe('SessionConfigTable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCollection.mockReturnValue({
      getFullList: mockGetFullList,
      update: mockUpdate,
      create: mockCreate,
    })
  })

  it('renders loading state initially', () => {
    mockGetFullList.mockReturnValue(new Promise(() => {}))
    renderWithProviders(<SessionConfigTable />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders all column headers in a single table', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions) // sessions
      .mockResolvedValueOnce(mockGradeConfigRecords) // grade config
      .mockResolvedValueOnce([]) // threshold
      .mockResolvedValueOnce(mockBudgetConfigRecords) // budget config

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('Session')).toBeInTheDocument()
      expect(screen.getByText('Min Grade')).toBeInTheDocument()
      expect(screen.getByText('Max Grade')).toBeInTheDocument()
      expect(screen.getByText('Cap. Override')).toBeInTheDocument()
      expect(screen.getByText('Participant Goal')).toBeInTheDocument()
      expect(screen.getByText('Session Fee')).toBeInTheDocument()
    })
  })

  it('renders session rows after data loads', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockBudgetConfigRecords)

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
      expect(screen.getByText('Session 2')).toBeInTheDocument()
      expect(screen.getByText('Session 2a')).toBeInTheDocument()
    })
  })

  it('renders AG sessions in a separate section', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockBudgetConfigRecords)

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('AG Session 2')).toBeInTheDocument()
    })
    expect(screen.getByText(/ag sessions/i)).toBeInTheDocument()
  })

  it('renders quest sessions in a separate section', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockBudgetConfigRecords)

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('Quest Adventure')).toBeInTheDocument()
    })
    expect(screen.getByText(/quests/i)).toBeInTheDocument()
  })

  it('populates grade selects from existing config', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockBudgetConfigRecords)

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    const selects = screen.getAllByRole('combobox')
    const hasValue2 = selects.some((s) => (s as HTMLSelectElement).value === '2')
    const hasValue6 = selects.some((s) => (s as HTMLSelectElement).value === '6')
    expect(hasValue2).toBe(true)
    expect(hasValue6).toBe(true)
  })

  it('populates budget inputs from existing config', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockBudgetConfigRecords)

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    const inputs = screen.getAllByRole('spinbutton')
    const hasValue150 = inputs.some((input) => (input as HTMLInputElement).value === '150')
    const hasValue3500 = inputs.some((input) => (input as HTMLInputElement).value === '3500')
    expect(hasValue150).toBe(true)
    expect(hasValue3500).toBe(true)
  })

  it('renders threshold input', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords)
      .mockResolvedValueOnce([
        {
          id: 'thr1',
          category: 'session_availability',
          subcategory: '2026',
          config_key: 'limited_threshold',
          value: 80,
        },
      ])
      .mockResolvedValueOnce(mockBudgetConfigRecords)

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText(/limited.*threshold/i)).toBeInTheDocument()
    })
  })

  it('shows save button only when grade changes are made', async () => {
    const user = userEvent.setup()
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockBudgetConfigRecords)

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    expect(screen.queryByText(/save/i)).not.toBeInTheDocument()

    const selects = screen.getAllByRole('combobox')
    await user.selectOptions(selects[0]!, '3')

    expect(screen.getByText(/save/i)).toBeInTheDocument()
  })

  it('shows save button only when budget changes are made', async () => {
    const user = userEvent.setup()
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockBudgetConfigRecords)

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    expect(screen.queryByText(/save/i)).not.toBeInTheDocument()

    // Change a budget input
    const inputs = screen.getAllByRole('spinbutton')
    await user.clear(inputs[0]!)
    await user.type(inputs[0]!, '175')

    expect(screen.getByText(/save/i)).toBeInTheDocument()
  })

  it('saves both grade and budget config on button click', async () => {
    const user = userEvent.setup()
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockBudgetConfigRecords)

    mockUpdate.mockResolvedValue({})
    mockCreate.mockResolvedValue({})

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Change a grade value
    const selects = screen.getAllByRole('combobox')
    await user.selectOptions(selects[0]!, '3')

    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    await waitFor(() => {
      const totalCalls = mockUpdate.mock.calls.length + mockCreate.mock.calls.length
      expect(totalCalls).toBeGreaterThan(0)
    })
  })

  it('saves budget config with correct category and key format', async () => {
    const user = userEvent.setup()
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    mockCreate.mockResolvedValue({})

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // In combined table: inputs[0] = threshold, then each row has
    // capacity_override, participant_goal, session_fee.
    // So participant_goal for first row is inputs[2]
    const inputs = screen.getAllByRole('spinbutton')
    await user.type(inputs[2]!, '100')

    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    // Wait for the budget create specifically (grade creates fire first)
    await waitFor(() => {
      const budgetCreate = mockCreate.mock.calls.find(
        (call) => (call[0] as Record<string, unknown>)['category'] === 'budget'
      )
      expect(budgetCreate).toBeDefined()
      expect((budgetCreate![0] as Record<string, unknown>)['config_key']).toMatch(/^session_/)
    })
  })

  it('saves grade config with correct category and key format', async () => {
    const user = userEvent.setup()
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    mockCreate.mockResolvedValue({})

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Change a grade value
    const selects = screen.getAllByRole('combobox')
    await user.selectOptions(selects[0]!, '3')

    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalled()
    })

    // Find the grade config create call
    const gradeCreate = mockCreate.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>)['category'] === 'session_availability'
    )
    expect(gradeCreate).toBeDefined()
  })

  it('uses update for existing grade config records', async () => {
    const user = userEvent.setup()
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords) // cfg1 for session 1001
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockBudgetConfigRecords)

    mockUpdate.mockResolvedValue({})
    mockCreate.mockResolvedValue({})

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    const selects = screen.getAllByRole('combobox')
    await user.selectOptions(selects[0]!, '3')

    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    await waitFor(() => {
      const updateCalls = mockUpdate.mock.calls
      const configUpdate = updateCalls.find((call) => call[0] === 'cfg1')
      expect(configUpdate).toBeDefined()
    })
  })

  it('uses update for existing budget config records', async () => {
    const user = userEvent.setup()
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockBudgetConfigRecords) // budget1 for session_1001

    mockUpdate.mockResolvedValue({})
    mockCreate.mockResolvedValue({})

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Change budget value for first session
    const inputs = screen.getAllByRole('spinbutton')
    await user.clear(inputs[0]!)
    await user.type(inputs[0]!, '175')

    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    await waitFor(() => {
      const updateCalls = mockUpdate.mock.calls
      const budgetUpdate = updateCalls.find((call) => call[0] === 'budget1')
      expect(budgetUpdate).toBeDefined()
    })
  })

  it('renders header and description', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockBudgetConfigRecords)

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText(/session config/i)).toBeInTheDocument()
    })
  })

  it('resets threshold to default when no threshold record exists', async () => {
    const queryClient = createTestQueryClient()
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords)
      .mockResolvedValueOnce([
        {
          id: 'thr1',
          category: 'session_availability',
          subcategory: '2026',
          config_key: 'limited_threshold',
          value: 65,
        },
      ])
      .mockResolvedValueOnce(mockBudgetConfigRecords)

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <SessionConfigTable />
      </QueryClientProvider>
    )

    await waitFor(() => {
      const thresholdInput = screen.getByLabelText<HTMLInputElement>(/limited.*threshold/i)
      expect(thresholdInput.value).toBe('65')
    })

    // Simulate year change with no threshold
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockBudgetConfigRecords)

    await queryClient.invalidateQueries()

    rerender(
      <QueryClientProvider client={queryClient}>
        <SessionConfigTable />
      </QueryClientProvider>
    )

    await waitFor(() => {
      const thresholdInput = screen.getByLabelText<HTMLInputElement>(/limited.*threshold/i)
      expect(thresholdInput.value).toBe('80')
    })
  })
})
