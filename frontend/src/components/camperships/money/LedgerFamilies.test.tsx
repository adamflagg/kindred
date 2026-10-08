/** Money › Ledger's family rows (§8.1; D26, D151; P-22, R-D), through the real hooks. Only `fetch` is faked. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { AidView } from '../kit/asOf'
import { LedgerFamilies } from './LedgerFamilies'
import { LEDGER, RULES_2027 } from './ledgerFixtures'
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

const LIVE: AidView = { year: 2027, asOf: { kind: 'live' } }

let fetchSpy: MockInstance<typeof fetch>
const ledgerCalls = () =>
  fetchSpy.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith('/api/financial-aid/money/2027/ledger'))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-06-03T18:00:00Z'))
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const path = String(url)
    const body = path.includes('/rules/')
      ? RULES_2027
      : path.includes('/sources')
        ? SOURCES_2027
        : LEDGER
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
  })
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

function renderAt(path: string, view: AidView = LIVE) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <LedgerFamilies view={view} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const rowOf = (key: number) => {
  const row = document.querySelector(`[data-row-key="${String(key)}"]`)
  if (!(row instanceof HTMLElement)) throw new Error(`no row ${String(key)}`)
  return row
}

describe('Money › Ledger family rows (P-22)', () => {
  it("names each family by the household page's label, its tie-break muted, the server's name when blank (R-D)", async () => {
    renderAt('/aid/money/ledger')
    const johnson = await screen.findByRole('link', { name: 'Pat Johnson Riverside, CA' })
    expect(johnson).toHaveAttribute('href', '/aid/households/1000001?year=2027')
    expect(within(johnson).getByText('Riverside, CA')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Liam & Olivia Garcia' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Chen' })).toHaveAttribute(
      'href',
      '/aid/households/1000003?year=2027'
    )
    // The household id shows only as a tie-break the server wrote, never under every name.
    expect(screen.queryByText('1000002')).toBeNull()
    const [url, options] = fetchSpy.mock.calls.find(([u]) =>
      String(u).startsWith('/api/financial-aid/money/')
    ) as [string, RequestInit]
    expect(url).toBe('/api/financial-aid/money/2027/ledger')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it("shows the level only where the money isn't on a request, the lines with reversals, and the server's totals", async () => {
    renderAt('/aid/money/ledger')
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    expect(within(rowOf(1000001)).getByText('household level')).toBeInTheDocument()
    expect(within(rowOf(1000001)).getByText('6 · 2 reversed')).toBeInTheDocument()
    expect(within(rowOf(1000002)).getByText('left at family level')).toBeInTheDocument()
    expect(within(rowOf(1000004)).getByText('no request')).toBeInTheDocument()
    expect(within(rowOf(1000003)).queryByText(/level|request|mismatch/)).toBeNull()
    // The server's totals, never the four rows' sum ($9,740 · $1,250).
    expect(screen.getByTestId('ledger-totals')).toHaveTextContent(
      '4 families · In CampMinder (net) $615,460 · Outside grants $141,450'
    )
  })

  it("sends the page's day, axis and filters, and each select's choice, to the server", async () => {
    renderAt('/aid/money/ledger?as_of=2027-05-01&as_of_axis=recorded&source=other_outside', {
      year: 2027,
      asOf: { kind: 'past', date: '2027-05-01', axis: 'recorded' },
    })
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    expect(ledgerCalls()[0]).toBe(
      '/api/financial-aid/money/2027/ledger?as_of=2027-05-01&as_of_axis=recorded&source=other_outside'
    )
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Level' }),
      'household level'
    )
    await waitFor(() =>
      expect(ledgerCalls().at(-1)).toBe(
        '/api/financial-aid/money/2027/ledger?as_of=2027-05-01&as_of_axis=recorded&source=other_outside&level=household'
      )
    )
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Program' }),
      await screen.findByRole('option', { name: 'Summer Sessions' })
    )
    await waitFor(() => expect(ledgerCalls().at(-1)).toContain('&program=summer&level=household'))
  })

  it('keeps the filters and the rows on screen while a refiltered read is on its way (R3-4)', async () => {
    renderAt('/aid/money/ledger')
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    // The refiltered read never answers here: the page must not blank while it waits.
    fetchSpy.mockImplementation((url) => {
      const path = String(url)
      if (path.includes('level=household')) return new Promise<Response>(() => undefined)
      const body = path.includes('/rules/')
        ? RULES_2027
        : path.includes('/sources')
          ? SOURCES_2027
          : LEDGER
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    })
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Level' }),
      'household level'
    )
    await waitFor(() => expect(ledgerCalls().at(-1)).toContain('level=household'))
    expect(screen.getByRole('combobox', { name: 'Level' })).toHaveValue('household')
    expect(screen.getByRole('link', { name: 'Liam & Olivia Garcia' })).toBeInTheDocument()
  })

  it("offers the registry's source families, in words, as the Source choices", async () => {
    renderAt('/aid/money/ledger')
    const source = await screen.findByRole('combobox', { name: 'Source' })
    await within(source).findByRole('option', { name: 'other outside' })
    expect(
      within(source)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['all', 'camp fa', 'named fund', 'other outside', 'placeholder', 'unclassified'])
  })

  it('shows a stale or hand-edited ?source= and ?program= in its select, since that is what is sent', async () => {
    renderAt('/aid/money/ledger?source=old_family&program=old_program')
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    expect(ledgerCalls()[0]).toBe(
      '/api/financial-aid/money/2027/ledger?source=old_family&program=old_program'
    )
    const source = screen.getByRole('combobox', { name: 'Source' })
    const program = screen.getByRole('combobox', { name: 'Program' })
    expect(source).toHaveDisplayValue('old family')
    expect(program).toHaveDisplayValue('Old program')
    // A value the select already offers is not listed twice.
    expect(within(source).getAllByRole('option', { name: 'camp fa' })).toHaveLength(1)
  })

  it('disables the two totals while a refiltered read shows the old rows, then enables them', async () => {
    renderAt('/aid/money/ledger')
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    const totals = () => within(screen.getByTestId('ledger-totals')).getAllByRole('button')
    expect(totals()).toHaveLength(2)
    for (const b of totals()) expect(b).toBeEnabled()
    let release: (r: Response) => void = () => undefined
    const held = new Promise<Response>((resolve) => {
      release = resolve
    })
    const normal = fetchSpy.getMockImplementation()
    fetchSpy.mockImplementation((url, init) =>
      String(url).includes('level=household') ? held : (normal?.(url, init) as Promise<Response>)
    )
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Level' }),
      'household level'
    )
    await waitFor(() => expect(ledgerCalls().at(-1)).toContain('level=household'))
    for (const b of totals()) expect(b).toBeDisabled()
    release(new Response(JSON.stringify(LEDGER), { status: 200 }))
    await waitFor(() => {
      for (const b of totals()) expect(b).toBeEnabled()
    })
  })
})
