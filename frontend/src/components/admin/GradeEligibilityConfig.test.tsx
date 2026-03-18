import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GradeEligibilityConfig } from './GradeEligibilityConfig'

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

// Mock useAuth (needed by useAdminSessions auth guard)
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1' }, isLoading: false }),
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
]

// Sample existing config records
const mockConfigRecords = [
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

describe('GradeEligibilityConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state initially', () => {
    // Sessions and config both loading
    mockGetFullList.mockReturnValue(new Promise(() => {}))
    renderWithProviders(<GradeEligibilityConfig />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders session rows after data loads', async () => {
    // First call: sessions, second call: config records, third call: threshold config
    mockGetFullList
      .mockResolvedValueOnce(mockSessions) // sessions
      .mockResolvedValueOnce(mockConfigRecords) // config records
      .mockResolvedValueOnce([]) // threshold

    renderWithProviders(<GradeEligibilityConfig />)

    await waitFor(() => {
      // Main sessions should appear (not AG sessions — they get a separate section)
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
      expect(screen.getByText('Session 2')).toBeInTheDocument()
      expect(screen.getByText('Session 2a')).toBeInTheDocument()
    })
  })

  it('renders AG sessions in a separate section', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockConfigRecords)
      .mockResolvedValueOnce([])

    renderWithProviders(<GradeEligibilityConfig />)

    await waitFor(() => {
      expect(screen.getByText('AG Session 2')).toBeInTheDocument()
    })
    // AG section should have its own header
    expect(screen.getByText(/ag sessions/i)).toBeInTheDocument()
  })

  it('populates grade selects from existing config', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockConfigRecords)
      .mockResolvedValueOnce([])

    renderWithProviders(<GradeEligibilityConfig />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Grade fields are now <select> elements (combobox role)
    const selects = screen.getAllByRole('combobox')
    // The Taste of Camp row has config with min_grade=2, max_grade=6
    const hasValue2 = selects.some((s) => (s as HTMLSelectElement).value === '2')
    const hasValue6 = selects.some((s) => (s as HTMLSelectElement).value === '6')
    expect(hasValue2).toBe(true)
    expect(hasValue6).toBe(true)
  })

  it('grade selects have options for grades 2-12 with ordinal labels', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    renderWithProviders(<GradeEligibilityConfig />)

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

  it('shows save button only when changes are made', async () => {
    const user = userEvent.setup()
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockConfigRecords)
      .mockResolvedValueOnce([])

    renderWithProviders(<GradeEligibilityConfig />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Save button should not be visible initially
    expect(screen.queryByText(/save/i)).not.toBeInTheDocument()

    // Change a grade select value
    const selects = screen.getAllByRole('combobox')
    await user.selectOptions(selects[0]!, '3')

    // Save button should appear
    expect(screen.getByText(/save/i)).toBeInTheDocument()
  })

  it('saves config on button click', async () => {
    const user = userEvent.setup()
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockConfigRecords)
      .mockResolvedValueOnce([])

    mockUpdate.mockResolvedValue({})
    mockCreate.mockResolvedValue({})

    renderWithProviders(<GradeEligibilityConfig />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Make a change via grade select
    const selects = screen.getAllByRole('combobox')
    await user.selectOptions(selects[0]!, '3')

    // Click save
    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    // Should have called create or update
    await waitFor(() => {
      const totalCalls = mockUpdate.mock.calls.length + mockCreate.mock.calls.length
      expect(totalCalls).toBeGreaterThan(0)
    })
  })

  it('renders header and description', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockConfigRecords)
      .mockResolvedValueOnce([])

    renderWithProviders(<GradeEligibilityConfig />)

    await waitFor(() => {
      expect(screen.getByText(/session availability config/i)).toBeInTheDocument()
      expect(screen.getByText(/grade ranges/i)).toBeInTheDocument()
    })
  })

  it('renders threshold input', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockConfigRecords)
      .mockResolvedValueOnce([
        {
          id: 'thr1',
          category: 'session_availability',
          subcategory: '2026',
          config_key: 'limited_threshold',
          value: 80,
        },
      ])

    renderWithProviders(<GradeEligibilityConfig />)

    await waitFor(() => {
      expect(screen.getByText(/limited.*threshold/i)).toBeInTheDocument()
    })
  })

  it('resets threshold to default when no threshold record exists', async () => {
    // First render: threshold record exists with value 65
    const queryClient = createTestQueryClient()
    mockGetFullList
      .mockResolvedValueOnce(mockSessions) // sessions
      .mockResolvedValueOnce(mockConfigRecords) // config records
      .mockResolvedValueOnce([
        {
          id: 'thr1',
          category: 'session_availability',
          subcategory: '2026',
          config_key: 'limited_threshold',
          value: 65,
        },
      ]) // threshold

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <GradeEligibilityConfig />
      </QueryClientProvider>
    )

    // Wait for the threshold input to show value 65
    await waitFor(() => {
      const thresholdInput = screen.getByLabelText<HTMLInputElement>(/limited.*threshold/i)
      expect(thresholdInput.value).toBe('65')
    })

    // Second render: simulate year change where no threshold record exists
    // Clear mock and set up new responses with empty threshold
    mockGetFullList
      .mockResolvedValueOnce(mockSessions) // sessions
      .mockResolvedValueOnce(mockConfigRecords) // config records
      .mockResolvedValueOnce([]) // no threshold record for new year

    // Invalidate queries to trigger refetch
    await queryClient.invalidateQueries()

    rerender(
      <QueryClientProvider client={queryClient}>
        <GradeEligibilityConfig />
      </QueryClientProvider>
    )

    // Threshold should reset to default (80), not stay at 65
    await waitFor(() => {
      const thresholdInput = screen.getByLabelText<HTMLInputElement>(/limited.*threshold/i)
      expect(thresholdInput.value).toBe('80')
    })
  })

  it('calls create (not update) for threshold when no record exists', async () => {
    const user = userEvent.setup()
    // No threshold record for this year
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockConfigRecords)
      .mockResolvedValueOnce([]) // no threshold

    mockUpdate.mockResolvedValue({})
    mockCreate.mockResolvedValue({ id: 'new-thr-1' })

    renderWithProviders(<GradeEligibilityConfig />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Change threshold to trigger save button
    const thresholdInput = screen.getByLabelText(/limited.*threshold/i)
    await user.clear(thresholdInput)
    await user.type(thresholdInput, '90')

    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    await waitFor(() => {
      // Threshold should have been created, not updated
      const createCalls = mockCreate.mock.calls
      const thresholdCreate = createCalls.find(
        (call) => (call[0] as Record<string, unknown>)['config_key'] === 'limited_threshold'
      )
      expect(thresholdCreate).toBeDefined()
    })
  })

  it('calls update (not create) for config row when record exists', async () => {
    const user = userEvent.setup()
    // Config record exists for session 1001 with id 'cfg1'
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockConfigRecords) // cfg1 for session 1001
      .mockResolvedValueOnce([])

    mockUpdate.mockResolvedValue({})
    mockCreate.mockResolvedValue({})

    renderWithProviders(<GradeEligibilityConfig />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Change min_grade for Taste of Camp (session 1001, has existing config 'cfg1')
    const selects = screen.getAllByRole('combobox')
    await user.selectOptions(selects[0]!, '3') // change min_grade from 2 to 3

    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    await waitFor(() => {
      // Config for session 1001 should have been UPDATED with record ID 'cfg1'
      const updateCalls = mockUpdate.mock.calls
      const configUpdate = updateCalls.find((call) => call[0] === 'cfg1')
      expect(configUpdate).toBeDefined()
      expect((configUpdate![1] as Record<string, unknown>)['config_key']).toBe('1001')
    })

    // Verify create was NOT called for session 1001
    const configCreate = mockCreate.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>)['config_key'] === '1001'
    )
    expect(configCreate).toBeUndefined()
  })

  it('looks up configId from query data at save time, not stale row state', async () => {
    const user = userEvent.setup()
    const queryClient = createTestQueryClient()

    // Initial load: config record exists with id 'cfg1'
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockConfigRecords)
      .mockResolvedValueOnce([])

    mockUpdate.mockResolvedValue({})
    mockCreate.mockResolvedValue({})

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <GradeEligibilityConfig />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Make a change to trigger save button
    const selects = screen.getAllByRole('combobox')
    await user.selectOptions(selects[0]!, '3')

    // Simulate config records refetch with a NEW record ID (as if record was recreated)
    const updatedConfigRecords = [
      {
        id: 'cfg1-recreated',
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
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(updatedConfigRecords)
      .mockResolvedValueOnce([])

    // Invalidate to trigger refetch with new config record ID
    await queryClient.invalidateQueries()
    rerender(
      <QueryClientProvider client={queryClient}>
        <GradeEligibilityConfig />
      </QueryClientProvider>
    )

    // Wait for refetch to complete
    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Re-make the change (rows were rebuilt from fresh data)
    const selectsAfter = screen.getAllByRole('combobox')
    await user.selectOptions(selectsAfter[0]!, '4')

    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    await waitFor(() => {
      // Should use the NEW record ID 'cfg1-recreated' from fresh query data,
      // not the old 'cfg1' that might be stuck in stale row state
      const updateCalls = mockUpdate.mock.calls
      const freshUpdate = updateCalls.find((call) => call[0] === 'cfg1-recreated')
      expect(freshUpdate).toBeDefined()
      expect((freshUpdate![1] as Record<string, unknown>)['config_key']).toBe('1001')
    })

    // Verify the stale ID was NOT used
    const staleUpdate = mockUpdate.mock.calls.find((call) => call[0] === 'cfg1')
    expect(staleUpdate).toBeUndefined()
  })

  it('calls update (not create) for threshold when record exists', async () => {
    const user = userEvent.setup()
    // Threshold record exists with id 'thr1'
    mockGetFullList
      .mockResolvedValueOnce(mockSessions)
      .mockResolvedValueOnce(mockConfigRecords)
      .mockResolvedValueOnce([
        {
          id: 'thr1',
          category: 'session_availability',
          subcategory: '2026',
          config_key: 'limited_threshold',
          value: 80,
        },
      ])

    mockUpdate.mockResolvedValue({})
    mockCreate.mockResolvedValue({})

    renderWithProviders(<GradeEligibilityConfig />)

    await waitFor(() => {
      expect(screen.getByText('Taste of Camp')).toBeInTheDocument()
    })

    // Change threshold to trigger save button
    const thresholdInput = screen.getByLabelText(/limited.*threshold/i)
    await user.clear(thresholdInput)
    await user.type(thresholdInput, '90')

    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    await waitFor(() => {
      // Threshold should have been updated with the correct record ID
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
})
