/**
 * Reports › Development › Report through its real hooks (spec §9.4; D65, D68; S4-4; Decisions 16, 17):
 * the table, the rebuild switch's reason, the basis note, and the on-demand as-of column (not saved,
 * component state only). Only `fetch` is faked.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { campToday } from '../kit/dates'
import {
  BUDGET_ROW,
  DEVELOPMENT,
  DEVELOPMENT_GRANTORS,
  DEVELOPMENT_LIVE,
} from './developmentFixtures'
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
let columnAnswer: () => Response
let liveAnswer: () => Response
let fetchSpy: MockInstance<typeof fetch>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-06-03T18:00:00Z'))
  columnAnswer = () => json(DEVELOPMENT)
  liveAnswer = () => json(DEVELOPMENT_LIVE)
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const text = String(url)
    if (text.includes('/definitions')) return Promise.resolve(json({ surface: 'x', notes: [] }))
    if (text.includes('column=')) return Promise.resolve(columnAnswer())
    return Promise.resolve(liveAnswer())
  })
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

function Where() {
  const location = useLocation()
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>
}

function renderReport() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/aid/reports/development']}>
        <DevelopmentReport view={VIEW} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('DevelopmentReport (spec §9.4)', () => {
  it('draws the lines by section, one row each, seasons as columns, never a family', async () => {
    renderReport()
    const table = await screen.findByRole('table', { name: 'Development report' })
    expect(within(table).getByText('Money')).toBeInTheDocument()
    expect(within(table).queryByText('Every group')).not.toBeInTheDocument()
    expect(within(table).queryByRole('columnheader', { name: 'Group' })).not.toBeInTheDocument()
    expect(within(table).getAllByText('Total Awards Granted')).toHaveLength(1)
    expect(
      within(table).getByText('2025 (as reported) · r · basis unconfirmed')
    ).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: '2027 by source' })).not.toBeInTheDocument()
  })

  it("keeps Show the dashboard's rebuild off, with no “Not built yet” line and none of the server's reasons (D4)", async () => {
    liveAnswer = () =>
      json({
        ...DEVELOPMENT_LIVE,
        not_built: [
          ...DEVELOPMENT_LIVE.not_built,
          { figure: 'other', reason: 'Some other figure waits' },
        ],
      })
    renderReport()
    await screen.findByRole('table', { name: 'Development report' })
    expect(screen.getByRole('checkbox', { name: /Show the dashboard's rebuild/ })).toBeDisabled()
    expect(screen.queryByText(/Not built yet/)).not.toBeInTheDocument()
    expect(screen.queryByText(/ledger backfill/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Some other figure waits/)).not.toBeInTheDocument()
  })
})

describe('the Budget row (D2)', () => {
  it('is the first line of Money, in dollars for every column', async () => {
    liveAnswer = () => json({ ...DEVELOPMENT_LIVE, rows: [...DEVELOPMENT_LIVE.rows, BUDGET_ROW] })
    renderReport()
    const table = await screen.findByRole('table', { name: 'Development report' })
    const rows = within(table).getAllByRole('row')
    // header row, then the Money heading, then Budget
    expect(rows[1]).toHaveTextContent('Money')
    expect(rows[2]).toHaveTextContent('Budget')
    expect(rows[2]).toHaveTextContent('$1,000,000')
    expect(rows[2]).toHaveTextContent('$1,200,000')
  })

  it('draws no Budget line, and no placeholder for it, when the read has none', async () => {
    renderReport()
    const table = await screen.findByRole('table', { name: 'Development report' })
    expect(within(table).queryByText(/Budget/)).not.toBeInTheDocument()
  })
})

describe('the grantor lines (D3)', () => {
  it('draw inline under Outside grants with their facts, in the one table', async () => {
    liveAnswer = () => json(DEVELOPMENT_GRANTORS)
    renderReport()
    const table = await screen.findByRole('table', { name: 'Development report' })
    expect(within(table).getByText('Grantor A')).toBeInTheDocument()
    expect(within(table).getByText('another funder · incentive')).toBeInTheDocument()
    expect(
      within(table).getByText('another funder · need-based · needs a group')
    ).toBeInTheDocument()
    expect(screen.getAllByRole('table')).toHaveLength(1)
  })
})

describe('the footnotes (D4)', () => {
  it('list every outside source with its facts, r typed once, and that no family is named', async () => {
    renderReport()
    await screen.findByRole('table', { name: 'Development report' })
    expect(
      screen.getByText(
        'Every outside source is listed by name with its facts: who paid, incentive or need-based, and its group.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText(/r = as reported, typed once, read only/)).toBeInTheDocument()
    expect(
      screen.getByText('No family is ever named on this report; rows are quantities and dollars.')
    ).toBeInTheDocument()
  })

  it('carry no internal id: no D-code, RPT- or O-930 anywhere on the report', async () => {
    renderReport()
    await screen.findByRole('table', { name: 'Development report' })
    expect(document.body.textContent).not.toMatch(/\bD\d{2,3}\b|RPT-|O-930/)
  })
})

describe('the footnote', () => {
  it('says each line is the server’s own figure and the groups under it are never added up', async () => {
    renderReport()
    await screen.findByRole('table', { name: 'Development report' })
    expect(
      screen.getByText(
        /Each line is the server's own figure over every group, money in no group included; the groups under a line are never added up to make it \(Money in no group is its own line\)\./
      )
    ).toBeInTheDocument()
  })
})

describe('Show As Of a Date…: one on-demand column, not saved (D1)', () => {
  const MARCH = '2027-03-09'
  const calls = () => fetchSpy.mock.calls.map(([url, init]) => [String(url), init?.method ?? 'GET'])

  async function show(day = MARCH) {
    await screen.findByRole('table', { name: 'Development report' })
    await userEvent.click(screen.getByRole('button', { name: 'Show As Of a Date…' }))
    fireEvent.change(screen.getByLabelText('As of'), { target: { value: day } })
    await userEvent.click(screen.getByRole('button', { name: 'Show' }))
  }

  it('opens Season and a date that stops at yesterday (camp time), with Show off until a day is picked', async () => {
    renderReport()
    await screen.findByRole('table', { name: 'Development report' })
    await userEvent.click(screen.getByRole('button', { name: 'Show As Of a Date…' }))
    const season = screen.getByLabelText('Season')
    expect(
      within(season)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['2027'])
    expect(screen.getByLabelText('As of')).toHaveAttribute('max', dayBefore(campToday()))
    expect(screen.getByRole('button', { name: 'Show' })).toBeDisabled()
  })

  it('refetches with the column and tags that column “not saved · gone when you leave”', async () => {
    renderReport()
    await show()
    expect(
      await screen.findByRole('columnheader', {
        name: /2027 as of Mar 9 · P · not saved · gone when you leave/,
      })
    ).toBeInTheDocument()
    expect(calls().some(([url]) => url?.includes('column=2027%3A2027-03-09'))).toBe(true)
    expect(
      screen.getAllByRole('columnheader').filter((h) => h.textContent.includes('not saved'))
    ).toHaveLength(1)
  })

  it('Remove drops the column, saves nothing, and puts nothing in the URL', async () => {
    renderReport()
    await show()
    await screen.findByRole('columnheader', { name: /not saved/ })
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/aid\/reports\/development$/)
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() =>
      expect(screen.queryByRole('columnheader', { name: /not saved/ })).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/aid\/reports\/development$/)
    expect(calls().filter(([, method]) => method !== 'GET')).toEqual([])
    expect(calls().some(([url]) => url?.includes('/columns'))).toBe(false)
  })

  it('is gone when the page is left: a fresh mount shows no column', async () => {
    const first = renderReport()
    await show()
    await screen.findByRole('columnheader', { name: /not saved/ })
    first.unmount()
    renderReport()
    await screen.findByRole('table', { name: 'Development report' })
    expect(screen.queryByRole('columnheader', { name: /not saved/ })).not.toBeInTheDocument()
  })

  it("shows the server's refusal sentence, in amber, and keeps the typing", async () => {
    columnAnswer = () => json({ detail: 'A dated column needs a day already past' }, 422)
    renderReport()
    await show('2027-06-02')
    const note = await screen.findByText(/A dated column needs a day already past/)
    expect(note).toHaveClass('text-amber-700')
    expect(screen.getByLabelText('As of')).toHaveValue('2027-06-02')
  })
})
