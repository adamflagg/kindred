/**
 * Money › To place, end to end through its real hooks (spec §8.1; §4.10; D12, D58, D152): what a
 * line shows, what Confirm sends, and that a refusal never leaves the panel stuck. Only `fetch` is
 * faked: `useApiWithAuth` and the write layer run as built.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { ApiAidGrants, ApiAidToPlace } from '../../../types/api-types'
import { GARCIA_HOUSEHOLD, GRANTS, grantRow } from '../grants/grantsFixtures'
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
// The registry's notes for this surface: one note unless a test says so.
const POSTED_NOTE = { key: 'posted', n: 1, text: 'Posted: the round’s Posted checkbox…' }
let definitionNotes: Array<{ key: string; n: number; text: string }> = [POSTED_NOTE]
let granted: string[] = []
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))

const REGISTRAR = ['financial_aid.view', 'financial_aid.casework']
// The line cell leads with what differs line to line: the date, who, then the description (final UX ★14).
const JOHNSON_LINE = 'May 14 · to the household · Camp aid · Summer'
const GARCIA_LINE = 'Apr 3 · to Liam Garcia · Camp aid · Summer'
const CHEN_LINE = 'May 20 · to the household · Camp aid · Quest'
const SAM_LINE = 'Apr 18 · to Riley Sam · Camp aid · Summer'
const SAMUEL_LINE = 'Jun 1 · to Samuel Johnson · Camp aid · Quest'
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
  definitionNotes = [POSTED_NOTE]
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
            notes: definitionNotes,
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

function Where() {
  const here = useLocation()
  return <span data-testid="where">{`${here.pathname}${here.search}`}</span>
}

function renderTab(householdCmId: number | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToPlaceTab view={VIEW} householdCmId={householdCmId} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

/** The words of each "What Confirm does" line, symbol first removed: one effect per line (§16). */
const effects = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('[data-effect]')).map((li) =>
    li.textContent.replace(/^[✓○⚠·]\s*/, '')
  )
/** The toolbar's one row (design-language §5). */
const toolbar = () => document.querySelector('[data-aid-toolbar]') as HTMLElement

const openLine = async (words: string) => {
  await userEvent.click(await screen.findByText(words))
  return screen.findByTestId('to-place-row')
}

