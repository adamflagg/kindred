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
import { downloadCsv } from '../../../utils/csvExport'
import { GRID_ROWS } from '../requests/gridFixtures'
import { GRANTS, NEVER_APPLIED_HOUSEHOLD, RILEY_COMMITMENT, grantRow } from './grantsFixtures'
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
vi.mock('../../../utils/csvExport', async (original) => ({
  ...(await original<typeof import('../../../utils/csvExport')>()),
  downloadCsv: vi.fn(),
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

/** The footer row's cells, as text. */
const footerCells = () =>
  Array.from(document.querySelectorAll('tfoot td')).map((td) => td.textContent.trim())
/** The Register's switcher (§18): the grey well, counts inside. */
const table = () => document.querySelector('table') as HTMLElement
const switcher = () => screen.getByRole('group', { name: 'Show' })

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
    await screen.findByRole('group', { name: 'Show' })
    expect(footerCells()[0]).toBe('8 grants · 3 not counted')
    // ⚠ P-15: Samuel's posted grant counts though he cancelled (CampMinder hasn't reversed it);
    // his cancelled commitment, Olivia's reversed line and Garcia's waiting line don't.
    expect(screen.getByText('$10,200')).toBeInTheDocument()
    expect(screen.getByText('applied · no camper yet')).toBeInTheDocument()
    // money-grants.html: the session leads the round, in its short form.
    expect(screen.getByText('Session 2 · R1 $1,420')).toBeInTheDocument()
    expect(screen.getByText('Quest · after the offer')).toBeInTheDocument()
    expect(screen.getByText("didn't apply")).toBeInTheDocument()
    // ★18: one chip, the details in its title.
    const chips = within(table()).getAllByText('Committed · not in CM')
    expect(chips).toHaveLength(2)
    expect(chips[0]).toHaveAttribute(
      'title',
      'Committed Apr 2 · entered by hand · not yet posted in CampMinder'
    )
    expect(within(table()).getByText('in CM · Mar 12 · reversed Apr 1')).toBeInTheDocument()
    expect(screen.queryByText(/in CampMinder · Mar 12/)).toBeNull()
  })

  it('has no Cancelled or Counted column: ⊘ before the name, a grey italic amount (ruling 15, ★16)', async () => {
    renderTab()
    await screen.findByRole('group', { name: 'Show' })
    const headers = screen
      .getAllByRole('columnheader')
      .map((h) => h.textContent.replace(/[^A-Za-z ]/g, '').trim())
    expect(headers).toEqual([
      'Camper',
      'Family',
      'Grantor',
      'Program',
      'Aid request it offsets',
      'Amount',
      'Where it stands',
    ])
    // ⊘ sits BEFORE the camper's name, with the words of a cancellation in its title.
    const marks = screen.getAllByText('⊘')
    expect(marks).toHaveLength(2)
    expect(marks[0]).toHaveAttribute(
      'title',
      expect.stringMatching(/^The camper cancelled \(from CampMinder enrollment\)/)
    )
    const cell = marks[0]?.closest('td') as HTMLElement
    expect(cell.textContent.startsWith('⊘')).toBe(true)
    // Not counted: the amount is grey italic, the reason in its title; a reversed line stays struck through.
    const why = Array.from(document.querySelectorAll<HTMLElement>('td[title^="Not counted: "]'))
    expect(why.map((el) => el.getAttribute('title')).sort()).toEqual([
      'Not counted: a commitment whose camper cancelled',
      'Not counted: reversed',
      'Not counted: waiting for its camper',
    ])
    for (const td of why) expect(td.querySelector('.italic')).not.toBeNull()
    expect(why.some((td) => td.querySelector('s') !== null)).toBe(true)
  })

  it('keeps Cancelled and Counted in the CSV (csvExtra), not on the screen', async () => {
    renderTab()
    await screen.findByRole('group', { name: 'Show' })
    await userEvent.click(screen.getByRole('button', { name: /^Download CSV/ }))
    const [content] = vi.mocked(downloadCsv).mock.calls[0] ?? []
    const [header = '', ...lines] = String(content).split('\n')
    expect(header).toContain('Cancelled')
    expect(header).toContain('Counted')
    expect(header).toContain('Household CM id')
    // Samuel's cancelled commitment: cancelled, and not counted.
    const row = lines.find(
      (l) => l.includes('Samuel Johnson') && l.includes('not yet in CampMinder')
    )
    expect(row).toBeDefined()
    expect(row).toContain('cancelled')
    expect(row).toContain('not counted')
  })

  it('draws the household program as ⌂ and the family label, and a household-level chip with its basis in the title', async () => {
    const fc = grantRow({
      transaction_cm_id: 4000050,
      person_cm_id: 0,
      camper_name: '',
      camper_basis: 'household',
      session_name: 'Family Camp 1: Fall Weekend',
      program_family: 'family',
      program_label: 'Family Camp',
      label: 'Pat Garcia',
    })
    served = { ...GRANTS, grants: [fc, ...GRANTS.grants] }
    renderTab()
    await screen.findByRole('group', { name: 'Show' })
    expect(screen.getByText('FC1 · R1 $1,420')).toHaveAttribute(
      'title',
      expect.stringContaining('Family Camp 1: Fall Weekend')
    )
    const camperCell = document.querySelector('tbody tr td') as HTMLElement
    expect(camperCell.querySelector('svg')).not.toBeNull()
    expect(camperCell).toHaveTextContent('Pat Garcia')
    const chip = within(table()).getByText('Household level')
    expect(chip).toHaveAttribute('title', expect.stringContaining('needs a camper'))
  })

  it('adds "placed by staff" inline, muted, with the full words in the cell title', async () => {
    const placed = grantRow({ transaction_cm_id: 4000051, camper_basis: 'placed' })
    served = { ...GRANTS, grants: [placed] }
    renderTab()
    await screen.findByRole('group', { name: 'Show' })
    const tail = screen.getByText(/placed by staff/)
    expect(tail.className).toMatch(/text-muted-foreground/)
    expect(tail.closest('td')).toHaveAttribute('title', 'Emma Johnson · placed by staff')
  })

  it("names the family by the household card's label, linking to the household (ruling D)", async () => {
    renderTab()
    const [garcia] = await screen.findAllByRole('link', { name: 'Pat Garcia' })
    expect(garcia).toHaveAttribute('href', '/aid/households/1000002?year=2027')
    expect(screen.queryByText('1000002')).toBeNull()
  })

  it('filters by the switcher, the grantor and the program, in the URL', async () => {
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: "Didn't apply 1" }))
    expect(screen.getByTestId('where')).toHaveTextContent('?show=didnt-apply')
    expect(footerCells()[0]).toBe('1 grant')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelled 2' }))
    expect(footerCells()[0]).toBe('2 grants · 1 not counted')
    await userEvent.click(screen.getByRole('button', { name: 'Grantor: All' }))
    await userEvent.click(screen.getByRole('option', { name: 'Grantor B' }))
    expect(screen.getByTestId('where')).toHaveTextContent('grantor=grantor_b')
    expect(footerCells()[0]).toBe('1 grant · 1 not counted')
    // The switcher's counts follow the grantor picked.
    expect(screen.getByRole('button', { name: 'All 2' })).toBeInTheDocument()
  })

  it('★17 lists the not-counted lines from the switcher', async () => {
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: 'Not counted 3' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?show=not-counted')
    expect(footerCells()[0]).toBe('3 grants · 3 not counted')
  })

  it('has one toolbar row: the Grantor and Program pickers, search, Record a Commitment…, Download CSV last — and no native select', async () => {
    renderTab()
    await screen.findByRole('group', { name: 'Show' })
    expect(document.querySelectorAll('select')).toHaveLength(0)
    const bars = Array.from(document.querySelectorAll('[data-aid-toolbar]'))
    expect(bars).toHaveLength(1)
    const bar = bars[0] as HTMLElement
    expect(within(bar).getByRole('button', { name: 'Grantor: All' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Program: All' })).toBeInTheDocument()
    expect(within(bar).getByPlaceholderText('Camper, family, grantor')).toBeInTheDocument()
    const buttons = within(bar).getAllByRole('button')
    expect(buttons[buttons.length - 1]).toHaveTextContent(/Download CSV/)
    expect(buttons.some((b) => b.textContent === 'Record a Commitment…')).toBe(true)
    // The switcher keeps its own row above (§18), and no sentence row sits anywhere.
    expect(bar.contains(switcher())).toBe(false)
  })

  it('"After the offer" shows the grants known after Round 1 posted (ruling G)', async () => {
    renderTab('/aid/grants/register?show=after-offer')
    await screen.findByRole('group', { name: 'Show' })
    expect(footerCells()[0]).toBe('1 grant')
    expect(screen.getByText('Quest · after the offer')).toBeInTheDocument()
    // money-grants.html: the late line's "extra for the family" rides in the title, not a second line.
    expect(screen.getByTitle(/after the offer: extra for the family/)).toBeInTheDocument()
    expect(screen.getByText('no grantor yet')).toBeInTheDocument()
  })

  it('opens a row in three panels: the grant, the request it offsets, what can be done (ruling A)', async () => {
    renderTab('/aid/grants/register?row=t4000001')
    await screen.findByRole('group', { name: 'Show' })
    const offsets = document.querySelector('[data-panel="offsets"]')
    expect(offsets).not.toBeNull()
    expect(
      within(offsets as HTMLElement).getByText('$700 of it · Session 2 · R1 $1,420')
    ).toBeInTheDocument()
    const actions = document.querySelector('[data-panel="actions"]') as HTMLElement
    expect(within(actions).getByText(/A grant line is CampMinder’s/)).toBeInTheDocument()
  })

  it('records a commitment for a camper on a request this season (D55; P-16)', async () => {
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: 'Record a Commitment…' }))
    const form = screen.getByTestId('commitment-form')
    // §24: wide and short. The fields sit in a label · field grid, what Save does in the right
    // column, and the buttons on one row; no native select.
    expect(within(form).getByText('Record a commitment')).toBeInTheDocument()
    expect(within(form).getAllByTestId('aid-editor-grid')).toHaveLength(2)
    expect(form.querySelector('select')).toBeNull()
    expect(form.querySelectorAll('[data-effect]')).toHaveLength(3)
    const save = within(form).getByRole('button', { name: 'Save' })
    expect(save.parentElement).toBe(
      within(form).getByRole('button', { name: 'Cancel' }).parentElement
    )
    // Final audit M-E1: the form opens BELOW the toolbar (AidTable's belowToolbar slot), so the
    // button just clicked never jumps down.
    expect(
      screen.getByRole('button', { name: 'Record a Commitment…' }).compareDocumentPosition(form) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    // The toolbar never shifts: its button stays on the row, off, while the form is open (money-grants.html).
    expect(screen.getByRole('button', { name: 'Record a Commitment…' })).toBeDisabled()
    await userEvent.click(within(form).getByRole('button', { name: 'Grantor: — pick —' }))
    await screen.findByRole('option', { name: 'Grantor C' })
    // Grantors in use only (D160): a retired one is never offered for a new commitment. Checked
    // while the form is open, so the check can fail (R5-17).
    expect(screen.queryByRole('option', { name: 'Grantor F (retired)' })).toBeNull()
    await userEvent.click(screen.getByRole('option', { name: 'Grantor C' }))
    await userEvent.click(within(form).getByRole('button', { name: 'Camper: — pick —' }))
    await userEvent.click(
      await screen.findByRole('option', { name: 'Riley Sam · Session 1 · The Sam Family' })
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
      await screen.findByText('✓ Commitment recorded · counts for the calculator from now')
    ).toBeInTheDocument()
    // The result rides the toolbar's status slot, not a sentence row that pushes the page down (§6).
    expect(
      screen
        .getByText('✓ Commitment recorded · counts for the calculator from now')
        .closest('[data-aid-toolbar]')
    ).not.toBeNull()
  })

  it('edits on a fresh read of the stored fields, keeping the stored note and date (review item 21)', async () => {
    renderTab('/aid/grants/register?row=ccmtriley0000001')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit…' }))
    const form = screen.getByTestId('commitment-form')
    // §24: an editor opened from a row takes the whole opened row, under the three panels.
    expect(within(form).getByText('Edit the commitment')).toBeInTheDocument()
    expect(form.closest('[data-panel]')).toBeNull()
    expect(form.closest('td')).toHaveAttribute('colspan')
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
    expect(await screen.findByText('✓ Commitment saved')).toBeInTheDocument()
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
    // The retired grantor stays as itself on the picker's face, and is never offered as a choice.
    const face = await within(form).findByRole('button', { name: 'Grantor: Grantor F (retired)' })
    await userEvent.click(face)
    expect(await screen.findByRole('option', { name: 'Grantor F (retired)' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
    await userEvent.keyboard('{Escape}')
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
    // §24: the reason editor, its buttons on one row (Cancel per the mock), the effect beside them.
    expect(screen.getByText('Withdraw this commitment')).toBeInTheDocument()
    const withdraw = screen.getByRole('button', { name: 'Withdraw' })
    expect(withdraw.parentElement).toBe(
      screen.getByRole('button', { name: 'Cancel' }).parentElement
    )
    expect(
      screen.getByText(/It leaves the Register and the calculator's grants from now/)
    ).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'Why' }), 'Grantor declined')
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toEqual({
      url: '/api/financial-aid/grants/2027/commitments/cmtriley0000001/withdraw',
      method: 'POST',
      body: JSON.stringify({ reason: 'Grantor declined' }),
    })
    expect(
      await screen.findByText(
        "✓ Commitment withdrawn, with your reason · it leaves the calculator's grants from now"
      )
    ).toBeInTheDocument()
  })

  it('offers view-only staff no commitment work', async () => {
    granted = ['financial_aid.view']
    renderTab('/aid/grants/register?row=ccmtriley0000001')
    await screen.findByRole('group', { name: 'Show' })
    const actions = document.querySelector('[data-panel="actions"]') as HTMLElement
    expect(within(actions).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Record a Commitment…' })).toBeNull()
  })

  it("⚠ counts a never-applied household's household-level line in the total and the footer", async () => {
    served = { ...GRANTS, grants: [...GRANTS.grants, NEVER_APPLIED_HOUSEHOLD] }
    renderTab()
    await screen.findByRole('group', { name: 'Show' })
    // 10,200 counted by the server + 900 the dashboard counts for the family that never applied.
    const cells = footerCells()
    expect(cells[0]).toBe('9 grants · 3 not counted')
    expect(cells).toContain('$11,100')
    // money-grants.html: the note sits in the "Aid request it offsets" column's own footer cell,
    // short, with the full sentence as its title; the label spans Camper and Family.
    const note = screen.getByText("incl. $900 didn't apply")
    expect(note.closest('td')).toHaveAttribute(
      'title',
      "The total counts 1 household-level line of families who didn't apply ($900)"
    )
    expect(document.querySelector('tfoot td')).toHaveAttribute('colspan', '2')
    expect(document.querySelector('tfoot td')).toHaveAttribute(
      'title',
      '9 grants shown · 3 not counted (1 reversed, 1 waiting for its camper, 1 a commitment whose camper cancelled)'
    )
  })

  it('puts "Aid request it offsets" just before Amount, and names the program from program_label', async () => {
    renderTab()
    await screen.findByRole('group', { name: 'Show' })
    const headers = screen
      .getAllByRole('columnheader')
      .map((h) => h.textContent.replace(/[^A-Za-z ]/g, '').trim())
    expect(headers.indexOf('Aid request it offsets')).toBe(headers.indexOf('Amount') - 1)
    expect(screen.getAllByText('Summer Camp').length).toBeGreaterThan(0)
    // Final audit E18: a line with no program reads "—" (the Camper cell says household level / needs a camper).
    expect(screen.queryByText('Not placed')).toBeNull()
  })

  it('fits a 1440 screen: the seven columns sum to no more than the 1214px inside the card border', async () => {
    renderTab()
    await screen.findByRole('group', { name: 'Show' })
    const cols = Array.from(document.querySelectorAll('table colgroup col'))
    expect(cols).toHaveLength(7)
    const widths = cols.map((c) => parseFloat((c as HTMLElement).style.width) || 0)
    expect(widths.reduce((sum, w) => sum + w, 0)).toBeLessThanOrEqual(1214)
    // The two status columns' 200px went to the names (money-grants.html: Camper 196, Family 226).
    expect(widths[0]).toBeGreaterThanOrEqual(190)
    expect(widths[1]).toBeGreaterThanOrEqual(220)
  })

  it('keeps every header on one line and gives every cut cell its words as a title (§8, §13)', async () => {
    renderTab()
    await screen.findByRole('group', { name: 'Show' })
    for (const th of screen.getAllByRole('columnheader'))
      expect(th.className).toMatch(/whitespace-nowrap/)
    // Every cell but a counted Amount (a figure is never cut).
    for (const td of document.querySelectorAll(
      'tbody tr:not([data-aid-detail]) td:not(:nth-child(6))'
    )) {
      if (td.textContent.trim() !== '' && td.textContent.trim() !== '—') {
        expect(
          td.getAttribute('title') ?? td.querySelector('[title]')?.getAttribute('title')
        ).toBeTruthy()
      }
    }
  })

  it('words the Grantor and Program filters\' no-filter choice "All", sentence case like the Ledger', async () => {
    renderTab()
    await screen.findByRole('group', { name: 'Show' })
    for (const name of ['Grantor', 'Program']) {
      await userEvent.click(screen.getByRole('button', { name: `${name}: All` }))
      expect(screen.getAllByRole('option')[0]).toHaveTextContent(/^(✓)?All$/)
      await userEvent.keyboard('{Escape}')
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
    await screen.findByRole('group', { name: 'Show' })
    expect(screen.queryByText(/Grants this season/)).toBeNull()
  })
})
