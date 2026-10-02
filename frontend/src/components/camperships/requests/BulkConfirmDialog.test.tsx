import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AidWriteError } from '../../../services/camperships/aidApi'
import { BulkConfirmDialog } from './BulkConfirmDialog'
import { gridRow, roundOut, ROW_EMMA, ROW_LIAM, ROW_OLIVIA, ROW_SAMUEL } from './gridFixtures'
import { tickPlan } from './ticks'

const posted = vi.fn()
const accepted = vi.fn()
vi.mock('../../../hooks/camperships/useAidWrites', () => ({
  useAidTickPosted: () => ({ mutateAsync: posted, isPending: false }),
  useAidTickAccepted: () => ({ mutateAsync: accepted, isPending: false }),
}))

const onDone = vi.fn()

beforeEach(() => {
  posted.mockReset()
  accepted.mockReset()
  onDone.mockReset()
})

describe('BulkConfirmDialog (§4.10)', () => {
  it('shows what it will lock, and writes exactly that', async () => {
    posted.mockResolvedValue({
      year: 2027,
      written: 2,
      unchanged: 0,
      operation_id: 'op1',
      total_locked: 2200,
    })
    render(
      <BulkConfirmDialog
        plan={tickPlan([ROW_EMMA, ROW_OLIVIA], 'posted')}
        year={2027}
        onClose={() => undefined}
        onDone={onDone}
      />
    )
    expect(
      screen.getByText('Tick Posted on 2 requests · 2 families · $2,200 locked')
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(posted).toHaveBeenCalledWith({
      year: 2027,
      body: {
        rows: [
          { request_id: 'reqemma00000001', round: 1, amount: 1420 },
          { request_id: 'reqolivia000003', round: 2, amount: 780 },
        ],
      },
    })
    expect(onDone).toHaveBeenCalledWith(
      'Ticked Posted on 2 requests · $2,200 locked',
      expect.objectContaining({ written: 2, unchanged: 0 })
    )
  })

  // A grid tick locks the confirmed amount or is refused (D41; Decision 9), so its total is exact.
  // Only a bulk placement's total is an estimate (D151). Replaces the Task 16 test that said otherwise.
  it('states the total plainly, with no hedge: it is exact or refused', () => {
    render(
      <BulkConfirmDialog
        plan={tickPlan([ROW_EMMA, ROW_OLIVIA], 'posted')}
        year={2027}
        onClose={() => undefined}
        onDone={onDone}
      />
    )
    expect(screen.queryByText(/estimate/i)).toBeNull()
    expect(screen.getByText(/already ticked is left as it is/)).toBeInTheDocument()
  })

  it('says which rows moved, and to what, when a decided amount changed first (409), and writes nothing', async () => {
    const error = new AidWriteError('Decided amounts moved since they were shown', 409)
    error.rows = [{ request_id: 'reqemma00000001', round: 1, confirmed: 1420, decided_now: 1500 }]
    posted.mockRejectedValue(error)
    render(
      <BulkConfirmDialog
        plan={tickPlan([ROW_EMMA, ROW_OLIVIA], 'posted')}
        year={2027}
        onClose={() => undefined}
        onDone={onDone}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(
      screen.getByText('Emma Johnson R1: now $1,500, you confirmed $1,420')
    ).toBeInTheDocument()
    expect(screen.getByText(/Nothing was ticked/)).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
  })

  it("quotes the server's words on a refusal, and says nothing was ticked (all or nothing)", async () => {
    posted.mockRejectedValue(
      new AidWriteError('reqolivia000003: tick Round 1 Posted before Round 2', 422)
    )
    render(
      <BulkConfirmDialog
        plan={tickPlan([ROW_EMMA, ROW_OLIVIA], 'posted')}
        year={2027}
        onClose={() => undefined}
        onDone={onDone}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByText('Olivia Chen: tick Round 1 Posted before Round 2')).toBeInTheDocument()
    expect(screen.queryByText(/reqolivia/)).toBeNull()
    expect(screen.getByText(/Nothing was ticked/)).toBeInTheDocument()
  })

  it('does not claim nothing was ticked when the answer never arrived', async () => {
    posted.mockRejectedValue(new TypeError('Failed to fetch'))
    render(
      <BulkConfirmDialog
        plan={tickPlan([ROW_EMMA], 'posted')}
        year={2027}
        onClose={() => undefined}
        onDone={onDone}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.queryByText(/Nothing was ticked/)).toBeNull()
    expect(screen.getByText(/can't tell whether/)).toBeInTheDocument()
  })

  it('refuses a plan over the server limit instead of splitting it', () => {
    const many = Array.from({ length: 901 }, (_, i) => ({
      ...ROW_EMMA,
      request_id: `req${String(i).padStart(12, '0')}`,
    }))
    render(
      <BulkConfirmDialog
        plan={tickPlan(many, 'posted')}
        year={2027}
        onClose={() => undefined}
        onDone={onDone}
      />
    )
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
    expect(screen.getByText(/at most 900/)).toBeInTheDocument()
  })

  it('ticks Accepted on each round with accepted: true', async () => {
    accepted.mockResolvedValue({ year: 2027, written: 1, unchanged: 0, operation_id: 'op2' })
    render(
      <BulkConfirmDialog
        plan={tickPlan([ROW_SAMUEL], 'accepted')}
        year={2027}
        onClose={() => undefined}
        onDone={onDone}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(accepted).toHaveBeenCalledWith({
      year: 2027,
      body: { rows: [{ request_id: 'reqsamuel000005', round: 1 }], accepted: true },
    })
  })

  it('names the selected rows it leaves out', () => {
    render(
      <BulkConfirmDialog
        plan={tickPlan([ROW_EMMA, ROW_LIAM], 'posted')}
        year={2027}
        onClose={() => undefined}
        onDone={onDone}
      />
    )
    expect(screen.getByText(/Nothing to tick on Liam Garcia/)).toBeInTheDocument()
  })

  // Two guards stop a double submit (`disabled={busy}` and `if (busy) return` in confirm), so dropping
  // either alone is an equivalent mutant; dropping BOTH makes this fail (checked in the PR 4 fix wave).
  it('sends one write for a double click (the button is disabled once it is in flight)', async () => {
    let finish: (v: unknown) => void = () => undefined
    posted.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    render(
      <BulkConfirmDialog
        plan={tickPlan([ROW_EMMA], 'posted')}
        year={2027}
        onClose={() => undefined}
        onDone={onDone}
      />
    )
    await userEvent.dblClick(screen.getByRole('button', { name: 'Confirm' }))
    expect(posted).toHaveBeenCalledTimes(1)
    finish({ year: 2027, written: 1, unchanged: 0, operation_id: 'op1', total_locked: 1420 })
  })

  it('shows Ticking… while the write is in flight, and cannot be closed by Cancel or Escape', async () => {
    let finish: (v: unknown) => void = () => undefined
    posted.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const onClose = vi.fn()
    render(
      <BulkConfirmDialog
        plan={tickPlan([ROW_EMMA], 'posted')}
        year={2027}
        onClose={onClose}
        onDone={onDone}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByRole('button', { name: 'Ticking…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    await act(async () =>
      finish({ year: 2027, written: 1, unchanged: 0, operation_id: 'op1', total_locked: 1420 })
    )
  })

  it('says ticking again is safe when the answer never arrived', async () => {
    posted.mockRejectedValue(new TypeError('Failed to fetch'))
    render(
      <BulkConfirmDialog
        plan={tickPlan([ROW_EMMA], 'posted')}
        year={2027}
        onClose={() => undefined}
        onDone={onDone}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByText(/ticking again is safe/)).toBeInTheDocument()
  })

  it('disables Confirm after a 409: the same plan can only be refused again', async () => {
    const error = new AidWriteError('Decided amounts moved since they were shown', 409)
    error.rows = [{ request_id: 'reqemma00000001', round: 1, confirmed: 1420, decided_now: 1500 }]
    posted.mockRejectedValue(error)
    render(
      <BulkConfirmDialog
        plan={tickPlan([ROW_EMMA], 'posted')}
        year={2027}
        onClose={() => undefined}
        onDone={onDone}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
  })

  it('lists every ticked row with its amount, and marks the ones a search or filter hides', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      ...ROW_EMMA,
      request_id: `req${String(i).padStart(12, '0')}`,
      camper_name: `Camper ${String(i)}`,
    }))
    render(
      <BulkConfirmDialog
        plan={tickPlan(many, 'posted', new Set([many[14]?.request_id ?? '']))}
        year={2027}
        onClose={() => undefined}
        onDone={onDone}
      />
    )
    expect(
      screen.getByText(/Camper 14 · Round 1 · \$1,420 \(hidden by the search or filters\)/)
    ).toBeInTheDocument()
    expect(screen.getAllByText(/Round 1 · \$1,420/)).toHaveLength(15)
  })

  it('caps the names it leaves out at ten, and says how many more', () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({
      ...ROW_LIAM,
      request_id: `reqliam${String(i).padStart(8, '0')}`,
      camper_name: `Nobody ${String(i)}`,
    }))
    render(
      <BulkConfirmDialog
        plan={tickPlan([ROW_EMMA, ...rows], 'posted')}
        year={2027}
        onClose={() => undefined}
        onDone={onDone}
      />
    )
    expect(screen.getByText(/Nobody 9/)).toBeInTheDocument()
    expect(screen.queryByText(/Nobody 10/)).toBeNull()
    expect(screen.getByText(/and 3 more/)).toBeInTheDocument()
  })

  it('names a row skipped for a reason, in staff words', () => {
    const blocked = gridRow({
      request_id: 'reqearlier00001',
      camper_name: 'Samuel Johnson',
      rounds: [
        roundOut(1, 'pending_approval', { ask: 2000 }),
        roundOut(2, 'needs_offer', { decided: 700 }),
      ],
    })
    render(
      <BulkConfirmDialog
        plan={tickPlan([ROW_EMMA, blocked], 'posted')}
        year={2027}
        onClose={() => undefined}
        onDone={onDone}
      />
    )
    expect(screen.getByText(/Samuel Johnson \(Round 1 isn't posted yet\)/)).toBeInTheDocument()
  })

  // The registrar compares this line with what CampMinder holds after a reverse-and-repost, which is
  // the request's new total, the same figure as the grid's New total cell. The locked amount and the
  // "$X locked" total stay the round amounts: that is what the server locks.
  it("shows an appeal's new total beside its round amount, and a Round 1 line unchanged", () => {
    render(
      <BulkConfirmDialog
        plan={tickPlan([ROW_EMMA, ROW_OLIVIA], 'posted')}
        year={2027}
        onClose={() => undefined}
        onDone={onDone}
      />
    )
    expect(screen.getByText('Olivia Chen · Round 2 · $780 (new total $2,200)')).toBeInTheDocument()
    expect(screen.getByText('Emma Johnson · Round 1 · $1,420')).toBeInTheDocument()
    expect(
      screen.getByText('Tick Posted on 2 requests · 2 families · $2,200 locked')
    ).toBeInTheDocument()
  })

  it('reads "Nothing to tick" for an empty plan, not a $0 lock (PR 4 review M2)', () => {
    render(
      <BulkConfirmDialog
        plan={tickPlan([ROW_LIAM], 'posted')}
        year={2027}
        onClose={() => undefined}
        onDone={onDone}
      />
    )
    expect(screen.getByText('Nothing to tick')).toBeInTheDocument()
    expect(screen.queryByText(/0 requests/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
  })
})