describe('Money › To place (§8.1)', () => {
  it("shows the server's open count and total, and the lines grouped by its reasons", async () => {
    renderTab()
    // The lead: the count bold, the figures muted, on the toolbar's one row (§5).
    expect(await screen.findByText('5 lines open')).toBeInTheDocument()
    expect(screen.getByText('· $6,920 camp aid')).toBeInTheDocument()
    // Each reason is a bold heading with its count, and a callout on its own line (§16).
    expect(screen.getByText('Several requests could take this line')).toBeInTheDocument()
    expect(screen.getByText('3 lines · 3 households')).toBeInTheDocument()
    const several = screen
      .getByText('Several requests could take this line')
      .closest('[data-aid-section]')
    expect(within(several as HTMLElement).getByText('Confirm')).toBeInTheDocument()
    expect(
      within(several as HTMLElement).getByText('→ marks the round Posted ✓')
    ).toBeInTheDocument()
    expect(screen.getByText('No request behind this line')).toBeInTheDocument()
    expect(screen.getByText('Nothing to mark Posted')).toBeInTheDocument()
    expect(screen.getByText('→ Reclassify it, or Leave With a Note')).toBeInTheDocument()
    // Left at family level: a heading and a muted meta (final UX, mock section 6).
    expect(screen.getByText('1 line · $120 · not in the open count')).toBeInTheDocument()
  })

  it('opens a line: its candidates, the suggestion, its evidence and what Confirm does', async () => {
    renderTab()
    const panel = await openLine(JOHNSON_LINE)
    expect(within(panel).getByText('Emma Johnson · Session 2')).toBeInTheDocument()
    expect(within(panel).getByText('· $2,200 not yet in CampMinder')).toBeInTheDocument()
    expect(effects(panel)).toContain('Marks Posted · Emma Johnson · Session 2 · R2 · $780')
  })

  it('Confirm sends what it showed it would lock, and says what it marked posted', async () => {
    renderTab()
    const panel = await openLine(CHEN_LINE)
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
    expect(
      await screen.findByText('✓ Chen: $1,500 placed · ✓ R2 Posted · $1,500')
    ).toBeInTheDocument()
    // The status is short; the title carries every request by name (§4.10: the result lists what was marked).
    expect(screen.getByText('✓ Chen: $1,500 placed · ✓ R2 Posted · $1,500')).toHaveAttribute(
      'title',
      '✓ Chen: $1,500 placed. Marked Posted: Olivia Chen · Quest Round 2 · $1,500.'
    )
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
    const panel = await openLine(CHEN_LINE)
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
    expect(
      await within(panel).findByText(/What this would mark Posted changed since the page loaded/)
    ).toBeInTheDocument()
    expect(effects(panel)).toContain('Marks Posted · Olivia Chen · Quest · R2 · $1,400')
    const confirm = within(panel).getByRole('button', { name: 'Confirm' })
    expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    await waitFor(() => expect(writes()).toHaveLength(2))
    expect(JSON.parse(String(writes()[1]?.body))).toMatchObject({ expected_locked: '1400.00' })
  })

  it('a 409 race says someone else changed it, and Confirm stays on', async () => {
    answers = [json({ detail: 'Someone else changed this; reload and try again' }, 409)]
    renderTab()
    const panel = await openLine(CHEN_LINE)
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
    expect(
      await within(panel).findByText(/Someone else changed this while you looked/)
    ).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Confirm' })).toBeEnabled()
  })

  it('leaves a line at family level with a note', async () => {
    answers = [json(WROTE)]
    renderTab()
    const panel = await openLine(CHEN_LINE)
    await userEvent.click(within(panel).getByRole('button', { name: 'Leave at Family Level…' }))
    await userEvent.type(within(panel).getByRole('textbox'), 'Waiting on CampMinder')
    await userEvent.click(within(panel).getByRole('button', { name: 'Leave It' }))
    expect(
      await screen.findByText('✓ Chen: left at family level with your note · Reopen needs a reason')
    ).toBeInTheDocument()
    expect(writes()).toEqual([
      {
        url: '/api/financial-aid/money/2027/to-place/3000003/leave',
        method: 'POST',
        body: JSON.stringify({ note: 'Waiting on CampMinder' }),
      },
    ])
  })

  it('heads "Left at family level" in bold sans, not a display-serif heading, with a muted meta (mock section 6)', async () => {
    renderTab()
    const left = await screen.findByTestId('left-lines')
    const heading = within(left).getByText('Left at family level')
    expect(heading.tagName).not.toBe('H3')
    expect(heading).toHaveClass('font-bold', 'text-[13.5px]')
    expect(within(left).getByText('1 line · $120 · not in the open count')).toHaveClass(
      'text-muted-foreground'
    )
  })

  it('draws the left lines as a table: Family · The line · Why it was left · Amount · Reopen…', async () => {
    renderTab()
    const left = await screen.findByTestId('left-lines')
    const heads = within(left)
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
    expect(heads).toEqual(['Family', 'The line in CampMinder', 'Why it was left', 'Amount', ''])
    expect(within(left).getByText('A deposit credit keyed as aid')).toBeInTheDocument()
    expect(within(left).getByText('$120')).toBeInTheDocument()
    // Every cut cell carries its full words (§13).
    expect(within(left).getByText('A deposit credit keyed as aid').closest('td')).toHaveAttribute(
      'title',
      'A deposit credit keyed as aid'
    )
  })

  it('reopens a left line with a reason', async () => {
    answers = [json(WROTE)]
    renderTab()
    const left = await screen.findByTestId('left-lines')
    expect(within(left).getByText('A deposit credit keyed as aid')).toBeInTheDocument()
    await userEvent.click(within(left).getByRole('button', { name: 'Reopen…' }))
    await userEvent.type(within(left).getByRole('textbox'), 'Fixed in CampMinder')
    await userEvent.click(within(left).getByRole('button', { name: 'Reopen' }))
    expect(
      await screen.findByText('✓ Garcia: reopened · the line is open again')
    ).toBeInTheDocument()
    expect(writes()[0]).toMatchObject({
      url: '/api/financial-aid/money/2027/to-place/3000006/leave?reason=Fixed+in+CampMinder',
      method: 'DELETE',
    })
  })

  it('shows view-only staff the line and its preview, and no way to change it', async () => {
    granted = ['financial_aid.view']
    renderTab()
    const panel = await openLine(CHEN_LINE)
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
      const panel = await openLine(CHEN_LINE)
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
      const panel = await openLine(CHEN_LINE)
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
      const chen = await openLine(CHEN_LINE)
      await userEvent.click(within(chen).getByRole('button', { name: 'Confirm' }))
      expect(await screen.findByText(/^✓ Chen: \$1,500 placed/)).toBeInTheDocument()
      const johnson = await openLine(JOHNSON_LINE)
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
      const panel = await openLine(CHEN_LINE)
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
    it('reads Placing…, disables Confirm and Leave, and sends one POST on a double click', async () => {
      let release: (r: Response) => void = () => undefined
      gate = new Promise((resolve) => {
        release = resolve
      })
      renderTab()
      const panel = await openLine(CHEN_LINE)
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
      const first = await openLine(CHEN_LINE)
      await userEvent.click(within(first).getByRole('button', { name: 'Confirm' }))
      await userEvent.click(await screen.findByText(JOHNSON_LINE))
      const back = await openLine(CHEN_LINE)
      expect(within(back).getByRole('button', { name: 'Placing…' })).toBeDisabled()
      expect(within(back).getByRole('button', { name: 'Leave at Family Level…' })).toBeDisabled()
      expect(writes()).toHaveLength(1)
      release(json(PLACED))
      expect(await screen.findByText(/^✓ Chen: \$1,500 placed/)).toBeInTheDocument()
    })
  })

  it('keeps the table when a background refetch fails (owner ruling Group 5)', async () => {
    renderTab()
    const panel = await openLine(CHEN_LINE)
    failReads = true
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText(/^✓ Chen: \$1,500 placed/)).toBeInTheDocument()
    expect(screen.getByText('5 lines open')).toBeInTheDocument()
  })

  it('offers "Leave With a Note…" on a line that is not a several-requests line', async () => {
    renderTab()
    const panel = await openLine(SAMUEL_LINE)
    expect(within(panel).getByRole('button', { name: 'Leave With a Note…' })).toBeInTheDocument()
  })

  it('draws ✓ in green for a round it marks Posted, and "Marks nothing Posted." with no state colour (§16)', async () => {
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
    const chen = await openLine(CHEN_LINE)
    expect(effects(chen)).toContain('Marks nothing Posted.')
    expect(chen.querySelector('[data-sym]')?.className).not.toMatch(/forest/)
    const johnson = await openLine(JOHNSON_LINE)
    const ok = johnson.querySelector('[data-effect] [data-sym]')
    expect(ok).toHaveTextContent('✓')
    expect(ok?.className).toMatch(/forest/)
  })

  it("heads the suggestion in the dashboard's words, never Kindred's (owner 10-05)", async () => {
    renderTab()
    const panel = await openLine(CHEN_LINE)
    // The column header is the short word now; the footnote mark explains it (final UX ★14).
    expect(screen.getAllByRole('columnheader', { name: /^Suggestion/ }).length).toBeGreaterThan(0)
    expect(within(panel).getByText(/^Suggestion/)).toBeInTheDocument()
    expect(screen.queryByText(/Kindred/)).toBeNull()
  })

  it('exports the household and the line id, so a row joins back to CampMinder (review m5)', async () => {
    renderTab()
    await screen.findByText('5 lines open')
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    const [content] = downloadSpy.mock.calls.at(-1) as [string, string]
    const [header, firstRow] = content.split('\n')
    // Ruling B dropped the "Not placed" column; the CSV keeps the figure. The Amount column is the line's own (final UX ★14).
    expect(header).toMatch(
      /^Family,The line in CampMinder,Could belong to,Suggestion,What Confirm does,Amount,Household CM id,Line,Still not placed,Group$/
    )
    expect(firstRow).toMatch(/,3620,1000001,3000001,3620,Camp aid: /)
  })

  describe('scan residue (#2990)', () => {
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
      const panel = await openLine(CHEN_LINE)
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
      const panel = await openLine(CHEN_LINE)
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
      const panel = await openLine(CHEN_LINE)
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

  it('puts what each request still lacks in the candidates cell, short, with the full words in its title', async () => {
    renderTab()
    const first = await screen.findByText('Emma Johnson · Session 2 · $2,200')
    expect(screen.getAllByText('Samuel Johnson · Session 2 · $1,420').length).toBeGreaterThan(0)
    expect(first.closest('td')).toHaveAttribute(
      'title',
      expect.stringContaining('Emma Johnson · Session 2: $2,200 not yet in CampMinder')
    )
    // The household id is a tie-break only (rulings 10-05): never drawn under every family.
    expect(screen.queryByText('1000003')).toBeNull()
  })

  it('has the six short columns, headers on one line: Family · The line · Could belong to · Suggestion · What Confirm does · Amount (★14)', async () => {
    renderTab()
    await screen.findByText('5 lines open')
    const table = screen.getAllByRole('table')[0] as HTMLElement
    const heads = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent.replace(/\d+$/, ''))
    expect(heads).toEqual([
      '',
      'Family',
      'The line in CampMinder',
      'Could belong to',
      'Suggestion',
      'What Confirm does',
      'Amount',
    ])
    for (const th of within(table).getAllByRole('columnheader')) {
      expect(th).toHaveClass('whitespace-nowrap')
    }
  })

  it('says the suggestion in bold and each cell short: ✓ R2 Posted · $780, ⚠ R2 by hand', async () => {
    renderTab()
    expect(await screen.findByText('Place on Olivia Chen · Quest')).toHaveClass('font-bold')
    expect(screen.getByText('Split $2,200 / $1,420')).toBeInTheDocument()
    const johnson = (await screen.findByText(JOHNSON_LINE)).closest('tr') as HTMLElement
    expect(within(johnson).getByText('R2 Posted · $780').closest('td')).toHaveAttribute(
      'title',
      expect.stringContaining('Marks Posted')
    )
    const garcia = screen.getByText(GARCIA_LINE).closest('tr') as HTMLElement
    expect(within(garcia).getByText('R2 by hand')).toBeInTheDocument()
    expect(within(garcia).getByText('⚠')).toBeInTheDocument()
    expect(within(johnson).getByText('$3,620')).toBeInTheDocument()
  })

  it('draws each reason as its own heading, callout and table, the heading folding its group (mock)', async () => {
    renderTab()
    await screen.findByText('5 lines open')
    const sections = document.querySelectorAll('[data-aid-section]')
    expect(sections).toHaveLength(3)
    for (const section of sections) expect(section.querySelector('table')).not.toBeNull()
    const several = sections[0] as HTMLElement
    await userEvent.click(
      within(several).getByRole('button', { name: /Several requests could take this line/ })
    )
    expect(several.querySelector('table')).toBeNull()
    // A shut group keeps its heading and drops its callout, as the mock does.
    expect(within(several).queryByText('→ marks the round Posted ✓')).toBeNull()
    expect(within(several).getByText('Several requests could take this line')).toBeInTheDocument()
  })

  it('goes flat: one heading, "Camp-aid lines", over one table', async () => {
    renderTab()
    await userEvent.click(await screen.findByRole('button', { name: 'Flat' }))
    expect(await screen.findByText('Camp-aid lines')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-aid-section] table')).toHaveLength(1)
  })

  it('has one toolbar row: the lead, Flat / By reason, the search, Download CSV, nothing on a second row (§5)', async () => {
    renderTab()
    await screen.findByText('5 lines open')
    const bar = toolbar()
    expect(within(bar).getByText('5 lines open')).toHaveClass('font-semibold')
    expect(within(bar).getByText('· $6,920 camp aid')).toHaveClass('text-muted-foreground')
    expect(within(bar).getByRole('group', { name: 'Grouping' })).toBeInTheDocument()
    expect(within(bar).getByRole('searchbox')).toHaveAttribute('placeholder', 'Names or CM IDs')
    const labels = Array.from(bar.querySelectorAll('button,input')).map(
      (e) => (e as HTMLInputElement).placeholder || e.textContent
    )
    expect(labels.at(-1)).toBe('Download CSV')
    // No bulk bar, and no result line, above the table.
    expect(document.querySelectorAll('[data-aid-toolbar]')).toHaveLength(1)
  })
})

