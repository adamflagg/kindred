/**
 * Money › Sources end to end through its real hooks (spec §8.1; D58, D100, D159, D160; P-9, P-12 to
 * P-14, ruling H): the registry and its chips, who may edit what, and the fresh read before every
 * save. Only `fetch` is faked, routed by URL and method.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidFundingSources, ApiAidSources } from '../../../types/api-types'
import { GRANTORS_ALL } from '../grants/grantorFixtures'
import { RULES_2027 } from './ledgerFixtures'
import {
  FUNDING_SOURCES_2027,
  REG_GRANTOR_A_GRANT,
  REG_GRANTOR_E_NEW,
  SOURCES_2027,
} from './registryFixtures'
import { SourcesTab } from './SourcesTab'

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
const VIEW = { year: 2027, asOf: { kind: 'live' } as const }

let sourceReads: ApiAidSources[] = []
let fundingReads: ApiAidFundingSources[] = []
let fetchSpy: MockInstance<typeof fetch>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const writes = () =>
  fetchSpy.mock.calls
    .map(([url, init]) => ({ url: String(url), method: init?.method ?? 'GET', body: init?.body }))
    .filter((call) => call.method !== 'GET')
/** The registry reads made before the first write. */
const sourceGetsBeforeWrite = () => {
  const calls = fetchSpy.mock.calls
  const first = calls.findIndex(([, init]) => (init?.method ?? 'GET') !== 'GET')
  return calls
    .slice(0, first === -1 ? calls.length : first)
    .filter(([url]) => String(url).startsWith('/api/financial-aid/sources?'))
}

