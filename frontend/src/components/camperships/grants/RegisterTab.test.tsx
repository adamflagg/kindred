/**
 * Grants › Register end to end through its real hooks (spec §8.2; D55, D126, D142; rulings A, D, G;
 * P-15): the rows, the filters, the counted total and the opened row. Only `fetch` is faked.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidGrantors, ApiAidGrants } from '../../../types/api-types'
import { GRID_ROWS } from '../requests/gridFixtures'
import { GRANTS, NEVER_APPLIED_HOUSEHOLD, RILEY_COMMITMENT } from './grantsFixtures'
import { RegisterTab } from './RegisterTab'

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

const REGISTRAR = ['financial_aid.view', 'financial_aid.casework']
const VIEW = { year: 2027, asOf: { kind: 'live' } as const }

let fetchSpy: MockInstance<typeof fetch>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const writes = () =>
  fetchSpy.mock.calls
    .map(([url, init]) => ({ url: String(url), method: init?.method ?? 'GET', body: init?.body }))
    .filter((call) => call.method !== 'GET')

const grantor = (key: string, name: string, retiredAt = '') => ({
  key,
  name,
  aliases: [],
  full_coverage: false,
  covers_canteen: 'unknown' as const,
  pays_after_camp_aid: false,
  eligibility: '',
  contacts: '',
  retired_at: retiredAt,
  descriptions: [],
})
const GRANTORS: ApiAidGrantors = {
  grantors: [
    grantor('grantor_a', 'Grantor A'),
    grantor('grantor_c', 'Grantor C'),
    grantor('grantor_f', 'Grantor F', '2027-03-01 10:00:00.000Z'),
  ],
}
/** The stored-fields reads (`?offsets=false`) in order: the edit's open, then its check before sending. */
let storedReads: ApiAidGrants[] = []
/** What the live read serves. */
let served: ApiAidGrants = GRANTS

