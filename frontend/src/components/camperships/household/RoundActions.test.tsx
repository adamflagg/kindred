import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { gridRow, roundOut, ROW_EMMA, ROW_SAMUEL } from '../requests/gridFixtures'
import { householdRequest } from './householdFixtures'
import { roundLines } from './householdModel'
import { RoundChecklist, RoundNextAction } from './RoundActions'

const posted = vi.fn()
const accepted = vi.fn()
const undo = vi.fn()
const decide = vi.fn()
let failWith: Error | null = null
// Typed as a plain function: vitest 5's `Mock` type isn't callable under tsc (I1).
const mutation = (spy: (vars: unknown) => unknown) => ({
  isPending: false,
  mutate: (vars: unknown, options?: { onError?: (error: Error) => void }) => {
    spy(vars)
    if (failWith !== null) options?.onError?.(failWith)
  },
  mutateAsync: (vars: unknown) => {
    spy(vars)
    return failWith === null ? Promise.resolve({}) : Promise.reject(failWith)
  },
})
vi.mock('../../../hooks/camperships/useAidWrites', () => ({
  useAidTickPosted: () => mutation(posted),
  useAidTickAccepted: () => mutation(accepted),
  useAidUndoPosted: () => mutation(undo),
  useAidRound3Decision: () => mutation(decide),
}))

beforeEach(() => {
  for (const spy of [posted, accepted, undo, decide]) spy.mockReset()
  failWith = null
})

const emma = householdRequest(ROW_EMMA)
const samuel = householdRequest(ROW_SAMUEL)
const lineOf = (request: typeof emma, round = 1) => {
  const line = roundLines(request).find((l) => l.round === round)
  if (line === undefined) throw new Error(`no round ${String(round)} line`)
  return line
}

describe('RoundNextAction (D51; Decision 22)', () => {
  it('marks posted at the decided amount it names', async () => {
    render(<RoundNextAction request={emma} line={lineOf(emma)} year={2027} canApprove={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mark posted · locks $1,420' }))
    expect(posted).toHaveBeenCalledWith({
      year: 2027,
      body: { rows: [{ request_id: 'reqemma00000001', round: 1, amount: 1420 }] },
    })
  })

  it("shows the server's refusal", async () => {
    failWith = new Error('reqemma00000001: Round 1 is on hold: release the hold first')
    render(<RoundNextAction request={emma} line={lineOf(emma)} year={2027} canApprove={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mark posted · locks $1,420' }))
    expect(
      screen.getByText('reqemma00000001: Round 1 is on hold: release the hold first')
    ).toBeInTheDocument()
  })

  it('lets finance refuse a Round 3 with a reason', async () => {
    const pending = householdRequest(
      gridRow({
        rounds: [
          roundOut(1, 'posted', { posted: 1420 }),
          roundOut(3, 'pending_approval', { pending_approval: 450 }),
        ],
      })
    )
    render(<RoundNextAction request={pending} line={lineOf(pending, 3)} year={2027} canApprove />)
    await userEvent.click(screen.getByRole('button', { name: 'Refuse…' }))
    await userEvent.type(screen.getByLabelText('Why refuse'), 'Over the reserve{Enter}')
    expect(decide).toHaveBeenCalledWith({
      requestId: 'reqemma00000001',
      body: { approve: false, note: 'Over the reserve' },
    })
  })

  it('shows nothing for a posted round', () => {
    const { container } = render(
      <RoundNextAction request={samuel} line={lineOf(samuel)} year={2027} canApprove />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('lets finance approve or refuse a Round 3 with a note, and tells the registrar it waits (D79)', async () => {
    const pending = householdRequest(
      gridRow({
        rounds: [
          roundOut(1, 'posted', { posted: 1420 }),
          roundOut(3, 'pending_approval', { pending_approval: 450 }),
        ],
      })
    )
    const { unmount } = render(
      <RoundNextAction request={pending} line={lineOf(pending, 3)} year={2027} canApprove={false} />
    )
    expect(screen.getByText("waits for finance's approval on Today")).toBeInTheDocument()
    unmount()
    render(<RoundNextAction request={pending} line={lineOf(pending, 3)} year={2027} canApprove />)
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    await userEvent.type(screen.getByLabelText('Approval note'), 'Within the reserve{Enter}')
    expect(decide).toHaveBeenCalledWith({
      requestId: 'reqemma00000001',
      body: { approve: true, note: 'Within the reserve' },
    })
  })
})

describe('RoundChecklist (§5.2; D47)', () => {
  it('asks why before undoing a Posted tick, then undoes it', async () => {
    render(<RoundChecklist request={samuel} line={lineOf(samuel)} year={2027} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /^Posted/ }))
    // Owner ruling S1 Q1: undo is for a tick made by mistake, never a way to lower a posted amount.
    expect(
      screen.getByText(
        'For a tick made by mistake. A posted amount stands: a later change to the award never lowers it.'
      )
    ).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Why undo Posted'), 'Ticked the wrong family{Enter}')
    expect(undo).toHaveBeenCalledWith({
      year: 2027,
      body: { request_id: 'reqsamuel000005', round: 1, reason: 'Ticked the wrong family' },
    })
  })

  it('ticks Accepted on a posted round, and keeps it off until the round is posted', async () => {
    render(<RoundChecklist request={samuel} line={lineOf(samuel)} year={2027} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Accepted' }))
    expect(accepted).toHaveBeenCalledWith({
      year: 2027,
      body: { rows: [{ request_id: 'reqsamuel000005', round: 1 }], accepted: true },
    })
  })

  it('offers neither box on a round not yet posted: Mark posted is the way', () => {
    render(<RoundChecklist request={emma} line={lineOf(emma)} year={2027} />)
    expect(screen.getByRole('checkbox', { name: /^Posted/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Accepted' })).toBeDisabled()
  })

  it('keeps the Posted box ticked on a CampMinder-reversed round', () => {
    const reversed = householdRequest(
      gridRow({
        rounds: [
          roundOut(1, 'posted', { posted: 1800, posted_on: '2027-03-09', clawed_back: true }),
        ],
      })
    )
    render(<RoundChecklist request={reversed} line={lineOf(reversed)} year={2027} />)
    expect(screen.getByRole('checkbox', { name: /^Posted/ })).toBeChecked()
  })

  it("shows the server's refusal of an undo and keeps the form", async () => {
    failWith = new Error('Round 1 is accepted: untick Accepted first')
    render(<RoundChecklist request={samuel} line={lineOf(samuel)} year={2027} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /^Posted/ }))
    await userEvent.type(screen.getByLabelText('Why undo Posted'), 'Ticked the wrong family{Enter}')
    expect(
      await screen.findByText('Round 1 is accepted: untick Accepted first')
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Why undo Posted')).toHaveValue('Ticked the wrong family')
  })

  it('shows an Accepted refusal once and clears it on the next try', async () => {
    failWith = new Error('Round 1 is not posted')
    render(<RoundChecklist request={samuel} line={lineOf(samuel)} year={2027} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Accepted' }))
    expect(screen.getAllByText('Round 1 is not posted')).toHaveLength(1)
    failWith = null
    await userEvent.click(screen.getByRole('checkbox', { name: 'Accepted' }))
    expect(screen.queryByText('Round 1 is not posted')).not.toBeInTheDocument()
  })
})
