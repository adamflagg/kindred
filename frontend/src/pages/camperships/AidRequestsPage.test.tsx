import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { APPROVED_RULES_2026 } from '../../components/camperships/requests/approvedRulesFixtures'
import {
  APPEAL_REFUSAL_R1,
  GRID_ROWS,
  roundOut,
  gridRow,
  ROW_SAMUEL,
} from '../../components/camperships/requests/gridFixtures'
import { DETAIL_POSTED } from '../../components/camperships/season/historyFixtures'
import type {
  ApiAidApprovedRules,
  ApiAidGrid,
  ApiAidHistoryOperationDetail,
  ApiAidReportRequestIds,
  ApiAidRound,
} from '../../types/api-types'
import AidRequestsPage from './AidRequestsPage'

interface GridResult {
  data: ApiAidGrid | undefined
  isLoading: boolean
  error: Error | null
}
let grid: GridResult
// A refetch landing while the page is open: set `grid`, then `await refetch()`.
let bumpGrid: (() => void) | undefined
vi.mock('../../hooks/camperships/useAidGrid', async () => {
  const { useEffect, useState } = await import('react')
  return {
    useAidGrid: () => {
      const [, setTick] = useState(0)
      useEffect(() => {
        bumpGrid = () => setTick((n) => n + 1)
      }, [])
      return grid
    },
  }
})
const refetch = () => act(async () => bumpGrid?.())
let approved: { data: ApiAidApprovedRules | undefined } = { data: APPROVED_RULES_2026 }
vi.mock('../../hooks/camperships/useAidRules', () => ({
  useAidApprovedRules: () => approved,
}))
// The page reads the registry's notes to number its marked headers: stable fixtures, no auth provider needed.
// No registry notes here: the marks on headers have their own tests (RequestsGrid.final.test.tsx).
// One object per test, never per render, so the page's memos stay stable.
const DEFINITIONS_READY = {
  entries: [],
  notes: [],
  numberOf: () => null,
  isPending: false,
  error: null as Error | null,
}
let definitions = DEFINITIONS_READY
vi.mock('../../hooks/camperships/useAidDefinitions', () => ({
  useAidDefinitions: () => definitions,
}))
const notesProps = vi.fn()
vi.mock('../../components/camperships/shell/AidDefinitionNotes', () => ({
  AidDefinitionNotes: (props: unknown) => {
    notesProps(props)
    return null
  },
}))
// Slice 3's March file has its own tests (MarchFileButton.test.tsx); here, only where it shows.
vi.mock('../../components/camperships/requests/useMarchFile', () => ({
  useMarchFile: (year: number) => ({
    year,
    said: `March result ${String(year)}`,
    error: null,
    dismiss: vi.fn(),
  }),
}))
vi.mock('../../components/camperships/requests/MarchFileButton', () => ({
  MarchFileItem: ({ march }: { march: { year: number } }) => (
    <button type="button">{`March file ${String(march.year)}`}</button>
  ),
}))

let operation: {
  data: ApiAidHistoryOperationDetail | undefined
  error: Error | null
  isLoading: boolean
  refetch?: () => unknown
}
vi.mock('../../hooks/camperships/useAidHistory', () => ({
  useAidHistoryOperation: () => operation,
}))
// The requests behind a Reports count (slice 4 J): set per test.
let reportIdsRead: {
  data: ApiAidReportRequestIds | undefined
  error: Error | null
  refetch?: () => unknown
}
vi.mock('../../hooks/camperships/useAidReportRequests', () => ({
  useAidReportRequests: () => reportIdsRead,
}))
let granted: string[] = ['financial_aid.view']
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (p: string) => granted.includes(p) }),
}))
vi.mock('../../hooks/useCurrentYear', () => ({ useYear: () => 2027 }))
vi.mock('../../hooks/camperships/useAidEditorPreview', () => ({
  useAidEditorPreview: () => ({ preview: { status: 'idle' }, onAmountChange: () => undefined }),
}))
const keyAsk = vi.fn(() =>
  Promise.resolve({ year: 2027, written: 1, unchanged: 0, operation_id: 'op0000000000001' })
)
const tickAccepted = vi.fn()
const tickPosted = vi.fn(() =>
  Promise.resolve({ year: 2027, written: 1, unchanged: 0, operation_id: 'op0000000000002' })
)
vi.mock('../../hooks/camperships/useAidWrites', () => ({
  useAidKeyAsk: () => ({ mutateAsync: keyAsk }),
  useAidTickAccepted: () => ({ mutateAsync: tickAccepted, isPending: false }),
  useAidTickPosted: () => ({ mutateAsync: tickPosted, isPending: false }),
}))

/** The write's refusal once Round 2 is posted, as the read's `appeal_refusal` carries it (#2997). */
const R2_POSTED = "Round 2 is posted; its ask can't change"

const LIVE: ApiAidGrid = { year: 2027, rules_version: 1, rows: [...GRID_ROWS], ticked_season: true }
/** LIVE with Riley's request not cancelled, so a bulk check takes it (#3023 refuses any cancellation). */
const OPEN_RILEY: ApiAidGrid = {
  ...LIVE,
  rows: LIVE.rows.map((r) =>
    r.request_id === 'reqriley0000004' ? { ...r, cancellation: null } : r
  ),
}

function Where() {
  const { pathname, search } = useLocation()
  return <div data-testid="where">{pathname + search}</div>
}

function Back() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => void navigate(-1)}>
      Back
    </button>
  )
}

/** The grid's one toolbar line: the filters, search and Download CSV (owner, 2026-10-02; 10-04). */
const toolbar = () => screen.getByLabelText('Search').closest('[data-aid-toolbar]') as HTMLElement

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/aid/requests"
          element={
            <>
              <AidRequestsPage />
              <Where />
            </>
          }
        />
        <Route
          path="/aid/households/:householdCmId"
          element={
            <>
              <Back />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  )
}

// §3: Program is the white AidPicker (a Listbox button named "Program: …"), not a native control.
// Owner ruling (ux3 Q2): Requests' Program is plain "Program"; the "as priced" note is gone.
it('has no program-words note under the grid', () => {
  renderAt('/aid/requests')
  expect(screen.queryByTestId('program-words-note')).toBeNull()
})

const programButton = () => screen.getByRole('button', { name: /^Program:/ })
const openProgram = () => userEvent.click(programButton())
const pickProgram = async (name: string) => {
  await openProgram()
  await userEvent.click(await screen.findByRole('option', { name }))
}

const viewLink = (label: string) => screen.getByRole('link', { name: new RegExp(`^${label} `) })

