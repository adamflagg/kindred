/**
 * The household page's Grants tab buttons (rulings:340): "Add a Commitment…" and "Place on a
 * Camper…" open slice 3's grant forms pre-filled with the household, for casework. Real hooks; only
 * `fetch` is faked.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { grantRow } from '../../components/camperships/grants/grantsFixtures'
import { householdPage } from '../../components/camperships/household/householdFixtures'
import type { ApiAidGrants, ApiAidHouseholdPage } from '../../types/api-types'
import AidHouseholdPage from './AidHouseholdPage'

vi.mock('../../lib/pocketbase', () => ({
  pb: { authStore: { token: 'test-jwt', clear: vi.fn() } },
}))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ isLoading: false, user: { id: 'u1' } }),
}))
let granted: string[] = []
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../../components/camperships/shell/AidDefinitionNotes', () => ({
  AidDefinitionNotes: () => null,
}))

/** A household-level line Grants lists as needing a camper, beside the page's own grant. */
const BASE_PAGE = householdPage()
const [EMMA_LINE] = BASE_PAGE.grants
const NEEDS_LINE = {
  ...(EMMA_LINE as NonNullable<typeof EMMA_LINE>),
  transaction_cm_id: 1000304,
  person_cm_id: 0,
  camper_name: '',
  camper_basis: 'none' as const,
  session_cm_id: 0,
  session_name: '',
  grantor_key: 'grantor_b',
  grantor_name: 'Grantor B',
  description: 'Grantor B grant',
  amount: 1500,
  counts: false,
  in_band: false,
  requests: [],
}
const PAGE: ApiAidHouseholdPage = householdPage({ grants: [...BASE_PAGE.grants, NEEDS_LINE] })
const LINE_IN_GRANTS = grantRow({
  transaction_cm_id: 1000304,
  person_cm_id: 0,
  camper_name: '',
  camper_basis: 'none',
  grantor_key: 'grantor_b',
  grantor_name: 'Grantor B',
  counts: false,
  requests: [],
})
const GRANTS_READ: ApiAidGrants = {
  year: 2027,
  grants: [LINE_IN_GRANTS],
  needs_camper: [
    {
      grant: LINE_IN_GRANTS,
      household_applied: true,
      suggestion: {
        person_cm_id: 1000002,
        camper_name: 'Emma Johnson',
        session_cm_id: 1000101,
        program_family: 'summer',
        basis: 'attribution',
        method: 'fa_application_program',
        commitment_id: '',
        amount_matches: false,
      },
      candidates: [
        { person_cm_id: 1000002, name: 'Emma Johnson' },
        { person_cm_id: 1000010, name: 'Samuel Johnson' },
      ],
    },
  ],
  unmapped: [],
  waiting: [],
  expected: [],
}
const GRANTORS = {
  grantors: [
    {
      key: 'grantor_c',
      name: 'Grantor C',
      aliases: [],
      full_coverage: false,
      covers_canteen: 'unknown',
      pays_after_camp_aid: false,
      eligibility: '',
      contacts: '',
      retired_at: '',
      descriptions: [],
    },
  ],
}

let storedRead: ApiAidGrants = GRANTS_READ
let fetchSpy: MockInstance<typeof fetch>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const writes = () =>
  fetchSpy.mock.calls
    .map(([url, init]) => ({ url: String(url), method: init?.method ?? 'GET', body: init?.body }))
    .filter((call) => call.method !== 'GET')

beforeEach(() => {
  granted = ['financial_aid.view', 'financial_aid.casework']
  storedRead = GRANTS_READ
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-20T18:00:00Z'))
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const path = String(url)
    if ((init?.method ?? 'GET') !== 'GET') {
      return Promise.resolve(
        json(
          path.endsWith('/placements')
            ? { year: 2027, placed: 1, unchanged: 0, operation_id: 'op0000000000009' }
            : {}
        )
      )
    }
    if (path.startsWith('/api/financial-aid/household-page/2027/1000001')) {
      return Promise.resolve(json(PAGE))
    }
    if (path.includes('offsets=false')) return Promise.resolve(json(storedRead))
    if (path.startsWith('/api/financial-aid/grants/2027')) return Promise.resolve(json(GRANTS_READ))
    if (path.startsWith('/api/financial-aid/grantors')) return Promise.resolve(json(GRANTORS))
    return Promise.resolve(json({ detail: 'not here' }, 404))
  })
})
afterEach(() => {
  fetchSpy.mockRestore()
  vi.useRealTimers()
})

