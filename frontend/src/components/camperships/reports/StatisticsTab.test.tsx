/**
 * Reports › Statistics, this season, through its real hooks (spec §9.2; RPT-10, 22, 9, 23; D80, D130,
 * D138, D157; slice 4 J, K, L): the chips and the reporting controls in the URL, the tables as sent,
 * the request-set and past-date lines, the count links, and a refusal shown in the server's words.
 * Only `fetch` is faked.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { CS_RULE_GROUP } from '../kit/kitStyles'
import { PROGRAMS_TWO_POOLS } from './programsFixtures'
import {
  STATISTICS,
  STATISTICS_ALL_TABLES,
  STATISTICS_PAST,
  STATISTICS_THROUGH,
} from './statisticsFixtures'
import { StatisticsTab } from './StatisticsTab'

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
let granted: string[] = []
let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

const VIEW = { year: 2027, asOf: { kind: 'live' } as const }
const NOTES = {
  surface: 'reports-statistics',
  notes: [
    { key: 'apps', n: 1, text: 'Apps: every received request.' },
    { key: 'awarded', n: 2, text: 'Awarded: Posted.' },
    { key: 'decided_not_offered', n: 6, text: 'Not yet offered: decided but not posted.' },
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
  writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  downloadCsv.mockClear()
  granted = ['financial_aid.view']
  statistics = () => json(STATISTICS)
  programs = PROGRAMS_TWO_POOLS
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

const toolbar = () => screen.getByTestId('aid-toolbar')
const picker = () => within(toolbar()).getByRole('button', { name: /^Requests: / })

describe('StatisticsTab (spec §9.2; approved final mock reports-statistics.html)', () => {
  it("draws the tier table headless, with the server's total spanning its label and the P badge on it", async () => {
    renderTab()
    const table = await screen.findByRole('table', { name: 'By tier' })
    expect(within(table).getByText('$27,000')).toBeInTheDocument()
    const label = within(table).getByText('Table A · Round 1')
    expect(label.closest('td')).toHaveAttribute('colspan', '4')
    expect(within(label.closest('td') as HTMLElement).getByText('P')).toBeInTheDocument()
    // no heading row of its own: its Copy and CSV are on the controls row
    expect(screen.queryByRole('heading', { name: 'By tier' })).toBeNull()
    expect(screen.getByText('Apps: every received request.')).toBeInTheDocument()
  })

  it('says none of the words the mock dropped: the controls box, the as-of line, the count footnote', async () => {
    renderTab()
    await screen.findByRole('table', { name: 'By tier' })
    expect(screen.queryByText(/Reporting controls/)).toBeNull()
    expect(screen.queryByText(/rules v3/)).toBeNull()
    expect(screen.queryByText(/Each count opens the requests behind it/)).toBeNull()
    expect(screen.queryByText(/Subtotals are pooled ratios/)).toBeNull()
  })

  it('puts Rows, Award table, Round, Requests, Include not yet offered, Copy and Download CSV on ONE row', async () => {
    renderTab()
    await screen.findByRole('table', { name: 'By tier' })
    const bar = toolbar()
    expect(bar).toHaveClass('flex-nowrap')
    for (const name of ['Rows', 'Award table', 'Round']) {
      expect(within(bar).getByRole('group', { name })).toBeInTheDocument()
    }
    expect(picker()).toBeInTheDocument()
    expect(
      within(bar).getByRole('checkbox', { name: 'Include not yet offered' })
    ).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Download CSV' })).toBeInTheDocument()
    const names = Array.from(bar.querySelectorAll('[role=group]')).map((g) =>
      g.getAttribute('aria-label')
    )
    expect(names).toEqual(['Rows', 'Award table', 'Round'])
  })

  it('offers All, then each rules award table as a segment titled with its full name', async () => {
    renderTab()
    await screen.findByRole('table', { name: 'By tier' })
    const group = screen.getByRole('group', { name: 'Award table' })
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => [b.textContent, b.title])
    ).toEqual([
      ['All', 'All award tables'],
      ['Table A', 'Table A'],
      ['Table B', 'Table B'],
    ])
    const rounds = screen.getByRole('group', { name: 'Round' })
    expect(
      within(rounds)
        .getAllByRole('button')
        .map((b) => [b.textContent, b.title])
    ).toEqual([
      ['R1', 'Round 1'],
      ['R2', 'Round 2 (appeals)'],
      ['R3', 'Round 3'],
      ['All', 'All rounds'],
    ])
  })

  it("divides the band columns from the figures at the tier table's Apps", async () => {
    renderTab()
    const table = await screen.findByRole('table', { name: 'By tier' })
    expect(within(table).getByRole('columnheader', { name: /^Apps/ }).className).toContain(
      CS_RULE_GROUP
    )
    expect(within(table).getByRole('columnheader', { name: 'Asked' }).className).not.toContain(
      CS_RULE_GROUP
    )
  })

  it('keeps the segments in the URL and reads the table and round the user picked', async () => {
    renderTab()
    await screen.findByRole('table', { name: 'By tier' })
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Award table' })).getByRole('button', {
        name: 'Table B',
      })
    )
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Round' })).getByRole('button', { name: 'All' })
    )
    expect(screen.getByTestId('where')).toHaveTextContent('?table=family&round=all')
    await waitFor(() =>
      expect(statisticsCalls().at(-1)).toBe(
        '/api/financial-aid/reports/2027/statistics?table=family&round=all'
      )
    )
  })

  it('says "varies" for the fee % on All award tables, muted, with what to do', async () => {
    statistics = () => json(STATISTICS_ALL_TABLES)
    renderTab()
    const table = await screen.findByRole('table', { name: 'By tier' })
    const varies = within(table).getAllByText('varies')
    expect(varies).toHaveLength(2)
    expect(varies[0]?.closest('td')).toHaveAttribute(
      'title',
      'Each award table sets its own fee share: pick one to see it'
    )
  })

  it("puts a request set in the total's label, and its words in the picker title (D138)", async () => {
    statistics = () => json(STATISTICS_THROUGH)
    renderTab('/aid/reports/statistics?through=2027-02-01')
    await screen.findByRole('table', { name: 'By tier' })
    expect(screen.getByText(/Table A · Round 1 · received through Feb 1, 2027/)).toBeInTheDocument()
    expect(statisticsCalls()[0]).toContain('received_through=2027-02-01')
    // The fixture holds 1 request with no received date: the retired sentence counted it, so the title does too.
    expect(picker()).toHaveAttribute(
      'title',
      'Which requests count: requests received through Feb 1, 2027 4 later requests left out, and 1 with no received date.'
    )
    expect(screen.queryByText(/Every figure below counts only/)).toBeNull()
  })

  it('says a past date never estimates in the controls row, not above the tables (D154)', async () => {
    statistics = () => json(STATISTICS_PAST)
    renderTab()
    const status = await screen.findByText(/never an estimate/)
    expect(toolbar().contains(status)).toBe(true)
    expect(status).toHaveAttribute('title', status.textContent)
  })

  it('keeps what loaded when a refetch fails (owner ruling Group 5)', async () => {
    let calls = 0
    statistics = () => {
      calls += 1
      return calls === 1 ? json(STATISTICS) : json({ detail: 'boom' }, 500)
    }
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

describe('StatisticsTab: Copy and Download CSV of the first table, on the controls row', () => {
  it('copies the By tier table to paste into a deck, and says so in the row', async () => {
    renderTab()
    await screen.findByRole('table', { name: 'By tier' })
    const copy = within(toolbar()).getByRole('button', { name: 'Copy' })
    expect(copy).toHaveAttribute('title', 'Copy the By tier table, to paste into a deck')
    await userEvent.click(copy)
    expect(writeText.mock.calls[0]?.[0]).toContain('Table A · Round 1')
    expect(writeText.mock.calls[0]?.[0].split('\n')[0]).toBe('By tier')
    expect(within(toolbar()).getByText('✓ Copied')).toBeInTheDocument()
  })

  it("downloads By tier's CSV with this view's link on its last line", async () => {
    renderTab('/aid/reports/statistics?table=camp')
    await screen.findByRole('table', { name: 'By tier' })
    const csv = within(toolbar()).getByRole('button', { name: 'Download CSV' })
    expect(csv).toHaveAttribute('title', "By tier · CSV, with this view's link on its last line")
    await userEvent.click(csv)
    const [content, name] = downloadCsv.mock.calls[0] ?? ['', '']
    expect(name).toContain('statistics-by-tier')
    expect(content).toContain('Link,/aid/reports/statistics?table=camp&year=2027')
  })
})

describe('StatisticsTab: the Requests picker and Include not yet offered (D129, D130, D138)', () => {
  it('keeps the controls in the URL, off by default, and sends what they say (S4-3)', async () => {
    renderTab()
    await screen.findByRole('table', { name: 'Aid recipients who cancelled' })
    expect(screen.getByRole('checkbox', { name: 'Include not yet offered' })).not.toBeChecked()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include not yet offered' }))
    await userEvent.click(picker())
    await userEvent.click(screen.getByRole('button', { name: 'Through the R1 deadline' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?decided=1&through=deadline')
    await waitFor(() =>
      expect(statisticsCalls().at(-1)).toBe(
        '/api/financial-aid/reports/2027/statistics?round=1&basis=posted_and_decided&through_round1_deadline=true'
      )
    )
    expect(picker()).toHaveAccessibleName('Requests: By the R1 deadline')
  })

  it('takes a received-through day from the picker, and clearing it returns to all requests', async () => {
    renderTab()
    await screen.findByRole('table', { name: 'By tier' })
    await userEvent.click(picker())
    fireEvent.change(screen.getByLabelText('Received through'), { target: { value: '2027-03-10' } })
    expect(screen.getByTestId('where')).toHaveTextContent('?through=2027-03-10')
    expect(picker()).toHaveAccessibleName('Requests: Through Mar 10')
    fireEvent.change(screen.getByLabelText('Received through'), { target: { value: '' } })
    expect(screen.getByTestId('where')).not.toHaveTextContent('through')
  })

  it('titles Include not yet offered with its note, and tints it amber while on', async () => {
    renderTab('/aid/reports/statistics?decided=1')
    await screen.findByRole('table', { name: 'By tier' })
    const label = screen.getByRole('checkbox', { name: 'Include not yet offered' }).closest('label')
    expect(label).toHaveAttribute('title', 'Not yet offered: decided but not posted.')
    expect(label?.className).toContain('text-amber-700')
  })

  it('draws recipients who cancelled, RPT-9 and RPT-23 from the same read, each with its heading row and description', async () => {
    renderTab()
    expect(await screen.findByText('Withdrawn in the dashboard')).toBeInTheDocument()
    for (const [name, words] of [
      ['Aid recipients who cancelled', /A request posted in two rounds is in two rows/],
      ['Round 1 and appeals by tier', /Each tier's appeals are counted at their Round 2 tier/],
      ['March committee outcomes', /The offers the March committee made/],
    ] as const) {
      const row = screen
        .getByRole('heading', { name: new RegExp(`^${name}`) })
        .closest('[data-testid=report-heading-row]')
      expect(within(row as HTMLElement).getByText(words)).toBeInTheDocument()
      expect(screen.getByRole('table', { name })).toBeInTheDocument()
    }
  })

  it('keeps the controls after a refusal, showing the sentence in the row, so the user can turn the control off', async () => {
    statistics = (url) =>
      url.includes('through_round1_deadline')
        ? json({ detail: 'The reporting controls work from 2027.' }, 422)
        : json(STATISTICS)
    renderTab('/aid/reports/statistics?through=deadline')
    const refusal = await screen.findByText('The reporting controls work from 2027.')
    expect(toolbar().contains(refusal)).toBe(true)
    expect(refusal.className).toContain('text-amber-700')
    expect(screen.getByRole('button', { name: 'R2' })).toBeInTheDocument()
    expect(screen.getByText('Nothing to show for these choices.')).toBeInTheDocument()
    await userEvent.click(picker())
    await userEvent.click(screen.getByRole('button', { name: 'All requests' }))
    expect(await screen.findByText('Table A · Round 1')).toBeInTheDocument()
    expect(screen.queryByText('The reporting controls work from 2027.')).toBeNull()
  })
})

describe('StatisticsTab: the cancelled applicants line and every count (slice 4 J; D20)', () => {
  it("opens a tier's Apps in Requests on exactly that count's address", async () => {
    renderTab('/aid/reports/statistics?table=camp')
    const table = await screen.findByRole('table', { name: 'By tier' })
    expect(within(table).getAllByRole('link', { name: '12' })[0]).toHaveAttribute(
      'href',
      requestsLink('statistics?table=camp&round=1&part=tier&tier=1&count=apps')
    )
  })

  it('says the cancelled applicants count in Apps too, with the link to them', async () => {
    renderTab('/aid/reports/statistics?table=camp')
    await screen.findByRole('table', { name: 'By tier' })
    const line = screen.getByText(/^Cancelled applicants, counted in Apps too:/)
    expect(within(line).getByRole('link', { name: '1' })).toHaveAttribute(
      'href',
      requestsLink('statistics?table=camp&round=1&part=total&count=cancelled')
    )
    expect(line.textContent).not.toContain('left out')
  })

  it('adds how many later requests are left out when the request set says so', async () => {
    statistics = () => json(STATISTICS_THROUGH)
    renderTab('/aid/reports/statistics?through=2027-02-01')
    await screen.findByRole('table', { name: 'By tier' })
    expect(
      screen.getByText(
        /Cancelled applicants, counted in Apps too:.*· 4 requests received later are left out/
      )
    ).toBeInTheDocument()
  })

  it("opens RPT-23's Waiting for a response too (#2974)", async () => {
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

  it("opens RPT-9's Round 1 apps and appeals on exactly that count's address", async () => {
    renderTab('/aid/reports/statistics?table=camp')
    const table = await screen.findByRole('table', { name: 'Round 1 and appeals by tier' })
    expect(
      within(table)
        .getAllByRole('link')
        .map((l) => l.getAttribute('href'))
    ).toEqual([
      requestsLink(
        'statistics?table=camp&round=1&part=tier_appeals&tier=1&appeals_count=round1_apps'
      ),
      requestsLink('statistics?table=camp&round=1&part=tier_appeals&tier=1&appeals_count=appeals'),
      requestsLink('statistics?table=camp&round=1&part=total_appeals&appeals_count=round1_apps'),
      requestsLink('statistics?table=camp&round=1&part=total_appeals&appeals_count=appeals'),
    ])
  })
})

describe('StatisticsTab: Rows, Income tier | Session — no control disappears', () => {
  const pressed = (group: string) =>
    within(screen.getByRole('group', { name: group }))
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.textContent)

  it('shows the session table, with Rows, Award table, Round, the picker and the checkbox all still there', async () => {
    renderTab('/aid/reports/statistics?rows=session')
    expect(await screen.findByRole('table', { name: 'By session' })).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'By tier' })).toBeNull()
    expect(pressed('Rows')).toEqual(['Session'])
    expect(screen.getByRole('group', { name: 'Award table' })).toBeInTheDocument()
    expect(picker()).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Include not yet offered' })).toBeInTheDocument()
    expect(screen.queryByText(/columns in the session table/)).toBeNull()
  })

  it('holds Round at All, R1 to R3 off with the words why', async () => {
    renderTab('/aid/reports/statistics?rows=session')
    await screen.findByRole('table', { name: 'By session' })
    expect(pressed('Round')).toEqual(['All'])
    const rounds = within(screen.getByRole('group', { name: 'Round' }))
    for (const name of ['R1', 'R2', 'R3']) {
      const button = rounds.getByRole('button', { name })
      expect(button).toBeDisabled()
      expect(button.title).toMatch(/^On Session rows every round is already a column block/)
    }
  })

  it('turns Include not yet offered off on Session, unchecked, and says why', async () => {
    renderTab('/aid/reports/statistics?rows=session&decided=1')
    await screen.findByRole('table', { name: 'By session' })
    const box = screen.getByRole('checkbox', { name: 'Include not yet offered' })
    expect(box).toBeDisabled()
    expect(box).not.toBeChecked()
    expect(box.closest('label')).toHaveAttribute(
      'title',
      "Not on Session rows yet: the session figures don't carry Decided amounts. Income tier rows have it."
    )
  })

  it("filters the session rows to the award table's pool, and the total to that pool", async () => {
    renderTab('/aid/reports/statistics?rows=session&table=family')
    const table = await screen.findByRole('table', { name: 'By session' })
    expect(within(table).getByText('Pool B')).toBeInTheDocument()
    expect(within(table).queryByText('Pool A')).toBeNull()
    expect(within(table).getByText('Table B')).toBeInTheDocument()
    expect(within(table).queryByText('All pools')).toBeNull()
  })

  it('keeps every pool and the all-pools total on All award tables', async () => {
    renderTab('/aid/reports/statistics?rows=session')
    const table = await screen.findByRole('table', { name: 'By session' })
    expect(within(table).getByText('Pool A')).toBeInTheDocument()
    expect(within(table).getByText('Pool B')).toBeInTheDocument()
    expect(within(table).getByText('All pools')).toBeInTheDocument()
    expect(within(table).getByText('2 sessions')).toBeInTheDocument()
  })

  it('marks a Family Camp session with a house and its household rule', async () => {
    renderTab('/aid/reports/statistics?rows=session')
    const table = await screen.findByRole('table', { name: 'By session' })
    const name = within(table).getByText('Family Camp 3: Young Families Weekend')
    expect(name.closest('td')).toHaveAttribute(
      'title',
      'Family Camp 3: Young Families Weekend · household requests: each app is a household'
    )
    expect(name.parentElement?.querySelector('svg')).not.toBeNull()
  })

  it('keeps the cancelled line, recipients who cancelled, RPT-9 and March outcomes under Session', async () => {
    renderTab('/aid/reports/statistics?rows=session')
    await screen.findByRole('table', { name: 'By session' })
    expect(screen.getByText(/Cancelled applicants, counted in Apps too/)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /Aid recipients who cancelled/ })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /Round 1 and appeals by tier/ })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /March committee outcomes/ })).toBeInTheDocument()
  })

  it('clears round and decided when Session is chosen, keeps the award table, and Income tier removes rows', async () => {
    renderTab('/aid/reports/statistics?table=camp&round=2&decided=1&through=deadline')
    await screen.findByRole('table', { name: 'By tier' })
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Rows' })).getByRole('button', { name: 'Session' })
    )
    expect(screen.getByTestId('where')).toHaveTextContent(
      '?table=camp&through=deadline&rows=session'
    )
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Rows' })).getByRole('button', {
        name: 'Income tier',
      })
    )
    expect(screen.getByTestId('where')).toHaveTextContent('?table=camp&through=deadline')
    expect(screen.getByTestId('where')).not.toHaveTextContent('rows')
  })

  it("numbers the session table's columns from the statistics notes: one list, at the foot", async () => {
    renderTab('/aid/reports/statistics?rows=session')
    const table = await screen.findByRole('table', { name: 'By session' })
    expect(await screen.findAllByText('Apps: every received request.')).toHaveLength(1)
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('reports-programs'))).toBe(
      false
    )
    const marks = Array.from(table.querySelectorAll('sup')).map((sup) => sup.textContent)
    expect(marks).toContain('1')
    expect(marks).toContain('2')
    const notes = screen.getByText('Apps: every received request.')
    const below = screen.getByRole('heading', { name: /^Aid recipients who cancelled/ })
    expect(below.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('reads the session table only on Session, and sends the request set (D138)', async () => {
    renderTab()
    await screen.findByRole('table', { name: 'By tier' })
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('/programs'))).toBe(false)
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Rows' })).getByRole('button', { name: 'Session' })
    )
    await userEvent.click(picker())
    await userEvent.click(screen.getByRole('button', { name: 'Through the R1 deadline' }))
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls
          .map(([u]) => String(u))
          .filter((u) => u.includes('/programs'))
          .at(-1)
      ).toBe('/api/financial-aid/reports/2027/programs?through_round1_deadline=true')
    )
  })

  it('copies By session from the controls row, full session names kept, and names it in its titles', async () => {
    renderTab('/aid/reports/statistics?rows=session&through=deadline')
    await screen.findByRole('table', { name: 'By session' })
    const copy = within(toolbar()).getByRole('button', { name: 'Copy' })
    expect(copy).toHaveAttribute('title', 'Copy the By session table, to paste into a deck')
    await userEvent.click(copy)
    expect(writeText.mock.calls[0]?.[0]).toContain('Family Camp 3: Young Families Weekend')
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'Download CSV' }))
    const [content] = downloadCsv.mock.calls[0] ?? ['']
    expect(content).toContain(
      'Link,/aid/reports/statistics?rows=session&through=deadline&year=2027'
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
  })
})