beforeEach(() => {
  granted = REGISTRAR
  storedReads = []
  served = GRANTS
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-20T18:00:00Z'))
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const path = String(url)
    if ((init?.method ?? 'GET') !== 'GET') return Promise.resolve(json({}))
    if (path.includes('offsets=false')) {
      const next = storedReads.length > 1 ? storedReads.shift() : storedReads[0]
      return Promise.resolve(json(next ?? GRANTS))
    }
    if (path.startsWith('/api/financial-aid/grants/2027')) return Promise.resolve(json(served))
    if (path.startsWith('/api/financial-aid/grantors')) return Promise.resolve(json(GRANTORS))
    if (path.startsWith('/api/financial-aid/decisions/2027/grid')) {
      return Promise.resolve(
        json({ year: 2027, rules_version: 3, rows: GRID_ROWS, ticked_season: true })
      )
    }
    // No rules yet: program keys are spelled out.
    return Promise.resolve(json({ detail: 'no approved rules' }, 404))
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

function renderTab(path = '/aid/grants/register') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <RegisterTab view={VIEW} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('Grants › Register (§8.2)', () => {
  it('lists every grant line and commitment, and ⚠ totals only what the server counts', async () => {
    renderTab()
    expect(await screen.findByText('8 grants · 3 not counted')).toBeInTheDocument()
    // ⚠ P-15: Samuel's posted grant counts though he cancelled (CampMinder hasn't reversed it);
    // his cancelled commitment, Olivia's reversed line and Garcia's waiting line don't.
    expect(screen.getByText('$10,200')).toBeInTheDocument()
    expect(screen.getByText('needs a camper')).toBeInTheDocument()
    expect(screen.getByText('applied · no camper yet')).toBeInTheDocument()
    expect(screen.getByText('R1 $1,420')).toBeInTheDocument()
    expect(screen.getByText('after the offer')).toBeInTheDocument()
    expect(screen.getByText("didn't apply")).toBeInTheDocument()
    expect(screen.getAllByText('Committed · not yet in CampMinder')).toHaveLength(2)
    expect(screen.getByText('in CampMinder · Mar 12 · reversed Apr 1')).toBeInTheDocument()
    expect(screen.getAllByText('Not counted')).toHaveLength(3)
  })

  it("names the family by the household card's label, linking to the household (ruling D)", async () => {
    renderTab()
    const [garcia] = await screen.findAllByRole('link', { name: 'Pat Garcia' })
    expect(garcia).toHaveAttribute('href', '/aid/households/1000002?year=2027')
    expect(screen.queryByText('1000002')).toBeNull()
  })

  it('filters by the chips, the grantor and the program, in the URL', async () => {
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: "Didn't apply 1" }))
    expect(screen.getByTestId('where')).toHaveTextContent('?show=didnt-apply')
    expect(screen.getByText('1 grant')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancelled 2' }))
    expect(screen.getByText('2 grants · 1 not counted')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Grantor' }), 'Grantor B')
    expect(screen.getByTestId('where')).toHaveTextContent('grantor=grantor_b')
    expect(screen.getByText('1 grant · 1 not counted')).toBeInTheDocument()
    // The chip counts follow the grantor picked.
    expect(screen.getByRole('button', { name: 'All 2' })).toBeInTheDocument()
  })

  it('"After the offer" shows the grants known after Round 1 posted (ruling G)', async () => {
    renderTab('/aid/grants/register?show=after-offer')
    expect(await screen.findByText('1 grant')).toBeInTheDocument()
    expect(screen.getByText('after the offer')).toBeInTheDocument()
    // The late line's muted note under where it stands, as grants-v2.html draws it (R5-1).
    expect(screen.getByText('after the offer · extra for the family')).toBeInTheDocument()
    expect(screen.getByText('no grantor yet')).toBeInTheDocument()
  })

  it('opens a row in three panels: the grant, the request it offsets, what can be done (ruling A)', async () => {
    renderTab('/aid/grants/register?row=t4000001')
    await screen.findByTestId('register-chips')
    const offsets = document.querySelector('[data-panel="offsets"]')
    expect(offsets).not.toBeNull()
    expect(within(offsets as HTMLElement).getByText('$700 of it · R1 $1,420')).toBeInTheDocument()
    const actions = document.querySelector('[data-panel="actions"]') as HTMLElement
    expect(within(actions).getByText(/A grant line is CampMinder’s/)).toBeInTheDocument()
  })

  it('records a commitment for a camper on a request this season (D55; P-16)', async () => {
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: 'Record a Commitment…' }))
    const form = screen.getByTestId('commitment-form')
    await within(form).findByRole('option', { name: 'Grantor C' })
    // Grantors in use only (D160): a retired one is never offered for a new commitment. Checked
    // while the form is open, so the check can fail (R5-17).
    expect(within(form).queryByRole('option', { name: 'Grantor F (retired)' })).toBeNull()
    await userEvent.selectOptions(
      within(form).getByRole('combobox', { name: 'Grantor' }),
      'Grantor C'
    )
    await within(form).findByRole('option', { name: 'Riley Sam · Session 1 · The Sam Family' })
    await userEvent.selectOptions(
      within(form).getByRole('combobox', { name: 'Camper' }),
      'Riley Sam · Session 1 · The Sam Family'
    )
    await userEvent.type(within(form).getByRole('textbox', { name: 'Amount' }), '6200')
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toEqual({
      url: '/api/financial-aid/grants/2027/commitments',
      method: 'POST',
      body: JSON.stringify({
        grantor_key: 'grantor_c',
        household_cm_id: 1000007,
        person_cm_id: 1000008,
        session_cm_id: 1000100,
        amount: '6200.00',
        committed_on: '2027-04-20',
        note: '',
      }),
    })
    expect(
      await screen.findByText('✓ Commitment recorded. It counts for the calculator from now.')
    ).toBeInTheDocument()
  })

  it('edits on a fresh read of the stored fields, keeping the stored note and date (review item 21)', async () => {
    renderTab('/aid/grants/register?row=ccmtriley0000001')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit…' }))
    const form = screen.getByTestId('commitment-form')
    const amount = within(form).getByRole('textbox', { name: 'Amount' })
    await waitFor(() => expect(amount).toBeEnabled())
    expect(amount).toHaveValue('6200')
    expect(within(form).getByRole('textbox', { name: 'Note' })).toHaveValue('Letter of Apr 2')
    await userEvent.clear(amount)
    await userEvent.type(amount, '6300')
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toEqual({
      url: '/api/financial-aid/grants/2027/commitments/cmtriley0000001',
      method: 'PUT',
      body: JSON.stringify({
        grantor_key: 'grantor_c',
        household_cm_id: 1000004,
        person_cm_id: 2000004,
        session_cm_id: 1000103,
        amount: '6300.00',
        committed_on: '2027-04-02',
        note: 'Letter of Apr 2',
      }),
    })
    const stored = fetchSpy.mock.calls.filter(([url]) => String(url).includes('offsets=false'))
    expect(stored).toHaveLength(2)
    // R5-3: the save closes the form, so a second Save can't re-read this person's own save.
    expect(await screen.findByText('✓ Commitment saved.')).toBeInTheDocument()
    expect(screen.queryByTestId('commitment-form')).toBeNull()
  })

  it("keeps another person's change to a field this person didn't touch on the second Save (R3-1)", async () => {
    const renoted: ApiAidGrants = {
      ...GRANTS,
      grants: GRANTS.grants.map((g) =>
        g.commitment_id === RILEY_COMMITMENT.commitment_id
          ? { ...g, commitment_note: 'Letter of Apr 2, countersigned' }
          : g
      ),
    }
    // Opened on the stored read; someone else edits the note before this Save re-checks.
    storedReads = [GRANTS, renoted]
    renderTab('/aid/grants/register?row=ccmtriley0000001')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit…' }))
    const form = screen.getByTestId('commitment-form')
    const amount = within(form).getByRole('textbox', { name: 'Amount' })
    await waitFor(() => expect(amount).toBeEnabled())
    await userEvent.clear(amount)
    await userEvent.type(amount, '6300')
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(
      await within(form).findByText(/^Someone changed this since you opened it: Note\./)
    ).toBeInTheDocument()
    expect(writes()).toHaveLength(0)
    // Re-based: the other person's note shows; this person's amount stays.
    expect(within(form).getByRole('textbox', { name: 'Note' })).toHaveValue(
      'Letter of Apr 2, countersigned'
    )
    expect(amount).toHaveValue('6300')
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(JSON.parse(String(writes()[0]?.body))).toMatchObject({
      amount: '6300.00',
      note: 'Letter of Apr 2, countersigned',
    })
  })

  it('sends nothing when the commitment moved since the form opened, and says what moved (P-9)', async () => {
    const moved: ApiAidGrants = {
      ...GRANTS,
      grants: GRANTS.grants.map((g) =>
        g.commitment_id === RILEY_COMMITMENT.commitment_id ? { ...g, amount: 6400 } : g
      ),
    }
    storedReads = [GRANTS, moved]
    renderTab('/aid/grants/register?row=ccmtriley0000001')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit…' }))
    const form = screen.getByTestId('commitment-form')
    const amount = within(form).getByRole('textbox', { name: 'Amount' })
    await waitFor(() => expect(amount).toBeEnabled())
    await userEvent.clear(amount)
    await userEvent.type(amount, '6300')
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(
      await within(form).findByText(/Someone changed this since you opened it: Amount/)
    ).toBeInTheDocument()
    expect(writes()).toHaveLength(0)
    expect(amount).toHaveValue('6300')
    // A second Save is a choice made knowing what moved: the later save wins.
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toMatchObject({ method: 'PUT' })
  })

  it('shows a retired grantor as itself, disabled, and never sends it', async () => {
    const onRetired: ApiAidGrants = {
      ...GRANTS,
      grants: GRANTS.grants.map((g) =>
        g.commitment_id === RILEY_COMMITMENT.commitment_id
          ? { ...g, grantor_key: 'grantor_f', grantor_name: 'Grantor F' }
          : g
      ),
    }
    storedReads = [onRetired]
    renderTab('/aid/grants/register?row=ccmtriley0000001')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit…' }))
    const form = screen.getByTestId('commitment-form')
    expect(await within(form).findByRole('option', { name: 'Grantor F (retired)' })).toBeDisabled()
    await waitFor(() =>
      expect(within(form).getByRole('combobox', { name: 'Grantor' })).toHaveValue('grantor_f')
    )
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    expect(
      within(form).getAllByText(
        'Grantor F is retired: pick a grantor in use, or Unretire It in Money › Funders.'
      ).length
    ).toBeGreaterThan(0)
    expect(writes()).toHaveLength(0)
  })

  it('withdraws an open commitment with a reason', async () => {
    renderTab('/aid/grants/register?row=ccmtriley0000001')
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw…' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Why' }), 'Grantor declined')
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toEqual({
      url: '/api/financial-aid/grants/2027/commitments/cmtriley0000001/withdraw',
      method: 'POST',
      body: JSON.stringify({ reason: 'Grantor declined' }),
    })
    expect(await screen.findByText(/✓ Commitment withdrawn, with your reason/)).toBeInTheDocument()
  })

  it('offers view-only staff no commitment work', async () => {
    granted = ['financial_aid.view']
    renderTab('/aid/grants/register?row=ccmtriley0000001')
    await screen.findByTestId('register-chips')
    const actions = document.querySelector('[data-panel="actions"]') as HTMLElement
    expect(within(actions).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Record a Commitment…' })).toBeNull()
  })

  it("⚠ counts a never-applied household's household-level line in the total and the footer", async () => {
    served = { ...GRANTS, grants: [...GRANTS.grants, NEVER_APPLIED_HOUSEHOLD] }
    renderTab()
    // 10,200 counted by the server + 900 the dashboard counts for the family that never applied.
    expect(await screen.findByText('9 grants · 3 not counted')).toBeInTheDocument()
    expect(screen.getByText('$11,100')).toBeInTheDocument()
    // Final audit E15: the footer says how many such lines the total counts, and their sum.
    expect(
      screen.getByText("counts 1 household-level line of families who didn't apply ($900)")
    ).toBeInTheDocument()
  })

  it('puts "Aid request it offsets" just before Amount, and names the program from program_label', async () => {
    renderTab()
    await screen.findByTestId('register-chips')
    const headers = screen
      .getAllByRole('columnheader')
      .map((h) => h.textContent.replace(/[^A-Za-z ]/g, '').trim())
    expect(headers.indexOf('Aid request it offsets')).toBe(headers.indexOf('Amount') - 1)
    expect(screen.getAllByText('Summer Camp').length).toBeGreaterThan(0)
    // Final audit E18: a line with no program reads "—" (the Camper cell says household level / needs a camper).
    expect(screen.queryByText('Not placed')).toBeNull()
  })

  it('fits a 1440 screen: the columns sum to no more than the 1214px inside the card border', async () => {
    renderTab()
    await screen.findByTestId('register-chips')
    const cols = Array.from(document.querySelectorAll('table colgroup col'))
    expect(cols.length).toBeGreaterThanOrEqual(9)
    const total = cols.reduce(
      (sum, c) => sum + (parseFloat((c as HTMLElement).style.width) || 0),
      0
    )
    expect(total).toBeGreaterThan(0)
    expect(total).toBeLessThanOrEqual(1214)
  })

  it('gives the names room (final audit O6): Family and Grantor are wide, Where it stands is narrow, Cancelled stays', async () => {
    renderTab()
    await screen.findByTestId('register-chips')
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent.trim())
    const cols = Array.from(document.querySelectorAll<HTMLElement>('table colgroup col'))
    const offset = cols.length - headers.length
    const width = (name: string) =>
      parseFloat(cols[headers.findIndex((h) => h.startsWith(name)) + offset]?.style.width ?? '0')
    expect(width('Family')).toBeGreaterThanOrEqual(180)
    expect(width('Grantor')).toBeGreaterThanOrEqual(170)
    expect(width('Where it stands')).toBeLessThanOrEqual(160)
    expect(headers.some((h) => h.startsWith('Cancelled'))).toBe(true)
  })

  it('keeps room for the "Not counted" pill', async () => {
    renderTab()
    await screen.findByTestId('register-chips')
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent.trim())
    const cols = Array.from(document.querySelectorAll<HTMLElement>('table colgroup col'))
    const offset = cols.length - headers.length
    // "Counted" for the whole "Not counted" pill (cut off at 100px once the table filled its card).
    const counted = cols[headers.findIndex((h) => h.startsWith('Counted')) + offset]
    expect(parseFloat(counted?.style.width ?? '0')).toBeGreaterThanOrEqual(110)
  })

  it('words the Grantor and Program filters\' no-filter choice "All", sentence case like the Ledger', async () => {
    renderTab()
    await screen.findByTestId('register-chips')
    for (const name of ['Grantor', 'Program']) {
      const select = screen.getByRole('combobox', { name })
      expect(within(select).getAllByRole('option')[0]).toHaveTextContent(/^All$/)
    }
  })

  it('links a waiting line to Money › To place for its household', async () => {
    renderTab('/aid/money/grants?row=t4000002')
    const link = await screen.findByRole('link', { name: 'Money › To place ›' })
    expect(link).toHaveAttribute('href', '/aid/money/to-place?household=1000002&year=2027')
    expect(screen.queryByText(/Needs attention/)).toBeNull()
  })

  it('links a description to its funder, or to its unmapped source row', async () => {
    renderTab('/aid/money/grants?row=t4000001')
    const mapped = await screen.findByRole('link', { name: 'Grantor A grant' })
    expect(mapped).toHaveAttribute('href', '/aid/money/funders?funder=grantor_a&year=2027')
  })

  it('links an unmapped description to its source row', async () => {
    renderTab('/aid/money/grants?row=t4000007')
    const unmapped = await screen.findByRole('link', { name: 'Grantor E grant 2027' })
    expect(unmapped).toHaveAttribute('href', '/aid/money/funders?row=srcgrantore0005&year=2027')
  })

  it('draws no definition notes itself: the page draws them once', async () => {
    renderTab()
    await screen.findByTestId('register-chips')
    expect(screen.queryByText(/Grants this season/)).toBeNull()
  })
})