describe('a line opens in three panels, the grid’s opened row (owner ruling A, 10-06)', () => {
  it('puts the line and its evidence left, the requests in the middle, Confirm right', async () => {
    renderTab()
    const row = await openLine(JOHNSON_LINE)
    const panel = (name: string) => {
      const found = row.querySelector(`[data-panel="${name}"]`)
      if (!(found instanceof HTMLElement)) throw new Error(`no ${name} panel`)
      return within(found)
    }
    expect(panel('line').getByText('$3,620')).toBeInTheDocument()
    expect(
      panel('line').getByText(/Camp aid · Summer · posted to the household · May 14/)
    ).toBeInTheDocument()
    expect(
      panel('line').getByText(/the two requests together \(\$2,200 \+ \$1,420\)/)
    ).toBeInTheDocument()
    expect(panel('candidates').getByText('· $2,200 not yet in CampMinder')).toBeInTheDocument()
    expect(panel('confirm').getByText('What Confirm does')).toBeInTheDocument()
    expect(panel('confirm').getByRole('button', { name: 'Confirm Split' })).toBeInTheDocument()
    // The opened row is AidTable's detail line, not the old editor row (#2990's).
    expect(row.closest('[data-aid-detail]')).not.toBeNull()
  })

  it('Esc closes the opened line', async () => {
    renderTab()
    await openLine(JOHNSON_LINE)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('to-place-row')).toBeNull()
  })
})

