/**
 * ZIP codes through its real hooks (spec §9.4; D66, D90; owner ruling C): the group chip from the read,
 * in the URL, highlighting the group served; both tables; a season with no aid table. Only `fetch` is faked.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidZip } from '../../../types/api-types'
import { ZIP, ZIP_NO_AID } from './zipFixtures'
import { ZipCodes } from './ZipCodes'

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
const downloadCsv = vi.fn<(content: string, name: string) => void>()
vi.mock('../../../utils/csvExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../utils/csvExport')>()),
  downloadCsv: (content: string, name: string) => downloadCsv(content, name),
}))

const VIEW = { year: 2027, asOf: { kind: 'live' } as const }
const ZIP_NOTES = {
  surface: 'reports-development-zip',
  notes: [
    { key: 'zip_who_counts', n: 1, text: 'Who counts: households.' },
    { key: 'zip_dollars', n: 2, text: 'Dollars: all money.' },
    { key: 'zip_zip', n: 3, text: 'ZIP: first five digits.' },
    { key: 'zip_families', n: 4, text: 'Families: households once.' },
    { key: 'zip_geography', n: 5, text: 'Geography goes no finer than ZIP.' },
  ],
}
let answer: (url: string) => ApiAidZip
let fetchSpy: MockInstance<typeof fetch>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const zipCalls = () =>
  fetchSpy.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/zip'))

beforeEach(() => {
  answer = () => ZIP
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const text = String(url)
    if (text.includes('/definitions')) return Promise.resolve(json(ZIP_NOTES))
    return Promise.resolve(json(answer(text)))
  })
})
afterEach(() => fetchSpy.mockRestore())

function Where() {
  const { search } = useLocation()
  return <div data-testid="where">{search}</div>
}

function renderZip(path = '/aid/reports/zip-codes') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ZipCodes view={VIEW} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('ZipCodes (spec §9.4; owner ruling C)', () => {
  it("draws both tables for the server's default group, its chip on", async () => {
    renderZip()
    expect(await screen.findByRole('table', { name: 'Every camper · Pool A' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Campers who got aid · Pool A' })).toBeInTheDocument()
    expect(zipCalls()).toEqual(['/api/financial-aid/reports/2027/development/zip'])
    expect(screen.getByRole('button', { name: 'Pool A' }).className).toContain('bg-primary')
  })

  it('reads the group a chip names, through the URL', async () => {
    answer = (url) =>
      url.includes('group=all') ? { ...ZIP, group: 'all', group_label: 'All groups' } : ZIP
    renderZip()
    await screen.findByRole('table', { name: 'Every camper · Pool A' })
    await userEvent.click(screen.getByRole('button', { name: 'All groups' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?group=all')
    expect(
      await screen.findByRole('table', { name: 'Every camper · All groups' })
    ).toBeInTheDocument()
    await waitFor(() => expect(zipCalls().at(-1)).toContain('group=all'))
  })

  it('shows no chip when the season has no rules (no groups)', async () => {
    answer = () => ({ ...ZIP, groups: [] })
    renderZip()
    await screen.findByRole('table', { name: 'Every camper · Pool A' })
    expect(screen.queryByRole('button', { name: 'Pool B' })).toBeNull()
    expect(screen.queryByText('Group')).toBeNull()
  })

  it("says why there's no aid table before the season's decisions", async () => {
    answer = () => ZIP_NO_AID
    renderZip()
    expect(
      await screen.findByText("Campers who got aid by ZIP start with 2027's decisions.")
    ).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Campers who got aid · Pool A' })).toBeNull()
    // one plain sentence: no "Not built yet" line and no server reason carrying an internal id
    expect(screen.queryByText(/Not built yet/)).toBeNull()
    expect(screen.queryByText(/The aid table waits/)).toBeNull()
  })

  it("shows the server's refusal for an unknown group at once, and one click back to the default", async () => {
    fetchSpy.mockImplementation((url) => {
      const text = String(url)
      if (text.includes('/definitions')) return Promise.resolve(json({ surface: 'x', notes: [] }))
      return Promise.resolve(
        text.includes('group=nonsense')
          ? json({ detail: "'nonsense' is not one of this season's groups" }, 422)
          : json(ZIP)
      )
    })
    renderZip('/aid/reports/zip-codes?group=nonsense')
    expect(await screen.findByText(/is not one of this season's groups/)).toBeInTheDocument()
    expect(zipCalls()).toHaveLength(1) // a refusal is never retried
    await userEvent.click(screen.getByRole('button', { name: 'Show the default group' }))
    expect(screen.getByTestId('where').textContent).toBe('')
    expect(await screen.findByRole('table', { name: 'Every camper · Pool A' })).toBeInTheDocument()
  })

  it("finds a ZIP while the totals stay the server's whole table", async () => {
    renderZip()
    await screen.findByRole('table', { name: 'Every camper · Pool A' })
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Find in Every camper · Pool A' }),
      '00012'
    )
    expect(screen.getByText(/1 of 4 rows match/)).toBeInTheDocument()
  })

  it('puts the descriptions before the tables, and opens each with the most campers first', async () => {
    renderZip()
    const every = await screen.findByRole('table', { name: 'Every camper · Pool A' })
    const words = screen.getByText(/campers enrolled in an aid-eligible session/)
    expect(words.compareDocumentPosition(every) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const aid = screen.getByRole('table', { name: 'Campers who got aid · Pool A' })
    const sameCampers = screen.getByText(/The same campers, attended and got money/)
    expect(sameCampers.compareDocumentPosition(aid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // row 1 is the totals row (it comes first), row 2 the ZIP with the most campers
    const first = (table: HTMLElement) =>
      within(within(table).getAllByRole('row')[2]!).getAllByRole('cell')[0]?.textContent
    expect(first(every)).toBe('00012')
    expect(first(aid)).toBe('00012')
    expect(within(every).getByRole('columnheader', { name: /Campers/ })).toHaveTextContent('↓')
  })

  it('draws the totals row first, under the header, sorted or not', async () => {
    renderZip()
    const every = await screen.findByRole('table', { name: 'Every camper · Pool A' })
    const cellOf = (row: number) =>
      within(within(every).getAllByRole('row')[row]!).getAllByRole('cell')[0]?.textContent
    expect(cellOf(1)).toBe('All · 2 ZIPs')
    await userEvent.click(within(every).getByRole('columnheader', { name: /Campers/ }))
    expect(cellOf(1)).toBe('All · 2 ZIPs')
    const rows = within(every).getAllByRole('row')
    expect(within(rows[rows.length - 1]!).getAllByRole('cell')[0]?.textContent).not.toMatch(/^All/)
  })

  it("numbers the Dollars, ZIP, Families and Campers columns with the mock's notes, listed at the foot", async () => {
    renderZip()
    const aid = await screen.findByRole('table', { name: 'Campers who got aid · Pool A' })
    const sup = (name: RegExp) =>
      within(aid).getByRole('columnheader', { name }).querySelector('sup')?.textContent
    expect(sup(/^ZIP/)).toBe('3')
    expect(sup(/^Campers/)).toBe('1')
    expect(sup(/^Families/)).toBe('4')
    expect(sup(/^Dollars/)).toBe('2')
    expect(await screen.findByText('Geography goes no finer than ZIP.')).toBeInTheDocument()
  })

  it('draws ZIPs in the monospace font', async () => {
    renderZip()
    const every = await screen.findByRole('table', { name: 'Every camper · Pool A' })
    expect(within(every).getByText('00012').closest('td')?.className).toContain('font-mono')
  })

  it('is its own Reports tab: the CSV links /aid/reports/zip-codes, and no internal id shows', async () => {
    renderZip()
    await screen.findByRole('table', { name: 'Every camper · Pool A' })
    expect(document.body.textContent).not.toMatch(/\bD\d{2,3}\b|RPT-\d|O-930/)
    await userEvent.click(screen.getAllByRole('button', { name: /Download CSV/ })[0]!)
    expect(downloadCsv.mock.calls[0]?.[0]).toContain('/aid/reports/zip-codes')
    expect(downloadCsv.mock.calls[0]?.[0]).not.toContain('/development/zip')
  })
})
