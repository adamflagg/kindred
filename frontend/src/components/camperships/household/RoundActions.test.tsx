import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AidWriteError } from '../../../services/camperships/aidApi'
import type { ApiAidUnticked } from '../../../types/api-types'
import { gridRow, roundOut, ROW_EMMA, ROW_SAMUEL } from '../requests/gridFixtures'
import { householdRequest } from './householdFixtures'
import { roundLines } from './householdModel'
import { RoundChecklist, RoundNextAction } from './RoundActions'

const posted = vi.fn()
const accepted = vi.fn()
const undo = vi.fn()
const decide = vi.fn()
let failWith: Error | null = null
let pending = false
// Typed as a plain function: vitest 5's `Mock` type isn't callable under tsc (I1).
const mutation = (spy: (vars: unknown) => unknown) => ({
  isPending: pending,
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
  pending = false
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
    await userEvent.click(screen.getByRole('button', { name: 'Mark Posted · locks $1,420' }))
    expect(posted).toHaveBeenCalledWith({
      year: 2027,
      body: { rows: [{ request_id: 'reqemma00000001', round: 1, amount: 1420 }] },
    })
  })

  it("shows the server's refusal", async () => {
    failWith = new Error(
      'A decided amount moved since it was shown, so nothing was posted: check the rows and tick again'
    )
    render(<RoundNextAction request={emma} line={lineOf(emma)} year={2027} canApprove={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mark Posted · locks $1,420' }))
    expect(
      screen.getByText(
        'A decided amount moved since it was shown, so nothing was posted: check the rows and tick again'
      )
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

  describe('where Mark Posted is hidden (D162)', () => {
    const MARK = { name: /Mark Posted/ }
    const untickedFor = (mark_posted: boolean): ApiAidUnticked => ({
      round: 1,
      code: mark_posted ? 'short_posting' : 'on_hold',
      label: mark_posted ? 'Short posting' : 'On hold',
      message: 'Why it is not ticked',
      mark_posted,
    })

    it('keeps the hand tick on an ordinary needs-offer round', () => {
      const request = householdRequest(
        gridRow({ rounds: [roundOut(1, 'needs_offer', { decided: 1420 })] })
      )
      render(
        <RoundNextAction request={request} line={lineOf(request)} year={2027} canApprove={false} />
      )
      expect(screen.getByRole('button', { name: 'Mark Posted · locks $1,420' })).toBeInTheDocument()
    })

    it('hides it on a round whose CampMinder check is pending (C1)', () => {
      const request = householdRequest(
        gridRow({ rounds: [roundOut(1, 'needs_offer', { decided: 1420, cm_pending: true })] })
      )
      render(
        <RoundNextAction request={request} line={lineOf(request)} year={2027} canApprove={false} />
      )
      expect(screen.queryByRole('button', MARK)).toBeNull()
    })

    it('hides it where the server says the round cannot be hand-ticked (mark_posted false)', () => {
      const request = householdRequest(
        gridRow({
          rounds: [roundOut(1, 'needs_offer', { decided: 1420 })],
          unticked: [untickedFor(false)],
        })
      )
      render(
        <RoundNextAction request={request} line={lineOf(request)} year={2027} canApprove={false} />
      )
      expect(screen.queryByRole('button', MARK)).toBeNull()
    })

    it('shows it where the server says the round can be hand-ticked (mark_posted true)', () => {
      const request = householdRequest(
        gridRow({
          rounds: [roundOut(1, 'needs_offer', { decided: 1420 })],
          unticked: [untickedFor(true)],
        })
      )
      render(
        <RoundNextAction request={request} line={lineOf(request)} year={2027} canApprove={false} />
      )
      expect(screen.getByRole('button', { name: 'Mark Posted · locks $1,420' })).toBeInTheDocument()
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

  it('disables Mark posted while its write is pending', () => {
    pending = true
    render(<RoundNextAction request={emma} line={lineOf(emma)} year={2027} canApprove={false} />)
    expect(screen.getByRole('button', { name: 'Mark Posted · locks $1,420' })).toBeDisabled()
  })

  it('closes the Round 3 form after a successful decision', async () => {
    const pendingRound = householdRequest(
      gridRow({
        rounds: [
          roundOut(1, 'posted', { posted: 1420 }),
          roundOut(3, 'pending_approval', { pending_approval: 450 }),
        ],
      })
    )
    render(
      <RoundNextAction
        request={pendingRound}
        line={lineOf(pendingRound, 3)}
        year={2027}
        canApprove
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Approve…' }))
    await userEvent.type(screen.getByLabelText('Approval note'), 'Within the reserve{Enter}')
    await waitFor(() => expect(screen.queryByLabelText('Approval note')).not.toBeInTheDocument())
  })

  // A withheld round's decided_now is what the tick WOULD lock, so refresh-and-tick-again loops:
  // the refusal offers the amount itself (#2981).
  describe('Mark Posted at the amount the server named (#2981)', () => {
    const moved = (decidedNow: number | null) => {
      const error = new AidWriteError('Decided amounts moved since they were shown', 409)
      error.rows = [
        { request_id: 'reqemma00000001', round: 1, confirmed: 1420, decided_now: decidedNow },
      ]
      return error
    }

    it('re-sends the round at decided_now and the offer goes away, with no second 409 needed', async () => {
      failWith = moved(1500)
      render(<RoundNextAction request={emma} line={lineOf(emma)} year={2027} canApprove={false} />)
      await userEvent.click(screen.getByRole('button', { name: 'Mark Posted · locks $1,420' }))
      failWith = null
      await userEvent.click(screen.getByRole('button', { name: 'Mark Posted at $1,500' }))
      expect(posted).toHaveBeenCalledTimes(2)
      expect(posted).toHaveBeenLastCalledWith({
        year: 2027,
        body: { rows: [{ request_id: 'reqemma00000001', round: 1, amount: 1500 }] },
      })
      expect(screen.queryByRole('button', { name: /Mark Posted at/ })).not.toBeInTheDocument()
      expect(screen.queryByText(/moved since/)).not.toBeInTheDocument()
    })

    it('offers nothing when decided_now is null or equals the decided amount', async () => {
      failWith = moved(null)
      const { unmount } = render(
        <RoundNextAction request={emma} line={lineOf(emma)} year={2027} canApprove={false} />
      )
      await userEvent.click(screen.getByRole('button', { name: 'Mark Posted · locks $1,420' }))
      expect(screen.getByText(/Decided amounts moved/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Mark Posted at/ })).not.toBeInTheDocument()
      unmount()
      failWith = moved(1420)
      render(<RoundNextAction request={emma} line={lineOf(emma)} year={2027} canApprove={false} />)
      await userEvent.click(screen.getByRole('button', { name: 'Mark Posted · locks $1,420' }))
      expect(screen.queryByRole('button', { name: /Mark Posted at/ })).not.toBeInTheDocument()
    })
  })

  it('clears a Mark posted refusal when the line changes under it', async () => {
    failWith = new Error('A decided amount moved since it was shown, so nothing was posted')
    const { rerender } = render(
      <RoundNextAction request={emma} line={lineOf(emma)} year={2027} canApprove={false} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Mark Posted · locks $1,420' }))
    expect(screen.getByText(/A decided amount moved/)).toBeInTheDocument()
    const postedRow = householdRequest(
      gridRow({ rounds: [roundOut(1, 'posted', { posted: 1420, decided: 1420 })] })
    )
    rerender(
      <RoundNextAction
        request={postedRow}
        line={lineOf(postedRow)}
        year={2027}
        canApprove={false}
      />
    )
    rerender(<RoundNextAction request={emma} line={lineOf(emma)} year={2027} canApprove={false} />)
    expect(screen.queryByText(/A decided amount moved/)).not.toBeInTheDocument()
  })

  it('offers no Mark posted on a round whose earlier round is not posted yet', () => {
    const two = householdRequest(
      gridRow({
        rounds: [
          roundOut(1, 'needs_offer', { decided: 1420 }),
          roundOut(2, 'needs_offer', { decided: 300 }),
        ],
      })
    )
    render(<RoundNextAction request={two} line={lineOf(two, 2)} year={2027} canApprove={false} />)
    expect(screen.queryByRole('button', { name: /Mark Posted/ })).not.toBeInTheDocument()
    expect(screen.getByText('after Round 1 is posted')).toBeInTheDocument()
  })
})

describe('RoundChecklist (§5.2; D47)', () => {
  // B22 (ruled 10-04 late): since D162 the overnight tick is the normal path, and it never re-marks a
  // round unmarked by hand; the undo says so before it is sent.
  it('warns that the overnight sync will not re-mark the round, and where it will show', async () => {
    render(<RoundChecklist request={samuel} line={lineOf(samuel)} year={2027} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /^Posted/ }))
    expect(
      screen.getByText(
        'The overnight sync won\'t mark it posted again: it will show in Not reconciled as "Unmarked by hand".'
      )
    ).toBeInTheDocument()
  })

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

  // P1 (owner, sitting B): the grid's acceptedTarget offers Accepted on a C1 round (in CampMinder in
  // full, tonight's tick posts it); the household page offers it too.
  it('offers Accepted on a C1 (cm_pending) round and sends the write', async () => {
    const c1 = householdRequest(
      gridRow({
        rounds: [roundOut(1, 'needs_offer', { decided: 900, cm_pending: true })],
      })
    )
    render(<RoundChecklist request={c1} line={lineOf(c1)} year={2027} />)
    expect(screen.getByRole('checkbox', { name: /^Posted/ })).toBeDisabled()
    const box = screen.getByRole('checkbox', { name: 'Accepted' })
    expect(box).toBeEnabled()
    await userEvent.click(box)
    expect(accepted).toHaveBeenCalledWith({
      year: 2027,
      body: { rows: [{ request_id: c1.row.request_id, round: 1 }], accepted: true },
    })
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
    failWith = new Error('Untick Accepted on Round 1 first')
    render(<RoundChecklist request={samuel} line={lineOf(samuel)} year={2027} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /^Posted/ }))
    await userEvent.type(screen.getByLabelText('Why undo Posted'), 'Ticked the wrong family{Enter}')
    expect(await screen.findByText('Untick Accepted on Round 1 first')).toBeInTheDocument()
    expect(screen.getByLabelText('Why undo Posted')).toHaveValue('Ticked the wrong family')
  })

  it('shows an Accepted refusal once and clears it on the next try', async () => {
    failWith = new Error('reqsamuel000005: Round 1 is not posted')
    render(<RoundChecklist request={samuel} line={lineOf(samuel)} year={2027} />)
    await userEvent.click(screen.getByRole('checkbox', { name: 'Accepted' }))
    expect(screen.getAllByText('reqsamuel000005: Round 1 is not posted')).toHaveLength(1)
    failWith = null
    await userEvent.click(screen.getByRole('checkbox', { name: 'Accepted' }))
    expect(screen.queryByText('reqsamuel000005: Round 1 is not posted')).not.toBeInTheDocument()
  })

  it('says only "a tick made by mistake" on a reversed round', async () => {
    const reversed = householdRequest(
      gridRow({
        rounds: [
          roundOut(1, 'posted', { posted: 1800, posted_on: '2027-03-09', clawed_back: true }),
        ],
      })
    )
    render(<RoundChecklist request={reversed} line={lineOf(reversed)} year={2027} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /^Posted/ }))
    expect(screen.getByText('For a tick made by mistake.')).toBeInTheDocument()
    expect(screen.queryByText(/A posted amount stands/)).not.toBeInTheDocument()
  })

  it("names the figure undoing returns to when the posted amount differs from today's (owner-approved)", async () => {
    const moved = householdRequest(
      gridRow({
        rounds: [
          roundOut(1, 'posted', {
            decided: 1600,
            posted: 1800,
            posted_on: '2027-03-09',
            would_change_by: -200,
          }),
        ],
      })
    )
    render(<RoundChecklist request={moved} line={lineOf(moved)} year={2027} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /^Posted/ }))
    expect(
      screen.getByText(
        "For a tick made by mistake. Undoing returns Round 1 to today's $1,600; marking it posted again locks that."
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/A posted amount stands/)).not.toBeInTheDocument()
  })

  it('names it on a reversed round too when the figures differ', async () => {
    const reversed = householdRequest(
      gridRow({
        rounds: [
          roundOut(1, 'posted', {
            decided: 1600,
            posted: 1800,
            posted_on: '2027-03-09',
            clawed_back: true,
          }),
        ],
      })
    )
    render(<RoundChecklist request={reversed} line={lineOf(reversed)} year={2027} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /^Posted/ }))
    expect(
      screen.getByText(
        "For a tick made by mistake. Undoing returns Round 1 to today's $1,600; marking it posted again locks that."
      )
    ).toBeInTheDocument()
  })

  // Ruled 2026-10-05: the grid never offers Accepted on a reversed round (ticks.ts acceptedTarget),
  // so neither does the household page; unticking one already accepted stays open.
  describe('Accepted on a reversed round', () => {
    const reversedRound = (accepted: boolean) =>
      householdRequest(
        gridRow({
          rounds: [
            roundOut(1, 'posted', {
              posted: 1800,
              posted_on: '2027-03-09',
              clawed_back: true,
              accepted,
            }),
          ],
        })
      )

    it('disables Accepted with a reason when the round is reversed and not accepted', () => {
      const reversed = reversedRound(false)
      render(<RoundChecklist request={reversed} line={lineOf(reversed)} year={2027} />)
      expect(screen.getByRole('checkbox', { name: 'Accepted' })).toBeDisabled()
      expect(screen.getByText('Reversed: nothing to accept')).toBeInTheDocument()
    })

    it('keeps Accepted enabled, with no reason, on a normal posted round', () => {
      render(<RoundChecklist request={samuel} line={lineOf(samuel)} year={2027} />)
      expect(screen.getByRole('checkbox', { name: 'Accepted' })).toBeEnabled()
      expect(screen.queryByText('Reversed: nothing to accept')).not.toBeInTheDocument()
    })

    it('still lets an already-accepted reversed round be unticked', async () => {
      const reversed = reversedRound(true)
      render(<RoundChecklist request={reversed} line={lineOf(reversed)} year={2027} />)
      expect(screen.getByRole('checkbox', { name: 'Accepted' })).toBeEnabled()
      expect(screen.queryByText('Reversed: nothing to accept')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('checkbox', { name: 'Accepted' }))
      expect(accepted).toHaveBeenCalledWith({
        year: 2027,
        body: { rows: [{ request_id: reversed.row.request_id, round: 1 }], accepted: false },
      })
    })
  })

  it('disables Accepted while its write is pending', () => {
    pending = true
    render(<RoundChecklist request={samuel} line={lineOf(samuel)} year={2027} />)
    expect(screen.getByRole('checkbox', { name: 'Accepted' })).toBeDisabled()
  })

  it('closes the undo form after a successful undo', async () => {
    render(<RoundChecklist request={samuel} line={lineOf(samuel)} year={2027} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /^Posted/ }))
    await userEvent.type(screen.getByLabelText('Why undo Posted'), 'Ticked the wrong family{Enter}')
    await waitFor(() => expect(screen.queryByLabelText('Why undo Posted')).not.toBeInTheDocument())
  })
})

