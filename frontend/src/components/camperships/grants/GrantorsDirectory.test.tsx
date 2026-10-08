/**
 * Grants › Grantors through its real hooks (spec §8.2; D57, D86, D143, D160; P-9, P-19, P-20; owner
 * 10-06, rulings:676): who may edit, the season columns and the server's note, the descriptions' links,
 * the award terms, retired grantors, create, edit on a fresh read, retire and unretire.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type {
  ApiAidDefinitions,
  ApiAidGrantorDescription,
  ApiAidGrantors,
} from '../../../types/api-types'
import { aidHref } from '../kit/asOf'
import { GRANTOR_A, GRANTOR_K, GRANTORS_ALL } from './grantorDirectoryFixtures'
import { GrantorsDirectory } from './GrantorsDirectory'

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

/** The server's "Grants this season" note (bunking/financial_aid/definitions.py, key grantor_season). */
const SEASON_NOTE =
  "Grants this season: a grantor's live CampMinder grant lines this season (a line still waiting for its camper included) and their net. A reversed line and a commitment not yet in CampMinder are left out."
const DEFINITIONS: ApiAidDefinitions = {
  surface: 'grants',
  notes: [
    { key: 'grants', n: 1, text: 'Grants: outside money.' },
    { key: 'grantor_season', n: 5, text: SEASON_NOTE },
  ],
}
const VIEW = { year: 2027, asOf: { kind: 'live' } as const }
const FINANCE = [
  'financial_aid.view',
  'financial_aid.casework',
  'financial_aid.rules',
  'financial_aid.grantors',
]
const DEVELOPMENT = [
  'financial_aid.summary',
  'financial_aid.funding_sources',
  'financial_aid.grantors',
]
const REGISTRAR = ['financial_aid.view', 'financial_aid.casework']

let reads: ApiAidGrantors[] = []
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

beforeEach(() => {
  granted = FINANCE
  reads = [GRANTORS_ALL]
  answers = []
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input)
    if ((init?.method ?? 'GET') !== 'GET')
      return Promise.resolve(answers.shift() ?? json(GRANTOR_A))
    if (url.startsWith('/api/financial-aid/definitions')) return Promise.resolve(json(DEFINITIONS))
    const next = reads.length > 1 ? reads.shift() : reads[0]
    return Promise.resolve(json(next ?? GRANTORS_ALL))
  })
})
afterEach(() => fetchSpy.mockRestore())

function Where() {
  const { search } = useLocation()
  return <div data-testid="where">{search}</div>
}

/** What Grants passes a `view` holder: a description links to its Money › Sources row. */
const SOURCES_HREF = (d: ApiAidGrantorDescription) =>
  aidHref('/aid/money/sources', VIEW, { row: d.source_id })

