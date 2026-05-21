/**
 * TDD tests for PopulateFromPreviousYear component.
 * Written FIRST before implementation.
 *
 * Tests the UI states: hidden, banner, no-sessions warning,
 * preview expanded, applying.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CurrentYearContext, type CurrentYearContextType } from '../../hooks/useCurrentYear'

// Track which collection is being queried
const mockGetFullList = vi.fn()
const mockCreate = vi.fn()
const mockUpdate = vi.fn()

vi.mock('../../lib/pocketbase', () => ({
  pb: {
    collection: (name: string) => {
      // Store the collection name so tests can differentiate calls
      const fn = (...args: unknown[]) => mockGetFullList(name, ...args)
      return {
        getFullList: fn,
        create: mockCreate,
        update: mockUpdate,
      }
    },
    autoCancellation: vi.fn(),
  },
}))

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

// ── Helpers ──────────────────────────────────────────────────────────

function createWrapper(year = 2026) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })

  const mockYearContext: CurrentYearContextType = {
    currentYear: year,
    setCurrentYear: vi.fn(),
    availableYears: [2026, 2025, 2024],
    isTransitioning: false,
    isYearReady: true,
  }

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <CurrentYearContext value={mockYearContext}>{children}</CurrentYearContext>
    </QueryClientProvider>
  )
}

const makePrevSessions = () => [
  {
    cm_id: 1001,
    name: 'Session 1',
    session_type: 'main',
    year: 2025,
    start_date: '2025-06-10',
  },
  {
    cm_id: 1002,
    name: 'Session 2',
    session_type: 'main',
    year: 2025,
    start_date: '2025-06-20',
  },
]

const makeCurSessions = () => [
  {
    cm_id: 1001,
    name: 'Session 1',
    session_type: 'main',
    year: 2026,
    start_date: '2026-06-10',
  },
  {
    cm_id: 1002,
    name: 'Session 2',
    session_type: 'main',
    year: 2026,
    start_date: '2026-06-20',
  },
]

const makePrevRegDates = () => [
  {
    id: 'prev_reg1',
    category: 'registration',
    subcategory: '2025',
    config_key: 'priority_reg_date',
    value: '2024-11-10',
  },
  {
    id: 'prev_reg2',
    category: 'registration',
    subcategory: '2025',
    config_key: 'early_reg_date',
    value: '2024-11-13',
  },
  {
    id: 'prev_reg3',
    category: 'registration',
    subcategory: '2025',
    config_key: 'open_reg_date',
    value: '2024-11-20',
  },
]

const makePrevGradeConfig = () => [
  {
    id: 'prev_grade1',
    category: 'session_availability',
    subcategory: '2025',
    config_key: '1001',
    value: { min_grade: 3, max_grade: 6, capacity_override: null },
  },
  {
    id: 'prev_grade2',
    category: 'session_availability',
    subcategory: '2025',
    config_key: '1002',
    value: { min_grade: 4, max_grade: 8, capacity_override: null },
  },
]

const makePrevBudgetConfig = () => [
  {
    id: 'prev_budget1',
    category: 'budget',
    subcategory: '2025',
    config_key: 'session_1001',
    value: { participant_goal: 150, session_fee: 3500 },
  },
]

/**
 * Set up mockGetFullList to return data based on collection name and filter params.
 * The mock receives (collectionName, options) from our mock setup.
 */
function setupMocks({
  prevSessions = makePrevSessions(),
  curSessions = makeCurSessions(),
  prevRegDates = makePrevRegDates(),
  prevGradeConfig = makePrevGradeConfig(),
  prevBudgetConfig = makePrevBudgetConfig(),
  curRegDates = [] as unknown[],
  curGradeConfig = [] as unknown[],
  curBudgetConfig = [] as unknown[],
}: {
  prevSessions?: unknown[]
  curSessions?: unknown[]
  prevRegDates?: unknown[]
  prevGradeConfig?: unknown[]
  prevBudgetConfig?: unknown[]
  curRegDates?: unknown[]
  curGradeConfig?: unknown[]
  curBudgetConfig?: unknown[]
} = {}) {
  mockGetFullList.mockImplementation((collection: string, options?: { filter?: string }) => {
    const filter = options?.filter ?? ''

    if (collection === 'camp_sessions') {
      if (filter.includes('2025')) return Promise.resolve(prevSessions)
      if (filter.includes('2026')) return Promise.resolve(curSessions)
      return Promise.resolve([])
    }

    if (collection === 'config') {
      // Registration dates
      if (filter.includes('registration') && filter.includes('2025'))
        return Promise.resolve(prevRegDates)
      if (filter.includes('registration') && filter.includes('2026'))
        return Promise.resolve(curRegDates)

      // Grade/session_availability
      if (filter.includes('session_availability') && filter.includes('2025'))
        return Promise.resolve(prevGradeConfig)
      if (filter.includes('session_availability') && filter.includes('2026'))
        return Promise.resolve(curGradeConfig)

      // Budget
      if (filter.includes('budget') && filter.includes('2025'))
        return Promise.resolve(prevBudgetConfig)
      if (filter.includes('budget') && filter.includes('2026'))
        return Promise.resolve(curBudgetConfig)
    }

    return Promise.resolve([])
  })
}

