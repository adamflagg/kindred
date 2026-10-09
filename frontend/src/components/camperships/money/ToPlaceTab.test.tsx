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

import type { ApiAidGrants, ApiAidToPlace } from '../../../types/api-types'
import { GARCIA_HOUSEHOLD, GRANTS, grantRow } from '../grants/grantsFixtures'
import { CS_LABEL } from '../kit/csType'
import { ToPlaceTab } from './ToPlaceTab'
import { SOURCES } from './sourcesFixtures'
import {
  CHEN_EXACT,
  RILEY_EXACT,
  SAM_RECLASSIFIED,
  TO_PLACE,
  TO_PLACE_SKIPPED,
  TO_PLACE_WITH_RILEY,
} from './toPlaceFixtures'

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
// The read the server sent last: the preview route answers from it (P-4). A test can set
// `previewAnswer` to answer otherwise.
let lastRead: ApiAidToPlace | null = null
let previewAnswer: ((txn: number) => Response) | null = null
let answers: Response[] = []
// A write held open until the test lets it go (the in-flight traps), and reads that fail.
let gate: Promise<Response> | null = null
let failReads = false
let fetchSpy: MockInstance<typeof fetch>
// The grants read (the fourth group): none need a camper unless a test says so.
const NO_GRANT_LINES: ApiAidGrants = { ...GRANTS, needs_camper: [] }
let grantsRead: ApiAidGrants = NO_GRANT_LINES
let failGrants = false
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const calls = () =>
  fetchSpy.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: init?.method ?? 'GET',
    body: init?.body,
  }))
// What changes state: the placement preview (P-4) writes nothing, so it is not a write.
const writes = () =>
  calls().filter((call) => call.method !== 'GET' && !call.url.endsWith('/preview'))
const previews = () => calls().filter((call) => call.url.endsWith('/preview'))

/** The preview the server would send for a line of `read` (its suggestion's own would_*). */
function echoPreview(read: ApiAidToPlace | null, txn: number): Response {
  const line = read?.groups.flatMap((g) => g.lines).find((l) => l.transaction_cm_id === txn)
  const s = line?.suggestion
  return json({
    year: 2027,
    transaction_cm_id: txn,
    parts: s?.parts ?? [],
    would_tick: s?.would_tick ?? [],
    would_lock: s?.would_lock ?? 0,
    would_leave: s?.would_leave ?? [],
    would_not_tick: s?.would_not_tick ?? [],
  })
}

beforeEach(() => {
  granted = REGISTRAR
  reads = [TO_PLACE]
  lastRead = null
  previewAnswer = null
  answers = []
  gate = null
  failReads = false
  grantsRead = NO_GRANT_LINES
  failGrants = false
  downloadSpy.mockClear()
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
    const path = String(url)
    if ((init?.method ?? 'GET') === 'GET') {
      // The tab's definition notes (ruling I): one note, so the foot shows it.
      if (path.includes('/definitions')) {
        return Promise.resolve(
          json({
            surface: 'money-to-place',
            notes: [{ key: 'posted', n: 1, text: 'Posted: the round’s Posted checkbox…' }],
          })
        )
      }
      // The grants read behind the outside-grant group (M5).
      if (path.includes('/api/financial-aid/grants/')) {
        return Promise.resolve(
          failGrants ? json({ detail: 'Server error' }, 500) : json(grantsRead)
        )
      }
      // The approved rules (program words): none yet.
      if (path.includes('/rules/'))
        return Promise.resolve(json({ detail: 'no approved rules' }, 404))
      // Reclassify's targets (part 1b): the sources registry.
      if (path.includes('/sources')) return Promise.resolve(json(SOURCES))
      if (failReads) return Promise.resolve(json({ detail: 'Server error' }, 500))
      // Each read takes the next answer; the last one repeats.
      const next = reads.length > 1 ? reads.shift() : reads[0]
      lastRead = next ?? TO_PLACE
      return Promise.resolve(json(lastRead))
    }
    if (path.endsWith('/preview')) {
      const txn = Number(path.split('/').at(-2))
      return Promise.resolve(previewAnswer ? previewAnswer(txn) : echoPreview(lastRead, txn))
    }
    if (gate) return gate
    return Promise.resolve(answers.shift() ?? json(PLACED))
  })
})
afterEach(() => fetchSpy.mockRestore())

