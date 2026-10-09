/**
 * Owner ruling F: the Ledger's two totals each open the lines behind them, read with the family
 * read's own filters and day; the heading states the lines read's `amount`. Real hooks; only
 * `fetch` is faked.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidLedgerLines } from '../../../types/api-types'
import type { AidView } from '../kit/asOf'
import { LedgerFamilies } from './LedgerFamilies'
import { LEDGER, LEDGER_LINES, RULES_2027 } from './ledgerFixtures'
import { SOURCES_2027 } from './registryFixtures'

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
vi.mock('../../../hooks/camperships/useAidDefinitions', async () => {
  const { ledgerDefinitions } = await import('./ledgerFixtures')
  return { useAidDefinitions: () => ledgerDefinitions() }
})

const PAST: AidView = { year: 2027, asOf: { kind: 'past', date: '2027-05-01', axis: 'campminder' } }
const FILTERED = '/aid/money/ledger?as_of=2027-05-01&source=camp_fa&level=household'

let lines: ApiAidLedgerLines = LEDGER_LINES
let linesRead: 'ok' | 'fail' | 'pending' = 'ok'
let fetchSpy: MockInstance<typeof fetch>
const urls = () => fetchSpy.mock.calls.map(([url]) => String(url))

beforeEach(() => {
  lines = LEDGER_LINES
  linesRead = 'ok'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-06-03T18:00:00Z'))
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const path = String(url)
    if (path.includes('/ledger/lines') && linesRead === 'pending') {
      return new Promise<Response>(() => undefined)
    }
    if (path.includes('/ledger/lines') && linesRead === 'fail') {
      return Promise.resolve(new Response('{}', { status: 500 }))
    }
    const body = path.includes('/rules/')
      ? RULES_2027
      : path.includes('/sources')
        ? SOURCES_2027
        : path.includes('/ledger/lines')
          ? lines
          : LEDGER
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
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

function renderAt(path: string, view: AidView) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <LedgerFamilies view={view} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("The Ledger's totals open their lines (ruling F)", () => {
  it('reads the lines with the same filters and day, and heads them with the read’s amount', async () => {
    // The lines read's own amount, unlike the family read's total: the heading must show this one.
    lines = { ...LEDGER_LINES, amount: 600000 }
    renderAt(FILTERED, PAST)
    await userEvent.click(await screen.findByRole('button', { name: '$615,460' }))
    expect(screen.getByTestId('where')).toHaveTextContent('lines=in_campminder_net')
    const panel = await screen.findByTestId('ledger-lines')
    expect(await within(panel).findByText('In CampMinder (net) $600,000')).toBeInTheDocument()
    expect(
      within(panel).getByText('the 2 lines behind it, 1 reversed (struck, not counted)')
    ).toBeInTheDocument()
    const family = urls().find((u) => u.startsWith('/api/financial-aid/money/2027/ledger?'))
    const behind = urls().find((u) => u.startsWith('/api/financial-aid/money/2027/ledger/lines'))
    expect(family).toBe(
      '/api/financial-aid/money/2027/ledger?as_of=2027-05-01&source=camp_fa&level=household'
    )
    expect(behind).toBe(
      '/api/financial-aid/money/2027/ledger/lines?total=in_campminder_net&as_of=2027-05-01&source=camp_fa&level=household'
    )
    // The lines read is a protected call: the real hook sends the bearer token.
    const call = fetchSpy.mock.calls.find(([u]) => String(u).startsWith(behind ?? ''))
    expect(new Headers(call?.[1]?.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it("shows each line's program_label, not the rules' words or a key, and 'Other program' with none", async () => {
    const [first, second] = LEDGER_LINES.lines
    if (first === undefined || second === undefined) throw new Error('fixture')
    lines = {
      ...LEDGER_LINES,
      lines: [
        { ...first, program: 'summer', program_label: 'Session 2' },
        { ...second, program: 'quest', program_label: '' },
      ],
    }
    renderAt('/aid/money/ledger?lines=in_campminder_net', { year: 2027, asOf: { kind: 'live' } })
    const panel = await screen.findByTestId('ledger-lines')
    expect(await within(panel).findByText('Session 2')).toBeInTheDocument()
    expect(within(panel).getByText('Other program')).toBeInTheDocument()
    expect(within(panel).queryByText(/Summer Sessions|^Quest$/)).toBeNull()
  })

  it("shows each line's source_family_label in the Source family column, never a key", async () => {
    const [first, second] = LEDGER_LINES.lines
    if (first === undefined || second === undefined) throw new Error('fixture')
    lines = {
      ...LEDGER_LINES,
      lines: [
        { ...first, source_family_label: 'Camp financial aid' },
        { ...second, source_family_label: '' },
      ],
    }
    renderAt('/aid/money/ledger?lines=in_campminder_net', { year: 2027, asOf: { kind: 'live' } })
    const panel = await screen.findByTestId('ledger-lines')
    expect(await within(panel).findByText('Camp financial aid')).toBeInTheDocument()
    expect(within(panel).getByText('camp fa')).toBeInTheDocument()
  })

  it('shows each line, a reversed one struck with its date, and closes', async () => {
    renderAt('/aid/money/ledger?lines=in_campminder_net', { year: 2027, asOf: { kind: 'live' } })
    const panel = await screen.findByTestId('ledger-lines')
    expect(await within(panel).findByText('reversed Mar 9')).toBeInTheDocument()
    expect(within(panel).getByText('$1,420').tagName).toBe('S')
    expect(within(panel).getAllByText('Summer Sessions')).toHaveLength(2)
    expect(within(panel).getByText('Household level')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Download CSV' })).toBeInTheDocument()
    // R3-3: each line's family is named as its Ledger row names it, tie-break muted, and links to
    // that family's household (R3-14), not the posting household.
    const [family] = within(panel).getAllByRole('link', { name: 'Pat Johnson Riverside, CA' })
    expect(family).toHaveAttribute('href', '/aid/households/1000001?year=2027')
    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('ledger-lines')).toBeNull()
    expect(screen.getByTestId('where')).not.toHaveTextContent('lines=')
  })

  it('opens Outside grants from a link that names it', async () => {
    lines = { ...LEDGER_LINES, total: 'outside_grants', amount: 141450, lines: [] }
    renderAt('/aid/money/ledger?lines=outside_grants', { year: 2027, asOf: { kind: 'live' } })
    const panel = await screen.findByTestId('ledger-lines')
    expect(await within(panel).findByText('Outside grants $141,450')).toBeInTheDocument()
    expect(within(panel).getByText('the 0 lines behind it')).toBeInTheDocument()
    expect(urls()).toContain('/api/financial-aid/money/2027/ledger/lines?total=outside_grants')
  })

  it.each(['fail', 'pending'] as const)(
    'can still be closed while the lines read is %s',
    async (state) => {
      linesRead = state
      renderAt('/aid/money/ledger?lines=in_campminder_net', { year: 2027, asOf: { kind: 'live' } })
      const panel = await screen.findByTestId('ledger-lines')
      await userEvent.click(await within(panel).findByRole('button', { name: 'Close' }))
      expect(screen.queryByTestId('ledger-lines')).toBeNull()
      expect(screen.getByTestId('where')).not.toHaveTextContent('lines=')
    }
  )
})

describe('the lines card, as the final mock draws it (★13, §23)', () => {
  const OPEN = '/aid/money/ledger?lines=in_campminder_net'
  const LIVE_VIEW: AidView = { year: 2027, asOf: { kind: 'live' } }

  it('has ONE heading row: title, desc, then search, Download CSV and Close, in that order', async () => {
    renderAt(OPEN, LIVE_VIEW)
    const panel = await screen.findByTestId('ledger-lines')
    await within(panel).findByText('In CampMinder (net) $615,460')
    const bars = panel.querySelectorAll('[data-aid-toolbar]')
    expect(bars).toHaveLength(1)
    const bar = bars[0] as HTMLElement
    expect(bar).toHaveTextContent('In CampMinder (net) $615,460')
    expect(bar).toHaveTextContent('the 2 lines behind it, 1 reversed (struck, not counted)')
    expect(within(bar).getByPlaceholderText('Names or CM IDs')).toBeInTheDocument()
    const buttons = within(bar)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(buttons.slice(-2)).toEqual(['Download CSV', 'Close'])
  })

  it('titles the heading words, so a cut one reads whole', async () => {
    renderAt(OPEN, LIVE_VIEW)
    const panel = await screen.findByTestId('ledger-lines')
    expect(await within(panel).findByText('In CampMinder (net) $615,460')).toHaveAttribute(
      'title',
      'In CampMinder (net) $615,460'
    )
  })

  it('holds the lines in a bounded 420px box, its header and Amount in the mock’s widths', async () => {
    renderAt(OPEN, LIVE_VIEW)
    const panel = await screen.findByTestId('ledger-lines')
    await within(panel).findByText('reversed Mar 9')
    expect(within(panel).getByRole('table').parentElement?.className).toContain('max-h-[420px]')
    for (const header of [
      'Family',
      'Camper',
      'Description in CampMinder',
      'Source family',
      'Program',
      'Amount',
      'Posted on',
      "Level, where it isn't a request",
    ]) {
      expect(within(panel).getByRole('columnheader', { name: header })).toBeInTheDocument()
    }
  })

  it('shows a household-level line’s camper as ⌂, titled, and titles every cut cell', async () => {
    renderAt(OPEN, LIVE_VIEW)
    const panel = await screen.findByTestId('ledger-lines')
    await within(panel).findByText('reversed Mar 9')
    const [household, camper] = within(panel).getAllByRole('row').slice(1)
    if (household === undefined || camper === undefined) throw new Error('rows')
    const cells = within(household).getAllByRole('cell')
    expect(cells[1]).toHaveAttribute('title', 'Posted to the household: no camper on the line')
    expect(cells[1]?.querySelector('svg')).not.toBeNull()
    expect(cells[2]).toHaveAttribute('title', 'Camp aid · Summer')
    expect(cells[3]).toHaveAttribute('title', 'camp fa')
    expect(cells[4]).toHaveAttribute('title', 'Summer Sessions')
    expect(within(camper).getAllByRole('cell')[1]).toHaveAttribute('title', 'Emma Johnson')
    expect(within(camper).getAllByRole('cell')[7]).not.toHaveAttribute('title', '')
  })

  // Mock lines card: a line posted to a Family Camp household reads ⌂ and the session in the tiny form, titled
  // "Posted to the household: {full session name}", and its family label carries ⌂ too.
  it('shows a Family Camp household line as ⌂ with its session', async () => {
    const [first, ...rest] = LEDGER_LINES.lines
    if (first === undefined) throw new Error('fixture')
    lines = {
      ...LEDGER_LINES,
      lines: [
        {
          ...first,
          household_session: { name: 'Family Camp 4: Riverside Weekend', session_type: 'family' },
        },
        ...rest,
      ],
    }
    renderAt(OPEN, LIVE_VIEW)
    const panel = await screen.findByTestId('ledger-lines')
    await within(panel).findByText('reversed Mar 9')
    const [household, camper] = within(panel).getAllByRole('row').slice(1)
    if (household === undefined || camper === undefined) throw new Error('rows')
    const cells = within(household).getAllByRole('cell')
    expect(cells[1]).toHaveTextContent('FC4')
    expect(cells[1]?.querySelector('svg')).not.toBeNull()
    expect(cells[1]).toHaveAttribute(
      'title',
      'Posted to the household: Family Camp 4: Riverside Weekend'
    )
    expect(cells[0]?.querySelector('svg')).not.toBeNull()
    expect(within(camper).getAllByRole('cell')[0]?.querySelector('svg')).toBeNull()
  })

  it('searches the lines from the heading row', async () => {
    renderAt(OPEN, LIVE_VIEW)
    const panel = await screen.findByTestId('ledger-lines')
    await within(panel).findByText('reversed Mar 9')
    await userEvent.type(within(panel).getByPlaceholderText('Names or CM IDs'), 'Emma')
    expect(within(panel).queryByText('$3,620')).toBeNull()
    expect(within(panel).getByText('reversed Mar 9')).toBeInTheDocument()
  })
})