beforeEach(() => {
  granted = FINANCE
  sourceReads = [SOURCES_2027]
  fundingReads = [FUNDING_SOURCES_2027]
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const path = String(url)
    const method = init?.method ?? 'GET'
    if (method !== 'GET') {
      if (path.includes('/funding-sources/')) {
        const [, , e] = FUNDING_SOURCES_2027.sources
        return Promise.resolve(json({ ...e, group: 'pool_a', group_label: 'Pool A' }))
      }
      return Promise.resolve(json(REG_GRANTOR_A_GRANT))
    }
    if (path.includes('/grantors')) return Promise.resolve(json(GRANTORS_ALL))
    if (path.includes('/funding-sources')) {
      // Each Funding sources read takes the next answer; the last one repeats.
      const next = fundingReads.length > 1 ? fundingReads.shift() : fundingReads[0]
      return Promise.resolve(json(next ?? FUNDING_SOURCES_2027))
    }
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

function renderTab(path = '/aid/money/sources') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <SourcesTab view={VIEW} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  )
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

describe('Money › Sources (§8.1)', () => {
  it("shows each description's facts, this season's lines and $, and the reporting group", async () => {
    renderTab()
    const row = (await screen.findByText('Grantor A grant')).closest('tr')
    if (row === null) throw new Error('no row')
    // "Pool A" comes from the second read (Funding sources): wait for it (R3-18).
    expect(await within(row).findByText('Pool A')).toBeInTheDocument()
    for (const words of ['Another funder', 'incentive', '61', '$98,400']) {
      expect(within(row).getByText(words)).toBeInTheDocument()
    }
    expect(
      within(row).getByText('finance@example.com · Sep 30 · "funds weekend families too"')
    ).toBeInTheDocument()
    const fresh = (await screen.findByText('Grantor E grant 2027')).closest('tr')
    if (fresh === null) throw new Error('no row')
    expect(within(fresh).getByText('needs a group')).toBeInTheDocument()
    expect(screen.getByText('Notes for money-sources')).toBeInTheDocument()
  })

  it('counts Needs a group both ways (ruling H) and filters in the URL', async () => {
    renderTab()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Needs a group 2 · 1 with lines this season' })
    )
    expect(screen.getByTestId('where')).toHaveTextContent('?show=needs-group')
    expect(screen.queryByText('Grantor A grant')).toBeNull()
    expect(screen.getByText('Grantor C full-ride program')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Unclassified 1' }))
    expect(screen.getByText('Returning-family bonus 2027')).toBeInTheDocument()
    expect(screen.queryByText('Grantor E grant 2027')).toBeNull()
  })

  it("opens the row a link names (?row=), in the rules' program words, its grantor linked", async () => {
    renderTab('/aid/money/sources?row=srcgrantora0003')
    await waitFor(() => expect(document.querySelector('[data-panel="source"]')).not.toBeNull())
    const left = panel('source')
    expect(within(left).getByText('Programs it funds: Summer Sessions')).toBeInTheDocument()
    expect(within(left).getByRole('link', { name: 'Grantor A' })).toHaveAttribute(
      'href',
      '/aid/grants/grantors?grantor=grantor_a&year=2027'
    )
  })

  it('is read only for the registrar', async () => {
    granted = REGISTRAR
    renderTab()
    await openRow('Grantor A grant')
    expect(document.querySelector('[data-panel="edit"]')).toBeNull()
    expect(within(panel('source')).queryByRole('button')).toBeNull()
  })

  it('classifies on a fresh read, checks again before sending, and sends the whole record', async () => {
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
    expect(sourceGetsBeforeWrite()).toHaveLength(3)
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
    // Re-based: the programs now show the other person's change; only the note is this person's.
    expect(within(editor).getByRole('checkbox', { name: 'Family Camp Weekends' })).toBeChecked()
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    // The whole-record PATCH carries the LATEST programs: the other change survives the second Save.
    expect(JSON.parse(String(writes()[0]?.body))).toMatchObject({
      implied_program_families: ['family_camp'],
      note: 'Checked the letter',
    })
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
    await userEvent.selectOptions(
      within(editor).getByRole('combobox', { name: 'Reporting group' }),
      'Pool A'
    )
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    expect(
      await within(editor).findByText(/^Someone changed this since you opened it: Incentive\./)
    ).toBeInTheDocument()
    expect(writes()).toHaveLength(0)
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    // The pool is this person's; the flag is the other person's.
    expect(JSON.parse(String(writes()[0]?.body))).toEqual({
      group: 'pool_a',
      incentive: !e.incentive,
    })
  })

  it('Map a Grantor… sends nothing when the grantor moved under it (R3-17)', async () => {
    granted = ['financial_aid.view', 'financial_aid.grantors']
    const moved: ApiAidSources = {
      ...SOURCES_2027,
      sources: SOURCES_2027.sources.map((s) =>
        s.id === REG_GRANTOR_E_NEW.id ? { ...s, grantor_key: 'grantor_a' } : s
      ),
    }
    sourceReads = [SOURCES_2027, SOURCES_2027, moved]
    renderTab()
    await openRow('Grantor E grant 2027')
    await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Map a Grantor…' }))
    const field = await screen.findByTestId('grantor-field')
    await within(field).findByRole('option', { name: 'Grantor E' })
    await waitFor(() => expect(within(field).getByRole('combobox')).toBeEnabled())
    await userEvent.selectOptions(within(field).getByRole('combobox'), 'Grantor E')
    await userEvent.type(within(field).getByRole('textbox', { name: 'Note' }), 'New for 2027')
    await userEvent.click(within(field).getByRole('button', { name: 'Save' }))
    expect(
      await within(field).findByText(/^Someone changed this since you opened it: Grantor\./)
    ).toBeInTheDocument()
    expect(writes()).toHaveLength(0)
    // The person's pick stays; a second Save puts it in place.
    expect(within(field).getByRole('combobox')).toHaveDisplayValue('Grantor E')
    await userEvent.click(within(field).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
  })

  it("shows the server's group sentence when the programs change", async () => {
    renderTab()
    await openRow('Grantor A grant')
    await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Edit…' }))
    const editor = await screen.findByTestId('classify-editor')
    const warning = 'Changing this re-places household-level lines on the next ledger sync.'
    expect(within(editor).queryByText(warning)).toBeNull()
    await userEvent.click(within(editor).getByRole('checkbox', { name: 'Family Camp Weekends' }))
    expect(within(editor).getByText(warning)).toBeInTheDocument()
  })

  it("Set a Group… writes development's route: one pool, the flag, the optional note", async () => {
    renderTab()
    await openRow('Grantor E grant 2027')
    await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Set a Group…' }))
    const editor = await screen.findByTestId('group-editor')
    expect(within(editor).getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.selectOptions(
      within(editor).getByRole('combobox', { name: 'Reporting group' }),
      'Pool A'
    )
    expect(
      within(editor).getByText(
        'Changing this re-places household-level lines on the next ledger sync.'
      )
    ).toBeInTheDocument()
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toEqual({
      url: '/api/financial-aid/reports/2027/funding-sources/srcgrantore0005',
      method: 'PUT',
      body: JSON.stringify({ group: 'pool_a', incentive: false }),
    })
    expect(
      await screen.findByText('✓ Grantor E grant 2027: reporting group Pool A, need-based.')
    ).toBeInTheDocument()
  })

  it('maps a description to a grantor in use, with a note, for grantors (no rules)', async () => {
    granted = ['financial_aid.view', 'financial_aid.grantors']
    renderTab()
    await openRow('Grantor E grant 2027')
    const edit = panel('edit')
    expect(within(edit).queryByRole('button', { name: 'Edit…' })).toBeNull()
    expect(within(edit).queryByRole('button', { name: 'Set a Group…' })).toBeNull()
    await userEvent.click(within(edit).getByRole('button', { name: 'Map a Grantor…' }))
    const field = await screen.findByTestId('grantor-field')
    await within(field).findByRole('option', { name: 'Grantor E' })
    await waitFor(() => expect(within(field).getByRole('combobox')).toBeEnabled())
    await userEvent.selectOptions(within(field).getByRole('combobox'), 'Grantor E')
    await userEvent.type(within(field).getByRole('textbox', { name: 'Note' }), 'New for 2027')
    await userEvent.click(within(field).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toEqual({
      url: `/api/financial-aid/sources/${REG_GRANTOR_E_NEW.id}/grantor`,
      method: 'PUT',
      body: JSON.stringify({ grantor_key: 'grantor_e', note: 'New for 2027' }),
    })
  })

  it('shows a retired grantor the description still maps to, disabled, and says why (P-13)', async () => {
    granted = ['financial_aid.view', 'financial_aid.grantors']
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
    await userEvent.click(
      within(panel('edit')).getByRole('button', { name: 'Change the Grantor…' })
    )
    const field = await screen.findByTestId('grantor-field')
    expect(await within(field).findByRole('option', { name: 'Grantor F (retired)' })).toBeDisabled()
    expect(within(field).queryByRole('option', { name: 'Grantor F' })).toBeNull()
    await waitFor(() => expect(within(field).getByRole('combobox')).toHaveValue('grantor_f'))
    expect(
      within(field).getByText('Grantor F is retired: pick a grantor in use, or', { exact: false })
    ).toBeInTheDocument()
    expect(
      within(field).getByRole('link', { name: 'Unretire It in Grants › Grantors' })
    ).toHaveAttribute('href', '/aid/grants/grantors?grantor=grantor_f&year=2027')
    await userEvent.type(within(field).getByRole('textbox', { name: 'Note' }), 'x')
    expect(within(field).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('offers no grantor on a camp-aid description, and asks to classify an unclassified one first', async () => {
    granted = ['financial_aid.view', 'financial_aid.grantors']
    renderTab()
    await openRow('Camp aid · Summer')
    // Ruled test edit (R3-12, applied after this test was written): a grantors-only person on a
    // camp-aid row gets no right panel at all, so there is no button to offer.
    expect(document.querySelector('[data-panel="edit"]')).toBeNull()
    await openRow('Returning-family bonus 2027')
    expect(
      within(panel('edit')).getByText(
        'Classify this description first: only an outside grant names a grantor.'
      )
    ).toBeInTheDocument()
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
      const release = holdReads('/api/financial-aid/sources?', SOURCES_2027)
      await userEvent.click(within(editor).getByRole('button', { name: 'Save' }))
      await userEvent.type(note, ' and more')
      release()
      await waitFor(() => expect(writes()).toHaveLength(1))
      expect(JSON.parse(String(writes()[0]?.body))).toMatchObject({
        note: 'First part and more',
      })
    })

    it('Set a Group… sends the pick and note as they stand when the re-check lands', async () => {
      renderTab()
      await openRow('Grantor E grant 2027')
      await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Set a Group…' }))
      const editor = await screen.findByTestId('group-editor')
      await userEvent.selectOptions(
        within(editor).getByRole('combobox', { name: 'Reporting group' }),
        'Pool A'
      )
      const release = holdReads(
        '/api/financial-aid/reports/2027/funding-sources',
        FUNDING_SOURCES_2027
      )
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

    it('Map a Grantor… sends the note as it stands when the re-check lands', async () => {
      granted = ['financial_aid.view', 'financial_aid.grantors']
      renderTab()
      await openRow('Grantor E grant 2027')
      await userEvent.click(within(panel('edit')).getByRole('button', { name: 'Map a Grantor…' }))
      const field = await screen.findByTestId('grantor-field')
      await within(field).findByRole('option', { name: 'Grantor E' })
      await waitFor(() => expect(within(field).getByRole('combobox')).toBeEnabled())
      await userEvent.selectOptions(within(field).getByRole('combobox'), 'Grantor E')
      const note = within(field).getByRole('textbox', { name: 'Note' })
      await userEvent.type(note, 'New')
      const release = holdReads('/api/financial-aid/sources?', SOURCES_2027)
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
