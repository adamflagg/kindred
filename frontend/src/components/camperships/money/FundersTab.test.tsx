/**
 * Money › Funders end to end through its real hooks (owner 10-08; mock q2; D58, D86, D100, D143,
 * D159, D160; P-9, P-12 to P-14): the sources and the grantors in one table grouped by who pays,
 * who may edit what (finance, the registrar, development), and the fresh read before every save.
 * Only `fetch` is faked, routed by URL and method. The permission gates, write bodies and refreshes,
 * retire rules and typing re-bases of the old Sources and Grantors tests live here now.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidFundingSources, ApiAidGrantors, ApiAidSources } from '../../../types/api-types'
import { GRANTOR_A, GRANTOR_K, GRANTORS_ALL } from '../grants/grantorDirectoryFixtures'
import { FundersTab } from './FundersTab'
import { RULES_2027 } from './ledgerFixtures'
import {
  FUNDING_SOURCES_2027,
  REG_GRANTOR_A_GRANT,
  REG_GRANTOR_E_NEW,
  SOURCES_2027,
} from './registryFixtures'

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
vi.mock('../shell/AidDefinitionNotes', () => ({
  AidDefinitionNotes: ({ surface }: { surface: string }) => <p>{`Notes for ${surface}`}</p>,
}))

const REGISTRAR = ['financial_aid.view', 'financial_aid.casework']
const FINANCE = [...REGISTRAR, 'financial_aid.rules', 'financial_aid.grantors']
const DEVELOPMENT = ['financial_aid.summary', 'financial_aid.grantors']
const VIEW = { year: 2027, asOf: { kind: 'live' } as const }
const SOURCES = '/api/financial-aid/sources?'
const GROUPS = '/api/financial-aid/reports/2027/funding-sources'
const GRANTORS = '/api/financial-aid/grantors'

// The registry's four Funders notes, numbered as the server sends them (bunking/financial_aid/definitions.py).
const DEFINITIONS = {
  surface: 'money-sources',
  notes: [
    ['funder', 'Funder'],
    ['incentive', 'Incentive or need-based'],
    ['reporting_group', 'Reporting group'],
    ['source_lines', 'Lines this season'],
  ].map(([key, term], i) => ({ key, n: i + 1, term, text: `${term}: the note's words.` })),
}

let sourceReads: ApiAidSources[] = []
let fundingReads: ApiAidFundingSources[] = []
let grantorReads: ApiAidGrantors[] = []
let answers: Response[] = []
let fetchSpy: MockInstance<typeof fetch>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const calls = () =>
  fetchSpy.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: init?.method ?? 'GET',
    auth: new Headers(init?.headers).get('Authorization'),
    body: init?.body,
  }))
const writes = () => calls().filter((call) => call.method !== 'GET')
/** The reads of one kind made before the first write. */
const getsBeforeWrite = (prefix: string) => {
  const all = calls()
  const first = all.findIndex((c) => c.method !== 'GET')
  return (first === -1 ? all : all.slice(0, first)).filter(
    (c) => c.method === 'GET' && c.url.startsWith(prefix)
  )
}
/** The reads of one kind made after the first write: what the save refreshed. */
const getsAfterWrite = (prefix: string) => {
  const all = calls()
  const first = all.findIndex((c) => c.method !== 'GET')
  return first === -1
    ? []
    : all.slice(first).filter((c) => c.method === 'GET' && c.url.startsWith(prefix))
}

beforeEach(() => {
  granted = FINANCE
  sourceReads = [SOURCES_2027]
  fundingReads = [FUNDING_SOURCES_2027]
  grantorReads = [GRANTORS_ALL]
  answers = []
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const path = String(url)
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      const queued = answers.shift()
      if (queued !== undefined) return Promise.resolve(queued)
      if (path.includes('/funding-sources/')) {
        const [, , e] = FUNDING_SOURCES_2027.sources
        return Promise.resolve(json({ ...e, group: 'pool_a', group_label: 'Pool A' }))
      }
      if (path.startsWith(GRANTORS)) return Promise.resolve(json(GRANTOR_A))
      return Promise.resolve(json(REG_GRANTOR_A_GRANT))
    }
    if (path.startsWith(GRANTORS)) {
      const next = grantorReads.length > 1 ? grantorReads.shift() : grantorReads[0]
      return Promise.resolve(json(next ?? GRANTORS_ALL))
    }
    if (path.includes('/funding-sources')) {
      // Each Funding sources read takes the next answer; the last one repeats.
      const next = fundingReads.length > 1 ? fundingReads.shift() : fundingReads[0]
      return Promise.resolve(json(next ?? FUNDING_SOURCES_2027))
    }
    if (path.includes('/definitions')) return Promise.resolve(json(DEFINITIONS))
    if (path.includes('/rules/')) return Promise.resolve(json(RULES_2027))
    // Each registry read takes the next answer; the last one repeats.
    const next = sourceReads.length > 1 ? sourceReads.shift() : sourceReads[0]
    return Promise.resolve(json(next ?? SOURCES_2027))
  })
})
afterEach(() => fetchSpy.mockRestore())

function Where() {
  const { search } = useLocation()
  return <div data-testid="where">{search}</div>
}

function renderTab(path = '/aid/money/funders') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <FundersTab view={VIEW} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const rowByKey = (key: string) => {
  const found = document.querySelector(`tr[data-row-key="${key}"]`)
  if (!(found instanceof HTMLElement)) throw new Error(`no row ${key}`)
  return found
}
const panel = (name: 'source' | 'edit') => {
  const found = document.querySelector(`[data-panel="${name}"]`)
  if (!(found instanceof HTMLElement)) throw new Error(`no ${name} panel`)
  return found
}
const openRow = async (description: string) => {
  await userEvent.click(await screen.findByText(description))
  await waitFor(() => expect(document.querySelector('[data-panel="source"]')).not.toBeNull())
}
/**
 * The kit's white picker (design-language §3; it replaced the native selects): open it by its button, pick an
 * option by its words. A multi picker stays open while it is checked, so a second pick needs no reopening.
 */
const openPicker = (scope: HTMLElement, label: string) =>
  userEvent.click(within(scope).getByRole('button', { name: new RegExp(`^${label}:`) }))
const pickOption = async (scope: HTMLElement, label: string, option: string | RegExp) => {
  await openPicker(scope, label)
  await userEvent.click(await screen.findByRole('option', { name: option }))
}
const openFunder = async (key: string) => {
  await screen.findByText('Grantor A grant')
  await userEvent.click(within(rowByKey(`funder:${key}`)).getAllByRole('cell')[0] as HTMLElement)
  return screen.findByTestId('grantor-panel')
}
const headerKeys = () =>
  Array.from(document.querySelectorAll('tr[data-row-tone]')).map((r) =>
    r.getAttribute('data-row-key')
  )

