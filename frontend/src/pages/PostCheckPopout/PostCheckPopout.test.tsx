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

const renderRoute = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/post-check/popout" element={<PostCheckPopout />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PostCheckPopout', () => {
  it('renders post-check modal contents bare (no main app shell)', async () => {
    renderRoute('/post-check/popout?session=1000001&scenario=abc')
    await waitFor(() => {
      expect(screen.getByText(/families to contact/i)).toBeInTheDocument()
    })
    // App shell elements MUST NOT render
    expect(screen.queryByTestId('main-app-sidebar')).toBeNull()
    expect(screen.queryByTestId('main-app-header')).toBeNull()
  })

  it('shows error message when session param missing', () => {
    renderRoute('/post-check/popout')
    expect(screen.getByText(/session.*required/i)).toBeInTheDocument()
  })
})
