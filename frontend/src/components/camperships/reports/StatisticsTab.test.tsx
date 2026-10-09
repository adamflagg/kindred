/**
 * Reports › Statistics, this season, through its real hooks (spec §9.2; RPT-10, 22, 9, 23; D80, D130,
 * D138, D157; slice 4 J, K, L): the chips and the reporting controls in the URL, the tables as sent,
 * the request-set and past-date lines, the count links, and a refusal shown in the server's words.
 * Only `fetch` is faked.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { PROGRAMS } from './programsFixtures'
import {
  STATISTICS,
  STATISTICS_ALL_TABLES,
  STATISTICS_PAST,
  STATISTICS_THROUGH,
} from './statisticsFixtures'
import { StatisticsTab } from './StatisticsTab'

vi.mock('../../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
let granted: string[] = []
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

const VIEW = { year: 2027, asOf: { kind: 'live' } as const }
const NOTES = {
  surface: 'reports-statistics',
  notes: [
    { key: 'apps', n: 1, text: 'Apps: every received request.' },
    { key: 'awarded', n: 3, text: 'Awarded: Posted.' },
  ],
}

let statistics: (url: string) => Response
let programs: unknown
let fetchSpy: MockInstance<typeof fetch>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const statisticsCalls = () =>
  fetchSpy.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/statistics'))
/** The Requests link a count carries: its address in `?report=`, the season after it (aidHref). */
const requestsLink = (address: string) =>
  `/aid/requests?${new URLSearchParams({ report: address, year: '2027' }).toString()}`

beforeEach(() => {
  granted = ['financial_aid.view']
  statistics = () => json(STATISTICS)
  programs = PROGRAMS
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-10T18:00:00Z'))
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const text = String(url)
    if (text.includes('/definitions')) {
      return Promise.resolve(
        json(
          text.includes('reports-programs')
            ? {
                surface: 'reports-programs',
                notes: [{ key: 'apps', n: 1, text: 'Programs note.' }],
              }
            : NOTES
        )
      )
    }
    if (text.includes('/programs')) return Promise.resolve(json(programs))
    return Promise.resolve(statistics(text))
  })
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

function Where() {
  const { search } = useLocation()
  return <div data-testid="where">{search}</div>
}