async function openGrantsTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/aid/households/1000001']}>
        <Routes>
          <Route path="/aid/households/:householdCmId" element={<AidHouseholdPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  await userEvent.click(await screen.findByRole('button', { name: /Grants and postings/ }))
  return screen.getByRole('table', { name: 'Grants' })
}

describe("the household page's grant buttons (rulings:340)", () => {
  it('places a line Grants lists as needing a camper, the suggestion pre-picked', async () => {
    const table = await openGrantsTab()
    // Only on the line that needs a camper: Emma's own line has hers.
    const [place] = await within(table).findAllByRole('button', { name: 'Place on a Camper…' })
    expect(within(table).getAllByRole('button', { name: 'Place on a Camper…' })).toHaveLength(1)
    await userEvent.click(place as HTMLElement)
    const form = screen.getByTestId('place-camper-form')
    expect(within(form).getByRole('combobox', { name: 'Camper' })).toHaveValue('1000002')
    expect(
      within(form).getByText('Emma Johnson: the program the aid application asked for.')
    ).toBeInTheDocument()
    await userEvent.click(within(form).getByRole('button', { name: 'Place It' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]).toEqual({
      url: '/api/financial-aid/grants/2027/placements',
      method: 'POST',
      body: JSON.stringify({
        placements: [{ transaction_cm_id: 1000304, person_cm_id: 1000002, session_cm_id: 1000101 }],
        note: '',
      }),
    })
    expect(await screen.findByText(/✓ 1 line placed on its camper/)).toBeInTheDocument()
  })

  it('sends nothing when someone placed the line since the page loaded (P-9)', async () => {
    storedRead = { ...GRANTS_READ, needs_camper: [] }
    const table = await openGrantsTab()
    await userEvent.click(await within(table).findByRole('button', { name: 'Place on a Camper…' }))
    const form = screen.getByTestId('place-camper-form')
    await userEvent.click(within(form).getByRole('button', { name: 'Place It' }))
    expect(
      await within(form).findByText(/This line has its camper now: someone placed it/)
    ).toBeInTheDocument()
    expect(writes()).toHaveLength(0)
  })

  it("adds a commitment for one of the household's campers", async () => {
    await openGrantsTab()
    await userEvent.click(screen.getByRole('button', { name: 'Add a Commitment…' }))
    const form = screen.getByTestId('commitment-form')
    const camper = within(form).getByRole('combobox', { name: 'Camper' })
    // The page's campers only, not the season's.
    expect(
      within(camper)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual([
      '— pick —',
      'Emma Johnson · Session 2 · The Johnson Family',
      'Samuel Johnson · Session 3 · The Johnson Family',
    ])
    await within(form).findByRole('option', { name: 'Grantor C' })
    await userEvent.selectOptions(
      within(form).getByRole('combobox', { name: 'Grantor' }),
      'Grantor C'
    )
    await userEvent.selectOptions(camper, 'Samuel Johnson · Session 3 · The Johnson Family')
    await userEvent.type(within(form).getByRole('textbox', { name: 'Amount' }), '500')
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(JSON.parse(String(writes()[0]?.body))).toEqual({
      grantor_key: 'grantor_c',
      household_cm_id: 1000001,
      person_cm_id: 1000010,
      session_cm_id: 1000102,
      amount: '500.00',
      committed_on: '2027-04-20',
      note: '',
    })
    expect(await screen.findByText(/✓ Commitment recorded/)).toBeInTheDocument()
    // The season's grid is never read for it.
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/grid'))).toBe(false)
  })

  it('offers view-only staff neither button; the grants stay read-only', async () => {
    granted = ['financial_aid.view']
    await openGrantsTab()
    expect(screen.queryByRole('button', { name: 'Add a Commitment…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Place on a Camper…' })).toBeNull()
  })
})