describe('Confirm reads a fresh preview when its line opens (P-4; review item 19)', () => {
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
    const row = await openLine(CHEN_LINE)
    await waitFor(() =>
      expect(effects(row)).toContain('Marks Posted · Olivia Chen · Quest · R2 · $1,400')
    )
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
    const row = await openLine(CHEN_LINE)
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
    const row = await openLine(CHEN_LINE)
    expect(within(row).getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Leave at Family Level…' }))
    expect(within(row).queryByRole('button', { name: 'Confirm' })).toBeNull()
    await userEvent.click(within(row).getByRole('button', { name: 'Back' }))
    expect(within(row).getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
  })

  it('asks only for a line that stays open: a line passed over asks nothing (R1-2)', async () => {
    renderTab()
    await openLine(GARCIA_LINE)
    // Straight on to the next line, before the first has settled.
    const row = await openLine(CHEN_LINE)
    await waitFor(() =>
      expect(effects(row)).toContain('Marks Posted · Olivia Chen · Quest · R2 · $1,500')
    )
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(previews().map((p) => p.url)).toEqual([
      '/api/financial-aid/money/2027/to-place/3000003/preview',
    ])
  })

  it('a preview that fails (a 500) leaves the read’s preview and Confirm in place', async () => {
    previewAnswer = () => json({ detail: 'Server error' }, 500)
    renderTab()
    const row = await openLine(CHEN_LINE)
    await waitFor(() => expect(previews()).toHaveLength(1))
    expect(effects(row)).toContain('Marks Posted · Olivia Chen · Quest · R2 · $1,500')
    expect(within(row).getByRole('button', { name: 'Confirm' })).toBeEnabled()
  })

  it('view-only staff see the read’s preview and no preview call (the route is casework)', async () => {
    granted = ['financial_aid.view']
    renderTab()
    const row = await openLine(CHEN_LINE)
    expect(effects(row)).toContain('Marks Posted · Olivia Chen · Quest · R2 · $1,500')
    // Past the settle time, so a call would have been made by now.
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(previews()).toHaveLength(0)
  })
})

