/**
 * Reports › Development › Report through its real hooks (spec §9.4; D65, D68; S4-4; Decisions 16, 17;
 * the approved final mock reports-development): ONE toolbar row, the grid with its two column groups,
 * six notes, and the on-demand as-of column (not saved, component state only). Only `fetch` is faked.
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
  usePermissions: () => ({ hasPermission: (p: string) => mockPerms.includes(p) }),
}))
vi.mock('../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

const SIX = [
  { n: 1, key: 'dev_budget', text: 'Budget: the first board-passed.' },
  { n: 2, key: 'need', text: 'Need and Total Requests: the asks.' },
  { n: 3, key: 'total_awards_granted', text: 'Total Awards Granted: all money.' },
  { n: 4, key: 'dev_recipients', text: 'Who counts: attended and got money.' },
  { n: 5, key: 'first_time', text: 'First-time: no earlier session.' },
  { n: 6, key: 'basis_unconfirmed', text: 'As reported: typed once.' },
]

let mockPerms: string[] = ['financial_aid.summary']
const VIEW = { year: 2027, asOf: { kind: 'live' } as const }
let columnAnswer: () => Response
let liveAnswer: () => Response
let fetchSpy: MockInstance<typeof fetch>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-06-03T18:00:00Z'))
  mockPerms = ['financial_aid.summary']
  columnAnswer = () => json(DEVELOPMENT)
  liveAnswer = () => json(DEVELOPMENT_LIVE)
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const text = String(url)
    if (text.includes('/definitions'))
      return Promise.resolve(json({ surface: 'reports-development', notes: SIX }))
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
    expect(screen.queryByRole('table', { name: '2027 by source' })).not.toBeInTheDocument()
  })

  it('heads the seasons short, grouped As reported⁶ and The dashboard, the long words in titles', async () => {
    renderReport()
    const table = await screen.findByRole('table', { name: 'Development report' })
    const asReported = await within(table).findByRole('columnheader', { name: /As reported/ })
    await waitFor(() => expect(asReported.querySelector('sup')?.textContent).toBe('6'))
    expect(within(table).getByRole('columnheader', { name: /The dashboard/ })).toBeInTheDocument()
    const live = within(table).getByRole('columnheader', { name: /live · Jun 3/ })
    expect(live).toHaveTextContent('2027live · Jun 3')
    expect(live).toHaveAttribute('title', "2027, live: the dashboard's decisions as of Jun 3")
    expect(within(table).getByRole('columnheader', { name: '2025' })).toHaveAttribute(
      'title',
      '2025: as reported, typed once, read only (basis unconfirmed)'
    )
    expect(document.body.textContent).not.toContain('basis unconfirmed ·')
  })

  it('has ONE toolbar row: the title, Show As Of a Date…, Copy and Download CSV; no heading row of its own', async () => {
    renderReport()
    await screen.findByRole('table', { name: 'Development report' })
    const bar = screen.getByTestId('aid-toolbar')
    expect(within(bar).getByRole('heading', { name: 'Development report' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Show As Of a Date…' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: /Copy/ })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: /Download CSV/ })).toBeInTheDocument()
    expect(screen.queryByTestId('report-heading-row')).toBeNull()
    expect(screen.getAllByRole('button', { name: /Download CSV/ })).toHaveLength(1)
  })

  it("hides Show the dashboard's rebuild until the backfill exists, and every amber sentence above the table", async () => {
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
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByText(/Not built yet/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Some other figure waits/)).not.toBeInTheDocument()
    // the 2025 column's basis is note 6 and a title now, never an amber "Basis unconfirmed" sentence
    expect(screen.queryByText(/Basis unconfirmed:/)).toBeNull()
    expect(document.querySelector('.text-amber-700, .bg-amber-50')).toBeNull()
  })

  it('puts Copy’s result on the Copy button, not the status slot', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => Promise.resolve()) },
      configurable: true,
    })
    renderReport()
    await screen.findByRole('table', { name: 'Development report' })
    await userEvent.click(screen.getByRole('button', { name: /Copy/ }))
    expect(
      await within(screen.getByTestId('aid-toolbar')).findByRole('button', { name: '✓ Copied' })
    ).toBeVisible()
  })
})

describe('the Budget row (D2)', () => {
  it('is the first line of Money, in dollars for every column', async () => {
    liveAnswer = () => json({ ...DEVELOPMENT_LIVE, rows: [...DEVELOPMENT_LIVE.rows, BUDGET_ROW] })
    renderReport()
    const table = await screen.findByRole('table', { name: 'Development report' })
    const rows = within(table).getAllByRole('row')
    // two header rows (the groups, then the seasons), then the Money heading, then Budget
    expect(rows[2]).toHaveTextContent('Money')
    expect(rows[3]).toHaveTextContent('Budget')
    expect(rows[3]).toHaveTextContent('$1,000,000')
    expect(rows[3]).toHaveTextContent('$1,200,000')
  })

  it('draws no Budget line, and no placeholder for it, when the read has none', async () => {
    renderReport()
    const table = await screen.findByRole('table', { name: 'Development report' })
    expect(within(table).queryByText(/Budget/)).not.toBeInTheDocument()
  })
})

describe('the grantor lines (D3)', () => {
  it('draw inline under Outside grants on ONE line: the name, then its facts at the right', async () => {
    liveAnswer = () => json(DEVELOPMENT_GRANTORS)
    renderReport()
    const table = await screen.findByRole('table', { name: 'Development report' })
    const a = within(table).getByText('Grantor A').closest('td') as HTMLElement
    expect(within(a).getByText('incentive')).toBeInTheDocument()
    expect(within(a).getByText('· Pool A')).toHaveAttribute('title', 'Pool A')
    expect(a).toHaveAttribute('title', 'Grantor A (another funder · incentive · Pool A)')
    const b = within(table).getByText('Grantor B').closest('td') as HTMLElement
    expect(within(b).getByText('need-based')).toBeInTheDocument()
    expect(within(b).getByText('needs a group')).toHaveAttribute(
      'title',
      'No reporting group yet: set one in Money › Funders'
    )
    // the words that used to be a second line are gone from the screen
    expect(within(table).queryByText(/another funder ·/)).toBeNull()
    expect(screen.getAllByRole('table')).toHaveLength(1)
  })
})

describe('the grantor lines link to Money › Funders', () => {
  it("open that funder's group for a user who sees Funders (development holds grantors)", async () => {
    mockPerms = ['financial_aid.summary', 'financial_aid.grantors']
    liveAnswer = () => json(DEVELOPMENT_GRANTORS)
    renderReport()
    const table = await screen.findByRole('table', { name: 'Development report' })
    expect(within(table).getByRole('link', { name: 'Grantor A' })).toHaveAttribute(
      'href',
      '/aid/money/funders?funder=grantor_a&year=2027'
    )
  })

  it('stay plain words for a summary-only user, who has no Money', async () => {
    liveAnswer = () => json(DEVELOPMENT_GRANTORS)
    renderReport()
    const table = await screen.findByRole('table', { name: 'Development report' })
    expect(within(table).getByText('Grantor A')).toBeInTheDocument()
    expect(within(table).queryByRole('link', { name: 'Grantor A' })).toBeNull()
  })
})

describe('the footnotes (final mock)', () => {
  it('drop the three sentences their meaning moved out of: titles and the notes say them', async () => {
    renderReport()
    await screen.findByRole('table', { name: 'Development report' })
    expect(screen.queryByText(/Every outside source is listed/)).toBeNull()
    expect(screen.queryByText(/r = as reported/)).toBeNull()
    expect(screen.queryByText(/No family is ever named/)).toBeNull()
  })

  it('carry no internal id: no D-code, RPT- or O-930 anywhere on the report', async () => {
    renderReport()
    await screen.findByRole('table', { name: 'Development report' })
    expect(document.body.textContent).not.toMatch(/\bD\d{2,3}\b|RPT-|O-930/)
  })
})

describe('the six numbered notes', () => {
  it("number the registry's six in its order, each row's mark the note it points at", async () => {
    renderReport()
    const table = await screen.findByRole('table', { name: 'Development report' })
    const total = within(table).getByText('Total Awards Granted').closest('td') as HTMLElement
    await waitFor(() => expect(total.querySelector('sup')?.textContent).toBe('3'))
    const items = await waitFor(() => {
      const list = document.querySelectorAll('ol li')
      expect(list).toHaveLength(6)
      return [...list].map((li) => li.textContent)
    })
    expect(items[0]).toBe('1. Budget: the first board-passed.')
    expect(items[5]).toBe('6. As reported: typed once.')
    const first = within(table).getByText('First-time, Pool A').closest('td') as HTMLElement
    expect(first.querySelector('sup')?.textContent).toBe('5')
  })

  it('say the definitions could not load, with no marks, when the registry fails', async () => {
    fetchSpy.mockImplementation((url) =>
      String(url).includes('/definitions')
        ? Promise.resolve(json({ detail: 'down' }, 500))
        : Promise.resolve(liveAnswer())
    )
    renderReport()
    const table = await screen.findByRole('table', { name: 'Development report' })
    expect(await screen.findByText(/definitions for these figures couldn.t load/)).toBeVisible()
    expect(table.querySelector('tbody sup')).toBeNull()
  })
})

describe('the capped-requests line (Rule M)', () => {
  const LINE =
    "Total Requests and % of need met: 1 request above its session's cost counted at the cost (2027)."

  it('is the one muted line under the table, above the notes', async () => {
    renderReport()
    const table = await screen.findByRole('table', { name: 'Development report' })
    const line = await screen.findByText(LINE)
    expect(screen.getAllByText(LINE)).toHaveLength(1)
    expect(table.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const section = table.closest('section') as HTMLElement
    expect(section.contains(line)).toBe(true)
    expect(section.querySelectorAll('p')).toHaveLength(1)
    expect(section.querySelector('ol')).toBeNull()
  })

  it('is absent when no column has a capped request', async () => {
    liveAnswer = () =>
      json({
        ...DEVELOPMENT_LIVE,
        columns: DEVELOPMENT_LIVE.columns.map((c) => ({ ...c, requests_capped: 0 })),
      })
    renderReport()
    await screen.findByRole('table', { name: 'Development report' })
    expect(document.body.textContent).not.toContain('counted at the cost')
  })
})

describe('Show As Of a Date…: one on-demand column, not saved (D1), inline in the one toolbar row', () => {
  const MARCH = '2027-03-09'
  const calls = () => fetchSpy.mock.calls.map(([url, init]) => [String(url), init?.method ?? 'GET'])
  const bar = () => screen.getByTestId('aid-toolbar')

  async function show(day = MARCH) {
    await screen.findByRole('table', { name: 'Development report' })
    await userEvent.click(screen.getByRole('button', { name: 'Show As Of a Date…' }))
    fireEvent.change(screen.getByLabelText('As of'), { target: { value: day } })
    await userEvent.click(screen.getByRole('button', { name: 'Show' }))
  }

  it('opens in the same row: Season picker, a date that stops at yesterday (camp time), Show and Back', async () => {
    renderReport()
    await screen.findByRole('table', { name: 'Development report' })
    await userEvent.click(screen.getByRole('button', { name: 'Show As Of a Date…' }))
    expect(within(bar()).getByRole('button', { name: 'Season: 2027' })).toBeInTheDocument()
    expect(screen.getByLabelText('As of')).toHaveAttribute('max', dayBefore(campToday()))
    expect(screen.getByLabelText('As of').closest('[data-testid="aid-toolbar"]')).toBe(bar())
    expect(screen.getByRole('button', { name: 'Show' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Show As Of a Date…' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'Show As Of a Date…' })).toBeInTheDocument()
  })

  it('offers only the seasons dated records cover, its title saying where they start', async () => {
    renderReport()
    await screen.findByRole('table', { name: 'Development report' })
    await userEvent.click(screen.getByRole('button', { name: 'Show As Of a Date…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Season: 2027' }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['✓2027'])
    expect(screen.getByTitle('Dated records start in 2027')).toBeInTheDocument()
  })

  it('refetches with the column and draws it as 2027 with “Mar 9 · not saved” under it', async () => {
    renderReport()
    await show()
    const head = await screen.findByRole('columnheader', { name: /Mar 9 · not saved/ })
    expect(head).toHaveTextContent('2027Mar 9 · not saved')
    expect(head.getAttribute('title')).toContain('never saved; gone when you leave the page')
    expect(calls().some(([url]) => url?.includes('column=2027%3A2027-03-09'))).toBe(true)
    expect(
      screen.getAllByRole('columnheader').filter((h) => h.textContent.includes('not saved'))
    ).toHaveLength(1)
  })

  it('closes the form once the column shows, leaving a removable chip in the same row', async () => {
    renderReport()
    await show()
    await screen.findByRole('columnheader', { name: /not saved/ })
    expect(screen.queryByLabelText('As of')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show' })).not.toBeInTheDocument()
    const chip = within(bar()).getByText('2027 as of Mar 9 · not saved').closest('span[title]')
    expect(chip).toHaveAttribute(
      'title',
      "Recomputed from dated records, never a frozen copy; nothing is saved, and it's gone when you leave the page. ✕ removes it."
    )
    expect(screen.queryByRole('button', { name: 'Show As Of a Date…' })).toBeNull()
  })

  it('✕ drops the column, saves nothing, and puts nothing in the URL', async () => {
    renderReport()
    await show()
    await screen.findByRole('columnheader', { name: /not saved/ })
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/aid\/reports\/development$/)
    await userEvent.click(screen.getByRole('button', { name: /Clear 2027 as of Mar 9/ }))
    await waitFor(() =>
      expect(screen.queryByRole('columnheader', { name: /not saved/ })).not.toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: 'Show As Of a Date…' })).toBeInTheDocument()
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

  it("sends a refusal to the status slot, warn tone, the server's full words in its title, and keeps the typing", async () => {
    columnAnswer = () => json({ detail: 'A dated column needs a day already past' }, 422)
    renderReport()
    await show('2027-06-03')
    const status = await within(bar()).findByText("⚠ Can't show Jun 3: pick a day before today")
    expect(status).toHaveClass('text-amber-700')
    expect(status).toHaveAttribute(
      'title',
      expect.stringContaining('A dated column needs a day already past')
    )
    expect(screen.getByLabelText('As of')).toHaveValue('2027-06-03')
  })

  it("names the server's own refusal, not the today advice, for a past day it still refuses", async () => {
    columnAnswer = () => json({ detail: '2025-05-01 is not a past day of the 2027 season' }, 422)
    renderReport()
    await show('2025-05-01')
    const status = await within(bar()).findByText(
      "⚠ Can't show May 1: 2025-05-01 is not a past day of the 2027 season"
    )
    expect(status).toHaveClass('text-amber-700')
    expect(within(bar()).queryByText(/pick a day before today/)).not.toBeInTheDocument()
  })

  // the final mock (`?asof=refused`): Back returns to idle, and picking another day returns to the form;
  // either way the refusal leaves the status slot
  it('clears the refusal from the status slot on Back', async () => {
    columnAnswer = () => json({ detail: 'A dated column needs a day already past' }, 422)
    renderReport()
    await show('2027-06-03')
    await within(bar()).findByText("⚠ Can't show Jun 3: pick a day before today")
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'Show As Of a Date…' })).toBeInTheDocument()
    expect(within(bar()).queryByText(/Can't show/)).not.toBeInTheDocument()
  })

  it('clears the refusal from the status slot once another day is picked', async () => {
    columnAnswer = () => json({ detail: 'A dated column needs a day already past' }, 422)
    renderReport()
    await show('2027-06-03')
    await within(bar()).findByText("⚠ Can't show Jun 3: pick a day before today")
    fireEvent.change(screen.getByLabelText('As of'), { target: { value: MARCH } })
    expect(within(bar()).queryByText(/Can't show/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('As of')).toHaveValue(MARCH)
  })
})
