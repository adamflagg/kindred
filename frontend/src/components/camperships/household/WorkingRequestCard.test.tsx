import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { gridRow, roundOut, ROW_EMMA, ROW_OLIVIA, ROW_RILEY } from '../requests/gridFixtures'
import { useEditorExits, type EditorExits } from './editorExits'
import { householdPage, householdRequest } from './householdFixtures'
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
    await userEvent.click(screen.getByRole('button', { name: 'Edit the appeal…' }))
    expect(screen.getByLabelText('Round 2 ask')).toHaveValue('1200')
  })

  it('cancels a request with one of the nine reasons', async () => {
    renderCards([ROW_EMMA])
    await userEvent.click(screen.getByRole('button', { name: 'Cancel request…' }))
    await userEvent.selectOptions(screen.getByLabelText('Cancel reason'), 'medical')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the request' }))
    expect(cancel).toHaveBeenCalledWith({
      requestId: 'reqemma00000001',
      body: { cancelled: true, reason: 'medical', note: '' },
    })
  })

  it('will not cancel without a reason', async () => {
    renderCards([ROW_EMMA])
    await userEvent.click(screen.getByRole('button', { name: 'Cancel request…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the request' }))
    expect(cancel).not.toHaveBeenCalled()
    expect(screen.getByText('Pick a cancel reason')).toBeInTheDocument()
  })

  it('asks for the reason CampMinder’s cancellation lacks (D101)', () => {
    renderCards([ROW_RILEY])
    expect(screen.getByRole('button', { name: 'Give a reason…' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel request…' })).toBeNull()
  })

  it('puts a request on hold by hand, with its reason', async () => {
    renderCards([ROW_EMMA])
    await userEvent.click(screen.getByRole('button', { name: 'Put on hold…' }))
    await userEvent.type(screen.getByLabelText('Reason for the hold'), 'Waiting on a call{Enter}')
    expect(manual).toHaveBeenCalledWith({
      requestId: 'reqemma00000001',
      body: { held: true, note: 'Waiting on a call' },
    })
  })

  it('offers nothing to change without casework: the plain card', () => {
    renderCards([ROW_OLIVIA], false)
    expect(screen.queryByRole('button', { name: 'Edit the appeal…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel request…' })).toBeNull()
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
    expect(screen.queryByRole('button', { name: 'Cancel request…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Put on hold…' })).toBeNull()
  })

  it('leaves a form alone when another opened while its save was pending', async () => {
    let finish: (value: unknown) => void = () => undefined
    cancelGate = new Promise((resolve) => {
      finish = resolve
    })
    renderCards([ROW_EMMA])
    await userEvent.click(screen.getByRole('button', { name: 'Cancel request…' }))
    await userEvent.selectOptions(screen.getByLabelText('Cancel reason'), 'medical')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel the request' }))
    await userEvent.click(screen.getByRole('button', { name: 'Put on hold…' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Edit the appeal…' }))
    await userEvent.clear(screen.getByLabelText('Round 2 ask'))
    await userEvent.keyboard('1300')
  }

  it('switches at once when nothing is typed', async () => {
    renderCards()
    await userEvent.click(screen.getByRole('button', { name: 'Edit the appeal…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Put on hold…' }))
    expect(screen.getByLabelText('Reason for the hold')).toBeInTheDocument()
    expect(screen.queryByLabelText('Round 2 ask')).toBeNull()
    expect(ask).not.toHaveBeenCalled()
  })

  it.each([
    ['Cancel request…', 'Cancel reason'],
    ['Put on hold…', 'Reason for the hold'],
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
    await userEvent.click(screen.getByRole('button', { name: 'Cancel request…' }))
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
    const edits = () => screen.getAllByRole('button', { name: 'Edit the appeal…' })
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
    await userEvent.click(screen.getByRole('button', { name: 'Edit the appeal…' }))
    act(() => exitsSeen?.beforeLeave(go))
    expect(go).toHaveBeenCalledTimes(2)
  })

  it('the page stays put when what is typed cannot be saved', async () => {
    renderCards()
    await userEvent.click(screen.getByRole('button', { name: 'Round 3 ask…' }))
    await userEvent.keyboard('450')
    act(() => exitsSeen?.beforeLeave(go))
    expect(go).not.toHaveBeenCalled()
    expect(screen.getByText('Statement of need is required')).toBeInTheDocument()
  })
})
