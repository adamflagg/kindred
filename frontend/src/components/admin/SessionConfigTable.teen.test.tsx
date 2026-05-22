import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SessionConfigTable } from './SessionConfigTable'

const { mockGetFullList, mockUpdate, mockCreate, mockCollection } = vi.hoisted(() => ({
  mockGetFullList: vi.fn(),
  mockUpdate: vi.fn(),
  mockCreate: vi.fn(),
  mockCollection: vi.fn(),
}))
vi.mock('../../lib/pocketbase', () => ({ pb: { collection: mockCollection } }))
vi.mock('../../hooks/useCurrentYear', () => ({ useCurrentYear: () => ({ currentYear: 2026 }) }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: '1' }, isLoading: false }),
}))

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

// One main (anchors the summer window) + two scit (CIT/SIT) + one tli, all summer dates.
// TLI start must fall within the main-session window for the window-gate to pass.
const sessions = [
  {
    cm_id: 1001,
    name: 'Session 2',
    session_type: 'main',
    start_date: '2026-06-15',
    end_date: '2026-08-03',
    year: 2026,
    parent_id: null,
  },
  {
    cm_id: 1236361,
    name: 'Counselor In-Training',
    session_type: 'scit',
    start_date: '2026-06-07',
    end_date: '2026-07-03',
    year: 2026,
    parent_id: null,
  },
  {
    cm_id: 1236368,
    name: 'Specialist In-Training',
    session_type: 'scit',
    start_date: '2026-06-07',
    end_date: '2026-07-03',
    year: 2026,
    parent_id: null,
  },
  {
    cm_id: 1274420,
    name: 'Teen Leadership Institute',
    session_type: 'tli',
    start_date: '2026-07-10',
    end_date: '2026-08-02',
    year: 2026,
    parent_id: null,
  },
]
const budget = [
  {
    id: 'b_scit',
    category: 'budget',
    subcategory: '2026',
    config_key: 'type_scit',
    value: { participant_goal: 50, session_fee: 1500 },
  },
]

describe('SessionConfigTable — teen rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCollection.mockReturnValue({
      getFullList: mockGetFullList,
      update: mockUpdate,
      create: mockCreate,
    })
  })

  it('collapses CIT+SIT into one SCIT row and renders a TLI row', async () => {
    mockGetFullList
      .mockResolvedValueOnce(sessions) // useAdminSessions
      .mockResolvedValueOnce([]) // grade config
      .mockResolvedValueOnce([]) // threshold
      .mockResolvedValueOnce(budget) // budget config
    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => expect(screen.getByText('Session 2')).toBeInTheDocument())
    expect(screen.getAllByText(/^SCIT$/)).toHaveLength(1) // not two
    expect(screen.getByText(/^TLI$/)).toBeInTheDocument()
    expect(screen.getByText(/teen programs/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue('1500')).toBeInTheDocument() // SCIT fee from type_scit
  })

  it('saves teen budget under config_key=type_tli (no grade write for teens)', async () => {
    const user = userEvent.setup()
    mockGetFullList
      .mockResolvedValueOnce(sessions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // no existing budget → create path
    mockCreate.mockResolvedValue({})
    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => expect(screen.getByText(/^TLI$/)).toBeInTheDocument())

    const inputs = screen.getAllByRole('spinbutton')
    const tliGoal = inputs.find(
      (i) =>
        i.getAttribute('aria-labelledby')?.includes('type_tli') &&
        i.getAttribute('aria-labelledby')?.includes('participant-goal')
    )
    expect(tliGoal).toBeDefined()
    await user.type(tliGoal!, '40')

    await user.click(screen.getByText(/save/i))

    await waitFor(() => {
      const teenBudget = mockCreate.mock.calls.find(
        (c) => (c[0] as Record<string, unknown>)['config_key'] === 'type_tli'
      )
      expect(teenBudget).toBeDefined()
      expect((teenBudget![0] as Record<string, unknown>)['category']).toBe('budget')
    })
    const teenGrade = mockCreate.mock.calls.find(
      (c) =>
        (c[0] as Record<string, unknown>)['config_key'] === 'type_tli' &&
        (c[0] as Record<string, unknown>)['category'] === 'session_availability'
    )
    expect(teenGrade).toBeUndefined()
  })

  it('hides grade selects for teen rows', async () => {
    mockGetFullList
      .mockResolvedValueOnce(sessions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(budget)
    renderWithProviders(<SessionConfigTable />)

    await waitFor(() => expect(screen.getByText(/^SCIT$/)).toBeInTheDocument())
    // Grade selects exist only for the main row (2: min+max). Teen rows render none.
    const selects = screen.getAllByRole('combobox')
    expect(selects).toHaveLength(2)
  })
})