describe('the footnote marks (design-language §12)', () => {
  it('numbers each header and the callout from the registry, with the note as the mark’s title', async () => {
    definitionNotes = [
      {
        key: 'not_yet_in_campminder',
        n: 1,
        text: 'Not yet in CampMinder: what a request still lacks.',
      },
      { key: 'to_place_suggestion', n: 2, text: 'Suggestion: the dashboard’s proposal.' },
      { key: 'placement_tick', n: 3, text: 'Placing checks Posted: oldest first.' },
      { key: 'posted', n: 4, text: 'Posted: the round’s Posted checkbox.' },
    ]
    renderTab()
    await screen.findByText('5 lines open')
    const table = screen.getAllByRole('table')[0] as HTMLElement
    const mark = (header: RegExp) =>
      within(within(table).getByRole('columnheader', { name: header })).getByText(/^\d$/)
    await waitFor(() => expect(mark(/Could belong to/)).toHaveTextContent('1'))
    expect(mark(/Could belong to/)).toHaveAttribute(
      'title',
      expect.stringMatching(/^Not yet in CampMinder/)
    )
    expect(mark(/^Suggestion/)).toHaveTextContent('2')
    expect(mark(/What Confirm does/)).toHaveTextContent('3')
    // Superscripts at about 0.72em (§12).
    expect(mark(/What Confirm does/)).toHaveClass('text-[0.72em]')
    const several = screen
      .getByText('Several requests could take this line')
      .closest('[data-aid-section]')
    expect(within(several as HTMLElement).getByText('4')).toHaveAttribute(
      'title',
      expect.stringMatching(/^Posted: /)
    )
  })
})

describe('the notes at the foot (ruling I: the owner reads them in place)', () => {
  it("reads the server's money-to-place notes", async () => {
    renderTab()
    // The mock bolds each note's leading term (boldTerm).
    expect((await screen.findByText('Posted:')).tagName).toBe('B')
    expect(await screen.findByText(/the round’s Posted checkbox/)).toBeInTheDocument()
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
    const row = await openLine(CHEN_LINE)
    await userEvent.click(within(row).getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText(/^✓ Mei & David Chen: \$1,500 placed/)).toBeInTheDocument()
  })
})

