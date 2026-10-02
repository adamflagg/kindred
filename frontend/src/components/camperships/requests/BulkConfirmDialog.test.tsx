import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AidWriteError } from '../../../services/camperships/aidApi'
import { BulkConfirmDialog } from './BulkConfirmDialog'
import { ROW_EMMA, ROW_LIAM, ROW_OLIVIA, ROW_SAMUEL } from './gridFixtures'
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
    expect(onDone).toHaveBeenCalledWith('Ticked Posted on 2 requests · $2,200 locked')
  })

  it('labels the dialog total an estimate: the result carries the server figure (bulk ruling Q4)', () => {
    render(
      <BulkConfirmDialog
        plan={tickPlan([ROW_EMMA, ROW_OLIVIA], 'posted')}
        year={2027}
        onClose={() => undefined}
        onDone={onDone}
      />
    )
    expect(screen.getByText(/The total is an estimate/)).toBeInTheDocument()
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
    expect(
      screen.getByText('reqolivia000003: tick Round 1 Posted before Round 2')
    ).toBeInTheDocument()
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

  it('sends one write for a double click (the second finds it already in flight)', async () => {
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
    const confirm = screen.getByRole('button', { name: 'Confirm' })
    await userEvent.dblClick(confirm)
    expect(posted).toHaveBeenCalledTimes(1)
    finish({ year: 2027, written: 1, unchanged: 0, operation_id: 'op1', total_locked: 1420 })
  })
})
