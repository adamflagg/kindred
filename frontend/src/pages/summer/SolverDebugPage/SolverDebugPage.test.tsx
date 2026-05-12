import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import toast from 'react-hot-toast'

import SolverDebugPage from '.'
import type { SolverRun } from '../../../hooks/useSolverRuns'

vi.mock('../../../hooks/useCurrentYear', () => ({
  useYear: () => 2026,
  useCurrentYear: () => ({
    currentYear: 2026,
    setCurrentYear: vi.fn(),
    availableYears: [2026],
    isTransitioning: false,
    isYearReady: true,
  }),
}))

type Mode = 'loading' | 'error' | 'empty' | 'success'

let mode: Mode = 'empty'
let mockRuns: SolverRun[] = []
let mockSessions: Array<{
  id: string
  cm_id: number
  name: string
  year: number
}> = []
let mockSessionsError = false
let mockScenariosError = false
let mockMutateAsync = vi.fn()

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('../../../hooks/useSolverRuns', () => ({
  useSolverRuns: () => {
    if (mode === 'loading') {
      return {
        data: undefined,
        isLoading: true,
        isError: false,
        isSuccess: false,
        error: null,
        hasNextPage: false,
        fetchNextPage: vi.fn(),
        isFetchingNextPage: false,
      }
    }
    if (mode === 'error') {
      return {
        data: undefined,
        isLoading: false,
        isError: true,
        isSuccess: false,
        error: new Error('boom'),
        hasNextPage: false,
        fetchNextPage: vi.fn(),
        isFetchingNextPage: false,
      }
    }
    return {
      data: { pages: [{ items: mockRuns, totalItems: mockRuns.length }] },
      isLoading: false,
      isError: false,
      isSuccess: true,
      error: null,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    }
  },
}))

vi.mock('../../../hooks/useSessionList', () => ({
  useSessionList: () => ({
    data: mockSessions,
    isLoading: false,
    isError: mockSessionsError,
  }),
}))
vi.mock('../../../hooks/useScenarioList', () => ({
  useScenarioList: () => ({
    data: [],
    isLoading: false,
    isError: mockScenariosError,
  }),
}))
vi.mock('../../../hooks/useRunSweep', () => ({
  useRunSweep: () => ({ mutateAsync: mockMutateAsync }),
  useCancelSweep: () => ({ mutate: vi.fn() }),
}))

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/summer/debug/solver']}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

afterEach(() => {
  mode = 'empty'
  mockRuns = []
  mockSessions = []
  mockSessionsError = false
  mockScenariosError = false
  mockMutateAsync = vi.fn()
  vi.mocked(toast.error).mockClear()
})

describe('SolverDebugPage', () => {
  it('renders header, tabs, and empty state when no runs', () => {
    mode = 'empty'
    render(<SolverDebugPage />, { wrapper })
    expect(screen.getByRole('heading', { name: /solver debug/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /solver stats/i })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByText(/no solver runs yet/i)).toBeInTheDocument()
  })

  it('shows a loading indicator while runs are being fetched', () => {
    mode = 'loading'
    render(<SolverDebugPage />, { wrapper })
    expect(screen.getByText(/loading solver runs/i)).toBeInTheDocument()
  })

  it('shows an error message when the runs query fails', () => {
    mode = 'error'
    render(<SolverDebugPage />, { wrapper })
    expect(screen.getByText(/failed to load solver runs/i)).toBeInTheDocument()
    expect(screen.getByText(/boom/)).toBeInTheDocument()
  })

  it('renders the runs table when there are runs', () => {
    mode = 'success'
    mockRuns = [
      {
        id: 'a',
        run_id: 'run_xyz',
        status: 'success',
        created: '2026-05-08T10:14:00Z',
        stats: { status: 'OPTIMAL', walltime_seconds: 12 },
      },
    ]
    render(<SolverDebugPage />, { wrapper })
    expect(screen.queryByText(/no solver runs yet/i)).not.toBeInTheDocument()
    expect(screen.getByText(/OPTIMAL/i)).toBeInTheDocument()
  })

  it('renders an alert when sessions or scenarios fail to load', () => {
    mode = 'empty'
    mockSessionsError = true
    render(<SolverDebugPage />, { wrapper })
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load sweep options/i)
  })

  it('shows the in-flight banner derived from data (survives refresh)', () => {
    // After a refresh, activeSweepId is null but the in-flight sweep's
    // children still exist in solver_runs. Banner must derive from data.
    mode = 'success'
    mockRuns = [
      {
        id: 'sw_a_1',
        run_id: 'run_1',
        status: 'started',
        created: '2026-05-08T10:14:00Z',
        details: { sweep_id: 'sw_refresh_test' },
      },
      {
        id: 'sw_a_2',
        run_id: 'run_2',
        status: 'started',
        created: '2026-05-08T10:14:01Z',
        details: { sweep_id: 'sw_refresh_test' },
      },
    ]
    render(<SolverDebugPage />, { wrapper })
    expect(screen.getByText(/sw_refresh_test/i)).toBeInTheDocument()
    expect(screen.getByText(/0 of 2 complete/i)).toBeInTheDocument()
  })

  it('does not show the in-flight banner when all sweep children are settled', () => {
    mode = 'success'
    mockRuns = [
      {
        id: 'done_1',
        run_id: 'r1',
        status: 'success',
        created: '2026-05-08T10:14:00Z',
        details: { sweep_id: 'sw_finished' },
      },
      {
        id: 'done_2',
        run_id: 'r2',
        status: 'success',
        created: '2026-05-08T10:14:01Z',
        details: { sweep_id: 'sw_finished' },
      },
    ]
    render(<SolverDebugPage />, { wrapper })
    expect(screen.queryByText(/sw_finished/i)).not.toBeInTheDocument()
  })

  it('shows a toast when the sweep mutation fails (handleRunSweep error path)', async () => {
    mode = 'empty'
    mockSessions = [
      {
        id: 'pb_s1',
        cm_id: 1000002,
        name: 'Session 2',
        year: 2026,
      },
    ]
    mockMutateAsync = vi.fn().mockRejectedValueOnce(new Error('network fail'))

    render(<SolverDebugPage />, { wrapper })

    const user = userEvent.setup()
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /run sweep/i }))
    })

    expect(mockMutateAsync).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toMatch(/sweep failed/i)
  })
})
