/** Statistics › Year over year through its real hooks (spec §9.7; S4-2). Only `fetch` is faked. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { CS_CARD_HEADING } from '../kit/csType'
import { COMMITTEE } from './committeeFixtures'
import { YearOverYear } from './YearOverYear'

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
let committee = COMMITTEE
let committeeFor = null as ((url: string) => Response) | null
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const committeeCalls = () =>
  fetchSpy.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/committee'))

beforeEach(() => {
  downloadCsv.mockClear()
  committee = COMMITTEE
  committeeFor = null
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((url) =>
      Promise.resolve(
        String(url).includes('/definitions')
          ? json({ surface: 'reports-committee', notes: [] })
          : (committeeFor?.(String(url)) ?? json(committee))
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

const toolbar = () => screen.getByTestId('aid-toolbar')
const PHASES = 'Round 1 phases, year over year'
const CUTOFF = 'Applications and Round 1 ask at the cutoff'
const BUDGET = 'Budget against actuals by pool'
const APPEALS = 'Appeals and % of ask in Round 1'
const headingRow = (name: string) =>
  screen
    .getByRole('heading', { name: new RegExp(`^${name}`) })
    .closest('[data-testid=report-heading-row]') as HTMLElement

describe('YearOverYear (spec §9.7; approved final mock reports-yoy.html)', () => {
  it('draws the four tables from one read', async () => {
    renderView()
    const phases = await screen.findByRole('table', { name: PHASES })
    expect(within(phases).getByText('2027')).toBeInTheDocument()
    for (const name of [CUTOFF, BUDGET, APPEALS]) {
      expect(screen.getByRole('table', { name })).toBeInTheDocument()
    }
    expect(screen.getAllByRole('table')).toHaveLength(4)
    expect(screen.queryByRole('table', { name: 'Applications and appeals' })).toBeNull()
    expect(screen.queryByRole('table', { name: '% of ask awarded in Round 1' })).toBeNull()
    expect(committeeCalls()).toHaveLength(1)
  })

  it("puts each table's description inline on its heading row, with Copy and Download CSV", async () => {
    renderView()
    await screen.findByRole('table', { name: PHASES })
    for (const [name, words] of [
      [PHASES, 'how much went out by the deadline, after it, and in appeals'],
      [CUTOFF, 'all pools · By pool splits them'],
      [BUDGET, 'all pools, and this season by pool'],
      [APPEALS, "all pools · By pool splits this season's Round 1"],
    ] as const) {
      const row = headingRow(name)
      expect(within(row).getByText(words)).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /copy/i })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: /download csv/i })).toBeInTheDocument()
    }
  })

  it('has ONE controls row, with no reporting-controls box and none of the old sentences', async () => {
    renderView()
    await screen.findByRole('table', { name: PHASES })
    expect(screen.getAllByTestId('aid-toolbar')).toHaveLength(1)
    const text = document.body.textContent
    expect(text).not.toContain('Reporting controls')
    expect(text).not.toContain('off by default')
    expect(text).not.toContain("P = the dashboard's Posted; r = as reported, typed once")
    expect(text).not.toContain('Applications are counted at the Round 1 deadline unless')
    expect(text).not.toContain('Phases shown as')
  })

  it('draws no table footnote paragraphs: the add-up and cutoff lines are the only lines under a table', async () => {
    renderView()
    await screen.findByRole('table', { name: PHASES })
    const text = document.body.textContent
    expect(text).not.toContain('The band under a % compares')
    expect(text).not.toContain("Finance's appeals: requests with any")
    expect(text).not.toContain("The camp's own money only")
    expect(
      screen.getByText(/^Total − Σ phases: 2026 \$10,000\. The typed total is more than/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /^2026: the typed pools add up to 14 apps and \$38,000 less than the headline/
      )
    ).toBeInTheDocument()
  })

  it('draws no add-up check when every season adds up', async () => {
    committee = {
      ...COMMITTEE,
      phases: COMMITTEE.phases.map((row) => ({ ...row, reconciliation: 0 })),
    }
    renderView()
    await screen.findByRole('table', { name: PHASES })
    expect(screen.queryByText(/Total − Σ phases/)).toBeNull()
  })

  it('marks the band on one line in the % cell, the band in its title, none under the figure', async () => {
    renderView()
    const phases = await screen.findByRole('table', { name: PHASES })
    const cell = within(phases).getByText('60.0%', { exact: false, selector: 'td' })
    expect(cell.textContent).toBe('60.0%↑')
    expect(cell).toHaveAttribute('title', expect.stringContaining('Target band 51–55%'))
    expect(within(phases).queryByText('51–55%: above')).toBeNull()
  })

  it('draws the season as a year and a line pill, the basis in its title', async () => {
    renderView()
    const phases = await screen.findByRole('table', { name: PHASES })
    const pill = within(phases).getByText('P · to date')
    expect(pill).toHaveAttribute('title', expect.stringContaining("P = the dashboard's Posted"))
    expect(pill.className).toContain('border')
  })

  it('leaves the seven added columns out of the screen, and keeps them in each CSV', async () => {
    renderView()
    const cutoff = await screen.findByRole('table', { name: CUTOFF })
    expect(within(cutoff).queryByText('As of')).toBeNull()
    expect(within(cutoff).queryByText('No received date')).toBeNull()
    expect(within(screen.getByRole('table', { name: BUDGET })).queryByText('Pool share')).toBeNull()
    expect(within(screen.getByRole('table', { name: APPEALS })).queryByText('R1 asked')).toBeNull()
    await userEvent.click(within(headingRow(CUTOFF)).getByRole('button', { name: /download csv/i }))
    const csv = downloadCsv.mock.calls[0]?.[0] ?? ''
    expect(csv).toContain('Season end · As of')
    expect(csv).toContain('Season end · Avg ask')
    expect(csv).toContain('Received since · Avg ask')
    expect(csv).toContain('vs last year · Asked')
  })
})

describe('YearOverYear: the one controls row', () => {
  it('draws the phases switch as a segmented well, % of budget chosen', async () => {
    renderView()
    await screen.findByRole('table', { name: PHASES })
    const well = within(toolbar()).getByRole('group', { name: 'Phases as' })
    expect(within(well).getByRole('button', { name: '% of budget' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(within(well).getByRole('button', { name: 'Share of the phases' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(within(toolbar()).getByText('Phases as')).toBeInTheDocument()
  })

  it('switches the phases to their share in the URL, without reading again', async () => {
    renderView()
    await screen.findByRole('table', { name: PHASES })
    await userEvent.click(screen.getByRole('button', { name: 'Share of the phases' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?phases=share')
    expect(screen.getAllByText('66.7%').length).toBeGreaterThan(0)
    expect(committeeCalls()).toHaveLength(1)
  })

  it('splits the cutoff, budget and Round 1 tables by pool from the URL, without reading again', async () => {
    renderView()
    await screen.findByRole('table', { name: PHASES })
    const well = within(toolbar()).getByRole('group', { name: 'Pools' })
    expect(within(well).getByRole('button', { name: 'All pools' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await userEvent.click(within(well).getByRole('button', { name: 'By pool' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?pools=pool')
    expect(
      within(screen.getByRole('table', { name: CUTOFF })).getAllByText('Pool A').length
    ).toBeGreaterThan(0)
    expect(within(headingRow(CUTOFF)).getByText('each pool, then all pools')).toBeInTheDocument()
    expect(within(headingRow(BUDGET)).getByText('every season by pool')).toBeInTheDocument()
    expect(
      within(headingRow(APPEALS)).getByText('this season by pool; appeals count once per season')
    ).toBeInTheDocument()
    expect(committeeCalls()).toHaveLength(1)
  })

  it('opens with "Through the R1 deadline" checked and the date shown but off', async () => {
    renderView()
    await screen.findByRole('table', { name: PHASES })
    const check = within(toolbar()).getByRole('checkbox', { name: 'Through the R1 deadline' })
    expect(check).toBeChecked()
    expect(check.closest('label')).toHaveAttribute(
      'title',
      'Count applications received by the Round 1 deadline, Feb 1, 2027 (the default)'
    )
    const date = within(toolbar()).getByLabelText('Received through')
    expect(date).toBeDisabled()
    expect(date).toHaveValue('2027-02-01')
    expect(date).toHaveAttribute(
      'title',
      'Off while Through the R1 deadline is checked: uncheck it to type or pick any date'
    )
  })

  it("unchecking keeps the deadline as the date, then a typed date moves this season's cutoff; checking again clears it", async () => {
    renderView()
    await screen.findByRole('table', { name: PHASES })
    await userEvent.click(
      within(toolbar()).getByRole('checkbox', { name: 'Through the R1 deadline' })
    )
    expect(screen.getByTestId('where')).toHaveTextContent('?through=2027-02-01')
    const date = within(toolbar()).getByLabelText('Received through')
    expect(date).toBeEnabled()
    expect(date).toHaveAttribute('title', expect.stringContaining('Moves this season'))
    fireEvent.change(date, { target: { value: '2027-02-15' } })
    await waitFor(() =>
      expect(committeeCalls().at(-1)).toBe(
        '/api/financial-aid/reports/2027/committee?received_through=2027-02-15'
      )
    )
    await userEvent.click(
      within(toolbar()).getByRole('checkbox', { name: 'Through the R1 deadline' })
    )
    expect(screen.getByTestId('where')).toHaveTextContent('')
    expect(screen.getByTestId('where').textContent).toBe('')
  })

  it('shows a refusal in the row as a warning, the full words in its title, and the tables keep the controls', async () => {
    committeeFor = (url) =>
      url.includes('received_through')
        ? json(
            {
              detail:
                'The reporting controls work from 2027: every 2026 request was recorded on one day.',
            },
            422
          )
        : json(COMMITTEE)
    renderView('/aid/reports/year-over-year?through=2026-12-01')
    const status = await screen.findByText(/^⚠ Can't count at Dec 1, 2026:/)
    expect(toolbar().contains(status)).toBe(true)
    expect(status.className).toContain('text-amber-700')
    expect(status).toHaveAttribute(
      'title',
      expect.stringContaining('every 2026 request was recorded on one day')
    )
    expect(
      within(toolbar()).getByRole('checkbox', { name: 'Through the R1 deadline' })
    ).not.toBeChecked()
  })

  it('says a future date counts to today', async () => {
    renderView('/aid/reports/year-over-year?through=2027-05-01')
    await screen.findByRole('table', { name: PHASES })
    expect(within(toolbar()).getByText('Counts to today, Apr 10')).toBeInTheDocument()
  })
})

describe('YearOverYear: words and type (R4)', () => {
  it('prints no RPT-, D-number or O-930 id and no "Not built yet" line', async () => {
    renderView()
    await screen.findByRole('table', { name: PHASES })
    expect(document.body.textContent).not.toMatch(/\bRPT-\d|\bD\d{2,3}\b|O-930/)
    expect(screen.queryByText(/Not built yet/)).toBeNull()
  })

  it('sets every table heading in the sans card heading, not the display serif', async () => {
    renderView()
    await screen.findByRole('table', { name: PHASES })
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings).toHaveLength(4)
    for (const h of headings) {
      expect(h.className).toContain(CS_CARD_HEADING)
      expect(h.className).not.toContain('font-display')
    }
  })
})
