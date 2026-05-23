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
    // inputs[0] = threshold, inputs[1] = capacity_override, inputs[2] = participant_goal
    const inputs = screen.getAllByRole('spinbutton')
    await user.clear(inputs[2]!)
    await user.type(inputs[2]!, '175')

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
    // inputs[0] = threshold, inputs[1] = capacity_override, inputs[2] = participant_goal
    const inputs = screen.getAllByRole('spinbutton')
    await user.clear(inputs[2]!)
    await user.type(inputs[2]!, '175')

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

  it('grade selects have options for grades 2-12 with ordinal labels', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    const selects = screen.getAllByRole('combobox')
    const firstSelect = selects[0] as HTMLSelectElement
    const options = Array.from(firstSelect.options)

    // First option is the empty "unset" option
    expect(options[0]!.value).toBe('')
    // Grades 2-12 should follow
    expect(options).toHaveLength(12) // 1 empty + 11 grades (2-12)
    expect(options[1]!.value).toBe('2')
    expect(options[1]!.textContent).toBe('2nd')
    expect(options[11]!.value).toBe('12')
    expect(options[11]!.textContent).toBe('12th')
  })

  it('inputs start empty by default when no config exists', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce([]) // no grade config
      .mockResolvedValueOnce([]) // no threshold
      .mockResolvedValueOnce([]) // no budget config

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // All number inputs (except threshold which defaults to 80) should be empty
    const inputs = screen.getAllByRole('spinbutton')
    for (let i = 1; i < inputs.length; i++) {
      expect((inputs[i] as HTMLInputElement).value).toBe('')
    }
  })

  it('calls create (not update) for threshold when no record exists', async () => {
    const user = userEvent.setup()
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords)
      .mockResolvedValueOnce([]) // no threshold
      .mockResolvedValueOnce(mockBudgetConfigRecords)

    mockUpdate.mockResolvedValue({})
    mockCreate.mockResolvedValue({ id: 'new-thr-1' })

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    const thresholdInput = screen.getByLabelText(/limited.*threshold/i)
    await user.clear(thresholdInput)
    await user.type(thresholdInput, '90')

    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    await waitFor(() => {
      const createCalls = mockCreate.mock.calls
      const thresholdCreate = createCalls.find(
        (call) => (call[0] as Record<string, unknown>)['config_key'] === 'limited_threshold'
      )
      expect(thresholdCreate).toBeDefined()
    })
  })

  it('calls update (not create) for threshold when record exists', async () => {
    const user = userEvent.setup()
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

    mockUpdate.mockResolvedValue({})
    mockCreate.mockResolvedValue({})

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    const thresholdInput = screen.getByLabelText(/limited.*threshold/i)
    await user.clear(thresholdInput)
    await user.type(thresholdInput, '90')

    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    await waitFor(() => {
      const updateCalls = mockUpdate.mock.calls
      const thresholdUpdate = updateCalls.find((call) => call[0] === 'thr1')
      expect(thresholdUpdate).toBeDefined()
      expect((thresholdUpdate![1] as Record<string, unknown>)['config_key']).toBe(
        'limited_threshold'
      )
      expect((thresholdUpdate![1] as Record<string, unknown>)['value']).toBe(90)
    })

    // Verify create was NOT called for the threshold
    const thresholdCreate = mockCreate.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>)['config_key'] === 'limited_threshold'
    )
    expect(thresholdCreate).toBeUndefined()
  })

  it('looks up grade configId from query data at save time, not stale row state', async () => {
    const user = userEvent.setup()
    const queryClient = createTestQueryClient()

    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords) // cfg1 for session 1001
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockBudgetConfigRecords)

    mockUpdate.mockResolvedValue({})
    mockCreate.mockResolvedValue({})

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <SessionConfigTable />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Make a change to trigger save button
    const selects = screen.getAllByRole('combobox')
    await user.selectOptions(selects[0]!, '3')

    // Simulate config records refetch with a NEW record ID (as if record was recreated)
    const updatedGradeConfigRecords = [
      {
        id: 'cfg1-recreated',
        category: 'session_availability',
        subcategory: '2026',
        config_key: '1001',
        value: { min_grade: 2, max_grade: 6, capacity_override: null },
      },
    ]
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(updatedGradeConfigRecords)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockBudgetConfigRecords)

    await queryClient.invalidateQueries()
    rerender(
      <QueryClientProvider client={queryClient}>
        <SessionConfigTable />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Re-make the change (rows were rebuilt from fresh data)
    const selectsAfter = screen.getAllByRole('combobox')
    await user.selectOptions(selectsAfter[0]!, '4')

    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    await waitFor(() => {
      // Should use the NEW record ID 'cfg1-recreated' from fresh query data
      const updateCalls = mockUpdate.mock.calls
      const freshUpdate = updateCalls.find((call) => call[0] === 'cfg1-recreated')
      expect(freshUpdate).toBeDefined()
      expect((freshUpdate![1] as Record<string, unknown>)['config_key']).toBe('1001')
    })

    // Verify the stale ID was NOT used
    const staleUpdate = mockUpdate.mock.calls.find((call) => call[0] === 'cfg1')
    expect(staleUpdate).toBeUndefined()
  })

  it('looks up budget configId from query data at save time, not stale row state', async () => {
    const user = userEvent.setup()
    const queryClient = createTestQueryClient()

    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockBudgetConfigRecords) // budget1 for session_1001

    mockUpdate.mockResolvedValue({})
    mockCreate.mockResolvedValue({})

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <SessionConfigTable />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Make a change
    // inputs[0] = threshold, inputs[1] = capacity_override, inputs[2] = participant_goal
    const inputs = screen.getAllByRole('spinbutton')
    await user.clear(inputs[2]!)
    await user.type(inputs[2]!, '175')

    // Simulate budget records refetch with a NEW record ID
    const updatedBudgetConfigRecords = [
      {
        id: 'budget1-recreated',
        category: 'budget',
        subcategory: '2026',
        config_key: 'session_1001',
        value: { participant_goal: 150, session_fee: 3500.0 },
      },
      mockBudgetConfigRecords[1],
    ]
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(updatedBudgetConfigRecords)

    await queryClient.invalidateQueries()
    rerender(
      <QueryClientProvider client={queryClient}>
        <SessionConfigTable />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Re-make the change (rows were rebuilt from fresh data)
    const inputsAfter = screen.getAllByRole('spinbutton')
    await user.clear(inputsAfter[2]!)
    await user.type(inputsAfter[2]!, '180')

    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    await waitFor(() => {
      // Should use the NEW record ID 'budget1-recreated' from fresh query data
      const updateCalls = mockUpdate.mock.calls
      const freshUpdate = updateCalls.find((call) => call[0] === 'budget1-recreated')
      expect(freshUpdate).toBeDefined()
      expect((freshUpdate![1] as Record<string, unknown>)['config_key']).toBe('session_1001')
    })

    // Verify the stale ID was NOT used
    const staleUpdate = mockUpdate.mock.calls.find((call) => call[0] === 'budget1')
    expect(staleUpdate).toBeUndefined()
  })

  it('invalidates forecast + availability queries on save so config edits propagate', async () => {
    const user = userEvent.setup()
    const queryClient = createTestQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockGradeConfigRecords)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockBudgetConfigRecords)
    mockUpdate.mockResolvedValue({})
    mockCreate.mockResolvedValue({})

    render(
      <QueryClientProvider client={queryClient}>
        <SessionConfigTable />
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.getByText('Taste of Camp')).toBeInTheDocument())

    const selects = screen.getAllByRole('combobox')
    await user.selectOptions(selects[0]!, '3')
    await user.click(screen.getByText(/save/i))

    await waitFor(() => {
      const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey)
      // Exact root keys, not substrings — must match queryKeys.forecastRoot() /
      // sessionAvailabilityRoot() so invalidation can't silently drift.
      expect(keys).toContainEqual(['metrics', 'forecast'])
      expect(keys).toContainEqual(['session-availability'])
    })
  })

  describe('accessibility: aria-labels on form controls', () => {
    beforeEach(() => {
      mockGetFullList
        .mockResolvedValueOnce(mockSessions)
        .mockResolvedValueOnce(mockGradeConfigRecords)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(mockBudgetConfigRecords)
    })

    it('column headers have id attributes', async () => {
      renderWithProviders(<SessionConfigTable />)

      await waitFor(() => {
        expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
      })

      expect(document.getElementById('col-min-grade')).toHaveTextContent('Min Grade')
      expect(document.getElementById('col-max-grade')).toHaveTextContent('Max Grade')
      expect(document.getElementById('col-cap-override')).toHaveTextContent('Cap. Override')
      expect(document.getElementById('col-participant-goal')).toHaveTextContent('Participant Goal')
      expect(document.getElementById('col-session-fee')).toHaveTextContent('Session Fee')
    })

    it('session name cells are row headers with id attributes', async () => {
      renderWithProviders(<SessionConfigTable />)

      await waitFor(() => {
        expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
      })

      const rowHeaders = screen.getAllByRole('rowheader')
      expect(rowHeaders.length).toBeGreaterThanOrEqual(5) // all 5 sessions

      // Check that each session name cell has an id
      const tasteHeader = rowHeaders.find((h) => h.textContent === 'Taste of Camp')
      expect(tasteHeader).toBeDefined()
      expect(tasteHeader!.id).toBe('session-1001')
    })

    it('selects have aria-labelledby referencing row and column headers', async () => {
      renderWithProviders(<SessionConfigTable />)

      await waitFor(() => {
        expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
      })

      const selects = screen.getAllByRole('combobox')
      // First two selects belong to first session (Taste of Camp, cm_id=1001)
      expect(selects[0]).toHaveAttribute('aria-labelledby', 'session-1001 col-min-grade')
      expect(selects[1]).toHaveAttribute('aria-labelledby', 'session-1001 col-max-grade')
    })

    it('number inputs have aria-labelledby referencing row and column headers', async () => {
      renderWithProviders(<SessionConfigTable />)

      await waitFor(() => {
        expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
      })

      const inputs = screen.getAllByRole('spinbutton')
      // inputs[0] = threshold (has its own label), then per row: cap override, participant goal, session fee
      // First row (Taste of Camp, cm_id=1001): inputs[1], inputs[2], inputs[3]
      expect(inputs[1]).toHaveAttribute('aria-labelledby', 'session-1001 col-cap-override')
      expect(inputs[2]).toHaveAttribute('aria-labelledby', 'session-1001 col-participant-goal')
      expect(inputs[3]).toHaveAttribute('aria-labelledby', 'session-1001 col-session-fee')
    })
  })

  it('renders error state when a query fails', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockRejectedValueOnce(new Error('Network error')) // grade config fails
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument()
    })
  })
})
