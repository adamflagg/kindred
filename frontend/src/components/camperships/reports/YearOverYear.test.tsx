/** Statistics › Year over year through its real hooks (spec §9.7; S4-2). Only `fetch` is faked. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { CS_CARD_HEADING } from '../kit/csType'
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
let committee = COMMITTEE
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const committeeCalls = () =>
  fetchSpy.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/committee'))

beforeEach(() => {
  committee = COMMITTEE
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((url) =>
      Promise.resolve(
        String(url).includes('/definitions')
          ? json({ surface: 'reports-committee', notes: [] })
          : json(committee)
      )
    )
})
afterEach(() => fetchSpy.mockRestore())

function Where() {
  const { search } = useLocation()
  return <div data-testid="where">{search}</div>
}

function renderView(path = '/aid/reports/year-over-year') {
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
  it('draws the five tables from one read', async () => {
    renderView()
    const phases = await screen.findByRole('table', {
      name: 'Round 1 phases, year over year',
    })
    expect(within(phases).getByText('2027 · P · to date')).toBeInTheDocument()
    for (const name of [
      'Applications and Round 1 ask at the cutoff',
      'Budget against actuals by pool',
      'Applications and appeals',
      '% of ask awarded in Round 1',
    ]) {
      expect(screen.getByRole('table', { name })).toBeInTheDocument()
    }
    expect(committeeCalls()).toHaveLength(1)
  })

  it("puts the band words under the first phase's %, and draws the add-up check only when non-zero", async () => {
    renderView()
    const phases = await screen.findByRole('table', {
      name: 'Round 1 phases, year over year',
    })
    expect(
      within(phases)
        .getAllByRole('columnheader')
        .filter((h) => h.textContent === 'End of season')
    ).toHaveLength(4)
    expect(within(phases).getByText('51–55%: above')).toBeInTheDocument()
    expect(screen.getByText('Total − Σ phases: 2026 $10,000')).toBeInTheDocument()
  })

  it('draws no add-up check when every season adds up', async () => {
    committee = {
      ...COMMITTEE,
      phases: COMMITTEE.phases.map((row) => ({ ...row, reconciliation: 0 })),
    }
    renderView()
    await screen.findByRole('table', { name: 'Round 1 phases, year over year' })
    expect(screen.queryByText(/Total − Σ phases/)).toBeNull()
  })

  it('draws the phases switch as separate pills, the chosen one in forest', async () => {
    renderView()
    await screen.findByRole('table', { name: 'Round 1 phases, year over year' })
    const on = screen.getByRole('button', { name: '% of budget' })
    const off = screen.getByRole('button', { name: 'Share of the phases' })
    expect(on.className).toContain('rounded-full')
    expect(off.className).toContain('rounded-full')
    expect(on.className).toContain('bg-forest-700')
    expect(off.className).not.toContain('bg-forest-700')
  })

  it('switches the phases to their share in the URL, without reading again', async () => {
    renderView()
    await screen.findByRole('table', { name: 'Round 1 phases, year over year' })
    await userEvent.click(screen.getByRole('button', { name: 'Share of the phases' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?phases=share')
    expect(screen.getAllByText('66.7%').length).toBeGreaterThan(0)
    expect(committeeCalls()).toHaveLength(1)
  })

  it("moves this season's cutoff with a received-through date; there is no deadline switch", async () => {
    renderView()
    await screen.findByRole('table', { name: 'Round 1 phases, year over year' })
    expect(screen.queryByRole('checkbox', { name: 'Through the Round 1 deadline' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Received through'), { target: { value: '2027-02-15' } })
    await waitFor(() =>
      expect(committeeCalls().at(-1)).toBe(
        '/api/financial-aid/reports/2027/committee?received_through=2027-02-15'
      )
    )
  })
})

describe('YearOverYear: words and type (R4)', () => {
  it('prints no RPT-, D-number or O-930 id and no "Not built yet" line', async () => {
    renderView()
    await screen.findByRole('table', { name: 'Round 1 phases, year over year' })
    expect(document.body.textContent).not.toMatch(/\bRPT-\d|\bD\d{2,3}\b|O-930/)
    expect(screen.queryByText(/Not built yet/)).toBeNull()
  })

  it('sets every table heading in the sans card heading, not the display serif', async () => {
    renderView()
    await screen.findByRole('table', { name: 'Round 1 phases, year over year' })
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings.length).toBeGreaterThanOrEqual(5)
    for (const h of headings) {
      expect(h.className).toContain(CS_CARD_HEADING)
      expect(h.className).not.toContain('font-display')
    }
  })
})