describe('the grouped list (mock q2)', () => {
  it('groups by who pays: Camp, each funder A to Z, then No funder yet, as header rows', async () => {
    renderTab()
    await screen.findByText('Grantor A grant')
    expect(headerKeys()).toEqual([
      'group:camp',
      'funder:grantor_a',
      'funder:grantor_c',
      'funder:grantor_e',
      'funder:grantor_k',
      'group:none',
    ])
    expect(rowByKey('group:none')).toHaveAttribute('data-row-tone', 'warn')
    expect(rowByKey('group:camp')).toHaveAttribute('data-row-tone', 'group')
    // Final UX (money-funders.html): a header reads name, terms, then the muted details, as three runs of
    // one spanning cell (the live row ran the whole sentence together and overprinted the next cell).
    const camp = rowByKey('group:camp')
    expect(
      within(camp).getByText("The camp's own aid · counts toward the budget")
    ).toBeInTheDocument()
    expect(within(camp).getByText('no terms or contacts · 2 descriptions')).toBeInTheDocument()
    const none = rowByKey('group:none')
    expect(
      within(none).getByText("Pick each description's funder; classify an unclassified one first")
    ).toBeInTheDocument()
    expect(within(none).getByText('2 descriptions')).toBeInTheDocument()
  })

  it('draws a header as one spanning cell up to the totals, whole in its title (owner: the long name overprinted)', async () => {
    // Replaces #3109's pin on the run-over (the header's words in the Source family cell): the name and its
    // terms own columns 1 to 6 and cut at the totals, with every word in a native title (design-language §13).
    renderTab()
    await screen.findByText('Grantor A grant')
    for (const key of ['group:camp', 'funder:grantor_a', 'funder:grantor_k', 'group:none']) {
      const cells = rowByKey(key).querySelectorAll('td')
      expect(cells, key).toHaveLength(3)
      expect(cells.item(0), key).toHaveAttribute('colspan', '6')
      expect(cells.item(0).className, key).toContain('overflow-hidden')
    }
    expect(rowByKey('funder:grantor_a').querySelector('td')).toHaveAttribute(
      'title',
      'Grantor A · Not full coverage · eligibility: First and second summers · 1 contact'
    )
    // Each header reads: caret, the bold name, then the muted terms.
    const first = rowByKey('funder:grantor_a').querySelector('td')
    expect(first?.textContent.startsWith('▸')).toBe(true)
    expect(within(rowByKey('funder:grantor_a')).getByText('Grantor A')).toHaveClass('font-bold')
  })

  it('indents a description under its funder with its own caret and a title for the whole name', async () => {
    renderTab()
    const row = (await screen.findByText('Grantor A grant')).closest('tr')
    if (row === null) throw new Error('no row')
    const first = row.querySelector('td')
    expect(first?.textContent.startsWith('▸')).toBe(true)
    expect(first).toHaveAttribute('title', 'Grantor A grant')
  })

  it("a funder's header holds its name, terms, eligibility, contacts and the season's totals", async () => {
    renderTab()
    await screen.findByText('Grantor A grant')
    const header = rowByKey('funder:grantor_a')
    expect(within(header).getByText('Grantor A')).toBeInTheDocument()
    expect(within(header).getByText('Not full coverage')).toBeInTheDocument()
    expect(
      within(header).getByText('eligibility: First and second summers · 1 contact')
    ).toBeInTheDocument()
    expect(within(header).getByText('61')).toBeInTheDocument()
    expect(within(header).getByText('$44,100')).toBeInTheDocument()
    expect(
      within(rowByKey('funder:grantor_k')).getByText(
        /Named fund · Full coverage · covers canteen: no · pays after camp aid: yes/
      )
    ).toBeInTheDocument()
    // A funder no description sits under, and one no line names this season.
    expect(screen.getAllByText('No CampMinder description sits under it yet.')).toHaveLength(2)
    expect(within(rowByKey('funder:grantor_e')).getByText('0')).toBeInTheDocument()
  })

  it('draws each description under its funder with the registry columns, and "—" for a false yes/no (final audit O9)', async () => {
    renderTab()
    const row = (await screen.findByText('Grantor A grant')).closest('tr')
    if (row === null) throw new Error('no row')
    // "Pool A" comes from the second read (Funding sources): wait for it (R3-18).
    expect(await within(row).findByText('Pool A')).toBeInTheDocument()
    expect(within(row).getByText('other outside')).toBeInTheDocument()
    expect(within(row).getByText('Incentive')).toBeInTheDocument()
    expect(within(row).getByText('yes')).toBeInTheDocument()
    expect(within(row).getByText('—')).toBeInTheDocument()
    expect(within(row).queryByText('no')).toBeNull()
    expect(within(row).getByText('61')).toBeInTheDocument()
    expect(within(row).getByText('$98,400')).toBeInTheDocument()
    const fresh = rowByKey(REG_GRANTOR_E_NEW.id)
    expect(within(fresh).getByText('Needs a group')).toBeInTheDocument()
    expect(within(fresh).getByText('need-based')).toBeInTheDocument()
    const unclassified = (await screen.findByText('Returning-family bonus 2027')).closest('tr')
    if (unclassified === null) throw new Error('no row')
    expect(within(unclassified).getByText('Not yet classified')).toBeInTheDocument()
    expect(screen.getByText('Notes for money-sources')).toBeInTheDocument()
  })

  it('has no Paid by, Grantor or Last change column, no purpose line, and headers that do not sort', async () => {
    renderTab()
    await screen.findByText('Grantor A grant')
    // The note marks (§12) arrive with the definitions read: 1 Funder, 2 Incentive, 3 Reporting group, 4 Lines.
    await waitFor(() =>
      expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
        'Funder, then its descriptions in CampMinder1',
        'Source family',
        'Incentive or need-based2',
        'Counts as aid',
        'Counts toward the budget',
        'Reporting group3',
        'Lines this season4',
        '$ this season4',
      ])
    )
    expect(
      within(screen.getByRole('table')).queryAllByRole('button', { name: /season|group/ })
    ).toEqual([])
    expect(screen.queryByText(/One registry, two views/)).toBeNull()
    expect(screen.queryByText(/Who pays for camperships/)).toBeNull()
  })

  it('counts the switcher and filters in the URL: Needs a group both ways, No funder yet', async () => {
    // Final UX (design-language §18, owner: "shorten the filter choices"): the grey switcher with the counts
    // inside, "All 5 · Needs a group 2 · No funder yet 2"; the long words moved into each choice's title.
    renderTab()
    const all = await screen.findByRole('button', { name: 'All 5' })
    expect(all).toHaveAttribute('title', 'All 5 funders · 6 descriptions')
    const needs = screen.getByRole('button', { name: 'Needs a group 2' })
    expect(needs).toHaveAttribute(
      'title',
      '2 outside sources with no group · 1 with lines this season'
    )
    await userEvent.click(needs)
    expect(screen.getByTestId('where')).toHaveTextContent('?show=needs-group')
    expect(screen.queryByText('Grantor A grant')).toBeNull()
    expect(screen.getByText('Grantor C full-ride program')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'No funder yet 2' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?show=no-funder')
    expect(screen.getByText('Returning-family bonus 2027')).toBeInTheDocument()
    expect(screen.queryByText('Grantor C full-ride program')).toBeNull()
  })

  it('keeps search, New Funder… and Download CSV on the switcher`s one row, CSV last, with no sentence row', async () => {
    // Owner (feedback 5): "fit search and download csv onto the same line". The per-role sentence moved into
    // an (i) whose title holds it (answers §1a), so nothing sits between the toolbar and the table.
    renderTab()
    await screen.findByText('Grantor A grant')
    const bar = document.querySelector('[data-aid-toolbar]')
    if (!(bar instanceof HTMLElement)) throw new Error('no toolbar')
    expect(within(bar).getByRole('button', { name: 'All 5' })).toBeInTheDocument()
    expect(within(bar).getByRole('checkbox', { name: 'Show retired' })).toBeInTheDocument()
    expect(within(bar).getByLabelText('Search')).toBeInTheDocument()
    const buttons = within(bar).getAllByRole('button')
    expect(buttons.map((b) => b.textContent).slice(-2)).toEqual(['New Funder…', 'Download CSV'])
    const sentence =
      'Click a funder for its terms and contacts, or a description to classify it or set its group. Every change is logged with who and why.'
    expect(screen.queryByText(sentence)).toBeNull()
    expect(within(bar).getByTitle(sentence)).toBeInTheDocument()
  })

  it('shows retired funders on request, struck, and keeps them out of the table until then', async () => {
    renderTab()
    await screen.findByText('Grantor A grant')
    expect(screen.queryByText('Grantor F')).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show retired' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?retired=all')
    expect(screen.getByText('Grantor F')).toHaveClass('line-through')
  })

  it("searches a description on its funder's name and a header on its descriptions", async () => {
    renderTab()
    await screen.findByText('Grantor A grant')
    const search = screen.getByLabelText('Search')
    expect(search).toHaveAttribute('placeholder', 'Funder or description')
    // A header matches on its name (its empty row follows it), and not on a sibling's.
    await userEvent.type(search, 'gap-filler')
    expect(headerKeys()).toEqual(['funder:grantor_k'])
    expect(screen.getByText('No CampMinder description sits under it yet.')).toBeInTheDocument()
    // A header matches on a description under it; so does the description, and no other row.
    await userEvent.clear(search)
    await userEvent.type(search, 'full-ride')
    expect(headerKeys()).toEqual(['funder:grantor_c'])
    expect(screen.getByText('Grantor C full-ride program')).toBeInTheDocument()
    expect(screen.queryByText('Grantor A grant')).toBeNull()
  })

  it('reads the grantors with the season, retired included, behind the bearer token', async () => {
    renderTab()
    await screen.findByText('Grantor A grant')
    const read = calls().find((c) => c.url.startsWith(GRANTORS))
    expect(read?.auth).toBe('Bearer test-jwt')
    const query = new URL(read?.url ?? '', 'http://x').searchParams
    expect([query.get('include_retired'), query.get('year')]).toEqual(['true', '2027'])
  })
})

