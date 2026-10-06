import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { gridRow, roundOut, ROW_EMMA, ROW_OLIVIA, ROW_RILEY } from '../requests/gridFixtures'
import { useEditorExits, type EditorExits } from './editorExits'
import { applicationOut, householdPage, householdRequest, requestOut } from './householdFixtures'
import type { DuplicateWaitingOut } from '../../../types/api-generated'
import { WorkingRequestCard } from './WorkingRequestCard'

const cancel = vi.fn()
const manual = vi.fn()
const ask = vi.fn()
const duplicate = vi.fn()
// When set, the duplicate write is refused with these words.
let duplicateRefusal: string | null = null
// #3031: the season's pending duplicates waiting on a request, by request id (the page's duplicates_waiting).
let waitingFor: Record<string, DuplicateWaitingOut[]> = {}
interface Call {
  onSuccess?: () => void
  onError?: (e: Error) => void
}
// 'auto' saves at once; 'manual' leaves the save pending until the test settles it.
let mode: 'auto' | 'manual' = 'auto'
let pending: Call[] = []
// Typed as plain functions: vitest 5's `Mock` type isn't callable under tsc.
function useFakeMutation(spy: (vars: unknown) => unknown) {
  const [state, setState] = useState<{ isPending: boolean; error: Error | null }>({
    isPending: false,
    error: null,
  })
  return {
    ...state,
    mutate: (vars: unknown, options?: Call) => {
      spy(vars)
      if (mode === 'auto') {
        options?.onSuccess?.()
        return
      }
      setState({ isPending: true, error: null })
      pending.push({
        onSuccess: () => {
          setState({ isPending: false, error: null })
          options?.onSuccess?.()
        },
        onError: (e) => {
          setState({ isPending: false, error: e })
          options?.onError?.(e)
        },
      })
    },
    mutateAsync: (vars: unknown) => {
      spy(vars)
      if (spy === duplicate && duplicateRefusal !== null) {
        return Promise.reject(new Error(duplicateRefusal))
      }
      return spy === cancel && cancelGate !== null ? cancelGate : Promise.resolve({})
    },
  }
}
const quiet = {
  isPending: false,
  error: null,
  mutate: vi.fn(),
  mutateAsync: vi.fn(() => Promise.resolve({})),
}
vi.mock('../../../hooks/camperships/useAidWrites', () => ({
  useAidCancellation: () => useFakeMutation(cancel),
  useAidManualHold: () => useFakeMutation(manual),
  useAidKeyAsk: () => useFakeMutation(ask),
  useAidHoldRelease: () => quiet,
  useAidTickPosted: () => quiet,
  useAidTickAccepted: () => quiet,
  useAidUndoPosted: () => quiet,
  useAidRound3Decision: () => quiet,
  useAidRound3Amount: () => quiet,
  useAidHouseholdShare: () => ({ ...quiet, mutateAsync: () => shareGate ?? Promise.resolve({}) }),
  useAidSessionResolve: () => ({ ...quiet, mutateAsync: () => resolveGate ?? Promise.resolve({}) }),
  useAidDuplicate: () => useFakeMutation(duplicate),
  useAidHeadcount: () => quiet,
  useAidCorrection: () => quiet,
}))
let application = applicationOut()
// What each application read asked for: [householdCmId, options].
const applicationRead = vi.fn()
vi.mock('../../../hooks/camperships/useAidApplication', () => ({
  useAidApplication: (...args: unknown[]) => {
    applicationRead(...args)
    return { data: application, isLoading: false, error: null }
  },
}))
let gridRows: Array<ReturnType<typeof gridRow>> = []
vi.mock('../../../hooks/camperships/useAidGrid', () => ({
  useAidGrid: () => ({ data: { rows: gridRows }, isLoading: false, error: null }),
}))
const prefetch = vi.fn()
vi.mock('../../../hooks/camperships/useAidEditorPreview', () => ({
  useAidEditorPreview: () => ({ preview: { status: 'idle' }, onAmountChange: () => undefined }),
  usePrefetchAidPreview: (...args: unknown[]) => {
    prefetch(...args)
  },
}))

const VIEW = { year: 2027, asOf: { kind: 'live' } as const }
const go = vi.fn()
// When set, the cancellation write stays pending until the test settles it.
let cancelGate: Promise<unknown> | null = null
// When set, Settle session's write stays pending until the test settles it.
let resolveGate: Promise<unknown> | null = null
// When set, Payer shares' write stays pending until the test settles it.
let shareGate: Promise<unknown> | null = null
let exitsSeen: EditorExits | null = null