describe('Split… and Place on Another Request… preview what they place (§8.1; D12; P-4, review item 19)', () => {
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
    const johnson = await openLine(JOHNSON_LINE)
    expect(within(johnson).getByRole('button', { name: 'Confirm Split' })).toBeInTheDocument()
    expect(within(johnson).getByRole('button', { name: 'Edit the Split…' })).toBeInTheDocument()
    // Both candidates are in the suggestion: no other request to place it on.
    expect(within(johnson).queryByRole('button', { name: 'Place on Another Request…' })).toBeNull()
    const garcia = await openLine(GARCIA_LINE)
    expect(within(garcia).getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(within(garcia).getByRole('button', { name: 'Split…' })).toBeInTheDocument()
    expect(
      within(garcia).getByRole('button', { name: 'Place on Another Request…' })
    ).toBeInTheDocument()
    const chen = await openLine(CHEN_LINE)
    expect(within(chen).queryByRole('button', { name: 'Split…' })).toBeNull()
    expect(within(chen).queryByRole('button', { name: 'Place on Another Request…' })).toBeNull()
    const sam = await openLine(SAM_LINE)
    expect(within(sam).queryByRole('button', { name: /Split|Another/ })).toBeNull()
    // The program-mismatch line offers it, as money-v2.html draws it (R1-8a).
    const samuel = await openLine(SAMUEL_LINE)
    expect(
      within(samuel).getByRole('button', { name: 'Place on Another Request…' })
    ).toBeInTheDocument()
  })

  it('opens on the suggestion, asks the preview for exactly the parts typed, and places what it showed', async () => {
    renderTab()
    const row = await openLine(JOHNSON_LINE)
    await userEvent.click(within(row).getByRole('button', { name: 'Edit the Split…' }))
    const editor = within(row).getByTestId('place-editor')
    expect(within(editor).getByText('Parts add to $3,620 of $3,620')).toBeInTheDocument()
    await waitFor(() =>
      expect(effects(editor)).toContain('Marks Posted · Emma Johnson · Session 2 · R2 · $780')
    )
    previewAnswer = marksNothing
    const emma = within(editor).getByRole('textbox', { name: 'Part for Emma Johnson · Session 2' })
    const samuel = within(editor).getByRole('textbox', {
      name: 'Part for Samuel Johnson · Session 2',
    })
    await userEvent.clear(emma)
    await userEvent.type(emma, '2000')
    expect(
      within(editor).getByText('Parts add to $3,420: they must make $3,620')
    ).toBeInTheDocument()
    expect(within(editor).getByRole('button', { name: 'Place the Split' })).toBeDisabled()
    await userEvent.clear(samuel)
    await userEvent.type(samuel, '1620')
    await waitFor(() => expect(effects(editor)).toContain('Marks nothing Posted.'))
    // Only sums that equal the line were asked, and the last ask is the parts on screen.
    expect(parts(previews().at(-1))).toEqual([
      { request_id: 'reqemma00000001', amount: '2000.00' },
      { request_id: 'reqsamuel000002', amount: '1620.00' },
    ])
    answers = [json({ ...PLACED, placed: [3000001], ticked: [] })]
    await userEvent.click(within(editor).getByRole('button', { name: 'Place the Split' }))
    expect(
      await screen.findByText('✓ Johnson: $3,620 placed · nothing marked Posted')
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
    const row = await openLine(JOHNSON_LINE)
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
    expect(within(editor).getByText('Parts add to $3,620 of $3,620')).toBeInTheDocument()
    expect(button).toBeDisabled()
    await waitFor(() => expect(button).toBeEnabled())
    expect(parts(previews().at(-1))).toEqual([
      { request_id: 'reqemma00000001', amount: '2300.00' },
      { request_id: 'reqsamuel000002', amount: '1320.00' },
    ])
  })

  it('a refused preview says why in the editor and offers no place', async () => {
    renderTab()
    const row = await openLine(JOHNSON_LINE)
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
    const row = await openLine(JOHNSON_LINE)
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
    const row = await openLine(JOHNSON_LINE)
    await userEvent.click(within(row).getByRole('button', { name: 'Edit the Split…' }))
    const editor = within(row).getByTestId('place-editor')
    await waitFor(() => expect(effects(editor)).toContain('Marks nothing Posted.'))
    // The season moves between the preview and the click.
    lock = 780
    await userEvent.click(within(editor).getByRole('button', { name: 'Place the Split' }))
    expect(
      await within(editor).findByText(/What this would mark Posted changed since the page loaded/)
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(effects(editor)).toContain('Marks Posted · Emma Johnson · Session 2 · R2 · $780')
    )
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
    const row = await openLine(GARCIA_LINE)
    await userEvent.click(within(row).getByRole('button', { name: 'Place on Another Request…' }))
    const editor = within(row).getByTestId('place-editor')
    expect(within(editor).getByRole('button', { name: 'Place It' })).toBeDisabled()
    await userEvent.click(within(editor).getByRole('radio', { name: 'Liam Garcia · Quest' }))
    await waitFor(() =>
      expect(effects(editor)).toContain('Marks Posted · Liam Garcia · Quest · R1 · $600')
    )
    expect(parts(previews().at(-1))).toEqual([{ request_id: 'reqliamquest005', amount: '600.00' }])
    await userEvent.click(within(editor).getByRole('button', { name: 'Place It' }))
    await waitFor(() => expect(writes()).toHaveLength(1))
    expect(JSON.parse(String(writes()[0]?.body))).toEqual({
      parts: [{ request_id: 'reqliamquest005', amount: '600.00' }],
      note: '',
      expected_locked: '600.00',
    })
  })

  it('opens an editor under the three panels, the whole opened row, with its dependent choice shown off, not hidden (§24)', async () => {
    renderTab()
    const row = await openLine(GARCIA_LINE)
    await userEvent.click(within(row).getByRole('button', { name: 'Place on Another Request…' }))
    const editor = within(row).getByTestId('place-editor')
    // Not inside the right panel: it takes the row's width under all three.
    expect(editor.closest('[data-panel]')).toBeNull()
    expect(row.querySelector('[data-panel="confirm"]')).not.toContainElement(editor)
    // The effects column is there before anything is picked, switched off.
    const side = within(editor).getByTestId('place-effects')
    expect(within(side).getByText('What placing this does')).toBeInTheDocument()
    expect(within(side).getByText('Pick a request to see it')).toHaveClass('opacity-60')
    // Title Case buttons on one row, the logged-with-who line beside them.
    const place = within(editor).getByRole('button', { name: 'Place It' })
    const back = within(editor).getByRole('button', { name: 'Back' })
    expect(place.parentElement).toBe(back.parentElement)
    expect(place.parentElement).toHaveTextContent('Each part lands on its request in full')
  })

  it('Back closes the editor and brings the buttons back', async () => {
    renderTab()
    const row = await openLine(GARCIA_LINE)
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
  const FINANCE = [...REGISTRAR, 'financial_aid.rules']

  it('shows the registrar Reclassify… (finance), off: it is `rules` (money-v2.html; R1-8b)', async () => {
    renderTab()
    const row = await openLine(SAM_LINE)
    expect(within(row).queryByRole('button', { name: 'Reclassify…' })).toBeNull()
    expect(within(row).getByRole('button', { name: 'Reclassify… (finance)' })).toBeDisabled()
  })

  it('shows view-only staff no Reclassify at all', async () => {
    granted = ['financial_aid.view']
    renderTab()
    const row = await openLine(SAM_LINE)
    expect(within(row).queryByRole('button', { name: /Reclassify/ })).toBeNull()
  })

  it('offers finance Reclassify on a no-request or program-mismatch line, never a several-requests one', async () => {
    granted = FINANCE
    renderTab()
    expect(
      within(await openLine(SAM_LINE)).getByRole('button', { name: 'Reclassify…' })
    ).toBeInTheDocument()
    expect(
      within(await openLine(SAMUEL_LINE)).getByRole('button', { name: 'Reclassify…' })
    ).toBeInTheDocument()
    const johnson = await openLine(JOHNSON_LINE)
    expect(within(johnson).queryByRole('button', { name: 'Reclassify…' })).toBeNull()
  })

  it('sends the target and the reason, and says the next ledger sync applies it', async () => {
    granted = FINANCE
    answers = [json({ ...WROTE, transaction_cm_id: 3000004 })]
    renderTab()
    const row = await openLine(SAM_LINE)
    await userEvent.click(within(row).getByRole('button', { name: 'Reclassify…' }))
    const editor = within(row).getByTestId('reclassify-editor')
    // The white picker, in the editor's 30px face (§3, §24), listing the targets under their kind.
    const picker = within(editor).getByRole('button', { name: /^Reclassify as:/ })
    expect(picker.className).toMatch(/h-\[30px\]/)
    expect(editor.querySelector('select')).toBeNull()
    // Off until a source and a reason are given (an open list makes the rest of the page inert).
    expect(within(editor).getByRole('button', { name: 'Reclassify' })).toBeDisabled()
    await userEvent.click(picker)
    await within(editor).findByRole('option', { name: 'Grantor C full-ride program (outside)' })
    // The line's own description and the unclassified one are not offered.
    expect(within(editor).queryByRole('option', { name: /^Camp aid · Summer/ })).toBeNull()
    expect(within(editor).queryByRole('option', { name: /Returning-family bonus/ })).toBeNull()
    await userEvent.click(
      within(editor).getByRole('option', { name: 'Grantor C full-ride program (outside)' })
    )
    await userEvent.type(within(editor).getByRole('textbox'), 'An outside full-ride line')
    await userEvent.click(within(editor).getByRole('button', { name: 'Reclassify' }))
    expect(
      await screen.findByText(
        '✓ Sam: reclassified as Grantor C full-ride program · the next ledger sync applies it'
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
    const row = await openLine(SAM_LINE)
    await userEvent.click(within(row).getByRole('button', { name: 'Reclassify…' }))
    const editor = within(row).getByTestId('reclassify-editor')
    await userEvent.click(within(editor).getByRole('button', { name: /^Reclassify as:/ }))
    await userEvent.click(
      await within(editor).findByRole('option', { name: 'Grantor C full-ride program (outside)' })
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

  it('lists reclassified lines apart as a table, with where they go and the server’s total (mock section 6)', async () => {
    reads = [{ ...TO_PLACE, reclassified: [SAM_RECLASSIFIED], reclassified_total: 450 }]
    renderTab()
    const apart = await screen.findByTestId('reclassified-lines')
    const heading = within(apart).getByText('Reclassified')
    expect(heading).toHaveClass('font-bold')
    expect(within(apart).getByText('1 line · $450 · waits for the next ledger sync')).toHaveClass(
      'text-muted-foreground'
    )
    expect(
      within(apart)
        .getAllByRole('columnheader')
        .map((h) => h.textContent)
    ).toEqual(['Family', 'The line in CampMinder', 'Reclassified as', 'Amount'])
    expect(within(apart).getByText('→ Grantor C full-ride program')).toBeInTheDocument()
    expect(within(apart).getByText('$450')).toBeInTheDocument()
    expect(screen.queryByText(/tonight/)).toBeNull()
  })
})

describe('one family’s To place (D26; P-8)', () => {
  it("reads one family's scope, and shows it as a removable chip in the toolbar (§6; answers 1a)", async () => {
    renderTab(1000001)
    const chip = await screen.findByText('One family')
    expect(toolbar()).toContainElement(chip)
    // The old sentence sits in the chip's title, not in a row of its own that pushes the page down.
    expect(chip.closest('span[title]')).toHaveAttribute(
      'title',
      expect.stringContaining('the household and every household that shares its requests')
    )
    expect(screen.queryByText(/One family's lines:/)).toBeNull()
    expect(screen.queryByRole('link', { name: 'All Families ›' })).toBeNull()
    const reads = calls().filter((c) => c.method === 'GET' && c.url.includes('/to-place'))
    expect(reads[0]?.url).toBe('/api/financial-aid/money/2027/to-place?household_cm_id=1000001')
    // R1-10: open a line in the family's scope, so the check isn't vacuous: no "Only This Family ›".
    const row = await openLine(JOHNSON_LINE)
    expect(within(row).getByRole('link', { name: 'Open the Household ›' })).toBeInTheDocument()
    expect(within(row).queryByRole('link', { name: 'Only This Family ›' })).toBeNull()
  })

  it('clears the chip back to every family', async () => {
    renderTab(1000001)
    await userEvent.click(await screen.findByRole('button', { name: 'Clear One family' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/money/to-place?year=2027')
  })

  it('draws no chip for every family', async () => {
    renderTab()
    await screen.findByText('5 lines open')
    expect(screen.queryByText('One family')).toBeNull()
  })

  it('opens a line with "Only This Family ›" to its household’s scope', async () => {
    renderTab()
    const row = await openLine(JOHNSON_LINE)
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

  it('one button checks every exact single match and opens the dialog; a program mismatch is never one', async () => {
    reads = [TO_PLACE_WITH_RILEY]
    renderTab()
    // Chen's and Riley's lines; Samuel's program mismatch has one candidate and an exact amount,
    // but is a judgement call (plan review I3).
    await userEvent.click(
      await screen.findByRole('button', { name: 'Confirm the 2 Exact Matches…' })
    )
    const dialog = await screen.findByRole('dialog')
    // Final audit E4: the title counts, in the grant dialog's own words (the mock's "Confirm 2 exact single matches").
    expect(within(dialog).getByText('Confirm 2 exact single matches')).toBeInTheDocument()
    expect(
      within(dialog).getByText(/^2 lines · 2 households · marks \$1,800 Posted/)
    ).toBeInTheDocument()
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
    expect(await screen.findByText('✓ 2 lines placed · ✓ R2 Posted · $1,500')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps checks through a search, marks the hidden ones, and leaves out a split by name', async () => {
    reads = [TO_PLACE_WITH_RILEY]
    renderTab()
    await screen.findByText(CHEN_LINE)
    await userEvent.click(within(rowOf(CHEN_LINE)).getByRole('checkbox', { name: 'Select' }))
    await userEvent.click(within(rowOf(JOHNSON_LINE)).getByRole('checkbox', { name: 'Select' }))
    expect(screen.getByText('2 checked')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'Olivia')
    expect(await screen.findByText('2 checked · 1 hidden')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm the 2 Checked…' }))
    const dialog = await screen.findByRole('dialog')
    // One line: its own preview is exact, so no estimate pill (plan review m6).
    expect(
      within(dialog).getByText(/^1 line · 1 household · marks \$1,500 Posted/)
    ).toBeInTheDocument()
    expect(within(dialog).queryByText('Estimate')).toBeNull()
    expect(
      within(dialog).getByText('Left out, confirm one at a time: Johnson (a split).')
    ).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back' }))
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'Johnson')
    await userEvent.click(await screen.findByRole('button', { name: /^Confirm the \d+ Checked…/ }))
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
      await screen.findByRole('button', { name: 'Confirm the 2 Exact Matches…' })
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
    await screen.findByText(CHEN_LINE)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Exact Match/ })).toBeNull()
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
  const GARCIA_GRANT = 'Apr 3 · to the household · Grantor B'

  it('adds the lines as a fourth group below the camp-aid table, and counts them in the open line', async () => {
    grantsRead = WITH_LINES
    renderTab()
    expect(await screen.findByText('7 lines open')).toBeInTheDocument()
    expect(screen.getByText('· $6,920 camp aid · $2,300.50 outside grants')).toBeInTheDocument()
    const heading = await screen.findByText('Outside grant posted to the family')
    expect(screen.getByText('2 lines · $2,300.50')).toBeInTheDocument()
    const camp = screen.getByText('No request behind this line')
    expect(camp.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText(GARCIA_GRANT)).toBeInTheDocument()
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
    await screen.findByText('5 lines open')
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
    await screen.findByText('5 lines open')
    expect(screen.queryByText('Outside grant posted to the family')).toBeNull()
    expect(screen.queryByText(/outside grants/)).toBeNull()
    expect(screen.queryByText(/Click a line to see/)).toBeNull()
  })

  it('keeps the camp-aid table when the grants read fails', async () => {
    failGrants = true
    renderTab()
    expect(await screen.findByText('5 lines open')).toBeInTheDocument()
    expect(screen.getByText('No request behind this line')).toBeInTheDocument()
    expect(screen.queryByText('Outside grant posted to the family')).toBeNull()
  })

  it("narrows to one household's grant lines under ?household=", async () => {
    grantsRead = WITH_LINES
    reads = [{ ...TO_PLACE, household_cm_id: 1000003 }]
    renderTab(1000003)
    expect(await screen.findByText('6 lines open')).toBeInTheDocument()
    expect(screen.getByText('· $6,920 camp aid · $800.50 outside grants')).toBeInTheDocument()
    expect(screen.getByText('1 line · $800.50')).toBeInTheDocument()
    expect(screen.queryByText(GARCIA_GRANT)).toBeNull()
  })

  it('shows a grant placement’s result on the tab', async () => {
    grantsRead = WITH_LINES
    answers = [json({ year: 2027, placed: 1, unchanged: 0, operation_id: 'op0000000000009' })]
    renderTab()
    await userEvent.click(await screen.findByText(GARCIA_GRANT))
    const panel = await screen.findByTestId('needs-camper-panel')
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText(/^✓ 1 line placed on its camper/)).toBeInTheDocument()
    expect(writes()[0]?.url).toBe('/api/financial-aid/grants/2027/placements')
    expect(GARCIA_HOUSEHOLD.transaction_cm_id).toBe(4000002)
  })
})