describe('links in', () => {
  it("opens the row a link names (?row=), in the rules' program words, its funder linked to Funders", async () => {
    renderTab('/aid/money/funders?row=srcgrantora0003')
    await waitFor(() => expect(document.querySelector('[data-panel="source"]')).not.toBeNull())
    const left = panel('source')
    // Final UX (money-funders.html fundsLine, star 19): the pool's words, not the program families'. The
    // groups arrive with the second read, so the first paint may say the programs; wait for the pool.
    await waitFor(() =>
      expect(left).toHaveTextContent(
        'Reporting group: Pool A · covers Summer Sessions, Quest, Teen'
      )
    )
    expect(left).not.toHaveTextContent('Programs it funds')
    expect(within(left).getByRole('link', { name: 'Grantor A' })).toHaveAttribute(
      'href',
      '/aid/money/funders?funder=grantor_a&year=2027'
    )
  })

  it("opens a funder's header from ?funder=, and ?grantor= is the same thing", async () => {
    renderTab('/aid/money/funders?funder=grantor_k')
    const panelK = await screen.findByTestId('grantor-panel')
    expect(
      within(panelK).getByText('Award terms: pays the rest after camp aid · no canteen')
    ).toBeInTheDocument()
  })

  it('takes the old ?grantor= link as ?funder=', async () => {
    renderTab(`/aid/money/funders?grantor=${GRANTOR_K.key}`)
    expect(await screen.findByTestId('grantor-panel')).toBeInTheDocument()
    expect(rowByKey('funder:grantor_k')).toHaveAttribute('data-highlighted', 'true')
  })

  it("opens a retired funder's header even while retired ones are hidden", async () => {
    renderTab('/aid/money/funders?funder=grantor_f')
    const retired = await screen.findByTestId('grantor-panel')
    expect(within(retired).getByRole('button', { name: 'Unretire…' })).toBeInTheDocument()
  })

  it("keeps the table's other URL params and swaps a row for a funder when one is opened", async () => {
    renderTab('/aid/money/funders?row=srcgrantora0003&show=needs-group&year=2027')
    await screen.findByText('Grantor C full-ride program')
    await userEvent.click(
      within(rowByKey('funder:grantor_c')).getAllByRole('cell')[0] as HTMLElement
    )
    const where = new URLSearchParams(screen.getByTestId('where').textContent)
    expect(where.get('funder')).toBe('grantor_c')
    expect(where.get('row')).toBeNull()
    expect(where.get('show')).toBe('needs-group')
    expect(where.get('year')).toBe('2027')
  })
})

describe('the registrar (view and casework): read only', () => {
  beforeEach(() => {
    granted = REGISTRAR
  })

  it('opens a description with nothing to change', async () => {
    renderTab()
    await openRow('Grantor A grant')
    expect(document.querySelector('[data-panel="edit"]')).toBeNull()
    expect(within(panel('source')).queryByRole('button')).toBeNull()
  })

  it('the No funder yet header gives a read-only user no instruction they cannot act on (final audit O10)', async () => {
    renderTab()
    await screen.findByText('Grantor A grant')
    const header = rowByKey('group:none')
    expect(within(header).getByText('Descriptions no funder claims yet')).toBeInTheDocument()
    expect(within(header).getByText('2 descriptions')).toBeInTheDocument()
    expect(within(header).queryByText(/Pick each description/)).toBeNull()
  })

  it('opens a funder with no buttons, no New Funder…, and says it is read only', async () => {
    renderTab()
    const panelA = await openFunder('grantor_a')
    expect(within(panelA).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('button', { name: 'New Funder…' })).toBeNull()
    // The per-role sentence is the (i)'s title now, not a line above the table (answers §1a).
    expect(screen.getByTitle(/^Read only for you/)).toBeInTheDocument()
    expect(screen.queryByText(/^Totals only/)).toBeNull()
  })
})

describe('a search that matches nothing (final audit E8)', () => {
  it('says nothing matches, not that there are no funders', async () => {
    renderTab()
    await screen.findByText('Grantor A grant')
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'zzzzqqq')
    expect(await screen.findByText('No funder or description matches.')).toBeInTheDocument()
    expect(screen.queryByText('No funders yet.')).toBeNull()
  })

  it('keeps "No funders yet." when nothing is typed and there are no rows', async () => {
    sourceReads = [{ ...SOURCES_2027, sources: [] }]
    grantorReads = [{ ...GRANTORS_ALL, grantors: [] }]
    renderTab()
    expect(await screen.findByText('No funders yet.')).toBeInTheDocument()
    expect(screen.queryByText('No funder or description matches.')).toBeNull()
  })
})

