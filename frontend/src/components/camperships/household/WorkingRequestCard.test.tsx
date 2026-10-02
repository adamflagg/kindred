import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { gridRow, roundOut, ROW_EMMA, ROW_OLIVIA, ROW_RILEY } from '../requests/gridFixtures'
import { useEditorExits, type EditorExits } from './editorExits'
import { applicationOut, householdPage, householdRequest } from './householdFixtures'
import { WorkingRequestCard } from './WorkingRequestCard'

const cancel = vi.fn()
const manual = vi.fn()
const ask = vi.fn()
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
  useAidHouseholdShare: () => quiet,
  useAidSessionResolve: () => quiet,
  useAidDuplicate: () => quiet,
  useAidHeadcount: () => quiet,
  useAidCorrection: () => quiet,
}))
vi.mock('../../../hooks/camperships/useAidApplication', () => ({
  useAidApplication: () => ({ data: applicationOut(), isLoading: false, error: null }),
}))
vi.mock('../../../hooks/camperships/useAidSessionNames', () => ({
  useAidSessionNames: () => undefined,
}))
vi.mock('../../../hooks/camperships/useAidEditorPreview', () => ({
  useAidEditorPreview: () => ({ preview: { status: 'idle' }, onAmountChange: () => undefined }),
}))

const VIEW = { year: 2027, asOf: { kind: 'live' } as const }
const go = vi.fn()
// When set, the cancellation write stays pending until the test settles it.
let cancelGate: Promise<unknown> | null = null
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
  const requests = rows.map((row) => householdRequest(row))
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
  cancelGate = null
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

  it('puts a request on hold by hand, with its reason', async () => {
    renderCards([ROW_EMMA])
    await userEvent.click(screen.getByRole('button', { name: 'Put on Hold…' }))
    await userEvent.type(screen.getByLabelText('Reason for the hold'), 'Waiting on a call{Enter}')
    expect(manual).toHaveBeenCalledWith({
      requestId: 'reqemma00000001',
      body: { held: true, note: 'Waiting on a call' },
    })
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
    expect(screen.getByRole('button', { name: 'Payer shares…' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Settle session…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Keep the other request…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Headcount…' })).toBeNull()
  })

  it('offers Settle session… on a request whose session is not settled', () => {
    renderCards([{ ...ROW_EMMA, request_status: 'unmatched_session' }])
    expect(screen.getByRole('button', { name: 'Settle session…' })).toBeInTheDocument()
  })

  it('offers Keep the other request… only on a pending duplicate', () => {
    renderCards([{ ...ROW_EMMA, request_status: 'duplicate_pending' }])
    expect(screen.getByRole('button', { name: 'Keep the other request…' })).toBeInTheDocument()
  })

  it('offers Headcount… on a Family Camp household request only', () => {
    renderCards([FAMILY])
    expect(screen.getByRole('button', { name: 'Headcount…' })).toBeInTheDocument()
  })

  it('offers no headcount on a summer request that merely has no camper', () => {
    renderCards([{ ...FAMILY, program_key: 'summer' }])
    expect(screen.queryByRole('button', { name: 'Headcount…' })).toBeNull()
  })

  it('offers none of them where the server refuses the write (a duplicate or withdrawn request)', () => {
    renderCards([{ ...ROW_EMMA, request_status: 'withdrawn' }])
    expect(screen.queryByRole('button', { name: 'Payer shares…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Headcount…' })).toBeNull()
  })

  it('is the plain card, with none of them, without casework permission', () => {
    renderCards([{ ...ROW_EMMA, request_status: 'unmatched_session' }], false)
    expect(screen.queryByRole('button', { name: 'Payer shares…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Settle session…' })).toBeNull()
  })

  it('opens a form in place, and Back closes it', async () => {
    renderCards([ROW_EMMA])
    await userEvent.click(screen.getByRole('button', { name: 'Payer shares…' }))
    expect(screen.getByLabelText('Household')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.queryByLabelText('Household')).toBeNull()
  })

  it("leaves the card's money editor before opening a form: one open editor", async () => {
    renderCards([ROW_OLIVIA])
    await userEvent.click(screen.getByRole('button', { name: 'Edit the appeal…' }))
    expect(screen.getByLabelText('Round 2 ask')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Payer shares…' }))
    expect(screen.queryByLabelText('Round 2 ask')).toBeNull()
    expect(screen.getByLabelText('Household')).toBeInTheDocument()
  })

  it('closes the money editor of another card when a form opens on this one', async () => {
    renderCards([ROW_OLIVIA, ROW_EMMA])
    await userEvent.click(screen.getByRole('button', { name: 'Edit the appeal…' }))
    const shares = screen.getAllByRole('button', { name: 'Payer shares…' })
    await userEvent.click(shares[1]!)
    expect(screen.queryByLabelText('Round 2 ask')).toBeNull()
    expect(screen.getByLabelText('Household')).toBeInTheDocument()
  })

  it('drops a form once the request no longer takes it (a refetch moved the status)', async () => {
    const { rerender } = render(
      <Cards rows={[{ ...ROW_EMMA, request_status: 'unmatched_session' }]} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Settle session…' }))
    expect(screen.getByLabelText('Session')).toBeInTheDocument()
    rerender(<Cards rows={[{ ...ROW_EMMA, request_status: 'active' }]} />)
    expect(screen.queryByLabelText('Session')).toBeNull()
  })
})
