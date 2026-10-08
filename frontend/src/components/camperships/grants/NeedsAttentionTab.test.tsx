/**
 * Grants › Needs attention through its real hooks (spec §8.2; D126, D160; S3-6; P-9, P-17; ruling G,
 * review item 8): the three groups, Confirm, Another Camper…, and the bulk confirm of single, exact
 * suggestions. Only `fetch` is faked.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidGrants } from '../../../types/api-types'
import { GARCIA_HOUSEHOLD, GRANTS, grantRow } from './grantsFixtures'
import { NeedsAttentionTab } from './NeedsAttentionTab'

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

const VIEW = { year: 2027, asOf: { kind: 'live' } as const }
const CHEN_HOUSEHOLD = grantRow({
  transaction_cm_id: 4000008,
  household_cm_id: 1000003,
  family_name: 'Chen',
  person_cm_id: 0,
  camper_name: '',
  camper_basis: 'none',
  amount: 800,
  counts: false,
  requests: [],
})
/** Two needs: Garcia's single suggestion, and Chen's with two campers (not single). */
const TWO: ApiAidGrants = {
  ...GRANTS,
  needs_camper: [
    ...GRANTS.needs_camper,
    {
      grant: CHEN_HOUSEHOLD,
      household_applied: true,
      suggestion: {
        person_cm_id: 2000003,
        camper_name: 'Olivia Chen',
        session_cm_id: 0,
        program_family: 'summer',
        basis: 'attribution',
        method: 'fa_application_program',
        commitment_id: '',
        amount_matches: false,
      },
      candidates: [
        { person_cm_id: 2000003, name: 'Olivia Chen' },
        { person_cm_id: 2000010, name: 'Riley Chen' },
      ],
    },
  ],
}
/** A second single suggestion, in another household (placed by someone else in the P-9 test). */
const SAM_HOUSEHOLD = grantRow({
  transaction_cm_id: 4000010,
  household_cm_id: 1000004,
  family_name: 'Sam',
  person_cm_id: 0,
  camper_name: '',
  camper_basis: 'none',
  grantor_key: 'grantor_c',
  grantor_name: 'Grantor C',
  amount: 600,
  counts: false,
  requests: [],
})
const THREE: ApiAidGrants = {
  ...TWO,
  needs_camper: [
    ...TWO.needs_camper,
    {
      grant: SAM_HOUSEHOLD,
      household_applied: true,
      suggestion: {
        person_cm_id: 2000004,
        camper_name: 'Riley Sam',
        session_cm_id: 1000103,
        program_family: 'summer',
        basis: 'attribution',
        method: 'household_single_camper',
        commitment_id: '',
        amount_matches: false,
      },
      candidates: [{ person_cm_id: 2000004, name: 'Riley Sam' }],
    },
  ],
}

/** The Register's priced read and the stored-fields read (`offsets=false`), apart. */
let read: ApiAidGrants = GRANTS
let stored: ApiAidGrants | null = null
let fetchSpy: MockInstance<typeof fetch>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const writes = () =>
  fetchSpy.mock.calls
    .map(([url, init]) => ({ url: String(url), method: init?.method ?? 'GET', body: init?.body }))
    .filter((call) => call.method !== 'GET')
const PLACED = { year: 2027, placed: 1, unchanged: 0, operation_id: 'op0000000000001' }