describe('finance (view, rules, grantors)', () => {
  it('classifies on a fresh read, checks again before sending, sends the whole record and refreshes the registry', async () => {
    renderTab()
    await openRow('Grantor A grant')
    await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Edit…' }))
    const editor = await screen.findByTestId('classify-editor')
    await userEvent.type(
      within(editor).getByRole('textbox', { name: 'Note' }),
      'Checked the letter'
    )
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    // The table's read, the editor's opening read, and the read just before sending.
    expect(getsBeforeWrite(SOURCES)).toHaveLength(3)
    expect(writes()[0]).toMatchObject({
      url: '/api/financial-aid/sources/srcgrantora0003',
      method: 'PATCH',
    })
    expect(JSON.parse(String(writes()[0]?.body))).toEqual({
      source_name: 'Grantor A',
      source_family: 'other_outside',
      funder_type: 'outside',
      counts_as_aid: true,
      counts_toward_budget: false,
      implied_program_families: ['summer'],
      note: 'Checked the letter',
    })
    expect(
      await screen.findByText('✓ Grantor A grant: classification saved, with your note.')
    ).toBeInTheDocument()
    await waitFor(() => expect(getsAfterWrite(SOURCES).length).toBeGreaterThan(0))
  })

  it('sends nothing when the row moved, keeps the typing, and the second Save keeps the other change (R3-1)', async () => {
    const moved: ApiAidSources = {
      ...SOURCES_2027,
      sources: SOURCES_2027.sources.map((s) =>
        s.id === REG_GRANTOR_A_GRANT.id ? { ...s, implied_program_families: ['family_camp'] } : s
      ),
    }
    sourceReads = [SOURCES_2027, SOURCES_2027, moved]
    renderTab()
    await openRow('Grantor A grant')
    await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Edit…' }))
    const editor = await screen.findByTestId('classify-editor')
    await userEvent.type(
      within(editor).getByRole('textbox', { name: 'Note' }),
      'Checked the letter'
    )
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    expect(
      await within(editor).findByText(
        'Someone changed this since you opened it: Programs. Nothing was saved. Your changes are kept; everything else now shows the latest. Save again to put your edit in its place.'
      )
    ).toBeInTheDocument()
    expect(writes()).toHaveLength(0)
    expect(within(editor).getByRole('textbox', { name: 'Note' })).toHaveValue('Checked the letter')
    // The rebased programs read in pool words now: family_camp is Pool B's (final UX star 19).
    expect(
      within(editor).getByRole('button', { name: 'Reporting groups: Pool B' })
    ).toBeInTheDocument()
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(JSON.parse(String(writes()[0]?.body))).toMatchObject({
      implied_program_families: ['family_camp'],
      note: 'Checked the letter',
    })
  })

  it("shows the server's group sentence when the programs change", async () => {
    renderTab()
    await openRow('Grantor A grant')
    await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Edit…' }))
    const editor = await screen.findByTestId('classify-editor')
    const warning = 'Changing this re-places household-level lines on the next ledger sync.'
    expect(within(editor).queryByText(warning)).toBeNull()
    // Picking another group moves the stored programs, so the sentence shows (star 19: pools, not eight boxes).
    await pickOption(editor, 'Reporting groups', 'Pool B')
    expect(within(editor).getByText(warning)).toBeInTheDocument()
  })

  it("Set a Group… writes development's route: one pool, the flag, and refreshes Funding sources", async () => {
    renderTab()
    await openRow('Grantor E grant 2027')
    await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Set a Group…' }))
    const editor = await screen.findByTestId('group-editor')
    expect(within(editor).getByRole('button', { name: 'Save' })).toBeDisabled()
    await pickOption(editor, 'Reporting group', 'Pool A')
    expect(
      within(editor).getByText(
        'Changing this re-places household-level lines on the next ledger sync.'
      )
    ).toBeInTheDocument()
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({
      url: '/api/financial-aid/reports/2027/funding-sources/srcgrantore0005',
      method: 'PUT',
      body: JSON.stringify({ group: 'pool_a', incentive: false }),
    })
    expect(
      await screen.findByText('✓ Grantor E grant 2027: reporting group Pool A, need-based.')
    ).toBeInTheDocument()
    await waitFor(() => expect(getsAfterWrite(GROUPS).length).toBeGreaterThan(0))
  })

  it('Set a Group… sends nothing when the source moved, then keeps the other change (R3-1, R3-17)', async () => {
    const e = FUNDING_SOURCES_2027.sources.find((f) => f.source_id === REG_GRANTOR_E_NEW.id)
    if (e === undefined) throw new Error('no Grantor E funding source')
    const moved: ApiAidFundingSources = {
      ...FUNDING_SOURCES_2027,
      sources: FUNDING_SOURCES_2027.sources.map((f) =>
        f.source_id === e.source_id ? { ...f, incentive: !e.incentive } : f
      ),
    }
    // The tab's read, the editor's read as it opens, then the move just before the send.
    fundingReads = [FUNDING_SOURCES_2027, FUNDING_SOURCES_2027, moved]
    renderTab()
    await openRow('Grantor E grant 2027')
    await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Set a Group…' }))
    const editor = await screen.findByTestId('group-editor')
    await pickOption(editor, 'Reporting group', 'Pool A')
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    expect(
      await within(editor).findByText(/^Someone changed this since you opened it: Incentive\./)
    ).toBeInTheDocument()
    expect(writes()).toHaveLength(0)
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(JSON.parse(String(writes()[0]?.body))).toEqual({
      group: 'pool_a',
      incentive: !e.incentive,
    })
  })

  it('offers no funder on a camp-aid description, and asks to classify an unclassified one first', async () => {
    granted = ['financial_aid.view', 'financial_aid.grantors']
    renderTab()
    await openRow('Sibling discount')
    // R3-12: a grantors-only person on a camp-aid row gets no right panel at all.
    expect(document.querySelector('[data-panel="edit"]')).toBeNull()
    await openRow('Returning-family bonus 2027')
    expect(
      within(panel('edit')).getByText(
        'Classify this description first: only an outside grant names a grantor.'
      )
    ).toBeInTheDocument()
  })

  describe('a funder, from its header (grantors)', () => {
    it('opens with its descriptions linked to their rows, and its terms in words', async () => {
      renderTab()
      const panelA = await openFunder('grantor_a')
      expect(within(panelA).getByRole('link', { name: 'Grantor A grant ›' })).toHaveAttribute(
        'href',
        '/aid/money/funders?row=srcgrantora0003&year=2027'
      )
      expect(
        within(panelA).getByText('Contacts: Test User, test@example.com, 555-0100')
      ).toBeInTheDocument()
    })

    it('creates a funder, the key suggested from the name, and refreshes the grantors', async () => {
      answers = [json(GRANTOR_A, 201)]
      renderTab()
      await userEvent.click(await screen.findByRole('button', { name: 'New Funder…' }))
      const form = screen.getByTestId('grantor-form')
      expect(within(form).getByText('New funder')).toBeInTheDocument()
      expect(within(form).getByText(/map to a funder on their own row\./)).toBeInTheDocument()
      await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'Grantor G')
      // Final audit E7: the key is internal; the form draws no Key field and it still follows the name.
      expect(within(form).queryByRole('textbox', { name: 'Key' })).toBeNull()
      await userEvent.click(within(form).getByRole('checkbox', { name: 'Full coverage' }))
      await userEvent.click(
        within(form).getByRole('checkbox', { name: 'Pays the rest after camp aid' })
      )
      await pickOption(form, 'Covers the canteen deposit', 'no')
      await userEvent.type(
        within(form).getByRole('textbox', { name: 'Note' }),
        'From the seed review'
      )
      await userEvent.click(within(form).getByRole('button', { name: 'Save Funder' }))
      await waitFor(() => expect(writes()).toHaveLength(1))
      expect(writes()[0]).toMatchObject({ url: GRANTORS, method: 'POST' })
      expect(JSON.parse(String(writes()[0]?.body))).toEqual({
        key: 'grantor_g',
        name: 'Grantor G',
        aliases: [],
        full_coverage: true,
        covers_canteen: 'no',
        pays_after_camp_aid: true,
        eligibility: '',
        contacts: '',
        note: 'From the seed review',
      })
      expect(await screen.findByText('✓ Grantor G: created, with your note.')).toBeInTheDocument()
      await waitFor(() => expect(getsAfterWrite(GRANTORS).length).toBeGreaterThan(0))
    })

    it('closes the New Funder form once the funder is created', async () => {
      answers = [json(GRANTOR_A, 201)]
      renderTab()
      await userEvent.click(await screen.findByRole('button', { name: 'New Funder…' }))
      const form = screen.getByTestId('grantor-form')
      await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'Grantor G')
      await userEvent.type(within(form).getByRole('textbox', { name: 'Note' }), 'x')
      await userEvent.click(within(form).getByRole('button', { name: 'Save Funder' }))
      expect(await screen.findByText('✓ Grantor G: created, with your note.')).toBeInTheDocument()
      expect(screen.queryByTestId('grantor-form')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'New Funder…' })).toBeInTheDocument()
    })

    it("shows a taken key in the server's words, not as a race", async () => {
      answers = [json({ detail: "a grantor with key 'grantor_g' already exists" }, 409)]
      renderTab()
      await userEvent.click(await screen.findByRole('button', { name: 'New Funder…' }))
      const form = screen.getByTestId('grantor-form')
      await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'Grantor G')
      await userEvent.type(within(form).getByRole('textbox', { name: 'Note' }), 'x')
      await userEvent.click(within(form).getByRole('button', { name: 'Save Funder' }))
      expect(
        await within(form).findByText(
          "Nothing was written: a grantor with key 'grantor_g' already exists"
        )
      ).toBeInTheDocument()
    })

    it('⚠ edits on a fresh read and sends nothing when it moved meanwhile; a second Save sends (P-9)', async () => {
      const renamed: ApiAidGrantors = {
        grantors: GRANTORS_ALL.grantors.map((g) =>
          g.key === 'grantor_a' ? { ...g, name: 'Grantor A Fund' } : g
        ),
      }
      // The table's read, the form's fresh read on open, then the check before Save finds a rename.
      grantorReads = [GRANTORS_ALL, GRANTORS_ALL, renamed]
      renderTab('/aid/money/funders?funder=grantor_a')
      const panelA = await screen.findByTestId('grantor-panel')
      await userEvent.click(within(panelA).getByRole('button', { name: 'Edit…' }))
      const form = within(panelA).getByTestId('grantor-form')
      await userEvent.type(within(form).getByRole('textbox', { name: 'Note' }), 'New contact')
      await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
      expect(
        await within(form).findByText(/Someone changed this since you opened it: Name\./)
      ).toBeInTheDocument()
      expect(writes()).toHaveLength(0)
      expect(within(form).getByRole('textbox', { name: 'Note' })).toHaveValue('New contact')
      // R3-1: re-based: the other person's rename shows, and the second Save keeps it.
      expect(within(form).getByRole('textbox', { name: 'Name' })).toHaveValue('Grantor A Fund')
      await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(writes()).toHaveLength(1))
      expect(writes()[0]).toMatchObject({ url: `${GRANTORS}/grantor_a`, method: 'PUT' })
      expect(JSON.parse(String(writes()[0]?.body))).toMatchObject({
        name: 'Grantor A Fund',
        note: 'New contact',
      })
    })

    it("⚠ typing that starts before the open read lands still takes the other person's change in fields it left alone (R3-1)", async () => {
      const renamed: ApiAidGrantors = {
        grantors: GRANTORS_ALL.grantors.map((g) =>
          g.key === 'grantor_a' ? { ...g, name: 'Grantor A Fund' } : g
        ),
      }
      renderTab('/aid/money/funders?funder=grantor_a')
      const panelA = await screen.findByTestId('grantor-panel')
      // Hold the form's open read until the person has typed.
      let release: (response: Response) => void = () => undefined
      const held = new Promise<Response>((resolve) => {
        release = resolve
      })
      fetchSpy.mockImplementation((input, init) => {
        if ((init?.method ?? 'GET') !== 'GET') return Promise.resolve(json(GRANTOR_A))
        if (String(input).startsWith(GRANTORS)) {
          // The first read after the click is held; any later read answers at once.
          fetchSpy.mockImplementation((later) =>
            Promise.resolve(
              json(
                String(later).startsWith(GRANTORS)
                  ? renamed
                  : String(later).includes('/rules/')
                    ? RULES_2027
                    : SOURCES_2027
              )
            )
          )
          return held
        }
        if (String(input).includes('/rules/')) return Promise.resolve(json(RULES_2027))
        return Promise.resolve(json(SOURCES_2027))
      })
      await userEvent.click(within(panelA).getByRole('button', { name: 'Edit…' }))
      const form = within(panelA).getByTestId('grantor-form')
      await userEvent.type(within(form).getByRole('textbox', { name: 'Note' }), 'New contact')
      release(json(renamed))
      await waitFor(() =>
        expect(within(form).getByRole('textbox', { name: 'Name' })).toHaveValue('Grantor A Fund')
      )
      expect(within(form).getByRole('textbox', { name: 'Note' })).toHaveValue('New contact')
      await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(writes()).toHaveLength(1))
    })

    it('keeps Retire… off while a description maps to the funder, and says why', async () => {
      renderTab('/aid/money/funders?funder=grantor_a')
      const panelA = await screen.findByTestId('grantor-panel')
      expect(within(panelA).getByRole('button', { name: 'Retire…' })).toBeDisabled()
      expect(
        within(panelA).getByText(
          '1 CampMinder description still maps to it. Map it to another funder first.'
        )
      ).toBeInTheDocument()
    })

    it("retires one nothing maps to, with a reason, and shows the server's sentence when an open grant names it", async () => {
      answers = [
        json(
          {
            detail: {
              message:
                "Grantor K gap-filler award can't be retired yet: 1 open grant still names it. Move it to another grantor or withdraw it first.",
              descriptions: 0,
              grants: 1,
            },
          },
          409
        ),
      ]
      renderTab(`/aid/money/funders?funder=${GRANTOR_K.key}`)
      const panelK = await screen.findByTestId('grantor-panel')
      await userEvent.click(within(panelK).getByRole('button', { name: 'Retire…' }))
      await userEvent.type(
        within(panelK).getByRole('textbox', { name: 'Why' }),
        'Merged into Grantor B'
      )
      await userEvent.click(within(panelK).getByRole('button', { name: 'Retire' }))
      expect(
        await within(panelK).findByText(
          "Nothing was written: Grantor K gap-filler award can't be retired yet: 1 open grant still names it. Move it to another grantor or withdraw it first."
        )
      ).toBeInTheDocument()
      expect(writes()[0]).toEqual({
        url: `${GRANTORS}/grantor_k/retire`,
        method: 'POST',
        auth: 'Bearer test-jwt',
        body: JSON.stringify({ reason: 'Merged into Grantor B' }),
      })
    })

    it('retires, then refreshes the grantors', async () => {
      renderTab(`/aid/money/funders?funder=${GRANTOR_K.key}`)
      const panelK = await screen.findByTestId('grantor-panel')
      await userEvent.click(within(panelK).getByRole('button', { name: 'Retire…' }))
      await userEvent.type(
        within(panelK).getByRole('textbox', { name: 'Why' }),
        'Merged into Grantor B'
      )
      await userEvent.click(within(panelK).getByRole('button', { name: 'Retire' }))
      await waitFor(() => expect(writes()).toHaveLength(1))
      expect(writes()[0]).toMatchObject({ url: `${GRANTORS}/grantor_k/retire`, method: 'POST' })
      await waitFor(() => expect(getsAfterWrite(GRANTORS).length).toBeGreaterThan(0))
    })

    it('unretires a retired funder with a reason', async () => {
      renderTab('/aid/money/funders?retired=all&funder=grantor_f')
      const panelF = await screen.findByTestId('grantor-panel')
      expect(within(panelF).queryByRole('button', { name: 'Edit…' })).toBeNull()
      await userEvent.click(within(panelF).getByRole('button', { name: 'Unretire…' }))
      await userEvent.type(
        within(panelF).getByRole('textbox', { name: 'Why' }),
        'Still funds weekends'
      )
      await userEvent.click(within(panelF).getByRole('button', { name: 'Unretire' }))
      await waitFor(() => expect(writes()).toHaveLength(1))
      expect(writes()[0]).toMatchObject({ url: `${GRANTORS}/grantor_f/unretire`, method: 'POST' })
      expect(JSON.parse(String(writes()[0]?.body))).toEqual({ reason: 'Still funds weekends' })
      expect(
        await screen.findByText('✓ Grantor F: unretired, with your reason.')
      ).toBeInTheDocument()
    })
  })

  describe('typing during the pre-send re-check is what gets sent', () => {
    /** Hold the next read whose URL starts with `prefix`; the returned function releases it. */
    const holdReads = (prefix: string, body: unknown) => {
      const normal = fetchSpy.getMockImplementation()
      let release: (r: Response) => void = () => undefined
      const held = new Promise<Response>((resolve) => {
        release = resolve
      })
      fetchSpy.mockImplementation((url, init) =>
        String(url).startsWith(prefix) && (init?.method ?? 'GET') === 'GET'
          ? held
          : (normal?.(url, init) as Promise<Response>)
      )
      return () => release(json(body))
    }

    it('Classify sends the note as it stands when the re-check lands', async () => {
      renderTab()
      await openRow('Grantor A grant')
      await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Edit…' }))
      const editor = await screen.findByTestId('classify-editor')
      const note = within(editor).getByRole('textbox', { name: 'Note' })
      await userEvent.type(note, 'First part')
      const release = holdReads(SOURCES, SOURCES_2027)
      await userEvent.click(within(editor).getByRole('button', { name: 'Save' }))
      await userEvent.type(note, ' and more')
      release()
      await waitFor(() => expect(writes()).toHaveLength(1))
      expect(JSON.parse(String(writes()[0]?.body))).toMatchObject({ note: 'First part and more' })
    })

    it('Set a Group… sends the pick and note as they stand when the re-check lands', async () => {
      renderTab()
      await openRow('Grantor E grant 2027')
      await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Set a Group…' }))
      const editor = await screen.findByTestId('group-editor')
      await pickOption(editor, 'Reporting group', 'Pool A')
      const release = holdReads(GROUPS, FUNDING_SOURCES_2027)
      await userEvent.click(within(editor).getByRole('button', { name: 'Save' }))
      await userEvent.type(
        within(editor).getByRole('textbox', { name: 'Note (optional)' }),
        'Late note'
      )
      release()
      await waitFor(() => expect(writes()).toHaveLength(1))
      expect(JSON.parse(String(writes()[0]?.body))).toEqual({
        group: 'pool_a',
        incentive: false,
        note: 'Late note',
      })
    })

    it('Map a Funder… sends the note as it stands when the re-check lands', async () => {
      renderTab()
      await openRow('Grantor E grant 2027')
      await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Map a Funder…' }))
      const field = await screen.findByTestId('grantor-field')
      await waitFor(() =>
        expect(within(field).getByRole('button', { name: /^Funder:/ })).toBeEnabled()
      )
      await pickOption(field, 'Funder', 'Grantor E')
      const note = within(field).getByRole('textbox', { name: 'Note' })
      await userEvent.type(note, 'New')
      const release = holdReads(SOURCES, SOURCES_2027)
      await userEvent.click(within(field).getByRole('button', { name: 'Save' }))
      await userEvent.type(note, ' for 2027')
      release()
      await waitFor(() => expect(writes()).toHaveLength(1))
      expect(JSON.parse(String(writes()[0]?.body))).toEqual({
        grantor_key: 'grantor_e',
        note: 'New for 2027',
      })
    })
  })
})

