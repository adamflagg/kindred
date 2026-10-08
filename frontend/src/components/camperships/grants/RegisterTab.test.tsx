/**
 * Grants › Register end to end through its real hooks (spec §8.2; D55, D126, D142; rulings A, D, G;
 * P-15): the rows, the filters, the counted total and the opened row. Only `fetch` is faked.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { GRANTS } from './grantsFixtures'
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

beforeEach(() => {
  granted = REGISTRAR
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-20T18:00:00Z'))
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const path = String(url)
    if (path.startsWith('/api/financial-aid/grants/2027')) return Promise.resolve(json(GRANTS))
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
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
    expect(screen.getAllByText('committed · not yet in CampMinder')).toHaveLength(2)
    expect(screen.getByText('in CampMinder · Mar 12 · reversed Apr 1')).toBeInTheDocument()
    expect(screen.getAllByText('not counted')).toHaveLength(3)
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
})