describe('a request cancelled in Kindred takes no tick (the server refuses it: reopen first)', () => {
  const cancelled = (rounds: Array<ReturnType<typeof roundOut>>) =>
    householdRequest(
      gridRow({
        rounds,
        cancellation: { by: 'kindred', on: '2027-06-02', reason: 'medical', note: '' },
      })
    )

  it('offers no Mark posted, and says to reopen first', () => {
    const request = cancelled([roundOut(1, 'needs_offer', { ask: 1500, decided: 900 })])
    render(<RoundNextAction request={request} line={lineOf(request)} year={2027} canApprove />)
    expect(screen.queryByRole('button', { name: /Mark Posted/ })).toBeNull()
    expect(screen.getByText('Cancelled in Kindred: reopen it first')).toBeInTheDocument()
  })

  it('offers no Approve or Refuse on a pending Round 3', () => {
    const request = cancelled([
      roundOut(1, 'posted', { posted: 1420 }),
      roundOut(3, 'pending_approval', { pending_approval: 450 }),
    ])
    render(<RoundNextAction request={request} line={lineOf(request, 3)} year={2027} canApprove />)
    expect(screen.queryByRole('button', { name: 'Approve…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refuse…' })).toBeNull()
  })

  it('disables Accepted on a posted round not yet accepted', () => {
    const request = cancelled([roundOut(1, 'posted', { posted: 900, decided: 900 })])
    render(<RoundChecklist request={request} line={lineOf(request)} year={2027} />)
    expect(screen.getByRole('checkbox', { name: 'Accepted' })).toBeDisabled()
  })

  it('still lets an accepted round be unticked, sending accepted: false', async () => {
    const request = cancelled([
      roundOut(1, 'posted', { posted: 900, decided: 900, accepted: true }),
    ])
    render(<RoundChecklist request={request} line={lineOf(request)} year={2027} />)
    const box = screen.getByRole('checkbox', { name: 'Accepted' })
    expect(box).toBeEnabled()
    await userEvent.click(box)
    expect(accepted).toHaveBeenCalledWith({
      year: 2027,
      body: { rows: [{ request_id: request.row.request_id, round: 1 }], accepted: false },
    })
  })
})

describe('while the card has a money editor open (editing)', () => {
  it('hides Mark posted, and says to save or close the edit first', () => {
    render(
      <RoundNextAction request={emma} line={lineOf(emma)} year={2027} canApprove={false} editing />
    )
    expect(screen.queryByRole('button', { name: /Mark Posted/ })).toBeNull()
    expect(screen.getByText('save or close the edit first')).toBeInTheDocument()
  })

  it('disables the Posted undo and the Accepted box', () => {
    render(<RoundChecklist request={samuel} line={lineOf(samuel)} year={2027} editing />)
    expect(screen.getByRole('checkbox', { name: /^Posted/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Accepted' })).toBeDisabled()
  })
})
