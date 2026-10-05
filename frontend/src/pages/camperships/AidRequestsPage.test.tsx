import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { APPROVED_RULES_2026 } from '../../components/camperships/requests/approvedRulesFixtures'
import {
  APPEAL_REFUSAL_R1,
  GRID_ROWS,
  roundOut,
} from '../../components/camperships/requests/gridFixtures'
import type { ApiAidApprovedRules, ApiAidGrid, ApiAidRound } from '../../types/api-types'
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
vi.mock('../../components/camperships/shell/AidDefinitionNotes', () => ({
  AidDefinitionNotes: () => null,
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

const openProgram = () => userEvent.click(screen.getByLabelText('Program'))
const pickProgram = async (name: string) => {
  await openProgram()
  await userEvent.click(await screen.findByRole('option', { name }))
}

const viewLink = (label: string) => screen.getByRole('link', { name: new RegExp(`^${label} `) })

beforeEach(() => {
  approved = { data: APPROVED_RULES_2026 }
  keyAsk.mockClear()
  grid = { data: LIVE, isLoading: false, error: null }
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
    expect(viewLink('Holds')).toHaveTextContent('Holds 1')
    expect(viewLink('Holds')).toHaveAttribute('href', '/aid/requests?view=holds&year=2027')
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
    expect(viewLink('Holds')).toHaveTextContent('Holds —')
    unmount()
    renderAt('/aid/requests?as_of=2027-03-01')
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
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
    expect(screen.getByRole('option', { name: 'Weekend Programs' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Pool B' })).toBeNull()
    // The list is already open: a second click on the button would close it mid-pick (flaky under load).
    await userEvent.click(screen.getByRole('option', { name: 'Quest' }))
    expect(screen.getByTestId('where')).toHaveTextContent('program=quest')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Emma Johnson')).toBeNull()
  })

  it('narrows to a pool by its heading, clearing the program, and back (T6)', async () => {
    renderAt('/aid/requests?program=summer')
    await pickProgram('Weekend Programs')
    expect(screen.getByTestId('where')).toHaveTextContent('pool=pool_b')
    expect(screen.getByTestId('where')).not.toHaveTextContent('program=')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.queryByText('Emma Johnson')).toBeNull()
    await pickProgram('Summer')
    expect(screen.getByTestId('where')).toHaveTextContent('program=summer')
    expect(screen.getByTestId('where')).not.toHaveTextContent('pool=')
  })

  it("names the programs with the server's labels, not by their rules keys", async () => {
    renderAt('/aid/requests')
    await openProgram()
    expect(screen.getByRole('option', { name: 'Summer' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'summer' })).toBeNull()
    expect(screen.queryByRole('option', { name: 'Summer camp' })).toBeNull()
    // The rules do not name Quest: its key spelled out.
    expect(screen.getByRole('option', { name: 'Quest' })).toBeInTheDocument()
  })

  it("shows a label the key could not spell: the server's Women's weekend, not Womens weekend", async () => {
    grid = {
      data: { ...LIVE, rows: [...GRID_ROWS, { ...GRID_ROWS[0]!, program_key: 'womens_weekend' }] },
      isLoading: false,
      error: null,
    }
    renderAt('/aid/requests')
    await openProgram()
    expect(screen.getByRole('option', { name: "Women's weekend" })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Womens weekend' })).toBeNull()
  })

  it('spells the keys out when the rules read has no answer (404, loading, failed), and still filters', async () => {
    approved = { data: undefined }
    renderAt('/aid/requests')
    await openProgram()
    expect(screen.getByRole('option', { name: 'Summer' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Pool b' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: 'Quest' }))
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
      screen.getByLabelText('Program'),
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
    expect(line.lastElementChild).toBe(screen.getByRole('button', { name: 'Download CSV' }))
    expect(screen.queryByRole('button', { name: '⤓ CSV' })).toBeNull()
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

  it("says on Needs an offer that a split request posts per household (⚠ Decision 39's interim)", () => {
    renderAt('/aid/requests?view=needs-offer')
    expect(screen.getByText(/posts one amount per household/)).toBeInTheDocument()
  })

  it('shows the split-request line on Needs an offer only', () => {
    renderAt('/aid/requests?view=holds')
    expect(screen.queryByText(/posts one amount per household/)).toBeNull()
  })

  it('says on Waiting on the family that Posted is this round, not yet accepted (owner ruling I2)', () => {
    renderAt('/aid/requests?view=waiting')
    expect(screen.getByText(/posted in this round, not yet accepted/)).toBeInTheDocument()
  })

  it('shows the Posted note on Waiting on the family only', () => {
    renderAt('/aid/requests?view=holds')
    expect(screen.queryByText(/posted in this round, not yet accepted/)).toBeNull()
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
    expect(screen.queryByRole('link', { name: /^Holds / })).toBeNull()
    expect(headers()).toContain('Appeal ask')
    expect(screen.getByText('Showing appeals only.')).toBeInTheDocument()
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

  it('opens the editor inside the detail line, beside its text, with no household caption of its own', async () => {
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
    expect(
      screen.getByText("Couldn't save Olivia Chen's Round 2 ask: The server is down")
    ).toBeInTheDocument()
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
    await pickProgram('Quest')
    expect(keyAsk).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('program=quest'))
  })

  it("won't move for a filter while what is typed can't be saved yet, and says why once", async () => {
    renderAt('/aid/requests')
    await userEvent.click(sessionCell('Olivia Chen'))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.type(screen.getByLabelText('Round 2 ask'), '12,50')
    await pickProgram('Quest')
    expect(screen.getByTestId('where')).not.toHaveTextContent('program=quest')
    expect(screen.getAllByText('Not an amount')).toHaveLength(1)
    expect(keyAsk).not.toHaveBeenCalled()
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
    expect(screen.getAllByRole('button', { name: 'Go Back' })).toHaveLength(2)
    await userEvent.click(screen.getAllByRole('button', { name: 'Go Back' })[1] as HTMLElement)
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    expect(screen.getAllByRole('button', { name: 'Go Back' })).toHaveLength(1)
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
  })

  async function selectCampers(...campers: string[]) {
    for (const camper of campers) {
      const row = screen.getByText(camper).closest('tr') as HTMLElement
      await userEvent.click(within(row).getByRole('checkbox', { name: 'Select' }))
    }
  }
  const selectBoth = () => selectCampers('Samuel Johnson', 'Riley Sam')

  it('offers Tick Accepted on the bar and no Tick Posted: Posted is exception-only', async () => {
    renderAt('/aid/requests')
    await selectBoth()
    expect(screen.getByRole('button', { name: 'Tick Accepted…' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tick Posted…' })).toBeNull()
  })

  it('renders no Posted button on Needs an offer rows', () => {
    renderAt('/aid/requests?view=needs-offer')
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(inRows().queryByRole('button', { name: /^Posted/ })).toBeNull()
  })

  it('confirms a bulk Accepted tick on the selected rows', async () => {
    renderAt('/aid/requests')
    await selectBoth()
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tick Accepted…' }))
    expect(screen.getByText('Tick Accepted on 2 requests · 2 families')).toBeInTheDocument()
  })

  it("ticks one row from the opened row's Tick Accepted step through the same confirmation (Full GO)", async () => {
    renderAt('/aid/requests?view=waiting')
    const row = screen.getByText('Samuel Johnson').closest('tr') as HTMLElement
    await userEvent.click(within(row).getAllByRole('cell')[2] as HTMLElement)
    const detail = document.querySelector('[data-aid-detail]') as HTMLElement
    await userEvent.click(within(detail).getByRole('button', { name: 'Tick Accepted' }))
    expect(screen.getByText('Tick Accepted on 1 request · 1 family')).toBeInTheDocument()
  })

  it("ticks one row from Waiting on the family's Tick column through the same confirmation", async () => {
    renderAt('/aid/requests?view=waiting')
    await userEvent.click(inRows().getByRole('button', { name: 'Accepted' }))
    expect(screen.getByText('Tick Accepted on 1 request · 1 family')).toBeInTheDocument()
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
    expect(screen.getByText('Tick Accepted on 1 request · 1 family')).toBeInTheDocument()
  })

  it('writes the Accepted tick end to end, lists exactly what was ticked, and keeps the selection of rows it did not tick', async () => {
    tickAccepted.mockResolvedValue({ year: 2027, written: 2, unchanged: 0, operation_id: 'op1' })
    renderAt('/aid/requests')
    await selectCampers('Samuel Johnson', 'Riley Sam', 'Liam Garcia')
    await userEvent.click(screen.getByRole('button', { name: 'Tick Accepted…' }))
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
    expect(await screen.findByText(/Ticked Accepted on 2 requests/)).toBeInTheDocument()
    expect(screen.getByText(/Samuel Johnson R1/)).toBeInTheDocument()
    expect(screen.getByText(/Riley Sam R1/)).toBeInTheDocument()
    expect(screen.queryByText('Tick Accepted on 2 requests · 2 families')).toBeNull()
    // Liam had nothing to tick, so he stays selected for the next action.
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('says so when the server found some already ticked: the list is what was sent, not what was ticked (M1)', async () => {
    tickAccepted.mockResolvedValue({ year: 2027, written: 1, unchanged: 1, operation_id: 'op1' })
    renderAt('/aid/requests')
    await selectBoth()
    await userEvent.click(screen.getByRole('button', { name: 'Tick Accepted…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText(/\(1 was already ticked\)\. Sent: /)).toBeInTheDocument()
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
      await userEvent.click(screen.getByRole('button', { name: 'Tick Accepted…' }))
      expect(keyAsk).toHaveBeenCalledTimes(1)
      expect(await screen.findByText('Tick Accepted on 1 request · 1 family')).toBeInTheDocument()
    })

    it('saves the typed ask first when the tick comes from a row, and only then opens it', async () => {
      renderAt('/aid/requests?view=waiting')
      await userEvent.click(sessionCell('Samuel Johnson'))
      await userEvent.clear(screen.getByLabelText('Round 2 ask'))
      await userEvent.type(screen.getByLabelText('Round 2 ask'), '1300')
      await userEvent.click(inRows().getByRole('button', { name: 'Accepted' }))
      expect(keyAsk).toHaveBeenCalledTimes(1)
      expect(await screen.findByText('Tick Accepted on 1 request · 1 family')).toBeInTheDocument()
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
      expect(screen.queryByText(/^Tick Accepted on/)).toBeNull()
      expect(await screen.findByText('1 selected')).toBeInTheDocument()
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
      expect(screen.queryByText('1 selected')).toBeNull()
    })

    it('opens nothing when that save fails, and the failure stays listed', async () => {
      keyAsk.mockImplementationOnce(() => Promise.reject(new Error('The server is down')))
      await typeAppealWithSamuelSelected()
      await userEvent.click(screen.getByRole('button', { name: 'Tick Accepted…' }))
      expect(await screen.findByText(/Couldn't save Olivia Chen's Round 2 ask/)).toBeInTheDocument()
      expect(screen.queryByText(/^Tick Accepted on/)).toBeNull()
      expect(tickAccepted).not.toHaveBeenCalled()
    })
  })

  describe('ticks persist when rows leave the screen (owner ruling 2026-10-02)', () => {
    it('keeps a tick through a search, counts it on the bar, and lists it in the dialog, marked', async () => {
      renderAt('/aid/requests')
      await selectBoth()
      await userEvent.type(screen.getByLabelText('Search'), 'Riley')
      expect(screen.getByText('2 selected · 1 hidden by the search or filters')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Tick Accepted…' }))
      expect(screen.getByText('Tick Accepted on 2 requests · 2 families')).toBeInTheDocument()
      expect(
        screen.getByText(/Samuel Johnson · Round 1 \(hidden by the search or filters\)/)
      ).toBeInTheDocument()
    })

    it('counts a tick hidden by the search AND a filter once', async () => {
      renderAt('/aid/requests')
      await selectCampers('Samuel Johnson', 'Olivia Chen')
      await pickProgram('Quest')
      // Samuel is now hidden by the filter; the search below hides him too.
      await userEvent.type(screen.getByLabelText('Search'), 'Olivia')
      expect(screen.getByText('2 selected · 1 hidden by the search or filters')).toBeInTheDocument()
    })

    it('keeps a tick through a filter change', async () => {
      renderAt('/aid/requests')
      await selectCampers('Samuel Johnson', 'Olivia Chen')
      await pickProgram('Quest')
      expect(screen.getByText('2 selected · 1 hidden by the search or filters')).toBeInTheDocument()
    })

    it("keeps a tick through a view change: the bar's action is chosen at the bar, not by the view", async () => {
      renderAt('/aid/requests')
      const samuel = screen.getByText('Samuel Johnson').closest('tr') as HTMLElement
      await userEvent.click(within(samuel).getByRole('checkbox', { name: 'Select' }))
      await userEvent.click(viewLink('Needs an offer'))
      expect(screen.getByText('1 selected · 1 hidden by the search or filters')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Tick Accepted…' }))
      expect(screen.getByText('Tick Accepted on 1 request · 1 family')).toBeInTheDocument()
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
