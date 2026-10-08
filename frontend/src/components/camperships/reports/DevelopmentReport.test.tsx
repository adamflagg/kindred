/**
 * Reports › Development › Report through its real hooks (spec §9.4; D65, D68; S4-4; Decisions 16, 17):
 * the table, the rebuild switch's reason, the basis note, and the dated columns' add and remove on
 * a fresh read. Only `fetch` is faked.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidReportColumns } from '../../../types/api-types'
import { campToday } from '../kit/dates'
import { COLUMNS_SAVED, DEVELOPMENT } from './developmentFixtures'
import { dayBefore } from './developmentModel'
import { DevelopmentReport } from './DevelopmentReport'

vi.mock('../../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => p === 'financial_aid.summary' }),
}))
vi.mock('../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

const VIEW = { year: 2027, asOf: { kind: 'live' } as const }
let columnReads: ApiAidReportColumns[] = []
let putAnswer: () => Response
let fetchSpy: MockInstance<typeof fetch>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-06-03T18:00:00Z'))
  columnReads = [COLUMNS_SAVED]
  putAnswer = () => json(COLUMNS_SAVED)
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const text = String(url)
    if (init?.method === 'PUT') return Promise.resolve(putAnswer())
    if (text.includes('/definitions')) return Promise.resolve(json({ surface: 'x', notes: [] }))
    if (text.includes('/columns')) {
      const next = columnReads.length > 1 ? columnReads.shift() : columnReads[0]
      return Promise.resolve(json(next ?? COLUMNS_SAVED))
    }
    return Promise.resolve(json(DEVELOPMENT))
  })
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

function renderReport() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/aid/reports/development']}>
        <DevelopmentReport view={VIEW} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('DevelopmentReport (spec §9.4)', () => {
  it('draws the lines by section and group, seasons as columns, never a family', async () => {
    renderReport()
    const table = await screen.findByRole('table', { name: 'Development report' })
    expect(within(table).getByText('Money')).toBeInTheDocument()
    expect(within(table).getAllByText('Every group')).toHaveLength(2)
    expect(
      within(table).getByText('2025 (as reported) · r · basis unconfirmed')
    ).toBeInTheDocument()
    expect(screen.getByRole('table', { name: '2027 by source' })).toBeInTheDocument()
  })

  it("keeps Show the dashboard's rebuild off, saying why in the server's words (Decision 16)", async () => {
    renderReport()
    await screen.findByRole('table', { name: 'Development report' })
    expect(screen.getByRole('checkbox', { name: /Show the dashboard's rebuild/ })).toBeDisabled()
    expect(screen.getByText(/waits on the 2017–2024 ledger backfill/)).toBeInTheDocument()
  })
})

describe('DatedColumns: saved for everyone, on a fresh read (D68; Decision 17)', () => {
  const APRIL = { season: 2027, as_of: '2027-04-12' }
  const puts = () =>
    fetchSpy.mock.calls
      .filter(([, init]) => init?.method === 'PUT')
      .map(([, init]) => JSON.parse(init?.body as string) as unknown)

  it("adds a dated column to the list as it now stands, keeping a colleague's (Decision 17)", async () => {
    const colleague = { season: 2027, as_of: '2027-05-01' }
    columnReads = [
      COLUMNS_SAVED,
      { report: 'development', columns: [...COLUMNS_SAVED.columns, colleague] },
    ]
    renderReport()
    await screen.findByText('2027 as of Mar 9, 2027')
    await userEvent.click(screen.getByRole('button', { name: '+ Add a Dated Column' }))
    fireEvent.change(screen.getByLabelText('As of'), { target: { value: APRIL.as_of } })
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(puts()).toEqual([{ columns: [...COLUMNS_SAVED.columns, colleague, APRIL] }])
    )
    expect(await screen.findByText(/2027 as of Apr 12, 2027: added/)).toBeInTheDocument()
  })

  it("shows the server's refusal and keeps the typing", async () => {
    putAnswer = () => json({ detail: 'A dated column needs a day already past' }, 422)
    renderReport()
    await screen.findByText('2027 as of Mar 9, 2027')
    await userEvent.click(screen.getByRole('button', { name: '+ Add a Dated Column' }))
    fireEvent.change(screen.getByLabelText('As of'), { target: { value: APRIL.as_of } })
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(
      await screen.findByText(/Nothing was written: A dated column needs a day already past/)
    ).toBeInTheDocument()
    expect(screen.getByLabelText('As of')).toHaveValue(APRIL.as_of)
  })

  it('offers a past day only: the date box stops at yesterday, camp time (#2967 refuses today)', async () => {
    renderReport()
    await screen.findByText('2027 as of Mar 9, 2027')
    await userEvent.click(screen.getByRole('button', { name: '+ Add a Dated Column' }))
    expect(screen.getByLabelText('As of')).toHaveAttribute('max', dayBefore(campToday()))
  })

  it('removes a dated column from the list as it now stands', async () => {
    renderReport()
    await screen.findByText('2027 as of Mar 9, 2027')
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(puts()).toEqual([{ columns: [] }]))
  })
})