describe("a description's funder (grantors, no rules)", () => {
  beforeEach(() => {
    granted = ['financial_aid.view', 'financial_aid.grantors']
  })

  it('maps a description to a funder in use, with a note, and refreshes the registry', async () => {
    renderTab()
    await openRow('Grantor E grant 2027')
    const edit = panel('edit')
    expect(within(edit).queryByRole('button', { name: 'Edit…' })).toBeNull()
    // Owner 10-09: `grantors` carries Set a Group too (funding_sources was folded into it).
    expect(within(edit).getByRole('button', { name: 'Set a Group…' })).toBeInTheDocument()
    await userEvent.click(within(edit).getByRole('button', { name: 'Map a Funder…' }))
    const field = await screen.findByTestId('grantor-field')
    // Funders says "funder" to staff, never "grantor" (coordinator 10-09).
    await waitFor(() =>
      expect(within(field).getByRole('button', { name: /^Funder:/ })).toBeEnabled()
    )
    await openPicker(field, 'Funder')
    expect(await screen.findByRole('option', { name: '— no funder —' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: 'Grantor E' }))
    await userEvent.type(within(field).getByRole('textbox', { name: 'Note' }), 'New for 2027')
    await userEvent.click(within(field).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toEqual({
      url: '/api/financial-aid/sources/srcgrantore0005/grantor',
      method: 'PUT',
      auth: 'Bearer test-jwt',
      body: JSON.stringify({ grantor_key: 'grantor_e', note: 'New for 2027' }),
    })
    await waitFor(() => expect(getsAfterWrite(SOURCES).length).toBeGreaterThan(0))
  })

  it('sends nothing when the funder moved under it (R3-17), and keeps the pick', async () => {
    const moved: ApiAidSources = {
      ...SOURCES_2027,
      sources: SOURCES_2027.sources.map((s) =>
        s.id === REG_GRANTOR_E_NEW.id ? { ...s, grantor_key: 'grantor_a' } : s
      ),
    }
    sourceReads = [SOURCES_2027, SOURCES_2027, moved]
    renderTab()
    await openRow('Grantor E grant 2027')
    await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Map a Funder…' }))
    const field = await screen.findByTestId('grantor-field')
    await waitFor(() =>
      expect(within(field).getByRole('button', { name: /^Funder:/ })).toBeEnabled()
    )
    await pickOption(field, 'Funder', 'Grantor E')
    await userEvent.type(within(field).getByRole('textbox', { name: 'Note' }), 'New for 2027')
    await userEvent.click(within(field).getByRole('button', { name: 'Save' }))
    expect(
      await within(field).findByText(/^Someone changed this since you opened it: Grantor\./)
    ).toBeInTheDocument()
    expect(writes()).toHaveLength(0)
    expect(within(field).getByRole('button', { name: 'Funder: Grantor E' })).toBeInTheDocument()
    await userEvent.click(within(field).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
  })

  it('shows a retired funder the description still maps to, disabled, and links to it in Funders (P-13)', async () => {
    sourceReads = [
      {
        ...SOURCES_2027,
        sources: SOURCES_2027.sources.map((s) =>
          s.id === REG_GRANTOR_A_GRANT.id
            ? { ...s, grantor_key: 'grantor_f', grantor_name: 'Grantor F' }
            : s
        ),
      },
    ]
    renderTab()
    await openRow('Grantor A grant')
    await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Change the Funder…' }))
    const field = await screen.findByTestId('grantor-field')
    await waitFor(() =>
      expect(
        within(field).getByRole('button', { name: 'Funder: Grantor F (retired)' })
      ).toBeEnabled()
    )
    await openPicker(field, 'Funder')
    expect(await screen.findByRole('option', { name: /Grantor F \(retired\)/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    expect(screen.queryByRole('option', { name: 'Grantor F' })).toBeNull()
    await userEvent.keyboard('{Escape}')
    expect(
      within(field).getByText('Grantor F is retired: pick a funder in use, or', { exact: false })
    ).toBeInTheDocument()
    expect(
      within(field).getByRole('link', { name: 'Unretire It in Money › Funders' })
    ).toHaveAttribute('href', '/aid/money/funders?funder=grantor_f&year=2027')
    await userEvent.type(within(field).getByRole('textbox', { name: 'Note' }), 'x')
    expect(within(field).getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

describe('development (summary, grantors; no view)', () => {
  beforeEach(() => {
    granted = DEVELOPMENT
  })

  it('sees group and incentive and funder edits, but no classify', async () => {
    renderTab()
    await openRow('Grantor E grant 2027')
    const edit = panel('edit')
    expect(within(edit).getByRole('button', { name: 'Set a Group…' })).toBeInTheDocument()
    expect(within(edit).getByRole('button', { name: 'Map a Funder…' })).toBeInTheDocument()
    expect(within(edit).queryByRole('button', { name: /^Edit…$|^Classify…$/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'New Funder…' })).toBeInTheDocument()
  })

  it("Set a Group… writes development's own route, as for finance", async () => {
    renderTab()
    await openRow('Grantor E grant 2027')
    await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Set a Group…' }))
    const editor = await screen.findByTestId('group-editor')
    await pickOption(editor, 'Reporting group', 'Pool A')
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({
      url: '/api/financial-aid/reports/2027/funding-sources/srcgrantore0005',
      method: 'PUT',
    })
    expect(JSON.parse(String(writes()[0]?.body))).toEqual({ group: 'pool_a', incentive: false })
    await waitFor(() => expect(getsAfterWrite(GROUPS).length).toBeGreaterThan(0))
  })

  it('edits a funder, and Edit… on the header is its own', async () => {
    renderTab()
    const panelA = await openFunder('grantor_a')
    expect(within(panelA).getByRole('button', { name: 'Edit…' })).toBeInTheDocument()
  })

  it('says totals only, links no household, and fires only the reads development may make', async () => {
    renderTab()
    await screen.findByText('Grantor A grant')
    expect(
      screen.getByText('Totals only: no family is named, listed or linked on this tab.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    for (const { url } of calls()) {
      expect(url).toMatch(
        /^\/api\/financial-aid\/(sources|grantors|definitions|reports\/2027\/funding-sources)/
      )
    }
    // Development's header says what it may do: it does not classify.
    expect(
      within(rowByKey('group:none')).getByText("Pick each description's funder")
    ).toBeInTheDocument()
    expect(within(rowByKey('group:none')).getByText('2 descriptions')).toBeInTheDocument()
  })

  it('does not say totals only to someone who can see the families', async () => {
    granted = FINANCE
    renderTab()
    await screen.findByText('Grantor A grant')
    expect(screen.queryByText(/^Totals only/)).toBeNull()
  })
})

// Final UX (design-language §24, money-funders.html; owner 10-09: "a pass through any other creation/edit type
// popout boxes"): every editor reachable from Funders is wide and short, its selects are the white picker, and
// its Title Case buttons share one row with the required or logged line.
describe('the editors in the final design (§24)', () => {
  const noteOf = (scope: HTMLElement) => within(scope).getByRole('textbox', { name: 'Note' })

  it('Edit… picks the season`s reporting groups instead of eight program boxes (star 19, rev1)', async () => {
    renderTab()
    await openRow('Grantor A grant')
    await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Edit…' }))
    const editor = await screen.findByTestId('classify-editor')
    // The eight ledger program families are gone: no "Bmitzvah", "Family school", "Other" boxes.
    for (const name of ['Summer Sessions', 'Quest', 'Teen', 'Bmitzvah', 'Family school', 'Other']) {
      expect(within(editor).queryByRole('checkbox', { name })).toBeNull()
    }
    expect(within(editor).getByText('Funds (its reporting group)')).toBeInTheDocument()
    expect(within(editor).queryByText(/Programs it funds/)).toBeNull()
    expect(
      within(editor).getByRole('button', { name: 'Reporting groups: Pool A' })
    ).toBeInTheDocument()
    // "Covers:" names the rules' programs the pool covers, in the rules' words and order.
    expect(within(editor).getByText('Covers: Summer Sessions, Quest, Teen')).toBeInTheDocument()
    // Every select is the white picker.
    expect(editor.querySelectorAll('select')).toHaveLength(0)
  })

  it('saves the union of the picked pools families, and the Covers line follows the picks', async () => {
    renderTab()
    await openRow('Grantor A grant')
    await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Edit…' }))
    const editor = await screen.findByTestId('classify-editor')
    await pickOption(editor, 'Reporting groups', 'Pool B')
    // The multi picker stays open while it is checked; close it to reach the rest of the editor.
    await userEvent.keyboard('{Escape}')
    expect(
      within(editor).getByRole('button', { name: 'Reporting groups: Pool A, Pool B' })
    ).toBeInTheDocument()
    expect(
      within(editor).getByText(
        'Covers: Summer Sessions, Quest, Teen (Pool A) · Family Camp Weekends (Pool B)'
      )
    ).toBeInTheDocument()
    await userEvent.type(noteOf(editor), 'Funds weekend families too')
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(JSON.parse(String(writes()[0]?.body))).toMatchObject({
      implied_program_families: ['family_camp', 'quest', 'summer', 'teen'],
    })
  })

  it('puts Save, Back and what is missing on one row', async () => {
    renderTab()
    await openRow('Grantor A grant')
    await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Edit…' }))
    const editor = await screen.findByTestId('classify-editor')
    const save = within(editor).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    const row = save.parentElement as HTMLElement
    expect(within(row).getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(within(row).getByText('A note is required (it is logged)')).toBeInTheDocument()
  })

  it('Set a Group… names what the group covers, and says why Save waits', async () => {
    renderTab()
    await openRow('Grantor E grant 2027')
    await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Set a Group…' }))
    const editor = await screen.findByTestId('group-editor')
    expect(within(editor).getByText('Set a Group · Grantor E grant 2027')).toBeInTheDocument()
    const save = within(editor).getByRole('button', { name: 'Save' })
    expect(
      within(save.parentElement as HTMLElement).getByText('Nothing to save yet.')
    ).toBeVisible()
    expect(editor.querySelectorAll('select')).toHaveLength(0)
    await pickOption(editor, 'Reporting group', 'Pool A')
    expect(within(editor).getByText('Covers: Summer Sessions, Quest, Teen')).toBeInTheDocument()
    expect(within(editor).queryByText('Nothing to save yet.')).toBeNull()
  })

  it('Map a Funder… is titled with the description and keeps its buttons on one row', async () => {
    renderTab()
    await openRow('Grantor E grant 2027')
    await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Map a Funder…' }))
    const field = await screen.findByTestId('grantor-field')
    expect(within(field).getByText('Funder · Grantor E grant 2027')).toBeInTheDocument()
    const save = within(field).getByRole('button', { name: 'Save' })
    expect(
      within(save.parentElement as HTMLElement).getByRole('button', { name: 'Back' })
    ).toBeVisible()
    expect(field.querySelectorAll('select')).toHaveLength(0)
  })

  describe('New Funder… and Edit… (rev1: 230px to 175px)', () => {
    it('is wide and short: Full coverage and its two choices sit in the right column, shown off, not hidden', async () => {
      renderTab()
      await userEvent.click(await screen.findByRole('button', { name: 'New Funder…' }))
      const form = screen.getByTestId('grantor-form')
      const full = within(form).getByRole('checkbox', { name: 'Full coverage' })
      const canteen = within(form).getByRole('button', {
        name: 'Covers the canteen deposit: not known',
      })
      const after = within(form).getByRole('checkbox', { name: 'Pays the rest after camp aid' })
      // The right column is the one with the dashed rule; the name, aliases, eligibility, contacts, note are left.
      const side = full.closest('[class*="border-dashed"]')
      expect(side).not.toBeNull()
      expect(side?.contains(canteen)).toBe(true)
      expect(side?.contains(after)).toBe(true)
      expect(side?.contains(within(form).getByRole('textbox', { name: 'Name' }))).toBe(false)
      // Shown, switched off while Full coverage is off.
      expect(canteen).toBeDisabled()
      expect(after).toBeDisabled()
      await userEvent.click(full)
      expect(canteen).toBeEnabled()
      expect(after).toBeEnabled()
      expect(form.querySelectorAll('select')).toHaveLength(0)
    })

    it('says Save Funder for a new one, Save for an edit, with the required line on the buttons` row', async () => {
      renderTab()
      await userEvent.click(await screen.findByRole('button', { name: 'New Funder…' }))
      const form = screen.getByTestId('grantor-form')
      const save = within(form).getByRole('button', { name: 'Save Funder' })
      expect(save).toBeDisabled()
      const row = save.parentElement as HTMLElement
      expect(within(row).getByRole('button', { name: 'Back' })).toBeInTheDocument()
      expect(within(row).getByText('A name and a note are required.')).toBeInTheDocument()
      expect(within(row).getByText(/Logged with who and why/)).toBeInTheDocument()
      await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'Grantor G')
      await userEvent.type(noteOf(form), 'x')
      expect(save).toBeEnabled()
      expect(within(row).queryByText('A name and a note are required.')).toBeNull()
    })

    it('an edit takes the whole opened row, not its right third', async () => {
      renderTab('/aid/money/funders?funder=grantor_a')
      const panelA = await screen.findByTestId('grantor-panel')
      expect(panelA.querySelector('[data-panel="grantor"]')).not.toBeNull()
      await userEvent.click(within(panelA).getByRole('button', { name: 'Edit…' }))
      const form = await within(panelA).findByTestId('grantor-form')
      expect(within(form).getByText('Editing · Grantor A')).toBeInTheDocument()
      expect(within(form).getByRole('button', { name: 'Save' })).toBeInTheDocument()
      expect(panelA.querySelector('[data-panel="grantor"]')).toBeNull()
      expect(panelA.querySelector('[data-panel="actions"]')).toBeNull()
    })
  })

  it('Retire… and Unretire… are the wide, short reason editor with Title Case buttons on one row', async () => {
    renderTab(`/aid/money/funders?funder=${GRANTOR_K.key}`)
    const panelK = await screen.findByTestId('grantor-panel')
    await userEvent.click(within(panelK).getByRole('button', { name: 'Retire…' }))
    expect(within(panelK).getByText(`Retire ${GRANTOR_K.name}`)).toBeInTheDocument()
    const retire = within(panelK).getByRole('button', { name: 'Retire' })
    expect(
      within(retire.parentElement as HTMLElement).getByRole('button', { name: 'Back' })
    ).toBeVisible()
  })
})

describe('development sees the same table and toolbar (owner item 6: "correct")', () => {
  it('has the switcher, Show retired, search and New Funder… on the one row, and no sentence line', async () => {
    granted = DEVELOPMENT
    renderTab()
    await screen.findByText('Grantor A grant')
    const bar = document.querySelector('[data-aid-toolbar]')
    if (!(bar instanceof HTMLElement)) throw new Error('no toolbar')
    expect(within(bar).getByRole('button', { name: 'All 5' })).toBeInTheDocument()
    expect(within(bar).getByRole('checkbox', { name: 'Show retired' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'New Funder…' })).toBeInTheDocument()
    expect(within(bar).getByLabelText('Search')).toBeInTheDocument()
    expect(
      screen.queryByText(/^Click a funder for its terms and contacts, or a description to set/)
    ).toBeNull()
    expect(
      within(bar).getByTitle(/^Click a funder for its terms and contacts, or a description to set/)
    ).toBeInTheDocument()
  })
})
