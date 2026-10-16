/**
 * Season's "CampMinder aid on no request" opened in place (owner Q4-A; the form-intake mock, steps 2–5): one line per
 * camper (or household) × session in a kit table, each with Add a Request… opening its editor right there, pre-filled
 * with the session the posting suggests, the registration ask, and CampMinder's amount as Round 1, ticked (Q5-A).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { SeasonStatusContext } from '../season/seasonStatus'
import { AidOnNoRequestPanel } from './AidOnNoRequestPanel'
import { LUCAS, OKAFOR_HH, aidOnNoRequestRead, formsRead } from './intakeFixtures'

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
vi.mock('../../../hooks/useCurrentYear', () => ({ useYear: () => 2026 }))
vi.mock('../../../hooks/camperships/useAidProgramNames', () => ({
  useAidProgramPool: () => (program: string) => (program === 'summer' ? 'Camp & Quest' : null),
}))

let lines = aidOnNoRequestRead()
let fetchSpy: MockInstance<typeof fetch>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const setStatus = vi.fn()

beforeEach(() => {
  granted = ['financial_aid.view', 'financial_aid.casework']
  lines = aidOnNoRequestRead()
  setStatus.mockReset()
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const path = String(url)
    if (init?.method === 'POST') return Promise.resolve(json({ addition: {}, request: {} }, 201))
    if (path.includes('/intake/2026/aid-on-no-request')) return Promise.resolve(json(lines))
    if (path.includes('/intake/2026/forms'))
      return Promise.resolve(json(formsRead([LUCAS, OKAFOR_HH], 2026)))
    return Promise.resolve(json({ detail: 'not here' }, 404))
  })
})
afterEach(() => fetchSpy.mockRestore())

function renderPanel(pool: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SeasonStatusContext.Provider value={setStatus}>
          <AidOnNoRequestPanel pool={pool} />
        </SeasonStatusContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

describe("Season's CampMinder aid on no request, opened in place", () => {
  it('lists one line per family × session, the money amber, with its own footer', async () => {
    renderPanel()
    await screen.findByText('Lucas Garcia')
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent.trim())).toEqual([
      'Family',
      'Session the posting suggests',
      'Posted',
      'CampMinder aid',
      '',
    ])
    const lucas = rowOf('Lucas Garcia')
    expect(within(lucas).getByRole('link', { name: /Rosa Garcia/ })).toHaveAttribute(
      'href',
      '/aid/households/1000011?year=2026'
    )
    expect(within(lucas).getByText('Session 3')).toBeInTheDocument()
    expect(within(lucas).getByText('Mar 9')).toBeInTheDocument()
    expect(within(lucas).getByText('$2,258').className).toMatch(/amber/)
    expect(within(rowOf('⌂ Daniel & Priya Chen-Okafor')).getByText('FC2')).toBeInTheDocument()
    expect(screen.getByText('2 families · 2 lines')).toBeInTheDocument()
    expect(screen.getByText('$2,716').className).toMatch(/amber/)
  })

  it("shows only Season's selected pool's lines, its footer and total that pool's (?pool=)", async () => {
    renderPanel('camp_pool')
    await screen.findByText('Lucas Garcia')
    expect(screen.queryByText('⌂ Daniel & Priya Chen-Okafor')).toBeNull()
    expect(screen.getByText('1 family · 1 line')).toBeInTheDocument()
    expect(screen.getAllByText('$2,258').length).toBe(2) // the line and its total
  })

  it('opens Add a Request… right there, pre-filled: the suggested session, the registration ask, Round 1 ticked', async () => {
    renderPanel()
    await screen.findByText('Lucas Garcia')
    await userEvent.click(
      within(rowOf('Lucas Garcia')).getByRole('button', { name: 'Add a Request…' })
    )
    expect(screen.getByText('Add a Request · Lucas Garcia')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Session:/ })).toHaveTextContent(
      'Session 3 · CampMinder aid here'
    )
    await waitFor(() => expect(screen.getByLabelText('Ask')).toHaveValue('2500'))
    expect(
      screen.getByRole('checkbox', {
        name: /Record CampMinder's \$2,258 as Round 1, posted \(Mar 9\)$/,
      })
    ).toBeChecked()
  })

  it('records the Round 1 and says so in the Season status slot', async () => {
    renderPanel()
    await screen.findByText('Lucas Garcia')
    await userEvent.click(
      within(rowOf('Lucas Garcia')).getByRole('button', { name: 'Add a Request…' })
    )
    await waitFor(() => expect(screen.getByLabelText('Ask')).toHaveValue('2500'))
    await userEvent.type(
      screen.getByLabelText('Reason'),
      'Assessed by phone; CampMinder aid already posted'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Add Request' }))
    await waitFor(() =>
      expect(setStatus).toHaveBeenCalledWith(
        '✓ Lucas Garcia · S3 added · $2,258 now counts as Posted in Camp & Quest'
      )
    )
    const post = fetchSpy.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(post[0]).toBe('/api/financial-aid/requests/2026/additions')
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({
      ask: 2500,
      round1_campminder: 2258,
    })
  })

  it('offers no Add a Request… without casework', async () => {
    granted = ['financial_aid.view']
    renderPanel()
    await screen.findByText('Lucas Garcia')
    expect(screen.queryByRole('button', { name: 'Add a Request…' })).toBeNull()
  })

  it('says so once every family on the line has a request', async () => {
    lines = { ...aidOnNoRequestRead(), lines: [], total: 0, families: 0 }
    renderPanel()
    expect(
      await screen.findByText(
        'Nothing left on this line: every family it counted now has a request.'
      )
    ).toBeInTheDocument()
  })
})