function renderTab(householdCmId: number | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToPlaceTab view={VIEW} householdCmId={householdCmId} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const openLine = async (words: string) => {
  await userEvent.click(await screen.findByText(words))
  return screen.findByTestId('to-place-row')
}

describe('Money › To place (§8.1)', () => {
  it("shows the server's open count and total, and the lines grouped by its reasons", async () => {
    renderTab()
    expect(await screen.findByText('5 lines open · $6,920 camp aid')).toBeInTheDocument()
    expect(screen.getByText('Several requests could take this')).toBeInTheDocument()
    expect(
      screen.getByText('3 households · 3 lines · Camp aid: Confirm marks the round Posted.')
    ).toBeInTheDocument()
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

  it('heads "Left at family level" with the kit section label, not a display-serif heading', async () => {
    renderTab()
    const left = await screen.findByTestId('left-lines')
    const heading = within(left).getByText('Left at family level')
    expect(heading.tagName).not.toBe('H3')
    expect(heading.className).toBe(CS_LABEL)
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
      await userEvent.click(within(johnson).getByRole('button', { name: 'Confirm Split' }))
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
    expect(screen.getByText('5 lines open · $6,920 camp aid')).toBeInTheDocument()
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
    await screen.findByText('5 lines open · $6,920 camp aid')
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    const [content] = downloadSpy.mock.calls.at(-1) as [string, string]
    const [header, firstRow] = content.split('\n')
    // Ruling B dropped the "Not placed" column; the CSV keeps the figure.
    expect(header).toMatch(/Household CM id,Line,Still not placed,Group$/)
    expect(firstRow).toMatch(/1000001,3000001,3620,Camp aid: /)
  })

  describe('scan residue (#2990)', () => {
    const CHEN = '$1,500 · Camp aid · Quest · posted to the household · May 20'
    const NOTHING_CHANGED = {
      year: 2027,
      transaction_cm_id: 3000003,
      written: 0,
      operation_id: '',
    }

    // Lead-ruled edit (R1-12: Confirm hides while an editor is open, so the old sequence,
    // Confirm pressed inside an open Leave form, can no longer be reached). Same intent:
    // while the line is saving, Leave can't be started and nothing is sent.
    it('A: Leave can’t be started while its line is saving, and sends nothing', async () => {
      gate = new Promise(() => undefined)
      renderTab()
      const panel = await openLine(CHEN)
      await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
      const leave = within(panel).getByRole('button', { name: 'Leave at Family Level…' })
      expect(leave).toBeDisabled()
      await userEvent.click(leave)
      expect(within(panel).queryByRole('button', { name: 'Leave It' })).toBeNull()
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

describe('a line opens in three panels, the grid’s opened row (owner ruling A, 10-06)', () => {
  it('puts the line and its evidence left, the requests in the middle, Confirm right', async () => {
    renderTab()
    const row = await openLine('$3,620 · Camp aid · Summer · posted to the household · May 14')
    const panel = (name: string) => {
      const found = row.querySelector(`[data-panel="${name}"]`)
      if (!(found instanceof HTMLElement)) throw new Error(`no ${name} panel`)
      return within(found)
    }
    expect(
      panel('line').getByText('$3,620 · Camp aid · Summer · posted to the household · May 14')
    ).toBeInTheDocument()
    expect(panel('line').getByText(/The line equals the two requests/)).toBeInTheDocument()
    expect(panel('candidates').getByText('$2,200 not yet in CampMinder')).toBeInTheDocument()
    expect(panel('confirm').getByText('What Confirm does')).toBeInTheDocument()
    expect(panel('confirm').getByRole('button', { name: 'Confirm Split' })).toBeInTheDocument()
    // The opened row is AidTable's detail line, not the old editor row (#2990's).
    expect(row.closest('[data-aid-detail]')).not.toBeNull()
  })

  it('Esc closes the opened line', async () => {
    renderTab()
    await openLine('$3,620 · Camp aid · Summer · posted to the household · May 14')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('to-place-row')).toBeNull()
  })
})

describe('Confirm reads a fresh preview when its line opens (P-4; review item 19)', () => {
  const CHEN = '$1,500 · Camp aid · Quest · posted to the household · May 20'

  it('asks the preview for the suggestion’s parts, shows its answer, and sends its lock', async () => {
    previewAnswer = (txn) =>
      json({
        year: 2027,
        transaction_cm_id: txn,
        parts: [{ request_id: 'reqolivia000003', amount: 1500 }],
        would_tick: [{ request_id: 'reqolivia000003', round: 2, amount: 1400 }],
        would_lock: 1400,
        would_leave: [],
        would_not_tick: [],
      })
    renderTab()
    const row = await openLine(CHEN)
    expect(
      await within(row).findByText('Marks Posted: Olivia Chen · Quest · Round 2 · $1,400 locked')
    ).toBeInTheDocument()
    expect(previews()).toEqual([
      {
        url: '/api/financial-aid/money/2027/to-place/3000003/preview',
        method: 'POST',
        body: JSON.stringify({
          parts: [{ request_id: 'reqolivia000003', amount: '1500.00' }],
          note: '',
        }),
      },
    ])
    await userEvent.click(within(row).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(JSON.parse(String(writes()[0]?.body))).toMatchObject({ expected_locked: '1400.00' })
  })

  it('a refused preview says why and offers no Confirm; Leave stays; Try Again asks again', async () => {
    previewAnswer = () =>
      json({ detail: 'line 3000003: line 3000003 is already on a request' }, 422)
    renderTab()
    const row = await openLine(CHEN)
    expect(
      await within(row).findByText(
        "Confirm can't place this as suggested now: line 3000003: line 3000003 is already on a request"
      )
    ).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(within(row).getByRole('button', { name: 'Leave at Family Level…' })).toBeEnabled()
    // R1-14: a passing race clears on a second ask; Confirm comes back with the new answer.
    previewAnswer = null
    await userEvent.click(within(row).getByRole('button', { name: 'Try Again' }))
    expect(await within(row).findByRole('button', { name: 'Confirm' })).toBeEnabled()
    expect(previews()).toHaveLength(2)
  })

  it('hides Confirm while the Leave form is open, so only the form’s own button sends (R1-12)', async () => {
    renderTab()
    const row = await openLine(CHEN)
    expect(within(row).getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Leave at Family Level…' }))
    expect(within(row).queryByRole('button', { name: 'Confirm' })).toBeNull()
    await userEvent.click(within(row).getByRole('button', { name: 'Back' }))
    expect(within(row).getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
  })

  it('asks only for a line that stays open: a line passed over asks nothing (R1-2)', async () => {
    renderTab()
    await openLine('$600 · Camp aid · Summer · posted to Liam Garcia · Apr 3')
    // Straight on to the next line, before the first has settled.
    const row = await openLine(CHEN)
    await within(row).findByText('Marks Posted: Olivia Chen · Quest · Round 2 · $1,500 locked')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(previews().map((p) => p.url)).toEqual([
      '/api/financial-aid/money/2027/to-place/3000003/preview',
    ])
  })

  it('a preview that fails (a 500) leaves the read’s preview and Confirm in place', async () => {
    previewAnswer = () => json({ detail: 'Server error' }, 500)
    renderTab()
    const row = await openLine(CHEN)
    await waitFor(() => expect(previews()).toHaveLength(1))
    expect(
      within(row).getByText('Marks Posted: Olivia Chen · Quest · Round 2 · $1,500 locked')
    ).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Confirm' })).toBeEnabled()
  })

  it('view-only staff see the read’s preview and no preview call (the route is casework)', async () => {
    granted = ['financial_aid.view']
    renderTab()
    const row = await openLine(CHEN)
    expect(
      within(row).getByText('Marks Posted: Olivia Chen · Quest · Round 2 · $1,500 locked')
    ).toBeInTheDocument()
    // Past the settle time, so a call would have been made by now.
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(previews()).toHaveLength(0)
  })
})

describe('the notes at the foot (ruling I: the owner reads them in place)', () => {
  it("reads the server's money-to-place notes", async () => {
    renderTab()
    expect(await screen.findByText(/Posted: the round’s Posted checkbox/)).toBeInTheDocument()
    expect(calls().some((c) => c.url.includes('/definitions?surface=money-to-place'))).toBe(true)
  })
})

describe('the family as the household card names it (owner ruling D, 10-06; #3080)', () => {
  // Two Johnson lines, labelled by the server; a collision on the label brings its muted tie-break.
  const labelled: ApiAidToPlace = {
    ...TO_PLACE,
    groups: TO_PLACE.groups.map((g) => ({
      ...g,
      lines: g.lines.map((l) =>
        l.household_cm_id === 1000001
          ? { ...l, household_label: 'Pat & Sam Johnson', household_label_tiebreak: '#1000001' }
          : l.transaction_cm_id === CHEN_EXACT.transaction_cm_id
            ? { ...l, household_label: 'Mei & David Chen', household_label_tiebreak: '' }
            : l
      ),
    })),
  }

  it('shows the label, the tie-break muted, and no household id otherwise', async () => {
    reads = [labelled]
    renderTab()
    expect((await screen.findAllByText('Pat & Sam Johnson')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('#1000001')[0]?.className).toMatch(/muted/)
    expect(screen.getByText('Mei & David Chen')).toBeInTheDocument()
    // A line with no label keeps its family name, and no id is drawn under any name.
    expect(screen.getAllByText('Garcia').length).toBeGreaterThan(0)
    expect(screen.queryByText('1000002')).toBeNull()
  })

  it('draws the family as a link to its household page, as money-v2.html does (R1-8c)', async () => {
    reads = [labelled]
    renderTab()
    const [link] = await screen.findAllByRole('link', { name: 'Mei & David Chen' })
    expect(link?.getAttribute('href')).toMatch(/^\/aid\/households\/1000003\b/)
  })

  it('names the family by its label in the result line', async () => {
    reads = [labelled]
    renderTab()
    const row = await openLine('$1,500 · Camp aid · Quest · posted to the household · May 20')
    await userEvent.click(within(row).getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText(/^✓ Mei & David Chen: \$1,500 placed/)).toBeInTheDocument()
  })
})

describe('Split… and Place on Another Request… preview what they place (§8.1; D12; P-4, review item 19)', () => {
  const JOHNSON = '$3,620 · Camp aid · Summer · posted to the household · May 14'
  const GARCIA = '$600 · Camp aid · Summer · posted to Liam Garcia · Apr 3'
  const CHEN = '$1,500 · Camp aid · Quest · posted to the household · May 20'
  const SAM = '$900 · Camp aid · Summer · posted to Riley Sam · Apr 18'
  /** A preview that marks nothing posted and locks nothing, whatever the parts. */
  const marksNothing = (txn: number) =>
    json({
      year: 2027,
      transaction_cm_id: txn,
      parts: [],
      would_tick: [],
      would_lock: 0,
      would_leave: [],
      would_not_tick: [],
    })
  /** The parts a preview call asked for. */
  const parts = (call: { body: BodyInit | null | undefined } | undefined) =>
    (JSON.parse(String(call?.body)) as { parts: unknown[] }).parts

  it('names the buttons as the mock does: Confirm Split and Edit the Split… on a split suggestion (review item 6)', async () => {
    renderTab()
    const johnson = await openLine(JOHNSON)
    expect(within(johnson).getByRole('button', { name: 'Confirm Split' })).toBeInTheDocument()
    expect(within(johnson).getByRole('button', { name: 'Edit the Split…' })).toBeInTheDocument()
    // Both candidates are in the suggestion: no other request to place it on.
    expect(within(johnson).queryByRole('button', { name: 'Place on Another Request…' })).toBeNull()
    const garcia = await openLine(GARCIA)
    expect(within(garcia).getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(within(garcia).getByRole('button', { name: 'Split…' })).toBeInTheDocument()
    expect(
      within(garcia).getByRole('button', { name: 'Place on Another Request…' })
    ).toBeInTheDocument()
    const chen = await openLine(CHEN)
    expect(within(chen).queryByRole('button', { name: 'Split…' })).toBeNull()
    expect(within(chen).queryByRole('button', { name: 'Place on Another Request…' })).toBeNull()
    const sam = await openLine(SAM)
    expect(within(sam).queryByRole('button', { name: /Split|Another/ })).toBeNull()
    // The program-mismatch line offers it, as money-v2.html draws it (R1-8a).
    const samuel = await openLine('$300 · Camp aid · Quest · posted to Samuel Johnson · Jun 1')
    expect(
      within(samuel).getByRole('button', { name: 'Place on Another Request…' })
    ).toBeInTheDocument()
  })

  it('opens on the suggestion, asks the preview for exactly the parts typed, and places what it showed', async () => {
    renderTab()
    const row = await openLine(JOHNSON)
    await userEvent.click(within(row).getByRole('button', { name: 'Edit the Split…' }))
    const editor = within(row).getByTestId('place-editor')
    expect(within(editor).getByText('Parts add to $3,620 of $3,620 ✓')).toBeInTheDocument()
    expect(
      await within(editor).findByText(
        'Marks Posted: Emma Johnson · Session 2 · Round 2 · $780 locked'
      )
    ).toBeInTheDocument()
    previewAnswer = marksNothing
    const emma = within(editor).getByRole('textbox', { name: 'Part for Emma Johnson · Session 2' })
    const samuel = within(editor).getByRole('textbox', {
      name: 'Part for Samuel Johnson · Session 2',
    })
    await userEvent.clear(emma)
    await userEvent.type(emma, '2000')
    expect(
      within(editor).getByText('Parts add to $3,420 of $3,620 · must equal the line')
    ).toBeInTheDocument()
    expect(within(editor).getByRole('button', { name: 'Place the Split' })).toBeDisabled()
    await userEvent.clear(samuel)
    await userEvent.type(samuel, '1620')
    expect(await within(editor).findByText('Marks nothing posted.')).toBeInTheDocument()
    // Only sums that equal the line were asked, and the last ask is the parts on screen.
    expect(parts(previews().at(-1))).toEqual([
      { request_id: 'reqemma00000001', amount: '2000.00' },
      { request_id: 'reqsamuel000002', amount: '1620.00' },
    ])
    answers = [json({ ...PLACED, placed: [3000001], ticked: [] })]
    await userEvent.click(within(editor).getByRole('button', { name: 'Place the Split' }))
    expect(
      await screen.findByText('✓ Johnson: $3,620 placed. Nothing marked posted.')
    ).toBeInTheDocument()
    expect(writes()).toEqual([
      {
        url: '/api/financial-aid/money/2027/to-place/3000001/place',
        method: 'POST',
        body: JSON.stringify({
          parts: [
            { request_id: 'reqemma00000001', amount: '2000.00' },
            { request_id: 'reqsamuel000002', amount: '1620.00' },
          ],
          note: '',
          expected_locked: '0.00',
        }),
      },
    ])
  })

  it('keeps Place the Split off until the preview has answered for the parts now typed', async () => {
    renderTab()
    const row = await openLine(JOHNSON)
    await userEvent.click(within(row).getByRole('button', { name: 'Edit the Split…' }))
    const editor = within(row).getByTestId('place-editor')
    const button = within(editor).getByRole('button', { name: 'Place the Split' })
    await waitFor(() => expect(button).toBeEnabled())
    const emma = within(editor).getByRole('textbox', { name: 'Part for Emma Johnson · Session 2' })
    const samuel = within(editor).getByRole('textbox', {
      name: 'Part for Samuel Johnson · Session 2',
    })
    await userEvent.clear(samuel)
    await userEvent.type(samuel, '1320')
    await userEvent.clear(emma)
    await userEvent.type(emma, '2300')
    // The sum is right again, but the preview speaks for $2,200 / $1,420, not these parts.
    expect(within(editor).getByText('Parts add to $3,620 of $3,620 ✓')).toBeInTheDocument()
    expect(button).toBeDisabled()
    await waitFor(() => expect(button).toBeEnabled())
    expect(parts(previews().at(-1))).toEqual([
      { request_id: 'reqemma00000001', amount: '2300.00' },
      { request_id: 'reqsamuel000002', amount: '1320.00' },
    ])
  })

  it('a refused preview says why in the editor and offers no place', async () => {
    renderTab()
    const row = await openLine(JOHNSON)
    previewAnswer = () => json({ detail: 'request reqsamuel000002 is cancelled' }, 422)
    await userEvent.click(within(row).getByRole('button', { name: 'Edit the Split…' }))
    const editor = within(row).getByTestId('place-editor')
    expect(
      await within(editor).findByText(
        "This can't be placed as typed: request reqsamuel000002 is cancelled"
      )
    ).toBeInTheDocument()
    expect(within(editor).getByRole('button', { name: 'Place the Split' })).toBeDisabled()
  })

  it('a preview that fails can be asked again', async () => {
    renderTab()
    const row = await openLine(JOHNSON)
    previewAnswer = () => json({ detail: 'Server error' }, 500)
    await userEvent.click(within(row).getByRole('button', { name: 'Edit the Split…' }))
    const editor = within(row).getByTestId('place-editor')
    expect(
      await within(editor).findByText(/^Couldn't work out what placing this does/)
    ).toBeInTheDocument()
    expect(within(editor).getByRole('button', { name: 'Place the Split' })).toBeDisabled()
    previewAnswer = null
    await userEvent.click(within(editor).getByRole('button', { name: 'Try Again' }))
    await waitFor(() =>
      expect(within(editor).getByRole('button', { name: 'Place the Split' })).toBeEnabled()
    )
  })

  it('after "this now locks…", shows the new answer and places at its lock', async () => {
    let lock = 0
    previewAnswer = (txn) =>
      json({
        year: 2027,
        transaction_cm_id: txn,
        parts: [],
        would_tick: lock > 0 ? [{ request_id: 'reqemma00000001', round: 2, amount: lock }] : [],
        would_lock: lock,
        would_leave: [],
        would_not_tick: [],
      })
    answers = [
      json({ detail: 'this now locks $780, not the $0 you confirmed: reload To place' }, 422),
      json({ ...PLACED, placed: [3000001], ticked: [] }),
    ]
    renderTab()
    const row = await openLine(JOHNSON)
    await userEvent.click(within(row).getByRole('button', { name: 'Edit the Split…' }))
    const editor = within(row).getByTestId('place-editor')
    expect(await within(editor).findByText('Marks nothing posted.')).toBeInTheDocument()
    // The season moves between the preview and the click.
    lock = 780
    await userEvent.click(within(editor).getByRole('button', { name: 'Place the Split' }))
    expect(
      await within(editor).findByText(/What this would lock changed since the page loaded/)
    ).toBeInTheDocument()
    expect(
      await within(editor).findByText(
        'Marks Posted: Emma Johnson · Session 2 · Round 2 · $780 locked'
      )
    ).toBeInTheDocument()
    await userEvent.click(within(editor).getByRole('button', { name: 'Place the Split' }))
    await waitFor(() => expect(writes()).toHaveLength(2))
    expect(JSON.parse(String(writes()[1]?.body))).toMatchObject({ expected_locked: '780.00' })
  })

  it('Place on Another Request… puts the whole line on the request picked, at the lock its preview showed', async () => {
    previewAnswer = (txn) =>
      json({
        year: 2027,
        transaction_cm_id: txn,
        parts: [{ request_id: 'reqliamquest005', amount: 600 }],
        would_tick: [{ request_id: 'reqliamquest005', round: 1, amount: 600 }],
        would_lock: 600,
        would_leave: [],
        would_not_tick: [],
      })
    renderTab()
    const row = await openLine(GARCIA)
    await userEvent.click(within(row).getByRole('button', { name: 'Place on Another Request…' }))
    const editor = within(row).getByTestId('place-editor')
    expect(within(editor).getByRole('button', { name: 'Place It' })).toBeDisabled()
    await userEvent.click(within(editor).getByRole('radio', { name: 'Liam Garcia · Quest' }))
    expect(
      await within(editor).findByText('Marks Posted: Liam Garcia · Quest · Round 1 · $600 locked')
    ).toBeInTheDocument()
    expect(parts(previews().at(-1))).toEqual([{ request_id: 'reqliamquest005', amount: '600.00' }])
    await userEvent.click(within(editor).getByRole('button', { name: 'Place It' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(JSON.parse(String(writes()[0]?.body))).toEqual({
      parts: [{ request_id: 'reqliamquest005', amount: '600.00' }],
      note: '',
      expected_locked: '600.00',
    })
  })

  it('Back closes the editor and brings the buttons back', async () => {
    renderTab()
    const row = await openLine(GARCIA)
    expect(within(row).getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Split…' }))
    expect(within(row).getByTestId('place-editor')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Leave at Family Level…' })).toBeNull()
    // R1-12: with the editor open, only its own button places; Confirm would send the suggestion.
    expect(within(row).queryByRole('button', { name: 'Confirm' })).toBeNull()
    await userEvent.click(within(row).getByRole('button', { name: 'Back' }))
    expect(within(row).queryByTestId('place-editor')).toBeNull()
    expect(within(row).getByRole('button', { name: 'Leave at Family Level…' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
  })
})

describe('Reclassify… (finance, D104; P-7) and the lines waiting apart', () => {
  const SAM = '$900 · Camp aid · Summer · posted to Riley Sam · Apr 18'
  const SAMUEL = '$300 · Camp aid · Quest · posted to Samuel Johnson · Jun 1'
  const FINANCE = [...REGISTRAR, 'financial_aid.rules']

  it('shows the registrar Reclassify… (finance), off: it is `rules` (money-v2.html; R1-8b)', async () => {
    renderTab()
    const row = await openLine(SAM)
    expect(within(row).queryByRole('button', { name: 'Reclassify…' })).toBeNull()
    expect(within(row).getByRole('button', { name: 'Reclassify… (finance)' })).toBeDisabled()
  })

  it('shows view-only staff no Reclassify at all', async () => {
    granted = ['financial_aid.view']
    renderTab()
    const row = await openLine(SAM)
    expect(within(row).queryByRole('button', { name: /Reclassify/ })).toBeNull()
  })

  it('offers finance Reclassify on a no-request or program-mismatch line, never a several-requests one', async () => {
    granted = FINANCE
    renderTab()
    expect(
      within(await openLine(SAM)).getByRole('button', { name: 'Reclassify…' })
    ).toBeInTheDocument()
    expect(
      within(await openLine(SAMUEL)).getByRole('button', { name: 'Reclassify…' })
    ).toBeInTheDocument()
    const johnson = await openLine('$3,620 · Camp aid · Summer · posted to the household · May 14')
    expect(within(johnson).queryByRole('button', { name: 'Reclassify…' })).toBeNull()
  })

  it('sends the target and the reason, and says the next ledger sync applies it', async () => {
    granted = FINANCE
    answers = [json({ ...WROTE, transaction_cm_id: 3000004 })]
    renderTab()
    const row = await openLine(SAM)
    await userEvent.click(within(row).getByRole('button', { name: 'Reclassify…' }))
    const editor = within(row).getByTestId('reclassify-editor')
    await within(editor).findByRole('option', { name: 'Grantor C full-ride program (outside)' })
    // The line's own description and the unclassified one are not offered.
    expect(within(editor).queryByRole('option', { name: /^Camp aid · Summer/ })).toBeNull()
    expect(within(editor).queryByRole('option', { name: /Returning-family bonus/ })).toBeNull()
    expect(within(editor).getByRole('button', { name: 'Reclassify' })).toBeDisabled()
    await userEvent.selectOptions(
      within(editor).getByRole('combobox'),
      'Grantor C full-ride program (outside)'
    )
    await userEvent.type(within(editor).getByRole('textbox'), 'An outside full-ride line')
    await userEvent.click(within(editor).getByRole('button', { name: 'Reclassify' }))
    expect(
      await screen.findByText(
        '✓ Sam: reclassified as Grantor C full-ride program. The next ledger sync applies it; until then the line is listed apart.'
      )
    ).toBeInTheDocument()
    expect(writes()).toEqual([
      {
        url: '/api/financial-aid/money/2027/to-place/3000004/reclassify',
        method: 'POST',
        body: JSON.stringify({
          source_key: 'keygrantorc0004',
          reason: 'An outside full-ride line',
        }),
      },
    ])
    expect(calls().some((c) => c.url === '/api/financial-aid/sources?year=2027')).toBe(true)
  })

  it('shows a refusal in staff words, at the editor and the tab', async () => {
    granted = FINANCE
    answers = [json({ detail: "source 'keygrantorc0004' is not classified as aid" }, 422)]
    renderTab()
    const row = await openLine(SAM)
    await userEvent.click(within(row).getByRole('button', { name: 'Reclassify…' }))
    const editor = within(row).getByTestId('reclassify-editor')
    await within(editor).findByRole('option', { name: 'Grantor C full-ride program (outside)' })
    await userEvent.selectOptions(
      within(editor).getByRole('combobox'),
      'Grantor C full-ride program (outside)'
    )
    await userEvent.type(within(editor).getByRole('textbox'), 'An outside full-ride line')
    await userEvent.click(within(editor).getByRole('button', { name: 'Reclassify' }))
    expect(
      await within(editor).findByText(
        "Nothing was written: source 'keygrantorc0004' is not classified as aid"
      )
    ).toBeInTheDocument()
    expect(
      screen.getAllByText("Nothing was written: source 'keygrantorc0004' is not classified as aid")
    ).toHaveLength(2)
  })

  it('lists reclassified lines apart, with where they go and the server’s total', async () => {
    reads = [{ ...TO_PLACE, reclassified: [SAM_RECLASSIFIED], reclassified_total: 450 }]
    renderTab()
    const apart = await screen.findByTestId('reclassified-lines')
    expect(
      within(apart).getByText(/^Reclassified, waiting for the next ledger sync/)
    ).toBeInTheDocument()
    expect(
      within(apart).getByText(
        "1 · $450 · not counted as open; can't be placed or left until the sync applies it"
      )
    ).toBeInTheDocument()
    expect(within(apart).getByText('→ Grantor C full-ride program')).toBeInTheDocument()
    expect(screen.queryByText(/tonight/)).toBeNull()
  })
})

describe('one family’s To place (D26; P-8)', () => {
  it("reads one family's scope, and links back to every family", async () => {
    renderTab(1000001)
    expect(await screen.findByRole('link', { name: 'All Families ›' })).toHaveAttribute(
      'href',
      '/aid/money/to-place?year=2027'
    )
    const reads = calls().filter((c) => c.method === 'GET' && c.url.includes('/to-place'))
    expect(reads[0]?.url).toBe('/api/financial-aid/money/2027/to-place?household_cm_id=1000001')
    // R1-10: open a line in the family's scope, so the check isn't vacuous: no "Only This Family ›".
    const row = await openLine('$3,620 · Camp aid · Summer · posted to the household · May 14')
    expect(within(row).getByRole('link', { name: 'Open the Household ›' })).toBeInTheDocument()
    expect(within(row).queryByRole('link', { name: 'Only This Family ›' })).toBeNull()
  })

  it('opens a line with "Only This Family ›" to its household’s scope', async () => {
    renderTab()
    const row = await openLine('$3,620 · Camp aid · Summer · posted to the household · May 14')
    expect(within(row).getByRole('link', { name: 'Only This Family ›' })).toHaveAttribute(
      'href',
      '/aid/money/to-place?household=1000001&year=2027'
    )
    expect(screen.queryByRole('link', { name: 'All Families ›' })).toBeNull()
  })
})

describe('the bulk confirm of exact single matches (§4.10; P-6; review §3 A)', () => {
  const rowOf = (words: string) => {
    const row = screen.getByText(words).closest('tr')
    if (row === null) throw new Error(`no row for ${words}`)
    return row
  }
  const CHEN = '$1,500 · Camp aid · Quest · posted to the household · May 20'
  const JOHNSON = '$3,620 · Camp aid · Summer · posted to the household · May 14'

  it('one button checks every exact single match and opens the dialog; a program mismatch is never one', async () => {
    reads = [TO_PLACE_WITH_RILEY]
    renderTab()
    // Chen's and Riley's lines; Samuel's program mismatch has one candidate and an exact amount,
    // but is a judgement call (plan review I3).
    await userEvent.click(
      await screen.findByRole('button', { name: 'Confirm the 2 Exact Single Matches…' })
    )
    const dialog = await screen.findByRole('dialog')
    // Final audit E4: the title counts, in the grant dialog's own words (the mock's "Confirm 2 exact single matches").
    expect(within(dialog).getByText('Confirm 2 exact single matches')).toBeInTheDocument()
    expect(within(dialog).getByText(/^2 lines · 2 households · \$1,800 locked/)).toBeInTheDocument()
    expect(within(dialog).getByText('Estimate')).toBeInTheDocument()
    answers = [json({ ...PLACED, placed: [3000003, RILEY_EXACT.transaction_cm_id] })]
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm 2' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(writes()[0]?.url).toBe('/api/financial-aid/money/2027/to-place/place')
    const body = JSON.parse(String(writes()[0]?.body)) as Record<string, unknown>
    expect(body['lines']).toEqual([
      { transaction_cm_id: 3000003, parts: [{ request_id: 'reqolivia000003', amount: '1500.00' }] },
      { transaction_cm_id: 3000008, parts: [{ request_id: 'reqriley0000006', amount: '300.00' }] },
    ])
    expect(body).not.toHaveProperty('expected_locked')
    expect(
      await screen.findByText(
        '✓ 2 lines placed. Marked Posted: Olivia Chen · Quest Round 2 · $1,500 locked.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps checks through a search, marks the hidden ones, and leaves out a split by name', async () => {
    reads = [TO_PLACE_WITH_RILEY]
    renderTab()
    await screen.findByText(CHEN)
    await userEvent.click(within(rowOf(CHEN)).getByRole('checkbox', { name: 'Select' }))
    await userEvent.click(within(rowOf(JOHNSON)).getByRole('checkbox', { name: 'Select' }))
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'Olivia')
    expect(await screen.findByText('2 selected · 1 hidden by the search')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm the Selected…' }))
    const dialog = await screen.findByRole('dialog')
    // One line: its own preview is exact, so no estimate pill (plan review m6).
    expect(within(dialog).getByText(/^1 line · 1 household · \$1,500 locked/)).toBeInTheDocument()
    expect(within(dialog).queryByText('Estimate')).toBeNull()
    expect(
      within(dialog).getByText('Left out, confirm one at a time: Johnson (a split).')
    ).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back' }))
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'Johnson')
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm the Selected…' }))
    expect(
      within(await screen.findByRole('dialog')).getByText(/\(hidden by the search\)/)
    ).toBeInTheDocument()
  })

  it('after a refusal, Confirm sends what is still open and names what dropped out (plan review I4)', async () => {
    // Someone else placed Riley's line meanwhile: the bulk is refused all or nothing, the reads
    // refresh before the error shows, and the dialog's plan is the current read's, not the click's.
    reads = [TO_PLACE_WITH_RILEY, TO_PLACE]
    answers = [json({ detail: 'line 3000008: line 3000008 is already on a request' }, 422)]
    renderTab()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Confirm the 2 Exact Single Matches…' })
    )
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm 2' }))
    expect(
      await within(dialog).findByText(
        'Nothing was written: line 3000008: line 3000008 is already on a request'
      )
    ).toBeInTheDocument()
    expect(
      await within(dialog).findByText('1 line is no longer open and was left out.')
    ).toBeInTheDocument()
    expect(within(dialog).queryByText('estimate')).toBeNull()
    answers = [json(PLACED)]
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm 1' }))
    await waitFor(() => expect(writes()).toHaveLength(2))
    const second = JSON.parse(String(writes()[1]?.body)) as {
      lines: Array<{ transaction_cm_id: number }>
      expected_locked?: string
    }
    expect(second.lines.map((l) => l.transaction_cm_id)).toEqual([3000003])
    expect(second.expected_locked).toBe('1500.00')
  })

  it('offers view-only staff no checks and no bulk', async () => {
    granted = ['financial_aid.view']
    reads = [TO_PLACE_WITH_RILEY]
    renderTab()
    await screen.findByText(CHEN)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Exact Single/ })).toBeNull()
  })
})

describe('Money › To place › the outside-grant group (M5)', () => {
  const CHEN_GRANT = grantRow({
    transaction_cm_id: 4000008,
    household_cm_id: 1000003,
    family_name: 'Chen',
    person_cm_id: 0,
    camper_name: '',
    camper_basis: 'none',
    amount: 800.5,
    counts: false,
    requests: [],
  })
  const WITH_LINES: ApiAidGrants = {
    ...GRANTS,
    needs_camper: [
      ...GRANTS.needs_camper,
      {
        grant: CHEN_GRANT,
        household_applied: true,
        suggestion: null,
        candidates: [{ person_cm_id: 2000003, name: 'Olivia Chen' }],
      },
    ],
  }
  const GARCIA_LINE = '$1,500 · Grantor B · posted to the household · Apr 3'

  it('adds the lines as a fourth group below the camp-aid table, and counts them in the open line', async () => {
    grantsRead = WITH_LINES
    renderTab()
    expect(
      await screen.findByText('7 lines open · $6,920 camp aid · $2,300.50 outside grants')
    ).toBeInTheDocument()
    const heading = await screen.findByText('Outside grant posted to the family')
    expect(screen.getByText('2 lines')).toBeInTheDocument()
    const camp = screen.getByText('No request behind it')
    expect(camp.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText(GARCIA_LINE)).toBeInTheDocument()
  })

  it('the one Download CSV carries the grant lines too, each marked with its group (final audit O8)', async () => {
    grantsRead = WITH_LINES
    renderTab()
    await screen.findByText('Outside grant posted to the family')
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    const [content] = downloadSpy.mock.calls.at(-1) as [string, string]
    const lines = content.split('\n')
    const header = lines[0] ?? ''
    expect(header).toMatch(/,Household CM id,Line,Still not placed,Group$/)
    // 5 camp-aid lines and 2 grant lines: every line the tab counts is in the file.
    const body = lines.filter((l) => /,(Camp aid|Outside grant)[^,]*$/.test(l))
    expect(body).toHaveLength(7)
    const grantRows = body.filter((l) => l.endsWith(',Outside grant posted to the family'))
    expect(grantRows).toHaveLength(2)
    expect(grantRows.some((l) => l.includes(',1000003,4000008,800.50,'))).toBe(true)
    expect(body.filter((l) => l.startsWith('Pat Garcia,')).length).toBe(1)
    expect(body.filter((l) => /,Camp aid: [^,]*$/.test(l))).toHaveLength(5)
  })

  it('a group-less read (no grant lines) still downloads only the camp-aid lines', async () => {
    renderTab()
    await screen.findByText('5 lines open · $6,920 camp aid')
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    const [content] = downloadSpy.mock.calls.at(-1) as [string, string]
    expect(content).not.toContain('Outside grant posted to the family')
  })

  it('reads the grants with the signed-in token', async () => {
    grantsRead = WITH_LINES
    renderTab()
    await screen.findByText('Outside grant posted to the family')
    const sent = fetchSpy.mock.calls.find(([url]) =>
      String(url).startsWith('/api/financial-aid/grants/2027')
    )
    expect(new Headers(sent?.[1]?.headers).get('Authorization')).toBe('Bearer test-jwt')
  })

  it('draws no group and no grant part when no line needs a camper, and no purpose line', async () => {
    renderTab()
    await screen.findByText('5 lines open · $6,920 camp aid')
    expect(screen.queryByText('Outside grant posted to the family')).toBeNull()
    expect(screen.queryByText(/outside grants/)).toBeNull()
    expect(screen.queryByText(/Click a line to see/)).toBeNull()
  })

  it('keeps the camp-aid table when the grants read fails', async () => {
    failGrants = true
    renderTab()
    expect(await screen.findByText('5 lines open · $6,920 camp aid')).toBeInTheDocument()
    expect(screen.getByText('No request behind it')).toBeInTheDocument()
    expect(screen.queryByText('Outside grant posted to the family')).toBeNull()
  })

  it("narrows to one household's grant lines under ?household=", async () => {
    grantsRead = WITH_LINES
    reads = [{ ...TO_PLACE, household_cm_id: 1000003 }]
    renderTab(1000003)
    expect(
      await screen.findByText('6 lines open · $6,920 camp aid · $800.50 outside grants')
    ).toBeInTheDocument()
    expect(screen.getByText('1 line')).toBeInTheDocument()
    expect(screen.queryByText(GARCIA_LINE)).toBeNull()
  })

  it('shows a grant placement’s result on the tab', async () => {
    grantsRead = WITH_LINES
    answers = [json({ year: 2027, placed: 1, unchanged: 0, operation_id: 'op0000000000009' })]
    renderTab()
    await userEvent.click(await screen.findByText(GARCIA_LINE))
    const panel = await screen.findByTestId('needs-camper-panel')
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText(/^✓ 1 line placed on its camper/)).toBeInTheDocument()
    expect(writes()[0]?.url).toBe('/api/financial-aid/grants/2027/placements')
    expect(GARCIA_HOUSEHOLD.transaction_cm_id).toBe(4000002)
  })
})