function renderTab(path = '/aid/reports/statistics') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <StatisticsTab view={VIEW} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('StatisticsTab (spec §9.2)', () => {
  it("draws the tier table and the server's total, with the cancelled applicants' line (D131)", async () => {
    renderTab()
    const table = await screen.findByRole('table', { name: 'By tier' })
    expect(within(table).getByText('$27,000')).toBeInTheDocument()
    expect(within(table).getByText('Table A · Round 1')).toBeInTheDocument()
    expect(
      screen.getByText(/Cancelled applicants \(counted in Apps too, and on their own line here\):/)
    ).toBeInTheDocument()
    expect(screen.getByText('Apps: every received request.')).toBeInTheDocument()
  })

  it("offers the rules' award tables as chips, with All award tables first (RPT-10)", async () => {
    renderTab()
    await screen.findByRole('table', { name: 'By tier' })
    const chips = ['All award tables', 'Table A', 'Table B'].map((name) =>
      screen.getByRole('button', { name })
    )
    expect(chips).toHaveLength(3)
  })

  it('puts the chips below the reporting controls, as the mock orders them', async () => {
    renderTab()
    await screen.findByRole('table', { name: 'By tier' })
    const controls = screen.getByLabelText('Received through')
    const chip = screen.getByRole('button', { name: 'Table A' })
    expect(controls.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('draws the chips as separate rounded pills, the chosen one in forest', async () => {
    renderTab('/aid/reports/statistics?table=camp')
    await screen.findByRole('table', { name: 'By tier' })
    const on = screen.getByRole('button', { name: 'R1' })
    const off = screen.getByRole('button', { name: 'R2' })
    expect(on.className).toContain('rounded-full')
    expect(off.className).toContain('rounded-full')
    expect(on.className).toContain('bg-forest-700')
    expect(off.className).not.toContain('bg-forest-700')
    expect(off.className).toContain('bg-card')
  })

  it("divides the band columns from the figures at the tier table's Apps", async () => {
    renderTab()
    const table = await screen.findByRole('table', { name: 'By tier' })
    expect(within(table).getByRole('columnheader', { name: /^Apps/ }).className).toContain(
      'border-l'
    )
    expect(within(table).getByRole('columnheader', { name: 'Asked' }).className).not.toContain(
      'border-l'
    )
  })

  it('keeps the chips in the URL and reads the table and round the user picked', async () => {
    renderTab()
    await screen.findByRole('table', { name: 'By tier' })
    await userEvent.click(screen.getByRole('button', { name: 'Table B' }))
    await userEvent.click(screen.getByRole('button', { name: 'All rounds' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?table=family&round=all')
    await waitFor(() =>
      expect(statisticsCalls().at(-1)).toBe(
        '/api/financial-aid/reports/2027/statistics?table=family&round=all'
      )
    )
  })

  it('says "varies" for the fee % on All award tables', async () => {
    statistics = () => json(STATISTICS_ALL_TABLES)
    renderTab()
    const table = await screen.findByRole('table', { name: 'By tier' })
    expect(within(table).getAllByText('varies')).toHaveLength(2)
  })

  it('labels every figure when a link carries a reporting control (D138)', async () => {
    statistics = () => json(STATISTICS_THROUGH)
    renderTab('/aid/reports/statistics?through=2027-02-01')
    expect(
      await screen.findByText(
        /Every figure below counts only requests received through Feb 1, 2027/
      )
    ).toBeInTheDocument()
    expect(statisticsCalls()[0]).toContain('received_through=2027-02-01')
  })

  it('says a past date never estimates (D154)', async () => {
    statistics = () => json(STATISTICS_PAST)
    renderTab()
    expect(await screen.findByText(/never an estimate/)).toBeInTheDocument()
  })

  it('keeps what loaded when a refetch fails (owner ruling Group 5)', async () => {
    let calls = 0
    statistics = () => {
      calls += 1
      return calls === 1 ? json(STATISTICS) : json({ detail: 'boom' }, 500)
    }
    // The hook retries a dropped connection (`reportRetry`); no delay here, so the retries run at once.
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/aid/reports/statistics']}>
          <StatisticsTab view={VIEW} />
        </MemoryRouter>
      </QueryClientProvider>
    )
    await screen.findByRole('table', { name: 'By tier' })
    await client.invalidateQueries({ queryKey: ['financial-aid', 'reports'] })
    await waitFor(() => expect(calls).toBeGreaterThan(1))
    expect(screen.getByRole('table', { name: 'By tier' })).toBeInTheDocument()
    expect(screen.queryByText(/Failed to load/)).toBeNull()
  })
})

describe('StatisticsTab: the reporting controls and the three tables (D129, D130, D138)', () => {
  it('keeps the controls in the URL, off by default, and sends what they say (S4-3)', async () => {
    renderTab()
    await screen.findByRole('table', { name: 'Aid recipients who cancelled' })
    expect(screen.getByRole('checkbox', { name: 'Include not yet offered' })).not.toBeChecked()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include not yet offered' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Through the Round 1 deadline' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?decided=1&through=deadline')
    await waitFor(() =>
      expect(statisticsCalls().at(-1)).toBe(
        '/api/financial-aid/reports/2027/statistics?round=1&basis=posted_and_decided&through_round1_deadline=true'
      )
    )
    expect(screen.getByLabelText('Received through')).toBeDisabled()
  })

  it('draws recipients who cancelled, RPT-9 and RPT-23 from the same read', async () => {
    renderTab()
    expect(await screen.findByText('Withdrawn in the dashboard')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Round 1 and appeals by tier' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'March committee outcomes' })).toBeInTheDocument()
    expect(screen.getByText('As of Apr 10, 2027 (live) · rules v3')).toBeInTheDocument()
  })

  it('keeps the controls after a refusal, so the user can turn the control off', async () => {
    statistics = (url) =>
      url.includes('through_round1_deadline')
        ? json({ detail: 'The reporting controls work from 2027.' }, 422)
        : json(STATISTICS)
    renderTab('/aid/reports/statistics?through=deadline')
    expect(await screen.findByText('The reporting controls work from 2027.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'R2' })).toBeInTheDocument()
    expect(screen.getByText('Nothing to show for these choices.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Through the Round 1 deadline' }))
    expect(await screen.findByText('Table A · Round 1')).toBeInTheDocument()
    expect(screen.queryByText('The reporting controls work from 2027.')).toBeNull()
  })
})

describe('StatisticsTab: every count opens its requests (slice 4 J; D20)', () => {
  it("opens a tier's Apps in Requests on exactly that count's address", async () => {
    renderTab('/aid/reports/statistics?table=camp')
    const table = await screen.findByRole('table', { name: 'By tier' })
    expect(within(table).getAllByRole('link', { name: '12' })[0]).toHaveAttribute(
      'href',
      requestsLink('statistics?table=camp&round=1&part=tier&tier=1&count=apps')
    )
  })

  it("opens RPT-23's Waiting for a response too, which no grid filter could hold before (#2974)", async () => {
    renderTab()
    const table = await screen.findByRole('table', { name: 'March committee outcomes' })
    const [poolA] = within(table).getAllByRole('row').slice(1)
    expect(within(poolA!).getByRole('link', { name: '1' })).toHaveAttribute(
      'href',
      requestsLink('statistics?round=1&part=outcome&outcome_row=pool&pool=pool_a&outcome=waiting')
    )
  })

  it('keeps every count a link under a reporting control, carrying the control (the ids match the figure)', async () => {
    statistics = () => json(STATISTICS_THROUGH)
    renderTab('/aid/reports/statistics?through=2027-02-01')
    const table = await screen.findByRole('table', { name: 'March committee outcomes' })
    expect(within(table).getAllByRole('link', { name: '9' })[0]).toHaveAttribute(
      'href',
      requestsLink(
        'statistics?round=1&received_through=2027-02-01&part=outcome&outcome_row=pool&pool=pool_a&outcome=accepted'
      )
    )
  })

  it("opens RPT-9's Round 1 apps and appeals on exactly that count's address, with no 'counts don't open' note", async () => {
    renderTab('/aid/reports/statistics?table=camp')
    const table = await screen.findByRole('table', { name: 'Round 1 and appeals by tier' })
    const links = within(table).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      requestsLink(
        'statistics?table=camp&round=1&part=tier_appeals&tier=1&appeals_count=round1_apps'
      ),
      requestsLink('statistics?table=camp&round=1&part=tier_appeals&tier=1&appeals_count=appeals'),
      requestsLink('statistics?table=camp&round=1&part=total_appeals&appeals_count=round1_apps'),
      requestsLink('statistics?table=camp&round=1&part=total_appeals&appeals_count=appeals'),
    ])
    expect(screen.queryByText(/counts don't open/)).toBeNull()
  })
})

describe('StatisticsTab: Rows, Income tier | Session (owner Q7)', () => {
  const chipLabels = () =>
    Array.from(document.querySelectorAll('button.rounded-full')).map((b) => b.textContent)

  it('puts Rows first, then Income tier and Session, before the award table and round chips', async () => {
    renderTab()
    await screen.findByRole('table', { name: 'By tier' })
    expect(chipLabels()).toEqual([
      'Income tier',
      'Session',
      'All award tables',
      'Table A',
      'Table B',
      'R1',
      'R2',
      'R3',
      'All rounds',
    ])
    const rows = screen.getByText('Rows')
    expect(rows.compareDocumentPosition(screen.getByText('Award table'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  })

  it('shows the session table instead of By tier, with the rounds note and no tier-only chips', async () => {
    renderTab('/aid/reports/statistics?rows=session')
    expect(await screen.findByRole('table', { name: 'By session' })).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'By tier' })).toBeNull()
    expect(
      screen.getByText('Rounds 1, 2 and 3 are columns in the session table')
    ).toBeInTheDocument()
    expect(chipLabels()).toEqual(['Income tier', 'Session'])
    expect(screen.queryByRole('checkbox', { name: 'Include not yet offered' })).toBeNull()
  })

  it('keeps the cancelled line, recipients who cancelled, RPT-9 and March outcomes under Session', async () => {
    renderTab('/aid/reports/statistics?rows=session')
    await screen.findByRole('table', { name: 'By session' })
    expect(screen.getByText(/Cancelled applicants \(counted in Apps too/)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /Aid recipients who cancelled/ })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /Round 1 and appeals by tier/ })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /March committee outcomes/ })).toBeInTheDocument()
  })

  it('clears table, round and decided when Session is chosen, and Income tier removes rows', async () => {
    renderTab('/aid/reports/statistics?table=camp&round=2&decided=1&through=deadline')
    await screen.findByRole('table', { name: 'By tier' })
    await userEvent.click(screen.getByRole('button', { name: 'Session' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?through=deadline&rows=session')
    await userEvent.click(screen.getByRole('button', { name: 'Income tier' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?through=deadline')
    expect(screen.getByTestId('where')).not.toHaveTextContent('rows')
  })

  it("numbers the session table's columns from the statistics notes: one list, at the foot", async () => {
    renderTab('/aid/reports/statistics?rows=session')
    const table = await screen.findByRole('table', { name: 'By session' })
    expect(await screen.findAllByText('Apps: every received request.')).toHaveLength(1)
    expect(screen.queryByText('Programs note.')).toBeNull()
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('reports-programs'))).toBe(
      false
    )
    // the session table's superscripts are the foot list's own numbers (Apps 1, Awarded 3)
    const marks = Array.from(table.querySelectorAll('sup')).map((sup) => sup.textContent)
    expect(marks).toContain('1')
    expect(marks).toContain('3')
    const stats = screen.getByText('Apps: every received request.')
    const below = screen.getByRole('heading', { name: /^Aid recipients who cancelled/ })
    expect(below.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says the request set and the past-date rule once under Session, though both reads carry them', async () => {
    statistics = () => json({ ...STATISTICS_THROUGH, not_rebuilt: STATISTICS_PAST.not_rebuilt })
    programs = {
      ...PROGRAMS,
      request_set: STATISTICS_THROUGH.request_set,
      not_rebuilt: STATISTICS_PAST.not_rebuilt,
    }
    renderTab('/aid/reports/statistics?rows=session&through=2027-02-01')
    await screen.findByRole('table', { name: 'By session' })
    expect(screen.getAllByText(/Every figure below counts only/)).toHaveLength(1)
    expect(screen.getAllByText(/never an estimate/)).toHaveLength(1)
  })

  it('shows only the statistics notes under Income tier', async () => {
    renderTab('/aid/reports/statistics')
    expect(await screen.findByText('Apps: every received request.')).toBeInTheDocument()
    expect(screen.queryByText('Programs note.')).toBeNull()
  })

  it('applies the reporting controls to the session table too (D138)', async () => {
    renderTab('/aid/reports/statistics?rows=session')
    await screen.findByRole('table', { name: 'By session' })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Through the Round 1 deadline' }))
    expect(screen.getByTestId('where')).toHaveTextContent('through=deadline')
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls
          .map(([u]) => String(u))
          .filter((u) => u.includes('/programs'))
          .at(-1)
      ).toBe('/api/financial-aid/reports/2027/programs?through_round1_deadline=true')
    )
  })
})

describe('StatisticsTab: our words carry no internal ids (R4)', () => {
  const CODES = /\bRPT-\d|\bD\d{2,3}\b|O-930/

  it.each(['/aid/reports/statistics', '/aid/reports/statistics?rows=session'])(
    'prints no RPT-, D-number or O-930 id on %s',
    async (path) => {
      renderTab(path)
      await screen.findByRole('table', { name: /Aid recipients who cancelled/ })
      expect(document.body.textContent).not.toMatch(CODES)
    }
  )

  it('heads the award count "Awards", never "Awards (camp aid)"', async () => {
    renderTab()
    const table = await screen.findByRole('table', { name: 'By tier' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent)
    ).not.toContain('Awards (camp aid)')
    expect(screen.queryByText(/Awards \(camp aid\)/)).toBeNull()
  })
})
