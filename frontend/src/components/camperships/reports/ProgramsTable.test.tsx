/** Reports › Statistics by session (the programs table) through its real hooks (spec §9.3; RPT-11; D138). Only `fetch` is faked. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { AidRequestSet } from '../../../services/camperships/aidApi'
import { PROGRAMS } from './programsFixtures'
import { ProgramsTable } from './ProgramsTable'

const downloadCsv = vi.fn<(content: string, name: string) => void>()
vi.mock('../../../utils/csvExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/csvExport')>()),
  downloadCsv: (content: string, name: string) => downloadCsv(content, name),
}))
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

function renderTab(
  requestSet: AidRequestSet = { kind: 'all' },
  path = '/aid/reports/statistics?rows=session'
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ProgramsTable view={VIEW} requestSet={requestSet} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('ProgramsTable (spec §9.3)', () => {
  it('names itself "the session table", never "Programs", while it loads', async () => {
    fetchSpy.mockImplementation(() => new Promise(() => undefined))
    renderTab()
    expect(await screen.findByText(/Loading the session table data/)).toBeInTheDocument()
    expect(screen.queryByText(/Loading Programs data/)).toBeNull()
  })

  it('numbers its columns from the Statistics notes (one list on the page)', async () => {
    fetchSpy.mockImplementation((url) =>
      Promise.resolve(
        String(url).includes('/definitions')
          ? json({
              surface: 'reports-statistics',
              notes: [
                { key: 'apps', n: 1, text: 'Apps.' },
                { key: 'awarded', n: 3, text: 'Awarded.' },
              ],
            })
          : json(PROGRAMS)
      )
    )
    renderTab()
    const table = await screen.findByRole('table', { name: 'By session' })
    await waitFor(() =>
      expect(Array.from(table.querySelectorAll('sup')).map((s) => s.textContent)).toContain('3')
    )
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('reports-programs'))).toBe(
      false
    )
  })

  it("draws sessions by pool with the server's subtotal and total", async () => {
    renderTab()
    const table = await screen.findByRole('table', { name: 'By session' })
    expect(within(table).getByText('Pool A subtotal')).toBeInTheDocument()
    expect(within(table).getByText('All pools')).toBeInTheDocument()
    expect(within(table).getAllByText('$2,100')).toHaveLength(3)
  })

  it("divides each round's Apps and the total from the figures before them, as the mock does", async () => {
    renderTab()
    const table = await screen.findByRole('table', { name: 'By session' })
    const heads = within(table).getAllByRole('columnheader')
    const divided = heads.filter((h) => h.className.includes('border-l')).map((h) => h.textContent)
    expect(divided).toHaveLength(4)
    expect(divided.filter((t) => t.startsWith('Apps'))).toHaveLength(3)
    expect(divided).toContain('Total awarded')
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

  it('has no controls of its own, and sends the request set it is given (D138)', async () => {
    renderTab({ kind: 'deadline' })
    await screen.findByRole('table', { name: 'By session' })
    expect(screen.queryByRole('checkbox')).toBeNull()
    await waitFor(() =>
      expect(programCalls().at(-1)).toBe(
        '/api/financial-aid/reports/2027/programs?through_round1_deadline=true'
      )
    )
  })

  it('names Statistics by session as its link, carrying the request set', async () => {
    renderTab({ kind: 'deadline' })
    await screen.findByRole('table', { name: 'By session' })
    await userEvent.click(screen.getByRole('button', { name: /Download CSV/ }))
    const [content] = downloadCsv.mock.calls[0] ?? ['']
    expect(content).toContain(
      'Link,/aid/reports/statistics?rows=session&through=deadline&year=2027'
    )
  })
})