beforeEach(() => {
  definitions = DEFINITIONS_READY
  approved = { data: APPROVED_RULES_2026 }
  keyAsk.mockClear()
  grid = { data: LIVE, isLoading: false, error: null }
  operation = { data: undefined, error: null, isLoading: false }
  reportIdsRead = { data: undefined, error: null }
  granted = ['financial_aid.view']
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-01T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('AidRequestsPage (§6.1, §6.2)', () => {
  // T4 spec change: the strip draws each count as its requests alone (the mock's one-line strip).
  it('opens on All, with every lens’s and stage’s requests on its link', () => {
    renderAt('/aid/requests')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Requests')
    expect(viewLink('All')).toHaveTextContent('All 5')
    expect(viewLink('All')).toHaveAttribute('href', '/aid/requests?year=2027')
    expect(viewLink('On hold')).toHaveTextContent('On hold 1')
    expect(viewLink('On hold')).toHaveAttribute('href', '/aid/requests?view=holds&year=2027')
  })

  // Spec §12.2: footnote 5 only when the rows shown hold outside money.
  it('adds the outside footnote only when the shown rows hold outside money', () => {
    const { unmount } = renderAt('/aid/requests')
    expect(notesProps.mock.lastCall?.[0]).toMatchObject({ surface: 'requests', extra: [] })
    unmount()
    const outside = gridRow({
      request_id: 'reqoutside00001',
      camper_name: 'Avery Testcamper',
      total_decided: 3675,
      rounds: [roundOut(1, 'posted', { decided: 3675, outside_budget: 3675 })],
    })
    grid = { data: { ...LIVE, rows: [...LIVE.rows, outside] }, isLoading: false, error: null }
    renderAt('/aid/requests')
    expect(notesProps.mock.lastCall?.[0]).toMatchObject({
      extra: [expect.stringMatching(/^Outside: the part of a round/)],
    })
  })

  // The footer's outside mark points at the outside note, which the notes list only once the registry
  // has loaded: while it is out, or failed with nothing loaded, the footer carries no number.
  it('marks the outside footer note only once the notes it points at are listed', () => {
    const outside = gridRow({
      request_id: 'reqoutside00001',
      camper_name: 'Avery Testcamper',
      total_decided: 3675,
      rounds: [roundOut(1, 'posted', { decided: 3675, outside_budget: 3675 })],
    })
    grid = { data: { ...LIVE, rows: [...LIVE.rows, outside] }, isLoading: false, error: null }
    const footerNote = () => screen.getByText(/^incl\. .* outside the budget/)
    const { unmount } = renderAt('/aid/requests')
    expect(footerNote().querySelector('sup')).toHaveTextContent('1')
    unmount()
    definitions = { ...DEFINITIONS_READY, isPending: true }
    const second = renderAt('/aid/requests')
    expect(footerNote().querySelector('sup')).toBeNull()
    second.unmount()
    definitions = { ...DEFINITIONS_READY, error: new Error('down') }
    renderAt('/aid/requests')
    expect(footerNote().querySelector('sup')).toBeNull()
  })

  // #2994: whether CM ✓ shows is the read's `ticked_season`, not a frontend copy of the first year.
  it('shows CM ✓ only when the read says the season is ticked', () => {
    const { unmount } = renderAt('/aid/requests')
    expect(screen.getByRole('columnheader', { name: 'CM ✓' })).toBeInTheDocument()
    unmount()
    grid = { data: { ...LIVE, ticked_season: false }, isLoading: false, error: null }
    renderAt('/aid/requests')
    expect(screen.queryByRole('columnheader', { name: 'CM ✓' })).toBeNull()
  })

  it("shows only a view's rows", () => {
    renderAt('/aid/requests?view=holds&year=2027')
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
    expect(screen.queryByText('Emma Johnson')).toBeNull()
  })

  it('says a queue view can’t be shown for a past date, and still shows All for it (Decision 11)', () => {
    grid = {
      data: {
        ...LIVE,
        as_of: '2027-03-01',
        rows: GRID_ROWS.map((row) => ({ ...row, queues: null })),
      },
      isLoading: false,
      error: null,
    }
    const { unmount } = renderAt('/aid/requests?view=holds&as_of=2027-03-01')
    expect(screen.getByText(/isn't rebuilt for a past date/)).toBeInTheDocument()
    expect(screen.queryByText('No requests in this view.')).toBeNull()
    expect(viewLink('On hold')).toHaveTextContent('On hold —')
    unmount()
    renderAt('/aid/requests?as_of=2027-03-01')
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
  })

  it("carries the grid's sort and grouping on the household link, so Back restores them (I1)", async () => {
    renderAt('/aid/requests?sort=total:desc&group=reason')
    await userEvent.click(screen.getByRole('link', { name: 'Ana Garcia' }))
    const where = new URL(String(screen.getByTestId('where').textContent), 'http://x')
    expect(where.pathname).toBe('/aid/households/1000003')
    expect(where.searchParams.get('sort')).toBe('total:desc')
    expect(where.searchParams.get('group')).toBe('reason')
  })

  it('opens the household from a name, with the view and season, and Back highlights the row (§3.5)', async () => {
    renderAt('/aid/requests')
    await userEvent.click(screen.getByRole('link', { name: 'Ana Garcia' }))
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/households/1000003?from=all&year=2027'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/requests?row=reqliam00000002')
    expect(screen.getByText('Liam Garcia').closest('tr')).toHaveAttribute(
      'data-highlighted',
      'true'
    )
  })

  // T6 spec change: Program and Pool are one grouped dropdown; pool names come from the rules' read.
  it("narrows to a program, kept in the URL, under its pool's heading from the rules' read", async () => {
    renderAt('/aid/requests')
    await openProgram()
    expect(screen.getByRole('option', { name: 'Pool B' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'pool_b' })).toBeNull()
    // The list is already open: a second click on the button would close it mid-pick (flaky under load).
    await userEvent.click(screen.getByRole('option', { name: 'Quests' }))
    expect(screen.getByTestId('where')).toHaveTextContent('program=quest')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Emma Johnson')).toBeNull()
  })

  it('narrows to a pool by its heading, clearing the program, and back (T6)', async () => {
    renderAt('/aid/requests?program=summer')
    await pickProgram('Pool B')
    expect(screen.getByTestId('where')).toHaveTextContent('pool=pool_b')
    expect(screen.getByTestId('where')).not.toHaveTextContent('program=')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Emma Johnson')).toBeNull()
    await pickProgram('At Camp')
    expect(screen.getByTestId('where')).toHaveTextContent('program=summer')
    expect(screen.getByTestId('where')).not.toHaveTextContent('pool=')
  })

  it("names the programs with the server's labels, not by their rules keys", async () => {
    renderAt('/aid/requests')
    await openProgram()
    expect(screen.getByRole('option', { name: 'At Camp' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'summer' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'Summer' })).toBeNull()
    expect(screen.getByRole('option', { name: 'Quests' })).toBeInTheDocument()
  })

  it("shows the family's word, not the rules' men's / women's programs: one Adult Weekends option", async () => {
    const adult = {
      ...GRID_ROWS[0]!,
      program_key: 'womens_weekend',
      program_family: 'adult_weekend',
      program_family_label: 'Adult Weekends',
    }
    grid = {
      data: { ...LIVE, rows: [...GRID_ROWS, adult, { ...adult, program_key: 'mens_weekend' }] },
      isLoading: false,
      error: null,
    }
    renderAt('/aid/requests')
    await openProgram()
    expect(screen.getAllByRole('option', { name: 'Adult Weekends' })).toHaveLength(1)
    expect(screen.queryByRole('option', { name: /Women/ })).toBeNull()
  })

  it('spells the pools out when the rules read has no answer (404, loading, failed), and still filters', async () => {
    approved = { data: undefined }
    renderAt('/aid/requests')
    await openProgram()
    expect(screen.getByRole('option', { name: 'At Camp' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Pool b' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: 'Quests' }))
    expect(screen.getByTestId('where')).toHaveTextContent('program=quest')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
  })

  it('stays on the URL it was opened at for a queue view on a past date (A8)', () => {
    grid = {
      data: {
        ...LIVE,
        as_of: '2026-04-01',
        rows: GRID_ROWS.map((row) => ({ ...row, queues: null })),
      },
      isLoading: false,
      error: null,
    }
    renderAt('/aid/requests?view=holds&as_of=2026-04-01')
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/requests?view=holds&as_of=2026-04-01'
    )
    expect(screen.getByText(/isn't rebuilt for a past date/)).toBeInTheDocument()
  })

  // Owner ruling (fast-follow, 10-03): the checklist chips are gone under D162 (no Posted ticks).
  // Was: "narrows to a round and a checklist state", clicking Accepted to write `tick=accepted`.
  it('narrows to a round, kept in the URL (Decision 9)', async () => {
    renderAt('/aid/requests')
    await userEvent.click(within(toolbar()).getByRole('button', { name: 'R2' }))
    expect(screen.getByTestId('where')).toHaveTextContent('round=2')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Samuel Johnson')).toBeNull()
  })

  it('ignores an old tick= link: it narrows nothing and no link carries it on', async () => {
    renderAt('/aid/requests?tick=accepted')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.getByText('Samuel Johnson')).toBeInTheDocument()
    expect(within(toolbar()).queryByRole('button', { name: 'Accepted' })).toBeNull()
    await userEvent.click(screen.getByRole('link', { name: 'Ana Garcia' }))
    expect(screen.getByTestId('where')).not.toHaveTextContent('tick=')
  })

  // Owner (10-04, csv-options.html option A): Download CSV ends the line again; the 10-03 "⤓ CSV"
  // chip is gone. Was: "…search and the ⤓ CSV chip on one toolbar line".
  // Owner rulings 10-04 late (grid follow-up): the line runs Program · Round · Flat / By reason ·
  // Show IDs · filter box · Download CSV. Was Program, Round, Show IDs, search, the switch, CSV.
  it('puts Program, the Round chips, Flat / By reason, Show IDs, search and Download CSV on one toolbar line, in that order', () => {
    renderAt('/aid/requests')
    const line = toolbar()
    expect(line).not.toBeNull()
    const inOrder = [
      programButton(),
      within(line).getByRole('button', { name: 'R1' }),
      within(line).getByRole('button', { name: 'Flat' }),
      screen.getByLabelText('Show IDs'),
      screen.getByLabelText('Search'),
      screen.getByRole('button', { name: 'Download CSV' }),
    ]
    for (const el of inOrder) expect(line).toContainElement(el)
    for (let i = 1; i < inOrder.length; i++) {
      const before = inOrder[i - 1] as HTMLElement
      const after = inOrder[i] as HTMLElement
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    // Design language §5: Download CSV is last in the toolbar's right-hand group.
    expect(line.lastElementChild?.lastElementChild).toBe(
      screen.getByRole('button', { name: 'Download CSV' })
    )
    expect(screen.queryByRole('button', { name: '⤓ CSV' })).toBeNull()
  })

  it('has no Counting toward the budget checkbox, and an old link’s counted=1 changes nothing', async () => {
    renderAt('/aid/requests?posted=1&counted=1')
    expect(screen.queryByLabelText('Counting toward the budget')).toBeNull()
    expect(await screen.findByText('Posted in Round 1')).toBeInTheDocument()
    expect(screen.queryByText(/counting toward the budget/)).toBeNull()
  })

  it('an old link’s counted=1 still shows a request whose money is outside the budget (R10)', async () => {
    const outside = gridRow({
      request_id: 'reqavery0000001',
      camper_name: 'Avery Testcamper',
      rounds: [roundOut(1, 'posted', { posted: 900, counts_toward_budget: false })],
    })
    grid = { data: { ...LIVE, rows: [...GRID_ROWS, outside] }, isLoading: false, error: null }
    renderAt('/aid/requests?posted=1&counted=1')
    expect(await screen.findByText('Avery Testcamper')).toBeInTheDocument()
  })

  it('says live=1 is on, hides withdrawn and cancelled requests, and Show All clears it', async () => {
    const withdrawn = {
      ...ROW_SAMUEL,
      request_id: 'reqwithdrawn001',
      camper_name: 'Withdrawn Camper',
      request_status: 'withdrawn',
    }
    grid = { data: { ...LIVE, rows: [...GRID_ROWS, withdrawn] }, isLoading: false, error: null }
    renderAt('/aid/requests?live=1')
    // §6: the sentence row is a removable chip on the toolbar (✕ = Show All).
    expect(within(toolbar()).getByText('Live only')).toBeInTheDocument()
    expect(screen.queryByText('Withdrawn Camper')).toBeNull()
    expect(screen.queryByText('Riley Sam')).toBeNull()
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear Live only' }))
    expect(screen.getByTestId('where')).not.toHaveTextContent('live=')
    expect(screen.getByText('Withdrawn Camper')).toBeInTheDocument()
    expect(screen.queryByText('Live only')).toBeNull()
  })

  // Owner 10-06, option (a): Season's Posted / Accepted figures open on a hidden posted= / accepted=
  // param. A toolbar chip says what the list is (§6), like Live only, and its ✕ clears it.
  it('narrows to a Season figure, says so on a chip, and its ✕ clears it (owner 10-06)', async () => {
    renderAt('/aid/requests?accepted=1')
    expect(within(toolbar()).getByText('Accepted in Round 1')).toBeInTheDocument()
    // Olivia Chen was accepted in Round 1 and is in Round 2 now: the figure still counts her.
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Samuel Johnson')).toBeNull()
    expect(screen.queryByText('Emma Johnson')).toBeNull()
    expect(screen.queryByText(/tick/i)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Clear Accepted in Round 1' }))
    expect(screen.getByTestId('where')).not.toHaveTextContent('accepted=')
    expect(screen.queryByText(/Accepted in Round 1/)).toBeNull()
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
  })

  it('words the figure line for any round', async () => {
    renderAt('/aid/requests?posted=all')
    const chip = screen.getByText('Posted in any round')
    expect(chip.closest('[title]')).toHaveAttribute(
      'title',
      'Posted in any round: the requests behind one Season figure. ✕ shows all.'
    )
    expect(screen.getByText('Samuel Johnson')).toBeInTheDocument()
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Emma Johnson')).toBeNull()
  })

  it('shows only the requests of one History operation, with its chip and ✕ (spec §9.8)', async () => {
    operation = {
      data: {
        ...DETAIL_POSTED,
        rows: [{ ...DETAIL_POSTED.rows[0]!, request_id: GRID_ROWS[0]!.request_id }],
      },
      error: null,
      isLoading: false,
    }
    renderAt(`/aid/requests?op=${'o'.repeat(15)}`)
    expect(screen.getByText('History operation · 1')).toBeInTheDocument()
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    for (const other of ['Samuel Johnson', 'Liam Garcia', 'Olivia Chen', 'Riley Sam']) {
      expect(screen.queryByText(other)).toBeNull()
    }
    await userEvent.click(screen.getByRole('button', { name: 'Clear History operation · 1' }))
    expect(screen.getByTestId('where')).not.toHaveTextContent('op=')
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
  })

  it('says so when the operation is not in the log the reader can read', () => {
    // A 404 as the History tests build it: hasStatus reads `.status`.
    operation = {
      data: undefined,
      error: Object.assign(new Error('missing'), { status: 404 }),
      isLoading: false,
    }
    renderAt(`/aid/requests?op=${'o'.repeat(15)}`)
    const chip = screen.getByText('History operation not found')
    expect(chip.closest('[title]')).toHaveAttribute(
      'title',
      expect.stringContaining("That History operation isn't in the log you can read")
    )
  })

  it('says the operation is still being read rather than "0 requests" while it loads', () => {
    operation = { data: undefined, error: null, isLoading: true }
    renderAt(`/aid/requests?op=${'o'.repeat(15)}`)
    expect(screen.getByText('Reading History operation…')).toBeInTheDocument()
    expect(screen.queryByText(/The 0 requests/)).toBeNull()
  })

  it('says a failed operation read failed, with Try Again, rather than "0 requests"', async () => {
    const refetch = vi.fn()
    operation = {
      data: undefined,
      error: Object.assign(new Error('boom'), { status: 500 }),
      isLoading: false,
      refetch,
    }
    renderAt(`/aid/requests?op=${'o'.repeat(15)}`)
    expect(screen.getByRole('button', { name: "Couldn't read · Try Again" })).toBeInTheDocument()
    expect(screen.queryByText(/The 0 requests/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: "Couldn't read · Try Again" }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('does not carry the operation filter to the household page: the walk ignores it', async () => {
    operation = {
      data: {
        ...DETAIL_POSTED,
        rows: [{ ...DETAIL_POSTED.rows[0]!, request_id: GRID_ROWS[0]!.request_id }],
      },
      error: null,
      isLoading: false,
    }
    renderAt(`/aid/requests?op=${'o'.repeat(15)}&live=1`)
    // The walk's filters do not read op, so a household link that carried it would walk every request.
    await userEvent.click(screen.getByRole('link', { name: 'Emma Johnson' }))
    const where = screen.getByTestId('where')
    expect(where).toHaveTextContent('/aid/households/')
    expect(where).toHaveTextContent('live=1')
    expect(where).not.toHaveTextContent('op=')
  })

  describe("a Reports count's requests (slice 4 J; D20)", () => {
    const COUNT = `/aid/requests?report=${encodeURIComponent('statistics?part=tier&tier=1&count=apps&round=1')}`
    const ids = (requestIds: string[]): ApiAidReportRequestIds => ({
      year: 2027,
      as_of: null,
      as_of_axis: null,
      figures_on: '2027-04-01',
      request_set: null,
      request_ids: requestIds,
    })

    it('shows exactly the requests the count counts, with its chip and ✕', async () => {
      reportIdsRead = { data: ids([GRID_ROWS[0]!.request_id]), error: null }
      renderAt(COUNT)
      expect(screen.getByText('Statistics count · 1')).toBeInTheDocument()
      expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
      for (const other of ['Samuel Johnson', 'Liam Garcia', 'Olivia Chen', 'Riley Sam']) {
        expect(screen.queryByText(other)).toBeNull()
      }
      await userEvent.click(screen.getByRole('button', { name: 'Clear Statistics count · 1' }))
      expect(screen.getByTestId('where')).not.toHaveTextContent('report=')
      expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
    })

    it('shows none of the rows while the ids are out, and says so', () => {
      renderAt(COUNT)
      expect(screen.getByText('Reading Reports count…')).toBeInTheDocument()
      expect(screen.queryByText('Emma Johnson')).toBeNull()
    })

    it('says a failed read failed, with Try Again', async () => {
      const refetch = vi.fn()
      reportIdsRead = { data: undefined, error: new Error('boom'), refetch }
      renderAt(COUNT)
      await userEvent.click(screen.getByRole('button', { name: "Couldn't read · Try Again" }))
      expect(refetch).toHaveBeenCalledTimes(1)
    })

    it('keeps the count on view links but off the household link, which the walk would ignore', async () => {
      reportIdsRead = { data: ids([GRID_ROWS[0]!.request_id]), error: null }
      renderAt(COUNT)
      expect(viewLink('Needs an offer')).toHaveAttribute(
        'href',
        expect.stringContaining('report=statistics')
      )
      await userEvent.click(screen.getByRole('link', { name: 'Emma Johnson' }))
      const where = screen.getByTestId('where')
      expect(where).toHaveTextContent('/aid/households/')
      expect(where).not.toHaveTextContent('report=')
    })
  })

  it('carries the Season figure to the household page, so the walk keeps it', async () => {
    renderAt('/aid/requests?posted=1')
    await userEvent.click(screen.getByRole('link', { name: 'David Chen' }))
    expect(screen.getByTestId('where')).toHaveTextContent(
      /^\/aid\/households\/1000005\?from=all&posted=1&year=2027$/
    )
  })

  it('carries live to the household page (M5)', async () => {
    renderAt('/aid/requests?live=1')
    await userEvent.click(screen.getByRole('link', { name: 'Ana Garcia' }))
    expect(screen.getByTestId('where')).toHaveTextContent(
      /^\/aid\/households\/1000003\?from=all&live=1&year=2027$/
    )
  })

  it('carries the filters to the household page, so the walk and Back keep them (M5)', async () => {
    renderAt('/aid/requests?program=summer')
    await userEvent.click(screen.getByRole('link', { name: 'Ana Garcia' }))
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/households/1000003?from=all&program=summer&year=2027'
    )
  })

  it('opens on the row a link names, and keeps the URL in step with the highlight (Decision 2)', async () => {
    renderAt('/aid/requests?row=reqliam00000002')
    expect(screen.getByText('Liam Garcia').closest('tr')).toHaveAttribute(
      'data-highlighted',
      'true'
    )
    await userEvent.click(
      within(screen.getByText('Olivia Chen').closest('tr') as HTMLElement).getAllByRole(
        'cell'
      )[2] as HTMLElement
    )
    expect(screen.getByTestId('where')).toHaveTextContent('row=reqolivia000003')
  })

  // §6 (owner 1a R1, R2): the two sentence rows are gone; their words ride in a title.
  it('draws no split sentence on Needs an offer, and no Posted sentence on Waiting', () => {
    const { unmount } = renderAt('/aid/requests?view=needs-offer')
    expect(screen.queryByText(/posts one amount per household/)).toBeNull()
    unmount()
    renderAt('/aid/requests?view=waiting')
    expect(screen.queryByText(/posted in this round, not yet accepted/)).toBeNull()
    expect(
      screen.getByRole('columnheader', { name: 'Posted' }).querySelector('[title]') ??
        screen.getByRole('columnheader', { name: 'Posted' })
    ).toBeInTheDocument()
  })

  it('keeps showing loaded rows when a background refetch fails (Decision 33)', () => {
    grid = { data: LIVE, isLoading: false, error: new Error('Network down') }
    renderAt('/aid/requests')
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.queryByText(/Network down/)).toBeNull()
  })

  it('says so when nothing ever loaded', () => {
    grid = { data: undefined, isLoading: false, error: new Error('Network down') }
    renderAt('/aid/requests')
    expect(screen.getByText(/Network down/)).toBeInTheDocument()
  })
})

const headers = () => screen.getAllByRole('columnheader').map((th) => th.textContent)
/** The grid's body rows: the toolbar's Checklist chips are buttons named Posted and Accepted too (A2). */
const inRows = () => within(screen.getByRole('table').querySelector('tbody') as HTMLElement)

describe('AidRequestsPage views strip (T4; RULED P1, P2, P4)', () => {
  it('narrows every row and count to appeals under the Appeals lens, with the Appeals columns', () => {
    renderAt('/aid/requests?lens=appeals')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Emma Johnson')).toBeNull()
    expect(viewLink('Appeals')).toHaveTextContent('Appeals 1')
    expect(viewLink('All')).toHaveTextContent('All 5')
    expect(viewLink('Needs an offer')).toHaveTextContent('Needs an offer 1')
    // Owner 2026-10-04: a badge with nothing in it under the lens is not drawn.
    expect(screen.queryByRole('link', { name: /^On hold / })).toBeNull()
    expect(headers()).toContain('Appeal ask')
    // §6: no "Showing appeals only." sentence under the strip; the lit lens says it.
    expect(screen.queryByText('Showing appeals only.')).toBeNull()
  })

  it('links each stage under the lens, and each lens with no stage (picking a lens clears the stage)', () => {
    renderAt('/aid/requests?view=holds&lens=appeals&program=summer')
    expect(viewLink('Needs an offer')).toHaveAttribute(
      'href',
      '/aid/requests?view=needs-offer&lens=appeals&program=summer&year=2027'
    )
    expect(viewLink('All')).toHaveAttribute('href', '/aid/requests?program=summer&year=2027')
    expect(viewLink('Appeals')).toHaveAttribute(
      'href',
      '/aid/requests?lens=appeals&program=summer&year=2027'
    )
  })

  it("shows a stage's appeals with the Appeals view's column set", () => {
    renderAt('/aid/requests?view=needs-offer&lens=appeals')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Emma Johnson')).toBeNull()
    expect(headers()).toContain('Appeal ask')
    expect(headers()).not.toContain('Round')
  })

  it("orders the Appeals view's columns by the identity rule under the lens: Camper first, Requested by just left of Needs attention (T2, T3)", () => {
    renderAt('/aid/requests?view=needs-offer&lens=appeals')
    expect(headers()).toEqual([
      'Camper',
      'Session',
      'Stage',
      'R1',
      'Appeal ask',
      'R2',
      'Total',
      'Posted',
      'Requested by',
      'Needs attention',
    ])
  })

  it('shows a stage under All with its own columns, and no appeals-only line', () => {
    renderAt('/aid/requests?view=needs-offer')
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(headers()).toContain('Round')
    expect(screen.queryByText('Showing appeals only.')).toBeNull()
  })

  it('reads the retired ?view=appeals as no stage and no lens, and leaves the URL alone (no fallback)', () => {
    renderAt('/aid/requests?view=appeals')
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.queryByText('Showing appeals only.')).toBeNull()
    expect(screen.getByTestId('where')).toHaveTextContent('/aid/requests?view=appeals')
  })

  it('carries the lens and the stage to the household page (from=<stage>, or all)', async () => {
    renderAt('/aid/requests?lens=appeals')
    await userEvent.click(screen.getByRole('link', { name: 'David Chen' }))
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/aid/households/1000005?from=all&lens=appeals&year=2027'
    )
  })

  it('says the Appeals lens needs today’s data on a past date, and counts only All', () => {
    grid = {
      data: {
        ...LIVE,
        as_of: '2027-03-01',
        rows: GRID_ROWS.map((row) => ({ ...row, queues: null })),
      },
      isLoading: false,
      error: null,
    }
    renderAt('/aid/requests?lens=appeals&as_of=2027-03-01')
    expect(screen.getByText(/Appeals needs today's data/)).toBeInTheDocument()
    expect(viewLink('Appeals')).toHaveTextContent('Appeals —')
    expect(viewLink('All')).toHaveTextContent('All 5')
  })
})

describe('the editor row (§4.6; D22; owner rulings A and B)', () => {
  const sessionCell = (camper: string) =>
    within(screen.getByText(camper).closest('tr') as HTMLElement).getAllByRole(
      'cell'
    )[2] as HTMLElement

  beforeEach(() => {
    granted = ['financial_aid.view', 'financial_aid.casework']
  })

  it('opens under a row whose Round 1 is posted, on its Round 2 ask', async () => {
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1200')
  })

  // Owner fast-follow (a), 10-03: the refusal shows only once someone tries to type on the row.
  // Was: shown as soon as the row opened.
  it("says why where an appeal can't be keyed yet, once someone tries to type on the row", async () => {
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Emma Johnson'))
    expect(screen.queryByLabelText('Round 2 ask')).toBeNull()
    expect(screen.queryByText(APPEAL_REFUSAL_R1)).toBeNull()
    await userEvent.keyboard('1')
    // The row's own `appeal_refusal` (#2997), drawn as the server sent it.
    expect(screen.getByText(APPEAL_REFUSAL_R1)).toBeInTheDocument()
  })

  it('opens the editor inside the detail line, under its text, with no household caption of its own', async () => {
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    const detail = document.querySelector('[data-aid-detail]') as HTMLElement
    expect(detail).toContainElement(screen.getByLabelText('Round 2 ask'))
    expect(within(detail).queryByText(/· household 1000005/)).toBeNull()
    expect(within(detail).getAllByRole('link', { name: /^Household 1000005/ })).toHaveLength(1)
  })

  it('saves an appeal with ↓, dated today, and moves on at once (ruling A)', async () => {
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300{ArrowDown}')
    expect(keyAsk).toHaveBeenCalledWith({
      requestId: 'reqolivia000003',
      body: { round: 2, amount: 1300, asked_on: '2027-04-01', note: 'Family emailed (Apr 1)' },
    })
    // The walk moved through the page's onHighlight, so the URL followed (build ruling 2).
    expect(screen.getByTestId('where')).toHaveTextContent('row=reqriley0000004')
  })

  it('opens the family from a name only once what was typed is saved (Decision 4)', async () => {
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '1300')
    await userEvent.click(screen.getByRole('link', { name: 'David Chen' }))
    expect(keyAsk).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/aid/households/1000005?from=all&year=2027'
      )
    )
  })

  it("stays on the grid when a ↓ save fails after a family link was clicked (C1, the review's probe)", async () => {
    let fail: ((error: Error) => void) | undefined
    keyAsk.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject: (error: Error) => void) => {
          fail = reject
        })
    )
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300{ArrowDown}')
    // On Riley's row now, nothing typed; Olivia's save is still in flight.
    await userEvent.click(screen.getByRole('link', { name: 'Riley Sam' }))
    expect(screen.getByTestId('where')).not.toHaveTextContent('/aid/households')
    await act(async () => fail?.(new Error('The server is down')))
    expect(screen.getByTestId('where')).not.toHaveTextContent('/aid/households')
    expect(screen.getByTestId('where')).toHaveTextContent('row=reqolivia000003')
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1300')
    // §5–6 (answers R8): the failure is the toolbar's status slot, its words in the title.
    const status = screen.getByText("⚠ Couldn't save Olivia Chen's Round 2 ask")
    expect(status).toHaveAttribute(
      'title',
      "Couldn't save Olivia Chen's Round 2 ask: The server is down Go Back to the row to try again."
    )
  })

  it('lands Back on the row whose family was opened, with the editor walk on (§3.5)', async () => {
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.click(screen.getByRole('link', { name: 'Ana Garcia' }))
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000003')
    )
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByTestId('where')).toHaveTextContent('row=reqliam00000002')
    expect(screen.getByText('Liam Garcia').closest('tr')).toHaveAttribute(
      'data-highlighted',
      'true'
    )
  })

  it('saves what is typed before a view link moves the page (Decision 4)', async () => {
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '1300')
    await userEvent.click(viewLink('Appeals'))
    expect(keyAsk).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('lens=appeals'))
  })

  it('saves what is typed before a filter changes the rows (A18: every exit ↓ handles)', async () => {
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '1300')
    await pickProgram('Quests')
    expect(keyAsk).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('program=quest'))
  })

  it("won't move for a filter while what is typed can't be saved yet, and says why once", async () => {
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '12,50')
    await pickProgram('Quests')
    expect(screen.getByTestId('where')).not.toHaveTextContent('program=quest')
    expect(screen.getAllByText('Not an amount')).toHaveLength(1)
    expect(keyAsk).not.toHaveBeenCalled()
  })

  // Lead ruling (scan of #3005): folding the opened row's group is a way out like any other, so it
  // saves first and folds only when it can leave.
  const groupHeadingOf = (camper: string) => {
    let tr = screen.getByText(camper).closest('tr')?.previousElementSibling ?? null
    while (tr !== null && tr.querySelector('[data-group-heading]') === null)
      tr = tr.previousElementSibling
    if (tr === null) throw new Error(`no group heading above ${camper}`)
    return tr.querySelector('[data-group-heading]') as HTMLElement
  }

  it("won't fold the opened row's group while what is typed can't be saved yet, and says why", async () => {
    renderAt('/aid/requests')
    await userEvent.click(screen.getByRole('button', { name: 'By reason' }))
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '12,50')
    const heading = groupHeadingOf('Olivia Chen')
    await userEvent.click(within(heading).getByRole('button'))
    expect(heading).toHaveTextContent('▾')
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('12,50')
    expect(screen.getAllByText('Not an amount')).toHaveLength(1)
    expect(keyAsk).not.toHaveBeenCalled()
  })

  it("saves what is typed before folding the opened row's group, then folds it", async () => {
    renderAt('/aid/requests')
    await userEvent.click(screen.getByRole('button', { name: 'By reason' }))
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '1300')
    const heading = groupHeadingOf('Olivia Chen')
    await userEvent.click(within(heading).getByRole('button'))
    expect(keyAsk).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(heading).toHaveTextContent('▸'))
    expect(screen.queryByText('Olivia Chen')).toBeNull()
    // The URL follows through the router, which can land a beat after the fold under load.
    await waitFor(() => expect(screen.getByTestId('where')).not.toHaveTextContent('row='))
  })

  it("holds the fold while the opened row's save is still out, and keeps the group open when it fails", async () => {
    let fail: ((error: Error) => void) | undefined
    keyAsk.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject: (error: Error) => void) => {
          fail = reject
        })
    )
    renderAt('/aid/requests')
    await userEvent.click(screen.getByRole('button', { name: 'By reason' }))
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '1300')
    const heading = groupHeadingOf('Olivia Chen')
    await userEvent.click(within(heading).getByRole('button'))
    expect(keyAsk).toHaveBeenCalledTimes(1)
    expect(heading).toHaveTextContent('▾')
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1300')
    await act(async () => fail?.(new Error('The server is down')))
    expect(heading).toHaveTextContent('▾')
    expect(screen.getByTestId('where')).toHaveTextContent('row=reqolivia000003')
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1300')
  })

  it('opens a stage view with every group open, whatever was folded on All', async () => {
    renderAt('/aid/requests')
    await userEvent.click(screen.getByRole('button', { name: 'By reason' }))
    const onAll = [...document.querySelectorAll('[data-group-heading]')].find((td) =>
      td.textContent.includes('To reverse')
    ) as HTMLElement
    await userEvent.click(within(onAll).getByRole('button'))
    expect(onAll).toHaveTextContent('▸')
    await userEvent.click(viewLink('To reverse'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('view=to-reverse'))
    const heading = document.querySelector('[data-group-heading]') as HTMLElement
    expect(heading).toHaveTextContent('To reverse')
    expect(heading).toHaveTextContent('▾')
  })

  it('marks the failed row in the grid (Decision 3, as accepted)', async () => {
    let fail: ((error: Error) => void) | undefined
    keyAsk.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject: (error: Error) => void) => {
          fail = reject
        })
    )
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300{ArrowDown}1')
    // Typing on Riley's row when it fails, so the failure is listed and marked, not jumped to.
    await act(async () => fail?.(new Error('The server is down')))
    expect(screen.getByText('Olivia Chen').closest('tr')).toHaveAttribute('data-marked', 'true')
    expect(screen.getByText('Riley Sam').closest('tr')).not.toHaveAttribute('data-marked')
  })

  it("forgets a failed row the read no longer has, so it can't block every later leave (build ruling 2)", async () => {
    let fail: ((error: Error) => void) | undefined
    keyAsk.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject: (error: Error) => void) => {
          fail = reject
        })
    )
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300{ArrowDown}1')
    await act(async () => fail?.(new Error('The server is down')))
    expect(screen.getByText(/Couldn't save Olivia Chen's Round 2 ask/)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    // The next refetch no longer has Olivia's request (cancelled elsewhere, say).
    grid = {
      ...grid,
      data: { ...LIVE, rows: LIVE.rows.filter((r) => r.request_id !== 'reqolivia000003') },
    }
    await userEvent.click(sessionCell('Emma Johnson'))
    expect(screen.queryByText(/Couldn't save/)).toBeNull()
    await userEvent.click(screen.getByRole('link', { name: 'Ana Garcia' }))
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000003')
    )
  })

  it('opens no editor without casework: the row only highlights', async () => {
    granted = ['financial_aid.view']
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    expect(screen.queryByLabelText('Round 2 ask')).toBeNull()
    expect(screen.getByText('Olivia Chen').closest('tr')).toHaveAttribute(
      'data-highlighted',
      'true'
    )
  })

  it('lets staff dismiss a refusal on a row that can no longer be keyed, and every exit works again (C1)', async () => {
    keyAsk.mockImplementationOnce(() => {
      // Meanwhile Round 2 was posted elsewhere: the refetch has the row un-keyable.
      grid = {
        ...grid,
        data: {
          ...LIVE,
          rows: LIVE.rows.map((r) =>
            r.request_id === 'reqolivia000003'
              ? {
                  ...r,
                  rounds: [...r.rounds.slice(0, 1), roundOut(2, 'posted', { ask: 1300 })],
                  // The read says so too (#2997): the row carries the write's refusal.
                  appeal_refusal: R2_POSTED,
                }
              : r
          ),
        },
      }
      return Promise.reject(new Error("Round 2 is posted; its ask can't change"))
    })
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300{ArrowDown}')
    const dismiss = await screen.findByRole('button', { name: 'Dismiss' })
    expect(screen.queryByLabelText('Round 2 ask')).toBeNull()
    await userEvent.click(dismiss)
    expect(screen.queryByText(/Couldn't save/)).toBeNull()
    await userEvent.click(viewLink('Appeals'))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('lens=appeals'))
    await userEvent.click(screen.getByRole('link', { name: 'David Chen' }))
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000005')
    )
  })

  it('goes back to a failed row a filter now hides, on All, keeping Show IDs (I2, M5)', async () => {
    let fail: ((error: Error) => void) | undefined
    keyAsk.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject: (error: Error) => void) => {
          fail = reject
        })
    )
    renderAt('/aid/requests?pool=pool_a&ids=1')
    await userEvent.click(sessionCell('Samuel Johnson'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '1300')
    await userEvent.click(sessionCell('Riley Sam'))
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '1')
    // A refetch moves Samuel out of pool A while his save is refused.
    grid = {
      ...grid,
      data: {
        ...LIVE,
        rows: LIVE.rows.map((r) =>
          r.request_id === 'reqsamuel000005' ? { ...r, pool: 'pool_b' } : r
        ),
      },
    }
    await act(async () => fail?.(new Error('The server is down')))
    expect(screen.queryByText('Samuel Johnson')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Go Back' }))
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('row=reqsamuel000005')
    )
    expect(screen.getByTestId('where')).not.toHaveTextContent('pool=')
    // All is the absence of a view param: Go Back clears the view, it never writes view=all.
    expect(screen.getByTestId('where')).not.toHaveTextContent('view=')
    expect(screen.getByTestId('where')).toHaveTextContent('ids=1')
    expect(screen.getByText('Samuel Johnson')).toBeInTheDocument()
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1300')
    // Saved, the failure clears and the exits work.
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByText(/Couldn't save/)).toBeNull())
    await userEvent.click(
      within(screen.getByText('Samuel Johnson').closest('tr') as HTMLElement).getByRole('link', {
        name: 'Sarah Johnson',
      })
    )
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000001')
    )
  })

  it('goes back to a failed row that is still on screen, with its typed amount (regression guard)', async () => {
    let fail: ((error: Error) => void) | undefined
    keyAsk.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject: (error: Error) => void) => {
          fail = reject
        })
    )
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300{ArrowDown}1')
    await act(async () => fail?.(new Error('The server is down')))
    await userEvent.click(screen.getByRole('button', { name: 'Go Back' }))
    expect(screen.getByTestId('where')).toHaveTextContent('row=reqolivia000003')
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1300')
  })

  it('goes back to a failed row the walk jumped back to and a refetch now hides (I1)', async () => {
    keyAsk.mockImplementationOnce(() => {
      // The refusal comes with a change that moves Samuel out of pool A.
      grid = {
        ...grid,
        data: {
          ...LIVE,
          rows: LIVE.rows.map((r) =>
            r.request_id === 'reqsamuel000005' ? { ...r, pool: 'pool_b' } : r
          ),
        },
      }
      return Promise.reject(new Error('The server is down'))
    })
    renderAt('/aid/requests?pool=pool_a')
    await userEvent.click(sessionCell('Samuel Johnson'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300{ArrowDown}')
    // Ruling A put the highlight back on Samuel, who a filter now hides.
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('row=reqsamuel000005')
    )
    expect(screen.queryByText('Samuel Johnson')).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: 'Go Back' }))
    await waitFor(() => expect(screen.getByTestId('where')).not.toHaveTextContent('pool='))
    expect(screen.getByTestId('where')).toHaveTextContent('row=reqsamuel000005')
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1300')
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByText(/Couldn't save/)).toBeNull())
    await userEvent.click(
      within(screen.getByText('Samuel Johnson').closest('tr') as HTMLElement).getByRole('link', {
        name: 'Sarah Johnson',
      })
    )
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000001')
    )
  })

  it('dismisses one of two listed failures and leaves the other (re-review nit)', async () => {
    const fails: Array<(error: Error) => void> = []
    const hold = () =>
      new Promise<never>((_resolve, reject: (error: Error) => void) => {
        fails.push(reject)
      })
    keyAsk.mockImplementationOnce(hold).mockImplementationOnce(hold)
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '1300')
    await userEvent.click(sessionCell('Samuel Johnson'))
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '1400')
    await userEvent.click(sessionCell('Riley Sam'))
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '1')
    // Both asks were posted elsewhere meanwhile: neither row can be keyed any more.
    grid = {
      ...grid,
      data: {
        ...LIVE,
        rows: LIVE.rows.map((r) =>
          r.request_id === 'reqolivia000003' || r.request_id === 'reqsamuel000005'
            ? {
                ...r,
                rounds: [...r.rounds.slice(0, 1), roundOut(2, 'posted', { ask: 900 })],
                // The read says so too (#2997): the row carries the write's refusal.
                appeal_refusal: R2_POSTED,
              }
            : r
        ),
      },
    }
    await act(async () => fails[0]?.(new Error('Round 2 is posted')))
    await act(async () => fails[1]?.(new Error('Round 2 is posted')))
    // §5–6: one status slot and one Go Back (to the first failure), the rest counted.
    expect(screen.getAllByRole('button', { name: 'Go Back' })).toHaveLength(1)
    expect(screen.getByText(/\(\+1 more\)$/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Go Back' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(screen.getAllByRole('button', { name: 'Go Back' })).toHaveLength(1)
    expect(screen.queryByText(/\(\+1 more\)$/)).toBeNull()
  })

  describe('an entry typed on a row whose editor a refetch takes away (I2)', () => {
    const olivia2Posted = () => {
      grid = {
        ...grid,
        data: {
          ...LIVE,
          rows: LIVE.rows.map((r) =>
            r.request_id === 'reqolivia000003'
              ? {
                  ...r,
                  rounds: [...r.rounds.slice(0, 1), roundOut(2, 'posted', { ask: 900 })],
                  // The read says so too (#2997): the row carries the write's refusal.
                  appeal_refusal: R2_POSTED,
                }
              : r
          ),
        },
      }
    }

    it('lets staff move on when what was typed could never be saved', async () => {
      renderAt('/aid/requests')
      await userEvent.click(sessionCell('Olivia Chen'))
      await userEvent.clear(screen.getByLabelText('Round 2 ask'))
      await userEvent.type(screen.getByLabelText('Round 2 ask'), '12,50')
      olivia2Posted()
      await refetch()
      expect(screen.queryByLabelText('Round 2 ask')).toBeNull()
      await userEvent.click(sessionCell('Emma Johnson'))
      expect(screen.getByTestId('where')).toHaveTextContent('row=reqemma00000001')
      await userEvent.click(screen.getByRole('link', { name: 'Ana Garcia' }))
      await waitFor(() =>
        expect(screen.getByTestId('where')).toHaveTextContent('/aid/households/1000003')
      )
    })

    it('still saves first, then moves, when what was typed could be saved (rulings B, F2-4; regression guard)', async () => {
      renderAt('/aid/requests')
      await userEvent.click(sessionCell('Olivia Chen'))
      await userEvent.clear(screen.getByLabelText('Round 2 ask'))
      await userEvent.type(screen.getByLabelText('Round 2 ask'), '1300')
      olivia2Posted()
      await refetch()
      await userEvent.click(sessionCell('Emma Johnson'))
      expect(keyAsk).toHaveBeenCalledWith({
        requestId: 'reqolivia000003',
        body: { round: 2, amount: 1300, asked_on: '2027-04-01', note: 'Family emailed (Apr 1)' },
      })
      expect(screen.getByTestId('where')).toHaveTextContent('row=reqemma00000001')
    })
  })
})