// Lazy import to ensure mocks are in place
async function getComponent() {
  const mod = await import('./PopulateFromPreviousYear')
  return mod.PopulateFromPreviousYear
}

// ── Tests ────────────────────────────────────────────────────────────

describe('PopulateFromPreviousYear', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when previous year has no sessions', async () => {
    setupMocks({ prevSessions: [] })

    const Component = await getComponent()
    const { container } = render(<Component />, { wrapper: createWrapper() })

    // Give queries time to settle
    await waitFor(() => {
      expect(mockGetFullList).toHaveBeenCalled()
    })

    // Component should render nothing
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when previous year has no config at all', async () => {
    setupMocks({
      prevRegDates: [],
      prevGradeConfig: [],
      prevBudgetConfig: [],
    })

    const Component = await getComponent()
    const { container } = render(<Component />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(mockGetFullList).toHaveBeenCalled()
    })

    expect(container.innerHTML).toBe('')
  })

  it('shows banner when previous year config exists', async () => {
    setupMocks()

    const Component = await getComponent()
    render(<Component />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText(/populate from 2025/i)).toBeInTheDocument()
    })
  })

  it('shows warning when current year has no sessions', async () => {
    setupMocks({ curSessions: [] })

    const Component = await getComponent()
    render(<Component />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText(/no sessions found/i)).toBeInTheDocument()
    })

    // The preview button should be disabled
    const button = screen.getByRole('button', { name: /run a sync first/i })
    expect(button).toBeDisabled()
  })

  it('expands preview panel when button is clicked', async () => {
    setupMocks()
    const user = userEvent.setup()

    const Component = await getComponent()
    render(<Component />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText(/populate from 2025/i)).toBeInTheDocument()
    })

    // Click the preview button
    const previewButton = screen.getByRole('button', { name: /preview/i })
    await user.click(previewButton)

    // Should show the preview section heading (exact match to avoid matching description text)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /registration dates/i })).toBeInTheDocument()
    })
  })

  it('shows shifted registration dates in preview', async () => {
    setupMocks()
    const user = userEvent.setup()

    const Component = await getComponent()
    render(<Component />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText(/populate from 2025/i)).toBeInTheDocument()
    })

    const previewButton = screen.getByRole('button', { name: /preview/i })
    await user.click(previewButton)

    // The shifted dates: 2024-11-10 → 2025-11-10
    await waitFor(() => {
      expect(screen.getByText(/2025-11-10/)).toBeInTheDocument()
    })
  })

  it('shows session grade config in preview', async () => {
    setupMocks()
    const user = userEvent.setup()

    const Component = await getComponent()
    render(<Component />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText(/populate from 2025/i)).toBeInTheDocument()
    })

    const previewButton = screen.getByRole('button', { name: /preview/i })
    await user.click(previewButton)

    // Should show the session grade config section heading
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /session grade config/i })).toBeInTheDocument()
    })
  })

  it('marks existing values as already set in preview', async () => {
    const curRegDates = [
      {
        id: 'cur_reg1',
        category: 'registration',
        subcategory: '2026',
        config_key: 'priority_reg_date',
        value: '2025-11-09',
      },
    ]
    setupMocks({ curRegDates })
    const user = userEvent.setup()

    const Component = await getComponent()
    render(<Component />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText(/populate from 2025/i)).toBeInTheDocument()
    })

    const previewButton = screen.getByRole('button', { name: /preview/i })
    await user.click(previewButton)

    // Should indicate some items are already set (multiple cells may say this)
    await waitFor(() => {
      const alreadySetElements = screen.getAllByText(/already set/i)
      expect(alreadySetElements.length).toBeGreaterThan(0)
    })
  })

  it('disables Apply button when all values already exist', async () => {
    const curRegDates = makePrevRegDates().map((r) => ({
      ...r,
      id: `cur_${r.config_key}`,
      subcategory: '2026',
    }))
    const curGradeConfig = makePrevGradeConfig().map((r) => ({
      ...r,
      id: `cur_${r.config_key}`,
      subcategory: '2026',
    }))
    const curBudgetConfig = makePrevBudgetConfig().map((r) => ({
      ...r,
      id: `cur_${r.config_key}`,
      subcategory: '2026',
    }))

    setupMocks({ curRegDates, curGradeConfig, curBudgetConfig })
    const user = userEvent.setup()

    const Component = await getComponent()
    render(<Component />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText(/populate from 2025/i)).toBeInTheDocument()
    })

    const previewButton = screen.getByRole('button', { name: /preview/i })
    await user.click(previewButton)

    await waitFor(() => {
      const applyButton = screen.getByRole('button', { name: /nothing to populate/i })
      expect(applyButton).toBeDisabled()
    })
  })

  it('creates config records when Apply is clicked', async () => {
    setupMocks()
    mockCreate.mockResolvedValue({ id: 'new_rec' })
    const user = userEvent.setup()

    const Component = await getComponent()
    render(<Component />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText(/populate from 2025/i)).toBeInTheDocument()
    })

    const previewButton = screen.getByRole('button', { name: /preview/i })
    await user.click(previewButton)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /registration dates/i })).toBeInTheDocument()
    })

    const applyButton = screen.getByRole('button', { name: /apply/i })
    await user.click(applyButton)

    // Should call create for each new config record
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalled()
    })
  })

  it('skips creating records that already exist', async () => {
    // priority_reg_date already exists for 2026
    const curRegDates = [
      {
        id: 'cur_reg1',
        category: 'registration',
        subcategory: '2026',
        config_key: 'priority_reg_date',
        value: '2025-11-09',
      },
    ]
    setupMocks({ curRegDates })
    mockCreate.mockResolvedValue({ id: 'new_rec' })
    const user = userEvent.setup()

    const Component = await getComponent()
    render(<Component />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText(/populate from 2025/i)).toBeInTheDocument()
    })

    const previewButton = screen.getByRole('button', { name: /preview/i })
    await user.click(previewButton)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /registration dates/i })).toBeInTheDocument()
    })

    const applyButton = screen.getByRole('button', { name: /apply/i })
    await user.click(applyButton)

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalled()
    })

    // Verify priority_reg_date was NOT created (it already exists)
    const createCalls = mockCreate.mock.calls
    const createdKeys = createCalls.map(
      (call: unknown[]) => (call[0] as Record<string, unknown>)['config_key']
    )
    expect(createdKeys).not.toContain('priority_reg_date')
  })

  it('shows summary counts in preview', async () => {
    setupMocks()
    const user = userEvent.setup()

    const Component = await getComponent()
    render(<Component />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText(/populate from 2025/i)).toBeInTheDocument()
    })

    const previewButton = screen.getByRole('button', { name: /preview/i })
    await user.click(previewButton)

    // Should show how many items will be created
    await waitFor(() => {
      // 3 reg dates + 2 grade configs + 1 budget = 6 items to create
      // (plus threshold if present in the mock data)
      const toCreateText = screen.getByText(/to create/i)
      expect(toCreateText).toBeInTheDocument()
    })
  })

  it('shows previous session name for alias-matched sessions', async () => {
    // Previous year has "Taste of Camp" (cm_id 5001)
    // Current year has "Taste of Camp 1" (cm_id 3001) — alias match
    const prevSessions = [
      {
        cm_id: 5001,
        name: 'Taste of Camp',
        session_type: 'main',
        year: 2025,
        start_date: '2025-06-10',
      },
    ]
    const curSessions = [
      {
        cm_id: 3001,
        name: 'Taste of Camp 1',
        session_type: 'main',
        year: 2026,
        start_date: '2026-06-10',
      },
    ]
    const prevGradeConfig = [
      {
        id: 'prev_grade_toc',
        category: 'session_availability',
        subcategory: '2025',
        config_key: '5001',
        value: { min_grade: 2, max_grade: 5, capacity_override: null },
      },
    ]

    setupMocks({
      prevSessions,
      curSessions,
      prevGradeConfig,
      prevRegDates: [],
      prevBudgetConfig: [],
    })
    const user = userEvent.setup()

    const Component = await getComponent()
    render(<Component />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText(/populate from 2025/i)).toBeInTheDocument()
    })

    const previewButton = screen.getByRole('button', { name: /preview/i })
    await user.click(previewButton)

    // Should show the previous session name in parens
    await waitFor(() => {
      expect(screen.getByText(/was Taste of Camp\b/)).toBeInTheDocument()
    })
  })

  it('uses update instead of create for items with existingRecordId', async () => {
    // Current year has grade config records with all-null values (empty but existing)
    const curGradeConfig = [
      {
        id: 'cur_grade1',
        category: 'session_availability',
        subcategory: '2026',
        config_key: '1001',
        value: { min_grade: null, max_grade: null, capacity_override: null },
      },
    ]

    setupMocks({
      curGradeConfig,
      prevRegDates: [],
      prevBudgetConfig: [],
    })
    mockCreate.mockResolvedValue({ id: 'new_rec' })
    mockUpdate.mockResolvedValue({ id: 'cur_grade1' })
    const user = userEvent.setup()

    const Component = await getComponent()
    render(<Component />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText(/populate from 2025/i)).toBeInTheDocument()
    })

    const previewButton = screen.getByRole('button', { name: /preview/i })
    await user.click(previewButton)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /session grade config/i })).toBeInTheDocument()
    })

    const applyButton = screen.getByRole('button', { name: /apply/i })
    await user.click(applyButton)

    await waitFor(() => {
      // Should use update for the existing empty record, not create
      expect(mockUpdate).toHaveBeenCalledWith('cur_grade1', expect.any(Object))
    })

    // Should NOT have called create for this item
    const createCalls = mockCreate.mock.calls
    const createdKeys = createCalls.map(
      (call: unknown[]) => (call[0] as Record<string, unknown>)['config_key']
    )
    expect(createdKeys).not.toContain('1001')
  })

  it('displays unmatched session names in summary', async () => {
    // Current year has sessions that don't exist in previous year
    const curSessions = [
      ...makeCurSessions(),
      {
        cm_id: 9001,
        name: 'Brand New Session',
        session_type: 'main',
        year: 2026,
        start_date: '2026-07-01',
      },
      {
        cm_id: 9002,
        name: 'Quest Extended',
        session_type: 'quest',
        year: 2026,
        start_date: '2026-07-15',
      },
    ]

    setupMocks({ curSessions })
    const user = userEvent.setup()

    const Component = await getComponent()
    render(<Component />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText(/populate from 2025/i)).toBeInTheDocument()
    })

    const previewButton = screen.getByRole('button', { name: /preview/i })
    await user.click(previewButton)

    // Should show the unmatched session names
    await waitFor(() => {
      expect(screen.getByText(/Brand New Session/)).toBeInTheDocument()
      expect(screen.getByText(/Quest Extended/)).toBeInTheDocument()
    })
  })

  it('treats current config with all-null values as populatable', async () => {
    // Current year has grade config records but all values are null
    const curGradeConfig = [
      {
        id: 'cur_grade1',
        category: 'session_availability',
        subcategory: '2026',
        config_key: '1001',
        value: { min_grade: null, max_grade: null, capacity_override: null },
      },
      {
        id: 'cur_grade2',
        category: 'session_availability',
        subcategory: '2026',
        config_key: '1002',
        value: { min_grade: null, max_grade: null, capacity_override: null },
      },
    ]

    setupMocks({ curGradeConfig })
    const user = userEvent.setup()

    const Component = await getComponent()
    render(<Component />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText(/populate from 2025/i)).toBeInTheDocument()
    })

    const previewButton = screen.getByRole('button', { name: /preview/i })
    await user.click(previewButton)

    // Grade items should show as "new" (populatable), not "already set"
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /session grade config/i })).toBeInTheDocument()
    })

    // All grade items should be marked "new" not "already set"
    const newBadges = screen.getAllByText('new')
    expect(newBadges.length).toBeGreaterThanOrEqual(2) // both sessions
  })
})