beforeEach(() => {
  granted = ['financial_aid.view', 'financial_aid.casework']
  read = GRANTS
  stored = null
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const path = String(url)
    if ((init?.method ?? 'GET') !== 'GET') return Promise.resolve(json(PLACED))
    if (path.includes('offsets=false')) return Promise.resolve(json(stored ?? read))
    if (path.startsWith('/api/financial-aid/grants/2027')) return Promise.resolve(json(read))
    return Promise.resolve(json({ detail: 'no approved rules' }, 404))
  })
})
afterEach(() => fetchSpy.mockRestore())

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NeedsAttentionTab view={VIEW} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('Grants › Needs attention (§8.2)', () => {
  it('groups by reason: unmapped descriptions link to their Sources row, commitments to the Register', async () => {
    renderTab()
    expect(await screen.findByText('Needs a camper · 1 line')).toBeInTheDocument()
    expect(screen.getByText(/The dashboard suggests; a person confirms\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Map It in Money › Sources ›' })).toHaveAttribute(
      'href',
      '/aid/money/sources?row=srcgrantore0005&year=2027'
    )
    expect(
      screen.getByText('Riley Sam · Grantor C · $6,200 · 18 days · not posted in CampMinder yet')
    ).toBeInTheDocument()
    const [riley] = screen.getAllByRole('link', { name: 'Edit or Withdraw in the Register ›' })
    expect(riley).toHaveAttribute('href', '/aid/grants/register?row=ccmtriley0000001&year=2027')
    // Ruling G: no pointer to Today anywhere.
    expect(screen.queryByRole('link', { name: /Today/ })).toBeNull()
  })

  it('Confirm places the line on the suggested camper and session, after a fresh read (P-9)', async () => {
    renderTab()
    await userEvent.click(
      await screen.findByText('$1,500 · Grantor B · posted to the household · Apr 3')
    )
    const panel = await screen.findByTestId('needs-camper-panel')
    expect(
      within(panel).getByText("Liam Garcia: the household's one camper enrolled this season.")
    ).toBeInTheDocument()
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toEqual({
      url: '/api/financial-aid/grants/2027/placements',
      method: 'POST',
      body: JSON.stringify({
        placements: [
          {
            transaction_cm_id: GARCIA_HOUSEHOLD.transaction_cm_id,
            person_cm_id: 2000002,
            session_cm_id: 1000102,
          },
        ],
        note: '',
      }),
    })
    expect(await screen.findByText(/^✓ 1 line placed on its camper/)).toBeInTheDocument()
  })

  it('Confirm sends nothing when the line was placed meanwhile', async () => {
    stored = { ...GRANTS, needs_camper: [] }
    renderTab()
    await userEvent.click(
      await screen.findByText('$1,500 · Grantor B · posted to the household · Apr 3')
    )
    const panel = await screen.findByTestId('needs-camper-panel')
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
    expect(await within(panel).findByText(/This line has its camper now/)).toBeInTheDocument()
    expect(writes()).toHaveLength(0)
  })

  it('Another Camper… places on the camper picked, with no session (P-17)', async () => {
    read = TWO
    renderTab()
    await userEvent.click(
      await screen.findByText('$800 · Grantor A · posted to the household · Mar 12')
    )
    const panel = await screen.findByTestId('needs-camper-panel')
    await userEvent.click(within(panel).getByRole('button', { name: 'Another Camper…' }))
    const form = within(panel).getByTestId('place-camper-form')
    await userEvent.selectOptions(
      within(form).getByRole('combobox', { name: 'Camper' }),
      'Riley Chen'
    )
    await userEvent.click(within(form).getByRole('button', { name: 'Place It' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(JSON.parse(String(writes()[0]?.body))).toEqual({
      placements: [{ transaction_cm_id: 4000008, person_cm_id: 2000010, session_cm_id: null }],
      note: '',
    })
  })

  it('bulk: the button takes every single, exact suggestion and nothing else (S3-6)', async () => {
    read = TWO
    renderTab()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Confirm the 1 Single, Exact Suggestion…' })
    )
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Garcia: \$1,500 · Grantor B/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/Chen:/)).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm 1' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(JSON.parse(String(writes()[0]?.body)).placements).toHaveLength(1)
  })

  it('bulk: rows checked by hand stay checked across a search, and a line that is not single is left out by name', async () => {
    read = TWO
    renderTab()
    const boxes = await screen.findAllByRole('checkbox', { name: 'Select' })
    await userEvent.click(boxes[0] as HTMLElement)
    await userEvent.click(boxes[1] as HTMLElement)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'Garcia')
    expect(screen.getByText('2 selected · 1 hidden by the search')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm the Selected…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Left out, confirm one at a time: Chen/)).toBeInTheDocument()
  })

  it('bulk: sends nothing when a line was placed meanwhile, refreshes, and Confirm then sends what still needs a camper (P-9)', async () => {
    read = THREE
    renderTab()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Confirm the 2 Single, Exact Suggestions…' })
    )
    const dialog = await screen.findByRole('dialog')
    // Someone else placed Sam's line meanwhile.
    read = TWO
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm 2' }))
    expect(
      await within(dialog).findByText(
        /1 line was placed since the page loaded; nothing was written/
      )
    ).toBeInTheDocument()
    expect(writes()).toHaveLength(0)
    expect(
      await within(dialog).findByText('1 line is no longer open and was left out.')
    ).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm 1' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    const sent = JSON.parse(String(writes()[0]?.body)) as {
      placements: Array<{ transaction_cm_id: number }>
    }
    expect(sent.placements.map((p) => p.transaction_cm_id)).toEqual([
      GARCIA_HOUSEHOLD.transaction_cm_id,
    ])
  })

  it('offers view-only staff nothing to change', async () => {
    granted = ['financial_aid.view']
    renderTab()
    await userEvent.click(
      await screen.findByText('$1,500 · Grantor B · posted to the household · Apr 3')
    )
    const panel = await screen.findByTestId('needs-camper-panel')
    expect(within(panel).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getAllByRole('link', { name: 'Open in the Register ›' })).toHaveLength(2)
  })
})