describe('ticks (§4.10, §5.2)', () => {
  beforeEach(() => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    tickAccepted.mockReset()
    // Riley stands in for a second checkable family here: its fixture's CampMinder cancellation
    // would refuse the check since #3023 (any cancellation), so these bulk tests drop it.
    grid = { data: OPEN_RILEY, isLoading: false, error: null }
  })

  async function selectCampers(...campers: string[]) {
    for (const camper of campers) {
      const row = screen.getByText(camper).closest('tr') as HTMLElement
      await userEvent.click(within(row).getByRole('checkbox', { name: 'Select' }))
    }
  }
  const selectBoth = () => selectCampers('Samuel Johnson', 'Riley Sam')

  it('offers Check Accepted on the bar and no Check Posted: Posted is exception-only', async () => {
    renderAt('/aid/requests')
    await selectBoth()
    expect(screen.getByRole('button', { name: 'Check Accepted…' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Posted…/ })).toBeNull()
  })

  it('renders no Posted button on Needs an offer rows', () => {
    renderAt('/aid/requests?view=needs-offer')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(inRows().queryByRole('button', { name: /^Posted/ })).toBeNull()
  })

  it('confirms a bulk Accepted tick on the selected rows', async () => {
    renderAt('/aid/requests')
    await selectBoth()
    expect(screen.getByText('2 checked')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Check Accepted…' }))
    expect(screen.getByText('Check Accepted on 2 requests · 2 families')).toBeInTheDocument()
  })

  it("ticks one row from the opened row's Check Accepted step through the same confirmation (Full GO)", async () => {
    renderAt('/aid/requests?view=waiting')
    const row = screen.getByText('Samuel Johnson').closest('tr') as HTMLElement
    await userEvent.click(within(row).getAllByRole('cell')[2] as HTMLElement)
    const detail = document.querySelector('[data-aid-detail]') as HTMLElement
    await userEvent.click(within(detail).getByRole('button', { name: 'Check Accepted' }))
    expect(screen.getByText('Check Accepted on 1 request · 1 family')).toBeInTheDocument()
  })

  it("ticks one row from Waiting on the family's Tick column through the same confirmation", async () => {
    renderAt('/aid/requests?view=waiting')
    await userEvent.click(inRows().getByRole('button', { name: 'Accepted' }))
    expect(screen.getByText('Check Accepted on 1 request · 1 family')).toBeInTheDocument()
  })

  it('offers no selection and no Tick column without casework', () => {
    granted = ['financial_aid.view']
    renderAt('/aid/requests?view=waiting')
    expect(screen.queryByRole('checkbox', { name: 'Select all' })).toBeNull()
    expect(inRows().queryByRole('button', { name: 'Accepted' })).toBeNull()
  })

  it('computes the confirmation at the click: a refetch afterwards does not rewrite it', async () => {
    renderAt('/aid/requests?view=waiting')
    await userEvent.click(inRows().getByRole('button', { name: 'Accepted' }))
    grid = {
      data: {
        ...LIVE,
        rows: GRID_ROWS.map((r) =>
          r.request_id === 'reqsamuel000005'
            ? { ...r, rounds: r.rounds.map((round) => ({ ...round, accepted: true })) }
            : r
        ),
      },
      isLoading: false,
      error: null,
    }
    await refetch()
    expect(screen.getByText('Check Accepted on 1 request · 1 family')).toBeInTheDocument()
  })

  it('writes the Accepted tick end to end, lists exactly what was ticked, and keeps the selection of rows it did not tick', async () => {
    tickAccepted.mockResolvedValue({ year: 2027, written: 2, unchanged: 0, operation_id: 'op1' })
    renderAt('/aid/requests')
    await selectCampers('Samuel Johnson', 'Riley Sam', 'Liam Garcia')
    await userEvent.click(screen.getByRole('button', { name: 'Check Accepted…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(tickAccepted).toHaveBeenCalledWith({
      year: 2027,
      body: {
        rows: [
          { request_id: 'reqsamuel000005', round: 1 },
          { request_id: 'reqriley0000004', round: 1 },
        ],
        accepted: true,
      },
    })
    expect(await screen.findByText(/Checked Accepted on 2 requests/)).toBeInTheDocument()
    expect(screen.getByText(/Samuel Johnson R1/)).toBeInTheDocument()
    expect(screen.getByText(/Riley Sam R1/)).toBeInTheDocument()
    expect(screen.queryByText('Check Accepted on 2 requests · 2 families')).toBeNull()
    // Liam had nothing to tick, so he stays selected for the next action.
    expect(screen.getByText(/· 1 still checked$/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check Accepted…' })).toBeInTheDocument()
  })

  it('says so when the server found some already ticked: the list is what was sent, not what was ticked (M1)', async () => {
    tickAccepted.mockResolvedValue({ year: 2027, written: 1, unchanged: 1, operation_id: 'op1' })
    renderAt('/aid/requests')
    await selectBoth()
    await userEvent.click(screen.getByRole('button', { name: 'Check Accepted…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText(/\(1 was already checked\)\. Sent: /)).toBeInTheDocument()
  })

  describe('a tick on the row being edited (review I2; F2-4)', () => {
    const sessionCell = (camper: string) =>
      within(screen.getByText(camper).closest('tr') as HTMLElement).getAllByRole(
        'cell'
      )[2] as HTMLElement
    const typeAppeal = async () => {
      renderAt('/aid/requests?view=needs-offer')
      await userEvent.click(
        screen.getByText('Olivia Chen').closest('tr')?.querySelectorAll('td')[3] as HTMLElement
      )
      await userEvent.clear(screen.getByLabelText('Round 2 ask'))
      await userEvent.type(screen.getByLabelText('Round 2 ask'), '1300')
    }
    // A selection survives a view change, so Samuel is picked on All and Olivia is edited on Needs an offer.
    const typeAppealWithSamuelSelected = async () => {
      renderAt('/aid/requests')
      await selectCampers('Samuel Johnson')
      await userEvent.click(viewLink('Needs an offer'))
      await userEvent.click(
        screen.getByText('Olivia Chen').closest('tr')?.querySelectorAll('td')[3] as HTMLElement
      )
      await userEvent.clear(screen.getByLabelText('Round 2 ask'))
      await userEvent.type(screen.getByLabelText('Round 2 ask'), '1300')
    }

    // Owner sitting A, A18: the bar's own Tick button is an exit like the row's, so it saves first too.
    it('saves the typed ask first when the tick comes from the selection bar, and the dialog shows it', async () => {
      await typeAppealWithSamuelSelected()
      await userEvent.click(screen.getByRole('button', { name: 'Check Accepted…' }))
      expect(keyAsk).toHaveBeenCalledTimes(1)
      expect(await screen.findByText('Check Accepted on 1 request · 1 family')).toBeInTheDocument()
    })

    it('saves the typed ask first when the tick comes from a row, and only then opens it', async () => {
      renderAt('/aid/requests?view=waiting')
      await userEvent.click(sessionCell('Samuel Johnson'))
      await userEvent.clear(screen.getByLabelText('Round 2 ask'))
      await userEvent.type(screen.getByLabelText('Round 2 ask'), '1300')
      await userEvent.click(inRows().getByRole('button', { name: 'Accepted' }))
      expect(keyAsk).toHaveBeenCalledTimes(1)
      expect(await screen.findByText('Check Accepted on 1 request · 1 family')).toBeInTheDocument()
    })

    // Owner sitting A, A18: toggling a row's checkbox is an exit like ↓, so what is typed is saved
    // first, before any dialog, and the row shows the saved figures.
    it('saves the typed ask when a row checkbox is toggled, before any dialog, and refreshes the row', async () => {
      keyAsk.mockImplementationOnce(() => {
        grid = {
          data: {
            ...LIVE,
            rows: GRID_ROWS.map((r) =>
              r.request_id === 'reqolivia000003'
                ? {
                    ...r,
                    rounds: [
                      r.rounds[0] as ApiAidRound,
                      roundOut(2, 'needs_offer', { ask: 1300, decided: 1040 }),
                    ],
                  }
                : r
            ),
          },
          isLoading: false,
          error: null,
        }
        return Promise.resolve({
          year: 2027,
          written: 1,
          unchanged: 0,
          operation_id: 'op0000000000001',
        })
      })
      await typeAppeal()
      const row = screen.getByText('Olivia Chen').closest('tr') as HTMLElement
      await userEvent.click(within(row).getByRole('checkbox', { name: 'Select' }))
      expect(keyAsk).toHaveBeenCalledTimes(1)
      expect(screen.queryByText(/^Check Accepted on/)).toBeNull()
      expect(await screen.findByText('1 checked')).toBeInTheDocument()
      expect(
        within(screen.getByText('Olivia Chen').closest('tr') as HTMLElement).getAllByText('$1,040')
          .length
      ).toBeGreaterThan(0)
    })

    it("keeps the row unticked and lists the failure when the checkbox's save fails", async () => {
      keyAsk.mockImplementationOnce(() => Promise.reject(new Error('The server is down')))
      await typeAppeal()
      const row = screen.getByText('Olivia Chen').closest('tr') as HTMLElement
      await userEvent.click(within(row).getByRole('checkbox', { name: 'Select' }))
      expect(await screen.findByText(/Couldn't save Olivia Chen's Round 2 ask/)).toBeInTheDocument()
      expect(screen.queryByText('1 checked')).toBeNull()
    })

    // CodeRabbit on #3111: Clear changes the selection like a checkbox, so it is an exit too (A18).
    it('saves the typed ask first when the selection is cleared', async () => {
      await typeAppealWithSamuelSelected()
      await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
      expect(keyAsk).toHaveBeenCalledTimes(1)
      expect(screen.queryByText(/checked/)).toBeNull()
    })

    it('opens nothing when that save fails, and the failure stays listed', async () => {
      keyAsk.mockImplementationOnce(() => Promise.reject(new Error('The server is down')))
      await typeAppealWithSamuelSelected()
      await userEvent.click(screen.getByRole('button', { name: 'Check Accepted…' }))
      expect(await screen.findByText(/Couldn't save Olivia Chen's Round 2 ask/)).toBeInTheDocument()
      expect(screen.queryByText(/^Check Accepted on/)).toBeNull()
      expect(tickAccepted).not.toHaveBeenCalled()
    })
  })

  describe('ticks persist when rows leave the screen (owner ruling 2026-10-02)', () => {
    it('keeps a tick through a search, counts it on the bar, and lists it in the dialog, marked', async () => {
      renderAt('/aid/requests')
      await selectBoth()
      await userEvent.type(screen.getByLabelText('Search'), 'Riley')
      expect(screen.getByText('2 checked · 1 hidden')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Check Accepted…' }))
      expect(screen.getByText('Check Accepted on 2 requests · 2 families')).toBeInTheDocument()
      expect(
        screen.getByText(/Samuel Johnson · Round 1 \(hidden by the search or filters\)/)
      ).toBeInTheDocument()
    })

    it('counts a tick hidden by the search AND a filter once', async () => {
      renderAt('/aid/requests')
      await selectCampers('Samuel Johnson', 'Olivia Chen')
      await pickProgram('Quests')
      // Samuel is now hidden by the filter; the search below hides him too.
      await userEvent.type(screen.getByLabelText('Search'), 'Olivia')
      expect(screen.getByText('2 checked · 1 hidden')).toBeInTheDocument()
    })

    it('keeps a tick through a filter change', async () => {
      renderAt('/aid/requests')
      await selectCampers('Samuel Johnson', 'Olivia Chen')
      await pickProgram('Quests')
      expect(screen.getByText('2 checked · 1 hidden')).toBeInTheDocument()
    })

    it("keeps a tick through a view change: the bar's action is chosen at the bar, not by the view", async () => {
      renderAt('/aid/requests')
      const samuel = screen.getByText('Samuel Johnson').closest('tr') as HTMLElement
      await userEvent.click(within(samuel).getByRole('checkbox', { name: 'Select' }))
      await userEvent.click(viewLink('Needs an offer'))
      expect(screen.getByText('1 checked · 1 hidden')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Check Accepted…' }))
      expect(screen.getByText('Check Accepted on 1 request · 1 family')).toBeInTheDocument()
    })
  })
})

// #2996 hand tick: "Mark Posted" in a Not reconciled row's opened line is the existing Posted write.
describe('Mark Posted on a Not reconciled row (#2996)', () => {
  beforeEach(() => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    tickPosted.mockClear()
  })

  it('writes the Posted tick for that round at its decided amount', async () => {
    const refused = {
      ...GRID_ROWS[0]!,
      request_id: 'reqrefused00001',
      rounds: [roundOut(1, 'needs_offer', { decided: 1500 })],
      unticked: [
        {
          round: 1,
          code: 'short_posting' as const,
          label: 'Short in CM',
          message: 'A sentence from the server.',
          mark_posted: true,
        },
      ],
      queues: ['not_reconciled' as const],
    }
    grid = { data: { ...LIVE, rows: [refused] }, isLoading: false, error: null }
    renderAt('/aid/requests?view=not-reconciled')
    const row = screen.getByText('Emma Johnson').closest('tr') as HTMLElement
    await userEvent.click(within(row).getAllByRole('cell')[2] as HTMLElement)
    const detail = document.querySelector('[data-aid-detail]') as HTMLElement
    await userEvent.click(
      within(detail).getByRole('button', { name: 'Mark Posted · locks $1,500' })
    )
    expect(tickPosted).toHaveBeenCalledWith({
      year: 2027,
      body: { rows: [{ request_id: 'reqrefused00001', round: 1, amount: 1500 }] },
    })
  })
})

// Owner ruling C (10-06): the grid's "Money to place" opens To place, filtered to the family.
describe('"Money to place" on a Not reconciled row (ruling C)', () => {
  it('links to To place for the family, keeping the season', async () => {
    const money = {
      ...gridRow({ request_id: 'reqmoney0000001' }),
      unticked: [
        {
          round: 1,
          code: 'family_level' as const,
          label: 'Money to place',
          message: 'A sentence from the server.',
          mark_posted: false,
        },
      ],
      queues: ['not_reconciled' as const],
    }
    grid = { data: { ...LIVE, rows: [money] }, isLoading: false, error: null }
    renderAt('/aid/requests?view=not-reconciled')
    const row = screen.getByText('Emma Johnson').closest('tr') as HTMLElement
    await userEvent.click(within(row).getAllByRole('cell')[2] as HTMLElement)
    const detail = document.querySelector('[data-aid-detail]') as HTMLElement
    expect(
      within(detail).getByRole('link', { name: 'Place It in Money › To Place ›' })
    ).toHaveAttribute('href', '/aid/money/to-place?household=1000001&year=2027')
  })
})

describe('the March file in the Download CSV menu (slice 3 rework R1; variant A)', () => {
  const marchItem = () => screen.queryByRole('button', { name: 'March file 2027' })
  const caret = () => screen.queryByRole('button', { name: 'More downloads' })

  it('puts a caret after Download CSV and the March item in its menu, on Needs an offer with R1 lit, for casework', async () => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    renderAt('/aid/requests?view=needs-offer&round=1')
    expect(marchItem()).toBeNull()
    await userEvent.click(caret() as HTMLElement)
    expect(marchItem()).not.toBeNull()
    expect(within(toolbar()).queryByRole('button', { name: 'March file 2027' })).not.toBeNull()
  })

  it('is a plain Download CSV without the R1 chip, on another round, or on another view', () => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    const { unmount } = renderAt('/aid/requests?view=needs-offer')
    expect(caret()).toBeNull()
    unmount()
    const second = renderAt('/aid/requests?view=needs-offer&round=2')
    expect(caret()).toBeNull()
    second.unmount()
    renderAt('/aid/requests?round=1')
    expect(caret()).toBeNull()
  })

  it('is a plain Download CSV without casework, and on a past date', () => {
    granted = ['financial_aid.view']
    const { unmount } = renderAt('/aid/requests?view=needs-offer&round=1')
    expect(caret()).toBeNull()
    unmount()
    granted = ['financial_aid.view', 'financial_aid.casework']
    grid = { data: { ...LIVE, as_of: '2027-03-01' }, isLoading: false, error: null }
    renderAt('/aid/requests?view=needs-offer&round=1&as_of=2027-03-01')
    expect(caret()).toBeNull()
  })

  it('puts the March File result in the toolbar’s status slot, only where the split control is (§6)', () => {
    granted = ['financial_aid.view', 'financial_aid.casework']
    const { unmount } = renderAt('/aid/requests?view=needs-offer&round=1')
    expect(screen.getByText('March result 2027')).toBeInTheDocument()
    unmount()
    renderAt('/aid/requests?view=needs-offer&round=2')
    expect(screen.queryByText('March result 2027')).toBeNull()
  })
})
