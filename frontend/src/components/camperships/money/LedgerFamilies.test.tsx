/** Money › Ledger's family rows (§8.1; D26, D151; P-22, R-D), through the real hooks. Only `fetch` is faked. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { AidView } from '../kit/asOf'
import { LedgerFamilies } from './LedgerFamilies'
import { LEDGER, LEDGER_NOTE_ENTRIES, RULES_2027 } from './ledgerFixtures'
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

const LABELS = { summer: 'Session 2', quest: 'Quest' }
const CHOICES = [
  { value: 'summer', label: 'Session 2' },
  { value: 'quest', label: 'Quest' },
  { value: 'teen', label: 'Other program' },
]

function renderAt(
  path: string,
  view: AidView = LIVE,
  unclassified?: number,
  programLabels: Readonly<Record<string, string>> = LABELS,
  programChoices: ReadonlyArray<{ value: string; label: string }> = CHOICES
) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <LedgerFamilies
          view={view}
          unclassified={unclassified}
          programLabels={programLabels}
          programChoices={programChoices}
        />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const rowOf = (key: number) => {
  const row = document.querySelector(`[data-row-key="${String(key)}"]`)
  if (!(row instanceof HTMLElement)) throw new Error(`no row ${String(key)}`)
  return row
}

/** Opens a toolbar picker by its name and chooses an option by its words. */
async function pick(picker: 'Source' | 'Program' | 'Level', option: string | RegExp) {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${picker}:`) }))
  await userEvent.click(await screen.findByRole('option', { name: option }))
}
const optionWords = async (picker: 'Source' | 'Program' | 'Level') => {
  await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${picker}:`) }))
  return (await screen.findAllByRole('option')).map((o) => o.textContent.replace(/^✓/, ''))
}
const tfoot = () => {
  const foot = document.querySelector('tfoot')
  if (!(foot instanceof HTMLElement)) throw new Error('no total row')
  return foot
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

  it("shows the level only where the money isn't on a request, and the lines with reversals", async () => {
    renderAt('/aid/money/ledger')
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    expect(within(rowOf(1000001)).getByText('Household level')).toBeInTheDocument()
    expect(within(rowOf(1000001)).getByText('6 · 2 reversed')).toBeInTheDocument()
    expect(within(rowOf(1000002)).getByText('Left at family level')).toBeInTheDocument()
    expect(within(rowOf(1000004)).getByText('No request')).toBeInTheDocument()
    expect(within(rowOf(1000003)).queryByText(/level|request|mismatch/)).toBeNull()
  })

  // §13: every cut cell carries its full words.
  it('titles every cut cell: the family, the campers, and a dash for a family with no camper on its lines', async () => {
    renderAt('/aid/money/ledger')
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    const cells = within(rowOf(1000001)).getAllByRole('cell')
    expect(cells[0]).toHaveAttribute('title', 'Pat Johnson · Riverside, CA')
    expect(cells[1]).toHaveAttribute('title', 'Emma Johnson, Samuel Johnson')
    expect(cells[5]).toHaveAttribute('title', 'Household level')
  })

  it('shows a muted dash, titled, where no camper is named on the family’s lines', async () => {
    const row = LEDGER.rows[3]
    if (row === undefined) throw new Error('fixture')
    fetchSpy.mockImplementation((url) => {
      const path = String(url)
      const body = path.includes('/rules/')
        ? RULES_2027
        : path.includes('/sources')
          ? SOURCES_2027
          : { ...LEDGER, rows: [{ ...row, campers: [] }] }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    })
    renderAt('/aid/money/ledger')
    await screen.findByRole('link', { name: 'Pat Johnson Lakeside, CA' })
    const cell = within(rowOf(1000004)).getAllByRole('cell')[1]
    expect(cell).toHaveTextContent('—')
    expect(cell).toHaveAttribute(
      'title',
      'No camper on these lines: CampMinder posted them to the household'
    )
  })

  it('is one toolbar row, in the kit: three white pickers, the search, then Download CSV last; no native select', async () => {
    renderAt('/aid/money/ledger')
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    expect(document.querySelectorAll('select')).toHaveLength(0)
    const toolbars = document.querySelectorAll('[data-aid-toolbar]')
    expect(toolbars).toHaveLength(1)
    const bar = toolbars[0] as HTMLElement
    for (const name of ['Source: All', 'Program: All', 'Level: All']) {
      expect(within(bar).getByRole('button', { name })).toBeInTheDocument()
    }
    expect(within(bar).getByPlaceholderText('Family, camper or CM ID')).toBeInTheDocument()
    const last = within(bar).getAllByRole('button').at(-1)
    expect(last).toHaveTextContent('Download CSV')
    // The search sits to the right of the pickers: after Level in the row.
    const order = Array.from(bar.querySelectorAll('button,input')).map(
      (el) => el.getAttribute('aria-label') ?? el.textContent
    )
    expect(order.indexOf('Level: All')).toBeLessThan(order.indexOf('Search'))
  })

  it("sends the page's day, axis and filters, and each picker's choice, to the server", async () => {
    renderAt('/aid/money/ledger?as_of=2027-05-01&as_of_axis=recorded&source=other_outside', {
      year: 2027,
      asOf: { kind: 'past', date: '2027-05-01', axis: 'recorded' },
    })
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    expect(ledgerCalls()[0]).toBe(
      '/api/financial-aid/money/2027/ledger?as_of=2027-05-01&as_of_axis=recorded&source=other_outside'
    )
    await pick('Level', 'Household level')
    await waitFor(() =>
      expect(ledgerCalls().at(-1)).toBe(
        '/api/financial-aid/money/2027/ledger?as_of=2027-05-01&as_of_axis=recorded&source=other_outside&level=household'
      )
    )
    await pick('Program', 'Session 2')
    await waitFor(() => expect(ledgerCalls().at(-1)).toContain('&program=summer&level=household'))
    await pick('Source', 'Every outside grant')
    await waitFor(() => expect(ledgerCalls().at(-1)).toContain('source=outside'))
  })

  it('keeps the pickers and the rows on screen while a refiltered read is on its way (R3-4)', async () => {
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
    await pick('Level', 'Household level')
    await waitFor(() => expect(ledgerCalls().at(-1)).toContain('level=household'))
    expect(screen.getByRole('button', { name: 'Level: Household level' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Liam & Olivia Garcia' })).toBeInTheDocument()
  })

  it('shows the pickers, and no table, while the first read is still on its way', async () => {
    fetchSpy.mockImplementation((url) => {
      const path = String(url)
      if (path.includes('/ledger')) return new Promise<Response>(() => undefined)
      return Promise.resolve(
        new Response(JSON.stringify(path.includes('/sources') ? SOURCES_2027 : RULES_2027), {
          status: 200,
        })
      )
    })
    renderAt('/aid/money/ledger?level=household')
    expect(
      await screen.findByRole('button', { name: 'Level: Household level' })
    ).toBeInTheDocument()
    expect(document.querySelector('table')).toBeNull()
  })

  // Item 2 (mock srcOpts): the camp's own aid, then Outside grants: Every outside grant and each family.
  it("groups the Source choices: the camp's own, Outside grants (Every outside grant first), Not classified only while the season has some", async () => {
    renderAt('/aid/money/ledger', LIVE, 300)
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    await userEvent.click(screen.getByRole('button', { name: /^Source:/ }))
    const list = await screen.findByRole('listbox')
    expect(list).toHaveTextContent(
      /All.*The camp's own.*camp fa.*Outside grants.*Every outside grant.*named fund.*other outside.*Not classified.*unclassified/s
    )
    const words = (await screen.findAllByRole('option')).map((o) => o.textContent.replace(/^✓/, ''))
    expect(words[0]).toBe('All')
    expect(words[1]).toBe('camp fa')
    expect(words).toContain('Every outside grant')
  })

  it('leaves Not classified out of the Source choices while the season has none', async () => {
    renderAt('/aid/money/ledger', LIVE, 0)
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    const words = await optionWords('Source')
    expect(words).not.toContain('unclassified')
    expect(screen.queryByText('Not classified')).toBeNull()
    expect(words).toContain('Every outside grant')
  })

  it("labels the Source choices with the server's source_family_label, never the key", async () => {
    const labelled = {
      ...SOURCES_2027,
      sources: SOURCES_2027.sources.map((r) => ({
        ...r,
        source_family_label: `Label of ${r.source_family}`,
      })),
    }
    fetchSpy.mockImplementation((url) => {
      const path = String(url)
      const body = path.includes('/rules/')
        ? RULES_2027
        : path.includes('/sources')
          ? labelled
          : LEDGER
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
    })
    renderAt('/aid/money/ledger')
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    await userEvent.click(screen.getByRole('button', { name: /^Source:/ }))
    expect(await screen.findByRole('option', { name: 'Label of camp_fa' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'camp fa' })).toBeNull()
  })

  // Lead ruling 10-08: only programs with money this season. The choices are what LedgerTab
  // passes in (programChoicesOf); an unlabelled program with money reads 'Other program' once.
  it("offers exactly the program choices it is given, 'Other program' once for an unlabelled one", async () => {
    renderAt('/aid/money/ledger')
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    const words = await optionWords('Program')
    expect(words).toEqual(['All', 'Session 2', 'Quest', 'Other program'])
    expect(words.join()).not.toMatch(/family_camp|Family camp|Bmitzvah/)
  })

  it('offers only "All" while no program choices have loaded', async () => {
    renderAt('/aid/money/ledger', LIVE, undefined, {}, [])
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    expect(await optionWords('Program')).toEqual(['All'])
  })

  it('shows a stale or hand-edited ?source= and ?program= in its picker, since that is what is sent', async () => {
    renderAt('/aid/money/ledger?source=old_family&program=old_program')
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    expect(ledgerCalls()[0]).toBe(
      '/api/financial-aid/money/2027/ledger?source=old_family&program=old_program'
    )
    expect(screen.getByRole('button', { name: 'Source: old family' })).toBeInTheDocument()
    // Ruled test edit (coordinator 10-08, program_label): a program with no label reads
    // 'Other program' (was 'Old program', the key spelled out).
    expect(screen.getByRole('button', { name: 'Program: Other program' })).toBeInTheDocument()
    // A value the picker already offers is not listed twice.
    await userEvent.click(screen.getByRole('button', { name: /^Source:/ }))
    expect(await screen.findAllByRole('option', { name: 'camp fa' })).toHaveLength(1)
  })
})

describe('the bounded family table (§23)', () => {
  it('sits in a 420px scroll box, and carries the footnote marks on its two money headers', async () => {
    renderAt('/aid/money/ledger')
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    expect(screen.getByRole('table').parentElement?.className).toContain('max-h-[420px]')
    const [camp, outside] = LEDGER_NOTE_ENTRIES
    const campHeader = screen.getByRole('columnheader', { name: /^In CampMinder \(net\)/ })
    expect(within(campHeader).getByText('1')).toHaveAttribute('title', camp?.text)
    const outsideHeader = screen.getByRole('columnheader', { name: /^Outside grants/ })
    expect(within(outsideHeader).getByText('2')).toHaveAttribute('title', outside?.text)
  })
})

describe('the total row (★11)', () => {
  it("is a row of the table, not a sentence: the family count, the server's two totals, the lines, the hint", async () => {
    renderAt('/aid/money/ledger')
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    expect(screen.queryByTestId('ledger-totals')).toBeNull()
    const foot = tfoot()
    expect(within(foot).getByText('4 families')).toBeInTheDocument()
    // The server's totals, never the four rows' sum ($9,740 · $1,250).
    expect(within(foot).getByRole('button', { name: '$615,460' })).toBeInTheDocument()
    expect(within(foot).getByRole('button', { name: '$141,450' })).toBeInTheDocument()
    // 6 + 4 + 3 + 1 lines, 2 + 1 reversed.
    expect(within(foot).getByText('14 · 3 reversed')).toBeInTheDocument()
    expect(within(foot).getByText('each total opens its lines')).toBeInTheDocument()
  })

  it('titles the label with the totals tip, and each total with the lines it opens', async () => {
    renderAt('/aid/money/ledger')
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    const foot = tfoot()
    expect(within(foot).getByText('4 families').closest('td')).toHaveAttribute(
      'title',
      '4 families. Each total opens its lines. The totals follow the filters, not the search.'
    )
    expect(within(foot).getByRole('button', { name: '$615,460' })).toHaveAttribute(
      'title',
      'In CampMinder (net): open the lines behind it'
    )
    expect(within(foot).getByRole('button', { name: '$141,450' })).toHaveAttribute(
      'title',
      'Outside grants: open the lines behind it'
    )
  })

  it('spans the Family and Campers columns with the label', async () => {
    renderAt('/aid/money/ledger')
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    expect(within(tfoot()).getByText('4 families').closest('td')).toHaveAttribute('colspan', '2')
  })

  it('disables the two totals while a refiltered read shows the old rows, then enables them', async () => {
    renderAt('/aid/money/ledger')
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    const totals = () =>
      within(tfoot())
        .getAllByRole('button')
        .filter((b) => b.title.includes('open the lines'))
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
    await pick('Level', 'Household level')
    await waitFor(() => expect(ledgerCalls().at(-1)).toContain('level=household'))
    for (const b of totals()) expect(b).toBeDisabled()
    release(new Response(JSON.stringify(LEDGER), { status: 200 }))
    await waitFor(() => {
      for (const b of totals()) expect(b).toBeEnabled()
    })
  })
})

describe('the total row notes unclassified money', () => {
  it('says "Outside grants incl. $X not yet classified" in the last cell, and a filter drops the amount', async () => {
    const { unmount } = renderAt('/aid/money/ledger', LIVE, 300)
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    const note = within(tfoot()).getByText('Outside grants incl. $300 not yet classified')
    expect(note.closest('td')).toHaveAttribute(
      'title',
      'Outside grants incl. $300 not yet classified. Each total opens its lines. The totals follow the filters, not the search.'
    )
    unmount()
    renderAt('/aid/money/ledger?source=other_outside', LIVE, 300)
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    const foot = tfoot()
    expect(foot).toHaveTextContent('Outside grants may include money not yet classified')
    expect(foot).not.toHaveTextContent('$300')
  })

  it('says nothing about it when the season has none', async () => {
    renderAt('/aid/money/ledger', LIVE, 0)
    await screen.findByRole('link', { name: 'Liam & Olivia Garcia' })
    expect(tfoot()).not.toHaveTextContent('classified')
  })
})
