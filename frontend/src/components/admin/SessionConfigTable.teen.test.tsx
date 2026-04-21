import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionConfigTable } from './SessionConfigTable'

// Mock pocketbase client — matches pattern in SessionConfigTable.test.tsx
const { mockGetFullList, mockUpdate, mockCreate, mockCollection } = vi.hoisted(() => ({
  mockGetFullList: vi.fn(),
  mockUpdate: vi.fn(),
  mockCreate: vi.fn(),
  mockCollection: vi.fn(),
}))
vi.mock('../../lib/pocketbase', () => ({
  pb: { collection: mockCollection },
}))

vi.mock('../../hooks/useCurrentYear', () => ({
  useCurrentYear: () => ({ currentYear: 2026 }),
}))

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

// Sessions backing teen programs: two SCIT, one TLI, one regular main for sanity
const mockTeenSessions = [
  {
    cm_id: 1235404,
    name: 'Session 2',
    session_type: 'main',
    start_date: '2026-06-15',
    year: 2026,
    parent_id: null,
  },
  {
    cm_id: 1236361,
    name: 'Counselor In-Training',
    session_type: 'scit',
    start_date: '2026-06-20',
    year: 2026,
    parent_id: null,
  },
  {
    cm_id: 1236368,
    name: 'Specialist In-Training',
    session_type: 'scit',
    start_date: '2026-07-01',
    year: 2026,
    parent_id: null,
  },
  {
    cm_id: 1274420,
    name: 'Teen Leadership Institute',
    session_type: 'tli',
    start_date: '2026-07-10',
    year: 2026,
    parent_id: null,
  },
]

const mockTeenBudgetConfig = [
  {
    id: 'b_scit',
    category: 'budget',
    subcategory: '2026',
    config_key: 'type_scit',
    value: { participant_goal: 50, session_fee: 1500 },
  },
  {
    id: 'b_tli',
    category: 'budget',
    subcategory: '2026',
    config_key: 'type_tli',
    value: { participant_goal: 40, session_fee: 2000 },
  },
]

describe('SessionConfigTable teen programs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCollection.mockReturnValue({
      getFullList: mockGetFullList,
      update: mockUpdate,
      create: mockCreate,
    })
  })

  it('collapses CIT + SIT into one SCIT row, shows one TLI row, and non-teen session row', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockTeenSessions) // sessions
      .mockResolvedValueOnce([]) // grade config
      .mockResolvedValueOnce([]) // threshold
      .mockResolvedValueOnce(mockTeenBudgetConfig) // budget config

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText('Session 2')).toBeInTheDocument()
    })

    // One SCIT row (collapsed from CIT + SIT)
    const scitCells = screen.getAllByText(/^SCIT$/)
    expect(scitCells).toHaveLength(1)

    // One TLI row
    const tliCells = screen.getAllByText(/^TLI$/)
    expect(tliCells).toHaveLength(1)

    // Original CIT and SIT names should NOT appear as row labels
    expect(screen.queryByText('Counselor In-Training')).not.toBeInTheDocument()
    expect(screen.queryByText('Specialist In-Training')).not.toBeInTheDocument()

    // Teen Programs section header
    expect(screen.getByText(/^Teen Programs$/i)).toBeInTheDocument()
  })

  it('populates SCIT row fee + goal from type_scit config', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockTeenSessions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockTeenBudgetConfig)

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText(/^SCIT$/)).toBeInTheDocument()
    })

    // SCIT goal = 50, SCIT fee = 1500
    expect(screen.getByDisplayValue('50')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1500')).toBeInTheDocument()
  })

  it('populates TLI row fee + goal from type_tli config', async () => {
    mockGetFullList
      .mockResolvedValueOnce(mockTeenSessions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockTeenBudgetConfig)

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText(/^TLI$/)).toBeInTheDocument()
    })

    expect(screen.getByDisplayValue('40')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2000')).toBeInTheDocument()
  })

  it('saves teen budget rows under type_<session_type> config_key', async () => {
    const user = userEvent.setup()
    mockGetFullList
      .mockResolvedValueOnce(mockTeenSessions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // no existing budget — force create path

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText(/^SCIT$/)).toBeInTheDocument()
    })

    // Find the SCIT row's participant_goal input via aria-labelledby.
    // Teen rows use sentinel cm_ids: SCIT=-1, TLI=-2.
    const scitGoal = document.querySelector<HTMLInputElement>(
      'input[aria-labelledby="session--1 col-participant-goal"]'
    )
    expect(scitGoal).not.toBeNull()
    await user.type(scitGoal!, '60')

    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    await waitFor(() => {
      const teenBudgetCreate = mockCreate.mock.calls.find(
        (call) =>
          (call[0] as Record<string, unknown>)['category'] === 'budget' &&
          (call[0] as Record<string, unknown>)['config_key'] === 'type_scit'
      )
      expect(teenBudgetCreate).toBeDefined()
    })
  })

  it('does not write grade config for teen rows', async () => {
    const user = userEvent.setup()
    mockGetFullList
      .mockResolvedValueOnce(mockTeenSessions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(mockTeenBudgetConfig)

    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => {
      expect(screen.getByText(/^SCIT$/)).toBeInTheDocument()
    })

    // Modify the SCIT goal to trigger save path
    const scitGoal = document.querySelector<HTMLInputElement>(
      'input[aria-labelledby="session--1 col-participant-goal"]'
    )
    expect(scitGoal).not.toBeNull()
    await user.clear(scitGoal!)
    await user.type(scitGoal!, '55')

    const saveButton = screen.getByText(/save/i)
    await user.click(saveButton)

    await waitFor(() => {
      // No create or update call should use category 'session_availability' with a negative cm_id
      const sentinelGradeWrites = [...mockCreate.mock.calls, ...mockUpdate.mock.calls].filter(
        (call) => {
          const payload = call[call.length - 1] as Record<string, unknown> | undefined
          if (!payload) return false
          const key = payload['config_key']
          return (
            payload['category'] === 'session_availability' &&
            typeof key === 'string' &&
            key.startsWith('-')
          )
        }
      )
      expect(sentinelGradeWrites).toHaveLength(0)
    })
  })
})