const settle = () => {
  const call = pending.shift()
  act(() => call?.onSuccess?.())
}

function Cards({
  rows,
  canWork = true,
  canApprove = false,
}: {
  rows: Array<Parameters<typeof householdRequest>[0]>
  canWork?: boolean
  canApprove?: boolean
}) {
  const exits = useEditorExits()
  exitsSeen = exits
  const requests = rows.map((row) =>
    householdRequest(row, { duplicates_waiting: waitingFor[row.request_id] ?? [] })
  )
  const page = householdPage({ requests })
  return (
    <MemoryRouter>
      {requests.map((request) => (
        <WorkingRequestCard
          key={request.row.request_id}
          request={request}
          page={page}
          view={VIEW}
          canWork={canWork}
          canApprove={canApprove}
          exits={exits}
        />
      ))}
    </MemoryRouter>
  )
}

const renderCards = (rows = [ROW_OLIVIA], canWork = true, canApprove = false) =>
  render(<Cards rows={rows} canWork={canWork} canApprove={canApprove} />)

beforeEach(() => {
  cancel.mockReset()
  prefetch.mockReset()
  duplicate.mockReset()
  duplicateRefusal = null
  waitingFor = {}
  applicationRead.mockReset()
  application = applicationOut()
  gridRows = []
  cancelGate = null
  resolveGate = null
  shareGate = null
  manual.mockReset()
  ask.mockReset()
  go.mockReset()
  mode = 'auto'
  pending = []
  exitsSeen = null
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2027-04-09T18:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('WorkingRequestCard (§6.3, casework)', () => {
  it("offers the card's money edits and opens the editor in place", async () => {
    renderCards()
    await userEvent.click(screen.getByRole('button', { name: 'Edit the Appeal…' }))
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1200')
  })

  it('cancels a request with one of the nine reasons', async () => {
    renderCards([ROW_EMMA])
    await userEvent.click(screen.getByRole('button', { name: 'Cancel Request…' }))
    await userEvent.selectOptions(screen.getByLabelText('Cancel reason'), 'medical')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the Request' }))
    expect(cancel).toHaveBeenCalledWith({
      requestId: 'reqemma00000001',
      body: { cancelled: true, reason: 'medical', note: '' },
    })
  })

  it('will not cancel without a reason', async () => {
    renderCards([ROW_EMMA])
    await userEvent.click(screen.getByRole('button', { name: 'Cancel Request…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the Request' }))
    expect(cancel).not.toHaveBeenCalled()
    expect(screen.getByText('Pick a cancel reason')).toBeInTheDocument()
  })

  it('asks for the reason CampMinder’s cancellation lacks (D101)', () => {
    renderCards([ROW_RILEY])
    expect(screen.getByRole('button', { name: 'Give a Reason…' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel Request…' })).toBeNull()
  })

  it('offers a CampMinder cancellation only its reason, no money edit (B35)', () => {
    renderCards([ROW_RILEY])
    const offered = screen
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((text) => text.endsWith('…'))
    expect(offered).toEqual(['Give a Reason…'])
  })

  it('puts a request on hold by hand, with its reason', async () => {
    renderCards([ROW_EMMA])
    await userEvent.click(screen.getByRole('button', { name: 'Put on Hold…' }))
    await userEvent.type(screen.getByLabelText('Reason for the hold'), 'Waiting on a call{Enter}')
    expect(manual).toHaveBeenCalledWith({
      requestId: 'reqemma00000001',
      body: { held: true, note: 'Waiting on a call' },
    })
  })

  it('prefetches the preview its money editor would open on (R2)', () => {
    renderCards()
    expect(prefetch).toHaveBeenCalledWith('reqolivia000003', 2, 1200)
  })

  it('prefetches nothing without casework, which opens no editor (R2)', () => {
    renderCards([ROW_OLIVIA], false)
    expect(prefetch).toHaveBeenCalled()
    expect(prefetch.mock.calls.every((call) => (call as unknown[])[2] === null)).toBe(true)
  })

  it('offers nothing to change without casework: the plain card', () => {
    renderCards([ROW_OLIVIA], false)
    expect(screen.queryByRole('button', { name: 'Edit the Appeal…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel Request…' })).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })
})

const KINDRED_CANCELLED = gridRow({
  ...ROW_EMMA,
  cancellation: { by: 'kindred', on: '2027-06-02', reason: 'medical', note: '' },
})

describe('WorkingRequestCard reopen, liveness and approval', () => {
  it('reopens a Kindred cancellation only with a note, and sends it', async () => {
    renderCards([KINDRED_CANCELLED])
    await userEvent.click(screen.getByRole('button', { name: 'Reopen…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(cancel).not.toHaveBeenCalled()
    expect(screen.getByText('Why reopen is required')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Why reopen'), 'Family changed their mind{Enter}')
    expect(cancel).toHaveBeenCalledWith({
      requestId: 'reqemma00000001',
      body: { cancelled: false, note: 'Family changed their mind' },
    })
  })

  it('offers no cancel or hold on a request that is no longer live', () => {
    renderCards([gridRow({ ...ROW_EMMA, request_status: 'withdrawn' })])
    expect(screen.queryByRole('button', { name: 'Cancel Request…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Put on Hold…' })).toBeNull()
  })

  it('leaves a form alone when another opened while its save was pending', async () => {
    let finish: (value: unknown) => void = () => undefined
    cancelGate = new Promise((resolve) => {
      finish = resolve
    })
    renderCards([ROW_EMMA])
    await userEvent.click(screen.getByRole('button', { name: 'Cancel Request…' }))
    await userEvent.selectOptions(screen.getByLabelText('Cancel reason'), 'medical')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the Request' }))
    await userEvent.click(screen.getByRole('button', { name: 'Put on Hold…' }))
    await act(async () => {
      finish({})
      await cancelGate
    })
    expect(screen.getByLabelText('Reason for the hold')).toBeInTheDocument()
  })

  const PENDING = gridRow({
    ...ROW_OLIVIA,
    rounds: [
      ...ROW_OLIVIA.rounds.slice(0, 1),
      roundOut(3, 'pending_approval', { pending_approval: 450 }),
    ],
  })

  it("passes finance's right to approve to the round's next action", () => {
    renderCards([PENDING], true, true)
    expect(screen.getByRole('button', { name: 'Approve…' })).toBeInTheDocument()
  })

  it('offers no approval without it', () => {
    renderCards([PENDING], true, false)
    expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
  })
})

describe('WorkingRequestCard exits (F2 4/5: every page-owned exit goes through the open editor)', () => {
  const typeAppeal = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Edit the Appeal…' }))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300')
  }

  it('switches at once when nothing is typed', async () => {
    renderCards()
    await userEvent.click(screen.getByRole('button', { name: 'Edit the Appeal…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Put on Hold…' }))
    expect(screen.getByLabelText('Reason for the hold')).toBeInTheDocument()
    expect(screen.queryByLabelText('Round 2 ask')).toBeNull()
    expect(ask).not.toHaveBeenCalled()
  })

  it.each([
    ['Cancel Request…', 'Cancel reason'],
    ['Put on Hold…', 'Reason for the hold'],
  ])('saves what is typed before %s, and opens it once the save lands', async (button, field) => {
    mode = 'manual'
    renderCards()
    await typeAppeal()
    await userEvent.click(screen.getByRole('button', { name: button }))
    expect(ask).toHaveBeenCalledWith({
      requestId: 'reqolivia000003',
      body: { round: 2, amount: 1300, asked_on: '2027-04-09', note: 'Family emailed (Apr 9)' },
    })
    expect(screen.queryByLabelText(field)).toBeNull()
    settle()
    expect(screen.getByLabelText(field)).toBeInTheDocument()
    expect(screen.queryByLabelText('Round 2 ask')).toBeNull()
  })

  it('stays on the editor, with its error, when the save fails', async () => {
    mode = 'manual'
    renderCards()
    await typeAppeal()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel Request…' }))
    const call = pending.shift()
    act(() => call?.onError?.(new Error('The server said no')))
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1300')
    expect(screen.getByText('The server said no')).toBeInTheDocument()
    expect(screen.queryByLabelText('Cancel reason')).toBeNull()
  })

  it('opens one editor per page: another card saves the open one first', async () => {
    mode = 'manual'
    const other = gridRow({
      ...ROW_OLIVIA,
      request_id: 'reqolivia000009',
      camper_name: 'Samuel Johnson',
    })
    renderCards([ROW_OLIVIA, other])
    const edits = () => screen.getAllByRole('button', { name: 'Edit the Appeal…' })
    await userEvent.click(edits()[0] as HTMLElement)
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300')
    await userEvent.click(edits()[1] as HTMLElement)
    expect(ask).toHaveBeenCalledTimes(1)
    expect(screen.getAllByLabelText('Round 2 ask')).toHaveLength(1)
    settle()
    expect(screen.getAllByLabelText('Round 2 ask')).toHaveLength(1)
    // The first card's editor is gone and the second's is open on its own figure.
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1200')
  })

  it("exposes the page's beforeLeave: saves the open editor, then goes", async () => {
    mode = 'manual'
    renderCards()
    await typeAppeal()
    act(() => exitsSeen?.beforeLeave(go))
    expect(ask).toHaveBeenCalledTimes(1)
    expect(go).not.toHaveBeenCalled()
    settle()
    expect(go).toHaveBeenCalledTimes(1)
  })

  it("the page's beforeLeave goes at once with no editor open, or nothing typed", async () => {
    renderCards()
    act(() => exitsSeen?.beforeLeave(go))
    expect(go).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Edit the Appeal…' }))
    act(() => exitsSeen?.beforeLeave(go))
    expect(go).toHaveBeenCalledTimes(2)
  })

  it('the page stays put when what is typed cannot be saved', async () => {
    renderCards()
    await userEvent.click(screen.getByRole('button', { name: 'Round 3 Ask…' }))
    await userEvent.keyboard('450')
    act(() => exitsSeen?.beforeLeave(go))
    expect(go).not.toHaveBeenCalled()
    expect(screen.getByText('Statement of need is required')).toBeInTheDocument()
  })
})

describe('WorkingRequestCard: round actions beside an open money editor (I2)', () => {
  const R2_OFFER = gridRow({
    ...ROW_OLIVIA,
    rounds: [
      roundOut(1, 'posted', { ask: 2500, decided: 1420, posted: 1420, posted_on: '2027-03-09' }),
      roundOut(2, 'needs_offer', { ask: 1200, decided: 900 }),
    ],
  })

  it('takes Mark posted away while an edit is open, and brings it back on Esc', async () => {
    renderCards([R2_OFFER])
    expect(screen.getByRole('button', { name: 'Mark Posted · locks $900' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Edit the Appeal…' }))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300')
    expect(screen.queryByRole('button', { name: /Mark Posted/ })).toBeNull()
    expect(screen.getByText('save or close the edit first')).toBeInTheDocument()
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Mark Posted · locks $900' })).toBeInTheDocument()
  })
})

describe('WorkingRequestCard: an editor the row stops offering closes (m1)', () => {
  it('drops the Round 3 ask editor once Round 1 is no longer posted', async () => {
    const { rerender } = renderCards([ROW_OLIVIA])
    await userEvent.click(screen.getByRole('button', { name: 'Round 3 Ask…' }))
    expect(screen.getByLabelText('Round 3 ask')).toBeInTheDocument()
    const undone = gridRow({
      ...ROW_OLIVIA,
      rounds: [roundOut(1, 'needs_offer', { ask: 2500, decided: 1800 })],
    })
    rerender(<Cards rows={[undone]} />)
    expect(screen.queryByLabelText('Round 3 ask')).toBeNull()
  })
})

describe('WorkingRequestCard: a non-live request takes no cancellation write (m2)', () => {
  it('offers no reason on a withdrawn CampMinder cancellation', () => {
    renderCards([gridRow({ ...ROW_RILEY, request_status: 'withdrawn' })])
    expect(screen.queryByRole('button', { name: 'Give a Reason…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change the Reason…' })).toBeNull()
  })

  it('offers no reopen or change on a withdrawn Kindred cancellation', () => {
    renderCards([gridRow({ ...KINDRED_CANCELLED, request_status: 'withdrawn' })])
    expect(screen.queryByRole('button', { name: 'Reopen…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change the Reason…' })).toBeNull()
  })

  it("names a released hold's releaser by first name, not by sign-in email", () => {
    renderCards([
      gridRow({
        ...ROW_EMMA,
        released_holds: [
          {
            code: 'py_confirm_tier_change',
            note: 'ok',
            released_by: 'emma.chen@example.org',
            released_at: '2027-03-01T10:00:00Z',
          },
        ],
      }),
    ])
    expect(screen.getByText(/ by Emma: ok$/)).toBeInTheDocument()
    expect(screen.queryByText(/example\.org/)).toBeNull()
  })

  it('offers no Put back on a withdrawn request with a released hold', () => {
    renderCards([
      gridRow({
        ...ROW_EMMA,
        request_status: 'withdrawn',
        released_holds: [
          {
            code: 'py_confirm_tier_change',
            note: 'ok',
            released_by: 'Emma Johnson',
            released_at: '2027-03-01T10:00:00Z',
          },
        ],
      }),
    ])
    expect(screen.queryByRole('button', { name: 'Put Back…' })).toBeNull()
  })
})

describe('WorkingRequestCard: the open editor’s own button (m3)', () => {
  it('is a no-op: nothing is saved and the draft stays', async () => {
    renderCards()
    await userEvent.click(screen.getByRole('button', { name: 'Edit the Appeal…' }))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300')
    await userEvent.click(screen.getByRole('button', { name: 'Edit the Appeal…' }))
    expect(ask).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1300')
  })
})

describe('WorkingRequestCard: the casework forms', () => {
  const FAMILY = gridRow({
    request_id: 'reqfamily000010',
    person_cm_id: 0,
    camper_name: '',
    program_key: 'family_camp',
  })

  it('offers payer shares on a live request, and each intake fix only where it applies', () => {
    renderCards([ROW_EMMA])
    expect(screen.getByRole('button', { name: 'Payer Shares…' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Settle Session…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Keep the Other Request…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Number of People…' })).toBeNull()
  })

  it('offers Settle Session… on a request whose session is not settled', () => {
    renderCards([{ ...ROW_EMMA, request_status: 'unmatched_session' }])
    expect(screen.getByRole('button', { name: 'Settle Session…' })).toBeInTheDocument()
  })

  it('offers Keep the Other Request… only on a pending duplicate', () => {
    renderCards([{ ...ROW_EMMA, request_status: 'duplicate_pending' }])
    expect(screen.getByRole('button', { name: 'Keep the Other Request…' })).toBeInTheDocument()
  })

  it('offers Number of People… on a Family Camp household request only', () => {
    renderCards([FAMILY])
    expect(screen.getByRole('button', { name: 'Number of People…' })).toBeInTheDocument()
  })

  it('offers no headcount on a summer request that merely has no camper', () => {
    renderCards([{ ...FAMILY, program_key: 'summer' }])
    expect(screen.queryByRole('button', { name: 'Number of People…' })).toBeNull()
  })

  it('offers none of them where the server refuses the write (a duplicate or withdrawn request)', () => {
    renderCards([{ ...ROW_EMMA, request_status: 'withdrawn' }])
    expect(screen.queryByRole('button', { name: 'Payer Shares…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Number of People…' })).toBeNull()
  })

  it('is the plain card, with none of them, without casework permission', () => {
    renderCards([{ ...ROW_EMMA, request_status: 'unmatched_session' }], false)
    expect(screen.queryByRole('button', { name: 'Payer Shares…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Settle Session…' })).toBeNull()
  })

  it('opens a form in place, and Back closes it', async () => {
    renderCards([ROW_EMMA])
    await userEvent.click(screen.getByRole('button', { name: 'Payer Shares…' }))
    expect(screen.getByLabelText('Household')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.queryByLabelText('Household')).toBeNull()
  })

  it("leaves the card's money editor before opening a form: one open editor", async () => {
    renderCards([ROW_OLIVIA])
    await userEvent.click(screen.getByRole('button', { name: 'Edit the Appeal…' }))
    expect(screen.getByLabelText('Round 2 ask')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Payer Shares…' }))
    expect(screen.queryByLabelText('Round 2 ask')).toBeNull()
    expect(screen.getByLabelText('Household')).toBeInTheDocument()
  })

  it('closes the money editor of another card when a form opens on this one', async () => {
    renderCards([ROW_OLIVIA, ROW_EMMA])
    await userEvent.click(screen.getByRole('button', { name: 'Edit the Appeal…' }))
    const shares = screen.getAllByRole('button', { name: 'Payer Shares…' })
    await userEvent.click(shares[1]!)
    expect(screen.queryByLabelText('Round 2 ask')).toBeNull()
    expect(screen.getByLabelText('Household')).toBeInTheDocument()
  })

  const UNSETTLED = {
    ...ROW_EMMA,
    request_status: 'unmatched_session',
    session_candidates: [{ session_cm_id: 1000101, name: 'Session 2' }],
  }

  it('drops a form once the request no longer takes it (a refetch moved the status)', async () => {
    const { rerender } = render(<Cards rows={[UNSETTLED]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Settle Session…' }))
    expect(screen.getByLabelText('Session')).toBeInTheDocument()
    rerender(<Cards rows={[{ ...UNSETTLED, request_status: 'active' }]} />)
    expect(screen.queryByLabelText('Session')).toBeNull()
  })

  it('a save that removes its own offer unmounts its form mid-save: no error, and the card is free after', async () => {
    let settle: () => void = () => undefined
    resolveGate = new Promise<void>((resolve) => {
      settle = resolve
    })
    const { rerender } = render(<Cards rows={[UNSETTLED]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Settle Session…' }))
    await userEvent.selectOptions(screen.getByLabelText('Session'), '1000101')
    await userEvent.type(screen.getByLabelText('Reason'), 'Registered for Session 2{Enter}')
    // The refetch lands before the write's promise resolves, and the row is no longer unmatched.
    rerender(<Cards rows={[{ ...UNSETTLED, request_status: 'active' }]} />)
    expect(screen.queryByLabelText('Session')).toBeNull()
    await act(async () => {
      settle()
      await resolveGate
    })
    expect(screen.queryByText(/Couldn|required|refused/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Payer Shares…' }))
    expect(screen.getByLabelText('Household')).toBeInTheDocument()
  })

  it("re-clicking a form's own button during its save is a no-op, so the saved form still closes (m1)", async () => {
    let settle: () => void = () => undefined
    shareGate = new Promise<void>((resolve) => {
      settle = resolve
    })
    renderCards([ROW_OLIVIA])
    await userEvent.click(screen.getByRole('button', { name: 'Payer Shares…' }))
    await userEvent.type(screen.getByLabelText('Share'), '40')
    await userEvent.type(screen.getByLabelText('Reason'), 'Court order{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Payer Shares…' }))
    await act(async () => {
      settle()
      await shareGate
    })
    expect(screen.queryByLabelText('Household')).toBeNull()
  })
})

describe('WorkingRequestCard: every form closes on Esc as soon as it opens', () => {
  // No click into a field first: the key goes to whatever the form's opening focused.
  it.each([
    ['Cancel Request…', 'Cancel reason', ROW_EMMA],
    ['Put on Hold…', 'Reason for the hold', ROW_OLIVIA],
    ['Payer Shares…', 'Household', ROW_EMMA],
    ['Round 3 Ask…', 'Round 3 ask', ROW_OLIVIA],
    ['Edit the Appeal…', 'Round 2 ask', ROW_OLIVIA],
  ])('%s', async (button, field, row) => {
    renderCards([row])
    await userEvent.click(screen.getByRole('button', { name: button }))
    expect(screen.getByLabelText(field)).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByLabelText(field)).toBeNull()
  })
})

describe('WorkingRequestCard: Put on Hold… in two columns (round 3)', () => {
  it('says on the right what the hold does', async () => {
    renderCards([ROW_EMMA])
    await userEvent.click(screen.getByRole('button', { name: 'Put on Hold…' }))
    const side = document.querySelector('[data-editor-side]')
    expect(side).toHaveTextContent('The request stays on hold until someone lifts it.')
    expect(side).not.toContainElement(screen.getByLabelText('Reason for the hold'))
  })
})

// Item 11 (owner ruling 10-05): either request of a duplicate pair reaches the other, and the request
// kept can keep itself (the server takes an active request to keep: see duplicatePair.ts).
describe('WorkingRequestCard: a duplicate pair (item 11)', () => {
  const PENDING = gridRow({
    ...ROW_EMMA,
    request_id: 'reqpending00001',
    request_status: 'duplicate_pending',
  })
  const KEPT = gridRow({ ...ROW_EMMA, request_id: 'reqkept00000001', request_status: 'active' })
  const naming = (holder: string) =>
    applicationOut({
      requests: [
        requestOut({ id: 'reqpending00001', status: 'duplicate_pending', duplicate_of: holder }),
      ],
    })
  const cardOf = (id: string) => document.getElementById(`request-${id}`) as HTMLElement
  const sideOf = (id: string) => cardOf(id).querySelector('[data-editor-side]') as HTMLElement

  it('draws no link between two requests on the same page (owner V4)', () => {
    application = naming('reqkept00000001')
    renderCards([PENDING, KEPT])
    expect(within(cardOf('reqpending00001')).queryByRole('link', { name: /Go to the/ })).toBeNull()
    expect(within(cardOf('reqkept00000001')).queryByRole('link', { name: /Go to the/ })).toBeNull()
  })

  it('offers the request kept Keep This Request…, which marks the OTHER one as the duplicate', async () => {
    application = naming('reqkept00000001')
    renderCards([PENDING, KEPT])
    const card = within(cardOf('reqkept00000001'))
    await userEvent.click(card.getByRole('button', { name: 'Keep This Request…' }))
    expect(card.getByText('Keeping this request')).toBeInTheDocument()
    await userEvent.type(card.getByLabelText('Reason'), 'Same camper, entered twice{Enter}')
    expect(duplicate).toHaveBeenCalledWith({
      requestId: 'reqpending00001',
      body: { duplicate_of: 'reqkept00000001', reason: 'Same camper, entered twice' },
    })
  })

  // Owner ruling 10-05 late: a pair on ONE page shows only Keep This Request… on each card; a pair
  // across two households keeps both buttons on both cards.
  it('offers only Keep This Request… on each card of a pair on the same page (owner ruling)', () => {
    application = naming('reqkept00000001')
    renderCards([PENDING, KEPT])
    for (const id of ['reqpending00001', 'reqkept00000001']) {
      const card = within(cardOf(id))
      expect(card.getByRole('button', { name: 'Keep This Request…' })).toBeInTheDocument()
      expect(card.queryByRole('button', { name: 'Keep the Other Request…' })).toBeNull()
    }
  })

  // #3031: the active card names its pending twin from duplicates_waiting, even on another page.
  const WAITING: DuplicateWaitingOut = {
    request_id: 'reqtwinelse0001',
    household_cm_id: 1000077,
    camper_name: 'Emma Johnson',
    session_name: 'Session 2',
    label: 'Riley & Emma Whitfield',
    label_tiebreak: 'Lakeside, CA',
  }

  it("offers the request kept Keep the Other Request… for a twin on another household's page, which swaps the two", async () => {
    waitingFor = { reqkept00000001: [WAITING] }
    renderCards([KEPT])
    const card = within(cardOf('reqkept00000001'))
    await userEvent.click(card.getByRole('button', { name: 'Keep the Other Request…' }))
    expect(card.getByText('Keeping the other request')).toBeInTheDocument()
    await userEvent.type(card.getByLabelText('Reason'), 'The later entry is right{Enter}')
    expect(duplicate).toHaveBeenCalledWith({
      requestId: 'reqkept00000001',
      body: { duplicate_of: 'reqtwinelse0001', reason: 'The later entry is right' },
    })
  })

  it('offers the request kept Keep This Request… for a twin on another page, which marks that twin the duplicate', async () => {
    waitingFor = { reqkept00000001: [WAITING] }
    renderCards([KEPT])
    const card = within(cardOf('reqkept00000001'))
    await userEvent.click(card.getByRole('button', { name: 'Keep This Request…' }))
    expect(sideOf('reqkept00000001')).toHaveTextContent(
      'Marks the other request as the duplicate: Emma Johnson · Session 2 · Riley & Emma Whitfield · Lakeside, CA'
    )
    await userEvent.type(card.getByLabelText('Reason'), 'First form is right{Enter}')
    expect(duplicate).toHaveBeenCalledWith({
      requestId: 'reqtwinelse0001',
      body: { duplicate_of: 'reqkept00000001', reason: 'First form is right' },
    })
  })

  it("names a twin on another page by camper, session and its household's label, and links its page without the grid", async () => {
    waitingFor = { reqkept00000001: [WAITING] }
    renderCards([KEPT])
    const card = within(cardOf('reqkept00000001'))
    expect(card.getByRole('link', { name: 'Go to the Other Request ›' })).toHaveAttribute(
      'href',
      '/aid/households/1000077?year=2027'
    )
    await userEvent.click(card.getByRole('button', { name: 'Keep the Other Request…' }))
    expect(sideOf('reqkept00000001')).toHaveTextContent(
      'Marks this request as the duplicate and keeps the other: Emma Johnson · Session 2 · Riley & Emma Whitfield · Lakeside, CA'
    )
    expect(sideOf('reqkept00000001')).not.toHaveTextContent('reqtwinelse0001')
    expect(applicationRead).not.toHaveBeenCalledWith(expect.anything(), { enabled: true })
  })

  it("offers the pending duplicate both keeps when its holder is on another household's page", () => {
    application = naming('reqelsewhere001')
    renderCards([PENDING])
    // In the same order as the active card's: Keep This, then Keep the Other.
    const keeps = within(cardOf('reqpending00001'))
      .getAllByRole('button', { name: /^Keep (This|the Other) Request…$/ })
      .map((button) => button.textContent)
    expect(keeps).toEqual(['Keep This Request…', 'Keep the Other Request…'])
  })

  it('offers the pending duplicate Keep This Request…, which closes the request it waits on', async () => {
    application = naming('reqkept00000001')
    renderCards([PENDING, KEPT])
    const card = within(cardOf('reqpending00001'))
    await userEvent.click(card.getByRole('button', { name: 'Keep This Request…' }))
    expect(card.getByText('Keeping this request')).toBeInTheDocument()
    await userEvent.type(card.getByLabelText('Reason'), 'The later entry is right{Enter}')
    expect(duplicate).toHaveBeenCalledWith({
      requestId: 'reqkept00000001',
      body: { duplicate_of: 'reqpending00001', reason: 'The later entry is right' },
    })
  })

  it("keeps the pending duplicate over a holder on another household's page, by the holder's id", async () => {
    application = naming('reqelsewhere001')
    renderCards([PENDING])
    const card = within(cardOf('reqpending00001'))
    await userEvent.click(card.getByRole('button', { name: 'Keep This Request…' }))
    await userEvent.type(card.getByLabelText('Reason'), 'Later entry is right{Enter}')
    expect(duplicate).toHaveBeenCalledWith({
      requestId: 'reqelsewhere001',
      body: { duplicate_of: 'reqpending00001', reason: 'Later entry is right' },
    })
  })

  // Owner call 10-05 late: the keep boxes name the other request as camper · session, never its raw id.

  it('names the other request by camper and session, without its id, in every keep box (owner 10-05)', async () => {
    application = naming('reqkept00000001')
    renderCards([PENDING, KEPT])
    const kept = within(cardOf('reqkept00000001'))
    await userEvent.click(kept.getByRole('button', { name: 'Keep This Request…' }))
    expect(sideOf('reqkept00000001')).toHaveTextContent(
      'Marks the other request as the duplicate: Emma Johnson · Session 2'
    )
    expect(sideOf('reqkept00000001')).not.toHaveTextContent('reqpending00001')
  })

  it("names a twin on another household's page by what the pending card knows: the same camper and session", async () => {
    application = naming('reqelsewhere001')
    renderCards([PENDING])
    const card = within(cardOf('reqpending00001'))
    await userEvent.click(card.getByRole('button', { name: 'Keep This Request…' }))
    expect(sideOf('reqpending00001')).toHaveTextContent(
      'Marks the other request as the duplicate and keeps this one: Emma Johnson · Session 2'
    )
    expect(sideOf('reqpending00001')).not.toHaveTextContent('reqelsewhere001')
  })

  it("shows the server's refusal in the box, and keeps what was typed", async () => {
    application = naming('reqkept00000001')
    duplicateRefusal = 'Round 2 is posted: keep this request, or undo Posted first'
    renderCards([PENDING, KEPT])
    const card = within(cardOf('reqpending00001'))
    await userEvent.click(card.getByRole('button', { name: 'Keep This Request…' }))
    await userEvent.type(card.getByLabelText('Reason'), 'Later entry{Enter}')
    expect(
      await card.findByText('Round 2 is posted: keep this request, or undo Posted first')
    ).toBeInTheDocument()
    expect(card.getByLabelText('Reason')).toHaveValue('Later entry')
  })

  it("opens the household page of a request kept on another household's page", () => {
    application = naming('reqelsewhere001')
    gridRows = [gridRow({ ...ROW_EMMA, request_id: 'reqelsewhere001', household_cm_id: 1000042 })]
    renderCards([PENDING])
    const link = within(cardOf('reqpending00001')).getByRole('link', {
      name: 'Go to the Other Request ›',
    })
    expect(link).toHaveAttribute('href', '/aid/households/1000042?year=2027')
  })

  it("reads the application only on a page that holds a pending duplicate, its household's", () => {
    renderCards([KEPT])
    expect(applicationRead.mock.calls.every((call) => (call as unknown[])[1] !== undefined)).toBe(
      true
    )
    expect(applicationRead).not.toHaveBeenCalledWith(expect.anything(), { enabled: true })
    applicationRead.mockReset()
    application = naming('reqkept00000001')
    renderCards([PENDING, KEPT])
    expect(applicationRead).toHaveBeenCalledWith(PENDING.household_cm_id, { enabled: true })
  })
})
