/**
 * Money › To place, end to end through its real hooks (spec §8.1; §4.10; D12, D58, D152): what a
 * line shows, what Confirm sends, and that a refusal never leaves the panel stuck. Only `fetch` is
 * faked: `useApiWithAuth` and the write layer run as built.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidToPlace } from '../../../types/api-types'
import { ToPlaceTab } from './ToPlaceTab'
import { CHEN_EXACT, TO_PLACE, TO_PLACE_SKIPPED } from './toPlaceFixtures'

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
const PLACED = {
  year: 2027,
  operation_id: 'op0000000000001',
  placed: [3000003],
  ticked: [{ request_id: 'reqolivia000003', round: 2, amount: 1500 }],
  left_to_tick: [],
}
const WROTE = {
  year: 2027,
  transaction_cm_id: 3000006,
  written: 1,
  operation_id: 'op0000000000002',
}

let reads: ApiAidToPlace[] = []
let answers: Response[] = []
let fetchSpy: MockInstance<typeof fetch>
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const writes = () =>
  fetchSpy.mock.calls
    .map(([url, init]) => ({ url: String(url), method: init?.method ?? 'GET', body: init?.body }))
    .filter((call) => call.method !== 'GET')

beforeEach(() => {
  granted = REGISTRAR
  reads = [TO_PLACE]
  answers = []
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      // Each read takes the next answer; the last one repeats.
      const next = reads.length > 1 ? reads.shift() : reads[0]
      return Promise.resolve(json(next ?? TO_PLACE))
    }
    return Promise.resolve(answers.shift() ?? json(PLACED))
  })
})
afterEach(() => fetchSpy.mockRestore())

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToPlaceTab view={VIEW} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const openLine = async (words: string) => {
  await userEvent.click(await screen.findByText(words))
  return screen.findByTestId('to-place-panel')
}

describe('Money › To place (§8.1)', () => {
  it("shows the server's open count and total, and the lines grouped by its reasons", async () => {
    renderTab()
    expect(await screen.findByText('5 lines open · $6,920')).toBeInTheDocument()
    expect(screen.getByText('Several requests could take this line')).toBeInTheDocument()
    expect(screen.getByText('3 households · 3 lines')).toBeInTheDocument()
    expect(screen.getByText('No request behind this line')).toBeInTheDocument()
    expect(screen.getByText('1 · $120 · not counted as open')).toBeInTheDocument()
  })

  it('opens a line: its candidates, the suggestion, its evidence and what Confirm does', async () => {
    renderTab()
    const panel = await openLine('$3,620 · Camp aid · Summer · posted to the household · May 14')
    expect(within(panel).getByText('Emma Johnson · Session 2')).toBeInTheDocument()
    expect(within(panel).getByText('$2,200 not yet in CampMinder')).toBeInTheDocument()
    expect(
      within(panel).getByText('Ticks Emma Johnson · Session 2 · Round 2 · $780 locked')
    ).toBeInTheDocument()
  })

  it('Confirm sends what it showed it would lock, and says what it ticked', async () => {
    renderTab()
    const panel = await openLine('$1,500 · Camp aid · Quest · posted to the household · May 20')
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
    expect(
      await screen.findByText(
        '✓ Chen: $1,500 placed. Ticked Posted: Olivia Chen · Quest Round 2 · $1,500 locked.'
      )
    ).toBeInTheDocument()
    expect(writes()).toEqual([
      {
        url: '/api/financial-aid/money/2027/to-place/3000003/place',
        method: 'POST',
        body: JSON.stringify({
          parts: [{ request_id: 'reqolivia000003', amount: '1500.00' }],
          note: '',
          expected_locked: '1500.00',
        }),
      },
    ])
  })

  it('never sticks after "this now locks…": the panel shows the new preview and confirms it', async () => {
    const moved: ApiAidToPlace = {
      ...TO_PLACE,
      groups: TO_PLACE.groups.map((g) => ({
        ...g,
        lines: g.lines.map((l) =>
          l.transaction_cm_id === CHEN_EXACT.transaction_cm_id && l.suggestion
            ? {
                ...l,
                suggestion: {
                  ...l.suggestion,
                  would_tick: [{ request_id: 'reqolivia000003', round: 2, amount: 1400 }],
                  would_lock: 1400,
                },
              }
            : l
        ),
      })),
    }
    reads = [TO_PLACE, moved]
    answers = [
      json(
        {
          detail:
            'this now locks $1,400, not the $1,500 you confirmed: reload To place and check it again',
        },
        422
      ),
    ]
    renderTab()
    const panel = await openLine('$1,500 · Camp aid · Quest · posted to the household · May 20')
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
    expect(
      await within(panel).findByText(/What this would lock changed since the page loaded/)
    ).toBeInTheDocument()
    expect(
      within(panel).getByText('Ticks Olivia Chen · Quest · Round 2 · $1,400 locked')
    ).toBeInTheDocument()
    const confirm = within(panel).getByRole('button', { name: 'Confirm' })
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    await waitFor(() => expect(writes()).toHaveLength(2))
    expect(JSON.parse(String(writes()[1]?.body))).toMatchObject({ expected_locked: '1400.00' })
  })

  it('a 409 race says someone else changed it, and Confirm stays on', async () => {
    answers = [json({ detail: 'Someone else changed this; reload and try again' }, 409)]
    renderTab()
    const panel = await openLine('$1,500 · Camp aid · Quest · posted to the household · May 20')
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
    expect(
      await within(panel).findByText(/Someone else changed this while you looked/)
    ).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Confirm' })).toBeEnabled()
  })

  it('leaves a line at family level with a note', async () => {
    answers = [json(WROTE)]
    renderTab()
    const panel = await openLine('$1,500 · Camp aid · Quest · posted to the household · May 20')
    await userEvent.click(within(panel).getByRole('button', { name: 'Leave at family level…' }))
    await userEvent.type(within(panel).getByRole('textbox'), 'Waiting on CampMinder')
    await userEvent.click(within(panel).getByRole('button', { name: 'Leave it' }))
    expect(
      await screen.findByText('✓ Chen: left at family level with your note. Reopen needs a reason.')
    ).toBeInTheDocument()
    expect(writes()).toEqual([
      {
        url: '/api/financial-aid/money/2027/to-place/3000003/leave',
        method: 'POST',
        body: JSON.stringify({ note: 'Waiting on CampMinder' }),
      },
    ])
  })

  it('reopens a left line with a reason', async () => {
    answers = [json(WROTE)]
    renderTab()
    const left = await screen.findByTestId('left-lines')
    expect(within(left).getByText('Left: A deposit credit keyed as aid')).toBeInTheDocument()
    await userEvent.click(within(left).getByRole('button', { name: 'Reopen…' }))
    await userEvent.type(within(left).getByRole('textbox'), 'Fixed in CampMinder')
    await userEvent.click(within(left).getByRole('button', { name: 'Reopen' }))
    expect(
      await screen.findByText('✓ Garcia: reopened; the line is open again.')
    ).toBeInTheDocument()
    expect(writes()[0]).toMatchObject({
      url: '/api/financial-aid/money/2027/to-place/3000006/leave?reason=Fixed+in+CampMinder',
      method: 'DELETE',
    })
  })

  it('shows view-only staff the line and its preview, and no way to change it', async () => {
    granted = ['financial_aid.view']
    renderTab()
    const panel = await openLine('$1,500 · Camp aid · Quest · posted to the household · May 20')
    expect(within(panel).getByText('What Confirm does')).toBeInTheDocument()
    expect(within(panel).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reopen…' })).toBeNull()
  })

  it('says why a season before 2027 has nothing to place', async () => {
    reads = [TO_PLACE_SKIPPED]
    renderTab()
    expect(
      await screen.findByText(
        'Nothing to place for 2026: 2026 predates To place (the first ticked season is 2027).'
      )
    ).toBeInTheDocument()
  })
})
