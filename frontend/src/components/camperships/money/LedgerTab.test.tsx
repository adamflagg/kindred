/** Money › Ledger's posted totals (F10; money-v2's pivot; R3-2), through the real hooks. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidSummary } from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import { LedgerTab } from './LedgerTab'
import { RULES_2027, SUMMARY, SUMMARY_PAST, SUMMARY_UNCLASSIFIED } from './ledgerFixtures'

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
vi.mock('../shell/AidDefinitionNotes', () => ({
  AidDefinitionNotes: ({ surface }: { surface: string }) => <p>{`Notes for ${surface}`}</p>,
}))

let summary: ApiAidSummary = SUMMARY
let fetchSpy: MockInstance<typeof fetch>

beforeEach(() => {
  summary = SUMMARY
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-06-03T18:00:00Z'))
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const body = String(url).includes('/rules/') ? RULES_2027 : summary
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  })
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

function renderTab(path: string, view: AidView) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <LedgerTab view={view} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const rowOf = (words: string) => {
  const row = screen.getAllByText(words)[0]?.closest('tr')
  if (row === null || row === undefined) throw new Error(`no row for ${words}`)
  return row
}

describe('Money › Ledger (§8.1; F10 as money-v2 draws it)', () => {
  it("draws camp aid, outside grants and the total per program, in the rules' words and order", async () => {
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    expect(screen.getByText(/One row per family comes in the next update/)).toBeInTheDocument()
    await screen.findAllByText('Summer Sessions')
    for (const header of ['Program', 'Camp aid (net)', 'Outside grants', 'Total']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument()
    }
    expect(screen.queryByRole('columnheader', { name: 'Unclassified' })).toBeNull()
    const summer = rowOf('Summer Sessions')
    for (const figure of ['$541,200', '$98,400', '$639,600']) {
      expect(within(summer).getByText(figure)).toBeInTheDocument()
    }
    // The server's footer, never a sum of the rows on screen.
    const foot = rowOf('All programs')
    for (const figure of ['$599,500', '$135,000', '$734,500']) {
      expect(within(foot).getByText(figure)).toBeInTheDocument()
    }
    expect(
      screen.getByText(
        'Counts toward the budget: $612,540 · placed on a request: 91% · at household level: 7% · not placed: 2% (each share of camp aid). Undated postings: 0.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/A split placement still counts/)).toBeNull()
    expect(screen.getByText('Notes for money-ledger')).toBeInTheDocument()
    // The footer is the season's, from the server: a search narrows the rows, never the footer.
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'Summer')
    expect(screen.queryByText('Family Camp Weekends')).toBeNull()
    expect(within(rowOf('All programs')).getByText('$599,500')).toBeInTheDocument()
  })

  it('shows an Unclassified column only for a season with an unclassified line', async () => {
    summary = SUMMARY_UNCLASSIFIED
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    expect(await screen.findByRole('columnheader', { name: 'Unclassified' })).toBeInTheDocument()
    expect(within(rowOf('All programs')).getByText('$734,900')).toBeInTheDocument()
  })

  it('on a past day: says the day, the split line and the axis note; folds', async () => {
    summary = SUMMARY_PAST
    renderTab('/aid/money/ledger?as_of=2027-05-01&as_of_axis=recorded', {
      year: 2027,
      asOf: { kind: 'past', date: '2027-05-01', axis: 'recorded' },
    })
    expect(screen.getByText('as of May 1, 2027 · all families')).toBeInTheDocument()
    expect(await screen.findByText(/^A split placement still counts/)).toBeInTheDocument()
    expect(screen.getByText(/Undated postings: 2\.$/)).toBeInTheDocument()
    expect(screen.getByText(/they have no "as recorded" view/)).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: /Posted in CampMinder by program and source/ })
    )
    expect(screen.queryByText('$541,200')).toBeNull()
  })
})
