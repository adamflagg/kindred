/** Statistics › Year over year through its real hooks (spec §9.7; S4-2). Only `fetch` is faked. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { COMMITTEE } from './committeeFixtures'
import { YearOverYear } from './YearOverYear'

vi.mock('../../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => p === 'financial_aid.view' }),
}))
vi.mock('../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

const VIEW = { year: 2027, asOf: { kind: 'live' } as const }
let fetchSpy: MockInstance<typeof fetch>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const committeeCalls = () =>
  fetchSpy.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/committee'))

beforeEach(() => {
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((url) =>
      Promise.resolve(
        String(url).includes('/definitions')
          ? json({ surface: 'reports-committee', notes: [] })
          : json(COMMITTEE)
      )
    )
})
afterEach(() => fetchSpy.mockRestore())

function Where() {
  const { search } = useLocation()
  return <div data-testid="where">{search}</div>
}

function renderView(path = '/aid/reports/statistics/year-over-year') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <YearOverYear view={VIEW} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('YearOverYear (spec §9.7; S4-2)', () => {
  it('draws the five tables from one read, with what is not built yet named', async () => {
    renderView()
    const phases = await screen.findByRole('table', {
      name: 'Round 1 phases, year over year (RPT-1)',
    })
    expect(within(phases).getByText('2027 · P · to date')).toBeInTheDocument()
    for (const name of [
      'Applications and Round 1 ask at the cutoff (RPT-2, RPT-6)',
      'Budget against actuals by pool (RPT-7, RPT-24)',
      'Applications and appeals (RPT-8)',
      '% of ask awarded in Round 1 (RPT-13)',
    ]) {
      expect(screen.getByRole('table', { name })).toBeInTheDocument()
    }
    expect(screen.getByText(/Not built yet: Enrollment % of goal/)).toBeInTheDocument()
    expect(committeeCalls()).toHaveLength(1)
  })

  it('switches the phases to their share in the URL, without reading again', async () => {
    renderView()
    await screen.findByRole('table', { name: 'Round 1 phases, year over year (RPT-1)' })
    await userEvent.click(screen.getByRole('button', { name: 'share of the phases' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?phases=share')
    expect(screen.getAllByText('66.7%').length).toBeGreaterThan(0)
    expect(committeeCalls()).toHaveLength(1)
  })

  it("moves this season's cutoff with a received-through date; there is no deadline switch", async () => {
    renderView()
    await screen.findByRole('table', { name: 'Round 1 phases, year over year (RPT-1)' })
    expect(screen.queryByRole('checkbox', { name: 'Through the Round 1 deadline' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Received through'), { target: { value: '2027-02-15' } })
    await waitFor(() =>
      expect(committeeCalls().at(-1)).toBe(
        '/api/financial-aid/reports/2027/committee?received_through=2027-02-15'
      )
    )
  })
})
