/** Money › Ledger's posted totals (F10; money-v2's pivot; R3-2), through the real hooks. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidBudget, ApiAidSummary } from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import { BUDGET } from '../season/budgetFixtures'
import { TO_PLACE } from './toPlaceFixtures'
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
  AidDefinitionNotes: ({ surface, extra = [] }: { surface: string; extra?: readonly string[] }) => (
    <div>
      <p>{`Notes for ${surface}`}</p>
      {extra.map((text) => (
        <p key={text}>{text}</p>
      ))}
    </div>
  ),
}))
// The family rows have their own tests (LedgerFamilies.test.tsx, LedgerLines.test.tsx).
vi.mock('./LedgerFamilies', () => ({
  LedgerFamilies: ({
    unclassified,
    programLabels,
  }: {
    unclassified?: number | null
    programLabels?: Record<string, string>
  }) => (
    <div>
      Family rows<span data-testid="unclassified-prop">{String(unclassified)}</span>
      <span data-testid="labels-prop">{JSON.stringify(programLabels)}</span>
    </div>
  ),
}))

let summary: ApiAidSummary = SUMMARY
const budgetPosting = (posted: number): ApiAidBudget => ({
  ...BUDGET,
  total: { ...BUDGET.total, total: { ...BUDGET.total.total, posted } },
})
let budget: ApiAidBudget = budgetPosting(SUMMARY.counts_toward_budget)
let budgetStatus = 200
let fetchSpy: MockInstance<typeof fetch>

beforeEach(() => {
  summary = SUMMARY
  budget = budgetPosting(SUMMARY.counts_toward_budget)
  budgetStatus = 200
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-06-03T18:00:00Z'))
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const u = String(url)
    if (u.includes('/budget')) {
      return Promise.resolve(new Response(JSON.stringify(budget), { status: budgetStatus }))
    }
    if (u.includes('/to-place')) {
      return Promise.resolve(new Response(JSON.stringify(TO_PLACE), { status: 200 }))
    }
    const body = u.includes('/rules/') ? RULES_2027 : summary
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
  it("shows the family rows, then camp aid, outside grants and the total per program, in the rules' words and order", async () => {
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    expect(screen.getByText('Family rows')).toBeInTheDocument()
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
        'Counts toward the budget: $612,540 · placed on a camper or request: 91% · at household level: 7% · not placed: 2% (each share of camp aid). Undated postings: 0.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/A split placement still counts/)).toBeNull()
    expect(screen.getByText('Notes for money-ledger')).toBeInTheDocument()
    expect(
      screen.getByText(/^The tie-out line: camp aid in CampMinder that counts toward the budget/)
    ).toBeInTheDocument()
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

  it("shows each pivot row's program_label, and the bucket words where the server sends none", async () => {
    const BASE_ROW = SUMMARY.by_program?.[0]
    if (BASE_ROW === undefined) throw new Error('fixture')
    summary = {
      ...SUMMARY,
      by_program: [
        ...(SUMMARY.by_program ?? []),
        { ...BASE_ROW, program: 'quest', program_label: 'Session 3' },
        { ...BASE_ROW, program: 'teen' },
      ],
    }
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    await screen.findByText('Session 3')
    expect(screen.getByText('Household level')).toBeInTheDocument()
    expect(screen.getByText('Not placed')).toBeInTheDocument()
    expect(screen.getByText('Other program')).toBeInTheDocument()
    expect(screen.queryByText(/^Teen$|^Quest$/)).toBeNull()
  })

  it("hands the family rows the summary's labels by program", async () => {
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    await waitFor(() => expect(screen.getByTestId('labels-prop')).toHaveTextContent('summer'))
    expect(JSON.parse(screen.getByTestId('labels-prop').textContent)).toEqual({
      summer: 'Summer Sessions',
      family_camp: 'Family Camp Weekends',
    })
  })

  it("hands the family rows the summary's unclassified figure, never a sum", async () => {
    summary = SUMMARY_UNCLASSIFIED
    renderTab('/aid/money/ledger', { year: 2027, asOf: { kind: 'live' } })
    await screen.findByRole('columnheader', { name: 'Unclassified' })
    expect(screen.getByTestId('unclassified-prop')).toHaveTextContent('400')
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

  describe('the tie-out line', () => {
    const live: AidView = { year: 2027, asOf: { kind: 'live' } }

    it('shows a check and a link to Rounds & budget when the figures match', async () => {
      renderTab('/aid/money/ledger', live)
      const line = await screen.findByTestId('tie-out')
      expect(line).toHaveTextContent(
        'Camp aid posted $612,540 · matches Season › Rounds & budget Posted $612,540 ✓'
      )
      const link = within(line).getByRole('link', { name: /Rounds & budget/ })
      expect(link.getAttribute('href')).toMatch(/^\/aid\/season\/rounds-budget/)
      // It sits after the family rows and before the folding table.
      const html = document.body.innerHTML
      expect(html.indexOf('Family rows')).toBeLessThan(html.indexOf('data-testid="tie-out"'))
      expect(html.indexOf('data-testid="tie-out"')).toBeLessThan(
        html.indexOf('Posted in CampMinder by program and source')
      )
    })

    it('shows the gap and To place with its open count when the figures differ', async () => {
      budget = budgetPosting(600000)
      renderTab('/aid/money/ledger', live)
      const line = await screen.findByTestId('tie-out')
      await waitFor(() =>
        expect(line).toHaveTextContent(
          `Camp aid posted $612,540 · Season › Rounds & budget Posted $600,000 · $12,540 apart · see To place (${String(TO_PLACE.open_count)} lines)`
        )
      )
      expect(line).not.toHaveTextContent('✓')
      const link = within(line).getByRole('link', { name: /see To place/ })
      expect(link.getAttribute('href')).toMatch(/^\/aid\/money\/to-place/)
    })

    it('shows nothing while the budget is loading, and nothing when it fails', async () => {
      budgetStatus = 500
      renderTab('/aid/money/ledger', live)
      await screen.findAllByText('Summer Sessions')
      await waitFor(() =>
        expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('/budget'))).toBe(true)
      )
      expect(screen.queryByTestId('tie-out')).toBeNull()
    })

    it('reads the budget with the signed-in token', async () => {
      renderTab('/aid/money/ledger', live)
      await screen.findByTestId('tie-out')
      const call = fetchSpy.mock.calls.find(([u]) => String(u).includes('/budget'))
      const headers = new Headers((call?.[1] as RequestInit | undefined)?.headers)
      expect(headers.get('Authorization')).toBe('Bearer test-jwt')
    })
  })
})
