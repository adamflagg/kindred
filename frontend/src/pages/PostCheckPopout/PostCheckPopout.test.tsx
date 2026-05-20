import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PostCheckPopout from './index'

// Mock AuthContext so the component can call useAuth()
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Test User' } }),
}))

// Mock the Modal so PostValidationResultsModal renders its children inline
vi.mock('../../components/ui/Modal', () => ({
  Modal: ({
    isOpen,
    children,
    header,
    footer,
  }: {
    isOpen: boolean
    children: React.ReactNode
    header?: React.ReactNode
    footer?: React.ReactNode
  }) => {
    if (!isOpen) return null
    return (
      <div data-testid="modal">
        {header}
        {children}
        {footer}
      </div>
    )
  },
}))

// BunkRequestProvider mocked to avoid PocketBase queries
vi.mock('../../providers/BunkRequestProvider', () => ({
  BunkRequestProvider: ({ children }: { sessionCmId: number; children: React.ReactNode }) => (
    <div data-testid="bunk-request-provider">{children}</div>
  ),
}))

// Mock useApiWithAuth — the popout calls solverService which needs fetchWithAuth
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn() }),
}))

// Mock useCurrentYear
vi.mock('../../hooks/useCurrentYear', () => ({
  useYear: () => 2025,
  useCurrentYear: () => ({
    currentYear: 2025,
    setCurrentYear: vi.fn(),
    availableYears: [2025],
    isTransitioning: false,
    isYearReady: true,
  }),
}))

// Mock solverService so we control what validateBunking and preValidateRequests return
vi.mock('../../services/solver', () => ({
  solverService: {
    validateBunking: vi.fn().mockResolvedValue({
      statistics: {
        total_campers: 50,
        assigned_campers: 48,
        unassigned_campers: 2,
        total_requests: 20,
        satisfied_requests: 18,
        request_satisfaction_rate: 0.9,
        bunks_at_capacity: 4,
        bunks_under_capacity: 0,
        bunks_over_capacity: 0,
        material_parent_requests: 0,
        satisfied_material_parent_requests: 0,
        material_parent_request_satisfaction_rate: 0,
        campers_with_unsatisfied_material_parent_requests: 0,
        // Include a not-bunk-with violation so "Families to contact" section renders
        negative_request_violations_detail: [
          {
            requester_cm_id: '1001',
            target_cm_id: '1002',
            requester_name: 'Emma Johnson',
            target_name: 'Liam Garcia',
            bunk_cm_id: '2001',
            bunk_name: 'Pine 3',
            session_cm_id: '1000001',
            requester_grade: 5,
          },
        ],
        field_stats: {},
      },
      issues: [],
      validated_at: '2025-06-01T12:00:00Z',
    }),
    preValidateRequests: vi.fn().mockResolvedValue({
      impossibility_report: {
        total_impossible: 0,
        affected_campers: 0,
        by_reason: {},
        flat: [],
        mp_campers_entirely_impossible: [],
      },
    }),
  },
}))

// Mock PocketBase. A single stable getFullList mock is shared across every
// pb.collection(...) call, so per-test overrides (mockResolvedValueOnce /
// mockRejectedValueOnce) actually drive what the component sees — the previous
// `collection: () => ({ getFullList: vi.fn() })` minted a fresh fn per call, so
// overrides landed on a throwaway and tests passed for the wrong reason (#1549).
const { mockGetFullList } = vi.hoisted(() => ({ mockGetFullList: vi.fn() }))

const DEFAULT_SESSIONS = [
  {
    id: 'sess-pb-1',
    cm_id: 1000001,
    name: 'Session 2',
    session_type: 'main',
    start_date: '2025-07-01',
    end_date: '2025-07-15',
    year: 2025,
    parent_id: '',
  },
]

vi.mock('../../lib/pocketbase', () => ({
  pb: {
    collection: vi.fn(() => ({ getFullList: mockGetFullList })),
  },
}))

const renderRoute = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/session/:sessionId/post-check" element={<PostCheckPopout />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetFullList.mockResolvedValue(DEFAULT_SESSIONS)
})

describe('PostCheckPopout', () => {
  it('renders post-check modal contents bare (no main app shell) when segment resolves', async () => {
    renderRoute('/session/2/post-check?scenario=abc')
    await waitFor(() => {
      expect(screen.getByText(/families to contact/i)).toBeInTheDocument()
    })
    // App shell elements MUST NOT render
    expect(screen.queryByTestId('main-app-sidebar')).toBeNull()
    expect(screen.queryByTestId('main-app-header')).toBeNull()
  })

  it('shows "Session not found" when the session list loads but has no match', async () => {
    // Empty session list → segment "2" can't resolve. With the stable mock this
    // override actually drives the component's fetch (proving the empty-list
    // path, not a coincidental segment mismatch).
    mockGetFullList.mockResolvedValueOnce([])
    renderRoute('/session/2/post-check')
    await waitFor(() => {
      expect(screen.getByText(/session not found/i)).toBeInTheDocument()
    })
  })

  it('shows an error state (not "Session not found") when the session query fails', async () => {
    // A network/PB failure must render an explicit error, not collapse into the
    // not-found state (frontend/CLAUDE.md: all 4 query states handled). #1549.
    mockGetFullList.mockRejectedValueOnce(new Error('network down'))
    renderRoute('/session/2/post-check')
    await waitFor(() => {
      expect(screen.getByText(/failed to load sessions/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/session not found/i)).toBeNull()
  })
})
