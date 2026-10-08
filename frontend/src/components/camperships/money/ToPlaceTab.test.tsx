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

const downloadSpy = vi.fn()
vi.mock('../../../utils/csvExport', async (importActual) => ({
  ...(await importActual<typeof import('../../../utils/csvExport')>()),
  downloadCsv: (...args: unknown[]) => downloadSpy(...args),
}))
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
// A write held open until the test lets it go (the in-flight traps), and reads that fail.
let gate: Promise<Response> | null = null
let failReads = false
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
  gate = null
  failReads = false
  downloadSpy.mockClear()
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
    if ((init?.method ?? 'GET') === 'GET') {
      if (failReads) return Promise.resolve(json({ detail: 'Server error' }, 500))
      // Each read takes the next answer; the last one repeats.
      const next = reads.length > 1 ? reads.shift() : reads[0]
      return Promise.resolve(json(next ?? TO_PLACE))
    }
    if (gate) return gate
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
    expect(screen.getByText('Several requests could take this')).toBeInTheDocument()
    expect(screen.getByText('3 households · 3 lines')).toBeInTheDocument()
    expect(screen.getByText('No request behind it')).toBeInTheDocument()
    expect(screen.getByText('1 · $120 · not counted as open')).toBeInTheDocument()
  })

  it('opens a line: its candidates, the suggestion, its evidence and what Confirm does', async () => {
    renderTab()
    const panel = await openLine('$3,620 · Camp aid · Summer · posted to the household · May 14')
    expect(within(panel).getByText('Emma Johnson · Session 2')).toBeInTheDocument()
    expect(within(panel).getByText('$2,200 not yet in CampMinder')).toBeInTheDocument()
    expect(
      within(panel).getByText('Marks Posted: Emma Johnson · Session 2 · Round 2 · $780 locked')
    ).toBeInTheDocument()
  })

  it('Confirm sends what it showed it would lock, and says what it marked posted', async () => {
    renderTab()
    const panel = await openLine('$1,500 · Camp aid · Quest · posted to the household · May 20')
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
    expect(
      await screen.findByText(
        '✓ Chen: $1,500 placed. Marked Posted: Olivia Chen · Quest Round 2 · $1,500 locked.'
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
      within(panel).getByText('Marks Posted: Olivia Chen · Quest · Round 2 · $1,400 locked')
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
    await userEvent.click(within(panel).getByRole('button', { name: 'Leave at Family Level…' }))
    await userEvent.type(within(panel).getByRole('textbox'), 'Waiting on CampMinder')
    await userEvent.click(within(panel).getByRole('button', { name: 'Leave It' }))
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
      await screen.findByText('Nothing to place: 2026 predates To place, which starts in 2027.')
    ).toBeInTheDocument()
  })

  describe('a refusal is never lost (review I1)', () => {
    const without = (txn: number): ApiAidToPlace => ({
      ...TO_PLACE,
      groups: TO_PLACE.groups.map((g) => ({
        ...g,
        lines: g.lines.filter((l) => l.transaction_cm_id !== txn),
      })),
    })

    it('says so when the refused line has left the table (someone else placed it)', async () => {
      reads = [TO_PLACE, without(CHEN_EXACT.transaction_cm_id)]
      answers = [json({ detail: 'line 3000003: line 3000003 is already on a request' }, 422)]
      renderTab()
      const panel = await openLine('$1,500 · Camp aid · Quest · posted to the household · May 20')
      await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
      expect(
        await screen.findByText(
          'Nothing was written: line 3000003: line 3000003 is already on a request'
        )
      ).toBeInTheDocument()
    })

    it('says so for a 409 race on a line that has left the table', async () => {
      reads = [TO_PLACE, without(CHEN_EXACT.transaction_cm_id)]
      answers = [json({ detail: 'Someone else changed this; reload and try again' }, 409)]
      renderTab()
      const panel = await openLine('$1,500 · Camp aid · Quest · posted to the household · May 20')
      await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
      expect(
        await screen.findByText(/Someone else changed this while you looked; nothing was written/)
      ).toBeInTheDocument()
    })

    it('a refusal replaces a stale green line', async () => {
      answers = [
        json(PLACED),
        json({ detail: 'Someone else changed this; reload and try again' }, 409),
      ]
      renderTab()
      const chen = await openLine('$1,500 · Camp aid · Quest · posted to the household · May 20')
      await userEvent.click(within(chen).getByRole('button', { name: 'Confirm' }))
      expect(await screen.findByText(/^✓ Chen: \$1,500 placed/)).toBeInTheDocument()
      const johnson = await openLine(
        '$3,620 · Camp aid · Summer · posted to the household · May 14'
      )
      await userEvent.click(within(johnson).getByRole('button', { name: 'Confirm' }))
      expect(
        (await screen.findAllByText(/Someone else changed this while you looked/)).length
      ).toBeGreaterThan(0)
      expect(screen.queryByText(/^✓ Chen/)).toBeNull()
    })

    it('says so when Leave is refused and its line has left the table', async () => {
      reads = [TO_PLACE, without(CHEN_EXACT.transaction_cm_id)]
      answers = [json({ detail: 'line 3000003 is already on a request' }, 422)]
      renderTab()
      const panel = await openLine('$1,500 · Camp aid · Quest · posted to the household · May 20')
      await userEvent.click(within(panel).getByRole('button', { name: 'Leave at Family Level…' }))
      await userEvent.type(within(panel).getByRole('textbox'), 'Waiting on CampMinder')
      await userEvent.click(within(panel).getByRole('button', { name: 'Leave It' }))
      expect(
        await screen.findByText('Nothing was written: line 3000003 is already on a request')
      ).toBeInTheDocument()
    })

    it('says so when Reopen is refused and its line has left', async () => {
      reads = [TO_PLACE, { ...TO_PLACE, left: [], left_total: 0 }]
      answers = [json({ detail: 'line 3000006 is not left at family level' }, 409)]
      renderTab()
      const left = await screen.findByTestId('left-lines')
      await userEvent.click(within(left).getByRole('button', { name: 'Reopen…' }))
      await userEvent.type(within(left).getByRole('textbox'), 'Fixed in CampMinder')
      await userEvent.click(within(left).getByRole('button', { name: 'Reopen' }))
      expect(
        await screen.findByText('Nothing was written: line 3000006 is not left at family level')
      ).toBeInTheDocument()
    })
  })

  describe('a line in flight stays held (review m1)', () => {
    const CHEN = '$1,500 · Camp aid · Quest · posted to the household · May 20'
    const JOHNSON = '$3,620 · Camp aid · Summer · posted to the household · May 14'

    it('reads Placing…, disables Confirm and Leave, and sends one POST on a double click', async () => {
      let release: (r: Response) => void = () => undefined
      gate = new Promise((resolve) => {
        release = resolve
      })
      renderTab()
      const panel = await openLine(CHEN)
      await userEvent.dblClick(within(panel).getByRole('button', { name: 'Confirm' }))
      expect(await within(panel).findByRole('button', { name: 'Placing…' })).toBeDisabled()
      expect(within(panel).getByRole('button', { name: 'Leave at Family Level…' })).toBeDisabled()
      expect(writes()).toHaveLength(1)
      release(json(PLACED))
      expect(await screen.findByText(/^✓ Chen: \$1,500 placed/)).toBeInTheDocument()
    })

    it('is still held after moving to another line and back', async () => {
      let release: (r: Response) => void = () => undefined
      gate = new Promise((resolve) => {
        release = resolve
      })
      renderTab()
      const first = await openLine(CHEN)
      await userEvent.click(within(first).getByRole('button', { name: 'Confirm' }))
      await userEvent.click(await screen.findByText(JOHNSON))
      const back = await openLine(CHEN)
      expect(within(back).getByRole('button', { name: 'Placing…' })).toBeDisabled()
      expect(within(back).getByRole('button', { name: 'Leave at Family Level…' })).toBeDisabled()
      expect(writes()).toHaveLength(1)
      release(json(PLACED))
      expect(await screen.findByText(/^✓ Chen: \$1,500 placed/)).toBeInTheDocument()
    })
  })

  it('keeps the table when a background refetch fails (owner ruling Group 5)', async () => {
    renderTab()
    const panel = await openLine('$1,500 · Camp aid · Quest · posted to the household · May 20')
    failReads = true
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText(/^✓ Chen: \$1,500 placed/)).toBeInTheDocument()
    expect(screen.getByText('5 lines open · $6,920')).toBeInTheDocument()
  })

  it('offers "Leave With a Note…" on a line that is not a several-requests line', async () => {
    renderTab()
    const panel = await openLine('$300 · Camp aid · Quest · posted to Samuel Johnson · Jun 1')
    expect(within(panel).getByRole('button', { name: 'Leave With a Note…' })).toBeInTheDocument()
  })

  it('colours a Marks Posted line green, and "Marks nothing posted." not at all (review m2)', async () => {
    const none: ApiAidToPlace = {
      ...TO_PLACE,
      groups: TO_PLACE.groups.map((g) => ({
        ...g,
        lines: g.lines.map((l) =>
          l.transaction_cm_id === CHEN_EXACT.transaction_cm_id && l.suggestion
            ? { ...l, suggestion: { ...l.suggestion, would_tick: [], would_lock: 0 } }
            : l
        ),
      })),
    }
    reads = [none]
    renderTab()
    const chen = await openLine('$1,500 · Camp aid · Quest · posted to the household · May 20')
    expect(within(chen).getByText('Marks nothing posted.').className).not.toMatch(/emerald/)
    const johnson = await openLine('$3,620 · Camp aid · Summer · posted to the household · May 14')
    expect(
      within(johnson).getByText('Marks Posted: Emma Johnson · Session 2 · Round 2 · $780 locked')
        .className
    ).toMatch(/emerald/)
  })

  it("heads the suggestion in the dashboard's words, never Kindred's (owner 10-05)", async () => {
    renderTab()
    const panel = await openLine('$1,500 · Camp aid · Quest · posted to the household · May 20')
    expect(screen.getByText('Suggestion and its evidence')).toBeInTheDocument()
    expect(within(panel).getByText('Suggestion')).toBeInTheDocument()
    expect(screen.queryByText(/Kindred/)).toBeNull()
  })

  it('exports the household and the line id, so a row joins back to CampMinder (review m5)', async () => {
    renderTab()
    await screen.findByText('5 lines open · $6,920')
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    const [content] = downloadSpy.mock.calls.at(-1) as [string, string]
    const [header, firstRow] = content.split('\n')
    // Ruling B dropped the "Not placed" column; the CSV keeps the figure.
    expect(header).toMatch(/Household,Line,Still not placed$/)
    expect(firstRow).toMatch(/1000001,3000001,3620$/)
  })

  describe('scan residue (#2990)', () => {
    const CHEN = '$1,500 · Camp aid · Quest · posted to the household · May 20'
    const NOTHING_CHANGED = {
      year: 2027,
      transaction_cm_id: 3000003,
      written: 0,
      operation_id: '',
    }

    it('A: a Leave submitted while its line is saving says so and sends nothing', async () => {
      gate = new Promise(() => undefined)
      renderTab()
      const panel = await openLine(CHEN)
      await userEvent.click(within(panel).getByRole('button', { name: 'Leave at Family Level…' }))
      await userEvent.type(within(panel).getByRole('textbox'), 'Waiting on CampMinder')
      await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
      await userEvent.click(within(panel).getByRole('button', { name: 'Leave It' }))
      expect(
        await screen.findByText(
          'Nothing was written: this line is still saving. Try again when it finishes.'
        )
      ).toBeInTheDocument()
      expect(writes().filter((w) => w.url.endsWith('/leave'))).toHaveLength(0)
    })

    it('F: the last write’s note is gone when the season changes', async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const tree = (year: number) => (
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <ToPlaceTab view={{ year, asOf: { kind: 'live' } }} />
          </MemoryRouter>
        </QueryClientProvider>
      )
      const { rerender } = render(tree(2027))
      const panel = await openLine(CHEN)
      await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
      expect(await screen.findByText(/^✓ Chen: \$1,500 placed/)).toBeInTheDocument()
      rerender(tree(2028))
      expect(screen.queryByText(/^✓ Chen/)).toBeNull()
    })

    it('I: the skipped sentence names the year once', async () => {
      reads = [TO_PLACE_SKIPPED]
      renderTab()
      const card = await screen.findByText(/predates To place/)
      expect(card.textContent).toBe(
        'Nothing to place: 2026 predates To place, which starts in 2027.'
      )
    })

    it('K: Leave says nothing changed when the server wrote nothing', async () => {
      answers = [json(NOTHING_CHANGED)]
      renderTab()
      const panel = await openLine(CHEN)
      await userEvent.click(within(panel).getByRole('button', { name: 'Leave at Family Level…' }))
      await userEvent.type(within(panel).getByRole('textbox'), 'Waiting on CampMinder')
      await userEvent.click(within(panel).getByRole('button', { name: 'Leave It' }))
      expect(
        await screen.findByText(
          '✓ Chen: already left at family level with this note; nothing changed.'
        )
      ).toBeInTheDocument()
    })

    it('K: Reopen says the line is already open when the server wrote nothing', async () => {
      answers = [json({ ...NOTHING_CHANGED, transaction_cm_id: 3000006 })]
      renderTab()
      const left = await screen.findByTestId('left-lines')
      await userEvent.click(within(left).getByRole('button', { name: 'Reopen…' }))
      await userEvent.type(within(left).getByRole('textbox'), 'Fixed in CampMinder')
      await userEvent.click(within(left).getByRole('button', { name: 'Reopen' }))
      expect(
        await screen.findByText('✓ Garcia: already open; nothing changed.')
      ).toBeInTheDocument()
    })
  })
})

describe('the table (owner rulings B and D, 10-06)', () => {
  it('says "still not placed" under a partly placed line, and has no Not placed column', async () => {
    const partly: ApiAidToPlace = {
      ...TO_PLACE,
      groups: TO_PLACE.groups.map((g) => ({
        ...g,
        lines: g.lines.map((l) =>
          l.transaction_cm_id === CHEN_EXACT.transaction_cm_id ? { ...l, unplaced: 1000 } : l
        ),
      })),
    }
    reads = [partly]
    renderTab()
    expect(await screen.findByText('· $1,000 still not placed')).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /Not placed/ })).toBeNull()
  })

  it('puts what each request still lacks in the candidates column, and no id under the family', async () => {
    renderTab()
    expect(
      await screen.findByText(
        'Emma Johnson · Session 2 ($2,200 not yet in CampMinder), Samuel Johnson · Session 2 ($1,420 not yet in CampMinder)'
      )
    ).toBeInTheDocument()
    // The household id is a tie-break only (rulings 10-05): never drawn under every family.
    expect(screen.queryByText('1000003')).toBeNull()
  })
})
