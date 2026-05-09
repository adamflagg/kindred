import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import SolverDebugPage from '.'
import type { SolverRun } from '../../../hooks/useSolverRuns'

type Mode = 'loading' | 'error' | 'empty' | 'success'

let mode: Mode = 'empty'
let mockRuns: SolverRun[] = []

vi.mock('../../../hooks/useSolverRuns', () => ({
  useSolverRuns: () => {
    if (mode === 'loading') {
      return {
        data: undefined,
        isLoading: true,
        isError: false,
        isSuccess: false,
        error: null,
      }
    }
    if (mode === 'error') {
      return {
        data: undefined,
        isLoading: false,
        isError: true,
        isSuccess: false,
        error: new Error('boom'),
      }
    }
    return {
      data: { items: mockRuns, totalItems: mockRuns.length },
      isLoading: false,
      isError: false,
      isSuccess: true,
      error: null,
    }
  },
}))

vi.mock('../../../hooks/useSessionList', () => ({
  useSessionList: () => ({ data: [], isLoading: false, isError: false }),
}))
vi.mock('../../../hooks/useScenarioList', () => ({
  useScenarioList: () => ({ data: [], isLoading: false, isError: false }),
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
})