/** `null`: a host that gives no link (a default parameter would replace `undefined`). */
function renderDirectory(
  path = '/aid/grants/grantors',
  descriptionHref: ((d: ApiAidGrantorDescription) => string | null) | null = SOURCES_HREF
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <GrantorsDirectory view={VIEW} descriptionHref={descriptionHref ?? undefined} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('the grantor directory (§8.2; D160; P-19)', () => {
  it("reads the season's grantors, retired included, and shows grants and $ this season with the server's note", async () => {
    renderDirectory()
    const row = (await screen.findByText('Grantor A')).closest('tr') as HTMLElement
    expect(within(row).getByText('61')).toBeInTheDocument()
    expect(within(row).getByText('$44,100')).toBeInTheDocument()
    // A grantor no line names this season: 0 grants, and "—" for its dollars (beside Full coverage's "—").
    const quiet = screen.getByText('Grantor E').closest('tr') as HTMLElement
    expect(within(quiet).getByText('0')).toBeInTheDocument()
    expect(within(quiet).getAllByText('—')).toHaveLength(2)
    expect(within(quiet).queryByText('$0')).toBeNull()
    expect(await screen.findByText(SEASON_NOTE)).toBeInTheDocument()
    const grantorRead = calls().find((c) => c.url.startsWith('/api/financial-aid/grantors'))
    expect(grantorRead?.auth).toBe('Bearer test-jwt')
    const query = new URL(grantorRead?.url ?? '', 'http://x').searchParams
    expect([query.get('include_retired'), query.get('year')]).toEqual(['true', '2027'])
  })

  it('draws the three term columns, "n/a" where only full coverage has the fact', async () => {
    renderDirectory()
    const fund = (await screen.findByText('Grantor K gap-filler award')).closest(
      'tr'
    ) as HTMLElement
    expect(within(fund).getAllByText('yes')).toHaveLength(2)
    expect(within(fund).getByText('no')).toBeInTheDocument()
    const plain = screen.getByText('Grantor A').closest('tr') as HTMLElement
    expect(within(plain).getAllByText('n/a')).toHaveLength(2)
  })

  it('links each description where its host says; retired grantors show on request, struck', async () => {
    renderDirectory()
    expect(await screen.findByRole('link', { name: 'Grantor A grant ›' })).toHaveAttribute(
      'href',
      '/aid/money/sources?row=srcgrantora0003&year=2027'
    )
    expect(screen.queryByText('Grantor F')).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show retired grantors' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?grantors=all')
    expect(screen.getByText('Grantor F')).toHaveClass('line-through')
  })

  it('shows descriptions as plain text where the host gives no link (a grantors-only user), and lets development edit', async () => {
    granted = DEVELOPMENT
    renderDirectory('/aid/grants/grantors', null)
    expect(await screen.findByText('Grantor A grant')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Grantor A grant/ })).toBeNull()
    expect(screen.getByText('Test User, test@example.com, 555-0100')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New Grantor…' })).toBeInTheDocument()
    // R5-19: the directory itself fires no read development may not make (grantors, definitions).
    const reads = fetchSpy.mock.calls.map(([url]) => String(url))
    expect(reads.length).toBeGreaterThan(0)
    for (const url of reads) {
      expect(url).toMatch(/^\/api\/financial-aid\/(grantors|definitions)/)
    }
  })

  it('keeps to its own URL keys and leaves every other search param untouched', async () => {
    renderDirectory('/aid/reports/development?view=grantors&row=srcother0000001&year=2027')
    expect(await screen.findByRole('link', { name: 'Grantor A grant ›' })).toBeInTheDocument()
    expect(screen.queryByTestId('grantor-panel')).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Show retired grantors' }))
    await userEvent.click(screen.getByText('First and second summers'))
    expect(await screen.findByTestId('grantor-panel')).toBeInTheDocument()
    const where = new URLSearchParams(screen.getByTestId('where').textContent)
    expect(where.get('view')).toBe('grantors')
    expect(where.get('row')).toBe('srcother0000001')
    expect(where.get('year')).toBe('2027')
    expect(where.get('grantors')).toBe('all')
    expect(where.get('grantor')).toBe('grantor_a')
  })

  it("opens a named fund's row with its award terms in words (owner 10-06)", async () => {
    renderDirectory('/aid/grants/grantors?grantor=grantor_k')
    const panel = await screen.findByTestId('grantor-panel')
    expect(
      within(panel).getByText('Award terms: pays the rest after camp aid · no canteen')
    ).toBeInTheDocument()
  })

  it('is read only without grantors', async () => {
    granted = REGISTRAR
    renderDirectory('/aid/grants/grantors?grantor=grantor_a')
    const panel = await screen.findByTestId('grantor-panel')
    expect(within(panel).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('button', { name: 'New Grantor…' })).toBeNull()
    expect(
      screen.getByText('Read only: finance and development edit the grantors.')
    ).toBeInTheDocument()
  })

  it('creates a grantor, the key suggested from the name', async () => {
    answers = [json(GRANTOR_A, 201)]
    renderDirectory()
    await userEvent.click(await screen.findByRole('button', { name: 'New Grantor…' }))
    const form = screen.getByTestId('grantor-form')
    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'Grantor G')
    expect(within(form).getByRole('textbox', { name: 'Key' })).toHaveValue('grantor_g')
    await userEvent.click(within(form).getByRole('checkbox', { name: 'Full coverage' }))
    await userEvent.click(
      within(form).getByRole('checkbox', { name: 'Pays the rest after camp aid' })
    )
    await userEvent.selectOptions(
      within(form).getByRole('combobox', { name: 'Covers the canteen deposit' }),
      'no'
    )
    await userEvent.type(
      within(form).getByRole('textbox', { name: 'Note' }),
      'From the seed review'
    )
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ url: '/api/financial-aid/grantors', method: 'POST' })
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
  })

  it("shows a taken key in the server's words, not as a race", async () => {
    answers = [json({ detail: "a grantor with key 'grantor_g' already exists" }, 409)]
    renderDirectory()
    await userEvent.click(await screen.findByRole('button', { name: 'New Grantor…' }))
    const form = screen.getByTestId('grantor-form')
    await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'Grantor G')
    await userEvent.type(within(form).getByRole('textbox', { name: 'Note' }), 'x')
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
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
    // The directory's read, the form's fresh read on open, then the check before Save finds a rename.
    reads = [GRANTORS_ALL, GRANTORS_ALL, renamed]
    renderDirectory('/aid/grants/grantors?grantor=grantor_a')
    const panel = await screen.findByTestId('grantor-panel')
    await userEvent.click(within(panel).getByRole('button', { name: 'Edit…' }))
    const form = within(panel).getByTestId('grantor-form')
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
    expect(writes()[0]).toMatchObject({
      url: '/api/financial-aid/grantors/grantor_a',
      method: 'PUT',
    })
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
    renderDirectory('/aid/grants/grantors?grantor=grantor_a')
    const panel = await screen.findByTestId('grantor-panel')
    // Hold the form's open read until the person has typed.
    let release: (response: Response) => void = () => undefined
    const held = new Promise<Response>((resolve) => {
      release = resolve
    })
    fetchSpy.mockImplementation((input, init) => {
      if ((init?.method ?? 'GET') !== 'GET') return Promise.resolve(json(GRANTOR_A))
      if (String(input).startsWith('/api/financial-aid/grantors')) {
        // The first read after the click is held; any later read answers at once.
        fetchSpy.mockImplementation((_i, _init) => Promise.resolve(json(renamed)))
        return held
      }
      return Promise.resolve(json(DEFINITIONS))
    })
    await userEvent.click(within(panel).getByRole('button', { name: 'Edit…' }))
    const form = within(panel).getByTestId('grantor-form')
    await userEvent.type(within(form).getByRole('textbox', { name: 'Note' }), 'New contact')
    release(json(renamed))
    await waitFor(() =>
      expect(within(form).getByRole('textbox', { name: 'Name' })).toHaveValue('Grantor A Fund')
    )
    expect(within(form).getByRole('textbox', { name: 'Note' })).toHaveValue('New contact')
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
  })

  it('keeps Retire… off while a description maps to the grantor, and says why', async () => {
    renderDirectory('/aid/grants/grantors?grantor=grantor_a')
    const panel = await screen.findByTestId('grantor-panel')
    expect(within(panel).getByRole('button', { name: 'Retire…' })).toBeDisabled()
    expect(
      within(panel).getByText(
        '1 CampMinder description still maps to it. Map it to another grantor first.'
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
    renderDirectory(`/aid/grants/grantors?grantor=${GRANTOR_K.key}`)
    const panel = await screen.findByTestId('grantor-panel')
    await userEvent.click(within(panel).getByRole('button', { name: 'Retire…' }))
    await userEvent.type(
      within(panel).getByRole('textbox', { name: 'Why' }),
      'Merged into Grantor B'
    )
    await userEvent.click(within(panel).getByRole('button', { name: 'Retire' }))
    expect(
      await within(panel).findByText(
        "Nothing was written: Grantor K gap-filler award can't be retired yet: 1 open grant still names it. Move it to another grantor or withdraw it first."
      )
    ).toBeInTheDocument()
    expect(writes()[0]).toEqual({
      url: '/api/financial-aid/grantors/grantor_k/retire',
      method: 'POST',
      auth: 'Bearer test-jwt',
      body: JSON.stringify({ reason: 'Merged into Grantor B' }),
    })
  })

  it('unretires a retired grantor with a reason', async () => {
    renderDirectory('/aid/grants/grantors?grantors=all&grantor=grantor_f')
    const panel = await screen.findByTestId('grantor-panel')
    expect(within(panel).queryByRole('button', { name: 'Edit…' })).toBeNull()
    await userEvent.click(within(panel).getByRole('button', { name: 'Unretire…' }))
    await userEvent.type(
      within(panel).getByRole('textbox', { name: 'Why' }),
      'Still funds weekends'
    )
    await userEvent.click(within(panel).getByRole('button', { name: 'Unretire' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({
      url: '/api/financial-aid/grantors/grantor_f/unretire',
      method: 'POST',
    })
    expect(await screen.findByText('✓ Grantor F: unretired, with your reason.')).toBeInTheDocument()
  })
})
