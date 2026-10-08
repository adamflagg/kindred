/** Reports › Programs through its real hooks (spec §9.3; RPT-11; D138). Only `fetch` is faked. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { PROGRAMS } from './programsFixtures'
import { ProgramsTab } from './ProgramsTab'

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
const programCalls = () =>
  fetchSpy.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/programs'))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((url) =>
      Promise.resolve(
        String(url).includes('/definitions')
          ? json({ surface: 'reports-programs', notes: [] })
          : json(PROGRAMS)
      )
    )
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

function Where() {
  const { search } = useLocation()
  return <div data-testid="where">{search}</div>
}

function renderTab(path = '/aid/reports/programs') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ProgramsTab view={VIEW} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('ProgramsTab (spec §9.3)', () => {
  it("draws sessions by pool with the server's subtotal and total", async () => {
    renderTab()
    const table = await screen.findByRole('table', { name: 'By session' })
    expect(within(table).getByText('Pool A subtotal')).toBeInTheDocument()
    expect(within(table).getByText('All pools')).toBeInTheDocument()
    expect(within(table).getAllByText('$2,100')).toHaveLength(3)
  })

  it("opens a session's Apps in Requests on that count's address (slice 4 J)", async () => {
    renderTab()
    const table = await screen.findByRole('table', { name: 'By session' })
    const [session2] = within(table).getAllByRole('link', { name: '2' })
    expect(session2).toHaveAttribute(
      'href',
      `/aid/requests?${new URLSearchParams({
        report: 'programs?part=session&pool=pool_a&session=1000102&block=1&count=apps',
        year: '2027',
      }).toString()}`
    )
  })

  it('applies the reporting controls through the URL (D138), with no decided basis', async () => {
    renderTab()
    await screen.findByRole('table', { name: 'By session' })
    expect(screen.queryByRole('checkbox', { name: 'Include not yet offered' })).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Through the Round 1 deadline' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?through=deadline')
    await waitFor(() =>
      expect(programCalls().at(-1)).toBe(
        '/api/financial-aid/reports/2027/programs?through_round1_deadline=true'
      )
    )
  })
})
