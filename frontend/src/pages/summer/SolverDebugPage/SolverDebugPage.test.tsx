import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import SolverDebugPage from '.'

vi.mock('../../../hooks/useSolverRuns', () => ({
  useSolverRuns: () => ({ data: { items: [], totalItems: 0 }, isSuccess: true }),
}))

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/summer/debug/solver']}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('SolverDebugPage', () => {
  it('renders header, tabs, and empty state when no runs', () => {
    render(<SolverDebugPage />, { wrapper })
    expect(screen.getByRole('heading', { name: /solver debug/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /solver stats/i })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByText(/no solver runs yet/i)).toBeInTheDocument()
  })
})
